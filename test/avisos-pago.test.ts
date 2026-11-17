import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { leerAvisoPago, numero, recibirAvisosPago } from '../src/avisos-pago.ts'

const T = new Date('2026-11-17T13:20:00').getTime()
const av = (app: string, titulo: string, texto: string, paquete = 'com.app.prueba') => ({ paquete, app, titulo, texto, en: T })

test('Fragua #296 · los números con miles y decimales de acá y de allá', () => {
  assert.equal(numero('1.234,56'), 1234.56)
  assert.equal(numero('1,234.56'), 1234.56)
  assert.equal(numero('1.500'), 1500)
  assert.equal(numero('12,5'), 12.5)
  assert.equal(numero('3.75'), 3.75)
  assert.equal(numero('2.000.000'), 2000000)
})

test('Fragua #296 · un aviso de pago o de cobro se lee: monto con signo, moneda, quién; un código o una promo, no', () => {
  assert.deepEqual(leerAvisoPago(av('Mercado Pago', 'Pagaste $ 15.300', 'Pagaste en Carrefour con tu dinero en cuenta')), { monto: -15300, moneda: 'ARS', tipo: 'pago', quien: 'Carrefour', fecha: '2026-11-17' })
  assert.deepEqual(leerAvisoPago(av('Banco Prueba', 'Compra con tarjeta', 'Compra de 23,40 € en MERCADONA VALENCIA')), { monto: -23.4, moneda: 'EUR', tipo: 'pago', quien: 'MERCADONA VALENCIA', fecha: '2026-11-17' })
  const cobro = leerAvisoPago(av('Belo', 'Recibiste US$ 200', 'Te transfirieron US$ 200 de Ana Prueba'))!
  assert.equal(cobro.monto, 200)
  assert.equal(cobro.moneda, 'USD')
  assert.equal(cobro.tipo, 'cobro')
  assert.equal(leerAvisoPago(av('Revolut', 'Paid 9.99 EUR', 'Payment at Spotify'))!.monto, -9.99)
  assert.equal(leerAvisoPago(av('Banco Prueba', 'Tu código', 'Tu código de verificación para pagar 50 € es 123456')), null, 'un código no')
  assert.equal(leerAvisoPago(av('Mercado Pago', 'Promo', 'Hasta 30 % de descuento de $ 5.000 en tu próxima compra')), null, 'una promo no')
  assert.equal(leerAvisoPago(av('Banco Prueba', 'Tu saldo', 'Tu saldo es 1.200,00 €')), null, 'sin pago ni cobro: no')
})

test('Fragua #296 · lo que manda el teléfono queda sugerido en el Monedero, una sola vez; dos cafés iguales el mismo día, también', async () => {
  const db = abrir(':memory:')
  const cafe = av('Banco Prueba', 'Compra con tarjeta', 'Compra de 2,50 € en Café Prueba')
  const r = await recibirAvisosPago(db, [cafe, { ...cafe }, { ...cafe, en: T + 3_600_000 }, av('Banco Prueba', 'Código', 'Tu código es 9999 para pagar 10 €')], T)
  assert.deepEqual(r, { recibidos: 4, sugeridos: 2, ignorados: 1, repetidos: 1 })
  const s = db.prepare(`SELECT monto, moneda, descripcion, dicho FROM movimientos_sugeridos ORDER BY id`).all() as any[]
  assert.equal(s.length, 2)
  assert.equal(s[0].monto, -2.5)
  assert.equal(s[0].descripcion, 'Pago · Café Prueba (Banco Prueba)')
  assert.match(s[0].dicho, /^Banco Prueba: Compra con tarjeta — Compra de 2,50 €/)
})
