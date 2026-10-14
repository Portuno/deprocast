/**
 * Leer un Google Takeout (sin modelo, sin tokens): la actividad de Gemini y los cuadernos de NotebookLM pasan a datos
 * con fecha. Lo que hay que escuchar, ver o pensar (audios, imágenes, el destilado) lo hace Deprocast en la nube.
 *
 * - Gemini («Mi actividad → Gemini Apps → MyActivity.html»): cada celda es un pedido con su respuesta, su fecha y el
 *   link a su chat. Con el link se rearman las conversaciones tal cual eran. Los adjuntos son archivos de la carpeta.
 * - NotebookLM: una carpeta por cuaderno con sus fuentes (el texto ya extraído por NotebookLM, con la fecha en que se
 *   agregó), notas, chats y artefactos (informes, tablas, apps, audios, videos, slides, infografías).
 */
import path from 'node:path'
import { decodificar, leerHtml } from '../lector/html.ts'

// ─── HTML → texto ───────────────────────────────────────────────────────

/** Un fragmento de HTML (una respuesta, una fuente, una nota) en Markdown, sin podar nada. */
export function aMarkdown(html: string): string {
  if (!html.trim()) return ''
  if (!/<[a-z][\s\S]*>/i.test(html)) return decodificar(html).trim()
  try {
    return leerHtml(`<html><body><article>${html}</article></body></html>`, 'https://takeout.invalid/', { entero: true }).markdown.trim()
  } catch {
    return decodificar(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').trim()
  }
}

/** Texto plano de un trozo con <br> (el pedido tal como lo escribió). */
const plano = (html: string) => decodificar(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/​/g, '').replace(/\n{3,}/g, '\n\n').trim()

// ─── fechas ─────────────────────────────────────────────────────────────

const MESES: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const ZONAS: Record<string, number> = { CEST: 2, CET: 1, BST: 1, GMT: 0, UTC: 0, WET: 0, WEST: 1, EET: 2, EEST: 3, ART: -3, EST: -5, EDT: -4, CST: -6, CDT: -5, PST: -8, PDT: -7 }

/** «Jun 30, 2025, 12:16:51 AM CEST» → ms. null si no se entiende. */
export function fechaGemini(s: string): number | null {
  const m = /([A-Z][a-z]{2})\w* (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}):(\d{2})[\s  ]*([AP]M)?[\s  ]*([A-Z]{2,5}|GMT[+-]\d{1,2}(?::?\d{2})?)?/.exec(s)
  if (!m) return null
  const mes = MESES[m[1].toLowerCase()]
  if (mes == null) return null
  let h = Number(m[4]) % 12
  if (m[7] === 'PM') h += 12
  if (!m[7]) h = Number(m[4])
  const zona = m[8] ?? 'UTC'
  const off = /^GMT([+-]\d{1,2})(?::?(\d{2}))?$/.exec(zona)
  const horas = off ? Number(off[1]) + Math.sign(Number(off[1])) * Number(off[2] ?? 0) / 60 : (ZONAS[zona] ?? 0)
  return Date.UTC(Number(m[3]), mes, Number(m[2]), h, Number(m[5]), Number(m[6])) - horas * 3_600_000
}

export const dia = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// ─── Gemini ─────────────────────────────────────────────────────────────

export type AdjuntoGemini = { archivo: string; nombre: string }
export type TurnoGemini = { chat: string; cuando: number; prompt: string; respuesta: string; adjuntos: AdjuntoGemini[]; canvas: boolean; via: 'gem' | 'notebook' | null }
export type ChatGemini = { id: string; titulo: string; desde: number; hasta: number; turnos: TurnoGemini[] }

const FECHA_CELDA = /<br>\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}, \d{1,2}:\d{2}:\d{2}[^<]*?)\s*<br>/

