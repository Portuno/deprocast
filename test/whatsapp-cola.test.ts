import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { conversacionHoy, _probarModelo } from '../src/chat/index.ts'
import { anotarSugeridas, resolverRapido, sugeridasParaPrompt } from '../src/chat/sugeridas.ts'
import { crearMision, leerMision } from '../src/misiones.ts'
import { _probarCola, _probarWhatsapp, aTelegram, aWhatsapp, configurarWhatsapp, mandarTexto, recibirWebhook, retomarWhatsapp } from '../src/whatsapp.ts'

const SUYO = '34600000000'
const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } })
const webhook = (m: any) => ({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '123456789' }, messages: [m] } }] }] })
const texto = (id: string, body: string, extra: any = {}) => ({ id, from: SUYO, type: 'text', text: { body }, ...extra })
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

function preparar() {
  const db = abrir(':memory:')
  configurarWhatsapp(db, { numeroId: '123456789', token: 'EAA'.padEnd(40, 'x'), secreto: 'a'.repeat(32) })
  db.prepare(`INSERT OR REPLACE INTO ajustes (clave, valor) VALUES ('whatsapp_wa_id', ?)`).run(SUYO)
  const mandados: any[] = []
  let n = 0
  _probarWhatsapp((async (u: string, init: RequestInit = {}) => {
    if (String(u).endsWith('/messages')) { mandados.push(JSON.parse(String(init.body))); return json({ messages: [{ id: `wamid.salida${++n}` }] }) }
    return json({})
  }) as typeof fetch)
  _probarCola({ juntarMs: 40, avisoMs: 30 })
  return { db, mandados, respuestas: () => mandados.filter((m) => m.type === 'text') }
}

