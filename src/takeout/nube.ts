/**
 * El Takeout en Deprocast (corre en la nube; todo lo que gasta tokens pasa acá):
 * 1. Ingesta (sin modelo): el paquete que armó la compu entra como piezas con su fecha y su nivel de voz. Gemini: una
 *    pieza por conversación (investigación) y otra con lo que él le dijo (propia). NotebookLM: cada cuaderno es un
 *    contexto (una subfuente) con sus fuentes, notas, chats y artefactos. Lo repetido entra una vez y suma apariciones.
 * 2. Medios: cada audio se transcribe (Whisper), cada imagen se describe (visión) y cada documento se lee. El archivo
 *    se borra apenas queda su texto: en Deprocast no quedan audios ni imágenes.
 * 3. Destilado: cada conversación, nota de voz y contexto se lee situado en SU fecha: resumen, proyectos (cómo estaban
 *    entonces), ideas, decisiones, lo que quedó abierto, personas y temas. Las entidades que ya existen se enlazan; las
 *    nuevas esperan su ok. Las ideas quedan como quántomos proto; lo que dice de él, como recuerdos sin revisar.
 * 4. Historia: cuando termina, cada proyecto recibe su historia por eras, las ideas viejas que valdría revisar hoy y
 *    una pregunta para que él diga en qué estado está y a dónde va (eso lo fija él, no el archivo).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fechaLocal, json, resolverRuta, type Db } from '../db.ts'
import { asegurarFuente, insertar, slug } from '../corpus.ts'
import { asegurarEntidad, editarEntidad } from '../entidades.ts'
import { crearQuantomo } from '../quantomos.ts'
import { memoriaParaPrompt, recordar } from '../memoria.ts'
import { encolarPregunta } from '../preguntas.ts'
import { nanTranscribir, nanVision } from '../nan.ts'
import { leerJson, pedirJson } from '../modelo.ts'
import { lineasDe } from '../exportacion.ts'
import { textoDePdf } from '../cargas/pdf.ts'
import { personaje } from '../personajes.ts'
import { zipDeBuffer } from './zip.ts'
import { aMarkdown } from './leer.ts'

// ─── dónde vive cada cosa ───────────────────────────────────────────────

export const dirTakeout = () => path.resolve(process.env.MASTRO_TAKEOUT ?? path.join(path.dirname(resolverRuta()), 'takeout'))
const rutaPaquete = (lote: string) => path.join(dirTakeout(), `${lote}.jsonl`)
const rutaMedio = (huella: string, ext: string) => path.join(dirTakeout(), 'medios', `${huella}.${ext}`)
export const loteValido = (s: string) => /^[\w.-]{6,80}$/.test(s)
export const huellaValida = (s: string) => /^[0-9a-f]{40}$/.test(s)

const FUENTES = {
  chats: { id: 'gemini-chats', nombre: 'Gemini · conversaciones', nivel: 'investigacion', descripcion: 'Tus charlas con Gemini, una pieza por conversación, con sus fechas.' },
  yo: { id: 'gemini', nombre: 'Gemini', nivel: 'propia', descripcion: 'Lo que le dijiste a Gemini (tu voz).' },
  adjuntos: { id: 'gemini-adjuntos', nombre: 'Gemini · adjuntos', nivel: 'primaria', descripcion: 'Lo que le pasaste a Gemini: imágenes descritas, audios transcriptos, documentos leídos.' },
  nlm: { id: 'notebooklm', nombre: 'NotebookLM', nivel: 'investigacion', descripcion: 'Tus cuadernos de NotebookLM, cada uno como un contexto con sus fuentes, notas, chats y artefactos.' },
  destilado: { id: 'takeout-destilado', nombre: 'Takeout · destilado', nivel: 'investigacion', descripcion: 'Lo que Mastropiero destiló de cada conversación, nota de voz y cuaderno, situado en su fecha.' },
  historia: { id: 'takeout-historia', nombre: 'Historia de proyectos', nivel: 'investigacion', descripcion: 'Cada proyecto por eras: cómo era, qué cambió e ideas viejas que valdría mirar hoy.' },
} as const

const fuenteCuaderno = (db: Db, carpeta: string, titulo: string) => {
  asegurarFuente(db, FUENTES.nlm)
  return asegurarFuente(db, { id: `nlm-${slug(carpeta).slice(0, 60)}`, nombre: `NotebookLM › ${titulo}`.slice(0, 120), nivel: 'investigacion', padreId: FUENTES.nlm.id, descripcion: 'Un cuaderno de NotebookLM: un contexto con sus fuentes, notas, chats y artefactos.' }).id
}

const sha1 = (s: string | Buffer) => crypto.createHash('sha1').update(s).digest('hex')
const hora = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
const diaDe = (ms: number | string | null | undefined) => (ms == null ? null : typeof ms === 'number' ? new Date(ms).toISOString().slice(0, 10) : String(ms).slice(0, 10) || null)
export const claveDe = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

// ─── lotes ──────────────────────────────────────────────────────────────

export type Aparicion = { origen: 'gemini' | 'notebooklm'; contexto: string; titulo: string; fecha: string | null; nivel: string; rol: string }

function lote(db: Db, id: string, ahora = Date.now()) {
  db.prepare(`INSERT OR IGNORE INTO takeout_lotes (id, estado, creado_en) VALUES (?, 'subiendo', ?)`).run(id, ahora)
  return db.prepare('SELECT * FROM takeout_lotes WHERE id = ?').get(id) as any
}
const marcarLote = (db: Db, id: string, estado: string, extra: Record<string, unknown> = {}) => {
  db.prepare('UPDATE takeout_lotes SET estado = ? WHERE id = ?').run(estado, id)
  if ('error' in extra) db.prepare('UPDATE takeout_lotes SET error = ? WHERE id = ?').run(extra.error as string | null, id)
}
const sumarResumen = (db: Db, id: string, cambios: Record<string, number>) => {
  const r = json<Record<string, number>>((db.prepare('SELECT resumen FROM takeout_lotes WHERE id = ?').get(id) as any)?.resumen, {}) ?? {}
  for (const [k, v] of Object.entries(cambios)) r[k] = (r[k] ?? 0) + v
  db.prepare('UPDATE takeout_lotes SET resumen = ? WHERE id = ?').run(JSON.stringify(r), id)
}

/** Guarda un pedazo del paquete en su lugar (por posición: un reintento no duplica). */
export function recibirParte(lote_: string, desde: number, datos: Buffer) {
  const ruta = rutaPaquete(lote_)
  fs.mkdirSync(path.dirname(ruta), { recursive: true })
  if (desde > 0 && (!fs.existsSync(ruta) || fs.statSync(ruta).size < desde)) throw new Error('Falta un pedazo anterior del paquete')
  const fd = fs.openSync(ruta, desde === 0 ? 'w' : 'r+')
  try { fs.writeSync(fd, datos, 0, datos.length, desde) } finally { fs.closeSync(fd) }
  return fs.statSync(ruta).size
}

/** Un medio que llega (ya achicado en la compu): queda en disco hasta que se procesa. */
export function recibirMedio(db: Db, lote_: string, huella: string, ext: string, datos: Buffer, ahora = Date.now()) {
  if (!/^[a-z0-9]{1,5}$/.test(ext)) throw new Error('Extensión rara')
  const ya = db.prepare('SELECT estado FROM takeout_medios WHERE huella = ?').get(huella) as { estado: string } | undefined
  if (ya && ya.estado !== 'esperando') return { ya: true }
  const ruta = rutaMedio(huella, ext)
  fs.mkdirSync(path.dirname(ruta), { recursive: true })
  fs.writeFileSync(ruta, datos)
  if (ya) db.prepare(`UPDATE takeout_medios SET ruta = ?, ext = ?, estado = 'pendiente' WHERE huella = ?`).run(ruta, ext, huella)
  else db.prepare(`INSERT INTO takeout_medios (huella, lote, clase, ext, nombre, apariciones, ruta, estado, creado_en) VALUES (?, ?, ?, ?, ?, '[]', ?, 'pendiente', ?)`)
    .run(huella, lote_, claseDeExt(ext), ext, `${huella}.${ext}`, ruta, ahora)
  return { ya: false }
}
const claseDeExt = (ext: string) => (/^(mp3|ogg|opus|m4a|wav|mp4|webm|aac)$/.test(ext) ? 'audio' : /^(jpe?g|png|webp|gif)$/.test(ext) ? 'imagen' : 'documento')

/** Las huellas que todavía no llegaron (para que la compu no suba dos veces lo mismo). */
export function faltan(db: Db, huellas: string[]): string[] {
  const q = db.prepare('SELECT estado FROM takeout_medios WHERE huella = ?')
  return huellas.filter((h) => { const r = q.get(h) as { estado: string } | undefined; return !r || r.estado === 'esperando' })
}

