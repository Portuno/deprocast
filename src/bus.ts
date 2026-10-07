/**
 * EL BUS: una sola tabla de tareas. Todo agente lee y escribe acá; nadie llama a nadie.
 */
import type { ClaseId } from './clases.ts'
import { esClase } from './clases.ts'
import { json, type Db } from './db.ts'

/** `en_espera`: fuera del reparto hasta que el operador la reanude (la ingesta masiva, por ejemplo). */
export type EstadoTarea = 'pendiente' | 'asignada' | 'hecha' | 'fallida' | 'en_espera'

export type Tarea = {
  id: number
  tipo: string
  clase: ClaseId
  proyectoId: string | null
  dominio: string | null
  payload: Record<string, unknown>
  estado: EstadoTarea
  asignadaA: string | null
  asignadaPor: string | null
  publicadaPor: string
  pipeline: string | null
  etapa: number | null
  corpusId: number | null
  intentos: number
  resultado: Record<string, unknown> | null
  error: string | null
  creadaEn: number
}

export type NuevaTarea = {
  clase: string
  tipo?: string
  payload: Record<string, unknown>
  publicadaPor: string
  proyectoId?: string | null
  dominio?: string | null
  pipeline?: string | null
  etapa?: number | null
  corpusId?: number | null
}

function deFila(r: any): Tarea {
  return {
    id: r.id,
    tipo: r.tipo,
    clase: r.clase,
    proyectoId: r.proyecto_id,
    dominio: r.dominio,
    payload: json(r.payload, {}),
    estado: r.estado,
    asignadaA: r.asignada_a,
    asignadaPor: r.asignada_por,
    publicadaPor: r.publicada_por,
    pipeline: r.pipeline,
    etapa: r.etapa,
    corpusId: r.corpus_id,
    intentos: r.intentos,
    resultado: json(r.resultado, null),
    error: r.error,
    creadaEn: r.creada_en,
  }
}

export function publicar(db: Db, t: NuevaTarea, ahora = Date.now()): Tarea {
  if (t.clase === 'omnivoro') throw new Error('Nadie le asigna tareas a Mastropiero: Mastropiero las reparte')
  if (!esClase(t.clase)) throw new Error(`Clase desconocida: ${t.clase}`)
  const r = db
    .prepare(
      `INSERT INTO tareas (tipo, clase, proyecto_id, dominio, payload, estado, publicada_por, pipeline, etapa, corpus_id, creada_en, actualizada_en)
       VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.tipo ?? t.clase, t.clase, t.proyectoId ?? null, t.dominio ?? null, JSON.stringify(t.payload),
      t.publicadaPor, t.pipeline ?? null, t.etapa ?? null, t.corpusId ?? null, ahora, ahora,
    )
  return leerTarea(db, Number(r.lastInsertRowid))!
}

export function leerTarea(db: Db, id: number): Tarea | null {
  const r = db.prepare('SELECT * FROM tareas WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

export function tareas(db: Db, estado?: EstadoTarea, limite = 50): Tarea[] {
  const rows = estado
    ? db.prepare('SELECT * FROM tareas WHERE estado = ? ORDER BY id LIMIT ?').all(estado, limite)
    : db.prepare('SELECT * FROM tareas ORDER BY id DESC LIMIT ?').all(limite)
  return rows.map(deFila)
}

/**
 * Pone en espera la ingesta que no arrancó o quedó asignada sin correr: deja de repartirse y de gastar.
 * Las piezas siguen en el corpus y se buscan igual; solo se frena el destilado.
 */
export function pausarIngesta(db: Db, ahora = Date.now()): number {
  return Number(db.prepare(
    `UPDATE tareas SET estado = 'en_espera', asignada_a = NULL, actualizada_en = ? WHERE pipeline = 'ingesta' AND estado IN ('pendiente', 'asignada')`,
  ).run(ahora).changes)
}

/**
 * Devuelve al reparto hasta `limite` encargos en espera. Con `soloPropias`, primero lo de su voz y lo más pesado
 * (nivel propia, por peso); el resto sigue esperando.
 */
export function reanudarIngesta(db: Db, o: { limite?: number; soloPropias?: boolean } = {}, ahora = Date.now()): number {
  const ids = (db.prepare(
    `SELECT t.id FROM tareas t LEFT JOIN corpus c ON c.id = t.corpus_id
     WHERE t.estado = 'en_espera' ${o.soloPropias ? `AND c.nivel = 'propia'` : ''}
     ORDER BY (c.nivel = 'propia') DESC, COALESCE(c.peso, 0) DESC, t.id LIMIT ?`,
  ).all(o.limite ?? 1_000_000) as { id: number }[]).map((r) => r.id)
  const upd = db.prepare(`UPDATE tareas SET estado = 'pendiente', actualizada_en = ? WHERE id = ?`)
  for (const id of ids) upd.run(ahora, id)
  return ids.length
}

export function enEspera(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM tareas WHERE estado = 'en_espera'`).get() as { n: number }).n
}

export function asignar(db: Db, tareaId: number, agenteId: string, por: string, ahora = Date.now()) {
  const r = db
    .prepare(`UPDATE tareas SET estado = 'asignada', asignada_a = ?, asignada_por = ?, actualizada_en = ? WHERE id = ? AND estado = 'pendiente'`)
    .run(agenteId, por, ahora, tareaId)
  return r.changes === 1
}

export function asignadasA(db: Db, agenteId: string, limite: number): Tarea[] {
  return db
    .prepare(`SELECT * FROM tareas WHERE asignada_a = ? AND estado = 'asignada' ORDER BY id LIMIT ?`)
    .all(agenteId, limite)
    .map(deFila)
}

export function cerrarOk(db: Db, id: number, resultado: unknown, ahora = Date.now()) {
  db.prepare(`UPDATE tareas SET estado = 'hecha', resultado = ?, error = NULL, intentos = intentos + 1, actualizada_en = ? WHERE id = ?`)
    .run(JSON.stringify(resultado), ahora, id)
}

/** Si quedan reintentos vuelve al bus como pendiente (otro agente puede tomarla); si no, fallida. */
export function cerrarFallo(db: Db, id: number, error: string, reintentar: boolean, ahora = Date.now()) {
  db.prepare(
    `UPDATE tareas SET estado = ?, asignada_a = CASE WHEN ? THEN NULL ELSE asignada_a END,
       error = ?, intentos = intentos + 1, actualizada_en = ? WHERE id = ?`,
  ).run(reintentar ? 'pendiente' : 'fallida', reintentar ? 1 : 0, error, ahora, id)
}
