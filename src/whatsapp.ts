/**
 * WhatsApp (plan v35, fase 4): Mastropiero en WhatsApp, el reemplazo de Instinct. Con la API oficial de Meta (Cloud
 * API): Deprocast tiene su propio número y él le escribe como a cualquier contacto. Lo que entra se atiende con el
 * mismo cerebro que Telegram (src/telegram.ts, por el «canal»): charla, notas de voz, fotos, sueños, registros, links,
 * botones.
 *
 * Configuración (en su perfil, queda en su base): el ID del número, el token permanente y el secreto de la app. En Meta
 * se pone el webhook (<su Deprocast>/api/whatsapp/webhook) con el token de verificación que muestra el perfil.
 *
 * Seguridad:
 * - cada pedido del webhook trae la firma de Meta (HMAC SHA-256 con el secreto de la app); sin firma válida, nada;
 * - solo se atiende SU número: se vincula mandando el código de 6 dígitos que muestra el perfil; a los demás, silencio;
 * - Meta reintenta: cada mensaje se procesa una sola vez.
 *
 * Lo que Mastropiero dice solo (el matinal, un aviso) sale por WhatsApp si él escribió en las últimas 24 horas (fuera
 * de esa ventana, WhatsApp exige una plantilla aprobada).
 */
import crypto from 'node:crypto'
import { ajuste, fijarAjuste, type Db } from './db.ts'
import { conCanal, procesarActualizacion, type Botones, type Canal } from './telegram.ts'
import { conversacionHoy, estaPensando } from './chat/index.ts'

const GRAPH = 'https://graph.facebook.com/v21.0'
const VENTANA = 24 * 3_600_000

let red: typeof fetch = (...a) => fetch(...a)
export function _probarWhatsapp(f: typeof fetch) { red = f }

const cfg = (db: Db) => ({
  numeroId: ajuste(db, 'whatsapp_numero_id') ?? '',
  token: ajuste(db, 'whatsapp_token') ?? '',
  secreto: ajuste(db, 'whatsapp_secreto') ?? '',
  verificar: ajuste(db, 'whatsapp_verificar') ?? '',
  suyo: ajuste(db, 'whatsapp_wa_id') ?? '',
  codigo: ajuste(db, 'whatsapp_codigo') ?? '',
})
/** Lo último que pasó con Meta (para ver en el perfil por qué no contesta): cuándo y qué. */
export function anotarWhatsapp(db: Db, que: string, ahora = Date.now()) { fijarAjuste(db, 'whatsapp_diag', JSON.stringify({ en: ahora, que: que.slice(0, 300) })) }
const diag = (db: Db): { en: number; que: string } | null => { try { return JSON.parse(ajuste(db, 'whatsapp_diag') ?? 'null') } catch { return null } }

export const whatsappConfigurado = (db: Db) => { const c = cfg(db); return !!(c.numeroId && c.token && c.secreto) }

export function estadoWhatsapp(db: Db) {
  const c = cfg(db)
  const ultimo = Number(ajuste(db, 'whatsapp_ultimo_entrante')) || null
  return {
    configurado: whatsappConfigurado(db),
    numeroId: c.numeroId || null,
    verificar: c.verificar || null,
    vinculado: c.suyo ? `+${c.suyo}` : null,
    codigo: c.suyo ? null : c.codigo || null,
    ultimoMensaje: ultimo,
    ventanaAbierta: !!ultimo && Date.now() - ultimo < VENTANA,
    diag: diag(db),
  }
}

