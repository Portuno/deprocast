import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { abrir, ajuste } from '../src/db.ts'
import { _probarGoogle, accesoGoogle, estadoGoogle, urlDeConexion, volverDeGoogle } from '../src/google/oauth.ts'
import { crearBorrador, sincronizarGmail, sinCitas, textoDe, verMails } from '../src/google/gmail.ts'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const idToken = (email: string) => `x.${b64(JSON.stringify({ email }))}.y`
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } })

function mensaje(id: string, hilo: string, o: { de: string; para: string; asunto: string; texto: string; etiquetas: string[]; fecha: number; mid?: string }) {
  return {
    id, threadId: hilo, labelIds: o.etiquetas, snippet: o.texto.slice(0, 80), internalDate: String(o.fecha),
    payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: o.de }, { name: 'To', value: o.para }, { name: 'Subject', value: o.asunto }, { name: 'Message-ID', value: o.mid ?? `<${id}@mail>` }],
      parts: [{ mimeType: 'text/plain', body: { data: b64(o.texto) } }, { mimeType: 'text/html', body: { data: b64(`<p>${o.texto}</p>`) } }] },
  }
}

describe('Google y Gmail (plan v35, fase 1)', () => {
  const antes = { id: process.env.GOOGLE_OAUTH_ID, s: process.env.GOOGLE_OAUTH_SECRETO }
  before(() => { process.env.GOOGLE_OAUTH_ID = 'cliente'; process.env.GOOGLE_OAUTH_SECRETO = 'secreto' })
  after(() => {
    if (antes.id === undefined) delete process.env.GOOGLE_OAUTH_ID; else process.env.GOOGLE_OAUTH_ID = antes.id
    if (antes.s === undefined) delete process.env.GOOGLE_OAUTH_SECRETO; else process.env.GOOGLE_OAUTH_SECRETO = antes.s
    _probarGoogle(fetch)
  })

  it('conectar: el estado es de un solo uso, cambia el código por el permiso y lo renueva solo', async () => {
    const db = abrir(':memory:')
    const pedidos: { url: string; cuerpo: string }[] = []
    let refrescos = 0
    _probarGoogle((async (u: string, init: RequestInit = {}) => {
      const cuerpo = String(init.body ?? '')
      pedidos.push({ url: String(u), cuerpo })
      if (String(u).includes('oauth2.googleapis.com/token')) {
        const f = new URLSearchParams(cuerpo)
        if (f.get('grant_type') === 'authorization_code') return json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: 'gmail', id_token: idToken('yo@ejemplo.com') })
        refrescos++
        return f.get('refresh_token') === 'r1' ? json({ access_token: `a${refrescos + 1}`, expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400)
      }
      return json({})
    }) as typeof fetch)

    const url = new URL(urlDeConexion(db, 'https://mi.deprocast'))
    assert.equal(url.searchParams.get('redirect_uri'), 'https://mi.deprocast/google/volver')
    assert.equal(url.searchParams.get('access_type'), 'offline')
    assert.match(url.searchParams.get('scope')!, /gmail\.readonly/)
    const state = url.searchParams.get('state')!
    await assert.rejects(volverDeGoogle(db, { code: 'c', state: 'otro' }), /venció o no es este/)
    // El intento fallido gastó el estado: hay que pedir otro.
    const state2 = new URL(urlDeConexion(db, 'https://mi.deprocast')).searchParams.get('state')!
    assert.notEqual(state, state2)
    assert.deepEqual(await volverDeGoogle(db, { code: 'c', state: state2 }), { email: 'yo@ejemplo.com' })
    assert.equal(estadoGoogle(db).conectado, true)
    assert.equal(estadoGoogle(db).email, 'yo@ejemplo.com')
    assert.match(pedidos.at(-1)!.cuerpo, /redirect_uri=https%3A%2F%2Fmi.deprocast%2Fgoogle%2Fvolver/)

    assert.equal(await accesoGoogle(db), 'a1', 'el acceso recién dado se reusa')
    assert.equal(refrescos, 0)
    assert.equal(await accesoGoogle(db, false, Date.now() + 2 * 3600_000), 'a2', 'vencido: se renueva con el permiso duradero')
    assert.equal(refrescos, 1)
  })

  it('un permiso revocado deja a Google desconectado y lo dice', async () => {
    const db = abrir(':memory:')
    db.prepare(`INSERT INTO ajustes (clave, valor) VALUES ('google_refresh', 'revocado')`).run()
    _probarGoogle((async () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400)) as typeof fetch)
    await assert.rejects(accesoGoogle(db), /revoked/)
    assert.equal(estadoGoogle(db).conectado, false)
    assert.match(estadoGoogle(db).error ?? '', /volver a conectar/)
  })

  it('Gmail: la primera pasada, lo suyo al corpus con el mail al que respondía, y después solo lo nuevo', async () => {
    const db = abrir(':memory:')
    db.prepare(`INSERT INTO ajustes (clave, valor) VALUES ('google_refresh', 'r1')`).run()
    const ahora = Date.now()
    const msgs: Record<string, unknown> = {
      m1: mensaje('m1', 'h1', { de: 'Ana <ana@ejemplo.com>', para: 'yo@ejemplo.com', asunto: 'El presupuesto', texto: '¿Me pasás el presupuesto del mes?', etiquetas: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'], fecha: ahora - 3_600_000 }),
      m2: mensaje('m2', 'h1', { de: 'yo@ejemplo.com', para: 'Ana <ana@ejemplo.com>', asunto: 'Re: El presupuesto', texto: 'Te lo paso mañana temprano, ya lo tengo casi listo.\n\nEl lun, 3 nov 2026, Ana <ana@ejemplo.com> escribió:\n> ¿Me pasás el presupuesto del mes?', etiquetas: ['SENT'], fecha: ahora - 1_800_000 }),
      m3: mensaje('m3', 'h2', { de: 'Tienda <ofertas@tienda.com>', para: 'yo@ejemplo.com', asunto: '50% off', texto: 'Ofertas', etiquetas: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'], fecha: ahora - 600_000 }),
      m4: mensaje('m4', 'h3', { de: 'Beto <beto@ejemplo.com>', para: 'yo@ejemplo.com', asunto: 'Mañana', texto: '¿Seguimos mañana a las 10?', etiquetas: ['INBOX', 'UNREAD'], fecha: ahora - 60_000 }),
    }
    let borrador: any = null
    _probarGoogle((async (u: string, init: RequestInit = {}) => {
      const url = String(u)
      if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'a', expires_in: 3600 })
      if (url.endsWith('/profile')) return json({ historyId: '100' })
      if (url.includes('/messages?q=')) return json({ messages: [{ id: 'm3' }, { id: 'm2' }, { id: 'm1' }] })
      if (url.includes('/history?startHistoryId=100')) return json({ historyId: '120', history: [{ messagesAdded: [{ message: { id: 'm4' } }] }, { labelsRemoved: [{ message: { id: 'm1' }, labelIds: ['UNREAD'] }] }] })
      const m = /\/messages\/(\w+)\?format=full/.exec(url)
      if (m) return msgs[m[1]] ? json(msgs[m[1]]) : json({ error: { message: 'no' } }, 404)
      if (url.endsWith('/drafts')) { borrador = JSON.parse(String(init.body)); return json({ id: 'd1' }) }
      return json({ error: { message: `no simulado: ${url}` } }, 500)
    }) as typeof fetch)

    assert.deepEqual(await sincronizarGmail(db), { nuevos: 3, completo: true })
    let b = verMails(db)
    assert.deepEqual(b.correos.map((c) => c.id), ['m1'], 'la promoción no aparece; lo suyo tampoco (no es bandeja)')
    assert.equal(b.no_leidos, 1)
    const pieza = db.prepare(`SELECT titulo, contenido FROM corpus WHERE titulo LIKE 'Mail ·%'`).get() as { titulo: string; contenido: string }
    assert.match(pieza.contenido, /Te lo paso mañana temprano/)
    assert.doesNotMatch(pieza.contenido.split('— En respuesta')[0], /escribió:/, 'sin lo citado')
    assert.match(pieza.contenido, /En respuesta a Ana/)

    assert.deepEqual(await sincronizarGmail(db), { nuevos: 1, completo: false })
    assert.equal(ajuste(db, 'gmail_historia'), '120')
    b = verMails(db)
    assert.deepEqual(b.correos.map((c) => [c.id, c.leido]), [['m4', false], ['m1', true]], 'm1 quedó leído (lo leyó en Gmail)')

    const r = await crearBorrador(db, { responderA: 'm4', cuerpo: 'Dale, a las 10 nos vemos.' })
    assert.equal(r.para, 'Beto <beto@ejemplo.com>')
    assert.equal(r.asunto, 'Re: Mañana')
    assert.equal(borrador.message.threadId, 'h3', 'en el mismo hilo')
    const crudo = Buffer.from(borrador.message.raw, 'base64url').toString('utf8')
    assert.match(crudo, /In-Reply-To: <m4@mail>/)
    assert.match(crudo, /Subject: =\?UTF-8\?B\?/)
    assert.match(Buffer.from(crudo.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8'), /a las 10 nos vemos/)
  })

  it('texto: el HTML sin etiquetas si no hay texto plano, y lo citado afuera', () => {
    assert.equal(textoDe({ mimeType: 'text/html', body: { data: b64('<p>Hola&nbsp;<b>Lau</b></p><br>Chau') } }), 'Hola Lau\n\nChau')
    assert.equal(sinCitas('Listo.\n\nOn Mon, Nov 3, 2026 at 10:00 Ana <a@b.c> wrote:\n> antes'), 'Listo.')
    assert.equal(sinCitas('Va.\n-----Mensaje original-----\nDe: x'), 'Va.')
  })
})
