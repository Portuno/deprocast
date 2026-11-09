import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { abrir } from '../src/db.ts'
import { archivoDe, borrarCapsula, guardarCapsula, listarCapsulas } from '../src/capsulas.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capsulas-'))
const antes = process.env.MASTRO_DB
before(() => { process.env.MASTRO_DB = path.join(tmp, 'x.db') })
after(() => { process.env.MASTRO_DB = antes; fs.rmSync(tmp, { recursive: true, force: true }) })

test('las cápsulas de 40 s (Fragua #163): sin consentimiento ni uso escrito no se guarda; se borran a pedido y queda el rastro', async () => {
  const db = abrir(':memory:')
  const video = Buffer.from('webm de prueba')
  await assert.rejects(guardarCapsula(db, video, { persona: 'Ana Pérez', uso: 'Testimonio para la web', consentimiento: 'x' }), /consentimiento/)
  await assert.rejects(guardarCapsula(db, video, { persona: 'Ana Pérez', uso: '', consentimiento: 'x', acepto: true }), /para qué se va a usar/)
  await assert.rejects(guardarCapsula(db, video, { persona: 'Ana Pérez', uso: 'x', consentimiento: 'x', acepto: true, duracion: 90 }), /40 segundos/)
  const c = await guardarCapsula(db, video, { persona: 'Ana Pérez', uso: 'Testimonio para la web de Versa', consentimiento: 'Ana aceptó…', acepto: '1', duracion: '38.5' })
  assert.equal(fs.readFileSync(archivoDe(c), 'utf8'), 'webm de prueba')
  const b = borrarCapsula(db, c.id, 'a pedido de la persona')
  assert.equal(b.estado, 'borrada')
  assert.ok(!fs.existsSync(archivoDe(c)), 'el video se borra del servidor')
  assert.equal(listarCapsulas(db)[0].consentimiento, 'Ana aceptó…', 'queda el rastro del consentimiento')
})