/** Guarda la configuración; genera el token de verificación del webhook y el código de vinculación si faltan. */
export function configurarWhatsapp(db: Db, d: { numeroId?: string; token?: string; secreto?: string }) {
  const numeroId = String(d.numeroId ?? '').trim()
  const token = String(d.token ?? '').trim()
  const secreto = String(d.secreto ?? '').trim()
  if (!/^\d{6,20}$/.test(numeroId)) throw new Error('El ID del número de teléfono son solo dígitos (está en WhatsApp → Configuración de la API).')
  if (token.length < 30) throw new Error('Falta el token de acceso (el permanente, del usuario del sistema).')
  if (/^EAA/.test(secreto)) throw new Error('En «Clave secreta de la app» pegaste un token (empieza con EAA). El secreto es otra cosa: 32 letras y números, en Configuración de la app → Básica → Clave secreta de la app → Mostrar.')
  if (!/^[0-9a-f]{32}$/i.test(secreto)) throw new Error('El secreto de la app son 32 caracteres (Configuración de la app → Básica → Clave secreta).')
  fijarAjuste(db, 'whatsapp_numero_id', numeroId)
  fijarAjuste(db, 'whatsapp_token', token)
  fijarAjuste(db, 'whatsapp_secreto', secreto)
  if (!ajuste(db, 'whatsapp_verificar')) fijarAjuste(db, 'whatsapp_verificar', crypto.randomBytes(18).toString('base64url'))
  if (!ajuste(db, 'whatsapp_wa_id') && !ajuste(db, 'whatsapp_codigo')) fijarAjuste(db, 'whatsapp_codigo', String(crypto.randomInt(100000, 1000000)))
  return estadoWhatsapp(db)
}

export function desvincularWhatsapp(db: Db) {
  fijarAjuste(db, 'whatsapp_wa_id', '')
  fijarAjuste(db, 'whatsapp_codigo', String(crypto.randomInt(100000, 1000000)))
  return estadoWhatsapp(db)
}

/** La verificación del webhook (GET): Meta manda el token que pusimos y espera el «challenge» de vuelta. */
export function verificarWebhook(db: Db, q: URLSearchParams): string | null {
  const c = cfg(db)
  if (q.get('hub.mode') !== 'subscribe' || !c.verificar) return null
  const t = q.get('hub.verify_token') ?? ''
  return t.length === c.verificar.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(c.verificar)) ? q.get('hub.challenge') : null
}

/** ¿El pedido viene de Meta? La firma es HMAC SHA-256 del cuerpo crudo con el secreto de la app. */
export function firmaValida(db: Db, cuerpo: Buffer, firma: string | undefined): boolean {
  const secreto = cfg(db).secreto
  if (!secreto || !firma?.startsWith('sha256=')) return false
  const esperada = `sha256=${crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex')}`
  return firma.length === esperada.length && crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))
}

// ─── mandar ─────────────────────────────────────────────────────────────