test('lo que dice cambia el sistema: «ya la hice» cierra lo que le sugirió, «sacala» lo descarta, y no se vuelve a sugerir', () => {
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  const a = crearMision(db, { titulo: 'Mandar el presupuesto a Ana', nivel: 'terciaria', estado: 'activa' })
  const b = crearMision(db, { titulo: 'Llamar al contador por el IVA', nivel: 'terciaria', estado: 'activa' })
  assert.equal(resolverRapido(db, cid, 'ya la hice'), null, 'sin nada sugerido, va al modelo')

  anotarSugeridas(db, cid, 'Hoy te conviene: mandar el presupuesto a Ana y después llamar al contador por el IVA.')
  assert.match(sugeridasParaPrompt(db, cid), /\[#\d+\] Mandar el presupuesto a Ana/)
  assert.equal(resolverRapido(db, cid, 'ya la hice'), null, 'dos sugeridas y no dice cuál: lo resuelve el modelo con el contexto')
  assert.match(resolverRapido(db, cid, 'ya hice lo del presupuesto')!, /✅.*presupuesto a Ana.*No te la vuelvo a sugerir/)
  assert.equal(leerMision(db, a.id)!.estado, 'hecha')
  assert.equal(resolverRapido(db, cid, '¿ya la hice?'), null, 'una pregunta no cierra nada')
  assert.match(resolverRapido(db, cid, 'sacala, no me la vuelvas a sugerir')!, /🗑.*contador/)
  assert.equal(leerMision(db, b.id)!.estado, 'descartada')
  assert.equal(sugeridasParaPrompt(db, cid), '', 'lo cerrado ya no aparece como sugerido')

  // La última respuesta manda: si nombró una sola, «listo, ya la hice» es esa.
  const c = crearMision(db, { titulo: 'Revisar el contrato de Versa', nivel: 'terciaria', estado: 'activa' })
  anotarSugeridas(db, cid, 'Lo que sigue: revisar el contrato de Versa.')
  assert.match(resolverRapido(db, cid, 'listo, ya la hice')!, /Versa/)
  assert.equal(leerMision(db, c.id)!.estado, 'hecha')
})

test('WhatsApp: una ráfaga de mensajes es una sola respuesta, con todo junto', async () => {
  const { db, respuestas } = preparar()
  let llamadas = 0
  let visto = ''
  _probarModelo(async (l, o) => { if (l.agenteId !== 'mastropiero') return { texto: '{}', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }; llamadas++; visto = (o.mensajes as any[]).filter((m) => m.role === 'user').map((m) => String(m.content)).join('\n'); return { texto: 'Todo junto: sí.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 5 } })
  await Promise.all([
    recibirWebhook(db, webhook(texto('r1', 'che, una cosa'))),
    esperar(5).then(() => recibirWebhook(db, webhook(texto('r2', 'mirá el tema de la mudanza')))),
    esperar(10).then(() => recibirWebhook(db, webhook(texto('r3', 'qué opinás de hacerla en enero')))),
  ])
  assert.equal(llamadas, 1, 'un solo turno para los tres')
  assert.match(visto, /che, una cosa\nmirá el tema de la mudanza\nqué opinás de hacerla en enero/)
  assert.equal(respuestas().length, 1)
  assert.equal(respuestas()[0].text.body, 'Todo junto: sí.')
  assert.equal((db.prepare('SELECT COUNT(*) n FROM whatsapp_vistos WHERE hecho = 1').get() as any).n, 3, 'los tres, atendidos')
})

test('WhatsApp: mientras piensa algo largo, «ya la hice» se contesta en el acto; la respuesta larga llega citada y con ⏳ mientras tanto', async () => {
  const { db, mandados, respuestas } = preparar()
  const m = crearMision(db, { titulo: 'Mandar el presupuesto a Ana', nivel: 'terciaria', estado: 'activa' })
  anotarSugeridas(db, conversacionHoy(db).id, 'Te queda mandar el presupuesto a Ana.')
  let soltar: () => void = () => {}
  let llamadas = 0
  _probarModelo(async (l) => { if (l.agenteId !== 'mastropiero') return { texto: '{}', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }; llamadas++; await new Promise<void>((r) => { soltar = r }); return { texto: 'Acá va el análisis largo.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 5 } })

  const largo = recibirWebhook(db, webhook(texto('l1', 'analizame cómo vengo con los proyectos de este mes')))
  await esperar(120) // juntó, entró al turno, y ya pasó el aviso
  assert.ok(mandados.some((x) => x.type === 'reaction' && x.reaction.emoji === '⏳' && x.reaction.message_id === 'l1'), '⏳ en su mensaje mientras piensa')
  await recibirWebhook(db, webhook(texto('l2', 'ya la hice')))
  assert.match(respuestas().at(-1).text.body, /✅.*presupuesto a Ana/, 'contestado sin esperar el turno largo')
  assert.equal(leerMision(db, m.id)!.estado, 'hecha')

  soltar()
  await largo
  const final = respuestas().at(-1)
  assert.equal(final.text.body, 'Acá va el análisis largo.')
  assert.deepEqual(final.context, { message_id: 'l1' }, 'llega después de otro mensaje suyo: va citando el que contesta')
  assert.equal(llamadas, 1, '«ya la hice» no entró al turno largo ni abrió otro')
  assert.ok(mandados.some((x) => x.type === 'reaction' && x.reaction.emoji === '' && x.reaction.message_id === 'l1'), 'al contestar, se saca el ⏳')
})

test('WhatsApp: entiende lo reenviado, lo citado, la ubicación y los contactos; las tablas se vuelven listas', async () => {
  preparar()
  assert.match(aTelegram(texto('f1', 'Mañana a las 10 en lo de Pedro', { context: { forwarded: true } })).message.text, /^\(Me reenviaste esto desde otro chat[^\n]+\)\nMañana a las 10/)
  await mandarTexto(abrir(':memory:'), SUYO, '¿Te anoto la reunión del jueves?')
  assert.match(aTelegram(texto('c1', 'sí', { context: { id: 'wamid.salida1' } })).message.text, /Respondés a esto que te dije: «¿Te anoto la reunión del jueves\?»\)\nsí$/)
  assert.match(aTelegram({ id: 'u1', type: 'location', location: { latitude: 39.47, longitude: -0.37, name: 'Ruzafa' } }).message.text, /Ruzafa · 39.47, -0.37/)
  assert.match(aTelegram({ id: 'k1', type: 'contacts', contacts: [{ name: { formatted_name: 'Ana Pérez' }, phones: [{ phone: '+34 611' }] }] }).message.text, /un contacto: Ana Pérez · \+34 611/)
  assert.equal(aWhatsapp('| Qué | Cuándo |\n|---|---|\n| Gym | lunes |\n| IVA | martes |'), '- Qué · Cuándo\n- Gym · lunes\n- IVA · martes')
})

test('WhatsApp: lo que un reinicio cortó se retoma (una vez atendido, no se repite)', async () => {
  const { db, respuestas } = preparar()
  const hace = Date.now() - 5 * 60_000
  db.prepare('INSERT INTO whatsapp_vistos (id, en, crudo) VALUES (?, ?, ?)').run('x1', hace, JSON.stringify(texto('x1', '/ayuda')))
  assert.equal(await retomarWhatsapp(db), 1)
  assert.match(respuestas()[0].text.body, /Acá estoy/)
  assert.equal(await retomarWhatsapp(db), 0, 'ya quedó hecho')
})
