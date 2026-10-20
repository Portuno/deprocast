import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'

const { abrir } = await import('../src/db.ts')
const { asegurarFuente, insertar } = await import('../src/corpus.ts')
const { crearQuantomo, leerQuantomo, sellar } = await import('../src/quantomos.ts')
const { _esperarFondo, _probarMano, composicion, deshacerJugada, jugar, marcarChoque, nuevasParaJugar, recalibrarPuente, responderSorpresa, robar, sorpresasPendientes, tasaDeSorpresas, umbralPuente } = await import('../src/mano.ts')

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
  assert.deepEqual({ ...composicion(s.db, T), sorpresas: undefined }, { total: 4, nuevas: 1, variaciones: 1, repetidas: 1, sinVector: 1, jugadasHoy: 0, sorpresas: undefined })
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

// ─── Fase 2: las sorpresas ──────────────────────────────────────────────

/** Dos mundos (notas propias y un podcast), con piezas sin relación entre sí, y un ayudante para crear afirmaciones con vector. */
function mundos() {
  const db = abrir(':memory:')
  asegurarFuente(db, { id: 'notas', nombre: 'Notas', nivel: 'propia', descripcion: 'Notas sueltas' })
  asegurarFuente(db, { id: 'podcast', nombre: 'Podcasts', nivel: 'primaria', descripcion: 'Lo que escucha' })
  let n = 0
  const pieza = (fuente: string) => insertar(db, { fuente, titulo: `Pieza ${++n}`, contenido: 'algo', origenId: `m:${n}`, fecha: '2025-03-01' }, T - 300 * DIA)!
  const q = (texto: string, fuente: string, v: Buffer, o: { peso?: number; piezaId?: number } = {}) => {
    const id = crearQuantomo(db, { texto, piezaId: o.piezaId ?? pieza(fuente) }, T - 200 * DIA)!
    db.prepare(`INSERT INTO vec_items (tipo, id, modelo, vec, en) VALUES ('quantomo', ?, 'juguete', ?, 0)`).run(id, v)
    if (o.peso) sellar(db, id, o.peso, T - 100 * DIA)
    return id
  }
  return { db, pieza, q }
}

test('Puente no obvio: algo pesado alto que dice casi lo mismo pero viene de otro mundo y nunca apareció junto; no se repite', async () => {
  const { db, pieza, q } = mundos()
  const ostrom = q('Los bienes comunes se cuidan con reglas locales', 'podcast', vec(1, 0.2, 0), { peso: 10 })
  const carta = q('El precio de entrada cuida la comunidad del juego', 'notas', vec(0.97, 0.25, 0))
  const j = await jugar(db, carta, { gesto: 'peso', peso: 8 }, T)
  assert.equal(j.sorpresas.length, 1)
  const p = j.sorpresas[0]
  assert.equal(p.tipo, 'puente')
  assert.deepEqual(p.cartas.map((c) => c.id), [carta, ostrom])
  assert.deepEqual(p.mundos, ['Notas', 'Podcasts'], 'trae de dónde viene cada una')
  assert.match(p.texto!, /nunca aparecieron juntos/)

  // Del mismo mundo, o con una entidad en común: no es puente (ya lo tenía relacionado).
  const mismo = q('Las reglas locales cuidan lo compartido', 'podcast', vec(0.99, 0.21, 0))
  const conMismo = (await jugar(db, mismo, { gesto: 'peso', peso: 7 }, T)).sorpresas
  assert.ok(!conMismo.some((s) => s.cartas.some((c) => c.id === ostrom)), 'con lo del mismo mundo no hay puente')
  assert.deepEqual(conMismo.map((s) => s.cartas[1].id), [carta], 'sí con la de las notas que acaba de pesar')
  const pa = pieza('notas')
  const pb = pieza('podcast')
  const ent = Number(db.prepare(`INSERT INTO entidades (tipo, nombre, creada_en) VALUES ('proyecto', 'Proyecto Faro', 1)`).run().lastInsertRowid)
  db.prepare('INSERT OR IGNORE INTO corpus_entidades (pieza_id, entidad_id) VALUES (?, ?), (?, ?)').run(pa, ent, pb, ent)
  q('Algo del Faro que ya creía', 'podcast', vec(0, 1, 0.1), { peso: 11, piezaId: pb })
  const conEntidad = q('Otra cosa del Faro', 'notas', vec(0, 0.98, 0.12), { piezaId: pa })
  assert.equal((await jugar(db, conEntidad, { gesto: 'peso', peso: 6 }, T)).sorpresas.length, 0)

  // Responder una vez; la respuesta tiene que ser de las de su tipo.
  assert.throws(() => responderSorpresa(db, p.id, 'actualizo', null, T), /Se responde real, casualidad/)
  assert.equal(responderSorpresa(db, p.id, 'real', null, T).estado, 'real')
  assert.throws(() => responderSorpresa(db, p.id, 'casualidad', null, T), /ya la respondiste/)
})

