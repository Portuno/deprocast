/**
 * Las reglas de la sincronización (Deprocast Mobile 1.0), sin nada de React Native: se prueban desde el repo.
 *
 * - claseDe: qué hacer con la respuesta de un envío. Un corte de red o un 5xx se reintenta; un 4xx que no tiene arreglo
 *   (un tramo sin voz, un pedido mal armado) se descarta, para que un ítem roto no trabe la cola para siempre; un 401 es
 *   que el teléfono perdió la sesión.
 * - unaALaVez: si se pide sincronizar mientras ya está sincronizando, se espera esa misma (antes corrían dos a la vez y
 *   un mensaje en cola podía salir dos veces).
 * - esMasNuevo: lo que llega del servidor no pisa algo más nuevo que ya hay.
 * - espera: cuánto esperar entre reintentos, creciendo (5 s, 10, 20… hasta 2 min).
 */

export type Clase = 'ok' | 'reintentar' | 'descartar' | 'sin_sesion'

/** status null = no hubo respuesta (sin red, timeout). */
export function claseDe(status: number | null): Clase {
  if (status == null) return 'reintentar'
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401 || status === 403) return 'sin_sesion'
  if (status === 408 || status === 425 || status === 429) return 'reintentar'
  if (status >= 400 && status < 500) return 'descartar'
  return 'reintentar'
}

export function unaALaVez<A extends unknown[], T>(f: (...a: A) => Promise<T>): (...a: A) => Promise<T> {
  let enCurso: Promise<T> | null = null
  return (...a: A) => {
    if (enCurso) return enCurso
    enCurso = f(...a).finally(() => { enCurso = null })
    return enCurso
  }
}

export function esMasNuevo(nuevo: number | null | undefined, actual: number | null | undefined): boolean {
  if (nuevo == null) return true // un servidor viejo que no la manda: se acepta (como antes)
  if (actual == null) return true
  return nuevo >= actual
}

export function espera(fallas: number): number {
  return Math.min(120_000, 5_000 * 2 ** Math.max(0, fallas - 1))
}

/** Cuándo «Actualizado» deja de ser reciente (para la pantalla): más de 2 minutos sin sincronizar con la app abierta. */
export const VIEJO_MS = 120_000

/** Una clave única para un envío (un tramo, un mensaje): la hora más un azar. Sirve para que el servidor no duplique. */
export function claveNueva(ahora = Date.now(), azar = Math.random): string {
  return `${ahora.toString(36)}-${Math.floor(azar() * 36 ** 6).toString(36).padStart(6, '0')}`
}
