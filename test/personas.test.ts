import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { aContactar, guardarRelacion, personas, personasParaPrompt } from '../src/personas.ts'
import { alertasPendientes } from '../src/alertas.ts'
import { marcarJugador } from '../src/personajes.ts'

const T = new Date(2026, 9, 20, 10).getTime()

test('personas: relación definida, último contacto deducido del corpus, vencidas y alerta semanal; el jugador no aparece', () => {
  const db = abrir(':memory:')
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Prueba', origenId: 't:ana' })
  const beto = asegurarEntidad(db, { tipo: 'persona', nombre: 'Beto Prueba', origenId: 't:beto' })
  const yo = asegurarEntidad(db, { tipo: 'persona', nombre: 'Jugador Prueba', origenId: 't:yo' })
  asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Un Proyecto', origenId: 't:p' })
  marcarJugador(db, yo)
  insertar(db, { fuente: 'operador', titulo: 'Charla', contenido: 'hablamos', nivel: 'propia', fecha: '2026-10-01', entidades: [ana], origenId: 't:1' })

  assert.deepEqual(personas(db, {}, T).map((p) => p.nombre).sort(), ['Ana Prueba', 'Beto Prueba'])
  assert.equal(personasParaPrompt(db, T), '', 'sin relaciones definidas, nada')

  guardarRelacion(db, ana, { vinculo: 'amistad', cercania: 9, cadaDias: 7, proxima: 'devolverle el libro' }, T)
  const a = personas(db, { id: ana }, T)[0]
  assert.equal(a.cercania, 5, 'cercanía acotada a 5')
  assert.equal(a.ultimoContacto, '2026-10-01')
  assert.equal(a.diasSinContacto, 19)
  assert.ok(a.vencida)
  assert.equal(personas(db, {}, T)[0].nombre, 'Ana Prueba', 'las definidas primero')
  assert.deepEqual(aContactar(db, T).map((p) => p.id), [ana])
  assert.match(personasParaPrompt(db, T), /Ana Prueba \(amistad\): último contacto hace 19 días — quería verla más seguido; próximo: devolverle el libro/)

  const al = alertasPendientes(db, T).filter((x) => x.clave.startsWith('persona:'))
  assert.equal(al.length, 1)
  assert.match(al[0].texto, /Hace 19 días que no sabés de Ana Prueba \(querías cada 7\)\. Tenías pendiente: devolverle el libro\./)

  guardarRelacion(db, ana, { contacto: true }, T)
  assert.equal(aContactar(db, T).length, 0, 'hablaron hoy')
  guardarRelacion(db, ana, { proxima: '' }, T)
  assert.equal(personas(db, { id: ana }, T)[0].proxima, null)
  assert.equal(personas(db, { id: ana }, T)[0].vinculo, 'amistad', 'lo que no viene, queda')
  assert.throws(() => guardarRelacion(db, 999, {}), /No existe/)
  assert.throws(() => guardarRelacion(db, beto + 2, {}), /Solo las personas/)
})
