import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fechaLocal } from '../src/db.ts'
import { distanciaKm, guardarPuntos, paradasDe, puntosDelDia, recorridoDelDia } from '../src/recorrido.ts'
import { HERRAMIENTAS } from '../src/chat/herramientas.ts'
import { _probarTelegram, procesarActualizacion } from '../src/telegram.ts'

const T = new Date(2026, 10, 13, 9, 0).getTime()
const MIN = 60_000
// Casa (10 min quieto), una caminata de ~1,1 km, la oficina (30 min quieto).
const casa = { lat: 39.4699, lon: -0.3763 }, oficina = { lat: 39.4799, lon: -0.3763 }
const dia = () => [
  ...Array.from({ length: 11 }, (_, i) => ({ en: T + i * MIN, ...casa })),
  ...Array.from({ length: 5 }, (_, i) => ({ en: T + (11 + i) * MIN, lat: casa.lat + (i + 1) * 0.0017, lon: casa.lon })),
  ...Array.from({ length: 31 }, (_, i) => ({ en: T + (16 + i) * MIN, lat: oficina.lat + (i % 2) * 0.0001, lon: oficina.lon })),
]

test('el recorrido: los puntos se guardan una vez por instante y fuente; del día salen las paradas (5 min en 100 m) y la distancia', () => {
  const db = abrir(':memory:')
  assert.equal(guardarPuntos(db, 'disp:1', dia(), T + 2 * 3_600_000).guardados, 47)
  assert.equal(guardarPuntos(db, 'disp:1', dia(), T + 2 * 3_600_000).guardados, 0, 'reintentar no duplica')
  assert.equal(guardarPuntos(db, 'disp:1', [{ en: T, lat: 300, lon: 0 }, { en: T + 99 * 3_600_000, lat: 1, lon: 1 }], T).guardados, 0, 'lo inválido o del futuro no entra')
  const ps = puntosDelDia(db, fechaLocal(T))
  assert.equal(ps.length, 47)
  const paradas = paradasDe(ps)
  assert.equal(paradas.length, 2)
  assert.deepEqual(paradas.map((p) => p.minutos), [10, 30])
  assert.ok(distanciaKm(ps) > 1 && distanciaKm(ps) < 1.6, String(distanciaKm(ps)))
})

test('el chat lo analiza con ver_recorrido: paradas con hora y minutos, distancia y fuentes; sin datos, lo dice', async () => {
  const db = abrir(':memory:')
  const h = HERRAMIENTAS.find((x) => x.nombre === 'ver_recorrido')!
  const vacio = await h.ejecutar({ fecha: fechaLocal(T) }, { db } as any) as any
  assert.match(vacio.nota, /No hay recorrido de ese día/)
  guardarPuntos(db, 'disp:1', dia(), T + 2 * 3_600_000)
  const r = await h.ejecutar({ fecha: fechaLocal(T) }, { db } as any) as any
  assert.deepEqual(r.paradas.map((p: any) => [p.desde, p.hasta, p.minutos]), [['09:00', '09:10', 10], ['09:16', '09:46', 30]])
  assert.deepEqual(r.fuentes, ['disp:1'])
  assert.match(r.paradas[0].lugar, /sin lugar conocido/)
  const m = await recorridoDelDia(db, fechaLocal(T))
  assert.equal(m.puntos.length, 47)
})

test('Telegram: la ubicación en vivo avisa una vez al empezar y después entra al recorrido en silencio; la fija sigue a la charla', async () => {
  const db = abrir(':memory:')
  const enviados: string[] = []
  _probarTelegram({ pedir: async (metodo: string, cuerpo: any) => { if (metodo === 'sendMessage') enviados.push(cuerpo.text); return { ok: true, result: { message_id: 1 } } } } as any)
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '42'
  const fecha = Math.floor(T / 1000)
  await procesarActualizacion(db, { message: { chat: { id: 42 }, message_id: 5, date: fecha, location: { latitude: casa.lat, longitude: casa.lon, live_period: 3600 } } })
  assert.match(enviados.at(-1)!, /Recibo tu ubicación en vivo por 60 min/)
  const antes = enviados.length
  for (let i = 1; i <= 3; i++) await procesarActualizacion(db, { edited_message: { chat: { id: 42 }, message_id: 5, date: fecha, edit_date: fecha + i * 60, location: { latitude: casa.lat + i * 0.001, longitude: casa.lon, live_period: 3600 } } })
  assert.equal(enviados.length, antes, 'las actualizaciones no hablan')
  const ps = puntosDelDia(db, fechaLocal(T))
  assert.equal(ps.length, 4)
  assert.ok(ps.every((p) => p.fuente === 'telegram'))
})