// ─── 1. ingesta ─────────────────────────────────────────────────────────

const ingiriendo = new Set<string>()

/** Lee el paquete de a líneas y deja todo como piezas (sin modelo). Idempotente: se puede repetir sin duplicar. */
export async function ingerirPaquete(db: Db, lote_: string, ahora = Date.now()): Promise<Record<string, number>> {
  if (ingiriendo.has(lote_)) throw new Error('Ese paquete ya se está leyendo')
  ingiriendo.add(lote_)
  lote(db, lote_, ahora)
  marcarLote(db, lote_, 'ingiriendo')
  const cuenta: Record<string, number> = {}
  const mas = (k: string) => { cuenta[k] = (cuenta[k] ?? 0) + 1 }
  const cuadernos = new Map<string, { fuente: string; titulo: string; overview: number | null }>()
  try {
    for (const k of Object.values(FUENTES)) asegurarFuente(db, k)
    for await (const linea of lineasDe(rutaPaquete(lote_))) {
      if (!linea.trim()) continue
      const x = JSON.parse(linea)
      if (x.t === 'gemini') ingerirChat(db, lote_, x, ahora) && mas('chats')
      else if (x.t === 'cuaderno') {
        const fuente = fuenteCuaderno(db, x.carpeta, x.titulo)
        const overview = ingerirCuaderno(db, lote_, fuente, x, ahora)
        cuadernos.set(x.carpeta, { fuente, titulo: x.titulo, overview })
        mas('cuadernos')
      } else if (x.t === 'fuente' || x.t === 'nota' || x.t === 'chat-nlm' || x.t === 'artefacto') {
        const c = cuadernos.get(x.carpeta)
        if (!c) continue // el paquete siempre manda el cuaderno antes que sus cosas
        if (ingerirDeCuaderno(db, lote_, c, x, ahora)) mas(x.t === 'chat-nlm' ? 'chats_nlm' : `${x.t}s`)
      } else if (x.t === 'medio') {
        anotarMedio(db, lote_, x, ahora)
        mas('medios')
      }
    }
    marcarLote(db, lote_, (db.prepare('SELECT subido_en FROM takeout_lotes WHERE id = ?').get(lote_) as any)?.subido_en ? 'procesando' : 'subiendo', { error: null })
    db.prepare('UPDATE takeout_lotes SET resumen = ? WHERE id = ?').run(JSON.stringify({ ...json<Record<string, number>>((db.prepare('SELECT resumen FROM takeout_lotes WHERE id = ?').get(lote_) as any)?.resumen, {}), ...Object.fromEntries(Object.entries(cuenta).map(([k, v]) => [`ingesta_${k}`, v])) }), lote_)
    fs.rmSync(rutaPaquete(lote_), { force: true })
    return cuenta
  } catch (e) {
    marcarLote(db, lote_, 'error', { error: `Ingesta: ${e instanceof Error ? e.message : String(e)}` })
    throw e
  } finally {
    ingiriendo.delete(lote_)
  }
}

function aparicion(db: Db, piezaId: number, a: { origen: string; contexto: string | null; titulo: string | null; fecha: string | null }) {
  db.prepare('INSERT OR IGNORE INTO takeout_apariciones (pieza_id, origen, contexto, titulo, fecha) VALUES (?, ?, ?, ?, ?)').run(piezaId, a.origen, a.contexto, a.titulo, a.fecha)
}

const porOrigen = (db: Db, origen: string) => (db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(origen) as { id: number } | undefined)?.id ?? null

/** Inserta o devuelve la que ya estaba con ese origen. */
function pieza(db: Db, p: Parameters<typeof insertar>[1], ahora: number): { id: number; nueva: boolean } {
  const id = insertar(db, { estado: 'disponible', ...p }, ahora)
  if (id != null) return { id, nueva: true }
  return { id: porOrigen(db, p.origenId!)!, nueva: false }
}

function encolarDestilado(db: Db, lote_: string, piezaId: number, prioridad = 0) {
  db.prepare(`INSERT OR IGNORE INTO takeout_destilado (pieza_id, lote, prioridad, estado) VALUES (?, ?, ?, 'pendiente')`).run(piezaId, lote_, prioridad)
}

type TurnoPaquete = { cuando: number; prompt: string; respuesta: string; adjuntos: { huella: string | null; nombre: string }[] }

function ingerirChat(db: Db, lote_: string, x: { id: string; titulo: string; desde: number; hasta: number; turnos: TurnoPaquete[] }, ahora: number): boolean {
  const cuerpo = x.turnos.map((t) => [
    `## ${hora(t.cuando)}`,
    t.prompt ? `**Yo:** ${t.prompt}` : '',
    t.adjuntos.length ? `[Adjuntos: ${t.adjuntos.map((a) => a.nombre).join(', ')}]` : '',
    t.respuesta ? `**Gemini:** ${t.respuesta}` : '',
  ].filter(Boolean).join('\n\n')).join('\n\n')
  const fecha = diaDe(x.desde)
  const meta = { takeout: lote_, chat: x.id, desde: x.desde, hasta: x.hasta, turnos: x.turnos.length }
  const c = pieza(db, {
    fuente: FUENTES.chats.id, nivel: 'investigacion', titulo: `Gemini · ${x.titulo}`, fecha, etiquetas: ['gemini', 'takeout'],
    contenido: `Conversación con Gemini · ${hora(x.desde)} → ${hora(x.hasta)} · ${x.turnos.length} pedidos\n\n${cuerpo}`, origenId: `takeout:gemini:${x.id}`, meta,
  }, ahora)
  aparicion(db, c.id, { origen: 'gemini', contexto: x.id, titulo: x.titulo, fecha })
  const yo = x.turnos.filter((t) => t.prompt.trim()).map((t) => `[${hora(t.cuando)}] ${t.prompt}`)
  if (yo.length) pieza(db, { fuente: FUENTES.yo.id, nivel: 'propia', titulo: `Lo que le dije a Gemini · ${x.titulo}`, fecha, contenido: yo.join('\n\n'), etiquetas: ['gemini', 'takeout'], origenId: `takeout:gemini-yo:${x.id}`, meta }, ahora)
  if (cuerpo.length > 300) encolarDestilado(db, lote_, c.id, 0)
  return c.nueva
}

function ingerirCuaderno(db: Db, lote_: string, fuente: string, x: any, ahora: number): number {
  const lineas = [
    `Cuaderno de NotebookLM «${x.titulo}»${x.emoji ? ` ${x.emoji}` : ''} · creado ${diaDe(x.creado) ?? '?'} · última vez abierto ${diaDe(x.visto) ?? '?'}`,
    x.fuentes?.length ? `\n## Fuentes (${x.fuentes.length})\n${x.fuentes.map((f: any) => `- ${f.titulo} · ${String(f.tipo ?? '').replace('SOURCE_CONTENT_TYPE_', '').toLowerCase()} · ${diaDe(f.agregada) ?? ''}`).join('\n')}` : '',
    x.artefactos?.length ? `\n## Lo que generó (${x.artefactos.length})\n${x.artefactos.map((a: any) => `- ${a.titulo} · ${String(a.tipo ?? '').replace('ARTIFACT_TYPE_', '').toLowerCase()}`).join('\n')}` : '',
    x.descubiertas?.length ? `\n## Fuentes que sugirió\n${x.descubiertas.map((d: any) => `- [${d.titulo}](${d.url})${d.explicacion ? ` — ${d.explicacion}` : ''}`).join('\n')}` : '',
    x.chats ? `\nChats guardados: ${x.chats}. Notas: ${x.notas ?? 0}.` : '',
  ].filter(Boolean).join('\n')
  const p = pieza(db, {
    fuente, nivel: 'investigacion', titulo: `Contexto · ${x.titulo}`, fecha: diaDe(x.creado), contenido: lineas, etiquetas: ['notebooklm', 'takeout', 'contexto'],
    origenId: `takeout:nlm:${x.carpeta}`, meta: { takeout: lote_, cuaderno: x.carpeta, creado: x.creado, visto: x.visto, ultima: x.ultima },
  }, ahora)
  aparicion(db, p.id, { origen: 'notebooklm', contexto: x.carpeta, titulo: x.titulo, fecha: diaDe(x.creado) })
  encolarDestilado(db, lote_, p.id, -1) // el contexto se destila último: cuando ya están sus audios y sus imágenes
  return p.id
}

