import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { forjar, leer } from '../src/roster.ts'
import { fichaDe } from '../src/arquetipos.ts'
import { bandeja, resolverBandeja } from '../src/sombra.ts'
import { purgar } from '../src/mastropiero.ts'
import { celdaSugerida, esTitular, pendientes, proponerOficio, resolverOficio } from '../src/oficios.ts'

const DIA = 86_400_000

test('Fragua #323: un oficio nuevo entra como arquetipo propuesto en Para validar, con su celda; nunca se nombra solo', async () => {
  const db = abrir(':memory:')
  const p = proponerOficio(db, { plantilla: 'visual', origen: 'chat' })
  assert.equal(p.oficio, 'Diseñador visual')
  assert.equal(p.elemento, 'onda')
  assert.equal(p.celda, 1, 'la primera celda vacía')
  assert.equal(p.fila, 4, 'la fila de su elemento (onda es el cuarto)')
  assert.match(p.instruccion!, /hallazgos numerados.*criterio de aprobación/s)
  assert.throws(() => proponerOficio(db, { oficio: 'Contabilidad' }), /es un concepto/)
  assert.throws(() => proponerOficio(db, { plantilla: 'visual' }), /ya está propuesto/)
  const otra = proponerOficio(db, { plantilla: 'experiencia' })
  // Un concepto que es de una plantilla se traduce a su profesión.
  assert.equal(proponerOficio(db, { oficio: 'Gamificación' }).oficio, 'Diseñador de juegos')
  resolverOficio(db, pendientes(db).at(-1)!.id, 'descartar')
  assert.equal(otra.celda, 2, 'la celda de una propuesta pendiente no se repite')

  const g = bandeja(db).grupos.find((x: any) => x.tipo === 'oficio')!
  assert.equal(g.n, 2)
  assert.match(g.items[0].texto, /Diseñador visual → celda 1 \(fila 4, columna 1\)/)
  assert.match(String(g.items[0].sub), /El nombre propio lo ponés vos/)

  // Aceptar desde Para validar: la ficha queda completa y sin nombre.
  await resolverBandeja(db, 'oficio', p.id, 'aceptar')
  const f = fichaDe(db, 1)
  assert.deepEqual([f.oficio, f.elemento, f.fila, f.columna, f.nombre, f.estado], ['Diseñador visual', 'onda', 4, 1, null, 'vacío'])
  assert.match(f.maneja!, /jerarquía, tipografía/)
  // Él la mueve a otra celda al aceptar.
  resolverOficio(db, otra.id, 'aceptar', { celda: 30 })
  assert.equal(fichaDe(db, 30).oficio, 'Investigador de experiencia')
  assert.equal(pendientes(db).length, 0)
  assert.equal(celdaSugerida(db, null).celda, 2)
})

test('Fragua #323: un generativo que cumplió su misión asciende al arquetipo (conserva lo suyo y deja de ser descartable)', () => {
  const db = abrir(':memory:')
  const g = forjar(db, { clase: 'generativo', instrucciones: 'Revisás piezas de gamificación.', ahora: Date.now() - 30 * DIA })
  assert.throws(() => proponerOficio(db, { plantilla: 'gamificacion', agente: g.id }), /todavía está en prueba/)
  db.prepare(`UPDATE agentes SET estado = 'activo', exitos = 3 WHERE id = ?`).run(g.id)
  const p = proponerOficio(db, { plantilla: 'gamificacion', agente: g.id })
  assert.equal(p.origen, 'ascenso')
  const r = resolverOficio(db, p.id, 'aceptar')
  const ag = leer(db, g.id)!
  assert.equal(ag.celda, r.arquetipo)
  assert.match(ag.instrucciones, /diseñador de juegos del plantel[\s\S]*Lo que traías de antes: Revisás piezas de gamificación/)
  assert.equal(esTitular(db, g.id), true)
  // Otro generativo activo (así no es el último de su clase) y diez días de liga sin correr: el titular no se purga.
  db.prepare(`UPDATE agentes SET estado = 'activo' WHERE id = ?`).run(forjar(db, { clase: 'generativo' }).id)
  for (let d = 1; d <= 10; d++) db.prepare(`INSERT INTO cronica (tick, tipo, texto, en) VALUES (?, 'tick', 'x', ?)`).run(d, Date.now() - d * DIA)
  purgar(db, Date.now())
  assert.ok(leer(db, g.id), 'sigue en el plantel')
})
