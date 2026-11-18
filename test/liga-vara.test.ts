import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { forjar } from '../src/roster.ts'
import { balance, piezasUsadas, rendimiento } from '../src/economia.ts'
import { insertar } from '../src/corpus.ts'
import { conversacionHoy } from '../src/chat/index.ts'
import { semanaDe } from '../src/misiones.ts'

const LUNES = new Date(2026, 10, 16, 10).getTime() // semana 2026-W47
const SEM = semanaDe(LUNES)

test('la vara de la liga: el gasto en créditos, lo que usaste paga, y el rendimiento con su veredicto', () => {
  const db = abrir(':memory:')
  const util = forjar(db, { clase: 'extractor', motor: 'local', ahora: LUNES - 86_400_000 })
  const caro = forjar(db, { clase: 'clasificador', motor: 'local', ahora: LUNES - 86_400_000 })
  db.prepare(`UPDATE agentes SET estado = 'activo'`).run()
  const en = LUNES + 3_600_000

  // Una pieza que procesó el útil, y otra que escribió él; Mastropiero te cita las dos (una, dos veces).
  const p1 = insertar(db, { fuente: 'operador', titulo: 'Notas del viaje', contenido: 'a', nivel: 'propia', origenId: 'x:1' })!
  const p2 = insertar(db, { fuente: 'operador', titulo: 'Resumen', contenido: 'b', nivel: 'generada', origenId: 'x:2', autor: util.id })!
  const p3 = insertar(db, { fuente: 'operador', titulo: 'Clasificada y nunca usada', contenido: 'c', nivel: 'propia', origenId: 'x:3' })!
  const tarea = (agente: string, corpus: number) => db.prepare(`INSERT INTO tareas (tipo, clase, payload, estado, asignada_a, publicada_por, creada_en, actualizada_en, corpus_id) VALUES ('ingesta', 'x', '{}', 'hecha', ?, 'test', ?, ?, ?)`).run(agente, en, en, corpus)
  tarea(util.id, p1)
  for (let i = 0; i < 20; i++) tarea(caro.id, p3)
  const cid = conversacionHoy(db).id
  const decir = (t: string) => db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'asistente', ?, ?)`).run(cid, t, en)
  decir(`Lo anotaste en el viaje [#${p1}] y lo resumió la liga [#${p2}].`)
  decir(`Como decía [#${p1}].`)

  // El gasto: en créditos donde hay precio; por tokens donde no.
  const llamada = (agente: string, creditos: number | null, tokens: number) => db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en, creditos) VALUES ('nan', 'x', 'x', ?, ?, 0, 1, 200, ?, ?)`).run(agente, tokens, en, creditos)
  llamada(caro.id, 8, 2_000_000)
  llamada(util.id, 0.5, 100_000)
  llamada(util.id, null, 3_000)

  const usadas = piezasUsadas(db, LUNES, LUNES + 7 * 86_400_000)
  assert.deepEqual([...(usadas.get(util.id) ?? [])].sort(), [p1, p2].sort(), 'la que procesó y la que escribió, una vez cada una')
  assert.equal(usadas.get(caro.id), undefined)

  const lineas = (id: string) => balance(db, SEM).filter((l) => l.agente === id)
  assert.ok(lineas(caro.id).some((l) => l.motivo === '8 créditos' && l.monto === -80), 'los 2 millones de tokens se cobran como los 8 créditos que costaron')
  assert.ok(!lineas(caro.id).some((l) => /K tokens/.test(l.motivo)))
  assert.ok(lineas(util.id).some((l) => l.motivo === '3K tokens' && l.monto === -3), 'sin precio, por tokens')
  assert.ok(lineas(util.id).some((l) => l.motivo === '2 de sus piezas que Mastropiero usó con vos' && l.monto === 6))

  const r = rendimiento(db, 30, LUNES + 2 * 86_400_000)
  assert.equal(r[0].agente, caro.id, 'arriba, el que más gasta')
  assert.equal(r[0].veredicto, 'caro sin resultados')
  assert.equal(r[0].tareas, 20)
  const u = r.find((x) => x.agente === util.id)!
  assert.equal(u.usadas, 2)
  assert.equal(u.valor, 6)
  assert.equal(u.porCredito, 12)
  assert.equal(u.veredicto, 'rinde')
})
