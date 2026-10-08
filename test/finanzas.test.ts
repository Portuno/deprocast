import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fijarAjuste } from '../src/db.ts'
import { categorizar, fecha, finanzasParaPrompt, importarCSV, numero, registrarMovimiento, resumenMes } from '../src/finanzas.ts'

const T = new Date(2026, 9, 7, 12).getTime()

test('finanzas: números y fechas de banco, categorías obvias', () => {
  assert.equal(numero('1.234,56'), 1234.56)
  assert.equal(numero('-12,30 €'), -12.3)
  assert.equal(numero('1,234.56'), 1234.56)
  assert.equal(numero('(40)'), -40)
  assert.equal(numero(''), null)
  assert.equal(fecha('31/12/2026'), '2026-12-31')
  assert.equal(fecha('1-2-26'), '2026-02-01')
  assert.equal(fecha('2026-10-07T10:00'), '2026-10-07')
  assert.equal(categorizar('MERCADONA VALENCIA', -30), 'comida')
  assert.equal(categorizar('Transferencia recibida', 500), 'ingresos')
  assert.equal(categorizar('Algo raro', -5), 'otros')
})

test('finanzas: CSV del banco (cargo/abono y separador ;) sin repetir al reimportar; resumen contra la meta', () => {
  const db = abrir(':memory:')
  const csv = 'Extracto de cuenta\nFecha operación;Concepto;Cargo;Abono;Saldo\n01/10/2026;MERCADONA;45,20;;1.000,00\n03/10/2026;Nómina;;1.500,00;2.454,80\n05/10/2026;Netflix;12,99;;2.441,81\n;;;;\n'
  assert.deepEqual(importarCSV(db, csv, { ahora: T }), { nuevos: 3, repetidos: 0, ignorados: 1 })
  assert.deepEqual(importarCSV(db, csv, { ahora: T }), { nuevos: 0, repetidos: 3, ignorados: 1 })
  registrarMovimiento(db, { monto: -20, descripcion: 'taxi', fecha: '2026-10-06' }, T)
  assert.throws(() => registrarMovimiento(db, { monto: 0, descripcion: 'nada' }), /distinto de cero/)

  fijarAjuste(db, 'meta_ingresos_mes', '3000')
  const r = resumenMes(db, '2026-10')
  assert.equal(r.ingresos, 1500)
  assert.equal(r.gastos, 78.19)
  assert.equal(r.avanceMeta, 50)
  assert.deepEqual(Object.keys(r.porCategoria), ['comida', 'transporte', 'suscripciones'])
  assert.equal(resumenMes(db, '2026-09').movimientos, 0)
  assert.equal(finanzasParaPrompt(abrir(':memory:')), '', 'sin datos, no dice nada')
})

test('finanzas: CSV con columna única de importe y separador coma', () => {
  const db = abrir(':memory:')
  const r = importarCSV(db, 'Date,Description,Amount\n2026-10-01,"Cafe, centro",-3.50\n2026-10-02,Freelance,800\n', { ahora: T })
  assert.equal(r.nuevos, 2)
  assert.equal(resumenMes(db, '2026-10').neto, 796.5)
  assert.throws(() => importarCSV(db, 'a;b\n1;2'), /cabecera/)
})
