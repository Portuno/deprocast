/**
 * El hub de procesos (plan v33, paso 5): cada usuario tiene su propio Deprocast, un proceso aparte con su base en
 * `usuarios/<id>/`, escuchando solo en 127.0.0.1. Un usuario creado queda prendido siempre (sus agentes y rutinas
 * siguen aunque no entre), sin límite de cantidad: al arrancar el hub se prenden todos los activos, escalonados, y si
 * uno se cae vuelve a arrancar solo (esperando cada vez un poco más si se cae en seguida). Solo se apaga si el dueño lo
 * suspende o lo borra.
 *
 * Aislamiento:
 * - su carpeta es su directorio de trabajo, así todo lo que va a `data/...` queda adentro;
 * - el entorno pasa por una lista blanca: el modelo (NaN) sí, la clave del dueño, Telegram, el calendario y las demás
 *   claves suyas no;
 * - cada pedido lleva la cabecera del hub solo si el hub ya verificó la sesión de ese usuario;
 * - tope duro de tokens por día (MASTRO_TOPE_DIA), que cuenta todo, también lo que pide él.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { CABECERA_HUB } from '../acceso.ts'

export type Hijo = { id: number; puerto: number; proc: ChildProcess; listo: Promise<void>; listoYa: boolean; ultimo: number; activos: number; salio: Promise<void> }

export type OpcionesHub = {
  /** Donde van las carpetas: `<datos>/usuarios/<id>/`. */
  datos: string
  /** Puertos fijos (base + id). Sin esto, cada uno toma un puerto libre (así dos servidores en un relevo no chocan). */
  puertoBase?: number
  /** El tope duro de tokens por día de ese usuario (0 = sin tope). */
  topeDe?: (id: number) => number
  /** Cuánto esperar a que arranque. */
  esperaMs?: number
}

/** Lo que pasa del entorno del dueño al de un usuario. Todo lo demás (claves, tokens, su calendario) se queda. */
const PASAN = /^(PATH|Path|PATHEXT|SYSTEMROOT|SystemRoot|WINDIR|windir|COMSPEC|ComSpec|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_ALL|TZ|NAN_API_KEY|NAN_BASE_URL|NAN_CADENA_[A-Z_]+|NAN_MIMO_ID|MASTRO_MOTOR|MASTRO_EMBED_MODEL|MASTRO_ZONA|MASTRO_COMMIT)$/

export function entornoDeUsuario(base: NodeJS.ProcessEnv, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) if (v !== undefined && PASAN.test(k)) env[k] = v
  return { ...env, ...extra }
}

export const dirDeUsuario = (datos: string, id: number) => path.join(datos, 'usuarios', String(Math.trunc(id)))

