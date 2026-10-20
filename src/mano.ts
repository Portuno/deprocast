/**
 * La Mano: el gesto mínimo de Deprocast. Cinco cartas (afirmaciones que destiló de lo suyo y todavía no pesó) y una
 * tecla por carta: peso 1–12, descartar o «choca con lo que ya sabía». Al jugarla, la respuesta llega enseguida y sin
 * modelo: con qué cosas que ya sabía conecta (por sentido), qué de lo que pesó alto refuerza o con qué choca, y a qué
 * misión sirve. Lo que sorprende sale de los datos, nunca de un sorteo: el orden es fijo por día (misma base, mismo
 * día, misma mano) y lo nuevo de verdad sale primero.
 */
import { fechaLocal, type Db } from './db.ts'
import { anotar } from './decisiones.ts'
import { descartar, leerQuantomo, parecidosA, sellar, UMBRAL_VARIACION, type Quantomo } from './quantomos.ts'
import { principalDe } from './misiones.ts'

export type Gesto = 'peso' | 'descartar' | 'choca'
export type Fuente = { piezaId: number; titulo: string; fecha: string | null; nivel: string | null }
export type Toca = {
  entidades: { id: number; nombre: string; tipo: string }[]
  /** La primaria de esta semana (o la última activa) que trata de algo de lo que habla la carta. */
  primaria: { id: number; titulo: string } | null
  principal: string | null
}
export type Carta = {
  id: number
  texto: string
  titulo: string | null
  novedad: string | null
  /** Si es variación o repetida: de qué. */
  parecidaA: { id: number; texto: string; sim: number } | null
  fuente: Fuente | null
  toca: Toca
}
export type Vecino = { id: number; texto: string; peso: number | null; sim: number; fecha: string | null }

/** Desde qué parecido una carta «conecta» con algo que ya sabía. */
export const UMBRAL_VECINO = 0.55
/** Lo que pesó desde acá es «lo que ya creía». */
export const PESO_CREENCIA = 9

// Primero lo nuevo de verdad que llegó esta semana (lo más reciente arriba: es lo que anuncia el aviso de Hoy); después
// lo nuevo de antes, las variaciones y lo repetido al final. Dentro de cada grupo, un orden mezclado pero fijo por día.
const ORDEN = `CASE WHEN q.novedad = 'nueva' AND q.creado_en > ? THEN -q.creado_en ELSE 0 END, CASE q.novedad WHEN 'nueva' THEN 0 WHEN 'variacion' THEN 1 WHEN 'repetida' THEN 3 ELSE 2 END, (q.id * 2654435761 + ?) % 1000003`
const SEMANA = 7 * 86_400_000
const semilla = (ahora: number) => Number(fechaLocal(ahora).replace(/-/g, ''))

function fuenteDe(db: Db, piezaId: number | null): Fuente | null {
  if (!piezaId) return null
  const p = db.prepare('SELECT id, titulo, fecha, nivel FROM corpus WHERE id = ?').get(piezaId) as any
  return p ? { piezaId: p.id, titulo: p.titulo, fecha: p.fecha ? String(p.fecha).slice(0, 10) : null, nivel: p.nivel ?? null } : null
}

/** A qué toca una carta: las entidades de su pieza (proyectos primero) y la primaria que trata de alguna de ellas. */
export function tocaDe(db: Db, piezaId: number | null): Toca {
  const principal = principalDe(db, 'jugador')?.titulo ?? null
  if (!piezaId) return { entidades: [], primaria: null, principal }
  const entidades = db.prepare(`SELECT e.id, e.nombre, e.tipo FROM corpus_entidades ce JOIN entidades e ON e.id = ce.entidad_id
    WHERE ce.pieza_id = ? ORDER BY e.tipo = 'proyecto' DESC, e.tipo = 'persona' DESC, e.id LIMIT 3`).all(piezaId) as Toca['entidades']
  const primaria = entidades.length
    ? (db.prepare(`SELECT id, titulo FROM misiones WHERE personaje = 'jugador' AND nivel = 'primaria' AND estado IN ('activa', 'sugerida', 'parcial')
        AND entidad_id IN (${entidades.map(() => '?').join(',')}) ORDER BY COALESCE(semana, '') DESC, id DESC LIMIT 1`).get(...entidades.map((e) => e.id)) as Toca['primaria'] | undefined) ?? null
    : null
  return { entidades, primaria, principal }
}

