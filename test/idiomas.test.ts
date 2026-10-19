import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
process.env.MASTRO_ADJUNTOS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-idiomas-'))

const { abrir, fechaLocal } = await import('../src/db.ts')
const t = await import('../src/tarjetas.ts')
const idi = await import('../src/idiomas.ts')
const nan = await import('../src/nan.ts')
const tg = await import('../src/telegram.ts')

const T = new Date(2026, 9, 19, 10).getTime() // lunes 19/10/2026, 10:00
const DIA = 86_400_000

/** Un modelo falso: abre la charla o devuelve la corrección, según qué le piden. */
const pedidos: { sistema: string; usuario: string }[] = []
idi._probarIdiomas({
  modelo: async (_db, sistema, usuario) => {
    pedidos.push({ sistema, usuario })
    if (sistema.includes('Abrís una charla')) return { mensaje: 'Salut ! Sur quoi tu travailles aujourd’hui ?', ayuda: '¿En qué trabajás hoy?' }
    return {
      correcciones: [{ dijo: 'je suis travaillé', natural: 'je travaille', por_que: 'Presente simple: «je travaille sur…»' }],
      frases: [{ frase: 'Je travaille sur un projet perso.', traduccion: 'Estoy trabajando en un proyecto personal.', patron: 'travailler sur + algo' }, { frase: 'Ça avance bien.', traduccion: 'Va bien encaminado.', patron: 'ça + verbo' }],
      respuesta: 'Super !', pregunta: 'Et c’est quoi, ce projet ?', animo: 'Te animaste a hablar entero.', nivel: 'A2',
    }
  },
  transcribir: async (_db, _audio, _nombre, idioma) => { assert.equal(idioma, 'fr', 'Whisper recibe el idioma que practica'); return 'Je suis travaillé sur mon projet' },
  voz: async () => Buffer.from('mp3-falso'),
})

test('Tarjetas: el repaso espaciado (SM-2) aleja lo que sabe y vuelve a hoy lo que no', () => {
  const db = abrir(':memory:')
  const a = t.crearTarjeta(db, { mazo: 'idioma:1', frente: '¿Cómo dirías «hola»?', dorso: 'Salut' }, T)
  assert.equal(a.nueva, true)
  assert.equal(t.crearTarjeta(db, { mazo: 'idioma:1', frente: '¿Cómo dirías «hola»?', dorso: 'Bonjour' }, T).nueva, false, 'la misma pregunta no se repite')
  t.crearTarjeta(db, { mazo: 'video:9', frente: '¿Qué plantea el video?', dorso: 'Que…' }, T)
  assert.equal(t.paraRepasar(db, {}, T).length, 2, 'lo nuevo toca hoy')
  assert.equal(t.paraRepasar(db, { mazo: 'idioma:' }, T).length, 1, 'un prefijo filtra el mazo')

  let x = t.responderTarjeta(db, a.id, 'bien', T)
  assert.equal(x.intervalo, 1)
  assert.equal(x.proxima, fechaLocal(T + DIA))
  x = t.responderTarjeta(db, a.id, 'bien', T + DIA)
  assert.equal(x.intervalo, 6)
  x = t.responderTarjeta(db, a.id, 'bien', T + 7 * DIA)
  assert.equal(x.intervalo, 15, '6 × 2,5')
  assert.equal(x.facilidad, 2.5)
  x = t.responderTarjeta(db, a.id, 'otra', T + 22 * DIA)
  assert.equal(x.intervalo, 0)
  assert.equal(x.repeticiones, 0)
  assert.equal(x.proxima, fechaLocal(T + 22 * DIA), '«otra vez» vuelve hoy')
  assert.ok(x.facilidad < 2.5)
  assert.equal(x.aciertos, 3)
  assert.equal(x.fallos, 1)

  const b = t.crearTarjeta(db, { mazo: 'idioma:1', frente: '¿«Gracias»?', dorso: 'Merci' }, T)
  assert.equal(t.responderTarjeta(db, b.id, 'facil', T).intervalo, 3, 'fácil de entrada salta a 3 días')
  const c = t.crearTarjeta(db, { mazo: 'idioma:1', frente: '¿«Chau»?', dorso: 'Salut' }, T)
  assert.ok(t.responderTarjeta(db, c.id, 'dificil', T).facilidad < 2.5, 'difícil baja la facilidad')
  for (let i = 0; i < 12; i++) t.responderTarjeta(db, c.id, 'otra', T)
  assert.equal(t.leerTarjeta(db, c.id)!.facilidad, 1.3, 'nunca baja de 1,3')
  assert.throws(() => t.responderTarjeta(db, c.id, 'genial' as any, T))

  const r = t.resumenTarjetas(db, T)
  assert.deepEqual({ ...r.find((m) => m.mazo === 'idioma:1') }, { mazo: 'idioma:1', hoy: 1, total: 3, aprendidas: 0 })
  t.suspenderTarjeta(db, c.id)
  assert.equal(t.paraRepasar(db, { mazo: 'idioma:1' }, T).length, 0)
})

