/**
 * El espacio de un proyecto: todo lo que Deprocast sabe de él en un lugar (con quién y qué aparece, lo que dice el
 * corpus, su historia del archivo, las misiones, los agentes que trabajan para él, los cuadernos y la plata). Y el
 * sandbox: Mastropiero lee el espacio y propone los agentes que faltan y encargos listos; él aprueba cada uno.
 * El proyecto de la liga (con su gerente) y la entidad tipo proyecto se vinculan por nombre.
 */
import type { Db } from './db.ts'
import { coocurrencias, leerEntidad, listarEntidades } from './entidades.ts'
import { listarPiezas } from './corpus.ts'
import { listarMisiones } from './misiones.ts'
import { listar } from './roster.ts'
import { ayudantesDe } from './ayudantes.ts'
import { listarCuadernos } from './cuadernos.ts'
import { listarMovimientos } from './finanzas.ts'
import { listarOportunidades } from './radar.ts'
import { CLASES, CLASE_IDS } from './clases.ts'
import { pedirJson } from './modelo.ts'
import { crearProyecto } from './mastropiero.ts'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** Vincula los proyectos de la liga con su entidad (por nombre o alias). Idempotente. */
export function vincularProyectos(db: Db): number {
  const proyectos = db.prepare('SELECT id, nombre FROM proyectos WHERE entidad_id IS NULL').all() as { id: string; nombre: string }[]
  if (!proyectos.length) return 0
  const ents = listarEntidades(db, { tipo: 'proyecto', limite: 1000 })
  let n = 0
  for (const p of proyectos) {
    const e = ents.find((x) => [x.nombre, ...x.alias].some((a) => norm(a) === norm(p.nombre)))
    if (e) { db.prepare('UPDATE proyectos SET entidad_id = ? WHERE id = ?').run(e.id, p.id); n++ }
  }
  return n
}

/** El proyecto por nombre (o alias) o por id de entidad. */
export function proyectoPorNombre(db: Db, q: string | number): number | null {
  if (typeof q === 'number' || /^\d+$/.test(String(q))) return leerEntidad(db, Number(q))?.id ?? null
  const k = norm(String(q))
  return listarEntidades(db, { tipo: 'proyecto', limite: 1000 }).find((e) => [e.nombre, ...e.alias].some((a) => norm(a) === k))?.id
    ?? listarEntidades(db, { tipo: 'proyecto', q: String(q), limite: 1 })[0]?.id ?? null
}

export function espacioDeProyecto(db: Db, entidadId: number) {
  const e = leerEntidad(db, entidadId)
  if (!e) throw new Error(`No existe la entidad ${entidadId}`)
  vincularProyectos(db)
  const liga = db.prepare('SELECT id, nombre FROM proyectos WHERE entidad_id = ?').get(entidadId) as { id: string; nombre: string } | undefined
  const misiones = listarMisiones(db, { entidadId, abiertas: true, limite: 60 })
  const primarias = misiones.filter((m) => m.nivel === 'primaria')
  const agentes = liga ? listar(db, { proyectoId: liga.id }) : []
  const ayudantes = primarias.flatMap((m) => ayudantesDe(db, m.id).map((a) => ({ primaria: m.titulo, agente: a.agente ? `${a.agente.id} ${a.agente.nombre ?? ''}`.trim() : null })))
  const { piezas, total } = listarPiezas(db, { entidad: entidadId, limite: 15 })
  const historia = db.prepare(`SELECT id, titulo, contenido, fecha FROM corpus WHERE fuente = 'takeout-historia' AND id IN (SELECT pieza_id FROM corpus_entidades WHERE entidad_id = ?) ORDER BY id DESC LIMIT 1`).get(entidadId) as { id: number; titulo: string; contenido: string; fecha: string } | undefined
  const nombres = [e.nombre, ...e.alias].map(norm)
  const cuadernos = listarCuadernos(db).filter((c) => nombres.some((n) => n && norm(c.titulo).includes(n))).map((c) => ({ id: c.id, titulo: c.titulo, fuentes: c.fuentes.length, notas: c.notas }))
  const plata = listarMovimientos(db, { limite: 5000 }).filter((m) => m.entidadId === entidadId)
  const oportunidades = listarOportunidades(db, { limite: 200 }).filter((o) => o.entidadId === entidadId && o.estado !== 'descartada')
  return {
    entidad: { id: e.id, nombre: e.nombre, alias: e.alias, notas: e.notas },
    liga: liga ? { id: liga.id, nombre: liga.nombre } : null,
    relacionadas: coocurrencias(db, entidadId, 10).map((x) => ({ id: x.id, nombre: x.nombre, tipo: x.tipo, compartidas: x.compartidas })),
    corpus: { total, recientes: piezas.map((p) => ({ id: p.id, titulo: p.titulo, nivel: p.nivel, fecha: p.fecha })) },
    historia: historia ? { id: historia.id, titulo: historia.titulo, fecha: historia.fecha, texto: historia.contenido.slice(0, 4000) } : null,
    misiones: misiones.map((m) => ({ id: m.id, nivel: m.nivel, titulo: m.titulo, estado: m.estado })),
    agentes: agentes.map((a) => ({ id: a.id, nombre: a.nombre, clase: a.clase, estado: a.estado })),
    ayudantes,
    cuadernos,
    plata: { movimientos: plata.length, entro: plata.filter((m) => m.monto > 0).reduce((s, m) => s + m.monto, 0), salio: -plata.filter((m) => m.monto < 0).reduce((s, m) => s + m.monto, 0) },
    oportunidades: oportunidades.map((o) => ({ id: o.id, titulo: o.titulo, estado: o.estado })),
  }
}

