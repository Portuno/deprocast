import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'

const { abrir } = await import('../src/db.ts')
const { asegurarFuente, insertar } = await import('../src/corpus.ts')
const { crearQuantomo, leerQuantomo, sellar } = await import('../src/quantomos.ts')
const { composicion, deshacerJugada, jugar, nuevasParaJugar, robar } = await import('../src/mano.ts')

const T = new Date(2026, 9, 20, 10).getTime()
const DIA = 86_400_000

/** Un vector normalizado (de juguete: pocos ejes de sentido). */
function vec(...xs: number[]) {
  const v = new Float32Array(xs)
  const n = Math.hypot(...xs) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return Buffer.from(v.buffer)
}

/**
 * Una base con: una pieza que habla de un proyecto con una primaria activa, tres afirmaciones selladas (una pesada alto)
 * y cuatro sin pesar (nueva, variación, repetida, sin vector).
 */
function sembrar() {
  const db = abrir(':memory:')
  asegurarFuente(db, { id: 'notas', nombre: 'Notas', nivel: 'propia', descripcion: 'Notas sueltas' })
  const pieza = insertar(db, { fuente: 'notas', titulo: 'Notas de la semana', contenido: 'Varias ideas', fecha: '2026-03-04', origenId: 't:1' }, T - 200 * DIA)!
  const proyecto = Number(db.prepare(`INSERT INTO entidades (tipo, nombre, creada_en) VALUES ('proyecto', 'Proyecto Faro', 1)`).run().lastInsertRowid)
  db.prepare('INSERT OR IGNORE INTO corpus_entidades (pieza_id, entidad_id) VALUES (?, ?)').run(pieza, proyecto)
  const primaria = Number(db.prepare(`INSERT INTO misiones (personaje, asignada_por, nivel, titulo, entidad_id, estado, semana, creada_por, creada_en)
    VALUES ('jugador', 'jugador', 'primaria', 'Lanzar el Faro', ?, 'activa', '2026-W43', 'jugador', 1)`).run(proyecto).lastInsertRowid)
  db.prepare(`INSERT INTO misiones (personaje, asignada_por, nivel, titulo, estado, creada_por, creada_en) VALUES ('jugador', 'jugador', 'principal', 'Algo grande', 'activa', 'jugador', 1)`).run()
  const q = (texto: string, v: Buffer | null, o: { novedad?: string; creado?: number } = {}) => {
    const id = crearQuantomo(db, { texto, piezaId: pieza }, o.creado ?? T - 100 * DIA)!
    if (v) db.prepare(`INSERT INTO vec_items (tipo, id, modelo, vec, en) VALUES ('quantomo', ?, 'juguete', ?, 0)`).run(id, v)
    if (o.novedad) db.prepare('UPDATE quantomos SET novedad = ? WHERE id = ?').run(o.novedad, id)
    return id
  }
  const creencia = q('Los precios bajos atraen más jugadores', vec(1, 0.1, 0), { novedad: 'nueva' })
  const vieja = q('Los juegos gratis retienen menos', vec(0.85, 0.5, 0), { novedad: 'nueva' })
  const lejos = q('Dormir bien mejora el foco', vec(0, 0, 1), { novedad: 'nueva' })
  sellar(db, creencia, 10, T - 50 * DIA)
  sellar(db, vieja, 6, T - 50 * DIA)
  sellar(db, lejos, 8, T - 50 * DIA)
  const nueva = q('Un precio alto puede señalar calidad', vec(0.98, 0.15, 0.05), { novedad: 'nueva', creado: T - DIA })
  const variacion = q('Bajar el precio trae gente', vec(1, 0.12, 0), { novedad: 'variacion' })
  const repetida = q('Precios bajos, más jugadores', vec(1, 0.1, 0.01), { novedad: 'repetida' })
  const sinVector = q('Algo que todavía no tiene vector', null)
  return { db, pieza, proyecto, primaria, creencia, vieja, lejos, nueva, variacion, repetida, sinVector }
}

