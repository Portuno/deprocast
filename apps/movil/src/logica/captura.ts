/**
 * La captura del teléfono (Mobile 1.0, bloque 4), sin nada de React Native: se prueba desde el repo.
 *
 * Qué capta y para qué, una función por permiso, y un interruptor que apaga todo de una:
 * - audio: tu voz en tramos cortos, con la pantalla apagada (el dictado y la escucha);
 * - ubicacion: dónde estabas, con frecuencia que se adapta (quieto casi no marca; caminando, cada 30–60 s), o solo las
 *   paradas (un lugar donde te quedaste 5 minutos o más) en vez de toda la traza;
 * - pasos: por el sensor del teléfono (no por GPS), para cruzar lo que dijiste con cómo te movías;
 * - batería y red: sin permiso, para decidir cuándo subir el audio.
 * Qué NO capta: el teclado, tus contactos, el contenido de otras apps ni capturas de pantalla.
 */

export type Ajustes = { todo: boolean; audio: boolean; ubicacion: boolean; soloParadas: boolean; pasos: boolean }
export const AJUSTES_INICIALES: Ajustes = { todo: true, audio: true, ubicacion: true, soloParadas: false, pasos: true }

/** Los ajustes guardados (con lo que falte, de los iniciales). El interruptor general manda sobre todo. */
export function leerAjustes(texto: string | null): Ajustes {
  try { return { ...AJUSTES_INICIALES, ...(texto ? JSON.parse(texto) : {}) } } catch { return { ...AJUSTES_INICIALES } }
}
export const capta = (a: Ajustes, que: 'audio' | 'ubicacion' | 'pasos') => a.todo && a[que]

/**
 * ¿Se sube audio ahora? Sin conexión, no (espera en disco). Con la batería por debajo del 15 % y sin cargar, tampoco:
 * el audio espera a que cargue (los textos y las capas, que pesan nada, salen igual).
 */
export function puedeSubirAudio(e: { nivel: number | null; cargando: boolean; conectado: boolean | null }): boolean {
  if (e.conectado === false) return false
  if (e.nivel != null && e.nivel >= 0 && e.nivel < 0.15 && !e.cargando) return false
  return true
}

/** Cada cuánto marca la ubicación: caminando o en movimiento, cada 30 s o 20 m; quieto, cada 10 min o 100 m. */
export function parametrosUbicacion(moviendose: boolean): { timeInterval: number; distanceInterval: number } {
  return moviendose ? { timeInterval: 30_000, distanceInterval: 20 } : { timeInterval: 600_000, distanceInterval: 100 }
}
/** Para no cambiar el ritmo a cada rato: el estado nuevo tiene que sostenerse este tiempo. */
export const SOSTENER_MS = 60_000

export type Punto = { lat: number; lon: number; t: number; precision?: number | null }
const R = 6_371_000
export function distancia(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Las paradas: un lugar donde te quedaste al menos 5 minutos sin alejarte más de 100 m. Con «solo paradas», a las capas
 * va el centro de la parada (y nada mientras te movés), en vez de toda la traza.
 */
export const RADIO_PARADA_M = 100
export const MINIMO_PARADA_MS = 5 * 60_000
export function crearParadas() {
  let grupo: Punto[] = []
  return {
    /** Suma un punto; devuelve la parada en curso (su centro) si ya lo es, o null. */
    sumar(p: Punto): { lat: number; lon: number; desde: number } | null {
      const centro = grupo.length ? { lat: grupo.reduce((s, x) => s + x.lat, 0) / grupo.length, lon: grupo.reduce((s, x) => s + x.lon, 0) / grupo.length } : null
      if (centro && distancia(centro, p) > RADIO_PARADA_M) grupo = []
      grupo.push(p)
      if (grupo.length > 200) grupo.shift()
      const desde = grupo[0].t
      if (p.t - desde < MINIMO_PARADA_MS) return null
      return { lat: grupo.reduce((s, x) => s + x.lat, 0) / grupo.length, lon: grupo.reduce((s, x) => s + x.lon, 0) / grupo.length, desde }
    },
  }
}

/**
 * Solo por conexión cifrada: el servidor va siempre por https. Un http se acepta solo para una dirección de tu red
 * (localhost, 10.x, 192.168.x, 172.16–31.x: el servidor en tu compu), nunca hacia afuera.
 */
export function servidorSeguro(url: string): string {
  const x = url.trim().replace(/\/+$/, '')
  const m = /^(https?):\/\/([^/:]+)/i.exec(x)
  if (!m) return `https://${x}`
  if (m[1].toLowerCase() === 'https') return x
  const host = m[2].toLowerCase()
  const local = host === 'localhost' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith('.local')
  return local ? x : x.replace(/^http:/i, 'https:')
}

/**
 * «Solo las paradas», para la cola del recorrido: los puntos se agrupan en tramos seguidos que no se alejan más de
 * 100 m; los de un grupo que duró 5 minutos o más se suben (es una parada); los de un grupo cerrado que no llegó (el
 * recorrido en movimiento) se descartan sin subirse; el último grupo, si todavía puede llegar a ser parada, espera.
 */
export function separarParadas(puntos: { en: number; lat: number; lon: number }[], ahora = Date.now()): { subir: number[]; descartar: number[]; esperar: number[] } {
  const out = { subir: [] as number[], descartar: [] as number[], esperar: [] as number[] }
  const grupos: { en: number; lat: number; lon: number }[][] = []
  let g: { en: number; lat: number; lon: number }[] = []
  for (const p of [...puntos].sort((a, b) => a.en - b.en)) {
    if (g.length) {
      const c = { lat: g.reduce((s, x) => s + x.lat, 0) / g.length, lon: g.reduce((s, x) => s + x.lon, 0) / g.length }
      if (distancia(c, p) > RADIO_PARADA_M) { grupos.push(g); g = [] }
    }
    g.push(p)
  }
  if (g.length) grupos.push(g)
  grupos.forEach((x, i) => {
    const dura = x.at(-1)!.en - x[0].en
    const ens = x.map((p) => p.en)
    if (dura >= MINIMO_PARADA_MS) out.subir.push(...ens)
    else if (i === grupos.length - 1 && ahora - x.at(-1)!.en < MINIMO_PARADA_MS * 2) out.esperar.push(...ens)
    else out.descartar.push(...ens)
  })
  return out
}
