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

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/** Cambia nombre, tipo, alias o notas. El nombre anterior queda como alias: nadie deja de encontrarla. */
export function editarEntidad(
  db: Db, id: number, c: { nombre?: string; tipo?: string; alias?: string[]; notas?: string | null; sumarAlias?: string[]; quitarAlias?: string[] },
): Entidad {
  const e = leerEntidad(db, id)
  if (!e) throw new Error(`No existe la entidad ${id}`)
  const nombre = c.nombre?.trim() || e.nombre
  if (c.tipo && !TIPOS_ENTIDAD.includes(c.tipo as TipoEntidad)) throw new Error(`Tipo inválido: ${c.tipo}`)
  const base = c.alias ?? e.alias
  const fuera = new Set((c.quitarAlias ?? []).map(normal))
  const alias = [...new Set([...base, ...(c.sumarAlias ?? []), ...(nombre !== e.nombre ? [e.nombre] : [])].map((a) => a.trim()).filter((a) => a && normal(a) !== normal(nombre) && !fuera.has(normal(a))))]
  db.prepare('UPDATE entidades SET nombre = ?, tipo = ?, alias = ?, notas = ? WHERE id = ?')
    .run(nombre, c.tipo ?? e.tipo, alias.length ? JSON.stringify(alias) : null, c.notas !== undefined ? c.notas : e.notas, id)
  return leerEntidad(db, id)!
}

/**
 * Fusiona duplicadas en una: las piezas, misiones, inventario e historia que apuntaban a las otras pasan a la que queda;
 * sus nombres y alias se suman como alias, y sus notas se juntan. Las otras desaparecen.
 */
