/**
 * Correr un programa (ffmpeg, git) sin trabar el servidor. spawnSync congela el event loop mientras el programa corre:
 * un video del Taller (varios ffmpeg seguidos) dejaba la pantalla sin responder por segundos. Esto devuelve una promesa
 * y el servidor sigue atendiendo mientras tanto.
 */
import { spawn } from 'node:child_process'

export type Salida = { status: number | null; stdout: string; stderr: string; error: Error | null }

export function correr(cmd: string, args: string[], o: { cwd?: string; timeout?: number } = {}): Promise<Salida> {
  return new Promise((ok) => {
    let stdout = '', stderr = ''
    let p: ReturnType<typeof spawn>
    try { p = spawn(cmd, args, { cwd: o.cwd, windowsHide: true }) } catch (e) { return ok({ status: null, stdout, stderr, error: e as Error }) }
    const corte = o.timeout ? setTimeout(() => p.kill(), o.timeout) : null
    p.stdout?.on('data', (b: Buffer) => { stdout += b.toString() })
    p.stderr?.on('data', (b: Buffer) => { stderr = (stderr + b.toString()).slice(-20_000) })
    p.on('error', (e) => { if (corte) clearTimeout(corte); ok({ status: null, stdout, stderr, error: e }) })
    p.on('close', (status) => { if (corte) clearTimeout(corte); ok({ status, stdout, stderr, error: null }) })
  })
}
