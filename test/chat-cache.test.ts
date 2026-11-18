import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarEscriba, _probarModelo, conMomento, conversacionHoy, enviar } from '../src/chat/index.ts'
import { tokensHoy } from '../src/nan.ts'

_probarEscriba(async () => {})

test('chat · la caché: el sistema no cambia entre mensajes, lo del momento viaja con su mensaje y las herramientas solo se suman al final', async () => {
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  const pedidos: { sistema: string; ultimo: string; herramientas: string[] }[] = []
  _probarModelo(async (_l: any, o: any) => {
    const ultimo = [...o.mensajes].reverse().find((m: any) => m.role === 'user')
    pedidos.push({ sistema: String(o.mensajes[0].content), ultimo: String(ultimo?.content ?? ''), herramientas: (o.herramientas ?? []).map((h: any) => h.function?.name ?? h.name) })
    return { texto: 'Listo.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  await enviar(db, cid, 'Contame qué hay en el corpus sobre la huerta del balcón')
  await enviar(db, cid, 'Y armame un pdf con eso para mandárselo a mi vieja')
  await enviar(db, cid, 'Perfecto, ahora otra cosa: ¿qué onda la semana que viene con lo de la huerta del balcón?')
  assert.equal(pedidos.length, 3)
  const [a, b, c] = pedidos
  // El sistema: idéntico de un mensaje al otro, y sin la hora (lo que cambia va con su mensaje).
  assert.equal(a.sistema, b.sistema)
  assert.equal(b.sistema, c.sistema)
  assert.doesNotMatch(a.sistema, /Ahora: /)
  assert.match(a.ultimo, /^\[Contexto de este momento[\s\S]*Ahora: [\s\S]*\[Lo que te escribió\]\nContame qué hay en el corpus/)
  // Las herramientas: las del mensaje anterior siguen, en el mismo orden; lo nuevo se suma al final.
  assert.deepEqual(b.herramientas.slice(0, a.herramientas.length), a.herramientas)
  assert.ok(b.herramientas.length > a.herramientas.length, 'el pdf trajo el grupo «crear»')
  assert.deepEqual(c.herramientas, b.herramientas, 'un mensaje sin grupos nuevos pide exactamente lo mismo')
})

test('chat · el momento con una imagen: va como primera parte del contenido', () => {
  const conv = conMomento([{ role: 'system', content: 'sis' }, { role: 'user', content: [{ type: 'text', text: 'mirá' }, { type: 'image_url', image_url: { url: 'data:' } }] }], 'Ahora: tal')
  assert.equal((conv[1].content as any[])[0].type, 'text')
  assert.match((conv[1].content as any[])[0].text, /Ahora: tal/)
  assert.equal((conv[1].content as any[]).length, 3)
  assert.deepEqual(conMomento([{ role: 'system', content: 'sis' }], 'x').at(-1), { role: 'system', content: 'x' }, 'sin mensaje suyo, va al final')
})

test('topes · lo que sale de la caché cuenta un décimo', () => {
  const db = abrir(':memory:')
  const ins = db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, tokens_cache, latencia_ms, status, en) VALUES ('nan', 'm', 'mastropiero', 'mastropiero', ?, ?, ?, 1, 200, ?)`)
  ins.run(30_000, 500, 27_000, Date.now())
  ins.run(1_000, 100, null, Date.now())
  // 30.000 de entrada con 27.000 de caché: cuentan 3.000 + 2.700; más las salidas y la llamada sin caché.
  assert.equal(tokensHoy(db).mastropiero, 3_000 + 2_700 + 500 + 1_000 + 100)
})