const SISTEMA_SANDBOX = `Sos Mastropiero y armás el sandbox de un proyecto del operador: el equipo de agentes de tu liga que trabaja para ese proyecto y los primeros encargos. Leés todo lo que Deprocast sabe del proyecto (su historia, las misiones abiertas, lo que dice el corpus, los agentes que ya tiene).
Clases de agente disponibles: ${CLASE_IDS.map((c) => `${c} (${CLASES[c].produce})`).join('; ')}.
Devolvé:
- "resumen": en 2 o 3 frases, en qué está el proyecto según lo que leíste y qué le falta para moverse (sin inventar: si algo no está, decilo).
- "agentes": los que faltan (no repitas los que ya tiene): [{"clase": una de las clases, "instrucciones": qué hace para ESTE proyecto, concreto (2 o 3 frases), "por_que": una frase}] (0 a 3).
- "encargos": encargos listos para publicar en el bus: [{"clase": la clase que lo toma, "texto": el encargo concreto, con lo que necesita saber, "por_que": una frase}] (3 a 5).
Forma: {"resumen": string, "agentes": [...], "encargos": [...]}`

let modelo = async (db: Db, usuario: string) => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'sandbox' }, SISTEMA_SANDBOX, usuario, { temperatura: 0.4, maxTokens: 3000, largo: true })).datos
export function _probarSandbox(f: typeof modelo) {
  modelo = f
}

type Propuesto = { clase: string; porQue: string }

/** Propone el sandbox (no forja ni publica nada: eso lo aprueba él). Si el proyecto no está en la liga, lo crea con su gerente. */
export type Sandbox = { proyecto: { id: string; nombre: string }; resumen: string; agentes: (Propuesto & { instrucciones: string })[]; encargos: (Propuesto & { texto: string })[] }

export async function armarSandbox(db: Db, entidadId: number): Promise<Sandbox> {
  let esp = espacioDeProyecto(db, entidadId)
  if (!esp.liga) {
    const r = crearProyecto(db, esp.entidad.nombre)
    db.prepare('UPDATE proyectos SET entidad_id = ? WHERE id = ?').run(entidadId, r.id)
    esp = espacioDeProyecto(db, entidadId)
  }
  const d = await modelo(db, `Proyecto: ${esp.entidad.nombre}${esp.entidad.notas ? ` — ${esp.entidad.notas}` : ''}
Su historia del archivo: ${esp.historia?.texto ?? '(no hay)'}
Misiones abiertas: ${esp.misiones.map((m) => `[${m.nivel}] ${m.titulo} (${m.estado})`).join('; ') || 'ninguna'}
Lo último en el corpus: ${esp.corpus.recientes.map((p) => `${p.fecha ?? ''} ${p.titulo}`).join('; ') || 'nada'}
Aparece con: ${esp.relacionadas.map((x) => x.nombre).join(', ') || 'nadie'}
Agentes que ya tiene: ${esp.agentes.map((a) => `${a.id} (${a.clase})`).join(', ') || 'solo el gerente'}`)
  const clase = (c: unknown) => (CLASE_IDS.includes(String(c) as never) ? String(c) : null)
  return {
    proyecto: esp.liga!,
    resumen: String(d?.resumen ?? '').trim(),
    agentes: (Array.isArray(d?.agentes) ? d.agentes : []).filter((a: any) => clase(a?.clase) && String(a?.instrucciones ?? '').trim()).slice(0, 3)
      .map((a: any): Propuesto & { instrucciones: string } => ({ clase: clase(a.clase)!, instrucciones: String(a.instrucciones).trim().slice(0, 800), porQue: String(a.por_que ?? '').trim().slice(0, 300) })),
    encargos: (Array.isArray(d?.encargos) ? d.encargos : []).filter((x: any) => clase(x?.clase) && String(x?.texto ?? '').trim()).slice(0, 5)
      .map((x: any): Propuesto & { texto: string } => ({ clase: clase(x.clase)!, texto: String(x.texto).trim().slice(0, 1500), porQue: String(x.por_que ?? '').trim().slice(0, 300) })),
  }
}
