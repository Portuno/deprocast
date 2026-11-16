/**
 * Los pasos del día (Mobile 1.2). El sensor de pasos del teléfono cuenta mientras la app está viva (abierta, o con la
 * escucha o el recorrido prendidos, que la mantienen con su aviso fijo); cada paso nuevo se suma al día en el teléfono
 * y sale con la sincronización (el servidor se queda con el mayor, así un reintento no suma de más). Con la app
 * cerrada del todo no cuenta: para eso hará falta leerlos de Health Connect.
 */
import { AppState } from 'react-native'
import { Pedometer } from 'expo-sensors'
import { pasosDe, pasosRecientes, sumarPasos } from './almacen'
import { mandarPasos, type Credenciales } from './api'
import { alSincronizar } from './sincronizar'
import { ajustesCaptura } from './captura'
import { capta } from './logica/captura'

const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

let sub: { remove: () => void } | null = null
let ultimo: number | null = null
const escuchas = new Set<(pasos: number) => void>()
/** La pantalla se entera cuando suman pasos. */
export function alCambiarPasos(f: (pasos: number) => void): () => void { escuchas.add(f); return () => { escuchas.delete(f) } }
export const pasosDeHoy = () => pasosDe(hoy())

async function suscribir() {
  sub?.remove()
  ultimo = null
  // El sensor da los pasos desde que se suscribió: se suma la diferencia con la lectura anterior.
  sub = Pedometer.watchStepCount((r) => {
    const delta = ultimo == null ? r.steps : r.steps - ultimo
    ultimo = r.steps
    if (delta > 0 && delta < 5000) void sumarPasos(hoy(), delta).then(() => pasosDe(hoy())).then((n) => { for (const f of escuchas) f(n) })
  })
}

let registrado = false
/** Prende el contador (si la captura de pasos está prendida y hay sensor y permiso). Devuelve un aviso o null. */
export async function registrarPasos(): Promise<string | null> {
  if (!capta(await ajustesCaptura(), 'pasos')) return null
  try {
    if (!(await Pedometer.isAvailableAsync())) return 'Este teléfono no tiene sensor de pasos.'
    if (!(await Pedometer.requestPermissionsAsync()).granted) return 'Sin el permiso de actividad física no puedo contar pasos.'
  } catch { return null }
  await suscribir()
  if (registrado) return null
  registrado = true
  // Al volver a la app, el contador se rearma (Android lo puede haber pausado).
  AppState.addEventListener('change', (s) => { if (s === 'active') void suscribir() })
  alSincronizar(subirPasos)
  return null
}

export async function subirPasos(c: Credenciales) {
  const dias = await pasosRecientes(3)
  if (dias.length) await mandarPasos(c, dias)
}
