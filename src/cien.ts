/**
 * Los Cien Días (o cualquier plan con fecha): frentes, hábitos con su ritmo semanal, y cada día los seis verbos votados
 * a la noche, los hábitos hechos, el WOOP de la mañana, el peso y una nota. Las tareas del plan viven como side quests
 * (misiones terciarias con fecha), así entran solas a las runs, al gemelo y a las alertas.
 */
import { fechaLocal, json, type Db } from './db.ts'
import { actualizarMision, leerMision, type Mision } from './misiones.ts'

export const VERBOS = [['estudio', 'Estudio'], ['trabajo', 'Trabajo'], ['entreno', 'Entreno'], ['ensenio', 'Enseño'], ['construyo', 'Construyo'], ['disenio', 'Diseño']] as const
export type Verbo = (typeof VERBOS)[number][0]
const ES_VERBO = new Set<string>(VERBOS.map(([k]) => k))

export type Plan = { id: string; nombre: string; desde: string; hasta: string; semana0: string }
export type Frente = { id: string; nombre: string; corto: string | null; ganar: string | null; principio: string | null; orden: number }
export type Habito = { id: string; titulo: string; frenteId: string | null; porSemana: number; dias: number[]; orden: number }
export type Woop = { w?: string; o?: string; ob?: string; p?: string }
export type Dia = { fecha: string; verbos: Record<string, boolean>; habitos: Record<string, boolean>; woop: Woop | null; peso: number | null; nota: string | null }

// ─── fechas ─────────────────────────────────────────────────────────────

const P = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12) }
const S = (d: Date) => fechaLocal(d.getTime())
export const sumarDias = (s: string, n: number) => { const d = P(s); d.setDate(d.getDate() + n); return S(d) }
const entre = (a: string, b: string) => Math.round((P(b).getTime() - P(a).getTime()) / 86_400_000)
/** Día ISO: 1 lunes … 7 domingo. */
export const isoDow = (s: string) => ((P(s).getDay() + 6) % 7) + 1
export const lunes = (s: string) => sumarDias(s, -(isoDow(s) - 1))

// ─── leer ───────────────────────────────────────────────────────────────

export function planDe(db: Db, fecha = fechaLocal()): Plan | null {
  const r = db.prepare('SELECT * FROM planes WHERE desde <= ? AND hasta >= ? ORDER BY desde DESC LIMIT 1').get(fecha, fecha) as any
    ?? db.prepare('SELECT * FROM planes ORDER BY desde DESC LIMIT 1').get() as any
  return r ? { id: r.id, nombre: r.nombre, desde: r.desde, hasta: r.hasta, semana0: r.semana0 } : null
}

export const frentes = (db: Db, planId: string): Frente[] =>
  (db.prepare('SELECT * FROM frentes WHERE plan_id = ? ORDER BY orden').all(planId) as any[]).map((r) => ({ id: r.id, nombre: r.nombre, corto: r.corto, ganar: r.ganar, principio: r.principio, orden: r.orden }))

export const habitos = (db: Db): Habito[] =>
  (db.prepare('SELECT * FROM habitos WHERE activo = 1 ORDER BY orden, titulo').all() as any[]).map((r) => ({ id: r.id, titulo: r.titulo, frenteId: r.frente_id, porSemana: r.por_semana, dias: json<number[]>(r.dias, []), orden: r.orden }))

/** ¿Toca este hábito este día? (sin días fijos, toca cualquiera) */
export const toca = (h: Habito, fecha: string) => !h.dias.length || h.dias.includes(isoDow(fecha))

export function leerDia(db: Db, fecha: string): Dia {
  const r = db.prepare('SELECT * FROM plan_dias WHERE fecha = ?').get(fecha) as any
  return { fecha, verbos: json(r?.verbos, {}), habitos: json(r?.habitos, {}), woop: json<Woop | null>(r?.woop, null), peso: r?.peso ?? null, nota: r?.nota ?? null }
}

function guardarDia(db: Db, d: Dia, ahora = Date.now()) {
  db.prepare(`INSERT INTO plan_dias (fecha, verbos, habitos, woop, peso, nota, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fecha) DO UPDATE SET verbos = excluded.verbos, habitos = excluded.habitos, woop = excluded.woop, peso = excluded.peso, nota = excluded.nota, actualizado_en = excluded.actualizado_en`)
    .run(d.fecha, JSON.stringify(d.verbos), JSON.stringify(d.habitos), d.woop ? JSON.stringify(d.woop) : null, d.peso, d.nota, ahora)
}

// ─── escribir ───────────────────────────────────────────────────────────

