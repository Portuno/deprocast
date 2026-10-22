/**
 * El Taller: Mastropiero crea cosas. Juegos (un HTML que corre aislado), imágenes (flux, qwen-image), voces (kokoro),
 * personajes (ficha + imagen + voz, reutilizables) y videos (guion → imágenes → voz → montaje con ffmpeg, o una
 * presentación HTML si no hay ffmpeg). Cada pedido de cambio es una versión nueva. Los archivos viven en data/taller/<id>/.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { json, resolverRuta, type Db } from './db.ts'
import { insertar } from './corpus.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { llamarModelo, pedirJson } from './modelo.ts'
import { nanConfigurado } from './nan.ts'

export const TIPOS_ARTEFACTO = ['juego', 'imagen', 'voz', 'personaje', 'video', 'estudio', 'visual'] as const
export type TipoArtefacto = (typeof TIPOS_ARTEFACTO)[number]
export type Artefacto = {
  id: number; tipo: TipoArtefacto; titulo: string; pedido: string; version: number; padreId: number | null; archivos: string[]
  meta: Record<string, any>; estado: 'haciendo' | 'listo' | 'fallo'; progreso: string | null; creadoEn: number
}

const deFila = (r: any): Artefacto => ({
  id: r.id, tipo: r.tipo, titulo: r.titulo, pedido: r.pedido, version: r.version, padreId: r.padre_id, archivos: json(r.archivos, []),
  meta: json(r.meta, {}), estado: r.estado, progreso: r.progreso, creadoEn: r.creado_en,
})

export const dirTaller = () => path.resolve(process.env.MASTRO_TALLER ?? path.join(path.dirname(resolverRuta()), 'taller'))
export const carpeta = (id: number) => path.join(dirTaller(), String(id))

export function leerArtefacto(db: Db, id: number): Artefacto | null {
  const r = db.prepare('SELECT * FROM artefactos WHERE id = ?').get(id)
  return r ? deFila(r) : null
}
export function listarArtefactos(db: Db, f: { tipo?: string; limite?: number } = {}): Artefacto[] {
  return (f.tipo
    ? db.prepare('SELECT * FROM artefactos WHERE tipo = ? ORDER BY id DESC LIMIT ?').all(f.tipo, f.limite ?? 60)
    : db.prepare('SELECT * FROM artefactos ORDER BY id DESC LIMIT ?').all(f.limite ?? 60)).map(deFila)
}

function nuevo(db: Db, a: { tipo: TipoArtefacto; titulo: string; pedido: string; padreId?: number | null; meta?: Record<string, unknown> }, ahora = Date.now()): Artefacto {
  const padre = a.padreId ? leerArtefacto(db, a.padreId) : null
  const r = db.prepare(`INSERT INTO artefactos (tipo, titulo, pedido, version, padre_id, archivos, meta, estado, progreso, creado_en) VALUES (?, ?, ?, ?, ?, '[]', ?, 'haciendo', ?, ?)`)
    .run(a.tipo, a.titulo.slice(0, 160), a.pedido, padre ? padre.version + 1 : 1, padre?.id ?? null, JSON.stringify(a.meta ?? {}), 'empezando', ahora)
  const id = Number(r.lastInsertRowid)
  fs.mkdirSync(carpeta(id), { recursive: true })
  return leerArtefacto(db, id)!
}

function avance(db: Db, id: number, progreso: string) {
  db.prepare('UPDATE artefactos SET progreso = ? WHERE id = ?').run(progreso, id)
}
function terminar(db: Db, id: number, archivos: string[], meta: Record<string, unknown>) {
  const a = leerArtefacto(db, id)!
  db.prepare(`UPDATE artefactos SET estado = 'listo', progreso = NULL, archivos = ?, meta = ? WHERE id = ?`).run(JSON.stringify(archivos), JSON.stringify({ ...a.meta, ...meta }), id)
}
function fallar(db: Db, id: number, e: unknown) {
  db.prepare(`UPDATE artefactos SET estado = 'fallo', progreso = ? WHERE id = ?`).run(e instanceof Error ? e.message : String(e), id)
}

// ─── NaN: imágenes y voz (inyectables para tests) ───────────────────────

const base = () => (process.env.NAN_BASE_URL ?? 'https://api.nan.builders/v1').replace(/\/+$/, '')
const cabeceras = () => ({ authorization: `Bearer ${process.env.NAN_API_KEY}`, 'content-type': 'application/json' })

let imagenNaN = async (prompt: string, o: { modelo: string; tamano: string }): Promise<Buffer> => {
  const r = await fetch(`${base()}/images/generations`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ model: o.modelo, prompt, size: o.tamano, n: 1 }), signal: AbortSignal.timeout(180_000) })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Imagen ${r.status}: ${JSON.stringify(j).slice(0, 160)}`)
  const d = j.data?.[0]
  if (d?.b64_json) return Buffer.from(d.b64_json, 'base64')
  if (!d?.url) throw new Error('La imagen no vino')
  const img = await fetch(d.url, { signal: AbortSignal.timeout(60_000) })
  return Buffer.from(await img.arrayBuffer())
}
let vozNaN = async (texto: string, voz: string): Promise<Buffer> => {
  const r = await fetch(`${base()}/audio/speech`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ model: 'kokoro', input: texto.slice(0, 4000), voice: voz, response_format: 'mp3' }), signal: AbortSignal.timeout(120_000) })
  if (!r.ok) throw new Error(`Voz ${r.status}: ${(await r.text()).slice(0, 160)}`)
  return Buffer.from(await r.arrayBuffer())
}
/** La voz de kokoro, para quien la necesite fuera del Taller (las respuestas por Telegram). */
export const sintetizar = (texto: string, voz = VOZ_DEFECTO_PUBLICA) => vozNaN(texto, voz)
const VOZ_DEFECTO_PUBLICA = 'em_alex'

