import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarFeed, recolectar, sumarFuente } from '../src/feed.ts'
import { _probarTelegram, procesarActualizacion } from '../src/telegram.ts'

test('#253 por Telegram/WhatsApp: /feed manda lo próximo con botones 1 a 6; un botón o «2 #ruido» lo puntúa y sigue con el próximo', async () => {
  const db = abrir(':memory:')
  sumarFuente(db, '@cuenta')
  _probarFeed(async () => [1, 2, 3].map((i) => ({ url: `https://x.com/cuenta/status/${i}`, titulo: `Post ${i}`, texto: `Post ${i}` })))
  await recolectar(db)
  const enviados: any[] = []
  let n = 100
  _probarTelegram({ pedir: async (metodo, cuerpo) => { const id = ++n; if (metodo === 'sendMessage') enviados.push({ id, ...cuerpo }); return { ok: true, result: { message_id: id } } } })
  _probarModelo(async () => ({ texto: 'Dale.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }))
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '42'
  let m = 1
  const yo = (extra: any) => ({ message: { chat: { id: 42 }, message_id: ++m, ...extra } })

  await procesarActualizacion(db, yo({ text: '/feed' }))
  const primero = enviados.at(-1)
  assert.match(primero.text, /📰 Post/)
  const botones = primero.reply_markup.inline_keyboard.flat().map((b: any) => b.text)
  assert.deepEqual(botones, ['1', '2', '3', '4', '5', '6'])
  const dato = primero.reply_markup.inline_keyboard[1][2].callback_data // el 6
  await procesarActualizacion(db, { callback_query: { id: 'q', data: dato, message: { chat: { id: 42 }, message_id: primero.message_id ?? primero.id } } })
  assert.ok(enviados.some((e) => /✓ 6\/6 a «Post/.test(e.text)))
  assert.match(enviados.at(-1).text, /📰 Post/, 'sigue con el próximo')

  // Un número suelto al rato, con #categoría: puntúa el último que mandó.
  await procesarActualizacion(db, yo({ text: '2 #ruido repetido' }))
  const it = db.prepare(`SELECT puntaje, categoria, razon FROM feed_items WHERE puntaje = 2`).get() as any
  assert.deepEqual({ ...it }, { puntaje: 2, categoria: 'ruido', razon: 'repetido' })
  // Un mensaje normal que empieza con número no se toma como puntaje.
  const antes = (db.prepare('SELECT COUNT(*) AS n FROM feed_items WHERE puntaje IS NOT NULL').get() as any).n
  await procesarActualizacion(db, yo({ text: '3 cosas que tengo que hacer hoy' }))
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM feed_items WHERE puntaje IS NOT NULL').get() as any).n, antes)
})
