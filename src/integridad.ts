/**
 * Los errores de integridad que se entienden (Fragua #291). SQLite solo dice «FOREIGN KEY constraint failed», sin
 * tabla, fila ni acción. Acá:
 * - traducirIntegridad: con la sentencia y sus valores, dice qué tabla, qué columna y qué valor apunta a algo que no
 *   existe (al guardar), o qué filas dependen de lo que se quiso borrar (al borrar). abrir() la engancha a cada sentencia;
 * - huerfanos: lo que ya está roto en la base (PRAGMA foreign_key_check, tabla por tabla), sin borrar nada. Se revisa al
 *   arrancar y se ve en /api/integridad.
 */
import type { DatabaseSync } from 'node:sqlite'

type Db = DatabaseSync
type Fk = { table: string; from: string; to: string | null }

export type DetalleIntegridad = { tabla: string; operacion: string; columna?: string; valor?: unknown; padre?: string; hijos?: string[] }
export class ErrorIntegridad extends Error {
  readonly detalle: DetalleIntegridad
  readonly original: unknown
  constructor(mensaje: string, detalle: DetalleIntegridad, original: unknown) { super(mensaje); this.detalle = detalle; this.original = original }
}

const fks = (db: Db, tabla: string) => db.prepare(`SELECT "table", "from", "to" FROM pragma_foreign_key_list(?)`).all(tabla) as Fk[]
const clavePrimaria = (db: Db, tabla: string) => (db.prepare(`SELECT name FROM pragma_table_info(?) WHERE pk = 1`).get(tabla) as { name: string } | undefined)?.name ?? 'rowid'
const separar = (s: string) => s.split(',').map((x) => x.trim().replace(/^["`[]|["`\]]$/g, ''))

/** Las columnas de la sentencia con su valor (solo los «?» posicionales). */
function valoresDe(sql: string, params: unknown[]): Map<string, unknown> {
  const out = new Map<string, unknown>()
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && !(params[0] instanceof Uint8Array)) return out
  const ins = /\(([^()]*)\)\s*VALUES\s*\(([^()]*)\)/i.exec(sql)
  if (ins) {
    let i = 0
    const cols = separar(ins[1]), vals = separar(ins[2])
    cols.forEach((c, k) => { if (vals[k] === '?') out.set(c, params[i++]) })
    return out
  }
  const set = /\bSET\s+([\s\S]*?)(?:\bWHERE\b|$)/i.exec(sql)
  if (set) {
    let i = 0
    for (const parte of set[1].split(',')) {
      const m = /^\s*["`]?(\w+)["`]?\s*=\s*(\?)?/.exec(parte)
      const usados = (parte.match(/\?/g) ?? []).length
      if (m?.[2]) out.set(m[1], params[i])
      i += usados
    }
  }
  return out
}

/** Si e es un error de clave foránea, uno que dice qué pasó; si no, e tal cual. */
export function traducirIntegridad(db: Db, e: unknown, sql: string, params: unknown[]): unknown {
  const msg = e instanceof Error ? e.message : String(e)
  if (!/FOREIGN KEY constraint failed/i.test(msg)) return e
  const m = /^\s*(INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`]?(\w+)/i.exec(sql)
  if (!m) return new ErrorIntegridad('Una regla de integridad de la base frenó el cambio (una clave foránea), pero no pude ver en qué tabla.', { tabla: '?', operacion: '?' }, e)
  const op = m[1].toUpperCase().startsWith('DELETE') ? 'borrar' : m[1].toUpperCase().startsWith('UPDATE') ? 'cambiar' : 'guardar'
  const tabla = m[2]
  try {
    // Al guardar o cambiar: ¿a qué padre apunta un valor que no existe?
    if (op !== 'borrar') {
      const valores = valoresDe(sql, params)
      for (const fk of fks(db, tabla)) {
        if (!valores.has(fk.from)) continue
        const v = valores.get(fk.from)
        if (v == null) continue
        const to = fk.to ?? clavePrimaria(db, fk.table)
        if (!db.prepare(`SELECT 1 FROM "${fk.table}" WHERE "${to}" = ?`).get(v as any)) {
          return new ErrorIntegridad(`No se pudo ${op} en «${tabla}»: ${fk.from} = ${JSON.stringify(v)} apunta a «${fk.table}» y esa fila no existe (¿se borró, o el id está mal?).`, { tabla, operacion: op, columna: fk.from, valor: v, padre: fk.table }, e)
        }
      }
    }
    // Al borrar (o reemplazar, o cambiar una clave): ¿quién depende de esta tabla?
    const hijos: string[] = []
    for (const t of db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]) {
      for (const fk of fks(db, t.name)) if (fk.table === tabla) hijos.push(`${t.name}.${fk.from}`)
    }
    if (hijos.length) return new ErrorIntegridad(`No se pudo ${op} en «${tabla}»: hay filas que dependen de lo que se quiso ${op === 'borrar' ? 'borrar' : 'cambiar'} (${hijos.slice(0, 6).join(', ')}). Hay que borrar o mover esas primero.`, { tabla, operacion: op, hijos }, e)
  } catch { /* si el análisis falla, al menos la tabla */ }
  return new ErrorIntegridad(`No se pudo ${op} en «${tabla}»: una clave foránea no se cumple.`, { tabla, operacion: op }, e)
}

/** Engancha la traducción a cada sentencia de esta base (run, get, all). */
export function engancharIntegridad(db: Db) {
  const preparar = db.prepare.bind(db)
  ;(db as any).prepare = (sql: string) => {
    const st = preparar(sql) as any
    for (const k of ['run', 'get', 'all'] as const) {
      const f = st[k].bind(st)
      st[k] = (...p: unknown[]) => { try { return f(...p) } catch (e) { throw traducirIntegridad(db, e, sql, p) } }
    }
    return st
  }
}

/** Lo que ya está roto: por tabla, cuántas filas apuntan a algo que no existe (sin borrar nada). Tabla por tabla. */
export async function huerfanos(db: Db, o: { limitePorTabla?: number } = {}): Promise<{ tabla: string; padre: string; filas: number }[]> {
  const out = new Map<string, { tabla: string; padre: string; filas: number }>()
  const tablas = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[]).filter((t) => fks(db, t.name).length)
  for (const t of tablas) {
    // De a una tabla, soltando el hilo entre medio (en una base grande, no traba el servidor de golpe).
    await new Promise((r) => setImmediate(r))
    const filas = db.prepare(`SELECT "table" AS tabla, parent AS padre FROM pragma_foreign_key_check(?) LIMIT ?`).all(t.name, o.limitePorTabla ?? 10_000) as { tabla: string; padre: string }[]
    for (const f of filas) {
      const k = `${f.tabla}→${f.padre}`
      const x = out.get(k) ?? { tabla: f.tabla, padre: f.padre, filas: 0 }
      x.filas++
      out.set(k, x)
    }
  }
  return [...out.values()].sort((a, b) => b.filas - a.filas)
}
