import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { publicar, tareas } from '../src/bus.ts'
import { tick } from '../src/mastropiero.ts'
import { forjar } from '../src/roster.ts'
import { _probar, assertPermitido, cadena, cuerpoChat, M, usoDelMes } from '../src/nan.ts'

process.env.NAN_API_KEY = 'test'

type Pedido = { url: string; body: any }

function falso(respuestas: ((p: Pedido) => { status: number; json?: unknown })[]) {
  const pedidos: Pedido[] = []
  _probar(async (url, init) => {
    const p = { url, body: init.body ? JSON.parse(String(init.body)) : undefined }
    pedidos.push(p)
    const r: { status: number; json?: any } = (respuestas.shift() ?? (() => ({ status: 500 })))(p)
    return { status: r.status, body: JSON.stringify(r.json ?? {}), json: r.json }
  })
  return pedidos
}

const ok = (contenido: unknown) => () => ({
  status: 200,
  json: { choices: [{ message: { content: JSON.stringify(contenido) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
})

test('cadenas por clase, overrides y MiMo opcional', () => {
  assert.deepEqual(cadena('auditor'), [M.glm, M.deepseek])
  assert.deepEqual(cadena('clasificador'), [M.qwen, M.deepseek])
  assert.deepEqual(cadena('ejecutivo'), [])
  process.env.NAN_MIMO_ID = 'mimo-x'
  assert.equal(cadena('generativo').at(-1), 'mimo-x')
  assert.deepEqual(cadena('vectorizador'), [M.embed])
  process.env.NAN_CADENA_GENERATIVO = 'qwen3.8-flash'
  assert.deepEqual(cadena('generativo'), ['qwen3.8-flash'])
  delete process.env.NAN_MIMO_ID
  delete process.env.NAN_CADENA_GENERATIVO
  assert.throws(() => assertPermitido('glm5.3'), /prohibido/)
  assert.throws(() => assertPermitido('algo-fallback'), /prohibido/)
})

test('DeepSeek: max_tokens ≥ 16384 y la palabra JSON', () => {
  const b = cuerpoChat(M.deepseek, { mensajes: [{ role: 'user', content: 'hola' }], temperatura: 0.2, maxTokens: 512, json: true })
  assert.equal(b.max_tokens, 16384)
  assert.match(JSON.stringify(b.messages), /JSON/)
  assert.equal(cuerpoChat(M.qwen, { mensajes: [], temperatura: 0.2, maxTokens: 512, json: true }).max_tokens, 512)
})

test('402 pasa al siguiente modelo, 429 reintenta, y el tick cierra la tarea', async () => {
  const db = abrir(':memory:')
  const pedidos = falso([() => ({ status: 402 }), () => ({ status: 429 }), ok({ texto: 'hecho por glm' })])
  forjar(db, { clase: 'generativo', motor: 'nan' })
  publicar(db, { clase: 'generativo', payload: { texto: 'escribí algo' }, publicadaPor: 'operador' })
  await tick(db)
  assert.deepEqual(pedidos.map((p) => p.body.model), [M.deepseek, M.glm, M.glm])
  assert.equal(tareas(db, 'hecha')[0].resultado?.texto, 'hecho por glm')
  const uso = usoDelMes(db)
  assert.equal(uso.find((u) => u.modelo === M.glm)!.tokens, 120)
  assert.equal(uso.find((u) => u.modelo === M.deepseek)!.errores, 1)
})

test('401 corta la cadena y la corrida cuenta como fallo', async () => {
  const db = abrir(':memory:')
  const pedidos = falso([() => ({ status: 401 })])
  forjar(db, { clase: 'clasificador', motor: 'nan' })
  publicar(db, { clase: 'clasificador', payload: { texto: 'x' }, publicadaPor: 'operador' })
  const ev = await tick(db, { reclutar: false })
  assert.equal(pedidos.length, 1)
  assert.ok(ev.some((e) => e.tipo === 'falla' && /401/.test(e.texto)))
})

test('el vectorizador usa /embeddings con qwen3-embedding', async () => {
  const db = abrir(':memory:')
  const pedidos = falso([() => ({ status: 200, json: { data: [{ embedding: [0.1, 0.2] }], usage: { total_tokens: 7 } } })])
  forjar(db, { clase: 'vectorizador', motor: 'nan' })
  publicar(db, { clase: 'vectorizador', payload: { texto: 'algo' }, publicadaPor: 'operador' })
  await tick(db, { reclutar: false })
  assert.match(pedidos[0].url, /\/embeddings$/)
  assert.equal(pedidos[0].body.model, M.embed)
  assert.deepEqual(tareas(db, 'hecha')[0].resultado?.embedding, [0.1, 0.2])
})

test('GLM cortado sin texto: reintenta con poco razonamiento y con presupuesto extra', async () => {
  const db = abrir(':memory:')
  const pedidos = falso([
    () => ({ status: 200, json: { choices: [{ finish_reason: 'length', message: { content: '' } }], usage: { prompt_tokens: 10, completion_tokens: 512 } } }),
    ok({ veredicto: 'ok', hallazgos: [] }),
  ])
  forjar(db, { clase: 'auditor', motor: 'nan' })
  publicar(db, { clase: 'auditor', payload: { texto: 'revisá' }, publicadaPor: 'operador' })
  await tick(db, { reclutar: false })
  assert.deepEqual(pedidos.map((p) => [p.body.model, p.body.reasoning_effort]), [[M.glm, undefined], [M.glm, 'low']])
  assert.ok(pedidos[0].body.max_tokens > 4096)
  assert.ok(Array.isArray(JSON.parse(pedidos[0].body.messages[1].content).log))
  assert.equal(tareas(db, 'hecha')[0].resultado?.veredicto, 'ok')
})

test('respuesta cortada con JSON a medias: también es truncado y pasa al siguiente modelo', async () => {
  const db = abrir(':memory:')
  const cortada = () => ({ status: 200, json: { choices: [{ finish_reason: 'length', message: { content: '{"veredicto": "ok", "hallaz' } }] } })
  const pedidos = falso([cortada, cortada, ok({ veredicto: 'alerta', hallazgos: ['x'] })])
  forjar(db, { clase: 'auditor', motor: 'nan' })
  publicar(db, { clase: 'auditor', payload: { texto: 'revisá' }, publicadaPor: 'operador' })
  await tick(db, { reclutar: false })
  assert.deepEqual(pedidos.map((p) => p.body.model), [M.glm, M.glm, M.deepseek])
  assert.equal(tareas(db, 'hecha')[0].resultado?.veredicto, 'alerta')
})

test('streaming: el acumulador junta texto y pedidos de herramienta en pedazos', async () => {
  const { acumuladorSSE } = await import('../src/nan.ts')
  const a = acumuladorSSE()
  const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`
  const crudo = ev({ choices: [{ delta: { content: 'Ho' } }] }) + ev({ choices: [{ delta: { content: 'la' } }] })
    + ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'buscar_corpus', arguments: '{"consu' } }] } }] })
    + ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'lta":"riego"}' } }] }, finish_reason: 'tool_calls' }] })
    + ev({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + 'data: [DONE]\n\n'
  // Cortado en pedazos arbitrarios, como llega por la red.
  for (let i = 0; i < crudo.length; i += 7) a.empujar(crudo.slice(i, i + 7))
  assert.equal(a.estado.texto, 'Hola')
  assert.deepEqual(a.estado.llamadas, [{ id: 'c1', nombre: 'buscar_corpus', argumentos: '{"consulta":"riego"}' }])
  assert.equal(a.estado.fin, 'tool_calls')
  assert.equal(a.estado.tokens, 15)
})
