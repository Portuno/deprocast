/**
 * El Estudio: posproducción de un video (uno del Taller o uno suyo). Sobre el video van capas con su lugar (en
 * proporciones del cuadro, así sobreviven al cambio de formato) y su tramo de tiempo: subtítulos, títulos, texto, logo o
 * imagen, QR, color, cartel de «en vivo», chat, alertas y barra de progreso.
 * - Los subtítulos salen de Whisper con el tiempo de cada palabra (y se pueden corregir uno por uno).
 * - El agente convierte una frase («que parezca un stream de cine») en operaciones sobre las capas: agregar, cambiar o
 *   quitar. Lo que devuelve se valida y se acota antes de tocar nada, y cada cambio suyo se puede deshacer.
 * - Exportar arma el video en el servidor con ffmpeg: los textos con ASS (posición, cajas, colores, fundidos y
 *   palabra por palabra), las imágenes con overlay, el color con eq/hue/colorchannelmixer, cada uno en su tramo.
 *   Cada exportación es una versión nueva. El mismo proyecto sale apaisado, vertical o cuadrado.
 * - «Momentos»: de la transcripción, cortes para shorts. Plantillas (el kit de marca de un proyecto) que se guardan,
 *   se aplican, y se exportan o importan como zip. «Mandar a Cuentas» deja una publicación en borrador: nada sale solo.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { json, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { nanTranscribirDetallado } from './nan.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { carpeta, hayFfmpeg, leerArtefacto, type Artefacto } from './taller.ts'
import { zipDeBuffer } from './takeout/zip.ts'
import { qrPng } from './qr.ts'

// ─── el proyecto ────────────────────────────────────────────────────────

export const TIPOS_CAPA = ['subtitulos', 'titulo', 'texto', 'imagen', 'qr', 'color', 'cartel', 'chat', 'alerta', 'progreso'] as const
export type TipoCapa = (typeof TIPOS_CAPA)[number]
export const FORMATOS: Record<string, [number, number]> = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1080, 1080] }
export const PRESETS_COLOR = ['sepia', 'contraste', 'vintage', 'noir', 'cyberpunk'] as const
export const ESTILOS_SUB = ['clasico', 'minimo', 'cine', 'editorial', 'palabra'] as const
export const ANIMACIONES = ['ninguna', 'aparecer', 'deslizar', 'latir'] as const

export type Palabra = { t0: number; t1: number; w: string }
export type Cue = { t0: number; t1: number; texto: string; palabras?: Palabra[] }
export type Estilo = { fondo: string; color: string; tam: number; opacidad: number; animacion: (typeof ANIMACIONES)[number]; sombra: boolean }
export type Capa = { id: string; tipo: TipoCapa; nombre: string; visible: boolean; x: number; y: number; w: number; desde: number; hasta: number | null; estilo: Estilo; datos: Record<string, any> }
export type Proyecto = {
  fuente: { artefacto: number; archivo: string }; duracion: number; ancho: number; alto: number
  formato: string; encuadre: 'recorte' | 'desenfoque'; recorte: { desde: number; hasta: number } | null; capas: Capa[]
  deshacer?: Capa[][]
}

const BASE_ESTILO: Estilo = { fondo: 'rgba(0,0,0,0.55)', color: '#ffffff', tam: 0.045, opacidad: 100, animacion: 'aparecer', sombra: true }
/** Cómo arranca cada tipo de capa (lugar y aspecto razonables). */
const DEFECTOS: Record<TipoCapa, Partial<Capa> & { datos: Record<string, any> }> = {
  subtitulos: { x: 0.1, y: 0.8, w: 0.8, estilo: { ...BASE_ESTILO, animacion: 'ninguna' }, datos: { cues: [], preset: 'clasico' } },
  titulo: { x: 0.05, y: 0.72, w: 0.5, estilo: { ...BASE_ESTILO, fondo: 'rgba(15,15,20,0.8)' }, datos: { titulo: 'Nombre', subtitulo: 'Rol' } },
  texto: { x: 0.1, y: 0.1, w: 0.8, estilo: { ...BASE_ESTILO, fondo: 'transparent', tam: 0.06 }, datos: { texto: 'Texto' } },
  imagen: { x: 0.82, y: 0.04, w: 0.14, estilo: { ...BASE_ESTILO, fondo: 'transparent', animacion: 'ninguna' }, datos: { archivo: null } },
  qr: { x: 0.84, y: 0.66, w: 0.12, estilo: { ...BASE_ESTILO, fondo: '#ffffff', animacion: 'aparecer' }, datos: { destino: 'https://' } },
  color: { x: 0, y: 0, w: 1, estilo: { ...BASE_ESTILO, fondo: 'transparent', animacion: 'ninguna' }, datos: { preset: 'cine', intensidad: 100, manual: null } },
  cartel: { x: 0.04, y: 0.05, w: 0.14, estilo: { ...BASE_ESTILO, fondo: '#e0263a', tam: 0.035, animacion: 'latir' }, datos: { modo: 'vivo', espectadores: 0 } },
  chat: { x: 0.68, y: 0.3, w: 0.28, estilo: { ...BASE_ESTILO, fondo: 'rgba(10,10,14,0.55)', tam: 0.03, animacion: 'ninguna' }, datos: { mensajes: [], cadencia: 1.6 } },
  alerta: { x: 0.3, y: 0.12, w: 0.4, estilo: { ...BASE_ESTILO, fondo: 'rgba(124,58,237,0.9)', animacion: 'deslizar' }, datos: { tipo: 'seguidor', nombre: 'Alguien', monto: null, mensaje: '' } },
  progreso: { x: 0, y: 0.985, w: 1, estilo: { ...BASE_ESTILO, fondo: '#c4a062', animacion: 'ninguna' }, datos: {} },
}

const nuevoId = () => crypto.randomBytes(4).toString('hex')
const acotar = (v: unknown, lo: number, hi: number, def: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def }
const texto = (v: unknown, max = 300) => String(v ?? '').replace(/[\u0000-\u0008]/g, '').slice(0, max)
/** Un color que se pueda usar tal cual (en el navegador y en el ASS). */
export function colorValido(v: unknown, def: string): string {
  const s = String(v ?? '').trim()
  if (s === 'transparent') return s
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(s)) return s
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  return m ? `rgba(${Math.min(255, +m[1])},${Math.min(255, +m[2])},${Math.min(255, +m[3])},${m[4] != null ? Math.min(1, +m[4]) : 1})` : def
}

