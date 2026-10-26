/**
 * Personas: su gente, no como fichas del corpus sino como relaciones. Hay tres clases (físicas, jurídicas —las
 * agrupaciones: una empresa, un colectivo— y ficticias), y de cada una él define dos números del 1 al 12: el nivel de
 * contacto (cuánto la conoce, qué tienen juntos: su pareja es 12) y la importancia en su vida (alguien que todavía no
 * conoce puede ser muy importante). También las que no conoce: contactadas o por conocer. Cada una puede estar en sus
 * proyectos con un rol y una importancia para ese proyecto. Cada cuánto quiere saber de ella, el último contacto
 * (anotado o deducido del corpus y del chat), lo pendiente y las misiones. Lo que él no llenó queda vacío: nada se inventa.
 */
import { fechaLocal, type Db } from './db.ts'
import { asegurarEntidad, coocurrencias } from './entidades.ts'
import { entidadDelJugador } from './personajes.ts'

export const VINCULOS = ['familia', 'pareja', 'amistad', 'trabajo', 'proyecto', 'mentor', 'contacto'] as const
export const CLASES_PERSONA = ['fisica', 'juridica', 'ficticia'] as const
export const ESTADOS_PERSONA = ['conocida', 'contactada', 'por_conocer'] as const
export type ClasePersona = (typeof CLASES_PERSONA)[number]
export type EstadoPersona = (typeof ESTADOS_PERSONA)[number]

export type EnProyecto = { id: number; nombre: string; rol: string | null; importancia: number | null }

export type Persona = {
  id: number
  nombre: string
  alias: string[]
  tipo: 'persona' | 'agrupacion'
  clase: ClasePersona
  estado: EstadoPersona
  /** Nivel de contacto, 1–12: cuánto la conoce y qué tienen juntos. */
  nivel: number | null
  /** Cuando él no lo fijó: lo que sugieren las menciones y el chat (solo una pista). */
  nivelSugerido: number | null
  /** Importancia en su vida, 1–12. */
  importancia: number | null
  vinculo: string | null
  /** La cercanía vieja (1–5); el nivel la reemplaza. */
  cercania: number | null
  cadaDias: number | null
  proxima: string | null
  notas: string | null
  ultimoContacto: string | null
  diasSinContacto: number | null
  vencida: boolean
  menciones: number
  definida: boolean
  proyectos: EnProyecto[]
  misiones: { id: number; titulo: string; vence: string | null }[]
}

