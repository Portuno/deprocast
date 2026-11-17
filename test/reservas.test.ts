import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import * as r from '../src/reservas.ts'
import { agendaDelDia, registrarFuenteDeEventos } from '../src/calendario.ts'

test('Fragua #254 · una reserva: los textos para pedirla, el seguimiento a las 48 h y la confirmada en la agenda', async () => {
  const db = abrir(':memory:')
  const T = new Date('2026-11-17T10:00:00').getTime()
  const x = await r.crearReserva(db, { sitio: 'Casa Prueba', fecha: '2026-11-21', hora: '21:00', personas: 6, telefono: '+34 600 11 22 33', email: 'reservas@casa.test', nota: 'en la terraza' }, T)
  assert.equal(x.estado, 'a_buscar')
  assert.ok(x.entidadId, 'el sitio queda como lugar en el grafo')
  const t = await r.textosDeReserva(db, x.id)
  assert.equal(t.asunto, 'Reserva para 6 personas el sábado 21 de noviembre a las 21:00')
  assert.match(t.cuerpo, /Quería reservar para 6 personas el sábado 21 de noviembre a las 21:00 \(en la terraza\)/)
  assert.match(t.links.mail!, /^mailto:reservas@casa\.test\?subject=Reserva%20para%206/)
  assert.match(t.links.whatsapp!, /^https:\/\/wa\.me\/34600112233\?text=/)
  assert.equal(t.links.llamar, 'tel:+34600112233')
  assert.ok(t.llamada.some((l) => /seña/.test(l)), 'el guion pregunta por la seña')
  assert.throws(() => r.actualizarReserva(db, x.id, { estado: 'rara' as any }), /Estado inválido/)

  // Pedida: a las 48 h sin confirmar, una alerta por día.
  r.actualizarReserva(db, x.id, { estado: 'pedida' }, T)
  assert.equal(r.alertasReservas(db, T + 24 * 3_600_000).length, 0)
  const a = r.alertasReservas(db, T + 49 * 3_600_000)
  assert.equal(a.length, 1)
  assert.match(a[0].texto, /Casa Prueba .* la pediste hace 2 días y no hay confirmación/)
  assert.match((await r.textosDeReserva(db, x.id)).recordatorio, /Les escribí el 17\/11 para reservar/)

  // Confirmada: entra a la agenda (por la fuente registrada) y se avisa el día antes.
  r.actualizarReserva(db, x.id, { estado: 'confirmada', comprobante: 'a nombre de Prueba' }, T + 50 * 3_600_000)
  assert.deepEqual(r.leerReserva(db, x.id)!.historia.map((h) => h.estado), ['a_buscar', 'pedida', 'confirmada'])
  registrarFuenteDeEventos('tus reservas', (f) => r.eventosDeReservas(db, f))
  try {
    const { eventos } = await agendaDelDia('2026-11-21')
    const e = eventos.find((x) => /Casa Prueba/.test(x.titulo))!
    assert.equal(e.titulo, 'Reserva · Casa Prueba · 6 p.')
    assert.equal(e.inicio, new Date('2026-11-21T21:00:00').getTime())
  } finally { registrarFuenteDeEventos('tus reservas', null) }
  assert.match(r.alertasReservas(db, new Date('2026-11-20T10:00:00').getTime())[0].texto, /Mañana: Casa Prueba a las 21:00, 6 personas\. Confirmada \(a nombre de Prueba\)/)
  assert.equal(r.listarReservas(db).length, 1)
  await assert.rejects(r.crearReserva(db, { sitio: '' }), /Falta el sitio/)
})