async function graph(db: Db, ruta: string, init: RequestInit = {}) {
  const c = cfg(db)
  const r = await red(`${GRAPH}/${ruta}`, { ...init, headers: { authorization: `Bearer ${c.token}`, ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(60_000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${j?.error?.message ?? 'falló'}`)
  return j
}

/**
 * Suscribe la cuenta de WhatsApp a la app. Sin esto, Meta verifica el webhook y manda las pruebas del panel, pero NO los
 * mensajes reales (y el panel no lo muestra). Las cuentas salen del token: `debug_token` dice a qué cuentas de WhatsApp
 * tiene acceso (granular_scopes). Devuelve qué quedó suscripto.
 */
export async function suscribirApp(db: Db, cuentaId?: string | null): Promise<{ cuentas: string[]; apps: string[] }> {
  const c = cfg(db)
  if (!c.token) throw new Error('Falta configurar WhatsApp')
  // La cuenta: la que él dio (o la guardada), si no la que diga el token (Meta no siempre la informa).
  const dada = String(cuentaId ?? ajuste(db, 'whatsapp_cuenta_id') ?? '').replace(/\D/g, '')
  let cuentas = dada ? [dada] : []
  if (!cuentas.length) {
    const dbg = await graph(db, `debug_token?input_token=${encodeURIComponent(c.token)}`).catch(() => null)
    const scopes = (dbg?.data?.granular_scopes ?? []) as { scope: string; target_ids?: string[] }[]
    cuentas = [...new Set(scopes.filter((s) => s.scope.startsWith('whatsapp_business')).flatMap((s) => s.target_ids ?? []))]
  }
  if (!cuentas.length) throw new Error('FALTA_CUENTA: no sé cuál es tu cuenta de WhatsApp. Pegá su ID (el «Identificador de la cuenta de mensajes», en Paso 1. Probar).')
  if (dada) fijarAjuste(db, 'whatsapp_cuenta_id', dada)
  const apps: string[] = []
  for (const id of cuentas) {
    await graph(db, `${id}/subscribed_apps`, { method: 'POST', body: '{}' })
    const r = await graph(db, `${id}/subscribed_apps`)
    for (const a of r?.data ?? []) apps.push(String(a?.whatsapp_business_api_data?.name ?? a?.name ?? a?.id ?? '?'))
  }
  anotarWhatsapp(db, `Cuenta de WhatsApp suscripta a la app (${apps.join(', ') || 'sin nombre'}): ahora sí llegan los mensajes reales`)
  return { cuentas, apps }
}

/** El formato de WhatsApp: *negrita*, _cursiva_, sin encabezados de Markdown. */
export function aWhatsapp(t: string): string {
  return t
    // Las tablas no existen en WhatsApp: cada fila, un renglón con guión (la fila separadora se va).
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$\n?/gm, '')
    .replace(/^\s*\|(.+)\|\s*$/gm, (_, fila: string) => `- ${fila.split('|').map((x) => x.trim()).filter(Boolean).join(' · ')}`)
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')
}

function pedazos(t: string, max = 3800): string[] {
  const out: string[] = []
  let actual = ''
  for (const p of t.split(/\n{2,}/)) {
    if ((actual + '\n\n' + p).length > max && actual) { out.push(actual); actual = '' }
    actual = actual ? `${actual}\n\n${p}` : p
    while (actual.length > max) { out.push(actual.slice(0, max)); actual = actual.slice(max) }
  }
  if (actual.trim()) out.push(actual)
  return out
}

/** Un texto (en pedazos si es largo); con botones, el último pedazo los lleva (hasta 3 botones, o una lista de 10). */
/** Lo que Mastropiero mandó hace poco (id → texto): cuando él responde citando, se sabe a qué. */
const enviados = new Map<string, string>()
function recordarEnviado(r: any, texto: string) {
  const id = r?.messages?.[0]?.id
  if (!id) return
  enviados.set(String(id), texto)
  if (enviados.size > 300) enviados.delete(enviados.keys().next().value!)
}

/** citar: el id de un mensaje suyo para responderlo citado (cuando la respuesta llega después de otros mensajes suyos). */
export async function mandarTexto(db: Db, para: string, texto: string, botones?: Botones, o: { citar?: string } = {}) {
  const c = cfg(db)
  const partes = pedazos(aWhatsapp(texto))
  const planos = (botones ?? []).flat().filter((b) => b.texto && b.dato).slice(0, 10)
  for (const [i, p] of partes.entries()) {
    const ultimo = i === partes.length - 1
    if (ultimo && planos.length) {
      const interactivo = planos.length <= 3
        ? { type: 'button', body: { text: p.slice(0, 1024) }, action: { buttons: planos.map((b) => ({ type: 'reply', reply: { id: b.dato.slice(0, 256), title: b.texto.slice(0, 20) } })) } }
        : { type: 'list', body: { text: p.slice(0, 4096) }, action: { button: 'Opciones', sections: [{ title: 'Elegí', rows: planos.map((b) => ({ id: b.dato.slice(0, 200), title: b.texto.slice(0, 24) })) }] } }
      recordarEnviado(await graph(db, `${c.numeroId}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'interactive', interactive: interactivo, ...(i === 0 && o.citar ? { context: { message_id: o.citar } } : {}) }) }), p)
    } else {
      recordarEnviado(await graph(db, `${c.numeroId}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: p, preview_url: false }, ...(i === 0 && o.citar ? { context: { message_id: o.citar } } : {}) }) }), p)
    }
  }
}

async function subirMedio(db: Db, datos: Buffer, mime: string, nombre: string): Promise<string> {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', mime)
  form.append('file', new Blob([new Uint8Array(datos)], { type: mime }), nombre)
  const j = await graph(db, `${cfg(db).numeroId}/media`, { method: 'POST', body: form })
  return j.id
}

async function bajarMedio(db: Db, id: string): Promise<{ datos: Buffer; nombre: string }> {
  const m = await graph(db, encodeURIComponent(id))
  const r = await red(m.url, { headers: { authorization: `Bearer ${cfg(db).token}` }, signal: AbortSignal.timeout(120_000) })
  if (!r.ok) throw new Error(`No pude bajar el archivo de WhatsApp (${r.status})`)
  const mime = String(m.mime_type ?? '')
  const ext = /ogg|opus/.test(mime) ? 'ogg' : /mpeg|mp3/.test(mime) ? 'mp3' : /mp4|m4a|aac/.test(mime) ? 'm4a' : /jpeg|jpg/.test(mime) ? 'jpg' : /png/.test(mime) ? 'png' : /webp/.test(mime) ? 'webp' : /pdf/.test(mime) ? 'pdf' : /csv/.test(mime) ? 'csv' : 'bin'
  return { datos: Buffer.from(await r.arrayBuffer()), nombre: `whatsapp.${ext}` }
}

/** El canal de WhatsApp para el cerebro de Telegram: todo lo que diga mientras atiende este mensaje, va acá. */
export const ESTILO_WHATSAPP = 'Estás contestando por WhatsApp, en el teléfono: escribí corto (de 2 a 6 líneas), una idea por párrafo, listas con guiones y nunca tablas ni títulos. Si da para largo, decí lo esencial y ofrecé el detalle. Si te escribió varios mensajes seguidos, contestá todo junto y en orden.'

type Ganchos = { citar?: () => string | undefined; alDecir?: () => void; entregado?: () => void }
function canal(db: Db, para: string, mensajeId: string, g: Ganchos = {}): Canal {
  return {
    nombre: 'WhatsApp',
    estilo: ESTILO_WHATSAPP,
    entregado: g.entregado,
    decir: async (texto, botones) => { await mandarTexto(db, para, texto, botones, { citar: g.citar?.() }); g.alDecir?.(); return null },
    bajar: (id) => bajarMedio(db, id),
    // Leído y «escribiendo…» (dura hasta la respuesta, o 25 s).
    escribiendo: () => graph(db, `${cfg(db).numeroId}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: mensajeId, typing_indicator: { type: 'text' } }) }).catch(() => {}),
    audio: async (datos, _titulo, texto) => {
      g.alDecir?.()
      const id = await subirMedio(db, datos, 'audio/mpeg', 'mastropiero.mp3')
      await graph(db, `${cfg(db).numeroId}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'audio', audio: { id } }) })
      if (texto) await mandarTexto(db, para, texto)
      return true
    },
    archivo: async (datos, nombre) => {
      const id = await subirMedio(db, datos, nombre.endsWith('.md') ? 'text/plain' : 'application/octet-stream', nombre)
      return graph(db, `${cfg(db).numeroId}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'document', document: { id, filename: nombre } }) })
    },
  }
}

