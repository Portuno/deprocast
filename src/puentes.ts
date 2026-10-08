/**
 * Puentes (el Pontífice, 51, y el Diplomático, 50): entre su gente.
 * - «presentar»: dos personas que deberían conocerse, por un proyecto, un interés o un pedido que se cruzan.
 * - «retomar»: alguien a quien hace rato no ve y con quien tiene algo concreto (una excusa real para escribirle).
 * Sale de lo que hay: vínculos y notas que él definió, con qué proyectos aparece cada uno, qué tiene pendiente, sus
 * primarias. Nada se manda solo: le deja la propuesta (y un borrador corto); al marcarla hecha, cuenta como contacto.
 */
import type { Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { coocurrencias } from './entidades.ts'
import { guardarRelacion, personas } from './personas.ts'
import { listarMisiones, principalDe, semanaDe } from './misiones.ts'

export type Puente = { id: number; tipo: 'presentar' | 'retomar'; personas: { id: number; nombre: string }[]; motivo: string; mensaje: string | null; estado: string; creadoEn: number }

function deFila(db: Db, r: any): Puente {
  const ids: number[] = JSON.parse(r.personas)
  return {
    id: r.id, tipo: r.tipo, motivo: r.motivo, mensaje: r.mensaje, estado: r.estado, creadoEn: r.creado_en,
    personas: ids.map((id) => ({ id, nombre: (db.prepare('SELECT nombre FROM entidades WHERE id = ?').get(id) as any)?.nombre ?? `#${id}` })),
  }
}

export const listarPuentes = (db: Db, estado = 'sugerido'): Puente[] =>
  db.prepare('SELECT * FROM puentes WHERE estado = ? ORDER BY id DESC LIMIT 30').all(estado).map((r) => deFila(db, r))

const SISTEMA = `Sos Mastropiero hablando como el Pontífice (el que tiende puentes) y el Diplomático. Le proponés al jugador movidas con su gente.
Forma: {"puentes": [{"tipo": "presentar" | "retomar", "personas": [number], "motivo": string, "mensaje": string}]}
- «presentar»: dos números de la lista (dos personas distintas) que se beneficiarían de conocerse; «motivo» concreto (un proyecto, un interés o una necesidad que se cruzan). «mensaje»: el borrador corto con el que él podría presentarlos.
- «retomar»: un número; alguien a quien hace tiempo no ve y con quien hay algo real (algo pendiente, un proyecto en común, algo que le debe o le prometió). «mensaje»: el primer mensaje que le podría mandar, en su voz, corto.
- Hasta 3 de cada tipo, y solo si hay razones reales en los datos. Nada de «para mantener el contacto» a secas.
- No inventes datos de las personas: usá solo lo que está en la lista. Castellano rioplatense.`

export async function proponerPuentes(db: Db, ahora = Date.now()): Promise<Puente[]> {
  const ps = personas(db, { limite: 200 }, ahora).filter((p) => p.vinculo || p.notas || p.proxima || p.menciones >= 2).slice(0, 45)
  if (ps.length < 2) throw new Error('Todavía conozco muy poca gente tuya: definí algunas personas en Personas')
  const lineas = ps.map((p, i) => {
    const con = coocurrencias(db, p.id, 6).filter((e) => e.tipo !== 'persona').slice(0, 3).map((e) => e.nombre)
    return `${i + 1}. ${p.nombre}${p.vinculo ? ` (${p.vinculo})` : ''}${p.notas ? ` — ${p.notas.slice(0, 120)}` : ''}${con.length ? ` · aparece con: ${con.join(', ')}` : ''}${p.diasSinContacto != null ? ` · último contacto hace ${p.diasSinContacto} días` : ''}${p.proxima ? ` · pendiente: ${p.proxima}` : ''}${p.misiones.length ? ` · le asignó: ${p.misiones.map((m) => m.titulo).join('; ')}` : ''}`
  })
  const principal = principalDe(db, 'jugador')
  const prims = listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] })
  const usuario = [principal ? `Su principal: ${principal.titulo}` : '', prims.length ? `Primarias: ${prims.map((m) => m.titulo).join('; ')}` : '', `Su gente:\n${lineas.join('\n')}`].filter(Boolean).join('\n\n')
  const { datos } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'pontifice' }, SISTEMA, usuario, { temperatura: 0.5, maxTokens: 2000 })
  // No repetir lo pendiente ni lo que descartó hace poco.
  const vistos = new Set((db.prepare(`SELECT clave FROM puentes WHERE estado = 'sugerido' OR creado_en > ?`).all(ahora - 30 * 86_400_000) as any[]).map((r) => r.clave))
  const ins = db.prepare('INSERT INTO puentes (tipo, personas, clave, motivo, mensaje, estado, creado_en) VALUES (?, ?, ?, ?, ?, \'sugerido\', ?)')
  for (const x of Array.isArray(datos.puentes) ? datos.puentes : []) {
    const tipo = x.tipo === 'presentar' ? 'presentar' : x.tipo === 'retomar' ? 'retomar' : null
    const ids = [...new Set((Array.isArray(x.personas) ? x.personas : []).map((n: any) => ps[Number(n) - 1]?.id).filter(Boolean))] as number[]
    if (!tipo || !x.motivo || (tipo === 'presentar' ? ids.length !== 2 : ids.length !== 1)) continue
    const clave = `${tipo}:${[...ids].sort((a, b) => a - b).join('-')}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    ins.run(tipo, JSON.stringify(ids), clave, String(x.motivo).slice(0, 400), x.mensaje ? String(x.mensaje).slice(0, 600) : null, ahora)
  }
  return listarPuentes(db)
}

/** Hecho: cuenta como contacto con las personas del puente. Descartado: no se vuelve a proponer por un mes. */
export function resolverPuente(db: Db, id: number, estado: 'hecho' | 'descartado', ahora = Date.now()): Puente {
  const r = db.prepare('SELECT * FROM puentes WHERE id = ?').get(id) as any
  if (!r) throw new Error(`No existe el puente ${id}`)
  db.prepare('UPDATE puentes SET estado = ?, resuelto_en = ? WHERE id = ?').run(estado, ahora, id)
  if (estado === 'hecho') for (const p of JSON.parse(r.personas) as number[]) { try { guardarRelacion(db, p, { contacto: true }, ahora) } catch { /* ya no es persona */ } }
  return deFila(db, db.prepare('SELECT * FROM puentes WHERE id = ?').get(id))
}
