import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCalendario } from '../src/calendario.ts'
import { _probarEscriba, promptMastropiero } from '../src/chat/index.ts'
import { HERRAMIENTAS } from '../src/chat/herramientas.ts'
import { bloquesDelDia, fijarHorario, horarioComoTexto, horarioDeTexto, horarioParaPrompt, leerHorario } from '../src/horario.ts'
import { prepararRun } from '../src/misiones.ts'
import { verDia } from '../src/dia.ts'
import { anotarUso, verUso } from '../src/uso.ts'

process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarEscriba(async () => [])
const ICS = (cuerpo: string) => `BEGIN:VCALENDAR\r\n${cuerpo}\r\nEND:VCALENDAR`
const TRABAJO = 'L-J 08:30-17:30 Trabajo; V 08:30-14:30 Trabajo'

test('horario fijo: se escribe en palabras, arranca vacío y dice las ventanas libres de cada día', () => {
  const db = abrir(':memory:')
  assert.deepEqual(leerHorario(db), [], 'sistema en blanco: sin horario hasta que él lo cargue')
  assert.equal(horarioParaPrompt(db, '2026-10-15'), '')
  const bs = horarioDeTexto(TRABAJO)
  assert.deepEqual(bs, [{ dias: [1, 2, 3, 4], desde: '08:30', hasta: '17:30', que: 'Trabajo' }, { dias: [5], desde: '08:30', hasta: '14:30', que: 'Trabajo' }])
  fijarHorario(db, bs)
  assert.equal(horarioComoTexto(leerHorario(db)), TRABAJO)
  assert.match(horarioParaPrompt(db, '2026-10-15'), /Trabajo 08:30–17:30\. Ventanas libres: antes de las 08:30, después de las 17:30/)
  assert.match(horarioParaPrompt(db, '2026-10-16'), /Trabajo 08:30–14:30.*después de las 14:30/)
  assert.match(horarioParaPrompt(db, '2026-10-17'), /no tiene nada fijo/)
  assert.deepEqual(bloquesDelDia(db, '2026-10-18'), [])
  assert.throws(() => fijarHorario(db, [{ dias: [1], desde: '18:00', hasta: '09:00' }]), /HH:MM/)
  assert.throws(() => horarioDeTexto('lunes temprano'), /No entiendo/)
  assert.match(promptMastropiero(db, ''), /Ventanas libres|nada fijo/)
})

test('horario fijo: la run no pone bandas adentro del trabajo; ver_dia lo trae con su fuente', async () => {
  const db = abrir(':memory:')
  fijarHorario(db, horarioDeTexto('L-V 09:00-11:00 Trabajo'))
  _probarCalendario(async () => ICS('BEGIN:VEVENT\r\nDTSTART;TZID=Europe/Madrid:20261007T160000\r\nDTEND;TZID=Europe/Madrid:20261007T170000\r\nSUMMARY:Charla IA jurídica\r\nEND:VEVENT'))
  _probarModelo(async (_l, o) => {
    const sistema = String(o.mensajes[0].content)
    const datos = sistema.includes('armás una run')
      ? { resumen: 'Mañana.', misiones: Array.from({ length: 20 }, (_, i) => ({ titulo: `Tarea ${i + 1}`, detalle: 'paso', minutos: 15, primaria: null, categoria: 'escritura' })) }
      : sistema.includes('interpretás el pedido de una run') ? { duracion: 300 } : null
    return { texto: datos ? JSON.stringify(datos) : 'ok', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  const { run, misiones } = await prepararRun(db, { inicio: '08:00', fin: '13:00' }, { ahora: new Date(2026, 9, 7, 7, 30).getTime() })
  assert.ok(run.fijos.some((f) => f.titulo === 'Trabajo' && f.inicio === '09:00' && f.fin === '11:00'))
  assert.ok(misiones.length > 0)
  assert.ok(misiones.every((m) => m.fin! <= '09:00' || m.inicio! >= '11:00'), 'ninguna banda adentro del trabajo')

  const d = await verDia(db, '2026-10-07')
  assert.equal(d.dia, 'mié 7/10')
  assert.deepEqual(d.fijo.map((f) => [f.que, f.fuente]), [['Trabajo', 'su horario fijo']])
  assert.deepEqual(d.agenda.map((e) => [e.hora, e.titulo, e.fuente]), [['16:00–17:00', 'Charla IA jurídica', 'su calendario']])
  assert.match(d.nota, /no lo afirmes/)
  _probarCalendario(async () => ICS(''))
})

test('uso: vistas, herramientas y el rastro de cada módulo, para rankear con datos', () => {
  const db = abrir(':memory:')
  for (const v of ['hoy', 'hoy', 'chat', 'corpus', 'hoy']) anotarUso(db, 'vista', v)
  anotarUso(db, 'herramienta', 'ver_dia')
  anotarUso(db, 'vista', 'algo raro con espacios') // no se anota
  db.prepare(`INSERT INTO salud (fecha, tipo, titulo, creado_en) VALUES ('2026-10-15', 'comida', 'Milanesa', ?)`).run(Date.now())
  const u = verUso(db, 30)
  assert.deepEqual(u.vistas.map((v) => [v.nombre, v.veces]), [['hoy', 3], ['chat', 1], ['corpus', 1]])
  assert.equal(u.herramientas[0].nombre, 'ver_dia')
  assert.equal(u.rastro.find((r) => r.modulo.startsWith('Salud'))!.cosas, 1)
  for (const n of ['ver_dia', 'ver_agenda', 'fijar_horario', 'ver_uso', 'que_puede_deprocast']) assert.ok(HERRAMIENTAS.some((h) => h.nombre === n), n)
})
