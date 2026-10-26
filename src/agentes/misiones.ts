/**
 * Las misiones de los agentes (plan v26): una meta larga («tres clientes nuevos para Versa antes de marzo») con su
 * criterio de éxito, que un agente trabaja en sesiones a lo largo de días. Cada sesión arranca desde su plan, su diario
 * (lo que encontró, lo que intentó, lo que él le indicó) y el próximo paso que dejó la anterior; trabaja en bucle con
 * sus herramientas y cierra anotando qué hizo y qué sigue. El brief lo escribe él: nada de la misión vive en el código.
 * Lo que sale hacia afuera (mensajes, propuestas) son borradores que él manda: el agente nunca habla con nadie.
 */
import { fechaLocal, json, type Db } from '../db.ts'
import { leerEntidad } from '../entidades.ts'
import { encolarPregunta } from '../preguntas.ts'
import { leccionesPara } from '../devoluciones.ts'
import { operadorParaAgente } from '../contexto.ts'
import { CLASES } from '../clases.ts'
import { alias, forjar, leer, PRUEBA_EXITOS, type Ficha } from '../roster.ts'
import { efectosAgente } from '../xp.ts'
import type { Ctx, Herramienta } from '../chat/herramientas.ts'
import { herramientasDeAgente, trabajar, type Resultado } from './motor.ts'

export const METRICAS = ['clientes', 'reuniones', 'respuestas', 'pistas', 'otro'] as const
export type Criterio = { metrica: (typeof METRICAS)[number]; meta: number; texto: string }
export type EstadoMision = 'activa' | 'pausada' | 'cumplida' | 'fallida' | 'abandonada'
export type PasoPlan = { paso: string; estado: 'pendiente' | 'hecho' | 'descartado' }
export type MisionAgente = {
  id: number; agenteId: string; titulo: string; brief: string; criterio: Criterio; entidadId: number | null; primariaId: number | null; vence: string | null
  estado: EstadoMision; plan: PasoPlan[]; proximo: string | null; creadaEn: number; actualizadaEn: number
}
export const TIPOS_DIARIO = ['plan', 'hallazgo', 'paso', 'reflexion', 'pregunta', 'instruccion', 'resultado', 'sesion'] as const
export type EntradaDiario = { id: number; misionId: number; agenteId: string; tipo: (typeof TIPOS_DIARIO)[number]; texto: string; refs: unknown; en: number }

const deFila = (r: any): MisionAgente => ({
  id: r.id, agenteId: r.agente_id, titulo: r.titulo, brief: r.brief, criterio: json<Criterio>(r.criterio, { metrica: 'otro', meta: 1, texto: '' } as Criterio), entidadId: r.entidad_id,
  primariaId: r.primaria_id, vence: r.vence, estado: r.estado, plan: json<PasoPlan[]>(r.plan, []) ?? [], proximo: r.proximo, creadaEn: r.creada_en, actualizadaEn: r.actualizada_en,
})
export const leerMisionAgente = (db: Db, id: number): MisionAgente | null => { const r = db.prepare('SELECT * FROM agente_misiones WHERE id = ?').get(id); return r ? deFila(r) : null }
export const listarMisionesAgente = (db: Db, f: { estados?: EstadoMision[]; agenteId?: string } = {}): MisionAgente[] =>
  (db.prepare('SELECT * FROM agente_misiones ORDER BY estado = \'activa\' DESC, actualizada_en DESC').all() as any[]).map(deFila)
    .filter((m) => (!f.estados || f.estados.includes(m.estado)) && (!f.agenteId || m.agenteId === f.agenteId))
/** Los agentes que tienen una misión viva no los toma el bus (están dedicados). */
export const agentesEnMision = (db: Db): Set<string> => new Set((db.prepare(`SELECT agente_id FROM agente_misiones WHERE estado IN ('activa', 'pausada')`).all() as { agente_id: string }[]).map((r) => r.agente_id))

// ─── el diario ──────────────────────────────────────────────────────────

