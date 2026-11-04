/**
 * Las voces (plan v33): quién habla en cada tramo que llega del teléfono. Cada tramo trae su huella (src/conciencia/
 * huella.ts); se compara con los hablantes que ya se conocen y, si se parece lo suficiente, es ese (su huella se
 * promedia y aprende); si no, nace «Hablante N». Vincular un hablante a una entidad (una persona de tus entidades, o
 * vos) le pone nombre: desde ahí se lo reconoce. La transcripción de cada turno queda con su hablante; el audio, nunca.
 * Las huellas son datos de la voz de cada uno: viven solo en tu base y se borran con el hablante.
 */
import type { Db } from './db.ts'
import { parecido, promediar } from './conciencia/huella.ts'

export const UMBRAL = 0.93
export type Hablante = { id: number; etiqueta: string; entidadId: number | null; nombre: string | null; tramos: number }
export type Turno = { id: number; hablante: Hablante | null; texto: string; inicio: number; fin: number | null; modo: string }

const json = <T>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) : d } catch { return d } }
const deHablante = (r: any): Hablante => ({ id: r.id, etiqueta: r.etiqueta, entidadId: r.entidad_id, nombre: r.nombre ?? null, tramos: r.tramos })
const conNombre = `SELECT h.*, e.nombre FROM voz_hablantes h LEFT JOIN entidades e ON e.id = h.entidad_id`

/** El hablante de una huella: el más parecido si pasa el umbral (y aprende), o uno nuevo. */
export function identificar(db: Db, huella: number[], ahora = Date.now()): { hablante: Hablante; nuevo: boolean; parecido: number } {
  let mejor: { id: number; p: number; huella: number[]; tramos: number } | null = null
  for (const r of db.prepare('SELECT id, huella, tramos FROM voz_hablantes').all() as { id: number; huella: string; tramos: number }[]) {
    const h = json<number[]>(r.huella, [])
    const p = parecido(huella, h)
    if (!mejor || p > mejor.p) mejor = { id: r.id, p, huella: h, tramos: r.tramos }
  }
  if (mejor && mejor.p >= UMBRAL) {
    db.prepare('UPDATE voz_hablantes SET huella = ?, tramos = tramos + 1, actualizado_en = ? WHERE id = ?').run(JSON.stringify(promediar(mejor.huella, Math.min(mejor.tramos, 30), huella)), ahora, mejor.id)
    return { hablante: deHablante(db.prepare(`${conNombre} WHERE h.id = ?`).get(mejor.id)), nuevo: false, parecido: mejor.p }
  }
  const n = (db.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM voz_hablantes').get() as { n: number }).n
  const id = Number(db.prepare('INSERT INTO voz_hablantes (numero, etiqueta, huella, tramos, creado_en, actualizado_en) VALUES (?, ?, ?, 1, ?, ?)').run(n, `Hablante ${n}`, JSON.stringify(huella), ahora, ahora).lastInsertRowid)
  return { hablante: deHablante(db.prepare(`${conNombre} WHERE h.id = ?`).get(id)), nuevo: true, parecido: mejor?.p ?? 0 }
}

export function anotarTurno(db: Db, t: { dispositivoId: number; hablanteId: number | null; texto: string; inicio: number; fin?: number | null; modo: string }, ahora = Date.now()): number {
  return Number(db.prepare('INSERT INTO voz_turnos (dispositivo_id, hablante_id, texto, inicio, fin, modo, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(t.dispositivoId, t.hablanteId, t.texto, t.inicio, t.fin ?? null, t.modo, ahora).lastInsertRowid)
}

/** Lo último que se dijo (para la lista de la app), del más viejo al más nuevo. */
export function ultimosTurnos(db: Db, o: { desde?: number; limite?: number } = {}): Turno[] {
  return (db.prepare(`SELECT t.*, h.id AS h_id, h.etiqueta, h.entidad_id, h.tramos, e.nombre FROM voz_turnos t LEFT JOIN voz_hablantes h ON h.id = t.hablante_id LEFT JOIN entidades e ON e.id = h.entidad_id
    WHERE t.inicio >= ? ORDER BY t.inicio DESC LIMIT ?`).all(o.desde ?? 0, o.limite ?? 80) as any[]).reverse()
    .map((r) => ({ id: r.id, texto: r.texto, inicio: r.inicio, fin: r.fin, modo: r.modo, hablante: r.h_id ? deHablante({ id: r.h_id, etiqueta: r.etiqueta, entidad_id: r.entidad_id, nombre: r.nombre, tramos: r.tramos }) : null }))
}

export const listarHablantes = (db: Db): Hablante[] => (db.prepare(`${conNombre} ORDER BY h.numero`).all() as any[]).map(deHablante)

/** Ponerle nombre a un hablante: vincularlo a una entidad (persona o vos). Si esa entidad ya tenía otro hablante, se juntan. */
export function vincularHablante(db: Db, id: number, entidadId: number | null, ahora = Date.now()): Hablante {
  const h = db.prepare('SELECT * FROM voz_hablantes WHERE id = ?').get(id) as any
  if (!h) throw new Error('Ese hablante no existe')
  if (entidadId != null && !db.prepare('SELECT 1 FROM entidades WHERE id = ?').get(entidadId)) throw new Error('Esa entidad no existe')
  const otro = entidadId != null ? db.prepare('SELECT * FROM voz_hablantes WHERE entidad_id = ? AND id != ?').get(entidadId, id) as any : null
  if (otro) {
    // La misma persona tenía otro hablante: se juntan (las huellas se promedian, los turnos pasan a este).
    const huella = promediar(json<number[]>(otro.huella, []), otro.tramos, json<number[]>(h.huella, []))
    db.prepare('UPDATE voz_turnos SET hablante_id = ? WHERE hablante_id = ?').run(id, otro.id)
    db.prepare('UPDATE voz_hablantes SET huella = ?, tramos = tramos + ? WHERE id = ?').run(JSON.stringify(huella), otro.tramos, id)
    db.prepare('DELETE FROM voz_hablantes WHERE id = ?').run(otro.id)
  }
  db.prepare('UPDATE voz_hablantes SET entidad_id = ?, actualizado_en = ? WHERE id = ?').run(entidadId, ahora, id)
  return deHablante(db.prepare(`${conNombre} WHERE h.id = ?`).get(id))
}

/** Olvidar un hablante: se borra su huella; sus turnos quedan sin hablante. */
export function olvidarHablante(db: Db, id: number) {
  db.prepare('UPDATE voz_turnos SET hablante_id = NULL WHERE hablante_id = ?').run(id)
  if (!db.prepare('DELETE FROM voz_hablantes WHERE id = ?').run(id).changes) throw new Error('Ese hablante no existe')
}

/** Personas para vincular (de tus entidades), por nombre o alias. */
export function buscarPersonas(db: Db, q: string): { id: number; nombre: string; tipo: string }[] {
  const x = `%${q.trim()}%`
  return db.prepare(`SELECT id, nombre, tipo FROM entidades WHERE tipo IN ('persona', 'agrupacion') AND (nombre LIKE ? OR alias LIKE ?) ORDER BY (SELECT COUNT(*) FROM corpus_entidades ce WHERE ce.entidad_id = entidades.id) DESC LIMIT 15`).all(x, x) as any[]
}
