/**
 * Tandas: lo suyo que entra de a muchos. Notas de voz (las que graba caminando) y páginas de sus cuadernos
 * escaneados o fotografiados. Cada archivo entra a una cola y se procesa de a uno:
 * - Audio: Whisper (partido en tramos de 10 min con ffmpeg si es largo) → separar voces (quién habla, cuál es él) →
 *   pieza propia con su fecha → el escriba aprende SOLO de lo que dijo él.
 * - Página: visión de NaN → transcripción fiel (con listas, flechas y dibujos descritos) → pieza propia
 *   «Cuaderno · hoja N» → el escriba aprende (la letra es suya).
 * Repetir un archivo no lo duplica (huella del contenido).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolverRuta, type Db } from './db.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { nanTranscribirDetallado, nanVision } from './nan.ts'
import { frases, pcm, rasgoDeTramo, agruparFrases, type Palabra } from './voces.ts'
import { leerJson, pedirJson } from './modelo.ts'
import { escribaDeMemoria } from './memoria.ts'
import { personaje } from './personajes.ts'

export type Tanda = {
  id: number; tipo: 'audio' | 'pagina'; archivo: string; bytes: number; fecha: string | null; cuaderno: string | null; hoja: number | null
  estado: 'pendiente' | 'procesando' | 'hecha' | 'fallo'; piezaId: number | null; error: string | null; creadaEn: number; hechaEn: number | null
}
const deFila = (r: any): Tanda => ({
  id: r.id, tipo: r.tipo, archivo: r.archivo, bytes: r.bytes, fecha: r.fecha, cuaderno: r.cuaderno, hoja: r.hoja, estado: r.estado,
  piezaId: r.pieza_id, error: r.error, creadaEn: r.creada_en, hechaEn: r.hecha_en,
})

const dirTandas = () => path.resolve(process.env.MASTRO_TANDAS ?? path.join(path.dirname(resolverRuta()), 'tandas'))
const AUDIO = /\.(m4a|mp3|wav|ogg|oga|opus|webm|aac|flac|mp4|amr|3gp)$/i
const IMAGEN = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i

// ─── inyectables (tests) ────────────────────────────────────────────────

let transcribir = async (db: Db, audio: Buffer, nombre: string): Promise<{ texto: string; palabras: Palabra[] }> => nanTranscribirDetallado(db, audio, nombre)
let leerPagina = async (db: Db, imagen: Buffer, mime: string, sistema: string, texto: string) =>
  (await nanVision({ db, clase: 'mastropiero', agenteId: 'visionario' }, { sistema, texto, imagen: `data:${mime};base64,${imagen.toString('base64')}`, maxTokens: 4000 })).texto
let escriba = (db: Db, texto: string, pieza: number) => escribaDeMemoria(db, texto, null, { pieza })
export function _probarTandas(o: { transcribir?: typeof transcribir; leerPagina?: typeof leerPagina; escriba?: typeof escriba }) {
  if (o.transcribir) transcribir = o.transcribir
  if (o.leerPagina) leerPagina = o.leerPagina
  if (o.escriba) escriba = o.escriba
}

// ─── fechas por nombre de archivo ───────────────────────────────────────

/**
 * La fecha (y hora) de una grabación por su nombre: «2026-09-30 06.21.00», «AUD-20260930-WA0001», «PTT-20260930»,
 * «Grabación 30-09-2026», «20260930_062100», «Nota de voz 30.09.26». Si no hay, la del archivo (la manda el navegador).
 */
