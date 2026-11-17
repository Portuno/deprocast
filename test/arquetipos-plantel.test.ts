import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { nombrarPagina } from '../src/paginas.ts'
import * as a from '../src/arquetipos.ts'

test('Fragua #260 · un oficio es una profesión, no un concepto', () => {
  for (const o of ['Tesorero', 'Modista', 'Hipnotizador', 'Grafeador', 'Racializador', 'El Haiku-eador', 'Maestro de ceremonias', 'Juez', 'Cartógrafo']) assert.ok(a.esOficio(o).ok, o)
  for (const o of ['Naturaleza y taxonomía', 'Benchmarking', 'Profesionales por rubro', 'Despacho de la liga', 'Organización']) {
    const v = a.esOficio(o)
    assert.equal(v.ok, false, o)
    assert.ok(v.porQue, `${o}: con su porqué`)
  }
})

test('Fragua #260 · la ficha del plantel: oficio, elemento, celda 6×6, estado; un oficio no es un nombre propio ni al revés', () => {
  const db = abrir(':memory:')
  nombrarPagina(db, 'arquetipo', '12', 'Anacleto Prueba')
  const f = a.fijarFicha(db, 12, { oficio: 'Tesorero', elemento: 'Tiempo espacio', fila: 2, columna: 5, maneja: 'Las arcas de cada agente', ejemplo: 'Reparte un ingreso a reserva' })
  assert.deepEqual({ ...f }, { n: 12, nombre: 'Anacleto Prueba', oficio: 'Tesorero', elemento: 'tiempo-espacio', fila: 2, columna: 5, maneja: 'Las arcas de cada agente', ejemplo: 'Reparte un ingreso a reserva', estado: 'nombrado' })
  assert.throws(() => a.fijarFicha(db, 12, { oficio: 'Benchmarking' }), /concepto/)
  assert.throws(() => a.fijarFicha(db, 12, { elemento: 'fuego' }), /Elemento inválido/)
  assert.throws(() => a.fijarFicha(db, 12, { fila: 7 }), /del 1 al 6/)
  // Un nombre propio no puede ser el oficio de otro, ni un oficio el nombre de otro.
  assert.throws(() => nombrarPagina(db, 'arquetipo', '13', 'El Tesorero'), /es el oficio del arquetipo 12/)
  assert.throws(() => a.fijarFicha(db, 14, { oficio: 'Anacleto Prueba' }), /nombre propio del arquetipo 12|no parece una profesión/)
  // Sin nombre no puede estar en prueba; con nombre, sí.
  assert.throws(() => a.fijarFicha(db, 20, { estado: 'activo' }), /primero necesita su nombre/)
  assert.equal(a.fijarFicha(db, 12, { estado: 'en prueba' }).estado, 'en prueba')
  assert.equal(a.fichaDe(db, 20).estado, 'vacío')
  const p = a.plantel(db)
  assert.deepEqual(p.plantel.map((x) => x.n), [12])
  assert.equal(p.porEstado['vacío'], 71)
  assert.equal(p.porEstado['en prueba'], 1)
  assert.deepEqual(a.revisarPlantel(db), [])
  // Una ficha vieja con un concepto como oficio aparece para corregir.
  db.prepare(`UPDATE arquetipo_fichas SET oficio = 'Profesionales por rubro' WHERE n = 12`).run()
  assert.match(a.revisarPlantel(db)[0].problema, /lista o un criterio/)
})
