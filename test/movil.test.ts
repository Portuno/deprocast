import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('La app nativa usa la misma conciencia acústica que el servidor (el mismo archivo, sin desviarse)', () => {
  for (const f of ['acustica.ts', 'rasgos.ts', 'movimiento.ts']) {
    const servidor = fs.readFileSync(`src/conciencia/${f}`, 'utf8')
    const movil = fs.readFileSync(`apps/movil/src/conciencia/${f}`, 'utf8')
    assert.equal(movil, servidor, `si cambiás src/conciencia/${f}, copialo a apps/movil/src/conciencia/${f}`)
  }
})
