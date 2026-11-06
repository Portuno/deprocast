import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { describe, it, test } from 'node:test'
import { abrir, ajuste } from '../src/db.ts'
import { _probarWhatsapp, aTelegram, aWhatsapp, configurarWhatsapp, decirPorWhatsapp, estadoWhatsapp, firmaValida, recibirWebhook, verificarWebhook } from '../src/whatsapp.ts'

const SECRETO = 'a'.repeat(32)
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } })
const webhook = (mensajes: any[]) => ({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '123456789' }, messages: mensajes } }] }] })

function preparar() {
  const db = abrir(':memory:')
  configurarWhatsapp(db, { numeroId: '123456789', token: 'EAA'.padEnd(40, 'x'), secreto: SECRETO })
  const mandados: any[] = []
  _probarWhatsapp((async (u: string, init: RequestInit = {}) => {
    if (String(u).endsWith('/messages')) { mandados.push(JSON.parse(String(init.body))); return json({ messages: [{ id: 'wamid.salida' }] }) }
    return json({}, 404)
  }) as typeof fetch)
  return { db, mandados }
}

describe('WhatsApp (plan v35, fase 4)', () => {
  it('configurar: valida los datos y deja el token de verificación y el código de vinculación', () => {
    const db = abrir(':memory:')
    assert.throws(() => configurarWhatsapp(db, { numeroId: 'abc', token: 'x'.repeat(40), secreto: SECRETO }), /solo dígitos/)
    assert.throws(() => configurarWhatsapp(db, { numeroId: '123456789', token: 'corto', secreto: SECRETO }), /token/)
    assert.throws(() => configurarWhatsapp(db, { numeroId: '123456789', token: 'x'.repeat(40), secreto: 'no' }), /32 caracteres/)
    const e = configurarWhatsapp(db, { numeroId: '123456789', token: 'x'.repeat(40), secreto: SECRETO })
    assert.equal(e.configurado, true)
    assert.match(e.codigo ?? '', /^\d{6}$/)
    assert.ok((e.verificar ?? '').length >= 20)
  })

  it('el webhook: la verificación de Meta y la firma de cada pedido', () => {
    const { db } = preparar()
    const t = estadoWhatsapp(db).verificar!
    assert.equal(verificarWebhook(db, new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': t, 'hub.challenge': '42' })), '42')
    assert.equal(verificarWebhook(db, new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '42' })), null)
    const cuerpo = Buffer.from('{"entry":[]}')
    const firma = `sha256=${crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('hex')}`
    assert.equal(firmaValida(db, cuerpo, firma), true)
    assert.equal(firmaValida(db, Buffer.from('{"entry":[1]}'), firma), false, 'otro cuerpo, otra firma')
    assert.equal(firmaValida(db, cuerpo, undefined), false)
  })

  it('se vincula con el código; a los demás, silencio; cada mensaje se atiende una sola vez; y contesta por WhatsApp', async () => {
    const { db, mandados } = preparar()
    const codigo = estadoWhatsapp(db).codigo!
    assert.equal(await recibirWebhook(db, webhook([{ id: 'w1', from: '5491100000000', type: 'text', text: { body: 'hola' } }])), 0)
    assert.equal(mandados.length, 0, 'sin vincular, a quien no manda el código no se le contesta')
    assert.equal(await recibirWebhook(db, webhook([{ id: 'w2', from: '5491100000000', type: 'text', text: { body: `mi código: ${codigo}` } }])), 1)
    assert.equal(ajuste(db, 'whatsapp_wa_id'), '5491100000000')
    assert.match(mandados[0].text.body, /vinculados/)
    assert.equal(estadoWhatsapp(db).vinculado, '+5491100000000')

    // Otro número: nada. El mismo mensaje dos veces (Meta reintenta): una sola vez.
    assert.equal(await recibirWebhook(db, webhook([{ id: 'w3', from: '5491199999999', type: 'text', text: { body: '/ayuda' } }])), 0)
    mandados.length = 0
    await recibirWebhook(db, webhook([{ id: 'w4', from: '5491100000000', type: 'text', text: { body: '/ayuda' } }]))
    await recibirWebhook(db, webhook([{ id: 'w4', from: '5491100000000', type: 'text', text: { body: '/ayuda' } }]))
    const respuestas = mandados.filter((m) => m.type === 'text')
    assert.equal(respuestas.length, 1, 'contestó una sola vez')
    assert.equal(respuestas[0].to, '5491100000000')
    assert.match(respuestas[0].text.body, /Acá estoy/, 'el mismo cerebro que Telegram (el comando /ayuda)')
  })

  it('lo que Mastropiero dice solo: por WhatsApp solo dentro de las 24 horas', async () => {
    const { db, mandados } = preparar()
    await recibirWebhook(db, webhook([{ id: 'v1', from: '5491100000000', type: 'text', text: { body: estadoWhatsapp(db).codigo! } }]), Date.now() - 25 * 3_600_000)
    mandados.length = 0
    assert.equal(await decirPorWhatsapp(db, 'Buen día'), false, 'ventana cerrada')
    db.prepare(`UPDATE ajustes SET valor = ? WHERE clave = 'whatsapp_ultimo_entrante'`).run(String(Date.now() - 3_600_000))
    assert.equal(await decirPorWhatsapp(db, 'Buen día, **hoy** tenés [#12] tres cosas'), true)
    assert.equal(mandados[0].text.body, 'Buen día, *hoy* tenés tres cosas')
  })

  it('los tipos de mensaje se traducen a lo que entiende el cerebro', () => {
    assert.equal(aTelegram({ type: 'audio', audio: { id: 'm1' } }).message.voice.file_id, 'm1')
    assert.equal(aTelegram({ type: 'image', image: { id: 'm2', caption: 'mi almuerzo' } }).message.caption, 'mi almuerzo')
    assert.equal(aTelegram({ id: 'x', type: 'interactive', interactive: { button_reply: { id: 'k:3:ok', title: 'Cargar' } } }).callback_query.data, 'k:3:ok')
    assert.equal(aTelegram({ type: 'sticker' }), null)
    assert.equal(aWhatsapp('## Hoy\n**Ojo** con [esto](https://x.com)'), '*Hoy*\n*Ojo* con esto (https://x.com)')
  })
})