function ingerirDeCuaderno(db: Db, lote_: string, c: { fuente: string; titulo: string }, x: any, ahora: number): boolean {
  const carpeta = x.carpeta as string
  let p: { id: number; nueva: boolean } | null = null
  const ap = (fecha: string | null) => p && aparicion(db, p.id, { origen: 'notebooklm', contexto: carpeta, titulo: c.titulo, fecha })
  if (x.t === 'fuente') {
    const texto = String(x.texto ?? '').trim()
    if (texto.length < 20) return false
    const nivel = /AUDIO/.test(x.tipo) ? 'propia' : /GEMINI_CHAT/.test(x.tipo) ? 'investigacion' : 'primaria'
    const tipo = String(x.tipo ?? '').replace('SOURCE_CONTENT_TYPE_', '').toLowerCase()
    p = pieza(db, {
      fuente: c.fuente, nivel, titulo: `${nivel === 'propia' ? 'Nota de voz' : 'Fuente'} · ${x.titulo}`.slice(0, 300), fecha: diaDe(x.agregada), contenido: texto,
      etiquetas: ['notebooklm', 'takeout', tipo], origenId: `takeout:texto:${sha1(texto)}`, meta: { takeout: lote_, cuaderno: carpeta, tipo: x.tipo, agregada: x.agregada, archivo: x.titulo },
    }, ahora)
    ap(diaDe(x.agregada))
    if (nivel === 'propia' && texto.length > 400) encolarDestilado(db, lote_, p.id, 1) // su voz: cada nota se destila sola
  } else if (x.t === 'nota') {
    const texto = String(x.texto ?? '').trim()
    if (!texto) return false
    const generada = /\[\d+(?:\s*[-,–]\s*\d+)*\]/.test(texto)
    p = pieza(db, { fuente: c.fuente, nivel: generada ? 'generada' : 'propia', titulo: `Nota · ${x.titulo}`, fecha: diaDe(x.fecha), contenido: texto, etiquetas: ['notebooklm', 'takeout', 'nota'], origenId: `takeout:texto:${sha1(texto)}`, meta: { takeout: lote_, cuaderno: carpeta } }, ahora)
    ap(diaDe(x.fecha))
  } else if (x.t === 'chat-nlm') {
    const ts = (x.turnos ?? []) as { quien: string; texto: string }[]
    if (!ts.length) return false
    const texto = ts.map((t) => `**${t.quien === 'yo' ? 'Yo' : 'NotebookLM'}:** ${t.texto}`).join('\n\n')
    p = pieza(db, { fuente: c.fuente, nivel: 'investigacion', titulo: `Chat en NotebookLM · ${c.titulo}`, fecha: diaDe(x.fecha), contenido: texto, etiquetas: ['notebooklm', 'takeout', 'chat'], origenId: `takeout:texto:${sha1(texto)}`, meta: { takeout: lote_, cuaderno: carpeta, archivo: x.archivo } }, ahora)
    ap(diaDe(x.fecha))
    const yo = ts.filter((t) => t.quien === 'yo').map((t) => t.texto)
    if (yo.length) pieza(db, { fuente: c.fuente, nivel: 'propia', titulo: `Lo que le pregunté a NotebookLM · ${c.titulo}`, fecha: diaDe(x.fecha), contenido: yo.join('\n\n'), etiquetas: ['notebooklm', 'takeout'], origenId: `takeout:nlm-yo:${sha1(texto)}`, meta: { takeout: lote_, cuaderno: carpeta } }, ahora)
  } else if (x.t === 'artefacto') {
    const texto = String(x.texto ?? '').trim()
    if (texto.length < 40) return false
    const tipo = String(x.tipo ?? '').replace('ARTIFACT_TYPE_', '').toLowerCase()
    p = pieza(db, { fuente: c.fuente, nivel: 'generada', titulo: `${tipo || 'Artefacto'} · ${x.titulo}`, fecha: diaDe(x.fecha), contenido: texto, etiquetas: ['notebooklm', 'takeout', tipo], origenId: `takeout:texto:${sha1(texto)}`, meta: { takeout: lote_, cuaderno: carpeta, tipo: x.tipo, fechaAproximada: true } }, ahora)
    ap(diaDe(x.fecha))
  }
  return !!p?.nueva
}

function anotarMedio(db: Db, lote_: string, x: { huella: string; clase: string; ext: string; nombre: string; apariciones: Aparicion[] }, ahora: number) {
  const ya = db.prepare('SELECT apariciones FROM takeout_medios WHERE huella = ?').get(x.huella) as { apariciones: string } | undefined
  if (!ya) {
    db.prepare(`INSERT INTO takeout_medios (huella, lote, clase, ext, nombre, apariciones, estado, creado_en) VALUES (?, ?, ?, ?, ?, ?, 'esperando', ?)`)
      .run(x.huella, lote_, x.clase, x.ext, x.nombre.slice(0, 200), JSON.stringify(x.apariciones ?? []), ahora)
    return
  }
  const todas = [...json<Aparicion[]>(ya.apariciones, []) ?? [], ...(x.apariciones ?? [])]
  const unicas = [...new Map(todas.map((a) => [`${a.origen}|${a.contexto}|${a.fecha}|${a.titulo}`, a])).values()]
  db.prepare('UPDATE takeout_medios SET apariciones = ?, clase = ?, nombre = ? WHERE huella = ?').run(JSON.stringify(unicas), x.clase, x.nombre.slice(0, 200), x.huella)
}

/** La compu terminó de subir: lo que no llegó se saltea y arranca el trabajo pesado. */
export function cerrarLote(db: Db, lote_: string, ahora = Date.now()) {
  lote(db, lote_, ahora)
  db.prepare(`UPDATE takeout_medios SET estado = 'salteado', error = 'No llegó el archivo' WHERE lote = ? AND estado = 'esperando'`).run(lote_)
  db.prepare('UPDATE takeout_lotes SET subido_en = ? WHERE id = ?').run(ahora, lote_)
  if (!ingiriendo.has(lote_)) marcarLote(db, lote_, 'procesando')
}

// ─── 2. medios ──────────────────────────────────────────────────────────

let transcribir = (db: Db, audio: Buffer, nombre: string) => nanTranscribir(db, audio, nombre)
let ver = async (db: Db, imagen: Buffer, mime: string, sistema: string, texto: string) =>
  (await nanVision({ db, clase: 'mastropiero', agenteId: 'takeout' }, { sistema, texto, imagen: `data:${mime};base64,${imagen.toString('base64')}`, maxTokens: 2500 })).texto
let destilar = async (db: Db, sistema: string, usuario: string) => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'takeout' }, sistema, usuario, { temperatura: 0.2, maxTokens: 6000, largo: true })).datos
export function _probarTakeout(o: { transcribir?: typeof transcribir; ver?: typeof ver; destilar?: typeof destilar }) {
  if (o.transcribir) transcribir = o.transcribir
  if (o.ver) ver = o.ver
  if (o.destilar) destilar = o.destilar
}

/** Whisper aguanta ~25 MB: lo más largo se parte en tramos de 10 minutos con ffmpeg. */
function tramosDe(ruta: string): { partes: string[]; temporal: string | null } {
  if (fs.statSync(ruta).size <= 24 * 1024 * 1024) return { partes: [ruta], temporal: null }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-takeout-'))
  const ext = path.extname(ruta)
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', ruta, '-f', 'segment', '-segment_time', '600', '-c', 'copy', path.join(dir, `t%03d${ext}`)], { encoding: 'utf8' })
  const partes = fs.readdirSync(dir).sort().map((f) => path.join(dir, f))
  if (r.status !== 0 || !partes.length) throw new Error('Audio largo que no pude partir')
  return { partes, temporal: dir }
}

const SISTEMA_IMAGEN = `Describís una imagen del archivo personal del operador (algo que le pasó a Gemini, o una slide o infografía que generó NotebookLM). Que la descripción sirva para encontrarla y entenderla sin verla.
Forma: {"titulo": string (máx. 70), "tipo": "captura" | "foto" | "diagrama" | "slide" | "infografia" | "documento" | "meme" | "otro", "descripcion": string (qué se ve y de qué trata, 2 a 6 frases), "texto_visible": string (el texto que aparece, fiel y en orden; vacío si no hay)}`

