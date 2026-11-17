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

test('Fragua #291 · si una regla cambió, sus disparadores se rehacen (los iguales quedan)', async () => {
  const db = abrir(':memory:')
  await aplicarCandidatas(db)
  // Un disparador viejo (otra versión de la regla) con el mismo nombre.
  db.exec(`DROP TRIGGER "fk_relaciones_entidad_id_borrar"; CREATE TRIGGER "fk_relaciones_entidad_id_borrar" AFTER DELETE ON entidades BEGIN SELECT 1; END`)
  const r = await aplicarCandidatas(db)
  assert.equal(r.find((x) => x.tabla === 'relaciones')!.estado, 'aplicada')
  assert.ok(r.filter((x) => x.tabla !== 'relaciones').every((x) => x.estado === 'ya estaba' || x.estado === 'falta tabla'))
  const ahora = Date.now()
  const e = Number(db.prepare(`INSERT INTO entidades (tipo, nombre, creada_en) VALUES ('persona', 'X', ?)`).run(ahora).lastInsertRowid)
  db.prepare('INSERT INTO relaciones (entidad_id, actualizado_en) VALUES (?, ?)').run(e, ahora)
  db.prepare('DELETE FROM entidades WHERE id = ?').run(e)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM relaciones').get() as any).n, 0, 'la cascada volvió')
})

test('Fragua #291 · importar una exportación con las reglas puestas: se pausan, se carga en cualquier orden y vuelven', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
  const { exportarEstado, importarEstado } = await import('../src/exportacion.ts')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reglas-import-'))
  const antes = process.env.MASTRO_DB
  process.env.MASTRO_DB = path.join(tmp, 'esta', 'mastro.db')
  try {
    const db = abrir(':memory:')
    await aplicarCandidatas(db)
    const ahora = Date.now()
    const e = Number(db.prepare(`INSERT INTO entidades (tipo, nombre, creada_en) VALUES ('persona', 'Persona A', ?)`).run(ahora).lastInsertRowid)
    const pieza = (await import('../src/corpus.ts')).insertar(db, { fuente: 'operador', titulo: 't', contenido: 'c', nivel: 'propia', origenId: 'x:1' })!
    db.prepare('INSERT INTO corpus_entidades (pieza_id, entidad_id) VALUES (?, ?)').run(pieza, e) // «corpus_entidades» va antes que «entidades»
    const m = Number(db.prepare(`INSERT INTO movimientos (fecha, monto, huella, creado_en) VALUES ('2026-11-17', 10, 'h', ?)`).run(ahora).lastInsertRowid)
    const cols = (db.prepare(`SELECT name, "notnull" AS nn, dflt_value AS d FROM pragma_table_info('tesoro_asientos')`).all() as { name: string; nn: number; d: unknown }[]).filter((c) => c.nn && c.d == null && c.name !== 'id')
    const valores: Record<string, unknown> = { fecha: '2026-11-17', desde: 'caja', hacia: 'banco', monto: 10, tipo: 'transferencia', creado_en: ahora }
    db.prepare(`INSERT INTO tesoro_asientos (${[...cols.map((c) => c.name), 'movimiento_id'].join(', ')}) VALUES (${[...cols.map(() => '?'), '?'].join(', ')})`).run(...cols.map((c) => (valores[c.name] ?? 'x') as any), m)
    const texto = fs.readFileSync(exportarEstado(db, { destino: tmp, archivos: false }).ruta, 'utf8')

    const otra = abrir(':memory:')
    await aplicarCandidatas(otra)
    // Vuelven de a una (de fondo): la de los asientos es la última de la lista.
    const hayRegla = () => (otra.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name IN ('fk_corpus_entidades_entidad_id_guardar', 'fk_tesoro_asientos_movimiento_id_borrar')`).get() as { n: number }).n === 2
    const vuelven = async () => { for (let i = 0; i < 1000 && !hayRegla(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(hayRegla(), 'las reglas volvieron') }
    importarEstado(otra, texto)
    await vuelven()
    assert.equal((otra.prepare('SELECT COUNT(*) AS n FROM corpus_entidades').get() as any).n, 1)
    assert.equal((otra.prepare('SELECT COUNT(*) AS n FROM tesoro_asientos').get() as any).n, 1)
    // Encima de una base con datos (vaciar «movimientos» antes que sus asientos no frena nada).
    importarEstado(otra, texto, { forzar: true })
    await vuelven()
    assert.equal((otra.prepare('SELECT COUNT(*) AS n FROM tesoro_asientos').get() as any).n, 1)
    assert.throws(() => otra.prepare('DELETE FROM movimientos WHERE id = ?').run(m), /No se pudo borrar en «movimientos»/)
  } finally {
    if (antes === undefined) delete process.env.MASTRO_DB; else process.env.MASTRO_DB = antes
  }
})
