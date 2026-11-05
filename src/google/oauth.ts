/**
 * La conexión con Google (plan v35, fase 1): OAuth una sola vez y para todo el entorno (Gmail, Drive, Calendar,
 * contactos y tareas), así cada fase nueva no pide volver a conectar.
 *
 * Él crea un cliente OAuth («Aplicación web») en Google Cloud, con la URI de redirección <su Deprocast>/google/volver,
 * y pega el JSON que baja de ahí en su perfil (queda en su base; no hace falta reiniciar la nube). También vale por
 * variables del servicio: GOOGLE_OAUTH_ID y GOOGLE_OAUTH_SECRETO. Deprocast guarda el permiso duradero (refresh token) en SU
 * base (cada usuario conecta su propio Google) y renueva el acceso solo. Sin dependencias: fetch y JSON.
 */
import crypto from 'node:crypto'
import { ajuste, fijarAjuste, type Db } from '../db.ts'

export const ALCANCES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/tasks',
]
const AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const REVOCAR = 'https://oauth2.googleapis.com/revoke'

let red: typeof fetch = (...a) => fetch(...a)
/** Para los tests: Google simulado. */
export function _probarGoogle(f: typeof fetch) { red = f; accesos = new WeakMap() }

/** El cliente OAuth: el que pegó en su perfil o, si no, el de las variables del servicio. */
export function clienteGoogle(db: Db | null) {
  const id = (db && ajuste(db, 'google_cliente_id')) || process.env.GOOGLE_OAUTH_ID?.trim()
  const secreto = (db && ajuste(db, 'google_cliente_secreto')) || process.env.GOOGLE_OAUTH_SECRETO?.trim()
  return id && secreto ? { id, secreto } : null
}
const cliente = (db: Db) => clienteGoogle(db)
export const googleConfigurado = (db: Db) => !!cliente(db)

/**
 * Guarda el cliente desde el JSON que da Google Cloud ({"web": {"client_id", "client_secret", "redirect_uris"}}) o
 * desde el ID y el secreto sueltos. Avisa si la URI de redirección registrada no es la de este Deprocast.
 */
export function guardarCliente(db: Db, entrada: { json?: string; id?: string; secreto?: string }, origen?: string) {
  let id = entrada.id?.trim() ?? ''
  let secreto = entrada.secreto?.trim() ?? ''
  let uris: string[] = []
  if (entrada.json?.trim()) {
    let j: any
    try { j = JSON.parse(entrada.json) } catch { throw new Error('Eso no es un JSON válido: pegá el archivo que bajaste de Google Cloud tal cual.') }
    const c = j.web ?? j.installed ?? j
    id = String(c.client_id ?? '')
    secreto = String(c.client_secret ?? '')
    uris = Array.isArray(c.redirect_uris) ? c.redirect_uris.map(String) : []
    if (j.installed) throw new Error('Ese cliente es de «App de escritorio»: hace falta uno de «Aplicación web».')
  }
  if (!/\.apps\.googleusercontent\.com$/.test(id) || secreto.length < 10) throw new Error('Falta el ID de cliente (termina en .apps.googleusercontent.com) o el secreto.')
  fijarAjuste(db, 'google_cliente_id', id)
  fijarAjuste(db, 'google_cliente_secreto', secreto)
  const esperada = origen ? `${origen}/google/volver` : null
  return { ok: true, id, aviso: esperada && uris.length && !uris.includes(esperada) ? `En Google Cloud, la URI de redirección registrada no es ${esperada}: agregala en el cliente o la conexión va a fallar.` : null }
}
export const googleConectado = (db: Db) => !!ajuste(db, 'google_refresh')

export function estadoGoogle(db: Db) {
  return {
    configurado: googleConfigurado(db),
    clientePropio: !!ajuste(db, 'google_cliente_id'),
    conectado: googleConectado(db),
    email: ajuste(db, 'google_email'),
    desde: Number(ajuste(db, 'google_desde')) || null,
    alcances: (ajuste(db, 'google_alcances') ?? '').split(' ').filter(Boolean),
    error: ajuste(db, 'google_error'),
  }
}

/** El link para conectar: a Google, que vuelve a <origen>/google/volver con un código de un solo uso. */
export function urlDeConexion(db: Db, origen: string, ahora = Date.now()): string {
  const c = cliente(db)
  if (!c) throw new Error('Falta configurar Google: pegá el JSON del cliente en tu perfil.')
  const estado = crypto.randomBytes(24).toString('base64url')
  fijarAjuste(db, 'google_estado', JSON.stringify({ estado, vence: ahora + 10 * 60_000, origen }))
  const q = new URLSearchParams({
    client_id: c.id, redirect_uri: `${origen}/google/volver`, response_type: 'code', scope: ALCANCES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: estado,
  })
  return `${AUTORIZAR}?${q}`
}