// ─── recibir ────────────────────────────────────────────────────────────

/** Un mensaje de WhatsApp, traducido a la forma de Telegram (lo que entiende el cerebro). null = un tipo que no se atiende. */
/** Lo que el mensaje trae de contexto: si lo reenvió de otro chat, o si responde citando algo que dijo Mastropiero. */
export function contextoDe(m: any): string {
  const partes: string[] = []
  if (m.context?.forwarded || m.context?.frequently_forwarded) partes.push('(Me reenviaste esto desde otro chat: si es algo para guardar o anotar, hacelo y confirmalo en una línea; no es un pedido tuyo salvo que lo digas.)')
  const citado = m.context?.id ? enviados.get(String(m.context.id)) : undefined
  if (citado) partes.push(`(Respondés a esto que te dije: «${citado.replace(/\s+/g, ' ').slice(0, 300)}${citado.length > 300 ? '…' : ''}»)`)
  return partes.join('\n')
}
const conContexto = (m: any, t?: string) => { const c = contextoDe(m); return c ? `${c}${t ? `\n${t}` : ''}` : t }

/** Lo que no merece respuesta (un sticker, una reacción): se ignora sin decir nada. */
export const IGNORADOS = new Set(['sticker', 'reaction', 'unsupported', 'system', 'ephemeral'])

