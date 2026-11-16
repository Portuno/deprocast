import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { ErrorIntegridad, huerfanos } from '../src/integridad.ts'
import { ejecutarHerramienta, type Herramienta } from '../src/chat/herramientas.ts'

test('Fragua #291 · un error de clave foránea dice qué tabla, qué columna y qué valor; al borrar, qué depende; el chat dice qué acción falló', async () => {
  const db = abrir(':memory:')
  // Guardar un mensaje en una conversación que no existe.
  let e: unknown = null
  try { db.prepare('INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, ?, ?, ?)').run(999, 'operador', 'hola', Date.now()) } catch (x) { e = x }
  assert.ok(e instanceof ErrorIntegridad)
  assert.match((e as Error).message, /^No se pudo guardar en «mensajes»: conversacion_id = 999 apunta a «conversaciones» y esa fila no existe/)
  assert.deepEqual((e as ErrorIntegridad).detalle, { tabla: 'mensajes', operacion: 'guardar', columna: 'conversacion_id', valor: 999, padre: 'conversaciones' })
  // Borrar una conversación que tiene mensajes: dice quién depende.
  const c = Number(db.prepare(`INSERT INTO conversaciones (con, titulo, creada_en, actualizada_en) VALUES ('mastropiero', 'x', ?, ?)`).run(Date.now(), Date.now()).lastInsertRowid)
  db.prepare('INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, ?, ?, ?)').run(c, 'operador', 'hola', Date.now())
  assert.throws(() => db.prepare('DELETE FROM conversaciones WHERE id = ?').run(c), /No se pudo borrar en «conversaciones»: hay filas que dependen .*mensajes\.conversacion_id/)
  // Lo demás no cambia: un error que no es de integridad sale tal cual.
  assert.throws(() => db.prepare('INSERT INTO mensajes (conversacion_id) VALUES (?)').run(c), /NOT NULL/)

  // En el chat: la acción y el detalle, no el texto crudo de SQLite.
  const h: Herramienta = { nombre: 'anotar_cosa', familia: 'accion', descripcion: '', parametros: { type: 'object', properties: {} }, ejecutar: () => db.prepare('INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, ?, ?, ?)').run(4242, 'operador', 'x', 1) } as any
  const r = await ejecutarHerramienta([h], 'anotar_cosa', '{}', { db } as any)
  assert.equal(r.ok, false)
  assert.match((r.resultado as any).error, /^Al anotar cosa: No se pudo guardar en «mensajes»: conversacion_id = 4242/)
  assert.equal((r.resultado as any).integridad.padre, 'conversaciones')

  // Lo que ya está roto se lista sin borrar nada.
  db.exec('PRAGMA foreign_keys = OFF')
  db.prepare('INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, ?, ?, ?)').run(777, 'operador', 'huérfano', 1)
  db.exec('PRAGMA foreign_keys = ON')
  const hs = await huerfanos(db)
  assert.deepEqual(hs.find((x) => x.tabla === 'mensajes'), { tabla: 'mensajes', padre: 'conversaciones', filas: 1 })
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM mensajes WHERE conversacion_id = 777').get() as any).n, 1, 'no se borró')
})

test('Fragua #282 · crear_aprendizaje sin tema (o con una letra) devuelve un error que dice qué falta, no una pregunta', async () => {
  const db = abrir(':memory:')
  const lista = (await import('../src/chat/herramientas.ts')).HERRAMIENTAS
  for (const args of ['{}', '{"tema":"x"}']) {
    const r = await ejecutarHerramienta(lista, 'crear_aprendizaje', args, { db } as any)
    assert.equal(r.ok, false)
    assert.match((r.resultado as any).error, /^Falta el parámetro «tema»/)
    assert.deepEqual((r.resultado as any).falta, ['tema'])
    assert.doesNotMatch((r.resultado as any).error, /^¿/)
  }
})
