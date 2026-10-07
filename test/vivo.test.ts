import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fechaLocal } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { archivar, corregir, escribaDeMemoria, memoriaParaPrompt, memoriaVigente, recordar } from '../src/memoria.ts'
import { eventosDelDia, _probarCalendario } from '../src/calendario.ts'
import { leerJornada } from '../src/jornada.ts'
import { correrRutinas, pendientes } from '../src/rutinas.ts'
import { _probarEscriba, conversacionHoy, crearConversacion, enviar, mensajes } from '../src/chat/index.ts'
import { listarPiezas } from '../src/corpus.ts'

process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarEscriba(async () => {})

type Vista = { sistema: string; usuario: string; herramientas: number }
/** Modelo falso que contesta según quién pregunta (escriba, jornada o chat). */
function modelo(respuestas: { escriba?: unknown; jornada?: unknown; chat?: string }) {
  const vistos: Vista[] = []
  _probarModelo(async (_l, o) => {
    const sistema = String(o.mensajes[0].content)
    const usuario = String(o.mensajes.at(-1)!.content)
    vistos.push({ sistema, usuario, herramientas: (o.herramientas as unknown[]).length })
    const datos = sistema.includes('escriba de memoria') ? respuestas.escriba : sistema.includes('armás la jornada') ? respuestas.jornada : null
    return { texto: datos ? JSON.stringify(datos) : respuestas.chat ?? 'ok', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  return vistos
}

const ICS = (cuerpo: string) => `BEGIN:VCALENDAR\r\n${cuerpo}\r\nEND:VCALENDAR`

test('memoria: no duplica, corregir deja versión, archivar la saca', () => {
  const db = abrir(':memory:')
  const a = recordar(db, { texto: 'Prefiere trabajar en series de 12 minutos', tipo: 'preferencia' })
  assert.equal(recordar(db, { texto: 'prefiere trabajar en series de 12 minutos.', tipo: 'preferencia' }).id, a.id)
  const meta = recordar(db, { texto: 'Quiere ser mega millonario en un año', tipo: 'meta', horizonte: 'castillo' })
  const b = corregir(db, a.id, { texto: 'Prefiere series de 25 minutos a la tarde' })
  assert.equal(b.reemplaza, a.id)
  assert.deepEqual(memoriaVigente(db).map((r) => r.id).sort(), [meta.id, b.id].sort())
  assert.match(memoriaParaPrompt(db).split('\n')[0], /\[meta · castillo\]/, 'metas primero')
  archivar(db, meta.id)
  assert.equal(memoriaVigente(db).length, 1)
})

test('el escriba guarda lo que dice el operador y falla en silencio', async () => {
  const db = abrir(':memory:')
  const vistos = modelo({ escriba: { recuerdos: [{ texto: 'Quiere aprender ruso', tipo: 'meta', horizonte: 'campamento' }, { texto: '' }] } })
  const nuevos = await escribaDeMemoria(db, 'Che, este año quiero aprender ruso en serio.', 7)
  assert.equal(nuevos.length, 1)
  assert.equal(nuevos[0].creadaPor, 'escriba')
  assert.equal(nuevos[0].origen, 7)
  assert.match(vistos[0].usuario, /aprender ruso en serio/)
  assert.deepEqual(await escribaDeMemoria(db, 'ok', 7), [], 'lo corto no se lee')
  _probarModelo(async () => { throw new Error('caído') })
  assert.deepEqual(await escribaDeMemoria(db, 'Un mensaje largo cualquiera para recordar', 7), [])
})

test('calendario: UTC, TZID, día entero, repeticiones, excepciones y cancelados', () => {
  const ics = ICS([
    'BEGIN:VEVENT\r\nDTSTART:20261007T080000Z\r\nDTEND:20261007T090000Z\r\nSUMMARY:Reunión UTC\r\nEND:VEVENT',
    'BEGIN:VEVENT\r\nDTSTART;TZID=Europe/Madrid:20261007T183000\r\nDTEND;TZID=Europe/Madrid:20261007T193000\r\nSUMMARY:Gym\\, piernas\r\nEND:VEVENT',
    'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261007\r\nDTEND;VALUE=DATE:20261008\r\nSUMMARY:Feriado\r\nEND:VEVENT',
    'BEGIN:VEVENT\r\nDTSTART;TZID=Europe/Madrid:20260930T100000\r\nDTEND;TZID=Europe/Madrid:20260930T101500\r\nRRULE:FREQ=WEEKLY;BYDAY=WE\r\nSUMMARY:Stand-up\r\nEND:VEVENT',
    'BEGIN:VEVENT\r\nDTSTART:20261001T120000Z\r\nDTEND:20261001T123000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Solo tres días\r\nEND:VEVENT',
    'BEGIN:VEVENT\r\nDTSTART:20261007T150000Z\r\nDTEND:20261007T160000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelado\r\nEND:VEVENT',
    'BEGIN:VEVENT\r\nDTSTART;TZID=Europe/Madrid:20260923T090000\r\nDTEND;TZID=Europe/Madrid:20260923T093000\r\nRRULE:FREQ=WEEKLY\r\nEXDATE;TZID=Europe/Madrid:20261007T090000\r\nSUMMARY:Exceptuado\r\nEND:VEVENT',
  ].join('\r\n'))
  const ev = eventosDelDia([ics], '2026-10-07')
  const titulos = ev.map((e) => e.titulo)
  assert.deepEqual(titulos.sort(), ['Feriado', 'Gym, piernas', 'Reunión UTC', 'Stand-up'].sort())
  const gym = ev.find((e) => e.titulo.startsWith('Gym'))!
  assert.equal(gym.fin - gym.inicio, 3_600_000)
  assert.ok(ev.find((e) => e.titulo === 'Feriado')!.todoElDia)
  assert.equal(eventosDelDia([ics], '2026-10-03').filter((e) => e.titulo === 'Solo tres días').length, 1)
  assert.equal(eventosDelDia([ics], '2026-10-04').filter((e) => e.titulo === 'Solo tres días').length, 0, 'COUNT=3 corta')
})

test('rutinas: corren una vez por día a su hora y dejan el mensaje en Hoy; el cierre recibe la respuesta', async () => {
  const db = abrir(':memory:')
  _probarCalendario(async () => ICS(''))
  modelo({ chat: 'Gracias por contarme.' })
  const ahora = new Date(2026, 9, 7, 7, 30).getTime()
  assert.equal(pendientes(db, ahora).length, 0, 'antes de las 07:45 nada')
  const nueve = new Date(2026, 9, 7, 9, 0).getTime()
  const r = await correrRutinas(db, nueve)
  assert.deepEqual(r.map((x) => [x.id, x.ok]), [['ayudantes', true], ['jornada', true]])
  assert.equal((await correrRutinas(db, nueve + 60_000)).length, 0, 'una vez por día')
  const hoy = conversacionHoy(db)
  assert.match(mensajes(db, hoy.id).at(-1)!.texto!, /Buen día.*No tenés primarias.*arrancamos una run/)

  const noche = new Date(2026, 9, 7, 22, 45).getTime()
  await correrRutinas(db, noche)
  assert.match(mensajes(db, hoy.id).at(-1)!.texto!, /Cerramos el día/)
  // La respuesta del operador en Hoy queda como cierre (la jornada es la de hoy real, así que se usa la fecha de hoy).
  db.prepare('UPDATE jornadas SET fecha = ? WHERE fecha = ?').run(fechaLocal(), '2026-10-07')
  await enviar(db, hoy.id, 'Fue un día raro pero avancé con la película.')
  assert.equal(leerJornada(db, fechaLocal())!.cierre, 'Fue un día raro pero avancé con la película.')
})

test('diario: lo que cuenta entra al corpus como propio y Mastropiero solo escucha', async () => {
  const db = abrir(':memory:')
  const vistos = modelo({ chat: 'Te escucho.' })
  const c = crearConversacion(db, 'mastropiero', 'diario')
  await enviar(db, c.id, 'Hoy caminé por el río pensando en la escena final.')
  assert.equal(vistos.at(-1)!.herramientas, 0, 'en el diario no opera la plataforma')
  assert.match(vistos.at(-1)!.sistema, /escuchás/)
  const p = listarPiezas(db, { nivel: 'propia' }).piezas[0]
  assert.match(p.titulo, /^Diario/)
  assert.ok(p.etiquetas.includes('diario'))
  assert.throws(() => crearConversacion(db, 'GEN-0001', 'diario'))
})

test('aprender de lo cargado: lee charlas y piezas propias, en paralelo, y cuenta lo nuevo', async () => {
  const { insertar } = await import('../src/corpus.ts')
  const { aprender, fuentesParaAprender } = await import('../src/memoria.ts')
  const db = abrir(':memory:')
  for (let i = 0; i < 6; i++) insertar(db, { fuente: 'operador', titulo: `audio ${i}`, contenido: `Grabación ${i}: `.padEnd(260, 'quiero filmar la escena final en el río y presentarla en festivales '), estado: 'disponible', peso: i })
  insertar(db, { fuente: 'web', titulo: 'tercero', contenido: 'x'.repeat(300), estado: 'disponible' })
  assert.equal(fuentesParaAprender(db, 10).length, 6, 'solo su voz')
  let n = 0
  _probarModelo(async () => ({ texto: JSON.stringify({ recuerdos: [{ texto: `Recuerdo número ${++n} sobre su película`, tipo: 'hecho' }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }))
  const r = await aprender(db, 10)
  assert.deepEqual(r, { hechos: 6, total: 6, nuevos: 6, terminado: true })
  assert.equal(memoriaVigente(db).length, 6)
})