test('Combo: tres cartas parecidas pesadas en la sesión, de dos mundos → en la nube, una hipótesis que vuelve como carta nueva', async () => {
  const { db, q } = mundos()
  let pedido = ''
  _probarMano({ nube: () => true, modelo: async (_db, sistema, usuario) => {
    if (sistema.includes('hipótesis')) { pedido = usuario; return { hipotesis: 'Cuando el precio filtra, la comunidad se cuida sola', predice: 'menos moderación', refutaria: 'más reportes' } }
    return { relaciones: [] }
  } })
  try {
    const a = q('El precio filtra a los que no se comprometen', 'notas', vec(1, 0.3, 0))
    const b = q('Pagar algo hace que la gente cuide más', 'podcast', vec(0.95, 0.35, 0.05))
    const c = q('Lo gratis se usa y se tira', 'notas', vec(0.9, 0.4, 0))
    const lejos = q('Dormir bien ayuda', 'notas', vec(0, 0, 1))
    assert.equal((await jugar(db, a, { gesto: 'peso', peso: 7 }, T)).sorpresas.length, 0)
    await jugar(db, lejos, { gesto: 'peso', peso: 5 }, T + 1000)
    assert.equal((await jugar(db, b, { gesto: 'peso', peso: 8 }, T + 2000)).sorpresas.filter((s) => s.tipo === 'combo').length, 0, 'dos no alcanzan')
    const j = await jugar(db, c, { gesto: 'peso', peso: 6 }, T + 3000)
    const combo = j.sorpresas.find((s) => s.tipo === 'combo')!
    assert.ok(combo, 'tres que se parecen, de dos mundos')
    assert.deepEqual(new Set(combo.cartas.map((x) => x.id)), new Set([a, b, c]), 'lo que no se parece no entra')
    assert.equal(combo.texto, null, 'la hipótesis llega después')
    await _esperarFondo()
    const s = sorpresasPendientes(db).find((x) => x.id === combo.id)!
    assert.match(s.texto!, /^Cuando el precio filtra[\s\S]*Predice: menos moderación/)
    assert.equal(leerQuantomo(db, s.hipotesisId!)?.etapa, 'proto', 'la hipótesis es una carta más, para pesarla')
    assert.match(pedido, /\[Podcasts\] Pagar algo/)
    responderSorpresa(db, combo.id, 'casualidad', null, T + 4000)
    assert.equal(leerQuantomo(db, s.hipotesisId!)?.etapa, 'descartado')
    // Las cartas de un combo no arman otro en la misma sesión.
    const d = q('Cobrar poco ya filtra', 'podcast', vec(0.97, 0.32, 0.02))
    assert.equal((await jugar(db, d, { gesto: 'peso', peso: 7 }, T + 5000)).sorpresas.filter((x) => x.tipo === 'combo').length, 0)
  } finally { _probarMano({ nube: () => false }) }
})

