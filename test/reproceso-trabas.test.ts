import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, ajuste, type Db } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { _probarEmbed, cercanas, pasajesDe } from '../src/semantica.ts'
import { alEmpezarReproceso, contarDeAPoco, encolarDeAPoco, encolarReproceso, estadoReproceso, sinPasajes } from '../src/reproceso.ts'
import { juntarBucles, listarBucles } from '../src/bucles.ts'
import { pendientesDeTarjetas } from '../src/consumido.ts'
import { personas } from '../src/personas.ts'

// Lo que trababa la nube en cada vuelta del reproceso (npm run medir a la escala de la nube): los arreglos tienen que
// dar lo mismo que antes, solo que de a poco.

process.env.NAN_API_KEY = 'test'
const EJES = [/plata|sueldo/, /perro|gato/, /viaje|vuelo/]
_probarEmbed(async (_db, textos) => ({ vectores: textos.map((t) => EJES.map((r) => (r.test(t.toLowerCase()) ? 1 : 0.01))), modelo: 'juguete' }))
const pieza = (db: Db, titulo: string, contenido: string, nivel = 'primaria') => insertar(db, { fuente: 'operador', titulo, nivel, contenido, origenId: `t:${titulo}` })!

test('encolar de a tramos da lo mismo que de una (octet_length: sin leer el contenido)', async () => {
  const a = abrir(':memory:'), b = abrir(':memory:')
  for (const db of [a, b]) {
    for (let i = 0; i < 30; i++) pieza(db, `P${i}`, i % 3 ? 'x'.repeat(500) : 'corta')
    pieza(db, 'Propia', 'y'.repeat(800), 'propia')
  }
  assert.equal(await encolarDeAPoco(a), encolarReproceso(b))
  assert.equal(await encolarDeAPoco(a), 0, 'no se repite')
  await contarDeAPoco(a, 0)
  assert.equal(estadoReproceso(a).destilado.pendientes, estadoReproceso(b).destilado.pendientes, 'la pantalla cuenta igual de a poco')
})

test('piezas sin pasajes: lo propio primero, sin las que ya tienen, y los huérfanos se barren al empezar', async () => {
  const db = abrir(':memory:')
  const otra = pieza(db, 'Otra', 'Algo del viaje en vuelo.')
  const mia = pieza(db, 'Mía', 'Mi perro y el sueldo.', 'propia')
  assert.deepEqual((await sinPasajes(db, 8)).slice(0, 2), [mia, otra])
  await pasajesDe(db, [mia])
  assert.deepEqual(await sinPasajes(db, 8), [otra], 'la que ya tiene pasajes no vuelve')
  db.prepare(`INSERT INTO pasajes (pieza_id, orden, desde, hasta, modelo, vec, en) VALUES (99999, 0, 0, 10, 'x', ?, 1)`).run(Buffer.alloc(8))
  await alEmpezarReproceso(db)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pasajes WHERE pieza_id = 99999').get() as { n: number }).n, 0)
})

test('el índice de pasajes en arreglos planos: encuentra, y al rehacer una pieza saca lo viejo y suma lo nuevo', async () => {
  const db = abrir(':memory:')
  const perro = pieza(db, 'Perro', 'Hablo de mi perro.')
  const viaje = pieza(db, 'Viaje', 'El vuelo a Valencia.')
  await pasajesDe(db, [perro, viaje])
  assert.equal((await cercanas(db, 'mi gato', 2))[0].id, perro)
  // La pieza cambió: sus pasajes se rehacen (los viejos se borran, entran otros con ids nuevos).
  db.prepare('UPDATE corpus SET contenido = ? WHERE id = ?').run('Ahora hablo de la plata y el sueldo.', perro)
  await pasajesDe(db, [perro])
  assert.equal((await cercanas(db, 'cuánta plata', 2))[0].id, perro)
  assert.equal((await cercanas(db, 'un vuelo', 2))[0].id, viaje, 'sacar lo viejo no corrió a las demás')
  assert.equal((await cercanas(db, 'un vuelo', 5)).length, 2, 'una entrada por pieza, sin restos de los pasajes borrados')
})

test('bucles: un cursor por destilado (no relee el JSON de todos) y el peso sale igual que antes', async () => {
  const db = abrir(':memory:')
  const d = (id: number, abierto: string[], en: number) => db.prepare(`INSERT INTO takeout_destilado (pieza_id, lote, estado, salida, hecho_en) VALUES (?, 'reproceso', 'hecho', ?, ?)`).run(id, JSON.stringify({ abierto }), en)
  const a = pieza(db, 'A', 'a'), b = pieza(db, 'B', 'b'), c = pieza(db, 'C', 'c')
  d(a, ['Llamar al contador por lo del sueldo'], 1000)
  d(b, [], 2000)
  assert.equal(await juntarBucles(db), 1)
  assert.equal(ajuste(db, 'bucles_destilado_hasta'), '2000')
  assert.equal(await juntarBucles(db), 0, 'nada nuevo: no vuelve a contar')
  d(c, ['Llamar al contador por lo del sueldo'], 3000)
  assert.equal(await juntarBucles(db), 1)
  const [x] = listarBucles(db, { limite: 3 })
  assert.equal(x.veces, 2, 'lo parecido se juntó')
  assert.equal(x.peso, Math.round(x.veces * (1 + Math.log2(1 + x.dias / 7)) * 10) / 10)
})

test('tarjetas: con el cursor puesto, solo mira lo destilado después', () => {
  const db = abrir(':memory:')
  assert.deepEqual(pendientesDeTarjetas(db, 1), [])
  db.prepare(`INSERT INTO takeout_destilado (pieza_id, lote, estado, salida, hecho_en) VALUES (1, 'reproceso', 'hecho', '{}', 5000)`).run()
  pendientesDeTarjetas(db, 1)
  assert.equal(ajuste(db, 'tarjetas_revisado_hasta'), '5000', 'sin nada pendiente, el cursor va al último')
})

test('personas: el índice del chat suma el mensaje nuevo sin rearmarse entero', () => {
  const db = abrir(':memory:')
  const e = Number(db.prepare(`INSERT INTO entidades (tipo, nombre, creada_en) VALUES ('persona', 'Ramona Pérez', 1)`).run().lastInsertRowid)
  const c = Number(db.prepare(`INSERT INTO conversaciones (con, titulo, creada_en, actualizada_en) VALUES ('mastropiero', 'x', 1, 1)`).run().lastInsertRowid)
  const msj = (t: string) => db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'operador', ?, ?)`).run(c, t, Date.now())
  msj('Hoy hablé con Ramona')
  assert.equal(personas(db).find((p) => p.id === e)!.nivelSugerido, 2)
  msj('Ramona me llamó'); msj('Ramona otra vez'); msj('y Ramona de nuevo')
  assert.equal(personas(db).find((p) => p.id === e)!.nivelSugerido, 3, 'con tres o más menciones en el chat, sube')
})
