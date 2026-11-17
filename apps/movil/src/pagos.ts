/**
 * Gastos solos (Fragua #296). Con el permiso «Acceso a notificaciones» (se da una vez en los ajustes de Android), el
 * teléfono guarda los avisos de las apps de pago y banco (Mercado Pago, Belo, el banco: por su paquete o porque el
 * nombre de la app lo dice) que traen un monto; todo lo demás se ignora sin guardarse. Acá se mandan al servidor, que
 * los lee y los deja como movimientos sugeridos en el Monedero, para firmar en un toque.
 * Salen con la sincronización y con la tarea de fondo; lo que llegó se saca del teléfono.
 */
import * as Pago from '../modules/avisos-pago'
import { mandarAvisosPago, type Credenciales } from './api'
import { alSincronizar } from './sincronizar'
import { ajustesCaptura } from './captura'
import { capta } from './logica/captura'

/** Las apps de pago y banco conocidas (además, las que se reconocen por el nombre: «Banco…», «…Pay», «Wallet»). */
const PAQUETES = ['com.mercadopago.wallet', 'com.revolut.revolut', 'de.number26.android', 'com.bbva.bbvacontigo', 'es.bancosantander.apps', 'es.lacaixa.mobile.android.newwapicon', 'com.paypal.android.p2pmobile', 'com.transferwise.android']

export const hayPagos = Pago.hayAvisosPago
export const tienePermisoPagos = Pago.tienePermisoPagos
export const abrirPermisoPagos = Pago.abrirPermisoPagos

/** Manda lo que guardó el teléfono. Sin el ajuste o sin permiso: nada. */
export async function subirPagos(c: Credenciales) {
  if (!capta(await ajustesCaptura(), 'pagos') || !Pago.tienePermisoPagos()) return
  const xs = Pago.pendientesPago()
  if (!xs.length) return
  await mandarAvisosPago(c, xs)
  Pago.soltarPagos(Math.max(...xs.map((x) => x.en)))
}

let registrado = false
export function registrarPagos() {
  if (registrado) return
  registrado = true
  Pago.fijarPaquetes(PAQUETES)
  alSincronizar(subirPagos)
}
