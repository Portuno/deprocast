import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarRepaso, listarAprendizajes, prepararRepaso, registrarPractica, aprenderParaPrompt } from '../src/aprender.ts'
import { responderPregunta, siguientePregunta, _probarEscribaPreguntas } from '../src/preguntas.ts'
import { _probarCaptura, clasificar, registrarCaptura } from '../src/captura.ts'
import { _probarEscriba } from '../src/chat/index.ts'

_probarEscriba(async () => {})
_probarEscribaPreguntas(async () => [])

test('aprender: práctica, días del mes y repaso espaciado (1, 3, 7, 16 días; salteado vuelve mañana)', async () => {
  const db = abrir(':memory:')
  const T = new Date(2026, 9, 14, 9).getTime()
  const dia = 86_400_000
  registrarPractica(db, { tema: 'Francés', minutos: 15, que: 'pronunciación', fecha: '2026-10-12' }, T)
  registrarPractica(db, { tema: 'francés', minutos: 20, que: 'pasado compuesto', fecha: '2026-10-13' }, T)
  const { practica, aprendizaje } = registrarPractica(db, { tema: 'FRANCES', minutos: 30, que: 'verbos en pasado' }, T)
  const [fr] = listarAprendizajes(db, {}, T)
  assert.deepEqual([fr.tema, fr.practicas, fr.minutos, fr.diasMes], ['Francés', 3, 65, 3], 'el mismo tema aunque cambie la forma de escribirlo')
  assert.match(aprenderParaPrompt(db, T), /Francés — 65 min esta semana, 3 días este mes/)

  _probarRepaso(async () => ({ preguntas: ['¿Cómo se dice «fui» en francés?', '¿Qué auxiliar lleva «aller» en pasado compuesto?', 'una tercera que sobra'] }))
  const ids = await prepararRepaso(db, aprendizaje, practica, T)
  assert.equal(ids.length, 2, '30 minutos o más: dos preguntas')
  assert.equal(siguientePregunta(db, T), null, 'hoy no: vuelve mañana')
  const p = siguientePregunta(db, T + dia)!
  assert.equal(p.texto, '¿Cómo se dice «fui» en francés?')
  await responderPregunta(db, p.id, 'je suis allé', T + dia)
  const vuelta = db.prepare('SELECT estado, vuelve_en, repaso FROM preguntas WHERE id = ?').get(p.id) as any
  assert.deepEqual([vuelta.estado, vuelta.repaso, (vuelta.vuelve_en - (T + dia)) / dia], ['pendiente', 1, 3])
  const q = siguientePregunta(db, T + dia)!
  await responderPregunta(db, q.id, null, T + dia)
  const salteada = db.prepare('SELECT repaso, vuelve_en FROM preguntas WHERE id = ?').get(q.id) as any
  assert.deepEqual([salteada.repaso, (salteada.vuelve_en - (T + dia)) / dia], [0, 1], 'salteada: mañana otra vez')
  for (const n of [2, 3, 4]) await responderPregunta(db, p.id, 'ok', T + 10 * dia * n)
  assert.equal((db.prepare('SELECT estado FROM preguntas WHERE id = ?').get(p.id) as any).estado, 'respondida', 'después de la última vuelta, se termina')
})

test('captura: lo que estudió y el ejercicio se anotan', async () => {
  const db = abrir(':memory:')
  const T = new Date(2026, 9, 14, 9).getTime()
  _probarRepaso(async () => ({ preguntas: [] }))
  const respuestas: Record<string, any> = {
    estudie: { tipo: 'aprendizaje', confianza: 0.9, titulo: 'Francés', datos: { tema: 'Francés', minutos: 12, que: 'los números' } },
    gym: { tipo: 'ejercicio', confianza: 0.95, titulo: 'Gym: piernas', datos: { minutos: 50 } },
  }
  _probarCaptura(async (_db, o) => respuestas[Object.keys(respuestas).find((k) => o.texto.includes(k))!])
  const e = registrarCaptura(db, await clasificar(db, { texto: 'estudie' }), { ahora: T })!
  assert.match(e.resumen, /📚 Francés: 12 min · los números/)
  const g = registrarCaptura(db, await clasificar(db, { texto: 'gym' }), { ahora: T })!
  assert.match(g.resumen, /💪 Gym: piernas: 50 min\. Anotado\.$/)
})
