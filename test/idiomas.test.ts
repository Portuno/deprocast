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

const c = (texto: string, es: string, pron: string | null = null, suena = 'su-é-na') => ({ texto, pron, suena, es })

/** Un modelo falso: el kit, una sesión, la devolución o completar tarjetas, según qué le piden. */
const pedidos: { sistema: string; usuario: string }[] = []
let voces = 0
idi._probarIdiomas({
  modelo: async (_db, sistema, usuario) => {
    pedidos.push({ sistema, usuario })
    if (sistema.includes('arranque completo')) return {
      temario: ['Saludar y presentarte', 'Pedir comida', 'Números y precios'],
      basicas: [c('Merci', 'Gracias'), c('S’il vous plaît', 'Por favor'), { texto: 'sin traducción' }],
      sesion: { tema: 'Saludar y presentarte', objetivo: 'Vas a poder saludar y decir tu nombre', palabras: [c('Bonjour', 'Hola'), c('Je m’appelle', 'Me llamo'), c('Enchanté', 'Encantado')], frases: [c('Bonjour, je m’appelle Ana.', 'Hola, me llamo Ana.')], pregunta: c('Comment tu t’appelles ?', '¿Cómo te llamás?', null, 'ko-mán tü ta-pél'), sugeridas: [c('Je m’appelle Lucas.', 'Me llamo Lucas.')] },
    }
    if (sistema.includes('Armás UNA sesión')) return { tema: 'Pedir comida', objetivo: 'Pedir en un bar', palabras: [c('Un café', 'Un café'), c('L’addition', 'La cuenta')], frases: [], pregunta: c('Qu’est-ce que tu prends ?', '¿Qué tomás?'), sugeridas: [c('Un café, s’il vous plaît.', 'Un café, por favor.')] }
    if (sistema.includes('Están practicando')) return {
      correcciones: [{ dijo: 'je suis appelle', natural: c('je m’appelle', 'me llamo'), por_que: 'Se dice «je m’appelle»' }],
      nuevas: [c('Et toi ?', '¿Y vos?')], respuesta: c('Enchanté !', '¡Encantado!'), pregunta: c('Tu habites où ?', '¿Dónde vivís?'), sugeridas: [c('J’habite à Valence.', 'Vivo en Valencia.')], animo: 'Te animaste a hablar entero.', nivel: 'A1',
    }
    if (sistema.includes('Te paso líneas')) return { tarjetas: [c('La carte, s’il vous plaît', 'La carta, por favor'), c('Je ne comprends pas', 'No entiendo')] }
    return {}
  },
  transcribir: async (_db, _audio, _nombre, idioma) => { assert.equal(idioma, 'fr', 'Whisper recibe el idioma que practica'); return 'Bonjour, je suis appelle Lautaro' },
  voz: async () => { voces++; return Buffer.from('mp3-falso') },
  nube: () => false,
})

test('Tarjetas: el repaso espaciado (SM-2) aleja lo que sabe y vuelve a hoy lo que no; se editan y se borran', () => {
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
  const cc = t.crearTarjeta(db, { mazo: 'idioma:1', frente: '¿«Chau»?', dorso: 'Salut' }, T)
  assert.ok(t.responderTarjeta(db, cc.id, 'dificil', T).facilidad < 2.5, 'difícil baja la facilidad')
  for (let i = 0; i < 12; i++) t.responderTarjeta(db, cc.id, 'otra', T)
  assert.equal(t.leerTarjeta(db, cc.id)!.facilidad, 1.3, 'nunca baja de 1,3')
  assert.throws(() => t.responderTarjeta(db, cc.id, 'genial' as any, T))

  const r = t.resumenTarjetas(db, T)
  assert.deepEqual({ ...r.find((m) => m.mazo === 'idioma:1') }, { mazo: 'idioma:1', hoy: 1, total: 3, aprendidas: 0 })
  t.suspenderTarjeta(db, cc.id)
  assert.equal(t.paraRepasar(db, { mazo: 'idioma:1' }, T).length, 0)

  assert.equal(t.editarTarjeta(db, b.id, { dorso: 'Merci beaucoup' }).dorso, 'Merci beaucoup')
  assert.throws(() => t.editarTarjeta(db, b.id, { frente: '¿Cómo dirías «hola»?' }), /Ya hay una tarjeta/)
  t.borrarTarjeta(db, b.id)
  assert.equal(t.leerTarjeta(db, b.id), null)
  // Varias de una, pero solo del mazo que se está mirando.
  const v1 = t.crearTarjeta(db, { mazo: 'idioma:1', frente: '¿Cómo dirías: «Corruptopolis»?', dorso: 'x' }, T).id
  const v2 = t.crearTarjeta(db, { mazo: 'idioma:1', frente: '¿Cómo dirías: «mi proyecto»?', dorso: 'y' }, T).id
  const otra = t.paraRepasar(db, { mazo: 'video:9' }, T)[0].id
  assert.equal(t.borrarTarjetas(db, 'idioma:1', [v1, v2, otra]), 2)
  assert.ok(t.leerTarjeta(db, otra), 'la de otro mazo no se toca')
  assert.deepEqual(t.tarjetasDeMazo(db, 'idioma:1').map((x) => x.id), [a.id])
})

