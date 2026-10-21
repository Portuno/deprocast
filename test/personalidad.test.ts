import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

process.env.TZ = 'Europe/Madrid'

const { abrir } = await import('../src/db.ts')
const { nombraDePila, personalidad, vozPara } = await import('../src/personalidad.ts')
const { promptDiario, promptMastropiero } = await import('../src/chat/index.ts')

test('Personalidad: sale del documento, trata de usted y pone lo útil primero', () => {
  const p = personalidad()
  assert.ok(p.length > 2000, 'el prompt se lee de docs/personalidad/mastropiero.md')
  assert.match(p, /^Personalidad: Mastropiero, el compositor/)
  assert.match(p, /Usted es Mastropiero/)
  assert.match(p, /Lo útil primero, exacto y entero/)
  assert.match(p, /Cero personaje en lo íntimo o lo urgente/)
  assert.doesNotMatch(p, /Mundstock|O'Connor/, 'sin quienes lo presentaban en escena')
  assert.doesNotMatch(p, /\bvos\b|\btenés\b|\bquerés\b/, 'nada de voseo en su boca')
  assert.match(p, /Prohibido hablar en contraposición/, 'la regla del Gem')
})

test('Personalidad: cada superficie con su dosis; lo íntimo y lo técnico, sin personaje', () => {
  assert.match(vozPara('ceremonia'), /Dosis de personalidad: PLENA/)
  assert.match(vozPara('chat'), /Dosis de personalidad: MÍNIMA/)
  assert.equal(vozPara('intima'), '')
  assert.equal(vozPara('tecnica'), '')
  assert.equal(vozPara('voz_del_operador'), '')
})

test('El chat de Mastropiero lo trata de usted (con la personalidad); el diario, de usted y sin personaje', () => {
  const db = abrir(':memory:')
  const chat = promptMastropiero(db, 'hola')
  assert.match(chat, /tratándolo siempre de usted/)
  assert.doesNotMatch(chat, /con voseo/)
  assert.doesNotMatch(chat, /«en tus audios»|la nombrás|«anotaste…»/, 'todos los ejemplos pasaron al usted')
  assert.match(chat, /usted la nombra como la que empuja la parte legal/)
  assert.match(chat, /Dosis de personalidad: MÍNIMA/)
  const diario = promptDiario(db)
  assert.match(diario, /tratándolo de usted/)
  assert.doesNotMatch(diario, /Dosis de personalidad/)
})

test('La guardia del nombre: ningún nombre de pila pegado a Mastropiero (se detecta sin escribir ninguno)', () => {
  assert.equal(nombraDePila('Ruperto Mastropiero compuso esto'), 'Ruperto Mastropiero')
  assert.equal(nombraDePila('Le escribe Ruperto Anselmo Mastropiero'), 'Ruperto Anselmo Mastropiero')
  for (const ok of ['Harold Mastropiero, su gemelo', 'Azuceno Mastropiero coescribió', 'Los Premios Mastropiero', 'Etcétera Mastropiero firmó la tercera', 'Don Juan de Mastropiero', 'Usted es Mastropiero', 'Soy Mastropiero.', 'el bolero de Mastropiero']) {
    assert.equal(nombraDePila(ok), null, ok)
  }
  // El propio documento la cumple.
  assert.equal(nombraDePila(fs.readFileSync(new URL('../docs/personalidad/mastropiero.md', import.meta.url), 'utf8')), null)
})