/** Una capa como tiene que ser: tipos conocidos, lugar dentro del cuadro, tramo dentro del video, largos acotados. */
export function normalizarCapa(c: any, duracion: number, previa?: Capa): Capa | null {
  const tipo = (previa?.tipo ?? c?.tipo) as TipoCapa
  if (!TIPOS_CAPA.includes(tipo)) return null
  const def = DEFECTOS[tipo]
  const base: Capa = previa ?? { id: nuevoId(), tipo, nombre: tipo, visible: true, x: def.x!, y: def.y!, w: def.w!, desde: 0, hasta: null, estilo: { ...(def.estilo as Estilo) }, datos: { ...def.datos } }
  const e = { ...base.estilo, ...(c?.estilo ?? {}) }
  const desde = acotar(c?.desde ?? base.desde, 0, duracion, 0)
  const hastaCrudo = c?.hasta === undefined ? base.hasta : c.hasta
  const hasta = hastaCrudo == null ? null : acotar(hastaCrudo, desde + 0.1, duracion, duracion)
  const out: Capa = {
    id: typeof c?.id === 'string' && /^[\w-]{1,20}$/.test(c.id) ? c.id : base.id, tipo,
    nombre: texto(c?.nombre ?? base.nombre, 60) || tipo, visible: c?.visible ?? base.visible,
    x: acotar(c?.x ?? base.x, 0, 0.98, base.x), y: acotar(c?.y ?? base.y, 0, 0.995, base.y), w: acotar(c?.w ?? base.w, 0.03, 1, base.w),
    desde, hasta,
    estilo: { fondo: colorValido(e.fondo, base.estilo.fondo), color: colorValido(e.color, base.estilo.color), tam: acotar(e.tam, 0.015, 0.2, base.estilo.tam), opacidad: acotar(e.opacidad, 0, 100, 100), animacion: ANIMACIONES.includes(e.animacion) ? e.animacion : base.estilo.animacion, sombra: e.sombra !== false },
    datos: { ...base.datos },
  }
  const d = c?.datos ?? {}
  if (tipo === 'subtitulos') {
    if (Array.isArray(d.cues)) out.datos.cues = d.cues.slice(0, 2000).map((q: any) => ({ t0: acotar(q?.t0, 0, duracion, 0), t1: acotar(q?.t1, 0, duracion, 0), texto: texto(q?.texto, 200), palabras: Array.isArray(q?.palabras) ? q.palabras.slice(0, 60).map((p: any) => ({ t0: acotar(p?.t0, 0, duracion, 0), t1: acotar(p?.t1, 0, duracion, 0), w: texto(p?.w, 40) })) : undefined })).filter((q: Cue) => q.texto.trim() && q.t1 > q.t0)
    if (d.preset !== undefined) out.datos.preset = ESTILOS_SUB.includes(d.preset) ? d.preset : 'clasico'
  } else if (tipo === 'titulo') {
    if (d.titulo !== undefined) out.datos.titulo = texto(d.titulo, 80)
    if (d.subtitulo !== undefined) out.datos.subtitulo = texto(d.subtitulo, 120)
  } else if (tipo === 'texto') {
    if (d.texto !== undefined) out.datos.texto = texto(d.texto, 300)
  } else if (tipo === 'imagen') {
    if (d.archivo !== undefined) out.datos.archivo = d.archivo && /^[\w.-]{1,80}$/.test(String(d.archivo)) ? String(d.archivo) : null
    if (d.artefacto !== undefined) out.datos.artefacto = Number.isInteger(d.artefacto) ? d.artefacto : null
  } else if (tipo === 'qr') {
    if (d.destino !== undefined) out.datos.destino = texto(d.destino, 300)
  } else if (tipo === 'color') {
    if (d.preset !== undefined) out.datos.preset = [...PRESETS_COLOR, 'cine', 'ninguno'].includes(d.preset) ? d.preset : 'ninguno'
    if (d.intensidad !== undefined) out.datos.intensidad = acotar(d.intensidad, 0, 200, 100)
    if (d.manual !== undefined) out.datos.manual = d.manual ? Object.fromEntries(['brillo', 'contraste', 'saturacion', 'sepia', 'gris', 'tono'].map((k) => [k, acotar(d.manual[k], k === 'tono' ? -180 : 0, k === 'tono' ? 180 : 300, k === 'sepia' || k === 'gris' || k === 'tono' ? 0 : 100)])) : null
  } else if (tipo === 'cartel') {
    if (d.modo !== undefined) out.datos.modo = ['vivo', 'grabando', 'espectadores'].includes(d.modo) ? d.modo : 'vivo'
    if (d.espectadores !== undefined) out.datos.espectadores = Math.round(acotar(d.espectadores, 0, 10_000_000, 0))
  } else if (tipo === 'chat') {
    if (Array.isArray(d.mensajes)) out.datos.mensajes = d.mensajes.slice(0, 60).map((m: any) => ({ usuario: texto(m?.usuario, 24) || 'alguien', texto: texto(m?.texto, 140), color: colorValido(m?.color, '#60a5fa') })).filter((m: any) => m.texto)
    if (d.cadencia !== undefined) out.datos.cadencia = acotar(d.cadencia, 0.4, 10, 1.6)
  } else if (tipo === 'alerta') {
    if (d.tipo !== undefined) out.datos.tipo = ['seguidor', 'suscripcion', 'donacion'].includes(d.tipo) ? d.tipo : 'seguidor'
    if (d.nombre !== undefined) out.datos.nombre = texto(d.nombre, 40)
    if (d.monto !== undefined) out.datos.monto = d.monto == null ? null : acotar(d.monto, 0, 1e7, 0)
    if (d.mensaje !== undefined) out.datos.mensaje = texto(d.mensaje, 120)
  }
  return out
}

export function capaNueva(tipo: TipoCapa, duracion: number, c: any = {}): Capa {
  return normalizarCapa({ ...c, tipo }, duracion)!
}

// ─── el video de partida ────────────────────────────────────────────────

/** Duración y tamaño de un video (de lo que dice ffmpeg, sin ffprobe). */
export function sondear(ruta: string): { duracion: number; ancho: number; alto: number; audio: boolean } {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', ruta], { encoding: 'utf8' })
  if (r.error) throw new Error('Para leer videos hace falta ffmpeg en el servidor (en la nube está; en esta compu no lo encuentro)')
  const s = r.stderr ?? ''
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(s)
  const v = /Video: .*?(\d{2,5})x(\d{2,5})/.exec(s)
  if (!d || !v) throw new Error('No pude leer ese video (¿es un video?)')
  return { duracion: +d[1] * 3600 + +d[2] * 60 + +d[3], ancho: +v[1], alto: +v[2], audio: /Audio: /.test(s) }
}

const formatoMasCercano = (ancho: number, alto: number) => (ancho / alto > 1.2 ? '16:9' : ancho / alto < 0.85 ? '9:16' : '1:1')

/** Un proyecto nuevo del Estudio: desde un video del Taller o desde un archivo subido (que se mueve a su carpeta). */
export function crearEstudio(db: Db, o: { desdeArtefacto?: number; archivo?: string; titulo?: string }, ahora = Date.now()): Artefacto {
  const origen = o.desdeArtefacto ? leerArtefacto(db, o.desdeArtefacto) : null
  if (o.desdeArtefacto && (!origen || !origen.archivos.includes('video.mp4'))) throw new Error('Ese video del Taller no tiene un mp4 (¿se armó sin ffmpeg?)')
  if (!origen && !o.archivo) throw new Error('Falta el video')
  const r = db.prepare(`INSERT INTO artefactos (tipo, titulo, pedido, version, archivos, meta, estado, creado_en) VALUES ('estudio', ?, ?, 1, '[]', '{}', 'listo', ?)`)
    .run((o.titulo ?? origen?.titulo ?? 'Video sin título').slice(0, 160), origen ? `Posproducción de «${origen.titulo}»` : 'Posproducción de un video subido', ahora)
  const id = Number(r.lastInsertRowid)
  const dir = carpeta(id)
  fs.mkdirSync(dir, { recursive: true })
  const destino = path.join(dir, 'fuente.mp4')
  try {
    if (origen) fs.copyFileSync(path.join(carpeta(origen.id), 'video.mp4'), destino)
    else fs.renameSync(o.archivo!, destino)
    const s = sondear(destino)
    const proyecto: Proyecto = { fuente: { artefacto: id, archivo: 'fuente.mp4' }, duracion: s.duracion, ancho: s.ancho, alto: s.alto, formato: formatoMasCercano(s.ancho, s.alto), encuadre: 'recorte', recorte: null, capas: [] }
    db.prepare('UPDATE artefactos SET archivos = ?, meta = ? WHERE id = ?').run(JSON.stringify(['fuente.mp4']), JSON.stringify({ proyecto, desde: origen?.id ?? null, audio: s.audio }), id)
  } catch (e) {
    db.prepare('DELETE FROM artefactos WHERE id = ?').run(id)
    fs.rmSync(dir, { recursive: true, force: true })
    throw e
  }
  return leerArtefacto(db, id)!
}

