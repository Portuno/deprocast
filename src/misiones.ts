/**
 * Misiones: lo que cada personaje persigue, en cuatro niveles.
 * Principal (su objetivo de vida; la de un agente no cambia), primarias (las de la semana, en foco),
 * secundarias (las tareas de una run, que el jugador diseña a su gusto) y terciarias (side quests que dependen
 * de dónde está o qué hace). Todo lo que propone Mastropiero entra como sugerencia; él acepta, cambia o descarta.
 * Las runs se calibran con lo que marca y cuenta, y dejan reportes por hora, por run y por semana.
 */
import { ajuste, fechaLocal, json, type Db } from './db.ts'
import { CLASES } from './clases.ts'
import { agendaDelDia, type Evento } from './calendario.ts'
import { insertar, listarPiezas } from './corpus.ts'
import { asegurarEntidad, leerEntidad, listarEntidades, TIPOS_ENTIDAD, type TipoEntidad } from './entidades.ts'
import { aHora, aMin } from './jornada.ts'
import { encargarYa } from './mastropiero.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { pedirJson } from './modelo.ts'
import { agregarItem, entidadPorNombre, escribirHistoria, inventarioParaPrompt, leerHistoria, personaje, personaPorNombre } from './personajes.ts'
import { especializacion } from './auditor.ts'
import { alias, leer, listar } from './roster.ts'
import { aportesParaRun } from './ayudantes.ts'
import { menciones, sinArrobas } from './menciones.ts'

export const NIVELES_MISION = ['principal', 'primaria', 'secundaria', 'terciaria'] as const
export type NivelMision = (typeof NIVELES_MISION)[number]
export const ESTADOS_MISION = ['sugerida', 'activa', 'hecha', 'parcial', 'no', 'descartada'] as const
export type EstadoMision = (typeof ESTADOS_MISION)[number]
const CERRADAS = ['hecha', 'parcial', 'no', 'descartada']

export type Disparador = { lugar?: string | null; zona?: string | null; actividad?: string | null; cuando?: string | null }
export type Mision = {
  id: number; personaje: string; asignadaPor: string; nivel: NivelMision; padreId: number | null; titulo: string; detalle: string | null
  categoria: string | null; entidadId: number | null; estado: EstadoMision; progreso: number; feedback: string | null; semana: string | null
  runId: number | null; inicio: string | null; fin: string | null; minutos: number | null; fijada: boolean; con: string | null; gasto: number | null
  disparador: Disparador | null; vence: string | null; orden: number; creadaPor: string; creadaEn: number; cerradaEn: number | null
}

const deFila = (r: any): Mision => ({
  id: r.id, personaje: r.personaje, asignadaPor: r.asignada_por, nivel: r.nivel, padreId: r.padre_id, titulo: r.titulo, detalle: r.detalle,
  categoria: r.categoria, entidadId: r.entidad_id, estado: r.estado, progreso: r.progreso, feedback: r.feedback, semana: r.semana,
  runId: r.run_id, inicio: r.inicio, fin: r.fin, minutos: r.minutos, fijada: r.fijada === 1, con: r.con, gasto: r.gasto,
  disparador: json(r.disparador, null), vence: r.vence, orden: r.orden, creadaPor: r.creada_por, creadaEn: r.creada_en, cerradaEn: r.cerrada_en,
})

const recorte = (s: string | null | undefined, n: number) => (s && s.length > n ? s.slice(0, n) + '…' : s ?? '')
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()

// ─── semanas ────────────────────────────────────────────────────────────

/** Semana ISO local: 2026-W41. */
export function semanaDe(ms = Date.now()): string {
  const d = new Date(ms)
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dia = (t.getDay() + 6) % 7
  t.setDate(t.getDate() - dia + 3)
  const primero = new Date(t.getFullYear(), 0, 4)
  const n = 1 + Math.round(((t.getTime() - primero.getTime()) / 86_400_000 - 3 + ((primero.getDay() + 6) % 7)) / 7)
  return `${t.getFullYear()}-W${String(n).padStart(2, '0')}`
}

/** Lunes y domingo (YYYY-MM-DD) de una semana ISO. */
export function diasDeSemana(semana: string): { desde: string; hasta: string } {
  const [a, w] = semana.split('-W').map(Number)
  const cuatro = new Date(a, 0, 4)
  const lunes = new Date(a, 0, 4 - ((cuatro.getDay() + 6) % 7) + (w - 1) * 7)
  const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6)
  return { desde: fechaLocal(lunes.getTime()), hasta: fechaLocal(domingo.getTime()) }
}

export function semanaVecina(semana: string, delta: number): string {
  const { desde } = diasDeSemana(semana)
  const [a, m, d] = desde.split('-').map(Number)
  return semanaDe(new Date(a, m - 1, d + 7 * delta + 3).getTime())
}

// ─── alta, lectura y cambios ────────────────────────────────────────────

export type NuevaMision = {
  personaje?: string; asignadaPor?: string; nivel: NivelMision; padreId?: number | null; titulo: string; detalle?: string | null; categoria?: string | null
  entidadId?: number | null; estado?: EstadoMision; progreso?: number; semana?: string | null; runId?: number | null; inicio?: string | null; fin?: string | null
  minutos?: number | null; con?: string | null; gasto?: number | null; disparador?: Disparador | null; vence?: string | null; orden?: number; creadaPor?: string
}

