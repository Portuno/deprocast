/**
 * Contacto con criterio (plan v38, fase 4). Tres reglas sobre las pistas de los agentes, que siguen siendo solo
 * borradores (nada se manda solo):
 * - #171 Apertura con motivo real: un borrador tiene que citar una señal pública y verificable del destinatario (algo que
 *   publicó o hizo, con el link de donde salió en esa sesión). Sin señal no hay mensaje: «sin personalización falsa».
 * - #173 Contexto previo: solo pasa a borrador quien ya tuvo contacto con él o con su trabajo (lo conoce: está en sus
 *   Personas o en su archivo; o él anotó el contexto). Lo demás queda en «Calentar primero». Y un tope de borradores por
 *   semana: «sin volumen sin criterio».
 * - #172 Tres toques y una llamada: al mandar el primero, quedan dos seguimientos con fecha (+3 y +7 días; el último
 *   propone una llamada). Si responde (o se descarta), los que faltan se cancelan; la llamada se agenda con su ok.
 */
import { ajuste, json, type Db } from '../db.ts'
import { actualizarMision, crearMision } from '../misiones.ts'
import { entidadPorNombre } from '../personajes.ts'
import type { Pista } from './embudo.ts'

const DIA = 86_400_000
export const TOPE_SEMANA = 10
export type Senal = { texto: string; url: string }
export type Toque = { n: number; fecha: string; misionId: number }

