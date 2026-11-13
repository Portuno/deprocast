/**
 * Tu día en capas (plan v38, fase 6; Mobile 1.0): los minutos que junta la escucha esperan en disco (capas_cola) y salen
 * con cada sincronización de la app. Antes vivían en memoria y un cierre de la app los perdía.
 */
import { subirCapas, type MinutoCapa } from './api'
import { minutosEnCola, sacarMinutos } from './almacen'
import { alSincronizar } from './sincronizar'

let registrado = false
/** Se llama una vez al abrir la app: desde ahí, cada sincronización sube los minutos que esperan (de a 240). */
export function registrarCapas() {
  if (registrado) return
  registrado = true
  alSincronizar(async (c) => {
    const xs = await minutosEnCola(240)
    if (!xs.length) return
    await subirCapas(c, xs.map((x) => JSON.parse(x.datos) as MinutoCapa))
    await sacarMinutos(xs.map((x) => x.minuto)) // el servidor los guarda por minuto: un reintento no duplica
  })
}
