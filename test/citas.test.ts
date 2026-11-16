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

test('#280: crear un evento siempre se confirma, y una reunión sin hora pregunta la hora una vez', async () => {
  const db = abrir(':memory:')
  const llamar = async (a: Record<string, unknown>) => (await ejecutarHerramienta(HERRAMIENTAS, 'crear_evento_calendario', JSON.stringify(a), { db, conversacionId: null })).resultado as any
  const sinHora = await llamar({ titulo: 'Reunión del Plan de Igualdad', fecha: '2026-11-20' })
  assert.match(sinHora.mensaje, /es una reunión o cita: preguntale a qué hora/)
  const conHoraEnTitulo = await llamar({ titulo: 'Reunión del Plan de Igualdad a las 15:00', fecha: '2026-11-20', lugar: 'Oficina' })
  assert.equal(conHoraEnTitulo.requiere_confirmacion, true)
  assert.match(conHoraEnTitulo.mensaje, /«Reunión del Plan de Igualdad» el .*20.* a las 15:00, 60 min, en Oficina/)
  assert.match((await llamar({ titulo: 'Cumpleaños de Ana', fecha: '20/11' })).error, /YYYY-MM-DD/)
})

test('#280: los eventos repetidos de la Línea van en uno por tema y día, con sus menciones', async () => {
  const { agruparEventos } = await import('../src/linea.ts')
  const titulo = 'Construcción de la técnica de medición de pantalla para Wildianopolis'
  const xs = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, fecha: '2026-11-13', titulo: i % 2 ? titulo.toUpperCase() : `${titulo}.`, hora: i === 4 ? '10:00' : null, lugar: null, piezaId: 100 + (i % 3) }))
  xs.push({ id: 10, fecha: '2026-11-14', titulo, hora: null, lugar: null, piezaId: 200 })
  const g = agruparEventos(xs)
  assert.equal(g.length, 2, 'uno por día')
  assert.equal(g[0].menciones, 9)
  assert.deepEqual(g[0].piezas, [100, 101, 102])
  assert.equal(g[0].hora, '10:00', 'se queda con la hora si alguna la tenía')
})
