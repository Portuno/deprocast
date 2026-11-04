/**
 * El hub de procesos (plan v33, paso 5): cada usuario tiene su propio Deprocast, un proceso aparte con su base en
 * `usuarios/<id>/`, escuchando solo en 127.0.0.1. Se prende recién cuando hace falta (entra, o una app suya llama),
 * se apaga solo tras un rato sin uso, y como mucho hay `maxVivos` prendidos a la vez (se apaga el más ocioso).
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
import path from 'node:path'
import { CABECERA_HUB } from '../acceso.ts'

export type Hijo = { id: number; puerto: number; proc: ChildProcess; listo: Promise<void>; listoYa: boolean; ultimo: number; activos: number; salio: Promise<void> }

export type OpcionesHub = {
  /** Donde van las carpetas: `<datos>/usuarios/<id>/`. */
  datos: string
  puertoBase?: number
  maxVivos?: number
  ociosoMs?: number
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
  const puertoBase = o.puertoBase ?? 7600
  const maxVivos = o.maxVivos ?? 4
  const ociosoMs = o.ociosoMs ?? 20 * 60_000
  const script = path.resolve(import.meta.dirname, '..', 'servidor.ts')

  function prender(id: number): Hijo {
    const dir = dirDeUsuario(o.datos, id)
    fs.mkdirSync(dir, { recursive: true })
    const puerto = puertoBase + id
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
    const salio = new Promise<void>((ok) => proc.once('exit', () => { if (hijos.get(id)?.proc === proc) hijos.delete(id); ok() }))
    const listo = esperarListo(puerto, proc, o.esperaMs ?? 120_000)
    const h: Hijo = { id, puerto, proc, listo, listoYa: false, ultimo: Date.now(), activos: 0, salio }
    listo.then(() => { h.listoYa = true }, () => { try { proc.kill() } catch { /* ya no está */ } })
    hijos.set(id, h)
    return h
  }

  /** El Deprocast de ese usuario, prendido y listo para contestar. */
  async function asegurar(id: number): Promise<Hijo> {
    let h = hijos.get(id)
    if (!h || h.proc.exitCode !== null) {
      if (hijos.size >= maxVivos) {
        const ocioso = [...hijos.values()].filter((x) => x.activos === 0).sort((a, b) => a.ultimo - b.ultimo)[0]
        if (!ocioso) throw new Error('Hay demasiados Deprocast prendidos a la vez. Probá en un rato.')
        await parar(ocioso.id)
      }
      h = prender(id)
    }
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

  async function parar(id: number) {
    const h = hijos.get(id)
    if (!h) return
    hijos.delete(id)
    try { h.proc.kill() } catch { /* ya no está */ }
    await Promise.race([h.salio, new Promise((ok) => setTimeout(ok, 10_000))])
  }

  const vigia = setInterval(() => {
    const ahora = Date.now()
    for (const h of hijos.values()) if (h.activos === 0 && ahora - h.ultimo > ociosoMs) void parar(h.id)
  }, 60_000)
  vigia.unref()

  async function pararTodos() {
    clearInterval(vigia)
    await Promise.all([...hijos.keys()].map(parar))
  }

  const vivos = () => [...hijos.values()].map((h) => ({ id: h.id, puerto: h.puerto, ultimo: h.ultimo, activos: h.activos, listo: h.listoYa }))

  return { token, asegurar, reenviar, parar, pararTodos, vivos }
}

export type Hub = ReturnType<typeof crearHub>

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
