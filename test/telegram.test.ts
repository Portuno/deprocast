import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCalendario } from '../src/calendario.ts'
import { _probarEscriba } from '../src/chat/index.ts'
import { _probarEscribaPreguntas, encolarPregunta } from '../src/preguntas.ts'
import { _probarTelegram, aHtml, latidoTelegram, procesarActualizacion } from '../src/telegram.ts'
import { resumenMes } from '../src/finanzas.ts'
import { leerBitacora } from '../src/bitacora.ts'
import { arrancarRun, prepararRun } from '../src/misiones.ts'

process.env.MASTRO_CARGAS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-tg-'))
process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarCalendario(async () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR')
_probarEscriba(async () => {})
_probarEscribaPreguntas(async () => [])

function bot() {
  const enviados: any[] = []
  const archivos: any[] = []
  let n = 100
  _probarTelegram({
    pedir: async (metodo, cuerpo) => { const id = ++n; if (/^(sendMessage|editMessageText)$/.test(metodo)) enviados.push({ metodo, id, ...cuerpo }); return { ok: true, result: { message_id: id } } },
    mandarArchivo: async (metodo, campos, campo, datos, nombre) => { archivos.push({ metodo, campo, nombre, bytes: datos.length }); return { ok: true } },
    hablar: async (t) => Buffer.from(`voz:${t}`),
    transcribir: async () => 'Mandé el mail',
  })
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    const datos = s.includes('armás una run') ? { resumen: 'ok', misiones: [{ titulo: 'Escribir el mail', minutos: 12 }] } : null
    return { texto: datos ? JSON.stringify(datos) : '**Dale**, te escucho.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '42'
  const yo = (extra: any) => ({ message: { chat: { id: 42 }, message_id: 1, ...extra } })
  return { enviados, archivos, yo, ultimo: () => enviados.at(-1) }
}

test('telegram: formato HTML, comandos rápidos (gasto, nota, bitácora, buscar, hoy) y voz', async () => {
  assert.equal(aHtml('**Hola** <tú> & *vos*\n- uno\n[link](https://x.org)'), '<b>Hola</b> &lt;tú&gt; &amp; <i>vos</i>\n• uno\n<a href="https://x.org">link</a>')
  const db = abrir(':memory:')
  const { yo, ultimo, archivos, enviados } = bot()

  await procesarActualizacion(db, yo({ text: 'hola' }))
  assert.equal(ultimo().text, '<b>Dale</b>, te escucho.')
  assert.equal(ultimo().parse_mode, 'HTML')

  await procesarActualizacion(db, yo({ text: '/gasto 12,5 súper' }))
  assert.match(ultimo().text, /Anotado: -12.5 € · súper \(comida\)/)
  await procesarActualizacion(db, yo({ text: '/ingreso 800 freelance' }))
  assert.equal(resumenMes(db).neto, 787.5)
  await procesarActualizacion(db, yo({ text: '/gasto mucho' }))
  assert.match(ultimo().text, /Así: \/gasto 12,5 súper/)

  await procesarActualizacion(db, yo({ text: '/bitacora hoy estuve raro' }))
  assert.equal(leerBitacora(db)[0].texto, 'hoy estuve raro')
  await procesarActualizacion(db, yo({ text: '/nota comprar tinta' }))
  await procesarActualizacion(db, yo({ text: '/buscar tinta' }))
  assert.match(ultimo().text, /Nota · comprar tinta/)
  await procesarActualizacion(db, yo({ text: '/hoy' }))
  assert.match(ultimo().text, /<b>Hoy, /)
  assert.match(ultimo().text, /Plata del mes: entró 800 €, salió 12.5 €/)

  // Voz: con «1», contesta en audio solo cuando le hablan en audio.
  await procesarActualizacion(db, yo({ text: '/voz sí' }))
  await procesarActualizacion(db, yo({ text: 'por escrito' }))
  assert.equal(archivos.length, 0)
  await procesarActualizacion(db, yo({ voice: { file_id: 'f1' } }))
  assert.deepEqual(archivos.map((a) => [a.metodo, a.campo]), [['sendAudio', 'audio']])

  // Una nota de voz larga (una caminata pensando en voz alta) queda además como pieza suya.
  _probarTelegram({ transcribir: async () => 'Estuve pensando en el taller de IA para abogados y en cómo venderlo. '.repeat(15) })
  await procesarActualizacion(db, yo({ voice: { file_id: 'f2', file_unique_id: 'u2', duration: 150 } }))
  const nota = db.prepare(`SELECT * FROM corpus WHERE origen_id = 'telegram-voz:u2'`).get() as any
  assert.equal(nota.nivel, 'propia')
  assert.equal(nota.fuente, 'voz')
  assert.ok(enviados.some((e) => /Guardé tu nota de voz \(3 min\)/.test(e.text)))
  await procesarActualizacion(db, yo({ voice: { file_id: 'f2', file_unique_id: 'u2', duration: 150 } }))
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE origen_id = 'telegram-voz:u2'`).get() as any).n, 1, 'la misma nota no se duplica')
  _probarTelegram({ transcribir: async () => 'Mandé el mail' })
  _probarTelegram({ bajar: async () => ({ datos: Buffer.from('a'), nombre: 'voz.oga' }) })
})

test('telegram: criba y preguntas con botones; responder al mensaje contesta la pregunta', async () => {
  const db = abrir(':memory:')
  const { yo, ultimo, enviados } = bot()
  const p = insertar(db, { fuente: 'operador', titulo: 'Una pieza para pesar', contenido: 'algo', nivel: 'propia', origenId: 't:1' })!
  await procesarActualizacion(db, yo({ text: '/criba' }))
  assert.match(ultimo().text, /<b>Una pieza para pesar<\/b>/)
  assert.equal(ultimo().reply_markup.inline_keyboard.flat().length, 14)
  await procesarActualizacion(db, { callback_query: { id: 'c', data: `c:${p}:9`, message: { chat: { id: 42 }, message_id: 77 } } })
  assert.equal((db.prepare('SELECT peso FROM corpus WHERE id = ?').get(p) as any).peso, 9)
  assert.equal(ultimo().metodo, 'editMessageText', 'la carta se reemplaza, no llena el chat')
  assert.match(ultimo().text, /No queda nada para cribar/)

  encolarPregunta(db, { texto: '¿Cuánto querés ganar por mes?', tipo: 'abierta' })
  encolarPregunta(db, { texto: '¿Café o mate?', tipo: 'opciones', opciones: ['Café', 'Mate'] })
  await procesarActualizacion(db, yo({ text: '/pregunta' }))
  const idMsg = ultimo().id
  assert.match(ultimo().text, /❓ ¿Cuánto querés ganar por mes\?/)
  await procesarActualizacion(db, { message: { chat: { id: 42 }, text: '3000 euros', reply_to_message: { message_id: idMsg } } })
  assert.equal((db.prepare(`SELECT respuesta FROM preguntas WHERE texto LIKE '¿Cuánto%'`).get() as any).respuesta, '3000 euros')
  assert.match(ultimo().text, /¿Café o mate\?/, 'sigue con la próxima')
  const pid = (db.prepare(`SELECT id FROM preguntas WHERE texto = '¿Café o mate?'`).get() as any).id
  await procesarActualizacion(db, { callback_query: { id: 'q', data: `p:${pid}:1`, message: { chat: { id: 42 }, message_id: 5 } } })
  assert.equal((db.prepare('SELECT respuesta FROM preguntas WHERE id = ?').get(pid) as any).respuesta, 'Mate')
})

test('telegram: links al corpus, archivos que se cargan (o del banco) y cada banda de la run llega sola', async () => {
  const db = abrir(':memory:')
  const { yo, ultimo } = bot()
  await procesarActualizacion(db, yo({ text: 'mirá https://www.instagram.com/reel/XYZ/' }))
  assert.ok(db.prepare(`SELECT 1 FROM corpus WHERE url = 'https://www.instagram.com/reel/XYZ/'`).get())

  const wa = '01/10/26, 09:15 - Ana: hola\n01/10/26, 09:16 - Beto: chau\n01/10/26, 09:17 - Ana: dale'
  _probarTelegram({ bajar: async () => ({ datos: Buffer.from(wa), nombre: 'x' }) })
  await procesarActualizacion(db, yo({ document: { file_id: 'd', file_name: 'Chat de WhatsApp con Ana.txt', file_size: wa.length } }))
  assert.match(ultimo().text, /📄 <b>Chat de WhatsApp con Ana<\/b>/)
  const cargar = ultimo().reply_markup.inline_keyboard[0][0].callback_data
  await procesarActualizacion(db, { callback_query: { id: 'k', data: cargar, message: { chat: { id: 42 } } } })
  assert.match(ultimo().text, /Cargado: \d+ piezas nuevas/)

  const banco = 'Fecha;Concepto;Importe\n01/10/2026;MERCADONA;-45,20\n'
  _probarTelegram({ bajar: async () => ({ datos: Buffer.from(banco), nombre: 'x' }) })
  await procesarActualizacion(db, yo({ document: { file_id: 'b', file_name: 'extracto.csv', file_size: banco.length } }))
  const botones = ultimo().reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)
  await procesarActualizacion(db, { callback_query: { id: 'b', data: botones.find((d: string) => d.endsWith(':banco')), message: { chat: { id: 42 } } } })
  assert.match(ultimo().text, /1 movimientos nuevos/)
  assert.equal(resumenMes(db, '2026-10').gastos, 45.2)

  const { run } = await prepararRun(db, {}, { ahora: Date.now() })
  arrancarRun(db, run.id)
  await latidoTelegram(db)
  const banda = ultimo()
  if (banda.reply_markup) {
    assert.match(banda.text, /Escribir el mail/)
    const antes = ultimo()
    await latidoTelegram(db)
    assert.equal(ultimo(), antes, 'la misma banda no se repite')
  }
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
})

test('telegram: un 409 se registra una sola vez y espera cada vez más; un timeout no dice «otra instancia»', async () => {
  const { vueltaTelegram, esperaTelegram, estadoTelegram, AVISO_OTRA_INSTANCIA } = await import('../src/telegram.ts')
  const db = abrir(':memory:')
  let respuesta: () => Promise<any> = async () => ({ ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' })
  _probarTelegram({ pedir: async () => respuesta() })
  const esperas = [await vueltaTelegram(db), await vueltaTelegram(db), await vueltaTelegram(db)]
  assert.deepEqual(esperas, [60_000, 120_000, 240_000])
  assert.equal(esperaTelegram(true, 20), 600_000, 'tope de 10 minutos')
  const errores = db.prepare(`SELECT COALESCE(SUM(veces), 0) AS n FROM errores WHERE texto LIKE '%Otra instancia%'`).get() as { n: number }
  assert.equal(errores.n, 1, 'una sola vez por racha')
  assert.equal(estadoTelegram().ultimoError, AVISO_OTRA_INSTANCIA)

  respuesta = async () => { throw new Error('The operation was aborted due to timeout') }
  const espera = await vueltaTelegram(db)
  assert.ok(espera <= 10_000, 'un timeout reintenta pronto')
  assert.doesNotMatch(estadoTelegram().ultimoError!, /Otra instancia/)

  respuesta = async () => ({ ok: true, result: [] })
  assert.equal(await vueltaTelegram(db), 300)
  assert.equal(estadoTelegram().ultimoError, null)
})

test('telegram: /mano manda una carta con sus 12 pesos; jugarla dice cómo cayó y trae la siguiente en el mismo mensaje', async () => {
  const db = abrir(':memory:')
  const { yo, ultimo } = bot()
  const { crearQuantomo, leerQuantomo } = await import('../src/quantomos.ts')
  const a = crearQuantomo(db, { texto: 'Una afirmación para pesar' })!
  crearQuantomo(db, { texto: 'Otra afirmación' })
  await procesarActualizacion(db, yo({ text: '/mano' }))
  assert.match(ultimo().text, /<b>(Una afirmación para pesar|Otra afirmación)<\/b>/)
  const datos = ultimo().reply_markup.inline_keyboard.flat().map((b: any) => b.callback_data)
  assert.equal(datos.length, 15, '12 pesos, descartar, choca y pasar')
  const primera = Number(datos[0].split(':')[1])
  await procesarActualizacion(db, { callback_query: { id: 'm', data: `mn:${primera}:8`, message: { chat: { id: 42 }, message_id: 78 } } })
  assert.equal(leerQuantomo(db, primera)?.peso, 8)
  assert.equal(ultimo().metodo, 'editMessageText')
  assert.match(ultimo().text, /Pesada 8[\s\S]*territorio nuevo[\s\S]*— — —/)
  assert.ok(primera === a || leerQuantomo(db, a)?.etapa === 'proto')
})
