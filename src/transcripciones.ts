/**
 * El audio y sus transcripciones (Fragua #306, pedido suyo caminando: «que mantenga el audio y permita varias revisadas,
 * porque la primera transcripción no suele ser perfecta»).
 * - Cada tramo de la escucha (dictado y notas de voz; las conversaciones con otros no) guarda su audio en Deprocast
 *   (comprimido a opus si hay ffmpeg; si no, tal cual), además de la copia en Drive.
 * - Cada transcripción es una versión: su motor (whisper, gemini), su fecha, su texto y sus tramos con la confianza. Volver
 *   a pasar el audio suma una versión sin perder las anteriores; él elige cuál vale (y la nota de voz se actualiza).
 * - Lo dudoso se marca: los tramos de baja confianza (o que Whisper cree que no tienen voz), para revisar solo eso.
 * - Si más de un tercio de lo transcripto es dudoso, se pasa solo por un segundo motor (Gemini, si está), como versión
 *   alternativa: no pisa la primera.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { ajuste, type Db } from './db.ts'
import type { SegmentoWhisper } from './nan.ts'

export type Motor = 'whisper' | 'gemini'
export type Version = { id: number; audioId: number; version: number; motor: string; texto: string; segmentos: SegmentoWhisper[]; dudosos: number; vigente: boolean; creadaEn: number }
export type Audio = { id: number; refTipo: string; refId: number; piezaId: number | null; archivo: string; bytes: number; nombre: string; creadoEn: number }

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS audios (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ref_tipo TEXT NOT NULL, ref_id INTEGER NOT NULL, pieza_id INTEGER, archivo TEXT NOT NULL,
  bytes INTEGER NOT NULL, nombre TEXT NOT NULL, creado_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audios_ref ON audios(ref_tipo, ref_id);
CREATE INDEX IF NOT EXISTS audios_pieza ON audios(pieza_id);
CREATE TABLE IF NOT EXISTS transcripciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, audio_id INTEGER NOT NULL, version INTEGER NOT NULL, motor TEXT NOT NULL, texto TEXT NOT NULL,
  segmentos TEXT NOT NULL DEFAULT '[]', dudosos INTEGER NOT NULL DEFAULT 0, vigente INTEGER NOT NULL DEFAULT 0, creada_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS transcripciones_audio ON transcripciones(audio_id, version);`
const listos = new WeakSet<Db>()
function asegurar(db: Db) { if (!listos.has(db)) { db.exec(ESQUEMA); listos.add(db) } }

const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) : d } catch { return d } }
const deAudio = (r: any): Audio => ({ id: r.id, refTipo: r.ref_tipo, refId: r.ref_id, piezaId: r.pieza_id, archivo: r.archivo, bytes: r.bytes, nombre: r.nombre, creadoEn: r.creado_en })
const deVersion = (r: any): Version => ({ id: r.id, audioId: r.audio_id, version: r.version, motor: r.motor, texto: r.texto, segmentos: json(r.segmentos, []), dudosos: r.dudosos, vigente: !!r.vigente, creadaEn: r.creada_en })

/** Un tramo es dudoso si su confianza es baja (< 0,5) o si Whisper cree que ahí no había voz (> 0,6). */
export const esDudoso = (s: Pick<SegmentoWhisper, 'confianza' | 'sinVoz'>) => (s.confianza != null && s.confianza < 0.5) || (s.sinVoz != null && s.sinVoz > 0.6)
/** Qué parte del texto es dudosa (0–1, por largo de los tramos). */
export function parteDudosa(segs: SegmentoWhisper[]): number {
  const total = segs.reduce((s, x) => s + x.texto.length, 0)
  return total ? segs.filter(esDudoso).reduce((s, x) => s + x.texto.length, 0) / total : 0
}
/** El texto con lo dudoso marcado: «… [¿Urbi Alba?] …». */
export const textoMarcado = (segs: SegmentoWhisper[]) => segs.map((s) => (esDudoso(s) ? `[¿${s.texto}?]` : s.texto)).join(' ').replace(/\s+/g, ' ').trim()