/** El texto de un documento: PDF, Word, Excel, PowerPoint, Markdown, texto, CSV, JSON, XML o HTML. */
export function textoDeDocumento(datos: Buffer, ext: string): string {
  if (ext === 'pdf') return textoDePdf(datos)
  if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') {
    const z = zipDeBuffer(datos)
    const xml = (re: RegExp) => z.entradas.filter((e) => re.test(e.nombre)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'en', { numeric: true })).map((e) => z.leer(e).toString('utf8'))
    const limpio = (s: string) => s.replace(/<\/(w:p|a:p|row)>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    if (ext === 'docx') return limpio(xml(/^word\/document\.xml$/).join('\n'))
    if (ext === 'pptx') return xml(/^ppt\/slides\/slide\d+\.xml$/).map((s, i) => `## Slide ${i + 1}\n${limpio(s)}`).join('\n\n')
    const compartidos = xml(/^xl\/sharedStrings\.xml$/).join('').split(/<si>/).slice(1).map((s) => limpio(s).trim())
    const celda = (attrs: string, dentro: string) => {
      const v = /<v>([^<]*)<\/v>/.exec(dentro)?.[1]
      if (/t="s"/.test(attrs)) return compartidos[Number(v)] ?? ''
      if (/t="inlineStr"/.test(attrs)) return limpio(dentro).trim()
      return v ?? ''
    }
    return xml(/^xl\/worksheets\/sheet\d+\.xml$/).map((h, i) => `## Hoja ${i + 1}\n${h.split(/<row[^>]*>/).slice(1).map((fila) => [...fila.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((m) => celda(m[1], m[2] ?? '')).filter(Boolean).join(' | ')).filter((f) => f.trim()).join('\n')}`).join('\n\n')
  }
  const s = datos.toString('utf8')
  if (ext === 'html' || ext === 'htm') return aMarkdown(s)
  return s
}

/** El nivel de un medio: el más cercano a él entre sus apariciones (su voz gana). */
const ORDEN_NIVEL = ['propia', 'primaria', 'investigacion', 'generada']
const nivelDe = (aps: Aparicion[], defecto: string) => aps.map((a) => a.nivel).sort((a, b) => ORDEN_NIVEL.indexOf(a) - ORDEN_NIVEL.indexOf(b))[0] ?? defecto

async function procesarMedio(db: Db, m: any, ahora: number): Promise<number | null> {
  const aps = json<Aparicion[]>(m.apariciones, []) ?? []
  const primera = aps[0]
  const titulo = primera?.rol && primera.rol !== 'adjunto' ? primera.titulo : m.nombre
  const fecha = aps.map((a) => a.fecha).filter(Boolean).sort()[0] ?? null
  let contenido = ''
  let etiqueta: string = m.clase
  if (m.clase === 'audio') {
    const { partes, temporal } = tramosDe(m.ruta)
    try {
      const textos: string[] = []
      for (const p of partes) textos.push((await transcribir(db, fs.readFileSync(p), path.basename(p))).trim())
      contenido = textos.filter(Boolean).join('\n')
    } finally {
      if (temporal) fs.rmSync(temporal, { recursive: true, force: true })
    }
    if (!contenido) throw new Error('No había voz que transcribir')
  } else if (m.clase === 'imagen') {
    const mime = m.ext === 'png' ? 'image/png' : m.ext === 'webp' ? 'image/webp' : 'image/jpeg'
    const contexto = primera ? `${primera.origen === 'gemini' ? `La adjuntó en una charla con Gemini («${primera.titulo}»)` : `La generó NotebookLM en el cuaderno «${primera.contexto}» («${primera.titulo}»)`}${primera.fecha ? `, el ${primera.fecha}` : ''}.` : ''
    const crudo = await ver(db, fs.readFileSync(m.ruta), mime, SISTEMA_IMAGEN, `${contexto} Devolvé solo el JSON.`)
    const d = leerJson<any>(crudo) ?? { descripcion: crudo }
    contenido = [d.descripcion ? String(d.descripcion) : '', d.texto_visible ? `[Texto en la imagen]\n${d.texto_visible}` : ''].filter(Boolean).join('\n\n')
    if (d.tipo) etiqueta = String(d.tipo).slice(0, 20)
    if (!contenido.trim()) throw new Error('La imagen no dio descripción')
    if (d.titulo && (!primera || primera.rol === 'adjunto')) m.tituloVisto = String(d.titulo).slice(0, 80)
  } else {
    contenido = textoDeDocumento(fs.readFileSync(m.ruta), m.ext).replace(/\u0000/g, '').trim().slice(0, 400_000)
    if (contenido.length < 20) throw new Error('El documento no tenía texto que leer')
  }
  const enNlm = aps.find((a) => a.origen === 'notebooklm')
  const fuente = enNlm ? fuenteCuaderno(db, enNlm.contexto, enNlm.contexto) : FUENTES.adjuntos.id
  const nivel = nivelDe(aps, enNlm ? 'generada' : 'primaria')
  const nombreTipo = m.clase === 'audio' ? (enNlm ? 'Audio' : 'Audio adjunto') : m.clase === 'imagen' ? 'Imagen' : 'Documento'
  const donde = aps.length ? `\n\n— ${aps.length === 1 ? 'Apareció' : `Apareció ${aps.length} veces`}: ${aps.slice(0, 8).map((a) => `${a.origen === 'gemini' ? 'Gemini' : 'NotebookLM'} «${a.titulo}»${a.fecha ? ` (${a.fecha})` : ''}`).join('; ')}` : ''
  const p = pieza(db, {
    fuente, nivel, titulo: `${nombreTipo} · ${m.tituloVisto ?? titulo}`.slice(0, 300), fecha, contenido: contenido + donde,
    etiquetas: ['takeout', etiqueta, ...(enNlm ? ['notebooklm'] : ['gemini'])], origenId: `takeout:medio:${m.huella}`,
    meta: { takeout: m.lote, huella: m.huella, archivo: m.nombre, clase: m.clase, apariciones: aps.length },
  }, ahora)
  for (const a of aps) aparicion(db, p.id, { origen: a.origen, contexto: a.contexto, titulo: a.titulo, fecha: a.fecha })
  // Su voz (un audio que le pasó a Gemini) se destila sola; lo demás entra en el destilado de su chat o su cuaderno.
  if (m.clase === 'audio' && nivel === 'propia' && contenido.length > 400) encolarDestilado(db, m.lote, p.id, 1)
  return p.id
}

// ─── 3. destilado ───────────────────────────────────────────────────────

const SISTEMA_DESTILADO = (yo: string) => `Sos Mastropiero y estás leyendo el archivo de un año del jugador (${yo}): sus charlas con Gemini, sus notas de voz y sus cuadernos de NotebookLM. Lo hacés para conocerlo mejor y para que cada proyecto sepa su historia.
Leés UNA unidad que tiene FECHA. Todo lo que extraigas es de ESE momento, no de hoy: un proyecto pudo cambiar mucho desde entonces.
Devolvé:
- "resumen": 2 a 4 frases en pasado, situadas en su fecha: de qué fue y qué pasó.
- "valor": 0 a 3. 0 = operativo o trivial (traducir, formatear, un dato suelto); 1 = útil pero menor; 2 = sustancioso (ideas, decisiones, trabajo en un proyecto); 3 = clave (visión, giros, decisiones grandes).
- "temas": de 2 a 8 temas cortos (2 a 4 palabras, en minúscula). Usá siempre el mismo nombre para el mismo tema.
- "proyectos": [{"nombre": string, "estado_entonces": cómo estaba ese proyecto en ESA fecha (1 o 2 frases), "ideas": [ideas concretas para ese proyecto]}]. Solo proyectos (obras, productos, empresas, iniciativas), no temas.
- "personas": [{"nombre": string, "rol": qué papel tienen acá}]. Personas reales con nombre; no incluyas al jugador ni a la IA.
- "ideas": [{"texto": una idea atómica que se entienda sola, "proyecto": nombre o null}] (hasta 6, solo si valor >= 2).
- "decisiones": [frases cortas] · "abierto": [lo que quedó sin resolver].
- "sobre_el": [hechos sobre el jugador que valen como recuerdo duradero: qué quiere, cómo trabaja, qué le importa] (hasta 4; nada que dependa del momento).
Reglas: cuando hablen de una persona o un proyecto del catálogo, usá su NOMBRE EXACTO del catálogo (también si aparece con un alias o mal escrito). Lo que no esté en el catálogo, con el nombre tal como aparece. No inventes nada que no esté en el texto.
Forma: {"resumen": string, "valor": number, "temas": [string], "proyectos": [...], "personas": [...], "ideas": [...], "decisiones": [string], "abierto": [string], "sobre_el": [string]}`

type Destilado = { resumen: string; valor: number; temas: string[]; proyectos: { nombre: string; estado_entonces: string; ideas: string[] }[]; personas: { nombre: string; rol: string }[]; ideas: { texto: string; proyecto: string | null }[]; decisiones: string[]; abierto: string[]; sobre_el: string[] }

const lista = (v: unknown) => (Array.isArray(v) ? v : [])
const txt = (v: unknown, max = 600) => String(v ?? '').trim().slice(0, max)

