import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fijarAjuste } from '../src/db.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { insertar } from '../src/corpus.ts'
import { semanaDe } from '../src/misiones.ts'
import { ACCIONES } from '../src/rutinas.ts'
import { _probarPosicion, agregarPregunta, detectar, listarPreguntas, medirPosicion, parteSemanal, quitarPregunta, tablero, tableros } from '../src/posicion.ts'

const DIA = 86_400_000

test('Fragua #293: detectar lo nombra como palabra, con su puesto en la lista y la frase', () => {
  const lista = 'Te recomiendo:\n\n1. **Productora Norte** — spots de marca.\n2. **Estudio Faro**: documentales y spots.\n3. Otra Más\n\nTodas trabajan en la zona.'
  assert.deepEqual(detectar(lista, ['Estudio Faro']), { aparece: true, puesto: 2, fragmento: 'Estudio Faro: documentales y spots.' })
  assert.equal(detectar(lista, ['Faro Films', 'estudio faro']).puesto, 2, 'por alias, sin mayúsculas')
  assert.equal(detectar('- Estúdio Fáro hace spots', ['Estudio Faro']).aparece, true, 'sin tildes')
  assert.equal(detectar('Visitá Versalles este verano.', ['Versa']).aparece, false, 'como palabra, no como parte de otra')
  assert.deepEqual(detectar('No conozco ninguna, pero Estudio Faro suena.', ['Estudio Faro']), { aparece: true, puesto: null, fragmento: 'No conozco ninguna, pero Estudio Faro suena.' })
  assert.equal(detectar(lista, ['Nadie']).aparece, false)
  assert.equal(detectar(lista, ['ab']).aparece, false, 'un nombre de menos de tres letras no cuenta')
})

test('Fragua #293: cada pregunta va a cada modelo, sin contexto, una vez por semana; la serie marca la semana en que cambió la hoja citable', async () => {
  const db = abrir(':memory:')
  const faro = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Estudio Faro', alias: ['Faro'] })
  fijarAjuste(db, 'posicion_modelos', 'modelo-a,modelo-b,modelo-c')
  const pedidos: { modelo: string; pregunta: string }[] = []
  _probarPosicion(async (_db, modelo, pregunta) => {
    pedidos.push({ modelo, pregunta })
    if (modelo === 'modelo-c') throw new Error('sin saldo')
    return { texto: modelo === 'modelo-a' ? '1. Productora Norte\n2. Estudio Faro, para spots' : 'Productora Norte y Otra.', tokens: 300 }
  })
  assert.throws(() => agregarPregunta(db, faro, 'corta'), /muy corta/)
  const q = agregarPregunta(db, 'estudio faro', '¿Qué productoras audiovisuales recomendás para un spot?')
  assert.equal(agregarPregunta(db, faro, '¿Qué productoras audiovisuales recomendás para un spot?').id, q.id, 'la misma no se duplica')

  const lunes = new Date(2026, 10, 16, 9, 30).getTime()
  const r = await medirPosicion(db, { ahora: lunes })
  assert.deepEqual([r.nuevas, r.fallas.length], [2, 1])
  assert.deepEqual(pedidos.map((p) => p.pregunta), Array(3).fill('¿Qué productoras audiovisuales recomendás para un spot?'), 'la pregunta sola, igual para todos')
  pedidos.length = 0
  assert.equal((await medirPosicion(db, { ahora: lunes + DIA })).nuevas, 0, 'la misma semana no se vuelve a preguntar')
  assert.deepEqual(pedidos.map((p) => p.modelo), ['modelo-c'], 'solo el que falló')

  // La semana siguiente cambia la hoja citable y lo nombran todos.
  _probarPosicion(async () => ({ texto: '1. Estudio Faro\n2. Productora Norte', tokens: 200 }))
  const otro = lunes + 7 * DIA
  insertar(db, { fuente: 'operador', titulo: 'Hoja citable · Estudio Faro · v1', contenido: 'x', nivel: 'propia', entidades: [faro], origenId: 'hoja:1' })
  db.prepare(`UPDATE corpus SET fuente = 'hojas', creado_en = ? WHERE origen_id = 'hoja:1'`).run(otro)
  await medirPosicion(db, { ahora: otro })

  const t = tablero(db, faro)
  assert.deepEqual(t.serie.map((s) => [s.semana, s.apariciones, s.respuestas, s.porcentaje, s.mejorPuesto, s.hoja]), [
    [semanaDe(lunes), 1, 2, 50, 2, false],
    [semanaDe(otro), 3, 3, 100, 1, true],
  ])
  assert.deepEqual(t.preguntas[0].ultimas.map((x) => [x.modelo, x.aparece, x.puesto]), [['modelo-a', true, 1], ['modelo-b', true, 1], ['modelo-c', true, 1]])
  assert.equal(tableros(db)[0].ultima!.porcentaje, 100)
  assert.match(parteSemanal(db)!, /Estudio Faro\*\*: lo nombran en 3 de 3 respuestas \(100 %\), mejor puesto 1 \(la anterior, 1 de 2\) · esta semana cambió su hoja citable/)

  quitarPregunta(db, q.id)
  assert.equal(listarPreguntas(db).length, 0)
  assert.equal(tablero(db, faro).preguntas.length, 1, 'lo medido queda en la serie')
})

test('Fragua #293: la rutina de los lunes no gasta nada si no cargó preguntas', async () => {
  const db = abrir(':memory:')
  let llamadas = 0
  _probarPosicion(async () => { llamadas++; return { texto: '', tokens: 0 } })
  assert.equal(await ACCIONES.posicion(db, '2026-11-16', Date.now()), null)
  assert.equal(llamadas, 0)
  assert.equal(parteSemanal(db), null)
})
