import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { abrir, fijarAjuste } from '../src/db.ts'
import { ALCANCES, _probarGoogle } from '../src/google/oauth.ts'
import { crearBorrador } from '../src/google/gmail.ts'
import { aplicarReglas, guardarRegla, modificarMails, reglas } from '../src/google/gmail-orden.ts'
import { gruposDelMensaje } from '../src/chat/herramientas.ts'

const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } })
const antes = { id: process.env.GOOGLE_OAUTH_ID, s: process.env.GOOGLE_OAUTH_SECRETO }
before(() => { process.env.GOOGLE_OAUTH_ID = 'cliente'; process.env.GOOGLE_OAUTH_SECRETO = 'secreto' })
after(() => {
  if (antes.id === undefined) delete process.env.GOOGLE_OAUTH_ID; else process.env.GOOGLE_OAUTH_ID = antes.id
  if (antes.s === undefined) delete process.env.GOOGLE_OAUTH_SECRETO; else process.env.GOOGLE_OAUTH_SECRETO = antes.s
  _probarGoogle(fetch)
})

function conectado(alcances = ALCANCES) {
  const db = abrir(':memory:')
  fijarAjuste(db, 'google_refresh', 'r1')
  fijarAjuste(db, 'google_alcances', alcances.map((a) => a.replace('https://www.googleapis.com/auth/', '')).join(' '))
  return db
}
const correo = (db: ReturnType<typeof abrir>, id: string, de: string, asunto: string, etiquetas: string, fecha = Date.now() - 3_600_000) =>
  db.prepare(`INSERT INTO correos (id, hilo, de, para, asunto, fecha, etiquetas, extracto, cuerpo, leido, suyo, ruido) VALUES (?, ?, ?, 'yo@ejemplo.com', ?, ?, ?, '', '', ?, 0, 0)`).run(id, `h-${id}`, de, asunto, fecha, etiquetas, etiquetas.includes('UNREAD') ? 0 : 1)