export function anotarDiario(db: Db, m: Pick<MisionAgente, 'id' | 'agenteId'>, tipo: EntradaDiario['tipo'], texto: string, refs: unknown = null, ahora = Date.now()): EntradaDiario {
  const t = String(texto ?? '').trim().slice(0, 2000)
  if (!t) throw new Error('¿Qué anoto?')
  const id = Number(db.prepare('INSERT INTO agente_diario (mision_id, agente_id, tipo, texto, refs, en) VALUES (?, ?, ?, ?, ?, ?)')
    .run(m.id, m.agenteId, TIPOS_DIARIO.includes(tipo) ? tipo : 'hallazgo', t, refs == null ? null : JSON.stringify(refs), ahora).lastInsertRowid)
  db.prepare('UPDATE agente_misiones SET actualizada_en = ? WHERE id = ?').run(ahora, m.id)
  return { id, misionId: m.id, agenteId: m.agenteId, tipo, texto: t, refs, en: ahora }
}
export const diarioDe = (db: Db, misionId: number, limite = 60): EntradaDiario[] => (db.prepare('SELECT * FROM agente_diario WHERE mision_id = ? ORDER BY id DESC LIMIT ?').all(misionId, limite) as any[])
  .map((r) => ({ id: r.id, misionId: r.mision_id, agenteId: r.agente_id, tipo: r.tipo, texto: r.texto, refs: json(r.refs, null), en: r.en }))

// ─── crear y conducir ───────────────────────────────────────────────────

/**
 * Una misión nueva. Si no viene un agente, se forja uno (un buscador: sale a la web) con la misión como razón de ser.
 * El brief es lo que él escribe: qué se ofrece, a quién, dónde, precios, links de muestra.
 */
export function crearMisionAgente(db: Db, m: { titulo: string; brief: string; criterio?: Partial<Criterio>; entidadId?: number | null; primariaId?: number | null; vence?: string | null; agenteId?: string | null; clase?: string }, ahora = Date.now()): MisionAgente {
  const titulo = String(m.titulo ?? '').trim().slice(0, 160)
  const brief = String(m.brief ?? '').trim().slice(0, 6000)
  if (!titulo) throw new Error('Ponele un título a la misión')
  if (brief.length < 20) throw new Error('Contale al agente de qué se trata: qué se ofrece, a quién, dónde (el brief)')
  const metrica = METRICAS.includes(m.criterio?.metrica as any) ? m.criterio!.metrica! : 'otro'
  const criterio: Criterio = { metrica, meta: Math.max(1, Math.round(Number(m.criterio?.meta) || 1)), texto: String(m.criterio?.texto ?? '').trim().slice(0, 300) || `${Math.max(1, Math.round(Number(m.criterio?.meta) || 1))} ${metrica}` }
  let agente: Ficha | null = m.agenteId ? leer(db, m.agenteId) : null
  if (m.agenteId && !agente) throw new Error(`No existe el agente ${m.agenteId}`)
  if (agente && agentesEnMision(db).has(agente.id)) throw new Error(`${alias(agente)} ya está en otra misión`)
  if (!agente) {
    agente = forjar(db, {
      clase: m.clase && CLASES[m.clase as keyof typeof CLASES] && m.clase !== 'ejecutivo' ? m.clase : 'buscador', creador: 'mastropiero', misionPrincipal: titulo,
      instrucciones: `Tu misión: ${titulo}. La trabajás en sesiones, con un plan y un diario; lo que sale hacia afuera son borradores que el operador manda.`, ahora,
    })
  }
  if (m.entidadId != null && !leerEntidad(db, Number(m.entidadId))) throw new Error(`No existe la entidad ${m.entidadId}`)
  const id = Number(db.prepare(`INSERT INTO agente_misiones (agente_id, titulo, brief, criterio, entidad_id, primaria_id, vence, estado, plan, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?, ?, ?, 'activa', '[]', ?, ?)`)
    .run(agente.id, titulo, brief, JSON.stringify(criterio), m.entidadId ?? null, m.primariaId ?? null, m.vence || null, ahora, ahora).lastInsertRowid)
  return leerMisionAgente(db, id)!
}

