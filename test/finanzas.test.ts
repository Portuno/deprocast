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

test('finanzas por proyecto: se atan solos por nombre o alias, se asignan a mano, y el ritmo hacia la meta', async () => {
  const { asegurarEntidad } = await import('../src/entidades.ts')
  const { editarMovimiento, listarMovimientos, resumenPorProyecto, ritmoMeta } = await import('../src/finanzas.ts')
  const db = abrir(':memory:')
  const corru = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Corruptopolis', alias: ['Corrupto'] }, T)
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Pérez' }, T)
  asegurarEntidad(db, { tipo: 'persona', nombre: 'Lautaro', meta: { operador: 1 } }, T)
  registrarMovimiento(db, { fecha: '2026-10-03', monto: -40, descripcion: 'Imprenta cartas Corruptopolis' }, T)
  registrarMovimiento(db, { fecha: '2026-10-04', monto: 300, descripcion: 'Preventa del juego', proyecto: 'corrupto' }, T)
  registrarMovimiento(db, { fecha: '2026-10-05', monto: -25, descripcion: 'Cena con Ana Pérez' }, T)
  registrarMovimiento(db, { fecha: '2026-10-06', monto: -12, descripcion: 'Súper Lautaro' }, T)
  const ms = listarMovimientos(db, { mes: '2026-10' })
  assert.deepEqual(ms.map((m) => [m.descripcion, m.entidad]), [['Súper Lautaro', null], ['Cena con Ana Pérez', 'Ana Pérez'], ['Preventa del juego', 'Corruptopolis'], ['Imprenta cartas Corruptopolis', 'Corruptopolis']], 'él mismo no es un proyecto')
  editarMovimiento(db, ms[1].id, { entidadId: corru })
  editarMovimiento(db, ms[1].id, { entidadId: null })
  assert.equal(listarMovimientos(db, { mes: '2026-10' })[1].entidadId, null)
  assert.throws(() => editarMovimiento(db, ms[1].id, { proyecto: 'Inexistente' }), /No encuentro/)
  const pp = resumenPorProyecto(db, '2026-10')
  assert.deepEqual(pp.map((p) => [p.nombre, p.ingresos, p.gastos, p.neto]), [['Corruptopolis', 300, 40, 260], ['Sin proyecto', 0, 37, -37]])
  assert.ok(ana)

  fijarAjuste(db, 'meta_ingresos_mes', '2000')
  const ritmo = ritmoMeta(db, new Date(2026, 9, 22, 12).getTime())!
  assert.deepEqual([ritmo.falta, ritmo.diasQuedan, ritmo.porDia], [1700, 10, 170])
  const p = finanzasParaPrompt(db, new Date(2026, 9, 22, 12).getTime())
  assert.match(p, /faltan 1700 € en 10 días \(170 € por día\)/)
  assert.match(p, /Por proyecto: Corruptopolis \+260 €/)
})

test('finanzas: los montos que contó charlando quedan sugeridos; con su ok entran, sin repetir lo ya anotado', async () => {
  const { sugerirMovimiento, sugeridos, resolverSugerido, listarMovimientos } = await import('../src/finanzas.ts')
  const { escribaDeMemoria } = await import('../src/memoria.ts')
  const { _probarModelo } = await import('../src/modelo.ts')
  const db = abrir(':memory:')
  _probarModelo(async () => ({ texto: JSON.stringify({ recuerdos: [], montos: [{ monto: 800, descripcion: 'Freelance', dicho: 'me pagaron 800 del freelance' }, { monto: -40, descripcion: 'Súper', dicho: 'gasté 40 en el súper' }, { monto: 'mucho' }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }))
  await escribaDeMemoria(db, 'Hoy me pagaron 800 del freelance y gasté 40 en el súper', null)
  assert.deepEqual(sugeridos(db).map((x) => [x.monto, x.descripcion]).sort(), [[-40, 'Súper'], [800, 'Freelance']])
  assert.equal(listarMovimientos(db).length, 0, 'nada entra sin su ok')

  // De una grabación no se sugiere: puede ser otro el que habla de plata.
  await escribaDeMemoria(db, 'Grabación: me pagaron 800 del freelance', null, { grabacion: true })
  assert.equal(sugeridos(db).length, 2)

  const [gasto, ingreso] = [...sugeridos(db)].sort((a, b) => a.monto - b.monto)
  const m = resolverSugerido(db, ingreso.id, 'aceptar', { descripcion: 'Freelance web' })!
  assert.deepEqual([m.monto, m.descripcion], [800, 'Freelance web'])
  resolverSugerido(db, gasto.id, 'descartar')
  assert.equal(sugeridos(db).length, 0)
  assert.throws(() => resolverSugerido(db, gasto.id, 'aceptar'), /pendiente/)

  registrarMovimiento(db, { monto: -15, descripcion: 'Taxi' })
  assert.equal(sugerirMovimiento(db, { monto: -15, descripcion: 'taxi' }), null, 'ya estaba anotado')
  assert.equal(sugerirMovimiento(db, { monto: 0, descripcion: 'nada' }), null)
})
