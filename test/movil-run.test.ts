import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fechaLocal } from '../src/db.ts'
import { crearMision } from '../src/misiones.ts'
import { anotarCompras } from '../src/compras.ts'
import { guardarLugar } from '../src/territorio.ts'
import { anotarError, erroresRecientes, marcarBandaTelefono, regionesCerca, runParaTelefono } from '../src/movil.ts'

test('Mobile 2.5 · la run en el teléfono: las bandas en orden, cuál toca ahora y cuál sigue; marcar una desde el teléfono', async () => {
  const db = abrir(':memory:')
  const T = new Date(); T.setHours(10, 5, 0, 0)
  const run = Number(db.prepare(`INSERT INTO runs (fecha, inicio, fin, estado, pedido, creada_en) VALUES (?, '10:00', '11:00', 'en_curso', '{}', ?)`).run(fechaLocal(T.getTime()), T.getTime()).lastInsertRowid)
  const b2 = crearMision(db, { nivel: 'secundaria', titulo: 'Revisar el contrato', runId: run, inicio: '10:30', fin: '11:00', estado: 'activa' })
  const b1 = crearMision(db, { nivel: 'secundaria', titulo: 'Escribir el mail', runId: run, inicio: '10:00', fin: '10:25', estado: 'activa' })
  const r = await runParaTelefono(db, T.getTime())
  assert.deepEqual(r.bandas.map((b) => b.titulo), ['Escribir el mail', 'Revisar el contrato'])
  assert.equal(r.ahora, b1.id)
  assert.equal(r.siguiente, b2.id)
  assert.equal((await marcarBandaTelefono(db, b1.id, 'hecha', 'salió')).estado, 'hecha')
  assert.equal((await runParaTelefono(db, T.getTime())).hechas, 1)
  await assert.rejects(marcarBandaTelefono(db, b1.id, 'quizás'))
  assert.deepEqual((await runParaTelefono(abrir(':memory:'))).run, null)
})

test('Mobile 2.5 · lo que pide un lugar: las tiendas se vigilan solo si hay algo para comprar', async () => {
  const db = abrir(':memory:')
  await guardarLugar(db, { nombre: 'Mercadona de la plaza', lat: 39.47, lon: -0.37 })
  await guardarLugar(db, { nombre: 'Lo de Ana', lat: 39.48, lon: -0.38, tipo: 'casa' })
  assert.equal((await regionesCerca(db)).length, 0, 'sin compras, nada')
  anotarCompras(db, [{ item: 'leche' }, { item: 'pan' }])
  const rs = await regionesCerca(db)
  assert.equal(rs.length, 1)
  assert.equal(rs[0].tipo, 'compras')
  assert.match(rs[0].titulo, /Estás en Mercadona de la plaza/)
  assert.match(rs[0].cuerpo, /^2 en la lista: leche, pan$/)
})

test('Mobile 2.5 · los errores de la app: se anotan (sin repetir el mismo en la hora) y se leen', () => {
  const db = abrir(':memory:')
  db.prepare(`INSERT INTO dispositivos (nombre, plataforma, prefijo, token_hash, creado_en) VALUES ('Mi Android', 'android', 'x', 'y', 1)`).run()
  assert.equal(anotarError(db, 1, { mensaje: 'undefined is not a function', donde: 'Mapa', version: '1.6.0' }, 1_000_000), true)
  assert.equal(anotarError(db, 1, { mensaje: 'undefined is not a function', donde: 'Mapa' }, 1_500_000), false)
  assert.equal(anotarError(db, 1, { mensaje: '' }), false)
  const xs = erroresRecientes(db, 7, 2_000_000)
  assert.equal(xs.length, 1)
  assert.equal(xs[0].telefono, 'Mi Android')
})

test('Mobile 2.6 · la plata en el teléfono: anotar un gasto, firmar lo que vino del banco y el mes', async () => {
  const { anotarPlata, plataParaTelefono, semanaParaTelefono } = await import('../src/movil.ts')
  const { sugerirMovimiento, resolverSugerido } = await import('../src/finanzas.ts')
  const db = abrir(':memory:')
  const g = await anotarPlata(db, { monto: '-12,5', descripcion: 'Súper' }) as any
  assert.equal(g.monto, -12.5)
  await assert.rejects(anotarPlata(db, { monto: 'nada' }))
  sugerirMovimiento(db, { monto: -30, descripcion: 'Belo: pago a Ana' })
  let p = await plataParaTelefono(db)
  assert.equal(p.hoy.length, 1)
  assert.equal(p.sugeridos.length, 1)
  assert.equal(p.mes.gastos, 12.5)
  resolverSugerido(db, p.sugeridos[0].id, 'aceptar')
  p = await plataParaTelefono(db)
  assert.equal(p.sugeridos.length, 0)
  assert.equal(p.mes.gastos, 42.5)
  const s = await semanaParaTelefono(db)
  assert.equal(s.dias.length, 7)
  assert.equal(s.dias.at(-1)!.gastos, 42.5)
})