test('WhatsApp: el perfil dice qué fue lo último que llegó de Meta (para ver por qué no contesta)', async () => {
  const { abrir } = await import('../src/db.ts')
  const wa = await import('../src/whatsapp.ts')
  const db = abrir(':memory:')
  wa.configurarWhatsapp(db, { numeroId: '1234567', token: 'EAA'.padEnd(40, 'x'), secreto: 'a'.repeat(32) })
  assert.equal(wa.estadoWhatsapp(db).diag, null)
  await wa.recibirWebhook(db, { entry: [{ changes: [{ value: { metadata: { phone_number_id: '999' }, messages: [{ id: 'm1', from: '34600', type: 'text', text: { body: 'hola' } }] } }] }] })
  assert.match(wa.estadoWhatsapp(db).diag!.que, /otro número \(ID 999\)/)
  await wa.recibirWebhook(db, { entry: [{ changes: [{ value: { metadata: { phone_number_id: '1234567' }, messages: [{ id: 'm2', from: '34600', type: 'text', text: { body: 'hola' } }] } }] }] })
  assert.match(wa.estadoWhatsapp(db).diag!.que, /no es el código/)
  assert.throws(() => wa.configurarWhatsapp(db, { numeroId: '1234567', token: 'EAA'.padEnd(40, 'x'), secreto: 'EAA'.padEnd(40, 'y') }), /pegaste un token/)
})

test('WhatsApp: suscribir la cuenta a la app sale del token (debug_token → subscribed_apps)', async () => {
  const wa = await import('../src/whatsapp.ts')
  const db = abrir(':memory:')
  wa.configurarWhatsapp(db, { numeroId: '1234567', token: 'EAA'.padEnd(40, 'x'), secreto: 'a'.repeat(32) })
  const pedidos: string[] = []
  wa._probarWhatsapp((async (url: string, init?: RequestInit) => {
    pedidos.push(`${init?.method ?? 'GET'} ${String(url).replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, '').replace(/\?.*/, '')}`)
    if (String(url).includes('debug_token')) return Response.json({ data: { granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: ['555'] }, { scope: 'whatsapp_business_management', target_ids: ['555'] }] } })
    if (init?.method === 'POST') return Response.json({ success: true })
    return Response.json({ data: [{ whatsapp_business_api_data: { name: 'Mastropiero' } }] })
  }) as typeof fetch)
  const r = await wa.suscribirApp(db)
  assert.deepEqual(r, { cuentas: ['555'], apps: ['Mastropiero'] })
  assert.deepEqual(pedidos, ['GET debug_token', 'POST 555/subscribed_apps', 'GET 555/subscribed_apps'])
  assert.match(wa.estadoWhatsapp(db).diag!.que, /suscripta a la app/)
})
