/**
 * El dibujo del mapa (Mobile 1.1, Fragua #287), sin nada de React Native: se prueba desde el repo.
 * - simplificar: el recorrido con menos puntos (Douglas-Peucker en metros): mismo trazo, sin la nube de puntos encimados
 *   que se veía al estar quieto o con mala señal.
 * - tramosPorHora: el recorrido cortado en tramos con su color de la mañana a la noche (para leer el orden del día).
 */

export type P = { en: number; lat: number; lon: number }

/** Distancia aproximada en metros (equirrectangular: sobra para una ciudad). */
export function metros(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = ((b.lon - a.lon) * Math.PI / 180) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  const y = (b.lat - a.lat) * Math.PI / 180
  return Math.sqrt(x * x + y * y) * 6_371_000
}

function aLaRecta(p: P, a: P, b: P): number {
  const ab = metros(a, b)
  if (ab < 0.01) return metros(p, a)
  // Área del triángulo (Herón) / base = altura.
  const pa = metros(p, a), pb = metros(p, b)
  const s = (ab + pa + pb) / 2
  const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - pa) * (s - pb)))
  return (2 * area) / ab
}

/** Douglas-Peucker: saca los puntos que se apartan menos de `tolerancia` metros del trazo. Conserva el primero y el último. */
export function simplificar<T extends P>(ps: T[], tolerancia = 12): T[] {
  if (ps.length <= 2) return ps
  const quedan = new Uint8Array(ps.length)
  quedan[0] = 1; quedan[ps.length - 1] = 1
  const pila: [number, number][] = [[0, ps.length - 1]]
  while (pila.length) {
    const [i, j] = pila.pop()!
    let max = 0, k = -1
    for (let x = i + 1; x < j; x++) { const d = aLaRecta(ps[x], ps[i], ps[j]); if (d > max) { max = d; k = x } }
    if (k >= 0 && max > tolerancia) { quedan[k] = 1; pila.push([i, k], [k, j]) }
  }
  return ps.filter((_, i) => quedan[i])
}

/** El recorrido en `n` tramos seguidos (comparten el punto de unión), del primero al último, para colorearlos en orden. */
export function tramosPorHora<T extends P>(ps: T[], n = 5): T[][] {
  if (ps.length < 2) return ps.length ? [ps] : []
  const partes = Math.min(n, ps.length - 1)
  const largo = (ps.length - 1) / partes
  return Array.from({ length: partes }, (_, i) => ps.slice(Math.round(i * largo), Math.round((i + 1) * largo) + 1))
}

// ─── Mobile 2.0: dónde diste los pasos ──────────────────────────────────
// El contador del teléfono sabe cuántos pasos por hora; el recorrido sabe por dónde anduviste. Cruzándolos, cada tramo
// del recorrido se queda con los pasos que le tocan: los de una hora se reparten entre los tramos de esa hora que van a
// paso de caminata o trote (no los del auto ni los de estar quieto), proporcional a los metros. Lo que no encaja en
// ningún tramo (caminaste sin recorrido prendido) queda «sin ubicar», para decirlo.