export function fusionarEntidades(db: Db, destino: number, origenes: number[]): Entidad {
  const d = leerEntidad(db, destino)
  if (!d) throw new Error(`No existe la entidad ${destino}`)
  const os = [...new Set(origenes)].filter((o) => o !== destino).map((o) => {
    const e = leerEntidad(db, o)
    if (!e) throw new Error(`No existe la entidad ${o}`)
    return e
  })
  if (!os.length) return d
  db.exec('BEGIN')
  try {
    const piezas = db.prepare(`SELECT DISTINCT c.id, c.entidades FROM corpus c, json_each(c.entidades) j WHERE j.value IN (${os.map(() => '?').join(',')})`).all(...os.map((o) => o.id)) as { id: number; entidades: string }[]
    const upd = db.prepare('UPDATE corpus SET entidades = ? WHERE id = ?')
    for (const p of piezas) {
      const ids = [...new Set(json<number[]>(p.entidades, []).map((x) => (os.some((o) => o.id === x) ? destino : x)))]
      upd.run(JSON.stringify(ids), p.id)
    }
    for (const o of os) {
      const k = `entidad:${o.id}`
      const kd = `entidad:${destino}`
      db.prepare('UPDATE misiones SET entidad_id = ? WHERE entidad_id = ?').run(destino, o.id)
      db.prepare('UPDATE misiones SET personaje = ? WHERE personaje = ?').run(kd, k)
      db.prepare('UPDATE misiones SET asignada_por = ? WHERE asignada_por = ?').run(kd, k)
      db.prepare('UPDATE inventario SET entidad_id = ? WHERE entidad_id = ?').run(destino, o.id)
      db.prepare('UPDATE inventario SET personaje = ? WHERE personaje = ?').run(kd, k)
      db.prepare('UPDATE conexiones SET a = ? WHERE a = ?').run(destino, o.id)
      db.prepare('UPDATE conexiones SET b = ? WHERE b = ?').run(destino, o.id)
      db.prepare('UPDATE OR IGNORE historias SET personaje = ? WHERE personaje = ?').run(kd, k)
      db.prepare('DELETE FROM historias WHERE personaje = ?').run(k)
      // Lo que también apuntaba a ella: plata, oportunidades, el proyecto de la liga, lo que propuso el Takeout.
      for (const t of ['oportunidades', 'movimientos', 'proyectos', 'takeout_nombres']) db.prepare(`UPDATE ${t} SET entidad_id = ? WHERE entidad_id = ?`).run(destino, o.id)
      // Su relación con él: se juntan (lo más alto de cada número, lo que estaba de cada lado, las notas sumadas).
      const ro = db.prepare('SELECT * FROM relaciones WHERE entidad_id = ?').get(o.id) as any
      if (ro) {
        const rd = db.prepare('SELECT * FROM relaciones WHERE entidad_id = ?').get(destino) as any
        if (!rd) db.prepare('UPDATE relaciones SET entidad_id = ? WHERE entidad_id = ?').run(destino, o.id)
        else {
          const max = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b))
          const notasR = [...new Set([rd.notas, ro.notas].filter((n: string | null) => n?.trim()))].join('\n\n') || null
          db.prepare(`UPDATE relaciones SET vinculo = ?, cercania = ?, nivel = ?, importancia = ?, clase = ?, estado = ?, cada_dias = ?, proxima = ?, notas = ?, ultimo_contacto = ? WHERE entidad_id = ?`).run(
            rd.vinculo ?? ro.vinculo, max(rd.cercania, ro.cercania), max(rd.nivel, ro.nivel), max(rd.importancia, ro.importancia), rd.clase ?? ro.clase, rd.estado ?? ro.estado,
            rd.cada_dias ?? ro.cada_dias, rd.proxima ?? ro.proxima, notasR, [rd.ultimo_contacto, ro.ultimo_contacto].filter(Boolean).sort().at(-1) ?? null, destino)
          db.prepare('DELETE FROM relaciones WHERE entidad_id = ?').run(o.id)
        }
      }
      db.prepare('UPDATE OR IGNORE persona_proyecto SET persona_id = ? WHERE persona_id = ?').run(destino, o.id)
      db.prepare('UPDATE OR IGNORE persona_proyecto SET proyecto_id = ? WHERE proyecto_id = ?').run(destino, o.id)
      db.prepare('DELETE FROM persona_proyecto WHERE persona_id = ? OR proyecto_id = ?').run(o.id, o.id)
      for (const pu of db.prepare(`SELECT p.id, p.personas FROM puentes p, json_each(p.personas) j WHERE j.value = ?`).all(o.id) as { id: number; personas: string }[]) {
        db.prepare('UPDATE puentes SET personas = ? WHERE id = ?').run(JSON.stringify([...new Set(json<number[]>(pu.personas, []).map((x) => (x === o.id ? destino : x)))]), pu.id)
      }
      db.prepare('DELETE FROM entidades WHERE id = ?').run(o.id)
    }
    db.prepare('DELETE FROM conexiones WHERE a = b').run()
    db.prepare('DELETE FROM persona_proyecto WHERE persona_id = proyecto_id').run()
    // Lo que se sabía de cada una (meta) se junta; si una de ellas era él (el yo), la que queda lo es.
    const meta = Object.assign({}, ...os.map((o) => o.meta ?? {}), d.meta ?? {})
    if (os.some((o) => o.meta?.operador)) meta.operador = 1
    if (Object.keys(meta).length) db.prepare('UPDATE entidades SET meta = ? WHERE id = ?').run(JSON.stringify(meta), destino)
    const notas = [d.notas, ...os.map((o) => o.notas)].filter((n): n is string => !!n?.trim())
    editarEntidad(db, destino, { sumarAlias: os.flatMap((o) => [o.nombre, ...o.alias]), notas: [...new Set(notas)].join('\n\n') || null })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return leerEntidad(db, destino)!
}

// ─── duplicados ─────────────────────────────────────────────────────────

export type GrupoDuplicado = { entidades: Entidad[]; motivo: string; queda: number }