/** Él la pausa, la retoma, la da por cumplida o la abandona; también puede afinar el brief, el criterio o la fecha. */
export function editarMisionAgente(db: Db, id: number, c: { estado?: EstadoMision; brief?: string; titulo?: string; criterio?: Partial<Criterio>; vence?: string | null }, ahora = Date.now()): MisionAgente {
  const m = leerMisionAgente(db, id)
  if (!m) throw new Error(`No existe la misión ${id}`)
  const estado = c.estado && ['activa', 'pausada', 'cumplida', 'fallida', 'abandonada'].includes(c.estado) ? c.estado : m.estado
  const criterio = c.criterio ? { ...m.criterio, ...c.criterio, meta: Math.max(1, Math.round(Number(c.criterio.meta ?? m.criterio.meta) || 1)) } : m.criterio
  db.prepare('UPDATE agente_misiones SET estado = ?, brief = ?, titulo = ?, criterio = ?, vence = ?, actualizada_en = ? WHERE id = ?').run(
    estado, c.brief?.trim() ? c.brief.trim().slice(0, 6000) : m.brief, c.titulo?.trim() ? c.titulo.trim().slice(0, 160) : m.titulo, JSON.stringify(criterio), c.vence === undefined ? m.vence : c.vence || null, ahora, id)
  if (estado !== m.estado) anotarDiario(db, m, 'instruccion', `El operador cambió la misión a «${estado}».`, null, ahora)
  return leerMisionAgente(db, id)!
}

/** Lo que él le indica (desde la pantalla o el chat): manda en la próxima sesión. */
export const instruir = (db: Db, id: number, texto: string, ahora = Date.now()) => {
  const m = leerMisionAgente(db, id)
  if (!m) throw new Error(`No existe la misión ${id}`)
  return anotarDiario(db, m, 'instruccion', texto, null, ahora)
}

// ─── las herramientas de la misión ──────────────────────────────────────

const S = (props: Record<string, unknown>, req: string[] = []) => ({ type: 'object', properties: props, required: req })
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })
const misionDe = (ctx: { db: Db; mision?: { id: number } }) => {
  const m = ctx.mision ? leerMisionAgente(ctx.db, ctx.mision.id) : null
  if (!m) throw new Error('Esta herramienta es para trabajar una misión')
  return m
}

