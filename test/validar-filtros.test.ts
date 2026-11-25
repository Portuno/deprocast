import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { sugerirMovimiento } from '../src/finanzas.ts'
import { exportarValidacion, resolverBandeja, tandaFiltrada } from '../src/sombra.ts'

const DIA = 86_400_000
function sembrar() {
  const db = abrir(':memory:')
  const ins = db.prepare(`INSERT INTO memoria (texto, tipo, fecha, estado, creada_por, creada_en, revisada) VALUES (?, 'hecho', '2026-11-20', 'vigente', 'escriba', ?, 0)`)
  // 12 recuerdos de días distintos (más que los 8 de la pantalla: el más viejo tiene que aparecer igual).
  for (let i = 0; i < 12; i++) ins.run(`Recuerdo ${i}`, 1_700_000_000_000 + i * DIA)
  sugerirMovimiento(db, { monto: -10, descripcion: 'Café' })
  return db
}

test('Mobile 2.7 · validar con filtros: los tipos que hay (con cuántos), solo los elegidos, y por fecha (también lo más viejo)', () => {
  const db = sembrar()
  const todo = tandaFiltrada(db, { n: 30 })
  assert.deepEqual(todo.tipos.map((x) => x.tipo).sort(), ['monto', 'recuerdo'])
  assert.equal(todo.tipos.find((x) => x.tipo === 'recuerdo')!.n, 12)
  const solo = tandaFiltrada(db, { n: 30, tipos: ['recuerdo'], orden: 'peso' })
  assert.ok(solo.tarjetas.every((t) => t.tipo === 'recuerdo'))
  assert.equal(solo.filtrado, 12)
  const viejo = tandaFiltrada(db, { n: 3, tipos: ['recuerdo'], orden: 'viejo' })
  assert.deepEqual(viejo.tarjetas.map((t) => t.texto), ['Recuerdo 0', 'Recuerdo 1', 'Recuerdo 2'], 'lo más viejo, aunque no esté entre los 8 de la pantalla')
  const nuevo = tandaFiltrada(db, { n: 2, tipos: ['recuerdo'], orden: 'nuevo' })
  assert.deepEqual(nuevo.tarjetas.map((t) => t.texto), ['Recuerdo 11', 'Recuerdo 10'])
  let k = 0
  const azar = tandaFiltrada(db, { n: 30, tipos: ['recuerdo'], orden: 'azar' }, Date.now(), () => (k++ % 7) / 7)
  assert.equal(azar.tarjetas.length, 12)
  assert.notDeepEqual(azar.tarjetas.map((t) => t.texto), viejo.tarjetas.map((t) => t.texto).concat())
  assert.equal(tandaFiltrada(db, { orden: 'cualquiera' }).orden, 'peso', 'un orden raro vuelve al de siempre')
})

test('Mobile 2.7 · exportar: lo cribado por un lado, lo que falta por el otro, y el resumen por tipo', async () => {
  const db = sembrar()
  const r0 = tandaFiltrada(db, { n: 1, tipos: ['recuerdo'], orden: 'viejo' }).tarjetas[0]
  await resolverBandeja(db, 'recuerdo', r0.id, 'descartar', Date.now(), { texto: r0.texto, via: 'prueba' })
  const x = exportarValidacion(db)
  assert.equal(x.pendientes.filter((p) => p.tipo === 'recuerdo').length, 11)
  assert.ok(x.pendientes.every((p) => 'en' in p))
  assert.equal(x.resumen.recuerdo.pendientes, 11)
  assert.equal(x.resumen.monto.pendientes, 1)
  assert.ok(Array.isArray(x.cribadas))
  assert.deepEqual(x.validadas.map((v: any) => [v.tipo, v.accion, v.texto, v.via]), [['recuerdo', 'descartar', 'Recuerdo 0', 'prueba']])
  assert.equal(x.resumen.recuerdo.rechazadas, 1)
})
