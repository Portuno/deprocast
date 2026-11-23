/**
 * Los audios que llegan por Telegram o WhatsApp (Fragua #328). Antes un audio se bajaba y se transcribía antes de dejar
 * rastro: si algo fallaba (pesaba más de lo que el bot puede bajar, la transcripción se cortaba) no quedaba nada, y
 * después el chat contestaba «no me llegó». Ahora:
 * - cada audio queda anotado apenas llega (nombre, duración, peso) con su estado: recibido, transcribiendo,
 *   transcripto, en cola (falló y se reintenta solo), grande (no se puede bajar) o fallo;
 * - el chat ve ese estado (no dice que no llegó lo que está en cola);
 * - lo que él pide sobre un audio que todavía no está («mandá eso a la Fragua») queda esperando y se hace cuando llega
 *   la transcripción;
 * - lo largo se transcribe por tramos de diez minutos (con ffmpeg), así un corte no tira todo;
 * - lo que falló se guarda en disco y se reintenta solo cada tanto (hasta 5 veces), y avisa con el nombre del archivo.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { json, resolverRuta, type Db } from './db.ts'

export type EstadoAudio = 'recibido' | 'transcribiendo' | 'transcripto' | 'en_cola' | 'grande' | 'fallo'
export type AudioEntrante = { id: number; canal: string; nombre: string; duracion: number | null; tamano: number | null; ref: string | null; estado: EstadoAudio; error: string | null; archivo: string | null; intentos: number; piezaId: number | null; ordenes: string[]; creado: number; actualizado: number }

/** Lo más que un bot de Telegram puede bajar. */
export const LIMITE_BOT = 20 * 1024 * 1024
export const MAX_INTENTOS = 5
/** Cuánto tiempo un audio sin resolver sigue a la vista del chat. */
const VENTANA = 24 * 3_600_000

const deFila = (r: any): AudioEntrante => ({ id: r.id, canal: r.canal, nombre: r.nombre, duracion: r.duracion, tamano: r.tamano, ref: r.ref, estado: r.estado, error: r.error, archivo: r.archivo, intentos: r.intentos, piezaId: r.pieza_id, ordenes: json<string[]>(r.ordenes, []), creado: r.creado, actualizado: r.actualizado })

export const dirPendientes = () => {
  const db = resolverRuta()
  return db === ':memory:' ? path.join(os.tmpdir(), `mastro-audios-${process.pid}`) : path.join(path.dirname(db), 'audios-pendientes')
}

export const minutos = (s: number | null) => (s ? `${Math.max(1, Math.round(s / 60))} min` : null)
export const mb = (b: number | null) => (b ? `${(b / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB` : null)
export const describir = (a: Pick<AudioEntrante, 'nombre' | 'duracion' | 'tamano'>) => `«${a.nombre}»${[minutos(a.duracion), mb(a.tamano)].filter(Boolean).length ? ` (${[minutos(a.duracion), mb(a.tamano)].filter(Boolean).join(', ')})` : ''}`