export function proyectoDe(db: Db, id: number): { a: Artefacto; p: Proyecto } {
  const a = leerArtefacto(db, id)
  if (!a || a.tipo !== 'estudio' || !a.meta.proyecto) throw new Error(`No existe el proyecto ${id} del Estudio`)
  return { a, p: a.meta.proyecto as Proyecto }
}
const duracionUtil = (p: Proyecto) => (p.recorte ? p.recorte.hasta - p.recorte.desde : p.duracion)

function guardarProyecto(db: Db, id: number, p: Proyecto, extra: Record<string, unknown> = {}) {
  const a = leerArtefacto(db, id)!
  db.prepare('UPDATE artefactos SET meta = ? WHERE id = ?').run(JSON.stringify({ ...a.meta, ...extra, proyecto: p }), id)
}

/** Lo que edita la pantalla: las capas (validadas una por una), el formato, el encuadre y el recorte. */
export function guardarEstudio(db: Db, id: number, c: { capas?: unknown[]; formato?: string; encuadre?: string; recorte?: { desde: number; hasta: number } | null; titulo?: string; conDeshacer?: boolean }): Proyecto {
  const { p } = proyectoDe(db, id)
  const dur = duracionUtil(p)
  if (Array.isArray(c.capas)) {
    if (c.conDeshacer) p.deshacer = [...(p.deshacer ?? []), p.capas].slice(-12)
    const previas = new Map(p.capas.map((x) => [x.id, x]))
    p.capas = c.capas.slice(0, 40).map((x: any) => normalizarCapa(x, dur, previas.get(x?.id) && previas.get(x.id)!.tipo === x?.tipo ? previas.get(x.id) : undefined)).filter((x): x is Capa => !!x)
  }
  if (c.formato && FORMATOS[c.formato]) p.formato = c.formato
  if (c.encuadre === 'recorte' || c.encuadre === 'desenfoque') p.encuadre = c.encuadre
  if (c.recorte !== undefined) p.recorte = c.recorte ? { desde: acotar(c.recorte.desde, 0, p.duracion - 0.5, 0), hasta: acotar(c.recorte.hasta, 0.5, p.duracion, p.duracion) } : null
  if (c.titulo?.trim()) db.prepare('UPDATE artefactos SET titulo = ? WHERE id = ?').run(c.titulo.trim().slice(0, 160), id)
  guardarProyecto(db, id, p)
  return p
}

export function deshacerEstudio(db: Db, id: number): Proyecto {
  const { p } = proyectoDe(db, id)
  const previas = p.deshacer?.pop()
  if (!previas) throw new Error('No hay nada para deshacer')
  p.capas = previas
  guardarProyecto(db, id, p)
  return p
}

// ─── subtítulos ─────────────────────────────────────────────────────────

/** De las palabras con tiempo a subtítulos: cortes por puntuación, por largo (~42 letras) o por pausa. */
export function cuesDePalabras(palabras: { start: number; end: number; word: string }[]): Cue[] {
  const cues: Cue[] = []
  let actual: Palabra[] = []
  const cerrar = () => {
    if (!actual.length) return
    cues.push({ t0: actual[0].t0, t1: actual.at(-1)!.t1, texto: actual.map((p) => p.w).join(' ').replace(/\s+([,.;:!?])/g, '$1'), palabras: actual })
    actual = []
  }
  for (const p of palabras) {
    const w = String(p.word ?? '').trim()
    if (!w) continue
    const prev = actual.at(-1)
    if (prev && (p.start - prev.t1 > 0.8 || actual.map((x) => x.w).join(' ').length + w.length > 42 || p.end - actual[0].t0 > 4)) cerrar()
    actual.push({ t0: +p.start, t1: +p.end, w })
    if (/[.!?…]$/.test(w)) cerrar()
  }
  cerrar()
  return cues
}

let transcribir = (db: Db, audio: Buffer, nombre: string) => nanTranscribirDetallado(db, audio, nombre, { palabras: true })
export function _probarEstudio(o: { transcribir?: typeof transcribir; agente?: typeof agente; momentosIA?: typeof momentosIA; redactar?: typeof redactar }) {
  if (o.transcribir) transcribir = o.transcribir
  if (o.agente) agente = o.agente
  if (o.momentosIA) momentosIA = o.momentosIA
  if (o.redactar) redactar = o.redactar
}

/** Saca el audio, lo transcribe con el tiempo de cada palabra y deja (o reemplaza) la capa de subtítulos. */
export async function transcribirEstudio(db: Db, id: number): Promise<Capa> {
  const { a, p } = proyectoDe(db, id)
  const dir = carpeta(a.id)
  const fuente = path.join(carpeta(p.fuente.artefacto), p.fuente.archivo)
  const mp3 = path.join(dir, `audio-${nuevoId()}.mp3`)
  try {
    const args = ['-hide_banner', '-loglevel', 'error', '-y', ...(p.recorte ? ['-ss', String(p.recorte.desde), '-to', String(p.recorte.hasta)] : []), '-i', fuente, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3]
    const r = spawnSync('ffmpeg', args, { encoding: 'utf8' })
    if (r.status !== 0 || !fs.existsSync(mp3)) throw new Error('El video no tiene audio para transcribir')
    const t = await transcribir(db, fs.readFileSync(mp3), 'audio.mp3')
    let cues = cuesDePalabras(t.palabras ?? [])
    if (!cues.length && t.texto.trim()) {
      // Sin tiempos por palabra: el texto repartido parejo en el tiempo.
      const frases = t.texto.split(/(?<=[.!?…])\s+/).filter(Boolean)
      const dur = duracionUtil(p) / Math.max(1, frases.length)
      cues = frases.map((f, i) => ({ t0: i * dur, t1: (i + 1) * dur, texto: f.slice(0, 200) }))
    }
    if (!cues.length) throw new Error('No se escuchó nada para subtitular')
    const previa = p.capas.find((c) => c.tipo === 'subtitulos')
    const capa = normalizarCapa({ tipo: 'subtitulos', nombre: 'Subtítulos', datos: { cues, preset: previa?.datos.preset ?? (p.formato === '9:16' ? 'palabra' : 'clasico') } }, duracionUtil(p), previa)!
    p.deshacer = [...(p.deshacer ?? []), p.capas].slice(-12)
    p.capas = previa ? p.capas.map((c) => (c.id === previa.id ? capa : c)) : [...p.capas, capa]
    guardarProyecto(db, id, p)
    return capa
  } finally {
    fs.rmSync(mp3, { force: true })
  }
}

// ─── el agente ──────────────────────────────────────────────────────────

