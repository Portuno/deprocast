import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probar, enFondo, nanChat, tokensHoy, topeAlcanzado } from '../src/nan.ts'
import { _probarAutocritica, autocritica, esErrorDeCodigo, materialDeAutocritica, registrarError } from '../src/autocritica.ts'
import { propuestasParaForjar } from '../src/fragua.ts'
import { _probarMatinal, guionMatinal, materialMatinal } from '../src/matinal.ts'
import { _probarDirecto, cerrarDirecto, iniciarDirecto, registrarCuadro, avisoDeCierre } from '../src/directo.ts'
import { evidencia, verificar } from '../src/gemelo.ts'
import { _probarModelo } from '../src/modelo.ts'
import { memoriaVigente } from '../src/memoria.ts'
import { _probarCalendario } from '../src/calendario.ts'

process.env.NAN_API_KEY = 'test'

test('tope: lo que corre solo (liga + rutinas) cuenta; lo que pide él no se frena ni suma', async () => {
  const db = abrir(':memory:')
  _probar(async () => ({ status: 200, body: '', json: { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 600, completion_tokens: 0 } } }))
  const l = { db, clase: 'mastropiero' as const, agenteId: 'x' }
  const o = { mensajes: [{ role: 'user', content: 'hola' }], temperatura: 0, maxTokens: 10, json: false }
  await nanChat(l, o) // él, en el chat
  await enFondo(() => nanChat(l, o)) // una rutina
  const t = tokensHoy(db)
  assert.deepEqual([t.mastropiero, t.fondo, t.liga], [1200, 600, 0])
  db.prepare(`UPDATE ajustes SET valor = '1000' WHERE clave = 'tokens_dia_max'`).run()
  assert.equal(topeAlcanzado(db), null, '600 de fondo: todavía no (lo suyo no cuenta)')
  await enFondo(() => nanChat(l, o))
  assert.match(topeAlcanzado(db)!, /lo que corre solo gastó 1\.200 tokens/)
})

test('autocrítica: anota los errores (uno por texto y día) y los vuelve propuestas para La Fragua, sin repetir', async () => {
  const db = abrir(':memory:')
  const T = Date.now()
  assert.equal(materialDeAutocritica(db, T), '', 'sin nada roto no hay material')
  _probarAutocritica(async () => { throw new Error('no debería preguntar') })
  assert.deepEqual(await autocritica(db, T), [])

  registrarError(db, 'ruta', 'POST /api/directo/:id/propuesta: Ruta desconocida', T)
  registrarError(db, 'ruta', 'POST /api/directo/:id/propuesta: Ruta desconocida', T + 1000)
  db.prepare(`INSERT INTO conversaciones (titulo, con, creada_en, actualizada_en) VALUES ('x', 'mastropiero', ?, ?)`).run(T, T)
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (1, 'operador', 'el directo cuando doy aceptar me tira ruta desconocida y no funciona', ?)`).run(T)
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (1, 'operador', 'buenísimo, gracias', ?)`).run(T)
  db.prepare(`INSERT INTO propuestas (titulo, detalle, estado, creada_en) VALUES ('Listas numeradas', 'x', 'abierta', ?)`).run(T)
  const m = materialDeAutocritica(db, T + 2000)
  assert.match(m, /\[ruta ×2\] POST \/api\/directo\/:id\/propuesta: Ruta desconocida/)
  assert.match(m, /me tira ruta desconocida/)
  assert.doesNotMatch(m, /buenísimo/, 'solo las quejas')

  let vio = ''
  _probarAutocritica(async (_db, u) => {
    vio = u
    return { propuestas: [
      { titulo: 'Ruta para aceptar propuestas del Directo', detalle: 'El botón llama a POST /api/directo/:id/propuesta y no existe: agregarla.', area: 'pantalla', prioridad: 'alta' },
      { titulo: 'listas numeradas', detalle: 'Repetida: ya existe con otro nombre en mayúsculas y todo eso.', area: 'chat' },
      { titulo: 'x', detalle: 'muy corta' },
    ] }
  })
  const ps = await autocritica(db, T + 3000)
  assert.match(vio, /YA EXISTEN[\s\S]*Listas numeradas/)
  assert.deepEqual(ps.map((p) => p.titulo), ['Ruta para aceptar propuestas del Directo'])
  const fila = db.prepare('SELECT origen, prioridad, estado FROM propuestas WHERE id = ?').get(ps[0].id) as any
  assert.deepEqual({ ...fila }, { origen: 'autocritica', prioridad: 'alta', estado: 'abierta' })
  // Y La Fragua la toma primero esa noche (alta antes que media).
  assert.equal(propuestasParaForjar(db, 1)[0].id, ps[0].id)

  assert.ok(esErrorDeCodigo(new TypeError("Cannot read properties of undefined (reading 'id')")))
  assert.ok(!esErrorDeCodigo(new Error('Acción inválida')), 'un error del operador no es un bug')
})

