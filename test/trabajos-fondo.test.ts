import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conPaciencia, estadoTrabajo } from '../src/trabajos.ts'
import { abrir, fijarAjuste } from '../src/db.ts'
import { _probarEsperaGoogle, _probarGoogle, llamarGoogle } from '../src/google/oauth.ts'

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('lo largo, de fondo (Fragua #83): lo rápido contesta igual; lo que pasa la paciencia queda con clave y su resultado se consulta', async () => {
  const rapido = await conPaciencia(Promise.resolve(42), 'POST /api/x', 200)
  assert.deepEqual(rapido, { listo: true, valor: 42 })
  await assert.rejects(conPaciencia(Promise.reject(new Error('mal')), 'POST /api/x', 200), /mal/, 'un error temprano sale como siempre')

  const lento = await conPaciencia(esperar(80).then(() => ({ eventos: 3 })), 'POST /api/tick', 20)
  assert.equal(lento.listo, false)
  const clave = (lento as { clave: string }).clave
  assert.equal(estadoTrabajo(clave).estado, 'andando')
  await esperar(120)
  assert.deepEqual({ ...estadoTrabajo(clave), segundos: 0 }, { estado: 'listo', que: 'POST /api/tick', segundos: 0, resultado: { eventos: 3 } })

  const falla = await conPaciencia(esperar(40).then(() => { throw new Error('se cayó el modelo') }), 'POST /api/radar', 10)
  await esperar(80)
  assert.equal(estadoTrabajo((falla as { clave: string }).clave).error, 'se cayó el modelo')
  assert.equal(estadoTrabajo('t0nada').estado, 'perdido', 'tras un reinicio, la clave no existe y se dice')
})

test('Google sin cupo (Fragua #135): un 403 de cuota o un 429 espera y reintenta, en vez de cortar', async () => {
  const db = abrir(':memory:')
  fijarAjuste(db, 'google_refresh', 'r')
  fijarAjuste(db, 'google_cliente_id', 'id.apps.googleusercontent.com')
  fijarAjuste(db, 'google_cliente_secreto', 'secreto')
  const esperas: number[] = []
  _probarEsperaGoogle(async (ms) => { esperas.push(ms) })
  let i = 0
  _probarGoogle((async (u: string) => {
    if (String(u).includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    i++
    if (i === 1) return new Response(JSON.stringify({ error: { message: "Quota exceeded for quota metric 'Total Query Cost'" } }), { status: 403 })
    if (i === 2) return new Response('', { status: 429, headers: { 'retry-after': '3' } })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch)
  assert.deepEqual(await llamarGoogle(db, 'https://gmail.googleapis.com/x'), { ok: true })
  assert.deepEqual(esperas, [2000, 3000], 'la primera con su espera; la segunda, lo que pidió Google')
})
