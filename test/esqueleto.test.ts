import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { ORGANOS, verEsqueleto } from '../src/esqueleto.ts'
import { CLASE_IDS } from '../src/clases.ts'

test('el esqueleto: cada órgano en una celda válida, con función, virtudes y qué hace; los propuestos se pueden forjar; la actividad sale de la base', () => {
  const ids = new Set<string>()
  for (const o of ORGANOS) {
    assert.ok(!ids.has(o.id), `id repetido: ${o.id}`)
    ids.add(o.id)
    assert.ok(o.celda >= 1 && o.celda <= 72, o.id)
    assert.ok(o.funcion.length > 40 && o.virtudes.length >= 2 && o.hace.length >= 2, `${o.id}: ficha completa`)
    if (o.tipo === 'propuesto') assert.ok(o.forja && CLASE_IDS.includes(o.forja.clase) && o.propuesta, `${o.id}: se puede forjar`)
  }
  assert.deepEqual(ORGANOS.filter((o) => o.tipo === 'propuesto').map((o) => o.nombre), ['El Taxónomo', 'Logos · Laboral', 'Logos · Mercantil', 'Logos · Fiscal'])
  const db = abrir(':memory:')
  db.prepare(`INSERT INTO criba (pieza_id, peso, fecha, en) VALUES (1, 7, '2026-11-12', ?)`).run(Date.now())
  const e = verEsqueleto(db)
  assert.equal(e.dominios.length, 8)
  const criba = e.organos.find((o) => o.id === 'criba')!
  assert.deepEqual(criba.semana, [{ etiqueta: 'piezas pesadas', n: 1 }])
  assert.equal(criba.celdaInfo.dominio, 'Criba')
  assert.ok(e.organos.find((o) => o.id === 'fragua')!.modelos.length >= 2, 'con qué modelos piensa')
  for (const o of e.organos) for (const s of o.semana) assert.notEqual(s.n, null, `${o.id}: su SQL de actividad anda (${s.etiqueta})`)
  assert.equal(e.porDominio.reduce((s, d) => s + d.organos + d.propuestos, 0), ORGANOS.length)
})