const SISTEMA_AGENTE = `Sos el posproductor del Estudio de Mastropiero. Te piden un cambio en palabras («que parezca un stream de cine», «tono editorial para LinkedIn», «sacá el chat») y devolvés operaciones sobre las capas del video.
Capas posibles (tipo → datos):
- subtitulos → {preset: clasico|minimo|cine|editorial|palabra} (no inventes cues: los subtítulos salen de transcribir)
- titulo → {titulo, subtitulo}  (un zócalo con nombre y rol)
- texto → {texto}
- imagen → {} (un logo o imagen; solo si ya hay una en la lista de imágenes disponibles: {artefacto: id, archivo: nombre})
- qr → {destino: url}
- color → {preset: sepia|contraste|vintage|noir|cyberpunk|cine, intensidad: 0-200}
- cartel → {modo: vivo|grabando|espectadores, espectadores: número}
- chat → {mensajes: [{usuario, texto, color}], cadencia: segundos entre mensajes} (mensajes cortos, creíbles, en el idioma del video, sobre lo que se ve)
- alerta → {tipo: seguidor|suscripcion|donacion, nombre, monto, mensaje}
- progreso → {}
Cada capa: {tipo, nombre, x, y, w (proporciones del cuadro, 0 a 1, arriba a la izquierda), desde, hasta (segundos; hasta null = hasta el final), estilo: {fondo, color (#hex o rgba), tam (alto de letra en proporción del cuadro: 0.03 a 0.08), opacidad 0-100, animacion: ninguna|aparecer|deslizar|latir}, datos}.
Respetá las zonas seguras (no pongas nada a menos de 0.04 de los bordes; en vertical, nada importante debajo de 0.82 ni arriba de 0.08). Usá los colores de su marca si hay.
Forma: {"mensaje": string (qué hiciste, en una o dos frases, castellano rioplatense), "operaciones": [{"op": "agregar", "capa": {...}} | {"op": "cambiar", "id": string, "cambios": {...}} | {"op": "quitar", "id": string}]}`

let agente = async (db: Db, sistema: string, usuario: string) => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'estudio' }, sistema, usuario, { temperatura: 0.5, maxTokens: 4000 })).datos

/** Las operaciones del agente aplicadas sobre las capas (las inválidas se ignoran). Exportada para los tests. */
export function aplicarOperaciones(capas: Capa[], ops: unknown[], duracion: number): { capas: Capa[]; hechas: number } {
  let out = [...capas]
  let hechas = 0
  for (const o of (Array.isArray(ops) ? ops : []).slice(0, 20) as any[]) {
    if (o?.op === 'agregar' && o.capa && out.length < 40) {
      const c = normalizarCapa(o.capa, duracion)
      if (c) (out.push(c), hechas++)
    } else if (o?.op === 'cambiar' && typeof o.id === 'string') {
      const prev = out.find((c) => c.id === o.id)
      if (!prev) continue
      const c = normalizarCapa({ ...o.cambios, id: prev.id, estilo: { ...prev.estilo, ...(o.cambios?.estilo ?? {}) }, datos: { ...prev.datos, ...(o.cambios?.datos ?? {}) } }, duracion, prev)
      if (c) (out = out.map((x) => (x.id === prev.id ? c : x)), hechas++)
    } else if (o?.op === 'quitar' && typeof o.id === 'string' && out.some((c) => c.id === o.id)) {
      out = out.filter((c) => c.id !== o.id)
      hechas++
    }
  }
  return { capas: out, hechas }
}

/** Lo que el agente necesita saber: el video, las capas que hay, las imágenes que puede usar y su marca. */
function contextoAgente(db: Db, a: Artefacto, p: Proyecto, marca: string): string {
  const imagenes = (db.prepare(`SELECT id, titulo, archivos FROM artefactos WHERE tipo = 'imagen' AND estado = 'listo' ORDER BY id DESC LIMIT 12`).all() as any[])
    .map((x) => ({ artefacto: x.id, titulo: x.titulo, archivo: json<string[]>(x.archivos, [])?.[0] })).filter((x) => x.archivo)
  return [
    `Video: «${a.titulo}», ${duracionUtil(p).toFixed(1)} s, formato ${p.formato}.`,
    `Capas que hay: ${p.capas.length ? JSON.stringify(p.capas.map((c) => ({ id: c.id, tipo: c.tipo, nombre: c.nombre, x: +c.x.toFixed(2), y: +c.y.toFixed(2), w: +c.w.toFixed(2), desde: c.desde, hasta: c.hasta, estilo: c.estilo, datos: c.tipo === 'subtitulos' ? { preset: c.datos.preset, cues: c.datos.cues.length } : c.datos }))) : 'ninguna'}`,
    p.capas.find((c) => c.tipo === 'subtitulos') ? `Lo que se dice: ${p.capas.find((c) => c.tipo === 'subtitulos')!.datos.cues.map((q: Cue) => q.texto).join(' ').slice(0, 1500)}` : '',
    imagenes.length ? `Imágenes disponibles del Taller: ${JSON.stringify(imagenes)}` : '',
    marca ? `Su marca:\n${marca}` : '',
    `Lo que sabés de él:\n${memoriaParaPrompt(db, 15)}`,
  ].filter(Boolean).join('\n\n')
}

export async function agenteDeCapas(db: Db, id: number, pedido: string): Promise<{ mensaje: string; hechas: number; proyecto: Proyecto }> {
  const { a, p } = proyectoDe(db, id)
  const marca = plantillas(db).filter((x) => x.marca).map((x) => `- ${x.nombre}: ${x.marca}`).join('\n')
  const d = await agente(db, SISTEMA_AGENTE, `${contextoAgente(db, a, p, marca)}\n\nPedido: ${pedido.slice(0, 1000)}`)
  const r = aplicarOperaciones(p.capas, d?.operaciones ?? [], duracionUtil(p))
  if (r.hechas) {
    p.deshacer = [...(p.deshacer ?? []), p.capas].slice(-12)
    p.capas = r.capas
    guardarProyecto(db, id, p)
  }
  return { mensaje: texto(d?.mensaje, 400) || (r.hechas ? 'Listo.' : 'No encontré nada para cambiar con eso.'), hechas: r.hechas, proyecto: p }
}

// ─── exportar: ASS + filtros de ffmpeg ──────────────────────────────────

