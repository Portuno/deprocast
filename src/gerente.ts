/**
 * El gerente juega de entrenador: decide quién toma cada tarea de su proyecto.
 * Sin gerente (o sin proyecto) reparte Mastropiero con la misma regla.
 */
import type { Db } from './db.ts'
import type { Tarea } from './bus.ts'
import { especializacion } from './auditor.ts'
import { listar, nivel, type Ficha } from './roster.ts'

export function gerenteDe(db: Db, proyectoId: string | null): Ficha | null {
  if (!proyectoId) return null
  return listar(db, { clase: 'gerente', proyectoId }).find((f) => f.estado !== 'banca') ?? null
}

/**
 * Puntaje de reparto. Los que están en prueba tienen prioridad: un recluta que no corre no se puede evaluar.
 * La carga (tareas ya asignadas en este reparto) penaliza para rotar.
 */
export function elegir(db: Db, t: Tarea, carga: Map<string, number>): { agente: Ficha; razon: string } | null {
  const candidatos = listar(db, { clase: t.clase }).filter(
    (f) => f.estado !== 'banca' && (f.proyectoId == null || f.proyectoId === t.proyectoId),
  )
  let mejor: { agente: Ficha; score: number; razon: string[] } | null = null
  for (const f of candidatos) {
    const razon = [`nv${nivel(f)}`]
    let score = nivel(f) * 2
    const esp = especializacion(db, f.id)
    if (esp && esp === t.dominio) (score += 3), razon.push(`especialista en ${esp}`)
    if (t.proyectoId && f.proyectoId === t.proyectoId) (score += 2), razon.push('de la casa')
    if (f.estado === 'prueba') (score += 4), razon.push('en prueba')
    const c = carga.get(f.id) ?? 0
    if (c) (score -= c * 3), razon.push(`carga ${c}`)
    if (!mejor || score > mejor.score) mejor = { agente: f, score, razon }
  }
  return mejor ? { agente: mejor.agente, razon: mejor.razon.join(', ') } : null
}