const HORA_MS = 3_600_000
/** Velocidad (m/s) de quien camina o trota: menos es estar quieto (o el GPS bailando); más, un vehículo. */
export const VELOCIDAD_PIE = { min: 0.4, max: 3.6 }
const dos = (n: number) => String(n).padStart(2, '0')
const horaLocal = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}` }
const inicioHora = (t: number) => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime() }

/** Los pasos de cada tramo (del punto i al i+1) y los que no se pudieron ubicar. Los puntos, en orden. */
export function pasosEnTramos(ps: P[], horas: { hora: string; pasos: number }[]): { porTramo: number[]; sinUbicar: number } {
  const porTramo = Array.from({ length: Math.max(0, ps.length - 1) }, () => 0)
  // Por hora: los tramos a pie con los metros que caen en esa hora.
  const pie = new Map<string, { i: number; m: number }[]>()
  for (let i = 0; i + 1 < ps.length; i++) {
    const a = ps[i], b = ps[i + 1]
    const ms = b.en - a.en
    if (!(ms > 0)) continue
    const m = metros(a, b)
    const v = m / (ms / 1000)
    if (v < VELOCIDAD_PIE.min || v > VELOCIDAD_PIE.max) continue
    for (let t = a.en; t < b.en;) {
      const fin = Math.min(b.en, inicioHora(t) + HORA_MS)
      const h = horaLocal(t)
      const xs = pie.get(h) ?? []
      xs.push({ i, m: (m * (fin - t)) / ms })
      pie.set(h, xs)
      t = fin
    }
  }
  let sinUbicar = 0
  for (const { hora, pasos } of horas) {
    if (!(pasos > 0)) continue
    const xs = pie.get(hora)
    const total = xs?.reduce((s, x) => s + x.m, 0) ?? 0
    if (!xs || total < 1) { sinUbicar += pasos; continue }
    for (const x of xs) porTramo[x.i] += (pasos * x.m) / total
  }
  return { porTramo: porTramo.map(Math.round), sinUbicar: Math.round(sinUbicar) }
}

/** Qué tan a pie iba un tramo, por pasos por minuto: 0 sin pasos (quieto o en vehículo), 1 paseo, 2 caminata, 3 a paso firme o trotando. */
export function ritmo(pasos: number, ms: number): 0 | 1 | 2 | 3 {
  if (!(pasos > 0) || !(ms > 0)) return 0
  const porMin = pasos / (ms / 60_000)
  return porMin < 50 ? 1 : porMin < 100 ? 2 : 3
}

/** El recorrido en tramos seguidos del mismo ritmo (para pintarlos), cada uno simplificado. */
export function tramosPorRitmo<T extends P>(ps: T[], porTramo: number[], tolerancia = 8): { ritmo: 0 | 1 | 2 | 3; puntos: T[] }[] {
  const out: { ritmo: 0 | 1 | 2 | 3; puntos: T[] }[] = []
  for (let i = 0; i + 1 < ps.length; i++) {
    const r = ritmo(porTramo[i] ?? 0, ps[i + 1].en - ps[i].en)
    const ultimo = out.at(-1)
    if (ultimo && ultimo.ritmo === r) ultimo.puntos.push(ps[i + 1])
    else out.push({ ritmo: r, puntos: [ps[i], ps[i + 1]] })
  }
  return out.map((x) => ({ ritmo: x.ritmo, puntos: simplificar(x.puntos, tolerancia) }))
}

export type Parada = { lat: number; lon: number; desde: number; hasta: number; minutos: number; lugar: string | null }
export type Momento =
  | { tipo: 'parada'; desde: number; hasta: number; minutos: number; lat: number; lon: number; lugar: string | null; n: number }
  | { tipo: 'trayecto'; desde: number; hasta: number; minutos: number; km: number; pasos: number; a: P; b: P }

/**
 * La línea del día: las paradas (numeradas, las mismas del mapa) y, entre ellas, los trayectos con su distancia y sus
 * pasos. Un trayecto de menos de 80 m (el GPS bailando en el mismo lugar) no cuenta.
 */
export function lineaDelDia(ps: P[], paradas: Parada[], porTramo: number[]): Momento[] {
  const out: Momento[] = []
  const trayecto = (desde: number, hasta: number) => {
    let m = 0, pasos = 0
    let a: P | null = null, b: P | null = null
    for (let i = 0; i + 1 < ps.length; i++) {
      if (ps[i].en < desde || ps[i + 1].en > hasta) continue
      a ??= ps[i]; b = ps[i + 1]
      const d = metros(ps[i], ps[i + 1])
      if (d < 50_000) m += d
      pasos += porTramo[i] ?? 0
    }
    if (a && b && m >= 80) out.push({ tipo: 'trayecto', desde: a.en, hasta: b.en, minutos: Math.round((b.en - a.en) / 60_000), km: Math.round(m / 100) / 10, pasos, a, b })
  }
  const orden = [...paradas].sort((x, y) => x.desde - y.desde)
  let cursor = ps[0]?.en ?? 0
  orden.forEach((p, i) => {
    trayecto(cursor, p.desde)
    out.push({ tipo: 'parada', desde: p.desde, hasta: p.hasta, minutos: p.minutos, lat: p.lat, lon: p.lon, lugar: p.lugar, n: i + 1 })
    cursor = p.hasta
  })
  trayecto(cursor, ps.at(-1)?.en ?? cursor)
  return out
}
