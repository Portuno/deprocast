/**
 * Deshacer lo que hizo Mastropiero desde el chat. Cada herramienta que escribe algo reversible devuelve, junto a su
 * resultado, cómo volverlo atrás (`_deshacer`): eso se guarda con el mensaje de la herramienta y no llega al modelo.
 * Lo que no tiene vuelta (un tick corrido, un encargo publicado) no lo devuelve, y entonces no hay botón.
 */
import type { Db } from '../db.ts'

export type Inversa = { tabla: 'salud' | 'movimientos' | 'misiones' | 'memoria'; id: number; previo?: { titulo: string; datos: Record<string, unknown> } | null }

/** Separa del resultado de una herramienta su forma de deshacerse (el modelo no la ve). */
export function separarInversa(resultado: unknown): { resultado: unknown; inversa: Inversa | null } {
  if (!resultado || typeof resultado !== 'object' || Array.isArray(resultado) || !('_deshacer' in resultado)) return { resultado, inversa: null }
  const { _deshacer, ...resto } = resultado as Record<string, unknown>
  return { resultado: resto, inversa: (_deshacer as Inversa | null) ?? null }
}

function aplicar(db: Db, x: Inversa) {
  if (x.tabla === 'salud') {
    if (x.previo) db.prepare('UPDATE salud SET titulo = ?, datos = ? WHERE id = ?').run(x.previo.titulo, JSON.stringify(x.previo.datos), x.id)
    else db.prepare('DELETE FROM salud WHERE id = ?').run(x.id)
  } else if (x.tabla === 'movimientos') db.prepare('DELETE FROM movimientos WHERE id = ?').run(x.id)
  else if (x.tabla === 'misiones') {
    // Una misión recién creada se borra; si algo ya cuelga de ella, queda descartada.
    try { db.prepare('DELETE FROM misiones WHERE id = ?').run(x.id) } catch { db.prepare(`UPDATE misiones SET estado = 'descartada' WHERE id = ?`).run(x.id) }
  } else if (x.tabla === 'memoria') db.prepare(`UPDATE memoria SET estado = 'archivada' WHERE id = ?`).run(x.id)
}

/** Deshace las acciones de esos mensajes de herramienta. Deja una línea en la charla para que Mastropiero lo sepa. */
export function deshacerAcciones(db: Db, ids: number[], ahora = Date.now()): { deshechas: string[] } {
  const deshechas: string[] = []
  let cid: number | null = null
  for (const id of ids) {
    const m = db.prepare(`SELECT id, conversacion_id, resumen, herramienta, deshacer, deshecho_en FROM mensajes WHERE id = ? AND rol = 'herramienta'`).get(id) as any
    if (!m) throw new Error(`No existe la acción ${id}`)
    if (m.deshecho_en) continue
    if (!m.deshacer) throw new Error(`«${m.resumen ?? m.herramienta}» no se puede deshacer`)
    aplicar(db, JSON.parse(m.deshacer))
    db.prepare('UPDATE mensajes SET deshecho_en = ? WHERE id = ?').run(ahora, id)
    deshechas.push(m.resumen ?? m.herramienta)
    cid = m.conversacion_id
  }
  if (cid != null && deshechas.length) {
    db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'evento', ?, ?)`).run(cid, `↶ Deshecho: ${deshechas.join(' · ')}`, ahora)
  }
  return { deshechas }
}

/** Las acciones del último turno con acciones reversibles todavía sin deshacer, en esa conversación. */
export function ultimasDeshacibles(db: Db, cid: number): { id: number; resumen: string }[] {
  const filas = db.prepare(`SELECT id, rol, resumen, herramienta, deshacer, deshecho_en FROM mensajes WHERE conversacion_id = ? ORDER BY id DESC LIMIT 200`).all(cid) as any[]
  const out: { id: number; resumen: string }[] = []
  for (const m of filas) {
    if (m.rol === 'operador') { if (out.length) break; continue }
    if (m.rol === 'herramienta' && m.deshacer && !m.deshecho_en) out.push({ id: m.id, resumen: m.resumen ?? m.herramienta })
  }
  return out.reverse()
}
