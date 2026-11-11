import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { M } from '../src/nan.ts'
import { BANCO, codigoDe, correrBanco, motoresDe, probarFuncion, verBanco } from '../src/benchmark.ts'

test('#236: el código del modelo corre en una caja aparte, contra sus casos; lo que se cuelga o rompe no pasa', () => {
  const bien = 'function sumaPares(xs) { return xs.filter((x) => typeof x === "number" && x % 2 === 0).reduce((s, x) => s + x, 0) }'
  assert.deepEqual(probarFuncion(bien, 'sumaPares', [[[[1, 2, 3, 4]], 6], [[[2, '4', null, 6]], 8]]), { pasan: 2, total: 2, error: null })
  assert.equal(probarFuncion('function sumaPares() { while (true) {} }', 'sumaPares', [[[[1]], 0]]).pasan, 0, 'un bucle infinito no cuelga nada')
  assert.match(probarFuncion('process.exit(1)', 'sumaPares', [[[[1]], 0]]).error!, /process is not defined/, 'sin process')
  assert.equal(codigoDe('Acá va:\n```js\nfunction f() {}\n```\nListo.'), 'function f() {}')
})

test('#236: cada prueba tiene su criterio y su puntaje; el banco corre contra el de siempre y dos alternativas, y el veredicto queda sellado', async () => {
  const db = abrir(':memory:')
  // Un motor que acierta todo (el «bueno») y los demás que fallan a medias.
  const bueno = M.qwen
  const respuestas: Record<string, string> = {
    corpus: 'Quedó en 12.400 euros con IVA [#102].',
    clasificacion: '{"etiquetas": ["gasto", "idea", "tarea", "salud", "gasto", "tarea"]}',
    redaccion: 'Hola, ¿cómo andás? Te aviso que el informe te lo entrego el lunes y trae el análisis de costos. Cualquier cosa me avisás.',
    extraccion: '{"nombre": "Lucía Ferrer", "fecha": "2026-03-03", "monto": 1250.5}',
    codigo: '```js\nfunction sumaPares(xs) { return xs.filter((x) => typeof x === "number" && x % 2 === 0).reduce((s, x) => s + x, 0) }\n```',
  }
  _probarModelo(async (l: any) => {
    const prueba = String(l.agenteId).split(':')[1]
    const modelo = l.modelos[0]
    return { texto: modelo === bueno ? respuestas[prueba] : 'No sé.', llamadas: [], razonamiento: null, modelo, tokens: 10 }
  })
  for (const p of BANCO) assert.ok(p.puntuar(respuestas[p.id]).puntaje >= 0.99, `${p.id}: la respuesta de referencia saca el máximo`)
  const r = await correrBanco(db, { ahora: Date.parse('2026-11-16T04:30:00') })
  assert.equal(r.veredictos.length, 5)
  for (const v of r.veredictos) {
    const { motores } = motoresDe(BANCO.find((p) => p.id === v.prueba)!)
    assert.equal(motores.length, 3, 'el de siempre y dos alternativas')
    if (motores.includes(bueno)) assert.equal(v.ganador.modelo, bueno)
  }
  const q = db.prepare('SELECT etapa, titulo, texto FROM quantomos WHERE id = ?').get(r.quantomo) as any
  assert.equal(q.etapa, 'sellado')
  assert.match(q.titulo, /Banco de pruebas · 2026-11-16/)
  assert.match(q.texto, /Clasificación: seis mensajes en cuatro etiquetas: gana/)
  const v = verBanco(db)
  assert.equal(v.pruebas.length, 5)
  assert.ok(v.historia.length >= 3)
})