/** Las herramientas que solo existen dentro de una misión (no las ve el chat del operador). */
export const HERRAMIENTAS_MISION: Herramienta[] = [
  {
    nombre: 'anotar_en_diario', familia: 'accion',
    descripcion: 'Anota en tu diario de la misión lo que encontraste, intentaste o aprendiste. Es tu memoria entre sesiones: lo que no anotes, la próxima sesión no lo sabe.',
    parametros: S({ tipo: str('Qué es', { enum: ['hallazgo', 'paso', 'reflexion'] }), texto: str('Concreto: qué, dónde, por qué importa') }, ['tipo', 'texto']),
    ejecutar: (a, ctx) => { const m = misionDe(ctx); const e = anotarDiario(ctx.db, m, a.tipo, a.texto); return { anotado: e.id } },
    resumen: (a) => `anotó en su diario (${a.tipo})`,
  },
  {
    nombre: 'rehacer_plan', familia: 'accion',
    descripcion: 'Reescribe tu plan de la misión: la lista de pasos con su estado (pendiente, hecho, descartado). Hacelo al arrancar si no hay plan, o cuando cambie lo que sabés.',
    parametros: S({ pasos: { type: 'array', items: { type: 'object', properties: { paso: { type: 'string' }, estado: { type: 'string', enum: ['pendiente', 'hecho', 'descartado'] } }, required: ['paso'] }, description: 'De 3 a 12 pasos' } }, ['pasos']),
    ejecutar: (a, ctx) => {
      const m = misionDe(ctx)
      const plan: PasoPlan[] = (Array.isArray(a.pasos) ? a.pasos : []).map((p: any) => ({ paso: String(p?.paso ?? '').trim().slice(0, 200), estado: ['hecho', 'descartado'].includes(p?.estado) ? p.estado : 'pendiente' })).filter((p: PasoPlan) => p.paso).slice(0, 12)
      if (!plan.length) return { error: 'Un plan necesita al menos un paso' }
      ctx.db.prepare('UPDATE agente_misiones SET plan = ?, actualizada_en = ? WHERE id = ?').run(JSON.stringify(plan), Date.now(), m.id)
      anotarDiario(ctx.db, m, 'plan', plan.map((p) => `${p.estado === 'hecho' ? '✓' : p.estado === 'descartado' ? '✕' : '·'} ${p.paso}`).join('\n'))
      return { plan }
    },
    resumen: () => 'rehizo su plan',
  },
  {
    nombre: 'preguntarle_al_operador', familia: 'accion',
    descripcion: 'Le deja UNA pregunta al operador (le llega a su bandeja de preguntas) cuando te falta algo que solo él sabe: un precio, un límite, si un tipo de cliente le interesa. Una por sesión como mucho; no preguntes lo que podés averiguar.',
    parametros: S({ pregunta: str('La pregunta, corta y concreta'), por_que: str('Para qué la necesitás') }, ['pregunta']),
    ejecutar: (a, ctx) => {
      const m = misionDe(ctx)
      if ((ctx.mision!.preguntas ?? 0) >= 1) return { error: 'Ya le preguntaste algo en esta sesión: seguí con lo que tenés' }
      const p = encolarPregunta(ctx.db, { texto: String(a.pregunta ?? ''), porQue: `${m.titulo}${a.por_que ? `: ${a.por_que}` : ''}`, origen: `agente:${m.agenteId}` })
      if (!p) return { error: 'La pregunta vino vacía' }
      ctx.mision!.preguntas = (ctx.mision!.preguntas ?? 0) + 1
      anotarDiario(ctx.db, m, 'pregunta', String(a.pregunta), { pregunta: p.id })
      return { pregunta: p.id, aviso: 'Le llega a su bandeja; su respuesta la vas a ver en tu diario cuando conteste.' }
    },
    resumen: () => 'le dejó una pregunta al operador',
  },
  {
    nombre: 'cerrar_sesion', familia: 'accion',
    descripcion: 'Cierra la sesión de trabajo: qué hiciste, cuál es el próximo paso y si la misión va bien. Llamala siempre al terminar.',
    parametros: S({ resumen: str('Qué hiciste en esta sesión, en dos o tres oraciones'), proximo_paso: str('Lo primero que hace la próxima sesión'), va_bien: { type: 'boolean', description: 'Si creés que la misión avanza' } }, ['resumen', 'proximo_paso']),
    ejecutar: (a, ctx) => {
      const m = misionDe(ctx)
      anotarDiario(ctx.db, m, 'resultado', `${String(a.resumen ?? '').trim()}${a.va_bien === false ? ' (no va bien)' : ''}`, { va_bien: a.va_bien !== false })
      ctx.db.prepare('UPDATE agente_misiones SET proximo = ?, actualizada_en = ? WHERE id = ?').run(String(a.proximo_paso ?? '').trim().slice(0, 400) || null, Date.now(), m.id)
      ctx.mision!.fin = true
      return { ok: true }
    },
    resumen: () => 'cerró la sesión',
  },
]

/** Las herramientas de misión que se suman en otras fases (pistas, borradores): se registran acá. */
const extras: Herramienta[] = []
export function sumarHerramientasMision(hs: Herramienta[]) { for (const h of hs) if (!extras.some((x) => x.nombre === h.nombre)) extras.push(h) }
/** Y lo que esas fases suman al prompt (las pistas con su etapa). */
const partesPrompt: ((db: Db, m: MisionAgente) => string)[] = []
export function sumarAlPrompt(f: (db: Db, m: MisionAgente) => string) { partesPrompt.push(f) }

// ─── una sesión de trabajo ──────────────────────────────────────────────