/** Para las pruebas: ffmpeg, los motores y si hay Gemini. */
let externos = {
  ffmpeg: (args: string[]) => new Promise<boolean>((ok) => { const p = spawn('ffmpeg', args, { stdio: 'ignore', windowsHide: true }); const t = setTimeout(() => p.kill('SIGKILL'), 120_000); p.on('error', () => { clearTimeout(t); ok(false) }); p.on('close', (c) => { clearTimeout(t); ok(c === 0) }) }),
  whisper: async (db: Db, audio: Buffer, nombre: string) => { const r = await (await import('./nan.ts')).nanTranscribirDetallado(db, audio, nombre, { palabras: false, segmentos: true }); return { texto: r.texto, segmentos: r.segmentos ?? [] } },
  gemini: (db: Db, audio: Buffer, nombre: string) => transcribirConGemini(db, audio, nombre),
  hayGemini: () => !!process.env.GEMINI_API_KEY?.trim(),
}
export function _probarTranscripciones(o: Partial<typeof externos>) { externos = { ...externos, ...o } }

async function dirAudios() {
  const { dirAdjuntos } = await import('./chat/adjuntos.ts')
  // En la carpeta de adjuntos (se sirven desde /adjuntos/…, con la misma clave), con el prefijo voz-.
  const d = dirAdjuntos()
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** Guarda el audio de un tramo (comprimido a opus si se puede) y su primera transcripción. Devuelve el id del audio. */
export async function archivarAudio(db: Db, a: { datos: Buffer; nombre: string; refTipo: string; refId: number; piezaId?: number | null; texto: string; segmentos?: SegmentoWhisper[]; motor?: Motor }, ahora = Date.now()): Promise<number> {
  asegurar(db)
  const d = await dirAudios()
  const base = `voz-${ahora}-${crypto.createHash('sha1').update(a.datos).digest('hex').slice(0, 10)}`
  const tmp = path.join(os.tmpdir(), `${base}${path.extname(a.nombre) || '.m4a'}`)
  fs.writeFileSync(tmp, a.datos)
  let archivo = `${base}.opus`
  try {
    if (!(await externos.ffmpeg(['-y', '-i', tmp, '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', path.join(d, archivo)])) || !fs.existsSync(path.join(d, archivo))) {
      archivo = `${base}${path.extname(a.nombre) || '.m4a'}`
      fs.copyFileSync(tmp, path.join(d, archivo))
    }
  } finally { fs.rmSync(tmp, { force: true }) }
  const bytes = fs.statSync(path.join(d, archivo)).size
  const id = Number(db.prepare('INSERT INTO audios (ref_tipo, ref_id, pieza_id, archivo, bytes, nombre, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)').run(a.refTipo, a.refId, a.piezaId ?? null, archivo, bytes, a.nombre.slice(0, 120), ahora).lastInsertRowid)
  agregarVersion(db, id, { motor: a.motor ?? 'whisper', texto: a.texto, segmentos: a.segmentos ?? [], vigente: true }, ahora)
  return id
}

function agregarVersion(db: Db, audioId: number, v: { motor: string; texto: string; segmentos: SegmentoWhisper[]; vigente: boolean }, ahora: number): Version {
  const n = ((db.prepare('SELECT MAX(version) AS n FROM transcripciones WHERE audio_id = ?').get(audioId) as { n: number | null }).n ?? 0) + 1
  if (v.vigente) db.prepare('UPDATE transcripciones SET vigente = 0 WHERE audio_id = ?').run(audioId)
  const id = Number(db.prepare('INSERT INTO transcripciones (audio_id, version, motor, texto, segmentos, dudosos, vigente, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(audioId, n, v.motor, v.texto, JSON.stringify(v.segmentos), v.segmentos.filter(esDudoso).length, v.vigente ? 1 : 0, ahora).lastInsertRowid)
  return deVersion(db.prepare('SELECT * FROM transcripciones WHERE id = ?').get(id))
}

export function leerAudio(db: Db, id: number): Audio | null { asegurar(db); const r = db.prepare('SELECT * FROM audios WHERE id = ?').get(id); return r ? deAudio(r) : null }
/** El audio de una pieza (una nota de voz) o de un tramo de la escucha. */
export function audioDe(db: Db, o: { piezaId?: number; segmentoId?: number }): Audio | null {
  asegurar(db)
  const r = o.piezaId != null ? db.prepare('SELECT * FROM audios WHERE pieza_id = ? ORDER BY id DESC LIMIT 1').get(o.piezaId) : db.prepare(`SELECT * FROM audios WHERE ref_tipo = 'voz_segmento' AND ref_id = ? ORDER BY id DESC LIMIT 1`).get(o.segmentoId ?? -1)
  return r ? deAudio(r) : null
}
export function versiones(db: Db, audioId: number): Version[] { asegurar(db); return (db.prepare('SELECT * FROM transcripciones WHERE audio_id = ? ORDER BY version').all(audioId) as any[]).map(deVersion) }
export async function rutaDelAudio(a: Audio) { return path.join(await dirAudios(), a.archivo) }

/** Pasa el audio otra vez (por otro motor, o el mismo): una versión nueva, que no pisa las anteriores salvo que se pida. */
export async function retranscribir(db: Db, audioId: number, motor: Motor = 'gemini', o: { vigente?: boolean; ahora?: number } = {}): Promise<Version> {
  const a = leerAudio(db, audioId)
  if (!a) throw new Error(`No existe el audio ${audioId}`)
  if (motor === 'gemini' && !externos.hayGemini()) throw new Error('Gemini no está configurado: puedo volver a pasarlo por Whisper')
  const datos = fs.readFileSync(await rutaDelAudio(a))
  const r = motor === 'gemini' ? { texto: await externos.gemini(db, datos, a.archivo), segmentos: [] as SegmentoWhisper[] } : await externos.whisper(db, datos, a.archivo)
  if (!r.texto.trim()) throw new Error('El motor no devolvió texto')
  const v = agregarVersion(db, audioId, { motor, texto: r.texto.trim(), segmentos: r.segmentos, vigente: !!o.vigente }, o.ahora ?? Date.now())
  if (o.vigente) actualizarPieza(db, a, v.texto)
  return v
}

/** Elige qué versión vale; si el audio es de una nota de voz, la pieza pasa a decir eso. */
export function elegirVersion(db: Db, audioId: number, version: number): Version {
  const a = leerAudio(db, audioId)
  if (!a) throw new Error(`No existe el audio ${audioId}`)
  const v = versiones(db, audioId).find((x) => x.version === version)
  if (!v) throw new Error(`El audio ${audioId} no tiene versión ${version}`)
  db.prepare('UPDATE transcripciones SET vigente = CASE WHEN version = ? THEN 1 ELSE 0 END WHERE audio_id = ?').run(version, audioId)
  actualizarPieza(db, a, v.texto)
  return { ...v, vigente: true }
}

function actualizarPieza(db: Db, a: Audio, texto: string) {
  if (a.piezaId) db.prepare('UPDATE corpus SET contenido = ? WHERE id = ?').run(texto, a.piezaId)
}

/** Si la primera transcripción tiene más de un tercio dudoso, un segundo motor la pasa (alternativa, no vigente). */
export async function segundaPasadaSiHaceFalta(db: Db, audioId: number, ahora = Date.now()): Promise<Version | null> {
  const vs = versiones(db, audioId)
  if (vs.length !== 1 || !vs[0].segmentos.length || parteDudosa(vs[0].segmentos) < 1 / 3) return null
  if (!externos.hayGemini() || ajuste(db, 'retranscribir_auto') === '0') return null
  return retranscribir(db, audioId, 'gemini', { ahora }).catch(() => null)
}

/** Gemini escucha el audio y lo transcribe literal (para comparar con Whisper). */
async function transcribirConGemini(db: Db, audio: Buffer, nombre: string): Promise<string> {
  const clave = process.env.GEMINI_API_KEY?.trim()
  if (!clave) throw new Error('Gemini no está configurado')
  const modelo = process.env.GEMINI_MODELO?.trim() || ajuste(db, 'youtube_gemini_modelo') || 'gemini-2.5-flash'
  const mime = /\.opus$|\.ogg$/i.test(nombre) ? 'audio/ogg' : /\.wav$/i.test(nombre) ? 'audio/wav' : /\.mp3$/i.test(nombre) ? 'audio/mpeg' : 'audio/mp4'
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': clave }, signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime, data: audio.toString('base64') } }, { text: 'Transcribí literal, palabra por palabra, lo que se dice en este audio (castellano rioplatense, puede mezclar otros idiomas). Sin resumir, sin corregir, sin comentarios. Lo que no se entiende, [inaudible]. Solo el texto.' }] }], generationConfig: { temperature: 0 } }),
  })
  const j = await r.json().catch(() => null) as any
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${String(j?.error?.message ?? '').slice(0, 160)}`)
  return String(j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '').trim()
}
