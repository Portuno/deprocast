import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { abrir, fijarAjuste } from '../src/db.ts'
import { _probarGoogle as probarOAuth } from '../src/google/oauth.ts'
import { _probarGoogle as probarCalendario, googleConectado, listarGoogle, olvidarGoogle, usarConexionGoogle, viaCalendario } from '../src/google-calendario.ts'
import { buscarContactos, sincronizarContactos } from '../src/google/contactos.ts'
import { prenderTareas, sincronizarTareas } from '../src/google/tareas.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { actualizarMision, crearMision, leerMision, listarMisiones } from '../src/misiones.ts'

const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } })
function conectado(alcances: string) {
  const db = abrir(':memory:')
  fijarAjuste(db, 'google_refresh', 'r1')
  fijarAjuste(db, 'google_alcances', alcances)
  return db
}

describe('agenda, contactos y tareas de Google (plan v35, fase 3)', () => {
  const antes = { id: process.env.GOOGLE_OAUTH_ID, s: process.env.GOOGLE_OAUTH_SECRETO }
  before(() => { process.env.GOOGLE_OAUTH_ID = 'c'; process.env.GOOGLE_OAUTH_SECRETO = 's' })
  after(() => {
    if (antes.id === undefined) delete process.env.GOOGLE_OAUTH_ID; else process.env.GOOGLE_OAUTH_ID = antes.id
    if (antes.s === undefined) delete process.env.GOOGLE_OAUTH_SECRETO; else process.env.GOOGLE_OAUTH_SECRETO = antes.s
    usarConexionGoogle(abrir(':memory:'))
    probarOAuth(fetch)
  })

  it('el calendario va por su cuenta de Google (su calendario principal), sin cuenta de servicio', async () => {
    const db = conectado('https://www.googleapis.com/auth/calendar')
    probarOAuth((async () => json({ access_token: 'token-suyo', expires_in: 3600 })) as typeof fetch)
    const pedidos: { url: string; auth: string }[] = []
    probarCalendario((async (u: string, init: RequestInit = {}) => {
      pedidos.push({ url: String(u), auth: String((init.headers as Record<string, string>).authorization) })
      return json({ items: [{ id: 'e1', summary: 'Dentista', start: { dateTime: '2026-11-06T10:00:00-03:00' }, end: { dateTime: '2026-11-06T11:00:00-03:00' } }] })
    }) as typeof fetch)
    usarConexionGoogle(db)
    olvidarGoogle()
    assert.equal(googleConectado(), true)
    assert.equal(viaCalendario(), 'cuenta')
    const evs = await listarGoogle('2026-11-06', '2026-11-06')
    assert.equal(evs[0].titulo, 'Dentista')
    assert.match(pedidos[0].url, /\/calendars\/primary\/events/)
    assert.equal(pedidos[0].auth, 'Bearer token-suyo')
    // Sin el permiso de calendario, no se usa la conexión.
    usarConexionGoogle(conectado('https://www.googleapis.com/auth/gmail.readonly'))
    assert.notEqual(viaCalendario(), 'cuenta')
  })

  it('sus contactos: todos para buscar; los que son sus personas suman mail, teléfono y cumpleaños', async () => {
    const db = conectado('https://www.googleapis.com/auth/contacts.readonly')
    const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Gómez', alias: ['Anita'] })
    asegurarEntidad(db, { tipo: 'persona', nombre: 'Pedro' })
    probarOAuth((async (u: string) => {
      if (String(u).includes('oauth2.googleapis.com/token')) return json({ access_token: 'a', expires_in: 3600 })
      return json({ connections: [
        { resourceName: 'people/1', names: [{ displayName: 'Ana Gómez' }], emailAddresses: [{ value: 'ana@ejemplo.com' }], phoneNumbers: [{ value: '11 5555-0000', canonicalForm: '+541155550000' }], birthdays: [{ date: { month: 3, day: 14 } }], organizations: [{ name: 'Estudio X', title: 'Abogada' }] },
        { resourceName: 'people/2', names: [{ displayName: 'Pedro' }], emailAddresses: [{ value: 'pedro@ejemplo.com' }] },
        { resourceName: 'people/3', names: [{ displayName: 'Carla Ruiz' }], emailAddresses: [{ value: 'carla@empresa.com' }] },
      ] })
    }) as typeof fetch)
    assert.deepEqual(await sincronizarContactos(db), { contactos: 3, vinculados: 1 }, 'un nombre suelto y corto («Pedro») no se vincula: sería adivinar')
    const meta = JSON.parse((db.prepare('SELECT meta FROM entidades WHERE id = ?').get(ana) as { meta: string }).meta)
    assert.deepEqual(meta.google.emails, ['ana@ejemplo.com'])
    assert.equal(meta.google.cumple, '03-14')
    assert.equal(meta.google.trabajo, 'Abogada en Estudio X')
    const r = buscarContactos(db, 'empresa')
    assert.equal(r[0].nombre, 'Carla Ruiz')
    assert.deepEqual(buscarContactos(db, 'Ana')[0].telefonos, ['+541155550000'])
  })

  it('Google Tasks ↔ sus tareas: entra lo de Google, sale lo nuevo de acá, y cada cambio va para el lado que corresponde', async () => {
    const db = conectado('https://www.googleapis.com/auth/tasks')
    const T0 = new Date(2026, 10, 5, 9).getTime()
    // Una vieja (antes de prender): no se sube sola.
    crearMision(db, { personaje: 'jugador', nivel: 'terciaria', titulo: 'Tarea vieja', estado: 'activa' }, { ahora: T0 - 86_400_000 })
    prenderTareas(db, true, T0)
    const nueva = crearMision(db, { personaje: 'jugador', nivel: 'terciaria', titulo: 'Llamar al banco', vence: '2026-11-07', estado: 'activa' }, { ahora: T0 + 1000 })
    const google: Record<string, Record<string, any>> = {
      lista1: {
        t1: { id: 't1', title: 'Comprar pan', due: '2026-11-06T00:00:00.000Z', status: 'needsAction' },
        t2: { id: 't2', title: 'Ya hecha antes', status: 'completed' },
        t3: { id: 't3', title: 'Borrada', status: 'needsAction', deleted: true },
      },
      '@default': {},
    }
    let n = 0
    probarOAuth((async (u: string, init: RequestInit = {}) => {
      const url = String(u)
      const metodo = init.method ?? 'GET'
      if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'a', expires_in: 3600 })
      if (url.includes('/users/@me/lists')) return json({ items: [{ id: 'lista1', title: 'Mis tareas' }] })
      const m = /\/lists\/([^/]+)\/tasks(?:\/([^?]+))?/.exec(url)!
      const lista = decodeURIComponent(m[1])
      if (metodo === 'GET') return json({ items: Object.values(google[lista] ?? {}) })
      if (metodo === 'POST') { const t = { id: `nueva${++n}`, status: 'needsAction', ...JSON.parse(String(init.body)) }; google.lista1[t.id] = t; return json(t) }
      const t = google.lista1[decodeURIComponent(m[2])]
      if (metodo === 'PATCH') { Object.assign(t, JSON.parse(String(init.body))); return json(t) }
      if (metodo === 'DELETE') { t.deleted = true; return new Response(null, { status: 204 }) }
      return json({}, 404)
    }) as typeof fetch)

    assert.deepEqual(await sincronizarTareas(db, T0 + 2000), { deGoogle: 1, aGoogle: 1, cambios: 0 })
    const pan = listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria' }).find((x) => x.titulo === 'Comprar pan')!
    assert.equal(pan.vence, '2026-11-06')
    assert.equal(google.lista1.nueva1.title, 'Llamar al banco')
    assert.equal(google.lista1.nueva1.due, '2026-11-07T00:00:00.000Z')
    assert.ok(!Object.values(google.lista1).some((t) => t.title === 'Tarea vieja'), 'lo viejo no se sube solo')

    // La tachó en Google → hecha acá. Le cambió el título acá → cambia en Google.
    google.lista1.t1.status = 'completed'
    actualizarMision(db, nueva.id, { titulo: 'Llamar al banco por la tarjeta' })
    assert.deepEqual(await sincronizarTareas(db, T0 + 3000), { deGoogle: 0, aGoogle: 0, cambios: 2 })
    assert.equal(leerMision(db, pan.id)!.estado, 'hecha')
    assert.equal(google.lista1.nueva1.title, 'Llamar al banco por la tarjeta')

    // Sin cambios, nada. Descartada acá → borrada en Google.
    assert.deepEqual(await sincronizarTareas(db, T0 + 4000), { deGoogle: 0, aGoogle: 0, cambios: 0 })
    actualizarMision(db, nueva.id, { estado: 'descartada' })
    await sincronizarTareas(db, T0 + 5000)
    assert.equal(google.lista1.nueva1.deleted, true)
  })
})
