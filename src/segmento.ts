/**
 * Exportación a medida (segmentada): en vez de todo Deprocast, solo lo que él elige.
 * 1. Elige entidades de partida (proyectos, personas, agrupaciones, conceptos…).
 * 2. vecindario() le muestra sus vinculaciones, para sumar las que quiera:
 *    - conexiones: las que anotó entre entidades (se conocen, trabajan juntos…);
 *    - equipo: persona ↔ proyecto, con su rol;
 *    - en tus textos: las que aparecen en las mismas piezas (cuántas comparten).
 * 3. Arma el esquema: qué viaja (relaciones solo entre las elegidas o también hacia afuera, quántomos por etapa, piezas
 *    como referencia o con texto, notas y la relación personal) y ve antes cuánto pesa (previa()).
 * 4. exportarSegmento() arma el JSON (formato deprocast-segmento). Los esquemas se guardan para volver a correrlos
 *    con los datos del día.
 * Lo íntimo (bitácora) no viaja nunca: el segmento sale de entidades, sus vínculos, sus piezas y sus quántomos.
 */
import type { Db } from './db.ts'

export const FORMATO_SEGMENTO = 'deprocast-segmento'
export const ETAPAS_QUANTOMO = ['sellado', 'proto', 'propuesta', 'superado', 'descartado'] as const
export const TIPOS_ENTIDAD = ['proyecto', 'persona', 'agrupacion', 'concepto', 'dominio', 'lugar'] as const

export type Esquema = {
  nombre?: string
  entidades: number[]
  relaciones?: 'entre' | 'afuera' | 'no'
  coocurrencias?: boolean
  quantomos?: string[]
  piezas?: 'no' | 'referencias' | 'completas'
  notas?: boolean
  relacionPersonal?: boolean
}
type EsquemaListo = Required<Omit<Esquema, 'nombre'>> & { nombre: string | null }

const MAX_ENTIDADES = 500
const MAX_PIEZAS_COMPLETAS = 400

const json = <T>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) : d } catch { return d } }
const lugares = (n: number) => Array.from({ length: n }, () => '?').join(',')

export function normalizar(e: Esquema): EsquemaListo {
  const ids = [...new Set((e.entidades ?? []).map(Number).filter((x) => Number.isInteger(x) && x > 0))]
  if (!ids.length) throw new Error('Elegí al menos una entidad para exportar')
  if (ids.length > MAX_ENTIDADES) throw new Error(`Hasta ${MAX_ENTIDADES} entidades por exportación`)
  const etapas = (e.quantomos ?? ['sellado', 'proto']).filter((x) => (ETAPAS_QUANTOMO as readonly string[]).includes(x))
  return {
    nombre: e.nombre?.trim().slice(0, 80) || null,
    entidades: ids,
    relaciones: e.relaciones === 'afuera' || e.relaciones === 'no' ? e.relaciones : 'entre',
    coocurrencias: !!e.coocurrencias,
    quantomos: etapas,
    piezas: e.piezas === 'completas' || e.piezas === 'no' ? e.piezas : 'referencias',
    notas: e.notas !== false,
    relacionPersonal: !!e.relacionPersonal,
  }
}

// ─── 1 y 2: elegir y ver sus vinculaciones ──────────────────────────────

export function buscarEntidades(db: Db, f: { q?: string; tipo?: string; limite?: number } = {}) {
  const where: string[] = []
  const args: (string | number)[] = []
  if (f.tipo) where.push('e.tipo = ?'), args.push(f.tipo)
  if (f.q?.trim()) where.push('(e.nombre LIKE ? OR e.alias LIKE ?)'), args.push(`%${f.q.trim()}%`, `%${f.q.trim()}%`)
  return db.prepare(`SELECT e.id, e.tipo, e.nombre, (SELECT COUNT(*) FROM corpus_entidades ce WHERE ce.entidad_id = e.id) AS piezas
    FROM entidades e ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY piezas DESC, e.nombre LIMIT ?`).all(...args, Math.min(f.limite ?? 40, 200)) as { id: number; tipo: string; nombre: string; piezas: number }[]
}

export type Vinculo = { id: number; tipo: string; nombre: string; por: 'conexion' | 'equipo' | 'textos'; detalle: string; desde: number[]; peso: number }

