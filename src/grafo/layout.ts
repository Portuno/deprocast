/**
 * El dibujo (plan v25): un layout de fuerzas al estilo ForceAtlas2 (Jacomy et al. 2014) con Barnes-Hut. Lo conectado se
 * atrae (con la fuerza del peso), todo se repele (más los nodos con más conexiones), y una gravedad suave lo mantiene
 * junto. No mide nada: hace legible lo que midieron las métricas. Arranca de las posiciones anteriores (si hay) para
 * que el grafo no salte entre fotos; si no, de un círculo con semilla. Devuelve coordenadas en [-1, 1].
 */
import { azar, type Adyacencia } from './medidas.ts'

type Celda = { x0: number; y0: number; t: number; masa: number; cx: number; cy: number; hijos: Celda[] | null; nodo: number }

function arbol(xs: Float64Array, ys: Float64Array, masa: Float64Array): Celda {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < xs.length; i++) { x0 = Math.min(x0, xs[i]); y0 = Math.min(y0, ys[i]); x1 = Math.max(x1, xs[i]); y1 = Math.max(y1, ys[i]) }
  const t = Math.max(x1 - x0, y1 - y0, 1e-6)
  const raiz: Celda = { x0, y0, t, masa: 0, cx: 0, cy: 0, hijos: null, nodo: -1 }
  const meter = (c: Celda, i: number, prof: number) => {
    if (c.masa === 0 && !c.hijos) { c.nodo = i; c.masa = masa[i]; c.cx = xs[i]; c.cy = ys[i]; return }
    if (!c.hijos) {
      const h = c.t / 2
      c.hijos = [0, 1, 2, 3].map((k) => ({ x0: c.x0 + (k & 1) * h, y0: c.y0 + (k >> 1) * h, t: h, masa: 0, cx: 0, cy: 0, hijos: null, nodo: -1 }))
      const viejo = c.nodo
      c.nodo = -1
      if (viejo >= 0 && prof < 40) meter(c.hijos[cuadrante(c, viejo)], viejo, prof + 1)
    }
    const m = c.masa + masa[i]
    c.cx = (c.cx * c.masa + xs[i] * masa[i]) / m
    c.cy = (c.cy * c.masa + ys[i] * masa[i]) / m
    c.masa = m
    if (prof < 40) meter(c.hijos[cuadrante(c, i)], i, prof + 1)
  }
  const cuadrante = (c: Celda, i: number) => (xs[i] >= c.x0 + c.t / 2 ? 1 : 0) + (ys[i] >= c.y0 + c.t / 2 ? 2 : 0)
  for (let i = 0; i < xs.length; i++) meter(raiz, i, 0)
  return raiz
}

export function acomodar(n: number, g: Adyacencia, o: { previas?: (readonly [number, number] | null)[]; iteraciones?: number; semilla?: number; fijo?: number | null; kr?: number; kg?: number } = {}): [number, number][] {
  if (!n) return []
  const r = azar(o.semilla ?? 11)
  const xs = new Float64Array(n), ys = new Float64Array(n)
  // Escala de trabajo: un disco cuyo radio crece con la raíz de la cantidad de nodos.
  const R0 = 10 * Math.sqrt(n)
  for (let i = 0; i < n; i++) {
    const p = o.previas?.[i]
    if (p) { xs[i] = p[0] * R0 + (r() - 0.5); ys[i] = p[1] * R0 + (r() - 0.5) }
    else { const a = r() * Math.PI * 2, d = R0 * Math.sqrt(r()); xs[i] = Math.cos(a) * d; ys[i] = Math.sin(a) * d }
  }
  const masa = new Float64Array(n)
  for (let i = 0; i < n; i++) masa[i] = g.vecinos[i].length + 1
  // ForceAtlas2: repulsión kr·(g1+1)(g2+1)/d, atracción lineal por el peso (amortiguado con log), gravedad fuerte
  // (proporcional a la distancia: nadie se escapa al borde, los grupos sueltos quedan cerca).
  const kr = o.kr ?? 2, kg = o.kg ?? 0.05, theta = 1.2
  const fx = new Float64Array(n), fy = new Float64Array(n)
  const iter = o.iteraciones ?? (n > 800 ? 300 : 450)
  for (let it = 0; it < iter; it++) {
    fx.fill(0); fy.fill(0)
    const raiz = arbol(xs, ys, masa)
    for (let i = 0; i < n; i++) {
      const pila = [raiz]
      while (pila.length) {
        const c = pila.pop()!
        if (!c.masa) continue
        const dx = xs[i] - c.cx, dy = ys[i] - c.cy
        const d2 = dx * dx + dy * dy + 0.01
        if (c.hijos && c.t * c.t / d2 > theta * theta) { for (const h of c.hijos) pila.push(h); continue }
        if (c.nodo === i) continue
        const f = (kr * masa[i] * c.masa) / d2
        fx[i] += dx * f; fy[i] += dy * f
      }
    }
    for (let i = 0; i < n; i++) {
      const vs = g.vecinos[i], ps = g.pesos[i]
      for (let k = 0; k < vs.length; k++) {
        const j = vs[k]
        if (j < i) continue
        const w = 1 + Math.log(ps[k])
        const dx = xs[j] - xs[i], dy = ys[j] - ys[i]
        fx[i] += dx * w; fy[i] += dy * w
        fx[j] -= dx * w; fy[j] -= dy * w
      }
      fx[i] -= xs[i] * kg * masa[i]; fy[i] -= ys[i] * kg * masa[i]
    }
    // Moverse: proporcional a la fuerza sobre la masa, con un tope que se enfría (nada sale disparado).
    const tope = R0 * 0.08 * (1 - it / iter) + R0 * 0.002
    for (let i = 0; i < n; i++) {
      if (o.fijo === i) { xs[i] = 0; ys[i] = 0; continue }
      let dx = (fx[i] / masa[i]) * 0.1, dy = (fy[i] / masa[i]) * 0.1
      const l = Math.hypot(dx, dy)
      if (l > tope) { dx *= tope / l; dy *= tope / l }
      xs[i] += dx; ys[i] += dy
    }
  }
  // A [-1, 1], centrado (en lo fijo, si hay: «Vos en el centro»); la escala la marca el 98 % (un suelto no achica todo).
  const cx = o.fijo != null ? xs[o.fijo] : xs.reduce((s, x) => s + x, 0) / n
  const cy = o.fijo != null ? ys[o.fijo] : ys.reduce((s, y) => s + y, 0) / n
  const radios = Array.from({ length: n }, (_, i) => Math.max(Math.abs(xs[i] - cx), Math.abs(ys[i] - cy))).sort((a, b) => a - b)
  const r0 = radios[Math.min(n - 1, Math.floor(n * 0.98))] || 1e-6
  const lim = (v: number) => Math.max(-1, Math.min(1, v))
  return Array.from({ length: n }, (_, i) => [+lim((xs[i] - cx) / r0).toFixed(4), +lim((ys[i] - cy) / r0).toFixed(4)] as [number, number])
}
