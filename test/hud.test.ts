import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarEscriba, conversacionHoy, enviar, mensajes, promptMastropiero, registrarEvento } from '../src/chat/index.ts'
import { _probarModelo } from '../src/modelo.ts'

_probarEscriba(async () => {})

test('HUD: las líneas de registro quedan en la conversación pero no van al modelo; el modo que mira entra al prompt', async () => {
  const db = abrir(':memory:')
  const c = conversacionHoy(db)
  registrarEvento(db, c.id, '  ✓ banda   «Escribir el capítulo III» hecha ')
  registrarEvento(db, c.id, '   ')
  assert.deepEqual(mensajes(db, c.id).map((m) => [m.rol, m.texto]), [['evento', '✓ banda «Escribir el capítulo III» hecha']])

  let visto: any = null
  _probarModelo(async (_l, o) => { visto = o; return { texto: 'Vas bien.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 } })
  await enviar(db, c.id, '¿cómo voy?', { hud: 'cuerpo' })
  assert.match(String(visto.mensajes[0].content), /En su panel de Hoy está mirando: Cuerpo \(calorías, proteína, sueño/)
  assert.ok(!JSON.stringify(visto.mensajes.slice(1)).includes('Escribir el capítulo III'), 'el registro no viaja al modelo')
  assert.doesNotMatch(promptMastropiero(db, 'hola'), /está mirando/, 'sin HUD, nada')
  assert.doesNotMatch(promptMastropiero(db, 'hola', 'inventado'), /está mirando/)
})
