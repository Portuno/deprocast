/**
 * La conexión con tu Deprocast (plan v33). El servidor y el token del dispositivo (dpd_…) viven en el almacén seguro del
 * teléfono (Keychain en iPhone, Keystore en Android), nunca en el código ni en SQLite.
 */
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

export type Credenciales = { servidor: string; token: string; nombre: string }
export type MensajeRemoto = { id: number; rol: 'operador' | 'asistente'; texto: string; en: number }
export type PaqueteHoy = { dispositivo: string; estado?: string; conversacion: number; mensajes: MensajeRemoto[]; paraValidar: number; servidorEn?: number; marca?: string }

/** Un error de Deprocast con su código (null = no hubo respuesta: sin red o se cortó por tiempo). */
export class ErrorApi extends Error {
  constructor(mensaje: string, readonly status: number | null) { super(mensaje) }
}

/** Un fetch que no se queda colgado: sin respuesta en ms, se corta (antes un pedido colgado congelaba Hoy). */
async function conTiempo(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...init, signal: ctrl.signal }) } catch (e) { throw new ErrorApi(ctrl.signal.aborted ? 'Deprocast no contestó a tiempo' : `Sin conexión: ${e instanceof Error ? e.message : String(e)}`, null) } finally { clearTimeout(t) }
}

const CLAVE = 'deprocast.credenciales'

export async function leerCredenciales(): Promise<Credenciales | null> {
  const s = await SecureStore.getItemAsync(CLAVE)
  try { return s ? (JSON.parse(s) as Credenciales) : null } catch { return null }
}
export const olvidarCredenciales = () => SecureStore.deleteItemAsync(CLAVE)

/** El servidor como lo escribió (con o sin https://, con o sin barra final). */
export function normalizarServidor(s: string): string {
  const x = s.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(x) ? x : `https://${x}`
}

