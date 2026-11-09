/**
 * El bautizo con criterio (Fragua #175): en vez de un nombre sin explicación, Mastropiero propone varios candidatos para
 * un agente, cada uno con su puntaje y su motivo, y dice el criterio con el que los comparó. Él elige (o deja el
 * primero). Al bautizar con uno de los propuestos, el resultado dice por qué ganó y contra quiénes.
 */
import { ajuste, fijarAjuste, type Db } from './db.ts'
import { describirCelda } from './geometria72.ts'
import { bautizar, leer, nivel } from './roster.ts'

export type Candidato = { nombre: string; puntaje: number; motivo: string }
export type Propuesta = { criterio: string; candidatos: Candidato[]; en: number }

let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> =>
  (await (await import('./modelo.ts')).pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'bautizo' }, sistema, usuario, { temperatura: 0.9, maxTokens: 1500 })).datos
export function _probarBautizo(f: typeof modelo) { modelo = f }

const SISTEMA = `Proponés nombres para un agente de la liga de Deprocast. Los nombres de la liga son de personaje: un nombre propio con un apodo de oficio («Saturnino, el Modista»), con humor y un guiño a lo que hace.
Proponé 6 candidatos distintos entre sí y elegí con UN criterio explícito (qué pesa más: que se entienda qué hace, que suene bien, que tenga historia).
Forma: {"criterio": "una línea: cómo los comparaste", "candidatos": [{"nombre": "...", "puntaje": 0-10, "motivo": "por qué ese puntaje, en una línea, concreto"}]}`

export async function proponerNombres(db: Db, id: string, ahora = Date.now()): Promise<Propuesta> {
  const f = leer(db, id)
  if (!f) throw new Error(`No existe ${id}`)
  if (f.nombre) throw new Error(`${f.id} ya se llama ${f.nombre}`)
  const usados = new Set((db.prepare('SELECT nombre FROM agentes WHERE nombre IS NOT NULL UNION SELECT nombre FROM lapidas WHERE nombre IS NOT NULL').all() as { nombre: string }[]).map((r) => r.nombre.toLowerCase()))
  const ejemplos = (db.prepare('SELECT nombre FROM agentes WHERE nombre IS NOT NULL ORDER BY rowid DESC LIMIT 12').all() as { nombre: string }[]).map((r) => r.nombre)
  const usuario = [
    `Agente ${f.id}: clase ${f.clase}, nivel ${nivel(f)}, ${f.exitos} éxitos y ${f.fallos} fallos.`,
    f.celda ? `Su celda en la Matriz 72: ${describirCelda(f.celda)}.` : '',
    f.estrategia ? `Lo que aprendió trabajando: ${f.estrategia.slice(0, 500)}` : '',
    f.instrucciones ? `Sus instrucciones: ${f.instrucciones.slice(0, 400)}` : '',
    ejemplos.length ? `Nombres que ya hay en la liga (el estilo; no los repitas): ${ejemplos.join(', ')}` : '',
  ].filter(Boolean).join('\n')
  const d = await modelo(db, SISTEMA, usuario)
  const candidatos = (Array.isArray(d?.candidatos) ? d.candidatos : [])
    .map((c: any) => ({ nombre: String(c?.nombre ?? '').trim().slice(0, 60), puntaje: Math.max(0, Math.min(10, Number(c?.puntaje) || 0)), motivo: String(c?.motivo ?? '').trim().slice(0, 240) }))
    .filter((c: Candidato) => c.nombre && !usados.has(c.nombre.toLowerCase()))
    .sort((a: Candidato, b: Candidato) => b.puntaje - a.puntaje)
  if (!candidatos.length) throw new Error('No salieron candidatos que no estén usados: probá de nuevo.')
  const p: Propuesta = { criterio: String(d?.criterio ?? '').trim().slice(0, 240) || 'Que se entienda qué hace y que suene a personaje.', candidatos, en: ahora }
  fijarAjuste(db, `bautizo:${f.id}`, JSON.stringify(p))
  return p
}

export function propuestaDe(db: Db, id: string): Propuesta | null {
  try { return JSON.parse(ajuste(db, `bautizo:${id}`) ?? 'null') } catch { return null }
}

/** Bautiza; si el nombre era uno de los propuestos, devuelve por qué ganó y contra quiénes. */
export function bautizarConCriterio(db: Db, id: string, nombre: string) {
  bautizar(db, id, nombre)
  const p = propuestaDe(db, id)
  const elegido = p?.candidatos.find((c) => c.nombre.toLowerCase() === nombre.trim().toLowerCase()) ?? null
  const porQue = elegido
    ? `Ganó «${elegido.nombre}» (${elegido.puntaje}/10): ${elegido.motivo}. Criterio: ${p!.criterio}.`
    : p ? `Lo eligió él por fuera de los propuestos (el mejor puntuado era «${p.candidatos[0].nombre}», ${p.candidatos[0].puntaje}/10).` : null
  return { porQue, criterio: p?.criterio ?? null, candidatos: p?.candidatos ?? [] }
}
