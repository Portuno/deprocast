/**
 * Quántomos: la unidad mínima de información. Una afirmación atómica destilada de una pieza.
 *
 * Ciclo: proto (lo propone un extractor o una carga) → sellado (el operador lo pesa 1–12).
 * Mejora: un generativo propone una versión nueva (propuesta, con padre). Si el operador la acepta,
 * la propuesta queda sellada y la anterior pasa a superado. Nada se pisa: las versiones quedan.
 */
import { json, type Db } from './db.ts'
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

export function listarQuantomos(db: Db, f: { etapa?: string; q?: string; pesoMin?: number; desde?: number; limite?: number } = {}) {
  const where: string[] = []
  const args: (string | number)[] = []
  if (f.etapa) where.push('etapa = ?'), args.push(f.etapa)
  else where.push(`etapa NOT IN ('superado', 'descartado')`)
  if (f.q) where.push('(texto LIKE ? OR titulo LIKE ?)'), args.push(`%${f.q}%`, `%${f.q}%`)
  if (f.pesoMin) where.push('peso >= ?'), args.push(f.pesoMin)
  const w = `WHERE ${where.join(' AND ')}`
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM quantomos ${w}`).get(...args) as { n: number }).n
  const filas = db.prepare(`SELECT * FROM quantomos ${w} ORDER BY etapa = 'propuesta' DESC, etapa = 'proto' DESC, actualizado_en DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, f.limite ?? 50, f.desde ?? 0)
  return { total, quantomos: filas.map(deFila) }
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
  db.prepare(`UPDATE quantomos SET etapa = 'sellado', peso = ?, actualizado_en = ? WHERE id = ?`).run(peso, ahora, id)
}

export function descartar(db: Db, id: number, ahora = Date.now()) {
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
