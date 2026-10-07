/**
 * EL BUS: una sola tabla de tareas. Todo agente lee y escribe acá; nadie llama a nadie.
 */
import type { ClaseId } from './clases.ts'
import { esClase } from './clases.ts'
import { json, type Db } from './db.ts'

export type EstadoTarea = 'pendiente' | 'asignada' | 'hecha' | 'fallida'

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