/** Junta los destilados de los tramos de una unidad larga. */
export function juntarDestilados(ds: any[]): Destilado {
  const unicos = <T>(xs: T[], k: (x: T) => string) => [...new Map(xs.filter((x) => k(x)).map((x) => [k(x), x])).values()]
  const proyectos = new Map<string, { nombre: string; estado_entonces: string; ideas: string[] }>()
  for (const d of ds) for (const p of lista(d?.proyectos)) {
    const nombre = txt(p?.nombre, 80)
    if (!nombre) continue
    const ya = proyectos.get(claveDe(nombre)) ?? { nombre, estado_entonces: '', ideas: [] }
    ya.estado_entonces = txt(p?.estado_entonces) || ya.estado_entonces
    ya.ideas = [...new Set([...ya.ideas, ...lista(p?.ideas).map((i) => txt(i, 300)).filter(Boolean)])].slice(0, 8)
    proyectos.set(claveDe(nombre), ya)
  }
  return {
    resumen: ds.map((d) => txt(d?.resumen, 1200)).filter(Boolean).join(' '),
    valor: Math.max(0, ...ds.map((d) => Math.min(3, Math.max(0, Number(d?.valor) || 0)))),
    temas: unicos(ds.flatMap((d) => lista(d?.temas).map((t) => txt(t, 50).toLowerCase())), claveDe).slice(0, 10),
    proyectos: [...proyectos.values()],
    personas: unicos(ds.flatMap((d) => lista(d?.personas).map((p) => ({ nombre: txt(p?.nombre, 80), rol: txt(p?.rol, 200) }))), (p) => claveDe(p.nombre)),
    ideas: unicos(ds.flatMap((d) => lista(d?.ideas).map((i) => ({ texto: txt(i?.texto ?? i, 400), proyecto: i?.proyecto ? txt(i.proyecto, 80) : null }))), (i) => claveDe(i.texto)).slice(0, 8),
    decisiones: unicos(ds.flatMap((d) => lista(d?.decisiones).map((x) => txt(x, 300))), claveDe).slice(0, 8),
    abierto: unicos(ds.flatMap((d) => lista(d?.abierto).map((x) => txt(x, 300))), claveDe).slice(0, 8),
    sobre_el: unicos(ds.flatMap((d) => lista(d?.sobre_el).map((x) => txt(x, 300))), claveDe).slice(0, 4),
  }
}

/** El catálogo de entidades para el modelo y para enlazar: nombre o alias normalizado → entidad. */
function catalogo(db: Db): { texto: string; buscar: (nombre: string) => { id: number; tipo: string } | null } {
  const filas = db.prepare(`SELECT id, tipo, nombre, alias FROM entidades WHERE tipo IN ('persona', 'proyecto', 'agrupacion', 'lugar') ORDER BY tipo, nombre`).all() as { id: number; tipo: string; nombre: string; alias: string | null }[]
  const mapa = new Map<string, { id: number; tipo: string }>()
  for (const f of filas) for (const n of [f.nombre, ...(json<string[]>(f.alias, []) ?? [])]) if (claveDe(n)) mapa.set(claveDe(n), { id: f.id, tipo: f.tipo })
  const yo = (db.prepare(`SELECT id FROM entidades WHERE json_extract(meta, '$.operador') = 1`).all() as { id: number }[]).map((r) => r.id)
  const texto = ['persona', 'proyecto', 'agrupacion', 'lugar'].map((t) => {
    const xs = filas.filter((f) => f.tipo === t && !yo.includes(f.id))
    return xs.length ? `${t}: ${xs.map((f) => `${f.nombre}${f.alias ? ` (${json<string[]>(f.alias, [])!.slice(0, 3).join(', ')})` : ''}`).join('; ')}` : ''
  }).filter(Boolean).join('\n')
  return { texto: texto.slice(0, 24_000), buscar: (n) => mapa.get(claveDe(n)) ?? null }
}

/** El texto a destilar de una unidad: la pieza y, si es un chat o un cuaderno, lo que vino con ella (adjuntos, fuentes, artefactos). */
function textoDeUnidad(db: Db, p: { id: number; titulo: string; contenido: string; fuente: string; meta: any }): string {
  const meta = p.meta ?? {}
  if (meta.chat) {
    const adj = db.prepare(`SELECT c.titulo, c.contenido FROM takeout_apariciones a JOIN corpus c ON c.id = a.pieza_id WHERE a.origen = 'gemini' AND a.contexto = ? AND c.id != ? AND c.origen_id LIKE 'takeout:medio:%'`).all(meta.chat, p.id) as { titulo: string; contenido: string }[]
    return [p.contenido, ...adj.map((a) => `\n### ${a.titulo}\n${a.contenido.slice(0, 3000)}`)].join('\n')
  }
  if (meta.cuaderno && p.titulo.startsWith('Contexto · ')) {
    const de = db.prepare(`SELECT c.titulo, c.contenido, c.nivel, c.fecha FROM corpus c WHERE c.id != ? AND (c.fuente = ? OR c.id IN (SELECT pieza_id FROM takeout_apariciones WHERE origen = 'notebooklm' AND contexto = ?)) ORDER BY c.fecha, c.id`).all(p.id, p.fuente, meta.cuaderno) as { titulo: string; contenido: string; nivel: string; fecha: string | null }[]
    const tope = (n: string, t: string) => (/^(Chat|Nota ·|Lo que le pregunté)/.test(t) ? 30_000 : n === 'propia' ? 6000 : n === 'generada' ? 5000 : 3500)
    return [p.contenido, ...de.map((x) => `\n### [${x.nivel}${x.fecha ? ` · ${x.fecha}` : ''}] ${x.titulo}\n${x.contenido.slice(0, tope(x.nivel, x.titulo))}`)].join('\n')
  }
  return p.contenido
}