export function crearHub(o: OpcionesHub) {
  const token = crypto.randomBytes(32).toString('hex')
  const hijos = new Map<number, Hijo>()
  const prendiendo = new Map<number, Promise<Hijo>>()
  /** Los que tienen que estar prendidos: si se caen, vuelven. */
  const quieren = new Set<number>()
  const caidas = new Map<number, number>()
  let apagando = false
  const script = path.resolve(import.meta.dirname, '..', 'servidor.ts')

  /** Lo prende una sola vez aunque lo pidan varios a la vez. */
  function prenderUna(id: number): Promise<Hijo> {
    const ya = prendiendo.get(id)
    if (ya) return ya
    const p = (async () => prender(id, o.puertoBase ? o.puertoBase + id : await puertoLibre()))().finally(() => prendiendo.delete(id))
    prendiendo.set(id, p)
    return p
  }

  function prender(id: number, puerto: number): Hijo {
    const dir = dirDeUsuario(o.datos, id)
    fs.mkdirSync(dir, { recursive: true })
    const env = entornoDeUsuario(process.env, {
      MASTRO_USUARIO: String(id),
      MASTRO_HUB_TOKEN: token,
      MASTRO_HOST: '127.0.0.1',
      MASTRO_TELEGRAM: '0',
      MASTRO_TOPE_DIA: String(o.topeDe?.(id) ?? 0),
    })
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', script, '--db', path.join(dir, 'deprocast.db'), '--puerto', String(puerto), '--sin-telegram'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    // Su consola, con su número adelante (a la salida estándar: no ensucia los errores del dueño).
    const eco = (b: Buffer) => { for (const l of b.toString('utf8').split('\n')) if (l.trim()) process.stdout.write(`  [u${id}] ${l}\n`) }
    proc.stdout?.on('data', eco)
    proc.stderr?.on('data', eco)
    const desde = Date.now()
    const salio = new Promise<void>((ok) => proc.once('exit', (codigo) => {
      if (hijos.get(id)?.proc === proc) {
        hijos.delete(id)
        // Se cayó solo (no lo paramos): vuelve. Si duró poco, espera más cada vez (5 s, 10 s… hasta 5 min).
        if (quieren.has(id) && !apagando) {
          const n = Date.now() - desde > 120_000 ? 0 : (caidas.get(id) ?? 0) + 1
          caidas.set(id, n)
          const espera = Math.min(300_000, 5000 * 2 ** n)
          process.stdout.write(`  [u${id}] salió (${codigo}): lo vuelvo a prender en ${Math.round(espera / 1000)} s\n`)
          setTimeout(() => { if (quieren.has(id) && !apagando && !hijos.has(id)) void prenderUna(id).catch(() => {}) }, espera).unref()
        }
      }
      ok()
    }))
    const listo = esperarListo(puerto, proc, o.esperaMs ?? 120_000)
    const h: Hijo = { id, puerto, proc, listo, listoYa: false, ultimo: Date.now(), activos: 0, salio }
    listo.then(() => { h.listoYa = true }, () => { try { proc.kill() } catch { /* ya no está */ } })
    hijos.set(id, h)
    return h
  }

  /** El Deprocast de ese usuario, prendido y listo para contestar. */
  async function asegurar(id: number): Promise<Hijo> {
    quieren.add(id)
    let h = hijos.get(id)
    if (!h || h.proc.exitCode !== null) h = await prenderUna(id)
    h.ultimo = Date.now()
    await h.listo
    return h
  }

  /** Pasa el pedido (tal cual, en streaming: subidas grandes y respuestas que van llegando) al Deprocast de ese usuario. */
  async function reenviar(req: http.IncomingMessage, res: http.ServerResponse, id: number, ruta: string, conSesion: boolean) {
    let h: Hijo
    try { h = await asegurar(id) } catch (e) {
      return void res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '30' }).end(e instanceof Error ? e.message : String(e))
    }
    const headers = { ...req.headers }
    delete headers[CABECERA_HUB]
    if (conSesion) headers[CABECERA_HUB] = token
    h.activos++
    let cerrado = false
    const terminar = () => { if (cerrado) return; cerrado = true; h.activos--; h.ultimo = Date.now() }
    const p = http.request({ host: '127.0.0.1', port: h.puerto, method: req.method, path: ruta, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(res)
    })
    p.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end('Tu Deprocast no contestó. Probá de nuevo en unos segundos.')
      else res.destroy()
      terminar()
    })
    res.on('close', () => { if (!res.writableFinished) p.destroy(); terminar() })
    req.pipe(p)
  }

  /** Prende a todos esos, de a uno cada `escalonMs` (para no competir entre ellos ni con el arranque del dueño). */
  function mantener(ids: number[], escalonMs = 3000) {
    ids.forEach((id, i) => { quieren.add(id); setTimeout(() => { if (!apagando) void asegurar(id).catch(() => {}) }, i * escalonMs).unref() })
  }

  /** Lo apaga y no lo vuelve a prender (suspendido o borrado). */
  async function parar(id: number) {
    quieren.delete(id)
    const h = hijos.get(id)
    if (!h) return
    hijos.delete(id)
    try { h.proc.kill() } catch { /* ya no está */ }
    await Promise.race([h.salio, new Promise((ok) => setTimeout(ok, 10_000))])
  }

  /** Para reiniciarlo (un tope nuevo): lo apaga y lo vuelve a prender. */
  async function reiniciar(id: number) {
    await parar(id)
    await asegurar(id)
  }

  async function pararTodos() {
    apagando = true
    await Promise.all([...hijos.keys()].map(parar))
  }

  const vivos = () => [...hijos.values()].map((h) => ({ id: h.id, puerto: h.puerto, ultimo: h.ultimo, activos: h.activos, listo: h.listoYa, pid: h.proc.pid }))

  return { token, asegurar, reenviar, mantener, parar, reiniciar, pararTodos, vivos }
}

export type Hub = ReturnType<typeof crearHub>

/** Un puerto libre de esta compu (lo pide al sistema y lo suelta). */
function puertoLibre(): Promise<number> {
  return new Promise((ok, mal) => {
    const s = net.createServer()
    s.on('error', mal)
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => ok(port)) })
  })
}

/** Espera a que el proceso conteste /version (o que se caiga). */
function esperarListo(puerto: number, proc: ChildProcess, maxMs: number): Promise<void> {
  const desde = Date.now()
  return new Promise((ok, mal) => {
    let terminado = false
    proc.once('exit', (c) => { if (!terminado) { terminado = true; mal(new Error(`Tu Deprocast no arrancó (salió con ${c}).`)) } })
    const probar = () => {
      if (terminado) return
      const r = http.get({ host: '127.0.0.1', port: puerto, path: '/version', timeout: 2000 }, (x) => {
        x.resume()
        if (x.statusCode === 200 && !terminado) { terminado = true; ok() } else otraVez()
      })
      r.on('error', otraVez)
      r.on('timeout', () => r.destroy())
    }
    const otraVez = () => {
      if (terminado) return
      if (Date.now() - desde > maxMs) { terminado = true; return mal(new Error('Tu Deprocast tardó demasiado en arrancar.')) }
      setTimeout(probar, 250)
    }
    probar()
  })
}
