/**
 * Búsqueda híbrida: la de palabras (FTS5) más la de significado (embeddings de NaN), fusionadas por rango (RRF).
 * «cuando me sentía perdido con la plata» encuentra piezas que no dicen esas palabras. Sin NaN o sin vectores, es la
 * búsqueda de siempre.
 * - Pasajes: cada pieza, cortada en tramos de ~1500 caracteres, tiene un vector por tramo (lo hace el reproceso). Así una
 *   charla larga se encuentra por lo que dice en el medio, y la búsqueda devuelve el fragmento exacto. Para buscar rápido
 *   los vectores viven en memoria, cuantizados a int8.
 * - El vector viejo de cada pieza (sus primeros 2000 caracteres) queda como respaldo para lo que todavía no tiene pasajes.
 * - Recuerdos y quántomos también tienen vector: la memoria del prompt se elige por sentido.
 */
import { ajuste, type Db } from './db.ts'
import { buscar, esNivel, leerPieza, type Nivel, type Pieza } from './corpus.ts'
import { nanConfigurado, nanEmbedLote } from './nan.ts'
import { pedirJson } from './modelo.ts'

type Embedder = (db: Db, textos: string[], agente?: string) => Promise<{ vectores: number[][]; modelo: string }>
let embedder: Embedder = async (db, textos, agente = 'semantica') => {
  const r = await nanEmbedLote({ db, clase: 'vectorizador', agenteId: agente }, textos)
  return { vectores: r.embeddings, modelo: r.modelo }
}
let disponible = () => nanConfigurado()
export function _probarEmbed(e: Embedder | null) {
  if (e) { embedder = e; disponible = () => true } else disponible = () => nanConfigurado()
}

