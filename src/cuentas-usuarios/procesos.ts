/**
 * El hub de procesos (plan v33, paso 5): cada usuario tiene su propio Deprocast, un proceso aparte con su base en
 * `usuarios/<id>/`, escuchando solo en 127.0.0.1. Un usuario creado queda prendido siempre (sus agentes y rutinas
 * siguen aunque no entre), sin límite de cantidad: al arrancar el hub se prenden todos los activos, escalonados, y si
 * uno se cae vuelve a arrancar solo (esperando cada vez un poco más si se cae en seguida). Solo se apaga si el dueño lo
 * suspende o lo borra.
 *
 * Relevo sin corte (paso 6): el registro `usuarios/hub.json` dice qué proceso corre cada usuario, en qué puerto, y el
 * token del hub. Cuando el servidor del dueño se reemplaza por una versión nueva, los procesos de los usuarios siguen
 * corriendo y el hub nuevo los adopta del registro (mismo token). Un proceso de usuario se apaga solo si no queda
 * ningún hub vivo (el registro dice cuál es el actual).
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
import { vivo } from '../supervisor.ts'

export type Hijo = { id: number; puerto: number; pid: number; proc: ChildProcess | null; listo: Promise<void>; listoYa: boolean; desde: number; ultimo: number; activos: number; salio: Promise<void> }

export type OpcionesHub = {
  /** Donde van las carpetas: `<datos>/usuarios/<id>/`. */
  datos: string
  /** Puertos fijos (base + id). Sin esto, cada uno toma un puerto libre (así dos servidores en un relevo no chocan). */
  puertoBase?: number
  /** El tope duro de tokens por día de ese usuario (0 = sin tope). */
  topeDe?: (id: number) => number
  /** Cuánto esperar a que arranque. */
  esperaMs?: number
  /** Si este hub ya es el que manda (en un relevo, el nuevo no revive a nadie hasta que se va el viejo). */
  activo?: () => boolean
}

type Registro = { token: string; hub: number; hijos: Record<string, { pid: number; puerto: number }> }

/** Lo que pasa del entorno del dueño al de un usuario. Todo lo demás (claves, tokens, su calendario) se queda. */
const PASAN = /^(PATH|Path|PATHEXT|SYSTEMROOT|SystemRoot|WINDIR|windir|COMSPEC|ComSpec|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_ALL|TZ|NAN_API_KEY|NAN_BASE_URL|NAN_CADENA_[A-Z_]+|NAN_MIMO_ID|MASTRO_MOTOR|MASTRO_EMBED_MODEL|MASTRO_ZONA|MASTRO_COMMIT)$/

export function entornoDeUsuario(base: NodeJS.ProcessEnv, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) if (v !== undefined && PASAN.test(k)) env[k] = v
  return { ...env, ...extra }
}

export const dirDeUsuario = (datos: string, id: number) => path.join(datos, 'usuarios', String(Math.trunc(id)))
export const rutaRegistro = (datos: string) => path.join(datos, 'usuarios', 'hub.json')

export function leerRegistro(ruta: string): Registro | null {
  try {
    const r = JSON.parse(fs.readFileSync(ruta, 'utf8')) as Registro
    return typeof r.token === 'string' && r.token.length >= 32 && r.hijos ? r : null
  } catch { return null }
}