export function promptMision(db: Db, f: Ficha, m: MisionAgente, ahora = Date.now()): string {
  const ef = efectosAgente(f.atributos)
  const e = m.entidadId ? leerEntidad(db, m.entidadId) : null
  const diario = diarioDe(db, m.id, ef.diario).reverse()
  const op = operadorParaAgente(db)
  const respuestas = diario.filter((d) => d.tipo === 'pregunta' && (d.refs as any)?.pregunta).map((d) => db.prepare('SELECT texto, respuesta FROM preguntas WHERE id = ? AND estado = \'respondida\'').get((d.refs as any).pregunta) as { texto: string; respuesta: string } | undefined).filter(Boolean) as { texto: string; respuesta: string }[]
  return [
    `Sos ${alias(f)}, agente ${CLASES[f.clase].nombre} de la liga de Mastropiero (Deprocast). Trabajás una misión para el operador, en sesiones: cada sesión arranca de tu plan y tu diario y termina con cerrar_sesion.`,
    `## La misión: ${m.titulo}\n${m.brief}\nCriterio de éxito: ${m.criterio.texto}${m.vence ? ` · vence el ${m.vence}` : ''}${e ? `\nEs para: ${e.nombre} (${e.tipo})${e.notas ? ` — ${e.notas.slice(0, 600)}` : ''}` : ''}`,
    op ? `## El operador\n${op.quien}` : '',
    m.plan.length ? `## Tu plan\n${m.plan.map((p) => `${p.estado === 'hecho' ? '✓' : p.estado === 'descartado' ? '✕' : '·'} ${p.paso}`).join('\n')}` : '## Tu plan\nTodavía no tenés plan: armalo con rehacer_plan antes de salir a trabajar.',
    diario.length ? `## Tu diario (lo último)\n${diario.map((d) => `[${fechaLocal(d.en)} · ${d.tipo}] ${d.texto}`).join('\n')}` : '',
    respuestas.length ? `## Lo que te contestó\n${respuestas.map((r) => `- ${r.texto} → ${r.respuesta}`).join('\n')}` : '',
    ...partesPrompt.map((p) => p(db, m)),
    leccionesPara(db, ['agentes']),
    `## Cómo trabajás
- Lo que él te indica (las entradas «instruccion» del diario) manda sobre tu plan.
- No inventes: datos, nombres y links solo de lo que leíste en esta sesión o tenés anotado. Si algo no lo encontrás, anotalo así.
- Nunca hablás con nadie: lo que sale hacia afuera (un mensaje, un mail, una propuesta) es un borrador que él revisa y manda.
- Solo información pública de organizaciones (empresas, productoras, marcas, eventos, medios); nada de datos privados de personas.
- Anotá en tu diario lo que vale para la próxima sesión. Cerrá siempre con cerrar_sesion.
- Hoy es ${fechaLocal(ahora)}.`,
  ].filter(Boolean).join('\n\n')
}

export const sesionesHoy = (db: Db, misionId: number, ahora = Date.now()) => {
  const desde = new Date(`${fechaLocal(ahora)}T00:00:00`).getTime()
  return (db.prepare(`SELECT COUNT(*) AS n FROM agente_diario WHERE mision_id = ? AND tipo = 'sesion' AND en >= ?`).get(misionId, desde) as { n: number }).n
}

const trabajando = new Set<number>()
export const misionTrabajando = (id: number) => trabajando.has(id)

/**
 * Una sesión de trabajo de una misión. Gasta tokens: solo en la nube (lo controla quien la llama: la rutina o la ruta).
 * Si el agente no cierra la sesión (se le acabaron los pasos o el tope), se cierra sola con lo que hubo.
 */
