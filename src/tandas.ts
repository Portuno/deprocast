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
import { nanTranscribir, nanVision } from './nan.ts'
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

let transcribir = (db: Db, audio: Buffer, nombre: string) => nanTranscribir(db, audio, nombre)
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

const SISTEMA_VOCES = `Te paso la transcripción de una nota de voz grabada por el operador (Whisper, sin marcas de quién habla). Puede ser él solo pensando en voz alta, o una charla con otras personas.
Separá las voces por lo que se dice (cambios de turno, preguntas y respuestas, quién se nombra) y decidí cuál es él (habla en primera persona de sus proyectos y su vida; los demás le hablan a él).
Forma: {"titulo": string (máx. 60, de qué va), "voces": number, "operador": "A" | null, "nombres": {"B": "nombre si se lo nombra"}, "turnos": [{"voz": "A" | "B" | "C"…, "texto": string}]}
- Si es una sola voz: voces 1, operador "A" y un único turno con todo el texto.
- Copiá el texto tal cual (no resumas ni corrijas), solo partilo en turnos.
- Si no se puede saber cuál es él, operador null. No inventes nombres.`

type Voces = { titulo: string | null; voces: number; operador: string | null; nombres: Record<string, string>; turnos: { voz: string; texto: string }[] }

/** Quién habla en una grabación. Corto o de una sola voz: no gasta modelo. */
export async function separarVoces(db: Db, texto: string, nombreOperador: string): Promise<Voces> {
  const solo: Voces = { titulo: null, voces: 1, operador: 'A', nombres: {}, turnos: [{ voz: 'A', texto }] }
  if (texto.length < 400) return solo
  try {
    const { datos } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'diarizador' }, SISTEMA_VOCES, `El operador se llama ${nombreOperador}.\n\nTranscripción:\n${texto.slice(0, 24000)}`, { temperatura: 0.1, maxTokens: 9000 })
    const turnos = (Array.isArray(datos.turnos) ? datos.turnos : []).filter((t: any) => t?.texto?.trim()).map((t: any) => ({ voz: String(t.voz ?? 'A').slice(0, 3), texto: String(t.texto).trim() }))
    // Si el modelo resumió en vez de copiar, se pierde texto: mejor quedarse con la transcripción entera como una voz.
    const largo = turnos.reduce((s: number, t: { texto: string }) => s + t.texto.length, 0)
    if (!turnos.length || largo < texto.length * 0.8) return { ...solo, titulo: typeof datos.titulo === 'string' ? datos.titulo : null }
    return { titulo: typeof datos.titulo === 'string' ? datos.titulo.slice(0, 80) : null, voces: Math.max(1, Number(datos.voces) || new Set(turnos.map((t: any) => t.voz)).size), operador: datos.operador ?? null, nombres: datos.nombres && typeof datos.nombres === 'object' ? datos.nombres : {}, turnos }
  } catch {
    return solo
  }
}

async function procesarAudio(db: Db, t: Tanda, ruta: string): Promise<number> {
  const partes = tramos(ruta, t.bytes)
  const textos: string[] = []
  for (const p of partes) textos.push((await transcribir(db, fs.readFileSync(p), path.basename(p).replace(/\.oga$/, '.ogg'))).trim())
  if (partes[0] !== ruta) fs.rmSync(path.dirname(partes[0]), { recursive: true, force: true })
  const texto = textos.filter(Boolean).join('\n')
  if (!texto) throw new Error('No había voz que transcribir')
  const yo = personaje(db, 'jugador').nombre
  const v = await separarVoces(db, texto, yo)
  const quien = (voz: string) => (voz === v.operador ? yo : v.nombres[voz] || `Voz ${voz}`)
  const contenido = v.voces > 1 ? v.turnos.map((x) => `[${quien(x.voz)}] ${x.texto}`).join('\n') : texto
  const [fecha, hora] = (t.fecha ?? '').split(' ')
  asegurarFuente(db, { id: 'voz', nombre: 'Notas de voz', nivel: 'propia', descripcion: 'Lo que grabás caminando o pensando en voz alta.' })
  const pieza = insertar(db, {
    fuente: 'voz', nivel: 'propia', estado: 'disponible', titulo: `Audio${fecha ? ` · ${fecha}${hora ? ` ${hora}` : ''}` : ''} · ${v.titulo ?? texto.slice(0, 50)}`,
    contenido, fecha: fecha || null, etiquetas: ['audio', ...(v.voces > 1 ? ['varias-voces'] : [])], origenId: `tanda:${t.id}`,
    datos: { archivo: t.archivo, voces: v.voces, operador: v.operador, nombres: v.nombres },
  })!
  // El escriba aprende solo de lo que dijo él; si no se sabe cuál es él, no aprende nada de esta grabación.
  const suyo = v.voces > 1 ? (v.operador ? v.turnos.filter((x) => x.voz === v.operador).map((x) => x.texto).join('\n') : '') : texto
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
function aJpeg(ruta: string, bytes: number): { datos: Buffer; mime: string } {
  const ext = path.extname(ruta).toLowerCase()
  const directo = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) && bytes <= 4 * 1024 * 1024
  if (directo) return { datos: fs.readFileSync(ruta), mime: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg' }
  const salida = path.join(os.tmpdir(), `mastro-pag-${Date.now()}.jpg`)
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', ruta, '-vf', "scale='min(2000,iw)':-2", '-q:v', '3', salida], { encoding: 'utf8' })
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
