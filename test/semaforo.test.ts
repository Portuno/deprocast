import { test } from 'node:test'
import assert from 'node:assert/strict'
import { semaforo } from '../src/semaforo.ts'

test('#244: de a 6 a la vez: diez pasos encolados nunca tienen más de seis activos, y terminan todos (también si alguno falla)', async () => {
  const s = semaforo(() => 6)
  let activos = 0, pico = 0
  const paso = (i: number) => s.con(async () => {
    activos++
    pico = Math.max(pico, activos)
    await new Promise((ok) => setTimeout(ok, 5 + (i % 3) * 5))
    activos--
    if (i === 4) throw new Error('un paso que falla suelta su lugar')
    return i
  })
  const r = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => paso(i)))
  assert.equal(pico, 6)
  assert.equal(s.pico, 6)
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 9)
  assert.equal(s.activos, 0)
  assert.equal(s.esperando, 0)
})

test('#267: los vectores de una pieza grande se piden de a 3 tandas a la vez (no una detrás de otra), y quedan todos en orden', async () => {
  const { abrir } = await import('../src/db.ts')
  const { insertar } = await import('../src/corpus.ts')
  const { _probarEmbed, pasajesDe } = await import('../src/semantica.ts')
  const db = abrir(':memory:')
  const id = insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Larga', contenido: Array.from({ length: 4000 }, (_, i) => `Párrafo ${i} con bastante texto para que se parta en muchos pasajes distintos.`).join('\n\n'), origenId: 'larga' })!
  let enVuelo = 0, pico = 0, pedidos = 0
  _probarEmbed(async (_db, textos) => {
    enVuelo++; pedidos++; pico = Math.max(pico, enVuelo)
    await new Promise((ok) => setTimeout(ok, 15))
    enVuelo--
    return { vectores: textos.map(() => Array.from({ length: 8 }, () => 0.1)), modelo: 'falso' }
  })
  try {
    await pasajesDe(db, [id])
    const n = (db.prepare('SELECT COUNT(*) AS n FROM pasajes WHERE pieza_id = ?').get(id) as { n: number }).n
    assert.ok(pedidos > 3, `una pieza grande son varias tandas (${pedidos})`)
    assert.equal(pico, 3)
    assert.ok(n > 32)
    const ordenes = (db.prepare('SELECT orden FROM pasajes WHERE pieza_id = ? ORDER BY orden').all(id) as { orden: number }[]).map((r) => r.orden)
    assert.deepEqual(ordenes, ordenes.map((_, i) => i))
  } finally {
    _probarEmbed(null)
  }
})
