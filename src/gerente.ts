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
/** Lo que no cambia durante un reparto: se calcula una vez por tick y no una vez por tarea (con cientos de pendientes, eran miles de consultas seguidas que trababan el servidor). */
export type CacheReparto = { enMision: Set<string>; porClase: Map<string, Ficha[]>; esp: Map<string, string | null> }
export function cacheReparto(db: Db): CacheReparto {
  return { enMision: new Set((db.prepare(`SELECT agente_id FROM agente_misiones WHERE estado IN ('activa', 'pausada')`).all() as { agente_id: string }[]).map((r) => r.agente_id)), porClase: new Map(), esp: new Map() }
}

export function elegir(db: Db, t: Tarea, carga: Map<string, number>, cache: CacheReparto = cacheReparto(db)): { agente: Ficha; razon: string } | null {
  // Los que tienen una misión viva están dedicados a ella (plan v26): el bus no los toma.
  if (!cache.porClase.has(t.clase)) cache.porClase.set(t.clase, listar(db, { clase: t.clase }))
  const candidatos = cache.porClase.get(t.clase)!.filter(
    (f) => f.estado !== 'banca' && !cache.enMision.has(f.id) && (f.proyectoId == null || f.proyectoId === t.proyectoId),
  )
  let mejor: { agente: Ficha; score: number; razon: string[] } | null = null
  for (const f of candidatos) {
    const razon = [`nv${nivel(f)}`]
    let score = nivel(f) * 2
    if (!cache.esp.has(f.id)) cache.esp.set(f.id, especializacion(db, f.id))
    const esp = cache.esp.get(f.id)
    if (esp && esp === t.dominio) (score += 3), razon.push(`especialista en ${esp}`)
    if (t.proyectoId && f.proyectoId === t.proyectoId) (score += 2), razon.push('de la casa')
    if (f.estado === 'prueba') (score += 4), razon.push('en prueba')
    const c = carga.get(f.id) ?? 0
    if (c) (score -= c * 3), razon.push(`carga ${c}`)
    if (!mejor || score > mejor.score) mejor = { agente: f, score, razon }
  }
  return mejor ? { agente: mejor.agente, razon: mejor.razon.join(', ') } : null
}
