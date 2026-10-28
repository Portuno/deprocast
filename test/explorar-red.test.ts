import { test } from 'node:test'
import assert from 'node:assert/strict'

const red = await import('../src/explorar/red.ts')

test('IPs de adentro: loopback, privadas, link-local, metadata de la nube, CGNAT, IPv6 local y mapeadas', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.0.1', '[::1]']) {
    assert.equal(red.ipPrivada(ip), true, ip)
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::6810:84e5']) assert.equal(red.ipPrivada(ip), false, ip)
})

test('chequearDestino: solo http(s) hacia afuera; los nombres que resuelven adentro tampoco', async () => {
  red._probarRed({ resolver: async (h) => (h === 'adentro.ejemplo.com' ? ['10.0.0.5'] : h === 'nada.ejemplo.com' ? [] : ['93.184.216.34']) })
  await assert.rejects(red.chequearDestino('file:///etc/passwd'), /http o https/)
  await assert.rejects(red.chequearDestino('http://localhost:7272/api/estado'), /adentro/)
  await assert.rejects(red.chequearDestino('http://127.0.0.1/'), /adentro/)
  await assert.rejects(red.chequearDestino('http://[::1]:7373/'), /adentro/)
  await assert.rejects(red.chequearDestino('http://169.254.169.254/latest/meta-data/'), /adentro/)
  await assert.rejects(red.chequearDestino('http://impresora.local/'), /adentro/)
  await assert.rejects(red.chequearDestino('https://adentro.ejemplo.com/'), /adentro/)
  await assert.rejects(red.chequearDestino('https://nada.ejemplo.com/'), /adentro/)
  assert.equal((await red.chequearDestino('https://afuera.ejemplo.com/x')).hostname, 'afuera.ejemplo.com')
})

test('pedirSeguro sigue redirecciones a mano y corta si una apunta adentro', async () => {
  const pedidos: string[] = []
  red._probarRed({
    resolver: async (h) => (h === 'adentro.ejemplo.com' ? ['192.168.0.2'] : ['93.184.216.34']),
    transporte: async (url) => {
      pedidos.push(url)
      if (url === 'https://a.ejemplo.com/') return new Response(null, { status: 301, headers: { location: '/b' } })
      if (url === 'https://a.ejemplo.com/b') return new Response('ok', { status: 200 })
      if (url === 'https://trampa.ejemplo.com/') return new Response(null, { status: 302, headers: { location: 'http://adentro.ejemplo.com/admin' } })
      if (url === 'https://bucle.ejemplo.com/') return new Response(null, { status: 302, headers: { location: 'https://bucle.ejemplo.com/' } })
      return new Response('?', { status: 404 })
    },
  })
  const r = await red.pedirSeguro('https://a.ejemplo.com/')
  assert.equal(await r.text(), 'ok')
  assert.deepEqual(pedidos, ['https://a.ejemplo.com/', 'https://a.ejemplo.com/b'])
  await assert.rejects(red.pedirSeguro('https://trampa.ejemplo.com/'), /adentro/)
  assert.ok(!pedidos.includes('http://adentro.ejemplo.com/admin'), 'nunca se pidió lo de adentro')
  await assert.rejects(red.pedirSeguro('https://bucle.ejemplo.com/'), /Demasiadas redirecciones/)
})
