/**
 * El canal de Telegram: hablarle a Mastropiero desde el celular. Texto, audios (Whisper) y fotos (visión) entran a la
 * conversación de Hoy; lo que contesta vuelve por Telegram, y lo que dice solo (saludo, alertas, reportes) también.
 * Sin URL pública: el servidor le pregunta a Telegram si hay mensajes (long polling). Solo atiende a su chat
 * (TELEGRAM_CHAT_ID): a cualquier otro le dice su id y nada más.
 */
import type { Db } from './db.ts'
import { conversacionHoy, enviar, estaPensando, mensajes } from './chat/index.ts'
import { nanTranscribir, nanVision } from './nan.ts'
import { enCurso, marcarSecundaria } from './misiones.ts'

const api = (metodo: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`

let pedir = async (metodo: string, cuerpo: Record<string, unknown>): Promise<any> => {
  const r = await fetch(api(metodo), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(65_000) })
  return r.json()
}
let bajar = async (fileId: string): Promise<{ datos: Buffer; nombre: string }> => {
  const f = await pedir('getFile', { file_id: fileId })
  if (!f.ok) throw new Error(`Telegram getFile: ${f.description}`)
  const r = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.result.file_path}`)
  return { datos: Buffer.from(await r.arrayBuffer()), nombre: String(f.result.file_path).split('/').pop() ?? 'archivo' }
}
let transcribir = (db: Db, audio: Buffer, nombre: string) => nanTranscribir(db, audio, nombre)
let ver = async (db: Db, imagen: Buffer) => (await nanVision({ db, clase: 'mastropiero', agenteId: 'telegram' }, {
  sistema: 'Describí la imagen con detalle útil (qué es, texto visible, contexto), en castellano rioplatense, en 2 a 5 oraciones.', texto: 'Te mandaron esta foto:', imagen: `data:image/jpeg;base64,${imagen.toString('base64')}`,
})).texto
export function _probarTelegram(o: { pedir?: typeof pedir; bajar?: typeof bajar; transcribir?: typeof transcribir; ver?: typeof ver }) {
  if (o.pedir) pedir = o.pedir
  if (o.bajar) bajar = o.bajar
  if (o.transcribir) transcribir = o.transcribir
  if (o.ver) ver = o.ver
}

export const telegramConfigurado = () => !!process.env.TELEGRAM_BOT_TOKEN
const suChat = () => process.env.TELEGRAM_CHAT_ID?.trim() || null

