/**
 * La segunda capa del grafo: aristas por sentido (Fragua #229). La arista de siempre dice «estas dos palabras aparecen en
 * el mismo texto»; por eso no hay puente entre dos cosas que nunca se nombran juntas aunque hablen de lo mismo (camiones
 * y BBVA; el Plan de Igualdad y la auditoría retributiva). Esta capa mira el sentido:
 * - el vector de cada concepto es el promedio de los vectores de las piezas donde aparece (los pasajes que ya hizo el
 *   reproceso: no se pide ningún embedding nuevo, no gasta nada);
 * - se le resta el promedio de todos (si no, lo que aparece en todo se parece a todo) y se compara de a pares;
 * - arista de sentido: dos conceptos muy cercanos que NO tienen arista literal (lo que dice lo mismo con otras palabras
 *   y todavía no conectó);
 * - hueco de sentido: dos grupos que se parecen por lo que dicen pero casi no se tocan en el texto. Esos son los huecos
 *   que importan para las ideas nuevas.
 * Se calcula de a poco (cediendo el turno) y se guarda por foto.
 */
import { json, type Db } from '../db.ts'
import { blobAVec } from '../semantica.ts'
import type { Foto } from './index.ts'

export type AristaSentido = [number, number, number] // a, b, similitud (0–1)
export type HuecoSentido = { a: number; b: number; sentido: number; literal: number; terminosA: string[]; terminosB: string[] }
export type Sentido = { fotoId: number; conceptos: number; aristas: AristaSentido[]; huecos: HuecoSentido[]; en: number; aviso?: string }

const ceder = () => new Promise<void>((ok) => setImmediate(ok))
const MAX_CONCEPTOS = 500

function normalizar(v: Float32Array) {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}
const punto = (a: Float32Array, b: Float32Array) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s }

/** El vector de cada pieza: el promedio de sus pasajes (de a 300 piezas, cediendo el turno). */
async function vectoresDePiezas(db: Db, ids: number[]): Promise<Map<number, Float32Array>> {
  const out = new Map<number, Float32Array>()
  const sumas = new Map<number, { v: Float32Array; n: number }>()
  for (let k = 0; k < ids.length; k += 300) {
    const tanda = ids.slice(k, k + 300)
    const filas = db.prepare(`SELECT pieza_id, vec FROM pasajes WHERE pieza_id IN (${tanda.map(() => '?').join(',')})`).all(...tanda) as { pieza_id: number; vec: Uint8Array }[]
    for (const f of filas) {
      const v = blobAVec(f.vec)
      const s = sumas.get(f.pieza_id) ?? { v: new Float32Array(v.length), n: 0 }
      for (let i = 0; i < Math.min(v.length, s.v.length); i++) s.v[i] += v[i]
      s.n++
      sumas.set(f.pieza_id, s)
    }
    await ceder()
  }
  for (const [id, s] of sumas) out.set(id, normalizar(s.v))
  return out
}

