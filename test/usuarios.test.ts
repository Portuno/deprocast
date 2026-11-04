import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import {
  abrirCuentas, alta, cambiarClave, cambiarEstado, crearInvitacion, crearLimitador, crearSesion, entrar, sesionDe, verInvitacion,
} from '../src/cuentas-usuarios/cuentas.ts'
import { entornoDeUsuario } from '../src/cuentas-usuarios/procesos.ts'
import { crearPuerta } from '../src/cuentas-usuarios/index.ts'
import { autorizado, CABECERA_HUB } from '../src/acceso.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'usuarios-'))

describe('cuentas de usuarios (plan v33, paso 5)', () => {
  it('alta por invitación de un solo uso, entrar, sesión, suspender', async () => {
    const db = abrirCuentas(path.join(tmp(), 'cuentas.db'))
    const inv = crearInvitacion(db, {})
    assert.ok(verInvitacion(db, inv.codigo))
    await assert.rejects(alta(db, { codigo: inv.codigo, email: 'ana@ejemplo.com', nombre: 'Ana', clave: 'corta' }), /10 caracteres/)
    const u = await alta(db, { codigo: inv.codigo, email: 'ana@ejemplo.com', nombre: 'Ana', clave: 'una clave larga' })
    assert.equal(u.estado, 'activo')
    assert.equal(verInvitacion(db, inv.codigo), null, 'la invitación ya se usó')
    await assert.rejects(alta(db, { codigo: inv.codigo, email: 'otro@ejemplo.com', nombre: 'Otro', clave: 'una clave larga' }), /no existe, ya se usó/)

    assert.equal(await entrar(db, 'ana@ejemplo.com', 'mal mal mal mal'), null)
    assert.equal(await entrar(db, 'nadie@ejemplo.com', 'una clave larga'), null)
    assert.equal((await entrar(db, 'ANA@ejemplo.com', 'una clave larga'))?.id, u.id, 'el email no distingue mayúsculas')

    const t = crearSesion(db, u.id)
    assert.equal(sesionDe(db, t)?.id, u.id)
    assert.equal(sesionDe(db, 'otra-cosa'), null)
    cambiarEstado(db, u.id, 'suspendido')
    assert.equal(sesionDe(db, t), null, 'suspender corta las sesiones')
    assert.equal(await entrar(db, 'ana@ejemplo.com', 'una clave larga'), null, 'suspendido no entra')
  })

  it('la invitación con email solo sirve para ese email; las vencidas no valen', async () => {
    const db = abrirCuentas(path.join(tmp(), 'cuentas.db'))
    const inv = crearInvitacion(db, { email: 'beto@ejemplo.com' })
    await assert.rejects(alta(db, { codigo: inv.codigo, email: 'otro@ejemplo.com', nombre: 'X', clave: 'una clave larga' }), /es para beto/)
    const vieja = crearInvitacion(db, { dias: 1 }, Date.now() - 2 * 86_400_000)
    assert.equal(verInvitacion(db, vieja.codigo), null)
  })

  it('cambiar la contraseña cierra las sesiones', async () => {
    const db = abrirCuentas(path.join(tmp(), 'cuentas.db'))
    const u = await alta(db, { codigo: crearInvitacion(db).codigo, email: 'c@ejemplo.com', nombre: 'C', clave: 'primera clave' })
    const t = crearSesion(db, u.id)
    await assert.rejects(cambiarClave(db, u.id, 'no es esta', 'segunda clave'), /actual/)
    await cambiarClave(db, u.id, 'primera clave', 'segunda clave')
    assert.equal(sesionDe(db, t), null)
    assert.ok(await entrar(db, 'c@ejemplo.com', 'segunda clave'))
  })

  it('el limitador corta tras el máximo y se libera con el tiempo', () => {
    const lim = crearLimitador(3, 1000)
    assert.deepEqual([lim('a', 0), lim('a', 1), lim('a', 2), lim('a', 3)], [true, true, true, false])
    assert.equal(lim('b', 3), true)
    assert.equal(lim('a', 1500), true)
  })

  it('el entorno de un usuario no lleva las claves del dueño', () => {
    const env = entornoDeUsuario({ PATH: '/bin', NAN_API_KEY: 'k', MASTRO_CLAVE: 'secreta', TELEGRAM_BOT_TOKEN: 't', GCAL_ICS_URLS: 'u', FIRECRAWL_API_KEY: 'f', NAN_CADENA_GENERATIVO: 'a,b' }, { MASTRO_USUARIO: '3' })
    assert.deepEqual(Object.keys(env).sort(), ['MASTRO_USUARIO', 'NAN_API_KEY', 'NAN_CADENA_GENERATIVO', 'PATH'])
  })

  it('en el Deprocast de un usuario solo pasa lo que trae la cabecera del hub (ni «esta compu»)', () => {
    const antes = { u: process.env.MASTRO_USUARIO, t: process.env.MASTRO_HUB_TOKEN }
    process.env.MASTRO_USUARIO = '7'
    process.env.MASTRO_HUB_TOKEN = 'x'.repeat(64)
    try {
      const req = (h: Record<string, string>) => ({ headers: h, socket: { remoteAddress: '127.0.0.1' } }) as unknown as http.IncomingMessage
      assert.equal(autorizado(req({})), false)
      assert.equal(autorizado(req({ [CABECERA_HUB]: 'y'.repeat(64) })), false)
      assert.equal(autorizado(req({ [CABECERA_HUB]: 'x'.repeat(64) })), true)
    } finally {
      if (antes.u === undefined) delete process.env.MASTRO_USUARIO; else process.env.MASTRO_USUARIO = antes.u
      if (antes.t === undefined) delete process.env.MASTRO_HUB_TOKEN; else process.env.MASTRO_HUB_TOKEN = antes.t
    }
  })
})

