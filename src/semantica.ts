/**
 * Búsqueda híbrida: la de palabras (FTS5) más la de significado (embeddings de NaN), fusionadas por rango (RRF).
 * «cuando me sentía perdido con la plata» encuentra piezas que no dicen esas palabras. Los vectores van en su propia
 * tabla (Float32, un modelo), aparte de los de la liga; se calculan de a tandas, primero lo propio.
 * Sin NaN o sin vectores, es la búsqueda de siempre.
 */
import { type Db } from './db.ts'
import { buscar, esNivel, leerPieza, type Nivel, type Pieza } from './corpus.ts'
import { nanConfigurado, nanEmbedLote } from './nan.ts'

type Embedder = (db: Db, textos: string[]) => Promise<{ vectores: number[][]; modelo: string }>
let embedder: Embedder = async (db, textos) => {
  const r = await nanEmbedLote({ db, clase: 'vectorizador', agenteId: 'semantica' }, textos)
  return { vectores: r.embeddings, modelo: r.modelo }
}
let disponible = () => nanConfigurado()
export function _probarEmbed(e: Embedder | null) {
  if (e) { embedder = e; disponible = () => true } else disponible = () => nanConfigurado()
}

/** Qwen3-embedding es «matrioska»: los primeros 1024 valores ya representan bien el sentido (y pesan 4 veces menos). */
const DIMS = 1024
const aBlob = (v: number[]) => {
  const f = new Float32Array(v.slice(0, DIMS))
  let n = 0
  for (const x of f) n += x * x
  n = Math.sqrt(n) || 1
  for (let i = 0; i < f.length; i++) f[i] /= n // normalizado: el coseno es un producto punto
  return Buffer.from(f.buffer)
}
const deBlob = (b: Uint8Array) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)

const textoDe = (p: { titulo: string; contenido: string }) => `${p.titulo}\n${p.contenido}`.slice(0, 2000)

export function estadoVectores(db: Db) {
  const total = (db.prepare('SELECT COUNT(*) AS n FROM corpus').get() as any).n
  const hechos = (db.prepare('SELECT COUNT(*) AS n FROM vectores v JOIN corpus c ON c.id = v.pieza_id').get() as any).n
  return { total, hechos, faltan: total - hechos }
}

/** Calcula los vectores que faltan (de a tandas de 16): primero lo propio y lo más pesado. */
export async function vectorizarPendientes(db: Db, o: { limite?: number; ahora?: number } = {}): Promise<{ hechos: number; faltan: number }> {
  if (!disponible()) return { hechos: 0, faltan: estadoVectores(db).faltan }
  const filas = db.prepare(`SELECT c.id, c.titulo, c.contenido FROM corpus c LEFT JOIN vectores v ON v.pieza_id = c.id WHERE v.pieza_id IS NULL
    ORDER BY c.nivel = 'propia' DESC, c.nivel = 'generada', COALESCE(c.peso, 0) DESC, c.id DESC LIMIT ?`).all(o.limite ?? 64) as any[]
  let hechos = 0
  for (let i = 0; i < filas.length; i += 16) {
    const tanda = filas.slice(i, i + 16)
    const r = await embedder(db, tanda.map(textoDe))
    const ins = db.prepare('INSERT OR REPLACE INTO vectores (pieza_id, modelo, dims, vec, en) VALUES (?, ?, ?, ?, ?)')
    tanda.forEach((p, k) => {
      const v = r.vectores[k]
      if (v?.length) { ins.run(p.id, r.modelo, Math.min(v.length, DIMS), aBlob(v), o.ahora ?? Date.now()); hechos++ }
    })
  }
  return { hechos, faltan: estadoVectores(db).faltan }
}

// La consulta se repite mucho (el chat busca lo mismo varias veces): guardo las últimas.
const consultas = new Map<string, Float32Array>()

async function vectorDe(db: Db, consulta: string): Promise<Float32Array | null> {
  const k = consulta.trim().toLowerCase()
  if (consultas.has(k)) return consultas.get(k)!
  const r = await embedder(db, [consulta.slice(0, 1000)])
  if (!r.vectores[0]?.length) return null
  const v = deBlob(aBlob(r.vectores[0]))
  consultas.set(k, v)
  if (consultas.size > 200) consultas.delete(consultas.keys().next().value!)
  return v
}

/** Las piezas más cercanas en significado. */
export async function cercanas(db: Db, consulta: string, limite: number, niveles?: Nivel[]): Promise<{ id: number; sim: number }[]> {
  if (!disponible()) return []
  const hay = (db.prepare('SELECT 1 FROM vectores LIMIT 1').get())
  if (!hay) return []
  const q = await vectorDe(db, consulta)
  if (!q) return []
  const filtro = niveles?.length ? `WHERE c.nivel IN (${niveles.map(() => '?').join(',')})` : ''
  const filas = db.prepare(`SELECT v.pieza_id AS id, v.vec FROM vectores v JOIN corpus c ON c.id = v.pieza_id ${filtro}`).all(...(niveles ?? [])) as any[]
  const out: { id: number; sim: number }[] = []
  for (const f of filas) {
    const v = deBlob(f.vec)
    if (v.length !== q.length) continue // otro modelo
    let s = 0
    for (let i = 0; i < v.length; i++) s += v[i] * q[i]
    out.push({ id: f.id, sim: s })
  }
  return out.sort((a, b) => b.sim - a.sim).slice(0, limite)
}

/**
 * Híbrida: une la lista por palabras y la por significado con Reciprocal Rank Fusion (1 / (60 + puesto)).
 * Lo generado sigue yendo al final, como en la búsqueda de siempre.
 */
export async function buscarHibrido(db: Db, consulta: string, limite: number, niveles?: Nivel[]): Promise<(Pieza & { por?: string })[]> {
  const porPalabras = buscar(db, consulta, limite * 2, null, niveles)
  let porSentido: { id: number; sim: number }[] = []
  try { porSentido = await cercanas(db, consulta, limite * 2, niveles) } catch { /* sin red: queda lo de palabras */ }
  if (!porSentido.length) return porPalabras.slice(0, limite)
  const puntos = new Map<number, { s: number; por: Set<string> }>()
  const sumar = (id: number, puesto: number, por: string) => {
    const x = puntos.get(id) ?? { s: 0, por: new Set<string>() }
    x.s += 1 / (60 + puesto)
    x.por.add(por)
    puntos.set(id, x)
  }
  porPalabras.forEach((p, i) => sumar(p.id, i, 'palabras'))
  porSentido.filter((x) => x.sim > 0.25).forEach((x, i) => sumar(x.id, i, 'sentido'))
  const ids = [...puntos.keys()]
  const piezas = new Map<number, Pieza>(porPalabras.map((p) => [p.id, p]))
  const faltan = ids.filter((id) => !piezas.has(id))
  for (const id of faltan) { const p = leerPieza(db, id); if (p) piezas.set(id, p) }
  return ids
    .filter((id) => piezas.has(id))
    .sort((a, b) => Number(piezas.get(a)!.nivel === 'generada') - Number(piezas.get(b)!.nivel === 'generada') || puntos.get(b)!.s - puntos.get(a)!.s)
    .slice(0, limite)
    .map((id) => ({ ...piezas.get(id)!, por: [...puntos.get(id)!.por].join('+') }))
}

export const nivelesDe = (n?: string | null): Nivel[] | undefined => (n && esNivel(n) ? [n] : undefined)
