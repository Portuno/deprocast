/**
 * La conexión con tu Deprocast (plan v33). El servidor y el token del dispositivo (dpd_…) viven en el almacén seguro del
 * teléfono (Keychain en iPhone, Keystore en Android), nunca en el código ni en SQLite.
 */
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { servidorSeguro } from './logica/captura'

export type Credenciales = { servidor: string; token: string; nombre: string }
export type MensajeRemoto = { id: number; rol: 'operador' | 'asistente'; texto: string; en: number }
/** La actividad del día (Mobile 1.2): pasos, minutos caminando, km y la meta. */
export type Actividad = { fecha: string; pasos: number; meta: number; avance: number; minutosCaminando: number; km: number; fuente: string }
export type PaqueteHoy = { dispositivo: string; estado?: string; conversacion: number; mensajes: MensajeRemoto[]; paraValidar: number; servidorEn?: number; marca?: string; actividad?: Actividad | null; uso?: UsoHoy | null }
/** Mobile 1.3: el uso del teléfono de hoy (lo que ya sabe el servidor). */
export type UsoHoy = { pantallaMin: number; distraccionMin: number; desbloqueos: number; apps: { nombre: string; min: number; distraccion: boolean }[] }

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

/**
 * El servidor como lo escribió (con o sin https://, con o sin barra final). Solo por conexión cifrada (Mobile 1.0):
 * https siempre, salvo un servidor de tu red (tu compu).
 */
export function normalizarServidor(s: string): string {
  return servidorSeguro(s)
}