/** Vota (o desvota) uno de los seis verbos. Sin valor, lo da vuelta. */
export function votar(db: Db, fecha: string, verbo: string, valor?: boolean, ahora = Date.now()): Dia {
  if (!ES_VERBO.has(verbo)) throw new Error(`«${verbo}» no es uno de los seis verbos`)
  const d = leerDia(db, fecha)
  d.verbos[verbo] = valor ?? !d.verbos[verbo]
  // Votar es el hábito «Voto de los seis verbos»: se marca solo.
  const voto = habitos(db).find((h) => /voto/i.test(h.titulo) && /verbo/i.test(h.titulo))
  if (voto) d.habitos[voto.id] = Object.values(d.verbos).some(Boolean)
  guardarDia(db, d, ahora)
  return d
}

export function marcarHabito(db: Db, fecha: string, id: string, valor?: boolean, ahora = Date.now()): Dia {
  if (!db.prepare('SELECT 1 FROM habitos WHERE id = ?').get(id)) throw new Error(`No existe el hábito ${id}`)
  const d = leerDia(db, fecha)
  d.habitos[id] = valor ?? !d.habitos[id]
  guardarDia(db, d, ahora)
  return d
}

export function guardarWoop(db: Db, fecha: string, w: Woop, ahora = Date.now()): Dia {
  const d = leerDia(db, fecha)
  const limpio = Object.fromEntries((['w', 'o', 'ob', 'p'] as const).map((k) => [k, String(w[k] ?? d.woop?.[k] ?? '').trim().slice(0, 500)]).filter(([, v]) => v)) as Woop
  d.woop = Object.keys(limpio).length ? limpio : null
  const h = habitos(db).find((x) => /woop/i.test(x.titulo)) // hacer el WOOP es el hábito «WOOP»
  if (h) d.habitos[h.id] = !!d.woop?.w
  guardarDia(db, d, ahora)
  return d
}

export function guardarNota(db: Db, fecha: string, c: { nota?: string | null; peso?: number | null }, ahora = Date.now()): Dia {
  const d = leerDia(db, fecha)
  if (c.nota !== undefined) d.nota = c.nota?.trim() || null
  if (c.peso !== undefined) d.peso = c.peso && Number.isFinite(Number(c.peso)) ? Number(c.peso) : null
  guardarDia(db, d, ahora)
  return d
}

/**
 * Lo que entra por la captura marca solo el hábito que corresponde: un ejercicio, «Entrenar» (y el verbo Entreno);
 * una caminata, «Caminar»; un gasto anotado, «Anotar gastos». Devuelve lo que marcó.
 */
export function marcarPorCaptura(db: Db, fecha: string, tipo: string, titulo = '', ahora = Date.now()): string[] {
  const hs = habitos(db)
  const marcar: Habito[] = []
  const busca = (re: RegExp) => hs.find((h) => re.test(h.titulo))
  if (tipo === 'ejercicio') {
    const camino = /camin/i.test(titulo)
    const h = camino ? busca(/camin/i) : busca(/entren|gym|gimnasio/i)
    if (h) marcar.push(h)
    if (!camino) votar(db, fecha, 'entreno', true, ahora)
  }
  if (tipo === 'gasto' || tipo === 'ingreso') { const h = busca(/gasto/i); if (h) marcar.push(h) }
  for (const h of marcar) marcarHabito(db, fecha, h.id, true, ahora)
  return marcar.map((h) => h.titulo)
}

// ─── el día, la semana, los 100 ─────────────────────────────────────────

/** 0 a 4, como en el plan original: verbos votados + hábitos hechos. */
export function intensidad(d: Pick<Dia, 'verbos' | 'habitos'>): number {
  const x = Object.values(d.verbos).filter(Boolean).length + Object.values(d.habitos).filter(Boolean).length
  return x === 0 ? 0 : x <= 2 ? 1 : x <= 4 ? 2 : x <= 7 ? 3 : 4
}

/** Cuántas veces hizo un hábito en la semana (lunes a domingo) de una fecha. */
export function habitoEnSemana(db: Db, id: string, fecha: string): number {
  const l = lunes(fecha)
  const filas = db.prepare('SELECT habitos FROM plan_dias WHERE fecha >= ? AND fecha <= ?').all(l, sumarDias(l, 6)) as { habitos: string }[]
  return filas.filter((f) => json<Record<string, boolean>>(f.habitos, {})[id]).length
}

export type TareaPlan = Mision & { frenteId: string | null; obligatoria: boolean; hito: boolean }

export function tareasDelPlan(db: Db, f: { fecha?: string; hasta?: string; abiertas?: boolean } = {}): TareaPlan[] {
  const filas = db.prepare(`SELECT t.mision_id, t.frente_id, t.obligatoria, t.hito FROM plan_tareas t JOIN misiones m ON m.id = t.mision_id
    WHERE m.estado != 'descartada' ${f.fecha ? 'AND m.vence = ?' : ''} ${f.hasta ? 'AND m.vence < ?' : ''} ${f.abiertas ? `AND m.estado IN ('activa', 'sugerida')` : ''}
    ORDER BY m.vence, t.obligatoria DESC, t.hito DESC`).all(...[f.fecha, f.hasta].filter(Boolean) as string[]) as any[]
  return filas.map((r) => ({ ...leerMision(db, r.mision_id)!, frenteId: r.frente_id, obligatoria: !!r.obligatoria, hito: !!r.hito }))
}

