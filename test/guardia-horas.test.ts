import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarGuardia, horasSinFecha, verificarHoras } from '../src/chat/guardia-horas.ts'

test('#248: una reunión con hora y sin fecha se detecta; con fecha absoluta, o sin reunión, no', () => {
  assert.deepEqual(horasSinFecha('Hoy la reunión de las 15 es el único ítem al 100%.').map((h) => [h.hora, h.minuto]), [[15, 0]])
  assert.deepEqual(horasSinFecha('Tenés una llamada a las 9:30 con Ramón.').map((h) => [h.hora, h.minuto]), [[9, 30]])
  assert.equal(horasSinFecha('La reunión del Plan de Igualdad del lunes 9/11, 15:00–16:00.').length, 0, 'con su fecha')
  assert.equal(horasSinFecha('La reunión del lunes 9 a las 15.').length, 0)
  assert.equal(horasSinFecha('Son las 15:30 y llevás dos bandas.').length, 0, 'sin reunión no es asunto de la guardia')
  assert.equal(horasSinFecha('Gastaste 15,50 € en la reunión.').length, 0, 'un monto no es una hora')
})

test('#248: si hoy no hay nada a esa hora, el aviso dice cuál es la de verdad y de qué día; si hoy está, no avisa', async () => {
  const db = abrir(':memory:')
  const ahora = new Date(2026, 10, 12, 10, 0).getTime() // jue 12/11
  const dias = (conHoy: boolean) => [
    { fecha: '2026-11-09', dia: 'lun 9/11', resumen: '1 evento', eventos: [{ fecha: '2026-11-09', hora: '15:00–16:00', titulo: 'Plan de Igualdad', lugar: null }], fijo: [] },
    { fecha: '2026-11-12', dia: 'jue 12/11', resumen: conHoy ? '1 evento' : 'sin eventos en la agenda', eventos: conHoy ? [{ fecha: '2026-11-12', hora: '15:00–15:30', titulo: 'Dentista', lugar: null }] : [], fijo: [] },
  ]
  _probarGuardia(async () => dias(false))
  const g = await verificarHoras(db, 'La reunión de las 15 es el único ítem al 100%.', ahora)
  assert.match(g!.aviso, /hoy, jue 12\/11, no hay ninguna reunión a esa hora \(hoy no tiene eventos en la agenda\): la de las 15:00 que tengo es «Plan de Igualdad» del lun 9\/11 \(15:00–16:00\)/)
  _probarGuardia(async () => dias(true))
  assert.equal(await verificarHoras(db, 'La cita de las 15 sigue en pie.', ahora), null, 'hoy está: verificada')
  _probarGuardia(async () => [])
  assert.match((await verificarHoras(db, 'Acordate de la llamada a las 18.', ahora))!.aviso, /no encuentro nada a las 18:00/)
})