/** Las vinculaciones de las elegidas (sin ellas mismas), agrupables por «por». */
export function vecindario(db: Db, ids: number[], o: { coocurrencias?: number } = {}): { elegidas: { id: number; tipo: string; nombre: string; piezas: number; quantomos: number }[]; vinculos: Vinculo[] } {
  const sel = [...new Set(ids.map(Number).filter((x) => x > 0))]
  if (!sel.length) return { elegidas: [], vinculos: [] }
  const enSel = new Set(sel)
  const ph = lugares(sel.length)
  const elegidas = (db.prepare(`SELECT e.id, e.tipo, e.nombre,
      (SELECT COUNT(*) FROM corpus_entidades ce WHERE ce.entidad_id = e.id) AS piezas,
      (SELECT COUNT(*) FROM quantomos q WHERE q.pieza_id IN (SELECT pieza_id FROM corpus_entidades WHERE entidad_id = e.id) AND q.etapa NOT IN ('superado', 'descartado')) AS quantomos
    FROM entidades e WHERE e.id IN (${ph})`).all(...sel) as any[])
  const nombre = new Map(elegidas.map((e) => [e.id, e.nombre]))
  const vs = new Map<string, Vinculo>()
  const sumar = (v: Omit<Vinculo, 'desde'> & { desde: number }) => {
    if (enSel.has(v.id)) return
    const k = `${v.por}:${v.id}`
    const ya = vs.get(k)
    if (ya) { if (!ya.desde.includes(v.desde)) ya.desde.push(v.desde); ya.peso += v.peso; return }
    vs.set(k, { ...v, desde: [v.desde] })
  }
  for (const r of db.prepare(`SELECT c.a, c.b, c.relacion, e.id, e.tipo, e.nombre FROM conexiones c
      JOIN entidades e ON e.id = CASE WHEN c.a IN (${ph}) THEN c.b ELSE c.a END
      WHERE c.a IN (${ph}) OR c.b IN (${ph})`).all(...sel, ...sel, ...sel) as any[]) {
    const desde = enSel.has(r.a) ? r.a : r.b
    sumar({ id: r.id, tipo: r.tipo, nombre: r.nombre, por: 'conexion', detalle: `${r.relacion ?? 'conectada'} con ${nombre.get(desde)}`, desde, peso: 1 })
  }
  for (const r of db.prepare(`SELECT pp.persona_id, pp.proyecto_id, pp.rol, e.id, e.tipo, e.nombre FROM persona_proyecto pp
      JOIN entidades e ON e.id = CASE WHEN pp.persona_id IN (${ph}) THEN pp.proyecto_id ELSE pp.persona_id END
      WHERE pp.persona_id IN (${ph}) OR pp.proyecto_id IN (${ph})`).all(...sel, ...sel, ...sel) as any[]) {
    const desde = enSel.has(r.persona_id) ? r.persona_id : r.proyecto_id
    sumar({ id: r.id, tipo: r.tipo, nombre: r.nombre, por: 'equipo', detalle: `${r.rol ? `${r.rol} · ` : ''}${enSel.has(r.persona_id) ? 'proyecto de' : 'en el equipo de'} ${nombre.get(desde)}`, desde, peso: 1 })
  }
  const tope = o.coocurrencias ?? 15
  for (const id of sel) {
    for (const r of db.prepare(`SELECT e.id, e.tipo, e.nombre, COUNT(*) AS n FROM corpus_entidades a JOIN corpus_entidades b ON b.pieza_id = a.pieza_id
        JOIN entidades e ON e.id = b.entidad_id WHERE a.entidad_id = ? AND b.entidad_id != ? GROUP BY e.id ORDER BY n DESC, e.nombre LIMIT ?`).all(id, id, tope) as any[]) {
      sumar({ id: r.id, tipo: r.tipo, nombre: r.nombre, por: 'textos', detalle: `${r.n} pieza${r.n === 1 ? '' : 's'} con ${nombre.get(id)}`, desde: id, peso: r.n })
    }
  }
  const orden = { conexion: 0, equipo: 1, textos: 2 }
  return { elegidas, vinculos: [...vs.values()].sort((a, b) => orden[a.por] - orden[b.por] || b.peso - a.peso || a.nombre.localeCompare(b.nombre)) }
}

// ─── 3 y 4: armar y exportar ────────────────────────────────────────────

