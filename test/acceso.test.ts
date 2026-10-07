import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autorizado, cookieDeEntrada, leerFormulario, validarAcceso } from '../src/acceso.ts'

const pedido = (ip: string, cookie?: string) => ({ socket: { remoteAddress: ip }, headers: cookie ? { cookie } : {} }) as any

test('acceso: local siempre; expuesto pide clave; sin clave no arranca', () => {
  delete process.env.MASTRO_HOST
  assert.equal(validarAcceso(), null)
  assert.ok(autorizado(pedido('100.64.0.2')), 'sin exponer, no hay clave que pedir')
  process.env.MASTRO_HOST = '0.0.0.0'
  delete process.env.MASTRO_CLAVE
  assert.match(validarAcceso()!, /MASTRO_CLAVE/)
  process.env.MASTRO_CLAVE = 'una-clave-larga'
  assert.equal(validarAcceso(), null)
  assert.ok(autorizado(pedido('127.0.0.1')), 'desde esta compu, sin clave')
  assert.ok(!autorizado(pedido('100.64.0.2')), 'desde la red, sin cookie, no')
  assert.equal(cookieDeEntrada('mal'), null)
  const c = cookieDeEntrada('una-clave-larga')!
  assert.ok(autorizado(pedido('100.64.0.2', c.split(';')[0])))
  assert.ok(!autorizado(pedido('100.64.0.2', 'mastro=otra')))
  delete process.env.MASTRO_HOST
  delete process.env.MASTRO_CLAVE
})

test('formularios: urlencoded y multipart (lo que manda «Compartir» del celular)', () => {
  assert.deepEqual(leerFormulario(Buffer.from('clave=a%20b&x=1'), 'application/x-www-form-urlencoded'), { clave: 'a b', x: '1' })
  const b = '----XYZ'
  const cuerpo = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="title"\r\n\r\nUn reel\r\n--${b}\r\nContent-Disposition: form-data; name="url"\r\n\r\nhttps://instagram.com/reel/1\r\n--${b}--\r\n`)
  assert.deepEqual(leerFormulario(cuerpo, `multipart/form-data; boundary=${b}`), { title: 'Un reel', url: 'https://instagram.com/reel/1' })
})