test('fragua de noche: no vuelve a forjar lo que ya tiene forja; reintenta lo que falló una vez', () => {
  const db = abrir(':memory:')
  const alta = db.prepare(`INSERT INTO propuestas (titulo, detalle, estado, prioridad, creada_en) VALUES (?, 'x', 'abierta', 'media', 1)`)
  for (const t of ['lista', 'falló una vez', 'falló dos veces', 'nueva']) alta.run(t)
  const forja = db.prepare(`INSERT INTO fragua (propuesta_id, pedido, rama, estado, creada_en) VALUES (?, 'x', '', ?, 1)`)
  forja.run(1, 'lista')
  forja.run(2, 'fallo')
  forja.run(3, 'fallo')
  forja.run(3, 'fallo')
  assert.deepEqual(propuestasParaForjar(db, 10).map((p) => p.titulo), ['falló una vez', 'nueva'])
})

test('Directo: las ideas y lo que miró entran solas (sin revisar); tareas y personas esperan', async () => {
  const db = abrir(':memory:')
  const T = new Date(2026, 9, 7, 10).getTime()
  _probarDirecto({ vision: async () => ({ app: 'YouTube', actividad: 'mirando video', tema: 'juegos', detalle: 'Diseño de juegos', nota: '' }), transcribir: async () => '' })
  const s = iniciarDirecto(db, ['pantalla'], T)
  await registrarCuadro(db, s.id, Buffer.from('c'), 'image/jpeg', T)
  _probarModelo(async () => ({ texto: JSON.stringify({
    texto: 'Miró un video.', ideas: ['La mecánica va primero'], tareas: ['Llamar a Ana'], cumplidas: [], bandas: [], conexiones: [],
    entidades: [{ nombre: 'Ana', tipo: 'persona', nota: '' }], consumido: [{ titulo: 'Diseño de juegos', tipo: 'Video', resumen: 'Mecánicas', relacion: null }],
  }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }))
  const c = await cerrarDirecto(db, s.id, { ahora: T + 20 * 60_000, escriba: false })
  const ps = (c.resumen as any).propuestas as { tipo: string; estado: string; sola?: boolean }[]
  assert.deepEqual(ps.map((p) => [p.tipo, p.estado, !!p.sola]), [['tarea', 'pendiente', false], ['entidad', 'pendiente', false], ['idea', 'aceptada', true], ['medio', 'aceptada', true]])
  assert.ok(memoriaVigente(db).some((m) => m.texto === 'La mecánica va primero' && !m.revisada), 'entra a la memoria para revisar')
  assert.match(avisoDeCierre(c), /2 ideas y cosas que miraste entraron solas/)
})

test('gemelo: los minutos que vio el Directo se califican solos', async () => {
  const db = abrir(':memory:')
  const T = new Date(2026, 9, 7, 10).getTime()
  const vistas = [{ app: 'VS Code', actividad: 'programando', tema: 'x', detalle: 'a.ts', nota: '' }, { app: 'YouTube', actividad: 'mirando video', tema: 'y', detalle: 'v', nota: '' }]
  _probarDirecto({ vision: async () => vistas.shift(), transcribir: async () => '' })
  const s = iniciarDirecto(db, ['pantalla'], T)
  await registrarCuadro(db, s.id, Buffer.from('c'), 'image/jpeg', T)
  await registrarCuadro(db, s.id, Buffer.from('c'), 'image/jpeg', T + 90 * 60_000)
  const ev = evidencia(db, '2026-10-07')
  assert.equal(ev.minutos?.porActividad.programando, 90)
  assert.equal(verificar({ tipo: 'directo_minutos', que: 'programando', op: '>=', valor: 60 }, ev), 1)
  assert.equal(verificar({ tipo: 'directo_minutos', que: 'YouTube', op: '<=', valor: 10 }, ev), 1)
  assert.equal(verificar({ tipo: 'directo_minutos', que: 'vs code', op: '<=', valor: 30 }, ev), 0)
  assert.equal(verificar({ tipo: 'directo_minutos', que: 'programando', op: '>=', valor: 60 }, evidencia(db, '2026-10-08')), null, 'sin Directo no se puede decir')
})

test('audio de la mañana: el guion sale de lo que pasó ayer y lo que toca hoy, sin markdown', async () => {
  const db = abrir(':memory:')
  _probarCalendario(async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR')
  db.prepare(`INSERT INTO fragua (propuesta_id, pedido, rama, estado, creada_en) VALUES (NULL, 'Que las listas numeren bien\ndetalle', 'fragua/1', 'lista', 1)`).run()
  const m = await materialMatinal(db, '2026-10-08', new Date(2026, 9, 8, 7, 50).getTime())
  assert.match(m, /Hoy es jueves, 8 de octubre/)
  assert.match(m, /Ayer no hubo run/)
  assert.match(m, /La Fragua dejó 1 mejora lista para aplicar: Que las listas numeren bien/)
  let vio = ''
  _probarMatinal(async (_db, u) => { vio = u; return { guion: '**Buen día.** Ayer no hubo run, pero la Fragua te dejó lista la mejora de las listas numeradas. Hoy la agenda está libre. ¿Qué querés empujar primero?' } })
  const g = await guionMatinal(db, '2026-10-08', new Date(2026, 9, 8, 7, 50).getTime())
  assert.equal(vio, m)
  assert.ok(g.startsWith('Buen día.'), 'sin markdown: es para escuchar')
  _probarMatinal(async () => ({ guion: '' }))
  await assert.rejects(guionMatinal(db, '2026-10-08'), /vacío/)
})
