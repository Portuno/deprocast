import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { aplicarCandidatas, ErrorIntegridad } from '../src/integridad.ts'

test('Fragua #291 · las claves foráneas candidatas con disparadores: arregla lo roto, cascada, vaciar, impedir y frena huérfanos nuevos', async () => {
  const db = abrir(':memory:')
  const ahora = Date.now()
  const entidad = (n: string) => Number(db.prepare(`INSERT INTO entidades (tipo, nombre, creada_en) VALUES ('persona', ?, ?)`).run(n, ahora).lastInsertRowid)
  const movimiento = (h: string, ent: number | null) => Number(db.prepare(`INSERT INTO movimientos (fecha, monto, huella, creado_en, entidad_id) VALUES ('2026-11-17', 10, ?, ?, ?)`).run(h, ahora, ent).lastInsertRowid)
  const a = entidad('Persona A'), b = entidad('Persona B')
  // Lo ya roto (sin las reglas todavía): una relación y un movimiento que apuntan a una entidad que no existe.
  db.prepare('INSERT INTO relaciones (entidad_id, actualizado_en) VALUES (?, ?)').run(777, ahora)
  db.prepare('INSERT INTO relaciones (entidad_id, actualizado_en) VALUES (?, ?)').run(a, ahora)
  const roto = movimiento('m-roto', 778)

  const r = await aplicarCandidatas(db)
  const de = (t: string, c: string) => r.find((x) => x.tabla === t && x.columna === c)!
  assert.equal(de('relaciones', 'entidad_id').estado, 'aplicada')
  assert.equal(de('relaciones', 'entidad_id').limpiadas, 1) // cascada: el huérfano se borró
  assert.equal(de('movimientos', 'entidad_id').limpiadas, 1) // vaciar: quedó en NULL
  assert.equal((db.prepare('SELECT entidad_id FROM movimientos WHERE id = ?').get(roto) as any).entidad_id, null)
  assert.ok(!r.some((x) => x.estado === 'salteada'), JSON.stringify(r.filter((x) => x.estado === 'salteada')))
  // Idempotente.
  assert.ok((await aplicarCandidatas(db)).every((x) => x.estado === 'ya estaba' || x.estado === 'falta tabla'))

  // Cascada: borrar la entidad se lleva su relación. Vaciar: el movimiento queda, sin la entidad.
  const m = movimiento('m-a', a)
  db.prepare('DELETE FROM entidades WHERE id = ?').run(a)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM relaciones WHERE entidad_id = ?').get(a) as any).n, 0)
  assert.equal((db.prepare('SELECT entidad_id FROM movimientos WHERE id = ?').get(m) as any).entidad_id, null)

  // Frena los huérfanos nuevos, al guardar y al cambiar, con un mensaje que dice qué y dónde.
  let e: unknown = null
  try { db.prepare('INSERT INTO relaciones (entidad_id, actualizado_en) VALUES (?, ?)').run(999, ahora) } catch (x) { e = x }
  assert.ok(e instanceof ErrorIntegridad, String(e))
  assert.match((e as Error).message, /^No se pudo guardar en «relaciones»: entidad_id apunta a «entidades» y esa fila no existe/)
  assert.deepEqual((e as ErrorIntegridad).detalle, { tabla: 'relaciones', operacion: 'guardar' })
  assert.throws(() => db.prepare('UPDATE movimientos SET entidad_id = ? WHERE id = ?').run(999, m), /No se pudo cambiar en «movimientos»: entidad_id apunta a «entidades»/)
  db.prepare('UPDATE movimientos SET entidad_id = ? WHERE id = ?').run(b, m) // a algo que existe, sí

  // Impedir: un movimiento con asientos contables no se deja borrar.
  const tieneTesoro = r.find((x) => x.tabla === 'tesoro_asientos')!.estado === 'aplicada'
  if (tieneTesoro) {
    const cols = (db.prepare(`SELECT name, "notnull" AS nn, dflt_value AS d FROM pragma_table_info('tesoro_asientos')`).all() as { name: string; nn: number; d: unknown }[]).filter((c) => c.nn && c.d == null && c.name !== 'id')
    const valores: Record<string, unknown> = { fecha: '2026-11-17', desde: 'caja', hacia: 'banco', monto: 10, tipo: 'transferencia', creado_en: ahora }
    db.prepare(`INSERT INTO tesoro_asientos (${[...cols.map((c) => c.name), 'movimiento_id'].join(', ')}) VALUES (${[...cols.map(() => '?'), '?'].join(', ')})`).run(...cols.map((c) => (valores[c.name] ?? 'x') as any), m)
    assert.throws(() => db.prepare('DELETE FROM movimientos WHERE id = ?').run(m), /No se pudo borrar en «movimientos»: hay filas en «tesoro_asientos»/)
    assert.ok(db.prepare('SELECT 1 FROM movimientos WHERE id = ?').get(m))
  }
})
