/**
 * Un cálculo completo del grafo (plan v25), puro: documentos → red → medidas → huecos → dibujo. Corre en el hilo aparte
 * (trabajador.ts); acá no hay base de datos ni red.
 */
import { construirRed, type Documento, type Red } from './construir.ts'
import { adyacencia, comunidades, componentes, entropia, estadoDiscurso, intermediacion, type Estado } from './medidas.ts'
import { acomodar } from './layout.ts'
import type { Diccionario } from './texto.ts'

export type Nodo = { i: number; lema: string; forma: string; frec: number; docs: number; btw: number; com: number; grado: number; x: number; y: number; entrada?: boolean; periferia?: boolean; vos?: boolean }
export type Comunidad = { id: number; tam: number; top: string[]; peso: number }
export type Hueco = { a: number; b: number; puntaje: number; puente: number; terminosA: string[]; terminosB: string[]; bisagras: string[] }
export type Metricas = { n: number; m: number; M: number; C1: number; C2: number; E: number; estado: Estado; documentos: number; lemas: number; comunidades: number }
export type Resultado = { nodos: Nodo[]; aristas: [number, number, number][]; comunidades: Comunidad[]; huecos: Hueco[]; metricas: Metricas; automaticas: string[]; ms: number }

export type Opciones = { dic?: Diccionario; maxNodos?: number; puenteParrafos?: boolean; previas?: Record<string, [number, number]>; vos?: boolean; semilla?: number }

export function calcular(docs: Documento[], o: Opciones = {}): Resultado {
  const t0 = Date.now()
  const red = construirRed(docs, { dic: o.dic, maxNodos: o.maxNodos, puenteParrafos: o.puenteParrafos })
  return { ...medirRed(red, o), ms: Date.now() - t0 }
}

/** Las medidas y el dibujo sobre una red ya armada (también sirve para «quitar lo obvio»: la misma red sin sus bisagras). */
export function medirRed(red: Pick<Red, 'nodos' | 'aristas' | 'documentos' | 'lemas' | 'automaticas'>, o: Opciones = {}): Resultado {
  const t0 = Date.now()
  const n = red.nodos.length
  const g = adyacencia(n, red.aristas)
  const btw = intermediacion(n, g, { semilla: o.semilla })
  const { comunidad, modularidad } = comunidades(n, red.aristas, { semilla: o.semilla })
  const comp = componentes(n, g)
  const grado = g.vecinos.map((v) => v.length)
  const porBtw = Array.from({ length: n }, (_, i) => i).sort((a, b) => btw[b] - btw[a])
  const top20 = porBtw.slice(0, 20)
  const nCom = new Set(comunidad).size
  const C1 = n ? comunidad.filter((c) => c === 0).length / n : 0
  const C2 = n ? comp.filter((c) => c === 0).length / n : 0
  const E = entropia(top20.map((i) => comunidad[i]))
  const metricas: Metricas = { n, m: red.aristas.length, M: +modularidad.toFixed(3), C1: +C1.toFixed(3), C2: +C2.toFixed(3), E: +E.toFixed(3), estado: estadoDiscurso({ M: modularidad, C1, C2, E }), documentos: red.documentos, lemas: red.lemas, comunidades: nCom }

  // Puntos de entrada: mucha intermediación para lo poco que aparecen. Periferia: pocas conexiones, pero hacia otro grupo.
  const rangoFrec = new Map(Array.from({ length: n }, (_, i) => i).sort((a, b) => red.nodos[b].frec - red.nodos[a].frec).map((i, k) => [i, k]))
  const entradas = new Set(porBtw.slice(0, Math.max(5, Math.ceil(n * 0.2))).filter((i) => rangoFrec.get(i)! > n * 0.4).sort((a, b) => btw[b] / red.nodos[b].frec - btw[a] / red.nodos[a].frec).slice(0, 8))
  const periferia = new Set(Array.from({ length: n }, (_, i) => i).filter((i) => grado[i] > 0 && grado[i] <= 2 && g.vecinos[i].some((j) => comunidad[j] !== comunidad[i])))

  // Las comunidades: su tamaño, su peso y sus términos más influyentes.
  const coms: Comunidad[] = Array.from({ length: nCom }, (_, c) => {
    const xs = porBtw.filter((i) => comunidad[i] === c)
    return { id: c, tam: xs.length, top: xs.slice(0, 8).map((i) => red.nodos[i].forma), peso: +xs.reduce((s, i) => s + btw[i], 0).toFixed(5) }
  })
  const huecos = huecosEstructurales(n, red.aristas, comunidad, btw, red.nodos.map((x) => x.forma), coms)

  // El dibujo: «Vos» en el centro (unido a lo más influyente), desde las posiciones de la foto anterior.
  const conVos = !!o.vos && n > 0
  const ladosDibujo = conVos ? [...red.aristas, ...porBtw.slice(0, 10).map((i) => [n, i, 3] as [number, number, number])] : red.aristas
  const gd = adyacencia(conVos ? n + 1 : n, ladosDibujo)
  const previas = [...red.nodos.map((x) => o.previas?.[x.lema] ?? null), ...(conVos ? [[0, 0] as [number, number]] : [])]
  const pos = acomodar(conVos ? n + 1 : n, gd, { previas, fijo: conVos ? n : null, semilla: o.semilla })
  const nodos: Nodo[] = red.nodos.map((x, i) => ({
    i, lema: x.lema, forma: x.forma, frec: x.frec, docs: x.docs, btw: +btw[i].toFixed(5), com: comunidad[i], grado: grado[i], x: pos[i][0], y: pos[i][1],
    ...(entradas.has(i) ? { entrada: true } : {}), ...(periferia.has(i) ? { periferia: true } : {}),
  }))
  if (conVos) nodos.push({ i: n, lema: '__vos', forma: 'Vos', frec: 0, docs: 0, btw: 0, com: -1, grado: 10, x: pos[n][0], y: pos[n][1], vos: true })
  return { nodos, aristas: ladosDibujo, comunidades: coms, huecos, metricas, automaticas: red.automaticas, ms: Date.now() - t0 }
}