export function fechaDeNombre(nombre: string): { fecha: string; hora: string | null } | null {
  const n = nombre.replace(/\.[^.]+$/, '')
  let m = /(20\d\d)[-_.]?(0[1-9]|1[0-2])[-_.]?([0-2]\d|3[01])(?:[ _T-]?([01]\d|2[0-3])[.:_-]?([0-5]\d)(?:[.:_-]?[0-5]\d)?)?/.exec(n)
  if (m) return { fecha: `${m[1]}-${m[2]}-${m[3]}`, hora: m[4] ? `${m[4]}:${m[5]}` : null }
  m = /\b([0-2]?\d|3[01])[-_.]([0]?[1-9]|1[0-2])[-_.]((?:20)?\d\d)\b/.exec(n)
  if (m) return { fecha: `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, hora: null }
  return null
}

// ─── cola ───────────────────────────────────────────────────────────────

export function encolar(db: Db, t: { tipo?: 'audio' | 'pagina'; nombre: string; datos: Buffer; fecha?: string | null; cuaderno?: string | null; hoja?: number | null }, ahora = Date.now()): { tanda: Tanda; repetida: boolean } {
  const nombre = path.basename(String(t.nombre || 'archivo')).replace(/[^\w.\-() áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 160)
  const tipo = t.tipo ?? (AUDIO.test(nombre) ? 'audio' : IMAGEN.test(nombre) ? 'pagina' : null)
  if (!tipo) throw new Error(`No sé qué hacer con «${nombre}»: subí audios (m4a, mp3, ogg…) o fotos de páginas (jpg, png…). Un PDF, exportalo como imágenes.`)
  if (!t.datos?.length) throw new Error('El archivo está vacío')
  const huella = crypto.createHash('sha1').update(t.datos).digest('hex')
  const ya = db.prepare('SELECT * FROM tandas WHERE huella = ?').get(huella) as any
  if (ya) return { tanda: deFila(ya), repetida: true }
  const dir = path.join(dirTandas(), tipo === 'audio' ? 'audios' : 'paginas')
  fs.mkdirSync(dir, { recursive: true })
  const ruta = path.join(dir, `${ahora}-${nombre}`)
  fs.writeFileSync(ruta, t.datos)
  const porNombre = fechaDeNombre(nombre)
  const fecha = porNombre ? `${porNombre.fecha}${porNombre.hora ? ` ${porNombre.hora}` : ''}` : t.fecha?.trim() || null
  let hoja = t.hoja ?? null
  const cuaderno = tipo === 'pagina' ? (t.cuaderno?.trim() || 'Cuaderno') : null
  if (tipo === 'pagina' && hoja == null) hoja = ((db.prepare('SELECT MAX(hoja) AS h FROM tandas WHERE cuaderno = ?').get(cuaderno) as any).h ?? 0) + 1
  const r = db.prepare(`INSERT INTO tandas (tipo, archivo, ruta, bytes, huella, fecha, cuaderno, hoja, estado, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)`)
    .run(tipo, nombre, ruta, t.datos.length, huella, fecha, cuaderno, hoja, ahora)
  return { tanda: leerTanda(db, Number(r.lastInsertRowid))!, repetida: false }
}

export const leerTanda = (db: Db, id: number): Tanda | null => { const r = db.prepare('SELECT * FROM tandas WHERE id = ?').get(id); return r ? deFila(r) : null }

export function listarTandas(db: Db, limite = 80) {
  const n = (estado: string) => (db.prepare('SELECT COUNT(*) AS n FROM tandas WHERE estado = ?').get(estado) as any).n as number
  return {
    tandas: db.prepare('SELECT * FROM tandas ORDER BY id DESC LIMIT ?').all(limite).map(deFila),
    cuenta: { pendiente: n('pendiente'), procesando: n('procesando'), hecha: n('hecha'), fallo: n('fallo') },
    cuadernos: (db.prepare(`SELECT cuaderno, MAX(hoja) AS hoja FROM tandas WHERE cuaderno IS NOT NULL GROUP BY cuaderno ORDER BY MAX(id) DESC`).all() as any[]).map((r) => ({ nombre: r.cuaderno, ultimaHoja: r.hoja })),
  }
}

export function reintentar(db: Db, id: number) {
  db.prepare(`UPDATE tandas SET estado = 'pendiente', error = NULL WHERE id = ? AND estado = 'fallo'`).run(id)
}

// ─── audio ──────────────────────────────────────────────────────────────

/** Whisper aguanta ~25 MB: lo más largo se parte en tramos de 10 minutos (sin recodificar) y se transcribe por partes. */
function tramos(ruta: string, bytes: number): string[] {
  if (bytes <= 24 * 1024 * 1024) return [ruta]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-tramos-'))
  const ext = path.extname(ruta) || '.m4a'
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', ruta, '-f', 'segment', '-segment_time', '600', '-c', 'copy', path.join(dir, `t%03d${ext}`)], { encoding: 'utf8' })
  const salida = fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((f) => path.join(dir, f)) : []
  if (r.status !== 0 || !salida.length) throw new Error('El audio es muy largo para transcribirlo de una y no pude partirlo (¿falta ffmpeg?)')
  return salida
}

const SISTEMA_VOCES = `Te paso una nota de voz grabada por el operador, partida en frases numeradas (Whisper, sin marcas de quién habla). Puede ser él solo pensando en voz alta, o una charla con otras personas.
Cada frase trae una pista acústica: la voz que le asignó un medidor de tono y timbre (A, B) y su tono en semitonos. Te digo cuánto confiar en la pista.
Decidí quién dice cada frase y cuál de las voces es él (habla en primera persona de sus proyectos y su vida; los demás le hablan a él, le preguntan, le cuentan lo suyo).
Forma: {"titulo": string (máx. 60, de qué va), "voces": number, "operador": "A" | null, "nombres": {"B": "nombre si se lo nombra"}, "frases": ["A" | "B" | "C" | "?"]}
- «frases» tiene exactamente una entrada por frase, en orden: la voz de cada una, o "?" si no se puede saber.
- Si es una sola persona hablando: voces 1, operador "A" y todas las frases "A". No inventes una segunda voz porque cambie el tema o el tono de una frase.
- Si hay diálogo, marcá con "A" al operador y con "B", "C"… a los demás. Las preguntas y sus respuestas suelen ser de voces distintas.
- Si no se puede saber cuál es él, operador null. No inventes nombres.`

type Voces = { titulo: string | null; voces: number; operador: string | null; nombres: Record<string, string>; turnos: { voz: string; texto: string }[] }

/** Une frases seguidas de la misma voz. */
function aTurnos(textos: string[], voces: string[]): { voz: string; texto: string }[] {
  const out: { voz: string; texto: string }[] = []
  textos.forEach((t, i) => {
    const ult = out.at(-1)
    if (ult && ult.voz === voces[i]) ult.texto += ` ${t}`
    else out.push({ voz: voces[i], texto: t })
  })
  return out
}

/**
 * Quién habla en una grabación. Con las palabras de Whisper y el audio: frases con su pista acústica (tono y timbre)
 * y el modelo decide frase por frase, sin reescribir el texto. Sin palabras ni audio: todo el texto como una voz, salvo
 * que el modelo lea un diálogo claro (y ahí, ante la duda, no se le atribuye nada a él).
 */
export async function separarVoces(db: Db, texto: string, nombreOperador: string, o: { palabras?: Palabra[]; ruta?: string } = {}): Promise<Voces> {
  const solo: Voces = { titulo: null, voces: 1, operador: 'A', nombres: {}, turnos: [{ voz: 'A', texto }] }
  const fs_ = o.palabras?.length ? frases(o.palabras) : []
  if (texto.length < 400 && fs_.length < 4) return solo
  // La pista acústica: por frase, la voz que sugiere el medidor y su tono.
  let pista: { voz: string; tono: number | null }[] = []
  let distancia = 0
  const m = o.ruta && fs_.length ? pcm(o.ruta) : null
  if (m) {
    const rs = fs_.map((f) => rasgoDeTramo(m, f.desde, f.hasta))
    const g = agruparFrases(fs_, rs)
    distancia = g.distancia
    // Solo se pasa cuando el sonido es inequívoco: una pista dudosa arrastra al modelo (se probó: la sigue frase por frase).
    if (g.dos) pista = fs_.map((_, i) => ({ voz: String.fromCharCode(65 + g.etiquetas[i]), tono: Number.isFinite(rs[i].tono) ? Math.round(rs[i].tono * 10) / 10 : null }))
  }
  const unidades = fs_.length ? fs_.map((f) => f.texto) : texto.split(/(?<=[.?!…])\s+/).filter((x) => x.trim())
  const confianza = pista.length
    ? `Pista acústica: hay dos voces bien distintas (a ${distancia} semitonos, una grave y una aguda). Usala, salvo que el contenido la contradiga claramente.`
    : 'No hay pista acústica confiable: decidí por el contenido (preguntas y respuestas, quién cuenta qué, en primera persona de quién).'
  try {
    const lista = unidades.map((t, i) => `[${i + 1}]${pista[i] ? ` (voz ${pista[i].voz}${pista[i].tono != null ? ` · tono ${pista[i].tono}` : ''})` : ''} ${t}`).join('\n')
    const { datos } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'diarizador' }, SISTEMA_VOCES, `El operador se llama ${nombreOperador}.\n${confianza}\n\nFrases:\n${lista.slice(0, 30000)}`, { temperatura: 0.1, maxTokens: 4000 })
    const vs: string[] = Array.isArray(datos.frases) ? datos.frases.map((v: unknown) => String(v ?? '?').trim().toUpperCase().slice(0, 1) || '?') : []
    const titulo = typeof datos.titulo === 'string' ? datos.titulo.slice(0, 80) : null
    if (vs.length !== unidades.length) throw new Error('el modelo no devolvió una voz por frase')
    const distintas = new Set(vs.filter((v) => v !== '?'))
    if (distintas.size <= 1 && !vs.includes('?')) return { ...solo, titulo, operador: datos.operador === null ? null : 'A' }
    const operador = typeof datos.operador === 'string' && distintas.has(datos.operador.toUpperCase()) ? datos.operador.toUpperCase() : null
    return { titulo, voces: Math.max(1, distintas.size), operador, nombres: datos.nombres && typeof datos.nombres === 'object' ? datos.nombres : {}, turnos: aTurnos(unidades, vs) }
  } catch {
    // Sin modelo: si el sonido dice claramente dos voces, se respeta pero no se sabe cuál es él; si no, una sola voz.
    if (pista.length && new Set(pista.map((p) => p.voz)).size > 1) return { titulo: null, voces: 2, operador: null, nombres: {}, turnos: aTurnos(unidades, pista.map((p) => p.voz)) }
    return solo
  }
}

async function procesarAudio(db: Db, t: Tanda, ruta: string): Promise<number> {
  const partes = tramos(ruta, t.bytes)
  const textos: string[] = []
  const palabras: Palabra[] = []
  let corrimiento = 0
  for (const p of partes) {
    const r = await transcribir(db, fs.readFileSync(p), path.basename(p).replace(/\.oga$/, '.ogg'))
    textos.push(r.texto.trim())
    // Los tiempos de cada tramo se corren a su lugar en el audio entero.
    for (const w of r.palabras) palabras.push({ start: w.start + corrimiento, end: w.end + corrimiento, word: w.word })
    corrimiento += r.palabras.at(-1)?.end ?? 600
  }
  if (partes[0] !== ruta) fs.rmSync(path.dirname(partes[0]), { recursive: true, force: true })
  const texto = textos.filter(Boolean).join('\n')
  if (!texto) throw new Error('No había voz que transcribir')
  const yo = personaje(db, 'jugador').nombre
  // Con varios tramos los tiempos son aproximados: la pista acústica solo se usa con el audio entero.
  const v = await separarVoces(db, texto, yo, { palabras: partes.length === 1 ? palabras : [], ruta: partes.length === 1 ? ruta : undefined })
  const quien = (voz: string) => (voz === '?' ? '¿?' : voz === v.operador ? yo : v.nombres[voz] || `Voz ${voz}`)
  const contenido = v.voces > 1 || v.turnos.some((x) => x.voz === '?') ? v.turnos.map((x) => `[${quien(x.voz)}] ${x.texto}`).join('\n') : texto
  const [fecha, hora] = (t.fecha ?? '').split(' ')
  asegurarFuente(db, { id: 'voz', nombre: 'Notas de voz', nivel: 'propia', descripcion: 'Lo que grabás caminando o pensando en voz alta.' })
  const pieza = insertar(db, {
    fuente: 'voz', nivel: 'propia', estado: 'disponible', titulo: `Audio${fecha ? ` · ${fecha}${hora ? ` ${hora}` : ''}` : ''} · ${v.titulo ?? texto.slice(0, 50)}`,
    contenido, fecha: fecha || null, etiquetas: ['audio', ...(v.voces > 1 ? ['varias-voces'] : [])], origenId: `tanda:${t.id}`,
    datos: { archivo: t.archivo, voces: v.voces, operador: v.operador, nombres: v.nombres },
  })!
  // El escriba aprende solo de lo que dijo él (nunca de lo dudoso); si no se sabe cuál es él, no aprende nada de esta grabación.
  const suyo = v.operador ? v.turnos.filter((x) => x.voz === v.operador).map((x) => x.texto).join('\n') : ''
  if (suyo.trim()) await escriba(db, suyo, pieza).catch(() => [])
  return pieza
}

// ─── página ─────────────────────────────────────────────────────────────

const SISTEMA_PAGINA = `Leés la foto o el escaneo de una página de un cuaderno manuscrito del operador. Transcribí con fidelidad.
Forma: {"titulo": string (máx. 60: el título de la página si tiene, o de qué trata), "transcripcion": string, "dibujos": string | null, "fecha_en_pagina": string | null, "legible": number (0 a 1)}
- «transcripcion»: el texto tal cual, en su orden de lectura. Conservá la estructura: listas, numeraciones, columnas (una tras otra), flechas como →, recuadros como [ ]. No corrijas ni completes; lo ilegible va como [¿…?].
- «dibujos»: diagramas, esquemas, tablas o dibujos descritos en una o dos frases (qué hay y cómo se conecta), o null.
- Si la página está en blanco o no es una página de cuaderno, transcripcion vacía y legible 0.`

/** Fotos enormes o en formatos raros (HEIC): a JPEG de hasta 2000 px con ffmpeg, si hace falta y se puede. */
/**
 * La orientación que dice el EXIF de un JPEG (1 = derecha; 2 a 8 = girada o espejada), sin librerías: el segmento APP1
 * «Exif», su cabecera TIFF y la etiqueta 0x0112 del primer directorio. 1 si no hay o no se entiende.
 */
export function orientacionExif(b: Buffer): number {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1
  let i = 2
  while (i + 4 < b.length && b[i] === 0xff) {
    const marca = b[i + 1]
    const largo = b.readUInt16BE(i + 2)
    if (marca === 0xe1 && b.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
      const t = i + 10
      const le = b.toString('latin1', t, t + 2) === 'II'
      const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o))
      const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
      const ifd = t + u32(t + 4)
      if (ifd + 2 > b.length) return 1
      for (let k = 0, n = u16(ifd); k < n; k++) {
        const e = ifd + 2 + k * 12
        if (e + 12 > b.length) break
        if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1 }
      }
      return 1
    }
    if (marca === 0xda) break // empezó la imagen: ya no hay metadatos
    i += 2 + largo
  }
  return 1
}

/** El filtro de ffmpeg que endereza cada orientación EXIF (null: ya está derecha). */
export function filtroDeOrientacion(o: number): string | null {
  return ({ 2: 'hflip', 3: 'hflip,vflip', 4: 'vflip', 5: 'transpose=0', 6: 'transpose=1', 7: 'transpose=3', 8: 'transpose=2' } as Record<number, string>)[o] ?? null
}

export function aJpeg(ruta: string, bytes: number): { datos: Buffer; mime: string } {
  const ext = path.extname(ruta).toLowerCase()
  // Una foto del celular viene «de costado» con una marca EXIF que el navegador respeta pero el modelo no: se endereza.
  const cabeza = Buffer.alloc(Math.min(bytes, 256 * 1024))
  const fd = fs.openSync(ruta, 'r')
  try { fs.readSync(fd, cabeza, 0, cabeza.length, 0) } finally { fs.closeSync(fd) }
  const girar = filtroDeOrientacion(orientacionExif(cabeza))
  const directo = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) && bytes <= 4 * 1024 * 1024 && !girar
  if (directo) return { datos: fs.readFileSync(ruta), mime: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg' }
  const salida = path.join(os.tmpdir(), `mastro-pag-${Date.now()}.jpg`)
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-noautorotate', '-i', ruta, '-vf', [girar, "scale='min(2000,iw)':-2"].filter(Boolean).join(','), '-map_metadata', '-1', '-q:v', '3', salida], { encoding: 'utf8' })
  if (r.status !== 0 || !fs.existsSync(salida)) {
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return { datos: fs.readFileSync(ruta), mime: ext === '.png' ? 'image/png' : 'image/jpeg' }
    throw new Error(`No pude leer la imagen ${path.basename(ruta)} (si es HEIC, exportala como JPG)`)
  }
  const datos = fs.readFileSync(salida)
  fs.rmSync(salida, { force: true })
  return { datos, mime: 'image/jpeg' }
}

async function procesarPagina(db: Db, t: Tanda, ruta: string): Promise<number> {
  const { datos, mime } = aJpeg(ruta, t.bytes)
  const crudo = await leerPagina(db, datos, mime, SISTEMA_PAGINA, `Página ${t.hoja ?? ''} del cuaderno «${t.cuaderno}». Devolvé solo el JSON.`)
  const p = leerJson<any>(crudo) ?? { transcripcion: crudo, titulo: null }
  const texto = String(p.transcripcion ?? '').trim()
  if (!texto && !p.dibujos) throw new Error('La página parece en blanco o no se pudo leer')
  asegurarFuente(db, { id: 'manuscritos', nombre: 'Manuscritos', nivel: 'propia', descripcion: 'Páginas de tus cuadernos, escaneadas o fotografiadas.' })
  const pieza = insertar(db, {
    fuente: 'manuscritos', nivel: 'propia', estado: 'disponible', tipo: 'materia',
    titulo: `${t.cuaderno} · hoja ${t.hoja}${p.titulo ? ` · ${String(p.titulo).slice(0, 60)}` : ''}`,
    contenido: [texto, p.dibujos ? `[Dibujos y esquemas] ${p.dibujos}` : ''].filter(Boolean).join('\n\n'),
    fecha: /^\d{4}-\d{2}-\d{2}/.test(String(p.fecha_en_pagina ?? '')) ? String(p.fecha_en_pagina).slice(0, 10) : (t.fecha?.slice(0, 10) || null),
    etiquetas: ['cuaderno', 'manuscrito'], origenId: `tanda:${t.id}`,
    datos: { archivo: t.archivo, cuaderno: t.cuaderno, hoja: t.hoja, legible: p.legible ?? null, fechaEnPagina: p.fecha_en_pagina ?? null },
  })!
  if (texto.length > 80) await escriba(db, texto, pieza).catch(() => [])
  return pieza
}

// ─── el obrero ──────────────────────────────────────────────────────────

let trabajando = false
/** Procesa la cola de a uno hasta vaciarla. Se puede llamar cuantas veces se quiera: si ya está andando, no hace nada. */
export async function procesarTandas(db: Db, o: { max?: number } = {}): Promise<number> {
  if (trabajando) return 0
  trabajando = true
  let hechas = 0
  try {
    for (let i = 0; i < (o.max ?? Infinity); i++) {
      const fila = db.prepare(`SELECT * FROM tandas WHERE estado = 'pendiente' ORDER BY id LIMIT 1`).get() as any
      if (!fila) break
      const t = deFila(fila)
      db.prepare(`UPDATE tandas SET estado = 'procesando' WHERE id = ?`).run(t.id)
      try {
        const pieza = t.tipo === 'audio' ? await procesarAudio(db, t, fila.ruta) : await procesarPagina(db, t, fila.ruta)
        db.prepare(`UPDATE tandas SET estado = 'hecha', pieza_id = ?, error = NULL, hecha_en = ? WHERE id = ?`).run(pieza, Date.now(), t.id)
        hechas++
      } catch (e) {
        db.prepare(`UPDATE tandas SET estado = 'fallo', error = ? WHERE id = ?`).run(e instanceof Error ? e.message : String(e), t.id)
      }
    }
  } finally {
    trabajando = false
  }
  return hechas
}

/** Si el servidor se cortó con algo a medias, vuelve a la cola. */
export function retomarTandas(db: Db) {
  db.prepare(`UPDATE tandas SET estado = 'pendiente' WHERE estado = 'procesando'`).run()
}