export function _probarTaller(o: { imagen?: typeof imagenNaN; voz?: typeof vozNaN }) {
  if (o.imagen) imagenNaN = o.imagen
  if (o.voz) vozNaN = o.voz
}

/** Voces de kokoro en castellano. */
export const VOCES = { 'ef_dora': 'Dora (mujer, castellano)', 'em_alex': 'Alex (hombre, castellano)', 'em_santa': 'Santa (hombre grave, castellano)' } as Record<string, string>
const VOZ_DEFECTO = 'em_alex'

const extension = (b: Buffer) => (b[0] === 0x89 && b[1] === 0x50 ? 'png' : 'jpg')

// ─── creaciones ─────────────────────────────────────────────────────────

const SISTEMA_JUEGO = `Sos el programador del Taller de Mastropiero. Escribís UN juego completo en un solo archivo HTML, autocontenido, que corre en un iframe aislado.
- Todo inline: HTML, CSS y JavaScript. Sin librerías externas, sin fetch, sin localStorage (el iframe no tiene permisos), sin imágenes externas: dibujá con canvas, SVG o CSS.
- Que se pueda jugar ya: instrucciones breves en pantalla, controles de teclado y también táctiles o con mouse, reiniciar, puntaje si corresponde.
- Que se vea bien en oscuro, que escale al tamaño del iframe, y que no tenga errores de consola.
- Textos del juego en castellano rioplatense.
- Compacto: código claro y sin repetir, menos de 500 líneas en total.
Respondé SOLO con el archivo HTML completo, empezando por <!doctype html>. Nada más.`

/** Un juego: el modelo escribe el HTML; con `padreId`, es una versión nueva del anterior con el cambio pedido. */
export async function crearJuego(db: Db, pedido: string, o: { padreId?: number | null; personajeId?: number | null; entidadId?: number | null; ahora?: number } = {}): Promise<Artefacto> {
  const padre = o.padreId ? leerArtefacto(db, o.padreId) : null
  const pj = o.personajeId ? leerArtefacto(db, o.personajeId) : null
  const ent = await contextoDeEntidad(db, o.entidadId)
  const extra = [pj?.meta?.ficha ? `Protagonista: ${pj.meta.ficha.nombre} — ${pj.meta.ficha.descripcion} Su frase: «${pj.meta.ficha.frase}».` : '', ent ? `Sobre esto de su mundo:\n${ent.texto}` : ''].filter(Boolean).join('\n\n')
  pedido = extra ? `${pedido}\n\n${extra}` : pedido
  const a = nuevo(db, { tipo: 'juego', titulo: padre?.titulo ?? pedido.slice(0, 80), pedido, padreId: padre?.id ?? null, meta: { personaje: pj?.id ?? null, entidad: o.entidadId ?? null } }, o.ahora)
  try {
    avance(db, a.id, 'escribiendo el juego')
    let escritos = 0
    const previo = padre ? fs.readFileSync(path.join(carpeta(padre.id), 'index.html'), 'utf8') : null
    const r = await llamarModelo({ db, clase: 'mastropiero', agenteId: 'taller' }, {
      mensajes: [
        { role: 'system', content: SISTEMA_JUEGO },
        { role: 'user', content: previo ? `Este es el juego actual:\n\n${previo}\n\nCambio que pide: ${pedido}\n\nDevolvé el archivo completo con el cambio.` : `El juego que pide: ${pedido}` },
      ],
      // Razonar poco: en DeepSeek el razonamiento come del mismo tope, y un juego necesita los tokens para el código.
      herramientas: [], temperatura: 0.5, maxTokens: 32000, razonarPoco: true,
    }, (parcial) => {
      // En streaming: el proxy no corta las respuestas largas mientras sigan llegando, y se ve el avance.
      const k = Math.floor(parcial.length / 4000)
      if (k > escritos) { escritos = k; avance(db, a.id, `escribiendo el juego (${(parcial.length / 1000).toFixed(0)}K caracteres)`) }
    })
    const html = (r.texto.match(/<!doctype html[\s\S]*<\/html>/i)?.[0] ?? r.texto.replace(/^```(?:html)?\s*|\s*```$/g, '')).trim()
    if (!/<html[\s>]/i.test(html)) throw new Error('El modelo no devolvió un HTML')
    fs.writeFileSync(path.join(carpeta(a.id), 'index.html'), html)
    const titulo = html.match(/<title>([^<]{1,80})<\/title>/i)?.[1]?.trim()
    if (titulo && !padre) db.prepare('UPDATE artefactos SET titulo = ? WHERE id = ?').run(titulo, a.id)
    terminar(db, a.id, ['index.html'], { modelo: r.modelo })
  } catch (e) { fallar(db, a.id, e) }
  return leerArtefacto(db, a.id)!
}

// ─── visuales para aprender (plan v23) ──────────────────────────────────

const BASE_VISUAL = `Sos el ilustrador técnico del Taller de Mastropiero. Escribís UN visual interactivo para entender un concepto, en un solo archivo HTML autocontenido que corre en un iframe aislado.
- Todo inline: HTML, CSS y JavaScript. Sin librerías externas, sin fetch, sin localStorage, sin imágenes externas: dibujá con SVG o canvas.
- Correcto antes que lindo: lo que muestra tiene que ser verdad (proporciones, relaciones, nombres). Si simplificás, decilo en una nota chica.
- Etiquetas y textos en castellano rioplatense. Arriba, una línea con qué es; abajo, una línea de «cómo usarlo».
- Se toca: tocar o pasar el mouse por cada parte la resalta y explica en un panel al costado o abajo. Controles claros (botones, deslizadores).
- Fondo oscuro, que escale al iframe (también a 390 px de ancho), sin errores de consola, menos de 450 líneas.
Respondé SOLO con el archivo HTML completo, empezando por <!doctype html>.`