test('Idiomas: sin por qué no arranca; la práctica corrige, deja frases como tarjetas y cuenta en Aprender', async () => {
  const db = abrir(':memory:')
  assert.throws(() => idi.crearIdioma(db, { codigo: 'fr', porQue: 'sí' }, T), /para qué/)
  assert.throws(() => idi.crearIdioma(db, { codigo: 'xx', porQue: 'Porque quiero vivir en Lyon' }, T), /No conozco/)
  const fr = idi.crearIdioma(db, { codigo: 'fr', nivel: 'A1', porQue: 'Quiero vivir un año en Lyon y trabajar ahí', hora: '19:30' }, T)
  assert.equal(fr.nombre, 'Francés')
  assert.match(String((db.prepare('SELECT tema FROM aprendizajes WHERE id = ?').get(fr.aprendizajeId) as any).tema), /Idioma · Francés/)
  assert.throws(() => idi.crearIdioma(db, { codigo: 'fr', porQue: 'Otra vez el mismo idioma' }, T), /Ya estás/)

  const p = await idi.abrirPractica(db, fr.aprendizajeId, T)
  assert.match(p.mensaje, /Salut/)
  assert.match(pedidos.at(-1)!.sistema, /Francés/)
  assert.equal(idi.practicaAbierta(db, T + 60_000)?.aprendizajeId, fr.aprendizajeId)
  assert.equal(idi.practicaAbierta(db, T + 50 * 60_000), null, 'después de 45 minutos sin actividad ya no está abierta')

  const d = await idi.responderPractica(db, fr.aprendizajeId, { audio: Buffer.from('ogg'), nombreAudio: 'a.ogg', segundos: 40 }, T + 120_000)
  assert.equal(d.transcripcion, 'Je suis travaillé sur mon projet')
  assert.equal(d.correcciones[0].natural, 'je travaille')
  assert.equal(d.tarjetasNuevas, 2)
  assert.match(pedidos.at(-1)!.usuario, /Sur quoi tu travailles/, 'la devolución sabe qué se le preguntó')
  const cartas = t.paraRepasar(db, { mazo: idi.mazoDe(fr.aprendizajeId) }, T)
  assert.equal(cartas.length, 2)
  assert.match(cartas[0].frente, /¿Cómo dirías: «Estoy trabajando/)
  assert.match(cartas[0].dorso, /Je travaille sur un projet perso\.\n\ntravailler sur/)

  // La segunda respuesta (por escrito) contesta la pregunta nueva, no la primera.
  await idi.responderPractica(db, fr.aprendizajeId, { texto: 'C’est une app pour apprendre' }, T + 300_000)
  assert.match(pedidos.at(-1)!.usuario, /c’est quoi, ce projet/)
  assert.equal(t.paraRepasar(db, { mazo: idi.mazoDe(fr.aprendizajeId) }, T).length, 2, 'las mismas frases no se duplican')

  const [l] = idi.listarIdiomas(db, T + 400_000)
  assert.equal(l.charlas, 2)
  assert.equal(l.racha, 1)
  assert.ok(l.minutosSemana >= 5)
  assert.equal(l.tarjetas.total, 2)
  assert.equal(l.conVoz, true)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM practicas WHERE aprendizaje_id = ?`).get(fr.aprendizajeId) as any).n, 2)

  // La hora: a las 19:30 toca, y una vez enviada no vuelve hasta mañana.
  assert.equal(idi.practicasQueTocan(db, new Date(2026, 9, 19, 19, 0).getTime()).length, 0)
  assert.equal(idi.practicasQueTocan(db, new Date(2026, 9, 19, 19, 31).getTime()).length, 1)
  idi.marcarEnviada(db, fr.aprendizajeId, new Date(2026, 9, 19, 19, 31).getTime())
  assert.equal(idi.practicasQueTocan(db, new Date(2026, 9, 19, 20, 0).getTime()).length, 0)

  // El audio de una frase se guarda una vez; sin voz para el idioma, nada.
  const url = await idi.audioDeFrase('Ça avance bien.', 'fr', process.env.MASTRO_ADJUNTOS!)
  assert.match(url!, /^\/adjuntos\/tts-[0-9a-f]{16}\.mp3$/)
  assert.equal(await idi.audioDeFrase('Hallo', 'de', process.env.MASTRO_ADJUNTOS!), null)
})

test('Whisper recibe el idioma (por defecto castellano)', async () => {
  const db = abrir(':memory:')
  const fetchReal = globalThis.fetch
  const idiomas: string[] = []
  globalThis.fetch = (async (_u: any, init: any) => { idiomas.push(String((init.body as FormData).get('language'))); return new Response(JSON.stringify({ text: 'ok' }), { status: 200 }) }) as typeof fetch
  try {
    await nan.nanTranscribir(db, Buffer.from('x'), 'a.ogg')
    await nan.nanTranscribir(db, Buffer.from('x'), 'a.ogg', 'en')
  } finally { globalThis.fetch = fetchReal }
  assert.deepEqual(idiomas, ['es', 'en'])
})

test('Telegram: /idioma abre la práctica, lo que contesta es su respuesta, ✋ la cierra; /tarjetas repasa con botones; a su hora llega sola', async () => {
  const db = abrir(':memory:')
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '7'
  const enviados: any[] = []
  const audios: string[] = []
  let n = 0
  tg._probarTelegram({
    esperar: async () => {},
    pedir: async (metodo, cuerpo) => { const id = ++n; enviados.push({ metodo, id, ...cuerpo }); return { ok: true, result: { message_id: id } } },
    mandarArchivo: async (metodo, campos) => { audios.push(`${metodo}:${campos.title}`); return { ok: true, result: { message_id: ++n } } },
    bajar: async () => ({ datos: Buffer.from('ogg'), nombre: 'voz.oga' }),
  })
  const msj = (x: Record<string, unknown>) => tg.procesarActualizacion(db, { message: { chat: { id: 7 }, message_id: ++n, ...x } })
  const boton = (data: string, mensajeId: number) => tg.procesarActualizacion(db, { callback_query: { id: 'q', data, message: { chat: { id: 7 }, message_id: mensajeId } } })
  const ultimo = () => enviados.filter((e) => /sendMessage|editMessageText/.test(e.metodo)).at(-1)

  await msj({ text: '/idioma' })
  assert.match(ultimo().text, /Todavía no estás aprendiendo/)
  const fr = idi.crearIdioma(db, { codigo: 'fr', porQue: 'Quiero vivir un año en Lyon' })

  await msj({ text: '/idioma francés' })
  assert.match(ultimo().text, /Francés.*práctica[\s\S]*Salut/)
  assert.equal(ultimo().reply_markup.inline_keyboard[0][0].callback_data, `id:${fr.aprendizajeId}:fin`)
  assert.deepEqual(audios.splice(0), ['sendAudio:Francés · escuchá'])

  // Con la práctica abierta, un audio es su respuesta (no va a la charla de Hoy).
  await msj({ voice: { file_id: 'v1', duration: 30 } })
  const dev = ultimo().text
  assert.match(dev, /Je suis travaillé/)
  assert.match(dev, /je travaille/)
  assert.match(dev, /Frases nuevas/)
  assert.match(dev, /c’est quoi, ce projet/)
  assert.deepEqual(audios.splice(0), ['sendAudio:Francés · repetí en voz alta'])
  assert.equal(t.paraRepasar(db).length, 2)

  await boton(`id:${fr.aprendizajeId}:fin`, 1)
  assert.match(ultimo().text, /Listo por hoy/)
  assert.equal(idi.practicaAbierta(db), null)

  // /tarjetas: primero la pregunta sola; «Ver» muestra el dorso con las cuatro calidades; marcar pasa a la siguiente.
  await msj({ text: '/tarjetas' })
  const carta = ultimo()
  assert.match(carta.text, /2 para hoy[\s\S]*¿Cómo dirías/)
  assert.doesNotMatch(carta.text, /Je travaille sur un projet perso/, 'el dorso no se ve antes de recordar')
  const [, id] = carta.reply_markup.inline_keyboard[0][0].callback_data.split(':')
  await boton(`tj:${id}:ver`, carta.id)
  const vista = ultimo()
  assert.equal(vista.metodo, 'editMessageText')
  assert.match(vista.text, /———/)
  assert.deepEqual(vista.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data), ['otra', 'dificil', 'bien', 'facil'].map((c) => `tj:${id}:${c}`))
  await boton(`tj:${id}:bien`, carta.id)
  assert.equal(t.leerTarjeta(db, Number(id))!.intervalo, 1)
  assert.match(ultimo().text, /1 para hoy/)

  // A su hora la práctica llega sola, una vez por día.
  idi.editarIdioma(db, fr.aprendizajeId, { hora: '00:00' })
  const antes = enviados.length
  await tg.latidoTelegram(db)
  assert.match(ultimo().text, /Francés.*práctica/)
  const despues = enviados.length
  assert.ok(despues > antes)
  await tg.latidoTelegram(db)
  assert.equal(enviados.length, despues, 'no se repite en el mismo día')
})
