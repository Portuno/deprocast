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
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'asistente', 'Dale.', ?)`).run(c.id, T - 3_590_000) // contestado: no es un pedido esperando

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

test('vencidos: un solo bloque por proyecto; sin los de un proyecto en pausa; tres avisos sin respuesta, silencio; nunca en medio de una charla', async () => {
  const db = abrir(':memory:')
  _probarCalendario(sinAgenda)
  fijarAjuste(db, 'pensar_cada_horas', '0')
  const juego = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'El juego' })
  const pausado = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'La app en pausa', meta: { estado: 'pausa' } })
  crearMision(db, { nivel: 'primaria', titulo: 'Cerrar el mapa del tablero', vence: '2026-10-05', estado: 'activa', entidadId: juego }, { ahora: T })
  crearMision(db, { nivel: 'primaria', titulo: 'Probar las cartas nuevas', vence: '2026-10-06', estado: 'activa', entidadId: juego }, { ahora: T })
  crearMision(db, { nivel: 'primaria', titulo: 'Renovar el pasaporte', vence: '2026-10-04', estado: 'activa' }, { ahora: T })
  crearMision(db, { nivel: 'primaria', titulo: 'Grabar el demo de sonido', vence: '2026-10-03', estado: 'activa', entidadId: pausado }, { ahora: T })

  const [a] = alertasPendientes(db, T)
  assert.match(a.texto, /^Tenés 3 cosas vencidas/)
  assert.match(a.texto, /El juego:\n- «Cerrar el mapa del tablero» \(venció el 2026-10-05\)\n- «Probar las cartas nuevas»/)
  assert.doesNotMatch(a.texto, /demo de sonido/, 'el proyecto en pausa no se anuncia')
  assert.equal(a.marcas?.length, 3)

  // Charlando (escribió hace 5 minutos): espera.
  const c = crearConversacion(db, 'mastropiero', 'chat', T)
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'operador', 'otra cosa', ?)`).run(c.id, T - 5 * 60_000)
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'asistente', 'Anotado.', ?)`).run(c.id, T - 4 * 60_000)
  assert.deepEqual(await pensar(db, T), [])
  // Un rato después, el bloque, una sola vez ese día.
  assert.equal((await pensar(db, T + 30 * 60_000)).length, 1)
  assert.equal((await pensar(db, T + 60 * 60_000)).length, 0)
  // Avisado tres días sin que lo toque: silencio.
  assert.equal((await pensar(db, T + 86_400_000)).length, 1)
  assert.equal((await pensar(db, T + 2 * 86_400_000)).length, 1)
  assert.deepEqual(await pensar(db, T + 3 * 86_400_000), [])
})

test('#237: un pedido sin contestar (o que se cortó con un error) hace esperar a los avisos y a las rutinas; contestado, salen', async () => {
  const { charlando, pedidoSinContestar } = await import('../src/alertas.ts')
  const db = abrir(':memory:')
  const c = crearConversacion(db, 'mastropiero', 'chat', T)
  const msj = (rol: string, texto: string, en: number, modelo: string | null = null) => db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, modelo, en) VALUES (?, ?, ?, ?, ?)`).run(c.id, rol, texto, modelo, en)
  msj('operador', 'Armame los 72 en tandas de 6', T - 30 * 60_000)
  msj('error', 'Ningún modelo pudo contestar. deepseek: 504 tiempo agotado', T - 15 * 60_000)
  msj('asistente', 'Tenés 10 cosas vencidas…', T - 10 * 60_000, 'rutina')
  assert.equal(charlando(db, T), true, 'el pedido sigue sin respuesta: un aviso de rutina no cuenta')
  assert.equal(pedidoSinContestar(db, T, 45 * 60_000), true)
  assert.equal(pedidoSinContestar(db, T + 20 * 60_000, 45 * 60_000), false, 'las rutinas esperan como mucho 45 minutos')
  msj('asistente', 'Listo, las 12 tandas en el documento.', T - 5 * 60_000)
  assert.equal(pedidoSinContestar(db, T, 45 * 60_000), false)
})
