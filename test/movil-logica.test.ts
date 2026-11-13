import { test } from 'node:test'
import assert from 'node:assert/strict'

const sincro = await import('../apps/movil/src/logica/sincro.ts')

test('Mobile 1.0 · bloque 1: qué se reintenta y qué se descarta (un ítem roto no traba la cola)', () => {
  assert.equal(sincro.claseDe(null), 'reintentar', 'sin red')
  assert.equal(sincro.claseDe(201), 'ok')
  assert.equal(sincro.claseDe(422), 'descartar', 'un tramo sin voz')
  assert.equal(sincro.claseDe(400), 'descartar')
  assert.equal(sincro.claseDe(503), 'reintentar', 'la transcripción caída')
  assert.equal(sincro.claseDe(429), 'reintentar')
  assert.equal(sincro.claseDe(401), 'sin_sesion')
  assert.deepEqual([1, 2, 3, 6, 9].map(sincro.espera), [5_000, 10_000, 20_000, 120_000, 120_000])
})

test('Mobile 1.0 · bloque 1: una sola sincronización a la vez (dos pedidos simultáneos comparten la misma)', async () => {
  let corridas = 0
  const f = sincro.unaALaVez(async (x: number) => { corridas++; await new Promise((ok) => setTimeout(ok, 20)); return x * 2 })
  const [a, b] = await Promise.all([f(1), f(5)])
  assert.equal(corridas, 1)
  assert.deepEqual([a, b], [2, 2], 'la segunda espera la primera')
  assert.equal(await f(3), 6, 'terminada, la próxima corre de nuevo')
  assert.equal(corridas, 2)
  const g = sincro.unaALaVez(async () => { throw new Error('x') })
  await assert.rejects(g())
  await assert.rejects(g(), 'un error no la deja trabada')
})

test('Mobile 1.0 · bloque 1: lo que llega más viejo no pisa lo nuevo; las claves de envío no se repiten', () => {
  assert.equal(sincro.esMasNuevo(1000, 2000), false)
  assert.equal(sincro.esMasNuevo(2000, 1000), true)
  assert.equal(sincro.esMasNuevo(undefined, 1000), true, 'un servidor viejo sin la marca: como antes')
  const claves = new Set(Array.from({ length: 500 }, () => sincro.claveNueva()))
  assert.equal(claves.size, 500)
})

test('Mobile 1.0 · bloque 1: la sincronización es de la app (no solo de Hoy), Hoy se entera de los cambios y tiene sus estados', async () => {
  const fs = await import('node:fs')
  const app = fs.readFileSync('apps/movil/App.tsx', 'utf8')
  assert.match(app, /useSincronizacion\(/)
  const hoy = fs.readFileSync('apps/movil/src/pantallas/Hoy.tsx', 'utf8')
  assert.match(hoy, /RefreshControl/, 'tirar para actualizar')
  assert.match(hoy, /alCambiar\(/, 'se redibuja cuando termina una sincronización')
  assert.match(hoy, /Cargando…[\s\S]*No pude traer Hoy[\s\S]*Todavía no hay nada hoy/, 'cargando, error y vacío')
  assert.doesNotMatch(hoy, /setInterval\(sync/, 'ya no sincroniza por su cuenta')
  const s = fs.readFileSync('apps/movil/src/sincronizar.ts', 'utf8')
  assert.match(s, /setInterval\(\(\) => \{ if \(activa\) void revisarCambio/, 'la marca cada 5 s con la app abierta')
  assert.match(fs.readFileSync('apps/movil/src/api.ts', 'utf8'), /AbortController/, 'ningún pedido se queda colgado')
})
