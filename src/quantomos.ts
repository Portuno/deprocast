/**
 * Quántomos: la unidad mínima de información. Una afirmación atómica destilada de una pieza.
 *
 * Ciclo: proto (lo propone un extractor o una carga) → sellado (el operador lo pesa 1–12).
 * Mejora: un generativo propone una versión nueva (propuesta, con padre). Si el operador la acepta,
 * la propuesta queda sellada y la anterior pasa a superado. Nada se pisa: las versiones quedan.
 */
import { json, type Db } from './db.ts'
import { anotar } from './decisiones.ts'
import { publicar, type Tarea } from './bus.ts'

export type Etapa = 'proto' | 'sellado' | 'propuesta' | 'superado' | 'descartado'

export type Quantomo = {
  id: number
  origenId: string | null
  piezaId: number | null
  titulo: string | null
  texto: string
  peso: number | null
  etapa: Etapa
  version: number
  padreId: number | null
  universo: string | null
  procedencia: string | null
  l72: Record<string, unknown> | null
  facetas: Record<string, unknown>[]
  tareaId: number | null
  cargaId: number | null
  creadoEn: number
  actualizadoEn: number
  /** nueva | variacion | repetida (null: todavía sin vector) y de cuál, por sentido. */
  novedad: string | null
  novedadDe: number | null
  novedadSim: number | null
}

function deFila(r: any): Quantomo {
  return {
    id: r.id,
    origenId: r.origen_id,
    piezaId: r.pieza_id,
    titulo: r.titulo,
    texto: r.texto,
    peso: r.peso,
    etapa: r.etapa,
    version: r.version,
    padreId: r.padre_id,
    universo: r.universo,
    procedencia: r.procedencia,
    l72: json(r.l72, null),
    facetas: json(r.facetas, []),
    tareaId: r.tarea_id,
    cargaId: r.carga_id,
    creadoEn: r.creado_en,
    actualizadoEn: r.actualizado_en,
    novedad: r.novedad ?? null,
    novedadDe: r.novedad_de ?? null,
    novedadSim: r.novedad_sim ?? null,
  }
}

export type NuevoQuantomo = {
  texto: string
  titulo?: string | null
  piezaId?: number | null
  peso?: number | null
  etapa?: Etapa
  version?: number
  padreId?: number | null
  universo?: string | null
  procedencia?: string | null
  l72?: Record<string, unknown> | null
  facetas?: Record<string, unknown>[]
  tareaId?: number | null
  origenId?: string | null
  cargaId?: number | null
}