/** Las celdas de «Mi actividad» de Gemini: solo los pedidos (y los Canvas), con su respuesta en Markdown. */
export function turnosDeGemini(html: string): TurnoGemini[] {
  const out: TurnoGemini[] = []
  for (const celda of html.split('<div class="outer-cell').slice(1)) {
    const i = celda.indexOf('mdl-typography--body-1">')
    if (i < 0) continue
    const cuerpo = celda.slice(i + 'mdl-typography--body-1">'.length, celda.indexOf('<div class="content-cell', i) > 0 ? celda.indexOf('<div class="content-cell', i) : undefined)
    const canvas = cuerpo.startsWith('Created Gemini Canvas')
    if (!cuerpo.startsWith('Prompted') && !canvas) continue
    const chat = /gemini\.google\.com\/app\/([0-9a-f]+)/.exec(celda)?.[1]
    if (!chat) continue
    const f = FECHA_CELDA.exec(cuerpo)
    const cuando = f ? fechaGemini(f[1]) : null
    if (!f || cuando == null) continue
    const pedidoHtml = cuerpo.slice(0, f.index).replace(/^(Prompted|Created Gemini Canvas)\s*/, '')
    const adjuntos: AdjuntoGemini[] = []
    for (const a of pedidoHtml.matchAll(/<a href="([^"]+)">([^<]*)<\/a>/g)) if (!/^https?:/i.test(a[1])) { const archivo = (() => { try { return decodeURIComponent(decodificar(a[1])) } catch { return decodificar(a[1]) } })(); adjuntos.push({ archivo, nombre: decodificar(a[2]) || archivo }) }
    const prompt = plano(pedidoHtml.replace(/Attached \d+ files?\.?/gi, '').replace(/<br>\s*-\s*<a href="[^"]+">[^<]*<\/a>/g, ''))
    const respuesta = aMarkdown(cuerpo.slice(f.index + f[0].length).replace(/<\/div>\s*$/, ''))
    const caption = celda.slice(celda.indexOf('mdl-typography--caption') > 0 ? celda.indexOf('mdl-typography--caption') : celda.length)
    const via = /gemini\.google\.com\/gems\//.test(caption) ? 'gem' : /gemini\.google\.com\/notebooks\//.test(caption) ? 'notebook' : null
    out.push({ chat, cuando, prompt, respuesta, adjuntos, canvas, via })
  }
  return out
}

/** Los pedidos agrupados en sus conversaciones, en orden; el título es el comienzo del primer pedido. Sin repetidos. */
export function chatsDeGemini(turnos: TurnoGemini[]): ChatGemini[] {
  const porChat = new Map<string, Map<string, TurnoGemini>>()
  for (const t of turnos) {
    const m = porChat.get(t.chat) ?? new Map()
    m.set(`${t.cuando}|${t.prompt.slice(0, 200)}`, t) // el mismo pedido en dos exportaciones cuenta una vez
    porChat.set(t.chat, m)
  }
  return [...porChat].map(([id, m]) => {
    const ts = [...m.values()].sort((a, b) => a.cuando - b.cuando)
    const primero = ts.find((t) => t.prompt.trim())?.prompt ?? ts[0].respuesta
    const titulo = primero.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sin título'
    return { id, titulo, desde: ts[0].cuando, hasta: ts.at(-1)!.cuando, turnos: ts }
  }).sort((a, b) => a.desde - b.desde)
}

// ─── NotebookLM ─────────────────────────────────────────────────────────

/** Qué es cada archivo de la carpeta de un cuaderno, por su ruta («<cuaderno>/Sources/x.html»). */
export type PiezaNlm =
  | { que: 'meta-cuaderno' }
  | { que: 'fuente-meta' | 'fuente'; base: string }
  | { que: 'artefacto-meta' | 'artefacto'; base: string; ext: string }
  | { que: 'nota' | 'chat'; base: string }
  | { que: 'descubiertas' }
  | { que: 'otro' }

export function queEs(rel: string): PiezaNlm {
  const p = rel.split('/')
  if (p.length === 2 && p[1].endsWith(' metadata.json')) return { que: 'meta-cuaderno' }
  if (p.length !== 3) return { que: 'otro' }
  const [, sub, nombre] = p
  const meta = nombre.endsWith(' metadata.json')
  if (sub === 'Sources') return meta ? { que: 'fuente-meta', base: nombre.slice(0, -' metadata.json'.length) } : { que: 'fuente', base: nombre.replace(/\.html$/i, '') }
  if (sub === 'Artifacts') {
    if (meta) return { que: 'artefacto-meta', base: nombre.slice(0, -' metadata.json'.length), ext: '' }
    // «Título.md», «Título.wav(1)», «Título» (una app o tabla en HTML), «x.pdf.pdf»
    const m = /^(.*?)(\.(md|wav|mp4|png|pdf|docx|html|json|csv|jpg|jpeg|webp|m4a|mp3))?(\(\d+\))?$/i.exec(nombre)!
    return { que: 'artefacto', base: m[1], ext: (m[3] ?? '').toLowerCase() }
  }
  if (sub === 'Notes') return { que: 'nota', base: nombre.replace(/\.html$/i, '') }
  if (sub === 'Chat History') return { que: 'chat', base: nombre.replace(/\.html$/i, '') }
  if (sub === 'Discovered Sources') return { que: 'descubiertas' }
  return { que: 'otro' }
}

/** Un chat de NotebookLM («USER: …», «MODEL: …») en turnos. */
export function turnosDeChatNlm(html: string): { quien: 'yo' | 'notebooklm'; texto: string }[] {
  const out: { quien: 'yo' | 'notebooklm'; texto: string }[] = []
  for (const parte of html.split(/\n(?=(?:USER|MODEL): )/)) {
    const m = /^(USER|MODEL): ([\s\S]*)$/.exec(parte.trim())
    if (!m) {
      if (out.length) out.at(-1)!.texto += `\n${aMarkdown(parte)}`
      continue
    }
    const texto = aMarkdown(m[2])
    if (texto) out.push({ quien: m[1] === 'USER' ? 'yo' : 'notebooklm', texto })
  }
  return out
}

/** Una nota con citas «[1]», «[2-4]» es una respuesta guardada de NotebookLM (generada); sin citas, la escribió él. */
export const notaGenerada = (texto: string) => /\[\d+(?:\s*[-,–]\s*\d+)*\]/.test(texto)

/** El nivel de voz de una fuente según su tipo: sus audios son suyos; un chat de Gemini, investigación; lo demás, fuente primaria. */
export function nivelDeFuente(tipo: string): 'propia' | 'primaria' | 'investigacion' {
  if (/AUDIO/.test(tipo)) return 'propia'
  if (/GEMINI_CHAT/.test(tipo)) return 'investigacion'
  return 'primaria'
}

// ─── medios ─────────────────────────────────────────────────────────────

export type ClaseMedio = 'audio' | 'imagen' | 'documento'

/** Qué hacer con un archivo binario, por su extensión o por sus primeros bytes (Takeout deja algunos sin extensión). */
export function claseDeArchivo(nombre: string, cabeza?: Buffer): { clase: ClaseMedio; ext: string } | null {
  let ext = path.extname(nombre.replace(/\(\d+\)$/, '')).toLowerCase().slice(1)
  if (!ext && cabeza) ext = sniff(cabeza)
  if (/^(wav|m4a|mp3|ogg|oga|opus|aac|amr|flac|webm|mp4|m4v|mov|3gp|weba)$/.test(ext)) return { clase: 'audio', ext }
  if (/^(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/.test(ext)) return { clase: 'imagen', ext }
  if (/^(pdf|docx|xlsx|pptx|md|txt|csv|json|xml|html?)$/.test(ext)) return { clase: 'documento', ext }
  return null
}

function sniff(b: Buffer): string {
  const s = b.subarray(0, 16).toString('latin1')
  if (s.startsWith('%PDF')) return 'pdf'
  if (s.startsWith('\x89PNG')) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg'
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE') return 'wav'
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'webp'
  if (s.startsWith('OggS')) return 'ogg'
  if (s.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3'
  if (s.slice(4, 8) === 'ftyp') return /M4A|m4a/.test(s.slice(8, 12)) ? 'm4a' : 'mp4'
  if (s.startsWith('\x1aE\xdf\xa3')) return 'webm'
  if (s.startsWith('PK')) return 'docx'
  if (s.trimStart().startsWith('{') || s.trimStart().startsWith('[')) return 'json'
  return ''
}