/** Un color CSS al formato del ASS (&HAABBGGRR, con la transparencia invertida) . */
export function aAss(color: string, opacidad = 100): string {
  let r = 255, g = 255, b = 255, a = 1
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)
  const rgba = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/.exec(color.replace(/\s/g, ''))
  if (color === 'transparent') a = 0
  else if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((x) => x + x).join('') : hex[1]
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255
  } else if (rgba) { r = +rgba[1]; g = +rgba[2]; b = +rgba[3]; a = rgba[4] != null ? +rgba[4] : 1 }
  const alfa = Math.round((1 - a * (opacidad / 100)) * 255)
  const x = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase()
  return `&H${x(alfa)}${x(b)}${x(g)}${x(r)}`
}
const tiempoAss = (s: number) => { const t = Math.max(0, s); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const sec = t % 60; return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}` }
const escaparAss = (s: string) => s.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N')

const FUENTE_SUB: Record<string, string> = { clasico: 'DejaVu Sans', minimo: 'DejaVu Sans', cine: 'DejaVu Serif', editorial: 'DejaVu Sans', palabra: 'DejaVu Sans' }

/** El archivo ASS con todas las capas de texto (cada una con su tramo, su lugar, su caja y su animación). */
export function armarAss(p: Proyecto): string {
  const [W, H] = FORMATOS[p.formato] ?? FORMATOS['16:9']
  const dur = duracionUtil(p)
  const ev: string[] = []
  const evento = (capa: Capa, t0: number, t1: number, cuerpo: string, o: { estilo?: string; extra?: string } = {}) => {
    const e = capa.estilo
    const x = Math.round(capa.x * W)
    const y = Math.round(capa.y * H)
    const anim = e.animacion === 'aparecer' ? '\\fad(250,200)' : e.animacion === 'deslizar' ? `\\move(${x - Math.round(W * 0.04)},${y},${x},${y},0,300)\\fad(200,200)` : e.animacion === 'latir' ? '\\t(0,500,\\fscx106\\fscy106)\\t(500,1000,\\fscx100\\fscy100)' : ''
    const pos = e.animacion === 'deslizar' ? '' : `\\pos(${x},${y})`
    const sombra = e.sombra ? '\\shad2' : '\\shad0'
    ev.push(`Dialogue: 0,${tiempoAss(t0)},${tiempoAss(t1)},${o.estilo ?? 'Base'},,0,0,0,,{\\an7${pos}${anim}${sombra}\\fs${Math.round(e.tam * H)}\\1c${aAss(e.color, e.opacidad).slice(0, 2)}&${aAss(e.color).slice(4)}\\3c${aAss(e.fondo).slice(0, 2)}&${aAss(e.fondo).slice(4)}\\1a&H${aAss(e.color, e.opacidad).slice(2, 4)}&\\3a&H${aAss(e.fondo, e.opacidad).slice(2, 4)}&\\4a&H${e.fondo === 'transparent' ? 'FF' : '80'}&${o.extra ?? ''}}${cuerpo}`)
  }
  for (const c of p.capas.filter((x) => x.visible)) {
    const t0 = c.desde
    const t1 = c.hasta ?? dur
    if (c.tipo === 'subtitulos') {
      for (const q of c.datos.cues as Cue[]) {
        if (q.t1 < t0 || q.t0 > t1) continue
        const centro = { ...c, x: c.x + c.w / 2 }
        const estiloSub = c.datos.preset === 'editorial' ? { ...c, estilo: { ...c.estilo, color: '#171717', fondo: 'rgba(245,240,230,0.92)' } } : c.datos.preset === 'minimo' ? { ...c, estilo: { ...c.estilo, fondo: 'transparent' } } : c
        if (c.datos.preset === 'palabra' && q.palabras?.length) {
          // Palabra por palabra: la frase entera, con la que suena en el color de acento y un poco más grande.
          for (const [i, w] of q.palabras.entries()) {
            const fin = q.palabras[i + 1]?.t0 ?? q.t1
            const linea = q.palabras.map((x, k) => (k === i ? `{\\1c&H3BC4F5&\\fscx112\\fscy112}${escaparAss(x.w)}{\\1c&HFFFFFF&\\fscx100\\fscy100}` : escaparAss(x.w))).join(' ')
            ev.push(`Dialogue: 0,${tiempoAss(w.t0)},${tiempoAss(fin)},Palabra,,0,0,0,,{\\an8\\pos(${Math.round(centro.x * W)},${Math.round(c.y * H)})\\fs${Math.round(c.estilo.tam * H * 1.15)}}${linea}`)
          }
        } else evento({ ...estiloSub, estilo: { ...estiloSub.estilo, animacion: 'ninguna' } }, q.t0, q.t1, escaparAss(q.texto), { estilo: c.datos.preset === 'cine' ? 'Cine' : 'Base', extra: `\\an8\\pos(${Math.round(centro.x * W)},${Math.round(c.y * H)})` })
      }
    } else if (c.tipo === 'titulo') evento(c, t0, t1, `{\\b1}${escaparAss(c.datos.titulo)}{\\b0}\\N{\\fs${Math.round(c.estilo.tam * H * 0.7)}}${escaparAss(c.datos.subtitulo ?? '')}`)
    else if (c.tipo === 'texto') evento(c, t0, t1, escaparAss(c.datos.texto))
    else if (c.tipo === 'cartel') evento(c, t0, t1, `{\\b1}● ${c.datos.modo === 'grabando' ? 'REC' : c.datos.modo === 'espectadores' ? `${Number(c.datos.espectadores).toLocaleString('es-AR')} mirando` : 'EN VIVO'}{\\b0}`)
    else if (c.tipo === 'alerta') {
      const que = c.datos.tipo === 'donacion' ? `donó${c.datos.monto ? ` ${c.datos.monto} €` : ''}` : c.datos.tipo === 'suscripcion' ? 'se suscribió' : 'empezó a seguirte'
      evento(c, t0, Math.min(t1, t0 + 5), `{\\b1}${escaparAss(c.datos.nombre)}{\\b0} ${que}${c.datos.mensaje ? `\\N${escaparAss(c.datos.mensaje)}` : ''}`)
    } else if (c.tipo === 'chat') {
      // El chat va apareciendo: cada mensaje en su momento, con los últimos seis en pantalla.
      const ms = c.datos.mensajes as { usuario: string; texto: string; color: string }[]
      const cad = c.datos.cadencia ?? 1.6
      for (let k = 0; k < ms.length; k++) {
        const a = t0 + k * cad
        if (a >= t1) break
        const b = Math.min(t1, k + 1 < ms.length ? a + cad : t1)
        const visibles = ms.slice(Math.max(0, k - 5), k + 1)
        evento({ ...c, estilo: { ...c.estilo, animacion: 'ninguna' } }, a, b, visibles.map((m) => `{\\b1\\1c${aAss(m.color).replace(/^&H../, '&H')}&}${escaparAss(m.usuario)}{\\b0\\1c&HFFFFFF&}  ${escaparAss(m.texto)}`).join('\\N'))
      }
    }
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,${FUENTE_SUB.clasico},${Math.round(H * 0.045)},&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,1,0,0,0,100,100,0,0,3,${Math.max(4, Math.round(H * 0.008))},0,7,0,0,0,1
Style: Cine,${FUENTE_SUB.cine},${Math.round(H * 0.045)},&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,1,0,3,${Math.max(4, Math.round(H * 0.008))},0,8,0,0,0,1
Style: Palabra,${FUENTE_SUB.palabra},${Math.round(H * 0.05)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(H * 0.005))},2,8,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join('\n')}
`
}

