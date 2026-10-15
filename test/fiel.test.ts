import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarEscriba, _probarModelo, crearConversacion, enviar, mensajes, promptMastropiero, resolverPropuesta } from '../src/chat/index.ts'
import { _probarCorrecciones, afirmaAccion, pareceCorreccion } from '../src/chat/correcciones.ts'
import { memoriaParaPrompt } from '../src/memoria.ts'
import { calendarioCorto, diaSemana } from '../src/zona.ts'
import { capacidades } from '../src/capacidades.ts'

_probarEscriba(async () => [])
const responde = (texto: string, llamadas: { id: string; nombre: string; argumentos: string }[] = []) => ({ texto, llamadas, razonamiento: null, modelo: 'falso', tokens: 1 })

test('fiel: una corrección suya se anota con su contexto y manda en el prompt de la charla (y lo duradero, en la memoria)', async () => {
  const db = abrir(':memory:')
  assert.ok(pareceCorreccion('La charla es a las 16hs, y no es mía, solo voy de oyente'))
  assert.ok(pareceCorreccion('¿Y de dónde sacaste que mañana tengo reunión?'))
  assert.ok(pareceCorreccion('No, eso fue el viernes pasado'))
  assert.ok(!pareceCorreccion('¿Qué tengo que hacer hoy?'))

  let vioExtractor = ''
  _probarCorrecciones(async (_db, usuario) => {
    vioExtractor = usuario
    return { correcciones: [{ texto: 'La charla del 15/10 sobre IA jurídica es a las 16:00 y él va de oyente.', duradera: false }, { texto: 'Trabaja de lunes a jueves de 8:30 a 17:30 y los viernes hasta las 14:30.', duradera: true }] }
  })
  const vistos: string[] = []
  _probarModelo(async (_l, o) => { vistos.push(String(o.mensajes[0].content)); return responde('Corrijo: a las 16 y de oyente.') })
  const c = crearConversacion(db)
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'asistente', 'La charla de las 14 es tuya.', ?)`).run(c.id, Date.now())
  await enviar(db, c.id, 'La charla es a las 16hs, y no es mía, solo voy de oyente')

  assert.match(vioExtractor, /La charla de las 14 es tuya/, 'lee lo último de la charla para entender qué corrige')
  assert.match(vistos[0], /Correcciones que te hizo en esta charla[\s\S]*a las 16:00 y él va de oyente/, 'el mismo turno ya la obedece')
  assert.ok(vistos[0].indexOf('Correcciones que te hizo') < vistos[0].indexOf('Cómo hablás'), 'va arriba de todo')
  assert.match(memoriaParaPrompt(db, 5).split('\n')[0], /\[correccion\] Trabaja de lunes a jueves/, 'lo duradero entra a la memoria, primero')

  // En el turno siguiente sigue ahí, aunque el mensaje no corrija nada.
  _probarCorrecciones(async () => { throw new Error('no debería llamarse') })
  await enviar(db, c.id, '¿Qué hago hoy?')
  assert.match(vistos.at(-1)!, /a las 16:00 y él va de oyente/)
  assert.doesNotMatch(promptMastropiero(db, '', null, null), /Correcciones que te hizo/, 'otra charla no las hereda (salvo lo duradero, por la memoria)')
})

test('fiel: el calendario y las fechas con su día de la semana', () => {
  assert.equal(diaSemana('2026-10-04'), 'dom 4/10')
  assert.equal(diaSemana('2026-10-09'), 'vie 9/10')
  const cal = calendarioCorto(new Date(2026, 9, 15, 7, 44).getTime())
  assert.match(cal, /mié 14\/10 \(ayer\) · jue 15\/10 \(HOY\) · vie 16\/10 \(mañana\)/)
  const db = abrir(':memory:')
  assert.match(promptMastropiero(db, ''), /Calendario: .*\(HOY\)/)
  assert.match(promptMastropiero(db, ''), /se resuelven contra el día en que se escribieron/)
})

test('fiel: si dice que anotó algo sin haber guardado nada, la charla lo marca', async () => {
  const db = abrir(':memory:')
  _probarCorrecciones(async () => ({ correcciones: [] }))
  const c = crearConversacion(db)
  _probarModelo(async () => responde('Listo, ya te lo dejé anotado con la corrección de las dos horas que hicimos recién.'))
  await enviar(db, c.id, 'El reloj está mal')
  assert.ok(mensajes(db, c.id).some((m) => m.rol === 'evento' && /no se guardó nada/.test(m.texto ?? '')))

  // Si de verdad guardó (una herramienta que escribe), no hay aviso.
  const c2 = crearConversacion(db)
  let n = 0
  _probarModelo(async () => (n++ === 0 ? responde('', [{ id: 'x', nombre: 'anotar_side_quest', argumentos: JSON.stringify({ titulo: 'Comprar pilas' }) }]) : responde('Anotado.')))
  await enviar(db, c2.id, 'Acordate de comprar pilas')
  assert.ok(!mensajes(db, c2.id).some((m) => m.rol === 'evento'))
  assert.ok(afirmaAccion('Lo corregí en tu memoria'))
  assert.ok(!afirmaAccion('¿Querés que lo anote?'))
})

test('fiel: sabe lo que Deprocast puede (por Telegram sí entran notas de voz)', () => {
  const r = capacidades('audio por telegram').map((c) => c.que).join(' ')
  assert.match(r, /nota de voz por Telegram se transcribe/)
  const db = abrir(':memory:')
  assert.match(promptMastropiero(db, ''), /consultá que_puede_deprocast/)
})

test('propuestas: mandarla a La Fragua la deja abierta y al frente', () => {
  const db = abrir(':memory:')
  db.prepare(`INSERT INTO propuestas (titulo, detalle, prioridad, estado, creada_en) VALUES ('x', 'y', 'baja', 'abierta', 1)`).run()
  resolverPropuesta(db, 1, 'aceptada')
  assert.deepEqual({ ...(db.prepare('SELECT estado, prioridad FROM propuestas').get() as object) }, { estado: 'abierta', prioridad: 'alta' })
  resolverPropuesta(db, 1, 'descartada')
  assert.equal((db.prepare('SELECT estado FROM propuestas').get() as any).estado, 'descartada')
})
