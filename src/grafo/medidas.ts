/**
 * Las medidas que convierten la red en lectura (plan v25), sin dependencias:
 * - Intermediación (Freeman 1977; Brandes 2001): en cuántos caminos más cortos aparece cada nodo. Los conceptos bisagra.
 *   La red se toma sin dirección y el costo de una arista es 1/peso (más co-ocurrencia = más cerca). Exacta hasta 600
 *   nodos; por encima, con pivotes al azar (Brandes y Pich 2007), escalada.
 * - Comunidades por modularidad (Louvain; Blondel et al. 2008): grupos que se conectan más entre sí que con el resto, y
 *   la modularidad M que dice qué tan marcados están.
 * - El componente conexo principal (C2), la comunidad mayor (C1) y la entropía E de cómo se reparten los 20 más
 *   influyentes entre comunidades (¿la influencia está repartida o concentrada?).
 * - Puntos de entrada (poca frecuencia, mucha intermediación) y periferia (pocas conexiones, pero hacia otro grupo).
 * Todo determinista con una semilla: la misma red da los mismos números.
 */

export type Adyacencia = { vecinos: number[][]; pesos: number[][] }

export function adyacencia(n: number, aristas: [number, number, number][]): Adyacencia {
  const vecinos: number[][] = Array.from({ length: n }, () => [])
  const pesos: number[][] = Array.from({ length: n }, () => [])
  for (const [a, b, p] of aristas) { vecinos[a].push(b); pesos[a].push(p); vecinos[b].push(a); pesos[b].push(p) }
  return { vecinos, pesos }
}

/** Un generador pseudoaleatorio con semilla (mulberry32): mismos datos, mismos resultados. */
export function azar(semilla = 42) {
  let t = semilla >>> 0
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296 }
}

// ─── intermediación (Brandes, con Dijkstra y costo 1/peso) ───────────────

class Monticulo {
  private h: [number, number][] = []
  get size() { return this.h.length }
  push(x: [number, number]) {
    const h = this.h; h.push(x)
    let i = h.length - 1
    while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p }
  }
  pop(): [number, number] {
    const h = this.h; const top = h[0]; const last = h.pop()!
    if (h.length) {
      h[0] = last
      let i = 0
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m }
    }
    return top
  }
}

export function intermediacion(n: number, g: Adyacencia, o: { exactaHasta?: number; pivotes?: number; semilla?: number } = {}): number[] {
  const cb = new Array(n).fill(0)
  if (n < 3) return cb
  let fuentes = Array.from({ length: n }, (_, i) => i)
  const exacta = n <= (o.exactaHasta ?? 600)
  if (!exacta) {
    const r = azar(o.semilla ?? 7)
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [fuentes[i], fuentes[j]] = [fuentes[j], fuentes[i]] }
    fuentes = fuentes.slice(0, o.pivotes ?? 250)
  }
  const dist = new Float64Array(n), sigma = new Float64Array(n), delta = new Float64Array(n)
  for (const s of fuentes) {
    const pila: number[] = []
    const pred: number[][] = Array.from({ length: n }, () => [])
    dist.fill(Infinity); sigma.fill(0); delta.fill(0)
    dist[s] = 0; sigma[s] = 1
    const q = new Monticulo()
    q.push([0, s])
    const hecho = new Uint8Array(n)
    while (q.size) {
      const [d, v] = q.pop()
      if (hecho[v]) continue
      hecho[v] = 1
      pila.push(v)
      const vs = g.vecinos[v], ps = g.pesos[v]
      for (let k = 0; k < vs.length; k++) {
        const w = vs[k]
        const nd = d + 1 / ps[k]
        if (nd < dist[w] - 1e-12) { dist[w] = nd; sigma[w] = sigma[v]; pred[w] = [v]; q.push([nd, w]) }
        else if (Math.abs(nd - dist[w]) <= 1e-12) { sigma[w] += sigma[v]; pred[w].push(v) }
      }
    }
    while (pila.length) {
      const w = pila.pop()!
      for (const v of pred[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w])
      if (w !== s) cb[w] += delta[w]
    }
  }
  // Sin dirección: cada camino se contó dos veces. Normalizado a 0..1 (y escalado si fue con pivotes).
  const escala = exacta ? 1 : n / fuentes.length
  const norma = ((n - 1) * (n - 2)) / 2
  return cb.map((x) => (x / 2) * escala / norma)
}

// ─── comunidades (Louvain) ──────────────────────────────────────────────

