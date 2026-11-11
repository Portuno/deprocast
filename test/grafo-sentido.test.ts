import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { construirRed } from '../src/grafo/construir.ts'
import { calcularSentido } from '../src/grafo/sentido.ts'

test('#229: la red guarda en qué piezas aparece cada concepto (para su vector de sentido)', () => {
  const r = construirRed([
    { id: 11, texto: 'El plan de igualdad de la empresa y su auditoría.', tipo: 'pieza' },
    { id: 12, texto: 'La auditoría retributiva del plan.', tipo: 'pieza' },
    { id: -5, texto: 'Un quántomo sobre el plan.', tipo: 'quantomo' },
  ], { maxNodos: 50 })
  const plan = r.nodos.findIndex((n) => n.forma === 'plan')
  assert.deepEqual(r.ejemplos![plan].sort(), [11, 12], 'solo piezas del corpus (el quántomo no tiene pasajes)')
})

test('#229: dos conceptos que dicen lo mismo sin aparecer juntos quedan unidos por sentido; lo que ya está unido en el texto, no', async () => {
  const db = abrir(':memory:')
  const vec = (xs: number[]) => Buffer.from(new Float32Array(xs).buffer)
  const pasaje = (pieza: number, v: number[]) => db.prepare(`INSERT INTO pasajes (pieza_id, orden, desde, hasta, modelo, vec, en) VALUES (?, 0, 0, 10, 'x', ?, 1)`).run(pieza, vec(v))
  // Cuatro temas: camiones y BBVA hablan de lo mismo (la flota y su financiación) aunque nunca se nombran juntos.
  pasaje(1, [1, 0, 0, 0]); pasaje(2, [0.95, 0.05, 0, 0]); pasaje(3, [0, 1, 0, 0]); pasaje(4, [0, 0, 1, 0]); pasaje(5, [0, 0, 0, 1])
  const n = (i: number, forma: string, com: number) => ({ i, lema: forma, forma, frec: 3, docs: 1, btw: 1 - i / 10, com, grado: 2, x: 0, y: 0 })
  const foto = {
    id: 1,
    nodos: [n(0, 'camiones', 0), n(1, 'ruta', 0), n(2, 'carga', 0), n(3, 'bbva', 1), n(4, 'banco', 1), n(5, 'cuota', 1), n(6, 'perro', 2), n(7, 'gato', 2), n(8, 'mascota', 2)],
    aristas: [[0, 1, 3], [1, 2, 3], [0, 2, 2], [3, 4, 3], [4, 5, 3], [3, 5, 2], [6, 7, 3], [7, 8, 3], [6, 8, 2]] as [number, number, number][],
    comunidades: [{ id: 0, tam: 3, top: ['camiones', 'ruta', 'carga'], peso: 1 }, { id: 1, tam: 3, top: ['bbva', 'banco', 'cuota'], peso: 1 }, { id: 2, tam: 3, top: ['perro', 'gato', 'mascota'], peso: 1 }],
    ejemplos: [[1], [3], [3], [2], [4], [4], [5], [5], [5]],
  }
  const s = await calcularSentido(db, foto as any)
  assert.ok(s.aristas.some(([a, b]) => (a === 0 && b === 3) || (a === 3 && b === 0)), `camiones ≈ bbva: ${JSON.stringify(s.aristas)}`)
  assert.ok(!s.aristas.some(([a, b]) => (a === 6 && b === 7) || (a === 7 && b === 6)), 'perro y gato ya están unidos en el texto')
  assert.equal(s.conceptos, 9)
  const viejo = await calcularSentido(db, { ...foto, ejemplos: undefined } as any)
  assert.match(viejo.aviso!, /recalculá el grafo/)
})