const clave = (s: string) => normal(s).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Entidades que parecen la misma: mismo nombre (sin tildes ni mayúsculas), o el nombre de una es alias de la otra.
 * Propone que quede la más mencionada. Lo que él marcó como «no son lo mismo» no vuelve a aparecer.
 */
export function duplicadosProbables(db: Db, limite = 40): GrupoDuplicado[] {
  const todas = listarEntidades(db, { limite: 100_000 })
  const descartados = new Set((db.prepare('SELECT a, b FROM no_duplicados').all() as { a: number; b: number }[]).map((x) => `${Math.min(x.a, x.b)}-${Math.max(x.a, x.b)}`))
  const padre = new Map<number, number>()
  const raiz = (x: number): number => (padre.get(x) ?? x) === x ? x : raiz(padre.get(x)!)
  const unir = (a: number, b: number) => {
    if (descartados.has(`${Math.min(a, b)}-${Math.max(a, b)}`)) return
    const ra = raiz(a), rb = raiz(b)
    if (ra !== rb) padre.set(rb, ra)
  }
  const motivo = new Map<number, string>()
  const porNombre = new Map<string, Entidad[]>()
  for (const e of todas) {
    const k = clave(e.nombre)
    if (k.length < 3) continue
    porNombre.set(k, [...(porNombre.get(k) ?? []), e])
  }
  for (const [, es] of porNombre) for (let i = 1; i < es.length; i++) { unir(es[0].id, es[i].id); motivo.set(es[i].id, 'mismo nombre') }
  for (const e of todas) {
    for (const a of e.alias) {
      const otros = porNombre.get(clave(a)) ?? []
      for (const o of otros) if (o.id !== e.id) { unir(e.id, o.id); motivo.set(o.id, `«${o.nombre}» es alias de «${e.nombre}»`) }
    }
  }
  const grupos = new Map<number, Entidad[]>()
  const conPadre = new Set(padre.values())
  for (const e of todas) {
    const r = raiz(e.id)
    if (r === e.id && !padre.has(e.id) && !conPadre.has(e.id)) continue
    grupos.set(r, [...(grupos.get(r) ?? []), e])
  }
  return [...grupos.values()].filter((g) => g.length > 1)
    .map((g) => {
      const orden = [...g].sort((a, b) => b.piezas - a.piezas)
      return { entidades: orden, motivo: [...new Set(g.map((e) => motivo.get(e.id)).filter(Boolean))].join(' · ') || 'parecido', queda: orden[0].id }
    })
    .sort((a, b) => b.entidades.reduce((s, e) => s + e.piezas, 0) - a.entidades.reduce((s, e) => s + e.piezas, 0))
    .slice(0, limite)
}

/** «No son lo mismo»: el par no vuelve a proponerse. */
export function noSonLoMismo(db: Db, ids: number[]) {
  const alta = db.prepare('INSERT OR IGNORE INTO no_duplicados (a, b) VALUES (?, ?)')
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) alta.run(Math.min(ids[i], ids[j]), Math.max(ids[i], ids[j]))
}

/** Un alias mal puesto se lleva a la entidad que corresponde (o se saca, si «a» es null). */
export function moverAlias(db: Db, alias: string, de: number, a: number | null): { de: Entidad; a: Entidad | null } {
  const origen = leerEntidad(db, de)
  if (!origen) throw new Error(`No existe la entidad ${de}`)
  if (!origen.alias.some((x) => normal(x) === normal(alias))) throw new Error(`«${alias}» no es alias de ${origen.nombre}`)
  const queda = editarEntidad(db, de, { quitarAlias: [alias] })
  return { de: queda, a: a ? editarEntidad(db, a, { sumarAlias: [alias] }) : null }
}

/**
 * Cuando el problema es un alias mal puesto («España» como alias de una persona): se lo saca, sin fusionar nada. Que
 * aparezcan juntas no las hace la misma: queda anotado como conexión entre las dos.
 */
