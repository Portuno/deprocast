import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
const { abrir } = await import('../src/db.ts')
const tb = await import('../src/tablero.ts')

const T = new Date(2026, 10, 3, 9).getTime() // martes 9:00
const H = 3_600_000

test('El tablero de Hoy: lo preparado (solo lo de las últimas 24 h, sin repetir), lo que espera, lo que corre; sin modelo', async () => {
  const db = abrir(':memory:')
  tb.anotarPreparado(db, 'la próxima clase de Retórica', 'aprender', T - 2 * H)
  tb.anotarPreparado(db, 'la próxima clase de Retórica', 'aprender', T - H)
  tb.anotarPreparado(db, 'la próxima sesión de Italiano', 'idiomas', T - 30 * H)
  db.prepare(`INSERT INTO campanas (titulo, objetivo, inicio, fin, estado, creada_en, actualizada_en) VALUES ('El programa', 'Pedir la entrevista', ?, ?, 'armada', ?, ?)`).run(T + 2 * 24 * H, T + 2 * 24 * H + 2 * H, T, T)
  db.prepare(`INSERT INTO observatorio_temas (nombre, consultas, plataformas, activo, intensivo_desde, intensivo_hasta, creado_en, actualizado_en) VALUES ('Un debate', '["x"]', '["x"]', 1, ?, ?, ?, ?)`).run(T - H, T + H, T, T)

  const r = await tb.tablero(db, T)
  assert.deepEqual(r.listo.map((x) => [x.texto, x.vista]), [['La próxima clase de Retórica', 'aprender']], 'lo de hace más de un día ya no está, y no se repite')
  const camp = r.espera.find((x) => x.vista === 'campanas')
  assert.match(camp!.texto, /El programa/)
  assert.ok(r.corriendo.some((x) => x.texto === 'Observatorio en vivo: Un debate'))
  assert.ok(r.corriendo.some((x) => /^A las \d\d:\d\d: /.test(x.texto)), 'la próxima rutina de hoy')

  tb.anotarPreparado(db, 'algo viejo', null, T + 20 * 24 * H)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM preparado WHERE que LIKE '%Italiano%'`).get() as { n: number }).n, 0, 'lo de más de 14 días se borra')
})
