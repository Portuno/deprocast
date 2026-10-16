/**
 * La exportación de ChatGPT (la carpeta que manda OpenAI: conversations-NNN.json, los file-*.dat y chat.html), leída en
 * la compu sin modelos. Cada conversación sale como la vio él: siguiendo la rama final (de current_node hacia atrás), no
 * las respuestas que regeneró y descartó. Lo que dijo por voz entra por su transcripción (los audios no vienen en la
 * exportación). Los razonamientos internos del modelo (thoughts, reasoning_recap) no entran.
 */
import fs from 'node:fs'
import path from 'node:path'

export type AdjuntoGpt = { archivo: string | null; nombre: string }
export type TurnoGpt = { cuando: number; prompt: string; respuesta: string; adjuntos: AdjuntoGpt[] }
export type ChatGpt = { id: string; titulo: string; desde: number; hasta: number; grupo?: boolean; turnos: TurnoGpt[] }

const conversaciones = (carpeta: string) => fs.readdirSync(carpeta).filter((f) => /^conversations(-\d+)?\.json$/.test(f)).sort()

/** ¿Es una exportación de ChatGPT? */
export const esExportChatGPT = (carpeta: string) => fs.existsSync(carpeta) && fs.statSync(carpeta).isDirectory() && conversaciones(carpeta).length > 0

/** El id del lote: con la fecha de la exportación (repetir la misma carpeta no duplica). */
export function loteChatGPT(carpeta: string): string {
  const f = /(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})/.exec(path.basename(path.resolve(carpeta)))?.[1]
  return `chatgpt-${f ?? new Date(fs.statSync(carpeta).mtimeMs).toISOString().slice(0, 19).replace(/[T:]/g, '-')}`
}

const ms = (s: unknown) => (typeof s === 'number' ? Math.round(s * 1000) : typeof s === 'string' && s ? Date.parse(s) || 0 : 0)
/** «file-service://file-XYZ» o «sediment://file_abc» → «file-XYZ» / «file_abc». */
const idDeAsset = (p: unknown) => (typeof p === 'string' ? (/^(file[-_][\w-]+)$/.exec(p.split('//').pop() ?? '')?.[1] ?? null) : null)

/** El texto de un mensaje (y sus imágenes), sin lo interno del modelo. */
function partes(m: any): { texto: string; imagenes: string[] } | null {
  const c = m?.content
  if (!c) return null
  const tipo = c.content_type
  if (tipo === 'thoughts' || tipo === 'reasoning_recap' || tipo === 'model_editable_context' || tipo === 'system_error') return null
  const textos: string[] = []
  const imagenes: string[] = []
  if (Array.isArray(c.parts)) {
    for (const p of c.parts) {
      if (typeof p === 'string') textos.push(p)
      else if (p?.content_type === 'audio_transcription' && p.text) textos.push(p.text)
      else if (p?.content_type === 'image_asset_pointer') { const id = idDeAsset(p.asset_pointer); if (id) imagenes.push(id) }
    }
  } else if (typeof c.text === 'string') textos.push(c.text)
  return { texto: textos.join('\n').trim(), imagenes }
}

/** La rama que quedó: desde el último mensaje hacia atrás por sus padres. */
function rama(c: any): any[] {
  const mapa = c.mapping ?? {}
  const out: any[] = []
  const vistos = new Set<string>()
  let id: string | null = c.current_node ?? null
  if (!id || !mapa[id]) {
    // Sin current_node: el mensaje más nuevo.
    id = Object.values(mapa).filter((n: any) => n?.message).sort((a: any, b: any) => (b.message.create_time ?? 0) - (a.message.create_time ?? 0)).map((n: any) => n.id)[0] ?? null
  }
  while (id && mapa[id] && !vistos.has(id)) {
    vistos.add(id)
    if (mapa[id].message) out.push(mapa[id].message)
    id = mapa[id].parent ?? null
  }
  return out.reverse()
}