export function crearHub(o: OpcionesHub) {
  const registro = rutaRegistro(o.datos)
  const previo = leerRegistro(registro)
  // El mismo token que el hub anterior: así sus procesos siguen aceptando los pedidos de este.
  const token = previo?.token ?? crypto.randomBytes(32).toString('hex')
  const hijos = new Map<number, Hijo>()
  const prendiendo = new Map<number, Promise<Hijo>>()
  /** Los que tienen que estar prendidos: si se caen, vuelven. */
  const quieren = new Set<number>()
  const caidas = new Map<number, number>()
  let apagando = false
  const script = path.resolve(import.meta.dirname, '..', 'servidor.ts')
  const activo = o.activo ?? (() => true)

  /** Anota en el registro (este hub es el actual; ese usuario corre en ese proceso, o ya no). */
  function anotar(id?: number, h?: { pid: number; puerto: number } | null) {
    try {
      const r: Registro = leerRegistro(registro) ?? { token, hub: process.pid, hijos: {} }
      r.token = token
      r.hub = process.pid
      if (id !== undefined) { if (h) r.hijos[id] = h; else delete r.hijos[id] }
      fs.mkdirSync(path.dirname(registro), { recursive: true })
      fs.writeFileSync(`${registro}.tmp`, JSON.stringify(r))
      fs.renameSync(`${registro}.tmp`, registro)
    } catch (e) { process.stdout.write(`  usuarios: no pude anotar el registro (${e instanceof Error ? e.message : e})\n`) }
  }
  anotar()

  /** Cuando un proceso de usuario termina: sale del registro y, si se cayó solo, vuelve. */
  function alTerminar(h: Hijo, codigo: unknown) {
    if (hijos.get(h.id) !== h) return
    hijos.delete(h.id)
    const r = leerRegistro(registro)
    if (r?.hijos[h.id]?.pid === h.pid) anotar(h.id, null)
    if (!quieren.has(h.id) || apagando || !activo()) return
    // Si duró poco, espera más cada vez (5 s, 10 s… hasta 5 min).
    const n = Date.now() - h.desde > 120_000 ? 0 : (caidas.get(h.id) ?? 0) + 1
    caidas.set(h.id, n)
    const espera = Math.min(300_000, 5000 * 2 ** n)
    process.stdout.write(`  [u${h.id}] salió (${codigo}): lo vuelvo a prender en ${Math.round(espera / 1000)} s\n`)
    setTimeout(() => { if (quieren.has(h.id) && !apagando && !hijos.has(h.id)) void prenderUna(h.id).catch(() => {}) }, espera).unref()
  }

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
      MASTRO_HUB_REGISTRO: registro,
      MASTRO_HOST: '127.0.0.1',
      MASTRO_TELEGRAM: '0',
      MASTRO_TOPE_DIA: String(o.topeDe?.(id) ?? 0),
    })
    // Su consola va directo a la del sistema (él mismo le pone su número adelante): así sigue escribiendo aunque
    // el servidor del dueño que lo prendió ya no esté.
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', script, '--db', path.join(dir, 'deprocast.db'), '--puerto', String(puerto), '--sin-telegram'], {
      cwd: dir, env, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, detached: process.platform !== 'win32',
    })
    proc.unref()
    const pid = proc.pid ?? -1
    let h!: Hijo
    const salio = new Promise<void>((ok) => proc.once('exit', (codigo) => { alTerminar(h, codigo); ok() }))
    const listo = esperarListo(puerto, () => proc.exitCode === null, o.esperaMs ?? 120_000)
    h = { id, puerto, pid, proc, listo, listoYa: false, desde: Date.now(), ultimo: Date.now(), activos: 0, salio }
    listo.then(() => { h.listoYa = true }, () => { try { proc.kill() } catch { /* ya no está */ } })
    hijos.set(id, h)
    anotar(id, { pid, puerto })
    return h
  }

  /** El que ya corría (lo prendió el hub anterior): si sigue vivo y contesta, queda a cargo de este. */
  async function adoptar(id: number): Promise<Hijo | null> {
    const e = leerRegistro(registro)?.hijos[id]
    if (!e || !vivo(e.pid) || !(await responde(e.puerto))) return null
    if (hijos.has(id)) return hijos.get(id)!
    let fin = () => {}
    const salio = new Promise<void>((ok) => (fin = ok))
    const h: Hijo = { id, puerto: e.puerto, pid: e.pid, proc: null, listo: Promise.resolve(), listoYa: true, desde: 0, ultimo: Date.now(), activos: 0, salio }
    hijos.set(id, h)
    // No es hijo de este proceso: se nota que terminó mirándolo cada tanto.
    const vigia = setInterval(() => { if (!vivo(h.pid)) { clearInterval(vigia); alTerminar(h, 'adoptado'); fin() } }, 3000)
    vigia.unref()
    return h
  }

  /** El Deprocast de ese usuario, prendido y listo para contestar. */
  async function asegurar(id: number): Promise<Hijo> {
    quieren.add(id)
    let h = hijos.get(id)
    if (!h || !vivo(h.pid)) h = (await adoptar(id)) ?? (await prenderUna(id))
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

  /** Prende (o adopta) a todos esos, de a uno cada `escalonMs` (para no competir entre ellos ni con el arranque del dueño). */
  function mantener(ids: number[], escalonMs = 3000) {
    let i = 0
    for (const id of ids) {
      quieren.add(id)
      // Los que ya corren se adoptan en el acto; los que hay que prender, escalonados.
      const corre = leerRegistro(registro)?.hijos[id]
      const espera = corre && vivo(corre.pid) ? 0 : i++ * escalonMs
      setTimeout(() => { if (!apagando) void asegurar(id).catch(() => {}) }, espera).unref()
    }
  }

  /** Lo apaga y no lo vuelve a prender (suspendido o borrado). */
  async function parar(id: number) {
    quieren.delete(id)
    const h = hijos.get(id) ?? (await adoptar(id))
    if (!h) return
    hijos.delete(id)
    anotar(id, null)
    try { process.kill(h.pid) } catch { /* ya no está */ }
    const t0 = Date.now()
    while (vivo(h.pid) && Date.now() - t0 < 10_000) await new Promise((ok) => setTimeout(ok, 200))
  }

  /** Para reiniciarlo (un tope nuevo): lo apaga y lo vuelve a prender. */
  async function reiniciar(id: number) {
    await parar(id)
    await asegurar(id)
  }

  /** Apagar todo (la compu se cierra, o un test). */
  async function pararTodos() {
    apagando = true
    await Promise.all([...hijos.keys()].map(parar))
  }

  /** El servidor del dueño se va en un relevo: los usuarios siguen corriendo y el próximo hub los adopta. */
  function dejar() {
    apagando = true
  }

  const vivos = () => [...hijos.values()].map((h) => ({ id: h.id, puerto: h.puerto, ultimo: h.ultimo, activos: h.activos, listo: h.listoYa, pid: h.pid }))

  return { token, asegurar, reenviar, mantener, parar, reiniciar, pararTodos, dejar, vivos }
}