export function aTelegram(m: any): any | null {
  const chat = { id: 'whatsapp' }
  switch (m.type) {
    case 'text': return { message: { chat, text: conContexto(m, m.text?.body ?? '') } }
    case 'audio': return { message: { chat, voice: { file_id: m.audio.id, file_unique_id: m.audio.id } } }
    case 'image': return { message: { chat, photo: [{ file_id: m.image.id }], caption: conContexto(m, m.image.caption) } }
    case 'document': return { message: { chat, document: { file_id: m.document.id, file_name: m.document.filename ?? 'archivo', mime_type: m.document.mime_type }, caption: conContexto(m, m.document.caption) } }
    case 'location': {
      const l = m.location ?? {}
      return { message: { chat, text: conContexto(m, `(Te mando dónde estoy: ${[l.name, l.address].filter(Boolean).join(', ') || 'mi ubicación'} · ${l.latitude}, ${l.longitude})`) } }
    }
    case 'contacts': {
      const cs = (m.contacts ?? []).map((x: any) => [x.name?.formatted_name, ...(x.phones ?? []).map((t: any) => t.phone), ...(x.emails ?? []).map((e: any) => e.email)].filter(Boolean).join(' · '))
      return { message: { chat, text: conContexto(m, `(Te paso ${cs.length === 1 ? 'un contacto' : 'unos contactos'}: ${cs.join('; ')})`) } }
    }
    case 'interactive': {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply
      return r ? { callback_query: { id: m.id, data: r.id, message: { chat } } } : null
    }
    case 'button': return { message: { chat, text: m.button?.text ?? m.button?.payload ?? '' } }
    default: return null
  }
}

/** Por remitente, de a uno (que las respuestas salgan en orden). */
// ─── la cola (plan v37) ─────────────────────────────────────────────────
//
// - Una ráfaga de textos («che» / «mirá esto» / «¿qué opinás?») se junta: con 1,5 s de silencio va todo junto, una respuesta.
// - El orden se respeta, pero la cola no espera la respuesta entera: apenas un mensaje quedó en la charla, sigue el próximo.
//   Si Mastropiero está pensando, lo nuevo entra a ese turno (lo ajusta y contesta todo junto) o, si es «ya la hice» sobre
//   algo que sugirió, se resuelve en el acto (el carril rápido del chat).
// - Si una respuesta tarda, ⏳ en su mensaje y «escribiendo…» renovado; si llega después de otros mensajes suyos, va citada.
// - Cada mensaje queda «hecho» recién cuando se atendió: si un reinicio lo corta, se retoma.

type Estado = { cola: Promise<unknown>; buffer: any[]; esperan: (() => void)[]; timer: ReturnType<typeof setTimeout> | null; ultimoId: string | null }
const estados = new Map<string, Estado>()
let juntarMs = 1500
let avisoMs = 6000
export function _probarCola(o: { juntarMs?: number; avisoMs?: number }) { juntarMs = o.juntarMs ?? juntarMs; avisoMs = o.avisoMs ?? avisoMs }
const estadoDe = (de: string): Estado => { let e = estados.get(de); if (!e) { e = { cola: Promise.resolve(), buffer: [], esperan: [], timer: null, ultimoId: null }; estados.set(de, e) } return e }
const marcarHecho = (db: Db, ids: string[]) => { for (const id of ids) db.prepare('UPDATE whatsapp_vistos SET hecho = 1 WHERE id = ?').run(id) }