async function pedir<T>(c: Pick<Credenciales, 'servidor' | 'token'> | { servidor: string; token?: string }, ruta: string, init: RequestInit = {}): Promise<T> {
  const r = await conTiempo(`${servidorSeguro(c.servidor)}/api/dispositivo/${ruta}`, {
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
export type MetaVoz = { modo: 'dictado' | 'pasivo' | 'conversacion'; inicio: number; fin: number; caminando: boolean; id?: string; recuperado?: boolean; lat?: number; lon?: number }
export type Hablante = { id: number; etiqueta: string; entidadId: number | null; nombre: string | null; tramos: number }
export type Turno = { id: number; hablante: Hablante | null; texto: string; inicio: number; fin: number | null; modo: string }
/** Un tramo de tu voz (WAV): Deprocast lo transcribe y lo descarta. Devuelve el texto y a dónde fue. */
export async function subirVoz(c: Credenciales, uri: string, m: MetaVoz): Promise<{ texto: string; destino: 'chat' | 'nota' | 'conversacion' | 'nada'; hablante?: Hablante | null }> {
  const { File } = await import('expo-file-system')
  const q = new URLSearchParams({ modo: m.modo, inicio: String(m.inicio), fin: String(m.fin), caminando: m.caminando ? '1' : '0', nombre: 'voz.wav', ...(m.id ? { id: m.id } : {}), ...(m.lat != null && m.lon != null ? { lat: String(m.lat), lon: String(m.lon) } : {}) })
  const r = await conTiempo(`${servidorSeguro(c.servidor)}/api/dispositivo/voz?${q}`, { method: 'POST', headers: { authorization: `Bearer ${c.token}`, 'content-type': 'audio/wav' }, body: new File(uri) }, 120_000)
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
  const r = await fetch(`${servidorSeguro(c.servidor)}/api/dispositivo/rescate/subir?clave=${encodeURIComponent(clave)}`, { method: 'POST', headers: { authorization: `Bearer ${c.token}`, 'content-type': 'uri' in cuerpo ? tipo : 'text/plain; charset=utf-8' }, body })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `Deprocast respondió ${r.status}`)
  return j as { clave: string; estado: string }
}

/** El recorrido (1.0.1): los puntos que anotó la pestaña Mapa (hora del teléfono), y el mapa de un día. */
export type PuntoMapa = { en: number; lat: number; lon: number; precision: number | null; fuente?: string }
export type ParadaMapa = { lat: number; lon: number; desde: number; hasta: number; minutos: number; lugar: string | null }
export type DiaMapa = { fecha: string; puntos: PuntoMapa[]; paradas: ParadaMapa[]; distanciaKm: number; fuentes: string[]; ultimo: PuntoMapa | null }
export const subirPuntos = (c: Credenciales, puntos: PuntoMapa[]) => pedir<{ guardados: number }>(c, 'puntos', { method: 'POST', body: JSON.stringify({ puntos }) })
export const traerMapa = (c: Credenciales, dia?: string) => pedir<DiaMapa>(c, `mapa${dia ? `?dia=${dia}` : ''}`)

// ─── Mobile 1.2: archivos, actividad, lugares y el mapa de un rango ─────

export type MetaArchivo = { id: string; nombre: string; tipo: string; nota?: string | null; en?: number | null; lat?: number | null; lon?: number | null }
/** Una foto o un video (crudo): Deprocast lo procesa de fondo y lo que resulta aparece en Hoy. Un reintento no lo duplica. */
export async function subirArchivo(c: Credenciales, uri: string, m: MetaArchivo): Promise<{ tipo: string; procesando?: boolean; repetido?: boolean }> {
  const { File } = await import('expo-file-system')
  const q = new URLSearchParams({ id: m.id, nombre: m.nombre, tipo: m.tipo, ...(m.nota ? { nota: m.nota } : {}), ...(m.en ? { en: String(m.en) } : {}), ...(m.lat != null && m.lon != null ? { lat: String(m.lat), lon: String(m.lon) } : {}) })
  const r = await conTiempo(`${servidorSeguro(c.servidor)}/api/dispositivo/archivo?${q}`, { method: 'POST', headers: { authorization: `Bearer ${c.token}`, 'content-type': m.tipo || 'application/octet-stream' }, body: new File(uri) }, 10 * 60_000)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ErrorApi(j.error ?? `Deprocast respondió ${r.status}`, r.status)
  return j
}
/** Los pasos que contó el teléfono, por día (el servidor se queda con el mayor). Devuelve la actividad de hoy. */
export const mandarPasos = (c: Credenciales, dias: { fecha: string; pasos: number }[], horas?: { hora: string; pasos: number }[]) => pedir<Actividad>(c, 'actividad', { method: 'POST', body: JSON.stringify({ dias, horas }) })
export type Frecuente = { lat: number; lon: number; dias: number; horas: number }
export const traerLugares = (c: Credenciales) => pedir<{ frecuentes: Frecuente[]; lugares: { id: number; nombre: string; lat: number; lon: number }[] }>(c, 'lugares')
export const guardarLugar = (c: Credenciales, l: { nombre: string; lat: number; lon: number }) => pedir<{ id: number; nombre: string }>(c, 'lugares', { method: 'POST', body: JSON.stringify(l) })
/** El recorrido de varios días (la semana, el mes). */
export const traerMapaRango = (c: Credenciales, desde: string, hasta: string) => pedir<DiaMapa & { desde: string; hasta: string; total: number }>(c, `mapa?desde=${desde}&hasta=${hasta}`)

// ─── Mobile 1.3: el uso del teléfono y los avisos ──────────────────────
export type DiaUsoApi = { fecha: string; pantallaMin: number; desbloqueos: number; apps: { paquete: string; nombre: string; min: number; aperturas: number }[]; sesiones?: [number, number][] }
export const subirUso = (c: Credenciales, dias: DiaUsoApi[]) => pedir<{ guardados: number }>(c, 'uso', { method: 'POST', body: JSON.stringify({ dias }) })
export type AvisoApi = { clave: string; titulo: string; cuerpo: string; en: number }
/** Fragua #296: los avisos de las apps de pago y banco que guardó el teléfono. */
export const mandarAvisosPago = (c: Credenciales, avisos: { paquete: string; app: string; titulo: string; texto: string; en: number }[]) => pedir<{ recibidos: number; sugeridos: number }>(c, 'pagos', { method: 'POST', body: JSON.stringify({ avisos }) })
// Validar en 5 minutos: la tanda de tarjetas (lo que más pesa de «Para validar») y el sí o no de cada una.
export type Tarjeta = { tipo: string; id: number | string; grupo: string; texto: string; sub: string | null; si: string; no: string }
export const traerTanda = (c: Credenciales, n = 10) => pedir<{ total: number; tarjetas: Tarjeta[] }>(c, `validar?n=${n}`)
export const responderTarjeta = (c: Credenciales, t: Pick<Tarjeta, 'tipo' | 'id'>, accion: 'aceptar' | 'descartar') => pedir<{ ok: true }>(c, 'validar', { method: 'POST', body: JSON.stringify({ tipo: t.tipo, id: t.id, accion }) })
export const traerAvisos = (c: Credenciales) => pedir<{ minutosAntes: number; avisos: AvisoApi[]; ahora?: { titulo: string; sub: string }; paraValidar?: number }>(c, 'avisos')

// ─── Mobile 2.0: lo adjunto en la charla y los lugares con su tipo ──────
/** La dirección de un adjunto del chat (una foto, un PDF) y la cabecera con el token: el teléfono no tiene la clave. */
export const urlAdjunto = (c: Credenciales, archivo: string, ancho?: number) => `${servidorSeguro(c.servidor)}/api/dispositivo/adjunto/${encodeURIComponent(archivo)}${ancho ? `?ancho=${ancho}` : ''}`
export const cabeceraDe = (c: Credenciales) => ({ authorization: `Bearer ${c.token}` })
export type TipoLugar = 'casa' | 'trabajo' | 'empresa' | 'destino' | 'frecuente' | 'otro'
export type LugarPropio = { id: number; nombre: string; lat: number; lon: number; tipo: TipoLugar | null }
export const traerLugaresPropios = (c: Credenciales) => pedir<{ frecuentes: Frecuente[]; lugares: LugarPropio[] }>(c, 'lugares')
export const marcarLugar = (c: Credenciales, l: { nombre: string; lat: number; lon: number; tipo: TipoLugar }) => pedir<{ id: number; nombre: string; tipo: TipoLugar | null }>(c, 'lugares', { method: 'POST', body: JSON.stringify(l) })
