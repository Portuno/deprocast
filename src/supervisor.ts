/**
 * El supervisor de la nube (plan v33, paso 6): actualizar sin cortar.
 *
 * Antes, cada versión nueva apagaba la vieja y recién después arrancaba (minutos sin contestar). Ahora:
 * - el supervisor se queda con el puerto público y pasa cada conexión (TCP, tal cual) al servidor de verdad, que corre
 *   atrás en un puerto interno;
 * - cada minuto mira la rama en GitHub; si hay versión nueva, la baja y la arranca AL LADO, «en espera» (contesta pero no
 *   corre nada de fondo). Cuando ya está caliente, le pasa el tráfico, apaga la vieja y le manda «activar»;
 * - si la nueva se cae o no llega a estar lista, queda la vieja y esa versión no se reintenta;
 * - si el servidor se cae solo, lo vuelve a arrancar (mientras tanto, las conexiones esperan en vez de fallar);
 * - el arranque de la imagen (que no se actualiza) igual lo reinicia cada tanto: al cerrarse deja el servidor corriendo
 *   y anota cuál es, y el supervisor siguiente lo adopta. El corte es lo que tarda en volver a tomar el puerto.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'

export type Version = { dir: string; sha: string }
type Corriendo = Version & { puerto: number; pid: number; proc: ChildProcess | null; desde: number }

export type OpcionesSupervisor = {
  puerto: number
  host: string
  /** La versión con la que arranca si no hay un servidor para adoptar. */
  inicial: Version
  /** Dónde anota qué servidor corre (para que otro supervisor lo adopte). */
  estado: string
  /** La versión más nueva, si no está entre `no` (la que corre y las que fallaron). */
  buscarNueva?: (no: Set<string>) => Promise<Version | null>
  cadaMs?: number
  args?: string[]
  /** Cuánto esperar como mucho a que una versión arranque (y, si es un relevo, esté caliente). */
  maxArranqueMs?: number
  alCambiar?: (actual: Version, anterior: Version | null) => void
  log?: (t: string) => void
}

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const corto = (sha: string) => sha.slice(0, 7)

