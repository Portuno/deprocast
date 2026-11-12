import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { publicar, tareas } from '../src/bus.ts'
import { tick } from '../src/mastropiero.ts'
import { forjar } from '../src/roster.ts'
import { _probar, assertPermitido, cadena, cadenaPara, creditosDe, cuerpoChat, M, PRESUPUESTO_RAZONAMIENTO, usoDelMes } from '../src/nan.ts'

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

test('cadenas por clase, overrides y NAN_MIMO_ID (sin duplicar)', () => {
  assert.deepEqual(cadena('auditor'), [M.deepseek, M.glm])
  assert.deepEqual(cadena('clasificador'), [M.deepseek, M.mimo], 'rotado por el banco de pruebas')
  assert.deepEqual(cadena('ejecutivo'), [])
  process.env.NAN_MIMO_ID = 'mimo-x'
  assert.equal(cadena('generativo').at(-1), 'mimo-x')
  process.env.NAN_MIMO_ID = M.mimo
  assert.deepEqual(cadena('generativo'), [M.deepseek, M.mimo], 'el que ya está no se repite')
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
  // Los que piensan antes de escribir llevan presupuesto para razonar (solo se paga lo que usan).
  assert.equal(cuerpoChat(M.mimo, { mensajes: [], temperatura: 0.2, maxTokens: 512, json: true }).max_tokens, 512 + PRESUPUESTO_RAZONAMIENTO)
  assert.equal(cuerpoChat(M.embed, { mensajes: [], temperatura: 0.2, maxTokens: 512, json: true }).max_tokens, 512)
})

test('el ruteo por uso (nov 2026): el chat y lo que él ve, a DeepSeek Flash; lo de fondo, a MiMo; lo que importa, a DeepSeek Pro; y los créditos de cada llamada', () => {
  assert.deepEqual(cadenaPara({ clase: 'mastropiero', agenteId: 'mastropiero' }), [M.deepseek, M.mimo, M.qwen])
  assert.deepEqual(cadenaPara({ clase: 'mastropiero', agenteId: 'directo' })[0], M.deepseek)
  assert.deepEqual(cadenaPara({ clase: 'mastropiero', agenteId: 'takeout' }), [M.mimo, M.deepseek])
  assert.deepEqual(cadenaPara({ clase: 'mastropiero', agenteId: 'escriba' }), [M.mimo, M.deepseek])
  assert.deepEqual(cadenaPara({ clase: 'mastropiero', agenteId: 'autocritica' }), [M.pro, M.deepseek])
  assert.deepEqual(cadenaPara({ clase: 'mastropiero', agenteId: 'fragua' }), [M.deepseek, M.mimo, M.pro, M.qwen], 'el código, a Flash (rotado por el banco de pruebas), con dos respaldos más (#242)')
  assert.deepEqual(cadenaPara({ clase: 'extractor', agenteId: 'EXT-0001' }), [M.mimo, M.deepseek], 'los agentes de la liga, por su clase')
  assert.deepEqual(cadenaPara({ clase: 'mastropiero', agenteId: 'takeout', modelos: [M.qwen] }), [M.qwen], 'la cadena propia de una llamada manda')
  // Créditos: 10.000 de entrada (8.000 cacheados) y 500 de salida en DeepSeek Flash = (2.000 × 10,5 + 8.000 × 0,21 + 500 × 42) / 1M.
  assert.equal(Math.round(creditosDe(M.deepseek, 10_000, 8_000, 500)! * 1e6), 2_000 * 10.5 + 8_000 * 0.21 + 500 * 42)
  assert.ok(creditosDe(M.mimo, 10_000, 8_000, 500)! < creditosDe(M.deepseek, 10_000, 8_000, 500)! * 0.55, 'MiMo cuesta casi la mitad')
  assert.equal(creditosDe('desconocido', 1, 0, 1), null)
})

test('402 pasa al siguiente modelo, 429 reintenta, y el tick cierra la tarea', async () => {
  const db = abrir(':memory:')
  process.env.NAN_CADENA_GENERATIVO = `${M.deepseek},${M.glm}` // la mecánica de reintentos, con una cadena fija
  const pedidos = falso([() => ({ status: 402 }), () => ({ status: 429 }), ok({ texto: 'hecho por glm' })])
  forjar(db, { clase: 'generativo', motor: 'nan' })
  publicar(db, { clase: 'generativo', payload: { texto: 'escribí algo' }, publicadaPor: 'operador' })
  await tick(db)
  assert.deepEqual(pedidos.map((p) => p.body.model), [M.deepseek, M.glm, M.glm])
  assert.equal(tareas(db, 'hecha')[0].resultado?.texto, 'hecho por glm')
  const uso = usoDelMes(db)
  assert.equal(uso.find((u) => u.modelo === M.glm)!.tokens, 120)
  assert.equal(uso.find((u) => u.modelo === M.deepseek)!.errores, 1)
  delete process.env.NAN_CADENA_GENERATIVO
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
  process.env.NAN_CADENA_AUDITOR = `${M.glm},${M.deepseek}`
  forjar(db, { clase: 'auditor', motor: 'nan' })
  publicar(db, { clase: 'auditor', payload: { texto: 'revisá' }, publicadaPor: 'operador' })
  await tick(db, { reclutar: false })
  assert.deepEqual(pedidos.map((p) => [p.body.model, p.body.reasoning_effort]), [[M.glm, undefined], [M.glm, 'low']])
  assert.ok(pedidos[0].body.max_tokens > 4096)
  assert.ok(Array.isArray(JSON.parse(pedidos[0].body.messages[1].content).log))
  assert.equal(tareas(db, 'hecha')[0].resultado?.veredicto, 'ok')
  delete process.env.NAN_CADENA_AUDITOR
})

