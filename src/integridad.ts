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

/**
 * Las claves foráneas que faltan y valen la pena (Fragua #291, segunda parte), con la decisión propuesta para cada una:
 * - cascada: lo de abajo no tiene vida propia (el vector de una pieza borrada no sirve para nada);
 * - vaciar: lo de abajo sigue existiendo sin eso (una misión sin su run);
 * - impedir: no se deja borrar lo de arriba mientras tenga esto (un movimiento con asientos contables).
 * Todavía NO se aplican: revisarCandidatas solo cuenta (filas y huérfanos ya presentes) para decidir con él.
 */
export type Candidata = { tabla: string; columna: string; padre: string; alBorrar: 'cascada' | 'vaciar' | 'impedir'; porQue: string }
export const CANDIDATAS: Candidata[] = [
  { tabla: 'vectores', columna: 'pieza_id', padre: 'corpus', alBorrar: 'cascada', porQue: 'el vector de una pieza borrada no sirve' },
  { tabla: 'pasajes', columna: 'pieza_id', padre: 'corpus', alBorrar: 'cascada', porQue: 'los pasajes son trozos de la pieza' },
  { tabla: 'corpus_entidades', columna: 'pieza_id', padre: 'corpus', alBorrar: 'cascada', porQue: 'es el vínculo pieza–entidad' },
  { tabla: 'corpus_entidades', columna: 'entidad_id', padre: 'entidades', alBorrar: 'cascada', porQue: 'es el vínculo pieza–entidad' },
  { tabla: 'criba', columna: 'pieza_id', padre: 'corpus', alBorrar: 'cascada', porQue: 'el voto es sobre esa pieza' },
  { tabla: 'tarjetas_piezas', columna: 'pieza_id', padre: 'corpus', alBorrar: 'cascada', porQue: 'el vínculo tarjeta–pieza' },
  { tabla: 'takeout_destilado', columna: 'pieza_id', padre: 'corpus', alBorrar: 'cascada', porQue: 'la cola de destilado de esa pieza' },
  { tabla: 'reproceso_fallos', columna: 'pieza_id', padre: 'corpus', alBorrar: 'cascada', porQue: 'el fallo de reprocesar esa pieza' },
  { tabla: 'relaciones', columna: 'entidad_id', padre: 'entidades', alBorrar: 'cascada', porQue: 'la ficha de relación de esa persona' },
  { tabla: 'persona_proyecto', columna: 'persona_id', padre: 'entidades', alBorrar: 'cascada', porQue: 'el vínculo persona–proyecto' },
  { tabla: 'persona_proyecto', columna: 'proyecto_id', padre: 'entidades', alBorrar: 'cascada', porQue: 'el vínculo persona–proyecto' },
  { tabla: 'propuestas_areas', columna: 'propuesta_id', padre: 'propuestas', alBorrar: 'cascada', porQue: 'el historial de categoría de esa propuesta' },
  { tabla: 'bucles_vistos', columna: 'bucle_id', padre: 'bucles', alBorrar: 'cascada', porQue: 'las menciones ya contadas de ese bucle' },
  { tabla: 'transcripciones', columna: 'audio_id', padre: 'audios', alBorrar: 'cascada', porQue: 'las versiones de ese audio' },
  { tabla: 'quantomos', columna: 'pieza_id', padre: 'corpus', alBorrar: 'vaciar', porQue: 'un quántomo cribado vale aunque se vaya su pieza' },
  { tabla: 'memoria', columna: 'pieza_id', padre: 'corpus', alBorrar: 'vaciar', porQue: 'el recuerdo sigue aunque se vaya la pieza' },
  { tabla: 'misiones', columna: 'run_id', padre: 'runs', alBorrar: 'vaciar', porQue: 'la misión sigue sin su run' },
  { tabla: 'misiones', columna: 'entidad_id', padre: 'entidades', alBorrar: 'vaciar', porQue: 'la misión sigue sin la entidad' },
  { tabla: 'movimientos', columna: 'entidad_id', padre: 'entidades', alBorrar: 'vaciar', porQue: 'la plata sigue anotada sin la entidad' },
  { tabla: 'movimientos', columna: 'mision_id', padre: 'misiones', alBorrar: 'vaciar', porQue: 'la plata sigue anotada sin la misión' },
  { tabla: 'oportunidades', columna: 'mision_id', padre: 'misiones', alBorrar: 'vaciar', porQue: 'la oportunidad sigue sin la primaria' },
  { tabla: 'fragua', columna: 'propuesta_id', padre: 'propuestas', alBorrar: 'vaciar', porQue: 'la forja queda como historia' },
  { tabla: 'eventos', columna: 'lugar_id', padre: 'entidades', alBorrar: 'vaciar', porQue: 'el evento sigue sin el lugar' },
  { tabla: 'tesoro_asientos', columna: 'movimiento_id', padre: 'movimientos', alBorrar: 'impedir', porQue: 'un asiento contable no puede quedar sin su movimiento' },
]

/** Cuánto hay y cuánto ya está roto en cada candidata (solo cuenta; de a una, soltando el hilo). */
export async function revisarCandidatas(db: Db): Promise<(Candidata & { filas: number | null; huerfanas: number | null; nota?: string })[]> {
  const existe = (t: string) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t)
  const out: (Candidata & { filas: number | null; huerfanas: number | null; nota?: string })[] = []
  for (const c of CANDIDATAS) {
    await new Promise((r) => setImmediate(r))
    if (!existe(c.tabla) || !existe(c.padre)) { out.push({ ...c, filas: null, huerfanas: null, nota: 'la tabla todavía no existe en esta base' }); continue }
    const pk = clavePrimaria(db, c.padre)
    const filas = (db.prepare(`SELECT COUNT(*) AS n FROM "${c.tabla}"`).get() as { n: number }).n
    const huerfanas = (db.prepare(`SELECT COUNT(*) AS n FROM "${c.tabla}" h WHERE h."${c.columna}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${c.padre}" p WHERE p."${pk}" = h."${c.columna}")`).get() as { n: number }).n
    out.push({ ...c, filas, huerfanas })
  }
  return out
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
