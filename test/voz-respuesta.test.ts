import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { canalVoz, fijarVozDelCanal, marcoParaVoz, tocaVoz, vozDelCanal } from '../src/voz-respuesta.ts'

test('Fragua #311 · la voz por canal: WhatsApp y Telegram cada uno la suya', () => {
  const db = abrir(':memory:')
  assert.equal(vozDelCanal(db, 'whatsapp'), '1')
  assert.equal(vozDelCanal(db, 'telegram'), '0')
  fijarVozDelCanal(db, 'whatsapp', 'siempre')
  assert.equal(vozDelCanal(db, 'whatsapp'), 'siempre')
  assert.equal(vozDelCanal(db, 'telegram'), '0')
  assert.throws(() => fijarVozDelCanal(db, 'telegram', 'a veces'))
  assert.equal(canalVoz('WhatsApp'), 'whatsapp')
  assert.equal(canalVoz('Telegram'), 'telegram')
  assert.equal(tocaVoz('1', true), true)
  assert.equal(tocaVoz('1', false), false)
  assert.equal(tocaVoz('siempre', false), true)
  assert.equal(tocaVoz('0', true), false)
})

test('Fragua #311 · el audio lleva solo el marco: sin listas ni números, y nada para un turno corto', () => {
  // Turno corto: sin audio.
  assert.equal(marcoParaVoz('Anotado. Mañana te lo recuerdo.'), null)
  assert.equal(marcoParaVoz('Listo.\nLo dejé en Hoy.'), null)
  // Todo datos: sin audio.
  assert.equal(marcoParaVoz('Tus gastos:\n- Súper 42 €\n- Nafta 30 €\n- Bar 12 €'), null)
  // Una idea con su lista: el marco va en audio, la lista y los números no.
  const r = marcoParaVoz([
    'Lo que me contás tiene una forma clara: estás esperando permiso para algo que ya decidiste, y eso te frena más que el miedo.',
    'Te propongo esto:',
    '- Escribir la primera versión hoy a las 18:00',
    '- Mandársela a **dos** personas',
    'La idea no es que salga perfecto, sino que salga. Lo demás se corrige andando, como siempre te pasó cuando te animaste. Cuesta 3 días como mucho.',
  ].join('\n'))
  assert.ok(r)
  assert.match(r!, /^Lo que me contás tiene una forma clara/)
  assert.match(r!, /Te propongo esto\./)
  assert.doesNotMatch(r!, /18:00|Mandársela|3 días|\*\*/)
  assert.match(r!, /El detalle te lo dejé escrito\.$/)
  // Pura prosa: sin el aviso del detalle.
  const p = marcoParaVoz('Creo que el nudo está en otro lado.\nNo es la falta de tiempo: es que el proyecto todavía no tiene una forma que te entusiasme.\nCuando la tenga, el tiempo aparece solo, como apareció para lo que de verdad te importó.')
  assert.ok(p && !/El detalle/.test(p))
})
