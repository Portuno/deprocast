import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { crearMision } from '../src/misiones.ts'
import { resolverLote, tandaParaValidar } from '../src/sombra.ts'

test('Mobile · la tanda para validar: lo que más pesa, de a sí o no, y responder la saca de la bandeja', async () => {
  const db = abrir(':memory:')
  const T = Date.now()
  for (let i = 0; i < 6; i++) crearMision(db, { nivel: 'primaria', titulo: `Primaria ${i}`, estado: 'sugerida' }, { ahora: T })
  const t = tandaParaValidar(db, 10, T)
  assert.equal(t.tarjetas.length, 4, 'como mucho 4 por grupo, para que la tanda mezcle')
  assert.ok(t.total >= 6)
  const x = t.tarjetas[0]
  assert.equal(x.tipo, 'primaria')
  assert.equal(x.grupo, 'Primarias que te propone')
  assert.ok(x.si && x.no && !x.si.startsWith('✓'), 'las etiquetas, sin el tilde')
  const r = await resolverLote(db, [{ tipo: x.tipo, id: x.id, accion: 'aceptar' }], T)
  assert.equal(r.hechas, 1)
  assert.ok(!tandaParaValidar(db, 10, T).tarjetas.some((y) => y.id === x.id), 'la respondida ya no vuelve')
})
