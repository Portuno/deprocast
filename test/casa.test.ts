import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
const { abrir, fijarAjuste } = await import('../src/db.ts')
const casa = await import('../src/casa.ts')
const { CLASES } = await import('../src/clases.ts')
const { publicar } = await import('../src/bus.ts')
const { forjar, listar, leer } = await import('../src/roster.ts')
const { purgar } = await import('../src/mastropiero.ts')

const T = new Date(2026, 10, 3, 10).getTime()
const DIA = 86_400_000
const tarea = (db: any, clase: string, estado = 'pendiente', extra = '') => {
  const t = publicar(db, { clase, tipo: 'prueba', payload: { texto: `algo ${extra}` }, publicadaPor: 'operador' }, T)
  if (estado !== 'pendiente') db.prepare('UPDATE tareas SET estado = ? WHERE id = ?').run(estado, t.id)
  return t
}

test('02 Forjador: al menos un agente listo por clase (el ejecutivo con su función), sin repetir; refuerzo si hay cuello de botella', () => {
  const db = abrir(':memory:')
  const f = casa.asegurarClases(db, T)
  assert.deepEqual(f.map((x) => x.clase).sort(), Object.keys(CLASES).sort(), 'uno de cada clase')
  assert.equal(f.find((x) => x.clase === 'ejecutivo')!.motor, 'funcion:bitacora')
  assert.ok(f.every((x) => x.creador === 'mastropiero:02'))
  assert.equal(casa.asegurarClases(db, T).length, 0, 'si ya hay, no forja')
  // Uno en la banca no cuenta como listo.
  const ext = f.find((x) => x.clase === 'extractor')!
  db.prepare(`UPDATE agentes SET estado = 'banca' WHERE id = ?`).run(ext.id)
  assert.deepEqual(casa.asegurarClases(db, T).map((x) => x.clase), ['extractor'])
  // Cuello de botella: muchas pendientes para un solo clasificador.
  for (let i = 0; i < casa.CUELLO + 5; i++) tarea(db, 'clasificador', 'pendiente', String(i))
  assert.deepEqual(casa.asegurarClases(db, T).map((x) => x.clase), ['clasificador'], 'un refuerzo')
  assert.equal(casa.turnos(db).find((t) => t.id === '02')!.vueltas, 4)
})

test('La purga nunca deja una clase sin nadie', () => {
  const db = abrir(':memory:')
  const viejo = forjar(db, { clase: 'auditor', ahora: T - 30 * DIA })
  for (let d = 0; d < 10; d++) db.prepare(`INSERT INTO cronica (tick, tipo, texto, en) VALUES (?, 'corre', 'x', ?)`).run(d + 1, T - d * DIA)
  purgar(db, T)
  assert.ok(leer(db, viejo.id), 'el último auditor queda')
  forjar(db, { clase: 'auditor', ahora: T })
  purgar(db, T)
  assert.equal(leer(db, viejo.id), null, 'con otro auditor listo, el viejo sí se purga')
})

test('01 Despachante: devuelve lo trabado; suelta la espera de a una tanda solo si se puede gastar', () => {
  const db = abrir(':memory:')
  const t = tarea(db, 'extractor', 'asignada')
  db.prepare(`UPDATE tareas SET asignada_a = 'EXT-9999' WHERE id = ?`).run(t.id)
  for (let i = 0; i < 50; i++) db.prepare(`UPDATE tareas SET estado = 'en_espera', pipeline = 'ingesta' WHERE id = ?`).run(tarea(db, 'extractor', 'pendiente', `e${i}`).id)
  const sin = casa.despachar(db, { drenar: false, ahora: T })
  assert.match(sin[0], /devolvió al bus 1 tarea trabada/)
  assert.equal((db.prepare('SELECT estado FROM tareas WHERE id = ?').get(t.id) as any).estado, 'pendiente')
  assert.equal(sin.length, 1, 'sin drenar no suelta')
  const con = casa.despachar(db, { drenar: true, ahora: T })
  assert.match(con[0], new RegExp(`soltó ${casa.TANDA_ESPERA} encargos de la espera`))
  assert.deepEqual(casa.despachar(db, { drenar: true, ahora: T }), [], 'con la cola de ingesta llena, espera')
})

