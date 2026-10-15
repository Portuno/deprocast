import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { deduplicarMemoria, memoriaVigente, recordar } from '../src/memoria.ts'
import { tick } from '../src/mastropiero.ts'

const alta = (db: ReturnType<typeof abrir>, texto: string, o: { tipo?: string; revisada?: boolean } = {}) =>
  // Entra directo (recordar ya frena los idénticos): así llegan las versiones casi iguales de distintas fuentes.
  Number(db.prepare(`INSERT INTO memoria (texto, tipo, fecha, estado, revisada, creada_por, creada_en) VALUES (?, ?, '2026-10-01', 'vigente', ?, 'escriba', 1)`).run(texto, o.tipo ?? 'hecho', o.revisada ? 1 : 0).lastInsertRowid)

test('memoria: los casi iguales se juntan solos (queda el revisado o el más completo); números distintos y correcciones no', () => {
  const db = abrir(':memory:')
  const a = alta(db, 'Su cumpleaños es el 3 de diciembre')
  const b = alta(db, 'Su cumpleaños es el 3 de diciembre de cada año')
  const c = alta(db, 'Trabaja en una agencia de lunes a viernes', { revisada: true })
  const d = alta(db, 'Trabaja en una agencia de lunes a viernes por la mañana')
  const e = alta(db, 'Cobra 1500 euros por mes de sueldo')
  const f = alta(db, 'Cobra 1800 euros por mes de sueldo')
  const g = alta(db, 'Trabaja en una agencia de lunes a viernes', { tipo: 'correccion' })
  const h = alta(db, 'Le gusta el cine de terror')
  const r = deduplicarMemoria(db)
  assert.deepEqual(r, { grupos: 2, archivados: 2 })
  const quedan = memoriaVigente(db).map((x) => x.id).sort((x, y) => x - y)
  assert.deepEqual(quedan, [b, c, e, f, g, h], 'del cumple queda el más completo; de la agencia, el que él revisó')
  assert.ok(!quedan.includes(a) && !quedan.includes(d))
  assert.equal((db.prepare('SELECT reemplaza FROM memoria WHERE id = ?').get(a) as any).reemplaza, b)
  assert.deepEqual(deduplicarMemoria(db), { grupos: 0, archivados: 0 }, 'una segunda pasada no encuentra nada')
})

test('memoria: el tick de la liga hace la limpieza y la deja en la crónica', async () => {
  const db = abrir(':memory:')
  recordar(db, { texto: 'Vive en Valencia desde hace dos años' })
  alta(db, 'Vive en Valencia desde hace dos años ya')
  const ev = await tick(db, { reclutar: false })
  assert.ok(ev.some((x) => x.tipo === 'memoria' && /juntó 1 recuerdo repetido/.test(x.texto)))
  assert.equal(memoriaVigente(db).length, 1)
})