/** Lo propio de cada clase de visual: qué tiene que mostrar y qué se tiene que poder hacer. */
export const CLASES_VISUAL: Record<string, string> = {
  diagrama: `${BASE_VISUAL}
Clase: DIAGRAMA. Piezas y relaciones: componentes con su símbolo normalizado (en electricidad, los de IEC), flechas de flujo (corriente, datos, energía) y rótulos. Un modo «paso a paso» que recorre el funcionamiento en orden, y un interruptor o parámetro que cambie algo y muestre el efecto.`,
  simulacion: `${BASE_VISUAL}
Clase: SIMULACIÓN. Algo que cambia en el tiempo o en el espacio (una proteína que se pliega, una molécula, un campo, un sistema dinámico). Canvas con animación (requestAnimationFrame), play/pausa, velocidad, reiniciar y uno o dos parámetros con deslizador. Si es 3D, proyectá a 2D con rotación arrastrando (matemática propia, sin librerías).`,
  movimiento: `${BASE_VISUAL}
Clase: MOVIMIENTO DEL CUERPO. Una figura humana articulada (esqueleto simple con cabeza, tronco, brazos y piernas con sus articulaciones) haciendo el ejercicio o la técnica por fases: posición inicial, recorrido y final. Botones por fase y animación continua, vista de frente y de costado, los músculos que trabajan resaltados por fase y los errores típicos (con un botón que muestre el error y su corrección).`,
}

/** Reserva el lugar de un visual (queda «en espera» hasta que la cola lo tome). */
export function reservarVisual(db: Db, v: { clase: string; pedido: string; concepto: string; nivel?: number | null; dominio?: string | null; dominioId?: number | null; clave?: string | null; padreId?: number | null }, ahora = Date.now()): Artefacto {
  if (!CLASES_VISUAL[v.clase]) throw new Error(`Clase de visual desconocida: ${v.clase}`)
  const a = nuevo(db, { tipo: 'visual', titulo: v.concepto, pedido: v.pedido, padreId: v.padreId ?? null, meta: { clase: v.clase, concepto: v.concepto, nivel: v.nivel ?? null, dominio: v.dominio ?? null, dominioId: v.dominioId ?? null, clave: v.clave ?? null } }, ahora)
  avance(db, a.id, 'en espera')
  return leerArtefacto(db, a.id)!
}

/** Genera el visual reservado: el HTML interactivo según su clase. Con padre, es una versión nueva con la mejora pedida. */
export async function crearVisual(db: Db, id: number): Promise<Artefacto> {
  const a = leerArtefacto(db, id)
  if (!a) throw new Error(`No existe el visual ${id}`)
  const padre = a.padreId ? leerArtefacto(db, a.padreId) : null
  try {
    avance(db, a.id, 'dibujando')
    let escritos = 0
    const previo = padre?.archivos.includes('index.html') ? fs.readFileSync(path.join(carpeta(padre.id), 'index.html'), 'utf8') : null
    const r = await llamarModelo({ db, clase: 'mastropiero', agenteId: 'taller' }, {
      mensajes: [
        { role: 'system', content: CLASES_VISUAL[a.meta.clase] ?? CLASES_VISUAL.diagrama },
        { role: 'user', content: previo
          ? `Este es el visual actual:\n\n${previo}\n\nLo que hay que mejorar: ${a.pedido}\n\nDevolvé el archivo completo, mejorado.`
          : `Concepto: ${a.meta.concepto}${a.meta.dominio ? ` (dominio: ${a.meta.dominio}${a.meta.nivel ? `, nivel ${a.meta.nivel} de 6` : ''})` : ''}\nQué tiene que mostrar: ${a.pedido}` },
      ],
      herramientas: [], temperatura: 0.4, maxTokens: 24000, razonarPoco: true,
    }, (parcial) => {
      const k = Math.floor(parcial.length / 4000)
      if (k > escritos) { escritos = k; avance(db, a.id, `dibujando (${(parcial.length / 1000).toFixed(0)}K caracteres)`) }
    })
    const html = (r.texto.match(/<!doctype html[\s\S]*<\/html>/i)?.[0] ?? r.texto.replace(/^```(?:html)?\s*|\s*```$/g, '')).trim()
    if (!/<html[\s>]/i.test(html)) throw new Error('El modelo no devolvió un HTML')
    fs.writeFileSync(path.join(carpeta(a.id), 'index.html'), html)
    terminar(db, a.id, ['index.html'], { modelo: r.modelo })
  } catch (e) { fallar(db, a.id, e) }
  return leerArtefacto(db, a.id)!
}

/** ★ Su valoración (1 a 5) y una nota. Con 4 o 5 queda sellado: es la referencia de ese concepto (la caché lo prefiere). */
export function valorarArtefacto(db: Db, id: number, estrellas: number, nota?: string | null): Artefacto {
  const a = leerArtefacto(db, id)
  if (!a) throw new Error(`No existe el artefacto ${id}`)
  const e = Math.max(1, Math.min(5, Math.round(Number(estrellas))))
  if (!Number.isFinite(e)) throw new Error('De 1 a 5 estrellas')
  db.prepare('UPDATE artefactos SET meta = ? WHERE id = ?').run(JSON.stringify({ ...a.meta, valoracion: e, nota: nota?.trim().slice(0, 500) || null, sellado: e >= 4 }), id)
  return leerArtefacto(db, id)!
}