const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00`) - Date.parse(`${desde}T12:00:00`)) / 86_400_000)
const a12 = (v: unknown) => (v == null || v === '' ? null : Math.max(1, Math.min(12, Math.round(Number(v)))) || null)
/** De la cercanía vieja (1–5) al nivel (1–12). */
export const NIVEL_DE_CERCANIA: Record<number, number> = { 1: 2, 2: 5, 3: 7, 4: 10, 5: 12 }

/**
 * Por entidad: cuántas piezas la nombran y la fecha de la última pieza propia donde aparece. Una sola pasada, que a la
 * escala de la nube cuesta ~150 ms; la piden Personas, la tarjeta «Vos», las preguntas y los puentes, así que se
 * rearma solo si cambió lo que la alimenta (corpus_entidades) o el día.
 */
const corpusPorEntidad = new WeakMap<Db, { clave: string; m: Map<number, { menciones: number; propia: string | null }> }>()
/** La huella de corpus_entidades (no tiene rowid): la última pieza, cuántas filas y la suma de entidades (cambia con una fusión); y el día. */
function huellaCorpusEntidades(db: Db): string {
  const f = db.prepare('SELECT MAX(pieza_id) AS m, COUNT(*) AS n, SUM(entidad_id) AS s FROM corpus_entidades').get() as { m: number | null; n: number; s: number | null }
  return `${f.m ?? 0}|${f.n}|${f.s ?? 0}|${fechaLocal()}`
}
function delCorpus(db: Db): Map<number, { menciones: number; propia: string | null }> {
  const clave = huellaCorpusEntidades(db)
  const ya = corpusPorEntidad.get(db)
  if (ya?.clave === clave) return ya.m
  const m = delCorpusSinCache(db)
  corpusPorEntidad.set(db, { clave, m })
  return m
}
function delCorpusSinCache(db: Db): Map<number, { menciones: number; propia: string | null }> {
  const filas = db.prepare(`SELECT ce.entidad_id AS id, COUNT(*) AS n,
      MAX(CASE WHEN c.nivel = 'propia' THEN COALESCE(substr(c.fecha, 1, 10), date(c.creado_en / 1000, 'unixepoch', 'localtime')) END) AS f
    FROM corpus_entidades ce JOIN corpus c ON c.id = ce.pieza_id GROUP BY ce.entidad_id`).all() as any[]
  return new Map(filas.map((r) => [r.id, { menciones: r.n, propia: r.f }]))
}

const palabras = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u)

/**
 * Lo que él escribió en el chat (últimos 180 días), como índice de palabras: cuántos mensajes la nombran y el último día.
 * Antes se buscaba el nombre de cada persona en cada mensaje (miles × miles): con el archivo grande tardaba más de un minuto.
 */
const indiceChat = new WeakMap<Db, { clave: string; m: Map<string, { veces: number; ultima: string }> }>()
function delChat(db: Db, ahora: number): Map<string, { veces: number; ultima: string }> {
  // Se rearma solo si llegó un mensaje suyo nuevo (o cambió el día): Personas se pide seguido.
  const ultimo = (db.prepare(`SELECT MAX(id) AS id FROM mensajes WHERE rol = 'operador'`).get() as { id: number | null }).id ?? 0
  const clave = `${ultimo}|${fechaLocal(ahora)}`
  const ya = indiceChat.get(db)
  if (ya?.clave === clave) return ya.m
  const m = delChatSinCache(db, ahora)
  indiceChat.set(db, { clave, m })
  return m
}

function delChatSinCache(db: Db, ahora: number): Map<string, { veces: number; ultima: string }> {
  const filas = db.prepare(`SELECT date(en / 1000, 'unixepoch', 'localtime') AS fecha, texto FROM mensajes WHERE rol = 'operador' AND en > ? ORDER BY en DESC`)
    .all(ahora - 180 * 86_400_000) as { fecha: string; texto: string | null }[]
  const m = new Map<string, { veces: number; ultima: string }>()
  for (const f of filas) {
    if (!f.texto) continue
    for (const w of new Set(palabras(f.texto))) {
      if (w.length < 4) continue
      const x = m.get(w)
      if (x) x.veces++
      else m.set(w, { veces: 1, ultima: f.fecha }) // vienen del más nuevo al más viejo: la primera vez es la última fecha
    }
  }
  return m
}

/** En qué proyectos está cada persona (con rol e importancia), de una. */
function proyectosPorPersona(db: Db): Map<number, EnProyecto[]> {
  const filas = db.prepare(`SELECT pp.persona_id, pp.proyecto_id, e.nombre, pp.rol, pp.importancia FROM persona_proyecto pp JOIN entidades e ON e.id = pp.proyecto_id ORDER BY COALESCE(pp.importancia, 0) DESC, e.nombre`).all() as any[]
  const m = new Map<number, EnProyecto[]>()
  for (const r of filas) m.set(r.persona_id, [...(m.get(r.persona_id) ?? []), { id: r.proyecto_id, nombre: r.nombre, rol: r.rol, importancia: r.importancia }])
  return m
}

export type FiltroPersonas = { q?: string; id?: number; limite?: number; clase?: string; estado?: string; orden?: 'nivel' | 'importancia' | 'contacto' | 'proyecto' | string; proyecto?: number }

export function personas(db: Db, f: FiltroPersonas = {}, ahora = Date.now()): Persona[] {
  const yo = entidadDelJugador(db)
  const hoy = fechaLocal(ahora)
  const filas = db.prepare(`SELECT e.id, e.nombre, e.alias, e.tipo, r.entidad_id AS definida, r.vinculo, r.cercania, r.nivel, r.importancia, r.clase, r.estado, r.cada_dias, r.proxima, r.notas, r.ultimo_contacto
    FROM entidades e LEFT JOIN relaciones r ON r.entidad_id = e.id
    WHERE e.tipo IN ('persona', 'agrupacion') AND e.id != ? ${f.id ? 'AND e.id = ?' : ''} ${f.q ? 'AND (e.nombre LIKE ? OR e.alias LIKE ?)' : ''}`)
    .all(...[yo ?? -1, ...(f.id ? [f.id] : []), ...(f.q ? [`%${f.q}%`, `%${f.q}%`] : [])]) as any[]
  const corpus = delCorpus(db)
  const chat = delChat(db, ahora)
  const enProyectos = proyectosPorPersona(db)
  let ps: Persona[] = filas.map((r) => {
    const c = corpus.get(r.id)
    // El chat cuenta por el primer nombre (4+ letras), que es como él la nombra.
    const pila = r.nombre.split(/\s+/)[0].toLowerCase()
    const enChat = pila.length >= 4 ? chat.get(palabras(pila).find(Boolean) ?? pila) : undefined
    const vecesChat = enChat?.veces ?? 0
    const ultimo = [r.ultimo_contacto, c?.propia ?? null, enChat?.ultima ?? null].filter((x): x is string => !!x).sort().at(-1) ?? null
    const sin = ultimo ? dias(ultimo, hoy) : null
    const menciones = c?.menciones ?? 0
    const nivel = r.nivel ?? null
    return {
      id: r.id, nombre: r.nombre, alias: r.alias ? JSON.parse(r.alias) : [], tipo: r.tipo,
      clase: (r.clase ?? (r.tipo === 'agrupacion' ? 'juridica' : 'fisica')) as ClasePersona,
      estado: (r.estado ?? 'conocida') as EstadoPersona,
      nivel, importancia: r.importancia ?? null,
      // Una pista, no un dato: cuánto aparece en lo que cargó y en lo que habló.
      nivelSugerido: nivel ? null : Math.max(1, Math.min(12, 1 + Math.round(Math.log2(1 + menciones) * 2) + (vecesChat >= 3 ? 2 : vecesChat ? 1 : 0))),
      vinculo: r.vinculo, cercania: r.cercania, cadaDias: r.cada_dias, proxima: r.proxima, notas: r.notas, ultimoContacto: ultimo, diasSinContacto: sin,
      vencida: !!r.cada_dias && (sin == null || sin > r.cada_dias), menciones, definida: !!r.definida,
      proyectos: enProyectos.get(r.id) ?? [], misiones: [],
    }
  })
  if (f.clase) ps = ps.filter((p) => p.clase === f.clase)
  if (f.estado) ps = ps.filter((p) => p.estado === f.estado)
  if (f.proyecto) ps = ps.filter((p) => p.proyectos.some((x) => x.id === f.proyecto))
  const porDefecto = (a: Persona, b: Persona) => Number(b.definida) - Number(a.definida) || (b.nivel ?? 0) - (a.nivel ?? 0) || (b.importancia ?? 0) - (a.importancia ?? 0) || b.menciones - a.menciones || a.nombre.localeCompare(b.nombre)
  const orden: Record<string, (a: Persona, b: Persona) => number> = {
    nivel: (a, b) => (b.nivel ?? 0) - (a.nivel ?? 0) || porDefecto(a, b),
    importancia: (a, b) => (b.importancia ?? 0) - (a.importancia ?? 0) || porDefecto(a, b),
    contacto: (a, b) => (a.diasSinContacto ?? 1e6) - (b.diasSinContacto ?? 1e6) || porDefecto(a, b),
    proyecto: (a, b) => b.proyectos.length - a.proyectos.length || porDefecto(a, b),
  }
  ps.sort(orden[f.orden ?? ''] ?? porDefecto)
  // Sus misiones abiertas (las que le asignó y las que son sobre ella), en una sola consulta para todas (antes, dos por persona).
  const elegidas = ps.slice(0, f.limite ?? 300)
  const porPersona = new Map<number, Map<number, { id: number; titulo: string; vence: string | null }>>()
  if (elegidas.length) {
    const ids = elegidas.map((p) => p.id)
    const filasM = db.prepare(`SELECT id, titulo, vence, personaje, entidad_id FROM misiones WHERE estado IN ('sugerida', 'activa')
      AND (personaje IN (${ids.map(() => '?').join(',')}) OR entidad_id IN (${ids.map(() => '?').join(',')})) ORDER BY id`).all(...ids.map((i) => `entidad:${i}`), ...ids) as any[]
    for (const m of filasM) {
      for (const pid of new Set([m.personaje?.startsWith('entidad:') ? Number(m.personaje.slice(8)) : null, m.entidad_id].filter((x) => x != null))) {
        const xs = porPersona.get(pid) ?? new Map()
        xs.set(m.id, { id: m.id, titulo: m.titulo, vence: m.vence })
        porPersona.set(pid, xs)
      }
    }
  }
  return elegidas.map((p) => ({ ...p, misiones: [...(porPersona.get(p.id)?.values() ?? [])] }))
}

export function leerPersona(db: Db, id: number): Persona | null {
  return personas(db, { id, limite: 1 })[0] ?? null
}

export type CambiosRelacion = {
  vinculo?: string | null; nivel?: number | null; importancia?: number | null; clase?: string | null; estado?: string | null
  /** La escala vieja (1–5): si no viene el nivel, lo define. */
  cercania?: number | null
  cadaDias?: number | null; proxima?: string | null; notas?: string | null; contacto?: string | boolean | null
}

/** Él define la relación. Campos vacíos se borran; los que no vienen, quedan. */
export function guardarRelacion(db: Db, id: number, c: CambiosRelacion, ahora = Date.now()): Persona {
  const e = db.prepare(`SELECT tipo FROM entidades WHERE id = ?`).get(id) as any
  if (!e) throw new Error(`No existe la entidad ${id}`)
  if (e.tipo !== 'persona' && e.tipo !== 'agrupacion') throw new Error('Solo las personas (físicas, jurídicas o ficticias) tienen relación')
  db.prepare('INSERT OR IGNORE INTO relaciones (entidad_id, actualizado_en) VALUES (?, ?)').run(id, ahora)
  const vacio = (v: unknown) => (v === '' || v == null ? null : v)
  const sets: [string, unknown][] = []
  if (c.vinculo !== undefined) sets.push(['vinculo', vacio(c.vinculo)])
  if (c.cercania !== undefined) {
    const cer = c.cercania == null || c.cercania === ('' as any) ? null : Math.max(1, Math.min(5, Math.round(Number(c.cercania))))
    sets.push(['cercania', cer])
    if (c.nivel === undefined && cer) sets.push(['nivel', NIVEL_DE_CERCANIA[cer]])
  }
  if (c.nivel !== undefined) sets.push(['nivel', a12(c.nivel)])
  if (c.importancia !== undefined) sets.push(['importancia', a12(c.importancia)])
  if (c.clase !== undefined) {
    if (c.clase && !CLASES_PERSONA.includes(c.clase as ClasePersona)) throw new Error(`Clase desconocida: ${c.clase} (física, jurídica o ficticia)`)
    sets.push(['clase', vacio(c.clase)])
  }
  if (c.estado !== undefined) {
    if (c.estado && !ESTADOS_PERSONA.includes(c.estado as EstadoPersona)) throw new Error(`Estado desconocido: ${c.estado} (conocida, contactada o por_conocer)`)
    sets.push(['estado', vacio(c.estado)])
  }
  if (c.cadaDias !== undefined) sets.push(['cada_dias', c.cadaDias == null || c.cadaDias === ('' as any) || !Number(c.cadaDias) ? null : Math.max(1, Math.round(Number(c.cadaDias)))])
  if (c.proxima !== undefined) sets.push(['proxima', vacio(typeof c.proxima === 'string' ? c.proxima.trim() : c.proxima)])
  if (c.notas !== undefined) sets.push(['notas', vacio(typeof c.notas === 'string' ? c.notas.trim() : c.notas)])
  if (c.contacto) sets.push(['ultimo_contacto', c.contacto === true ? fechaLocal(ahora) : String(c.contacto).slice(0, 10)])
  if (sets.length) db.prepare(`UPDATE relaciones SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, actualizado_en = ? WHERE entidad_id = ?`).run(...(sets.map(([, v]) => v) as any[]), ahora, id)
  return leerPersona(db, id)!
}

/** Alguien nuevo: una persona que todavía no conoce, que contactó, o una empresa (jurídica). */
export function nuevaPersona(db: Db, p: { nombre: string; clase?: string; estado?: string; importancia?: number | null; nivel?: number | null; vinculo?: string | null; notas?: string | null }, ahora = Date.now()): Persona {
  const nombre = p.nombre?.trim()
  if (!nombre) throw new Error('Falta el nombre')
  const clase = (p.clase && CLASES_PERSONA.includes(p.clase as ClasePersona) ? p.clase : 'fisica') as ClasePersona
  const id = asegurarEntidad(db, { tipo: clase === 'juridica' ? 'agrupacion' : 'persona', nombre }, ahora)
  return guardarRelacion(db, id, { clase, estado: p.estado ?? 'por_conocer', importancia: p.importancia ?? null, nivel: p.nivel ?? undefined, vinculo: p.vinculo ?? undefined, notas: p.notas ?? undefined }, ahora)
}

// ─── personas en proyectos ──────────────────────────────────────────────

/** La pone en un proyecto (o una agrupación) con su rol y cuánto importa ahí. Repetir actualiza. */
export function vincularAProyecto(db: Db, personaId: number, proyectoId: number, o: { rol?: string | null; importancia?: number | null; notas?: string | null } = {}, ahora = Date.now()): EnProyecto[] {
  const p = db.prepare('SELECT tipo FROM entidades WHERE id = ?').get(personaId) as any
  const x = db.prepare('SELECT tipo FROM entidades WHERE id = ?').get(proyectoId) as any
  if (!p || (p.tipo !== 'persona' && p.tipo !== 'agrupacion')) throw new Error('Eso no es una persona')
  if (!x || (x.tipo !== 'proyecto' && x.tipo !== 'agrupacion')) throw new Error('Eso no es un proyecto')
  if (personaId === proyectoId) throw new Error('No puede estar en sí misma')
  db.prepare(`INSERT INTO persona_proyecto (persona_id, proyecto_id, rol, importancia, notas, desde) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (persona_id, proyecto_id) DO UPDATE SET rol = COALESCE(excluded.rol, rol), importancia = COALESCE(excluded.importancia, importancia), notas = COALESCE(excluded.notas, notas)`)
    .run(personaId, proyectoId, o.rol?.trim() || null, a12(o.importancia), o.notas?.trim() || null, ahora)
  return proyectosDe(db, personaId)
}

export function desvincularDeProyecto(db: Db, personaId: number, proyectoId: number): EnProyecto[] {
  db.prepare('DELETE FROM persona_proyecto WHERE persona_id = ? AND proyecto_id = ?').run(personaId, proyectoId)
  return proyectosDe(db, personaId)
}

export const proyectosDe = (db: Db, personaId: number): EnProyecto[] => proyectosPorPersona(db).get(personaId) ?? []

/** Quiénes están en un proyecto, por importancia para ese proyecto. */
export function personasDeProyecto(db: Db, proyectoId: number): (EnProyecto & { persona: string })[] {
  return (db.prepare(`SELECT pp.persona_id AS id, e.nombre AS persona, pp.rol, pp.importancia FROM persona_proyecto pp JOIN entidades e ON e.id = pp.persona_id WHERE pp.proyecto_id = ? ORDER BY COALESCE(pp.importancia, 0) DESC, e.nombre`).all(proyectoId) as any[])
    .map((r) => ({ id: r.id, persona: r.persona, nombre: r.persona, rol: r.rol, importancia: r.importancia }))
}

/** Las que pidió ver seguido y hace más de lo que quería que no ve. */
export function aContactar(db: Db, ahora = Date.now()): Persona[] {
  return personas(db, {}, ahora).filter((p) => p.vencida).sort((a, b) => (b.diasSinContacto ?? 999) - (a.diasSinContacto ?? 999))
}

export type ConPersona = { id: number; nombre: string; compartidas: number }
export type PersonaConMatriz = Persona & { con: ConPersona[]; accion: string | null }

/** Quién entra en la matriz: lo que él definió o lo que aparece en el corpus. */
const enMatriz = (p: Persona) => !!(p.vinculo || p.notas || p.menciones > 0 || p.definida)

/**
 * Con quién aparece cada persona en el corpus. Una consulta por persona, en cada pedido de Personas, era lo que más
 * pesaba: se guarda con la misma huella de corpus_entidades (si nada cambió, no se vuelve a preguntar).
 */
const conPorPersona = new WeakMap<Db, { clave: string; m: Map<number, ConPersona[]> }>()
function conQuien(db: Db, id: number, clave: string): ConPersona[] {
  let c = conPorPersona.get(db)
  if (c?.clave !== clave) { c = { clave, m: new Map() }; conPorPersona.set(db, c) }
  let xs = c.m.get(id)
  if (!xs) {
    xs = coocurrencias(db, id, 8).filter((e) => e.tipo === 'persona').map((e) => ({ id: e.id, nombre: e.nombre, compartidas: e.compartidas }))
    c.m.set(id, xs)
  }
  return xs
}

/** Con quién aparece en el corpus, y la acción que ya está en los datos: escribirle si venció el ritmo, o lo próximo. */
export function matrizPersonas(db: Db, ahora = Date.now()): PersonaConMatriz[] {
  return conMatriz(db, personas(db, {}, ahora).filter(enMatriz))
}

/** La lista que ya se pidió, con la matriz pegada. Quien no entra en la matriz queda con acción vacía. */
export function conMatriz(db: Db, ps: Persona[]): PersonaConMatriz[] {
  const clave = huellaCorpusEntidades(db)
  return ps.map((p) => (enMatriz(p) ? { ...p, con: conQuien(db, p.id, clave), accion: p.vencida ? 'escribirle' : p.proxima } : { ...p, con: [], accion: null }))
}

const CLASE_NOMBRE: Record<string, string> = { juridica: 'persona jurídica', ficticia: 'personaje ficticio' }
const ESTADO_NOMBRE: Record<string, string> = { contactada: 'contactada, no la conoce', por_conocer: 'por conocer' }

/** Una persona en una línea, como la definió él. */
export function personaEnUnaLinea(p: Persona): string {
  const datos = [p.vinculo, CLASE_NOMBRE[p.clase], ESTADO_NOMBRE[p.estado], p.nivel ? `nivel ${p.nivel}` : null, p.importancia ? `importancia ${p.importancia}` : null].filter(Boolean)
  const proys = p.proyectos.length ? ` — en ${p.proyectos.map((x) => `${x.nombre}${x.rol ? ` (${x.rol})` : ''}`).join(', ')}` : ''
  return `${p.nombre}${datos.length ? ` (${datos.join(', ')})` : ''}${proys}`
}

/** Para Mastropiero: quién es quién en su vida (lo que él definió) y a quién le debe un contacto. Vacío si no definió nada. */
export function personasParaPrompt(db: Db, ahora = Date.now()): string {
  const ps = personas(db, {}, ahora).filter((p) => p.vinculo || p.proxima || p.vencida || (p.nivel ?? 0) >= 9 || (p.importancia ?? 0) >= 9 || p.proyectos.length)
  if (!ps.length) return ''
  const peso = (p: Persona) => Math.max(p.nivel ?? 0, p.importancia ?? 0) + (p.vencida ? 3 : 0) + (p.proxima ? 1 : 0)
  const lineas = [...ps].sort((a, b) => peso(b) - peso(a)).slice(0, 16).map((p) => `- ${personaEnUnaLinea(p)}${p.diasSinContacto != null ? `: último contacto hace ${p.diasSinContacto} días` : ''}${p.vencida ? ' — quería verla más seguido' : ''}${p.proxima ? `; próximo: ${p.proxima}` : ''}`)
  return `Su gente (lo que él definió; nivel = cuánto la conoce, importancia = cuánto pesa en su vida, ambos 1–12):\n${lineas.join('\n')}`
}

// ─── el grafo ───────────────────────────────────────────────────────────

export type NodoGrafo = { id: number; nombre: string; clase: ClasePersona | 'yo'; peso: number; menciones: number }
export type AristaGrafo = { a: number; b: number; tipo: string; nota: string | null; veces: number; definida: boolean }

/**
 * Su gente como grafo: cada persona (física o jurídica) con el tamaño de lo que pesa en su vida, y entre ellas las
 * relaciones que dice el archivo o que anotó él (tipadas) y, en gris, las que solo aparecen juntas en sus piezas.
 */
export function grafoPersonas(db: Db, o: { max?: number } = {}, ahora = Date.now()): { nodos: NodoGrafo[]; aristas: AristaGrafo[] } {
  const yo = entidadDelJugador(db)
  const ps = personas(db, {}, ahora).filter((p) => p.clase !== 'ficticia' || p.definida)
    .sort((a, b) => (b.importancia ?? b.nivel ?? b.nivelSugerido ?? 0) - (a.importancia ?? a.nivel ?? a.nivelSugerido ?? 0) || b.menciones - a.menciones)
    .slice(0, o.max ?? 150)
  const nodos: NodoGrafo[] = ps.map((p) => ({ id: p.id, nombre: p.nombre, clase: p.clase, peso: p.importancia ?? p.nivel ?? p.nivelSugerido ?? 1, menciones: p.menciones }))
  if (yo) {
    const e = db.prepare('SELECT nombre FROM entidades WHERE id = ?').get(yo) as { nombre: string } | undefined
    if (e) nodos.unshift({ id: yo, nombre: e.nombre, clase: 'yo', peso: 12, menciones: 0 })
  }
  const ids = new Set(nodos.map((n) => n.id))
  const aristas: AristaGrafo[] = (db.prepare('SELECT a, b, relacion, nota, origen FROM conexiones').all() as any[])
    .filter((c) => ids.has(c.a) && ids.has(c.b))
    .map((c) => ({ a: c.a, b: c.b, tipo: c.relacion ?? 'conexión', nota: c.nota, veces: 1 + ((c.nota ?? '').match(/ · /g)?.length ?? 0), definida: !String(c.origen ?? '').startsWith('destilado:') }))
  const ya = new Set(aristas.map((x) => `${Math.min(x.a, x.b)}|${Math.max(x.a, x.b)}`))
  const juntas = db.prepare(`SELECT x.entidad_id AS a, y.entidad_id AS b, COUNT(*) AS n FROM corpus_entidades x JOIN corpus_entidades y ON y.pieza_id = x.pieza_id AND x.entidad_id < y.entidad_id
    GROUP BY 1, 2 HAVING n >= 2 ORDER BY n DESC LIMIT 2000`).all() as { a: number; b: number; n: number }[]
  for (const j of juntas) {
    if (!ids.has(j.a) || !ids.has(j.b) || ya.has(`${j.a}|${j.b}`)) continue
    aristas.push({ a: j.a, b: j.b, tipo: 'aparecen juntas', nota: null, veces: j.n, definida: false })
  }
  return { nodos, aristas }
}
