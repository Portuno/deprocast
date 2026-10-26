/**
 * El embudo de las pistas (plan v26), en liviano: lo que leen la bandeja 📥, la economía y la pantalla sin cargar el
 * motor de los agentes. Una pista es una oportunidad del Radar con misión y etapa:
 * encontrada → borrador → enviada → respondió → reunión → cliente (o descartada).
 */
import { json, type Db } from '../db.ts'

export const ETAPAS = ['encontrada', 'borrador', 'enviada', 'respondio', 'reunion', 'cliente', 'descartada'] as const
export type Etapa = (typeof ETAPAS)[number]
export const NOMBRE_ETAPA: Record<Etapa, string> = { encontrada: 'Encontrada', borrador: 'Borrador listo', enviada: 'Enviada', respondio: 'Respondió', reunion: 'Reunión', cliente: 'Cliente', descartada: 'Descartada' }

export type Contacto = { organizacion: string; canal: string; url: string | null }
export type Pista = {
  id: number; misionId: number; titulo: string; url: string | null; tipo: string; descripcion: string | null; porQue: string | null; lugar: string | null
  etapa: Etapa; contacto: Contacto; borrador: string | null; notas: string | null; creadaEn: number; actualizadaEn: number
}
const deFila = (r: any): Pista => ({
  id: r.id, misionId: r.agente_mision_id, titulo: r.titulo, url: r.url, tipo: r.tipo, descripcion: r.descripcion, porQue: r.por_que, lugar: r.lugar,
  etapa: r.etapa ?? 'encontrada', contacto: json<Contacto>(r.contacto, { organizacion: r.titulo, canal: 'web', url: null }), borrador: r.borrador, notas: r.notas, creadaEn: r.creada_en, actualizadaEn: r.actualizada_en,
})
export const leerPista = (db: Db, id: number): Pista | null => { const r = db.prepare('SELECT * FROM oportunidades WHERE id = ? AND agente_mision_id IS NOT NULL').get(id); return r ? deFila(r) : null }
export const pistasDe = (db: Db, f: { misionId?: number; etapas?: Etapa[] } = {}): Pista[] => (db.prepare(`SELECT * FROM oportunidades WHERE agente_mision_id IS NOT NULL${f.misionId ? ' AND agente_mision_id = ?' : ''} ORDER BY actualizada_en DESC LIMIT 500`).all(...(f.misionId ? [f.misionId] : [])) as any[])
  .map(deFila).filter((p) => !f.etapas || f.etapas.includes(p.etapa))

/** Cuántas hay en cada etapa. */
export function embudo(db: Db, misionId: number): Record<Etapa, number> {
  const e = Object.fromEntries(ETAPAS.map((x) => [x, 0])) as Record<Etapa, number>
  for (const p of pistasDe(db, { misionId })) e[p.etapa]++
  return e
}

/** El progreso contra el criterio: clientes; reuniones (o más); respuestas (o más); pistas vivas. */
export function progreso(db: Db, m: { id: number; criterio: { metrica: string; meta: number } }): { logrado: number; meta: number } {
  const e = embudo(db, m.id)
  const logrado = m.criterio.metrica === 'reuniones' ? e.reunion + e.cliente
    : m.criterio.metrica === 'respuestas' ? e.respondio + e.reunion + e.cliente
      : m.criterio.metrica === 'pistas' ? ETAPAS.filter((x) => x !== 'descartada').reduce((s, x) => s + e[x], 0)
        : e.cliente
  return { logrado, meta: m.criterio.meta }
}

const quien = (db: Db, misionId: number) => db.prepare('SELECT a.id, a.nombre, m.entidad_id FROM agente_misiones m JOIN agentes a ON a.id = m.agente_id WHERE m.id = ?').get(misionId) as { id: string; nombre: string | null; entidad_id: number | null } | undefined

/** Para 📥: los borradores que esperan su ok, con quién los escribió. */
export function borradoresEsperando(db: Db): { id: number; texto: string; sub: string }[] {
  return pistasDe(db, { etapas: ['borrador'] }).map((p) => {
    const a = quien(db, p.misionId)
    return { id: p.id, texto: `${a ? `${a.nombre ?? a.id} · ` : ''}${p.contacto.organizacion || p.titulo} (${p.contacto.canal})`, sub: p.borrador ?? '' }
  })
}

/**
 * Un ingreso del proyecto de una misión que entró después de mandar algo: ¿es de esa pista? (en 📥, uno por
 * movimiento; lo que él responde no vuelve a preguntarse).
 */
export function ingresosPorConfirmar(db: Db): { id: string; texto: string; sub: string }[] {
  const out: { id: string; texto: string; sub: string }[] = []
  const vistos = new Set((db.prepare(`SELECT ref FROM decisiones WHERE tipo = 'agente:cliente'`).all() as { ref: string }[]).map((r) => r.ref.split(':')[0]))
  const ps = pistasDe(db, { etapas: ['enviada', 'respondio', 'reunion'] }).map((p) => ({ p, entidad: quien(db, p.misionId)?.entidad_id ?? null })).filter((x) => x.entidad != null)
  if (!ps.length) return out
  const orden: Record<string, number> = { reunion: 0, respondio: 1, enviada: 2 }
  for (const m of db.prepare(`SELECT id, fecha, monto, moneda, descripcion, entidad_id, creado_en FROM movimientos WHERE monto > 0 AND entidad_id IS NOT NULL ORDER BY id DESC LIMIT 60`).all() as any[]) {
    if (vistos.has(String(m.id))) continue
    const p = ps.filter((x) => x.entidad === m.entidad_id && x.p.actualizadaEn <= m.creado_en).map((x) => x.p).sort((a, b) => orden[a.etapa] - orden[b.etapa] || b.actualizadaEn - a.actualizadaEn)[0]
    if (p) out.push({ id: `${m.id}:${p.id}`, texto: `Ingreso de ${m.monto} ${m.moneda} (${m.descripcion || m.fecha}): ¿es de «${p.contacto.organizacion || p.titulo}»?`, sub: `La pista está en «${NOMBRE_ETAPA[p.etapa]}».` })
  }
  return out.slice(0, 8)
}
