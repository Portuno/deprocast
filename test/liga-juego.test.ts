import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MASTRO_CLAVE_TOKENS = 'clave-de-prueba'

const { abrir } = await import('../src/db.ts')
const { forjar, leer, cambiarEstado } = await import('../src/roster.ts')
const { semanaDe } = await import('../src/misiones.ts')
const { ventana } = await import('../src/economia.ts')
const j = await import('../src/juego.ts')
const { guardarCuenta } = await import('../src/cuentas.ts')

const DIA = 86_400_000
/** Un lunes al mediodía, y la semana anterior. */
const AHORA = new Date(2026, 10, 18, 12).getTime()
const SEMANA_ANTES = ventana(semanaDe(AHORA))[0] - 3 * DIA

/** Trabajo hecho de verdad: `n` aportes (15 cada uno en la economía) o tareas (1), de un agente, en un momento. */
function hecho(db: any, agente: string, n: number, en: number, tipo = 'aporte', estado = 'hecha') {
  const ins = db.prepare(`INSERT INTO tareas (tipo, clase, payload, estado, asignada_a, publicada_por, creada_en, actualizada_en) VALUES (?, 'generativo', '{}', ?, ?, 'operador', ?, ?)`)
  for (let i = 0; i < n; i++) ins.run(tipo, estado, agente, en, en)
}
/** Un agente activo en la celda de un arquetipo. */
function agente(db: any, celda: number, clase = 'generativo') {
  const f = forjar(db, { clase, celda, ahora: AHORA - 30 * DIA })
  db.prepare(`UPDATE agentes SET estado = 'activo' WHERE id = ?`).run(f.id)
  return leer(db, f.id)!
}
/** La corrida del arquetipo, empezada antes de la semana anterior (para que cuente todo). */
function desdeAntes(db: any, n: number) {
  const c = j.corridaAbierta(db, n, AHORA - 20 * DIA)
  return c
}

test('Fragua #262: cada punto es algo hecho de verdad (las pérdidas no suman); el nivel es geométrico y desbloquea la tienda', () => {
  const db = abrir(':memory:')
  const a = agente(db, 5)
  desdeAntes(db, 5)
  hecho(db, a.id, 2, AHORA - 1000) // 2 aportes: 30 puntos
  hecho(db, a.id, 4, AHORA - 1000, 'aporte', 'fallida') // los fallos no restan puntos
  const e = j.estados(db, AHORA).get(5)!
  assert.equal(e.puntos, 30)
  assert.deepEqual([e.epoca, e.nivel, e.geometria.nombre, e.alcanzado, e.influencia], [1, 4, 'Cuadrado', 4, 30])
  const [p] = j.puntosDeSemana(db, semanaDe(AHORA), AHORA)
  assert.ok(p.neto < p.puntos, 'el neto (con los fallos) es otra cosa: solo cuenta para quebrar')

  const r = j.comprar(db, 5, 'entrenamiento', { agente: a.id, atributo: leer(db, a.id)!.atributos ? Object.keys(leer(db, a.id)!.atributos)[0] : '' }, AHORA)
  assert.match(r.texto, /Entrenamiento: .* sube/)
  assert.equal(r.influencia, 10)
  assert.throws(() => j.comprar(db, 5, 'fichaje', { clase: 'generativo' }, AHORA), /cuesta 40 de influencia; tiene 10/)
  assert.throws(() => j.comprar(db, 5, 'indulto', { agente: a.id }, AHORA), /se desbloquea en el Pentágono/)
  assert.throws(() => j.comprar(db, 9, 'entrenamiento', {}, AHORA), /no está en juego/)
})

test('Fragua #262: las épocas se cierran con su sello (lo viejo queda archivado) y desde el Triángulo los hitos dejan artefactos', () => {
  const db = abrir(':memory:')
  const a = agente(db, 7)
  desdeAntes(db, 7)
  hecho(db, a.id, 9, AHORA - 1000) // 135 puntos: época III
  const e = j.estados(db, AHORA).get(7)!
  assert.deepEqual([e.puntos, e.epoca, e.nivel, e.alcanzado], [135, 3, 2, 6])
  const r = j.avanzar(db, AHORA)
  assert.deepEqual(r, { sellos: 2, drops: 1 })
  assert.deepEqual(j.avanzar(db, AHORA), { sellos: 0, drops: 0 }, 'una vez cada cosa')
  const arts = db.prepare('SELECT nombre FROM juego_artefactos WHERE arquetipo = 7 ORDER BY id').all().map((x: any) => x.nombre)
  assert.deepEqual(arts, ['Sello de la época I', 'Sello de la época II', 'Trofeo: 9 aportes (aporte)'])
  const diario = db.prepare('SELECT epoca, tipo FROM juego_diario ORDER BY id').all().map((x: any) => `${x.epoca}:${x.tipo}`)
  assert.ok(diario.includes('2:epoca') && diario.includes('3:epoca'), diario.join(','))
})

