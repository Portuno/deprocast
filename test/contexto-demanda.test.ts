import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { partesMastropiero } from '../src/chat/index.ts'
import { gruposDelMensaje, GRUPOS } from '../src/chat/herramientas.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { guardarRelacion } from '../src/personas.ts'
import { registrarMovimiento } from '../src/finanzas.ts'
import { anotarSideQuest } from '../src/misiones.ts'

test('Fragua #339: el contexto del chat viaja por demanda: lo mínimo siempre, cada bloque con su tema, y dice qué no viajó', () => {
  const db = abrir(':memory:')
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Pérez' })
  const beto = asegurarEntidad(db, { tipo: 'persona', nombre: 'Beto Gómez' })
  guardarRelacion(db, ana, { vinculo: 'amistad', nivel: 10, importancia: 10 })
  guardarRelacion(db, beto, { vinculo: 'trabajo', nivel: 9, importancia: 9 })
  registrarMovimiento(db, { monto: -40, descripcion: 'Super' })
  anotarSideQuest(db, { titulo: 'Devolver el libro' })

  // Sin temas (otros usos del prompt): todo, como antes.
  const todo = partesMastropiero(db, '¿Qué tengo hoy?')
  assert.match(todo.momento, /Su gente/)
  assert.match(todo.momento, /Side quests abiertas:\n- Devolver el libro/)
  assert.match(todo.fijo, /forjar agentes/)

  // Un «¿qué tengo hoy?» sin tema: lo mínimo, y avisa qué se pide con qué grupo.
  const min = partesMastropiero(db, '¿Qué tengo hoy?', null, null, undefined, new Set())
  assert.match(min.momento, /Ahora: .*\nCalendario:/)
  assert.doesNotMatch(min.momento, /Su gente/)
  assert.match(min.momento, /Tiene 1 side quests abiertas \(la lista viaja/)
  assert.match(min.momento, /No viaja en este turno.*la plata del mes.*pedir_herramientas \(plata, salud, gente, misiones, crear, liga\)/)
  assert.doesNotMatch(min.fijo, /forjar agentes/, 'las reglas de la liga viajan con la liga')
  assert.ok(min.fijo.length + min.momento.length < todo.fijo.length + todo.momento.length)

  // Nombra a alguien: viaja esa persona sola, no toda su gente.
  const nombrada = partesMastropiero(db, 'Mañana veo a Ana', null, null, undefined, new Set())
  assert.match(nombrada.momento, /Ana Pérez/)
  assert.doesNotMatch(nombrada.momento, /Beto Gómez/)

  // Con su tema activo, el bloque viaja entero (y deja de figurar como faltante).
  const gente = partesMastropiero(db, '¿cómo está mi gente?', null, null, undefined, new Set(['gente', 'misiones']))
  assert.match(gente.momento, /Ana Pérez[\s\S]*Beto Gómez/)
  assert.match(gente.momento, /Side quests abiertas:\n- Devolver el libro/)
  assert.doesNotMatch(gente.momento, /No viaja en este turno:[^\n]*su gente/)
})

test('Fragua #339: «mi proyecto» trae sus proyectos, no las 52 herramientas de la liga', () => {
  assert.deepEqual(gruposDelMensaje('Contame qué sabés de mi proyecto Huerta Norte'), ['proyectos'])
  assert.ok(gruposDelMensaje('forjá un agente para la liga').includes('liga'))
  assert.ok(gruposDelMensaje('creá una misión para el agente BUS-0001').includes('liga'))
  assert.ok(GRUPOS.proyectos.includes('ver_proyecto') && !GRUPOS.liga.includes('ver_proyecto'))
})