/** ¿Hay contexto previo con esta pista? El motivo (para mostrarlo) o null. */
export function contextoPrevio(db: Db, p: Pista & { contextoPrevio?: string | null }): string | null {
  const anotado = (db.prepare('SELECT contexto_previo FROM oportunidades WHERE id = ?').get(p.id) as { contexto_previo: string | null } | undefined)?.contexto_previo
  if (anotado?.trim()) return anotado.trim()
  const id = entidadPorNombre(db, p.contacto.organizacion || p.titulo)
  if (!id) return null
  if (db.prepare('SELECT 1 FROM relaciones WHERE entidad_id = ?').get(id)) return 'Está en tus Personas'
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM corpus_entidades ce JOIN corpus c ON c.id = ce.pieza_id WHERE ce.entidad_id = ? AND c.nivel = 'propia'`).get(id) as { n: number }).n
  return n ? `Aparece en ${n} cosa${n === 1 ? '' : 's'} tuya${n === 1 ? '' : 's'}` : null
}

/** Él anota el contexto («nos conocimos en el evento», «comentó mi post»): la pista sale de «Calentar primero». */
export function anotarContexto(db: Db, id: number, texto: string, ahora = Date.now()) {
  const t = texto.trim().slice(0, 500)
  if (!t) throw new Error('¿Qué contexto hay? (cómo se conocen o qué vio de tu trabajo)')
  db.prepare(`UPDATE oportunidades SET contexto_previo = ?, etapa = CASE WHEN etapa = 'calentar' THEN 'encontrada' ELSE etapa END, actualizada_en = ? WHERE id = ?`).run(t, ahora, id)
  return { ok: true }
}

/** Cuántos borradores se escribieron en los últimos 7 días, y el tope (ajuste pistas_tope_semana). */
export function volumenSemana(db: Db, ahora = Date.now()) {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM oportunidades WHERE borrador_en > ?').get(ahora - 7 * DIA) as { n: number }).n
  return { n, tope: Number(ajuste(db, 'pistas_tope_semana')) || TOPE_SEMANA }
}

/**
 * Lo que el agente tiene que cumplir para dejar un borrador. null si puede; si no, por qué (y la pista pasa a calentar
 * cuando lo que falta es el contexto).
 */
export function puedeRedactar(db: Db, p: Pista, senal: Senal | null, urlsVistas: Set<string>, ahora = Date.now()): string | null {
  const v = volumenSemana(db, ahora)
  if (v.n >= v.tope) return `Ya hay ${v.n} borradores esta semana (el tope es ${v.tope}): sin volumen sin criterio. Elegí mejor las que quedan.`
  if (!senal?.texto?.trim() || !senal.url) return 'Falta la señal: algo concreto y público que esa organización (o su gente) publicó o hizo, con el link de donde lo sacaste. Sin señal real no hay mensaje (sin personalización falsa).'
  const normal = (u: string) => u.trim().replace(/[.,;]+$/, '').replace(/\/+$/, '').replace(/^http:\/\//, 'https://').replace(/#.*$/, '')
  if (![...urlsVistas].map(normal).includes(normal(senal.url))) return 'El link de la señal no salió de tus búsquedas ni lecturas de esta sesión: leelo primero.'
  if (!contextoPrevio(db, p)) {
    db.prepare(`UPDATE oportunidades SET etapa = 'calentar', actualizada_en = ? WHERE id = ?`).run(ahora, p.id)
    return 'Sin contexto previo con él: la pista queda en «Calentar primero» (que primero haya un contacto o vean su trabajo). Él puede anotar el contexto si ya lo hay.'
  }
  return null
}

/** Al mandar el primero: dos seguimientos con fecha, el último propone la llamada. */
export function crearSecuencia(db: Db, p: Pista, ahora = Date.now()): Toque[] {
  const quien = p.contacto.organizacion || p.titulo
  const primero = (p.borrador ?? '').replace(/\s+/g, ' ').slice(0, 280)
  const fecha = (dias: number) => new Date(ahora + dias * DIA).toISOString().slice(0, 10)
  const toques: Toque[] = [
    { n: 2, dias: 3, titulo: `Seguimiento 2/3: ${quien}`, detalle: `Si no respondió: un mensaje corto que aporte algo nuevo (un dato, un ejemplo, algo suyo que viste), nunca «¿viste mi mail?». Lo primero que le mandaste: «${primero}»` },
    { n: 3, dias: 7, titulo: `Seguimiento 3/3: ${quien} (proponer llamada)`, detalle: `Si sigue sin responder: el último toque, proponiendo una llamada corta (15 minutos) con dos horarios concretos. Si tampoco responde, se corta acá.` },
  ].map((t) => ({ n: t.n, fecha: fecha(t.dias), misionId: crearMision(db, { nivel: 'terciaria', titulo: t.titulo.slice(0, 200), detalle: t.detalle, categoria: 'seguimiento', estado: 'activa', vence: fecha(t.dias), disparador: { cuando: fecha(t.dias) }, creadaPor: 'pistas' }, { por: 'mastropiero', ahora }).id }))
  db.prepare('UPDATE oportunidades SET secuencia = ? WHERE id = ?').run(JSON.stringify(toques), p.id)
  return toques
}

/** Respondió o se descartó: los seguimientos que faltan se cancelan. Si respondió, la llamada queda sugerida (con su ok). */
export function cortarSecuencia(db: Db, p: Pista, motivo: 'respondio' | 'descartada' | 'cliente' | 'reunion', ahora = Date.now()) {
  const toques = json<Toque[]>((db.prepare('SELECT secuencia FROM oportunidades WHERE id = ?').get(p.id) as { secuencia: string | null } | undefined)?.secuencia ?? null, []) ?? []
  for (const t of toques) {
    const m = db.prepare('SELECT estado FROM misiones WHERE id = ?').get(t.misionId) as { estado: string } | undefined
    if (m && (m.estado === 'activa' || m.estado === 'sugerida')) actualizarMision(db, t.misionId, { estado: 'descartada' }, { por: 'mastropiero', ahora })
  }
  if (motivo === 'respondio' && toques.length) {
    crearMision(db, { nivel: 'terciaria', titulo: `Agendar la llamada con ${p.contacto.organizacion || p.titulo}`.slice(0, 200), detalle: 'Respondió: proponé dos horarios concretos para una llamada corta.', categoria: 'seguimiento', estado: 'sugerida', creadaPor: 'pistas' }, { por: 'mastropiero', ahora })
  }
  db.prepare('UPDATE oportunidades SET secuencia = NULL WHERE id = ?').run(p.id)
}
