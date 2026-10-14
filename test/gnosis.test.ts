import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarGnosis, cronicaDelDia, escribirCronica, sintesisSemanal } from '../src/gnosis.ts'
import { registrarSalud } from '../src/salud.ts'
import { registrarMovimiento } from '../src/finanzas.ts'
import { asegurarEntidad, listarEntidades } from '../src/entidades.ts'
import { registrarPractica } from '../src/aprender.ts'
import { listarQuantomos } from '../src/quantomos.ts'
import { memoriaVigente } from '../src/memoria.ts'
import { _probarEscribaPreguntas, siguientePregunta } from '../src/preguntas.ts'

_probarEscribaPreguntas(async () => [])

test('gnosis: la crónica del día junta cuerpo, plata y aprendizaje en una pieza propia (y se reescribe sin duplicar)', () => {
  const db = abrir(':memory:')
  const T = new Date(2026, 9, 14, 21).getTime()
  assert.equal(escribirCronica(db, '2026-10-14', T), null, 'un día sin registros no deja crónica')
  const corru = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Corruptopolis' }, T)
  registrarSalud(db, { tipo: 'comida', titulo: 'Almuerzo: pollo con arroz', fecha: '2026-10-14', hora: '13:30', datos: { kcal: 650, proteina: 45 } }, T)
  registrarSalud(db, { tipo: 'ejercicio', titulo: 'Gym', fecha: '2026-10-14', datos: { minutos: 50 } }, T)
  registrarMovimiento(db, { fecha: '2026-10-14', monto: -18.5, descripcion: 'Imprenta cartas Corruptopolis' }, T)
  registrarPractica(db, { tema: 'Francés', minutos: 15, que: 'los números', fecha: '2026-10-14' }, T)
  const { texto, entidades } = cronicaDelDia(db, '2026-10-14')
  assert.match(texto, /## Cuerpo\nComió \(650 kcal, 45 g de proteína\): 13:30 Almuerzo: pollo con arroz\.\nEjercicio: Gym \(50 min\)\./)
  assert.match(texto, /## Plata\n-18.5 EUR · Imprenta cartas Corruptopolis \(otros · Corruptopolis\)/)
  assert.match(texto, /## Aprendizaje\nFrancés 15 min: los números/)
  assert.deepEqual(entidades, [corru])
  const id = escribirCronica(db, '2026-10-14', T)!
  registrarSalud(db, { tipo: 'sueno', fecha: '2026-10-14', datos: { horas: 7 } }, T)
  assert.equal(escribirCronica(db, '2026-10-14', T), id, 'la misma pieza, actualizada')
  const p = db.prepare('SELECT nivel, fuente, contenido FROM corpus WHERE id = ?').get(id) as any
  assert.deepEqual([p.nivel, p.fuente], ['propia', 'vida'])
  assert.match(p.contenido, /Durmió 7 h/)
  assert.ok(listarEntidades(db, { tipo: 'dominio' }).some((e) => e.nombre === 'Francés'), 'lo que aprende es un nodo del grafo')
})

test('gnosis: la síntesis de la semana deja la carta, patrones como quántomos proto y recuerdos, y preguntas', async () => {
  const db = abrir(':memory:')
  const T = new Date(2026, 9, 18, 21, 30).getTime()
  for (const [f, min] of [['2026-10-13', 45], ['2026-10-15', 50], ['2026-10-17', 40]] as const) registrarSalud(db, { tipo: 'ejercicio', titulo: 'Gym', fecha: f, datos: { minutos: min } }, T)
  let vio = ''
  _probarGnosis(async (_db, u) => {
    vio = u
    return {
      texto: 'Entrenaste tres días, en días alternos. La semana que viene, sumá el viernes.',
      patrones: [{ texto: 'Entrena en días alternos: martes, jueves y sábado.', evidencia: '13, 15 y 17/10' }, { texto: 'corto' }],
      preguntas: ['¿Qué te impide entrenar dos días seguidos?'],
    }
  })
  const r = (await sintesisSemanal(db, '2026-10-18', T))!
  assert.match(vio, /Crónica del martes, 13 de octubre[\s\S]*Crónica del sábado, 17 de octubre/)
  assert.deepEqual([r.patrones, r.preguntas], [1, 1])
  const [q] = listarQuantomos(db, { etapa: 'proto' }).quantomos
  assert.equal(q.texto, 'Entrena en días alternos: martes, jueves y sábado.')
  assert.equal(q.universo, 'vida')
  assert.ok(memoriaVigente(db).some((m) => m.texto === q.texto && !m.revisada))
  assert.equal(siguientePregunta(db)?.texto, '¿Qué te impide entrenar dos días seguidos?')
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE fuente = 'vida'`).get() as any).n, 3, 'escribió las crónicas que faltaban')
  // Una semana sin registros no se sintetiza.
  assert.equal(await sintesisSemanal(abrir(':memory:'), '2026-10-18', T), null)
})
