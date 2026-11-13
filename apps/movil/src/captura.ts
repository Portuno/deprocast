/**
 * La captura del teléfono (Mobile 1.0, bloque 4): los ajustes por función (con el interruptor que apaga todo) guardados
 * en el teléfono, y la batería y la red para decidir cuándo subir el audio. Las reglas están en logica/captura.
 */
import { fijarAjuste, leerAjuste } from './almacen'
import { decidirAudio } from './sincronizar'
import { leerAjustes, puedeSubirAudio, type Ajustes } from './logica/captura'

export async function ajustesCaptura(): Promise<Ajustes> {
  return leerAjustes(await leerAjuste('captura'))
}
export async function guardarAjustesCaptura(a: Ajustes) {
  await fijarAjuste('captura', JSON.stringify(a))
}

/** La batería y la red, ahora. Sin el módulo (una versión vieja de la app), se asume que se puede. */
export async function energiaYRed(): Promise<{ nivel: number | null; cargando: boolean; conectado: boolean | null; tipo: string | null }> {
  let nivel: number | null = null, cargando = false, conectado: boolean | null = null, tipo: string | null = null
  try {
    const B = await import('expo-battery')
    nivel = await B.getBatteryLevelAsync()
    const e = await B.getBatteryStateAsync()
    cargando = e === B.BatteryState.CHARGING || e === B.BatteryState.FULL
  } catch { /* sin el módulo */ }
  try {
    const N = await import('expo-network')
    const r = await N.getNetworkStateAsync()
    conectado = r.isInternetReachable ?? r.isConnected ?? null
    tipo = r.type ?? null
  } catch { /* sin el módulo */ }
  return { nivel, cargando, conectado, tipo }
}

let registrado = false
/** Se llama una vez al abrir la app: desde ahí, la sincronización pregunta acá antes de subir audio. */
export function registrarCaptura() {
  if (registrado) return
  registrado = true
  decidirAudio(async () => puedeSubirAudio(await energiaYRed()))
}
