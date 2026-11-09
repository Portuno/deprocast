import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import * as m from '../src/mapamundi.ts'
import { HERRAMIENTAS, GRUPOS, gruposDelMensaje } from '../src/chat/herramientas.ts'

const T = new Date('2026-11-09T10:00:00').getTime()
const respuesta = (datos: unknown) => async () => ({ texto: JSON.stringify(datos), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 5 })

test('la cuadrícula: un punto cae en su hexágono, el centro vuelve al mismo, y los vecinos están a uno', () => {
  const c = { lat: 39.66, lon: -0.23, nombre: 'x', km: 4 }
  for (const h of [{ q: 0, r: 0 }, { q: 2, r: -1 }, { q: -3, r: 4 }]) {
    const [lat, lon] = m.centroDe(c, h)
    assert.deepEqual(m.hexDe(c, lat, lon), h)
    for (const [la, lo] of m.vertices(c, h)) assert.ok(m.distancia(m.hexDe(c, (la * 3 + lat) / 4, (lo * 3 + lon) / 4), h) === 0)
  }
  assert.ok(m.vecinos({ q: 0, r: 0 }).every((v) => m.distancia(v, { q: 0, r: 0 }) === 1))
})

test('Mapamundi arranca en blanco; el piloto de Sagunto se juega de punta a punta', async () => {
  const db = abrir(':memory:')
  const vacio = await m.estado(db, T)
  assert.equal(vacio.centro, null)
  assert.equal(vacio.piloto!.disputas, 3)

  m.cargarPiloto(db, T)
  assert.throws(() => m.cargarPiloto(db, T), /ya tiene/)
  let e = await m.estado(db, T)
  assert.equal(e.centro!.nombre, 'Puerto de Sagunto')
  assert.equal(e.hexes!.filter((h) => h.control === 'tuyo').length, 1)
  assert.equal(e.disputas!.filter((d) => d.jugable).length, 3)
  const zama = e.disputas!.find((d) => d.nombre === 'Zama')!
  assert.equal(zama.rival, 'Aníbal Barca')
  assert.equal(zama.anioTexto, '202 a. C.')
  assert.match(zama.postura!, /Cannas/)

  // Por la fuerza: tu fuerza (3 + 2 por hexágono) contra el doble de la del rival.
  assert.equal(m.tuFuerza(db), 5)
  m._probarAzar(() => 0.1)
  const r = await m.jugar(db, zama.id, { via: 'fuerza' }, T)
  assert.equal(r.gano, true)
  assert.equal(Math.round(r.prob! * 100), 24)
  assert.match(r.ficha.ley, /estudia cómo lo vencieron/)
  e = await m.estado(db, T)
  assert.equal(e.hexes!.find((h) => h.clave === '0,-1')!.control, 'tuyo')
  assert.deepEqual(e.rutas, [['0,-1', '0,0']])
  assert.equal(m.tuFuerza(db), 3 + 4 + 1)
  await assert.rejects(m.jugar(db, zama.id, { via: 'fuerza' }, T), /ya la ganaste/)

  // Por el discurso: quince palabras como mucho, y el juez decide con el puntaje (no con lo que diga de más).
  const pron = e.disputas!.find((d) => d.nombre === 'Pronunciamiento de Sagunto')!
  await assert.rejects(m.jugar(db, pron.id, { via: 'discurso', texto: 'una dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis' }, T), /16 palabras/)
  let pedido = ''
  _probarModelo(async (_l, o) => { pedido = String((o.mensajes.at(-1) as any).content); return respuesta({ puntaje: 4.5, por_que: 'Genérica', gana: true })() })
  const d = await m.jugar(db, pron.id, { via: 'discurso', texto: 'Un rey impuesto por las armas no cierra guerras: las aplaza.' }, T)
  assert.match(pedido, /Martínez Campos/)
  assert.equal(d.gano, false)
  assert.equal(d.puntaje, 4.5)
  assert.match(d.cambio, /capital resiste/)
  // La revancha, al día siguiente.
  await assert.rejects(m.jugar(db, pron.id, { via: 'fuerza' }, T + 3_600_000), /revancha/)
  m._probarAzar(() => 0.01)
  assert.equal((await m.jugar(db, pron.id, { via: 'fuerza' }, T + 25 * 3_600_000)).gano, true)

  // Perder desde un hexágono que no es la capital: lo perdés, con sus rutas.
  const resumen = await m.resumen(db, T + 26 * 3_600_000)
  assert.equal(resumen.tuyos!.length, 3)
  assert.ok(HERRAMIENTAS.some((h) => h.nombre === 'disputar') && HERRAMIENTAS.some((h) => h.nombre === 'ver_mapamundi'))
  assert.deepEqual(GRUPOS.mapamundi, ['ver_mapamundi', 'disputar'])
  assert.ok(gruposDelMensaje('quiero jugar una disputa del mapamundi').includes('mapamundi'))
  m._probarAzar(Math.random)
})