/** Crear según lo que se pidió (la pantalla y el chat): el mismo camino para todo, que la cola corre de a uno. */
export function crearSegun(db: Db, b: Record<string, any>): Promise<Artefacto> {
  const pedido = String(b.pedido ?? '').trim()
  const n = (v: unknown) => (v == null || v === '' ? null : Number(v))
  const crear = {
    juego: () => crearJuego(db, pedido, { personajeId: n(b.personajeId ?? b.personaje), entidadId: n(b.entidadId ?? b.entidad) }),
    imagen: () => crearImagen(db, pedido, { modelo: b.modelo || undefined, aspecto: b.aspecto || undefined, estilo: b.estilo || null, variantes: n(b.variantes) ?? 1 }),
    voz: () => (b.modo === 'charla' ? crearCharla(db, pedido, { voces: Array.isArray(b.voces) ? (b.voces as [string, string]) : undefined }) : crearVoz(db, pedido, { voz: b.voz || undefined })),
    charla: () => crearCharla(db, pedido),
    personaje: () => crearPersonaje(db, pedido, { entidadId: n(b.entidadId ?? b.entidad) }),
    video: () => crearVideo(db, pedido, { personajeId: n(b.personajeId ?? b.personaje), voz: b.voz || undefined, formato: b.formato || undefined, escenas: n(b.escenas) ?? undefined, movimiento: b.movimiento !== false }),
  }[b.tipo as string]
  if (!crear) throw new Error('Tipo inválido')
  return crear()
}

/** Formatos: el tamaño que se le pide al modelo y la resolución del video. */
export const ASPECTOS: Record<string, { imagen: string; video: [number, number]; nombre: string }> = {
  '1:1': { imagen: '1024x1024', video: [1080, 1080], nombre: 'Cuadrado' },
  '16:9': { imagen: '1344x768', video: [1280, 720], nombre: 'Apaisado' },
  '9:16': { imagen: '768x1344', video: [720, 1280], nombre: 'Vertical' },
}
/** Estilos de imagen (se suman al pedido, en inglés: los modelos de imagen rinden mejor así). */
export const ESTILOS: Record<string, { nombre: string; prompt: string }> = {
  foto: { nombre: 'Foto', prompt: 'photorealistic photograph, natural light, sharp focus' },
  ilustracion: { nombre: 'Ilustración', prompt: 'detailed digital illustration, clean lines' },
  acuarela: { nombre: 'Acuarela', prompt: 'watercolor painting, soft washes, paper texture' },
  '3d': { nombre: '3D', prompt: '3D render, soft studio lighting, high detail' },
  pixel: { nombre: 'Pixel art', prompt: 'pixel art, 16-bit, crisp pixels' },
  cine: { nombre: 'Cine', prompt: 'cinematic film still, dramatic lighting, anamorphic lens' },
  plano: { nombre: 'Plano', prompt: 'flat vector design, bold shapes, limited palette' },
}
const conEstilo = (prompt: string, estilo?: string | null) => (estilo && ESTILOS[estilo] ? `${prompt}. Style: ${ESTILOS[estilo].prompt}` : prompt)

/** Una imagen en el tamaño pedido; si el modelo no acepta ese tamaño, cuadrada. */
async function pintar(prompt: string, modelo: string, aspecto: string): Promise<Buffer> {
  const tamano = (ASPECTOS[aspecto] ?? ASPECTOS['1:1']).imagen
  try { return await imagenNaN(prompt, { modelo, tamano }) } catch (e) {
    if (tamano === '1024x1024') throw e
    return imagenNaN(prompt, { modelo, tamano: '1024x1024' })
  }
}

export async function crearImagen(db: Db, prompt: string, o: { modelo?: string; tamano?: string; aspecto?: string; estilo?: string | null; variantes?: number; padreId?: number | null; ahora?: number } = {}): Promise<Artefacto> {
  const padre = o.padreId ? leerArtefacto(db, o.padreId) : null
  const base = padre ? `${padre.meta.base ?? padre.meta.prompt ?? padre.pedido}. Cambio: ${prompt}` : prompt
  const modelo = o.modelo ?? padre?.meta.modelo ?? 'flux-2-klein'
  const aspecto = o.aspecto && ASPECTOS[o.aspecto] ? o.aspecto : padre?.meta.aspecto ?? '1:1'
  const estilo = o.estilo !== undefined ? o.estilo : padre?.meta.estilo ?? null
  const variantes = Math.max(1, Math.min(4, Math.round(o.variantes ?? padre?.meta.variantes ?? 1)))
  const final = conEstilo(base, estilo)
  const a = nuevo(db, { tipo: 'imagen', titulo: padre?.titulo ?? prompt.slice(0, 80), pedido: prompt, padreId: padre?.id ?? null, meta: { prompt: final, base, modelo, aspecto, estilo, variantes } }, o.ahora)
  try {
    const archivos: string[] = []
    for (let i = 1; i <= variantes; i++) {
      avance(db, a.id, variantes > 1 ? `pintando ${i} de ${variantes}` : 'pintando')
      const img = o.tamano ? await imagenNaN(final, { modelo, tamano: o.tamano }) : await pintar(variantes > 1 ? `${final} (variation ${i})` : final, modelo, aspecto)
      const nombre = variantes > 1 ? `imagen-${i}.${extension(img)}` : `imagen.${extension(img)}`
      fs.writeFileSync(path.join(carpeta(a.id), nombre), img)
      archivos.push(nombre)
    }
    terminar(db, a.id, archivos, {})
  } catch (e) { fallar(db, a.id, e) }
  return leerArtefacto(db, a.id)!
}

export async function crearVoz(db: Db, texto: string, o: { voz?: string; ahora?: number } = {}): Promise<Artefacto> {
  const voz = o.voz && VOCES[o.voz] ? o.voz : VOZ_DEFECTO
  const a = nuevo(db, { tipo: 'voz', titulo: texto.slice(0, 80), pedido: texto, meta: { voz } }, o.ahora)
  try {
    avance(db, a.id, 'grabando')
    fs.writeFileSync(path.join(carpeta(a.id), 'voz.mp3'), await vozNaN(texto, voz))
    terminar(db, a.id, ['voz.mp3'], {})
  } catch (e) { fallar(db, a.id, e) }
  return leerArtefacto(db, a.id)!
}

/**
 * Varios mp3 en uno. Pegarlos tal cual deja la cabecera del primero mandando (duración incluida) y muchos
 * reproductores y decodificadores cortan ahí: con ffmpeg se unen bien; sin ffmpeg, pegados (mejor que nada).
 */
