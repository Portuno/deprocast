/**
 * Personajes: el jugador, Mastropiero, cada agente y cada entidad comparten tres cosas: historia (trasfondo y origen),
 * inventario (capital, conexiones, presencia digital, conocimiento…) y misiones (ver misiones.ts).
 * Una clave de texto los nombra a todos: jugador | mastropiero | agente:GEN-0007 | entidad:42.
 * Lo que propone Mastropiero entra como sugerencia y solo vale cuando el operador lo acepta.
 */
import { json, type Db } from './db.ts'
import { CLASES } from './clases.ts'
import { especializacion } from './auditor.ts'
import { leerEntidad } from './entidades.ts'
import { alias, leer, nivel } from './roster.ts'
import { capa } from './xp.ts'

export type TipoPersonaje = 'jugador' | 'mastropiero' | 'agente' | 'entidad'
export type Personaje = { clave: string; tipo: TipoPersonaje; nombre: string; subtipo: string | null }

export const TIPOS_INVENTARIO = ['capital', 'conexion', 'presencia', 'conocimiento', 'herramienta', 'acceso', 'recurso'] as const
export type TipoInventario = (typeof TIPOS_INVENTARIO)[number]

/** Valida una clave y dice quién es. Tira error si no existe. */
export function personaje(db: Db, clave: string): Personaje {
  if (clave === 'jugador') return { clave, tipo: 'jugador', nombre: nombreDelJugador(db), subtipo: null }
  if (clave === 'mastropiero') return { clave, tipo: 'mastropiero', nombre: 'Mastropiero', subtipo: null }
  const [tipo, id] = [clave.slice(0, clave.indexOf(':')), clave.slice(clave.indexOf(':') + 1)]
  if (tipo === 'agente') {
    const f = leer(db, id)
    if (!f) throw new Error(`No existe el agente ${id}`)
    return { clave: `agente:${f.id}`, tipo: 'agente', nombre: alias(f), subtipo: f.clase }
  }
  if (tipo === 'entidad') {
    const e = leerEntidad(db, Number(id))
    if (!e) throw new Error(`No existe la entidad ${id}`)
    return { clave: `entidad:${e.id}`, tipo: 'entidad', nombre: e.nombre, subtipo: e.tipo }
  }
  throw new Error(`Clave de personaje inválida: ${clave} (jugador | mastropiero | agente:ID | entidad:N)`)
}

