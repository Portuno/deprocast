/**
 * Contexto en capas. El agente recibe un esquema chico + acceso de lectura; cuánto se le precarga depende del nivel.
 * Mastropiero es el único que ve todo: no pasa por acá.
 */
import { CLASES } from './clases.ts'
import type { Db } from './db.ts'
import { asientos, especializacion } from './auditor.ts'
import { buscar, leerPieza, type Pieza } from './corpus.ts'
import { listar, nivel, type Ficha } from './roster.ts'
import type { Tarea } from './bus.ts'
import { capa, efectos } from './xp.ts'

export type Contexto = {
  capa: { nivel: number; nombre: string }
  esquema: { clase: string; produce: string; salida: string }
  tarea: { id: number; tipo: string; dominio: string | null; payload: Record<string, unknown> }
  pieza?: Pieza
  memoria?: { tipo: string; payload: unknown; resultado: unknown }[]
  proyecto?: { nombre: string; recientes: { tipo: string; clase: string; estado: string }[] }
  especialidad?: { dominio: string; piezas: { id: number; titulo: string }[] }
  liga?: { roster: { id: string; clase: string; nivel: number; estado: string }[]; auditoria: unknown[] }
  /** Solo auditores: el log es su materia de trabajo, no contexto extra. */
  log?: unknown[]
}

export type Lector = { buscar: (consulta: string) => Pieza[] }

export function construir(db: Db, f: Ficha, t: Tarea): { contexto: Contexto; lector: Lector } {
  const n = nivel(f)
  const c = capa(n)
  const clase = CLASES[f.clase]
  const esp = especializacion(db, f.id)
  const ctx: Contexto = {
    capa: { nivel: c.nivel, nombre: c.nombre },
    esquema: { clase: clase.nombre, produce: clase.produce, salida: clase.salida },
    tarea: { id: t.id, tipo: t.tipo, dominio: t.dominio, payload: t.payload },
  }
  if (t.corpusId != null) ctx.pieza = leerPieza(db, t.corpusId) ?? undefined

  const k = efectos(f.atributos).memoria
  if (n >= 2 && k > 0) {
    ctx.memoria = (db
      .prepare(`SELECT tipo, payload, resultado FROM tareas WHERE asignada_a = ? AND estado = 'hecha' ORDER BY id DESC LIMIT ?`)
      .all(f.id, k) as any[]).map((r) => ({ tipo: r.tipo, payload: JSON.parse(r.payload), resultado: JSON.parse(r.resultado ?? 'null') }))
  }
  if (n >= 3 && t.proyectoId) {
    const p = db.prepare('SELECT nombre FROM proyectos WHERE id = ?').get(t.proyectoId) as { nombre: string } | undefined
    if (p) {
      ctx.proyecto = {
        nombre: p.nombre,
        recientes: db.prepare('SELECT tipo, clase, estado FROM tareas WHERE proyecto_id = ? ORDER BY id DESC LIMIT 12').all(t.proyectoId) as any,
      }
    }
  }
  if (n >= 4 && esp) {
    ctx.especialidad = { dominio: esp, piezas: buscar(db, esp, c.lecturaMax, esp).map((p) => ({ id: p.id, titulo: p.titulo })) }
  }
  if (n >= 6) {
    ctx.liga = {
      roster: listar(db).map((x) => ({ id: x.id, clase: x.clase, nivel: nivel(x), estado: x.estado })),
      auditoria: asientos(db, { limite: 12 }),
    }
  }
  if (f.clase === 'auditor') {
    const objetivo = typeof t.payload.agenteId === 'string' ? t.payload.agenteId : undefined
    ctx.log = asientos(db, { agenteId: objetivo, limite: 30 }).map((a) => ({
      agente: a.agenteId, tarea: a.tareaId, ok: a.ok, dominio: a.dominio, decision: a.decision,
    }))
  }
  const lector: Lector = { buscar: (q) => buscar(db, q, c.lecturaMax, esp ?? t.dominio) }
  return { contexto: ctx, lector }
}