/**
 * Los huecos estructurales (Burt): pares de comunidades densas por dentro y casi sin aristas entre ellas. puente: el peso
 * cruzado relativo al de adentro (0 = nada las une). Se rankean los grupos con peso propio y poco puente. Son
 * candidatos: algunos no tienen nada que decirse; el filtro es él.
 */
export function huecosEstructurales(n: number, aristas: [number, number, number][], comunidad: number[], btw: number[], formas: string[], coms: Comunidad[], max = 10): Hueco[] {
  const adentro = new Map<number, number>()
  const cruce = new Map<string, number>()
  const bisagras = new Map<string, Map<number, number>>()
  for (const [a, b, p] of aristas) {
    const ca = comunidad[a], cb = comunidad[b]
    if (ca === cb) { adentro.set(ca, (adentro.get(ca) ?? 0) + p); continue }
    const k = ca < cb ? `${ca}|${cb}` : `${cb}|${ca}`
    cruce.set(k, (cruce.get(k) ?? 0) + p)
    const bs = bisagras.get(k) ?? new Map<number, number>()
    bs.set(a, (bs.get(a) ?? 0) + p); bs.set(b, (bs.get(b) ?? 0) + p)
    bisagras.set(k, bs)
  }
  const grandes = coms.filter((c) => c.tam >= 4).slice(0, 12)
  const total = grandes.reduce((s, c) => s + c.tam, 0) || 1
  const out: Hueco[] = []
  for (let x = 0; x < grandes.length; x++) for (let y = x + 1; y < grandes.length; y++) {
    const A = grandes[x], B = grandes[y]
    const ia = adentro.get(A.id) ?? 0, ib = adentro.get(B.id) ?? 0
    if (!ia || !ib) continue
    const k = `${Math.min(A.id, B.id)}|${Math.max(A.id, B.id)}`
    const puente = (cruce.get(k) ?? 0) / Math.sqrt(ia * ib)
    const masa = Math.sqrt((A.tam / total) * (B.tam / total))
    const puntaje = masa * (1 / (1 + 8 * puente))
    out.push({ a: A.id, b: B.id, puntaje: +puntaje.toFixed(4), puente: +puente.toFixed(4), terminosA: A.top.slice(0, 6), terminosB: B.top.slice(0, 6), bisagras: [...(bisagras.get(k) ?? new Map()).entries()].sort((p, q) => q[1] - p[1] || btw[q[0]] - btw[p[0]]).slice(0, 4).map(([i]) => formas[i]) })
  }
  return out.sort((p, q) => q.puntaje - p.puntaje).slice(0, max)
}
