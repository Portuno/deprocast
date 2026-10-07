/**
 * Entidades: personas, proyectos, agrupaciones, dominios, lugares y conceptos que aparecen en el corpus.
 * Es la semilla del módulo Personas: por ahora nombran y agrupan piezas; la matriz de relaciones viene después.
 */
import { json, type Db } from './db.ts'

export const TIPOS_ENTIDAD = ['persona', 'proyecto', 'agrupacion', 'dominio', 'lugar', 'concepto'] as const
export type TipoEntidad = (typeof TIPOS_ENTIDAD)[number]

export type Entidad = {
  id: number
  origenId: string | null
  tipo: TipoEntidad
  nombre: string
  alias: string[]
  notas: string | null
  meta: Record<string, unknown> | null
  cargaId: number | null
  piezas: number
}

function deFila(r: any): Entidad {
  return {
    id: r.id, origenId: r.origen_id, tipo: r.tipo, nombre: r.nombre, alias: json(r.alias, []),
    notas: r.notas, meta: json(r.meta, null), cargaId: r.carga_id, piezas: r.piezas ?? 0,
  }
}

/** Alta idempotente por origen: si ya existe devuelve su id. */
export function asegurarEntidad(
  db: Db,
  e: { tipo: TipoEntidad; nombre: string; alias?: string[]; notas?: string | null; meta?: Record<string, unknown> | null; origenId?: string | null; cargaId?: number | null },
  ahora = Date.now(),
): number {
  if (e.origenId) {
    const ya = db.prepare('SELECT id FROM entidades WHERE origen_id = ?').get(e.origenId) as { id: number } | undefined
    if (ya) return ya.id
  } else {
    const ya = db.prepare('SELECT id FROM entidades WHERE tipo = ? AND nombre = ? COLLATE NOCASE').get(e.tipo, e.nombre) as { id: number } | undefined
    if (ya) return ya.id
  }
  const alias = [...new Set((e.alias ?? []).map((a) => a.trim()).filter((a) => a && a.toLowerCase() !== e.nombre.toLowerCase()))]
  const r = db.prepare(
    'INSERT INTO entidades (origen_id, tipo, nombre, alias, notas, meta, carga_id, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(e.origenId ?? null, e.tipo, e.nombre.trim(), alias.length ? JSON.stringify(alias) : null, e.notas ?? null, e.meta ? JSON.stringify(e.meta) : null, e.cargaId ?? null, ahora)
  return Number(r.lastInsertRowid)
}

export function listarEntidades(db: Db, f: { tipo?: string; q?: string; id?: number; limite?: number; desde?: number } = {}): Entidad[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (f.tipo) where.push('e.tipo = ?'), args.push(f.tipo)
  if (f.q) where.push('(e.nombre LIKE ? OR e.alias LIKE ?)'), args.push(`%${f.q}%`, `%${f.q}%`)
  if (f.id) where.push('e.id = ?'), args.push(f.id)
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return db.prepare(
    `WITH usos AS (SELECT j.value AS id, COUNT(*) AS n FROM corpus c, json_each(c.entidades) j WHERE c.entidades IS NOT NULL GROUP BY j.value)
     SELECT e.*, COALESCE(u.n, 0) AS piezas FROM entidades e LEFT JOIN usos u ON u.id = e.id ${w} ORDER BY piezas DESC, e.nombre LIMIT ? OFFSET ?`,
  ).all(...args, f.limite ?? 60, f.desde ?? 0).map(deFila)
}

export function contarEntidades(db: Db, f: { tipo?: string; q?: string } = {}): number {
  const where: string[] = []
  const args: string[] = []
  if (f.tipo) where.push('tipo = ?'), args.push(f.tipo)
  if (f.q) where.push('(nombre LIKE ? OR alias LIKE ?)'), args.push(`%${f.q}%`, `%${f.q}%`)
  return (db.prepare(`SELECT COUNT(*) AS n FROM entidades ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...args) as { n: number }).n
}

export function leerEntidad(db: Db, id: number): Entidad | null {
  return listarEntidades(db, { id, limite: 1 })[0] ?? null
}

/** Con quién aparece: entidades que comparten piezas con esta, por cantidad de piezas compartidas. */
export function coocurrencias(db: Db, id: number, limite = 12): (Entidad & { compartidas: number })[] {
  return (db.prepare(
    `SELECT e.*, COUNT(*) AS compartidas FROM corpus c, json_each(c.entidades) a, json_each(c.entidades) b JOIN entidades e ON e.id = b.value
     WHERE c.entidades IS NOT NULL AND a.value = ? AND b.value != ? GROUP BY e.id ORDER BY compartidas DESC, e.nombre LIMIT ?`,
  ).all(id, id, limite) as any[]).map((r) => ({ ...deFila(r), compartidas: r.compartidas }))
}

export function entidadesPorId(db: Db, ids: number[]): Entidad[] {
  if (!ids.length) return []
  return db.prepare(`SELECT * FROM entidades WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(deFila)
}

export function resumenEntidades(db: Db) {
  return db.prepare('SELECT tipo, COUNT(*) AS n FROM entidades GROUP BY tipo ORDER BY n DESC').all() as { tipo: TipoEntidad; n: number }[]
}
