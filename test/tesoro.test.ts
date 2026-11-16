import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { registrarMovimiento } from '../src/finanzas.ts'
import { forjar } from '../src/roster.ts'
import { nombrarPagina, datosDe } from '../src/paginas.ts'
import { bandeja, resolverBandeja } from '../src/sombra.ts'
import { ACCIONES } from '../src/rutinas.ts'
import { HERRAMIENTAS, ejecutarHerramienta } from '../src/chat/herramientas.ts'
import * as t from '../src/tesoro.ts'

const AHORA = Date.UTC(2026, 10, 17, 9)

test('Monedero · un solo libro: las cuentas salen de Finanzas (la caja, Belo), con saldo inicial y patrimonio', () => {
  const db = abrir(':memory:')
  t.cambiarCuenta(db, 'caja', { saldoInicial: 1000, desde: '2026-11-01' })
  registrarMovimiento(db, { fecha: '2026-10-20', monto: -999, descripcion: 'antes del saldo inicial: ya está contado' })
  registrarMovimiento(db, { fecha: '2026-11-05', monto: -50, descripcion: 'súper' })
  registrarMovimiento(db, { fecha: '2026-11-10', monto: 800, descripcion: 'Factura taller', cuenta: 'Belo' })
  registrarMovimiento(db, { fecha: '2026-11-11', monto: 30, descripcion: 'en dólares', cuenta: 'Belo', moneda: 'USD' })
  assert.equal(t.saldo(db, 'caja', '2026-11-30'), 950)
  const belo = t.resolverCuenta(db, 'belo')!
  assert.equal(belo, 'banco:belo')
  assert.equal(t.saldo(db, belo, '2026-11-30'), 800)
  const p = t.patrimonio(db, '2026-11-30')
  assert.equal(p.total, 1750)
  assert.ok(p.cuentas.some((c) => c.nombre === 'Belo'), 'la cuenta de Finanzas aparece sola')
  // Una deuda resta.
  t.cambiarCuenta(db, 'deuda:prestamo', { tipo: 'deuda', saldoInicial: -300, desde: '2026-11-01', nombre: 'Préstamo' })
  assert.equal(t.patrimonio(db, '2026-11-30').total, 1450)
  assert.equal(t.patrimonio(db, '2026-11-30').pasivos, 300)
})

test('Monedero · lo que genera un agente o un arquetipo va a sus arcas (solo si él lo atribuye) y no se cuenta dos veces', () => {
  const db = abrir(':memory:')
  const ag = forjar(db, { clase: 'generativo', creador: 'operador', ahora: AHORA })
  db.prepare('UPDATE agentes SET celda = 12 WHERE id = ?').run(ag.id)
  nombrarPagina(db, 'arquetipo', '12', 'El Modista')
  const ing = registrarMovimiento(db, { fecha: '2026-11-10', monto: 600, descripcion: 'Cliente de extracción', cuenta: 'Belo' })!
  const otro = registrarMovimiento(db, { fecha: '2026-11-12', monto: 200, descripcion: 'Venta de un diseño', cuenta: 'Belo' })!
  t.atribuirIngreso(db, ing.id, `agente:${ag.id}`, AHORA)
  t.atribuirIngreso(db, otro.id, t.resolverCuenta(db, 'el modista')!, AHORA)
  assert.equal(t.saldo(db, `agente:${ag.id}`), 600)
  assert.equal(t.saldo(db, 'arquetipo:12'), 200)
  assert.equal(t.saldo(db, 'banco:belo'), 0, 'salió de Belo hacia sus arcas')
  const p = t.patrimonio(db)
  assert.equal(p.total, 0, 'las arcas son parte de lo suyo: no se suman dos veces al patrimonio propio')
  assert.deepEqual(p.arcas.map((c) => [c.clave, c.saldo]).sort(), [[`agente:${ag.id}`, 600], ['arquetipo:12', 200]])
  assert.deepEqual(t.generado(db).map((g) => [g.nombre, g.total]), [[ag.nombre ?? ag.id, 600], ['El Modista', 200]])
  // Reatribuir no duplica.
  t.atribuirIngreso(db, otro.id, `agente:${ag.id}`, AHORA)
  assert.equal(t.saldo(db, 'arquetipo:12'), 0)
  assert.equal(t.saldo(db, `agente:${ag.id}`), 800)
  assert.throws(() => t.atribuirIngreso(db, registrarMovimiento(db, { fecha: '2026-11-13', monto: -10, descripcion: 'gasto' })!.id, `agente:${ag.id}`), /Solo se atribuye un ingreso/)
  // Los agentes no gastan: lo que sale de sus arcas espera la firma de él.
  const sale = t.asentar(db, { desde: `agente:${ag.id}`, hacia: 'reserva', monto: 100, tipo: 'asignacion', por: 'operador' }, AHORA)
  assert.equal(sale.estado, 'propuesto')
  // Y la página del arquetipo muestra sus arcas.
  return datosDe(db, 'arquetipo', '12').then((d: any) => {
    assert.equal(d.arcas.agentes, 800)
    assert.equal(d.agentes[0].arcas, 800)
  })
})