export function unirMp3(partes: Buffer[]): Buffer {
  if (partes.length < 2 || !hayFfmpeg()) return Buffer.concat(partes)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-mp3-'))
  try {
    partes.forEach((p, i) => fs.writeFileSync(path.join(dir, `p${String(i).padStart(3, '0')}.mp3`), p))
    fs.writeFileSync(path.join(dir, 'lista.txt'), partes.map((_, i) => `file 'p${String(i).padStart(3, '0')}.mp3'`).join('\n'))
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-c:a', 'libmp3lame', '-q:a', '4', 'todo.mp3'], { cwd: dir, encoding: 'utf8' })
    return r.status === 0 && fs.existsSync(path.join(dir, 'todo.mp3')) ? fs.readFileSync(path.join(dir, 'todo.mp3')) : Buffer.concat(partes)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Una charla grabada: cada turno con su voz, todo en un mp3. */
export async function crearConversacion(db: Db, titulo: string, turnos: { voz: string; texto: string }[], o: { meta?: Record<string, unknown>; ahora?: number } = {}): Promise<Artefacto> {
  const a = nuevo(db, { tipo: 'voz', titulo, pedido: titulo, meta: { conversacion: true, ...o.meta } }, o.ahora)
  try {
    const partes: Buffer[] = []
    for (const [i, t] of turnos.entries()) {
      avance(db, a.id, `grabando ${i + 1} de ${turnos.length}`)
      partes.push(await vozNaN(t.texto, VOCES[t.voz] ? t.voz : VOZ_DEFECTO))
    }
    fs.writeFileSync(path.join(carpeta(a.id), 'charla.mp3'), unirMp3(partes))
    terminar(db, a.id, ['charla.mp3'], { guion: turnos })
  } catch (e) { fallar(db, a.id, e) }
  return leerArtefacto(db, a.id)!
}

const SISTEMA_PERSONAJE = `Sos el Taller de Mastropiero y diseñás un personaje reutilizable (para juegos, videos, historias).
Forma: {"nombre": string, "descripcion": string (2-3 oraciones), "personalidad": [string], "apariencia_prompt": string (en inglés, para un generador de imágenes: estilo, rasgos, ropa, fondo simple), "frase": string (una frase típica suya, en castellano rioplatense), "voz": "ef_dora" | "em_alex" | "em_santa"}`

/** Lo que se sabe de una entidad de su mundo (para un personaje o un juego que salga de ahí). */
async function contextoDeEntidad(db: Db, entidadId: number | null | undefined): Promise<{ nombre: string; texto: string } | null> {
  if (!entidadId) return null
  const e = db.prepare('SELECT id, nombre, tipo, alias, notas FROM entidades WHERE id = ?').get(entidadId) as any
  if (!e) return null
  const rel = db.prepare('SELECT vinculo, notas FROM relaciones WHERE entidad_id = ?').get(entidadId) as any
  const piezas = db.prepare(`SELECT titulo, contenido FROM corpus WHERE EXISTS (SELECT 1 FROM json_each(COALESCE(corpus.entidades, '[]')) j WHERE j.value = ?) ORDER BY nivel = 'propia' DESC, COALESCE(peso, 0) DESC, id DESC LIMIT 6`).all(entidadId) as { titulo: string; contenido: string }[]
  const texto = [
    `${e.nombre} (${e.tipo})${json<string[]>(e.alias, [])?.length ? `, también «${json<string[]>(e.alias, [])!.slice(0, 4).join('», «')}»` : ''}`,
    e.notas ? `Notas: ${e.notas}` : '',
    rel?.vinculo || rel?.notas ? `Su relación con él: ${[rel.vinculo, rel.notas].filter(Boolean).join('. ')}` : '',
    piezas.length ? `Lo que dice su archivo:\n${piezas.map((p) => `- ${p.titulo}: ${p.contenido.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n')
  return { nombre: e.nombre, texto }
}

export async function crearPersonaje(db: Db, pedido: string, o: { entidadId?: number | null; ahora?: number } = {}): Promise<Artefacto> {
  const ent = await contextoDeEntidad(db, o.entidadId)
  const pedido_ = pedido.trim() || (ent ? `Un personaje basado en ${ent.nombre}` : 'Un personaje')
  const a = nuevo(db, { tipo: 'personaje', titulo: (ent?.nombre ?? pedido_).slice(0, 80), pedido: pedido_, meta: { entidad: o.entidadId ?? null } }, o.ahora)
  try {
    avance(db, a.id, 'imaginándolo')
    const { datos: f } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'taller' }, SISTEMA_PERSONAJE, `Lo que pide: ${pedido_}${ent ? `\n\nSale de alguien o algo de su mundo (respetalo; si es una persona real, que sea un retrato cariñoso, no una burla):\n${ent.texto}` : ''}\n\nLo que sabés del jugador (para que encaje en su mundo):\n${memoriaParaPrompt(db, 20)}`, { temperatura: 0.8, maxTokens: 1500 })
    db.prepare('UPDATE artefactos SET titulo = ? WHERE id = ?').run(String(f.nombre ?? pedido).slice(0, 80), a.id)
    avance(db, a.id, 'dibujándolo')
    const img = await imagenNaN(String(f.apariencia_prompt ?? pedido), { modelo: 'flux-2-klein', tamano: '1024x1024' })
    const nombreImg = `retrato.${extension(img)}`
    fs.writeFileSync(path.join(carpeta(a.id), nombreImg), img)
    avance(db, a.id, 'dándole voz')
    const voz = VOCES[f.voz] ? f.voz : VOZ_DEFECTO
    fs.writeFileSync(path.join(carpeta(a.id), 'voz.mp3'), await vozNaN(String(f.frase ?? f.nombre ?? 'Hola'), voz))
    terminar(db, a.id, [nombreImg, 'voz.mp3'], { ficha: { ...f, voz } })
  } catch (e) { fallar(db, a.id, e) }
  return leerArtefacto(db, a.id)!
}

// ─── video ──────────────────────────────────────────────────────────────

export function hayFfmpeg(): boolean {
  if (process.env.MASTRO_SIN_FFMPEG) return false
  try { return spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0 } catch { return false }
}

const SISTEMA_GUION = `Sos el guionista del Taller de Mastropiero. Escribís el guion de un video corto, en escenas.
- Entre 3 y 8 escenas. Cada escena: «narracion» (lo que dice la voz, 1-3 oraciones, castellano rioplatense) e «imagen» (prompt en inglés para un generador de imágenes: composición clara, estilo coherente en todas las escenas, formato apaisado).
- Si hay un personaje, que aparezca con su apariencia en las imágenes donde corresponda.
Forma: {"titulo": string, "estilo": string, "escenas": [{"narracion": string, "imagen": string}]}`

/** Un video: guion → imágenes y voz por escena (en paralelo, de a 3) → montaje (ffmpeg) o presentación HTML. */
export async function crearVideo(db: Db, pedido: string, o: { personajeId?: number | null; voz?: string; formato?: string; escenas?: number; movimiento?: boolean; ahora?: number } = {}): Promise<Artefacto> {
  const pj = o.personajeId ? leerArtefacto(db, o.personajeId) : null
  const formato = o.formato && ASPECTOS[o.formato] ? o.formato : '16:9'
  const movimiento = o.movimiento !== false
  const cuantas = o.escenas ? Math.max(3, Math.min(8, Math.round(o.escenas))) : null
  const a = nuevo(db, { tipo: 'video', titulo: pedido.slice(0, 80), pedido, meta: { personaje: pj?.id ?? null, formato, movimiento } }, o.ahora)
  const dir = carpeta(a.id)
  try {
    avance(db, a.id, 'escribiendo el guion')
    const { datos: g } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'taller' }, SISTEMA_GUION, [
      `Lo que pide: ${pedido}`,
      `Formato: ${ASPECTOS[formato].nombre.toLowerCase()} (${formato})${formato === '9:16' ? ': composición vertical, el sujeto al centro' : ''}.${cuantas ? ` Exactamente ${cuantas} escenas.` : ''}`,
      pj?.meta?.ficha ? `Personaje: ${pj.meta.ficha.nombre} — ${pj.meta.ficha.descripcion}. Apariencia: ${pj.meta.ficha.apariencia_prompt}` : '',
    ].filter(Boolean).join('\n'), { temperatura: 0.7, maxTokens: 3000 })
    const escenas = (g.escenas ?? []).filter((e: any) => e?.narracion && e?.imagen).slice(0, 8)
    if (!escenas.length) throw new Error('El guion vino vacío')
    db.prepare('UPDATE artefactos SET titulo = ? WHERE id = ?').run(String(g.titulo ?? pedido).slice(0, 80), a.id)
    const voz = (o.voz && VOCES[o.voz]) ? o.voz : pj?.meta?.ficha?.voz ?? VOZ_DEFECTO
    const archivos: string[] = []
    for (let i = 0; i < escenas.length; i += 3) {
      avance(db, a.id, `escenas ${i + 1}–${Math.min(i + 3, escenas.length)} de ${escenas.length}`)
      await Promise.all(escenas.slice(i, i + 3).map(async (e: any, k: number) => {
        const n = i + k + 1
        const img = await pintar(`${e.imagen}. Style: ${g.estilo ?? 'cinematic illustration'}`, 'flux-2-klein', formato)
        const nombreImg = `escena-${n}.${extension(img)}`
        fs.writeFileSync(path.join(dir, nombreImg), img)
        fs.writeFileSync(path.join(dir, `escena-${n}.mp3`), await vozNaN(e.narracion, voz))
        archivos.push(nombreImg, `escena-${n}.mp3`)
      }))
    }
    // Subtítulos (srt) y presentación HTML, siempre; el mp4, si hay ffmpeg.
    fs.writeFileSync(path.join(dir, 'guion.json'), JSON.stringify(g, null, 2))
    fs.writeFileSync(path.join(dir, 'presentacion.html'), presentacion(g.titulo ?? pedido, escenas.length, archivos))
    const final = ['presentacion.html', 'guion.json', ...archivos.sort()]
    if (hayFfmpeg()) {
      avance(db, a.id, 'montando el video')
      montar(dir, escenas.length, archivos, { formato, movimiento })
      final.unshift('video.mp4')
    }
    terminar(db, a.id, final, { escenas: escenas.length, voz, conFfmpeg: hayFfmpeg(), guion: escenas })
  } catch (e) { fallar(db, a.id, e) }
  return leerArtefacto(db, a.id)!
}

