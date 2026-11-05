import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { abrir, ajuste } from '../src/db.ts'
import { _probarGoogle, accesoGoogle, estadoGoogle, guardarCliente, urlDeConexion, volverDeGoogle } from '../src/google/oauth.ts'
import { agregarFilas, crearHoja, idDeHoja, leerHoja } from '../src/google/sheets.ts'
import { bandeja, guardarBorrador, hiloDe, marcarAtendido, proponerRespuesta, triarCorreos } from '../src/google/correo.ts'
import { _probarModelo } from '../src/modelo.ts'
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

  it('el cliente se pega como JSON (y avisa si la URI de redirección no es la de este Deprocast)', () => {
    const db = abrir(':memory:')
    delete process.env.GOOGLE_OAUTH_ID
    try {
      assert.throws(() => guardarCliente(db, { json: '{no es json' }), /JSON válido/)
      assert.throws(() => guardarCliente(db, { json: JSON.stringify({ installed: { client_id: 'x.apps.googleusercontent.com', client_secret: 'secreto-largo' } }) }), /Aplicación web/)
      const r = guardarCliente(db, { json: JSON.stringify({ web: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-secreto', redirect_uris: ['https://otro/google/volver'] } }) }, 'https://mi.deprocast')
      assert.match(r.aviso ?? '', /https:\/\/mi.deprocast\/google\/volver/)
      assert.equal(estadoGoogle(db).configurado, true)
      assert.equal(new URL(urlDeConexion(db, 'https://mi.deprocast')).searchParams.get('client_id'), '123-abc.apps.googleusercontent.com')
      // Se manda exactamente la URI registrada para ese host (aunque el pedido llegue como http detrás de un proxy).
      guardarCliente(db, { json: JSON.stringify({ web: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-secreto', redirect_uris: ['http://127.0.0.1:7272/google/volver', 'https://mi.deprocast/google/volver'] } }) })
      assert.equal(new URL(urlDeConexion(db, 'http://mi.deprocast')).searchParams.get('redirect_uri'), 'https://mi.deprocast/google/volver')
      assert.equal(new URL(urlDeConexion(db, 'http://127.0.0.1:7272')).searchParams.get('redirect_uri'), 'http://127.0.0.1:7272/google/volver')
    } finally { process.env.GOOGLE_OAUTH_ID = 'cliente' }
  })

  it('Sheets: el id desde el link, leer, agregar filas y crear', async () => {
    const db = abrir(':memory:')
    db.prepare(`INSERT INTO ajustes (clave, valor) VALUES ('google_refresh', 'r1')`).run()
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'
    assert.equal(idDeHoja(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id)
    assert.throws(() => idDeHoja('cualquier cosa'), /No reconozco/)
    const pedidos: { url: string; metodo: string; cuerpo: any }[] = []
    _probarGoogle((async (u: string, init: RequestInit = {}) => {
      const url = String(u)
      if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'a', expires_in: 3600 })
      pedidos.push({ url, metodo: init.method ?? 'GET', cuerpo: init.body ? JSON.parse(String(init.body)) : null })
      if (url.includes('?fields=')) return json({ properties: { title: 'Gastos' }, sheets: [{ properties: { title: 'Enero', gridProperties: { rowCount: 100, columnCount: 5 } } }] })
      if (url.includes('/values/') && !url.includes(':append') && (init.method ?? 'GET') === 'GET') return json({ range: 'Enero!A1:B2', values: [['Fecha', 'Monto'], ['2026-11-01', '1200']] })
      if (url.includes(':append')) return json({ updates: { updatedRange: 'Enero!A3:B3', updatedRows: 1 } })
      if (url.endsWith('/spreadsheets')) return json({ spreadsheetId: 'nuevo-id-de-planilla-123456', sheets: [{ properties: { title: 'Hoja 1' } }] })
      if (init.method === 'PUT') return json({ updatedRange: 'Hoja 1!A1:B2', updatedCells: 4 })
      return json({}, 404)
    }) as typeof fetch)
    const l = await leerHoja(db, id)
    assert.equal(l.titulo, 'Gastos')
    assert.deepEqual(l.valores[1], ['2026-11-01', '1200'])
    assert.match(decodeURIComponent(pedidos[1].url), /'Enero'!A1:Z200/)
    assert.equal((await agregarFilas(db, id, "'Enero'!A1", [['2026-11-02', '=B2*2']])).filas, 1)
    assert.match(pedidos.at(-1)!.url, /valueInputOption=USER_ENTERED/)
    const c = await crearHoja(db, 'Nueva', [['a', 'b'], [1, 2]])
    assert.equal(c.link, 'https://docs.google.com/spreadsheets/d/nuevo-id-de-planilla-123456/edit')
    assert.deepEqual(pedidos.at(-1)!.cuerpo, { values: [['a', 'b'], [1, 2]] })
  })

  it('el correo en la web: triaje, lo que pide respuesta primero, una respuesta en su voz y el borrador (sale de pendientes)', async () => {
    const db = abrir(':memory:')
    db.prepare(`INSERT INTO ajustes (clave, valor) VALUES ('google_refresh', 'r1')`).run()
    const ahora = Date.now()
    const ins = db.prepare(`INSERT INTO correos (id, hilo, de, para, asunto, fecha, etiquetas, extracto, cuerpo, leido, suyo, ruido, mensaje_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
    ins.run('a1', 'h1', 'Ana <ana@ejemplo.com>', 'yo@ejemplo.com', 'Presupuesto', ahora - 7200_000, 'INBOX UNREAD', '¿Me pasás…', '¿Me pasás el presupuesto antes del viernes?', 0, 0, '<a1@m>')
    ins.run('b1', 'h2', 'Boletín <news@x.com>', 'yo@ejemplo.com', 'Novedades', ahora - 3600_000, 'INBOX UNREAD', 'Este mes…', 'Las novedades del mes.', 0, 0, '<b1@m>')
    ins.run('c1', 'h3', 'Beto <beto@ejemplo.com>', 'yo@ejemplo.com', 'Cena', ahora - 1800_000, 'INBOX', '¿Vamos?', '¿Vamos a cenar el sábado?', 1, 0, '<c1@m>')
    ins.run('s1', 'h9', 'yo@ejemplo.com', 'Ana <ana@ejemplo.com>', 'Re: Otra cosa', ahora - 86_400_000, 'SENT', 'Dale', 'Dale Ana, te lo mando a la tarde. Abrazo, L.', 1, 1, '<s1@m>')

    const prompts: string[] = []
    _probarModelo(async (_l: any, o: any) => {
      const u = String(o.mensajes.at(-1).content)
      prompts.push(u)
      const texto = /id: a1/.test(u)
        ? JSON.stringify({ correos: [{ id: 'a1', pide_respuesta: true, urgencia: 'alta', resumen: 'Ana pide el presupuesto antes del viernes', accion: 'responder' }, { id: 'b1', pide_respuesta: false, urgencia: 'baja', resumen: 'Boletín del mes', accion: 'nada' }, { id: 'c1', pide_respuesta: true, urgencia: 'media', resumen: 'Beto propone cenar el sábado', accion: 'responder' }, { id: 'inventado', pide_respuesta: true }] })
        : JSON.stringify({ texto: 'Hola Ana, te lo mando el jueves. Abrazo, L.' })
      return { texto, llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    })
    assert.equal(await triarCorreos(db), 3, 'lo inventado por el modelo no entra')
    assert.equal(await triarCorreos(db), 0, 'no vuelve a triar lo ya triado')

    let b = await bandeja(db)
    assert.deepEqual(b.correos.map((m) => m.id), ['a1', 'c1'], 'lo que pide respuesta, lo urgente primero')
    assert.equal(b.cuantos.responder, 2)
    assert.equal(b.cuantos.no_leidos, 2)
    assert.equal((await bandeja(db, { filtro: 'enviados' })).correos[0].id, 's1')

    const r = await proponerRespuesta(db, 'a1', 'decile que el jueves')
    assert.match(r.texto, /jueves/)
    const p = prompts.at(-1)!
    assert.match(p, /Dale Ana, te lo mando a la tarde/, 'sus mails a esa persona, como muestra de su voz')
    assert.match(p, /Su indicación: decile que el jueves/)

    let borrador: any = null
    _probarGoogle((async (u: string, init: RequestInit = {}) => {
      if (String(u).includes('oauth2.googleapis.com/token')) return json({ access_token: 'a', expires_in: 3600 })
      if (String(u).endsWith('/drafts')) { borrador = JSON.parse(String(init.body)); return json({ id: 'd9' }) }
      return json({}, 404)
    }) as typeof fetch)
    await guardarBorrador(db, 'a1', r.texto)
    assert.equal(borrador.message.threadId, 'h1')
    b = await bandeja(db)
    assert.deepEqual(b.correos.map((m) => m.id), ['c1'], 'con el borrador hecho, sale de pendientes')
    marcarAtendido(db, 'a1', false)
    assert.equal((await bandeja(db)).correos.length, 2)
    assert.equal(hiloDe(db, 'a1')?.triaje?.urgencia, 'alta')
  })

  it('texto: el HTML sin etiquetas si no hay texto plano, y lo citado afuera', () => {
    assert.equal(textoDe({ mimeType: 'text/html', body: { data: b64('<p>Hola&nbsp;<b>Lau</b></p><br>Chau') } }), 'Hola Lau\n\nChau')
    assert.equal(sinCitas('Listo.\n\nOn Mon, Nov 3, 2026 at 10:00 Ana <a@b.c> wrote:\n> antes'), 'Listo.')
    assert.equal(sinCitas('Va.\n-----Mensaje original-----\nDe: x'), 'Va.')
  })
})
