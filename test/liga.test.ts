import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { publicar, tareas } from '../src/bus.ts'
import { leerPieza } from '../src/corpus.ts'
import { crearProyecto, ingerir, tick } from '../src/mastropiero.ts'
import { bautizar, cambiarEstado, DIA_MS, forjar, lapidas, leer, listar, nivel } from '../src/roster.ts'
import { celda } from '../src/geometria72.ts'
import { nivelDe, umbral } from '../src/xp.ts'

process.env.MASTRO_BITACORA = path.join(os.tmpdir(), `mastro-bitacora-${process.pid}.md`)
const T0 = Date.UTC(2026, 9, 6)

test('la forja respeta las reglas', () => {
  const db = abrir(':memory:')
  assert.throws(() => forjar(db, { clase: 'omnivoro' }), /Mastropiero no se forja/)
  assert.throws(() => forjar(db, { clase: 'generativo', reparto: { potencia: 3, ritmo: 4 } }), /hay 6/)
  assert.throws(() => forjar(db, { clase: 'vectorizador', reparto: { ritmo: 3 } }), /no puede pasar de 6/)
  assert.throws(() => forjar(db, { clase: 'ejecutivo', motor: 'llm' }), /funcion:/)
  assert.throws(() => forjar(db, { clase: 'generativo', celda: 73 }), /fuera de la matriz/)
  const f = forjar(db, { clase: 'generativo', reparto: { potencia: 3, ritmo: 3 }, celda: 36 })
  assert.equal(f.id, 'GEN-0001')
  assert.equal(f.estado, 'prueba')
  assert.equal(f.atributos.potencia, 6)
  assert.equal(forjar(db, { clase: 'generativo' }).id, 'GEN-0002')
})

test('geometría 72 y curva de niveles', () => {
  assert.deepEqual(
    { d: celda(36).dominio, ipo: celda(36).ipo, cma: celda(36).cma },
    { d: 'Memoria', ipo: 'Output', cma: 'Alma' },
  )
  assert.equal(celda(72).dominio, 'Vitalidad')
  assert.equal(nivelDe(0), 1)
  assert.equal(nivelDe(umbral(3)), 3)
  assert.equal(nivelDe(1e9), 6)
})

test('la pipeline de ingesta deja la pieza disponible y el buscador cita', async () => {
  const db = abrir(':memory:')
  const { corpusId } = ingerir(db, { fuente: 'operador', titulo: 'Riego', contenido: 'Regar temprano reduce la evaporación del agua en la huerta.' }, T0)
  for (let i = 0; i < 3; i++) await tick(db, { ahora: T0 + i })
  const pieza = leerPieza(db, corpusId)!
  assert.equal(pieza.estado, 'disponible')
  assert.ok(pieza.etiquetas.length > 0)
  assert.equal(listar(db).length, 3) // extractor, clasificador y vectorizador reclutados

  publicar(db, { clase: 'buscador', payload: { texto: '¿cuándo conviene regar la huerta?' }, publicadaPor: 'operador' }, T0)
  await tick(db, { ahora: T0 + 10 })
  const r = tareas(db, 'hecha').find((t) => t.clase === 'buscador')!
  assert.deepEqual(r.resultado?.citas, [corpusId])
})

test('un recluta que no pasa la prueba se retira', async () => {
  const db = abrir(':memory:')
  for (let i = 0; i < 3; i++) publicar(db, { clase: 'buscador', payload: { texto: 'nada' }, publicadaPor: 'operador' }, T0)
  await tick(db, { ahora: T0 })
  await tick(db, { ahora: T0 + 1, reclutar: false })
  assert.equal(listar(db).length, 0)
  assert.equal(lapidas(db)[0].causa, 'no pasó la prueba')
  assert.equal(tareas(db, 'fallida').length, 3)
})

test('prueba → activo, nivel 3 habilita el nombre, banca por racha', async () => {
  const db = abrir(':memory:')
  const f = forjar(db, { clase: 'generativo', reparto: { ritmo: 5 } }, )
  assert.throws(() => bautizar(db, f.id, 'Escriba'), /nivel 3/)
  for (let i = 0; i < 20; i++) publicar(db, { clase: 'generativo', payload: { texto: `pieza ${i}` }, publicadaPor: 'operador', dominio: 'captura' }, T0)
  for (let i = 0; i < 8; i++) await tick(db, { ahora: T0 + i, reclutar: false })
  const g = leer(db, f.id)!
  assert.equal(g.estado, 'activo')
  assert.equal(nivel(g), 3)
  bautizar(db, f.id, 'Juglar')
  assert.equal(leer(db, 'juglar')!.id, f.id)
  assert.throws(() => cambiarEstado(db, forjar(db, { clase: 'auditor' }).id, 'activo'), /prueba/)

  // Tres fallos seguidos de un activo → banca.
  db.prepare(`UPDATE agentes SET motor = 'funcion:inexistente' WHERE id = ?`).run(f.id)
  for (let i = 0; i < 3; i++) publicar(db, { clase: 'generativo', payload: { texto: 'x' }, publicadaPor: 'operador' }, T0)
  await tick(db, { ahora: T0 + 100, reclutar: false })
  assert.equal(leer(db, f.id)!.estado, 'banca')
})

