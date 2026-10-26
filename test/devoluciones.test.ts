import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'

const { abrir } = await import('../src/db.ts')
const dv = await import('../src/devoluciones.ts')
const ac = await import('../src/academia.ts')

const T = new Date(2026, 9, 26, 10).getTime()
const pedidos: { sistema: string; usuario: string }[] = []
dv._probarLecciones(async (_db, sistema, usuario) => {
  pedidos.push({ sistema, usuario })
  return { lecciones: [{ texto: 'Usar analogías mecánicas', apoyo: 3 }, { texto: 'Explicaciones cortas', apoyo: 2 }] }
})
ac._probarAcademia({
  nube: () => false,
  alPedirVisual: () => {},
  modelo: async (_db, sistema, usuario) => {
    pedidos.push({ sistema, usuario })
    if (/mapa de conceptos/.test(sistema)) return { conceptos: [{ nombre: 'Carga', nivel: 1 }] }
    if (/no entendí/.test(sistema)) return { texto: 'Otra forma.' }
    return { tema: 'Carga', explicacion: 'E', ejemplos: [], ideas: [], tarjetas: [], visual: null, preguntas: [{ pregunta: 'Q', clave: 'k' }] }
  },
})

test('El feedback: una valoración por cosa, se vuelve lecciones (las corregidas quedan fijas) y entran al prompt', async () => {
  const db = abrir(':memory:')
  dv.anotarDevolucion(db, { superficie: 'clase', ref: 1, valor: -1, nota: 'muy abstracta' }, T)
  dv.anotarDevolucion(db, { superficie: 'clase', ref: 1, valor: 1 }, T + 1)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM devoluciones').get() as any).n, 1, 'la nueva reemplaza a la anterior')
  assert.equal((db.prepare('SELECT nota FROM devoluciones').get() as any).nota, 'muy abstracta', 'sin nota nueva, la nota queda')
  assert.throws(() => dv.anotarDevolucion(db, { superficie: 'cualquiera', ref: 1, valor: 1 }), /No sé valorar/)

  // Con menos de 3 nuevas no se destila nada.
  assert.deepEqual(await dv.destilarLecciones(db, T + 10), {})
  dv.anotarDevolucion(db, { superficie: 'clase', ref: 2, valor: -1, nota: 'preferiría un ejemplo con un motor' }, T + 2)
  dv.anotarDevolucion(db, { superficie: 'clase', ref: 3, valor: 1, nota: 'la analogía del agua, genial' }, T + 3)
  const r = await dv.destilarLecciones(db, T + 10)
  assert.deepEqual(r, { clase: 2 })
  assert.match(pedidos.at(-1)!.usuario, /👎 «preferiría un ejemplo con un motor»/)

  const [l] = dv.leccionesDe(db, 'clase')
  dv.editarLeccion(db, l.id, { texto: 'Siempre un ejemplo con un aparato de la casa' }, T + 20)
  for (const k of [4, 5, 6]) dv.anotarDevolucion(db, { superficie: 'clase', ref: k, valor: 1 }, T + 30 + k)
  await dv.destilarLecciones(db, T + 40)
  assert.match(pedidos.at(-1)!.usuario, /Siempre un ejemplo con un aparato de la casa \(él la escribió: no la cambies\)/)
  const vigentes = dv.leccionesDe(db, 'clase').map((x) => x.texto)
  assert.ok(vigentes.includes('Siempre un ejemplo con un aparato de la casa'), 'la que corrigió se queda')
  assert.equal(vigentes.length, 3)

  // Entran al prompt del tutor.
  const d = ac.sumarDominio(db, { tema: 'Electricidad' }, T)
  await ac.abrirSesionTutor(db, d.id, { ahora: T })
  assert.match(pedidos.at(-1)!.usuario, /Lo que aprendimos de sus devoluciones \(respetalo\):\n- Siempre un ejemplo con un aparato de la casa/)
  dv.editarLeccion(db, l.id, { borrar: true })
  assert.equal(dv.leccionesDe(db, 'clase').length, 2)
})