/** Manda un texto a su chat (cortado en pedazos de 4.000: el límite de Telegram), con botones opcionales. */
export async function decir(texto: string, botones?: { texto: string; dato: string }[][]): Promise<void> {
  const chat = suChat()
  if (!telegramConfigurado() || !chat || !texto.trim()) return
  const limpio = texto.replace(/\[#\d+\]/g, '').trim()
  for (let i = 0; i < limpio.length; i += 4000) {
    const ultimo = i + 4000 >= limpio.length
    await pedir('sendMessage', { chat_id: chat, text: limpio.slice(i, i + 4000), ...(ultimo && botones ? { reply_markup: { inline_keyboard: botones.map((f) => f.map((b) => ({ text: b.texto, callback_data: b.dato }))) } } : {}) })
  }
}

/** La banda que toca ahora, con botones para marcarla. */
async function bandaActual(db: Db) {
  const v = enCurso(db)
  if (!v) return decir('No hay una run en curso.')
  if (!v.actual) return decir(`Run ${v.run.inicio}–${v.run.fin}: estás entre bandas.${v.siguientes[0] ? ` Lo que sigue: ${v.siguientes[0].inicio} ${v.siguientes[0].titulo}` : ''}`)
  return decir(`${v.actual.inicio}–${v.actual.fin} · ${v.actual.titulo}${v.actual.detalle ? `\n${v.actual.detalle}` : ''}\nTe quedan ${v.restan} min.`,
    [[{ texto: '✓ Hecha', dato: `m:${v.actual.id}:hecha` }, { texto: '◐ A medias', dato: `m:${v.actual.id}:parcial` }, { texto: '✗ No', dato: `m:${v.actual.id}:no` }]])
}

/** Lo que dice él → la conversación de Hoy → la respuesta de Mastropiero vuelve por Telegram. */
async function conversar(db: Db, texto: string) {
  const c = conversacionHoy(db)
  if (estaPensando(c.id)) return decir('Esperá, todavía estoy contestando lo anterior.')
  const desde = mensajes(db, c.id).at(-1)?.id ?? 0
  await pedir('sendChatAction', { chat_id: suChat(), action: 'typing' }).catch(() => {})
  await enviar(db, c.id, texto)
  const respuesta = mensajes(db, c.id, desde).filter((m) => m.rol === 'asistente' && m.texto).map((m) => m.texto).join('\n\n')
  const error = mensajes(db, c.id, desde).find((m) => m.rol === 'error')
  await decir(respuesta || (error ? `No pude: ${error.texto}` : 'Listo.'))
}

/** Una actualización de Telegram (mensaje o botón). */
export async function procesarActualizacion(db: Db, u: any): Promise<void> {
  const msg = u.message ?? u.edited_message
  const chatId = String(msg?.chat?.id ?? u.callback_query?.message?.chat?.id ?? '')
  if (!chatId) return
  if (!suChat()) {
    // Sin chat configurado: no atiende a nadie; le dice a quien escribe su id para que lo pongan en .env.
    await pedir('sendMessage', { chat_id: chatId, text: `Hola. Para que te atienda, poné en .env: TELEGRAM_CHAT_ID=${chatId} y reiniciá Mastropiero.` })
    return
  }
  if (chatId !== suChat()) return // otro: silencio
  if (u.callback_query) {
    const [k, id, estado] = String(u.callback_query.data ?? '').split(':')
    await pedir('answerCallbackQuery', { callback_query_id: u.callback_query.id }).catch(() => {})
    if (k === 'm') {
      const m = marcarSecundaria(db, Number(id), estado as any)
      await decir(`Marcada «${m.titulo}» como ${estado === 'parcial' ? 'a medias' : estado}.`)
    }
    return
  }
  const texto: string | undefined = msg.text ?? msg.caption
  if (texto?.startsWith('/')) {
    const cmd = texto.split(/\s+/)[0].toLowerCase()
    if (cmd === '/banda' || cmd === '/ahora') return bandaActual(db)
    if (cmd === '/start') return decir('Acá estoy. Escribime, mandame audios o fotos. /banda te muestra lo que toca ahora en la run.')
    return conversar(db, texto.slice(cmd.length).trim() || texto)
  }
  const voz = msg.voice ?? msg.audio
  if (voz) {
    const { datos, nombre } = await bajar(voz.file_id)
    const t = await transcribir(db, datos, nombre.endsWith('.oga') ? nombre.replace(/\.oga$/, '.ogg') : nombre)
    if (!t.trim()) return decir('No entendí el audio.')
    return conversar(db, t)
  }
  if (msg.photo?.length) {
    const { datos } = await bajar(msg.photo.at(-1).file_id)
    const descripcion = await ver(db, datos)
    return conversar(db, `(Te mandé una foto por Telegram. Lo que se ve: ${descripcion})${texto ? `\n${texto}` : ''}`)
  }
  if (texto) return conversar(db, texto)
}

let corriendo = false
let offset = 0
/** El bucle de long polling: pregunta, procesa de a una (en orden), y vuelve a preguntar. */
export function escucharTelegram(db: Db) {
  if (corriendo || !telegramConfigurado()) return
  corriendo = true
  const vuelta = async () => {
    try {
      const r = await pedir('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'edited_message', 'callback_query'] })
      for (const u of r.result ?? []) {
        offset = u.update_id + 1
        await procesarActualizacion(db, u).catch((e) => decir(`Se me trabó algo: ${e instanceof Error ? e.message : e}`))
      }
    } catch (e) {
      console.error('  telegram:', e instanceof Error ? e.message : e)
      await new Promise((ok) => setTimeout(ok, 10_000))
    }
    if (corriendo) setTimeout(vuelta, 300)
  }
  void vuelta()
}
export function dejarDeEscuchar() {
  corriendo = false
}