async function reaccionar(db: Db, para: string, mensajeId: string, emoji: string) {
  await graph(db, `${cfg(db).numeroId}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'reaction', reaction: { message_id: mensajeId, emoji } }) }).catch(() => {})
}

/** Un mensaje suyo. La promesa se cumple cuando quedó atendido del todo. */
function recibirMensaje(db: Db, de: string, m: any): Promise<unknown> {
  const e = estadoDe(de)
  e.ultimoId = String(m.id)
  if (IGNORADOS.has(m.type)) { marcarHecho(db, [String(m.id)]); return Promise.resolve() }
  let pensando = false
  try { pensando = estaPensando(conversacionHoy(db).id) } catch { /* sin charla todavía */ }
  return new Promise<void>((ok) => {
    if (m.type === 'text' && !pensando) {
      e.buffer.push(m)
      e.esperan.push(ok)
      if (e.timer) clearTimeout(e.timer)
      e.timer = setTimeout(() => soltar(db, de), juntarMs)
      return
    }
    soltar(db, de) // lo que estaba juntándose va antes
    encolar(db, de, [m]).then(() => ok(), () => ok())
  })
}

function soltar(db: Db, de: string) {
  const e = estadoDe(de)
  if (e.timer) { clearTimeout(e.timer); e.timer = null }
  if (!e.buffer.length) return
  const ms = e.buffer.splice(0)
  const esperan = e.esperan.splice(0)
  const fin = () => { for (const f of esperan) f() }
  encolar(db, de, ms).then(fin, fin)
}

function encolar(db: Db, de: string, ms: any[]): Promise<unknown> {
  const e = estadoDe(de)
  let entregado: () => void = () => {}
  const listo = new Promise<void>((r) => { entregado = r })
  const completo = e.cola.then(() => atender(db, de, ms, entregado))
  // El próximo arranca cuando éste quedó en la charla (o terminó), no cuando llegó la respuesta.
  e.cola = Promise.race([listo, completo.catch(() => {})])
  return completo
}

async function atender(db: Db, de: string, ms: any[], entregado: () => void) {
  const ids = ms.map((m) => String(m.id))
  const ultimo = ids.at(-1)!
  const u = ms.length === 1 ? aTelegram(ms[0]) : { message: { chat: { id: 'whatsapp' }, text: ms.map((m) => aTelegram(m)?.message?.text ?? '').filter(Boolean).join('\n') } }
  let respondio = false
  let reaccion = false
  const aviso = setTimeout(() => { if (!respondio) { reaccion = true; void reaccionar(db, de, ultimo, '⏳') } }, avisoMs)
  const latido = setInterval(() => { if (!respondio) void graph(db, `${cfg(db).numeroId}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: ultimo, typing_indicator: { type: 'text' } }) }).catch(() => {}) }, 20_000)
  const quitarAviso = () => { if (reaccion) { reaccion = false; void reaccionar(db, de, ultimo, '') } }
  try {
    if (!u) {
      await mandarTexto(db, de, ms[0]?.type === 'video' ? 'Los videos todavía no los puedo ver: mandame el audio, una captura o contame qué hay.' : 'Ese tipo de mensaje todavía no lo entiendo: mandame texto, un audio, una foto o un archivo.')
    } else {
      const c = canal(db, de, ultimo, {
        citar: () => (estadoDe(de).ultimoId !== ultimo ? ultimo : undefined),
        alDecir: () => { respondio = true; quitarAviso() },
        entregado,
      })
      await conCanal(c, () => procesarActualizacion(db, u))
      // Si entró a un turno que ya estaba en curso, no contesta ahora: 👀 dice que lo vio y lo suma.
      if (!respondio && estaPensando(conversacionHoy(db).id)) void reaccionar(db, de, ultimo, '👀')
    }
    marcarHecho(db, ids)
  } catch (e2) {
    console.error('  whatsapp:', e2 instanceof Error ? e2.message : e2)
    await mandarTexto(db, de, `Se me trabó algo: ${e2 instanceof Error ? e2.message : e2}`).catch(() => {})
    marcarHecho(db, ids)
  } finally {
    clearTimeout(aviso)
    clearInterval(latido)
    quitarAviso()
    entregado()
  }
}

/** Lo que un reinicio cortó (llegó, no se terminó de atender, hace menos de media hora): se retoma, como mucho dos veces. */
export async function retomarWhatsapp(db: Db, ahora = Date.now()): Promise<number> {
  const c = cfg(db)
  if (!whatsappConfigurado(db) || !c.suyo) return 0
  const filas = db.prepare(`SELECT id, crudo FROM whatsapp_vistos WHERE hecho = 0 AND crudo IS NOT NULL AND intentos < 2 AND en BETWEEN ? AND ? ORDER BY en`).all(ahora - 30 * 60_000, ahora - 60_000) as { id: string; crudo: string }[]
  const tareas: Promise<unknown>[] = []
  for (const f of filas) {
    db.prepare('UPDATE whatsapp_vistos SET intentos = intentos + 1 WHERE id = ?').run(f.id)
    try { tareas.push(recibirMensaje(db, c.suyo, JSON.parse(f.crudo))) } catch { marcarHecho(db, [f.id]) }
  }
  await Promise.all(tareas)
  return filas.length
}