describe('la puerta, de punta a punta (con un Deprocast de usuario de verdad)', () => {
  const datos = tmp()
  const puerta = crearPuerta({ datos })
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (await puerta.atender(req, res, url)) return
    res.writeHead(200, { 'content-type': 'text/plain' }).end('DUENO')
  })
  after(async () => {
    await puerta.hub.pararTodos()
    srv.close()
    puerta.cuentas().close()
    try { fs.rmSync(datos, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch { /* Windows suelta los archivos tarde: queda en temp */ }
  })

  const pedir = (ruta: string, o: { metodo?: string; cookie?: string; cuerpo?: string; accept?: string } = {}) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((ok, mal) => {
    const { port } = srv.address() as { port: number }
    const r = http.request({ host: '127.0.0.1', port, path: ruta, method: o.metodo ?? 'GET', headers: { ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.cuerpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(o.accept ? { accept: o.accept } : {}) } }, (x) => {
      let b = ''
      x.on('data', (c) => (b += c))
      x.on('end', () => ok({ status: x.statusCode ?? 0, headers: x.headers, body: b }))
    })
    r.on('error', mal)
    r.end(o.cuerpo)
  })

  it('sin cookie de usuario, el dueño sigue igual; con invitación se crea la cuenta y todo va a SU base', { timeout: 120_000 }, async () => {
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok))
    assert.equal((await pedir('/api/estado')).body, 'DUENO')

    const inv = crearInvitacion(puerta.cuentas(), {})
    assert.equal((await pedir(`/alta?codigo=${inv.codigo}`)).status, 200)
    const a = await pedir('/alta', { metodo: 'POST', cuerpo: new URLSearchParams({ codigo: inv.codigo, nombre: 'Dana', email: 'dana@ejemplo.com', clave: 'una clave larga' }).toString() })
    assert.equal(a.status, 303)
    const cookie = String(a.headers['set-cookie']).split(';')[0]
    assert.match(cookie, /^deprocast=/)

    // Su Deprocast arranca y contesta (su propia base, en su carpeta).
    await puerta.hub.asegurar(1)
    const v = await pedir('/version', { cookie })
    assert.equal(v.status, 200)
    assert.ok(JSON.parse(v.body).web)
    const e = await pedir('/api/meta', { cookie })
    assert.equal(e.status, 200, e.body.slice(0, 200))
    assert.ok(fs.existsSync(path.join(datos, 'usuarios', '1', 'deprocast.db')))

    // Por /u/1 sin su sesión: lo de las apps pide token y lo demás no pasa (sin la cabecera del hub).
    assert.equal((await pedir('/u/1/api/meta')).status, 401)
    assert.equal((await pedir('/u/1/api/dispositivo/hoy')).status, 401)
    assert.equal((await pedir('/u/1/api/meta', { cookie })).status, 200, 'con su sesión, sí')
    assert.equal((await pedir('/u/99/api/meta')).status, 404)

    // La administración: solo el dueño (acá, «esta compu»).
    const adm = await pedir('/usuarios')
    assert.match(adm.body, /dana@ejemplo\.com/)

    // Salir: la cookie ya no vale y vuelve a lo del dueño.
    await pedir('/salir', { cookie })
    const despues = await pedir('/api/estado', { cookie })
    assert.equal(despues.body, 'DUENO')
  })
})

describe('el tope duro de tokens (Deprocast de un usuario)', () => {
  it('con el tope alcanzado, ningún pedido al modelo sale', async () => {
    const { fijarTopeDuro, nanChat, _probar } = await import('../src/nan.ts')
    const { abrir } = await import('../src/db.ts')
    let salieron = 0
    _probar(async () => { salieron++; return { status: 200, body: '{}', json: { choices: [{ message: { content: 'hola' } }], usage: {} } } as never })
    const antes = process.env.NAN_API_KEY
    process.env.NAN_API_KEY = 'prueba'
    fijarTopeDuro(() => 'Llegaste al tope de hoy')
    try {
      const db = abrir(':memory:')
      await assert.rejects(nanChat({ db, clase: 'mastropiero', agenteId: 'mastropiero' }, { mensajes: [{ role: 'user', content: 'hola' }], temperatura: 0, maxTokens: 10, json: false }), /tope de hoy/)
      assert.equal(salieron, 0)
    } finally {
      fijarTopeDuro(() => null)
      if (antes === undefined) delete process.env.NAN_API_KEY; else process.env.NAN_API_KEY = antes
    }
  })
})
