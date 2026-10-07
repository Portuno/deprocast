import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fijarAjuste } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCalendario } from '../src/calendario.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { crearConversacion, _probarEscriba } from '../src/chat/index.ts'
import { asignarMision, crearMision } from '../src/misiones.ts'
import { alertasPendientes, pensar } from '../src/alertas.ts'

process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarEscriba(async () => {})
const T = new Date(2026, 9, 7, 11).getTime()
const sinAgenda = async () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'

test('alertas: vencimientos de lo que no viene hablando y lo que otros le deben; una vez por día; nunca en reunión', async () => {
  const db = abrir(':memory:')
  _probarCalendario(sinAgenda)
  crearMision(db, { nivel: 'primaria', titulo: 'Presentar la beca de cine', vence: '2026-10-08', estado: 'activa' }, { ahora: T })
  crearMision(db, { nivel: 'primaria', titulo: 'Entregar el reglamento del juego', vence: '2026-10-07', estado: 'activa' }, { ahora: T })
  crearMision(db, { nivel: 'primaria', titulo: 'Algo para dentro de un mes', vence: '2026-11-07', estado: 'activa' }, { ahora: T })
  asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Gómez' })
  asignarMision(db, { a: 'Ana Gómez', titulo: 'Mandar el presupuesto', vence: '2026-10-05' }, T)
  // Del reglamento viene hablando: esa no se alerta.
  const c = crearConversacion(db, 'mastropiero', 'chat', T)
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'operador', 'hoy cierro el reglamento del juego', ?)`).run(c.id, T - 3_600_000)

  const as = alertasPendientes(db, T)
  assert.equal(as.length, 2)
  assert.match(as[0].texto, /Presentar la beca de cine» vence mañana/)
  assert.match(as[1].texto, /Ana Gómez te debía «Mandar el presupuesto»/)

  fijarAjuste(db, 'pensar_cada_horas', '0')
  assert.equal((await pensar(db, T)).length, 2)
  assert.equal((await pensar(db, T + 60_000)).length, 0, 'una vez por día')

  // En una reunión no interrumpe.
  const db2 = abrir(':memory:')
  crearMision(db2, { nivel: 'primaria', titulo: 'Presentar la beca de cine', vence: '2026-10-07', estado: 'activa' }, { ahora: T })
  _probarCalendario(async () => 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261007T103000\r\nDTEND:20261007T113000\r\nSUMMARY:Reunión de equipo\r\nEND:VEVENT\r\nEND:VCALENDAR')
  assert.equal((await pensar(db2, T)).length, 0)
  _probarCalendario(sinAgenda)
  assert.equal((await pensar(db2, T)).length, 1, 'después de la reunión, sí')
})

test('pensar: una reflexión cada tantas horas, que puede ser nada', async () => {
  const db = abrir(':memory:')
  _probarCalendario(sinAgenda)
  let decir = true
  let llamadas = 0
  _probarModelo(async () => { llamadas++; return { texto: JSON.stringify(decir ? { decir: true, texto: 'Probá mandar el mail antes de que se te vaya la energía.' } : { decir: false }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 } })
  assert.deepEqual(await pensar(db, T), ['Probá mandar el mail antes de que se te vaya la energía.'])
  assert.deepEqual(await pensar(db, T + 3_600_000), [], 'no piensa de nuevo antes de 3 horas')
  decir = false
  assert.deepEqual(await pensar(db, T + 3 * 3_600_000 + 1), [], 'mejor callar que hacer ruido')
  assert.equal(llamadas, 2)
  assert.deepEqual(await pensar(db, new Date(2026, 9, 7, 7).getTime()), [], 'fuera de la jornada, nada')
})
