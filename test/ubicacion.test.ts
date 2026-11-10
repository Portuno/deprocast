import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { anotarSideQuest, leerMision } from '../src/misiones.ts'
import { alDecirSolo } from '../src/chat/index.ts'
import { metros, prenderUbicacion, recibirUbicacion, ubicacionActual, ubicacionParaPrompt } from '../src/ubicacion.ts'
import { recibirCapas } from '../src/capas.ts'

const T = new Date('2026-11-10T18:00:00').getTime()
const MERCADO = { lat: 39.4735, lon: -0.3790 }
const dichos: string[] = []
alDecirSolo((t) => dichos.push(t))

function base() {
  const db = abrir(':memory:')
  // Los lugares ya ubicados (la caché del Mapa): el Mercado Central y el barrio de Benimaclet.
  const geo = db.prepare('INSERT INTO geocache (clave, texto, lat, lon, nombre, buscado_en) VALUES (?, ?, ?, ?, ?, 1)')
  geo.run('mercado central', 'Mercado Central', MERCADO.lat, MERCADO.lon, 'Mercado Central')
  geo.run('benimaclet', 'Benimaclet', 39.4880, -0.3600, 'Benimaclet')
  return db
}

test('ubicación en vivo (Fragua #195): apagada no guarda nada; prendida activa una vez la side quest cercana y avisa', async () => {
  const db = base()
  const sq = anotarSideQuest(db, { titulo: 'Comprar azafrán', disparador: { lugar: 'Mercado Central' }, sugerida: true }, T)
  const lejos = anotarSideQuest(db, { titulo: 'Pasar por la ferretería', disparador: { zona: 'Benimaclet' }, sugerida: true }, T)
  // Apagada (por defecto): nada se registra.
  assert.deepEqual(await recibirUbicacion(db, { lat: MERCADO.lat, lon: MERCADO.lon }, T), { guardada: false, activadas: [] })
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM ubicacion_senales').get() as any).n, 0)
  prenderUbicacion(db, true)
  // A ~150 m del mercado (y a más de 1,5 km de Benimaclet).
  const aqui = { lat: MERCADO.lat + 0.0013, lon: MERCADO.lon }
  assert.ok(metros(aqui, MERCADO) < 300)
  const r = await recibirUbicacion(db, { ...aqui, precision: 20, fuente: 'compu' }, T)
  assert.deepEqual(r.activadas.map((a) => a.titulo), ['Comprar azafrán'])
  assert.equal(leerMision(db, sq.id)!.estado, 'activa')
  assert.equal(leerMision(db, lejos.id)!.estado, 'sugerida')
  assert.match(dichos.at(-1)!, /📍 Estás cerca de Mercado Central \(a \d+ m\): «Comprar azafrán»/)
  // Una sola vez: pasar de nuevo no repite el aviso.
  assert.deepEqual((await recibirUbicacion(db, aqui, T + 60_000)).activadas, [])
  // La zona (1,5 km): en Benimaclet se activa la otra.
  assert.deepEqual((await recibirUbicacion(db, { lat: 39.4875, lon: -0.3610 }, T + 120_000)).activadas.map((a) => a.titulo), ['Pasar por la ferretería'])
})

test('ubicación en vivo: el chat sabe dónde está (el lugar suyo más cercano); vence; apagarla borra todo; el teléfono también la manda', async () => {
  const db = base()
  db.prepare(`INSERT INTO entidades (tipo, nombre, meta, creada_en) VALUES ('lugar', 'Mercado Central', ?, 1)`).run(JSON.stringify(MERCADO))
  prenderUbicacion(db, true)
  await recibirUbicacion(db, { lat: MERCADO.lat + 0.001, lon: MERCADO.lon, fuente: 'compu' }, T)
  assert.match(ubicacionParaPrompt(db, T + 3 * 60_000), /hace 3 min, por compu\): cerca de Mercado Central \(a \d+ m\)/)
  assert.equal(ubicacionActual(db, T + 16 * 60_000), null, 'a los 15 minutos vence')
  prenderUbicacion(db, false)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM ubicacion_senales').get() as any).n, 0, 'apagarla borra lo que había')
  assert.equal(ubicacionParaPrompt(db, T), '')
  // Desde el teléfono: el último minuto con lugar de su día en capas.
  prenderUbicacion(db, true)
  recibirCapas(db, 1, [{ minuto: T, hablo: 0, escucho: 0, ruido: 0, silencio: 60, lat: MERCADO.lat, lon: MERCADO.lon, precision: 15 }], T + 30_000)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(ubicacionActual(db, T + 60_000)!.fuente, 'teléfono')
})
