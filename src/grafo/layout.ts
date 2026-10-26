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

export function acomodar(n: number, g: Adyacencia, o: { previas?: (readonly [number, number] | null)[]; iteraciones?: number; semilla?: number; fijo?: number | null } = {}): [number, number][] {
  if (!n) return []
  const r = azar(o.semilla ?? 11)
  const xs = new Float64Array(n), ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = o.previas?.[i]
    if (p) { xs[i] = p[0] * 100 + (r() - 0.5); ys[i] = p[1] * 100 + (r() - 0.5) }
    else { const a = r() * Math.PI * 2, d = 20 + r() * 80; xs[i] = Math.cos(a) * d; ys[i] = Math.sin(a) * d }
  }
  const masa = new Float64Array(n)
  for (let i = 0; i < n; i++) masa[i] = g.vecinos[i].length + 1
  const kr = 10, gravedad = 1, theta = 1.2
  const fx = new Float64Array(n), fy = new Float64Array(n)
  const iter = o.iteraciones ?? (n > 800 ? 250 : 400)
  // Pesos de atracción normalizados (para que unos pocos pesos enormes no colapsen todo).
  const pmax = Math.max(1, ...g.pesos.flat())
  for (let it = 0; it < iter; it++) {
    fx.fill(0); fy.fill(0)
    const raiz = arbol(xs, ys, masa)
    // Repulsión (Barnes-Hut).
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
    // Atracción por las aristas y gravedad.
    for (let i = 0; i < n; i++) {
      const vs = g.vecinos[i], ps = g.pesos[i]
      for (let k = 0; k < vs.length; k++) {
        const j = vs[k]
        if (j < i) continue
        const w = 0.2 + (ps[k] / pmax) * 2
        const dx = xs[j] - xs[i], dy = ys[j] - ys[i]
        fx[i] += dx * w * 0.05; fy[i] += dy * w * 0.05
        fx[j] -= dx * w * 0.05; fy[j] -= dy * w * 0.05
      }
      const d = Math.hypot(xs[i], ys[i]) || 1
      fx[i] -= (xs[i] / d) * gravedad * masa[i]; fy[i] -= (ys[i] / d) * gravedad * masa[i]
    }
    // Moverse con un paso que se enfría (y acotado: nada sale disparado).
    const temp = 10 * (1 - it / iter) + 0.5
    for (let i = 0; i < n; i++) {
      if (o.fijo === i) { xs[i] = 0; ys[i] = 0; continue }
      const f = Math.hypot(fx[i], fy[i]) || 1
      const paso = Math.min(temp, f / masa[i])
      xs[i] += (fx[i] / f) * paso; ys[i] += (fy[i] / f) * paso
    }
  }
  // A [-1, 1], centrado (en lo fijo, si hay: «Vos en el centro»).
  const cx = o.fijo != null ? xs[o.fijo] : xs.reduce((s, x) => s + x, 0) / n
  const cy = o.fijo != null ? ys[o.fijo] : ys.reduce((s, y) => s + y, 0) / n
  let r0 = 1e-6
  for (let i = 0; i < n; i++) r0 = Math.max(r0, Math.abs(xs[i] - cx), Math.abs(ys[i] - cy))
  return Array.from({ length: n }, (_, i) => [+((xs[i] - cx) / r0).toFixed(4), +((ys[i] - cy) / r0).toFixed(4)] as [number, number])
}
