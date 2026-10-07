/**
 * Ayudantes: agentes de la liga al servicio de las primarias del jugador. Es el puente entre la liga y su vida.
 * Un ayudante es un agente con una misión primaria propia («Ayudar con X») colgada de la primaria del jugador.
 * Entre runs, cada ayudante deja un aporte (un borrador, próximos pasos, lo que hay en el corpus) que entra como
 * pieza generada y aparece como material en la próxima run. Corre con el mismo contrato, auditoría y XP del bus,
 * y respeta el tope diario de la liga.
 */
import { fechaLocal, json, type Db } from './db.ts'
import { CLASES, type ClaseId } from './clases.ts'
import { buscar, insertar, NIVELES } from './corpus.ts'
import { leerEntidad } from './entidades.ts'
import { encargarYa } from './mastropiero.ts'
import { actualizarMision, crearMision, leerMision, listarMisiones, semanaDe, type Mision } from './misiones.ts'
import { nanConfigurado, topeAlcanzado } from './nan.ts'
import { leerHistoria, personaje } from './personajes.ts'
import { alias, forjar, leer, type Ficha } from './roster.ts'
import { buscarOportunidades, listarOportunidades, type Oportunidad } from './radar.ts'

/** Las clases que hoy sirven de ayudante: escribir (generativo) y buscar en su corpus (buscador). */
export const CLASES_AYUDANTE: ClaseId[] = ['generativo', 'buscador']
/** Los roles que se pueden pedir: los de arriba más el explorador (un generativo que sale a la web). */
export const ROLES_AYUDANTE = ['generativo', 'buscador', 'explorador'] as const
const MARCA_EXPLORADOR = '[explorador web]'
const esExplorador = (f: Ficha) => f.instrucciones.includes(MARCA_EXPLORADOR)

const ROL: Record<string, (titulo: string) => string> = {
  generativo: (t) => `Ayudás al jugador con «${t}». Dejás aportes concretos que pueda usar ya: borradores, próximos pasos chicos, esquemas, preguntas clave. Nada de relleno ni de motivación vacía.`,
  buscador: (t) => `Ayudás al jugador con «${t}» buscando en su corpus lo que ya tiene sobre eso: notas, ideas, contactos, decisiones. Siempre con cita.`,
  explorador: (t) => `${MARCA_EXPLORADOR} Ayudás al jugador con «${t}» saliendo a la web: encontrás lugares concretos donde actuar (comunidades, eventos, convocatorias, gente) y le proponés cómo entrar a cada uno, con borradores en su voz.`,
}

export type Ayudante = { mision: Mision; agente: Ficha | null; ultimoAporte: { id: number; en: number } | null }

function primariaDelJugador(db: Db, id: number): Mision {
  const m = leerMision(db, id)
  if (!m || m.nivel !== 'primaria' || m.personaje !== 'jugador') throw new Error(`La misión ${id} no es una primaria tuya`)
  if (m.estado !== 'activa') throw new Error('Solo una primaria activa (aceptada y abierta) puede tener ayudantes')
  return m
}

