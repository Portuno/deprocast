/**
 * Cuánto tarda cada ruta y cuánto se traba el servidor, medido en vivo (en la compu o en la nube): por ruta, las veces,
 * el p50, el p95, el máximo y los bytes; del event loop, el bloqueo más largo (lo que ayer dejó todo en 524). Cada
 * respuesta lleva «Server-Timing» y lo que pasa de un segundo queda anotado como «lento» para la autocrítica.
 * Para el panel «Velocidad» (GET /api/velocidad) y para comparar antes y después de cada optimización.
 */
import type http from 'node:http'
import { monitorEventLoopDelay } from 'node:perf_hooks'

type Medida = { veces: number; tiempos: number[]; max: number; bytes: number; lentos: number }
const rutas = new Map<string, Medida>()
const MUESTRAS = 200
const LENTO_MS = 1000
let desde = Date.now()
const bucle = monitorEventLoopDelay({ resolution: 20 })
bucle.enable()

/** La ruta sin ids ni archivos: «GET /api/encargos/:id», «GET estático», «GET /adjuntos/*». */
export function rutaNormal(metodo: string, pathname: string): string {
  if (pathname.startsWith('/adjuntos/')) return `${metodo} /adjuntos/*`
  if (pathname.startsWith('/taller/')) return `${metodo} /taller/*`
  if (!pathname.startsWith('/api/')) return `${metodo} ${pathname === '/' || pathname === '/index.html' ? '/' : 'estático'}`
  return `${metodo} ${pathname.replace(/\/\d+(?=\/|$|\.)/g, '/:id').replace(/\/[0-9a-f]{16,}(?=\/|$)/g, '/:hash')}`
}

/**
 * Mide un pedido: agrega Server-Timing (el tiempo hasta que se mandan los headers) y al terminar suma la medida.
 * alLento: qué hacer con lo que tardó más de un segundo (anotarlo).
 */
export function medirPedido(req: http.IncomingMessage, res: http.ServerResponse, alLento?: (ruta: string, ms: number) => void) {
  const t0 = performance.now()
  const ruta = rutaNormal(req.method ?? 'GET', new URL(req.url ?? '/', 'http://x').pathname)
  let bytes = 0
  const writeHead = res.writeHead.bind(res) as (...a: any[]) => http.ServerResponse
  ;(res as any).writeHead = (...a: any[]) => {
    if (!res.headersSent) res.setHeader('server-timing', `total;dur=${(performance.now() - t0).toFixed(1)}`)
    return writeHead(...a)
  }
  const write = res.write.bind(res) as (...a: any[]) => boolean
  ;(res as any).write = (chunk: any, ...a: any[]) => { if (chunk) bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length ?? 0; return write(chunk, ...a) }
  const end = res.end.bind(res) as (...a: any[]) => http.ServerResponse
  ;(res as any).end = (chunk?: any, ...a: any[]) => {
    if (chunk && typeof chunk !== 'function') bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length ?? 0
    if (!res.headersSent) res.setHeader('server-timing', `total;dur=${(performance.now() - t0).toFixed(1)}`)
    return end(chunk, ...a)
  }
  res.once('finish', () => {
    const ms = performance.now() - t0
    const m = rutas.get(ruta) ?? { veces: 0, tiempos: [], max: 0, bytes: 0, lentos: 0 }
    m.veces++
    m.tiempos.push(ms)
    if (m.tiempos.length > MUESTRAS) m.tiempos.shift()
    m.max = Math.max(m.max, ms)
    m.bytes += bytes
    // Lo que tarda por esperar a un modelo o a un archivo grande no es un problema del servidor: solo las rutas rápidas.
    if (ms > LENTO_MS && !/\/(chat\/:id\/mensajes|mensajes|directo\/:id\/(cuadro|audio|cerrar)|tandas|youtube|exportar|mudanza|takeout\/|apps\/|cargas|imagen|archivo|log|documento|entrevista-audio|informe|asis|tobe|guia|manual|kpis\/proponer|descubrir|tarjetas$)/.test(ruta)) {
      m.lentos++
      alLento?.(ruta, ms)
    }
    rutas.set(ruta, m)
  })
}

const percentil = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
}
const r1 = (x: number) => Math.round(x * 10) / 10

/** Lo medido desde que arrancó (o desde el último reinicio de la medición). */
export function velocidad() {
  const lista = [...rutas].map(([ruta, m]) => ({
    ruta, veces: m.veces, p50: r1(percentil(m.tiempos, 0.5)), p95: r1(percentil(m.tiempos, 0.95)), max: r1(m.max),
    kbPromedio: r1(m.bytes / m.veces / 1024), lentos: m.lentos,
  })).sort((a, b) => b.p95 * b.veces - a.p95 * a.veces)
  return {
    desde, minutos: Math.round((Date.now() - desde) / 60_000),
    // El event loop: cuánto tuvo que esperar algo para correr (si sube, el servidor se está trabando).
    bucle: { p50: r1(bucle.percentile(50) / 1e6), p99: r1(bucle.percentile(99) / 1e6), max: r1(bucle.max / 1e6) },
    rutas: lista,
  }
}

export function reiniciarVelocidad() {
  rutas.clear()
  bucle.reset()
  desde = Date.now()
}