export function quitarAliasCruzados(db: Db, ids: number[], ahora = Date.now()): number {
  const es = ids.map((i) => leerEntidad(db, i)).filter((e): e is Entidad => !!e)
  let quitados = 0
  for (const e of es) {
    const otros = es.filter((o) => o.id !== e.id)
    const cruzadas = otros.filter((o) => e.alias.some((a) => clave(a) === clave(o.nombre)))
    const quedan = e.alias.filter((a) => !otros.some((o) => clave(o.nombre) === clave(a)))
    if (quedan.length !== e.alias.length) {
      quitados += e.alias.length - quedan.length
      db.prepare('UPDATE entidades SET alias = ? WHERE id = ?').run(quedan.length ? JSON.stringify(quedan) : null, e.id)
      for (const o of cruzadas) anotarConexion(db, { a: e.id, b: o.id, nota: `«${o.nombre}» figuraba como alias de «${e.nombre}»: aparecen juntas`, origen: 'alias' }, ahora)
    }
  }
  noSonLoMismo(db, ids)
  return quitados
}

export type Conexion = { id: number; otra: number; nombre: string; tipo: TipoEntidad; relacion: string | null }

/** La que ya existe con ese nombre o alias; si no, la crea. */
export function asegurarPorNombre(db: Db, nombre: string, tipo: TipoEntidad = 'persona', ahora = Date.now()): number {
  const n = nombre.trim()
  if (!n) throw new Error('Una entidad sin nombre no se anota')
  const t = TIPOS_ENTIDAD.includes(tipo) ? tipo : 'concepto'
  const directa = db.prepare('SELECT id FROM entidades WHERE nombre = ? COLLATE NOCASE').get(n) as { id: number } | undefined
  if (directa) return directa.id
  const k = normal(n)
  const porAlias = (db.prepare('SELECT id, alias FROM entidades WHERE alias IS NOT NULL').all() as { id: number; alias: string }[])
    .find((r) => json<string[]>(r.alias, []).some((a) => normal(a) === k))
  if (porAlias) return porAlias.id
  return asegurarEntidad(db, { tipo: t, nombre: n }, ahora)
}

/** Un vínculo que él aceptó. El mismo par con la misma relación no se duplica. */
export function anotarConexion(db: Db, c: { a: number; b: number; relacion?: string | null; nota?: string | null; origen?: string | null }, ahora = Date.now()): number {
  if (c.a === c.b) throw new Error('Una conexión necesita dos entidades distintas')
  const relacion = c.relacion?.trim().slice(0, 160) || null
  const ya = db.prepare(`SELECT id FROM conexiones WHERE a = ? AND b = ? AND COALESCE(relacion, '') = COALESCE(?, '')`).get(c.a, c.b, relacion) as { id: number } | undefined
  if (ya) return ya.id
  const r = db.prepare('INSERT INTO conexiones (a, b, relacion, nota, origen, creada_en) VALUES (?, ?, ?, ?, ?, ?)').run(c.a, c.b, relacion, c.nota?.trim().slice(0, 300) || null, c.origen ?? null, ahora)
  return Number(r.lastInsertRowid)
}

/** Con quién la anotó él, en cualquiera de los dos lados. */
export function conexionesDe(db: Db, id: number): Conexion[] {
  return (db.prepare(
    `SELECT c.id, c.relacion, CASE WHEN c.a = ? THEN c.b ELSE c.a END AS otra, e.nombre, e.tipo
     FROM conexiones c JOIN entidades e ON e.id = CASE WHEN c.a = ? THEN c.b ELSE c.a END
     WHERE c.a = ? OR c.b = ? ORDER BY c.id DESC LIMIT 24`,
  ).all(id, id, id, id) as any[]).map((r) => ({ id: r.id, otra: r.otra, nombre: r.nombre, tipo: r.tipo, relacion: r.relacion }))
}
