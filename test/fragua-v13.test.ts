import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { _probarCronica, cronicaDelMes, mesesSinCronica } from '../src/linea.ts'

process.env.NAN_API_KEY = 'test'

/** Un mes con «n» piezas destiladas (desde el día «desde»). */
function mes(db: ReturnType<typeof abrir>, n: number, desde = 1) {
  for (let i = desde; i < desde + n; i++) {
    const id = insertar(db, { fuente: 'operador', titulo: `Día ${i}`, nivel: 'propia', fecha: `2026-03-${String(i).padStart(2, '0')}`, origenId: `m:${i}`, contenido: 'algo' })!
    db.prepare(`INSERT INTO takeout_destilado (pieza_id, lote, estado, salida, hecho_en) VALUES (?, 'reproceso', 'hecho', ?, 1)`).run(id, JSON.stringify({ resumen: `Pasó lo del día ${i}`, decisiones: [], abierto: [] }))
  }
}

test('crónica que nunca da JSON: se intenta 3 veces y se deja hasta que el mes tenga material nuevo (no 370)', async () => {
  const db = abrir(':memory:')
  mes(db, 3)
  let llamadas = 0
  _probarCronica(async () => { llamadas++; throw new Error('El modelo no devolvió un JSON válido') })
  const errores: string[] = []
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    const [m] = mesesSinCronica(db)
    if (!m) break
    await cronicaDelMes(db, m.mes).catch((e) => errores.push(e.message))
  }
  assert.equal(llamadas, 3, 'tres intentos, no infinitos')
  assert.match(errores[0], /La crónica de 2026-03 no salió \(3 piezas, \d+ caracteres, material [0-9a-f]{10}, intento 1\): El modelo no devolvió/)
  assert.deepEqual(mesesSinCronica(db), [], 'el mes queda salteado')
  // Con 3 piezas nuevas vuelve, y si sale, se borra el fallo.
  mes(db, 3, 10)
  assert.equal(mesesSinCronica(db)[0]?.mes, '2026-03')
  _probarCronica(async () => ({ titulo: 'Al fin', cronica: 'Salió.', giros: [], abierto: [] }))
  await cronicaDelMes(db, '2026-03')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM cronica_fallos').get() as any).n, 0)
})

test('JSON del modelo: el primer objeto aunque venga otro o texto atrás, sin comas finales, y el error dice qué pasó', async () => {
  const { leerJson, porQueNoEsJson, pedirJson, _probarModelo } = await import('../src/modelo.ts')
  const { cuerpoChat } = await import('../src/nan.ts')
  assert.deepEqual(leerJson('{"a": 1}\n{"b": 2}'), { a: 1 })
  assert.deepEqual(leerJson('{"a": "una } en un string"}\nY esto es prosa.'), { a: 'una } en un string' })
  assert.deepEqual(leerJson('Acá va:\n```json\n{"a": [1, 2,],}\n```'), { a: [1, 2] })
  assert.equal(leerJson('No hay nada'), null)
  assert.match(porQueNoEsJson('Te cuento que el mes fue largo'), /contestó texto sin JSON/)
  assert.match(porQueNoEsJson('{"cronica": "empezó y se cor'), /se cortó antes de cerrar el JSON/)
  assert.match(porQueNoEsJson('{"a": nope}'), /JSON mal formado/)
  // Modo JSON: va response_format cuando no hay herramientas.
  assert.deepEqual(cuerpoChat('qwen3.8-flash', { mensajes: [], temperatura: 0, maxTokens: 10, json: true }).response_format, { type: 'json_object' })
  let pidio: any
  _probarModelo(async (_l, o) => { pidio = o; return { texto: 'Te cuento que fue un buen mes', llamadas: [], razonamiento: null, modelo: 'x', tokens: 1 } })
  await assert.rejects(pedirJson({ db: abrir(':memory:'), clase: 'gerente', agenteId: 't' }, 's', 'u'), /no devolvió un JSON válido: contestó texto sin JSON/)
  assert.equal(pidio.json, true)
})

test('NaN: nunca más de 6 pedidos en vuelo, y Whisper reintenta el 429', async () => {
  const nan = await import('../src/nan.ts')
  let ahora = 0
  let max = 0
  nan._probar(async () => {
    ahora++
    max = Math.max(max, ahora)
    await new Promise((ok) => setTimeout(ok, 5))
    ahora--
    return { status: 200, body: '', json: { choices: [{ message: { content: 'ok' } }] } }
  })
  const db = abrir(':memory:')
  const rs = await Promise.all(Array.from({ length: 20 }, () => nan.nanChat({ db, clase: 'gerente', agenteId: 't' }, { mensajes: [], temperatura: 0, maxTokens: 10, json: false })))
  assert.equal(rs.length, 20)
  assert.ok(max <= 6, `llegó a ${max} en vuelo`)
  assert.equal(nan._enVuelo(), 0)

  // Whisper: 429 → espera → 200.
  const fetchReal = globalThis.fetch
  let llamadas = 0
  globalThis.fetch = (async () => (++llamadas === 1 ? new Response('max_parallel_requests', { status: 429 }) : new Response(JSON.stringify({ text: 'hola' }), { status: 200 }))) as typeof fetch
  try {
    assert.equal(await nan.nanTranscribir(db, Buffer.from('x'), 'a.mp3'), 'hola')
    assert.equal(llamadas, 2)
  } finally {
    globalThis.fetch = fetchReal
  }
})

