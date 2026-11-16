/**
 * Los pasos del día. Mobile 1.3: cuentan aunque la app esté cerrada, sin Health Connect. El teléfono lleva su propio
 * contador de pasos (de hardware, casi sin batería) con el total desde que se prendió; la app lo lee al abrirse, cada
 * vez que el sensor avisa que caminaste (con la app abierta, a lo sumo cada 15 s) y cada ~15 minutos en segundo plano
 * (la tarea de fondo, fondo.ts). Cada lectura suma la diferencia con la anterior, repartida por hora (logica/pasos.ts), y los
 * días salen con la sincronización (el servidor se queda con el mayor, así un reintento no suma de más).
 *
 * En una app sin el módulo nativo (o un teléfono sin ese contador) queda lo de 1.2: se cuenta solo mientras la app
 * está viva, con la librería de pasos de Expo.
 */
import { AppState } from 'react-native'
import { Pedometer } from 'expo-sensors'
import * as Contador from '../modules/contador-pasos'
import { fijarAjuste, leerAjuste, pasosDe, pasosPorHora, pasosRecientes, sumarPasos, sumarPasosPorHora } from './almacen'
import { mandarPasos, type Credenciales } from './api'
import { alSincronizar } from './sincronizar'
import { ajustesCaptura } from './captura'
import { capta } from './logica/captura'
import { contar, horasDelDia, type Lectura } from './logica/pasos'

const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

const MARCA = 'contador_pasos'

const escuchas = new Set<(pasos: number) => void>()
/** La pantalla se entera cuando suman pasos. */
export function alCambiarPasos(f: (pasos: number) => void): () => void { escuchas.add(f); return () => { escuchas.delete(f) } }
export const pasosDeHoy = () => pasosDe(hoy())
/** Las 24 horas de hoy (o de una fecha) con sus pasos. */
export const horasDeHoy = async (fecha = hoy()) => horasDelDia(fecha, await pasosPorHora(fecha))
/** Los últimos días con pasos (el más nuevo primero). */
export const ultimosDias = (n = 7) => pasosRecientes(n)
async function avisar() { const n = await pasosDe(hoy()); for (const f of escuchas) f(n) }

/** Si el teléfono tiene el contador y la app el módulo: cuenta aunque esté cerrada. */
export const cuentaConLaAppCerrada = () => Contador.disponible()

let leyendo: Promise<number> | null = null
/**
 * Lee el contador del teléfono y suma lo nuevo. Devuelve los pasos que sumó. Una sola lectura a la vez (la pantalla y
 * la tarea de fondo pueden pedir juntas).
 */
export function leerContador(): Promise<number> {
  leyendo ??= (async () => {
    try {
      const nueva = await Contador.leer()
      if (!nueva) return 0
      let prev: Lectura | null = null
      try { prev = JSON.parse((await leerAjuste(MARCA)) ?? 'null') } catch { prev = null }
      const r = contar(prev, nueva)
      await sumarPasosPorHora(r.reparto)
      await fijarAjuste(MARCA, JSON.stringify(nueva))
      if (r.pasos) await avisar()
      return r.pasos
    } finally { leyendo = null }
  })()
  return leyendo
}

let sub: { remove: () => void } | null = null
let ultimo: number | null = null
let ultimaLectura = 0
async function suscribir() {
  sub?.remove()
  ultimo = null
  const conContador = Contador.disponible()
  if (conContador) await leerContador()
  sub = Pedometer.watchStepCount((r) => {
    if (conContador) {
      // Con la app abierta, cada vez que caminás se relee el contador (a lo sumo cada 15 s): un solo origen, sin sumar dos veces.
      if (Date.now() - ultimaLectura > 15_000) { ultimaLectura = Date.now(); void leerContador() }
      return
    }
    // Sin el contador (1.2): el sensor da los pasos desde que se suscribió; se suma la diferencia con la lectura anterior.
    const delta = ultimo == null ? r.steps : r.steps - ultimo
    ultimo = r.steps
    if (delta > 0 && delta < 5000) void sumarPasos(hoy(), delta).then(avisar)
  })
}

let registrado = false
/** Prende el contador (si la captura de pasos está prendida y hay sensor y permiso). Devuelve un aviso o null. */
export async function registrarPasos(): Promise<string | null> {
  if (!capta(await ajustesCaptura(), 'pasos')) return null
  try {
    if (!(await Pedometer.isAvailableAsync()) && !Contador.disponible()) return 'Este teléfono no tiene sensor de pasos.'
    if (!(await Pedometer.requestPermissionsAsync()).granted) return 'Sin el permiso de actividad física no puedo contar pasos.'
  } catch { return null }
  await suscribir()
  if (registrado) return null
  registrado = true
  // Al volver a la app, el contador se relee y el sensor se rearma (Android lo puede haber pausado).
  AppState.addEventListener('change', (s) => { if (s === 'active') void suscribir() })
  alSincronizar(subirPasos)
  return null
}

export async function subirPasos(c: Credenciales) {
  const dias = await pasosRecientes(3)
  if (dias.length) await mandarPasos(c, dias)
}