function carta(db: Db, q: Quantomo): Carta {
  const de = q.novedadDe ? (db.prepare('SELECT id, texto FROM quantomos WHERE id = ?').get(q.novedadDe) as { id: number; texto: string } | undefined) : undefined
  return {
    id: q.id, texto: q.texto, titulo: q.titulo, novedad: q.novedad,
    parecidaA: de && q.novedad !== 'nueva' ? { ...de, sim: q.novedadSim ?? 0 } : null,
    fuente: fuenteDe(db, q.piezaId), toca: tocaDe(db, q.piezaId),
  }
}

/** Cómo viene el mazo antes de robar: cuántas cartas sin pesar y de qué clase (el azar a la vista). */
export function composicion(db: Db, ahora = Date.now()) {
  const filas = db.prepare(`SELECT novedad, COUNT(*) AS n FROM quantomos WHERE etapa = 'proto' GROUP BY novedad`).all() as { novedad: string | null; n: number }[]
  const de = (k: string | null) => filas.find((f) => f.novedad === k)?.n ?? 0
  const hoy = new Date(`${fechaLocal(ahora)}T00:00:00`).getTime()
  const jugadas = (db.prepare(`SELECT COUNT(*) AS n FROM mano_jugadas WHERE deshecha = 0 AND en >= ?`).get(hoy) as { n: number }).n
  return { total: filas.reduce((s, f) => s + f.n, 0), nuevas: de('nueva'), variaciones: de('variacion'), repetidas: de('repetida'), sinVector: de(null), jugadasHoy: jugadas }
}

/**
 * Cuántas afirmaciones nuevas de verdad (no se parecen a nada que tenga) llegaron desde la última vez que jugó (o en la
 * última semana): es lo único que hace aparecer el aviso en Hoy. No cuenta el montón acumulado: eso sería presión por
 * volumen, no novedad.
 */
export function nuevasParaJugar(db: Db, ahora = Date.now()): number {
  const ultima = (db.prepare('SELECT MAX(en) AS en FROM mano_jugadas').get() as { en: number | null }).en ?? 0
  const desde = Math.max(ultima, ahora - SEMANA)
  return (db.prepare(`SELECT COUNT(*) AS n FROM quantomos WHERE etapa = 'proto' AND novedad = 'nueva' AND creado_en > ?`).get(desde) as { n: number }).n
}

/** Una mano: hasta n cartas sin pesar, lo nuevo primero, en un orden fijo por día. */
export function robar(db: Db, o: { n?: number; saltear?: number[]; ahora?: number } = {}): Carta[] {
  const saltear = (o.saltear ?? []).filter(Number.isFinite).slice(-200)
  const filas = db.prepare(`SELECT q.id FROM quantomos q WHERE q.etapa = 'proto'
      ${saltear.length ? `AND q.id NOT IN (${saltear.map(() => '?').join(',')})` : ''}
    ORDER BY ${ORDEN} LIMIT ?`).all(...saltear, (o.ahora ?? Date.now()) - SEMANA, semilla(o.ahora ?? Date.now()), Math.min(Math.max(o.n ?? 5, 1), 12)) as { id: number }[]
  return filas.map((f) => carta(db, leerQuantomo(db, f.id)!))
}