test('Idiomas: el kit de una (temario, básicas como tarjetas y la primera sesión con sus capas y audios); abrir es instantáneo', async () => {
  const db = abrir(':memory:')
  assert.throws(() => idi.crearIdioma(db, { codigo: 'fr', porQue: 'sí' }, T), /para qué/)
  assert.throws(() => idi.crearIdioma(db, { codigo: 'xx', porQue: 'Porque quiero vivir en Lyon' }, T), /No conozco/)
  const fr = idi.crearIdioma(db, { codigo: 'fr', porQue: 'Para ir a comer afuera en París', sobreMi: 'Me llamo Lautaro, vivo en Valencia' }, T)
  assert.equal(fr.nivel, 'A0', 'de cero por defecto')
  assert.equal(fr.hora, null, 'sin hora: se practica en la app cuando quiera')
  assert.throws(() => idi.crearIdioma(db, { codigo: 'fr', porQue: 'Otra vez el mismo idioma' }, T), /Ya estás/)

  // Su memoria no entra: lo que guía es su para qué (y lo poco que contó de él).
  db.prepare(`INSERT INTO memoria (texto, tipo, fecha, estado, revisada, creada_por, creada_en) VALUES ('Está armando Corruptopolis, un juego', 'hecho', '2026-10-01', 'vigente', 1, 'escriba', 1)`).run()
  pedidos.length = 0
  voces = 0
  const s = await idi.prepararSesion(db, fr.aprendizajeId, { ahora: T })
  assert.equal(pedidos.length, 1, 'una sola llamada trae todo')
  assert.match(pedidos[0].sistema, /cuatro capas/)
  assert.match(pedidos[0].usuario, /comer afuera en París/)
  assert.doesNotMatch(pedidos[0].sistema + pedidos[0].usuario, /Corruptopolis/)
  assert.equal(s.estado, 'lista')
  assert.equal(s.paquete.palabras.length, 3)
  assert.deepEqual(s.paquete.pregunta, { texto: 'Comment tu t’appelles ?', pron: null, suena: 'ko-mán tü ta-pél', es: '¿Cómo te llamás?', nota: null, audio: s.paquete.pregunta.audio })
  assert.match(s.paquete.pregunta.audio!, /^\/adjuntos\/tts-/, 'los audios ya vienen')
  assert.equal(voces, 3 + 1 + 1 + 1 + 2, 'todos los audios juntos (palabras, frase, pregunta, sugerida y básicas)')
  assert.deepEqual(idi.leerIdioma(db, fr.aprendizajeId)!.temario, ['Saludar y presentarte', 'Pedir comida', 'Números y precios'])
  const basicas = t.tarjetasDeMazo(db, idi.mazoDe(fr.aprendizajeId))
  assert.equal(basicas.length, 2, 'las básicas ya son tarjetas (la incompleta no)')
  assert.match(basicas.find((x) => x.dorso.startsWith('Merci'))!.frente, /¿Cómo se dice: «Gracias»\?/)

  pedidos.length = 0
  const a = await idi.abrirPractica(db, fr.aprendizajeId, T)
  assert.equal(pedidos.length, 0, 'abrir una sesión lista no llama al modelo')
  assert.equal(a.sesion.id, s.id)
  assert.equal(a.mensaje, 'Comment tu t’appelles ?')
  assert.equal(idi.leerIdioma(db, fr.aprendizajeId)!.temaIdx, 1)
  assert.equal((await idi.abrirPractica(db, fr.aprendizajeId, T + 60_000)).sesion.id, s.id, 'reabrir enseguida retoma la misma')

  // La siguiente, sobre el tema que sigue y con lo que ya está aprendiendo.
  const s2 = await idi.prepararSesion(db, fr.aprendizajeId, { ahora: T })
  assert.match(pedidos.at(-1)!.usuario, /Tema de hoy: Pedir comida/)
  assert.match(pedidos.at(-1)!.usuario, /Merci/)
  assert.equal(s2.tema, 'Pedir comida')
})