/** Corta un texto largo en tramos (por párrafos) de hasta «max» caracteres. */
export function tramosDeTexto(texto: string, max = 80_000): string[] {
  if (texto.length <= max) return [texto]
  const out: string[] = []
  let actual = ''
  for (const parte of texto.split(/\n(?=## |### )|\n\n/)) {
    if (actual.length + parte.length + 2 > max && actual) { out.push(actual); actual = '' }
    if (parte.length > max) for (let i = 0; i < parte.length; i += max) out.push(parte.slice(i, i + max))
    else actual += (actual ? '\n\n' : '') + parte
  }
  if (actual) out.push(actual)
  return out
}

async function destilarUnidad(db: Db, fila: { pieza_id: number; lote: string }, ahora: number) {
  const r = db.prepare('SELECT id, titulo, contenido, fuente, nivel, fecha, meta, entidades FROM corpus WHERE id = ?').get(fila.pieza_id) as any
  if (!r) return
  const p = { ...r, meta: json<any>(r.meta, {}) }
  const cat = catalogo(db)
  const yo = personaje(db, 'jugador').nombre
  const origen = p.meta?.chat ? 'una conversación con Gemini' : p.titulo.startsWith('Contexto · ') ? 'el contexto entero de un cuaderno de NotebookLM (sus fuentes, notas, chats y lo que generó)' : p.nivel === 'propia' ? 'una nota de voz suya (transcripta)' : 'una pieza de su archivo'
  const tramos = tramosDeTexto(textoDeUnidad(db, p))
  const salidas: any[] = []
  for (const [i, t] of tramos.entries()) {
    salidas.push(await destilar(db, SISTEMA_DESTILADO(yo), `Unidad: ${origen} · «${p.titulo}» · fecha ${p.fecha ?? 'sin fecha'}${tramos.length > 1 ? ` · tramo ${i + 1} de ${tramos.length}` : ''}\n\nCatálogo de entidades que ya conoce:\n${cat.texto || '(vacío)'}\n\nTexto:\n${t}`))
  }
  const d = juntarDestilados(salidas)
  guardarDestilado(db, fila, p, d, cat, ahora)
}

function guardarDestilado(db: Db, fila: { pieza_id: number; lote: string }, p: any, d: Destilado, cat: ReturnType<typeof catalogo>, ahora: number) {
  // Entidades: las que ya existen se enlazan; las nuevas (personas y proyectos) esperan su ok.
  const ids = new Set<number>(json<number[]>(p.entidades, []) ?? [])
  const nuevo = (nombre: string, tipo: 'persona' | 'proyecto', nota: string) => {
    const k = claveDe(nombre)
    if (!k || k.length < 2) return
    const ya = db.prepare('SELECT piezas, primera, ultima, estado, entidad_id FROM takeout_nombres WHERE clave = ?').get(k) as any
    if (ya?.estado === 'aceptada' && ya.entidad_id) { ids.add(ya.entidad_id); return }
    if (ya?.estado === 'descartada') return
    const piezas = [...new Set([...(json<number[]>(ya?.piezas, []) ?? []), p.id])].slice(-400)
    const fechas = [ya?.primera, ya?.ultima, p.fecha].filter(Boolean).sort()
    if (ya) db.prepare('UPDATE takeout_nombres SET veces = veces + 1, piezas = ?, primera = ?, ultima = ?, nota = COALESCE(nota, ?) WHERE clave = ?').run(JSON.stringify(piezas), fechas[0] ?? null, fechas.at(-1) ?? null, nota || null, k)
    else db.prepare(`INSERT INTO takeout_nombres (clave, nombre, tipo, veces, piezas, primera, ultima, nota, estado, creada_en) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'propuesta', ?)`).run(k, nombre, tipo, JSON.stringify(piezas), p.fecha ?? null, p.fecha ?? null, nota || null, ahora)
  }
  for (const x of d.personas) { const e = cat.buscar(x.nombre); if (e) ids.add(e.id); else nuevo(x.nombre, 'persona', x.rol) }
  for (const x of d.proyectos) { const e = cat.buscar(x.nombre); if (e) ids.add(e.id); else nuevo(x.nombre, 'proyecto', x.estado_entonces) }
  const entidades = [...ids]
  if (entidades.length) db.prepare('UPDATE corpus SET entidades = ? WHERE id = ?').run(JSON.stringify(entidades), p.id)

  // La pieza del destilado: buscable, con su fecha y sus entidades.
  const cuerpo = [
    `**${p.fecha ?? 'Sin fecha'}** · ${p.titulo}`,
    d.resumen,
    d.proyectos.length ? `### Proyectos (cómo estaban entonces)\n${d.proyectos.map((x) => `- **${x.nombre}**: ${x.estado_entonces}${x.ideas.length ? `\n  Ideas: ${x.ideas.join(' · ')}` : ''}`).join('\n')}` : '',
    d.ideas.length ? `### Ideas\n${d.ideas.map((x) => `- ${x.texto}${x.proyecto ? ` (${x.proyecto})` : ''}`).join('\n')}` : '',
    d.decisiones.length ? `### Decisiones\n${d.decisiones.map((x) => `- ${x}`).join('\n')}` : '',
    d.abierto.length ? `### Quedó abierto\n${d.abierto.map((x) => `- ${x}`).join('\n')}` : '',
    d.personas.length ? `### Personas\n${d.personas.map((x) => `- ${x.nombre}${x.rol ? `: ${x.rol}` : ''}`).join('\n')}` : '',
    d.temas.length ? `Temas: ${d.temas.join(' · ')}` : '',
  ].filter(Boolean).join('\n\n')
  asegurarFuente(db, FUENTES.destilado)
  const dest = pieza(db, {
    fuente: FUENTES.destilado.id, nivel: 'investigacion', titulo: `Destilado · ${p.titulo.replace(/^(Gemini|Contexto|Nota de voz|Audio adjunto) · /, '')}`.slice(0, 300), fecha: p.fecha,
    contenido: cuerpo, etiquetas: ['takeout', 'destilado', ...d.temas.slice(0, 6)], entidades, origenId: `takeout:destilado:${p.id}`,
    meta: { takeout: fila.lote, de: p.id, valor: d.valor },
  }, ahora)
  if (!dest.nueva && entidades.length) db.prepare('UPDATE corpus SET entidades = ? WHERE id = ?').run(JSON.stringify(entidades), dest.id)

  // El pulso: cada tema, con la fecha en que apareció.
  const pulso = db.prepare('INSERT OR IGNORE INTO temas_pulso (clave, tema, fecha, pieza_id, origen) VALUES (?, ?, ?, ?, ?)')
  for (const t of d.temas) pulso.run(claveDe(t), t, p.fecha ?? null, p.id, p.meta?.chat ? 'gemini' : 'notebooklm')

  // Ideas → quántomos proto (él los pesa); lo que dice de él → recuerdos sin revisar. Solo de lo que vale.
  if (d.valor >= 2) d.ideas.slice(0, 4).forEach((x, i) => {
    crearQuantomo(db, {
      texto: x.texto, titulo: `Idea de archivo${x.proyecto ? ` · ${x.proyecto}` : ''} · ${p.fecha ?? ''}`.trim(), piezaId: dest.id, universo: 'archivo',
      procedencia: `${p.titulo} · ${p.fecha ?? 'sin fecha'}`.slice(0, 300), origenId: `takeout:idea:${p.id}:${i}`,
    }, ahora)
  })
  if (d.valor >= 1) for (const s of d.sobre_el.slice(0, 3)) {
    try { recordar(db, { texto: s, tipo: 'hecho', creadaPor: 'takeout', revisada: false, piezaId: dest.id, fecha: p.fecha ?? fechaLocal(ahora) }, ahora) } catch { /* vacío */ }
  }
  db.prepare(`UPDATE takeout_destilado SET estado = 'hecho', salida = ?, error = NULL, hecho_en = ? WHERE pieza_id = ?`).run(JSON.stringify({ ...d, fecha: p.fecha, titulo: p.titulo }), ahora, p.id)
}

// ─── 4. historia de cada proyecto ───────────────────────────────────────

const SISTEMA_HISTORIA = (yo: string) => `Sos Mastropiero. Tenés, en orden de fecha, todo lo que el archivo de un año dice de un proyecto de ${yo} (de sus charlas con Gemini, sus notas de voz y sus cuadernos de NotebookLM), y lo poco que se sabe de HOY (material reciente, notas de la entidad, recuerdos).
Un proyecto cambia: lo viejo NO es el estado actual. Armá su historia:
- "eras": las etapas por las que pasó, en orden: [{"desde": "YYYY-MM", "hasta": "YYYY-MM", "nombre": corto, "como_era": 2 o 3 frases}].
- "hoy": lo que se sabe del estado actual SOLO por el material reciente o las notas (o null si no hay nada reciente; no lo deduzcas del archivo).
- "cambios": qué cambió entre las eras viejas y lo de hoy (o null).
- "ideas_para_revisar": ideas viejas que podrían servir HOY: [{"idea": la idea, "de_cuando": "YYYY-MM", "por_que_hoy": por qué valdría mirarla con el estado actual}] (hasta 5, solo si de verdad aportan).
- "pregunta": una pregunta para él, concreta, para que diga en qué estado está hoy el proyecto y a dónde quiere llevarlo (eso lo fija él).
Forma: {"eras": [...], "hoy": string | null, "cambios": string | null, "ideas_para_revisar": [...], "pregunta": string}`

let historiar = async (db: Db, sistema: string, usuario: string) => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'takeout' }, sistema, usuario, { temperatura: 0.3, maxTokens: 6000, largo: true })).datos
export function _probarHistoria(f: typeof historiar) {
  historiar = f
}

/** Los proyectos con historia en el archivo: los que ya son entidades y los propuestos que aparecen 3 veces o más. */
type Mencion = { fecha: string | null; titulo: string; estado: string; ideas: string[]; decisiones: string[]; pieza: number }
function proyectosConHistoria(db: Db, lote_: string) {
  const salidas = (db.prepare(`SELECT pieza_id, salida FROM takeout_destilado WHERE lote = ? AND estado = 'hecho' AND salida IS NOT NULL`).all(lote_) as { pieza_id: number; salida: string }[])
    .map((s) => ({ pieza: s.pieza_id, d: json<any>(s.salida, null) })).filter((s) => s.d)
  const cat = catalogo(db)
  const porProyecto = new Map<string, { nombre: string; entidad: number | null; menciones: Mencion[] }>()
  for (const s of salidas) for (const p of lista(s.d.proyectos)) {
    const e = cat.buscar(p.nombre)
    const aceptado = e ? null : (db.prepare(`SELECT entidad_id FROM takeout_nombres WHERE clave = ? AND estado != 'descartada'`).get(claveDe(p.nombre)) as { entidad_id: number | null } | undefined)
    const clave = e ? `e:${e.id}` : aceptado ? (aceptado.entidad_id ? `e:${aceptado.entidad_id}` : `n:${claveDe(p.nombre)}`) : null
    if (!clave) continue
    const x = porProyecto.get(clave) ?? { nombre: String(p.nombre), entidad: e?.id ?? aceptado?.entidad_id ?? null, menciones: [] as Mencion[] }
    x.menciones.push({ fecha: s.d.fecha ?? null, titulo: s.d.titulo ?? '', estado: txt(p.estado_entonces), ideas: lista(p.ideas).map((i) => txt(i, 300)), decisiones: lista(s.d.decisiones).map((i) => txt(i, 200)).slice(0, 3), pieza: s.pieza })
    porProyecto.set(clave, x)
  }
  return [...porProyecto.values()].filter((x) => x.entidad || x.menciones.length >= 3).sort((a, b) => b.menciones.length - a.menciones.length)
}

