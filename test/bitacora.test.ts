import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { cambiarEntrada, compartidas, disparadorDe, escribir, leerBitacora } from '../src/bitacora.ts'
import { buscar } from '../src/corpus.ts'

test('bitácora: privada por defecto, cifrada con su clave (no se guarda), compartida solo si él quiere', () => {
  const db = abrir(':memory:')
  const abierta = escribir(db, { texto: 'Hoy fue un día raro, pensé en cambiar todo', animo: 7 })
  assert.equal(abierta.animo, 5)
  const secreta = escribir(db, { texto: 'Lo que no le dije a nadie', clave: 'mi-clave-larga' })
  assert.equal(secreta.texto, 'Lo que no le dije a nadie', 'al escribirla la ve')
  const crudo = (db.prepare('SELECT texto FROM bitacora WHERE id = ?').get(secreta.id) as any).texto
  assert.ok(crudo.startsWith('v1:') && !crudo.includes('nadie'), 'en la base, cifrada')

  assert.equal(leerBitacora(db).find((e) => e.id === secreta.id)!.texto, null, 'sin clave no se lee')
  assert.equal(leerBitacora(db, { clave: 'otra-clave' }).find((e) => e.id === secreta.id)!.texto, null, 'con otra, tampoco')
  assert.equal(leerBitacora(db, { clave: 'mi-clave-larga' }).find((e) => e.id === secreta.id)!.texto, 'Lo que no le dije a nadie')

  assert.deepEqual(compartidas(db), [], 'Mastropiero no ve nada por defecto')
  assert.deepEqual(buscar(db, 'raro', 5), [], 'no está en el corpus')
  cambiarEntrada(db, abierta.id, { compartida: true })
  assert.deepEqual(compartidas(db).map((e) => e.texto), ['Hoy fue un día raro, pensé en cambiar todo'])
  assert.throws(() => cambiarEntrada(db, secreta.id, { compartida: true }), /cifrada no se puede compartir/)
  assert.throws(() => escribir(db, { texto: 'x', clave: 'abcdefg', compartida: true }), /no se puede compartir/)
  assert.throws(() => escribir(db, { texto: 'x', clave: 'corta' }), /6 caracteres/)
  assert.throws(() => escribir(db, { texto: '  ' }), /vacía/)

  cambiarEntrada(db, secreta.id, { borrar: true })
  assert.equal(leerBitacora(db).length, 1)
  assert.ok(disparadorDe('2026-10-08').endsWith('?'))
})
