import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { forjar, leer, listar } from '../src/roster.ts'
import { balance, cerrarTemporada, saldo, tabla, ventana } from '../src/economia.ts'
import { semanaDe } from '../src/misiones.ts'

const LUNES = new Date(2026, 9, 5, 10).getTime() // semana 2026-W41
const SEM = semanaDe(LUNES)

function tarea(db: any, agente: string, estado: string, tipo = 'ingesta', clase = 'extractor', en = LUNES + 3600_000) {
  db.prepare(`INSERT INTO tareas (tipo, clase, payload, estado, asignada_a, publicada_por, creada_en, actualizada_en) VALUES (?, ?, '{}', ?, ?, 'test', ?, ?)`).run(tipo, clase, estado, agente, en, en)
}

test('economía: cobra por lo que entrega, paga tokens y fallos; al cierre, banca, quiebra y clon', () => {
  const db = abrir(':memory:')
  assert.deepEqual(ventana(SEM).map((x) => new Date(x).getDay()), [1, 1])
  const bueno = forjar(db, { clase: 'extractor', motor: 'local', ahora: LUNES - 86_400_000 })
  const malo = forjar(db, { clase: 'extractor', motor: 'local', ahora: LUNES - 86_400_000 })
  const ayudante = forjar(db, { clase: 'generativo', motor: 'local', ahora: LUNES - 86_400_000 })
  db.prepare(`UPDATE agentes SET estado = 'activo'`).run()

  for (let i = 0; i < 5; i++) tarea(db, bueno.id, 'hecha')
  tarea(db, ayudante.id, 'hecha', 'aporte', 'generativo')
  tarea(db, malo.id, 'hecha')
  for (let i = 0; i < 2; i++) tarea(db, malo.id, 'fallida')
  db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'x', 'extractor', ?, 4000, 1000, 1, 200, ?)`).run(malo.id, LUNES + 7200_000)
  tarea(db, bueno.id, 'hecha', 'ingesta', 'extractor', LUNES - 2 * 86_400_000) // de la semana anterior: no cuenta
  for (let i = 0; i < 25; i++) db.prepare(`INSERT INTO tareas (tipo, clase, payload, estado, publicada_por, creada_en, actualizada_en) VALUES ('ingesta', 'extractor', '{}', 'pendiente', 'test', ?, ?)`).run(LUNES, LUNES)

  const neto = (id: string) => balance(db, SEM).filter((l) => l.agente === id).reduce((s, l) => s + l.monto, 0)
  assert.equal(neto(bueno.id), 25)
  assert.equal(neto(ayudante.id), 15, 'un aporte vale más que una tarea')
  assert.equal(neto(malo.id), 5 - 6 - 5)
  assert.equal(tabla(db, SEM)[0].temporada, 25)

  const r = cerrarTemporada(db, SEM, LUNES + 7 * 86_400_000)
  assert.equal(leer(db, malo.id)!.estado, 'banca', 'pérdida → banca')
  assert.equal(r.clones.length, 1, 'el mejor extractor con trabajo esperando se clona')
  assert.equal(listar(db, { clase: 'extractor' }).length, 3)
  assert.equal(saldo(db, bueno.id), 25)
  assert.match(r.texto!, /Temporada 2026-W41 cerrada\. Ganó .* \(\+25\) · a la banca: .* · clonados: /)
  assert.equal(cerrarTemporada(db, SEM, LUNES + 7 * 86_400_000).clones.length, 0, 'cerrarla de nuevo no clona ni castiga otra vez')
  assert.equal(saldo(db, bueno.id), 25)

  // Segunda temporada con pérdida estando en banca: quiebra.
  const prox = LUNES + 7 * 86_400_000
  tarea(db, malo.id, 'fallida', 'ingesta', 'extractor', prox + 3600_000)
  tarea(db, bueno.id, 'hecha', 'ingesta', 'extractor', prox + 3600_000)
  const r2 = cerrarTemporada(db, semanaDe(prox), prox + 7 * 86_400_000)
  assert.equal(leer(db, malo.id), null)
  assert.equal(r2.retirados.length, 1)
  assert.ok(db.prepare('SELECT 1 FROM lapidas WHERE id = ? AND causa LIKE ?').get(malo.id, 'quebró%'))
})

test('economía: una semana sin liga no castiga a nadie', () => {
  const db = abrir(':memory:')
  forjar(db, { clase: 'extractor', motor: 'local', ahora: LUNES })
  db.prepare(`UPDATE agentes SET estado = 'activo'`).run()
  const r = cerrarTemporada(db, SEM, LUNES)
  assert.deepEqual([r.banca, r.retirados, r.clones, r.texto], [[], [], [], null])
})