async function historiaDe(db: Db, lote_: string, x: ReturnType<typeof proyectosConHistoria>[number], preguntar: boolean, ahora: number) {
  const yo = personaje(db, 'jugador').nombre
  const ms = x.menciones.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
  let archivo = ms.map((m) => `- ${m.fecha ?? 's/f'} · ${m.titulo}: ${m.estado}${m.ideas.length ? ` | ideas: ${m.ideas.join('; ')}` : ''}${m.decisiones.length ? ` | decidió: ${m.decisiones.join('; ')}` : ''}`).join('\n')
  if (archivo.length > 120_000) archivo = `${archivo.slice(0, 60_000)}\n…\n${archivo.slice(-60_000)}`
  const ent = x.entidad ? (db.prepare('SELECT nombre, notas FROM entidades WHERE id = ?').get(x.entidad) as { nombre: string; notas: string | null } | undefined) : undefined
  const hace = ahora - 60 * 86_400_000
  const recientes = x.entidad ? (db.prepare(`SELECT titulo, contenido, fecha FROM corpus WHERE creado_en >= ? AND entidades IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(corpus.entidades) j WHERE j.value = ?) AND (origen_id IS NULL OR origen_id NOT LIKE 'takeout:%') ORDER BY creado_en DESC LIMIT 10`).all(hace, x.entidad) as { titulo: string; contenido: string; fecha: string | null }[]) : []
  const recuerdos = memoriaParaPrompt(db, 80).split('\n').filter((l) => claveDe(l).includes(claveDe(x.nombre))).slice(0, 12).join('\n')
  const hoy = [ent?.notas ? `Notas de la entidad: ${ent.notas}` : '', recientes.length ? `Material de los últimos 60 días:\n${recientes.map((r) => `- ${r.fecha ?? ''} ${r.titulo}: ${r.contenido.slice(0, 500)}`).join('\n')}` : '', recuerdos ? `Recuerdos:\n${recuerdos}` : ''].filter(Boolean).join('\n\n') || '(no hay nada reciente sobre este proyecto)'
  const d = await historiar(db, SISTEMA_HISTORIA(yo), `Proyecto: ${ent?.nombre ?? x.nombre}${x.entidad ? '' : ' (todavía no es una entidad: lo propuso el archivo)'} · ${ms.length} menciones en el archivo · hoy es ${fechaLocal(ahora)}\n\nLo que dice el archivo, en orden:\n${archivo}\n\nLo que se sabe de hoy:\n${hoy}`)
  const eras = lista(d?.eras).map((e) => `- **${txt(e?.nombre, 80)}** (${txt(e?.desde, 10)} → ${txt(e?.hasta, 10)}): ${txt(e?.como_era)}`).join('\n')
  const ideas = lista(d?.ideas_para_revisar).slice(0, 5)
  const contenido = [
    `# ${ent?.nombre ?? x.nombre}: su historia en el archivo`,
    `${ms.length} menciones entre ${ms[0]?.fecha ?? '?'} y ${ms.at(-1)?.fecha ?? '?'}.`,
    eras ? `## Eras\n${eras}` : '',
    `## Hoy\n${txt(d?.hoy, 1500) || 'No hay material reciente: falta que digas en qué estado está.'}`,
    d?.cambios ? `## Qué cambió\n${txt(d.cambios, 1500)}` : '',
    ideas.length ? `## Ideas viejas que valdría mirar hoy\n${ideas.map((i) => `- ${txt(i?.idea, 400)} (${txt(i?.de_cuando, 10)}): ${txt(i?.por_que_hoy, 400)}`).join('\n')}` : '',
    d?.pregunta ? `## Para vos\n${txt(d.pregunta, 300)}` : '',
  ].filter(Boolean).join('\n\n')
  asegurarFuente(db, FUENTES.historia)
  const p = pieza(db, {
    fuente: FUENTES.historia.id, nivel: 'investigacion', titulo: `Historia de ${ent?.nombre ?? x.nombre}`, fecha: fechaLocal(ahora), contenido,
    etiquetas: ['takeout', 'historia', 'proyecto'], entidades: x.entidad ? [x.entidad] : undefined, origenId: `takeout:historia:${lote_}:${x.entidad ?? claveDe(x.nombre)}`,
    meta: { takeout: lote_, menciones: ms.length, propuesto: !x.entidad },
  }, ahora)
  ideas.forEach((i, k) => {
    const t = txt(i?.idea, 400)
    if (t) crearQuantomo(db, { texto: t, titulo: `¿Sirve hoy? · ${ent?.nombre ?? x.nombre} · ${txt(i?.de_cuando, 10)}`, piezaId: p.id, universo: 'archivo', procedencia: `Historia de ${ent?.nombre ?? x.nombre}: ${txt(i?.por_que_hoy, 200)}`, origenId: `takeout:revisar:${lote_}:${x.entidad ?? claveDe(x.nombre)}:${k}` }, ahora)
  })
  if (preguntar && d?.pregunta) encolarPregunta(db, { texto: txt(d.pregunta, 300), porQue: `Para que ${ent?.nombre ?? x.nombre} sepa en qué estado está hoy y a dónde va (lo viejo del archivo no lo dice).`, tema: ent?.nombre ?? x.nombre, origen: 'takeout' }, ahora)
}

/** El mapa del año: los temas que más volvieron, mes a mes (sin modelo). */
function mapaDelAno(db: Db, lote_: string, ahora: number) {
  const filas = db.prepare(`SELECT clave, MIN(tema) AS tema, COUNT(*) AS veces, MIN(fecha) AS primera, MAX(fecha) AS ultima, GROUP_CONCAT(substr(fecha, 1, 7)) AS meses FROM temas_pulso GROUP BY clave HAVING veces >= 2 ORDER BY veces DESC LIMIT 60`).all() as { tema: string; veces: number; primera: string | null; ultima: string | null; meses: string | null }[]
  if (!filas.length) return
  const linea = (f: (typeof filas)[number]) => {
    const porMes = new Map<string, number>()
    for (const m of String(f.meses ?? '').split(',').filter(Boolean)) porMes.set(m, (porMes.get(m) ?? 0) + 1)
    return `- **${f.tema}** · ${f.veces} veces · ${f.primera ?? '?'} → ${f.ultima ?? '?'} · ${[...porMes].sort().map(([m, n]) => `${m}: ${n}`).join(', ')}`
  }
  asegurarFuente(db, FUENTES.historia)
  pieza(db, {
    fuente: FUENTES.historia.id, nivel: 'investigacion', titulo: 'Mapa del año · los temas que más volvieron', fecha: fechaLocal(ahora),
    contenido: `Los temas que más tocaste en Gemini y NotebookLM, cuántas veces y en qué meses.\n\n${filas.map(linea).join('\n')}`,
    etiquetas: ['takeout', 'mapa', 'pulso'], origenId: `takeout:mapa:${lote_}`, meta: { takeout: lote_ },
  }, ahora)
}

// ─── el obrero ──────────────────────────────────────────────────────────

let trabajando = false
let enHistoria = false
const CARRILES = 3

