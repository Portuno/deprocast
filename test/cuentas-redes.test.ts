import { test } from 'node:test'
import assert from 'node:assert/strict'

// Los tokens se cifran con una clave del servidor: en las pruebas, una del entorno (así no se crea en data/).
process.env.MASTRO_CLAVE_TOKENS = 'clave-de-prueba'

const { abrir } = await import('../src/db.ts')
const { forjar } = await import('../src/roster.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const { _probarRedes } = await import('../src/redes-conectores.ts')
const c = await import('../src/cuentas.ts')
const { estadoSistema } = await import('../src/vigia.ts')
const { ACCIONES } = await import('../src/rutinas.ts')

/** Bluesky de mentira: la sesión y el post; con `caido`, la sesión responde 401. */
function bluesky(o: { caido?: boolean } = {}) {
  const pedidos: { url: string; body: any }[] = []
  _probarRedes((async (url: string, init: RequestInit = {}) => {
    pedidos.push({ url, body: init.body ? JSON.parse(String(init.body)) : null })
    if (url.endsWith('createSession')) return o.caido ? new Response(JSON.stringify({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }), { status: 401 }) : new Response(JSON.stringify({ accessJwt: 'jwt', did: 'did:plc:x', handle: 'prueba.bsky.social' }))
    if (url.endsWith('createRecord')) return new Response(JSON.stringify({ uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }))
    return new Response('{}', { status: 404 })
  }) as typeof fetch)
  return pedidos
}

test('Fragua #224: el token de una cuenta se guarda cifrado y nunca sale (solo sus últimos 4); borrarlo la deja sin token', async () => {
  const db = abrir(':memory:')
  const cu = c.guardarCuenta(db, { red: 'bluesky', usuario: '@prueba', conector: 'bluesky', credencial: { usuario: 'prueba.bsky.social', clave_app: 'abcd-efgh-ijkl-mnop' } })
  const crudo = (db.prepare('SELECT credencial FROM cuentas WHERE id = ?').get(cu.id) as { credencial: string }).credencial
  assert.match(crudo, /^s1:/)
  assert.doesNotMatch(crudo, /mnop|abcd/, 'en la base no queda el token en claro')
  assert.deepEqual(cu.credencial, { cargada: true, pista: '…mnop', legible: true })
  assert.doesNotMatch(JSON.stringify(c.leerAgente(db, cu.id)), /abcd-efgh/, 'la ficha no trae el token')
  assert.doesNotMatch(JSON.stringify(c.listarCuentas(db)), /abcd-efgh/)
  // Cambiar solo la clave no borra el usuario de la credencial.
  c.guardarCuenta(db, { id: cu.id, red: 'bluesky', usuario: '@prueba', conector: 'bluesky', credencial: { clave_app: 'nueva-clave-wxyz' } })
  const pedidos = bluesky()
  await c.verificarCuenta(db, cu.id)
  assert.deepEqual(pedidos[0].body, { identifier: 'prueba.bsky.social', password: 'nueva-clave-wxyz' })
  const sin = c.guardarCuenta(db, { id: cu.id, red: 'bluesky', usuario: '@prueba', conector: 'bluesky', credencial: null })
  assert.deepEqual([sin.credencial.cargada, sin.conectorEstado], [false, 'sin_token'])
  assert.ok(c.CONECTORES.bluesky && c.CONECTORES.mastodon && c.CONECTORES.linkedin && c.CONECTORES.x && c.CONECTORES.facebook_pagina)
})

test('Fragua #224: un agente tiene su cuenta propia, con su nombre y su voz (no la del jugador), en «redacta» por defecto', async () => {
  const db = abrir(':memory:')
  const ag = forjar(db, { clase: 'generativo', instrucciones: 'Hablás de jardinería urbana, con humor.' })
  db.prepare('UPDATE agentes SET nombre = ? WHERE id = ?').run('La Jardinera', ag.id)
  const cu = c.guardarCuenta(db, { red: 'mastodon', usuario: '@jardinera', agente: 'La Jardinera' })
  assert.deepEqual([cu.agenteId, cu.nombre, cu.modo], [ag.id, 'La Jardinera', 'redacta'])
  assert.throws(() => c.guardarCuenta(db, { red: 'mastodon', usuario: '@x', agente: 'Nadie' }), /No existe el agente «Nadie»/)
  let sistema = '', usuario = ''
  _probarModelo(async (_l, o) => { sistema = String((o.mensajes[0] as any).content); usuario = String((o.mensajes[1] as any).content); return { texto: JSON.stringify({ publicaciones: [{ texto: 'Las tomateras en balcón piden sol.', tipo: 'respuesta' }] }), llamadas: [], razonamiento: null, modelo: 'm', tokens: 1 } })
  const [p] = await c.redactarPublicaciones(db, cu.id, { n: 1 })
  assert.match(sistema, /cuenta propia de La Jardinera.*nunca se hace pasar por el jugador/s)
  assert.match(sistema, /jardinería urbana/)
  assert.doesNotMatch(usuario, /Lo que sabés de él/, 'la memoria del jugador no va en la voz del agente')
  assert.equal(p.estado, 'borrador')
})

test('Fragua #224: publicar por la API deja el registro (quién aprobó, quién publicó, desde qué cuenta); un token caído frena, avisa y espera', async () => {
  const db = abrir(':memory:')
  const cu = c.guardarCuenta(db, { red: 'bluesky', usuario: '@prueba', modo: 'redacta', conector: 'bluesky', credencial: { usuario: 'prueba.bsky.social', clave_app: 'abcd-efgh-ijkl-mnop' } })
  const pub = db.prepare(`INSERT INTO publicaciones (cuenta_id, texto, estado, origen, creada_en) VALUES (?, 'Hola desde la prueba', 'borrador', 'mastropiero', ?)`).run(cu.id, Date.now())
  c.resolverPublicacion(db, Number(pub.lastInsertRowid), { accion: 'aprobar', cuando: Date.now() - 1000 })
  const pedidos = bluesky()
  const [hecha] = await c.publicarPendientes(db)
  assert.equal(hecha.estado, 'publicada')
  assert.equal(hecha.url, 'https://bsky.app/profile/prueba.bsky.social/post/abc123')
  assert.deepEqual(pedidos[0].body, { identifier: 'prueba.bsky.social', password: 'abcd-efgh-ijkl-mnop' }, 'el conector usa la credencial abierta')
  assert.equal(c.leerCuenta(db, cu.id)!.conectorEstado, 'ok')
  const [asiento] = c.registro(db)
  assert.deepEqual([asiento.red, asiento.cuenta, asiento.deQuien, asiento.aprobo, asiento.publico], ['Bluesky', '@prueba', 'vos', 'vos', 'Deprocast, por Bluesky (contraseña de aplicación)'])

  // El token deja de andar: la cuenta queda caída, lo aprobado espera (no se pierde), y el vigía lo marca.
  const otra = db.prepare(`INSERT INTO publicaciones (cuenta_id, texto, estado, origen, creada_en, programada_para) VALUES (?, 'Segunda', 'aprobada', 'mastropiero', ?, ?)`).run(cu.id, Date.now(), Date.now() - 1000)
  bluesky({ caido: true })
  await c.publicarPendientes(db)
  const caida = c.leerCuenta(db, cu.id)!
  assert.equal(caida.conectorEstado, 'caido')
  assert.match(caida.conectorError!, /Bluesky 401/)
  assert.equal((db.prepare('SELECT estado FROM publicaciones WHERE id = ?').get(Number(otra.lastInsertRowid)) as any).estado, 'aprobada')
  const pieza = (await estadoSistema(db, { ahora: Date.now() })).piezas.find((x) => x.id === 'redes')!
  assert.equal(pieza.estado, 'mal')
  assert.match(pieza.problemas[0].texto, /bluesky \(@prueba\) se desconectó/)
  const pedidos2 = bluesky()
  await c.publicarPendientes(db)
  assert.equal(pedidos2.length, 0, 'una cuenta caída no vuelve a intentar hasta que se arregle')
})

test('Fragua #224: la revisión diaria avisa solo cuando una cuenta se cae (no todos los días)', async () => {
  const db = abrir(':memory:')
  const cu = c.guardarCuenta(db, { red: 'bluesky', usuario: '@prueba', conector: 'bluesky', credencial: { usuario: 'prueba.bsky.social', clave_app: 'abcd-efgh-ijkl-mnop' } })
  bluesky()
  assert.equal(await ACCIONES.redes(db, '2026-11-19', Date.now()), null, 'anda: nada que decir')
  assert.equal(c.leerCuenta(db, cu.id)!.conectorEstado, 'ok')
  bluesky({ caido: true })
  assert.match((await ACCIONES.redes(db, '2026-11-19', Date.now()))!, /Se desconectó una cuenta de redes[\s\S]*bluesky \(@prueba\)/)
  assert.equal(await ACCIONES.redes(db, '2026-11-20', Date.now()), null, 'sigue caída: ya se avisó')
  // Un error de red (no de credencial) no tumba la cuenta.
  bluesky()
  await c.verificarCuenta(db, cu.id)
  _probarRedes((async () => { throw new Error('fetch failed') }) as typeof fetch)
  assert.equal((await c.verificarCuenta(db, cu.id)).estado, 'ok')
})