async function pedir<T>(c: Pick<Credenciales, 'servidor' | 'token'> | { servidor: string; token?: string }, ruta: string, init: RequestInit = {}): Promise<T> {
  const r = await conTiempo(`${c.servidor}/api/dispositivo/${ruta}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(c.token ? { authorization: `Bearer ${c.token}` } : {}), ...(init.headers as Record<string, string> ?? {}) },
  }, 20_000)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ErrorApi(j.error ?? `Deprocast respondió ${r.status}`, r.status)
  return j as T
}

/** Vincular este teléfono con el código de 6 dígitos que da Deprocast (Apps conectadas → 📱 Tus dispositivos). */
export async function vincular(servidor: string, codigo: string, nombre: string): Promise<Credenciales> {
  const s = normalizarServidor(servidor)
  const r = await pedir<{ token: string; dispositivo: { nombre: string } }>({ servidor: s }, 'vincular', {
    method: 'POST', body: JSON.stringify({ codigo: codigo.replace(/\D/g, ''), nombre, plataforma: Platform.OS, tipo: 'telefono' }),
  })
  const c = { servidor: s, token: r.token, nombre: r.dispositivo.nombre }
  await SecureStore.setItemAsync(CLAVE, JSON.stringify(c))
  return c
}

export const traerHoy = (c: Credenciales) => pedir<PaqueteHoy>(c, 'hoy')
/** La marca barata de «algo cambió en Hoy»: se pregunta cada 5 s con la app abierta. */
export const traerMarca = (c: Credenciales) => pedir<{ marca: string; servidorEn: number }>(c, 'cambio')

/** id: la clave del tramo (el servidor no lo procesa dos veces si el teléfono reintenta). inicio y fin: hora del teléfono. */
export type MetaVoz = { modo: 'dictado' | 'pasivo' | 'conversacion'; inicio: number; fin: number; caminando: boolean; id?: string; recuperado?: boolean }
export type Hablante = { id: number; etiqueta: string; entidadId: number | null; nombre: string | null; tramos: number }
export type Turno = { id: number; hablante: Hablante | null; texto: string; inicio: number; fin: number | null; modo: string }
/** Un tramo de tu voz (WAV): Deprocast lo transcribe y lo descarta. Devuelve el texto y a dónde fue. */
export async function subirVoz(c: Credenciales, uri: string, m: MetaVoz): Promise<{ texto: string; destino: 'chat' | 'nota' | 'conversacion'; hablante?: Hablante | null }> {
  const { File } = await import('expo-file-system')
  const q = new URLSearchParams({ modo: m.modo, inicio: String(m.inicio), fin: String(m.fin), caminando: m.caminando ? '1' : '0', nombre: 'voz.wav', ...(m.id ? { id: m.id } : {}) })
  const r = await conTiempo(`${c.servidor}/api/dispositivo/voz?${q}`, { method: 'POST', headers: { authorization: `Bearer ${c.token}`, 'content-type': 'audio/wav' }, body: new File(uri) }, 120_000)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ErrorApi(j.error ?? `Deprocast respondió ${r.status}`, r.status)
  return j
}
/** Lo último que se dijo (con su hablante) y los hablantes que conoce. */
export const traerTurnos = (c: Credenciales, desde = 0) => pedir<{ turnos: Turno[]; hablantes: Hablante[] }>(c, `turnos?desde=${desde}`)
export const buscarPersonas = (c: Credenciales, q: string) => pedir<{ personas: { id: number; nombre: string; tipo: string }[] }>(c, `personas?q=${encodeURIComponent(q)}`)
/** Ponerle nombre a una voz: una persona de tus entidades, o vos («yo»). */
export const vincularHablante = (c: Credenciales, id: number, a: { entidadId?: number | null; yo?: boolean }) => pedir<Hablante>(c, `hablantes/${id}`, { method: 'POST', body: JSON.stringify(a) })
export const olvidarHablante = (c: Credenciales, id: number) => pedir<{ ok: true }>(c, `hablantes/${id}/olvidar`, { method: 'POST', body: '{}' })
/** id: la clave del mensaje en la cola (un reintento no lo manda dos veces); en: cuándo lo escribiste (hora del teléfono). */
export const mandarMensaje = (c: Credenciales, texto: string, o: { id?: string; en?: number } = {}) => pedir<{ ok: true; repetido?: boolean }>(c, 'mensaje', { method: 'POST', body: JSON.stringify({ texto, ...o }) })

/** Un minuto de tu día en capas (plan v38, fase 6): solo números, nunca audio. */
export type MinutoCapa = {
  minuto: number; hablo: number; escucho: number; ruido: number; silencio: number
  vozDb: number | null; vozCercaDb: number | null; pisoDb: number | null; pasos: number; caminando: number
  lat: number | null; lon: number | null; precision: number | null
}
export const subirCapas = (c: Credenciales, minutos: MinutoCapa[]) => pedir<{ guardados: number }>(c, 'capas', { method: 'POST', body: JSON.stringify({ minutos }) })

/** El rescate (plan v38, fase 6): inventario → subir cada ítem crudo → cerrar. Nada se procesa antes de estar a salvo. */
export type ItemRescate = { clave: string; tipo: 'audio' | 'foto' | 'nota' | 'contactos' | 'mensaje' | 'archivo'; nombre: string; bytes?: number; fecha?: number; meta?: Record<string, unknown> }
export type EstadoRescate = { estado?: string; total: number; faltan: string[]; aSalvo: number; procesados: number }
export const estadoRescate = (c: Credenciales) => pedir<EstadoRescate>(c, 'rescate')
export const inventariar = (c: Credenciales, items: ItemRescate[]) => pedir<EstadoRescate>(c, 'rescate', { method: 'POST', body: JSON.stringify({ items }) })
export const cerrarRescate = (c: Credenciales) => pedir<EstadoRescate & { estado: 'activo' }>(c, 'rescate/cerrar', { method: 'POST', body: '{}' })
/** Sube un ítem crudo: un archivo del teléfono (uri) o un texto. */
export async function subirItem(c: Credenciales, clave: string, cuerpo: { uri: string } | { texto: string }, tipo = 'application/octet-stream') {
  const body = 'uri' in cuerpo ? new (await import('expo-file-system')).File(cuerpo.uri) : cuerpo.texto
  const r = await fetch(`${c.servidor}/api/dispositivo/rescate/subir?clave=${encodeURIComponent(clave)}`, { method: 'POST', headers: { authorization: `Bearer ${c.token}`, 'content-type': 'uri' in cuerpo ? tipo : 'text/plain; charset=utf-8' }, body })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `Deprocast respondió ${r.status}`)
  return j as { clave: string; estado: string }
}