test('Fragua #338: borrador_mail adjunta archivos de Drive (un Google Doc va como PDF) y no los pega como link', async () => {
  const db = conectado()
  let borrador: any = null
  _probarGoogle((async (u: string, init: RequestInit = {}) => {
    const url = String(u)
    if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'a', expires_in: 3600 })
    if (url.includes('/files/DOCxxxxxxxxxxxxxxx?fields')) return json({ name: 'Presupuesto 2027', mimeType: 'application/vnd.google-apps.document' })
    if (url.includes('/files/DOCxxxxxxxxxxxxxxx/export?mimeType=application%2Fpdf')) return new Response(Buffer.from('%PDF-1.4 presupuesto'))
    if (url.includes('/files/PDFxxxxxxxxxxxxxxx?fields')) return json({ name: 'Dossier.pdf', mimeType: 'application/pdf', size: '20' })
    if (url.includes('/files/PDFxxxxxxxxxxxxxxx?alt=media')) return new Response(Buffer.from('%PDF-1.4 dossier'))
    if (url.includes('/files/CARxxxxxxxxxxxxxxx?fields')) return json({ name: 'Cartelería', mimeType: 'application/vnd.google-apps.folder' })
    if (url.endsWith('/drafts')) { borrador = JSON.parse(String(init.body)); return json({ id: 'd1' }) }
    return json({ error: { message: `no simulado: ${url}` } }, 500)
  }) as typeof fetch)

  const r = await crearBorrador(db, { para: 'cliente@ejemplo.com', asunto: 'Presupuesto', cuerpo: 'Te mando el presupuesto y el dossier.', adjuntos: ['https://docs.google.com/document/d/DOCxxxxxxxxxxxxxxx/edit', 'PDFxxxxxxxxxxxxxxx'] })
  assert.deepEqual(r.adjuntos, ['Presupuesto 2027.pdf', 'Dossier.pdf'])
  assert.match(r.nota, /con 2 adjuntos/)
  const crudo = Buffer.from(borrador.message.raw, 'base64url').toString('utf8')
  assert.match(crudo, /Content-Type: multipart\/mixed; boundary="/)
  assert.match(crudo, /Content-Disposition: attachment; filename="Presupuesto 2027\.pdf"/)
  assert.match(crudo, /Content-Type: application\/pdf; name="Dossier\.pdf"/)
  const partes = crudo.split(/\r\n--deprocast-[^\r\n]+/)
  assert.ok(partes.some((p) => Buffer.from(p.split('\r\n\r\n')[1]?.replace(/\r\n/g, '') ?? '', 'base64').toString('utf8') === '%PDF-1.4 dossier'), 'el PDF va entero, en base64')
  assert.ok(!/drive\.google|docs\.google/.test(Buffer.from(partes[1].split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8')), 'el cuerpo no lleva el link')

  // Sin adjuntos, el borrador es el de siempre (texto plano).
  await crearBorrador(db, { para: 'x@ejemplo.com', asunto: 'Hola', cuerpo: 'Nada adjunto.' })
  assert.match(Buffer.from(borrador.message.raw, 'base64url').toString('utf8'), /Content-Type: text\/plain; charset=UTF-8/)
  await assert.rejects(crearBorrador(db, { para: 'x@ejemplo.com', cuerpo: 'Va la carpeta', adjuntos: ['CARxxxxxxxxxxxxxxx'] }), /es una carpeta/)
})

test('Fragua #337: archivar, marcar leído y etiquetar en Gmail; las reglas con lista blanca las aplica el encargo y dicen qué hicieron', async () => {
  const db = conectado()
  const pedidos: { url: string; cuerpo: any }[] = []
  _probarGoogle((async (u: string, init: RequestInit = {}) => {
    const url = String(u)
    if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'a', expires_in: 3600 })
    const cuerpo = init.body ? JSON.parse(String(init.body)) : null
    pedidos.push({ url, cuerpo })
    if (url.endsWith('/labels') && !init.method) return json({ labels: [{ id: 'INBOX', name: 'INBOX' }, { id: 'Label_1', name: 'Boletines' }] })
    if (url.endsWith('/labels')) return json({ id: 'Label_9', name: cuerpo.name })
    if (url.endsWith('/messages/batchModify')) return new Response(null, { status: 204 })
    return json({ error: { message: `no simulado: ${url}` } }, 500)
  }) as typeof fetch)

  correo(db, 'm1', 'Substack Digest <digest@substack.com>', 'Lo mejor de la semana', 'INBOX UNREAD CATEGORY_UPDATES')
  correo(db, 'm2', 'Newsletter <news@revista.com>', 'Boletín de noviembre', 'INBOX UNREAD CATEGORY_PROMOTIONS')
  correo(db, 'm3', 'Ana Cliente <ana@cliente.com>', 'Boletín: factura pendiente', 'INBOX UNREAD CATEGORY_PROMOTIONS')
  correo(db, 'm4', 'Beto <beto@ejemplo.com>', '¿Nos vemos?', 'INBOX UNREAD')
  correo(db, 'm5', 'Viejo <viejo@x.com>', 'Boletín viejo', 'INBOX UNREAD CATEGORY_PROMOTIONS', Date.now() - 30 * 86_400_000)

  const m = await modificarMails(db, ['m4'], { leido: true, sumar: ['Seguir'] }) as any
  assert.equal(m.cambiados, 1)
  assert.deepEqual(pedidos.find((p) => p.url.endsWith('/labels') && p.cuerpo)?.cuerpo.name, 'Seguir', 'la etiqueta que no existía se crea')
  assert.deepEqual(pedidos.at(-1)!.cuerpo, { ids: ['m4'], addLabelIds: ['Label_9'], removeLabelIds: ['UNREAD'] })
  assert.equal((db.prepare('SELECT leido, etiquetas FROM correos WHERE id = ?').get('m4') as any).leido, 1)

  guardarRegla(db, { nombre: 'Clientes', de: '@cliente.com', dejar: true })
  guardarRegla(db, { nombre: 'Boletines y digests', asunto: 'boletín, digest, lo mejor de la semana', categoria: undefined, archivar: true, leido: true })
  guardarRegla(db, { nombre: 'Promos', categoria: 'promociones', etiqueta: 'Boletines' })
  assert.equal(reglas(db)[0].nombre, 'Clientes', 'la lista blanca va primero')
  assert.throws(() => guardarRegla(db, { archivar: true }), /a qué mails se aplica/)

  const prueba = await aplicarReglas(db, { probar: true }) as any
  assert.equal(prueba.cambiados, 2)
  const antesDePrueba = pedidos.length
  const r = await aplicarReglas(db) as any
  assert.ok(pedidos.length > antesDePrueba, 'probar no cambia nada; aplicar sí')
  assert.equal(r.protegidos, 1, 'el mail del cliente queda aunque diga «boletín»')
  assert.match(r.resumen, /^Hice: 2 archivado, marcado leído \(Boletines y digests\)\. 1 quedaron en la bandeja/)
  assert.deepEqual(r.detalle[0].mails.map((x: any) => x.de).sort(), ['Newsletter', 'Substack Digest'])
  const batch = pedidos.filter((p) => p.url.endsWith('/batchModify')).at(-1)!.cuerpo
  assert.deepEqual(batch.removeLabelIds.sort(), ['INBOX', 'UNREAD'])
  assert.deepEqual(batch.ids.sort(), ['m1', 'm2'], 'lo de hace un mes no entra (últimos 7 días)')
  assert.equal((db.prepare('SELECT etiquetas FROM correos WHERE id = ?').get('m2') as any).etiquetas.includes('INBOX'), false)

  // Sin el permiso nuevo, lo dice en vez de fallar.
  const sinPermiso = conectado(ALCANCES.filter((a) => !a.endsWith('gmail.modify')))
  assert.equal((await modificarMails(sinPermiso, ['x'], { archivar: true }) as any).sin_permiso, true)
  // El encargo «Archivar o marcar como leído» trae las herramientas de correo.
  assert.ok(gruposDelMensaje('Archivar o marcar como leído lo que no importa').includes('correo'))
})