export type Hub = ReturnType<typeof crearHub>

/** El proceso de un usuario: ¿sigue habiendo un hub vivo? (Si no, se apaga solo.) */
export function hayHub(registro: string): boolean {
  const r = leerRegistro(registro)
  return !!r && vivo(r.hub)
}

/** Un puerto libre de esta compu (lo pide al sistema y lo suelta). */
function puertoLibre(): Promise<number> {
  return new Promise((ok, mal) => {
    const s = net.createServer()
    s.on('error', mal)
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => ok(port)) })
  })
}

function responde(puerto: number): Promise<boolean> {
  return new Promise((ok) => {
    const r = http.get({ host: '127.0.0.1', port: puerto, path: '/version', timeout: 2000 }, (x) => { x.resume(); ok(x.statusCode === 200) })
    r.on('error', () => ok(false))
    r.on('timeout', () => r.destroy())
  })
}

/** Espera a que el proceso conteste /version (o que se caiga). */
async function esperarListo(puerto: number, sigue: () => boolean, maxMs: number): Promise<void> {
  const desde = Date.now()
  for (;;) {
    if (!sigue()) throw new Error('Tu Deprocast no arrancó.')
    if (await responde(puerto)) return
    if (Date.now() - desde > maxMs) throw new Error('Tu Deprocast tardó demasiado en arrancar.')
    await new Promise((ok) => setTimeout(ok, 250))
  }
}