/** Louvain: mueve cada nodo a la comunidad vecina que más sube la modularidad, junta y repite. Devuelve la comunidad de cada nodo (0 = la más grande) y M. */
export function comunidades(n: number, aristas: [number, number, number][], o: { semilla?: number; resolucion?: number } = {}): { comunidad: number[]; modularidad: number } {
  if (!n) return { comunidad: [], modularidad: 0 }
  const res = o.resolucion ?? 1
  const r = azar(o.semilla ?? 3)
  let pertenece = Array.from({ length: n }, (_, i) => i) // nodo original → comunidad final
  // El grafo del nivel actual.
  let N = n
  let lados = aristas.map(([a, b, p]) => [a, b, p] as [number, number, number])
  const m2 = lados.reduce((s, [, , p]) => s + 2 * p, 0) || 1
  for (let nivel = 0; nivel < 20; nivel++) {
    const g = adyacencia(N, lados)
    const ki = new Float64Array(N)
    const lazo = new Float64Array(N)
    for (let i = 0; i < N; i++) for (let k = 0; k < g.vecinos[i].length; k++) { ki[i] += g.pesos[i][k]; if (g.vecinos[i][k] === i) lazo[i] += g.pesos[i][k] }
    const com = Array.from({ length: N }, (_, i) => i)
    const tot = Float64Array.from(ki)
    let movio = false
    for (let pasada = 0; pasada < 50; pasada++) {
      let cambios = 0
      const orden = Array.from({ length: N }, (_, i) => i)
      for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [orden[i], orden[j]] = [orden[j], orden[i]] }
      for (const i of orden) {
        const ci = com[i]
        const hacia = new Map<number, number>()
        for (let k = 0; k < g.vecinos[i].length; k++) { const j = g.vecinos[i][k]; if (j !== i) hacia.set(com[j], (hacia.get(com[j]) ?? 0) + g.pesos[i][k]) }
        tot[ci] -= ki[i]
        let mejor = ci, ganancia = (hacia.get(ci) ?? 0) - (res * tot[ci] * ki[i]) / m2
        for (const [c, w] of hacia) { const gn = w - (res * tot[c] * ki[i]) / m2; if (gn > ganancia + 1e-12) { ganancia = gn; mejor = c } }
        tot[mejor] += ki[i]
        if (mejor !== ci) { com[i] = mejor; cambios++; movio = true }
      }
      if (!cambios) break
    }
    if (!movio) break
    // Juntar: cada comunidad pasa a ser un nodo.
    const nuevo = new Map<number, number>()
    for (const c of com) if (!nuevo.has(c)) nuevo.set(c, nuevo.size)
    pertenece = pertenece.map((c) => nuevo.get(com[c])!)
    const pesos = new Map<string, number>()
    for (const [a, b, p] of lados) { const x = nuevo.get(com[a])!, y = nuevo.get(com[b])!; const k = x <= y ? `${x}|${y}` : `${y}|${x}`; pesos.set(k, (pesos.get(k) ?? 0) + p) }
    lados = [...pesos].map(([k, p]) => { const [x, y] = k.split('|').map(Number); return [x, y, p] as [number, number, number] })
    N = nuevo.size
  }
  // Las comunidades por tamaño (0 = la más grande).
  const tam = new Map<number, number>()
  for (const c of pertenece) tam.set(c, (tam.get(c) ?? 0) + 1)
  const orden = [...tam.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c]) => c)
  const renombre = new Map(orden.map((c, i) => [c, i]))
  const comunidad = pertenece.map((c) => renombre.get(c)!)
  return { comunidad, modularidad: modularidad(n, aristas, comunidad) }
}

/** La modularidad de una partición (Newman): lo que se conectan por dentro, menos lo que se esperaría al azar. */
export function modularidad(n: number, aristas: [number, number, number][], comunidad: number[]): number {
  const m = aristas.reduce((s, [, , p]) => s + p, 0)
  if (!m) return 0
  const k = new Float64Array(n)
  for (const [a, b, p] of aristas) { k[a] += p; k[b] += p }
  let adentro = 0
  const sumaK = new Map<number, number>()
  for (const [a, b, p] of aristas) if (comunidad[a] === comunidad[b]) adentro += p
  for (let i = 0; i < n; i++) sumaK.set(comunidad[i], (sumaK.get(comunidad[i]) ?? 0) + k[i])
  let esperado = 0
  for (const s of sumaK.values()) esperado += (s / (2 * m)) ** 2
  return adentro / m - esperado
}

/** Los componentes conexos: el de cada nodo, por tamaño (0 = el principal). */
export function componentes(n: number, g: Adyacencia): number[] {
  const comp = new Array(n).fill(-1)
  const tam: number[] = []
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue
    const c = tam.length
    let t = 0
    const pila = [s]
    comp[s] = c
    while (pila.length) { const v = pila.pop()!; t++; for (const w of g.vecinos[v]) if (comp[w] < 0) { comp[w] = c; pila.push(w) } }
    tam.push(t)
  }
  const orden = tam.map((t, c) => [t, c]).sort((a, b) => b[0] - a[0]).map(([, c]) => c)
  const ren = new Map(orden.map((c, i) => [c, i]))
  return comp.map((c) => ren.get(c)!)
}

/** Entropía (0..1, normalizada) de cómo se reparten los más influyentes entre comunidades. */
export function entropia(comunidadDeTop: number[]): number {
  if (comunidadDeTop.length < 2) return 0
  const c = new Map<number, number>()
  for (const x of comunidadDeTop) c.set(x, (c.get(x) ?? 0) + 1)
  if (c.size < 2) return 0
  let h = 0
  for (const v of c.values()) { const p = v / comunidadDeTop.length; h -= p * Math.log2(p) }
  return h / Math.log2(Math.min(comunidadDeTop.length, c.size))
}

export type Estado = 'sesgado' | 'enfocado' | 'diversificado' | 'disperso'
/** Los umbrales iniciales (de la literatura de análisis de discurso con redes): a calibrar sobre su corpus. */
export const UMBRALES = { mBajo: 0.2, mMedio: 0.4, mAlto: 0.65, c1Domina: 0.5, c2Fragmentado: 0.7, eConcentrada: 0.5 }

/**
 * El estado del discurso: sesgado (casi sin grupos, la influencia concentrada), enfocado (hay grupos pero uno domina),
 * diversificado (varios grupos claros y conectados), disperso (grupos claros pero sueltos). Ninguno es «el bueno».
 */
export function estadoDiscurso(x: { M: number; C1: number; C2: number; E: number }, u = UMBRALES): Estado {
  if (x.M < u.mBajo) return 'sesgado'
  if (x.M > u.mAlto || x.C2 < u.c2Fragmentado) return 'disperso'
  if (x.M < u.mMedio || x.C1 > u.c1Domina || x.E < u.eConcentrada) return 'enfocado'
  return 'diversificado'
}
