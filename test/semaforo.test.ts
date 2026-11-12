import { test } from 'node:test'
import assert from 'node:assert/strict'
import { semaforo } from '../src/semaforo.ts'

test('#244: de a 6 a la vez: diez pasos encolados nunca tienen más de seis activos, y terminan todos (también si alguno falla)', async () => {
  const s = semaforo(() => 6)
  let activos = 0, pico = 0
  const paso = (i: number) => s.con(async () => {
    activos++
    pico = Math.max(pico, activos)
    await new Promise((ok) => setTimeout(ok, 5 + (i % 3) * 5))
    activos--
    if (i === 4) throw new Error('un paso que falla suelta su lugar')
    return i
  })
  const r = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => paso(i)))
  assert.equal(pico, 6)
  assert.equal(s.pico, 6)
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 9)
  assert.equal(s.activos, 0)
  assert.equal(s.esperando, 0)
})
