import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shaDeRama } from '../src/arranque-nube.ts'

const respuesta = (cuerpo: string, ok = true) => (async () => ({ ok, text: async () => cuerpo })) as unknown as typeof fetch
const SHA_MAIN = 'a'.repeat(40)
const SHA_OTRA = 'b'.repeat(40)
const REFS = `001e# service=git-upload-pack\n0000015${SHA_OTRA} HEAD\0multi_ack\n003f${SHA_OTRA} refs/heads/main-vieja\n003f${SHA_MAIN} refs/heads/main\n0000`

test('arranque en la nube: lee la punta de la rama exacta (no una que empiece igual)', async () => {
  assert.equal(await shaDeRama('alguien/repo', 'main', respuesta(REFS)), SHA_MAIN)
  assert.equal(await shaDeRama('alguien/repo', 'main-vieja', respuesta(REFS)), SHA_OTRA)
  assert.equal(await shaDeRama('alguien/repo', 'otra', respuesta(REFS)), null)
  assert.equal(await shaDeRama('alguien/repo', 'main', respuesta('', false)), null)
})