/** El filtro de una capa de color: presets con su intensidad, o el ajuste manual (como los LUT del navegador). */
export function filtroColor(c: Capa): string {
  const k = (c.datos.intensidad ?? 100) / 100
  const m = c.datos.manual
  if (m) {
    const partes = [`eq=brightness=${(((m.brillo ?? 100) - 100) / 100).toFixed(2)}:contrast=${((m.contraste ?? 100) / 100).toFixed(2)}:saturation=${((m.saturacion ?? 100) / 100).toFixed(2)}`]
    if (m.gris) partes.push(`hue=s=${(1 - Math.min(100, m.gris) / 100).toFixed(2)}`)
    if (m.tono) partes.push(`hue=h=${m.tono}`)
    if (m.sepia) { const s = Math.min(100, m.sepia) / 100; partes.push(`colorchannelmixer=${sepia(s)}`) }
    return partes.join(',')
  }
  switch (c.datos.preset) {
    case 'sepia': return `colorchannelmixer=${sepia(Math.min(1, k))}`
    case 'contraste': return `eq=contrast=${(1 + 0.35 * k).toFixed(2)}:saturation=${(1 + 0.15 * k).toFixed(2)}`
    case 'vintage': return `curves=preset=vintage,eq=saturation=${(1 - 0.2 * k).toFixed(2)}`
    case 'noir': return `hue=s=0,eq=contrast=${(1 + 0.3 * k).toFixed(2)}`
    case 'cyberpunk': return `colorbalance=rs=${(0.15 * k).toFixed(2)}:bs=${(0.3 * k).toFixed(2)}:gm=${(-0.1 * k).toFixed(2)},eq=saturation=${(1 + 0.4 * k).toFixed(2)}:contrast=${(1 + 0.1 * k).toFixed(2)}`
    case 'cine': return `eq=contrast=${(1 + 0.12 * k).toFixed(2)}:saturation=${(1 - 0.12 * k).toFixed(2)},colorbalance=rs=${(0.04 * k).toFixed(2)}:bs=${(-0.05 * k).toFixed(2)}:rh=${(-0.04 * k).toFixed(2)}:bh=${(0.06 * k).toFixed(2)}`
    default: return 'null'
  }
}
const sepia = (s: number) => {
  const mezcla = (a: number, b: number) => (a * s + b * (1 - s)).toFixed(3)
  return `rr=${mezcla(0.393, 1)}:rg=${mezcla(0.769, 0)}:rb=${mezcla(0.189, 0)}:gr=${mezcla(0.349, 0)}:gg=${mezcla(0.686, 1)}:gb=${mezcla(0.168, 0)}:br=${mezcla(0.272, 0)}:bg=${mezcla(0.534, 0)}:bb=${mezcla(0.131, 1)}`
}