export function leerMision(db: Db, id: number): Mision | null {
  const r = db.prepare('SELECT * FROM misiones WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

function insertarMision(db: Db, m: NuevaMision, ahora: number): Mision {
  const titulo = String(m.titulo ?? '').trim().slice(0, 200)
  if (!titulo) throw new Error('La misión necesita un título')
  if (!NIVELES_MISION.includes(m.nivel)) throw new Error(`Nivel de misión inválido: ${m.nivel}`)
  const estado = m.estado ?? 'activa'
  if (!ESTADOS_MISION.includes(estado)) throw new Error(`Estado de misión inválido: ${estado}`)
  const clave = personaje(db, m.personaje ?? 'jugador').clave
  if (m.entidadId != null && !leerEntidad(db, m.entidadId)) throw new Error(`No existe la entidad ${m.entidadId}`)
  if (m.padreId != null && !leerMision(db, m.padreId)) throw new Error(`No existe la misión ${m.padreId}`)
  const r = db.prepare(
    `INSERT INTO misiones (personaje, asignada_por, nivel, padre_id, titulo, detalle, categoria, entidad_id, estado, progreso, semana, run_id, inicio, fin, minutos,
       con, gasto, disparador, vence, orden, creada_por, creada_en, cerrada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    clave, m.asignadaPor ?? 'jugador', m.nivel, m.padreId ?? null, titulo, m.detalle?.trim() || null, m.categoria?.trim() || null, m.entidadId ?? null,
    estado, Math.max(0, Math.min(100, Math.round(m.progreso ?? 0))), m.semana ?? null, m.runId ?? null, m.inicio ?? null, m.fin ?? null, m.minutos ?? null,
    m.con?.trim() || null, m.gasto ?? null, m.disparador ? JSON.stringify(m.disparador) : null, m.vence ?? null, m.orden ?? 0, m.creadaPor ?? 'operador', ahora,
    CERRADAS.includes(estado) ? ahora : null,
  )
  return leerMision(db, Number(r.lastInsertRowid))!
}

/** Alta general. Las principales pasan por sus reglas; las primarias sin semana caen en la actual. */
export function crearMision(db: Db, m: NuevaMision, o: { por?: string; ahora?: number } = {}): Mision {
  const ahora = o.ahora ?? Date.now()
  const ms = menciones(db, `${m.titulo} ${m.detalle ?? ''}`)
  if (ms.length) {
    m = { ...m, titulo: sinArrobas(m.titulo, ms), detalle: m.detalle ? sinArrobas(m.detalle, ms) : m.detalle }
    if (m.entidadId == null) m.entidadId = ms.find((x) => x.entidadId && x.clave !== 'jugador')?.entidadId ?? null
  }
  if (m.nivel === 'principal') return fijarPrincipal(db, m.personaje ?? 'jugador', { titulo: m.titulo, detalle: m.detalle }, { por: o.por ?? m.creadaPor ?? 'operador', sugerida: m.estado === 'sugerida', ahora })
  const semana = m.nivel === 'primaria' ? m.semana ?? semanaDe(ahora) : m.semana ?? null
  return insertarMision(db, { ...m, semana, creadaPor: m.creadaPor ?? o.por ?? 'operador' }, ahora)
}

export type FiltroMisiones = {
  personaje?: string; nivel?: NivelMision; estados?: EstadoMision[]; semana?: string; runId?: number; asignadaPor?: string
  abiertas?: boolean; padreId?: number; entidadId?: number; excluirPersonaje?: string; limite?: number
}

export function listarMisiones(db: Db, f: FiltroMisiones = {}): Mision[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (f.personaje) where.push('personaje = ?'), args.push(f.personaje)
  if (f.excluirPersonaje) where.push('personaje != ?'), args.push(f.excluirPersonaje)
  if (f.nivel) where.push('nivel = ?'), args.push(f.nivel)
  if (f.estados?.length) where.push(`estado IN (${f.estados.map(() => '?').join(',')})`), args.push(...f.estados)
  if (f.abiertas) where.push(`estado IN ('sugerida', 'activa')`)
  if (f.semana) where.push('semana = ?'), args.push(f.semana)
  if (f.runId != null) where.push('run_id = ?'), args.push(f.runId)
  if (f.asignadaPor) where.push('asignada_por = ?'), args.push(f.asignadaPor)
  if (f.padreId != null) where.push('padre_id = ?'), args.push(f.padreId)
  if (f.entidadId != null) where.push('entidad_id = ?'), args.push(f.entidadId)
  return db.prepare(`SELECT * FROM misiones ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(inicio, ''), orden, id LIMIT ?`)
    .all(...args, f.limite ?? 300).map(deFila)
}

export type CambiosMision = Partial<Pick<Mision, 'titulo' | 'detalle' | 'categoria' | 'estado' | 'progreso' | 'feedback' | 'vence' | 'padreId' | 'entidadId' | 'con' | 'fijada' | 'semana'>> & { disparador?: Disparador | null }

/**
 * Cambia una misión. La principal de un agente no se toca nunca; la del jugador solo la toca el operador.
 * Aceptar una principal sugerida reemplaza a la vigente.
 */
export function actualizarMision(db: Db, id: number, c: CambiosMision, o: { por?: string; ahora?: number } = {}): Mision {
  const m = leerMision(db, id)
  if (!m) throw new Error(`No existe la misión ${id}`)
  const por = o.por ?? 'operador'
  const ahora = o.ahora ?? Date.now()
  if (m.nivel === 'principal') {
    if (m.personaje.startsWith('agente:') && m.estado !== 'sugerida') throw new Error('La misión principal de un agente es la razón por la que nació: no cambia')
    if (m.personaje === 'jugador' && por !== 'operador') throw new Error('La misión principal del jugador solo la cambia él')
  }
  if (c.estado && !ESTADOS_MISION.includes(c.estado)) throw new Error(`Estado inválido: ${c.estado}`)
  if (m.nivel === 'principal' && c.estado === 'activa' && m.estado !== 'activa') {
    db.prepare(`UPDATE misiones SET estado = 'descartada', feedback = COALESCE(feedback, 'reemplazada'), cerrada_en = ? WHERE personaje = ? AND nivel = 'principal' AND estado = 'activa' AND id != ?`)
      .run(ahora, m.personaje, id)
  }
  // Una primaria del jugador que se cierra cierra también a sus ayudantes.
  if (m.nivel === 'primaria' && m.personaje === 'jugador' && c.estado && CERRADAS.includes(c.estado) && !CERRADAS.includes(m.estado)) {
    db.prepare(`UPDATE misiones SET estado = ?, cerrada_en = ? WHERE padre_id = ? AND personaje LIKE 'agente:%' AND estado = 'activa'`)
      .run(c.estado === 'hecha' ? 'hecha' : 'descartada', ahora, id)
  }
  const v = <K extends keyof CambiosMision>(k: K, actual: unknown) => (k in c ? (c[k] ?? null) : actual)
  const estado = (c.estado ?? m.estado) as EstadoMision
  const progreso = c.progreso != null ? Math.max(0, Math.min(100, Math.round(Number(c.progreso)))) : estado === 'hecha' && m.nivel !== 'secundaria' ? 100 : m.progreso
  db.prepare(
    `UPDATE misiones SET titulo = ?, detalle = ?, categoria = ?, estado = ?, progreso = ?, feedback = ?, vence = ?, padre_id = ?, entidad_id = ?, con = ?, fijada = ?,
       semana = ?, disparador = ?, cerrada_en = ? WHERE id = ?`,
  ).run(
    String(v('titulo', m.titulo) || m.titulo).trim().slice(0, 200), v('detalle', m.detalle) as any, v('categoria', m.categoria) as any, estado, progreso,
    v('feedback', m.feedback) as any, v('vence', m.vence) as any, v('padreId', m.padreId) as any, v('entidadId', m.entidadId) as any, v('con', m.con) as any,
    (('fijada' in c ? c.fijada : m.fijada) ? 1 : 0), v('semana', m.semana) as any,
    'disparador' in c ? (c.disparador ? JSON.stringify(c.disparador) : null) : (m.disparador ? JSON.stringify(m.disparador) : null),
    CERRADAS.includes(estado) ? m.cerradaEn ?? ahora : null, id,
  )
  return leerMision(db, id)!
}

// ─── principal ──────────────────────────────────────────────────────────

export function principalDe(db: Db, clave: string): Mision | null {
  const r = db.prepare(`SELECT * FROM misiones WHERE personaje = ? AND nivel = 'principal' AND estado = 'activa' ORDER BY id DESC LIMIT 1`).get(clave)
  return r ? deFila(r) : null
}

/**
 * Fija (o sugiere) la misión principal. Reglas: una vigente por personaje; la de un agente se fija al nacer y no cambia;
 * la del jugador solo la fija el operador (Mastropiero puede sugerir candidatas).
 */
export function fijarPrincipal(db: Db, clave: string, m: { titulo: string; detalle?: string | null }, o: { por?: string; sugerida?: boolean; ahora?: number } = {}): Mision {
  const k = personaje(db, clave).clave
  const por = o.por ?? 'operador'
  const ahora = o.ahora ?? Date.now()
  const vigente = principalDe(db, k)
  if (k.startsWith('agente:') && vigente) throw new Error('La misión principal de un agente es la razón por la que nació: no cambia')
  const sugerida = o.sugerida || (k === 'jugador' && por !== 'operador')
  if (!sugerida && vigente) {
    db.prepare(`UPDATE misiones SET estado = 'descartada', feedback = COALESCE(feedback, 'reemplazada'), cerrada_en = ? WHERE id = ?`).run(ahora, vigente.id)
  }
  return insertarMision(db, { personaje: k, asignadaPor: por, nivel: 'principal', titulo: m.titulo, detalle: m.detalle, estado: sugerida ? 'sugerida' : 'activa', creadaPor: por }, ahora)
}

/** Agentes y Mastropiero siempre tienen principal: si falta, se fija la de su oficio (la de un agente, para siempre). */
export function asegurarPrincipal(db: Db, clave: string): Mision | null {
  const ya = principalDe(db, clave)
  if (ya) return ya
  if (clave === 'mastropiero') {
    return fijarPrincipal(db, clave, { titulo: 'Que el jugador cumpla su misión principal', detalle: 'Entenderlo, empujarlo y poner la liga entera a trabajar para eso.' }, { por: 'sistema' })
  }
  if (clave.startsWith('agente:')) {
    const f = leer(db, clave.slice(7))
    if (!f) return null
    const c = CLASES[f.clase]
    return fijarPrincipal(db, `agente:${f.id}`, { titulo: `Producir ${c.produce}`, detalle: f.instrucciones }, { por: f.creador })
  }
  return null
}

// ─── progreso ───────────────────────────────────────────────────────────

export type Avance = { progreso: number; bandas: { hechas: number; parciales: number; no: number; total: number }; minutos: number }

/** El progreso de una misión es el que se le marca; sus hijas suman foco (bandas y minutos trabajados). */
export function avanceDe(db: Db, id: number): Avance {
  const m = leerMision(db, id)
  if (!m) throw new Error(`No existe la misión ${id}`)
  const hijas = db.prepare(`SELECT estado, COALESCE(minutos, 0) AS minutos FROM misiones WHERE padre_id = ? AND nivel = 'secundaria'`).all(id) as { estado: string; minutos: number }[]
  const cuenta = (e: string) => hijas.filter((h) => h.estado === e).length
  const minutos = hijas.reduce((s, h) => s + (h.estado === 'hecha' ? h.minutos : h.estado === 'parcial' ? h.minutos / 2 : 0), 0)
  const progreso = m.nivel === 'secundaria' || m.nivel === 'terciaria'
    ? m.estado === 'hecha' ? 100 : m.estado === 'parcial' ? 50 : m.progreso
    : m.estado === 'hecha' ? 100 : m.progreso
  return { progreso, bandas: { hechas: cuenta('hecha'), parciales: cuenta('parcial'), no: cuenta('no'), total: hijas.length }, minutos: Math.round(minutos) }
}

export function conAvance(db: Db, ms: Mision[]) {
  return ms.map((m) => ({ ...m, avance: avanceDe(db, m.id) }))
}

// ─── primarias de la semana ─────────────────────────────────────────────

/** Lo que dijo en las últimas horas (con Mastropiero, en cualquier conversación). */
export function charlaReciente(db: Db, ahora: number, horas = 36, limite = 30): string[] {
  return (db.prepare(
    `SELECT m.texto FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
     WHERE m.rol = 'operador' AND c.con = 'mastropiero' AND m.en > ? ORDER BY m.id DESC LIMIT ?`,
  ).all(ahora - horas * 3_600_000, limite) as { texto: string }[]).reverse().map((c) => c.texto.replace(/\s+/g, ' ').slice(0, 500))
}

function proyectosActivos(db: Db, limite = 20): string {
  return listarEntidades(db, { tipo: 'proyecto', limite }).filter((e) => e.piezas > 0).map((e) => e.nombre).join(', ')
}

const SISTEMA_PRIMARIAS = (n: number) => `Sos Mastropiero y proponés las misiones primarias de la semana del jugador: ${n} focos, no más.
Una primaria es algo que esta semana merece su foco: un proyecto que empujar, una tarea grande, un frente de su vida. Puede ser a la vez la misión principal de un proyecto («Escribir el libro» es la principal del libro).
Reglas:
- Solo lo que está en su memoria, su misión principal, lo que te dijo y lo que quedó de la semana pasada. No inventes proyectos, personas ni tareas.
- Si una primaria de la semana pasada sigue abierta y le importa, puede seguir (decilo en «por_que»).
- Títulos cortos y concretos, en infinitivo («Publicar…», «Cerrar…», «Escribir…»). «detalle»: qué sería un buen avance esta semana, en una frase.
- Nada sobre la plataforma misma (entender la liga, el corpus, los agentes) salvo que él lo haya pedido como meta. Nunca muestres ids internos («entidad #12», «pieza 40»): hablá de las cosas por su nombre.
- «entidad»: el nombre exacto del proyecto o persona de la lista si corresponde, o null.
- Castellano rioplatense.
Forma: {"primarias": [{"titulo": string, "detalle": string, "categoria": string, "entidad": string | null, "por_que": string}]}`

/** Propone las primarias de una semana como sugerencias. Las de la semana que ya estén sugeridas se reemplazan. */
export async function proponerPrimarias(db: Db, semana = semanaDe(), o: { ahora?: number; texto?: string } = {}): Promise<Mision[]> {
  const ahora = o.ahora ?? Date.now()
  const n = Math.max(1, Math.min(12, Number(ajuste(db, 'primarias_semana') ?? 6)))
  const principal = principalDe(db, 'jugador')
  const previa = semanaVecina(semana, -1)
  const pasadas = conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: previa }).filter((m) => m.estado !== 'sugerida' && m.estado !== 'descartada'))
  const actuales = listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana, estados: ['activa', 'hecha', 'parcial'] })
  const memoria = memoriaParaPrompt(db, 60)
  const charla = charlaReciente(db, ahora, 72, 20)
  const usuario = [
    `Semana ${semana} (${diasDeSemana(semana).desde} a ${diasDeSemana(semana).hasta}).`,
    principal ? `Su misión principal: ${principal.titulo}${principal.detalle ? ` — ${principal.detalle}` : ''}` : 'Todavía no fijó su misión principal.',
    `\nLo que sabés de él:\n${memoria || '- (casi nada todavía: proponé pocas y decilo)'}`,
    pasadas.length ? `\nLa semana pasada:\n${pasadas.map((m) => `- ${m.titulo} [${m.estado}, ${m.avance.progreso}%, ${m.avance.bandas.hechas} bandas hechas]`).join('\n')}` : '',
    actuales.length ? `\nYa aceptadas para esta semana (no las repitas; proponé ${Math.max(0, n - actuales.length)}):\n${actuales.map((m) => `- ${m.titulo}`).join('\n')}` : '',
    charla.length ? `\nLo que te dijo estos días:\n${charla.map((c) => `- ${c}`).join('\n')}` : '',
    `\nProyectos que aparecen en su mundo: ${proyectosActivos(db) || 'ninguno cargado'}.`,
    o.texto ? `\nLo que pide para esta propuesta: ${o.texto}` : '',
  ].filter(Boolean).join('\n')
  const { datos } = await pedirJson<{ primarias?: any[] }>({ db, clase: 'mastropiero', agenteId: 'primarias' }, SISTEMA_PRIMARIAS(n), usuario, { temperatura: 0.5, maxTokens: 3000 })
  db.prepare(`DELETE FROM misiones WHERE personaje = 'jugador' AND nivel = 'primaria' AND semana = ? AND estado = 'sugerida'`).run(semana)
  const cupo = Math.max(0, n - actuales.length)
  return (datos.primarias ?? []).filter((p) => typeof p?.titulo === 'string' && p.titulo.trim()).slice(0, cupo).map((p, i) => insertarMision(db, {
    personaje: 'jugador', asignadaPor: 'mastropiero', nivel: 'primaria', titulo: p.titulo, detalle: [p.detalle, p.por_que ? `Por qué: ${p.por_que}` : ''].filter(Boolean).join(' '),
    categoria: typeof p.categoria === 'string' ? p.categoria.slice(0, 40) : null, entidadId: typeof p.entidad === 'string' ? entidadPorNombre(db, p.entidad) : null,
    padreId: principal?.id ?? null, estado: 'sugerida', semana, orden: i, creadaPor: 'mastropiero',
  }, ahora))
}

// ─── runs ───────────────────────────────────────────────────────────────

/** Lo que el jugador pide para una run. Todo es opcional: lo que falta lo pone la plantilla. */
export type PedidoRun = {
  plantilla?: number | string | null
  /** YYYY-MM-DD: una run para otro día (mañana a la mañana). Vacío = hoy. */
  fecha?: string | null
  inicio?: string | null
  duracion?: number | null
  fin?: string | null
  /** Minutos por misión permitidos; vacío o `libre` = que Mastropiero elija el largo de cada una. */
  banda?: number[] | null
  libre?: boolean
  cantidad?: number | null
  intensidad?: number | null
  energia?: string | null
  dinero?: number | null
  recursos?: string | null
  /** Entidades: id, nombre, o «persona:Nombre» / «proyecto:Nombre» para crearla al vuelo. */
  incluir?: (number | string | { nombre: string; tipo?: string })[]
  excluir?: string | null
  formato?: string | null
  subdescripcion?: boolean
  texto?: string | null
}

export type Incluido = { id: number; nombre: string; tipo: string }
export type PedidoResuelto = Omit<PedidoRun, 'incluir'> & { inicio: string; duracion: number; fin: string; incluir: Incluido[]; plantillaNombre: string | null; cantidadDicha?: boolean }
export type AgenteEnRun = { id: string; nombre: string; tarea: number; ok: boolean; aporte: string | null }
export type Run = {
  id: number; fecha: string; inicio: string; fin: string; estado: 'propuesta' | 'en_curso' | 'cerrada' | 'descartada'; pedido: PedidoResuelto
  fijos: { inicio: string; fin: string; titulo: string }[]; agentes: AgenteEnRun[]; resumen: string | null; reporte: string | null; modelo: string | null
  ultimaHora: number; creadaEn: number; iniciadaEn: number | null; cerradaEn: number | null
}

const deRun = (r: any): Run => ({
  id: r.id, fecha: r.fecha, inicio: r.inicio, fin: r.fin, estado: r.estado, pedido: json(r.pedido, {} as PedidoResuelto), fijos: json(r.fijos, []),
  agentes: json(r.agentes, []), resumen: r.resumen, reporte: r.reporte, modelo: r.modelo, ultimaHora: r.ultima_hora, creadaEn: r.creada_en,
  iniciadaEn: r.iniciada_en, cerradaEn: r.cerrada_en,
})

export function leerRun(db: Db, id: number): Run | null {
  const r = db.prepare('SELECT * FROM runs WHERE id = ?').get(id)
  return r ? deRun(r) : null
}

export function listarRuns(db: Db, f: { fecha?: string; desde?: string; hasta?: string; estados?: string[]; limite?: number } = {}): Run[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (f.fecha) where.push('fecha = ?'), args.push(f.fecha)
  if (f.desde) where.push('fecha >= ?'), args.push(f.desde)
  if (f.hasta) where.push('fecha <= ?'), args.push(f.hasta)
  if (f.estados?.length) where.push(`estado IN (${f.estados.map(() => '?').join(',')})`), args.push(...f.estados)
  return db.prepare(`SELECT * FROM runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY fecha DESC, inicio DESC LIMIT ?`).all(...args, f.limite ?? 50).map(deRun)
}

/** La run viva: la que está en curso o, si no, la última propuesta de hoy. */
export function runActual(db: Db, ahora = Date.now()): Run | null {
  const r = db.prepare(`SELECT * FROM runs WHERE estado = 'en_curso' ORDER BY id DESC LIMIT 1`).get()
    ?? db.prepare(`SELECT * FROM runs WHERE estado = 'propuesta' AND fecha = ? ORDER BY id DESC LIMIT 1`).get(fechaLocal(ahora))
  return r ? deRun(r) : null
}

export function misionesDeRun(db: Db, id: number): Mision[] {
  return listarMisiones(db, { runId: id, nivel: 'secundaria' }).filter((m) => m.estado !== 'descartada')
}

// Plantillas

export type Plantilla = { id: number; nombre: string; pedido: PedidoRun; sistema: boolean }
export function listarPlantillas(db: Db): Plantilla[] {
  return (db.prepare('SELECT * FROM run_plantillas ORDER BY sistema DESC, nombre').all() as any[]).map((r) => ({ id: r.id, nombre: r.nombre, pedido: json(r.pedido, {}), sistema: r.sistema === 1 }))
}

export function guardarPlantilla(db: Db, nombre: string, pedido: PedidoRun): Plantilla {
  const n = nombre.trim().slice(0, 60)
  if (!n) throw new Error('La plantilla necesita un nombre')
  const { plantilla: _, texto: __, inicio: ___, ...limpio } = pedido
  db.prepare('INSERT INTO run_plantillas (nombre, pedido, sistema, creada_en) VALUES (?, ?, 0, ?) ON CONFLICT(nombre) DO UPDATE SET pedido = excluded.pedido')
    .run(n, JSON.stringify(limpio), Date.now())
  return listarPlantillas(db).find((p) => p.nombre === n)!
}

export function borrarPlantilla(db: Db, id: number) {
  const p = listarPlantillas(db).find((x) => x.id === id)
  if (!p) throw new Error(`No existe la plantilla ${id}`)
  if (p.sistema) throw new Error('La plantilla de fábrica no se borra (podés guardar otra con tu gusto)')
  db.prepare('DELETE FROM run_plantillas WHERE id = ?').run(id)
}

function plantillaDe(db: Db, ref: number | string | null | undefined): Plantilla | null {
  const ps = listarPlantillas(db)
  if (ref == null || ref === '') return ps.find((p) => p.sistema) ?? ps[0] ?? null
  return ps.find((p) => p.id === Number(ref) || norm(p.nombre) === norm(String(ref))) ?? null
}

const definido = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<T>

const SISTEMA_PEDIDO = `Sos Mastropiero e interpretás el pedido de una run: el jugador te dice en sus palabras cómo quiere su próxima tanda de trabajo.
Devolvé SOLO los campos que su texto cambia o precisa; lo que no menciona, no lo pongas.
Campos posibles:
- duracion (minutos totales) o fin ("HH:MM"); inicio ("HH:MM") si dice cuándo arranca.
- banda: lista de minutos permitidos por misión (ej. [25] o [12, 25]); libre: true si quiere que vos elijas el largo de cada una.
- cantidad: cuántas misiones, si lo dice.
- intensidad: 1 (cabeza apagada) a 5 (modo profundo), si se infiere de cómo está; energia: cómo dice que está, en sus palabras cortas.
- dinero: plata disponible para gastar (número); recursos: dónde está, qué tiene a mano, si puede salir o llamar.
- incluir: [{"nombre": string, "tipo": "persona" | "proyecto" | "agrupacion" | "lugar" | "concepto"}] proyectos o personas que quiere meter.
- excluir: lo que no quiere (texto corto); formato: cómo quiere ver las tareas (texto corto); subdescripcion: false si no quiere subdescripción.
Forma: un objeto JSON con esos campos.`

const PALABRAS_VACIAS = new Set(['tengo', 'quiero', 'una', 'un', 'de', 'en', 'y', 'con', 'run', 'para', 'hoy', 'ahora', 'me', 'dame', 'armame', 'arma', 'hace', 'hacé', 'la', 'el', 'las', 'los', 'que', 'sea', 'por', 'favor', 'bandas', 'tareas', 'misiones', 'minutos', 'min', 'horas', 'hora', 'h', 'media', 'cuarto'])

/**
 * Lo que se entiende sin modelo: duración («2 horas», «1h30», «90 minutos», «hora y media»), banda («bandas de 25»)
 * y cantidad («10 bandas»). Si el texto no dice nada más, no hace falta llamar al modelo (ahorra 10 segundos).
 */
export function leerPedidoSimple(texto: string): PedidoRun | null {
  let t = ` ${texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.,;:!?]/g, ' ')} `
  const out: PedidoRun = {}
  const quitar = (re: RegExp, f: (m: RegExpExecArray) => void) => { const m = re.exec(t); if (m) { f(m); t = t.replace(m[0], ' ') } }
  quitar(/\s(?:bandas?|tandas?|tramos?)\s+de\s+(\d{1,3})\s*(?:min(?:utos)?)?\s/, (m) => (out.banda = [Number(m[1])]))
  quitar(/\s(\d{1,2})\s*h(?:oras?)?\s*(?:y\s*)?(\d{1,2})\s*(?:min(?:utos)?)?\s/, (m) => (out.duracion = Number(m[1]) * 60 + Number(m[2])))
  if (out.duracion == null) quitar(/\s(\d{1,2})\s*(?:horas?|h)\s+y\s+media\s/, (m) => (out.duracion = Number(m[1]) * 60 + 30))
  if (out.duracion == null) quitar(/\s(?:una\s+)?hora\s+y\s+media\s/, () => (out.duracion = 90))
  if (out.duracion == null) quitar(/\s(\d{1,2})\s*(?:horas?|h)\s/, (m) => (out.duracion = Number(m[1]) * 60))
  if (out.duracion == null) quitar(/\s(\d{2,3})\s*min(?:utos)?\s/, (m) => (out.duracion = Number(m[1])))
  if (out.duracion == null) quitar(/\suna\s+hora\s/, () => (out.duracion = 60))
  quitar(/\s(\d{1,2})\s+(?:bandas|tareas|misiones)\s/, (m) => (out.cantidad = Number(m[1])))
  const resto = t.split(/\s+/).filter((w) => w && !PALABRAS_VACIAS.has(w) && !/^\d+$/.test(w))
  return resto.length || !Object.keys(out).length ? null : out
}

/** Plantilla + campos + lo que dice en palabras (lo dicho manda). Las entidades nuevas se crean al vuelo. */
export async function resolverPedido(db: Db, p: PedidoRun, ahora = Date.now()): Promise<PedidoResuelto> {
  const plantilla = plantillaDe(db, p.plantilla)
  if (p.plantilla != null && p.plantilla !== '' && !plantilla) throw new Error(`No existe la plantilla «${p.plantilla}»`)
  const base: PedidoRun = plantilla?.pedido ?? { duracion: 180, banda: [12], cantidad: 15, subdescripcion: true }
  const propios = definido({ ...p, incluir: undefined, plantilla: undefined })
  let leido: PedidoRun = {}
  if (p.texto?.trim()) {
    const simple = leerPedidoSimple(p.texto)
    if (simple) leido = simple
    else {
      const { datos } = await pedirJson<PedidoRun>({ db, clase: 'mastropiero', agenteId: 'run-pedido' }, SISTEMA_PEDIDO, p.texto.trim(), { temperatura: 0.1, maxTokens: 800 })
      leido = definido({ ...datos, texto: undefined, plantilla: undefined }) as PedidoRun
    }
  }
  const r: PedidoRun = { ...base, ...propios, ...leido }
  // Si cambió el largo o la banda y nadie dijo cuántas, la cantidad sale de la cuenta (o la decide el modelo, si es libre).
  const dijoCantidad = propios.cantidad != null || leido.cantidad != null
  const libre = !!(r.libre || (Array.isArray(r.banda) && !r.banda.length) || (!r.banda && !base.banda))
  const banda = libre ? null : (r.banda ?? []).map(Number).filter((n) => n >= 3 && n <= 240)
  // Horario: hoy desde ahora (redondeado a 5); otro día, desde el inicio de su jornada; salvo que diga otra cosa.
  const d = new Date(ahora)
  const otroDia = !!p.fecha && p.fecha !== fechaLocal(ahora)
  const ahoraMin = otroDia ? aMin(ajuste(db, 'jornada_inicio') ?? '09:00') : Math.ceil((d.getHours() * 60 + d.getMinutes()) / 5) * 5
  const inicioMin = r.inicio && Number.isFinite(aMin(r.inicio)) ? aMin(r.inicio) : Math.min(ahoraMin, 23 * 60 + 30)
  let duracion = Math.round(Number(r.duracion) || 180)
  if (r.fin && Number.isFinite(aMin(r.fin)) && aMin(r.fin) > inicioMin) duracion = aMin(r.fin) - inicioMin
  duracion = Math.max(10, Math.min(duracion, 24 * 60 - 1 - inicioMin))
  const cantidad = dijoCantidad ? Math.max(1, Math.min(60, Math.round(Number(r.cantidad)))) : banda?.length === 1 ? Math.max(1, Math.floor(duracion / banda[0])) : libre ? null : r.cantidad ?? null
  const nombrados = menciones(db, p.texto ?? '').filter((m) => m.entidadId && m.clave !== 'jugador').map((m) => m.entidadId!)
  const incluir = resolverIncluidos(db, [...(p.incluir ?? []), ...nombrados, ...((leido.incluir as any[]) ?? [])], ahora)
  return {
    ...r, plantilla: plantilla?.id ?? null, plantillaNombre: plantilla?.nombre ?? null, inicio: aHora(inicioMin), duracion, fin: aHora(inicioMin + duracion),
    banda: banda?.length ? banda : null, libre, cantidad, cantidadDicha: dijoCantidad, incluir, texto: p.texto?.trim() || null,
    subdescripcion: r.subdescripcion !== false, intensidad: r.intensidad != null ? Math.max(1, Math.min(5, Math.round(Number(r.intensidad)))) : null,
    dinero: r.dinero != null && Number.isFinite(Number(r.dinero)) ? Number(r.dinero) : null,
  }
}

function resolverIncluidos(db: Db, xs: PedidoRun['incluir'], ahora: number): Incluido[] {
  const out = new Map<number, Incluido>()
  for (const x of xs ?? []) {
    let id: number | null = null
    if (typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x.trim()))) id = leerEntidad(db, Number(x))?.id ?? null
    else {
      const o = typeof x === 'string' ? { nombre: x, tipo: undefined as string | undefined } : x
      const m = typeof x === 'string' ? /^(persona|proyecto|agrupacion|dominio|lugar|concepto)\s*:\s*(.+)$/i.exec(x.trim()) : null
      const nombre = (m ? m[2] : o.nombre ?? '').trim()
      const tipo = (m ? m[1].toLowerCase() : o.tipo) as TipoEntidad | undefined
      if (!nombre) continue
      id = entidadPorNombre(db, nombre) ?? asegurarEntidad(db, { tipo: TIPOS_ENTIDAD.includes(tipo as TipoEntidad) ? tipo! : 'proyecto', nombre }, ahora)
    }
    const e = id ? leerEntidad(db, id) : null
    if (e) out.set(e.id, { id: e.id, nombre: e.nombre, tipo: e.tipo })
  }
  return [...out.values()]
}

/** Por cada proyecto o persona incluida: lo que se sabe de ella, y lo que aportan los agentes de la liga que la conocen. */
async function reunirContexto(db: Db, incluidos: Incluido[], ahora: number, o: { conAgentes?: boolean } = {}): Promise<{ texto: string; agentes: AgenteEnRun[] }> {
  const partes: string[] = []
  const agentes: AgenteEnRun[] = []
  const proyectos = new Map((db.prepare('SELECT id, nombre FROM proyectos').all() as { id: string; nombre: string }[]).map((p) => [p.id, norm(p.nombre)]))
  const liga = o.conAgentes === false ? [] : listar(db, { estado: 'activo' }).filter((f) => f.clase === 'generativo')
  for (const e of incluidos.slice(0, 8)) {
    const clave = personaje(db, `entidad:${e.id}`).clave
    const h = leerHistoria(db, clave)
    const inv = inventarioParaPrompt(db, clave, 8)
    const abiertas = listarMisiones(db, { personaje: clave, abiertas: true, limite: 6 })
    const suyas = listarMisiones(db, { entidadId: e.id, abiertas: true, limite: 6 }).filter((m) => m.personaje === 'jugador')
    const piezas = listarPiezas(db, { entidad: e.id, limite: 5 }).piezas
    let aporte = ''
    const conoce = liga.filter((f) => (f.proyectoId && proyectos.get(f.proyectoId) === norm(e.nombre)) || norm(especializacion(db, f.id) ?? '') === norm(e.nombre))
    for (const f of conoce.slice(0, 1)) {
      if (agentes.length >= 2) break
      try {
        const { tarea } = await Promise.race([
          encargarYa(db, f.id, {
            tipo: 'preparar-run', publicadaPor: 'mastropiero', dominio: e.nombre, proyectoId: f.proyectoId,
            payload: { texto: `El jugador arma una run de trabajo y quiere avanzar en «${e.nombre}». Desde lo que sabés, proponé de 3 a 5 próximos pasos concretos y chicos, que se puedan empezar ya. Sin relleno.` },
          }, ahora),
          new Promise<never>((_, mal) => setTimeout(() => mal(new Error('tardó demasiado')), 45_000)),
        ])
        const texto = typeof tarea.resultado?.texto === 'string' ? tarea.resultado.texto : null
        agentes.push({ id: f.id, nombre: alias(f), tarea: tarea.id, ok: tarea.estado === 'hecha', aporte: texto ? recorte(texto, 800) : null })
        if (texto) aporte = `\n  Lo que propone ${alias(f)} (agente que la conoce): ${recorte(texto, 800)}`
      } catch (err) {
        agentes.push({ id: f.id, nombre: alias(f), tarea: 0, ok: false, aporte: err instanceof Error ? err.message : String(err) })
      }
    }
    partes.push([
      `• ${e.nombre} (${e.tipo})`,
      h.texto ? `  Historia: ${recorte(h.texto, 300)}` : '',
      inv ? `  Inventario:\n${inv.split('\n').map((l) => `  ${l}`).join('\n')}` : '',
      abiertas.length ? `  Sus misiones abiertas: ${abiertas.map((m) => m.titulo).join(' · ')}` : '',
      suyas.length ? `  Lo que el jugador tiene abierto con esto: ${suyas.map((m) => m.titulo).join(' · ')}` : '',
      piezas.length ? `  En su corpus:\n${piezas.map((p) => `  - ${p.titulo}: ${recorte(p.contenido.replace(/\s+/g, ' '), 200)}`).join('\n')}` : '',
      aporte,
    ].filter(Boolean).join('\n'))
  }
  return { texto: partes.join('\n'), agentes }
}

/** Cómo le fue con las runs anteriores: lo que se usa para calibrar la próxima. */
export function calibracion(db: Db, ahora: number, dias = 30): string {
  const filas = db.prepare(
    `SELECT COALESCE(categoria, 'sin categoría') AS categoria, estado, COUNT(*) AS n FROM misiones
     WHERE personaje = 'jugador' AND nivel = 'secundaria' AND creada_en > ? AND estado IN ('hecha', 'parcial', 'no') GROUP BY 1, 2`,
  ).all(ahora - dias * 86_400_000) as { categoria: string; estado: string; n: number }[]
  const por = new Map<string, Record<string, number>>()
  for (const f of filas) por.set(f.categoria, { ...(por.get(f.categoria) ?? {}), [f.estado]: f.n })
  const notas = db.prepare(
    `SELECT titulo, estado, feedback FROM misiones WHERE personaje = 'jugador' AND nivel = 'secundaria' AND feedback IS NOT NULL ORDER BY COALESCE(cerrada_en, creada_en) DESC LIMIT 10`,
  ).all() as { titulo: string; estado: string; feedback: string }[]
  const ultimo = db.prepare(`SELECT texto FROM reportes WHERE tipo = 'run' ORDER BY id DESC LIMIT 1`).get() as { texto: string } | undefined
  return [
    por.size ? `Cómo le fue por categoría (últimos ${dias} días):\n${[...por].map(([c, e]) => `- ${c}: ${e.hecha ?? 0} hechas, ${e.parcial ?? 0} a medias, ${e.no ?? 0} no`).join('\n')}` : '',
    notas.length ? `Lo que te dijo de bandas anteriores:\n${notas.map((x) => `- «${x.titulo}» [${x.estado}]: ${recorte(x.feedback, 200)}`).join('\n')}` : '',
    ultimo ? `Tu último reporte de run: ${recorte(ultimo.texto, 600)}` : '',
  ].filter(Boolean).join('\n')
}

const SISTEMA_RUN = `Sos Mastropiero y armás una run: una tanda de misiones secundarias para que el jugador trabaje ahora, exactamente en el formato que pidió.
Reglas:
- Respetá su pedido: cuántas misiones, de cuántos minutos, su intensidad y energía (con la cabeza apagada, tareas mecánicas y cortas; en modo profundo, pocas y hondas), sus recursos y lo que excluye.
- Cada misión es una acción concreta que se empieza ya («Escribir el mail a…», «Revisar la escena 7»), no un tema. Título corto (máximo 70 caracteres).
- «detalle»: la subdescripción, una o dos frases con el primer paso y qué es «hecho» para esa banda. Vacía si pidió sin subdescripción.
- Empujá sus primarias de la semana: «primaria» es el número de la lista que empuja, o null.
- Si una misión usa plata, poné «gasto» (número); el total no puede pasar de lo disponible. Si involucra a alguien, «con».
- Usá la calibración: lo que suele saltear, achicalo o cambialo; lo que funciona, repetilo.
- Si su memoria dice en qué horas rinde más y en cuáles menos, ubicá lo hondo en sus horas buenas y lo liviano, mecánico o introspectivo donde baja.
- Por defecto, arrancá con una victoria rápida y alterná tareas chicas y concretas (que terminan con algo hecho) con otras más grandes: la run existe para que haga más, no para que se sienta en deuda.
- Si pidió pausas o el formato lo pide, incluí misiones de categoría «pausa».
- Una side quest abierta entra solo si encaja con dónde va a estar o lo que va a hacer.
- Solo usá lo que está en su memoria, sus misiones, lo que dijo y el contexto. No inventes proyectos, personas ni tareas; si sabés poco, menos misiones y buenas.
- No metas tareas sobre la plataforma misma salvo que él lo pida.
- «resumen»: una o dos oraciones, como si le hablaras: el sentido de la run.
Forma: {"resumen": string, "misiones": [{"titulo": string, "detalle": string, "minutos": number, "primaria": number | null, "categoria": string, "con": string | null, "gasto": number | null}]}`

type Propuesta = { titulo: string; detalle: string | null; minutos: number; primaria: number | null; categoria: string | null; con: string | null; gasto: number | null }

/** Pone horario a lo propuesto: en orden, sin pisar lo ocupado (agenda y lo que se conserva), dentro de la ventana. */
export function programar(
  ps: Propuesta[], o: { desde: number; hasta: number; banda: number[] | null; cantidad: number | null; ocupado: [number, number][]; dinero: number | null; excluir: string | null },
): (Propuesta & { inicio: string; fin: string })[] {
  const out: (Propuesta & { inicio: string; fin: string })[] = []
  const prohibidas = (o.excluir ?? '').split(/[,;]/).map((x) => norm(x)).filter((x) => x.length >= 3)
  let cursor = o.desde
  let gastado = 0
  for (const p of ps) {
    if (o.cantidad != null && out.length >= o.cantidad) break
    if (prohibidas.some((x) => norm(p.titulo).includes(x))) continue
    if (p.gasto != null) {
      if (o.dinero == null || gastado + p.gasto > o.dinero) continue
      gastado += p.gasto
    }
    const pedido = Number(p.minutos) || o.banda?.[0] || 25
    const min = o.banda?.length ? o.banda.reduce((m, x) => (Math.abs(x - pedido) < Math.abs(m - pedido) ? x : m), o.banda[0]) : Math.max(5, Math.min(120, Math.round(pedido)))
    let choque = o.ocupado.find(([a, b]) => cursor < b && a < cursor + min)
    while (choque) {
      cursor = choque[1]
      choque = o.ocupado.find(([a, b]) => cursor < b && a < cursor + min)
    }
    if (cursor + min > o.hasta) break
    out.push({ ...p, minutos: min, inicio: aHora(cursor), fin: aHora(cursor + min) })
    cursor += min
  }
  return out
}

function deModelo(x: any): Propuesta | null {
  const titulo = typeof x?.titulo === 'string' ? x.titulo.trim().slice(0, 160) : ''
  if (!titulo) return null
  const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  return {
    titulo, detalle: typeof x.detalle === 'string' && x.detalle.trim() ? x.detalle.trim().slice(0, 500) : null, minutos: num(x.minutos) ?? 0,
    primaria: num(x.primaria), categoria: typeof x.categoria === 'string' ? x.categoria.trim().slice(0, 40) || null : null,
    con: typeof x.con === 'string' && x.con.trim() ? x.con.trim().slice(0, 80) : null, gasto: num(x.gasto),
  }
}

function describirPedido(p: PedidoResuelto): string {
  return [
    `De ${p.inicio} a ${p.fin} (${p.duracion} minutos).`,
    p.banda ? `Bandas de ${p.banda.join(' o ')} minutos.` : 'Largo de cada misión: elegilo vos según la tarea.',
    p.cantidad ? `Cantidad: ${p.cantidad} misiones.` : '',
    p.intensidad ? `Intensidad mental: ${p.intensidad} de 5.` : '',
    p.energia ? `Cómo está: ${p.energia}.` : '',
    p.dinero != null ? `Plata disponible para gastar: ${p.dinero}.` : 'No declaró plata para gastar: nada que cueste.',
    p.recursos ? `Recursos y contexto: ${p.recursos}.` : '',
    p.excluir ? `No quiere: ${p.excluir}.` : '',
    p.formato ? `Formato que pide: ${p.formato}.` : '',
    p.subdescripcion === false ? 'Sin subdescripción.' : '',
    p.texto ? `Lo que te dijo al pedirla: «${p.texto}»` : '',
  ].filter(Boolean).join(' ')
}

async function generar(
  db: Db, fecha: string, p: PedidoResuelto, o: { desde: number; ocupado: [number, number][]; conservadas: Mision[]; ajuste?: string | null; contexto: string; cantidad: number | null; ahora: number },
): Promise<{ resumen: string | null; misiones: (Propuesta & { inicio: string; fin: string })[]; modelo: string }> {
  const semana = semanaDe(o.ahora)
  const primarias = listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana, estados: ['activa'] })
  const principal = principalDe(db, 'jugador')
  const terciarias = listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria', estados: ['activa'], limite: 10 })
  const charla = charlaReciente(db, o.ahora, 12, 12)
  const usuario = [
    `Fecha: ${fecha}. ${describirPedido(p)}`,
    o.ajuste ? `\nCAMBIO QUE PIDE AHORA (manda sobre lo anterior): ${o.ajuste}` : '',
    o.conservadas.length ? `\nYa están en la run y se quedan (no las repitas):\n${o.conservadas.map((m) => `- ${m.inicio} ${m.titulo} [${m.estado}]`).join('\n')}` : '',
    principal ? `\nSu misión principal: ${principal.titulo}` : '',
    primarias.length ? `\nSus primarias de la semana:\n${primarias.map((m, i) => `${i + 1}. ${m.titulo}${m.detalle ? ` — ${recorte(m.detalle, 160)}` : ''}`).join('\n')}` : '\nNo tiene primarias aceptadas esta semana.',
    o.contexto ? `\nLo que pidió meter en esta run:\n${o.contexto}` : '',
    aportesParaRun(db, o.ahora) ? `\nLo que le dejaron sus ayudantes de la liga estos días (material: si sirve, armá bandas que lo usen y decí de quién viene):\n${aportesParaRun(db, o.ahora)}` : '',
    terciarias.length ? `\nSide quests abiertas:\n${terciarias.map((m) => `- ${m.titulo}${m.disparador ? ` (cuando: ${Object.values(m.disparador).filter(Boolean).join(', ')})` : ''}`).join('\n')}` : '',
    `\nLo que sabés de él:\n${memoriaParaPrompt(db, 40) || '- (casi nada todavía)'}`,
    charla.length ? `\nLo que te dijo en las últimas horas:\n${charla.map((c) => `- ${c}`).join('\n')}` : '',
    `\n${calibracion(db, o.ahora) || 'Todavía no hay runs anteriores para calibrar.'}`,
  ].filter(Boolean).join('\n')
  const { datos, modelo } = await pedirJson<{ resumen?: string; misiones?: any[] }>({ db, clase: 'mastropiero', agenteId: 'run' }, SISTEMA_RUN, usuario, { temperatura: 0.6, maxTokens: 6000 })
  const ps = (datos.misiones ?? []).map(deModelo).filter((x): x is Propuesta => !!x)
  const gastado = o.conservadas.reduce((s, m) => s + (m.gasto ?? 0), 0)
  const misiones = programar(ps, {
    desde: o.desde, hasta: aMin(p.fin), banda: p.banda ?? null, cantidad: o.cantidad, ocupado: o.ocupado,
    dinero: p.dinero != null ? Math.max(0, p.dinero - gastado) : null, excluir: p.excluir ?? null,
  })
  const ref = primarias
  return { resumen: typeof datos.resumen === 'string' ? datos.resumen.trim() : null, misiones: misiones.map((m) => ({ ...m, primaria: m.primaria && ref[m.primaria - 1] ? ref[m.primaria - 1].id : null })), modelo }
}

function eventosOcupados(eventos: Evento[], fecha: string): { inicio: string; fin: string; titulo: string }[] {
  const hm = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes() }
  return eventos.filter((e) => !e.todoElDia && fechaLocal(e.inicio) === fecha).map((e) => ({ inicio: aHora(hm(e.inicio)), fin: aHora(Math.max(hm(e.inicio) + 5, hm(e.fin) || 24 * 60 - 1)), titulo: e.titulo }))
}

function guardarSecundarias(db: Db, runId: number, xs: (Propuesta & { inicio: string; fin: string })[], ahora: number, desdeOrden = 0) {
  xs.forEach((m, i) => insertarMision(db, {
    personaje: 'jugador', asignadaPor: 'mastropiero', nivel: 'secundaria', titulo: m.titulo, detalle: m.detalle, categoria: m.categoria, padreId: m.primaria,
    runId, inicio: m.inicio, fin: m.fin, minutos: m.minutos, con: m.con, gasto: m.gasto, orden: desdeOrden + i, estado: 'activa', creadaPor: 'mastropiero',
  }, ahora))
}

/**
 * Prepara una run a pedido: interpreta, reúne contexto (con los agentes que sirvan), genera y programa.
 * Devuelve una propuesta: se puede rehacer cuantas veces quiera antes de arrancarla.
 */
/** En qué paso va la run que se está armando (para que la pantalla lo diga mientras espera). */
let pasoRun: { paso: string; desde: number } | null = null
export const pasoDeRun = () => pasoRun

export async function prepararRun(db: Db, pedido: PedidoRun, o: { ahora?: number; conAgentes?: boolean } = {}): Promise<{ run: Run; misiones: Mision[]; avisos: string[] }> {
  try {
    return await prepararRunPasos(db, pedido, o)
  } finally {
    pasoRun = null
  }
}

async function prepararRunPasos(db: Db, pedido: PedidoRun, o: { ahora?: number; conAgentes?: boolean }): Promise<{ run: Run; misiones: Mision[]; avisos: string[] }> {
  const paso = (p: string) => (pasoRun = { paso: p, desde: Date.now() })
  paso('entendiendo tu pedido')
  const ahora = o.ahora ?? Date.now()
  if (pedido.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(pedido.fecha)) throw new Error('Fecha inválida (YYYY-MM-DD)')
  if (pedido.fecha && pedido.fecha < fechaLocal(ahora)) throw new Error('Esa fecha ya pasó')
  const fecha = pedido.fecha || fechaLocal(ahora)
  const p = await resolverPedido(db, pedido, ahora)
  paso('mirando tu agenda')
  const { eventos, avisos } = await agendaDelDia(fecha)
  const fijos = eventosOcupados(eventos, fecha).filter((e) => aMin(e.inicio) < aMin(p.fin) && aMin(e.fin) > aMin(p.inicio))
  paso(p.incluir.length ? 'consultando a la liga sobre lo que pediste' : 'juntando tu contexto')
  const ctx = await reunirContexto(db, p.incluir, ahora, { conAgentes: o.conAgentes })
  paso('armando las bandas')
  // Una propuesta anterior de hoy sin arrancar queda descartada: la nueva la reemplaza.
  for (const r of listarRuns(db, { fecha, estados: ['propuesta'] })) descartarRun(db, r.id, ahora)
  const g = await generar(db, fecha, p, { desde: aMin(p.inicio), ocupado: fijos.map((f) => [aMin(f.inicio), aMin(f.fin)]), conservadas: [], contexto: ctx.texto, cantidad: p.cantidad ?? null, ahora })
  if (!g.misiones.length) throw new Error('El modelo no propuso ninguna misión que entre en la run')
  const r = db.prepare(
    `INSERT INTO runs (fecha, inicio, fin, estado, pedido, fijos, agentes, resumen, modelo, creada_en) VALUES (?, ?, ?, 'propuesta', ?, ?, ?, ?, ?, ?)`,
  ).run(fecha, p.inicio, p.fin, JSON.stringify(p), JSON.stringify(fijos), JSON.stringify(ctx.agentes), g.resumen, g.modelo, ahora)
  const id = Number(r.lastInsertRowid)
  guardarSecundarias(db, id, g.misiones, ahora)
  return { run: leerRun(db, id)!, misiones: misionesDeRun(db, id), avisos }
}

/**
 * Rehace una run con un cambio en palabras («más corto», «sacá lo de X»). Conserva lo fijado, lo marcado
 * y, si ya arrancó, lo que ya pasó; lo demás se vuelve a armar desde donde corresponde.
 */
export async function rehacerRun(db: Db, id: number, cambio: string | null, o: { ahora?: number } = {}): Promise<{ run: Run; misiones: Mision[] }> {
  const ahora = o.ahora ?? Date.now()
  const run = leerRun(db, id)
  if (!run) throw new Error(`No existe la run ${id}`)
  if (run.estado !== 'propuesta' && run.estado !== 'en_curso') throw new Error('Esa run ya terminó')
  const d = new Date(ahora)
  const ahoraMin = d.getHours() * 60 + d.getMinutes()
  const todas = misionesDeRun(db, id)
  const conservadas = todas.filter((m) => m.fijada || ['hecha', 'parcial', 'no'].includes(m.estado) || (run.estado === 'en_curso' && aMin(m.inicio!) < ahoraMin))
  // Lo anterior es la base; la cantidad solo se conserva si él la dijo (si no, sale de la nueva duración y banda).
  // El fin viejo no viaja: si cambia la duración, el fin sale de ella.
  const { cantidad: cantidadVieja, cantidadDicha, fin: _fin, ...previo } = run.pedido
  const p = cambio?.trim()
    ? await resolverPedido(db, { ...previo, ...(cantidadDicha ? { cantidad: cantidadVieja } : {}), incluir: run.pedido.incluir.map((e) => e.id), plantilla: run.pedido.plantilla, inicio: run.inicio, texto: cambio }, ahora)
    : run.pedido
  const pedido: PedidoResuelto = { ...p, inicio: run.inicio, texto: [run.pedido.texto, cambio].filter(Boolean).join(' / ') || null }
  if (cambio?.trim() && p.duracion !== run.pedido.duracion) pedido.fin = aHora(Math.min(24 * 60 - 1, aMin(run.inicio) + p.duracion))
  else pedido.fin = cambio?.trim() && p.fin !== run.pedido.fin && aMin(p.fin) > aMin(run.inicio) ? p.fin : run.fin
  const desde = run.estado === 'en_curso' ? Math.max(aMin(run.inicio), Math.ceil(ahoraMin / 5) * 5) : aMin(run.inicio)
  const ocupado: [number, number][] = [...run.fijos.map((f) => [aMin(f.inicio), aMin(f.fin)] as [number, number]), ...conservadas.map((m) => [aMin(m.inicio!), aMin(m.fin!)] as [number, number])]
  const ctx = await reunirContexto(db, pedido.incluir, ahora, { conAgentes: false })
  const cantidad = pedido.cantidad != null ? Math.max(0, pedido.cantidad - conservadas.length) : null
  // Primero se genera; recién con lo nuevo en la mano se reemplaza lo viejo (si el modelo falla, la run queda como estaba).
  const g = cantidad === 0 ? { resumen: run.resumen, misiones: [], modelo: run.modelo ?? '' } : await generar(db, run.fecha, pedido, { desde, ocupado, conservadas, ajuste: cambio, contexto: ctx.texto, cantidad, ahora })
  // Ojo: `NOT IN (NULL)` no borra nada en SQL; sin nada que conservar, se borra todo lo de la run.
  if (conservadas.length) db.prepare(`DELETE FROM misiones WHERE run_id = ? AND id NOT IN (${conservadas.map(() => '?').join(',')})`).run(id, ...conservadas.map((m) => m.id))
  else db.prepare('DELETE FROM misiones WHERE run_id = ?').run(id)
  guardarSecundarias(db, id, g.misiones, ahora, conservadas.length)
  db.prepare('UPDATE runs SET pedido = ?, fin = ?, resumen = COALESCE(?, resumen), modelo = ? WHERE id = ?').run(JSON.stringify(pedido), pedido.fin, g.resumen, g.modelo, id)
  return { run: leerRun(db, id)!, misiones: misionesDeRun(db, id) }
}

/** Arranca una propuesta: «arrancar» es ahora, así que la run entera se corre a este minuto (antes o después de lo previsto). */
export function arrancarRun(db: Db, id: number, ahora = Date.now()): Run {
  const run = leerRun(db, id)
  if (!run) throw new Error(`No existe la run ${id}`)
  if (run.estado !== 'propuesta') throw new Error('Solo se arranca una run propuesta')
  const otra = db.prepare(`SELECT id FROM runs WHERE estado = 'en_curso'`).get() as { id: number } | undefined
  if (otra) throw new Error('Ya hay una run en curso: cerrala antes de arrancar otra')
  const d = new Date(ahora)
  const ahoraMin = d.getHours() * 60 + d.getMinutes()
  const delta = ahoraMin - aMin(run.inicio)
  const mover = (h: string) => aHora(Math.max(0, Math.min(24 * 60 - 1, aMin(h) + delta)))
  if (delta !== 0 || run.fecha !== fechaLocal(ahora)) {
    for (const m of misionesDeRun(db, id)) db.prepare('UPDATE misiones SET inicio = ?, fin = ? WHERE id = ?').run(mover(m.inicio!), mover(m.fin!), m.id)
    db.prepare('UPDATE runs SET inicio = ?, fin = ?, fecha = ? WHERE id = ?').run(mover(run.inicio), mover(run.fin), fechaLocal(ahora), id)
  }
  db.prepare(`UPDATE runs SET estado = 'en_curso', iniciada_en = ?, ultima_hora = 0 WHERE id = ?`).run(ahora, id)
  return leerRun(db, id)!
}

export function descartarRun(db: Db, id: number, ahora = Date.now()) {
  const run = leerRun(db, id)
  if (!run) throw new Error(`No existe la run ${id}`)
  if (run.estado !== 'propuesta') throw new Error('Solo se descarta una propuesta; una run en curso se cierra')
  db.prepare(`UPDATE runs SET estado = 'descartada', cerrada_en = ? WHERE id = ?`).run(ahora, id)
  db.prepare(`UPDATE misiones SET estado = 'descartada', cerrada_en = ? WHERE run_id = ?`).run(ahora, id)
}

/** El feedback de una banda: hecha, a medias o no, y una nota si quiere. */
export function marcarSecundaria(db: Db, id: number, estado: 'hecha' | 'parcial' | 'no' | 'activa', nota?: string | null, ahora = Date.now()): Mision {
  const m = leerMision(db, id)
  if (!m) throw new Error(`No existe la misión ${id}`)
  if (!['hecha', 'parcial', 'no', 'activa'].includes(estado)) throw new Error('Estado inválido (hecha | parcial | no | activa)')
  const feedback = nota?.trim() ? [m.feedback, nota.trim()].filter(Boolean).join(' · ') : m.feedback
  return actualizarMision(db, id, { estado, feedback }, { por: 'operador', ahora })
}

/** La banda que toca ahora y las que siguen. */
export function enCurso(db: Db, ahora = Date.now()): { run: Run; actual: Mision | null; siguientes: Mision[]; restan: number | null } | null {
  const run = runActual(db, ahora)
  if (!run || run.estado !== 'en_curso') return null
  const d = new Date(ahora)
  const min = d.getHours() * 60 + d.getMinutes()
  const ms = misionesDeRun(db, run.id)
  const actual = ms.find((m) => aMin(m.inicio!) <= min && min < aMin(m.fin!)) ?? null
  return { run, actual, siguientes: ms.filter((m) => aMin(m.inicio!) > min).slice(0, 3), restan: actual ? aMin(actual.fin!) - min : null }
}

// ─── reportes ───────────────────────────────────────────────────────────

export type Reporte = { id: number; tipo: 'hora' | 'run' | 'semana'; personaje: string; desde: number; hasta: number; runId: number | null; texto: string; metricas: any; piezaId: number | null; creadoEn: number }
const deReporte = (r: any): Reporte => ({ id: r.id, tipo: r.tipo, personaje: r.personaje, desde: r.desde, hasta: r.hasta, runId: r.run_id, texto: r.texto, metricas: json(r.metricas, null), piezaId: r.pieza_id, creadoEn: r.creado_en })

export function listarReportes(db: Db, f: { tipo?: string; runId?: number; limite?: number } = {}): Reporte[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (f.tipo) where.push('tipo = ?'), args.push(f.tipo)
  if (f.runId != null) where.push('run_id = ?'), args.push(f.runId)
  return db.prepare(`SELECT * FROM reportes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args, f.limite ?? 30).map(deReporte)
}

function guardarReporte(db: Db, r: Omit<Reporte, 'id' | 'creadoEn' | 'piezaId'> & { enCorpus?: string | null }, ahora: number): Reporte {
  const pieza = r.enCorpus
    ? insertar(db, { fuente: 'agentes', nivel: 'generada', titulo: r.enCorpus, contenido: r.texto, estado: 'disponible', etiquetas: ['reporte', r.tipo], autor: 'Mastropiero', fecha: new Date(ahora).toISOString() }, ahora)
    : null
  const x = db.prepare('INSERT INTO reportes (tipo, personaje, desde, hasta, run_id, texto, metricas, pieza_id, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.tipo, r.personaje, r.desde, r.hasta, r.runId, r.texto, r.metricas ? JSON.stringify(r.metricas) : null, pieza, ahora)
  return deReporte(db.prepare('SELECT * FROM reportes WHERE id = ?').get(Number(x.lastInsertRowid)))
}

const cuentas = (ms: Mision[]) => ({
  hechas: ms.filter((m) => m.estado === 'hecha').length, parciales: ms.filter((m) => m.estado === 'parcial').length,
  no: ms.filter((m) => m.estado === 'no').length, sinMarcar: ms.filter((m) => m.estado === 'activa').length, total: ms.length,
  minutos: Math.round(ms.reduce((s, m) => s + (m.estado === 'hecha' ? m.minutos ?? 0 : m.estado === 'parcial' ? (m.minutos ?? 0) / 2 : 0), 0)),
})

/**
 * El latido de las runs: cada hora cumplida de una run en curso deja un reporte corto en Hoy (sin modelo),
 * y una run vencida hace 15 minutos se cierra sola con su reporte. Devuelve los textos a dejar en Hoy.
 */
export async function latidoRuns(db: Db, ahora = Date.now(), o: { cerrarConModelo?: boolean } = {}): Promise<string[]> {
  const dichos: string[] = []
  const run = db.prepare(`SELECT * FROM runs WHERE estado = 'en_curso' ORDER BY id DESC LIMIT 1`).get()
  if (!run) return dichos
  const r = deRun(run)
  const d = new Date(ahora)
  const min = (r.fecha === fechaLocal(ahora) ? 0 : 24 * 60) + d.getHours() * 60 + d.getMinutes()
  const ini = aMin(r.inicio)
  const horas = Math.floor((Math.min(min, aMin(r.fin)) - ini) / 60)
  if (horas > r.ultimaHora) {
    const desde = ini + (horas - 1) * 60
    const ms = misionesDeRun(db, r.id).filter((m) => aMin(m.inicio!) >= desde && aMin(m.inicio!) < desde + 60)
    const c = cuentas(ms)
    const partes = [c.hechas && `${c.hechas} hecha${c.hechas > 1 ? 's' : ''}`, c.parciales && `${c.parciales} a medias`, c.no && `${c.no} que no salió`, c.sinMarcar && `${c.sinMarcar} sin marcar`].filter(Boolean)
    const texto = `${horas === 1 ? 'Primera hora' : `Hora ${horas}`} de la run (${aHora(desde)}–${aHora(desde + 60)}): ${partes.length ? listaY(partes as string[]) : 'nada marcado todavía'}. ¿Algo para ajustar en lo que sigue? Si me contás qué trabó o qué funcionó, calibro.`
    guardarReporte(db, { tipo: 'hora', personaje: 'jugador', desde: ahora - 3_600_000, hasta: ahora, runId: r.id, texto, metricas: c }, ahora)
    db.prepare('UPDATE runs SET ultima_hora = ? WHERE id = ?').run(horas, r.id)
    dichos.push(texto)
  }
  if (min >= aMin(r.fin) + 15) {
    const rep = await cerrarRun(db, r.id, { ahora, conModelo: o.cerrarConModelo !== false })
    dichos.push(rep.texto)
  }
  return dichos
}

const listaY = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`)

const SISTEMA_REPORTE_RUN = `Sos Mastropiero y escribís el reporte de una run que el jugador acaba de terminar.
- Dos o tres párrafos cortos, en castellano rioplatense, como si le hablaras: qué salió, qué no y qué te dicen sus notas.
- Cerrá con uno a tres ajustes concretos para la próxima run (largo de bandas, tipo de tareas, orden, horario). Sin sermones.
- No inventes: usá solo las misiones, sus marcas y sus notas.
Forma: {"texto": string, "ajustes": [string]}`

/** Cierra una run y deja su reporte (al corpus como generado, y como calibración para la próxima). */
export async function cerrarRun(db: Db, id: number, o: { ahora?: number; conModelo?: boolean } = {}): Promise<Reporte> {
  const ahora = o.ahora ?? Date.now()
  const run = leerRun(db, id)
  if (!run) throw new Error(`No existe la run ${id}`)
  if (run.estado !== 'en_curso') throw new Error('Solo se cierra una run en curso')
  const ms = misionesDeRun(db, id)
  const c = cuentas(ms)
  const porPrimaria = new Map<string, number>()
  for (const m of ms.filter((x) => x.padreId && ['hecha', 'parcial'].includes(x.estado))) {
    const p = leerMision(db, m.padreId!)
    if (p) porPrimaria.set(p.titulo, (porPrimaria.get(p.titulo) ?? 0) + (m.estado === 'hecha' ? m.minutos ?? 0 : (m.minutos ?? 0) / 2))
  }
  const metricas = { ...c, porPrimaria: Object.fromEntries([...porPrimaria].map(([k, v]) => [k, Math.round(v)])), agentes: run.agentes.length }
  const base = `Run del ${run.fecha}, ${run.inicio}–${run.fin}: ${c.hechas} de ${c.total} hechas${c.parciales ? `, ${c.parciales} a medias` : ''}${c.no ? `, ${c.no} que no` : ''}${c.sinMarcar ? `, ${c.sinMarcar} sin marcar` : ''}. ${c.minutos} minutos de foco.`
  let texto = base
  if (o.conModelo !== false) {
    try {
      const { datos } = await pedirJson<{ texto?: string; ajustes?: string[] }>({ db, clase: 'mastropiero', agenteId: 'reporte' }, SISTEMA_REPORTE_RUN, [
        base, run.pedido.texto ? `Lo que pidió: «${run.pedido.texto}»` : '',
        `Misiones:\n${ms.map((m) => `- ${m.inicio} ${m.titulo} [${m.estado}]${m.feedback ? ` — nota: ${m.feedback}` : ''}`).join('\n')}`,
      ].filter(Boolean).join('\n'), { temperatura: 0.4, maxTokens: 1500 })
      if (typeof datos.texto === 'string' && datos.texto.trim()) {
        texto = [datos.texto.trim(), ...(Array.isArray(datos.ajustes) && datos.ajustes.length ? [`Para la próxima: ${datos.ajustes.filter((a) => typeof a === 'string').join(' · ')}`] : [])].join('\n\n')
      }
    } catch {
      // sin modelo, queda el reporte con números
    }
  }
  db.prepare(`UPDATE runs SET estado = 'cerrada', cerrada_en = ?, reporte = ? WHERE id = ?`).run(ahora, texto, id)
  return guardarReporte(db, { tipo: 'run', personaje: 'jugador', desde: run.iniciadaEn ?? run.creadaEn, hasta: ahora, runId: id, texto, metricas, enCorpus: `Reporte de run · ${run.fecha} ${run.inicio}` }, ahora)
}

/** Los números de una semana, sin modelo. */
export function metricasSemana(db: Db, semana: string) {
  const { desde, hasta } = diasDeSemana(semana)
  const primarias = conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana }).filter((m) => m.estado !== 'sugerida' && m.estado !== 'descartada'))
  const runs = listarRuns(db, { desde, hasta, estados: ['en_curso', 'cerrada'] })
  const secundarias = runs.flatMap((r) => misionesDeRun(db, r.id))
  const [a, m, d] = desde.split('-').map(Number)
  const ini = new Date(a, m - 1, d).getTime()
  const fin = ini + 7 * 86_400_000
  const terciarias = (db.prepare(`SELECT COUNT(*) AS n FROM misiones WHERE personaje = 'jugador' AND nivel = 'terciaria' AND estado = 'hecha' AND cerrada_en >= ? AND cerrada_en < ?`).get(ini, fin) as { n: number }).n
  const deOtros = listarMisiones(db, { asignadaPor: 'jugador', excluirPersonaje: 'jugador', abiertas: true })
  const porCategoria: Record<string, number> = {}
  for (const x of secundarias.filter((s) => s.estado === 'hecha')) porCategoria[x.categoria ?? 'sin categoría'] = (porCategoria[x.categoria ?? 'sin categoría'] ?? 0) + (x.minutos ?? 0)
  return {
    semana, desde, hasta, runs: runs.length, secundarias: cuentas(secundarias), terciariasHechas: terciarias,
    primarias: primarias.map((p) => ({ id: p.id, titulo: p.titulo, estado: p.estado, progreso: p.avance.progreso, bandas: p.avance.bandas.hechas, minutos: p.avance.minutos })),
    minutosPorCategoria: porCategoria, pendientesDeOtros: deOtros.map((x) => ({ id: x.id, titulo: x.titulo, quien: x.personaje, vence: x.vence })),
  }
}

const SISTEMA_REPORTE_SEMANA = `Sos Mastropiero y escribís el reporte semanal del jugador: todo lo hecho, el avance de sus primarias, sus runs y lo que quedó.
- Tres a cinco párrafos cortos, en castellano rioplatense, cálido y honesto: qué avanzó de verdad, qué quedó quieto, patrones que ves (horarios, tipos de tarea, energía).
- Nombrá las primarias por su título y su progreso. Mencioná lo que otros le deben si hay.
- Cerrá con una sugerencia para la semana que viene. Solo con los datos que tenés.
Forma: {"texto": string}`

export async function reporteSemana(db: Db, semana = semanaDe(), o: { ahora?: number; conModelo?: boolean } = {}): Promise<Reporte> {
  const ahora = o.ahora ?? Date.now()
  const met = metricasSemana(db, semana)
  const base = `Semana ${semana}: ${met.runs} runs, ${met.secundarias.hechas} de ${met.secundarias.total} bandas hechas (${met.secundarias.minutos} minutos de foco), ${met.terciariasHechas} side quests cumplidas.`
  let texto = [base, ...met.primarias.map((p) => `- ${p.titulo}: ${p.progreso}% · ${p.bandas} bandas · ${p.minutos} min`)].join('\n')
  if (o.conModelo !== false) {
    try {
      const { datos } = await pedirJson<{ texto?: string }>({ db, clase: 'mastropiero', agenteId: 'reporte' }, SISTEMA_REPORTE_SEMANA, JSON.stringify(met), { temperatura: 0.4, maxTokens: 2500 })
      if (typeof datos.texto === 'string' && datos.texto.trim()) texto = datos.texto.trim()
    } catch {
      // queda el de números
    }
  }
  const { desde, hasta } = diasDeSemana(semana)
  const [a, m, d] = desde.split('-').map(Number)
  return guardarReporte(db, { tipo: 'semana', personaje: 'jugador', desde: new Date(a, m - 1, d).getTime(), hasta: Math.min(ahora, new Date(a, m - 1, d + 7).getTime()), runId: null, texto, metricas: met, enCorpus: `Reporte semanal · ${semana} (${desde} a ${hasta})` }, ahora)
}

// ─── terciarias y misiones para otros ───────────────────────────────────

export function anotarSideQuest(db: Db, s: { titulo: string; detalle?: string | null; disparador?: Disparador | null; personaje?: string; asignadaPor?: string; vence?: string | null; sugerida?: boolean; creadaPor?: string }, ahora = Date.now()): Mision {
  const disp = s.disparador ? definido(s.disparador) : null
  // La misma side quest dicha dos veces (o anotada por Mastropiero y por el escriba) no se duplica.
  const clave = personaje(db, s.personaje ?? 'jugador').clave
  const n = norm(s.titulo)
  const ya = listarMisiones(db, { personaje: clave, nivel: 'terciaria', abiertas: true }).find((m) => {
    const x = norm(m.titulo)
    return x === n || (x.length > 12 && n.includes(x)) || (n.length > 12 && x.includes(n))
  })
  if (ya) return ya.estado === 'sugerida' && !s.sugerida ? actualizarMision(db, ya.id, { estado: 'activa', disparador: disp ?? ya.disparador }, { ahora }) : ya
  return insertarMision(db, {
    personaje: s.personaje ?? 'jugador', asignadaPor: s.asignadaPor ?? 'jugador', nivel: 'terciaria', titulo: s.titulo, detalle: s.detalle,
    disparador: disp && Object.keys(disp).length ? disp : null, vence: s.vence ?? null, estado: s.sugerida ? 'sugerida' : 'activa', creadaPor: s.creadaPor ?? 'operador',
  }, ahora)
}

/** Las side quests cuyo disparador (lugar, zona, actividad) aparece en lo que cuenta o en su agenda. */
export function sideQuestsRelevantes(db: Db, contexto: string): Mision[] {
  const t = ` ${norm(contexto)} `
  if (!t.trim()) return []
  return listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria', estados: ['activa'] }).filter((m) => {
    const claves = Object.values(m.disparador ?? {}).filter((x): x is string => typeof x === 'string').flatMap((x) => [norm(x), ...norm(x).split(' ').filter((w) => w.length >= 5)])
    return claves.some((k) => k.length >= 4 && t.includes(` ${k} `))
  })
}

/** Una misión para otro personaje (una persona, un agente), asignada por el jugador. Si la persona no existe, se crea. */
export function asignarMision(db: Db, a: { a: string; titulo: string; detalle?: string | null; vence?: string | null; por?: string; nivel?: NivelMision; crear?: boolean }, ahora = Date.now()): Mision {
  let clave: string
  const nombrada = menciones(db, a.a.startsWith('@') ? a.a : `@${a.a}`)[0]
  if (nombrada && a.a.trim().startsWith('@')) a = { ...a, a: nombrada.clave === 'jugador' ? 'jugador' : nombrada.clave }
  try {
    clave = a.a.includes(':') || /^\d+$/.test(a.a) ? personaje(db, /^\d+$/.test(a.a) ? `entidad:${a.a}` : a.a).clave : (leer(db, a.a) ? `agente:${leer(db, a.a)!.id}` : `entidad:${personaPorNombre(db, a.a) ?? entidadPorNombre(db, a.a) ?? (a.crear !== false ? asegurarEntidad(db, { tipo: 'persona', nombre: a.a }, ahora) : 0)}`)
    clave = personaje(db, clave).clave // la entidad del jugador es el jugador
    // Un alias suyo mal puesto («Amparo» entre los alias del jugador) no debe asignarle a él lo que es de otra persona.
    if (clave === 'jugador' && !esNombreDelJugador(db, a.a)) {
      const otra = personaPorNombre(db, a.a, { sinJugador: true })
      if (otra) clave = `entidad:${otra}`
    }
  } catch (e) {
    throw new Error(`No encuentro a «${a.a}»: ${e instanceof Error ? e.message : e}`)
  }
  return insertarMision(db, { personaje: clave, asignadaPor: a.por ?? 'jugador', nivel: a.nivel ?? 'primaria', titulo: a.titulo, detalle: a.detalle, vence: a.vence ?? null, estado: 'activa', creadaPor: a.por === 'mastropiero' ? 'mastropiero' : 'operador' }, ahora)
}

function esNombreDelJugador(db: Db, nombre: string): boolean {
  const n = norm(nombre)
  const propio = norm(personaje(db, 'jugador').nombre)
  return n === propio || propio.startsWith(`${n} `) || n === 'jugador' || n === 'yo'
}

/** Lo que otros le deben y ya venció (o vence hoy). */
export function seguimientos(db: Db, ahora = Date.now()): Mision[] {
  const hoy = fechaLocal(ahora)
  return listarMisiones(db, { asignadaPor: 'jugador', excluirPersonaje: 'jugador', estados: ['activa'] }).filter((m) => m.vence && m.vence <= hoy)
}

// ─── para Mastropiero ───────────────────────────────────────────────────

/** El bloque de misiones del prompt: corto, lo que importa ahora. */
export function misionesParaPrompt(db: Db, ahora = Date.now(), mensaje = ''): string {
  const principal = principalDe(db, 'jugador')
  const candidatas = listarMisiones(db, { personaje: 'jugador', nivel: 'principal', estados: ['sugerida'] })
  const primarias = conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa', 'hecha', 'parcial', 'sugerida'] }))
  const vivo = enCurso(db, ahora)
  const propuesta = runActual(db, ahora)
  const terciarias = listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria', estados: ['activa'], limite: 10 })
  const tocan = mensaje ? sideQuestsRelevantes(db, mensaje) : []
  const deben = seguimientos(db, ahora)
  const nombre = (k: string) => { try { return personaje(db, k).nombre } catch { return k } }
  return [
    principal ? `Su misión principal: ${principal.titulo}${principal.detalle ? ` — ${principal.detalle}` : ''}` : `Todavía no fijó su misión principal${candidatas.length ? ` (le sugeriste: ${candidatas.map((c) => c.titulo).join(' / ')})` : ''}.`,
    primarias.length ? `Primarias de esta semana (el id es para tus herramientas, no se lo digas):\n${primarias.map((p) => {
      const ayudantes = listarMisiones(db, { padreId: p.id, nivel: 'primaria', estados: ['activa'] }).filter((m) => m.personaje.startsWith('agente:')).map((m) => m.personaje.slice(7))
      return `- (id ${p.id}) ${p.titulo} [${p.estado === 'sugerida' ? 'sugerida, sin aceptar' : `${p.avance.progreso}%, ${p.avance.bandas.hechas} bandas`}]${ayudantes.length ? ` · ayudantes: ${ayudantes.join(', ')}` : ''}`
    }).join('\n')}` : 'No tiene primarias esta semana (podés proponerlas).',
    vivo ? `Run en curso (${vivo.run.inicio}–${vivo.run.fin}): ${vivo.actual ? `ahora toca «${vivo.actual.titulo}», le quedan ${vivo.restan} min` : 'entre bandas'}${vivo.siguientes.length ? `; después: ${vivo.siguientes.map((m) => `${m.inicio} ${m.titulo}`).join(' · ')}` : ''}.`
      : propuesta?.estado === 'propuesta' ? `Hay una run propuesta para hoy (${propuesta.inicio}–${propuesta.fin}) que todavía no arrancó.` : 'No hay run en curso.',
    terciarias.length ? `Side quests abiertas:\n${terciarias.map((m) => `- ${m.titulo}${m.disparador ? ` (se activa: ${Object.values(m.disparador).filter(Boolean).join(', ')})` : ''}`).join('\n')}` : '',
    tocan.length ? `⚑ Lo que acaba de decir toca el disparador de: ${tocan.map((m) => `«${m.titulo}»`).join(', ')}. Recordáselo en una línea, natural.` : '',
    deben.length ? `Seguimientos vencidos (cosas que otros le deben): ${deben.map((m) => `${nombre(m.personaje)}: ${m.titulo} (vencía ${m.vence})`).join(' · ')}.` : '',
  ].filter(Boolean).join('\n')
}

// ─── procesar al jugador ────────────────────────────────────────────────

const SISTEMA_PROCESAR = `Sos Mastropiero y procesás al jugador para armar su ficha de personaje: historia, inventario y candidatas a misión principal.
- historia: su trasfondo y origen en prosa, en segunda persona («Venís de…»), 1 a 3 párrafos; «elementos»: rasgos y elementos base, cortos.
- inventario: lo que tiene, pocas cosas y ciertas (máximo 20). tipo: capital (plata, bienes), conexion (personas o grupos), presencia (sitios, redes, canales), conocimiento (saberes, oficios), herramienta (software, equipos, IAs que usa), acceso (lugares, comunidades, cuentas), recurso (tiempo, espacios, otros). Con «valor» y «unidad» si hay número.
  · conexion: solo si los datos dicen qué relación tiene con él (socia, pareja, cliente, mentor…), y el «detalle» dice esa relación. Que alguien aparezca mucho NO alcanza. Nunca Mastropiero ni las IAs.
  · presencia: solo sitios, cuentas o canales que son SUYOS (o de sus proyectos). Un sitio que visitó, citó o tomó de inspiración no es su presencia.
  · Si dudás, no lo pongas.
- principales: 1 a 3 candidatas a su misión principal, su objetivo de vida, en una frase cada una.
- Solo lo que está en los datos. No inventes nada; si algo no aparece, no lo pongas.
- Castellano rioplatense.
Forma: {"historia": {"texto": string, "elementos": [string]}, "inventario": [{"tipo": string, "nombre": string, "detalle": string, "valor": number | null, "unidad": string | null, "url": string | null}], "principales": [{"titulo": string, "detalle": string}]}`

/**
 * Lee todo lo que sabe del jugador y propone su ficha: historia, inventario, candidatas a principal y primarias de la semana.
 * Todo entra como sugerencia. Las llamadas corren en paralelo.
 */
export async function procesarJugador(db: Db, o: { ahora?: number } = {}): Promise<{ historia: boolean; inventario: number; principales: number; primarias: number }> {
  const ahora = o.ahora ?? Date.now()
  const memoria = memoriaParaPrompt(db, 120)
  const gente = listarEntidades(db, { tipo: 'persona', limite: 25 }).filter((e) => e.piezas > 0).map((e) => e.nombre)
  const proyectos = listarEntidades(db, { tipo: 'proyecto', limite: 25 }).filter((e) => e.piezas > 0).map((e) => e.nombre)
  const propias = (db.prepare(`SELECT titulo, contenido FROM corpus WHERE nivel = 'propia' ORDER BY COALESCE(peso, 0) DESC, id DESC LIMIT 25`).all() as { titulo: string; contenido: string }[])
  const usuario = [
    `Su memoria (lo que te contó):\n${memoria || '- (vacía)'}`,
    gente.length ? `\nPersonas que más aparecen en su material (aparecer no es tener relación: solo sirven para reconocer nombres): ${gente.join(', ')}.` : '',
    proyectos.length ? `\nProyectos que más aparecen: ${proyectos.join(', ')}.` : '',
    propias.length ? `\nFragmentos de su propia voz:\n${propias.map((p) => `- ${p.titulo}: ${recorte(p.contenido.replace(/\s+/g, ' '), 300)}`).join('\n')}` : '',
    `\nInventario que ya tiene (no lo repitas):\n${inventarioParaPrompt(db, 'jugador', 60) || '- nada'}`,
  ].filter(Boolean).join('\n')
  if (!memoria && !propias.length) throw new Error('Todavía no sé nada de vos: contale cosas a Mastropiero o cargá material propio, y después procesamos')
  // Dos llamadas chicas en paralelo (historia y principales por un lado, inventario por otro): la mitad del tiempo.
  const soloEsto = (que: string) => `${SISTEMA_PROCESAR}\nEn esta pasada devolvé SOLO ${que} (el resto, vacío).`
  const [parteA, parteB, primarias] = await Promise.all([
    pedirJson<{ historia?: { texto?: string; elementos?: string[] }; principales?: any[] }>({ db, clase: 'mastropiero', agenteId: 'procesar' }, soloEsto('«historia» y «principales»'), usuario, { temperatura: 0.4, maxTokens: 3000 }),
    pedirJson<{ inventario?: any[] }>({ db, clase: 'mastropiero', agenteId: 'procesar' }, soloEsto('«inventario»'), usuario, { temperatura: 0.3, maxTokens: 3000 }),
    principalDe(db, 'jugador') || listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] }).length
      ? Promise.resolve([] as Mision[])
      : proponerPrimarias(db, semanaDe(ahora), { ahora }).catch(() => [] as Mision[]),
  ])
  const d = { historia: parteA.datos.historia, principales: parteA.datos.principales, inventario: parteB.datos.inventario }
  let historia = false
  if (d.historia?.texto?.trim()) {
    escribirHistoria(db, 'jugador', { texto: d.historia.texto, elementos: d.historia.elementos ?? [] }, { sugerida: true, ahora })
    historia = true
  }
  let inventario = 0
  for (const i of (d.inventario ?? []).slice(0, 40)) {
    try {
      const conexion = i?.tipo === 'conexion' && typeof i.nombre === 'string' ? entidadPorNombre(db, i.nombre) : null
      const antes = (db.prepare('SELECT COUNT(*) AS n FROM inventario').get() as { n: number }).n
      agregarItem(db, 'jugador', { ...i, entidadId: conexion }, { fuente: 'mastropiero', sugerido: true, ahora })
      if ((db.prepare('SELECT COUNT(*) AS n FROM inventario').get() as { n: number }).n > antes) inventario++
    } catch {
      // un ítem raro no frena el resto
    }
  }
  db.prepare(`DELETE FROM misiones WHERE personaje = 'jugador' AND nivel = 'principal' AND estado = 'sugerida'`).run()
  let principales = 0
  for (const p of (d.principales ?? []).slice(0, 3)) {
    if (typeof p?.titulo !== 'string' || !p.titulo.trim()) continue
    fijarPrincipal(db, 'jugador', { titulo: p.titulo, detalle: p.detalle ?? null }, { por: 'mastropiero', sugerida: true, ahora })
    principales++
  }
  return { historia, inventario, principales, primarias: primarias.length }
}