function nombreDelJugador(db: Db): string {
  const yo = db.prepare(`SELECT nombre FROM entidades WHERE tipo = 'persona' AND json_extract(meta, '$.operador') = 1 LIMIT 1`).get() as { nombre: string } | undefined
  return yo?.nombre ?? 'Jugador'
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/**
 * De lo que dice un humano o un modelo a una clave: «yo», «jugador», «mastropiero», un id o nombre de agente,
 * «entidad:12», «12» o el nombre (o alias) exacto de una entidad.
 */
export function resolverPersonaje(db: Db, texto: string | number | null | undefined): string {
  const t = String(texto ?? '').trim()
  if (!t || ['jugador', 'yo', 'operador', 'el operador', 'el jugador'].includes(norm(t))) return 'jugador'
  if (norm(t) === 'mastropiero') return 'mastropiero'
  if (/^(agente|entidad):/.test(t)) return personaje(db, t).clave
  if (/^\d+$/.test(t)) return personaje(db, `entidad:${t}`).clave
  const f = leer(db, t)
  if (f) return `agente:${f.id}`
  const e = entidadPorNombre(db, t)
  if (e) return `entidad:${e}`
  throw new Error(`No encuentro a «${t}» entre los personajes (buscalo con listar_entidades, o creá la entidad)`)
}

/** Una entidad por nombre o alias exacto (sin tildes ni mayúsculas). */
export function entidadPorNombre(db: Db, nombre: string): number | null {
  const n = norm(nombre)
  if (!n) return null
  // Sin tildes ni mayúsculas: LIKE no las ignora, así que se compara en memoria.
  const todas = db.prepare('SELECT id, nombre, alias FROM entidades').all() as { id: number; nombre: string; alias: string | null }[]
  return (todas.find((e) => norm(e.nombre) === n) ?? todas.find((e) => json<string[]>(e.alias, []).some((a) => norm(a) === n)))?.id ?? null
}

/**
 * Una persona por cómo la nombra él («Ana» → «Ana María López»): primero exacto; si no, la única persona
 * cuyo nombre o alias empieza así. Si hay más de una candidata, no adivina.
 */
export function personaPorNombre(db: Db, nombre: string): number | null {
  const exacta = entidadPorNombre(db, nombre)
  if (exacta) return exacta
  const n = norm(nombre)
  if (n.length < 3) return null
  const personas = db.prepare(`SELECT id, nombre, alias FROM entidades WHERE tipo = 'persona'`).all() as { id: number; nombre: string; alias: string | null }[]
  const empieza = (x: string) => norm(x) === n || norm(x).startsWith(`${n} `) || norm(x).split(' ')[0].startsWith(n)
  const cands = personas.filter((p) => empieza(p.nombre) || json<string[]>(p.alias, []).some(empieza))
  return cands.length === 1 ? cands[0].id : null
}

// ─── historia ───────────────────────────────────────────────────────────

export type Historia = { texto: string | null; elementos: string[]; sugerencia: { texto: string; elementos: string[] } | null; derivada: string | null }

export function leerHistoria(db: Db, clave: string): Historia {
  const r = db.prepare('SELECT * FROM historias WHERE personaje = ?').get(clave) as any
  return { texto: r?.texto ?? null, elementos: json(r?.elementos, []), sugerencia: json(r?.sugerencia, null), derivada: historiaDerivada(db, clave) }
}

/** Lo que el sistema ya sabe del origen sin que nadie lo escriba. */
function historiaDerivada(db: Db, clave: string): string | null {
  if (clave.startsWith('agente:')) {
    const f = leer(db, clave.slice(7))
    if (!f) return null
    const c = CLASES[f.clase]
    return [
      `${c.nombre} forjado por ${f.creador === 'operador' ? 'el operador' : f.creador} el ${new Date(f.creadoEn).toLocaleDateString('es-AR')}.`,
      f.proyectoId ? `Nació para el proyecto ${f.proyectoId}.` : 'Agente libre.',
      f.celda ? `Celda ${f.celda} de la Matriz 72.` : '',
      `Sus instrucciones: «${f.instrucciones}»`,
    ].filter(Boolean).join(' ')
  }
  if (clave.startsWith('entidad:')) return leerEntidad(db, Number(clave.slice(8)))?.notas ?? null
  if (clave === 'mastropiero') return 'El agente omnívoro: no es una ficha, es la liga entera. Nace con la plataforma y crece con lo que el jugador le carga y le cuenta.'
  return null
}

export function escribirHistoria(db: Db, clave: string, h: { texto?: string | null; elementos?: string[] }, o: { sugerida?: boolean; ahora?: number } = {}) {
  personaje(db, clave)
  const ahora = o.ahora ?? Date.now()
  const elementos = (h.elementos ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 24)
  const texto = (h.texto ?? '').trim() || null
  db.prepare('INSERT OR IGNORE INTO historias (personaje, actualizada_en) VALUES (?, ?)').run(clave, ahora)
  if (o.sugerida) {
    db.prepare('UPDATE historias SET sugerencia = ?, actualizada_en = ? WHERE personaje = ?').run(JSON.stringify({ texto: texto ?? '', elementos }), ahora, clave)
  } else {
    const previa = leerHistoria(db, clave)
    db.prepare('UPDATE historias SET texto = ?, elementos = ?, actualizada_en = ? WHERE personaje = ?')
      .run(texto ?? previa.texto, JSON.stringify(h.elementos ? elementos : previa.elementos), ahora, clave)
  }
  return leerHistoria(db, clave)
}

/** La sugerencia pasa a ser la historia (o se descarta). */
export function resolverHistoria(db: Db, clave: string, aceptar: boolean) {
  const h = leerHistoria(db, clave)
  if (!h.sugerencia) throw new Error('No hay historia sugerida')
  if (aceptar) {
    const elementos = [...new Set([...h.elementos, ...h.sugerencia.elementos])]
    db.prepare('UPDATE historias SET texto = ?, elementos = ? WHERE personaje = ?').run(h.sugerencia.texto || h.texto, JSON.stringify(elementos), clave)
  }
  db.prepare('UPDATE historias SET sugerencia = NULL WHERE personaje = ?').run(clave)
  return leerHistoria(db, clave)
}

// ─── inventario ─────────────────────────────────────────────────────────

export type Item = {
  id: number; personaje: string; tipo: TipoInventario; nombre: string; detalle: string | null; valor: number | null; unidad: string | null
  url: string | null; entidadId: number | null; estado: 'sugerido' | 'vigente' | 'archivado'; fuente: string; actualizadoEn: number
}

const item = (r: any): Item => ({
  id: r.id, personaje: r.personaje, tipo: r.tipo, nombre: r.nombre, detalle: r.detalle, valor: r.valor, unidad: r.unidad, url: r.url,
  entidadId: r.entidad_id, estado: r.estado, fuente: r.fuente, actualizadoEn: r.actualizado_en,
})

export const esTipoInventario = (t: unknown): t is TipoInventario => TIPOS_INVENTARIO.includes(t as TipoInventario)

export type NuevoItem = { tipo?: string; nombre: string; detalle?: string | null; valor?: number | null; unidad?: string | null; url?: string | null; entidadId?: number | null }

/** Alta. Si ya hay uno vigente o sugerido con el mismo tipo y nombre, lo actualiza en vez de duplicar. */
export function agregarItem(db: Db, clave: string, i: NuevoItem, o: { fuente?: string; sugerido?: boolean; ahora?: number } = {}): Item {
  personaje(db, clave)
  const nombre = String(i.nombre ?? '').trim().slice(0, 160)
  if (!nombre) throw new Error('El ítem necesita un nombre')
  const tipo = esTipoInventario(i.tipo) ? i.tipo : 'recurso'
  const ahora = o.ahora ?? Date.now()
  const valor = i.valor == null || i.valor === ('' as any) || !Number.isFinite(Number(i.valor)) ? null : Number(i.valor)
  const ya = (db.prepare(`SELECT * FROM inventario WHERE personaje = ? AND tipo = ? AND estado != 'archivado'`).all(clave, tipo) as any[]).find((r) => norm(r.nombre) === norm(nombre))
  if (ya) {
    db.prepare('UPDATE inventario SET detalle = COALESCE(?, detalle), valor = COALESCE(?, valor), unidad = COALESCE(?, unidad), url = COALESCE(?, url), actualizado_en = ? WHERE id = ?')
      .run(i.detalle ?? null, valor, i.unidad ?? null, i.url ?? null, ahora, ya.id)
    return leerItem(db, ya.id)!
  }
  const r = db.prepare(
    `INSERT INTO inventario (personaje, tipo, nombre, detalle, valor, unidad, url, entidad_id, estado, fuente, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(clave, tipo, nombre, i.detalle?.trim() || null, valor, i.unidad?.trim() || null, i.url?.trim() || null, i.entidadId ?? null,
    o.sugerido ? 'sugerido' : 'vigente', o.fuente ?? 'operador', ahora, ahora)
  return leerItem(db, Number(r.lastInsertRowid))!
}

export function leerItem(db: Db, id: number): Item | null {
  const r = db.prepare('SELECT * FROM inventario WHERE id = ?').get(id)
  return r ? item(r) : null
}

export function editarItem(db: Db, id: number, c: Partial<NuevoItem> & { estado?: Item['estado'] }, ahora = Date.now()): Item {
  const i = leerItem(db, id)
  if (!i) throw new Error(`No existe el ítem ${id}`)
  if (c.estado && !['sugerido', 'vigente', 'archivado'].includes(c.estado)) throw new Error('Estado de ítem inválido')
  const v = (k: keyof NuevoItem, actual: unknown) => (k in c ? (c as any)[k] ?? null : actual)
  db.prepare('UPDATE inventario SET tipo = ?, nombre = ?, detalle = ?, valor = ?, unidad = ?, url = ?, estado = ?, actualizado_en = ? WHERE id = ?').run(
    esTipoInventario(c.tipo) ? c.tipo : i.tipo, String(v('nombre', i.nombre) || i.nombre).trim(), v('detalle', i.detalle), v('valor', i.valor) === '' ? null : v('valor', i.valor),
    v('unidad', i.unidad), v('url', i.url), c.estado ?? i.estado, ahora, id,
  )
  return leerItem(db, id)!
}

export function inventarioDe(db: Db, clave: string, o: { conSugeridos?: boolean; conArchivados?: boolean } = {}): Item[] {
  const estados = ['vigente', ...(o.conSugeridos ? ['sugerido'] : []), ...(o.conArchivados ? ['archivado'] : [])]
  return db.prepare(`SELECT * FROM inventario WHERE personaje = ? AND estado IN (${estados.map(() => '?').join(',')}) ORDER BY tipo, estado DESC, nombre`)
    .all(clave, ...estados).map(item)
}

/** Lo que un agente o Mastropiero tienen por ser lo que son: no se edita, se ve. */
export function inventarioDerivado(db: Db, clave: string): { tipo: TipoInventario; nombre: string; detalle: string }[] {
  if (clave.startsWith('agente:')) {
    const f = leer(db, clave.slice(7))
    if (!f) return []
    const n = nivel(f)
    const k = capa(n)
    const esp = especializacion(db, f.id)
    return [
      { tipo: 'herramienta', nombre: `Motor ${f.motor}`, detalle: 'con lo que piensa' },
      { tipo: 'acceso', nombre: `Capa ${k.nivel} · ${k.nombre}`, detalle: `${k.abre}; lee hasta ${k.lecturaMax} piezas por búsqueda` },
      { tipo: 'capital', nombre: `${f.xp} XP · nivel ${n}`, detalle: `${f.exitos} misiones cumplidas, ${f.fallos} fallidas` },
      ...(esp ? [{ tipo: 'conocimiento' as const, nombre: `Especialista en ${esp}`, detalle: 'ganado en el bus' }] : []),
    ]
  }
  if (clave === 'mastropiero') {
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n
    return [
      { tipo: 'capital', nombre: `${n(`SELECT COUNT(*) AS n FROM agentes WHERE estado != 'prueba'`)} agentes en la liga`, detalle: `${n(`SELECT COUNT(*) AS n FROM agentes WHERE estado = 'prueba'`)} más en prueba` },
      { tipo: 'conocimiento', nombre: `${n('SELECT COUNT(*) AS n FROM corpus').toLocaleString('es-AR')} piezas en el corpus`, detalle: `${n('SELECT COUNT(*) AS n FROM entidades').toLocaleString('es-AR')} entidades` },
      { tipo: 'conocimiento', nombre: `${n(`SELECT COUNT(*) AS n FROM memoria WHERE estado = 'vigente'`)} recuerdos del jugador`, detalle: 'su memoria' },
      { tipo: 'herramienta', nombre: 'Herramientas de la plataforma', detalle: 'opera la liga, el corpus, las misiones y el día' },
    ]
  }
  return []
}

/** Resumen de inventario en una línea por tipo (para prompts). */
export function inventarioParaPrompt(db: Db, clave: string, limite = 30): string {
  const xs = inventarioDe(db, clave).slice(0, limite)
  return xs.map((i) => `- [${i.tipo}] ${i.nombre}${i.valor != null ? ` (${i.valor}${i.unidad ? ` ${i.unidad}` : ''})` : ''}${i.detalle ? `: ${i.detalle}` : ''}`).join('\n')
}