test('una semana de liga sin correr: retirado, y su nombre no se recicla', async () => {
  const db = abrir(':memory:')
  const f = forjar(db, { clase: 'clasificador', ahora: T0 })
  // Un mes sin prender la liga no mata a nadie: cuentan los días con ticks.
  await tick(db, { ahora: T0 + 30 * DIA_MS })
  assert.ok(leer(db, f.id))
  for (let d = 31; d <= 35; d++) await tick(db, { ahora: T0 + d * DIA_MS })
  assert.ok(leer(db, f.id), 'seis días de liga todavía no alcanzan')
  await tick(db, { ahora: T0 + 36 * DIA_MS })
  assert.equal(leer(db, f.id), null)
  assert.equal(forjar(db, { clase: 'clasificador' }).id, 'CLA-0002')
})

test('ingesta en espera: no se reparte; se reanuda primero lo propio y pesado', async () => {
  const { ingerir } = await import('../src/mastropiero.ts')
  const { pausarIngesta, reanudarIngesta, enEspera } = await import('../src/bus.ts')
  const db = abrir(':memory:')
  ingerir(db, { fuente: 'web', titulo: 'ajeno', contenido: 'texto de otro' })
  const propia = ingerir(db, { fuente: 'operador', titulo: 'mío', contenido: 'texto mío' })
  db.prepare('UPDATE corpus SET peso = 9 WHERE id = ?').run(propia.corpusId)
  assert.equal(pausarIngesta(db), 2)
  await tick(db, { ahora: T0, reclutar: true })
  assert.equal(listar(db).length, 0, 'nadie se recluta para lo que espera')
  assert.equal(reanudarIngesta(db, { limite: 1 }), 1)
  const vuelta = db.prepare(`SELECT corpus_id FROM tareas WHERE estado = 'pendiente'`).get() as { corpus_id: number }
  assert.equal(vuelta.corpus_id, propia.corpusId)
  assert.equal(enEspera(db), 1)
})

test('tope diario de tokens: la liga reparte pero no corre, y nadie falla por eso', async () => {
  const db = abrir(':memory:')
  db.prepare(`UPDATE ajustes SET valor = '100' WHERE clave = 'tokens_dia_max'`).run()
  db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'x', 'extractor', 'EXT-0001', 90, 20, 1, 200, ?)`).run(T0)
  db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'x', 'mastropiero', 'chat', 5000, 0, 1, 200, ?)`).run(T0)
  const f = forjar(db, { clase: 'generativo', motor: 'local', ahora: T0 })
  publicar(db, { clase: 'generativo', payload: { texto: 'x' }, publicadaPor: 'operador' }, T0)
  const ev = await tick(db, { ahora: T0 + 1000, reclutar: false })
  assert.ok(ev.some((e) => e.tipo === 'tope'))
  assert.equal(leer(db, f.id)!.exitos + leer(db, f.id)!.fallos, 0)
  db.prepare(`UPDATE ajustes SET valor = '0' WHERE clave = 'tokens_dia_max'`).run()
  const ev2 = await tick(db, { ahora: T0 + 2000, reclutar: false })
  assert.ok(ev2.some((e) => e.tipo === 'corre'), 'sin tope vuelve a correr')
})

test('el gerente reparte su proyecto, prefiere a los de la casa y gana XP', async () => {
  const db = abrir(':memory:')
  const { id, gerente } = crearProyecto(db, 'Ulpianito', T0)
  const libre = forjar(db, { clase: 'ejecutivo', motor: 'funcion:bitacora', ahora: T0 })
  const casa = forjar(db, { clase: 'ejecutivo', motor: 'funcion:bitacora', proyectoId: id, ahora: T0 })
  publicar(db, { clase: 'ejecutivo', payload: { texto: 'anotá' }, publicadaPor: 'operador', proyectoId: id }, T0)
  publicar(db, { clase: 'ejecutivo', payload: { texto: 'nadie sin dueño' }, publicadaPor: 'operador' }, T0)
  const ev = await tick(db, { ahora: T0 + 1 })
  const hechas = tareas(db, 'hecha')
  assert.equal(hechas.find((t) => t.proyectoId === id)!.asignadaA, casa.id)
  assert.equal(hechas.find((t) => t.proyectoId === null)!.asignadaA, libre.id)
  assert.equal(hechas.find((t) => t.proyectoId === id)!.asignadaPor, gerente.id)
  assert.ok(leer(db, gerente.id)!.xp > 0)
  assert.ok(!ev.some((e) => e.tipo === 'recluta'))
})

test('nadie recluta ejecutivos solo: queda vacante', async () => {
  const db = abrir(':memory:')
  publicar(db, { clase: 'ejecutivo', payload: { texto: 'pagá algo' }, publicadaPor: 'operador' }, T0)
  const ev = await tick(db, { ahora: T0 })
  assert.ok(ev.some((e) => e.tipo === 'vacante'))
  assert.equal(listar(db).length, 0)
})