/** El día del plan. Las atrasadas (tareas abiertas de antes) solo para hoy, o si se piden. */
export function diaDelPlan(db: Db, fecha = fechaLocal(), o: { atrasadas?: boolean } = {}) {
  const plan = planDe(db, fecha)
  if (!plan) return null
  const semana = Math.floor(entre(plan.semana0, lunes(fecha)) / 7)
  const foco = (db.prepare('SELECT foco FROM plan_semanas WHERE plan_id = ? AND n = ?').get(plan.id, semana) as { foco: string } | undefined)?.foco ?? null
  const hs = habitos(db)
  const dia = leerDia(db, fecha)
  return {
    plan, fecha, n: entre(plan.desde, fecha) + 1, total: entre(plan.desde, plan.hasta) + 1, quedan: Math.max(0, entre(fecha, plan.hasta)),
    semana, foco, frentes: frentes(db, plan.id), dia, intensidad: intensidad(dia),
    habitos: hs.map((h) => ({ ...h, toca: toca(h, fecha), hecho: !!dia.habitos[h.id], enSemana: habitoEnSemana(db, h.id, fecha) })),
    tareas: tareasDelPlan(db, { fecha }), atrasadas: (o.atrasadas ?? fecha === fechaLocal()) ? tareasDelPlan(db, { hasta: fecha, abiertas: true }) : [],
  }
}

/** Cada día del plan con su intensidad y si hay hito (el mapa de los cien). */
export function mapaDelPlan(db: Db, plan: Plan) {
  const dias = new Map((db.prepare('SELECT * FROM plan_dias WHERE fecha >= ? AND fecha <= ?').all(plan.desde, plan.hasta) as any[]).map((r) => [r.fecha, intensidad({ verbos: json(r.verbos, {}), habitos: json(r.habitos, {}) })]))
  const hitos = new Set(tareasDelPlan(db).filter((t) => t.hito).map((t) => t.vence))
  return Array.from({ length: entre(plan.desde, plan.hasta) + 1 }, (_, i) => {
    const f = sumarDias(plan.desde, i)
    return { fecha: f, n: i + 1, intensidad: dias.get(f) ?? 0, hito: hitos.has(f) }
  })
}

export function marcarTarea(db: Db, misionId: number, hecha: boolean, ahora = Date.now()): Mision {
  return actualizarMision(db, misionId, { estado: hecha ? 'hecha' : 'activa' }, { por: 'operador', ahora })
}

/** Para Mastropiero: dónde va el plan, qué toca hoy y qué se atrasó. */
export function cienParaPrompt(db: Db, ahora = Date.now()): string {
  const hoy = fechaLocal(ahora)
  const d = diaDelPlan(db, hoy, { atrasadas: true })
  if (!d || hoy < d.plan.desde || hoy > d.plan.hasta) return ''
  const ayer = leerDia(db, sumarDias(hoy, -1))
  const votados = VERBOS.filter(([k]) => ayer.verbos[k]).map(([, n]) => n)
  const tocan = d.habitos.filter((h) => h.toca && !h.hecho)
  const atrasadasOblig = d.atrasadas.filter((t) => t.obligatoria)
  return [
    `Su plan «${d.plan.nombre}»: día ${d.n} de ${d.total} (semana ${d.semana}${d.foco ? `, foco: ${d.foco}` : ''}).`,
    d.frentes.length ? `Frentes: ${d.frentes.map((f) => `${f.corto ?? f.nombre} (${f.ganar ?? ''})`).join('; ')}.` : '',
    tocan.length ? `Hábitos que le tocan hoy: ${tocan.map((h) => `${h.titulo} (${h.enSemana}/${h.porSemana} esta semana)`).join('; ')}.` : '',
    d.tareas.length ? `Tareas del plan para hoy: ${d.tareas.map((t) => `${t.hito ? '◆ ' : ''}${t.titulo}${t.obligatoria ? ' (obligatoria)' : ''} [${t.estado}]`).join('; ')}.` : '',
    atrasadasOblig.length ? `Obligatorias atrasadas: ${atrasadasOblig.slice(0, 6).map((t) => `${t.titulo} (${t.vence})`).join('; ')}.` : '',
    `Ayer votó ${votados.length ? votados.join(', ') : 'ningún verbo'}.${d.dia.woop?.w ? ` Su WOOP de hoy: deseo «${d.dia.woop.w}», obstáculo «${d.dia.woop.ob ?? '—'}», plan «${d.dia.woop.p ?? '—'}».` : ''}`,
  ].filter(Boolean).join(' ')
}
