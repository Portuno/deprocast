import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { forjar, leer, nivel, bautizar } from '../src/roster.ts'
import { _probarBautizo, bautizarConCriterio, proponerNombres } from '../src/bautizo.ts'

test('el bautizo con criterio (Fragua #175): candidatos con puntaje y motivo, y al bautizar dice por qué ganó', async () => {
  const db = abrir(':memory:')
  const otro = forjar(db, { clase: 'generativo', reparto: { ritmo: 5 } })
  const f = forjar(db, { clase: 'generativo', reparto: { ritmo: 5 } })
  db.prepare('UPDATE agentes SET xp = 100000 WHERE id IN (?, ?)').run(f.id, otro.id)
  assert.ok(nivel(leer(db, f.id)!) >= 3)
  bautizar(db, otro.id, 'Juglar')
  let vio = ''
  _probarBautizo(async (_db, _s, u) => {
    vio = u
    return { criterio: 'Que se entienda qué hace', candidatos: [
      { nombre: 'Saturnino, el Modista', puntaje: 7, motivo: 'Corta y cose textos a medida.' },
      { nombre: 'Juglar', puntaje: 9, motivo: 'ya usado' },
      { nombre: 'Clotilde, la Tejedora', puntaje: 8, motivo: 'Teje piezas largas.' },
    ] }
  })
  const p = await proponerNombres(db, f.id)
  assert.match(vio, /Nombres que ya hay en la liga.*Juglar/)
  assert.deepEqual(p.candidatos.map((c) => c.nombre), ['Clotilde, la Tejedora', 'Saturnino, el Modista'], 'ordenados por puntaje y sin los usados')
  const r = bautizarConCriterio(db, f.id, 'Saturnino, el Modista')
  assert.match(r.porQue!, /Ganó «Saturnino, el Modista» \(7\/10\): Corta y cose.*Criterio: Que se entienda qué hace/)
  assert.equal(leer(db, f.id)!.nombre, 'Saturnino, el Modista')
})