/** Suma un ayudante a una primaria: uno de la liga (por id) o uno nuevo de la clase pedida, forjado para eso. */
export function sumarAyudante(db: Db, primariaId: number, o: { clase?: string; agenteId?: string; ahora?: number } = {}): Ayudante {
  const ahora = o.ahora ?? Date.now()
  let p = primariaDelJugador(db, primariaId)
  // Sin entidad no hay contexto: se busca en el título (prefiriendo el proyecto) y queda vinculada.
  if (p.entidadId == null) {
    const e = entidadEnTexto(db, p.titulo)
    if (e) p = actualizarMision(db, p.id, { entidadId: e }, { por: 'operador', ahora })
  }
  let f: Ficha | null
  if (o.agenteId) {
    f = leer(db, o.agenteId)
    if (!f) throw new Error(`No existe el agente ${o.agenteId}`)
    if (!CLASES_AYUDANTE.includes(f.clase)) throw new Error(`Un ${CLASES[f.clase].nombre} no sirve de ayudante (sí: ${CLASES_AYUDANTE.map((c) => CLASES[c].nombre).join(', ')})`)
  } else {
    const rol = o.clase ?? 'generativo'
    if (!ROLES_AYUDANTE.includes(rol as any)) throw new Error(`Los ayudantes son ${ROLES_AYUDANTE.join(', ')}`)
    const clase = (rol === 'explorador' ? 'generativo' : rol) as ClaseId
    f = forjar(db, {
      clase, motor: nanConfigurado() ? 'nan' : 'local', creador: 'mastropiero', instrucciones: ROL[rol](p.titulo),
      misionPrincipal: rol === 'explorador' ? `Encontrar afuera lo que haga avanzar «${p.titulo}»` : `Ayudar a que «${p.titulo}» avance`, ahora,
    })
  }
  const ya = listarMisiones(db, { personaje: `agente:${f.id}`, padreId: p.id, abiertas: true })[0]
  const mision = ya ?? crearMision(db, {
    personaje: `agente:${f.id}`, asignadaPor: 'jugador', nivel: 'primaria', padreId: p.id, titulo: `Ayudar con «${p.titulo}»`,
    semana: p.semana, entidadId: p.entidadId, estado: 'activa', creadaPor: 'mastropiero',
  }, { por: 'mastropiero', ahora })
  return { mision, agente: f, ultimoAporte: null }
}

export function quitarAyudante(db: Db, misionAyudanteId: number) {
  const m = leerMision(db, misionAyudanteId)
  if (!m || !m.personaje.startsWith('agente:')) throw new Error(`La misión ${misionAyudanteId} no es de un ayudante`)
  actualizarMision(db, m.id, { estado: 'descartada', feedback: 'el jugador lo sacó' }, { por: 'operador' })
}

export function ayudantesDe(db: Db, primariaId: number): Ayudante[] {
  return listarMisiones(db, { padreId: primariaId, nivel: 'primaria', estados: ['activa'] })
    .filter((m) => m.personaje.startsWith('agente:'))
    .map((m) => {
      const ultimo = db.prepare(`SELECT id, creado_en AS en FROM corpus WHERE json_extract(meta, '$.ayudante') = ? ORDER BY id DESC LIMIT 1`).get(m.id) as { id: number; en: number } | undefined
      return { mision: m, agente: leer(db, m.personaje.slice(7)), ultimoAporte: ultimo ?? null }
    })
}

export type Aporte = { id: number; titulo: string; contenido: string; autor: string | null; primaria: number; ayudante: number; agente: string; en: number }

