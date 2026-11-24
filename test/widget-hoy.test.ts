import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fechaLocal } from '../src/db.ts'
import { crearMision } from '../src/misiones.ts'
import { _probarAvisos, ahoraEnDosLineas, proximosAvisos } from '../src/avisos-movil.ts'

test('Mobile · el widget: lo de ahora en dos líneas (la banda en curso, lo que sigue, lo próximo de la agenda)', async () => {
  const db = abrir(':memory:')
  const hoy = new Date(); hoy.setHours(10, 5, 0, 0)
  const T = hoy.getTime()
  // Sin nada: un empujón.
  _probarAvisos(async () => [])
  await proximosAvisos(db, T)
  assert.deepEqual(ahoraEnDosLineas(db, T), { titulo: 'Nada agendado', sub: 'Armá una run o contale a Mastropiero qué querés hacer.' })

  // Lo próximo de la agenda (lo de todo el día no cuenta).
  const evento = new Date(T); evento.setHours(15, 30, 0, 0)
  _probarAvisos(async (f: string) => (f === fechaLocal(T) ? [{ titulo: 'Todo el día', inicio: T - 3_600_000, fin: T + 9e7, todoElDia: true, lugar: null }, { titulo: 'Reunión con Ana', inicio: evento.getTime(), fin: evento.getTime() + 3_600_000, todoElDia: false, lugar: 'Ruzafa' }] : []))
  await proximosAvisos(db, T)
  assert.deepEqual(ahoraEnDosLineas(db, T), { titulo: 'Lo próximo: Reunión con Ana', sub: '15:30 · en 5 h 25 min · Ruzafa' })

  // Con una run en curso: la banda de ahora, y entre bandas, la que sigue.
  const run = Number(db.prepare(`INSERT INTO runs (fecha, inicio, fin, estado, pedido, creada_en) VALUES (?, '10:00', '11:00', 'en_curso', '{}', ?)`).run(fechaLocal(T), T).lastInsertRowid)
  crearMision(db, { nivel: 'secundaria', titulo: 'Escribir el mail', runId: run, inicio: '10:00', fin: '10:25', estado: 'activa' })
  crearMision(db, { nivel: 'secundaria', titulo: 'Revisar el contrato', runId: run, inicio: '10:30', fin: '11:00', estado: 'activa' })
  assert.deepEqual(ahoraEnDosLineas(db, T), { titulo: 'Escribir el mail', sub: 'Hasta las 10:25 · 0 de 2 bandas hechas' })
  assert.deepEqual(ahoraEnDosLineas(db, T + 22 * 60_000), { titulo: 'Lo que sigue: Revisar el contrato', sub: 'A las 10:30 · 0 de 2 hechas' })

})