/** ¿Sigue vivo ese proceso? (Un zombi, en Linux, cuenta como muerto.) */
export function vivo(pid: number): boolean {
  try { process.kill(pid, 0) } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
  try { return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')) } catch { return true }
}

function version(puerto: number): Promise<{ commit: string | null; caliente?: boolean; activo?: boolean } | null> {
  return new Promise((ok) => {
    const r = http.get({ host: '127.0.0.1', port: puerto, path: '/version', timeout: 3000 }, (x) => {
      let b = ''
      x.on('data', (c) => (b += c))
      x.on('end', () => { try { ok(x.statusCode === 200 ? JSON.parse(b) : null) } catch { ok(null) } })
    })
    r.on('error', () => ok(null))
    r.on('timeout', () => r.destroy())
  })
}

export async function supervisar(o: OpcionesSupervisor) {
  const log = o.log ?? ((t: string) => console.log(`  ⇄ ${t}`))
  const PUERTOS = [o.puerto + 1, o.puerto + 2]
  const maxMs = o.maxArranqueMs ?? 6 * 60_000
  const malas = new Set<string>()
  let actual: Corriendo | null = null
  let anterior: Version | null = null
  let cerrado = false
  let ocupado = false
  let enCurso: { nuevo: Corriendo; fase: 'arrancando' | 'pasando'; listo: Promise<void> } | null = null

  // ─── el puerto público ───
  let destino: number | null = null
  const esperando = new Set<net.Socket>()
  const conectar = (c: net.Socket, puerto: number) => {
    c.setTimeout(0)
    const s = net.connect(puerto, '127.0.0.1')
    const fin = () => { c.destroy(); s.destroy() }
    c.on('error', fin); s.on('error', fin); c.on('close', fin); s.on('close', fin)
    c.pipe(s)
    s.pipe(c)
  }
  const proxy = net.createServer({ pauseOnConnect: true }, (c) => {
    if (destino) return conectar(c, destino)
    // Sin servidor listo (recién arrancado, o se cayó): la conexión espera en vez de fallar.
    if (esperando.size > 1000) return void c.destroy()
    esperando.add(c)
    c.on('close', () => esperando.delete(c))
    c.on('error', () => c.destroy())
    c.setTimeout(180_000, () => c.destroy())
  })
  const fijarDestino = (p: number | null) => {
    destino = p
    if (p) for (const c of [...esperando]) { esperando.delete(c); if (!c.destroyed) conectar(c, p) }
  }
  await new Promise<void>((ok, mal) => { proxy.once('error', mal); proxy.listen(o.puerto, o.host, () => ok()) })

  // ─── los servidores ───
  function lanzar(v: Version, puerto: number, enEspera: boolean): Corriendo {
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(v.dir, 'src', 'servidor.ts'), ...(o.args ?? [])], {
      cwd: v.dir,
      detached: process.platform !== 'win32', // sobrevive al supervisor (el siguiente lo adopta)
      windowsHide: true,
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, MASTRO_SUPERVISADO: '1', MASTRO_COMMIT: v.sha, MASTRO_PUERTO: String(puerto), MASTRO_HOST: '127.0.0.1', MASTRO_EN_ESPERA: enEspera ? '1' : '' },
    })
    proc.unref()
    proc.channel?.unref()
    return { ...v, puerto, pid: proc.pid ?? -1, proc, desde: Date.now() }
  }

  async function esperarListo(c: Corriendo, caliente: boolean) {
    const t0 = Date.now()
    let primera = 0
    for (;;) {
      if (!vivo(c.pid)) throw new Error('se cayó al arrancar')
      const v = await version(c.puerto)
      if (v) {
        primera ||= Date.now()
        // Caliente: ya corrió las rutas que la pantalla pide primero (o pasó un minuto y medio contestando).
        if (!caliente || v.caliente || Date.now() - primera > 90_000) return
      }
      if (Date.now() - t0 > maxMs) throw new Error('tardó demasiado en arrancar')
      await dormir(400)
    }
  }

  async function matar(c: Corriendo, maxMs = 15_000) {
    if (!vivo(c.pid)) return
    try { process.kill(c.pid, 'SIGTERM') } catch { return }
    const t0 = Date.now()
    while (vivo(c.pid) && Date.now() - t0 < maxMs) await dormir(200)
    if (vivo(c.pid)) try { process.kill(c.pid, 'SIGKILL') } catch { /* ya no está */ }
  }

  function guardar() {
    if (!actual) return
    try {
      fs.mkdirSync(path.dirname(o.estado), { recursive: true })
      fs.writeFileSync(o.estado, JSON.stringify({ pid: actual.pid, puerto: actual.puerto, sha: actual.sha, dir: actual.dir }))
    } catch (e) { log(`no pude anotar el estado: ${e instanceof Error ? e.message : e}`) }
  }

  /** Arranca una versión cuando no hay otra atendiendo (al empezar, o si se cayó). */
  async function arrancar(v: Version): Promise<void> {
    const libre = PUERTOS.find((p) => p !== actual?.puerto) ?? PUERTOS[0]
    log(`arranco el servidor (${corto(v.sha)}, puerto ${libre})`)
    const c = lanzar(v, libre, false)
    actual = c
    guardar()
    try {
      await esperarListo(c, false)
      fijarDestino(c.puerto)
      log(`contesta el servidor (${corto(v.sha)})`)
    } catch (e) {
      log(`la versión ${corto(v.sha)} no arrancó: ${e instanceof Error ? e.message : e}`)
      await matar(c, 3000)
      actual = null
      if (anterior && anterior.sha !== v.sha && !malas.has(anterior.sha)) {
        malas.add(v.sha)
        const a = anterior
        anterior = null
        return arrancar(a)
      }
      if (!cerrado) { await dormir(10_000); return arrancar(v) }
    }
  }

  /** El relevo: la nueva arranca al lado, en espera; cuando está caliente toma el tráfico y la vieja se apaga. */
  async function cambiarA(v: Version) {
    if (!actual || cerrado) return
    const viejo = actual
    const puerto = viejo.puerto === PUERTOS[0] ? PUERTOS[1] : PUERTOS[0]
    log(`versión nueva ${corto(v.sha)}: la arranco al lado (puerto ${puerto}) mientras atiende ${corto(viejo.sha)}`)
    const nuevo = lanzar(v, puerto, true)
    let soltar = () => {}
    enCurso = { nuevo, fase: 'arrancando', listo: new Promise<void>((ok) => (soltar = ok)) }
    try {
      try {
        await esperarListo(nuevo, true)
      } catch (e) {
        malas.add(v.sha)
        log(`la versión ${corto(v.sha)} no quedó lista (${e instanceof Error ? e.message : e}): sigue ${corto(viejo.sha)}`)
        await matar(nuevo, 3000)
        return
      }
      if (cerrado) return void (await matar(nuevo, 3000))
      enCurso.fase = 'pasando'
      fijarDestino(puerto)
      actual = nuevo
      anterior = { dir: viejo.dir, sha: viejo.sha }
      guardar()
      log(`${corto(v.sha)} atiende; apago ${corto(viejo.sha)}`)
      await dormir(1500) // lo que la vieja estaba contestando, que termine
      await matar(viejo, 8000)
      try { nuevo.proc?.send('activar') } catch { /* sin canal */ }
      log(`listo: corre ${corto(v.sha)}`)
      o.alCambiar?.(nuevo, anterior)
    } finally {
      enCurso = null
      soltar()
    }
  }

  async function revisar() {
    if (cerrado || ocupado || !actual || !o.buscarNueva) return
    ocupado = true
    try {
      const v = await o.buscarNueva(new Set([actual.sha, ...malas]))
      if (v && v.sha !== actual.sha && !malas.has(v.sha)) await cambiarA(v)
    } catch (e) { log(`no pude revisar la rama: ${e instanceof Error ? e.message : e}`) } finally { ocupado = false }
  }

  // ─── al empezar: adoptar el que ya corría, o arrancar ───
  let previo: { pid: number; puerto: number; sha: string; dir: string } | null = null
  try { previo = JSON.parse(fs.readFileSync(o.estado, 'utf8')) } catch { /* no había */ }
  if (previo && PUERTOS.includes(previo.puerto) && vivo(previo.pid) && (await version(previo.puerto))) {
    actual = { ...previo, proc: null, desde: 0 }
    fijarDestino(previo.puerto)
    log(`adopto el servidor que ya corría (${corto(previo.sha)}, puerto ${previo.puerto})`)
  } else {
    if (previo && vivo(previo.pid)) await matar({ ...previo, proc: null, desde: 0 }, 5000)
    await arrancar(o.inicial)
  }

  // Si el servidor se cae solo, vuelve (las conexiones esperan mientras tanto).
  let reviviendo = false
  const vigia = setInterval(async () => {
    if (cerrado || reviviendo || enCurso || !actual || vivo(actual.pid)) return
    reviviendo = true
    const caido = actual
    log(`el servidor (${corto(caido.sha)}) se cayó: lo vuelvo a arrancar`)
    fijarDestino(null)
    try {
      if (Date.now() - caido.desde < 60_000 && anterior && anterior.sha !== caido.sha) {
        malas.add(caido.sha)
        const a = anterior
        anterior = null
        await arrancar(a)
      } else await arrancar(caido)
    } finally { reviviendo = false }
  }, 3000)
  const reloj = setInterval(() => void revisar(), o.cadaMs ?? 60_000)
  if (o.buscarNueva) setTimeout(() => void revisar(), 5000).unref()

  /**
   * Cerrar. Con `dejarCorriendo` (lo reinicia el arranque de la imagen), el servidor sigue y el próximo supervisor lo
   * adopta. Un relevo a medio arrancar se descarta; uno que ya pasó el tráfico se termina primero.
   */
  async function cerrar(c: { dejarCorriendo: boolean }) {
    cerrado = true
    clearInterval(vigia)
    clearInterval(reloj)
    if (enCurso?.fase === 'arrancando') await matar(enCurso.nuevo, 3000)
    else if (enCurso) await enCurso.listo
    await new Promise<void>((ok) => proxy.close(() => ok()))
    for (const s of esperando) s.destroy()
    if (!c.dejarCorriendo && actual) await matar(actual)
    else guardar()
  }

  return { cerrar, revisar, actual: () => actual, destino: () => destino }
}