/** Los aportes de una primaria (o de todas), los más nuevos primero. */
export function aportes(db: Db, f: { primariaId?: number; desde?: number; limite?: number } = {}): Aporte[] {
  const where = [`json_extract(meta, '$.aporte') = 1`]
  const args: number[] = []
  if (f.primariaId != null) where.push(`json_extract(meta, '$.primaria') = ?`), args.push(f.primariaId)
  if (f.desde != null) where.push('creado_en >= ?'), args.push(f.desde)
  return (db.prepare(`SELECT id, titulo, contenido, autor, meta, creado_en FROM corpus WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args, f.limite ?? 20) as any[])
    .map((r) => {
      const meta = json<any>(r.meta, {})
      return { id: r.id, titulo: r.titulo, contenido: r.contenido, autor: r.autor, primaria: meta.primaria, ayudante: meta.ayudante, agente: meta.agente, en: r.creado_en }
    })
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
const PREFERENCIA: Record<string, number> = { proyecto: 0, agrupacion: 1, persona: 2, lugar: 3, dominio: 4, concepto: 5 }

/** La entidad que nombra un texto («Profundizar con Terreta Hub» → Terreta Hub): la más larga; entre iguales, el proyecto. */
export function entidadEnTexto(db: Db, texto: string): number | null {
  const t = ` ${norm(texto)} `
  const cands = (db.prepare('SELECT id, nombre, tipo FROM entidades').all() as { id: number; nombre: string; tipo: string }[])
    .filter((e) => norm(e.nombre).length >= 4 && t.includes(` ${norm(e.nombre)} `))
    .sort((a, b) => norm(b.nombre).length - norm(a.nombre).length || (PREFERENCIA[a.tipo] ?? 9) - (PREFERENCIA[b.tipo] ?? 9))
  return cands[0]?.id ?? null
}

/** De qué se trata, en palabras buscables: la entidad, o el título sin el verbo del principio. */
function consultaDe(p: Mision, ent: { nombre: string } | null): string {
  if (ent) return ent.nombre
  return p.titulo.split(/\s+/).filter((w, i) => !(i === 0 && /(ar|er|ir)$/i.test(w))).join(' ')
}

/** Material de su corpus para el ayudante: su voz y lo que guardó, nunca lo escrito por otros modelos (sin eco). */
function material(db: Db, consulta: string) {
  return buscar(db, consulta, 8).filter((x) => x.nivel !== 'generada').slice(0, 6)
    .map((x) => ({ id: x.id, nivel: NIVELES[x.nivel].nombre, titulo: x.titulo, extracto: x.contenido.replace(/\s+/g, ' ').slice(0, 500) }))
}

/** Lo que hizo el jugador en sus runs para esta primaria: material para que el ayudante no repita ni proponga lo ya hecho. */
function trabajoDelJugador(db: Db, primariaId: number): string {
  const ms = listarMisiones(db, { padreId: primariaId, nivel: 'secundaria' }).filter((m) => ['hecha', 'parcial', 'no'].includes(m.estado)).slice(-10)
  return ms.map((m) => `- ${m.titulo} [${m.estado === 'parcial' ? 'a medias' : m.estado}]${m.feedback ? ` — «${m.feedback}»` : ''}`).join('\n')
}

function encargo(db: Db, p: Mision, f: Ficha, previos: Aporte[], afuera: Oportunidad[] = []): Record<string, unknown> {
  const jugador = personaje(db, 'jugador').nombre.split(' ')[0]
  const ent = p.entidadId ? leerEntidad(db, p.entidadId) : null
  const consulta = consultaDe(p, ent)
  const fuentes = material(db, consulta)
  if (f.clase === 'buscador') {
    // El lector busca por palabras: el texto es la consulta corta; la pregunta y el material van aparte.
    return { texto: consulta, pregunta: `Qué hay en el corpus de ${jugador} sobre «${p.titulo}»: lo útil para avanzar esta semana (decisiones, ideas, contactos, pendientes). Citá por id.`, material: fuentes }
  }
  const h = ent ? leerHistoria(db, `entidad:${ent.id}`) : null
  return {
    texto: [
      `Trabajás para ${jugador}. Su primaria de esta semana: «${p.titulo}»${p.detalle ? ` — ${p.detalle}` : ''}.`,
      ent ? `Se trata de ${ent.nombre} (${ent.tipo})${h?.texto || ent.notas ? `: ${(h?.texto ?? ent.notas ?? '').slice(0, 400)}` : ''}.` : '',
      fuentes.length ? `Lo que hay en su corpus sobre esto (es su material: usalo, y si tomás algo citá [#id]):\n${fuentes.map((x) => `[#${x.id}] ${x.titulo}: ${x.extracto}`).join('\n')}` : 'En su corpus no hay nada sobre esto todavía.',
      afuera.length ? `Lo que encontraste afuera, en la web (oportunidades reales, con su link):\n${afuera.map((o) => `- ${o.titulo} (${o.tipo}) ${o.url ?? ''}: ${o.descripcion ?? ''} — ${o.porQue ?? ''}`).join('\n')}\nArmale un plan corto para entrar a los mejores 2 o 3 lugares, con un primer mensaje en su voz para cada uno.` : '',
      trabajoDelJugador(db, p.id) ? `Lo que ya trabajó en sus runs:\n${trabajoDelJugador(db, p.id)}` : 'Todavía no trabajó en esto en una run.',
      previos.length ? `Tus aportes anteriores (no los repitas, construí sobre ellos):\n${previos.map((a) => `- ${a.contenido.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')}` : '',
      'Dejale UN aporte concreto que pueda usar en su próxima run: un borrador, 3 a 5 próximos pasos chicos, un esquema o las preguntas que tiene que responder. Máximo 250 palabras, en castellano rioplatense. Si te falta información, decí qué falta en vez de inventar.',
    ].filter(Boolean).join('\n\n'),
  }
}

/**
 * Les pide un aporte a los ayudantes (de una primaria, o de todas las activas de la semana). Corre ya, de a uno,
 * con el tope diario de la liga: si se alcanza, para y lo dice. Los aportes entran al corpus como piezas generadas.
 */
export async function pedirAportes(db: Db, o: { primariaId?: number; ahora?: number; soloSinAporteHoy?: boolean } = {}): Promise<{ aportes: Aporte[]; fallas: string[]; frenado: string | null }> {
  const ahora = o.ahora ?? Date.now()
  const primarias = o.primariaId != null
    ? [primariaDelJugador(db, o.primariaId)]
    : listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] })
  const nuevos: Aporte[] = []
  const fallas: string[] = []
  const inicioHoy = new Date(fechaLocal(ahora) + 'T00:00:00').getTime()
  for (const p of primarias) {
    for (const a of ayudantesDe(db, p.id)) {
      if (!a.agente) continue
      if (o.soloSinAporteHoy && a.ultimoAporte && a.ultimoAporte.en >= inicioHoy) continue
      const tope = topeAlcanzado(db, ahora)
      if (tope) return { aportes: nuevos, fallas, frenado: tope }
      const previos = aportes(db, { primariaId: p.id, limite: 3 }).filter((x) => x.ayudante === a.mision.id)
      let afuera: Oportunidad[] = []
      if (esExplorador(a.agente)) {
        try {
          const r = await buscarOportunidades(db, { misionId: p.id, ahora })
          afuera = r.nuevas.length ? r.nuevas : listarOportunidades(db, { misionId: p.id, estados: ['nueva', 'me_interesa'], limite: 6 })
          if (!afuera.length && r.aviso) fallas.push(`${alias(a.agente)}: ${r.aviso}`)
        } catch (e) {
          fallas.push(`${alias(a.agente)}: ${e instanceof Error ? e.message : e}`)
        }
      }
      try {
        const { tarea } = await encargarYa(db, a.agente.id, {
          tipo: 'aporte', publicadaPor: 'mastropiero', dominio: p.entidadId ? leerEntidad(db, p.entidadId)?.nombre ?? null : null,
          proyectoId: a.agente.proyectoId, payload: encargo(db, p, a.agente, previos, afuera),
        }, ahora)
        const r = tarea.resultado as Record<string, unknown> | null
        const contenido = typeof r?.texto === 'string' ? r.texto : typeof r?.respuesta === 'string' ? r.respuesta : null
        if (tarea.estado !== 'hecha' || !contenido?.trim()) {
          fallas.push(`${alias(a.agente)}: ${tarea.error ?? 'no dejó nada'}`)
          continue
        }
        const citas = Array.isArray(r?.citas) ? (r!.citas as number[]).filter(Number.isInteger) : []
        const id = insertar(db, {
          fuente: 'agentes', nivel: 'generada', titulo: `Aporte de ${alias(a.agente)} · ${p.titulo}`.slice(0, 200),
          contenido: contenido.trim() + (citas.length ? `\n\nFuentes: ${citas.map((c) => `[#${c}]`).join(' ')}` : ''),
          estado: 'disponible', etiquetas: ['aporte'], autor: alias(a.agente), entidades: p.entidadId ? [p.entidadId] : undefined,
          meta: { aporte: 1, primaria: p.id, ayudante: a.mision.id, agente: a.agente.id, tarea: tarea.id },
        }, ahora)
        if (id) nuevos.push(aportes(db, { primariaId: p.id, limite: 1 })[0])
      } catch (e) {
        fallas.push(`${alias(a.agente)}: ${e instanceof Error ? e.message : e}`)
      }
    }
  }
  return { aportes: nuevos, fallas, frenado: null }
}

/** Para la run: lo que dejaron los ayudantes en los últimos días, recortado. */
export function aportesParaRun(db: Db, ahora: number, dias = 4, max = 5): string {
  const xs = aportes(db, { desde: ahora - dias * 86_400_000, limite: max })
  return xs.map((a) => {
    const p = leerMision(db, a.primaria)
    return `- De ${a.autor ?? a.agente}, para «${p?.titulo ?? '?'}»: ${a.contenido.replace(/\s+/g, ' ').slice(0, 600)}`
  }).join('\n')
}