/** null si ya existía uno con el mismo origen. */
export function crearQuantomo(db: Db, q: NuevoQuantomo, ahora = Date.now()): number | null {
  const texto = q.texto.trim()
  if (!texto) throw new Error('Un quántomo vacío no es un quántomo')
  const r = db.prepare(
    `INSERT OR IGNORE INTO quantomos (origen_id, pieza_id, titulo, texto, peso, etapa, version, padre_id, universo, procedencia, l72, facetas, tarea_id, carga_id, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    q.origenId ?? null, q.piezaId ?? null, q.titulo ?? null, texto, q.peso ?? null, q.etapa ?? 'proto', q.version ?? 1,
    q.padreId ?? null, q.universo ?? null, q.procedencia ?? null, q.l72 ? JSON.stringify(q.l72) : null,
    q.facetas?.length ? JSON.stringify(q.facetas) : null, q.tareaId ?? null, q.cargaId ?? null, ahora, ahora,
  )
  return r.changes ? Number(r.lastInsertRowid) : null
}

export function leerQuantomo(db: Db, id: number): Quantomo | null {
  const r = db.prepare('SELECT * FROM quantomos WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

export function quantomosDePieza(db: Db, piezaId: number): Quantomo[] {
  return db.prepare(`SELECT * FROM quantomos WHERE pieza_id = ? AND etapa NOT IN ('superado', 'descartado') ORDER BY id`).all(piezaId).map(deFila)
}

export function listarQuantomos(db: Db, f: { etapa?: string; q?: string; pesoMin?: number; desde?: number; limite?: number; novedad?: string } = {}) {
  const where: string[] = []
  const args: (string | number)[] = []
  if (f.etapa) where.push('etapa = ?'), args.push(f.etapa)
  else where.push(`etapa NOT IN ('superado', 'descartado')`)
  if (f.q) where.push('(texto LIKE ? OR titulo LIKE ?)'), args.push(`%${f.q}%`, `%${f.q}%`)
  if (f.pesoMin) where.push('peso >= ?'), args.push(f.pesoMin)
  if (f.novedad) where.push('novedad = ?'), args.push(f.novedad)
  const w = `WHERE ${where.join(' AND ')}`
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM quantomos ${w}`).get(...args) as { n: number }).n
  const filas = db.prepare(`SELECT * FROM quantomos ${w} ORDER BY etapa = 'propuesta' DESC, etapa = 'proto' DESC, actualizado_en DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, f.limite ?? 50, f.desde ?? 0)
  return { total, quantomos: filas.map(deFila) }
}

// ─── ¿idea nueva o repetida? ────────────────────────────────────────────

export const UMBRAL_REPETIDA = 0.92
export const UMBRAL_VARIACION = 0.8

/** Los vectores de los quántomos, cuantizados a int8 y en memoria (4 veces menos que float), por base; se completa con lo nuevo. */
const vectoresQ = new WeakMap<Db, { hasta: number; ids: number[]; q: Int8Array[]; esc: number[] }>()
const soltar = () => new Promise<void>((ok) => setImmediate(ok))

async function vectoresDeQuantomos(db: Db) {
  let c = vectoresQ.get(db)
  if (!c) { c = { hasta: 0, ids: [], q: [], esc: [] }; vectoresQ.set(db, c) }
  // De a mil y soltando entre tanda y tanda: leer los 15.000 de un tirón trababa el servidor más de un segundo.
  const tanda = db.prepare(`SELECT q.id, v.vec FROM quantomos q JOIN vec_items v ON v.tipo = 'quantomo' AND v.id = q.id WHERE q.id > ? AND q.etapa != 'descartado' ORDER BY q.id LIMIT 1000`)
  for (;;) {
    const nuevos = tanda.all(c.hasta) as { id: number; vec: Uint8Array }[]
    for (const r of nuevos) {
      const v = new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength))
      let max = 0
      for (const x of v) max = Math.max(max, Math.abs(x))
      const esc = max / 127 || 1
      const q = new Int8Array(v.length)
      for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] / esc)
      c.ids.push(r.id); c.q.push(q); c.esc.push(esc); c.hasta = r.id
    }
    if (nuevos.length < 1000) break
    await soltar()
  }
  return c
}

/**
 * Marca cada quántomo con vector contra los de antes (por sentido): ≥ 0,92 «repetida de #…», de 0,80 a 0,92
 * «variación de #…», si no «nueva». Sin modelo: usa los vectores que ya hizo el Procesar. Devuelve cuántos marcó.
 * Suelta el procesador después de cada uno: con decenas de miles de quántomos, compararlos todos de un tirón trababa el
 * servidor entero (Hoy, el chat y el Directo no contestaban).
 */
export async function marcarNovedad(db: Db, limite = 100): Promise<number> {
  const faltan = db.prepare(`SELECT q.id, v.vec FROM quantomos q JOIN vec_items v ON v.tipo = 'quantomo' AND v.id = q.id WHERE q.novedad IS NULL ORDER BY q.id LIMIT ?`).all(limite) as { id: number; vec: Uint8Array }[]
  if (!faltan.length) return 0
  const c = await vectoresDeQuantomos(db)
  const marcar = db.prepare('UPDATE quantomos SET novedad = ?, novedad_de = ?, novedad_sim = ? WHERE id = ?')
  for (const f of faltan) {
    const v = new Float32Array(f.vec.buffer.slice(f.vec.byteOffset, f.vec.byteOffset + f.vec.byteLength))
    let mejor = { id: null as number | null, sim: 0 }
    for (let k = 0; k < c.ids.length && c.ids[k] < f.id; k++) {
      const q = c.q[k]
      let s = 0
      for (let i = 0; i < Math.min(v.length, q.length); i++) s += v[i] * q[i]
      s *= c.esc[k]
      if (s > mejor.sim) mejor = { id: c.ids[k], sim: s }
    }
    const sim = Math.round(Math.min(1, mejor.sim) * 1000) / 1000
    const novedad = sim >= UMBRAL_REPETIDA ? 'repetida' : sim >= UMBRAL_VARIACION ? 'variacion' : 'nueva'
    marcar.run(novedad, novedad === 'nueva' ? null : mejor.id, mejor.id ? sim : null, f.id)
    await soltar()
  }
  return faltan.length
}

/**
 * Los quántomos más parecidos a uno, por sentido (con el mismo caché int8), del más cercano al más lejano. Sin modelo:
 * usa el vector que ya tiene. [] si todavía no tiene vector. Puede traer descartados viejos: filtrar por etapa al usarlos.
 */
export async function parecidosA(db: Db, id: number, limite = 30): Promise<{ id: number; sim: number }[]> {
  const r = db.prepare(`SELECT vec FROM vec_items WHERE tipo = 'quantomo' AND id = ?`).get(id) as { vec: Uint8Array } | undefined
  if (!r) return []
  const v = new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength))
  const c = await vectoresDeQuantomos(db)
  const out: { id: number; sim: number }[] = []
  for (let k = 0; k < c.ids.length; k++) {
    if (c.ids[k] === id) continue
    const q = c.q[k]
    let s = 0
    for (let i = 0; i < Math.min(v.length, q.length); i++) s += v[i] * q[i]
    out.push({ id: c.ids[k], sim: Math.round(Math.min(1, s * c.esc[k]) * 1000) / 1000 })
  }
  return out.sort((a, b) => b.sim - a.sim).slice(0, limite)
}

export function resumenQuantomos(db: Db) {
  return db.prepare('SELECT etapa, COUNT(*) AS n FROM quantomos GROUP BY etapa').all() as { etapa: Etapa; n: number }[]
}

function validarPeso(peso: number) {
  if (!Number.isInteger(peso) || peso < 1 || peso > 12) throw new Error('El peso va de 1 a 12')
}

/** El operador sella: el quántomo deja de ser propuesta de una máquina. */
export function sellar(db: Db, id: number, peso: number, ahora = Date.now()) {
  validarPeso(peso)
  const q = leerQuantomo(db, id)
  if (!q) throw new Error(`No existe el quántomo ${id}`)
  if (q.etapa === 'propuesta') return aceptarPropuesta(db, id, peso, ahora)
  if (q.etapa !== 'proto' && q.etapa !== 'sellado') throw new Error(`Un quántomo ${q.etapa} no se sella`)
  if (q.etapa === 'proto') anotar(db, 'quantomo', id, 'aceptada', { ahora })
  db.prepare(`UPDATE quantomos SET etapa = 'sellado', peso = ?, actualizado_en = ? WHERE id = ?`).run(peso, ahora, id)
}

export function descartar(db: Db, id: number, ahora = Date.now()) {
  if (leerQuantomo(db, id)?.etapa === 'proto') anotar(db, 'quantomo', id, 'rechazada', { ahora })
  db.prepare(`UPDATE quantomos SET etapa = 'descartado', actualizado_en = ? WHERE id = ?`).run(ahora, id)
}

/** Pide a la liga una versión mejor. La toma un generativo; su salida vuelve como propuesta. */
export function pedirMejora(db: Db, id: number, instruccion: string, ahora = Date.now()): Tarea {
  const q = leerQuantomo(db, id)
  if (!q) throw new Error(`No existe el quántomo ${id}`)
  if (q.etapa === 'superado' || q.etapa === 'descartado') throw new Error(`Un quántomo ${q.etapa} no se mejora`)
  return publicar(db, {
    clase: 'generativo',
    tipo: 'mejora-quantomo',
    payload: {
      quantomoId: q.id,
      texto: [
        'Reescribí este quántomo: una sola afirmación atómica, autosuficiente, sin relleno, en castellano.',
        'Devolvé en "texto" solo el quántomo nuevo.',
        instruccion.trim() ? `Indicación del operador: ${instruccion.trim()}` : '',
        `Quántomo actual: ${q.texto}`,
      ].filter(Boolean).join('\n'),
    },
    publicadaPor: 'operador',
  }, ahora)
}

/** Lo llama la liga cuando cierra una tarea de mejora. */
export function registrarPropuesta(db: Db, tarea: Tarea, texto: string, agenteId: string, ahora = Date.now()): number | null {
  const padre = leerQuantomo(db, Number(tarea.payload.quantomoId))
  if (!padre || !texto.trim()) return null
  return crearQuantomo(db, {
    texto: texto.trim().replace(/^["«]|["»]$/g, ''),
    titulo: padre.titulo,
    piezaId: padre.piezaId,
    etapa: 'propuesta',
    version: padre.version + 1,
    padreId: padre.id,
    universo: padre.universo,
    procedencia: `mejora de ${agenteId}`,
    tareaId: tarea.id,
  }, ahora)
}

export function aceptarPropuesta(db: Db, id: number, peso: number | null, ahora = Date.now()) {
  const q = leerQuantomo(db, id)
  if (!q || q.etapa !== 'propuesta') throw new Error(`El quántomo ${id} no es una propuesta`)
  const padre = q.padreId ? leerQuantomo(db, q.padreId) : null
  const p = peso ?? padre?.peso ?? null
  if (p != null) validarPeso(p)
  db.prepare(`UPDATE quantomos SET etapa = 'sellado', peso = ?, actualizado_en = ? WHERE id = ?`).run(p, ahora, id)
  if (padre) db.prepare(`UPDATE quantomos SET etapa = 'superado', actualizado_en = ? WHERE id = ?`).run(ahora, padre.id)
}

/** La cadena de versiones de un quántomo, de la más vieja a la vigente. */
export function linaje(db: Db, id: number): Quantomo[] {
  const cadena: Quantomo[] = []
  let q = leerQuantomo(db, id)
  while (q && cadena.length < 50) {
    cadena.unshift(q)
    q = q.padreId ? leerQuantomo(db, q.padreId) : null
  }
  return cadena
}

/** Partir un texto en candidatos a proto-quántomo: oraciones con sustancia, sin repetir. Para el extractor local. */
export function candidatos(texto: string, max = 3): string[] {
  const oraciones = texto
    .replace(/\[Speaker \d+\]/g, ' ')
    .split(/(?<=[.!?¿¡])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 40 && s.length <= 280 && /\s/.test(s))
  return [...new Set(oraciones)].sort((a, b) => b.length - a.length).slice(0, max)
}

/** Grupos de proto quántomos por (universo, piezaId), para sellar por lote. */
export function gruposProto(db: Db) {
  return db.prepare(`
    SELECT universo, pieza_id, COUNT(*) AS n, GROUP_CONCAT(id) AS ids
    FROM quantomos
    WHERE etapa = 'proto'
    GROUP BY universo, pieza_id
    ORDER BY n DESC
  `).all() as { universo: string | null; pieza_id: number | null; n: number; ids: string }[]
}

/** Pide a un generativo que fusione o recomiende descartar un lote de proto (máx 10). */
export function pedirLote(db: Db, ids: number[], ahora = Date.now()): Tarea {
  if (!ids.length) throw new Error('Lote vacío')
  if (ids.length > 10) throw new Error('Un lote es de máximo 10 quántomos')
  const quants = ids.map((i) => leerQuantomo(db, i)).filter((q): q is Quantomo => !!q && q.etapa === 'proto')
  if (!quants.length) throw new Error('Ningún quántomo del lote está en proto')
  const lista = quants.map((q, i) => `${i + 1}. [id=${q.id}] ${q.texto}`).join('\n')
  return publicar(db, {
    clase: 'generativo',
    tipo: 'lote-quantomo',
    payload: {
      ids: quants.map((q) => q.id),
      texto: [
        'Te doy un lote de proto-quántomos agrupados por tema y pieza. Proponé UNA de estas dos cosas:',
        '1) "fusion": una sola afirmación atómica que capture la esencia del lote.',
        '2) "descartar": si el lote no tiene sustancia, un motivo breve.',
        'Respondé SOLO un objeto JSON: {"fusion": string} o {"descartar": string}.',
        `Lote (${quants.length} quántomos):`,
        lista,
      ].join('\n'),
    },
    publicadaPor: 'operador',
  }, ahora)
}

/** Sella un lote de proto quántomos con un peso único. */
export function sellarLote(db: Db, ids: number[], peso: number, ahora = Date.now()) {
  validarPeso(peso)
  if (!ids.length) throw new Error('Lote vacío')
  const placeholders = ids.map(() => '?').join(',')
  for (const x of db.prepare(`SELECT id FROM quantomos WHERE id IN (${placeholders}) AND etapa = 'proto'`).all(...ids) as { id: number }[]) anotar(db, 'quantomo', x.id, 'aceptada', { ahora })
  const r = db.prepare(`UPDATE quantomos SET etapa = 'sellado', peso = ?, actualizado_en = ? WHERE id IN (${placeholders}) AND etapa = 'proto'`).run(peso, ahora, ...ids)
  return { sellados: r.changes }
}

/** Descarta un lote de proto quántomos con un motivo. */
export function descartarLote(db: Db, ids: number[], motivo: string, ahora = Date.now()) {
  if (!ids.length) throw new Error('Lote vacío')
  const placeholders = ids.map(() => '?').join(',')
  for (const x of db.prepare(`SELECT id FROM quantomos WHERE id IN (${placeholders}) AND etapa = 'proto'`).all(...ids) as { id: number }[]) anotar(db, 'quantomo', x.id, 'rechazada', { ahora })
  const r = db.prepare(`UPDATE quantomos SET etapa = 'descartado', procedencia = ?, actualizado_en = ? WHERE id IN (${placeholders}) AND etapa = 'proto'`).run(`descartado por lote: ${motivo}`, ahora, ...ids)
  return { descartados: r.changes }
}