export function exportarSegmento(db: Db, esquema: Esquema, ahora = Date.now()) {
  const e = normalizar(esquema)
  const ph = lugares(e.entidades.length)
  const enSel = new Set(e.entidades)

  const entidades = (db.prepare(`SELECT e.*, r.vinculo, r.cercania, r.notas AS r_notas, r.ultimo_contacto FROM entidades e LEFT JOIN relaciones r ON r.entidad_id = e.id WHERE e.id IN (${ph}) ORDER BY e.tipo, e.nombre`).all(...e.entidades) as any[])
    .map((r) => ({
      id: r.id, tipo: r.tipo, nombre: r.nombre, alias: json<string[]>(r.alias, []),
      ...(e.notas ? { notas: r.notas ?? null, meta: json(r.meta, null) } : {}),
      ...(e.relacionPersonal && (r.vinculo || r.cercania != null) ? { relacion_personal: { vinculo: r.vinculo, cercania: r.cercania, notas: r.r_notas, ultimo_contacto: r.ultimo_contacto } } : {}),
    }))
  if (!entidades.length) throw new Error('Ninguna de esas entidades existe')

  // Relaciones: entre las elegidas, o también hacia afuera (la otra punta viaja como referencia).
  const relaciones: { de: number; a: number; tipo: string; relacion?: string | null; nota?: string | null; rol?: string | null; importancia?: number | null; piezas?: number }[] = []
  const afuera = new Map<number, { id: number; tipo: string; nombre: string }>()
  const tocar = (id: number) => { if (enSel.has(id) || afuera.has(id)) return; const r = db.prepare('SELECT id, tipo, nombre FROM entidades WHERE id = ?').get(id) as any; if (r) afuera.set(id, r) }
  if (e.relaciones !== 'no') {
    const cond = e.relaciones === 'entre' ? `a IN (${ph}) AND b IN (${ph})` : `a IN (${ph}) OR b IN (${ph})`
    for (const r of db.prepare(`SELECT a, b, relacion, nota FROM conexiones WHERE ${cond}`).all(...e.entidades, ...e.entidades) as any[]) {
      relaciones.push({ de: r.a, a: r.b, tipo: 'conexion', relacion: r.relacion, nota: r.nota }); tocar(r.a); tocar(r.b)
    }
    const condPP = e.relaciones === 'entre' ? `persona_id IN (${ph}) AND proyecto_id IN (${ph})` : `persona_id IN (${ph}) OR proyecto_id IN (${ph})`
    for (const r of db.prepare(`SELECT persona_id, proyecto_id, rol, importancia, notas FROM persona_proyecto WHERE ${condPP}`).all(...e.entidades, ...e.entidades) as any[]) {
      relaciones.push({ de: r.persona_id, a: r.proyecto_id, tipo: 'equipo', rol: r.rol, importancia: r.importancia, nota: r.notas }); tocar(r.persona_id); tocar(r.proyecto_id)
    }
  }
  if (e.coocurrencias && e.entidades.length > 1) {
    for (const r of db.prepare(`SELECT a.entidad_id AS x, b.entidad_id AS y, COUNT(*) AS n FROM corpus_entidades a JOIN corpus_entidades b ON b.pieza_id = a.pieza_id
        WHERE a.entidad_id IN (${ph}) AND b.entidad_id IN (${ph}) AND a.entidad_id < b.entidad_id GROUP BY a.entidad_id, b.entidad_id`).all(...e.entidades, ...e.entidades) as any[]) {
      relaciones.push({ de: r.x, a: r.y, tipo: 'en_textos', piezas: r.n })
    }
  }

  // Piezas y quántomos: los de las piezas donde aparece alguna elegida (con cuáles aparece).
  const enPiezas = new Map<number, number[]>()
  for (const r of db.prepare(`SELECT pieza_id, entidad_id FROM corpus_entidades WHERE entidad_id IN (${ph})`).all(...e.entidades) as { pieza_id: number; entidad_id: number }[]) {
    enPiezas.set(r.pieza_id, [...(enPiezas.get(r.pieza_id) ?? []), r.entidad_id])
  }
  const idsPiezas = [...enPiezas.keys()]
  let quantomos: any[] = []
  if (e.quantomos.length && idsPiezas.length) {
    quantomos = []
    for (let i = 0; i < idsPiezas.length; i += 500) {
      const lote = idsPiezas.slice(i, i + 500)
      quantomos.push(...(db.prepare(`SELECT id, titulo, texto, etapa, peso, version, universo, pieza_id, creado_en FROM quantomos
        WHERE pieza_id IN (${lugares(lote.length)}) AND etapa IN (${lugares(e.quantomos.length)}) ORDER BY peso IS NULL, peso DESC, id`).all(...lote, ...e.quantomos) as any[]))
    }
    quantomos = quantomos.map((q) => ({ ...q, entidades: enPiezas.get(q.pieza_id) ?? [], creado_en: new Date(q.creado_en).toISOString() }))
  }
  let piezas: any[] = []
  if (e.piezas !== 'no' && idsPiezas.length) {
    const completas = e.piezas === 'completas'
    for (let i = 0; i < idsPiezas.length; i += 500) {
      const lote = idsPiezas.slice(i, i + 500)
      piezas.push(...(db.prepare(`SELECT id, titulo, nivel, fecha, url, fuente${completas ? ', contenido' : ''} FROM corpus WHERE id IN (${lugares(lote.length)})`).all(...lote) as any[]))
    }
    piezas.sort((a, b) => (enPiezas.get(b.id)?.length ?? 0) - (enPiezas.get(a.id)?.length ?? 0) || b.id - a.id)
    if (completas && piezas.length > MAX_PIEZAS_COMPLETAS) piezas = piezas.map((p, i) => (i < MAX_PIEZAS_COMPLETAS ? p : { ...p, contenido: undefined, recortada: true }))
    piezas = piezas.map((p) => ({ ...p, entidades: enPiezas.get(p.id) ?? [] }))
  }

  return {
    formato: FORMATO_SEGMENTO, version: 1, exportado_en: new Date(ahora).toISOString(),
    esquema: e,
    resumen: { entidades: entidades.length, relaciones: relaciones.length, quantomos: quantomos.length, piezas: piezas.length, afuera: afuera.size },
    entidades,
    ...(afuera.size ? { entidades_afuera: [...afuera.values()] } : {}),
    relaciones, quantomos, piezas,
  }
}

