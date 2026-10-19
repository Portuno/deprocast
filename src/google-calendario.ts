/**
 * Google Calendar ida y vuelta con una cuenta de servicio: sin OAuth, sin dependencias y sin que Deprocast vea su
 * contraseña. Él crea la cuenta de servicio en Google Cloud, comparte su calendario con el mail de esa cuenta («Hacer
 * cambios en los eventos») y pone en el .env de la nube:
 *   GOOGLE_CUENTA_SERVICIO = el .json de la clave (tal cual o en base64)
 *   GOOGLE_CALENDARIO_ID   = su calendario (su gmail)
 * El acceso es un JWT firmado con la clave (RS256, node:crypto) que Google cambia por un token de una hora.
 */
import crypto from 'node:crypto'
import { zonaActual } from './zona.ts'

type Cuenta = { client_email: string; private_key: string; token_uri?: string }
/** Un evento de Google, en lo que Deprocast necesita. deDeprocast: «origen:id» si lo creó Deprocast. */
export type EventoGoogle = { id: string; titulo: string; inicio: number; fin: number; todoElDia: boolean; lugar: string | null; descripcion: string | null; url: string | null; deDeprocast: string | null }
/** Lo que se manda para crear o cambiar: fecha YYYY-MM-DD, hora HH:MM (sin hora = todo el día). */
export type DatosEvento = { titulo?: string; fecha?: string; hora?: string | null; duracionMin?: number | null; lugar?: string | null; descripcion?: string | null; deDeprocast?: string | null }

const ALCANCE = 'https://www.googleapis.com/auth/calendar'
const API = 'https://www.googleapis.com/calendar/v3'

function cuenta(): Cuenta | null {
  const v = process.env.GOOGLE_CUENTA_SERVICIO?.trim()
  if (!v) return null
  for (const texto of [v, (() => { try { return Buffer.from(v, 'base64').toString('utf8') } catch { return '' } })()]) {
    try {
      const j = JSON.parse(texto)
      if (j?.client_email && j?.private_key) return { client_email: j.client_email, private_key: String(j.private_key).replace(/\\n/g, '\n'), token_uri: j.token_uri }
    } catch { /* probar el siguiente */ }
  }
  return null
}
const calendarioId = () => process.env.GOOGLE_CALENDARIO_ID?.trim() || null
/** ¿Está conectado su calendario (ida y vuelta)? */
export const googleConectado = () => !!cuenta() && !!calendarioId()
/** El mail de la cuenta de servicio (para decirle con quién compartir el calendario). */
export const mailDeLaCuenta = () => cuenta()?.client_email ?? null

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

/** El JWT que se cambia por un token (exportado para el test: se valida con la clave pública). */
export function firmarJwt(c: Cuenta, ahora = Date.now()): string {
  const iat = Math.floor(ahora / 1000)
  const cabeza = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const cuerpo = b64url(JSON.stringify({ iss: c.client_email, scope: ALCANCE, aud: c.token_uri ?? 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }))
  const firma = crypto.sign('RSA-SHA256', Buffer.from(`${cabeza}.${cuerpo}`), c.private_key)
  return `${cabeza}.${cuerpo}.${b64url(firma)}`
}

let pedir: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
let token: { valor: string; vence: number } | null = null
export function _probarGoogle(f: typeof pedir) {
  pedir = f
  token = null
}

async function tokenDeAcceso(ahora = Date.now()): Promise<string> {
  if (token && token.vence > ahora + 60_000) return token.valor
  const c = cuenta()
  if (!c) throw new Error('Google Calendar no está conectado (falta GOOGLE_CUENTA_SERVICIO)')
  const r = await pedir(c.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: firmarJwt(c, ahora) }).toString(),
  })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error(`Google no dio acceso: ${j.error_description ?? j.error ?? r.status}`)
  token = { valor: j.access_token, vence: ahora + (Number(j.expires_in) || 3600) * 1000 }
  return token.valor
}

