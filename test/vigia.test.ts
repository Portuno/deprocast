import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fijarAjuste } from '../src/db.ts'
import { estadoSistema, vigilar } from '../src/vigia.ts'

test('vigía · cada pieza con su estado, y el aviso por WhatsApp una vez cada 12 horas por problema', async () => {
  const db = abrir(':memory:')
  const ahora = Date.now()
  // Todo tranquilo: nada «mal», y la ronda no avisa nada.
  let s = await estadoSistema(db, { commit: 'abc1234def', arranco: ahora - 3_600_000, ahora })
  assert.deepEqual(s.piezas.map((p) => p.id), ['servidor', 'integridad', 'drive', 'whatsapp', 'taller', 'errores', 'gasto'])
  assert.match(s.piezas[0].detalle, /commit abc1234, arrancó hace 1 h/)
  assert.ok(!s.piezas.some((p) => p.estado === 'mal'))
  const dichos: string[] = []
  const decir = async (t: string) => { dichos.push(t); return true }
  assert.deepEqual(await vigilar(db, { ahora, decir }), { avisados: [], mandado: false })

  // Se rompe algo: archivos que no suben al Drive y un trabajo del Taller colgado.
  fijarAjuste(db, 'google_refresh', 'r')
  db.prepare(`INSERT INTO drive_cola (archivo, nombre, mime, carpeta, origen, creado, intentos, error) VALUES ('x', 'a.mp3', 'audio/mpeg', '[]', 'podcast', ?, 6, 'invalid_grant')`).run(ahora - 3 * 3_600_000)
  db.exec(`CREATE TABLE IF NOT EXISTS taller_cola (id INTEGER PRIMARY KEY, tipo TEXT, args TEXT, titulo TEXT, artefacto_id INTEGER, prioridad INTEGER, clave TEXT, origen TEXT, estado TEXT, error TEXT, tokens INTEGER, encolado_en INTEGER, empezado_en INTEGER, terminado_en INTEGER)`)
  db.prepare(`INSERT INTO taller_cola (tipo, args, titulo, origen, estado, encolado_en, empezado_en) VALUES ('crear', '{}', 'Un video largo', 'pantalla', 'haciendo', ?, ?)`).run(ahora - 7_200_000, ahora - 3_600_000)
  s = await estadoSistema(db, { ahora })
  assert.equal(s.estado, 'mal')
  assert.equal(s.piezas.find((p) => p.id === 'drive')!.estado, 'mal')
  assert.equal(s.piezas.find((p) => p.id === 'taller')!.estado, 'mal')

  const r = await vigilar(db, { ahora, decir })
  assert.equal(r.mandado, true)
  assert.equal(r.avisados.length, 2)
  assert.match(dichos[0], /Ojo, algo en Deprocast no anda:[\s\S]*no suben a tu Drive después de 6 intentos \(invalid_grant\)[\s\S]*«Un video largo» lleva 1 h haciéndose[\s\S]*La máquina → Estado/)
  // El mismo problema no se repite en la ronda siguiente; pasadas 12 horas, sí.
  assert.equal((await vigilar(db, { ahora: ahora + 15 * 60_000, decir })).avisados.length, 0)
  assert.equal((await vigilar(db, { ahora: ahora + 13 * 3_600_000, decir })).avisados.length, 2)
  // La caché del chat: las llamadas que no la anotan (el streaming de antes) no cuentan; sin otras, «sin medir».
  const llamada = (cache: number | null) => db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, tokens_cache, latencia_ms, status, en) VALUES ('nan', 'm', 'mastropiero', 'mastropiero', 2000000, 100, ?, 1, 200, ?)`).run(cache, ahora)
  llamada(null)
  let g = (await estadoSistema(db, { ahora })).piezas.find((p) => p.id === 'gasto')!
  assert.match(g.detalle, /El chat, hoy: caché sin medir todavía/)
  assert.equal(g.problemas.length, 0, 'sin medir no es un 0 %')
  llamada(100_000)
  g = (await estadoSistema(db, { ahora })).piezas.find((p) => p.id === 'gasto')!
  assert.match(g.detalle, /El chat, hoy: 5 % de caché/)
  assert.equal(g.problemas.length, 1, 'medida y baja, sí')
  // Si lo apaga, no avisa.
  fijarAjuste(db, 'vigia_whatsapp', '0')
  assert.equal((await vigilar(db, { ahora: ahora + 30 * 3_600_000, decir })).avisados.length, 0)
  assert.equal((await estadoSistema(db, { ahora })).avisos, false)
})
