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
    corpus: '1) El presupuesto definitivo es de 13.150 euros, desde el 3/11 [#202]; los 13.500 que menciona Ramón son de antes [#205]. 2) Quién paga la pintura no consta en los fragmentos: solo dicen que Ramón la cobra [#203]. 3) Subió 750 euros respecto del inicial de 12.400 [#201], un 6,0 %.',
    clasificacion: '{"etiquetas": ["gasto", "tarea", "idea", "ingreso", "salud", "tarea", "otro", "gasto", "idea", "salud"]}',
    redaccion: 'Hola, ¿cómo andás? El informe te lo entrego el lunes 17 e incluye el análisis de costos. La factura es de 1.200 euros. ¿Me confirmás si te viene bien?',
    extraccion: '{"nombre": "Lucía Ferrer", "fecha": "2026-03-03", "monto": 1250.5, "comision": 1.75, "devuelto": 200, "fecha_devolucion": "2026-03-12", "neto": 1048.75}',
    codigo: '```js\nfunction parsearMonto(texto) {\n  const s = String(texto ?? "").replace(/[^\\d.,-]/g, "")\n  if (!/\\d/.test(s)) return null\n  const neg = s.startsWith("-")\n  let t = s.replace(/-/g, "")\n  const c = t.lastIndexOf(","), p = t.lastIndexOf(".")\n  if (c >= 0 && p >= 0) t = c > p ? t.replace(/\\./g, "").replace(",", ".") : t.replace(/,/g, "")\n  else if (c >= 0) t = /,\\d{3}$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".")\n  else if (p >= 0 && /\\.\\d{3}$/.test(t)) t = t.replace(/\\./g, "")\n  const n = Number(t)\n  return Number.isFinite(n) ? (neg ? -n : n) : null\n}\n```',
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
  assert.match(q.texto, /Banco de pruebas v4[\s\S]*Clasificación: diez mensajes con reglas de desempate: gana/)
  const v = verBanco(db)
  assert.equal(v.pruebas.length, 5)
  assert.ok(v.historia.length >= 3)
})

test('#236 (banco v2): las trampas restan — el dato viejo, inventar quién paga, saltearse una regla, pasarse de palabras', () => {
  const p = (id: string) => BANCO.find((x) => x.id === id)!
  assert.ok(p('corpus').puntuar('El presupuesto definitivo es 12.400 euros [#201]. La pintura la paga Ramón.').puntaje <= 0)
  assert.match(p('clasificacion').puntuar('{"etiquetas": ["salud", "salud", "idea", "ingreso", "salud", "tarea", "otro", "gasto", "idea", "salud"]}').detalle, /la 1 como salud[\s\S]*la 2 como salud/)
  assert.ok(p('redaccion').puntuar('¡Hola! El informe sale el lunes 17 con los costos y la factura de 1.200 euros. ' + 'muy '.repeat(40) + 'bien.').puntaje < 0.6)
  assert.match(p('redaccion').puntuar('Hola, el informe se entrega el lunes 17 con el análisis de costos y la factura es de 1.200 euros. ¿Me confirmas si te viene bien?').detalle, /voseo ✗/)
  assert.match(p('redaccion').puntuar('Hola, el informe se entrega el lunes 17 con el análisis de costos y la factura es de 1.200 euros. ¿Te queda alguna duda?').detalle, /pregunta ✗ · voseo ✗/)
  assert.equal(p('codigo').puntuar('function parsearMonto(t) { return Number(t) }').puntaje < 0.5, true)
})

test('#236: si todos aciertan, la prueba «no distingue» (no se rota por precio); en lo interactivo, el más lento no conviene', async () => {
  const { veredictoDe } = await import('../src/benchmark.ts')
  const m = (modelo: string, porDefecto: boolean, puntaje: number, creditos: number, ms: number) => ({ prueba: 'x', modelo, porDefecto, ms, tokensIn: 1, tokensOut: 1, creditos, puntaje, detalle: '', error: null })
  const facil = veredictoDe(BANCO.find((p) => p.id === 'extraccion')!, [m('a', true, 1, 0.007, 2000), m('b', false, 1, 0.001, 2500)])
  assert.equal(facil.noDistingue, true)
  assert.equal(facil.rotar, false)
  assert.match(facil.texto, /la prueba no distingue/)
  const chat = veredictoDe(BANCO.find((p) => p.id === 'corpus')!, [m('rapido', true, 0.8, 0.006, 2800), m('barato', false, 0.9, 0.0017, 4700)])
  assert.equal(chat.rotar, false, '4,7 s contra 2,8 s en el chat: no')
  const fondo = veredictoDe(BANCO.find((p) => p.id === 'extraccion')!, [m('caro', true, 0.6, 0.007, 2000), m('mejor', false, 0.9, 0.002, 5000)])
  assert.equal(fondo.rotar, true, 'de fondo, acierta más y cuesta menos: conviene')
})