/** Qwen3-embedding es «matrioska»: los primeros 1024 valores ya representan bien el sentido (y pesan 4 veces menos). */
const DIMS = 1024
/** Los pasajes y los recuerdos van a 512: alcanza para ordenar por sentido y entran muchos más en memoria. */
export const DIMS_P = 512
const normalizado = (v: ArrayLike<number>, dims: number) => {
  const f = new Float32Array(Math.min(dims, v.length))
  let n = 0
  for (let i = 0; i < f.length; i++) { f[i] = v[i]; n += f[i] * f[i] }
  n = Math.sqrt(n) || 1
  for (let i = 0; i < f.length; i++) f[i] /= n // normalizado: el coseno es un producto punto
  return f
}
const aBlob = (v: number[], dims = DIMS) => Buffer.from(normalizado(v, dims).buffer)
const deBlob = (b: Uint8Array) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
const punto = (a: Float32Array, b: Float32Array) => {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

const textoDe = (p: { titulo: string; contenido: string }) => `${p.titulo}\n${p.contenido}`.slice(0, 2000)

export function estadoVectores(db: Db) {
  const total = (db.prepare('SELECT COUNT(*) AS n FROM corpus').get() as any).n
  const hechos = (db.prepare('SELECT COUNT(*) AS n FROM vectores v JOIN corpus c ON c.id = v.pieza_id').get() as any).n
  const conPasajes = (db.prepare('SELECT COUNT(DISTINCT pieza_id) AS n FROM pasajes').get() as any).n
  return { total, hechos, faltan: total - hechos, conPasajes }
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

// ─── pasajes ────────────────────────────────────────────────────────────

/**
 * Corta un texto en pasajes de hasta «largo» caracteres, por párrafos (y por oraciones si un párrafo es enorme), con un
 * solapamiento al principio de cada uno para no partir una idea al medio. Devuelve posiciones dentro del texto.
 */
export function partirEnPasajes(texto: string, largo = 1500, solape = 200): { desde: number; hasta: number }[] {
  if (texto.length <= largo) return [{ desde: 0, hasta: texto.length }]
  // Cortes naturales: fin de párrafo; si no hay, fin de oración; si no, a la fuerza.
  const cortes: number[] = []
  const re = /\n\s*\n|(?<=[.!?…])\s+/g
  for (let m = re.exec(texto); m; m = re.exec(texto)) cortes.push(m.index + m[0].length)
  const out: { desde: number; hasta: number }[] = []
  let desde = 0
  while (desde < texto.length) {
    const tope = desde + largo
    if (tope >= texto.length) { out.push({ desde, hasta: texto.length }); break }
    // El último corte natural antes del tope (que deje al menos medio pasaje); si no hay, se corta en el tope.
    let hasta = tope
    for (const c of cortes) { if (c > desde + largo / 2 && c <= tope) hasta = c; if (c > tope) break }
    out.push({ desde, hasta })
    desde = Math.max(hasta - solape, desde + 1)
    // Que el pasaje siguiente arranque en un borde de palabra.
    const espacio = texto.indexOf(' ', desde)
    if (espacio > 0 && espacio < hasta) desde = espacio + 1
  }
  return out
}

/** Hace los pasajes (con su vector) de esas piezas. Devuelve cuántos pasajes guardó. */
export async function pasajesDe(db: Db, ids: number[], ahora = Date.now()): Promise<number> {
  if (!disponible() || !ids.length) return 0
  const tareas: { pieza: number; orden: number; desde: number; hasta: number; texto: string }[] = []
  for (const id of ids) {
    const p = db.prepare('SELECT id, titulo, contenido FROM corpus WHERE id = ?').get(id) as { id: number; titulo: string; contenido: string } | undefined
    if (!p) continue
    partirEnPasajes(p.contenido).forEach((x, orden) => tareas.push({ pieza: p.id, orden, ...x, texto: `${p.titulo}\n\n${p.contenido.slice(x.desde, x.hasta)}` }))
  }
  const ins = db.prepare('INSERT INTO pasajes (pieza_id, orden, desde, hasta, modelo, vec, en) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const filas: { t: (typeof tareas)[number]; v: number[]; modelo: string }[] = []
  for (let i = 0; i < tareas.length; i += 32) {
    const tanda = tareas.slice(i, i + 32)
    const r = await embedder(db, tanda.map((t) => t.texto), 'reproceso-vec')
    tanda.forEach((t, k) => { if (r.vectores[k]?.length) filas.push({ t, v: r.vectores[k], modelo: r.modelo }) })
  }
  // Se guarda todo junto al final: una pieza queda con todos sus pasajes o con ninguno.
  const porPieza = new Set(filas.map((f) => f.t.pieza))
  db.exec('BEGIN')
  try {
    for (const id of porPieza) db.prepare('DELETE FROM pasajes WHERE pieza_id = ?').run(id)
    for (const f of filas) ins.run(f.t.pieza, f.t.orden, f.t.desde, f.t.hasta, f.modelo, aBlob(f.v, DIMS_P), ahora)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  if (porPieza.size) indices.delete(db) // se recarga entero: los ids de los reemplazados cambiaron
  return filas.length
}

/** El índice en memoria: cada pasaje cuantizado a int8 con su escala (unos 520 bytes por pasaje). */
type Fila = { id: number; pieza: number; desde: number; hasta: number; q: Int8Array; esc: number }
const indices = new WeakMap<Db, { filas: Fila[]; ultimo: number }>()

export function cuantizar(v: Float32Array): { q: Int8Array; esc: number } {
  let max = 0
  for (const x of v) max = Math.max(max, Math.abs(x))
  const esc = max / 127 || 1
  const q = new Int8Array(v.length)
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] / esc)
  return { q, esc }
}

function indice(db: Db) {
  let ix = indices.get(db)
  // Si se borraron pasajes (una pieza que cambió o se fue), se recarga entero.
  if (ix && (db.prepare('SELECT COUNT(*) AS n FROM pasajes WHERE id <= ?').get(ix.ultimo) as { n: number }).n !== ix.filas.length) ix = undefined
  if (!ix) { ix = { filas: [], ultimo: 0 }; indices.set(db, ix) }
  // Solo lo nuevo desde la última vez.
  const nuevas = db.prepare('SELECT id, pieza_id, desde, hasta, vec FROM pasajes WHERE id > ? ORDER BY id').all(ix.ultimo) as any[]
  for (const r of nuevas) {
    ix.filas.push({ id: r.id, pieza: r.pieza_id, desde: r.desde, hasta: r.hasta, ...cuantizar(deBlob(r.vec)) })
    ix.ultimo = r.id
  }
  return ix
}

/** Los pasajes más cercanos, agrupados por pieza (cada una con su mejor pasaje). */
function cercanosPorPasaje(db: Db, q: Float32Array, limite: number, niveles?: Nivel[]): { id: number; sim: number; desde: number; hasta: number }[] {
  const ix = indice(db)
  if (!ix.filas.length) return []
  const qq = normalizado(q, DIMS_P)
  const puntajes: { f: Fila; sim: number }[] = []
  for (const f of ix.filas) {
    let s = 0
    for (let i = 0; i < f.q.length; i++) s += f.q[i] * qq[i]
    puntajes.push({ f, sim: s * f.esc })
  }
  puntajes.sort((a, b) => b.sim - a.sim)
  const mejor = new Map<number, { id: number; sim: number; desde: number; hasta: number }>()
  for (const x of puntajes.slice(0, Math.max(200, limite * 20))) {
    if (!mejor.has(x.f.pieza)) mejor.set(x.f.pieza, { id: x.f.pieza, sim: x.sim, desde: x.f.desde, hasta: x.f.hasta })
  }
  let out = [...mejor.values()]
  if (niveles?.length && out.length) {
    const ok = new Set((db.prepare(`SELECT id FROM corpus WHERE id IN (${out.map(() => '?').join(',')}) AND nivel IN (${niveles.map(() => '?').join(',')})`).all(...out.map((x) => x.id), ...niveles) as { id: number }[]).map((r) => r.id))
    out = out.filter((x) => ok.has(x.id))
  }
  return out.slice(0, limite)
}

// La consulta se repite mucho (el chat busca lo mismo varias veces): guardo las últimas.
const consultas = new Map<string, Float32Array>()

export async function vectorDe(db: Db, consulta: string): Promise<Float32Array | null> {
  if (!disponible()) return null
  const k = consulta.trim().toLowerCase()
  if (consultas.has(k)) return consultas.get(k)!
  const r = await embedder(db, [consulta.slice(0, 1000)])
  if (!r.vectores[0]?.length) return null
  const v = normalizado(r.vectores[0], DIMS)
  consultas.set(k, v)
  if (consultas.size > 200) consultas.delete(consultas.keys().next().value!)
  return v
}

/** Las piezas más cercanas en significado: por sus pasajes y, lo que no tiene pasajes, por su vector viejo. */
export async function cercanas(db: Db, consulta: string, limite: number, niveles?: Nivel[]): Promise<{ id: number; sim: number; desde?: number; hasta?: number }[]> {
  if (!disponible()) return []
  const hayViejos = db.prepare('SELECT 1 FROM vectores LIMIT 1').get()
  const hayPasajes = db.prepare('SELECT 1 FROM pasajes LIMIT 1').get()
  if (!hayViejos && !hayPasajes) return []
  const q = await vectorDe(db, consulta)
  if (!q) return []
  const out = new Map<number, { id: number; sim: number; desde?: number; hasta?: number }>()
  if (hayPasajes) for (const x of cercanosPorPasaje(db, q, limite * 2, niveles)) out.set(x.id, x)
  if (hayViejos) {
    const filtro = niveles?.length ? `AND c.nivel IN (${niveles.map(() => '?').join(',')})` : ''
    // Solo las que todavía no tienen pasajes: las otras ya están mejor representadas.
    const filas = db.prepare(`SELECT v.pieza_id AS id, v.vec FROM vectores v JOIN corpus c ON c.id = v.pieza_id WHERE NOT EXISTS (SELECT 1 FROM pasajes p WHERE p.pieza_id = v.pieza_id) ${filtro}`).all(...(niveles ?? [])) as any[]
    for (const f of filas) {
      const v = deBlob(f.vec)
      if (v.length !== q.length) continue // otro modelo
      const sim = punto(v, q)
      if (!out.has(f.id) || out.get(f.id)!.sim < sim) out.set(f.id, { id: f.id, sim })
    }
  }
  return [...out.values()].sort((a, b) => b.sim - a.sim).slice(0, limite)
}

export type PiezaHallada = Pieza & { por?: string; fragmento?: string }

/**
 * Híbrida: une la lista por palabras y la por significado con Reciprocal Rank Fusion (1 / (60 + puesto)).
 * Lo generado sigue yendo al final, como en la búsqueda de siempre. Lo que se encontró por un pasaje trae su fragmento.
 */
export async function buscarHibrido(db: Db, consulta: string, limite: number, niveles?: Nivel[]): Promise<PiezaHallada[]> {
  const porPalabras = buscar(db, consulta, limite * 2, null, niveles)
  let porSentido: { id: number; sim: number; desde?: number; hasta?: number }[] = []
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
  const sentido = porSentido.filter((x) => x.sim > 0.25)
  sentido.forEach((x, i) => sumar(x.id, i, 'sentido'))
  const tramo = new Map(sentido.filter((x) => x.desde != null).map((x) => [x.id, x]))
  const ids = [...puntos.keys()]
  const piezas = new Map<number, Pieza>(porPalabras.map((p) => [p.id, p]))
  for (const id of ids.filter((i) => !piezas.has(i))) { const p = leerPieza(db, id); if (p) piezas.set(id, p) }
  return ids
    .filter((id) => piezas.has(id))
    .sort((a, b) => Number(piezas.get(a)!.nivel === 'generada') - Number(piezas.get(b)!.nivel === 'generada') || puntos.get(b)!.s - puntos.get(a)!.s)
    .slice(0, limite)
    .map((id) => {
      const p = piezas.get(id)!
      const t = tramo.get(id)
      // El fragmento solo si no es el principio (eso ya lo muestra el extracto).
      return { ...p, por: [...puntos.get(id)!.por].join('+'), fragmento: t && t.desde! > 0 ? p.contenido.slice(t.desde, t.hasta) : undefined }
    })
}

export const nivelesDe = (n?: string | null): Nivel[] | undefined => (n && esNivel(n) ? [n] : undefined)

// ─── recuerdos y quántomos ──────────────────────────────────────────────

/** Vectoriza los recuerdos vigentes y los quántomos (sellados y proto) que todavía no tienen vector. */
export async function vectorizarItems(db: Db, limite = 256, ahora = Date.now()): Promise<number> {
  if (!disponible()) return 0
  const faltan = db.prepare(`
    SELECT 'memoria' AS tipo, m.id, m.texto FROM memoria m WHERE m.estado = 'vigente' AND NOT EXISTS (SELECT 1 FROM vec_items v WHERE v.tipo = 'memoria' AND v.id = m.id)
    UNION ALL
    SELECT 'quantomo', q.id, COALESCE(q.titulo || ': ', '') || q.texto FROM quantomos q WHERE q.etapa IN ('sellado', 'proto') AND NOT EXISTS (SELECT 1 FROM vec_items v WHERE v.tipo = 'quantomo' AND v.id = q.id)
    LIMIT ?`).all(limite) as { tipo: string; id: number; texto: string }[]
  const ins = db.prepare('INSERT OR REPLACE INTO vec_items (tipo, id, modelo, vec, en) VALUES (?, ?, ?, ?, ?)')
  let n = 0
  for (let i = 0; i < faltan.length; i += 32) {
    const tanda = faltan.slice(i, i + 32)
    const r = await embedder(db, tanda.map((x) => x.texto.slice(0, 1500)), 'reproceso-vec')
    tanda.forEach((x, k) => { if (r.vectores[k]?.length) (ins.run(x.tipo, x.id, r.modelo, aBlob(r.vectores[k], DIMS_P), ahora), n++) })
  }
  return n
}

/** Los vectores de un tipo de ítem (para ordenar por sentido o juntar repetidos). */
export function vectoresDe(db: Db, tipo: 'memoria' | 'quantomo'): Map<number, Float32Array> {
  return new Map((db.prepare('SELECT id, vec FROM vec_items WHERE tipo = ?').all(tipo) as { id: number; vec: Uint8Array }[]).map((r) => [r.id, deBlob(r.vec)]))
}

/** Similitud por sentido entre la consulta (vector de 1024 o 512) y un ítem (512). */
export const parecidoA = (q: Float32Array, v: Float32Array) => punto(normalizado(q, DIMS_P), v)

// ─── lo del archivo que va al chat ──────────────────────────────────────

let reordenar = async (db: Db, consulta: string, candidatos: { clave: string; texto: string }[]): Promise<string[]> => {
  const { datos } = await pedirJson<{ elegidos?: string[] }>({ db, clase: 'clasificador', agenteId: 'reproceso-rerank' },
    'Elegís, de una lista de fragmentos del archivo personal de alguien, los que sirven para contestar su mensaje. Solo los que de verdad aportan (pueden ser ninguno). Del más útil al menos. Forma: {"elegidos": ["clave", ...]} (máximo 6).',
    `Mensaje: ${consulta.slice(0, 800)}\n\nFragmentos:\n${candidatos.map((c) => `[${c.clave}] ${c.texto.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')}`,
    { temperatura: 0, maxTokens: 300 })
  return Array.isArray(datos.elegidos) ? datos.elegidos.map(String) : []
}
export function _probarReordenar(f: typeof reordenar) {
  reordenar = f
}

/**
 * Lo que su archivo dice de lo que acaba de escribir: los pasajes y quántomos sellados más cercanos (híbrido), y si hay
 * más de los que entran, un modelo chico elige los que sirven. Vuelve como bloque para el prompt, con ids para citar.
 */
export async function archivoRelevante(db: Db, mensaje: string, o: { max?: number } = {}): Promise<{ texto: string; vec: Float32Array | null }> {
  const max = o.max ?? 6
  const limpio = mensaje.replace(/\[imagen:[^\]]*\]/g, '').trim()
  if (limpio.length < 12 || !disponible()) return { texto: '', vec: null }
  let vec: Float32Array | null = null
  try { vec = await vectorDe(db, limpio) } catch { return { texto: '', vec: null } }
  const piezas = (await buscarHibrido(db, limpio, 14).catch(() => [] as PiezaHallada[])).filter((p) => p.por?.includes('sentido') || p.nivel !== 'generada')
  const qs = vec ? [...vectoresDe(db, 'quantomo')].map(([id, v]) => ({ id, sim: parecidoA(vec!, v) })).filter((x) => x.sim > 0.45).sort((a, b) => b.sim - a.sim).slice(0, 6) : []
  const quantomos = qs.length ? db.prepare(`SELECT id, texto, peso, pieza_id FROM quantomos WHERE etapa = 'sellado' AND id IN (${qs.map(() => '?').join(',')})`).all(...qs.map((x) => x.id)) as { id: number; texto: string; peso: number | null; pieza_id: number | null }[] : []
  const candidatos = [
    ...piezas.map((p) => ({ clave: `p${p.id}`, texto: `«${p.titulo}»${p.fecha ? ` (${p.fecha.slice(0, 10)})` : ''}: ${p.fragmento ?? p.contenido.slice(0, 600)}`, linea: `- [#${p.id}] «${p.titulo}»${p.fecha ? ` · ${p.fecha.slice(0, 10)}` : ''} · ${p.nivel}: ${(p.fragmento ?? p.contenido).replace(/\s+/g, ' ').slice(0, 700)}` })),
    ...quantomos.map((q) => ({ clave: `q${q.id}`, texto: q.texto, linea: `- [#${q.pieza_id ?? '?'}] (quántomo sellado${q.peso ? `, peso ${q.peso}` : ''}) ${q.texto.slice(0, 400)}` })),
  ]
  if (!candidatos.length) return { texto: '', vec }
  let elegidos = candidatos.slice(0, max)
  if (candidatos.length > max && ajuste(db, 'reproceso_rerank') !== '0') {
    try {
      const claves = await reordenar(db, limpio, candidatos)
      const porClave = new Map(candidatos.map((c) => [c.clave, c]))
      elegidos = claves.map((k) => porClave.get(k)).filter((c): c is (typeof candidatos)[number] => !!c).slice(0, max)
    } catch { /* sin modelo: quedan los de mejor puntaje */ }
  }
  if (!elegidos.length) return { texto: '', vec }
  return { texto: `Lo que su archivo dice de esto (lo encontré sin que lo pidas; citalo con su [#id] si lo usás, y si no alcanza, buscá más):\n${elegidos.map((c) => c.linea).join('\n')}`, vec }
}