/** Lo que manda Meta al webhook (ya verificada la firma). Devuelve cuántos mensajes atendió. */
export async function recibirWebhook(db: Db, cuerpo: any, ahora = Date.now()): Promise<number> {
  let n = 0
  const tareas: Promise<unknown>[] = []
  const cuantos = (cuerpo?.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((ch: any) => ch.value?.messages ?? [])).length
  const estados = (cuerpo?.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((ch: any) => ch.value?.statuses ?? []))
  const fallido = estados.find((s: any) => s.status === 'failed')
  if (cuantos) anotarWhatsapp(db, `Llegó de Meta: ${cuantos} mensaje${cuantos === 1 ? '' : 's'}${cfg(db).suyo ? '' : ' (esperando el código)'}`, ahora)
  else if (fallido) anotarWhatsapp(db, `Meta no pudo entregar un mensaje de Mastropiero: ${fallido.errors?.[0]?.title ?? fallido.errors?.[0]?.message ?? 'sin detalle'}`, ahora)
  for (const e of cuerpo?.entry ?? []) {
    for (const ch of e.changes ?? []) {
      const v = ch.value ?? {}
      if (v.metadata?.phone_number_id && v.metadata.phone_number_id !== cfg(db).numeroId) { anotarWhatsapp(db, `Llegó un mensaje para otro número (ID ${v.metadata.phone_number_id}); el configurado es ${cfg(db).numeroId}`, ahora); continue } // otro número
      for (const m of v.messages ?? []) {
        // Meta reintenta: cada mensaje, una sola vez.
        if (db.prepare('INSERT OR IGNORE INTO whatsapp_vistos (id, en) VALUES (?, ?)').run(String(m.id), ahora).changes === 0) continue
        const de = String(m.from ?? '')
        const c = cfg(db)
        if (!c.suyo) {
          // Sin vincular: solo el código de su perfil lo vincula. A los demás, nada.
          if (!(m.type === 'text' && c.codigo && m.text?.body?.replace(/\D/g, '').includes(c.codigo))) anotarWhatsapp(db, `Llegó «${String(m.text?.body ?? m.type).slice(0, 40)}» de +${de}, pero no es el código de vinculación`, ahora)
          if (m.type === 'text' && c.codigo && m.text?.body?.replace(/\D/g, '').includes(c.codigo)) {
            fijarAjuste(db, 'whatsapp_wa_id', de)
            fijarAjuste(db, 'whatsapp_codigo', '')
            fijarAjuste(db, 'whatsapp_ultimo_entrante', String(ahora))
            anotarWhatsapp(db, `Vinculado con +${de}`, ahora)
            tareas.push(mandarTexto(db, de, '☿ Listo, quedamos vinculados. Escribime, mandame audios o fotos como en Telegram: soy Mastropiero.').catch((e2) => { anotarWhatsapp(db, `Vinculado, pero no pude contestar: ${e2 instanceof Error ? e2.message : e2}`); console.error('  whatsapp:', e2 instanceof Error ? e2.message : e2) }))
            n++
          }
          continue
        }
        if (de !== c.suyo) continue // otro número: silencio
        fijarAjuste(db, 'whatsapp_ultimo_entrante', String(ahora))
        db.prepare('UPDATE whatsapp_vistos SET crudo = ? WHERE id = ?').run(JSON.stringify(m), String(m.id))
        n++
        tareas.push(recibirMensaje(db, de, m))
      }
    }
  }
  db.prepare('DELETE FROM whatsapp_vistos WHERE en < ?').run(ahora - 7 * 86_400_000)
  await Promise.all(tareas)
  return n
}

/** Lo que Mastropiero dice solo: por WhatsApp si la ventana de 24 horas está abierta. */
export async function decirPorWhatsapp(db: Db, texto: string, ahora = Date.now()): Promise<boolean> {
  const c = cfg(db)
  const ultimo = Number(ajuste(db, 'whatsapp_ultimo_entrante')) || 0
  if (!whatsappConfigurado(db) || !c.suyo || ahora - ultimo >= VENTANA || !texto.trim()) return false
  await mandarTexto(db, c.suyo, texto.replace(/\s*\[#\d+\]/g, '').trim())
  return true
}
