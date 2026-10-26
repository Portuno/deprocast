/**
 * Del texto a la red (plan v25): cada párrafo es una secuencia de lemas; dos lemas seguidos se unen con peso 3, a
 * distancia 2 con peso 2 y a distancia 3 con peso 1 (una ventana de 4). Las aristas repetidas suman: si dos conceptos
 * aparecen juntos seguido en su materia, están relacionados en su cabeza. Las palabras que aparecen en casi todo (no
 * discriminan nada) NO se sacan solas: se sugieren (él decide en el diccionario; sacar «proyecto» de su corpus sería
 * borrarle un concepto). Quedan los nodos más fuertes, para que se pueda leer.
 */
import { diccionarioVacio, formaDe, lemas, parrafos, type Diccionario } from './texto.ts'

/** Un texto que entra al grafo: una pieza (id del corpus), un quántomo (id negativo), un mensaje del chat o un texto suelto. */
export type Documento = { id: number; texto: string; fecha?: string | null; tipo?: 'pieza' | 'quantomo' | 'mensaje' | 'texto' }
export type Red = {
  /** Las raíces que quedaron, en orden de fuerza. */
  nodos: { lema: string; forma: string; frec: number; docs: number }[]
  /** Las aristas entre ellos (índices en nodos), sin repetir, con su peso. */
  aristas: [number, number, number][]
  /** Cuántos documentos y lemas entraron; y las palabras que aparecen en casi todo (sugeridas como palabra-puente). */
  documentos: number; lemas: number; automaticas: string[]
}

export const PESOS = [3, 2, 1] // distancia 1, 2, 3

export function construirRed(docs: Documento[], o: { dic?: Diccionario; maxNodos?: number; maxAristasPorNodo?: number; puenteParrafos?: boolean } = {}): Red {
  const dic = o.dic ?? diccionarioVacio()
  const formas = new Map<string, Map<string, number>>()
  const id = new Map<string, number>()
  const lista: string[] = []
  const frec: number[] = []
  const enDocs: number[] = []
  const pares = new Map<number, number>()
  const K = 1 << 21
  const idDe = (l: string) => { let i = id.get(l); if (i == null) { i = lista.length; id.set(l, i); lista.push(l); frec.push(0); enDocs.push(0) } return i }
  let total = 0
  // Primero, cada documento por separado: los lemas y en qué documentos aparece cada uno.
  const secuencias: number[][][] = []
  for (const d of docs) {
    const vistos = new Set<number>()
    const ps = parrafos(d.texto).map((p) => lemas(p, dic, formas).map((l) => { const i = idDe(l); frec[i]++; vistos.add(i); return i })).filter((s) => s.length)
    for (const i of vistos) enDocs[i]++
    total += ps.reduce((s, x) => s + x.length, 0)
    secuencias.push(ps)
  }
  // Las que aparecen en casi todos los documentos (tf-idf): candidatas a palabra-puente, para que él decida.
  const omnipresentes = docs.length >= 30 ? lista.map((_, i) => i).filter((i) => enDocs[i] / docs.length > 0.5 && !dic.proteger.has(lista[i])).sort((a, b) => enDocs[b] - enDocs[a]) : []
  const automaticas = new Set<number>()
  const sumar = (a: number, b: number, p: number) => {
    if (a === b || automaticas.has(a) || automaticas.has(b)) return
    const k = a < b ? a * K + b : b * K + a
    pares.set(k, (pares.get(k) ?? 0) + p)
  }
  for (const ps of secuencias) {
    let anterior: number | null = null
    for (const s0 of ps) {
      const s = s0.filter((i) => !automaticas.has(i))
      for (let i = 0; i < s.length; i++) for (let d = 1; d <= 3 && i + d < s.length; d++) sumar(s[i], s[i + d], PESOS[d - 1])
      // El último de un párrafo con el primero del siguiente (peso 1): la narración no se corta.
      if (o.puenteParrafos && anterior != null && s.length) sumar(anterior, s[0], 1)
      if (s.length) anterior = s[s.length - 1]
    }
  }
  // Los más fuertes: por frecuencia ponderada (lo que aparece y en cuántos documentos).
  const fuerza = (i: number) => frec[i] * (1 + Math.log(1 + enDocs[i]))
  const max = o.maxNodos ?? 1200
  const elegidos = lista.map((_, i) => i).filter((i) => !automaticas.has(i) && frec[i] >= (docs.length > 3 ? 2 : 1)).sort((a, b) => fuerza(b) - fuerza(a)).slice(0, max)
  const nuevo = new Map(elegidos.map((v, k) => [v, k]))
  let aristas: [number, number, number][] = []
  for (const [k, p] of pares) {
    const a = nuevo.get(Math.floor(k / K)), b = nuevo.get(k % K)
    if (a != null && b != null) aristas.push([a, b, p])
  }
  // Para que se pueda leer: cada nodo conserva sus aristas más fuertes (y las débiles que lo unen a alguien fuerte).
  const tope = o.maxAristasPorNodo ?? 12
  aristas.sort((x, y) => y[2] - x[2])
  const grado = new Array(elegidos.length).fill(0)
  aristas = aristas.filter(([a, b]) => { if (grado[a] >= tope && grado[b] >= tope) return false; grado[a]++; grado[b]++; return true })
  return {
    nodos: elegidos.map((i) => ({ lema: lista[i], forma: formaDe(formas, lista[i]), frec: frec[i], docs: enDocs[i] })),
    aristas, documentos: docs.length, lemas: total, automaticas: omnipresentes.map((i) => formaDe(formas, lista[i])).slice(0, 40),
  }
}
