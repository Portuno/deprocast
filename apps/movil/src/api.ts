/**
 * La conexión con tu Deprocast (plan v33). El servidor y el token del dispositivo (dpd_…) viven en el almacén seguro del
 * teléfono (Keychain en iPhone, Keystore en Android), nunca en el código ni en SQLite.
 */
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

export type Credenciales = { servidor: string; token: string; nombre: string }
export type MensajeRemoto = { id: number; rol: 'operador' | 'asistente'; texto: string; en: number }
export type PaqueteHoy = { dispositivo: string; conversacion: number; mensajes: MensajeRemoto[]; paraValidar: number }

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
  const r = await fetch(`${c.servidor}/api/dispositivo/${ruta}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(c.token ? { authorization: `Bearer ${c.token}` } : {}), ...(init.headers as Record<string, string> ?? {}) },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `Deprocast respondió ${r.status}`)
  return j as T
}

/** Vincular este teléfono con el código de 6 dígitos que da Deprocast (Apps conectadas → 📱 Tus dispositivos). */
export async function vincular(servidor: string, codigo: string, nombre: string): Promise<Credenciales> {
  const s = normalizarServidor(servidor)
  const r = await pedir<{ token: string; dispositivo: { nombre: string } }>({ servidor: s }, 'vincular', {
    method: 'POST', body: JSON.stringify({ codigo: codigo.replace(/\D/g, ''), nombre, plataforma: Platform.OS }),
  })
  const c = { servidor: s, token: r.token, nombre: r.dispositivo.nombre }
  await SecureStore.setItemAsync(CLAVE, JSON.stringify(c))
  return c
}

export const traerHoy = (c: Credenciales) => pedir<PaqueteHoy>(c, 'hoy')
export const mandarMensaje = (c: Credenciales, texto: string) => pedir<{ ok: true }>(c, 'mensaje', { method: 'POST', body: JSON.stringify({ texto }) })