/** Cuánto sale con este esquema, sin armarlo entero (para decidir antes de bajar). */
export function previa(db: Db, esquema: Esquema) {
  const r = exportarSegmento(db, { ...esquema, piezas: esquema.piezas === 'completas' ? 'referencias' : esquema.piezas })
  const bytes = Buffer.byteLength(JSON.stringify(r))
  const extra = esquema.piezas === 'completas' && r.piezas.length
    ? Number((db.prepare(`SELECT COALESCE(SUM(LENGTH(contenido)), 0) AS n FROM corpus WHERE id IN (${lugares(Math.min(r.piezas.length, MAX_PIEZAS_COMPLETAS))})`).get(...r.piezas.slice(0, MAX_PIEZAS_COMPLETAS).map((p: any) => p.id)) as { n: number }).n)
    : 0
  return { ...r.resumen, bytes: bytes + extra }
}

// ─── esquemas guardados ─────────────────────────────────────────────────

export function guardarEsquema(db: Db, esquema: Esquema, ahora = Date.now()) {
  const e = normalizar(esquema)
  if (!e.nombre) throw new Error('Ponele un nombre al esquema para guardarlo')
  db.prepare(`INSERT INTO export_esquemas (nombre, esquema, creado_en, usado_en) VALUES (?, ?, ?, ?)
    ON CONFLICT(nombre) DO UPDATE SET esquema = excluded.esquema, usado_en = excluded.usado_en`).run(e.nombre, JSON.stringify(e), ahora, ahora)
  return listarEsquemas(db).find((x) => x.nombre === e.nombre)!
}

export function listarEsquemas(db: Db) {
  return (db.prepare('SELECT * FROM export_esquemas ORDER BY usado_en DESC').all() as any[]).map((r) => ({ id: r.id, nombre: r.nombre, esquema: json<EsquemaListo>(r.esquema, null as any), creadoEn: r.creado_en, usadoEn: r.usado_en }))
}

export function borrarEsquema(db: Db, id: number) {
  if (!db.prepare('DELETE FROM export_esquemas WHERE id = ?').run(id).changes) throw new Error('Ese esquema no existe')
}

export function usarEsquema(db: Db, id: number, ahora = Date.now()) {
  db.prepare('UPDATE export_esquemas SET usado_en = ? WHERE id = ?').run(ahora, id)
}
