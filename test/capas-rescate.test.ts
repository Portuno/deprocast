import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

process.env.TZ = 'Europe/Madrid'
const { abrir } = await import('../src/db.ts')
const capas = await import('../src/capas.ts')
const rs = await import('../src/rescate.ts')
const d = await import('../src/dispositivos.ts')
const { crearMovimiento } = await import('../src/conciencia/movimiento.ts')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rescate-'))
const antes = process.env.MASTRO_DB
before(() => { process.env.MASTRO_DB = path.join(tmp, 'x.db') })
after(() => { process.env.MASTRO_DB = antes; fs.rmSync(tmp, { recursive: true, force: true }) })

const minuto = (h: number, m: number) => new Date(2026, 10, 8, h, m).getTime()
const vincularUno = (db: ReturnType<typeof abrir>, nombre = 'Pixel nuevo') => { const { codigo } = d.crearCodigo(db); return d.vincular(db, { codigo, nombre, plataforma: 'android' }).dispositivo }

test('los pasos salen del acelerómetro (sin podómetro): ~1,8 por segundo durante 6 s', () => {
  const m = crearMovimiento()
  let l = { caminando: false, levantado: false, pasos: 0 }
  for (let t = 0; t < 6000; t += 50) l = m.medir({ t, x: 0.05, y: 0, z: 1 + 0.3 * Math.sin(2 * Math.PI * 1.8 * (t / 1000)) })
  assert.ok(l.caminando)
  assert.ok(l.pasos >= 9 && l.pasos <= 12, `pasos: ${l.pasos}`)
  const q = crearMovimiento()
  for (let t = 0; t < 6000; t += 50) l = q.medir({ t, x: 0, y: 0, z: 1 })
  assert.equal(l.pasos, 0)
})

test('tu día en capas (Fragua #133): la línea, la distancia al micrófono, el recorrido y los consejos concretos', () => {
  const db = abrir(':memory:')
  const disp = vincularUno(db)
  const ms: import('../src/capas.ts').MinutoCapa[] = []
  // A la mañana le dictó de cerca (la referencia de su voz: −20 dB).
  for (let i = 0; i < 5; i++) ms.push({ minuto: minuto(8, i), hablo: 30, escucho: 0, ruido: 0, silencio: 30, vozDb: -20, vozCercaDb: -20, pisoDb: -50 })
  // 20 minutos hablando lejos (−42 dB: unos 1,9 m) con el ambiente encima (piso −45).
  for (let i = 0; i < 20; i++) ms.push({ minuto: minuto(10, i), hablo: 40, escucho: 5, ruido: 10, silencio: 5, vozDb: -42, pisoDb: -45 })
  // Dos horas y media quieto, después una caminata con ubicación.
  for (let i = 0; i < 150; i++) ms.push({ minuto: minuto(12, 0) + i * 60_000, hablo: 0, escucho: 0, ruido: 0, silencio: 60, pisoDb: -55, pasos: 0, caminando: 0 })
  for (let i = 0; i < 10; i++) ms.push({ minuto: minuto(15, i), hablo: 0, escucho: 0, ruido: 20, silencio: 40, pasos: 100, caminando: 55, lat: 39.47 + i * 0.001, lon: -0.37, precision: 12 })
  ms.push({ minuto: minuto(16, 0), hablo: 999, escucho: -3, ruido: 0, silencio: 0, lat: 400, lon: 0 }) // se recorta y la ubicación imposible no entra
  assert.equal(capas.recibirCapas(db, disp.id, ms, minuto(23, 0)).guardados, ms.length)
  assert.equal(capas.recibirCapas(db, disp.id, [ms[0]], minuto(23, 0)).guardados, 1, 'repetir un minuto lo reemplaza')

  const dia = capas.diaEnCapas(db, '2026-11-08', minuto(23, 0))
  assert.equal(dia.referenciaVoz, -20)
  assert.equal(capas.distanciaCm(-42, -20), 189)
  assert.equal(dia.totales.hablo, 26)
  assert.equal(dia.totales.pasos, 1000)
  assert.equal(dia.totales.camino, 10)
  assert.deepEqual(dia.capas.lejos, [{ desde: 600, hasta: 619 }])
  assert.equal(dia.recorrido.length, 10)
  assert.equal(dia.recorrido[0][2], '15:00')
  assert.match(dia.consejos[0], /^Estuviste 2 h 30 quieto de 12:00 a 14:30/)
  assert.match(dia.consejos[1], /^Hablaste 20 minutos seguidos \(10:00–10:20\) lejos del micrófono \(unos 1,9 m\): el ruido se comió la mitad/)
  const prompt = capas.capasParaPrompt(db, '2026-11-08', minuto(23, 0))
  assert.match(prompt, /habló 26 minutos, escuchó .*1\.000 pasos/)
  assert.match(prompt, /Consejos concretos/)
  assert.equal(capas.capasParaPrompt(db, '2026-11-07', minuto(23, 0)), '', 'sin escucha, nada')
})

