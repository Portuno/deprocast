import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarFuente, insertar } from '../src/corpus.ts'
import { crearMision, actualizarMision, sinHoraEnTitulo } from '../src/misiones.ts'
import { _probarGuardia, fechaDeFrase, horasConFecha, verificarHorasConFecha } from '../src/chat/guardia-horas.ts'
import { HERRAMIENTAS, ejecutarHerramienta } from '../src/chat/herramientas.ts'

const AHORA = Date.UTC(2026, 10, 16, 12)

test('#280: la hora sale del título de una misión y queda como mención, no como cita', () => {
  assert.deepEqual(sinHoraEnTitulo('Preparar la reunión del Plan de Igualdad de las 15:00'), { titulo: 'Preparar la reunión del Plan de Igualdad', hora: '15:00' })
  assert.deepEqual(sinHoraEnTitulo('Llamar a Ana a las 9'), { titulo: 'Llamar a Ana', hora: '09:00' })
  assert.deepEqual(sinHoraEnTitulo('Revisar acta (15.30 h)'), { titulo: 'Revisar acta', hora: '15:30' })
  // Lo que no es hora no se toca.
  assert.deepEqual(sinHoraEnTitulo('Leer el capítulo 15 y 3/4 del informe'), { titulo: 'Leer el capítulo 15 y 3/4 del informe', hora: null })
  assert.deepEqual(sinHoraEnTitulo('Estudiar 15 horas esta semana'), { titulo: 'Estudiar 15 horas esta semana', hora: null })

  const db = abrir(':memory:')
  const m = crearMision(db, { titulo: 'Preparar la reunión del Plan de Igualdad de las 15:00', nivel: 'primaria' }, { ahora: AHORA })
  assert.equal(m.titulo, 'Preparar la reunión del Plan de Igualdad')
  assert.match(m.detalle ?? '', /Hora mencionada: 15:00 \(no es una cita/)
  const e = actualizarMision(db, m.id, { titulo: 'Mandar el acta a las 18:30' }, { ahora: AHORA })
  assert.equal(e.titulo, 'Mandar el acta')
  assert.match(e.detalle ?? '', /Hora mencionada: 18:30/)
})

test('#280: una reunión con fecha y hora que el calendario no tiene se avisa (la cita fantasma)', async () => {
  const db = abrir(':memory:')
  assert.equal(fechaDeFrase('la reunión del 13/11 a las 15:00', AHORA), '2026-11-13')
  assert.equal(fechaDeFrase('el 4 de diciembre', AHORA), '2026-12-04')
  assert.equal(fechaDeFrase('el jueves 19', AHORA), '2026-11-19')
  assert.deepEqual(horasConFecha('Tenés la reunión del Plan de Igualdad del 13/11 a las 15:00. Después, nada.', AHORA).map((h) => [h.fecha, h.hora]), [['2026-11-13', 15]])

  const dia = (fecha: string, eventos: { hora: string; titulo: string }[]) => [{ fecha, dia: fecha, resumen: '', eventos: eventos.map((e) => ({ ...e, fecha, lugar: null })), fijo: [] }]
  _probarGuardia(async (_db, desde) => (desde === '2026-11-13' ? dia(desde, [{ hora: '10:00–11:00', titulo: 'Dentista' }]) : dia(desde, [{ hora: '15:00–16:00', titulo: 'Plan de Igualdad' }])))
  const mal = await verificarHorasConFecha(db, 'La reunión del 13/11 a las 15:00 es con RRHH.', AHORA)
  assert.match(mal!.aviso, /no hay nada a las 15:00 en tu calendario \(ese día: 10:00–11:00 Dentista\)/)
  assert.equal(await verificarHorasConFecha(db, 'La reunión del 20/11 a las 15:00 sigue en pie.', AHORA), null, 'la que está en el calendario pasa')
  assert.equal(await verificarHorasConFecha(db, 'Mañana revisás el acta.', AHORA), null)
})

test('#289: el extracto de una búsqueda dice que es solo el comienzo y cuánto mide la pieza', async () => {
  const db = abrir(':memory:')
  asegurarFuente(db, { id: 'capturas', nombre: 'Capturas e imágenes', nivel: 'propia' })
  const largo = `Panel de MetroBús. ${'Parada '.repeat(1200)}`
  const id = insertar(db, { fuente: 'capturas', titulo: 'Imagen · Panel MetroBús', contenido: largo, nivel: 'propia' })!
  const r = await ejecutarHerramienta(HERRAMIENTAS, 'buscar_corpus', JSON.stringify({ consulta: 'MetroBús', fuente: 'capturas' }), { db, conversacionId: null })
  const p = (r.resultado as any).piezas.find((x: any) => x.id === id)
  assert.match(p.extractoDe, new RegExp(`solo el comienzo: la pieza entera tiene ${largo.length.toLocaleString('es-AR')} caracteres \\(leela con leer_pieza ${id}\\)`))
})