// ─── en la nube ───

/** Deja una copia de esa versión en su carpeta (la del arranque de la imagen la puede borrar mientras corre). */
function copiar(origen: string, dir: string, sha: string): string {
  const destino = path.join(dir, sha)
  if (fs.existsSync(path.join(destino, 'src', 'servidor.ts'))) return destino
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${destino}.tmp`
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.cpSync(origen, tmp, { recursive: true, verbatimSymlinks: true, filter: (f) => path.basename(f) !== '.git' })
  fs.rmSync(destino, { recursive: true, force: true })
  fs.renameSync(tmp, destino)
  return destino
}

/** Deja solo las versiones que sirven (la que corre y la anterior). */
function limpiar(dir: string, mantener: string[]) {
  try {
    for (const d of fs.readdirSync(dir)) if (!d.endsWith('.json') && !mantener.includes(d)) fs.rmSync(path.join(dir, d), { recursive: true, force: true })
  } catch { /* nada que limpiar */ }
}

export async function principal() {
  const { bajar, shaDeRama } = await import('./arranque-nube.ts')
  const codigo = path.resolve(import.meta.dirname, '..')
  const repo = process.env.MASTRO_REPO ?? ''
  const rama = process.env.MASTRO_RAMA ?? 'main'
  const base = process.env.MASTRO_CODIGO ?? '/data/codigo'
  const dir = process.env.MASTRO_CODIGO_SUP ?? path.join(path.dirname(base), 'codigo-sup')
  const commit = process.env.MASTRO_COMMIT ?? ''
  const sha = commit && commit !== 'imagen' ? commit : path.basename(codigo)
  // La de la imagen no se borra nunca: corre de ahí. Las bajadas, de una copia propia.
  const inicial: Version = commit === 'imagen' ? { sha: 'imagen', dir: codigo } : { sha, dir: copiar(codigo, dir, sha) }
  const args: string[] = []
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--puerto') i++; else args.push(argv[i]) }

  const s = await supervisar({
    puerto: Number(process.env.MASTRO_PUERTO ?? 3000),
    host: process.env.MASTRO_HOST ?? '0.0.0.0',
    inicial,
    estado: path.join(dir, 'supervisor.json'),
    args,
    cadaMs: Number(process.env.MASTRO_SUPERVISOR_SEG ?? 60) * 1000,
    buscarNueva: async (no) => {
      const ultimo = await shaDeRama(repo, rama)
      if (!ultimo || no.has(ultimo)) return null
      return { sha: ultimo, dir: await bajar(ultimo, dir, repo) }
    },
    alCambiar: (a, b) => limpiar(dir, [a.sha, ...(b ? [b.sha] : [])]),
  })
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => { void s.cerrar({ dejarCorriendo: true }).finally(() => process.exit(0)) })
  }
}