/** Une las escenas en un mp4: cada imagen dura lo que su voz, con un acercamiento suave si se pidió movimiento. */
export function montar(dir: string, n: number, archivos: string[], o: { formato?: string; movimiento?: boolean } = {}) {
  const [w, h] = (ASPECTOS[o.formato ?? '16:9'] ?? ASPECTOS['16:9']).video
  const encuadre = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`
  // zoompan sobre una imagen agrandada: se acerca de a poco hacia el centro (efecto Ken Burns), sin temblores.
  const vf = o.movimiento ? `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='min(1+0.0007*on,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=25,setsar=1` : encuadre
  const partes: string[] = []
  for (let i = 1; i <= n; i++) {
    const img = archivos.find((f) => f.startsWith(`escena-${i}.`) && !f.endsWith('.mp3'))
    if (!img) continue
    const salida = `parte-${i}.mp4`
    const r = spawnSync('ffmpeg', ['-y', '-loop', '1', '-framerate', '25', '-i', img, '-i', `escena-${i}.mp3`, '-c:v', 'libx264', '-tune', 'stillimage', '-c:a', 'aac', '-b:a', '128k', '-pix_fmt', 'yuv420p',
      '-vf', vf, '-r', '25', '-shortest', salida], { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`ffmpeg (escena ${i}): ${r.stderr.slice(-300)}`)
    partes.push(salida)
  }
  fs.writeFileSync(path.join(dir, 'lista.txt'), partes.map((p) => `file '${p}'`).join('\n'))
  const r = spawnSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-c', 'copy', 'video.mp4'], { cwd: dir, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg (montaje): ${r.stderr.slice(-300)}`)
  for (const p of partes) fs.rmSync(path.join(dir, p), { force: true })
  fs.rmSync(path.join(dir, 'lista.txt'), { force: true })
}

function presentacion(titulo: string, n: number, archivos: string[]): string {
  const escenas = Array.from({ length: n }, (_, i) => ({ img: archivos.find((f) => f.startsWith(`escena-${i + 1}.`) && !f.endsWith('.mp3')), audio: `escena-${i + 1}.mp3` }))
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo.replace(/</g, '')}</title>
<style>html,body{margin:0;height:100%;background:#000;color:#fff;font:16px system-ui}img{width:100%;height:100%;object-fit:contain}button{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:20px;border:0;background:#c4a062;color:#111;font-weight:600;cursor:pointer}</style></head>
<body><img id="i" alt=""><audio id="a"></audio><button id="b">▶ Reproducir</button>
<script>const e=${JSON.stringify(escenas)};let k=0;const i=document.getElementById('i'),a=document.getElementById('a'),b=document.getElementById('b');
function ir(n){if(n>=e.length){b.hidden=false;b.textContent='↻ De nuevo';k=0;return}k=n;i.src=e[n].img;a.src=e[n].audio;a.play()}
a.onended=()=>ir(k+1);b.onclick=()=>{b.hidden=true;ir(0)};i.src=e[0].img;</script></body></html>`
}

/** Iterar: una versión nueva con el cambio pedido (juegos e imágenes); el resto se rehace con el pedido sumado. */
export async function iterarArtefacto(db: Db, id: number, cambio: string): Promise<Artefacto> {
  const a = leerArtefacto(db, id)
  if (!a) throw new Error(`No existe el artefacto ${id}`)
  if (a.tipo === 'juego') return crearJuego(db, cambio, { padreId: a.id })
  if (a.tipo === 'visual') return crearVisual(db, reservarVisual(db, { clase: a.meta.clase, pedido: cambio || a.meta.nota || 'Que se entienda mejor', concepto: a.meta.concepto ?? a.titulo, nivel: a.meta.nivel, dominio: a.meta.dominio, dominioId: a.meta.dominioId, clave: a.meta.clave, padreId: a.id }).id)
  if (a.tipo === 'imagen') return crearImagen(db, cambio, { padreId: a.id })
  if (a.tipo === 'voz') return crearVoz(db, cambio || a.pedido, { voz: a.meta.voz })
  if (a.tipo === 'personaje') return conPadre(db, await crearPersonaje(db, `${a.pedido}. Cambio: ${cambio}`, { entidadId: a.meta.entidad ?? null }), a)
  return conPadre(db, await crearVideo(db, `${a.pedido}. Cambio: ${cambio}`, { personajeId: a.meta.personaje ?? null, formato: a.meta.formato, movimiento: a.meta.movimiento }), a)
}

/** Lo rehecho con un cambio es una versión del anterior (así la Librería lo muestra como la misma obra). */
function conPadre(db: Db, nueva: Artefacto, padre: Artefacto): Artefacto {
  db.prepare('UPDATE artefactos SET padre_id = ?, version = ? WHERE id = ?').run(padre.id, padre.version + 1, nueva.id)
  return leerArtefacto(db, nueva.id)!
}

/** Lo terminado puede entrar al corpus como generado (la descripción y, si es texto, el contenido). */
export function artefactoAlCorpus(db: Db, id: number): number | null {
  const a = leerArtefacto(db, id)
  if (!a || a.estado !== 'listo') throw new Error('Ese artefacto no está listo')
  const contenido = [`${a.tipo} del Taller: ${a.titulo}`, `Pedido: ${a.pedido}`, a.meta.ficha ? `Ficha: ${JSON.stringify(a.meta.ficha)}` : '', `Archivos: ${a.archivos.map((f) => `/taller/${a.id}/${f}`).join(' ')}`].filter(Boolean).join('\n')
  return insertar(db, { fuente: 'agentes', nivel: 'generada', titulo: `Taller · ${a.titulo}`, contenido, estado: 'disponible', etiquetas: ['taller', a.tipo], autor: 'Mastropiero', meta: { artefacto: a.id }, origenId: `taller:${a.id}` })
}

export const tallerListo = () => nanConfigurado()

// ─── la charla a dos voces ──────────────────────────────────────────────

const SISTEMA_CHARLA = `Sos el guionista del Taller de Mastropiero. Escribís una charla corta entre dos voces, en castellano rioplatense, para escuchar (como un podcast): natural, con ideas concretas, sin muletillas de locutor.
- Entre 6 y 14 turnos, alternados. Cada turno: 1 a 3 oraciones.
- Usá lo que se sabe de su archivo cuando venga al caso; no inventes datos sobre él.
Forma: {"titulo": string, "turnos": [{"quien": "A" | "B", "texto": string}]}`

/** Una charla sobre un tema (de su archivo, si hay): el guion lo escribe el modelo y cada turno sale con su voz. */
export async function crearCharla(db: Db, tema: string, o: { voces?: [string, string]; ahora?: number } = {}): Promise<Artefacto> {
  const [va, vb] = o.voces?.length === 2 && VOCES[o.voces[0]] && VOCES[o.voces[1]] ? o.voces : ['em_alex', 'ef_dora']
  let archivo = ''
  try { archivo = (await import('./semantica.ts').then((m) => m.archivoRelevante(db, tema))).texto } catch { /* sin vectores: con la memoria alcanza */ }
  const { datos: g } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'taller' }, SISTEMA_CHARLA, [`Tema: ${tema}`, archivo, `Lo que sabés de él:\n${memoriaParaPrompt(db, 20, tema)}`].filter(Boolean).join('\n\n'), { temperatura: 0.8, maxTokens: 3000 })
  const turnos = (Array.isArray(g.turnos) ? g.turnos : []).filter((t: any) => t?.texto).slice(0, 16).map((t: any) => ({ voz: t.quien === 'B' ? vb : va, texto: String(t.texto).slice(0, 600) }))
  if (!turnos.length) throw new Error('El guion de la charla vino vacío')
  return crearConversacion(db, String(g.titulo ?? tema).slice(0, 80), turnos, { meta: { tema, voces: [va, vb] }, ahora: o.ahora })
}

// ─── ideas desde su archivo ─────────────────────────────────────────────

const SISTEMA_SUGERIR = `Sos el Taller de Mastropiero. Proponés 3 cosas concretas para crear ahora, del tipo que te piden, sacadas de lo que está haciendo él (sus proyectos, sus focos de la semana, sus ideas). Cada una lista para pedir: específica, con el detalle que la haga buena, y que le sirva (para un proyecto, para comunicar algo, para jugar con una idea suya).
Forma: {"sugerencias": [{"titulo": string (corto), "pedido": string (el pedido completo, 1 a 3 oraciones)}]}`

export async function sugerenciasTaller(db: Db, tipo: string): Promise<{ titulo: string; pedido: string }[]> {
  const proyectos = (db.prepare(`SELECT e.nombre, e.notas FROM entidades e WHERE e.tipo = 'proyecto' ORDER BY (SELECT COUNT(*) FROM corpus c, json_each(COALESCE(c.entidades, '[]')) j WHERE j.value = e.id) DESC LIMIT 8`).all() as { nombre: string; notas: string | null }[])
  const primarias = (db.prepare(`SELECT titulo FROM misiones WHERE personaje = 'jugador' AND nivel IN ('primaria', 'principal') AND estado = 'activa' ORDER BY id DESC LIMIT 6`).all() as { titulo: string }[]).map((m) => m.titulo)
  const ideas = (db.prepare(`SELECT texto FROM quantomos WHERE etapa = 'sellado' ORDER BY COALESCE(peso, 0) DESC, id DESC LIMIT 10`).all() as { texto: string }[]).map((q) => q.texto)
  const usuario = [
    `Tipo: ${tipo} (${{ juego: 'un juego HTML jugable', imagen: 'una imagen', voz: 'una voz o una charla a dos voces', personaje: 'un personaje con retrato y voz', video: 'un video corto narrado' }[tipo] ?? tipo})`,
    proyectos.length ? `Sus proyectos: ${proyectos.map((p) => `${p.nombre}${p.notas ? ` (${p.notas.slice(0, 120)})` : ''}`).join('; ')}` : '',
    primarias.length ? `Sus focos de la semana: ${primarias.join('; ')}` : '',
    ideas.length ? `Ideas suyas que pesó alto:\n${ideas.map((i) => `- ${i.slice(0, 200)}`).join('\n')}` : '',
    `Lo que sabés de él:\n${memoriaParaPrompt(db, 25)}`,
  ].filter(Boolean).join('\n\n')
  const { datos } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'taller' }, SISTEMA_SUGERIR, usuario, { temperatura: 0.9, maxTokens: 1200 })
  return (Array.isArray(datos.sugerencias) ? datos.sugerencias : []).filter((x: any) => x?.pedido).slice(0, 3).map((x: any) => ({ titulo: String(x.titulo ?? x.pedido).slice(0, 80), pedido: String(x.pedido).slice(0, 800) }))
}

// ─── la librería ────────────────────────────────────────────────────────

export type Obra = { raiz: number; ultima: Artefacto; versiones: { id: number; version: number; estado: string; creadoEn: number }[] }

/** Cada obra una vez (su última versión) con la cadena de versiones, de la más nueva a la más vieja. */
export function libreria(db: Db, f: { tipo?: string; q?: string } = {}): Obra[] {
  const todos = (db.prepare('SELECT * FROM artefactos ORDER BY id').all() as any[]).map(deFila)
  const porId = new Map(todos.map((a) => [a.id, a]))
  const raizDe = (a: Artefacto): number => { let x = a; for (let i = 0; i < 100 && x.padreId && porId.has(x.padreId); i++) x = porId.get(x.padreId)!; return x.id }
  const obras = new Map<number, Artefacto[]>()
  for (const a of todos) obras.set(raizDe(a), [...(obras.get(raizDe(a)) ?? []), a])
  const q = f.q?.trim().toLowerCase()
  return [...obras.entries()]
    .map(([raiz, vs]) => ({ raiz, ultima: vs.at(-1)!, versiones: vs.slice().reverse().map((v) => ({ id: v.id, version: v.version, estado: v.estado, creadoEn: v.creadoEn })) }))
    .filter((o) => (!f.tipo || o.ultima.tipo === f.tipo) && (!q || `${o.ultima.titulo} ${o.ultima.pedido}`.toLowerCase().includes(q)))
    .sort((a, b) => b.ultima.creadoEn - a.ultima.creadoEn || b.ultima.id - a.ultima.id)
}

/** Borra una versión y sus archivos; las que salían de ella pasan a salir de la anterior (o quedan como obra propia). */
export function borrarArtefacto(db: Db, id: number) {
  const a = leerArtefacto(db, id)
  if (!a) throw new Error(`No existe el artefacto ${id}`)
  if (a.estado === 'haciendo') throw new Error('Esperá a que termine')
  db.prepare('UPDATE artefactos SET padre_id = ? WHERE padre_id = ?').run(a.padreId, id)
  db.prepare('DELETE FROM artefactos WHERE id = ?').run(id)
  fs.rmSync(carpeta(id), { recursive: true, force: true })
  db.prepare(`DELETE FROM corpus WHERE origen_id = ?`).run(`taller:${id}`)
}
