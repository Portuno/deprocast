/**
 * Personas: su gente, no como fichas del corpus sino como relaciones. Qué vínculo es, cada cuánto quiere verla o
 * hablarle, cuándo fue el último contacto (anotado, o derivado de lo que cargó y de lo que habló en el chat), qué
 * tiene pendiente con ella y qué le debe. Lo que él no llenó, se deduce o queda vacío: nada se inventa.
 */
import { fechaLocal, type Db } from './db.ts'
import { entidadDelJugador } from './personajes.ts'
import { listarMisiones } from './misiones.ts'

export const VINCULOS = ['familia', 'pareja', 'amistad', 'trabajo', 'proyecto', 'mentor', 'contacto'] as const

export type Persona = {
  id: number
  nombre: string
  alias: string[]
  vinculo: string | null
  cercania: number | null
  cadaDias: number | null
  proxima: string | null
  notas: string | null
  ultimoContacto: string | null
  diasSinContacto: number | null
  vencida: boolean
  menciones: number
  misiones: { id: number; titulo: string; vence: string | null }[]
}

const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00`) - Date.parse(`${desde}T12:00:00`)) / 86_400_000)

/** Por entidad: cuántas piezas la nombran y la fecha de la última pieza propia donde aparece. Una sola pasada. */
function delCorpus(db: Db): Map<number, { menciones: number; propia: string | null }> {
  const filas = db.prepare(`SELECT CAST(e.value AS INTEGER) AS id, COUNT(*) AS n,
      MAX(CASE WHEN c.nivel = 'propia' THEN COALESCE(substr(c.fecha, 1, 10), date(c.creado_en / 1000, 'unixepoch', 'localtime')) END) AS f
    FROM corpus c, json_each(c.entidades) e WHERE c.entidades IS NOT NULL AND c.entidades != '[]' GROUP BY e.value`).all() as any[]
  return new Map(filas.map((r) => [r.id, { menciones: r.n, propia: r.f }]))
}

/** Lo que él escribió en el chat (últimos 180 días), para ver cuándo nombró a cada una. */
function delChat(db: Db, ahora: number): { fecha: string; texto: string }[] {
  return (db.prepare(`SELECT date(en / 1000, 'unixepoch', 'localtime') AS fecha, lower(texto) AS texto FROM mensajes WHERE rol = 'operador' AND en > ? ORDER BY en DESC`)
    .all(ahora - 180 * 86_400_000) as any[]).filter((m) => m.texto)
}

export function personas(db: Db, f: { q?: string; id?: number; limite?: number } = {}, ahora = Date.now()): Persona[] {
  const yo = entidadDelJugador(db)
  const hoy = fechaLocal(ahora)
  const filas = db.prepare(`SELECT e.id, e.nombre, e.alias, r.entidad_id AS definida, r.vinculo, r.cercania, r.cada_dias, r.proxima, r.notas, r.ultimo_contacto
    FROM entidades e LEFT JOIN relaciones r ON r.entidad_id = e.id
    WHERE e.tipo = 'persona' AND e.id != ? ${f.id ? 'AND e.id = ?' : ''} ${f.q ? 'AND (e.nombre LIKE ? OR e.alias LIKE ?)' : ''}`)
    .all(...[yo ?? -1, ...(f.id ? [f.id] : []), ...(f.q ? [`%${f.q}%`, `%${f.q}%`] : [])]) as any[]
  const corpus = delCorpus(db)
  const chat = delChat(db, ahora)
  const ps = filas.map((r) => {
    const c = corpus.get(r.id)
    // El chat cuenta por el primer nombre (4+ letras), que es como él la nombra.
    const pila = r.nombre.split(/\s+/)[0].toLowerCase()
    const enChat = pila.length >= 4 ? chat.find((m) => m.texto.includes(pila))?.fecha ?? null : null
    const ultimo = [r.ultimo_contacto, c?.propia ?? null, enChat].filter((x): x is string => !!x).sort().at(-1) ?? null
    const sin = ultimo ? dias(ultimo, hoy) : null
    return {
      id: r.id, nombre: r.nombre, alias: r.alias ? JSON.parse(r.alias) : [], vinculo: r.vinculo, cercania: r.cercania, cadaDias: r.cada_dias,
      proxima: r.proxima, notas: r.notas, ultimoContacto: ultimo, diasSinContacto: sin,
      vencida: !!r.cada_dias && (sin == null || sin > r.cada_dias), menciones: c?.menciones ?? 0, definida: !!r.definida,
      misiones: [] as Persona['misiones'],
    }
  })
  ps.sort((a, b) => Number(b.definida) - Number(a.definida) || (b.cercania ?? 0) - (a.cercania ?? 0) || b.menciones - a.menciones || a.nombre.localeCompare(b.nombre))
  return ps.slice(0, f.limite ?? 200).map(({ definida: _, ...p }) => ({
    ...p, misiones: listarMisiones(db, { personaje: `entidad:${p.id}`, abiertas: true }).map((m) => ({ id: m.id, titulo: m.titulo, vence: m.vence })),
  }))
}

export function leerPersona(db: Db, id: number): Persona | null {
  return personas(db, { id, limite: 1 })[0] ?? null
}

/** Él define la relación. Campos vacíos se borran; los que no vienen, quedan. */
export function guardarRelacion(db: Db, id: number, c: { vinculo?: string | null; cercania?: number | null; cadaDias?: number | null; proxima?: string | null; notas?: string | null; contacto?: string | boolean | null }, ahora = Date.now()): Persona {
  const e = db.prepare(`SELECT tipo FROM entidades WHERE id = ?`).get(id) as any
  if (!e) throw new Error(`No existe la entidad ${id}`)
  if (e.tipo !== 'persona') throw new Error('Solo las personas tienen relación')
  db.prepare('INSERT OR IGNORE INTO relaciones (entidad_id, actualizado_en) VALUES (?, ?)').run(id, ahora)
  const vacio = (v: unknown) => (v === '' || v == null ? null : v)
  const sets: [string, unknown][] = []
  if (c.vinculo !== undefined) sets.push(['vinculo', vacio(c.vinculo)])
  if (c.cercania !== undefined) sets.push(['cercania', c.cercania == null || c.cercania === ('' as any) ? null : Math.max(1, Math.min(5, Math.round(Number(c.cercania))))])
  if (c.cadaDias !== undefined) sets.push(['cada_dias', c.cadaDias == null || c.cadaDias === ('' as any) || !Number(c.cadaDias) ? null : Math.max(1, Math.round(Number(c.cadaDias)))])
  if (c.proxima !== undefined) sets.push(['proxima', vacio(typeof c.proxima === 'string' ? c.proxima.trim() : c.proxima)])
  if (c.notas !== undefined) sets.push(['notas', vacio(typeof c.notas === 'string' ? c.notas.trim() : c.notas)])
  if (c.contacto) sets.push(['ultimo_contacto', c.contacto === true ? fechaLocal(ahora) : String(c.contacto).slice(0, 10)])
  if (sets.length) db.prepare(`UPDATE relaciones SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, actualizado_en = ? WHERE entidad_id = ?`).run(...(sets.map(([, v]) => v) as any[]), ahora, id)
  return leerPersona(db, id)!
}

/** Las que pidió ver seguido y hace más de lo que quería que no ve. */
export function aContactar(db: Db, ahora = Date.now()): Persona[] {
  return personas(db, {}, ahora).filter((p) => p.vencida).sort((a, b) => (b.diasSinContacto ?? 999) - (a.diasSinContacto ?? 999))
}

/** Para Mastropiero: a quién le debe un contacto y qué tiene pendiente con su gente (corto; vacío si no hay nada). */
export function personasParaPrompt(db: Db, ahora = Date.now()): string {
  const ps = personas(db, {}, ahora).filter((p) => p.vinculo || p.proxima || p.vencida)
  if (!ps.length) return ''
  const lineas = ps.slice(0, 8).map((p) => `- ${p.nombre}${p.vinculo ? ` (${p.vinculo})` : ''}${p.diasSinContacto != null ? `: último contacto hace ${p.diasSinContacto} días` : ''}${p.vencida ? ' — quería verla más seguido' : ''}${p.proxima ? `; próximo: ${p.proxima}` : ''}`)
  return `Su gente (lo que él definió):\n${lineas.join('\n')}`
}