test('perder desde un hexágono conquistado lo devuelve y borra sus rutas', async () => {
  const db = abrir(':memory:')
  m.cargarPiloto(db, T)
  const e = await m.estado(db, T)
  m._probarAzar(() => 0)
  await m.jugar(db, e.disputas!.find((d) => d.nombre === 'Zama')!.id, { via: 'fuerza' }, T)
  // Una disputa nueva desde el hexágono de Aníbal hacia un vecino ajeno.
  db.prepare(`INSERT INTO mapamundi_hex (clave, q, r, grande, pais, siglo, idea, control, origen, creado) VALUES ('1,-2', 1, -2, 'Otro', 'X', 5, 'i', 'ajeno', 'prueba', 1)`).run()
  db.prepare(`INSERT INTO mapamundi_disputas (a, b, nombre, anio, verdad) VALUES ('0,-1', '1,-2', 'Prueba', 500, 'v')`).run()
  const id = (db.prepare(`SELECT id FROM mapamundi_disputas WHERE nombre = 'Prueba'`).get() as { id: number }).id
  m._probarAzar(() => 0.99)
  const r = await m.jugar(db, id, { via: 'fuerza' }, T)
  assert.equal(r.gano, false)
  assert.match(r.cambio, /Perdés el hexágono/)
  const x = await m.estado(db, T)
  assert.equal(x.hexes!.find((h) => h.clave === '0,-1')!.control, 'ajeno')
  assert.deepEqual(x.rutas, [])
  m._probarAzar(Math.random)
})

test('las lentes: una sola, recordada; Tu vida y Economía anclan sus lugares y su plata al hexágono', async () => {
  const db = abrir(':memory:')
  m.cargarPiloto(db, T)
  assert.equal(m.lente(db), 'territorio')
  m.fijarLente(db, 'vida')
  assert.equal((await m.estado(db, T)).lente, 'vida')
  assert.throws(() => m.fijarLente(db, 'facciones'), /desconocida/)
  // Un lugar suyo a unos km del centro, y un gasto ahí.
  const [lat, lon] = m.centroDe(m.centro(db)!, { q: 1, r: 1 })
  db.prepare(`INSERT INTO entidades (tipo, nombre, meta, creada_en) VALUES ('lugar', 'Taller del barrio', ?, 1)`).run(JSON.stringify({ lat, lon }))
  db.prepare(`INSERT INTO movimientos (fecha, monto, descripcion, huella, creado_en) VALUES ('2026-11-01', -30, 'Pintura en Taller del barrio', 'h1', 1)`).run()
  const e = await m.estado(db, T)
  const h = e.hexes!.find((x) => x.clave === '1,1')!
  assert.equal(h.vida[0].titulo, 'Taller del barrio')
  assert.deepEqual(h.plata, { ingresos: 0, gastos: 30, n: 1 })
})

test('replicar: el modelo puebla un vecino con su grande y una disputa con lo que ya está', async () => {
  const db = abrir(':memory:')
  m.cargarPiloto(db, T)
  await assert.rejects(m.poblar(db, '5,5', T), /de a uno/)
  _probarModelo(respuesta({ grande: 'Jaime I', pais: 'Corona de Aragón', siglo: 13, idea: 'Conquistar es repoblar con fueros.', disputas: [{ vecino: '0,0', nombre: 'Toma de Valencia', anio: 1238, lugar: 'Valencia', postura_tuya: 'a', postura_rival: 'b', fuerza_tuya: 6, fuerza_rival: 5, verdad: 'Jaime I tomó Valencia en 1238.', botin: 'El reino de Valencia.', ley: 'Quien repuebla, retiene.' }, { vecino: '9,9', nombre: 'Inventada', anio: 1, verdad: 'x' }] }))
  const h = await m.poblar(db, '1,0', T)
  assert.equal(h!.grande, 'Jaime I')
  assert.equal(h!.control, 'ajeno')
  const e = await m.estado(db, T)
  const t = e.disputas!.find((d) => d.nombre === 'Toma de Valencia')!
  assert.equal(t.jugable, true)
  assert.equal(t.postura, 'a') // juega desde la capital (lado b): la postura del rival es la de Jaime I
  assert.ok(!e.disputas!.some((d) => d.nombre === 'Inventada'))
  await assert.rejects(m.poblar(db, '1,0', T), /ya tiene/)
})
