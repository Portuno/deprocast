/**
 * El recorrido (Mobile 1.0.1): la ubicación va aparte de la escucha. Prendido desde la pestaña Mapa, anota por dónde
 * andás aunque la app esté cerrada (un servicio con aviso fijo, como la escucha), con un ritmo que se adapta solo:
 * quieto casi no marca (cada 25 m), caminando cada 30 s. Los puntos esperan en disco y salen con cada sincronización;
 * con «solo las paradas», el recorrido en movimiento no se sube (solo los lugares donde te quedaste 5 minutos o más).
 *
 * La tarea de fondo tiene que estar definida apenas arranca la app: este archivo se importa desde index.ts.
 */
import * as TaskManager from 'expo-task-manager'
import { baseLocal } from './almacen'
import { subirPuntos } from './api'
import { alSincronizar } from './sincronizar'
import { ajustesCaptura } from './captura'
import { capta, separarParadas } from './logica/captura'

export const TAREA = 'deprocast-recorrido'
type PuntoLocal = { en: number; lat: number; lon: number; precision: number | null }

/** El último punto que se anotó (para las capas de la escucha y para la pantalla), en memoria. */
let ultimo: PuntoLocal | null = null
export const ultimoPunto = () => ultimo

async function tabla() {
  const d = await baseLocal()
  await d.execAsync('CREATE TABLE IF NOT EXISTS puntos_cola (en INTEGER PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL, precision REAL)')
  return d
}
export async function guardarPuntosLocales(ps: PuntoLocal[]) {
  if (!ps.length) return
  const d = await tabla()
  await d.withTransactionAsync(async () => { for (const p of ps) await d.runAsync('INSERT OR IGNORE INTO puntos_cola (en, lat, lon, precision) VALUES (?, ?, ?, ?)', p.en, p.lat, p.lon, p.precision) })
  ultimo = ps.reduce((a, b) => (b.en > a.en ? b : a), ultimo ?? ps[0])
}
export async function puntosEnCola(): Promise<PuntoLocal[]> {
  return (await tabla()).getAllAsync<PuntoLocal>('SELECT en, lat, lon, precision FROM puntos_cola ORDER BY en')
}

// La tarea de fondo: Android le entrega las posiciones nuevas (aunque la app esté cerrada).
TaskManager.defineTask(TAREA, async ({ data, error }) => {
  if (error || !data) return
  const locations = (data as { locations?: { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number | null } }[] }).locations ?? []
  await guardarPuntosLocales(locations.map((l) => ({ en: Math.round(l.timestamp), lat: l.coords.latitude, lon: l.coords.longitude, precision: l.coords.accuracy ?? null }))).catch(() => {})
})

export async function recorridoPrendido(): Promise<boolean> {
  try { return await (await import('expo-location')).hasStartedLocationUpdatesAsync(TAREA) } catch { return false }
}

/**
 * Prende el recorrido. Pide la ubicación mientras se usa la app y, para que siga con la app cerrada, «todo el tiempo»
 * (en Android 11+ eso abre los ajustes del sistema). Devuelve qué pasó, en palabras.
 */
export async function prenderRecorrido(): Promise<{ ok: boolean; aviso: string | null }> {
  if (!capta(await ajustesCaptura(), 'ubicacion')) return { ok: false, aviso: 'La ubicación está apagada en Captura y permisos (⋯).' }
  const L = await import('expo-location')
  if (!(await L.requestForegroundPermissionsAsync()).granted) return { ok: false, aviso: 'Sin permiso de ubicación no puedo anotar el recorrido.' }
  const fondo = await L.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }))
  try {
    await L.startLocationUpdatesAsync(TAREA, {
      accuracy: L.Accuracy.Balanced, timeInterval: 30_000, distanceInterval: 25, deferredUpdatesInterval: 0,
      foregroundService: { notificationTitle: 'Deprocast anota tu recorrido', notificationBody: 'Se apaga desde la pestaña Mapa.', killServiceOnDestroy: false },
    })
  } catch (e) {
    return { ok: false, aviso: `No pude prender el recorrido: ${e instanceof Error ? e.message : String(e)}. Si te lo pidió, dale a la ubicación «Permitir todo el tiempo».` }
  }
  return { ok: true, aviso: fondo.granted ? null : 'Anoto mientras el aviso fijo esté en la barra. Para que siga aunque Android cierre la app, dale a la ubicación «Permitir todo el tiempo» en los ajustes.' }
}

export async function apagarRecorrido() {
  try { const L = await import('expo-location'); if (await L.hasStartedLocationUpdatesAsync(TAREA)) await L.stopLocationUpdatesAsync(TAREA) } catch { /* ya estaba apagado */ }
}

/**
 * Lo que sale con cada sincronización. Con «solo las paradas»: los puntos que forman una parada (5 minutos en 100 m)
 * se suben; los del recorrido en movimiento de hace más de 10 minutos se descartan sin subirse.
 */
export async function subirRecorrido(c: Parameters<typeof subirPuntos>[0]) {
  const ps = await puntosEnCola()
  if (!ps.length) return
  const d = await tabla()
  let aSubir = ps
  if ((await ajustesCaptura()).soloParadas) {
    const r = separarParadas(ps)
    if (r.descartar.length) await d.withTransactionAsync(async () => { for (const en of r.descartar) await d.runAsync('DELETE FROM puntos_cola WHERE en = ?', en) })
    const subir = new Set(r.subir)
    aSubir = ps.filter((p) => subir.has(p.en))
  }
  for (let i = 0; i < aSubir.length; i += 500) {
    const lote = aSubir.slice(i, i + 500)
    await subirPuntos(c, lote) // el servidor no duplica un mismo instante: reintentar es seguro
    await d.withTransactionAsync(async () => { for (const p of lote) await d.runAsync('DELETE FROM puntos_cola WHERE en = ?', p.en) })
  }
}

let registrado = false
export function registrarRecorrido() {
  if (registrado) return
  registrado = true
  alSincronizar(subirRecorrido)
}