/** Arma los argumentos de ffmpeg: video base (recorte y reencuadre), color, imágenes y QR, barra de progreso y el ASS. */
export function armarRender(p: Proyecto, o: { fuente: string; dir: string; salida: string }): string[] {
  const [W, H] = FORMATOS[p.formato] ?? FORMATOS['16:9']
  const dur = duracionUtil(p)
  const entradas: string[] = [...(p.recorte ? ['-ss', String(p.recorte.desde), '-to', String(p.recorte.hasta)] : []), '-i', o.fuente]
  const f: string[] = []
  // Base al tamaño del formato: recorte al centro, o el video entero sobre su propia versión desenfocada.
  if (p.encuadre === 'desenfoque') f.push(`[0:v]split=2[fondo][frente];[fondo]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2[fd];[frente]scale=${W}:${H}:force_original_aspect_ratio=decrease[fr];[fd][fr]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]`)
  else f.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[v0]`)
  let actual = 'v0'
  let n = 0
  const tramo = (c: Capa) => `between(t,${c.desde.toFixed(2)},${(c.hasta ?? dur).toFixed(2)})`
  for (const c of p.capas.filter((x) => x.visible && x.tipo === 'color')) {
    const sig = `c${++n}`
    // Cada filtro de color vale solo en su tramo: se arma aparte y se superpone con enable.
    f.push(`[${actual}]split=2[a${n}][b${n}];[b${n}]${filtroColor(c)}[cb${n}];[a${n}][cb${n}]overlay=0:0:enable='${tramo(c)}'[${sig}]`)
    actual = sig
  }
  let idx = 1
  for (const c of p.capas.filter((x) => x.visible && (x.tipo === 'imagen' || x.tipo === 'qr'))) {
    const archivo = c.tipo === 'qr' ? `qr-${c.id}.png` : c.datos.archivo
    if (!archivo || !fs.existsSync(path.join(o.dir, archivo))) continue
    entradas.push('-loop', '1', '-i', archivo)
    const ancho = Math.max(8, Math.round(c.w * W))
    const sig = `i${idx}`
    f.push(`[${idx}:v]scale=${ancho}:-1,format=rgba,colorchannelmixer=aa=${(c.estilo.opacidad / 100).toFixed(2)}[im${idx}];[${actual}][im${idx}]overlay=${Math.round(c.x * W)}:${Math.round(c.y * H)}:shortest=1:enable='${tramo(c)}'[${sig}]`)
    actual = sig
    idx++
  }
  for (const c of p.capas.filter((x) => x.visible && x.tipo === 'progreso')) {
    const sig = `p${++n}`
    const alto = Math.max(4, Math.round(H * 0.008))
    f.push(`[${actual}]drawbox=x=${Math.round(c.x * W)}:y=${Math.min(H - alto, Math.round(c.y * H))}:w='${Math.round(c.w * W)}*t/${dur.toFixed(2)}':h=${alto}:color=${c.estilo.fondo.startsWith('#') ? c.estilo.fondo.replace('#', '0x') : 'white'}@${(c.estilo.opacidad / 100).toFixed(2)}:t=fill:enable='${tramo(c)}'[${sig}]`)
    actual = sig
  }
  f.push(`[${actual}]subtitles=capas.ass,format=yuv420p[vout]`)
  return ['-hide_banner', '-loglevel', 'error', '-y', ...entradas, '-filter_complex', f.join(';'), '-map', '[vout]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '160k', '-t', dur.toFixed(2), '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', o.salida]
}

/** Exporta: una versión nueva del proyecto con el mp4 armado (corre de fondo; el avance queda en la versión). */
export async function exportarEstudio(db: Db, id: number, ahora = Date.now()): Promise<Artefacto> {
  const { a, p } = proyectoDe(db, id)
  if (!hayFfmpeg()) throw new Error('Para exportar hace falta ffmpeg en el servidor (en la nube está; en esta compu no lo encuentro)')
  // La versión que sigue a la última de esta obra (cada exportación cuelga de la copia de trabajo).
  const ultima = (db.prepare('SELECT MAX(version) AS v FROM artefactos WHERE id = ? OR padre_id = ?').get(a.id, a.id) as { v: number }).v
  const r = db.prepare(`INSERT INTO artefactos (tipo, titulo, pedido, version, padre_id, archivos, meta, estado, progreso, creado_en) VALUES ('estudio', ?, ?, ?, ?, '[]', ?, 'haciendo', 'preparando', ?)`)
    .run(a.titulo, a.pedido, ultima + 1, a.id, JSON.stringify({ ...a.meta, proyecto: { ...p, deshacer: undefined }, exportado: true }), ahora)
  const nid = Number(r.lastInsertRowid)
  const dir = carpeta(nid)
  fs.mkdirSync(dir, { recursive: true })
  const avance = (t: string) => db.prepare('UPDATE artefactos SET progreso = ? WHERE id = ?').run(t, nid)
  try {
    // Los archivos que usan las capas (logos, imágenes del Taller, QR) se copian a la carpeta de la versión.
    const [W] = FORMATOS[p.formato] ?? FORMATOS['16:9']
    for (const c of p.capas.filter((x) => x.visible)) {
      if (c.tipo === 'qr' && c.datos.destino && c.datos.destino !== 'https://') fs.writeFileSync(path.join(dir, `qr-${c.id}.png`), qrPng(c.datos.destino, Math.max(2, Math.ceil((c.w * W) / 40))))
      if (c.tipo === 'imagen' && c.datos.archivo) {
        const desde = c.datos.artefacto ? path.join(carpeta(c.datos.artefacto), c.datos.archivo) : path.join(carpeta(id), c.datos.archivo)
        if (fs.existsSync(desde)) fs.copyFileSync(desde, path.join(dir, c.datos.archivo))
      }
    }
    fs.writeFileSync(path.join(dir, 'capas.ass'), armarAss(p))
    const fuente = path.join(carpeta(p.fuente.artefacto), p.fuente.archivo)
    const dur = duracionUtil(p)
    await new Promise<void>((ok, mal) => {
      const ff = spawn('ffmpeg', armarRender(p, { fuente, dir, salida: 'video.mp4' }), { cwd: dir })
      let err = ''
      ff.stdout.on('data', (b: Buffer) => {
        const t = /out_time_ms=(\d+)/.exec(b.toString())
        if (t) avance(`armando el video (${Math.min(99, Math.round((Number(t[1]) / 1e6 / dur) * 100))} %)`)
      })
      ff.stderr.on('data', (b: Buffer) => { err = (err + b.toString()).slice(-800) })
      ff.on('error', mal)
      ff.on('close', (c) => (c === 0 ? ok() : mal(new Error(`ffmpeg: ${err.trim().split('\n').slice(-3).join(' ')}`))))
    })
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (dur / 3).toFixed(2), '-i', 'video.mp4', '-frames:v', '1', '-vf', 'scale=480:-2', 'miniatura.jpg'], { cwd: dir })
    const archivos = ['video.mp4', 'capas.ass', ...(fs.existsSync(path.join(dir, 'miniatura.jpg')) ? ['miniatura.jpg'] : [])]
    db.prepare(`UPDATE artefactos SET estado = 'listo', progreso = NULL, archivos = ? WHERE id = ?`).run(JSON.stringify(archivos), nid)
  } catch (e) {
    db.prepare(`UPDATE artefactos SET estado = 'fallo', progreso = ? WHERE id = ?`).run(e instanceof Error ? e.message.slice(0, 500) : String(e), nid)
  }
  return leerArtefacto(db, nid)!
}

// ─── momentos ───────────────────────────────────────────────────────────

let momentosIA = async (db: Db, usuario: string) => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'estudio' }, `Sos editor de video. De la transcripción con tiempos, elegís de 1 a 5 momentos que funcionan solos como un short (de 15 a 60 segundos): una idea completa, un remate, algo que engancha en los primeros segundos. Respetá los tiempos de la transcripción (empezá y terminá en un corte de frase).
Forma: {"momentos": [{"titulo": string, "desde": segundos, "hasta": segundos, "por_que": string}]}`, usuario, { temperatura: 0.4, maxTokens: 1500 })).datos

/** De la transcripción, los mejores cortes: cada uno queda como un proyecto nuevo (vertical, con sus subtítulos corridos). */
export async function momentosEstudio(db: Db, id: number, ahora = Date.now()): Promise<{ id: number; titulo: string; desde: number; hasta: number; por_que: string }[]> {
  const { a, p } = proyectoDe(db, id)
  const sub = p.capas.find((c) => c.tipo === 'subtitulos')
  if (!sub?.datos.cues?.length) throw new Error('Primero transcribí el video (los momentos salen de lo que se dice)')
  const base = p.recorte?.desde ?? 0
  const d = await momentosIA(db, (sub.datos.cues as Cue[]).map((q) => `[${(q.t0 + base).toFixed(1)}–${(q.t1 + base).toFixed(1)}] ${q.texto}`).join('\n').slice(0, 30_000))
  const out: { id: number; titulo: string; desde: number; hasta: number; por_que: string }[] = []
  for (const m of (Array.isArray(d?.momentos) ? d.momentos : []).slice(0, 5)) {
    const desde = acotar(m?.desde, 0, p.duracion - 1, 0)
    const hasta = acotar(m?.hasta, desde + 1, p.duracion, Math.min(p.duracion, desde + 30))
    if (hasta - desde < 3) continue
    const corridas: Capa[] = p.capas.map((c) => {
      if (c.tipo !== 'subtitulos') return { ...c, desde: Math.max(0, c.desde - (desde - base)), hasta: c.hasta == null ? null : Math.max(0.1, c.hasta - (desde - base)) }
      const cues = (c.datos.cues as Cue[]).filter((q) => q.t1 + base > desde && q.t0 + base < hasta)
        .map((q) => ({ ...q, t0: Math.max(0, q.t0 + base - desde), t1: q.t1 + base - desde, palabras: q.palabras?.map((w) => ({ ...w, t0: Math.max(0, w.t0 + base - desde), t1: w.t1 + base - desde })) }))
      return { ...c, datos: { ...c.datos, cues, preset: 'palabra' } }
    })
    const proyecto: Proyecto = { ...p, formato: '9:16', recorte: { desde, hasta }, capas: corridas, deshacer: [] }
    const titulo = texto(m?.titulo, 80) || `Momento ${out.length + 1}`
    const r = db.prepare(`INSERT INTO artefactos (tipo, titulo, pedido, version, archivos, meta, estado, creado_en) VALUES ('estudio', ?, ?, 1, '[]', ?, 'listo', ?)`)
      .run(`${titulo} · de «${a.titulo}»`.slice(0, 160), texto(m?.por_que, 300), JSON.stringify({ proyecto, momentoDe: a.id, audio: a.meta.audio }), ahora)
    fs.mkdirSync(carpeta(Number(r.lastInsertRowid)), { recursive: true })
    out.push({ id: Number(r.lastInsertRowid), titulo, desde, hasta, por_que: texto(m?.por_que, 300) })
  }
  return out
}

// ─── plantillas (el kit de marca) ───────────────────────────────────────

export type Plantilla = { id: number; nombre: string; entidadId: number | null; marca: string | null; capas: Capa[]; creadaEn: number }
const dePlantilla = (r: any): Plantilla => ({ id: r.id, nombre: r.nombre, entidadId: r.entidad_id, marca: r.marca, capas: json(r.capas, []) ?? [], creadaEn: r.creada_en })

export function plantillas(db: Db): Plantilla[] {
  return (db.prepare('SELECT * FROM plantillas_estudio ORDER BY id DESC').all() as any[]).map(dePlantilla)
}

/** Guarda las capas de un proyecto (sin subtítulos: esos son de cada video) como plantilla, opcionalmente de un proyecto suyo. */
export function guardarPlantilla(db: Db, id: number, o: { nombre: string; entidadId?: number | null; marca?: string | null }, ahora = Date.now()): Plantilla {
  const { p } = proyectoDe(db, id)
  const capas = p.capas.filter((c) => c.tipo !== 'subtitulos')
  if (!capas.length) throw new Error('No hay capas para guardar (los subtítulos no van en una plantilla)')
  // Las imágenes que usa viajan con la plantilla.
  const dirP = dirPlantillas()
  fs.mkdirSync(dirP, { recursive: true })
  for (const c of capas.filter((x) => x.tipo === 'imagen' && x.datos.archivo)) {
    const desde = c.datos.artefacto ? path.join(carpeta(c.datos.artefacto), c.datos.archivo) : path.join(carpeta(id), c.datos.archivo)
    if (fs.existsSync(desde)) fs.copyFileSync(desde, path.join(dirP, c.datos.archivo))
  }
  const r = db.prepare('INSERT INTO plantillas_estudio (nombre, entidad_id, marca, capas, creada_en) VALUES (?, ?, ?, ?, ?)')
    .run(texto(o.nombre, 80) || 'Plantilla', o.entidadId ?? null, o.marca ? texto(o.marca, 600) : null, JSON.stringify(capas.map((c) => ({ ...c, datos: c.tipo === 'imagen' ? { archivo: c.datos.archivo } : c.datos }))), ahora)
  return dePlantilla(db.prepare('SELECT * FROM plantillas_estudio WHERE id = ?').get(Number(r.lastInsertRowid)))
}
const dirPlantillas = () => path.join(path.dirname(carpeta(0)), 'plantillas')

/** Suma las capas de una plantilla al proyecto (con ids nuevos y sus imágenes copiadas). */
export function aplicarPlantilla(db: Db, id: number, plantillaId: number): Proyecto {
  const { p } = proyectoDe(db, id)
  const pl = db.prepare('SELECT * FROM plantillas_estudio WHERE id = ?').get(plantillaId)
  if (!pl) throw new Error('No existe esa plantilla')
  const t = dePlantilla(pl)
  for (const c of t.capas.filter((x) => x.tipo === 'imagen' && x.datos.archivo)) {
    const desde = path.join(dirPlantillas(), c.datos.archivo)
    if (fs.existsSync(desde)) fs.copyFileSync(desde, path.join(carpeta(id), c.datos.archivo))
  }
  const nuevas = t.capas.map((c) => normalizarCapa({ ...c, id: nuevoId(), datos: c.tipo === 'imagen' ? { archivo: c.datos.archivo, artefacto: null } : c.datos }, duracionUtil(p))).filter((x): x is Capa => !!x)
  p.deshacer = [...(p.deshacer ?? []), p.capas].slice(-12)
  p.capas = [...p.capas, ...nuevas].slice(0, 40)
  guardarProyecto(db, id, p)
  return p
}

/** Un zip mínimo (sin compresión): manifest.json y las imágenes. */
function zipDe(archivos: { nombre: string; datos: Buffer }[]): Buffer {
  const locales: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const a of archivos) {
    const nombre = Buffer.from(a.nombre)
    const crc = zlib.crc32(a.datos)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(a.datos.length, 18); lh.writeUInt32LE(a.datos.length, 22); lh.writeUInt16LE(nombre.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(a.datos.length, 20); ch.writeUInt32LE(a.datos.length, 24); ch.writeUInt16LE(nombre.length, 28); ch.writeUInt32LE(offset, 42)
    locales.push(lh, nombre, a.datos)
    central.push(ch, nombre)
    offset += 30 + nombre.length + a.datos.length
  }
  const cd = Buffer.concat(central)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(offset, 16)
  return Buffer.concat([...locales, cd, fin])
}

export function exportarPlantilla(db: Db, plantillaId: number): { nombre: string; zip: Buffer } {
  const pl = db.prepare('SELECT * FROM plantillas_estudio WHERE id = ?').get(plantillaId)
  if (!pl) throw new Error('No existe esa plantilla')
  const t = dePlantilla(pl)
  const assets = [...new Set(t.capas.filter((c) => c.tipo === 'imagen' && c.datos.archivo).map((c) => c.datos.archivo as string))].filter((n) => fs.existsSync(path.join(dirPlantillas(), n)))
  const manifest = { formato: 'deprocast-plantilla', version: 1, nombre: t.nombre, marca: t.marca, capas: t.capas, assets: assets.map((n) => `assets/${n}`) }
  return { nombre: `${t.nombre.replace(/[^\w-]+/g, '-') || 'plantilla'}.zip`, zip: zipDe([{ nombre: 'manifest.json', datos: Buffer.from(JSON.stringify(manifest, null, 2)) }, ...assets.map((n) => ({ nombre: `assets/${n}`, datos: fs.readFileSync(path.join(dirPlantillas(), n)) }))]) }
}

export function importarPlantilla(db: Db, datos: Buffer, ahora = Date.now()): Plantilla {
  const z = zipDeBuffer(datos)
  const man = z.entradas.find((e) => e.nombre === 'manifest.json')
  if (!man) throw new Error('Ese zip no es una plantilla (falta manifest.json)')
  const m = JSON.parse(z.leer(man).toString('utf8'))
  if (m?.formato !== 'deprocast-plantilla' || !Array.isArray(m.capas)) throw new Error('Formato de plantilla desconocido')
  fs.mkdirSync(dirPlantillas(), { recursive: true })
  for (const e of z.entradas.filter((x) => x.nombre.startsWith('assets/') && !x.dir)) {
    const n = path.basename(e.nombre)
    if (/^[\w.-]{1,80}$/.test(n)) fs.writeFileSync(path.join(dirPlantillas(), n), z.leer(e))
  }
  const capas = m.capas.map((c: any) => normalizarCapa(c, 3600)).filter(Boolean)
  const r = db.prepare('INSERT INTO plantillas_estudio (nombre, entidad_id, marca, capas, creada_en) VALUES (?, NULL, ?, ?, ?)').run(texto(m.nombre, 80) || 'Plantilla', m.marca ? texto(m.marca, 600) : null, JSON.stringify(capas), ahora)
  return dePlantilla(db.prepare('SELECT * FROM plantillas_estudio WHERE id = ?').get(Number(r.lastInsertRowid)))
}

/** Una imagen propia para una capa (un logo): queda en la carpeta del proyecto. */
export function subirImagenEstudio(db: Db, id: number, nombre: string, datos: Buffer): string {
  proyectoDe(db, id)
  const ext = datos[0] === 0x89 && datos[1] === 0x50 ? 'png' : datos[0] === 0xff && datos[1] === 0xd8 ? 'jpg' : null
  if (!ext) throw new Error('Subí un PNG o un JPG')
  const archivo = `img-${nuevoId()}.${ext}`
  fs.writeFileSync(path.join(carpeta(id), archivo), datos)
  void nombre
  return archivo
}

// ─── mandar a Cuentas ───────────────────────────────────────────────────

let redactar = async (db: Db, usuario: string) => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'estudio' }, 'Escribís el texto de una publicación para acompañar un video, en la voz del operador (castellano rioplatense, sin hashtags de relleno, con un gancho al principio). Forma: {"texto": string}', usuario, { temperatura: 0.7, maxTokens: 800 })).datos

/** Deja una publicación en borrador con el video y un texto propuesto: él la aprueba (o no) en Cuentas. */
export async function mandarACuentas(db: Db, id: number, cuentaId: number, ahora = Date.now()): Promise<{ publicacion: number; texto: string }> {
  const a = leerArtefacto(db, id)
  if (!a || a.tipo !== 'estudio' || !a.archivos.includes('video.mp4')) throw new Error('Primero exportá el video')
  const c = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(cuentaId) as any
  if (!c) throw new Error('No existe esa cuenta')
  if (c.modo === 'lectura') throw new Error('Esa cuenta es solo de lectura: ahí no se publica')
  const sub = (a.meta.proyecto as Proyecto).capas.find((x) => x.tipo === 'subtitulos')
  const d = await redactar(db, [`Red: ${c.red} (${c.usuario})`, `Video: «${a.titulo}»`, sub ? `Lo que se dice: ${sub.datos.cues.map((q: Cue) => q.texto).join(' ').slice(0, 2000)}` : '', `Lo que sabés de él:\n${memoriaParaPrompt(db, 20)}`].filter(Boolean).join('\n'))
  const t = texto(d?.texto, 2500) || a.titulo
  const r = db.prepare(`INSERT INTO publicaciones (cuenta_id, texto, estado, tipo, origen, adjunto, creada_en) VALUES (?, ?, 'borrador', 'video', 'mastropiero', ?, ?)`).run(cuentaId, t, `/taller/${a.id}/video.mp4`, ahora)
  return { publicacion: Number(r.lastInsertRowid), texto: t }
}
