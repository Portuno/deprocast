import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { abrir } from '../src/db.ts'
import { cerrarEnvio, reservarEnvio, soltarEnvio } from '../src/dispositivos.ts'

test('Mobile 1.0: un envío con clave se procesa una vez; si falla, la clave se libera para el reintento', () => {
  const db = abrir(':memory:')
  assert.deepEqual(reservarEnvio(db, 1, 'voz:a'), { nuevo: true })
  assert.deepEqual(reservarEnvio(db, 1, 'voz:a'), { nuevo: false, respuesta: null }, 'procesándose')
  cerrarEnvio(db, 1, 'voz:a', { texto: 'hola' })
  assert.deepEqual(reservarEnvio(db, 1, 'voz:a'), { nuevo: false, respuesta: { texto: 'hola' } }, 'la respuesta de la primera vez')
  assert.deepEqual(reservarEnvio(db, 2, 'voz:a'), { nuevo: true }, 'por dispositivo')
  assert.deepEqual(reservarEnvio(db, 1, 'voz:b'), { nuevo: true })
  soltarEnvio(db, 1, 'voz:b')
  assert.deepEqual(reservarEnvio(db, 1, 'voz:b'), { nuevo: true }, 'falló: se puede reintentar')
})

const puertoLibre = () => new Promise<number>((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)) }) })

test('Mobile 1.0, por HTTP: la marca de Hoy cambia con un mensaje; un mensaje repetido no sale dos veces; un tramo vacío es 422 (se descarta, no se reintenta)', { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movil-'))
  const puerto = await puertoLibre()
  const env = { ...process.env, MASTRO_CLAVE: '', MASTRO_NUBE: '', MASTRO_REPO: '', NAN_API_KEY: '', TELEGRAM_BOT_TOKEN: '', MASTRO_CARGAS: path.join(dir, 'cargas') }
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/servidor.ts', '--db', path.join(dir, 'x.db'), '--puerto', String(puerto), '--sin-rutinas', '--sin-telegram'], { env, stdio: 'ignore' })
  const base = `http://127.0.0.1:${puerto}`
  try {
    for (let i = 0; i < 100; i++) { if (await fetch(`${base}/version`).then((r) => r.ok, () => false)) break; await new Promise((ok) => setTimeout(ok, 200)) }
    const codigo = (await (await fetch(`${base}/api/dispositivos/codigo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).codigo
    const v = await (await fetch(`${base}/api/dispositivo/vincular`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo, nombre: 'Prueba', plataforma: 'android', tipo: 'telefono' }) })).json()
    assert.match(v.token, /^dpd_/, JSON.stringify(v))
    const h = { authorization: `Bearer ${v.token}` }
    // Recién vinculado está en rescate: se cierra para que el chat reciba.
    await fetch(`${base}/api/dispositivo/rescate/cerrar`, { method: 'POST', headers: h, body: '{}' })

    const m1 = await (await fetch(`${base}/api/dispositivo/cambio`, { headers: h })).json()
    assert.match(m1.marca, /^\d+:\d+:\d+$/)
    assert.ok(Math.abs(m1.servidorEn - Date.now()) < 60_000)
    const mandar = () => fetch(`${base}/api/dispositivo/mensaje`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ texto: 'hola desde el teléfono', id: 'm-1' }) }).then((r) => r.json())
    assert.equal((await mandar()).repetido, undefined)
    assert.equal((await mandar()).repetido, true, 'el reintento no se manda de nuevo')
    let m2 = m1
    for (let i = 0; i < 20 && m2.marca === m1.marca; i++) { await new Promise((ok) => setTimeout(ok, 150)); m2 = await (await fetch(`${base}/api/dispositivo/cambio`, { headers: h })).json() }
    assert.notEqual(m2.marca, m1.marca, 'un mensaje nuevo cambia la marca')
    const hoy = await (await fetch(`${base}/api/dispositivo/hoy`, { headers: h })).json()
    assert.equal(hoy.mensajes.filter((x: any) => x.texto === 'hola desde el teléfono').length, 1)
    assert.ok(hoy.servidorEn && hoy.marca)

    const vacio = await fetch(`${base}/api/dispositivo/voz?id=t-1&modo=dictado`, { method: 'POST', headers: { ...h, 'content-type': 'audio/wav' }, body: new Uint8Array(0) })
    assert.equal(vacio.status, 422, 'no tiene arreglo: el teléfono lo descarta')

    // El recorrido (1.0.1): los puntos del teléfono y el mapa del día.
    const ahora = Date.now()
    const puntos = Array.from({ length: 8 }, (_, i) => ({ en: ahora - (8 - i) * 60_000, lat: 39.4699, lon: -0.3763, precision: 10 }))
    const sub = await (await fetch(`${base}/api/dispositivo/puntos`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ puntos }) })).json()
    assert.equal(sub.guardados, 8)
    const mapa = await (await fetch(`${base}/api/dispositivo/mapa`, { headers: h })).json()
    assert.equal(mapa.puntos.length, 8)
    assert.equal(mapa.paradas.length, 1, '7 minutos en el mismo lugar: una parada')
  } finally {
    srv.kill()
    await new Promise((ok) => setTimeout(ok, 300))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
