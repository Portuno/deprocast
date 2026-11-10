import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { anotarRegistro, esRegistro, separar } from '../src/bitacora-dev.ts'

// Lo que él escribió de verdad el 10/11 (suyo) y lo que pegó de la sesión de Claude Code (registro).
const SUYOS = [
  'Ok pero la app de sagunto-paterna-torrent no es algo INTRA deprocast, sino una idea de proyecto aparte. De la que claro, voy a usar Deprocast como herramienta para construirlo.',
  'Bueno igualmente hoy sí hay una reunión, con Luz y Begoña, para ver el tema de los agentes. Así que en esa línea dame una mano preparatoria',
  'ok y con el agente cómo hacemos',
  'Mandé todo lo de la Fragua a Claude, así el sistema va realizando las mejoras',
  'De qué cosas hablamos ayer? algo que me quede interesante para hoy?',
  'Hola?',
  'qué reunión de las 15?',
]
const PEGADOS = [
  'Antes de seguir confirmo si el último commit, el de la Fase 1, alcanzó a entrar: la sesión se cortó a mitad de esa llamada.',
  'No entró: los cambios de la Fase 1 siguen sin commitear (no se perdió nada). Corro las pruebas y los subo.',
  'La Fase 1 ya está en GitHub (7a49776); ahora reviso las 19 propuestas nuevas, de las cuales 13 son #190–#202, antes de darte el reporte.',
  '#202 está a medias: los envíos ya respetan `retry_after`, pero el polling de `getUpdates` aún trata el 429 como fallo. Ahora reviso #190, el corte por cantidad de herramientas.',
  'El chat corta tras 8 vueltas de herramientas, así que cambio ese tope por un presupuesto de 2 millones de tokens por turno (configurable), avisando al modelo al 80 % para que cierre, y si se agota devuelvo lo completado.',
]

test('la bitácora de desarrollo (Fragua #207): lo pegado de Claude Code es registro; lo que él escribe, no', () => {
  for (const t of SUYOS) assert.equal(esRegistro(t), false, `suyo: ${t}`)
  assert.ok(esRegistro('Ya está en GitHub (f3fc96d). Corro `npm test` y reviso src/chat/index.ts antes de subir la Fragua #199.'))
  assert.ok(esRegistro('registro: hoy probamos la conexión con Meta'), 'con «registro:» va siempre')
  // La ráfaga del 10/11 a las 9:15: los cinco pegados juntos son registro (los que tienen pocas señales, por estar al lado
  // de uno claro), y lo suyo que vino después sigue al chat.
  const s = separar([...PEGADOS, 'ok y con el agente cómo hacemos'])
  assert.deepEqual(s.suyo, ['ok y con el agente cómo hacemos'])
  assert.equal(s.registro.length, PEGADOS.length)
  // Solo lo suyo: nada es registro.
  assert.deepEqual(separar(SUYOS).registro, [])
})

test('la bitácora de desarrollo: una pieza por día que crece, con la hora y por dónde llegó', async () => {
  const db = abrir(':memory:')
  const T = new Date('2026-11-10T09:15:00').getTime()
  const id = await anotarRegistro(db, PEGADOS.slice(0, 2), 'WhatsApp', T)
  assert.equal(await anotarRegistro(db, [PEGADOS[2]], 'WhatsApp', T + 60_000), id)
  const p = db.prepare('SELECT titulo, fuente, nivel, contenido FROM corpus WHERE id = ?').get(id) as any
  assert.equal(p.titulo, 'Bitácora de desarrollo · 2026-11-10')
  assert.deepEqual([p.fuente, p.nivel], ['desarrollo', 'generada'], 'no es su voz: es registro generado')
  assert.match(p.contenido, /## 09:15 · WhatsApp[\s\S]*Antes de seguir confirmo[\s\S]*## 09:16 · WhatsApp[\s\S]*7a49776/)
})