test('La creencia que se cae: el modelo (en la nube) o él la detectan; actualizo, sostengo o lo pruebo una semana', async () => {
  const { db, q } = mundos()
  _probarMano({ nube: () => true, modelo: async (_db, sistema, usuario) => {
    if (!sistema.includes('refuerza, la contradice')) return { hipotesis: null }
    const id = Number(/\[(\d+)\]/.exec(usuario)![1])
    return { relaciones: [{ id, relacion: 'contradice', por_que: 'Si el cansancio viene del almuerzo, no es el sueño' }] }
  } })
  try {
    const vieja = q('El cansancio de la tarde es falta de sueño', 'notas', vec(1, 0.2, 0), { peso: 9 })
    const nueva = q('El foco cae los días que no almuerzo', 'podcast', vec(0.9, 0.3, 0.1))
    await jugar(db, nueva, { gesto: 'peso', peso: 5 }, T)
    await _esperarFondo()
    const c = sorpresasPendientes(db).find((s) => s.tipo === 'contradiccion')!
    assert.deepEqual(c.cartas.map((x) => x.id), [nueva, vieja])
    assert.match(c.texto!, /almuerzo/)
    responderSorpresa(db, c.id, 'actualizo', 'lo vi en el Directo', T)
    assert.equal(leerQuantomo(db, nueva)?.peso, 9, 'la nueva toma el peso de lo que creía')
    assert.equal(leerQuantomo(db, vieja)?.peso, 3, 'lo viejo baja, pero queda')
  } finally { _probarMano({ nube: () => false }) }

  // Él la marca con «choca» y elige con qué; «lo pruebo» deja una side quest con fecha, «sostengo» descarta la nueva.
  const { db: db2, q: q2 } = mundos()
  const creia = q2('Hay que hacer todo solo', 'notas', vec(1, 0, 0), { peso: 10 })
  const otra = q2('Delegar me dio más tiempo', 'podcast', vec(0.8, 0.6, 0))
  const j = await jugar(db2, otra, { gesto: 'choca' }, T)
  assert.equal(j.chocaCon[0].id, creia)
  const ch = marcarChoque(db2, otra, creia, T)
  assert.equal(marcarChoque(db2, otra, creia, T).id, ch.id, 'marcarla dos veces no la duplica')
  responderSorpresa(db2, ch.id, 'pruebo', null, T)
  const m = db2.prepare(`SELECT titulo, vence, nivel FROM misiones WHERE titulo LIKE 'Probar una semana%'`).get() as any
  assert.equal(m.nivel, 'terciaria')
  assert.equal(m.vence, '2026-10-27')
  const otra2 = q2('Pedir ayuda es debilidad', 'podcast', vec(0.85, 0.5, 0))
  await jugar(db2, otra2, { gesto: 'choca' }, T)
  responderSorpresa(db2, marcarChoque(db2, otra2, creia, T).id, 'sostengo', 'no me convence', T)
  assert.equal(leerQuantomo(db2, otra2)?.etapa, 'descartado')
})

test('Deshacer una jugada se lleva lo que destapó y todavía no respondió', async () => {
  const { db, q } = mundos()
  q('Los bienes comunes se cuidan con reglas locales', 'podcast', vec(1, 0.2, 0), { peso: 10 })
  const carta = q('El precio de entrada cuida la comunidad', 'notas', vec(0.97, 0.25, 0))
  assert.equal((await jugar(db, carta, { gesto: 'peso', peso: 8 }, T)).sorpresas.length, 1)
  deshacerJugada(db, T)
  assert.equal(sorpresasPendientes(db).length, 0)
})

test('El umbral del puente se regula solo: sube si salen demasiados o si son casualidad, baja si no sale ninguno', () => {
  const { db } = mundos()
  const jugadas = (n: number, desde: number) => { for (let i = 0; i < n; i++) db.prepare(`INSERT INTO mano_jugadas (quantomo_id, gesto, peso, en) VALUES (1, 'peso', 5, ?)`).run(desde + i) }
  const puentes = (n: number, en: number, estado = 'pendiente') => {
    for (let i = 0; i < n; i++) db.prepare(`INSERT INTO mano_eventos (tipo, quantomo_id, ids, estado, creado_en, respondido_en) VALUES ('puente', 1, '[]', ?, ?, ?)`).run(estado, en + i, estado === 'pendiente' ? null : en + i)
  }
  assert.equal(umbralPuente(db), 0.8)
  jugadas(5, T)
  assert.equal(recalibrarPuente(db, T + 100), 0.8, 'con pocas cartas no se mueve')
  jugadas(25, T + 10)
  puentes(10, T + 20)
  assert.equal(recalibrarPuente(db, T + 100), 0.81, '10 de 30: demasiados → más exigente')
  db.exec('DELETE FROM mano_eventos')
  for (let i = 0; i < 30; i++) recalibrarPuente(db, T + 100)
  assert.equal(umbralPuente(db), 0.7, 'sin ninguno, baja hasta el piso (nunca extinción)')
  puentes(4, T + 300, 'casualidad')
  puentes(1, T + 400, 'real')
  assert.ok(recalibrarPuente(db, T + 500) > 0.7, 'más de la mitad casualidad → sube aunque salgan pocos')
  assert.equal(tasaDeSorpresas(db).respondidas, 5)
})
