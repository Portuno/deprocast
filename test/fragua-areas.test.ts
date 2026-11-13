import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { AREA_IDS, areaDe, areasConCuenta, cambiarArea, reagrupar } from '../src/fragua-areas.ts'
import { HERRAMIENTAS } from '../src/chat/herramientas.ts'

const prop = (db: any, id: number, area: string | null, titulo: string, estado = 'abierta', prioridad = 'media') =>
  db.prepare(`INSERT INTO propuestas (id, titulo, detalle, area, prioridad, estado, creada_en) VALUES (?, ?, ?, ?, ?, ?, 1)`).run(id, titulo, `${titulo}, con detalle.`, area, prioridad, estado)

test('#258: seis categorías fijas; las viejas y «otro» se reparten (las de su lista, a mano), con registro; las descartadas quedan', () => {
  const db = abrir(':memory:')
  assert.deepEqual(AREA_IDS, ['corpus', 'grafo', 'chat', 'liga', 'pantalla', 'vida'])
  prop(db, 249, 'pantalla', 'El promedio de kcal de la semana')
  prop(db, 252, 'otro', 'Traer cuentas enteras de X al corpus (el feed no alcanza)')
  prop(db, 265, 'chat', 'Reintentar telegram ante timeouts')
  prop(db, 264, 'forja', 'Agente de planes de extracción de datos')
  prop(db, 263, 'otro', 'Encuestas y cuotas 29N')
  prop(db, 266, 'otro', 'Arreglar ruta de conciencia acústica en app nativa')
  prop(db, 300, 'otro', 'Algo descartado', 'descartada')
  reagrupar(db)
  const area = (id: number) => (db.prepare('SELECT area FROM propuestas WHERE id = ?').get(id) as any).area
  assert.equal(area(249), 'vida', 'su lista manda')
  assert.equal(area(252), 'corpus', 'su lista manda aunque diga «feed»')
  assert.equal(area(265), 'chat')
  assert.equal(area(264), 'liga')
  assert.equal(area(263), 'vida')
  assert.equal(area(266), 'pantalla')
  assert.equal(area(300), 'otro', 'las descartadas quedan como están')
  assert.deepEqual({ ...(db.prepare('SELECT de, a, por FROM propuestas_areas WHERE propuesta_id = 249').get() as any) }, { de: 'pantalla', a: 'vida', por: 'reagrupación #258' })
  assert.throws(() => cambiarArea(db, 249, 'otro', 'a mano'), /una de las seis/)
  cambiarArea(db, 249, 'pantalla', 'a mano')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM propuestas_areas WHERE propuesta_id = 249').get() as any).n, 2, 'cada cambio, con la anterior')
  prop(db, 301, 'liga', 'Urgente uno', 'abierta', 'alta'); prop(db, 302, 'liga', 'Urgente dos', 'abierta', 'alta')
  const c = areasConCuenta(db)
  assert.equal(c.inicial, 'liga', 'arranca en la que tiene más urgentes')
  assert.equal(c.areas.length, 6)
})

test('#258: proponer_mejora solo registra con una de las seis; si no se sabe dónde va, no la registra', async () => {
  const db = abrir(':memory:')
  const h = HERRAMIENTAS.find((x) => x.nombre === 'proponer_mejora')!
  const mal = await h.ejecutar({ titulo: 'Una cosa vaga', detalle: 'Hacer algo mejor en general.', area: 'otro' }, { db, conversacionId: null } as any)
  assert.match((mal as any).error, /seis categorías/)
  const bien = await h.ejecutar({ titulo: 'Reservas de restaurante', detalle: 'Que arme la reserva y la persiga.', area: 'vida' }, { db, conversacionId: null } as any) as any
  assert.equal((db.prepare('SELECT area FROM propuestas WHERE id = ?').get(bien.propuesta) as any).area, 'vida')
  assert.equal(areaDe('motores'), 'liga')
  assert.equal(areaDe(null, 'el grafo tiene nodos sueltos'), 'grafo')
})