test('03 Meta-analista: cuellos de botella, fallas por clase (propuesta a 📥 una sola vez), una vez por hora', () => {
  const db = abrir(':memory:')
  forjar(db, { clase: 'extractor', ahora: T })
  for (let i = 0; i < 25; i++) tarea(db, 'extractor', 'pendiente', String(i))
  for (let i = 0; i < 8; i++) { const x = tarea(db, 'clasificador', 'fallida', `f${i}`); db.prepare('UPDATE tareas SET error = ?, actualizada_en = ? WHERE id = ?').run('falta "temas"', T, x.id) }
  for (let i = 0; i < 4; i++) { const x = tarea(db, 'clasificador', 'hecha', `h${i}`); db.prepare('UPDATE tareas SET actualizada_en = ? WHERE id = ?').run(T, x.id) }
  const h = casa.metaanalizar(db, T)!
  assert.ok(h.some((x) => /Extractor: 25 pendientes/.test(x.texto)))
  assert.ok(h.some((x) => x.nivel === 'alto' && /Clasificador: falla el 67 %/.test(x.texto)))
  const props = () => db.prepare(`SELECT titulo, detalle FROM propuestas WHERE origen = 'meta'`).all() as any[]
  assert.equal(props().length, 1)
  assert.match(props()[0].detalle, /falta "temas"/)
  assert.equal(casa.metaanalizar(db, T + 10 * 60_000), null, 'una vez por hora')
  casa.metaanalizar(db, T + 2 * 3_600_000)
  assert.equal(props().length, 1, 'no repite la propuesta mientras siga abierta')
})

test('Auto y por qué no avanza: apagado, fuera de la nube, la espera; la vuelta tickea solo cuando toca', async () => {
  const db = abrir(':memory:')
  casa._reiniciarCasa()
  tarea(db, 'buscador')
  let ticks = 0
  const tick = async () => { ticks++ }
  assert.equal(casa.autoPrendido(db), true, 'prendido por defecto')
  assert.match(casa.frenoDeAuto(db, false, T)!, /solo en la nube/)
  const local = await casa.vueltaDeLiga(db, { nube: false, tick, ahora: T })
  assert.deepEqual(local, { casa: true, tick: false })
  assert.ok(listar(db).length >= Object.keys(CLASES).length, 'los de la casa corren igual (el Forjador forjó)')
  assert.deepEqual(await casa.vueltaDeLiga(db, { nube: true, tick, ahora: T + 15_000 }), { casa: false, tick: true })
  assert.equal(ticks, 1)

  fijarAjuste(db, 'liga_auto', '0')
  assert.match(casa.frenoDeAuto(db, true, T)!, /apagado/)
  assert.ok(casa.porQueNoAvanza(db, true, T).some((m) => m.clave === 'auto' && m.accion))
  assert.deepEqual(await casa.vueltaDeLiga(db, { nube: true, tick, ahora: T + 30_000 }), { casa: false, tick: false })

  db.prepare(`UPDATE tareas SET estado = 'en_espera', pipeline = 'ingesta'`).run()
  const m = casa.porQueNoAvanza(db, false, T)
  assert.ok(m.some((x) => x.clave === 'espera' && /no se sueltan solos/.test(x.texto)))
  const vivo = casa.ligaEnVivo(db, false, T)
  assert.equal(vivo.clases.length, Object.keys(CLASES).length)
  assert.equal(vivo.casa.map((c) => c.id).join(','), '01,02,03')
  assert.equal(vivo.totales.en_espera, 1)
})