async function pedirToken(campos: Record<string, string>): Promise<any> {
  const r = await red(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campos), signal: AbortSignal.timeout(30_000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = new Error(`Google: ${j.error_description ?? j.error ?? r.status}`) as Error & { codigo?: string }
    e.codigo = j.error
    throw e
  }
  return j
}

/** La vuelta de Google: valida el estado (un solo uso, 10 min), cambia el código por los tokens y los guarda. */
export async function volverDeGoogle(db: Db, p: { code?: string | null; state?: string | null; error?: string | null }, ahora = Date.now()) {
  const guardado = (() => { try { return JSON.parse(ajuste(db, 'google_estado') ?? 'null') } catch { return null } })() as { estado: string; vence: number; origen: string } | null
  fijarAjuste(db, 'google_estado', '')
  if (p.error) throw new Error(p.error === 'access_denied' ? 'No diste el permiso en Google.' : `Google dijo: ${p.error}`)
  if (!guardado || !p.state || p.state !== guardado.estado || guardado.vence < ahora) throw new Error('El pedido de conexión venció o no es este. Probá conectar de nuevo.')
  const c = cliente(db)
  if (!c || !p.code) throw new Error('Falta el código de Google.')
  const t = await pedirToken({ code: p.code, client_id: c.id, client_secret: c.secreto, redirect_uri: `${guardado.origen}/google/volver`, grant_type: 'authorization_code' })
  if (!t.refresh_token) throw new Error('Google no dio un permiso duradero. Sacale el acceso a Deprocast en tu cuenta de Google y volvé a conectar.')
  let email: string | null = null
  try { email = JSON.parse(Buffer.from(String(t.id_token).split('.')[1], 'base64url').toString('utf8')).email ?? null } catch { /* sin id_token */ }
  fijarAjuste(db, 'google_refresh', t.refresh_token)
  fijarAjuste(db, 'google_email', email ?? '')
  fijarAjuste(db, 'google_alcances', String(t.scope ?? ''))
  fijarAjuste(db, 'google_desde', String(ahora))
  fijarAjuste(db, 'google_error', '')
  accesos.set(db, { token: t.access_token, vence: ahora + (Number(t.expires_in) || 3600) * 1000 })
  return { email }
}

let accesos = new WeakMap<Db, { token: string; vence: number }>()

/** Un acceso vigente (lo renueva con el permiso duradero si venció). */
export async function accesoGoogle(db: Db, forzar = false, ahora = Date.now()): Promise<string> {
  const ya = accesos.get(db)
  if (ya && !forzar && ya.vence - 60_000 > ahora) return ya.token
  const refresh = ajuste(db, 'google_refresh')
  const c = cliente(db)
  if (!refresh) throw new Error('Google no está conectado.')
  if (!c) throw new Error('Falta configurar Google (el JSON del cliente, en tu perfil).')
  try {
    const t = await pedirToken({ refresh_token: refresh, client_id: c.id, client_secret: c.secreto, grant_type: 'refresh_token' })
    accesos.set(db, { token: t.access_token, vence: ahora + (Number(t.expires_in) || 3600) * 1000 })
    return t.access_token
  } catch (e) {
    // Revocado o vencido: hay que volver a conectar (y se dice en la pantalla).
    if ((e as { codigo?: string }).codigo === 'invalid_grant') {
      fijarAjuste(db, 'google_refresh', '')
      fijarAjuste(db, 'google_error', 'Google pidió volver a conectar (se revocó o venció el permiso).')
    }
    throw e
  }
}

/** Un pedido a una API de Google, con el acceso puesto (y uno renovado si el primero ya no vale). */
export async function llamarGoogle<T = any>(db: Db, url: string, init: RequestInit = {}): Promise<T> {
  for (let intento = 0; ; intento++) {
    const token = await accesoGoogle(db, intento > 0)
    const r = await red(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) })
    if (r.status === 401 && intento === 0) continue
    const texto = await r.text()
    const j = texto ? (() => { try { return JSON.parse(texto) } catch { return texto } })() : null
    if (!r.ok) {
      const e = new Error(`Google ${r.status}: ${j?.error?.message ?? String(texto).slice(0, 200)}`) as Error & { status?: number }
      e.status = r.status
      throw e
    }
    return j as T
  }
}

export async function desconectarGoogle(db: Db) {
  const refresh = ajuste(db, 'google_refresh')
  if (refresh) await red(`${REVOCAR}?token=${encodeURIComponent(refresh)}`, { method: 'POST', signal: AbortSignal.timeout(15_000) }).catch(() => {})
  for (const k of ['google_refresh', 'google_email', 'google_alcances', 'google_desde', 'google_error', 'gmail_historia']) fijarAjuste(db, k, '')
  accesos.delete(db)
}
