import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
const { abrir } = await import('../src/db.ts')
const { migrarCien } = await import('../src/migrar-cien.ts')

/** Las tablas del plan como estaban (ya no están en el esquema), con algo adentro. */
function conPlanViejo() {
  const db = abrir(':memory:')
  db.exec(`
    CREATE TABLE planes (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, desde TEXT NOT NULL, hasta TEXT NOT NULL, semana0 TEXT NOT NULL, creado_en INTEGER NOT NULL);
    CREATE TABLE frentes (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, nombre TEXT NOT NULL, corto TEXT, ganar TEXT, principio TEXT, orden INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE habitos (id TEXT PRIMARY KEY, plan_id TEXT, titulo TEXT NOT NULL, frente_id TEXT, por_semana INTEGER NOT NULL DEFAULT 7, dias TEXT NOT NULL DEFAULT '[]', orden INTEGER NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE plan_dias (fecha TEXT PRIMARY KEY, verbos TEXT NOT NULL DEFAULT '{}', habitos TEXT NOT NULL DEFAULT '{}', woop TEXT, peso REAL, nota TEXT, actualizado_en INTEGER NOT NULL);
    CREATE TABLE plan_semanas (plan_id TEXT NOT NULL, n INTEGER NOT NULL, foco TEXT NOT NULL, PRIMARY KEY (plan_id, n));
    CREATE TABLE plan_tareas (origen TEXT PRIMARY KEY, plan_id TEXT NOT NULL, mision_id INTEGER NOT NULL, frente_id TEXT, obligatoria INTEGER NOT NULL DEFAULT 0, hito INTEGER NOT NULL DEFAULT 0);
  `)
  db.prepare(`INSERT INTO planes VALUES ('p1', 'Plan de prueba', '2026-09-23', '2026-12-31', '2026-09-21', 1)`).run()
  db.prepare(`INSERT INTO frentes VALUES ('cuerpo', 'p1', 'Cuerpo', 'Cuerpo', 'Correr 10 km sin parar', 'Primero el movimiento, después la dieta', 1), ('idiomas', 'p1', 'Idiomas', 'Idiomas', 'Charlar 15 minutos en francés', NULL, 2)`).run()
  db.prepare(`INSERT INTO habitos (id, plan_id, titulo, frente_id, por_semana, dias) VALUES ('h1', 'p1', 'Entrenar', 'cuerpo', 3, '[1,3,5]'), ('h2', 'p1', 'Francés', 'idiomas', 5, '[]'), ('h3', 'p1', 'Voto de los seis verbos', NULL, 7, '[]')`).run()
  db.prepare(`INSERT INTO plan_dias (fecha, verbos, habitos, woop, nota, actualizado_en) VALUES ('2026-10-01', '{"estudio":true}', '{"h1":true}', '{"w":"Mandar la propuesta","ob":"Me pongo a pulir"}', 'Buen día', 1), ('2026-10-02', '{"trabajo":true}', '{}', NULL, NULL, 1)`).run()
  db.prepare(`INSERT INTO plan_semanas VALUES ('p1', 1, 'Arrancar sin romperse')`).run()
  db.prepare(`INSERT INTO rutinas (id, nombre, hora, dias, accion, activa) VALUES ('voto', 'El voto', '22:15', '0123456', 'voto', 1)`).run()
  db.prepare(`INSERT INTO identidades (frase, ataduras, creada_en) VALUES ('Soy alguien que se mueve', '{"habitos":["h1"],"aprendizajes":[3]}', 1)`).run()
  return db
}

test('Adiós a los Cien Días: respaldo, su conocimiento al corpus como suyo, dominios, y las tablas se van', () => {
  const db = conPlanViejo()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cien-'))
  const r = migrarCien(db, { respaldos: dir, ahora: new Date(2026, 9, 22, 12).getTime() })!
  assert.ok(r)

  const respaldo = JSON.parse(fs.readFileSync(r.respaldo!, 'utf8'))
  assert.equal(respaldo.tablas.plan_dias.length, 2, 'el respaldo lleva todo, también los votos')
  assert.equal(path.basename(r.respaldo!), 'cien-dias-2026-10-22.json')

  const piezas = db.prepare(`SELECT titulo, contenido, nivel FROM corpus WHERE meta LIKE '%cien-dias%' ORDER BY id`).all() as any[]
  assert.deepEqual(piezas.map((p) => p.titulo), ['Frente: Cuerpo', 'Frente: Idiomas', 'Los focos de cada semana (Plan de prueba)', 'Lo que practicaba', 'Notas y WOOP del plan'])
  assert.ok(piezas.every((p) => p.nivel === 'propia'))
  assert.match(piezas[0].contenido, /\*\*Qué es ganar:\*\* Correr 10 km sin parar/)
  assert.match(piezas[0].contenido, /- Entrenar \(lun, mié, vie\)/)
  assert.match(piezas[4].contenido, /## 2026-10-01\n- Deseo: Mandar la propuesta\n- Obstáculo: Me pongo a pulir\n- Nota: Buen día/)
  assert.doesNotMatch(piezas[4].contenido, /2026-10-02/, 'un día sin nota ni WOOP no es conocimiento')

  const dominios = (db.prepare(`SELECT nombre FROM entidades WHERE tipo = 'dominio' ORDER BY nombre`).all() as any[]).map((e) => e.nombre)
  assert.ok(dominios.includes('Cuerpo') && dominios.includes('Entrenar') && dominios.includes('Francés'))
  assert.ok(!dominios.some((d) => /voto/i.test(d)), 'votar no es un tema')

  for (const t of ['planes', 'frentes', 'habitos', 'plan_dias', 'plan_semanas', 'plan_tareas']) {
    assert.equal(db.prepare(`SELECT 1 FROM sqlite_master WHERE name = ?`).get(t), undefined, `${t} se borró`)
  }
  assert.equal(db.prepare(`SELECT 1 FROM rutinas WHERE id = 'voto'`).get(), undefined)
  assert.deepEqual(JSON.parse((db.prepare('SELECT ataduras FROM identidades').get() as any).ataduras), { aprendizajes: [3] })

  assert.equal(migrarCien(db, { respaldos: dir }), null, 'la segunda vez no hace nada')
})
