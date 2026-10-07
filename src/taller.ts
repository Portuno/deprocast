/**
 * El Taller: Mastropiero crea cosas. Juegos (un HTML que corre aislado), imágenes (flux, qwen-image), voces (kokoro),
 * personajes (ficha + imagen + voz, reutilizables) y videos (guion → imágenes → voz → montaje con ffmpeg, o una
 * presentación HTML si no hay ffmpeg). Cada pedido de cambio es una versión nueva. Los archivos viven en data/taller/<id>/.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { json, resolverRuta, type Db } from './db.ts'
import { insertar } from './corpus.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { llamarModelo, pedirJson } from './modelo.ts'
import { nanConfigurado } from './nan.ts'

export const TIPOS_ARTEFACTO = ['juego', 'imagen', 'voz', 'personaje', 'video'] as const
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
Respondé SOLO con el archivo HTML completo, empezando por <!doctype html>. Nada más.`

/** Un juego: el modelo escribe el HTML; con `padreId`, es una versión nueva del anterior con el cambio pedido. */
export async function crearJuego(db: Db, pedido: string, o: { padreId?: number | null; ahora?: number } = {}): Promise<Artefacto> {
  const padre = o.padreId ? leerArtefacto(db, o.padreId) : null
  const a = nuevo(db, { tipo: 'juego', titulo: padre?.titulo ?? pedido.slice(0, 80), pedido, padreId: padre?.id ?? null }, o.ahora)
  try {
    avance(db, a.id, 'escribiendo el juego')
    const previo = padre ? fs.readFileSync(path.join(carpeta(padre.id), 'index.html'), 'utf8') : null
    const r = await llamarModelo({ db, clase: 'mastropiero', agenteId: 'taller' }, {
      mensajes: [
        { role: 'system', content: SISTEMA_JUEGO },
        { role: 'user', content: previo ? `Este es el juego actual:\n\n${previo}\n\nCambio que pide: ${pedido}\n\nDevolvé el archivo completo con el cambio.` : `El juego que pide: ${pedido}` },
      ],
      herramientas: [], temperatura: 0.5, maxTokens: 16000,
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

export async function crearImagen(db: Db, prompt: string, o: { modelo?: string; tamano?: string; padreId?: number | null; ahora?: number } = {}): Promise<Artefacto> {
  const padre = o.padreId ? leerArtefacto(db, o.padreId) : null
  const final = padre ? `${padre.meta.prompt ?? padre.pedido}. Cambio: ${prompt}` : prompt
  const modelo = o.modelo ?? 'flux-2-klein'
  const a = nuevo(db, { tipo: 'imagen', titulo: padre?.titulo ?? prompt.slice(0, 80), pedido: prompt, padreId: padre?.id ?? null, meta: { prompt: final, modelo } }, o.ahora)
  try {
    avance(db, a.id, 'pintando')
    const img = await imagenNaN(final, { modelo, tamano: o.tamano ?? '1024x1024' })
    const nombre = `imagen.${extension(img)}`
    fs.writeFileSync(path.join(carpeta(a.id), nombre), img)
    terminar(db, a.id, [nombre], {})
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

const SISTEMA_PERSONAJE = `Sos el Taller de Mastropiero y diseñás un personaje reutilizable (para juegos, videos, historias).
Forma: {"nombre": string, "descripcion": string (2-3 oraciones), "personalidad": [string], "apariencia_prompt": string (en inglés, para un generador de imágenes: estilo, rasgos, ropa, fondo simple), "frase": string (una frase típica suya, en castellano rioplatense), "voz": "ef_dora" | "em_alex" | "em_santa"}`

export async function crearPersonaje(db: Db, pedido: string, o: { ahora?: number } = {}): Promise<Artefacto> {
  const a = nuevo(db, { tipo: 'personaje', titulo: pedido.slice(0, 80), pedido }, o.ahora)
  try {
    avance(db, a.id, 'imaginándolo')
    const { datos: f } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'taller' }, SISTEMA_PERSONAJE, `Lo que pide: ${pedido}\n\nLo que sabés del jugador (para que encaje en su mundo):\n${memoriaParaPrompt(db, 20)}`, { temperatura: 0.8, maxTokens: 1500 })
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
export async function crearVideo(db: Db, pedido: string, o: { personajeId?: number | null; voz?: string; ahora?: number } = {}): Promise<Artefacto> {
  const pj = o.personajeId ? leerArtefacto(db, o.personajeId) : null
  const a = nuevo(db, { tipo: 'video', titulo: pedido.slice(0, 80), pedido, meta: { personaje: pj?.id ?? null } }, o.ahora)
  const dir = carpeta(a.id)
  try {
    avance(db, a.id, 'escribiendo el guion')
    const { datos: g } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'taller' }, SISTEMA_GUION, [
      `Lo que pide: ${pedido}`,
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
        const img = await imagenNaN(`${e.imagen}. Style: ${g.estilo ?? 'cinematic illustration'}`, { modelo: 'flux-2-klein', tamano: '1024x576' })
          .catch(() => imagenNaN(`${e.imagen}. Style: ${g.estilo ?? 'cinematic illustration'}`, { modelo: 'flux-2-klein', tamano: '1024x1024' }))
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
      montar(dir, escenas.length, archivos)
      final.unshift('video.mp4')
    }
    terminar(db, a.id, final, { escenas: escenas.length, voz, conFfmpeg: hayFfmpeg() })
  } catch (e) { fallar(db, a.id, e) }
  return leerArtefacto(db, a.id)!
}

function montar(dir: string, n: number, archivos: string[]) {
  const partes: string[] = []
  for (let i = 1; i <= n; i++) {
    const img = archivos.find((f) => f.startsWith(`escena-${i}.`) && !f.endsWith('.mp3'))
    if (!img) continue
    const salida = `parte-${i}.mp4`
    const r = spawnSync('ffmpeg', ['-y', '-loop', '1', '-i', img, '-i', `escena-${i}.mp3`, '-c:v', 'libx264', '-tune', 'stillimage', '-c:a', 'aac', '-b:a', '128k', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1', '-shortest', salida], { cwd: dir, encoding: 'utf8' })
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
  if (a.tipo === 'imagen') return crearImagen(db, cambio, { padreId: a.id, modelo: a.meta.modelo })
  if (a.tipo === 'voz') return crearVoz(db, cambio || a.pedido, { voz: a.meta.voz })
  if (a.tipo === 'personaje') return crearPersonaje(db, `${a.pedido}. Cambio: ${cambio}`)
  return crearVideo(db, `${a.pedido}. Cambio: ${cambio}`, { personajeId: a.meta.personaje ?? null })
}

/** Lo terminado puede entrar al corpus como generado (la descripción y, si es texto, el contenido). */
export function artefactoAlCorpus(db: Db, id: number): number | null {
  const a = leerArtefacto(db, id)
  if (!a || a.estado !== 'listo') throw new Error('Ese artefacto no está listo')
  const contenido = [`${a.tipo} del Taller: ${a.titulo}`, `Pedido: ${a.pedido}`, a.meta.ficha ? `Ficha: ${JSON.stringify(a.meta.ficha)}` : '', `Archivos: ${a.archivos.map((f) => `/taller/${a.id}/${f}`).join(' ')}`].filter(Boolean).join('\n')
  return insertar(db, { fuente: 'agentes', nivel: 'generada', titulo: `Taller · ${a.titulo}`, contenido, estado: 'disponible', etiquetas: ['taller', a.tipo], autor: 'Mastropiero', meta: { artefacto: a.id }, origenId: `taller:${a.id}` })
}

export const tallerListo = () => nanConfigurado()