export function leerAudio(db: Db, id: number): AudioEntrante | null {
  const r = db.prepare('SELECT * FROM audios_entrantes WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

/** Lo anota apenas llega. Si ya estaba (el mismo audio reenviado) devuelve ese. */
export function registrarAudio(db: Db, a: { canal: string; nombre: string; duracion?: number | null; tamano?: number | null; ref?: string | null }, ahora = Date.now()): AudioEntrante {
  if (a.ref) {
    const ya = db.prepare(`SELECT * FROM audios_entrantes WHERE ref = ? ORDER BY id DESC LIMIT 1`).get(a.ref)
    if (ya) return deFila(ya)
  }
  const r = db.prepare('INSERT INTO audios_entrantes (canal, nombre, duracion, tamano, ref, estado, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(a.canal, a.nombre.slice(0, 200), a.duracion ?? null, a.tamano ?? null, a.ref ?? null, 'recibido', ahora, ahora)
  return leerAudio(db, Number(r.lastInsertRowid))!
}

export function marcar(db: Db, id: number, estado: EstadoAudio, c: { error?: string | null; piezaId?: number | null; archivo?: string | null; intento?: boolean } = {}, ahora = Date.now()) {
  const a = leerAudio(db, id)
  if (!a) return
  db.prepare('UPDATE audios_entrantes SET estado = ?, error = ?, pieza_id = COALESCE(?, pieza_id), archivo = ?, intentos = intentos + ?, actualizado = ? WHERE id = ?')
    .run(estado, c.error === undefined ? a.error : c.error?.slice(0, 400) ?? null, c.piezaId ?? null, c.archivo === undefined ? a.archivo : c.archivo, c.intento ? 1 : 0, ahora, id)
}

/** Guarda la copia del audio mientras espera (para reintentar sin volver a bajarlo). */
export function guardarCopia(db: Db, id: number, datos: Buffer, nombre: string): string {
  fs.mkdirSync(dirPendientes(), { recursive: true })
  const ruta = path.join(dirPendientes(), `${id}${path.extname(nombre) || '.m4a'}`)
  fs.writeFileSync(ruta, datos)
  db.prepare('UPDATE audios_entrantes SET archivo = ? WHERE id = ?').run(ruta, id)
  return ruta
}
export function borrarCopia(db: Db, id: number) {
  const a = leerAudio(db, id)
  if (a?.archivo) try { fs.rmSync(a.archivo, { force: true }) } catch { /* ya no estaba */ }
  db.prepare('UPDATE audios_entrantes SET archivo = NULL WHERE id = ?').run(id)
}

/** Los que todavía no están (o fallaron) de las últimas 24 horas. */
export function sinResolver(db: Db, ahora = Date.now()): AudioEntrante[] {
  return (db.prepare(`SELECT * FROM audios_entrantes WHERE estado != 'transcripto' AND creado >= ? ORDER BY id DESC`).all(ahora - VENTANA) as any[]).map(deFila)
}

/** Para el prompt del chat: los audios que llegaron y todavía no están transcriptos, con su estado. */
export function audiosParaPrompt(db: Db, ahora = Date.now()): string {
  let xs: AudioEntrante[] = []
  try { xs = sinResolver(db, ahora) } catch { return '' }
  if (!xs.length) return ''
  const que: Record<EstadoAudio, string> = { recibido: 'recibido, por bajar', transcribiendo: 'transcribiéndose ahora', transcripto: 'transcripto', en_cola: 'en cola: falló y se reintenta solo', grande: 'no se pudo bajar: pesa más de lo que el bot puede bajar', fallo: 'falló del todo' }
  return `Audios que te mandó y todavía no están transcriptos (NO digas que no llegaron: decí en qué estado están). Si pide algo sobre uno de ellos («mandá eso a la Fragua»), dejalo esperando con dejar_orden_para_audio: se hace solo cuando llegue la transcripción.\n${xs.map((a) => `- audio ${a.id} ${describir(a)} por ${a.canal}: ${que[a.estado]}${a.error ? ` (${a.error.slice(0, 120)})` : ''}${a.ordenes.length ? `; esperando: ${a.ordenes.join(' · ')}` : ''}`).join('\n')}`
}

/** Deja una orden esperando a que llegue la transcripción (el último audio sin resolver, o uno por id). */
export function dejarOrden(db: Db, orden: string, id?: number | null, ahora = Date.now()) {
  const a = id ? leerAudio(db, id) : sinResolver(db, ahora)[0] ?? null
  if (!a) throw new Error('No hay ningún audio esperando')
  if (a.estado === 'transcripto') throw new Error(`El audio ${describir(a)} ya está transcripto${a.piezaId ? ` (pieza #${a.piezaId})` : ''}: hacelo ahora`)
  const ordenes = [...a.ordenes, orden.trim().slice(0, 500)].slice(-10)
  db.prepare('UPDATE audios_entrantes SET ordenes = ?, actualizado = ? WHERE id = ?').run(JSON.stringify(ordenes), ahora, a.id)
  return { audio: a.id, nombre: a.nombre, estado: a.estado, ordenes }
}

/** Las órdenes que esperaban (y las saca: se hacen una vez). */
export function tomarOrdenes(db: Db, id: number): string[] {
  const a = leerAudio(db, id)
  if (!a?.ordenes.length) return []
  db.prepare(`UPDATE audios_entrantes SET ordenes = '[]' WHERE id = ?`).run(id)
  return a.ordenes
}

// ─── transcribir por tramos ────────────────────────────────────────────────

/** Por debajo de esto un audio no llega a diez minutos ni en opus de WhatsApp (unos 16 kbps): no hace falta medirlo. */
const TAMANO_PARA_MEDIR = 1_000_000

/** La duración en segundos de lo que dice ffmpeg; null si no está o no la pudo leer. */
export function duracionDeAudio(datos: Buffer, nombre: string): number | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-dur-'))
  try {
    const entrada = path.join(dir, `a${path.extname(nombre) || '.ogg'}`)
    fs.writeFileSync(entrada, datos)
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', entrada], { encoding: 'utf8', timeout: 30_000 })
    const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr ?? '')
    return d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null
  } catch { return null } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

/**
 * Lo de más de diez minutos se parte en tramos de diez (ffmpeg, sin recodificar) y se transcribe por partes: un corte
 * no tira los dieciocho minutos enteros. Sin ffmpeg, o si partir falla, va entero.
 */
export async function transcribirPorTramos(datos: Buffer, nombre: string, duracion: number | null, transcribir: (d: Buffer, n: string) => Promise<string>): Promise<string> {
  // WhatsApp no manda la duración (Fragua #333): si el archivo da para más de diez minutos, se mide antes de mandarlo
  // entero, que en un audio largo es donde la transcripción salía cortada.
  if (!duracion && datos.length > TAMANO_PARA_MEDIR) duracion = duracionDeAudio(datos, nombre)
  if (!duracion || duracion <= 600) return transcribir(datos, nombre)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-audio-'))
  try {
    const ext = path.extname(nombre) || '.m4a'
    const entrada = path.join(dir, `entrada${ext}`)
    fs.writeFileSync(entrada, datos)
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', entrada, '-f', 'segment', '-segment_time', '600', '-c', 'copy', path.join(dir, `t%03d${ext}`)], { encoding: 'utf8' })
    const tramos = fs.readdirSync(dir).filter((f) => /^t\d{3}/.test(f)).sort()
    if (r.status !== 0 || tramos.length < 2) return transcribir(datos, nombre)
    const partes: string[] = []
    for (const t of tramos) partes.push((await transcribir(fs.readFileSync(path.join(dir, t)), t)).trim())
    return partes.filter(Boolean).join(' ')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
