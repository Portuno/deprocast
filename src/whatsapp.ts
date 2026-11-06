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

/** El formato de WhatsApp: *negrita*, _cursiva_, sin encabezados de Markdown. */
export function aWhatsapp(t: string): string {
  return t
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
export async function mandarTexto(db: Db, para: string, texto: string, botones?: Botones) {
  const c = cfg(db)
  const partes = pedazos(aWhatsapp(texto))
  const planos = (botones ?? []).flat().filter((b) => b.texto && b.dato).slice(0, 10)
  for (const [i, p] of partes.entries()) {
    const ultimo = i === partes.length - 1
    if (ultimo && planos.length) {
      const interactivo = planos.length <= 3
        ? { type: 'button', body: { text: p.slice(0, 1024) }, action: { buttons: planos.map((b) => ({ type: 'reply', reply: { id: b.dato.slice(0, 256), title: b.texto.slice(0, 20) } })) } }
        : { type: 'list', body: { text: p.slice(0, 4096) }, action: { button: 'Opciones', sections: [{ title: 'Elegí', rows: planos.map((b) => ({ id: b.dato.slice(0, 200), title: b.texto.slice(0, 24) })) }] } }
      await graph(db, `${c.numeroId}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'interactive', interactive: interactivo }) })
    } else {
      await graph(db, `${c.numeroId}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: p, preview_url: false } }) })
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
function canal(db: Db, para: string, mensajeId: string): Canal {
  return {
    nombre: 'WhatsApp',
    decir: async (texto, botones) => { await mandarTexto(db, para, texto, botones); return null },
    bajar: (id) => bajarMedio(db, id),
    // Leído y «escribiendo…» (dura hasta la respuesta, o 25 s).
    escribiendo: () => graph(db, `${cfg(db).numeroId}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: mensajeId, typing_indicator: { type: 'text' } }) }).catch(() => {}),
    audio: async (datos, _titulo, texto) => {
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
export function aTelegram(m: any): any | null {
  const chat = { id: 'whatsapp' }
  switch (m.type) {
    case 'text': return { message: { chat, text: m.text?.body ?? '' } }
    case 'audio': return { message: { chat, voice: { file_id: m.audio.id, file_unique_id: m.audio.id } } }
    case 'image': return { message: { chat, photo: [{ file_id: m.image.id }], caption: m.image.caption } }
    case 'document': return { message: { chat, document: { file_id: m.document.id, file_name: m.document.filename ?? 'archivo', mime_type: m.document.mime_type }, caption: m.document.caption } }
    case 'interactive': {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply
      return r ? { callback_query: { id: m.id, data: r.id, message: { chat } } } : null
    }
    case 'button': return { message: { chat, text: m.button?.text ?? m.button?.payload ?? '' } }
    default: return null
  }
}

/** Por remitente, de a uno (que las respuestas salgan en orden). */
const colas = new Map<string, Promise<unknown>>()

/** Lo que manda Meta al webhook (ya verificada la firma). Devuelve cuántos mensajes atendió. */
export async function recibirWebhook(db: Db, cuerpo: any, ahora = Date.now()): Promise<number> {
  let n = 0
  const tareas: Promise<unknown>[] = []
  for (const e of cuerpo?.entry ?? []) {
    for (const ch of e.changes ?? []) {
      const v = ch.value ?? {}
      if (v.metadata?.phone_number_id && v.metadata.phone_number_id !== cfg(db).numeroId) continue // otro número
      for (const m of v.messages ?? []) {
        // Meta reintenta: cada mensaje, una sola vez.
        if (db.prepare('INSERT OR IGNORE INTO whatsapp_vistos (id, en) VALUES (?, ?)').run(String(m.id), ahora).changes === 0) continue
        const de = String(m.from ?? '')
        const c = cfg(db)
        if (!c.suyo) {
          // Sin vincular: solo el código de su perfil lo vincula. A los demás, nada.
          if (m.type === 'text' && c.codigo && m.text?.body?.replace(/\D/g, '').includes(c.codigo)) {
            fijarAjuste(db, 'whatsapp_wa_id', de)
            fijarAjuste(db, 'whatsapp_codigo', '')
            fijarAjuste(db, 'whatsapp_ultimo_entrante', String(ahora))
            tareas.push(mandarTexto(db, de, '☿ Listo, quedamos vinculados. Escribime, mandame audios o fotos como en Telegram: soy Mastropiero.').catch((e2) => console.error('  whatsapp:', e2 instanceof Error ? e2.message : e2)))
            n++
          }
          continue
        }
        if (de !== c.suyo) continue // otro número: silencio
        fijarAjuste(db, 'whatsapp_ultimo_entrante', String(ahora))
        const u = aTelegram(m)
        n++
        const atender = async () => {
          if (!u) return mandarTexto(db, de, 'Ese tipo de mensaje todavía no lo entiendo: mandame texto, un audio, una foto o un archivo.')
          return conCanal(canal(db, de, String(m.id)), () => procesarActualizacion(db, u))
        }
        const previa = colas.get(de) ?? Promise.resolve()
        const sigue = previa.then(atender).catch((e2) => {
          console.error('  whatsapp:', e2 instanceof Error ? e2.message : e2)
          return mandarTexto(db, de, `Se me trabó algo: ${e2 instanceof Error ? e2.message : e2}`).catch(() => {})
        })
        colas.set(de, sigue)
        tareas.push(sigue)
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
