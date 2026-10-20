import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
delete process.env.NAN_API_KEY

const { abrir } = await import('../src/db.ts')
const { insertar, listarPiezas } = await import('../src/corpus.ts')
const { asegurarEntidad, leerEntidad, listarEntidades, coocurrencias } = await import('../src/entidades.ts')
const { personas } = await import('../src/personas.ts')
const { rutaNormal } = await import('../src/rendimiento-servidor.ts')

const plan = (db: any, sql: string, ...args: unknown[]) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((r) => r.detail).join(' | ')

test('corpus_entidades sigue a corpus.entidades (alta, cambio, baja y JSON roto) y reemplaza al json_each', () => {
  const db = abrir(':memory:')
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Ejemplo' })
  const beto = asegurarEntidad(db, { tipo: 'persona', nombre: 'Beto Ejemplo' })
  const obra = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'La obra' })
  const p1 = insertar(db, { fuente: 'operador', titulo: 'Uno', contenido: 'x', entidades: [ana, obra], origenId: 'r:1' })!
  const p2 = insertar(db, { fuente: 'operador', titulo: 'Dos', contenido: 'x', entidades: [ana, beto, obra], origenId: 'r:2' })!
  insertar(db, { fuente: 'operador', titulo: 'Tres', contenido: 'x', origenId: 'r:3' })
  const filas = () => (db.prepare('SELECT pieza_id, entidad_id FROM corpus_entidades ORDER BY 1, 2').all() as any[]).map((r) => `${r.pieza_id}:${r.entidad_id}`)
  assert.deepEqual(filas(), [`${p1}:${ana}`, `${p1}:${obra}`, `${p2}:${ana}`, `${p2}:${beto}`, `${p2}:${obra}`])

  assert.equal(leerEntidad(db, ana)!.piezas, 2)
  assert.equal(leerEntidad(db, beto)!.piezas, 1)
  assert.deepEqual(listarEntidades(db).map((e) => e.nombre).slice(0, 2), ['Ana Ejemplo', 'La obra'], 'ordenadas por piezas')
  assert.deepEqual(listarPiezas(db, { entidad: beto }).piezas.map((p) => p.id), [p2])
  assert.deepEqual(coocurrencias(db, ana).map((e) => [e.nombre, e.compartidas]), [['La obra', 2], ['Beto Ejemplo', 1]])

  db.prepare('UPDATE corpus SET entidades = ? WHERE id = ?').run(JSON.stringify([beto]), p1)
  assert.equal(leerEntidad(db, ana)!.piezas, 1)
  assert.equal(leerEntidad(db, beto)!.piezas, 2)
  db.prepare(`UPDATE corpus SET entidades = 'esto no es JSON' WHERE id = ?`).run(p1)
  assert.equal(leerEntidad(db, beto)!.piezas, 1, 'un JSON roto no rompe nada: la pieza queda sin entidades')
  db.prepare('DELETE FROM corpus WHERE id = ?').run(p2)
  assert.deepEqual(filas(), [])
  assert.equal(leerEntidad(db, 99999), null)
})

test('Las consultas calientes usan índice (no recorren tablas enteras)', () => {
  const db = abrir(':memory:')
  assert.match(plan(db, 'SELECT pieza_id FROM corpus_entidades WHERE entidad_id = ?', 1), /USING (COVERING )?INDEX corpus_entidades_ent/)
  assert.match(plan(db, 'SELECT COUNT(*) FROM llamadas WHERE en >= ?', 1), /USING (COVERING )?INDEX llamadas_cuando/)
  assert.match(plan(db, `SELECT estado, COUNT(*) FROM misiones WHERE padre_id = ? AND nivel = 'secundaria' GROUP BY estado`, 1), /USING INDEX misiones_padre/)
  assert.match(plan(db, `SELECT COUNT(*) FROM corpus WHERE json_extract(meta, '$.aporte') = 1 AND json_extract(meta, '$.primaria') = ?`, 1), /USING INDEX corpus_aporte/)
  assert.match(plan(db, `SELECT * FROM takeout_destilado WHERE lote = ? AND estado = 'pendiente' ORDER BY prioridad DESC LIMIT 1`, 'x'), /USING INDEX takeout_destilado_cola/)
  assert.match(plan(db, `SELECT * FROM directo_momentos WHERE tipo = 'pantalla' AND desde >= ? AND desde < ?`, 1, 2), /USING INDEX directo_momentos_tipo/)
  assert.match(plan(db, `SELECT * FROM preguntas WHERE estado = 'pendiente' ORDER BY id`), /USING INDEX preguntas_estado/)
  assert.equal(db.prepare('PRAGMA synchronous').get()!.synchronous, 1, 'NORMAL')
  assert.equal(db.prepare('PRAGMA busy_timeout').get()!.timeout, 5000)
})

test('Personas: cuántas veces la nombraste en el chat sale de un índice de palabras (y por palabra entera)', () => {
  const db = abrir(':memory:')
  const T = Date.now()
  const marti = asegurarEntidad(db, { tipo: 'persona', nombre: 'Martina Ejemplo' })
  asegurarEntidad(db, { tipo: 'persona', nombre: 'Mart Corto' })
  const conv = Number(db.prepare(`INSERT INTO conversaciones (con, creada_en, actualizada_en) VALUES ('mastropiero', ?, ?)`).run(T, T).lastInsertRowid)
  const msj = db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'operador', ?, ?)`)
  msj.run(conv, 'Hoy hablé con Martina del taller', T - 5 * 86_400_000)
  msj.run(conv, '¿Martina, venís? Martina!!', T - 2 * 86_400_000)
  msj.run(conv, 'MARTINA me mandó el presupuesto', T - 1 * 86_400_000)
  msj.run(conv, 'Martinas no es ella', T)
  const p = personas(db, { id: marti }, T)[0]
  assert.equal(p.ultimoContacto, new Date(T - 86_400_000).toLocaleDateString('sv-SE'), 'el último día que la nombró')
  assert.equal(p.nivelSugerido, 3, '3 mensajes: suma 2 al nivel sugerido')
})

test('Las rutas se agrupan sin ids para medir', () => {
  assert.equal(rutaNormal('GET', '/api/encargos/12'), 'GET /api/encargos/:id')
  assert.equal(rutaNormal('POST', '/api/procesos/3/paso/4'), 'POST /api/procesos/:id/paso/:id')
  assert.equal(rutaNormal('GET', '/js/30-hoy.js'), 'GET estático')
  assert.equal(rutaNormal('GET', '/adjuntos/1700-ab.jpg'), 'GET /adjuntos/*')
  assert.equal(rutaNormal('GET', '/'), 'GET /')
})
