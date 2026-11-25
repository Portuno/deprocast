import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { guardarRelacion } from '../src/personas.ts'
import { asegurarFuente, insertar } from '../src/corpus.ts'
import { buscarParaTelefono, contactoHoy, genteParaTelefono, piezaParaTelefono, respirarParaTelefono } from '../src/movil.ts'

const DIA = 86_400_000

test('Mobile 2.8 · buscar desde el teléfono: el corpus, las personas y la pieza para leer', async () => {
  const db = abrir(':memory:')
  asegurarFuente(db, { id: 'notas', nombre: 'Notas', nivel: 'propia', descripcion: '' })
  const id = insertar(db, { fuente: 'notas', nivel: 'propia', tipo: 'materia', estado: 'disponible', titulo: 'Plan de la huerta', contenido: 'Sembrar tomates en marzo y lechugas en abril.', fecha: '2026-11-01' })!
  asegurarEntidad(db, { tipo: 'persona', nombre: 'Tomás Gil' })
  const r = await buscarParaTelefono(db, 'tomates')
  assert.ok(r.piezas.some((p) => p.id === id), JSON.stringify(r.piezas))
  assert.equal((await buscarParaTelefono(db, 'Tomás')).personas[0]?.nombre, 'Tomás Gil')
  assert.deepEqual(await buscarParaTelefono(db, 'x'), { piezas: [], personas: [], misiones: [], lugares: [], charla: [] })
  const p = await piezaParaTelefono(db, id)
  assert.equal(p!.titulo, 'Plan de la huerta')
  assert.equal(await piezaParaTelefono(db, 99999), null)
})

test('Mobile 2.8 · tu gente: primero a quién le toca (se pasó su «cada cuántos días»); «hablé hoy» lo saca de ahí', async () => {
  const db = abrir(':memory:')
  const ahora = Date.now()
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana' })
  const juan = asegurarEntidad(db, { tipo: 'persona', nombre: 'Juan' })
  guardarRelacion(db, ana, { cadaDias: 7, contacto: new Date(ahora - 20 * DIA).toISOString().slice(0, 10), importancia: 9 }, ahora)
  guardarRelacion(db, juan, { importancia: 8, contacto: new Date(ahora - 3 * DIA).toISOString().slice(0, 10) }, ahora)
  let g = await genteParaTelefono(db, ahora)
  assert.deepEqual(g.toca.map((x) => x.nombre), ['Ana'])
  assert.deepEqual(g.importantes.map((x) => x.nombre), ['Juan'])
  await contactoHoy(db, ana, ahora)
  g = await genteParaTelefono(db, ahora)
  assert.equal(g.toca.length, 0)
})

test('Mobile 2.8 · respirar: los ejercicios con sus fases', async () => {
  const db = abrir(':memory:')
  const r = await respirarParaTelefono(db)
  const caja = r.ejercicios.find((e) => e.id === 'base:caja')!
  assert.deepEqual(caja.fases.map((f) => f.tipo), ['inhalar', 'retener', 'exhalar', 'sostener'])
  assert.ok(caja.segundos > 0)
})
