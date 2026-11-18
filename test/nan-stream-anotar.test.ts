import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { creditosDe, M, nanChatHerramientasStream } from '../src/nan.ts'

process.env.NAN_API_KEY = 'test'

test('streaming (el chat): cada llamada se anota como las demás — entrada, salida, lo que salió de la caché y sus créditos', async () => {
  const db = abrir(':memory:')
  const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`
  const crudo = ev({ choices: [{ delta: { content: 'Listo, ' } }] }) + ev({ choices: [{ delta: { content: 'anotado.' }, finish_reason: 'stop' }] })
    + ev({ choices: [], usage: { prompt_tokens: 30_000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 27_500 } } }) + 'data: [DONE]\n\n'
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(crudo)); c.close() } }), { status: 200 })) as typeof fetch
  try {
    let visto = ''
    const r = await nanChatHerramientasStream({ db, clase: 'mastropiero', agenteId: 'mastropiero' }, { mensajes: [{ role: 'user', content: 'hola' }], herramientas: [], temperatura: 0.5, maxTokens: 100 }, (p) => (visto = p))
    assert.equal(r.texto, 'Listo, anotado.')
    assert.equal(visto, 'Listo, anotado.')
    const fila = db.prepare('SELECT modelo, tokens_in, tokens_out, tokens_cache, creditos FROM llamadas').get() as any
    assert.equal(fila.modelo, M.deepseek)
    assert.equal(fila.tokens_in, 30_000, 'la entrada sola (antes iba la suma)')
    assert.equal(fila.tokens_out, 200)
    assert.equal(fila.tokens_cache, 27_500, 'lo que salió de la caché queda anotado')
    assert.equal(fila.creditos, creditosDe(M.deepseek, 30_000, 27_500, 200), 'y los créditos (antes el chat no los contaba)')
  } finally {
    globalThis.fetch = original
  }
})