/** Lo sellado más parecido a un quántomo, con su parecido y la fecha de su pieza. */
async function selladosCerca(db: Db, id: number): Promise<Vecino[]> {
  const cerca = (await parecidosA(db, id, 60)).filter((x) => x.sim >= UMBRAL_VECINO)
  if (!cerca.length) return []
  const filas = new Map((db.prepare(`SELECT q.id, q.texto, q.peso, c.fecha FROM quantomos q LEFT JOIN corpus c ON c.id = q.pieza_id
    WHERE q.etapa = 'sellado' AND q.id IN (${cerca.map(() => '?').join(',')})`).all(...cerca.map((x) => x.id)) as any[]).map((r) => [r.id, r]))
  return cerca.filter((x) => filas.has(x.id)).map((x) => {
    const r = filas.get(x.id)
    return { id: x.id, texto: r.texto, peso: r.peso, sim: x.sim, fecha: r.fecha ? String(r.fecha).slice(0, 10) : null }
  })
}

export type Jugada = {
  jugadaId: number
  gesto: Gesto
  carta: { id: number; texto: string; peso: number | null; etapa: string }
  /** Las 3 cosas que ya sabía con las que más conecta. */
  vecinos: Vecino[]
  /** Lo que pesó alto (≥ 9) y dice casi lo mismo: lo que esta carta refuerza. */
  refuerza: Vecino[]
  /** Si marcó «choca»: lo pesado alto más cercano, candidato a ser lo que contradice. */
  chocaCon: Vecino[]
  toca: Toca
  ms: number
}

/** Juega una carta: la pesa, la descarta o la marca como choque, y devuelve enseguida con qué conecta. */
export async function jugar(db: Db, id: number, g: { gesto: Gesto; peso?: number | null; porque?: string | null }, ahora = Date.now()): Promise<Jugada> {
  const t0 = performance.now()
  const q = leerQuantomo(db, id)
  if (!q) throw new Error(`No existe la carta ${id}`)
  if (q.etapa !== 'proto' && q.etapa !== 'sellado') throw new Error(`Esa carta ya está ${q.etapa}`)
  if (!['peso', 'descartar', 'choca'].includes(g.gesto)) throw new Error('El gesto es peso, descartar o choca')
  if (g.gesto === 'peso') sellar(db, id, Number(g.peso), ahora)
  else if (g.gesto === 'descartar') descartar(db, id, ahora)
  const porque = String(g.porque ?? '').trim().slice(0, 500) || null
  const jugadaId = Number(db.prepare(`INSERT INTO mano_jugadas (quantomo_id, gesto, peso, porque, etapa_antes, peso_antes, en) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, g.gesto, g.gesto === 'peso' ? Number(g.peso) : null, porque, q.etapa, q.peso, ahora).lastInsertRowid)
  const despues = leerQuantomo(db, id)!
  const cerca = g.gesto === 'descartar' ? [] : await selladosCerca(db, id)
  return {
    jugadaId, gesto: g.gesto,
    carta: { id, texto: despues.texto, peso: despues.peso, etapa: despues.etapa },
    vecinos: cerca.slice(0, 3),
    refuerza: g.gesto === 'peso' ? cerca.filter((v) => (v.peso ?? 0) >= PESO_CREENCIA && v.sim >= UMBRAL_VARIACION).slice(0, 2) : [],
    chocaCon: g.gesto === 'choca' ? cerca.filter((v) => (v.peso ?? 0) >= PESO_CREENCIA - 1).slice(0, 3) : [],
    toca: tocaDe(db, q.piezaId),
    ms: Math.round(performance.now() - t0),
  }
}

/** Deshace la última carta jugada: vuelve a como estaba (sin pesar, o con el peso de antes). */
export function deshacerJugada(db: Db, ahora = Date.now()): { quantomoId: number } | null {
  const j = db.prepare('SELECT * FROM mano_jugadas WHERE deshecha = 0 ORDER BY id DESC LIMIT 1').get() as any
  if (!j) return null
  if (j.gesto !== 'choca') {
    db.prepare('UPDATE quantomos SET etapa = ?, peso = ?, actualizado_en = ? WHERE id = ?').run(j.etapa_antes, j.peso_antes, ahora, j.quantomo_id)
    if (j.etapa_antes === 'proto') anotar(db, 'quantomo', j.quantomo_id, 'deshecha', { ahora })
  }
  db.prepare('UPDATE mano_jugadas SET deshecha = 1 WHERE id = ?').run(j.id)
  return { quantomoId: j.quantomo_id }
}