test('Monedero · el reparto se propone y espera la firma en Para validar; el freno de mano corta', async () => {
  // Con el reloj de verdad: el reparto mira los ingresos desde hoy.
  const YA = Date.now()
  const db = abrir(':memory:')
  t.fijarReparto(db, { reserva: 20, inversion: 10 })
  assert.throws(() => t.fijarReparto(db, { reserva: 80, inversion: 30 }), /100 %/)
  registrarMovimiento(db, { fecha: fechaDe(YA), monto: 1000, descripcion: 'Honorarios' })
  const ps = t.proponerRepartos(db, YA)
  assert.deepEqual(ps.map((a) => [a.hacia, a.monto, a.estado]), [['reserva', 200, 'propuesto'], ['inversion', 100, 'propuesto']])
  assert.equal(t.proponerRepartos(db, YA).length, 0, 'un ingreso no se reparte dos veces')
  assert.equal(t.saldo(db, 'reserva'), 0, 'propuesto no mueve nada')
  const g = bandeja(db, YA).grupos.find((x) => x.tipo === 'tesoro')!
  assert.equal(g.n, 2)
  assert.match(g.items[0].texto, /200 EUR: Caja .* → Reserva/)
  await resolverBandeja(db, 'tesoro', ps[0].id, 'aceptar', YA)
  await resolverBandeja(db, 'tesoro', ps[1].id, 'descartar', YA)
  assert.equal(t.saldo(db, 'reserva'), 200)
  assert.equal(t.saldo(db, 'inversion'), 0)
  assert.equal(t.saldo(db, 'caja'), 800)
  // Freno de mano: la reserva no recibe nada.
  t.cambiarCuenta(db, 'reserva', { frenada: true })
  assert.throws(() => t.asentar(db, { desde: 'caja', hacia: 'reserva', monto: 10, tipo: 'asignacion', por: 'operador' }), /freno de mano/)
})

test('Monedero · serie, alerta si cae dos meses, metas, proyección y el parte del día 1', async () => {
  const db = abrir(':memory:')
  t.cambiarCuenta(db, 'caja', { saldoInicial: 5000, desde: '2026-08-01' })
  registrarMovimiento(db, { fecha: '2026-10-05', monto: -400, descripcion: 'octubre' })
  registrarMovimiento(db, { fecha: '2026-11-05', monto: -300, descripcion: 'noviembre' })
  const s = t.serieMensual(db, 4, AHORA)
  assert.deepEqual(s.serie.map((x) => x.total), [5000, 5000, 4600, 4300])
  assert.match(s.alerta!, /cayó dos meses seguidos/)
  t.fijarMeta(db, 10_000, '2027-11-17', 'colchón', AHORA)
  const [m] = t.metas(db, AHORA)
  assert.equal(m.falta, 5700)
  assert.ok(m.porMes > 400 && m.porMes < 500)
  t.cambiarCuenta(db, 'caja', { tasa: 3, riesgo: 'bajo: plazo fijo' })
  const [pr] = t.proyeccion(db, 12)
  assert.ok(pr.seria > 4300 && pr.ganancia > 100)
  assert.equal(pr.riesgo, 'bajo: plazo fijo')
  const parte = await ACCIONES.tesoro(db, '2026-12-01', Date.UTC(2026, 11, 1, 9))
  assert.match(parte!, /Parte del Tesorero.*patrimonio 4\.300 €/s)
  assert.match(parte!, /Meta 10\.000 €/)
  const h = await ejecutarHerramienta(HERRAMIENTAS, 'ver_monedero', '{}', { db, conversacionId: null })
  assert.equal((h.resultado as any).patrimonio.total, 4300)
})

function fechaDe(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