test('Idiomas: la devolución trae todo con capas y audios; las palabras quedan como tarjetas cortas; la sesión queda en el corpus', async () => {
  const db = abrir(':memory:')
  const fr = idi.crearIdioma(db, { codigo: 'fr', nivel: 'A1', porQue: 'Para ir a comer afuera en París' }, T)
  await idi.prepararSesion(db, fr.aprendizajeId, { ahora: T })
  const { sesion } = await idi.abrirPractica(db, fr.aprendizajeId, T)
  assert.equal(idi.practicaAbierta(db, T + 60_000)?.aprendizajeId, fr.aprendizajeId)
  assert.equal(idi.practicaAbierta(db, T + 50 * 60_000), null, 'después de 45 minutos sin actividad ya no está abierta')

  voces = 0
  const d = await idi.responderPractica(db, fr.aprendizajeId, { audio: Buffer.from('ogg'), nombreAudio: 'a.ogg', segundos: 40 }, T + 120_000)
  assert.equal(d.transcripcion, 'Bonjour, je suis appelle Lautaro')
  assert.equal(d.correcciones[0].natural.texto, 'je m’appelle')
  assert.equal(d.pregunta!.es, '¿Dónde vivís?')
  assert.match(d.pregunta!.audio!, /tts-/)
  assert.equal(voces, 5, 'corrección, lo que faltó, respuesta, pregunta y sugerida, juntos')
  assert.match(pedidos.at(-1)!.sistema, /Saludar y presentarte/)
  assert.match(pedidos.at(-1)!.usuario, /Comment tu t’appelles/, 'la devolución sabe qué se le preguntó')
  // Las 3 palabras de la sesión + lo que le faltó, cortas, del castellano al francés con cómo suena.
  const cartas = t.tarjetasDeMazo(db, idi.mazoDe(fr.aprendizajeId))
  assert.equal(d.tarjetasNuevas, 4)
  assert.ok(cartas.some((x) => x.frente === '¿Cómo se dice: «¿Y vos?»?' && /^Et toi \?\nsuena «su-é-na»$/.test(x.dorso)))

  await idi.responderPractica(db, fr.aprendizajeId, { texto: 'J’habite à Valence' }, T + 300_000)
  assert.match(pedidos.at(-1)!.usuario, /Tu habites où/, 'la segunda contesta la pregunta nueva')
  assert.equal(t.tarjetasDeMazo(db, idi.mazoDe(fr.aprendizajeId)).length, 6, 'no se duplican (4 de la sesión + 2 básicas del kit)')

  // El corpus: una pieza por sesión, al día.
  const pieza = db.prepare(`SELECT titulo, contenido, fuente, nivel FROM corpus WHERE origen_id = ?`).get(`idiomas:${fr.aprendizajeId}:${sesion.id}`) as any
  assert.equal(pieza.fuente, 'idiomas')
  assert.equal(pieza.nivel, 'propia')
  assert.match(pieza.titulo, /^Práctica de francés · 2026-10-19 · Saludar y presentarte$/)
  assert.match(pieza.contenido, /Dije: J’habite à Valence/)
  assert.match(pieza.contenido, /je suis appelle → je m’appelle/)

  const r = idi.cerrarPractica(db, fr.aprendizajeId, T + 10 * 60_000)!
  assert.deepEqual({ ...r, piezaId: !!r.piezaId }, { sesionId: sesion.id, tema: 'Saludar y presentarte', vueltas: 2, palabras: 3, tarjetas: 4, minutos: 10, piezaId: true })
  assert.equal(idi.leerSesion(db, sesion.id)!.estado, 'hecha')

  const [l] = idi.listarIdiomas(db, T + 11 * 60_000)
  assert.equal(l.sesiones, 1)
  assert.equal(l.charlas, 2)
  assert.equal(l.diasMes, 1)
  assert.equal(l.tarjetas.total, 6)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM practicas WHERE aprendizaje_id = ?`).get(fr.aprendizajeId) as any).n, 2)

  // El audio de una frase se guarda una vez; sin voz para el idioma, nada.
  const url = await idi.audioDeFrase('Ça avance bien.', 'fr', process.env.MASTRO_ADJUNTOS!)
  assert.match(url!, /^\/adjuntos\/tts-[0-9a-f]{16}\.mp3$/)
  assert.equal(await idi.audioDeFrase('Hallo', 'de', process.env.MASTRO_ADJUNTOS!), null)
})

test('Idiomas: tarjetas a mano (completar varias de una, revisar y guardar); cambiar intereses rehace el temario', async () => {
  const db = abrir(':memory:')
  const fr = idi.crearIdioma(db, { codigo: 'fr', porQue: 'Para ir a comer afuera en París' }, T)
  pedidos.length = 0
  const borradores = await idi.completarTarjetas(db, fr.aprendizajeId, ['la carta por favor', '', 'no entiendo'])
  assert.equal(pedidos.length, 1, 'todas en una llamada')
  assert.match(pedidos[0].usuario, /1\. la carta por favor\n2\. no entiendo/)
  assert.equal(borradores.length, 2)
  assert.equal(t.tarjetasDeMazo(db, idi.mazoDe(fr.aprendizajeId)).length, 0, 'completar no guarda')
  assert.equal(idi.guardarTarjetas(db, fr.aprendizajeId, [...borradores, { texto: 'À demain', es: 'Hasta mañana', suena: 'a de-mán' }, { texto: 'sin traducción' }], T), 3)
  assert.match(t.tarjetasDeMazo(db, idi.mazoDe(fr.aprendizajeId))[0].dorso, /^À demain\nsuena «a de-mán»$/)
  await assert.rejects(idi.completarTarjetas(db, fr.aprendizajeId, ['  ']), /al menos una/)

  await idi.prepararSesion(db, fr.aprendizajeId, { ahora: T })
  assert.ok(idi.sesionLista(db, fr.aprendizajeId))
  idi.editarIdioma(db, fr.aprendizajeId, { intereses: 'vinos, quesos y mercados' })
  assert.deepEqual(idi.leerIdioma(db, fr.aprendizajeId)!.temario, [], 'el temario se rehace')
  assert.equal(idi.sesionLista(db, fr.aprendizajeId), null, 'y la sesión lista vieja se descarta')
  await idi.prepararSesion(db, fr.aprendizajeId, { ahora: T })
  assert.match(pedidos.at(-1)!.usuario, /Temas que le interesan: vinos, quesos y mercados/)
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

test('Telegram (opcional): /idioma abre la sesión con sus capas, lo que contesta es su respuesta, ✋ la cierra; /tarjetas repasa; con hora llega sola', async () => {
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
  const abierta = ultimo().text
  assert.match(abierta, /Francés.*práctica · Saludar y presentarte/)
  assert.match(abierta, /Comment tu t’appelles[\s\S]*ko-mán tü ta-pél[\s\S]*¿Cómo te llamás\?/, 'la pregunta con cómo suena y la traducción')
  assert.match(abierta, /Je m’appelle Lucas/, 'y respuestas sugeridas')
  assert.equal(ultimo().reply_markup.inline_keyboard[0][0].callback_data, `id:${fr.aprendizajeId}:fin`)
  assert.deepEqual(audios.splice(0), ['sendAudio:Francés · escuchá'])

  // Con la práctica abierta, un audio es su respuesta (no va a la charla de Hoy).
  await msj({ voice: { file_id: 'v1', duration: 30 } })
  const dev = ultimo().text
  assert.match(dev, /je suis appelle/)
  assert.match(dev, /je m’appelle/)
  assert.match(dev, /Te faltó[\s\S]*Et toi/)
  assert.match(dev, /Tu habites où[\s\S]*¿Dónde vivís\?/)
  assert.deepEqual(audios.splice(0), ['sendAudio:Francés · repetí en voz alta'])
  assert.ok(t.paraRepasar(db).length >= 4)

  await boton(`id:${fr.aprendizajeId}:fin`, 1)
  assert.match(ultimo().text, /Listo por hoy/)
  assert.equal(idi.practicaAbierta(db), null)

  // /tarjetas: primero la pregunta sola; «Ver» muestra el dorso con las cuatro calidades; marcar pasa a la siguiente.
  await msj({ text: '/tarjetas' })
  const carta = ultimo()
  assert.match(carta.text, /para hoy[\s\S]*¿Cómo se dice/)
  const [, id] = carta.reply_markup.inline_keyboard[0][0].callback_data.split(':')
  await boton(`tj:${id}:ver`, carta.id)
  const vista = ultimo()
  assert.equal(vista.metodo, 'editMessageText')
  assert.match(vista.text, /———/)
  assert.deepEqual(vista.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data), ['otra', 'dificil', 'bien', 'facil'].map((c) => `tj:${id}:${c}`))
  await boton(`tj:${id}:bien`, carta.id)
  assert.equal(t.leerTarjeta(db, Number(id))!.intervalo, 1)

  // Con hora (opcional), la práctica llega sola, una vez por día.
  idi.editarIdioma(db, fr.aprendizajeId, { hora: '00:00' })
  const antes = enviados.length
  await tg.latidoTelegram(db)
  assert.match(ultimo().text, /Francés.*práctica/)
  const despues = enviados.length
  assert.ok(despues > antes)
  await tg.latidoTelegram(db)
  assert.equal(enviados.length, despues, 'no se repite en el mismo día')
})
