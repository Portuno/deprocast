/**
 * Para delegar (plan v38, fase 0): lo que automatiza SU trabajo no es una propuesta para La Fragua (que es para que
 * Deprocast se mejore a sí mismo): es un encargo que Mastropiero puede hacer solo, cada tanto. Acá quedan los encargos
 * sugeridos (del discovery de sus procesos, de sus anotaciones, o movidos desde La Fragua) hasta que él los acepta (se
 * crea el encargo programado) o los descarta.
 */
import type { Db } from './db.ts'

export type EncargoSugerido = { id: number; titulo: string; pedido: string; cuando: string; porQue: string | null; origen: string; estado: string; creado: number }
const DIA = 86_400_000
const deFila = (r: any): EncargoSugerido => ({ id: r.id, titulo: r.titulo, pedido: r.pedido, cuando: r.cuando, porQue: r.por_que, origen: r.origen, estado: r.estado, creado: r.creado })

/** Deja un encargo sugerido (sin repetir uno pendiente, ni uno descartado hace menos de 4 semanas). null si ya estaba. */
export async function sugerirEncargo(db: Db, e: { titulo: string; pedido: string; cuando?: string | null; porQue?: string | null; origen: string }, ahora = Date.now()): Promise<EncargoSugerido | null> {
  const titulo = e.titulo.trim().slice(0, 160)
  const pedido = e.pedido.trim().slice(0, 2000)
  if (!titulo || !pedido) return null
  if (db.prepare(`SELECT 1 FROM encargos_sugeridos WHERE lower(titulo) = lower(?) AND (estado = 'pendiente' OR creado > ?)`).get(titulo, ahora - 28 * DIA)) return null
  // El cuándo tiene que entenderse (si no, el de siempre: los lunes a las 9).
  const { interpretarCuando } = await import('./programados.ts')
  let cuando = String(e.cuando ?? '').trim()
  try { if (!cuando) throw new Error(); interpretarCuando(cuando) } catch { cuando = 'todos los lunes a las 9' }
  const r = db.prepare(`INSERT INTO encargos_sugeridos (titulo, pedido, cuando, por_que, origen, estado, creado) VALUES (?, ?, ?, ?, ?, 'pendiente', ?)`)
    .run(titulo, pedido, cuando, e.porQue?.trim().slice(0, 400) || null, e.origen, ahora)
  return deFila(db.prepare('SELECT * FROM encargos_sugeridos WHERE id = ?').get(Number(r.lastInsertRowid)))
}

export const encargosSugeridos = (db: Db, limite = 12) =>
  (db.prepare(`SELECT * FROM encargos_sugeridos WHERE estado = 'pendiente' ORDER BY id DESC LIMIT ?`).all(limite) as any[]).map(deFila)
export const cuantosSugeridos = (db: Db) => (db.prepare(`SELECT COUNT(*) AS n FROM encargos_sugeridos WHERE estado = 'pendiente'`).get() as { n: number }).n

/** Aceptarlo crea el encargo programado (con el pedido y el cuándo, o los que él cambie); descartarlo lo saca. */
export async function resolverEncargoSugerido(db: Db, id: number, accion: 'aceptar' | 'descartar', cambios: { pedido?: string; cuando?: string } = {}, ahora = Date.now()) {
  const r = db.prepare('SELECT * FROM encargos_sugeridos WHERE id = ?').get(id)
  if (!r) throw new Error(`No existe el encargo sugerido ${id}`)
  const e = deFila(r)
  db.prepare('UPDATE encargos_sugeridos SET estado = ? WHERE id = ?').run(accion === 'aceptar' ? 'aceptado' : 'descartado', id)
  if (accion === 'descartar') return { ok: true }
  return (await import('./programados.ts')).crearProgramado(db, { titulo: e.titulo, pedido: cambios.pedido?.trim() || e.pedido, cuando: cambios.cuando?.trim() || e.cuando }, ahora)
}

/**
 * Una propuesta de La Fragua que no era de Deprocast, a donde corresponde: «encargo» (Para delegar), «idea» (una ficha
 * de idea como side quest) o «proyecto» (una nota en la entidad del proyecto). La propuesta queda «movida», con el rastro.
 */
export async function moverPropuesta(db: Db, id: number, a: 'encargo' | 'idea' | 'proyecto', o: { proyecto?: string | number | null } = {}, ahora = Date.now()) {
  const p = db.prepare('SELECT id, titulo, detalle, estado FROM propuestas WHERE id = ?').get(id) as { id: number; titulo: string; detalle: string | null; estado: string } | undefined
  if (!p) throw new Error(`No existe la propuesta ${id}`)
  if (p.estado !== 'abierta') throw new Error(`La propuesta #${id} ya no está abierta (${p.estado})`)
  const detalle = (p.detalle ?? '').replace(/\n*Es diseño \(salió de tus anotaciones\)[\s\S]*$/, '').trim()
  let destino: string
  if (a === 'encargo') {
    const e = await sugerirEncargo(db, { titulo: p.titulo, pedido: detalle || p.titulo, origen: `fragua:${id}` }, ahora)
    destino = e ? `encargo sugerido #${e.id} (Para delegar)` : 'un encargo sugerido que ya estaba'
  } else {
    const { crearMision } = await import('./misiones.ts')
    const { entidadPorNombre } = await import('./personajes.ts')
    const proyecto = typeof o.proyecto === 'number' ? o.proyecto : o.proyecto ? entidadPorNombre(db, String(o.proyecto)) : null
    if (a === 'proyecto' && !proyecto) throw new Error('¿De qué proyecto? No lo encuentro por ese nombre.')
    if (a === 'proyecto') {
      db.prepare(`UPDATE entidades SET notas = TRIM(COALESCE(notas, '') || char(10) || char(10) || ?) WHERE id = ?`).run(`💡 ${p.titulo}: ${detalle}`.slice(0, 3000), proyecto)
      destino = `una nota del proyecto #${proyecto}`
    } else {
      const m = crearMision(db, { nivel: 'terciaria', titulo: `Idea: ${p.titulo}`.slice(0, 200), detalle: detalle || null, categoria: 'idea', entidadId: proyecto, estado: 'sugerida', creadaPor: 'fragua' }, { por: 'mastropiero', ahora })
      destino = `la idea #${m.id} (side quest sugerida)`
    }
  }
  db.prepare(`UPDATE propuestas SET estado = 'movida', detalle = COALESCE(detalle, '') || ? WHERE id = ?`).run(`\n\n(Movida a ${destino}: no era para La Fragua.)`, id)
  return { ok: true, destino }
}