test('Fragua #262: en red (desde el Cuadrado) lo que gana uno llega como influencia a sus vecinos de la matriz 6×6', () => {
  const db = abrir(':memory:')
  db.prepare(`CREATE TABLE IF NOT EXISTS arquetipo_fichas (n INTEGER PRIMARY KEY, oficio TEXT, elemento TEXT, fila INTEGER, columna INTEGER, maneja TEXT, ejemplo TEXT, estado TEXT, actualizada_en INTEGER NOT NULL)`).run()
  for (const [n, f, c] of [[1, 1, 1], [2, 1, 2], [3, 2, 3]]) db.prepare('INSERT INTO arquetipo_fichas (n, fila, columna, actualizada_en) VALUES (?, ?, ?, 0)').run(n, f, c)
  const a = agente(db, 1), b = agente(db, 2), c = agente(db, 3)
  for (const n of [1, 2, 3]) desdeAntes(db, n)
  assert.deepEqual(j.vecinos(db, 1), [2])
  hecho(db, a.id, 3, SEMANA_ANTES) // la semana pasada: 45 → ya pasó el Cuadrado (está en el Pentágono)
  hecho(db, a.id, 2, AHORA - 1000) // esta: 30, ya en red → 3 para su vecino
  hecho(db, b.id, 1, AHORA - 1000)
  hecho(db, c.id, 1, AHORA - 1000)
  const es = j.estados(db, AHORA)
  assert.equal(es.get(1)!.puntos, 75)
  assert.equal(es.get(2)!.recibido, 3, 'una décima de lo que ganó en red')
  assert.equal(es.get(2)!.influencia, 18)
  assert.equal(es.get(3)!.recibido, 0, 'no es vecino')
  // La semana pasada quedó guardada: si el agente se va de la celda, lo que sumó sigue donde lo sumó.
  db.prepare('UPDATE agentes SET celda = 9 WHERE id = ?').run(a.id)
  assert.equal(j.estados(db, AHORA).get(1)!.puntos, 45)
})

test('Fragua #262: una corrida se pierde (sin agentes activos) y empieza otra con legado; los artefactos quedan', () => {
  const db = abrir(':memory:')
  const a = agente(db, 11)
  desdeAntes(db, 11)
  hecho(db, a.id, 5, AHORA - 1000)
  j.avanzar(db, AHORA)
  const antes = j.estados(db, AHORA).get(11)!
  cambiarEstado(db, a.id, 'banca')
  const r = j.revisarCorridas(db, semanaDe(AHORA), AHORA)
  assert.deepEqual(r.perdidas, [{ arquetipo: 11, causa: 'se quedó sin agentes activos' }])
  const nueva = j.estados(db, AHORA + 1).get(11)!
  assert.equal(nueva.numero, 2)
  assert.equal(nueva.legado, Math.round(antes.influencia * j.PARTE_LEGADO * 100) / 100)
  assert.ok(Number((db.prepare(`SELECT COUNT(*) AS n FROM juego_artefactos WHERE arquetipo = 11`).get() as any).n) >= 1, 'los artefactos no se pierden')
})

test('Fragua #262: las cuentas de un agente van en «libre» solo si su arquetipo llegó al Pentágono', () => {
  const db = abrir(':memory:')
  const a = agente(db, 20)
  desdeAntes(db, 20)
  const libre = () => guardarCuenta(db, { red: 'bluesky', usuario: '@a', modo: 'libre', agente: a.id }, AHORA)
  assert.throws(libre, /desde el Pentágono.*va por el Punto/)
  hecho(db, a.id, 2, AHORA - 1000) // 30: Cuadrado
  assert.throws(libre, /va por el Cuadrado/)
  hecho(db, a.id, 1, AHORA - 1000) // 45: Pentágono
  assert.equal(libre().modo, 'libre')
  // Lo que ya estaba en libre sigue aunque después la corrida se pierda.
  db.prepare('UPDATE juego_corridas SET terminada = ? WHERE arquetipo = 20').run(AHORA)
  assert.equal(guardarCuenta(db, { id: libre().id, red: 'bluesky', usuario: '@a', modo: 'libre', agente: a.id }, AHORA).modo, 'libre')
})