test('respuesta cortada con JSON a medias: también es truncado; razona menos, después pide el doble y recién ahí pasa al siguiente modelo', async () => {
  const db = abrir(':memory:')
  const cortada = () => ({ status: 200, json: { choices: [{ finish_reason: 'length', message: { content: '{"veredicto": "ok", "hallaz' } }] } })
  const pedidos = falso([cortada, cortada, cortada, ok({ veredicto: 'alerta', hallazgos: ['x'] })])
  process.env.NAN_CADENA_AUDITOR = `${M.glm},${M.deepseek}`
  forjar(db, { clase: 'auditor', motor: 'nan' })
  publicar(db, { clase: 'auditor', payload: { texto: 'revisá' }, publicadaPor: 'operador' })
  await tick(db, { reclutar: false })
  assert.deepEqual(pedidos.map((p) => p.body.model), [M.glm, M.glm, M.glm, M.deepseek])
  assert.equal(pedidos[1].body.reasoning_effort, 'low')
  assert.equal(pedidos[2].body.max_tokens, 2 * pedidos[0].body.max_tokens, 'el tercero, con el doble de lugar')
  assert.equal(tareas(db, 'hecha')[0].resultado?.veredicto, 'alerta')
  delete process.env.NAN_CADENA_AUDITOR
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

test('sin red: se reintenta con espera y, si sigue sin conexión, corta con un mensaje claro', async () => {
  const { nanChat, SIN_RED } = await import('../src/nan.ts')
  const db = abrir(':memory:')
  const esperas: number[] = []
  let n = 0
  _probar(async () => (++n <= 2 ? { status: SIN_RED, body: 'sin conexión: fetch failed (ECONNRESET)', json: undefined } : { status: 200, body: '', json: { choices: [{ message: { content: 'volví' } }] } }), async (ms) => { esperas.push(ms) })
  const r = await nanChat({ db, clase: 'mastropiero', agenteId: 't' }, { mensajes: [{ role: 'user', content: 'hola' }], temperatura: 0, maxTokens: 10, json: false })
  assert.equal(r.texto, 'volví')
  assert.deepEqual(esperas, [2000, 5000])
  _probar(async () => ({ status: SIN_RED, body: 'sin conexión: fetch failed', json: undefined }), async () => {})
  await assert.rejects(nanChat({ db, clase: 'mastropiero', agenteId: 't' }, { mensajes: [{ role: 'user', content: 'hola' }], temperatura: 0, maxTokens: 10, json: false }), /Sin conexión con NaN \(fetch failed\)\. Revisá internet/)
})

test('si fallan todos los modelos, el error dice el motivo de cada uno (y no «NaN agotada»)', async () => {
  const db = abrir(':memory:')
  falso([() => ({ status: 402, json: { error: { message: 'Insufficient balance' } } }), ...Array.from({ length: 12 }, () => () => ({ status: 503 }))])
  const { nanChat } = await import('../src/nan.ts')
  await assert.rejects(nanChat({ db, clase: 'auditor', agenteId: 'x' }, { mensajes: [{ role: 'user', content: 'hola' }], temperatura: 0, maxTokens: 10, json: false }), (e: Error) => {
    assert.match(e.message, /Ningún modelo pudo contestar/)
    assert.match(e.message, /sin saldo \(402: Insufficient balance\)/)
    assert.match(e.message, /el servidor falló \(503/)
    assert.doesNotMatch(e.message, /agotada/)
    return true
  })
})

test('el tiempo agotado leyendo la respuesta es un 504 que pasa al siguiente modelo (Fragua #105 y #124), no un error crudo', async () => {
  const http = await import('node:http')
  const { transporteReal, decidir } = await import('../src/nan.ts')
  // Un servidor que manda los encabezados y se queda callado (como NaN cuando el modelo tarda).
  const srv = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"id":') })
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok))
  const antes = process.env.NAN_TIEMPO_MS
  process.env.NAN_TIEMPO_MS = '5000'
  try {
    const { port } = srv.address() as import('node:net').AddressInfo
    const t0 = Date.now()
    const r = await transporteReal(`http://127.0.0.1:${port}/chat/completions`, { method: 'POST', body: '{}' })
    assert.equal(r.status, 504)
    assert.match(r.body, /^tiempo agotado/)
    assert.ok(Date.now() - t0 < 9000)
    assert.deepEqual(decidir(r, 'x', { server: 0, rate: 0, trunc: 0 }), { accion: 'siguiente' }, 'no reintenta el mismo modelo')
    assert.equal(decidir({ status: 502, body: 'bad gateway' }, 'x', { server: 0, rate: 0, trunc: 0 }).accion, 'reintentar', 'otro 5xx sí se reintenta')
  } finally {
    process.env.NAN_TIEMPO_MS = antes
    srv.closeAllConnections()
    srv.close()
  }
})

test('lo que lee cada clase tiene tope: un clasificador ya no recibe la pieza entera (300 millones de tokens en diez días)', async () => {
  const { mensajesDe, LECTURA_MAX, recortarMedio } = await import('../src/motores.ts')
  const largo = `PRINCIPIO ${'x'.repeat(600_000)} FINAL`
  const r = recortarMedio(largo, 12_000)
  assert.ok(r.length < 12_200 && r.startsWith('PRINCIPIO') && r.endsWith('FINAL'))
  assert.match(r, /\[… recortado: 588\.\d{3} de 600\.\d{3} caracteres …\]/)
  const ficha = { id: 'CLA-0006', clase: 'clasificador', instrucciones: 'Clasificá.' } as any
  const contexto = { capa: { nivel: 1, nombre: 'x' }, esquema: { clase: 'clasificador', produce: '', salida: '' }, tarea: { id: 1, tipo: 'clasificar', dominio: null, payload: {} }, pieza: { id: 9, titulo: 'Chat enorme', contenido: largo } } as any
  const [, usuario] = mensajesDe({ ficha, contexto, lector: { buscar: () => [] }, efectos: { iniciativa: 0 } } as any)
  assert.ok(String(usuario.content).length < LECTURA_MAX.clasificador! + 2_000, `mandó ${String(usuario.content).length} caracteres`)
  const sinTope = mensajesDe({ ficha: { ...ficha, clase: 'ejecutivo' }, contexto, lector: { buscar: () => [] }, efectos: { iniciativa: 0 } } as any)[1]
  assert.ok(String(sinTope.content).length > 600_000, 'las clases sin tope siguen igual')
})

test('#243: una respuesta cortada por largo se reintenta una vez con el doble de lugar antes de pasar al siguiente modelo; un tope que el modelo no acepta no corta la cadena', async () => {
  const { decidir, cuerpoChat, TOPE_SALIDA } = await import('../src/nan.ts')
  const cortada = { status: 200, body: '{}', json: { choices: [{ finish_reason: 'length', message: { content: 'a medias' } }] } } as any
  assert.deepEqual(decidir(cortada, M.mimo, { server: 0, rate: 0, trunc: 0, largo: 0 }), { accion: 'reintentar', esperaMs: 0, masLargo: true })
  assert.deepEqual(decidir(cortada, M.mimo, { server: 0, rate: 0, trunc: 0, largo: 1 }), { accion: 'siguiente' }, 'la segunda vez, al siguiente')
  assert.equal(cuerpoChat(M.deepseek, { mensajes: [], temperatura: 0, maxTokens: 512, json: false, masLargo: true }).max_tokens, 32768)
  assert.equal(cuerpoChat(M.mimo, { mensajes: [], temperatura: 0, maxTokens: 60_000, json: false, masLargo: true }).max_tokens, TOPE_SALIDA)
  assert.deepEqual(decidir({ status: 400, body: 'max_tokens is too large: 65536' } as any, M.mimo, { server: 0, rate: 0, trunc: 0 }), { accion: 'siguiente' })
})

test('#242: la Fragua no se pierde porque fallen sus dos motores: Flash sin respuesta y MiMo cortado por largo pasan a Pro, que contesta', async () => {
  const { nanChat } = await import('../src/nan.ts')
  const db = abrir(':memory:')
  const caido = () => ({ status: 504 })
  const cortada = () => ({ status: 200, json: { choices: [{ finish_reason: 'length', message: { content: '{"cambios": [' } }] } })
  const pedidos = falso([caido, caido, caido, cortada, cortada, ok({ cambios: [] })])
  const r = await nanChat({ db, clase: 'mastropiero', agenteId: 'fragua' }, { mensajes: [{ role: 'user', content: 'forjá' }], temperatura: 0.2, maxTokens: 12000, json: true })
  assert.equal(r.modelo, M.pro, 'queda registrado quién contestó')
  assert.deepEqual(pedidos.map((p) => p.body.model), [M.deepseek, M.deepseek, M.deepseek, M.mimo, M.mimo, M.pro])
})
