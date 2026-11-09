import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { abrirFichaIdea } from '../src/ideas.ts'
import { HERRAMIENTAS } from '../src/chat/herramientas.ts'

test('la ficha de idea (Fragua #159): de la frase suelta a una side quest de 7 días, atada al proyecto', () => {
  const db = abrir(':memory:')
  const p = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Versa' })
  const ahora = new Date('2026-11-09T10:00:00').getTime()
  const r = abrirFichaIdea(db, { idea: 'Clonar Revolut y Stripe', queEs: 'Pagos entre clientes de Versa', codigoYPermiso: 'El código es la app; el permiso es una licencia de entidad de pago', prueba7Dias: 'Cobrarle a un cliente real con un link de pago de Stripe', primerCliente: 'Un cliente actual de Versa', proyecto: 'versa' }, ahora)
  assert.equal(r.proyecto, p)
  assert.equal(r.mision.nivel, 'terciaria')
  assert.equal(r.mision.titulo, 'Probar: Cobrarle a un cliente real con un link de pago de Stripe')
  assert.equal(r.mision.vence, '2026-11-16')
  assert.match(r.mision.detalle!, /Código y permisos: El código es la app; el permiso es una licencia/)
  assert.throws(() => abrirFichaIdea(db, { idea: 'Algo', queEs: '', codigoYPermiso: '', prueba7Dias: '', primerCliente: '' }), /7 días/)
  assert.ok(HERRAMIENTAS.some((h) => h.nombre === 'abrir_ficha_idea'))
})