/** Las conversaciones, en turnos (lo que pidió + lo que contestó), con las imágenes y adjuntos de cada turno. */
export function chatsDeChatGPT(carpeta: string): ChatGpt[] {
  const archivos = new Map<string, string>() // id del archivo → nombre en la carpeta
  for (const f of fs.readdirSync(carpeta)) { const id = /^(file[-_][\w-]+?)(?:\.[\w]+)?$/.exec(f)?.[1]; if (id) archivos.set(id, f) }
  const chats: ChatGpt[] = []
  for (const f of conversaciones(carpeta)) {
    const lista = JSON.parse(fs.readFileSync(path.join(carpeta, f), 'utf8')) as any[]
    for (const c of Array.isArray(lista) ? lista : []) {
      const turnos: TurnoGpt[] = []
      for (const m of rama(c)) {
        const rol = m.author?.role
        if (rol !== 'user' && rol !== 'assistant') continue
        if (m.metadata?.is_visually_hidden_from_conversation) continue
        const p = partes(m)
        if (!p) continue
        const cuando = ms(m.create_time) || ms(c.create_time)
        if (rol === 'user') {
          const adjuntos: AdjuntoGpt[] = []
          const nombres = new Map<string, string>((m.metadata?.attachments ?? []).map((a: any) => [String(a.id), String(a.name ?? 'adjunto')]))
          for (const id of new Set([...p.imagenes, ...nombres.keys()])) adjuntos.push({ archivo: archivos.get(id) ?? null, nombre: nombres.get(id) ?? 'imagen' })
          if (!p.texto && !adjuntos.length) continue // un audio sin transcripción
          turnos.push({ cuando, prompt: p.texto, respuesta: '', adjuntos })
        } else {
          if (!p.texto) continue
          const t = turnos.at(-1)
          if (t) t.respuesta = t.respuesta ? `${t.respuesta}\n\n${p.texto}` : p.texto
          else turnos.push({ cuando, prompt: '', respuesta: p.texto, adjuntos: [] })
        }
      }
      if (!turnos.length) continue
      const desde = ms(c.create_time) || turnos[0].cuando
      chats.push({ id: String(c.conversation_id ?? c.id), titulo: String(c.title || 'Sin título').slice(0, 200), desde, hasta: Math.max(ms(c.update_time), turnos.at(-1)!.cuando, desde), turnos })
    }
  }
  // Los chats grupales: cada mensaje con su rol (no se sabe cuál de los participantes es él: no entra como su voz).
  const g = path.join(carpeta, 'group_chats.json')
  if (fs.existsSync(g)) {
    for (const c of (JSON.parse(fs.readFileSync(g, 'utf8'))?.chats ?? []) as any[]) {
      const ms_ = [...(c.messages ?? [])].sort((a: any, b: any) => ms(a.created_at) - ms(b.created_at))
      const turnos: TurnoGpt[] = []
      for (const m of ms_) {
        const texto = String(m.text ?? '').trim()
        if (!texto) continue
        if (m.role === 'assistant' && turnos.length) turnos.at(-1)!.respuesta += (turnos.at(-1)!.respuesta ? '\n\n' : '') + texto
        else turnos.push({ cuando: ms(m.created_at), prompt: m.role === 'assistant' ? '' : texto, respuesta: m.role === 'assistant' ? texto : '', adjuntos: [] })
      }
      if (turnos.length) chats.push({ id: `grupo-${c.id}`, titulo: String(c.name || 'Chat grupal').slice(0, 200), desde: ms(c.created_at) || turnos[0].cuando, hasta: ms(c.last_action_at) || turnos.at(-1)!.cuando, grupo: true, turnos })
    }
  }
  return chats.sort((a, b) => a.desde - b.desde)
}

/** El nombre original de cada archivo (lo trae la exportación aparte). */
export function nombresOriginales(carpeta: string): Record<string, string> {
  const f = path.join(carpeta, 'conversation_asset_file_names.json')
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {} } catch { return {} }
}