test('Telegram: un 502 o un timeout al mandar se reintenta (un 400 no), y una nota de voz reenviada no entra dos veces', async () => {
  const tg = await import('../src/telegram.ts')
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '1'
  const llamadas: string[] = []
  let respuestas: any[] = []
  tg._probarTelegram({ esperar: async () => {}, pedir: async (metodo, cuerpo) => { llamadas.push(`${metodo}:${cuerpo.parse_mode ?? 'plano'}`); const r = respuestas.shift(); if (r instanceof Error) throw r; return r } })
  respuestas = [{ ok: false, error_code: 502, description: 'Bad Gateway' }, new Error('The operation was aborted due to timeout'), { ok: true, result: { message_id: 7 } }]
  assert.equal(await tg.decir('Un mensaje que tiene que llegar aunque Telegram tropiece dos veces.'), 7)
  assert.equal(llamadas.length, 3, 'dos reintentos y llegó')
  llamadas.length = 0
  respuestas = [{ ok: false, error_code: 400, description: 'Bad Request: can\'t parse entities' }, { ok: true, result: { message_id: 8 } }]
  assert.equal(await tg.decir('Otro mensaje distinto, con un HTML que a Telegram no le gusta nada.'), 8)
  assert.deepEqual(llamadas, ['sendMessage:HTML', 'sendMessage:plano'], 'el 400 no se reintenta: va plano')

  const db = abrir(':memory:')
  const texto = 'Hoy caminando pensé en el piloto del barrio, en cómo arrancar con tres capas y en la gente que se suma los domingos. '.repeat(4)
  const a = tg.guardarNotaDeVoz(db, texto, 120, 'f1')
  assert.ok(a.pieza)
  const b = tg.guardarNotaDeVoz(db, texto.toUpperCase().replace(/,/g, ''), 120, 'f2')
  assert.equal(b.pieza, null, 'el mismo audio reenviado (otra puntuación) no crea pieza')
  assert.equal(b.repetida?.id, a.pieza)
  assert.equal(JSON.parse((db.prepare('SELECT meta FROM corpus WHERE id = ?').get(a.pieza) as any).meta).reenvios, 1)
  assert.ok(tg.guardarNotaDeVoz(db, `${texto} Y algo nuevo que agrego al final, bastante distinto de lo anterior y largo de verdad para cambiar todo.`.repeat(2), 200, 'f3').pieza, 'una nota distinta sí entra')
})

test('chat: lo ya leído en vueltas anteriores viaja recortado, desde la 5.ª se le pide cerrar y no pasa de 8 vueltas', async () => {
  const C = await import('../src/chat/index.ts')
  const largo = 'x'.repeat(5000)
  const conv: any[] = [
    { role: 'user', content: 'viejo' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'a' }] }, { role: 'tool', tool_call_id: 'a', content: largo },
    { role: 'assistant', content: '', tool_calls: [{ id: 'b' }] }, { role: 'tool', tool_call_id: 'b', content: largo },
  ]
  C.recortarYaLeido(conv, 1)
  assert.ok(conv[2].content.length < C.RECORTE_YA_LEIDO + 40 && conv[2].content.endsWith('[ya leído: recortado]'), 'la que ya leyó, recortada')
  assert.equal(conv[4].content, largo, 'la última vuelta, entera')

  const db = abrir(':memory:')
  const vistos: any[][] = []
  C._probarModelo(async (_l, o) => {
    if (!(o.herramientas as any[])?.length) return { texto: '{}', razonamiento: null, modelo: 'falso', tokens: 1, llamadas: [] } // los otros llamados (correcciones, título)
    vistos.push(o.mensajes as any[])
    return { texto: '', razonamiento: null, modelo: 'falso', tokens: 1, llamadas: [{ id: `v${vistos.length}`, nombre: 'pedir_herramientas', argumentos: '{"grupos":[]}' }] }
  })
  const c = C.crearConversacion(db)
  await C.enviar(db, c.id, 'Hacé algo que no termina nunca')
  assert.equal(vistos.length, 8, 'corta en 8 vueltas')
  assert.ok(!vistos[4].some((m) => m.role === 'system' && /cerrá con lo que ya tenés/.test(m.content)))
  assert.ok(vistos[5].some((m) => m.role === 'system' && /Llevás 5 vueltas/.test(m.content)), 'desde la 5.ª se le pide cerrar')
})