export async function trabajarMision(db: Db, id: number, o: { ahora?: number } = {}): Promise<{ sesion: number; resultado: Resultado; cerrada: boolean }> {
  const ahora = o.ahora ?? Date.now()
  const m = leerMisionAgente(db, id)
  if (!m) throw new Error(`No existe la misión ${id}`)
  if (m.estado !== 'activa') throw new Error(`La misión está ${m.estado}`)
  const f = leer(db, m.agenteId)
  if (!f) throw new Error(`El agente ${m.agenteId} ya no está`)
  if (f.estado === 'banca') throw new Error(`${alias(f)} está en la banca: no trabaja hasta que vuelva`)
  if (trabajando.has(id)) throw new Error('Esta misión ya está trabajando')
  trabajando.add(id)
  try {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM agente_diario WHERE mision_id = ? AND tipo = 'sesion'`).get(id) as { n: number }).n + 1
    const ctxMision: NonNullable<Ctx['mision']> = { id, agenteId: f.id, urlsVistas: new Set<string>(), desde: ahora, preguntas: 0 }
    const resultado = await trabajar(db, f, {
      sistema: promptMision(db, f, m, ahora), herramientas: herramientasDeAgente(f, [...HERRAMIENTAS_MISION, ...extras]), ctx: { mision: ctxMision }, ahora,
      mensajes: [{ role: 'user', content: `Sesión ${n}. ${m.proximo ? `El próximo paso que dejaste: ${m.proximo}` : 'Es la primera: armá tu plan y arrancá.'}` }],
    })
    const cerrada = !!ctxMision.fin
    const herramientas = resultado.pasos.map((p) => p.herramienta)
    if (!cerrada && resultado.texto.trim()) anotarDiario(db, m, 'resultado', resultado.texto.trim().slice(0, 1200), null, ahora)
    anotarDiario(db, m, 'sesion', `Sesión ${n}: ${resultado.pasos.length} paso${resultado.pasos.length === 1 ? '' : 's'}${cerrada ? '' : resultado.cortado === 'tope' ? ' · cortada por el tope del día' : resultado.cortado === 'pasos' ? ' · se le acabaron los pasos' : ' · terminó sin cerrar'}`, { pasos: herramientas, tokens: resultado.tokens, cortado: resultado.cortado }, ahora)
    // Una sesión cerrada es una misión cumplida en la carta del agente: con tres, el que estaba a prueba entra al roster.
    db.prepare('UPDATE agentes SET xp = xp + ?, exitos = exitos + ?, ultima_corrida = ? WHERE id = ?').run(cerrada ? 5 : 1, cerrada ? 1 : 0, ahora, f.id)
    const g = leer(db, f.id)!
    if (g.estado === 'prueba' && g.exitos >= PRUEBA_EXITOS) db.prepare(`UPDATE agentes SET estado = 'activo' WHERE id = ?`).run(f.id)
    return { sesion: n, resultado, cerrada }
  } finally {
    trabajando.delete(id)
  }
}

/**
 * La rutina (tres veces por día, en la nube): cada misión activa trabaja una sesión si todavía no hizo las que le da su
 * Ritmo hoy. De a una, y frena si se alcanza el tope de la liga.
 */
export async function trabajarMisiones(db: Db, ahora = Date.now()): Promise<{ sesiones: { mision: string; agente: string; pasos: number; cerrada: boolean }[]; frenado: string | null }> {
  const { topeAlcanzado } = await import('../nan.ts')
  const out: { mision: string; agente: string; pasos: number; cerrada: boolean }[] = []
  for (const m of listarMisionesAgente(db, { estados: ['activa'] })) {
    const tope = topeAlcanzado(db, ahora)
    if (tope) return { sesiones: out, frenado: tope }
    const f = leer(db, m.agenteId)
    if (!f || f.estado === 'banca' || misionTrabajando(m.id)) continue
    if (m.vence && m.vence < fechaLocal(ahora)) { editarMisionAgente(db, m.id, { estado: 'fallida' }, ahora); continue }
    if (sesionesHoy(db, m.id, ahora) >= efectosAgente(f.atributos).sesionesDia) continue
    try {
      const r = await trabajarMision(db, m.id, { ahora })
      out.push({ mision: m.titulo, agente: alias(f), pasos: r.resultado.pasos.length, cerrada: r.cerrada })
    } catch (e) { console.error(`  misión ${m.id}:`, e instanceof Error ? e.message : e) }
  }
  return { sesiones: out, frenado: null }
}