test('rescate de salvables (Fragua #157): nada se procesa hasta que todo está a salvo; los fallos quedan a salvo para reintentar', async () => {
  const db = abrir(':memory:')
  const disp = vincularUno(db)
  assert.equal(disp.estado, 'rescate')
  assert.equal(disp.tipo, 'telefono')
  const procesados: string[] = []
  rs._probarRescate(async (_db, _d, it, datos) => {
    if (it.tipo === 'nota' && datos.toString() === 'rompe') throw new Error('falló el proceso')
    procesados.push(`${it.tipo}:${datos.toString()}`)
  })
  let e = rs.inventariar(db, disp, [{ clave: 'a1', tipo: 'audio', nombre: 'voz.wav' }, { clave: 'n1', tipo: 'nota', nombre: 'idea.txt' }, { clave: 'x', tipo: 'raro' }, { clave: '' } as any])
  assert.equal(e.total, 3)
  assert.deepEqual(e.faltan.sort(), ['a1', 'n1', 'x'])
  assert.throws(() => rs.cerrarRescate(db, disp), /Faltan 3/)
  await assert.rejects(rs.salvar(db, disp, 'no-esta', Buffer.from('x')), /inventario/)
  await rs.salvar(db, disp, 'a1', Buffer.from('wav'))
  await rs.salvar(db, disp, 'n1', Buffer.from('rompe'))
  await rs.salvar(db, disp, 'x', Buffer.from('bin'))
  // Lo que manda mientras tanto también queda a salvo primero.
  await rs.guardarDuranteRescate(db, disp, 'mensaje', 'mensaje.txt', Buffer.from('hola'), {})
  const item = db.prepare(`SELECT archivo FROM rescate_items WHERE clave = 'a1'`).get() as { archivo: string }
  assert.ok(fs.existsSync(item.archivo) && item.archivo.startsWith(tmp), 'la copia cruda queda en el servidor, al lado de la base')
  assert.deepEqual(procesados, [], 'nada procesado antes de cerrar')

  const r = rs.cerrarRescate(db, disp)
  assert.equal(r.estado, 'activo')
  assert.deepEqual(await r.trabajo, { procesados: 3, errores: 1 })
  assert.deepEqual(procesados.sort(), ['archivo:bin', 'audio:wav', 'mensaje:hola'])
  assert.equal(d.listarDispositivos(db)[0].estado, 'activo')
  e = rs.estadoRescate(db, disp.id)
  assert.equal(e.errores.length, 1)
  assert.match(e.errores[0].error!, /falló el proceso/)
  // Reintentar el que falló (ahora anda).
  db.prepare(`UPDATE rescate_items SET archivo = ? WHERE clave = 'n1'`).run(item.archivo)
  assert.deepEqual(await rs.procesarPendientes(db, disp, Date.now(), true), { procesados: 1, errores: 0 })
  assert.deepEqual(rs.aportes(db, disp.id).sort(), ['rescate: archivo', 'rescate: audio', 'rescate: mensaje', 'rescate: nota'])
  // Sin Drive conectado, la copia del servidor es la única: no se borra.
  assert.equal(rs.limpiar(db), 0)
  assert.ok(fs.existsSync(item.archivo))
})