async function api(metodo: string, ruta: string, cuerpo?: unknown): Promise<any> {
  const id = calendarioId()
  if (!id) throw new Error('Google Calendar no está conectado (falta GOOGLE_CALENDARIO_ID)')
  for (let intento = 0; ; intento++) {
    const r = await pedir(`${API}/calendars/${encodeURIComponent(id)}${ruta}`, {
      method: metodo, headers: { authorization: `Bearer ${await tokenDeAcceso()}`, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    })
    if (r.status === 401 && intento === 0) { token = null; continue }
    if (r.status === 204 || (metodo === 'DELETE' && r.status === 410)) return null
    const j: any = await r.json().catch(() => ({}))
    if (!r.ok) {
      const m = j?.error?.message ?? `respondió ${r.status}`
      throw new Error(r.status === 404 || r.status === 403 ? `Google Calendar: ${m} (¿compartiste el calendario con ${mailDeLaCuenta()} con permiso para hacer cambios?)` : `Google Calendar: ${m}`)
    }
    return j
  }
}

/** Medianoche local de un día YYYY-MM-DD (en la zona del servidor, que es la del operador). */
const medianoche = (dia: string) => { const [a, m, d] = dia.split('-').map(Number); return new Date(a, m - 1, d).getTime() }
const diaSiguiente = (dia: string) => { const [a, m, d] = dia.split('-').map(Number); const x = new Date(a, m - 1, d + 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

function deGoogle(e: any): EventoGoogle | null {
  if (!e?.id || e.status === 'cancelled') return null
  const todoElDia = !!e.start?.date
  const inicio = todoElDia ? medianoche(e.start.date) : Date.parse(e.start?.dateTime ?? '')
  const fin = todoElDia ? medianoche(e.end?.date ?? diaSiguiente(e.start.date)) : Date.parse(e.end?.dateTime ?? e.start?.dateTime ?? '')
  if (!Number.isFinite(inicio)) return null
  return { id: e.id, titulo: e.summary ?? '(sin título)', inicio, fin: Number.isFinite(fin) ? fin : inicio + 3_600_000, todoElDia, lugar: e.location ?? null, descripcion: e.description ?? null, url: e.htmlLink ?? null, deDeprocast: e.extendedProperties?.private?.deprocast ?? null }
}

/** Los eventos entre dos días (YYYY-MM-DD, ambos incluidos), con las repeticiones desplegadas. */
export async function listarGoogle(desde: string, hasta: string): Promise<EventoGoogle[]> {
  const q = new URLSearchParams({ timeMin: new Date(medianoche(desde)).toISOString(), timeMax: new Date(medianoche(diaSiguiente(hasta))).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' })
  const out: EventoGoogle[] = []
  let pagina: string | undefined
  do {
    if (pagina) q.set('pageToken', pagina)
    const j = await api('GET', `/events?${q.toString()}`)
    for (const e of j?.items ?? []) { const x = deGoogle(e); if (x) out.push(x) }
    pagina = j?.nextPageToken
  } while (pagina)
  return out
}

/** El cuerpo de Google para lo que se manda (solo lo que vino: sirve para crear y para cambiar). */
function cuerpoDe(d: DatosEvento, base?: EventoGoogle | null): Record<string, unknown> {
  const b: Record<string, any> = {}
  if (d.titulo != null) b.summary = d.titulo
  if (d.lugar !== undefined) b.location = d.lugar ?? ''
  if (d.descripcion !== undefined) b.description = d.descripcion ?? ''
  if (d.deDeprocast) b.extendedProperties = { private: { deprocast: d.deDeprocast } }
  if (d.fecha || d.hora !== undefined || d.duracionMin != null) {
    const fecha = d.fecha ?? (base ? new Date(base.inicio).toISOString().slice(0, 10) : null)
    if (!fecha) throw new Error('Falta la fecha')
    const hora = d.hora === undefined ? (base && !base.todoElDia ? new Date(base.inicio).toTimeString().slice(0, 5) : null) : d.hora
    if (!hora) {
      b.start = { date: fecha }
      b.end = { date: diaSiguiente(fecha) }
    } else {
      const dur = d.duracionMin ?? (base && !base.todoElDia ? Math.round((base.fin - base.inicio) / 60_000) : 60)
      const [h, m] = hora.split(':').map(Number)
      const fin = new Date(medianoche(fecha) + (h * 60 + m + dur) * 60_000)
      const local = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}:00`
      b.start = { dateTime: `${fecha}T${hora}:00`, timeZone: zonaActual() }
      b.end = { dateTime: local(fin), timeZone: zonaActual() }
    }
  }
  return b
}

export async function crearGoogle(d: DatosEvento & { titulo: string; fecha: string }): Promise<EventoGoogle> {
  return deGoogle(await api('POST', '/events', cuerpoDe(d)))!
}
export async function leerGoogle(id: string): Promise<EventoGoogle | null> {
  return deGoogle(await api('GET', `/events/${encodeURIComponent(id)}`))
}
export async function editarGoogle(id: string, d: DatosEvento): Promise<EventoGoogle> {
  const base = d.fecha || d.hora !== undefined || d.duracionMin != null ? await leerGoogle(id) : null
  return deGoogle(await api('PATCH', `/events/${encodeURIComponent(id)}`, cuerpoDe(d, base)))!
}
export async function borrarGoogle(id: string): Promise<void> {
  await api('DELETE', `/events/${encodeURIComponent(id)}`)
}