test('Lo que hace en la Academia ya es feedback: aceptar o descartar, «no entendí», 👍/👎 del material; y la revisión lo junta', async () => {
  const db = abrir(':memory:')
  for (const [tema, est] of [['Drones', 'sugerido'], ['Cocina', 'sugerido'], ['Ajedrez', 'sugerido']]) db.prepare('INSERT INTO aprendizajes (tema, estado, sugerencia, creado_en) VALUES (?, ?, ?, ?)').run(tema, est, JSON.stringify({ porQue: 'x' }), T)
  const [a, b, c] = ac.sugeridosDe(db).sort((x, y) => x.id - y.id)
  await ac.aceptarSugerencia(db, a.id, T)
  ac.descartarSugerencia(db, b.id)
  ac.descartarSugerencia(db, c.id)
  let r = dv.revision(db, T)
  assert.deepEqual([r.sugerencias.aceptadas, r.sugerencias.rechazadas], [1, 2])
  assert.equal(r.porSuperficie.find((x) => x.superficie === 'sugerencia')!.n, 3)

  await ac.armarMapa(db, a.id, T)
  const s = await ac.abrirSesionTutor(db, a.id, { ahora: T })
  await ac.aclarar(db, s.id, -1, T)
  const ex = db.prepare(`SELECT valor, nota FROM devoluciones WHERE superficie = 'explicacion'`).get() as any
  assert.deepEqual([ex.valor, ex.nota], [-1, 'pidió otra explicación (Carga)'])

  const m = await ac.sumarMaterial(db, a.id, { texto: 'Un texto sobre drones con suficiente largo para entrar. '.repeat(3), titulo: 'Apuntes' }, T)
  ac.marcarMaterial(db, a.id, m[0].id, { util: -1 })
  assert.match((db.prepare(`SELECT nota FROM devoluciones WHERE superficie = 'fuente'`).get() as any).nota, /no sirve: Apuntes/)

  dv.anotarDevolucion(db, { superficie: 'chat', ref: 99, valor: 1 }, T)
  dv.anotarDevolucion(db, { superficie: 'chat', ref: 100, valor: -1, nota: 'muy largo' }, T)
  r = dv.revision(db, T)
  assert.deepEqual(r.chat.map((x) => [x.bien, x.mal]), [[1, 1]])
  assert.ok(r.ultimas.some((x) => x.nota === 'muy largo'))
  assert.deepEqual(r.dominios.map((x) => x.tema), ['Drones'])
})

test('Las estrellas de un visual también son feedback (con su plantilla)', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  process.env.MASTRO_TALLER = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-'))
  const { valorarArtefacto } = await import('../src/taller.ts')
  const db = abrir(':memory:')
  const id = Number(db.prepare(`INSERT INTO artefactos (tipo, titulo, pedido, version, archivos, meta, estado, creado_en) VALUES ('visual', 'Ley de Ohm', 'p', 1, '[]', ?, 'listo', 1)`).run(JSON.stringify({ plantilla: 'diagrama', concepto: 'Ley de Ohm' })).lastInsertRowid)
  valorarArtefacto(db, id, 2, 'mucho texto')
  for (let i = 0; i < 20 && !db.prepare(`SELECT 1 FROM devoluciones WHERE superficie = 'visual'`).get(); i++) await new Promise((r) => setTimeout(r, 5))
  const d = db.prepare(`SELECT valor, nota FROM devoluciones WHERE superficie = 'visual'`).get() as any
  assert.deepEqual([d.valor, d.nota], [2, 'plantilla diagrama · Ley de Ohm · mucho texto'])
  assert.deepEqual(dv.revision(db).visuales.map((v) => [v.plantilla, v.estrellas]), [['diagrama', 2]])
})
