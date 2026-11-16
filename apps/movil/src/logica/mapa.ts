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