test('Mano: lo nuevo primero, lo repetido al final; el mismo día roba la misma mano y saltear la cambia', () => {
  const s = sembrar()
  const a = robar(s.db, { ahora: T })
  assert.deepEqual(a.map((c) => c.id), [s.nueva, s.variacion, s.sinVector, s.repetida])
  assert.deepEqual(robar(s.db, { ahora: T }).map((c) => c.id), a.map((c) => c.id), 'fijo por día: nada sorteado')
  assert.deepEqual(robar(s.db, { ahora: T, saltear: [s.nueva] }).map((c) => c.id)[0], s.variacion)
  assert.equal(robar(s.db, { ahora: T, n: 2 }).length, 2)
  const c = a[0]
  assert.equal(c.toca.primaria?.titulo, 'Lanzar el Faro', 'dice a qué primaria sirve')
  assert.equal(c.toca.principal, 'Algo grande')
  assert.equal(c.fuente?.fecha, '2026-03-04')
  assert.deepEqual(composicion(s.db, T), { total: 4, nuevas: 1, variaciones: 1, repetidas: 1, sinVector: 1, jugadasHoy: 0 })
})

test('Mano: pesar una carta la sella y vuelve enseguida con lo que ya sabías cerca y lo pesado alto que refuerza', async () => {
  const s = sembrar()
  const j = await jugar(s.db, s.nueva, { gesto: 'peso', peso: 9, porque: 'lo vi en otro juego' }, T)
  assert.equal(leerQuantomo(s.db, s.nueva)?.etapa, 'sellado')
  assert.equal(j.carta.peso, 9)
  assert.equal(j.vecinos[0].id, s.creencia, 'lo más parecido primero')
  assert.ok(!j.vecinos.some((v) => v.id === s.lejos), 'lo que no se parece no aparece')
  assert.ok(!j.vecinos.some((v) => v.id === s.variacion), 'solo lo sellado cuenta como «lo que ya sabías»')
  assert.deepEqual(j.refuerza.map((v) => v.id), [s.creencia], 'refuerza lo pesado ≥ 9 que dice casi lo mismo')
  assert.equal(j.vecinos[0].fecha, '2026-03-04')
  assert.equal(j.toca.primaria?.titulo, 'Lanzar el Faro')
  assert.ok(j.ms < 200)
  assert.equal((s.db.prepare('SELECT porque FROM mano_jugadas WHERE id = ?').get(j.jugadaId) as any).porque, 'lo vi en otro juego')
})

test('Mano: «choca» no sella y propone con qué choca; descartar y deshacer vuelven la carta a como estaba', async () => {
  const s = sembrar()
  const c = await jugar(s.db, s.variacion, { gesto: 'choca' }, T)
  assert.equal(leerQuantomo(s.db, s.variacion)?.etapa, 'proto')
  assert.equal(c.chocaCon[0].id, s.creencia)
  assert.deepEqual(c.refuerza, [])

  const d = await jugar(s.db, s.repetida, { gesto: 'descartar' }, T)
  assert.equal(leerQuantomo(s.db, s.repetida)?.etapa, 'descartado')
  assert.deepEqual(d.vecinos, [])
  assert.equal(deshacerJugada(s.db, T)?.quantomoId, s.repetida)
  assert.equal(leerQuantomo(s.db, s.repetida)?.etapa, 'proto')

  // Volver a pesar algo ya sellado: deshacer devuelve el peso de antes.
  await jugar(s.db, s.vieja, { gesto: 'peso', peso: 11 }, T)
  deshacerJugada(s.db, T)
  assert.equal(leerQuantomo(s.db, s.vieja)?.peso, 6)
  await assert.rejects(jugar(s.db, s.repetida, { gesto: 'otro' as any }, T), /gesto/)
  await assert.rejects(jugar(s.db, 9999, { gesto: 'peso', peso: 3 }, T))
})

test('Mano: el aviso de Hoy cuenta solo lo nuevo de verdad desde la última vez que jugó, no el montón acumulado', async () => {
  const s = sembrar()
  assert.equal(nuevasParaJugar(s.db, T), 1, 'una nueva en la última semana (la vieja de hace 100 días no cuenta)')
  await jugar(s.db, s.variacion, { gesto: 'peso', peso: 5 }, T)
  assert.equal(nuevasParaJugar(s.db, T + 1000), 0, 'después de jugar, el aviso se apaga hasta que llegue algo nuevo')
  crearQuantomo(s.db, { texto: 'Otra idea distinta' }, T + 2000)
  s.db.prepare(`UPDATE quantomos SET novedad = 'nueva' WHERE texto = 'Otra idea distinta'`).run()
  assert.equal(nuevasParaJugar(s.db, T + 3000), 1)
  assert.equal(robar(s.db, { ahora: T + 3000 })[0].texto, 'Otra idea distinta', 'lo que anuncia el aviso sale primero en la mano')
})
