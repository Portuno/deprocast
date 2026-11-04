import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { supervisar, vivo } from '../src/supervisor.ts'

const RAIZ = path.resolve(import.meta.dirname, '..')

function version(puerto: number): Promise<{ status: number; j: { commit?: string; activo?: boolean } }> {
  return new Promise((ok) => {
    const r = http.get({ host: '127.0.0.1', port: puerto, path: '/version', timeout: 10_000, agent: false }, (x) => {
      let b = ''
      x.on('data', (c) => (b += c))
      x.on('end', () => { try { ok({ status: x.statusCode ?? 0, j: JSON.parse(b) }) } catch { ok({ status: x.statusCode ?? 0, j: {} }) } })
    })
    r.on('error', () => ok({ status: 0, j: {} }))
    r.on('timeout', () => r.destroy())
  })
}

describe('el supervisor de la nube (plan v33, paso 6)', () => {
  it('cambia de versión sin que falle ningún pedido, y otro supervisor adopta el servidor que quedó', { timeout: 240_000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-'))
    const puerto = 7480 + Math.floor(Math.random() * 100) * 3
    const opciones = {
      puerto,
      host: '127.0.0.1',
      inicial: { dir: RAIZ, sha: 'a'.repeat(40) },
      estado: path.join(tmp, 'supervisor.json'),
      args: ['--db', path.join(tmp, 'prueba.db'), '--sin-rutinas', '--sin-telegram'],
      cadaMs: 3_600_000,
      log: () => {},
    }
    let nueva: { dir: string; sha: string } | null = { dir: RAIZ, sha: 'b'.repeat(40) }
    const s1 = await supervisar({ ...opciones, buscarNueva: async () => { const v = nueva; nueva = null; return v } })
    try {
      const a = await version(puerto)
      assert.equal(a.status, 200)
      assert.equal(a.j.commit, 'a'.repeat(40))
      const pidA = s1.actual()!.pid

      // Pedidos seguidos durante todo el relevo.
      let andando = true
      const fallas: string[] = []
      let pedidos = 0
      const carga = (async () => {
        while (andando) {
          const r = await version(puerto)
          pedidos++
          if (r.status !== 200) fallas.push(String(r.status))
          await new Promise((ok) => setTimeout(ok, 100))
        }
      })()
      await s1.revisar()
      andando = false
      await carga

      assert.deepEqual(fallas, [], `fallaron ${fallas.length} de ${pedidos}`)
      assert.ok(pedidos > 10)
      const b = await version(puerto)
      assert.equal(b.j.commit, 'b'.repeat(40))
      assert.equal(b.j.activo, true, 'la nueva quedó activa (corre lo de fondo)')
      assert.equal(vivo(pidA), false, 'la vieja se apagó')

      // El arranque de la imagen reinicia al supervisor: el servidor sigue y el próximo lo adopta.
      const pidB = s1.actual()!.pid
      await s1.cerrar({ dejarCorriendo: true })
      assert.ok(vivo(pidB))
      const s2 = await supervisar(opciones)
      try {
        assert.equal(s2.actual()!.pid, pidB, 'adoptó el mismo proceso')
        assert.equal((await version(puerto)).j.commit, 'b'.repeat(40))
      } finally {
        await s2.cerrar({ dejarCorriendo: false })
      }
      assert.equal(vivo(pidB), false)
    } finally {
      const x = s1.actual()
      if (x && vivo(x.pid)) try { process.kill(x.pid) } catch { /* ya no está */ }
      try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch { /* Windows suelta tarde */ }
    }
  })
})