/** Toma lo próximo que haya (medios primero; después el destilado; al final la historia). false si no hay nada. */
async function unPaso(db: Db): Promise<boolean> {
  const ahora = Date.now()
  const medio = db.prepare(`SELECT * FROM takeout_medios WHERE estado = 'pendiente' ORDER BY clase = 'audio' DESC, creado_en LIMIT 1`).get() as any
  if (medio) {
    db.prepare(`UPDATE takeout_medios SET estado = 'procesando', intentos = intentos + 1 WHERE huella = ?`).run(medio.huella)
    try {
      const id = await procesarMedio(db, medio, ahora)
      db.prepare(`UPDATE takeout_medios SET estado = 'hecho', pieza_id = ?, error = NULL, hecho_en = ? WHERE huella = ?`).run(id, Date.now(), medio.huella)
      sumarResumen(db, medio.lote, { [`medios_${medio.clase}`]: 1 })
      if (medio.ruta) fs.rmSync(medio.ruta, { force: true })
    } catch (e) {
      const final = medio.intentos + 1 >= 3
      db.prepare(`UPDATE takeout_medios SET estado = ?, error = ? WHERE huella = ?`).run(final ? 'fallo' : 'pendiente', e instanceof Error ? e.message.slice(0, 500) : String(e), medio.huella)
      if (final && medio.ruta) fs.rmSync(medio.ruta, { force: true }) // no queda el archivo aunque falle
    }
    return true
  }
  // El destilado espera a que el lote esté subido y sin medios por procesar (así cada chat y cada cuaderno se lee con sus adjuntos).
  const lote_ = db.prepare(`SELECT l.id FROM takeout_lotes l WHERE l.estado = 'procesando' AND NOT EXISTS (SELECT 1 FROM takeout_medios m WHERE m.lote = l.id AND m.estado IN ('esperando', 'pendiente', 'procesando')) ORDER BY l.creado_en LIMIT 1`).get() as { id: string } | undefined
  if (!lote_) return false
  const fila = db.prepare(`SELECT d.pieza_id, d.lote, d.intentos FROM takeout_destilado d LEFT JOIN corpus c ON c.id = d.pieza_id WHERE d.lote = ? AND d.estado = 'pendiente' ORDER BY d.prioridad DESC, c.fecha DESC LIMIT 1`).get(lote_.id) as { pieza_id: number; lote: string; intentos: number } | undefined
  if (fila) {
    db.prepare(`UPDATE takeout_destilado SET estado = 'procesando', intentos = intentos + 1 WHERE pieza_id = ?`).run(fila.pieza_id)
    try {
      await destilarUnidad(db, fila, ahora)
      sumarResumen(db, fila.lote, { destilados: 1 })
    } catch (e) {
      db.prepare(`UPDATE takeout_destilado SET estado = ?, error = ? WHERE pieza_id = ?`).run(fila.intentos + 1 >= 3 ? 'fallo' : 'pendiente', e instanceof Error ? e.message.slice(0, 500) : String(e), fila.pieza_id)
    }
    return true
  }
  if (db.prepare(`SELECT 1 FROM takeout_destilado WHERE lote = ? AND estado = 'procesando'`).get(lote_.id)) return false // los otros carriles terminan lo suyo
  if (enHistoria) return false
  enHistoria = true
  try {
    marcarLote(db, lote_.id, 'historia')
    const proyectos = proyectosConHistoria(db, lote_.id)
    for (const [i, x] of proyectos.entries()) {
      try { await historiaDe(db, lote_.id, x, i < 12, Date.now()) } catch (e) { console.error('  takeout historia:', e instanceof Error ? e.message : e) }
    }
    mapaDelAno(db, lote_.id, Date.now())
    sumarResumen(db, lote_.id, { historias: proyectos.length })
    db.prepare(`UPDATE takeout_lotes SET estado = 'terminado', terminado_en = ? WHERE id = ?`).run(Date.now(), lote_.id)
  } finally {
    enHistoria = false
  }
  return true
}

/** Trabaja hasta vaciar todo, en varios carriles. Se puede llamar cuantas veces se quiera: si ya anda, no hace nada. */
export async function trabajarTakeout(db: Db): Promise<void> {
  if (trabajando) return
  trabajando = true
  try {
    // Una vuelta en varios carriles; si alguno hizo algo, puede haber destrabado más (el destilado espera a los medios).
    for (;;) {
      const pasos = await Promise.all(Array.from({ length: CARRILES }, async () => {
        let n = 0
        while (await unPaso(db).catch((e) => { console.error('  takeout:', e instanceof Error ? e.message : e); return false })) n++
        return n
      }))
      if (!pasos.some(Boolean)) break
    }
  } finally {
    trabajando = false
  }
}

/** Si el servidor se cortó con algo a medias, vuelve a la cola; un paquete que quedó sin leer, se lee. */
export function retomarTakeout(db: Db) {
  db.prepare(`UPDATE takeout_medios SET estado = 'pendiente' WHERE estado = 'procesando'`).run()
  db.prepare(`UPDATE takeout_destilado SET estado = 'pendiente' WHERE estado = 'procesando'`).run()
  db.prepare(`UPDATE takeout_lotes SET estado = 'procesando' WHERE estado = 'historia'`).run()
  const sinLeer = (db.prepare(`SELECT id, subido_en FROM takeout_lotes WHERE estado IN ('ingiriendo', 'subiendo', 'error')`).all() as { id: string; subido_en: number | null }[])
    .filter((l) => fs.existsSync(rutaPaquete(l.id)) && fs.statSync(rutaPaquete(l.id)).size > 0 && db.prepare(`SELECT 1 FROM takeout_lotes WHERE id = ? AND resumen LIKE '%paquete_listo%'`).get(l.id))
  return sinLeer.map((l) => l.id)
}

/** El paquete terminó de subir: se marca y se lee de fondo. */
export function paqueteListo(db: Db, lote_: string, total: number) {
  const ruta = rutaPaquete(lote_)
  if (!fs.existsSync(ruta)) throw new Error('No llegó el paquete')
  if (total && fs.statSync(ruta).size !== total) throw new Error(`Llegaron ${fs.statSync(ruta).size} de ${total} bytes del paquete: volvé a subirlo`)
  lote(db, lote_)
  sumarResumen(db, lote_, { paquete_listo: 1 })
}

// ─── lo que ve la pantalla ──────────────────────────────────────────────

export function estadoTakeout(db: Db) {
  const lotes = (db.prepare('SELECT * FROM takeout_lotes ORDER BY creado_en DESC LIMIT 5').all() as any[]).map((l) => ({ ...l, resumen: json(l.resumen, {}) }))
  const medios = db.prepare(`SELECT clase, estado, COUNT(*) AS n FROM takeout_medios GROUP BY clase, estado`).all()
  const destilado = db.prepare(`SELECT estado, COUNT(*) AS n FROM takeout_destilado GROUP BY estado`).all()
  const errores = db.prepare(`SELECT 'medio' AS que, nombre AS titulo, error FROM takeout_medios WHERE estado = 'fallo' UNION ALL SELECT 'destilado', CAST(pieza_id AS TEXT), error FROM takeout_destilado WHERE estado = 'fallo' LIMIT 20`).all()
  const nombres = db.prepare(`SELECT clave, nombre, tipo, veces, primera, ultima, nota FROM takeout_nombres WHERE estado = 'propuesta' ORDER BY veces DESC, nombre LIMIT 60`).all()
  const temas = db.prepare(`SELECT MIN(tema) AS tema, COUNT(*) AS veces, MIN(fecha) AS primera, MAX(fecha) AS ultima FROM temas_pulso GROUP BY clave ORDER BY veces DESC LIMIT 25`).all()
  const disco = (() => { try { return fs.readdirSync(path.join(dirTakeout(), 'medios')).length } catch { return 0 } })()
  return { lotes, medios, destilado, errores, nombres, temas, archivosEnEspera: disco, trabajando }
}

/** Una persona o un proyecto que propuso el archivo: se acepta (nueva entidad o fusionada con una que existe) o se descarta. */
export function resolverNombre(db: Db, clave: string, accion: 'aceptar' | 'descartar', o: { entidadId?: number | null; tipo?: string } = {}, ahora = Date.now()) {
  const n = db.prepare('SELECT * FROM takeout_nombres WHERE clave = ?').get(clave) as any
  if (!n) throw new Error('No conozco ese nombre')
  if (accion === 'descartar') {
    db.prepare(`UPDATE takeout_nombres SET estado = 'descartada' WHERE clave = ?`).run(clave)
    return { ok: true }
  }
  let id = o.entidadId ?? null
  if (id) editarEntidad(db, id, { sumarAlias: [n.nombre] })
  else id = asegurarEntidad(db, { tipo: (o.tipo === 'proyecto' || o.tipo === 'persona' ? o.tipo : n.tipo), nombre: n.nombre, notas: n.nota ?? null }, ahora)
  const upd = db.prepare('UPDATE corpus SET entidades = ? WHERE id = ?')
  for (const pid of json<number[]>(n.piezas, []) ?? []) {
    for (const p of [pid, porOrigen(db, `takeout:destilado:${pid}`)].filter(Boolean) as number[]) {
      const actual = json<number[]>((db.prepare('SELECT entidades FROM corpus WHERE id = ?').get(p) as any)?.entidades, []) ?? []
      if (!actual.includes(id)) upd.run(JSON.stringify([...actual, id]), p)
    }
  }
  db.prepare(`UPDATE takeout_nombres SET estado = 'aceptada', entidad_id = ? WHERE clave = ?`).run(id, clave)
  return { ok: true, entidadId: id }
}

/** Lo que falló vuelve a la cola. */
export function reintentarTakeout(db: Db) {
  const d = db.prepare(`UPDATE takeout_destilado SET estado = 'pendiente', intentos = 0 WHERE estado = 'fallo'`).run().changes
  db.prepare(`UPDATE takeout_lotes SET estado = 'procesando' WHERE estado = 'terminado' AND ? > 0`).run(d)
  return { destilados: d }
}