/** Calcula la capa de sentido de una foto (sin guardarla). */
export async function calcularSentido(db: Db, foto: Pick<Foto, 'id' | 'nodos' | 'aristas' | 'comunidades' | 'ejemplos'>, ahora = Date.now()): Promise<Sentido> {
  const vacio = (aviso: string): Sentido => ({ fotoId: foto.id, conceptos: 0, aristas: [], huecos: [], en: ahora, aviso })
  if (!foto.ejemplos?.length) return vacio('Esta foto es anterior a la capa de sentido: recalculá el grafo.')
  // Los conceptos con más peso (bisagras primero), los que tienen piezas con pasajes.
  const candidatos = foto.nodos.filter((n) => !n.vos && (foto.ejemplos![n.i]?.length ?? 0) > 0).sort((a, b) => b.btw - a.btw || b.frec - a.frec).slice(0, MAX_CONCEPTOS)
  const piezas = await vectoresDePiezas(db, [...new Set(candidatos.flatMap((n) => foto.ejemplos![n.i]))])
  if (!piezas.size) return vacio('Las piezas de este grafo todavía no tienen pasajes (los hace el reproceso).')
  const conceptos: { i: number; v: Float32Array }[] = []
  for (const n of candidatos) {
    const vs = foto.ejemplos![n.i].map((id) => piezas.get(id)).filter((x): x is Float32Array => !!x)
    if (!vs.length) continue
    const v = new Float32Array(vs[0].length)
    for (const x of vs) for (let i = 0; i < v.length; i++) v[i] += x[i]
    conceptos.push({ i: n.i, v })
  }
  if (conceptos.length < 3) return vacio('Muy pocos conceptos con pasajes para comparar.')
  // Centrar: lo que aparece en todo se parecería a todo.
  const media = new Float32Array(conceptos[0].v.length)
  for (const c of conceptos) { normalizar(c.v); for (let i = 0; i < media.length; i++) media[i] += c.v[i] / conceptos.length }
  for (const c of conceptos) { for (let i = 0; i < media.length; i++) c.v[i] -= media[i]; normalizar(c.v) }
  // Todas contra todas (500 → 125 mil pares), cediendo el turno cada tanto.
  const literal = new Set(foto.aristas.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)))
  const sims: { a: number; b: number; s: number }[] = []
  for (let x = 0; x < conceptos.length; x++) {
    for (let y = x + 1; y < conceptos.length; y++) sims.push({ a: conceptos[x].i, b: conceptos[y].i, s: punto(conceptos[x].v, conceptos[y].v) })
    if (x % 50 === 49) await ceder()
  }
  // El umbral: lo más parecido entre lo que NO está unido en el texto (el 2 % de arriba), nunca por debajo de 0,35.
  const sinLiteral = sims.filter((p) => !literal.has(p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`))
  const orden = sinLiteral.map((p) => p.s).sort((a, b) => b - a)
  const umbral = Math.max(0.35, orden[Math.floor(orden.length * 0.02)] ?? 1)
  const porNodo = new Map<number, number>()
  const aristas: AristaSentido[] = []
  for (const p of sinLiteral.filter((p) => p.s >= umbral).sort((a, b) => b.s - a.s)) {
    if ((porNodo.get(p.a) ?? 0) >= 3 || (porNodo.get(p.b) ?? 0) >= 3) continue
    porNodo.set(p.a, (porNodo.get(p.a) ?? 0) + 1); porNodo.set(p.b, (porNodo.get(p.b) ?? 0) + 1)
    aristas.push([p.a, p.b, +p.s.toFixed(3)])
    if (aristas.length >= 600) break
  }
  // Los huecos de sentido: grupos parecidos por lo que dicen (centroides) y con poco puente literal.
  const comDe = new Map(foto.nodos.map((n) => [n.i, n.com]))
  const grupos = foto.comunidades.filter((c) => c.tam >= 3).sort((a, b) => b.tam - a.tam).slice(0, 14)
  const centro = new Map<number, Float32Array>()
  for (const g of grupos) {
    const vs = conceptos.filter((c) => comDe.get(c.i) === g.id)
    if (vs.length < 2) continue
    const v = new Float32Array(vs[0].v.length)
    for (const c of vs) for (let i = 0; i < v.length; i++) v[i] += c.v[i]
    centro.set(g.id, normalizar(v))
  }
  // El peso literal entre grupos y dentro de cada uno, en una pasada.
  const pesos = new Map<string, number>()
  for (const [x, y, p] of foto.aristas) {
    const cx = comDe.get(x), cy = comDe.get(y)
    if (cx == null || cy == null) continue
    const k = cx < cy ? `${cx}|${cy}` : `${cy}|${cx}`
    pesos.set(k, (pesos.get(k) ?? 0) + p)
  }
  const pesoEntre = (a: number, b: number) => pesos.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0
  const pesoDentro = (a: number) => pesos.get(`${a}|${a}`) || 1
  const huecos: HuecoSentido[] = []
  const ids = [...centro.keys()]
  for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
    const a = ids[x], b = ids[y]
    const s = punto(centro.get(a)!, centro.get(b)!)
    const l = pesoEntre(a, b) / Math.min(pesoDentro(a), pesoDentro(b))
    if (s >= 0.3 && l < 0.05) huecos.push({ a, b, sentido: +s.toFixed(3), literal: +l.toFixed(4), terminosA: grupos.find((g) => g.id === a)!.top.slice(0, 5), terminosB: grupos.find((g) => g.id === b)!.top.slice(0, 5) })
  }
  huecos.sort((p, q) => q.sentido - q.literal * 5 - (p.sentido - p.literal * 5))
  return { fotoId: foto.id, conceptos: conceptos.length, aristas, huecos: huecos.slice(0, 6), en: ahora }
}

// ─── guardado y cálculo de fondo ────────────────────────────────────────

export function sentidoGuardado(db: Db, fotoId: number): Sentido | null {
  const r = db.prepare('SELECT datos FROM grafo_sentido WHERE foto_id = ?').get(fotoId) as { datos: string } | undefined
  return r ? json<Sentido>(r.datos, null as any) : null
}
const enCurso = new Set<number>()
export const calculandoSentido = (fotoId: number) => enCurso.has(fotoId)

/** Lo guardado de esa foto; si no hay, lo empieza a calcular de fondo (y devuelve null mientras tanto). */
export function sentidoDe(db: Db, foto: Foto): Sentido | null {
  const ya = sentidoGuardado(db, foto.id)
  if (ya || enCurso.has(foto.id)) return ya
  enCurso.add(foto.id)
  void calcularSentido(db, foto).then((s) => {
    db.prepare('INSERT OR REPLACE INTO grafo_sentido (foto_id, datos, en) VALUES (?, ?, ?)').run(foto.id, JSON.stringify(s), Date.now())
  }).catch((e) => console.error('  grafo sentido:', e instanceof Error ? e.message : e)).finally(() => enCurso.delete(foto.id))
  return null
}
