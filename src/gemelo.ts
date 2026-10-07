/**
 * El gemelo predictivo: cada mañana Mastropiero predice el día del jugador con probabilidades; a la noche se califica.
 * Lo verificable se califica solo (bandas hechas, runs, primarias, de qué habló, el Directo); lo demás lo juzga el modelo
 * con la evidencia del día, y lo dudoso queda para que él marque ✓ o ✗. Métrica: el puntaje de Brier, y de ahí
 * «Te conozco X %» (0 % = tirar una moneda, 100 % = acertar todo). Lo que falla vuelve a la memoria como aprendizaje.
 */
import { fechaLocal, json, type Db } from './db.ts'
import { agendaDelDia } from './calendario.ts'
import { memoriaParaPrompt, recordar } from './memoria.ts'
import { pedirJson } from './modelo.ts'
import { calibracion, conAvance, listarMisiones, listarRuns, misionesDeRun, semanaDe } from './misiones.ts'

export type Criterio =
  | { tipo: 'bandas_hechas'; op: '>=' | '<='; valor: number }
  | { tipo: 'run_arrancada'; valor: boolean }
  | { tipo: 'primaria_avanza'; primaria: string }
  | { tipo: 'habla_de'; texto: string }
  | { tipo: 'directo_prendido'; valor: boolean }

export type Prediccion = {
  id: number; fecha: string; texto: string; probabilidad: number; tipo: string; criterio: Criterio | null
  resultado: number | null; estado: 'abierta' | 'calificada' | 'para_el_jugador'; calificadaPor: string | null; nota: string | null
}

const deFila = (r: any): Prediccion => ({
  id: r.id, fecha: r.fecha, texto: r.texto, probabilidad: r.probabilidad, tipo: r.tipo, criterio: json(r.criterio, null),
  resultado: r.resultado, estado: r.estado, calificadaPor: r.calificada_por, nota: r.nota,
})

export function prediccionesDe(db: Db, fecha: string): Prediccion[] {
  return db.prepare('SELECT * FROM predicciones WHERE fecha = ? ORDER BY id').all(fecha).map(deFila)
}

const inicioDia = (fecha: string) => new Date(`${fecha}T00:00:00`).getTime()
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// ─── lo que pasó (para calificar) ───────────────────────────────────────

/** La evidencia de un día: bandas, runs, primarias que avanzaron, lo que dijo, el Directo, su cierre. */
export function evidencia(db: Db, fecha: string) {
  const runs = listarRuns(db, { fecha, estados: ['en_curso', 'cerrada'] })
  const bandas = runs.flatMap((r) => misionesDeRun(db, r.id))
  const desde = inicioDia(fecha)
  const hasta = desde + 86_400_000
  const dijo = (db.prepare(`SELECT m.texto FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id WHERE m.rol = 'operador' AND c.con = 'mastropiero' AND m.en >= ? AND m.en < ?`).all(desde, hasta) as { texto: string }[]).map((x) => x.texto)
  const directo = db.prepare(`SELECT informe FROM directo_sesiones WHERE inicio >= ? AND inicio < ?`).all(desde, hasta) as { informe: string | null }[]
  const cierre = (db.prepare('SELECT cierre FROM jornadas WHERE fecha = ?').get(fecha) as { cierre: string | null } | undefined)?.cierre ?? null
  const primariasQueAvanzaron = [...new Set(bandas.filter((b) => b.padreId && ['hecha', 'parcial'].includes(b.estado)).map((b) => b.padreId!))]
    .map((id) => (db.prepare('SELECT titulo FROM misiones WHERE id = ?').get(id) as { titulo: string } | undefined)?.titulo).filter(Boolean) as string[]
  return { runs, bandas, dijo, directo, cierre, primariasQueAvanzaron }
}

/** Califica lo que se puede verificar solo. null = no se puede decir con los datos. */
export function verificar(c: Criterio, ev: ReturnType<typeof evidencia>): number | null {
  const hechas = ev.bandas.filter((b) => b.estado === 'hecha').length
  switch (c.tipo) {
    case 'bandas_hechas': return (c.op === '>=' ? hechas >= c.valor : hechas <= c.valor) ? 1 : 0
    case 'run_arrancada': return (ev.runs.length > 0) === c.valor ? 1 : 0
    case 'primaria_avanza': return ev.primariasQueAvanzaron.some((t) => norm(t).includes(norm(c.primaria).slice(0, 24))) ? 1 : 0
    case 'habla_de': return ev.dijo.some((t) => norm(t).includes(norm(c.texto))) ? 1 : 0
    case 'directo_prendido': return (ev.directo.length > 0) === c.valor ? 1 : 0
  }
  return null
}

function criterioValido(c: any): Criterio | null {
  if (!c || typeof c !== 'object') return null
  if (c.tipo === 'bandas_hechas' && (c.op === '>=' || c.op === '<=') && Number.isFinite(Number(c.valor))) return { tipo: c.tipo, op: c.op, valor: Number(c.valor) }
  if ((c.tipo === 'run_arrancada' || c.tipo === 'directo_prendido') && typeof c.valor === 'boolean') return { tipo: c.tipo, valor: c.valor }
  if (c.tipo === 'primaria_avanza' && typeof c.primaria === 'string' && c.primaria.trim()) return { tipo: c.tipo, primaria: c.primaria.trim() }
  if (c.tipo === 'habla_de' && typeof c.texto === 'string' && c.texto.trim().length >= 3) return { tipo: c.tipo, texto: c.texto.trim() }
  return null
}

// ─── la métrica ─────────────────────────────────────────────────────────

/** Brier de un conjunto calificado: promedio de (p − resultado)². 0 es perfecto; 0,25 es tirar una moneda. */
export function brier(ps: Pick<Prediccion, 'probabilidad' | 'resultado'>[]): number | null {
  const xs = ps.filter((p) => p.resultado != null)
  if (!xs.length) return null
  return xs.reduce((s, p) => s + (p.probabilidad - p.resultado!) ** 2, 0) / xs.length
}

/** «Te conozco X %»: 0 % = como una moneda (Brier 0,25), 100 % = perfecto. */
export const conocimiento = (b: number | null) => (b == null ? null : Math.round(Math.max(0, 1 - b / 0.25) * 100))

/** La curva: por día, el Brier y el «te conozco», más el acumulado de los últimos n días. */
export function curva(db: Db, hasta: string, dias = 21) {
  const [a, m, d] = hasta.split('-').map(Number)
  const puntos = Array.from({ length: dias }, (_, i) => {
    const f = fechaLocal(new Date(a, m - 1, d - (dias - 1 - i)).getTime())
    const ps = prediccionesDe(db, f)
    const b = brier(ps)
    return { fecha: f, predicciones: ps.length, calificadas: ps.filter((p) => p.resultado != null).length, aciertos: ps.filter((p) => p.resultado != null && (p.probabilidad >= 0.5) === (p.resultado === 1)).length, brier: b, conocimiento: conocimiento(b) }
  })
  const todas = puntos.flatMap((p) => prediccionesDe(db, p.fecha))
  return { puntos, total: conocimiento(brier(todas)), calificadas: todas.filter((p) => p.resultado != null).length }
}

// ─── predecir ───────────────────────────────────────────────────────────

const SISTEMA_PREDECIR = `Sos el gemelo predictivo del jugador: Mastropiero predice su día antes de que pase, para conocerlo cada vez mejor.
- Entre 5 y 8 predicciones sobre HOY, con «probabilidad» de 0 a 1 bien calibrada (si dudás, cerca de 0,5; nada de 0 ni 1).
- Variá los tipos: qué va a hacer y qué no, cuántas bandas, qué primaria va a mover o va a dejar quieta, su energía y su ánimo, de qué te va a hablar, si cambia de plan, algo inesperado.
- Si se puede verificar con datos, agregá «criterio», de estos tipos exactos:
  {"tipo": "bandas_hechas", "op": ">=" | "<=", "valor": número} (bandas de run marcadas como hechas en el día)
  {"tipo": "run_arrancada", "valor": true | false}
  {"tipo": "primaria_avanza", "primaria": "título exacto de una primaria"}
  {"tipo": "habla_de", "texto": "palabra o nombre que va a aparecer en lo que te diga"}
  {"tipo": "directo_prendido", "valor": true | false}
  Si no es verificable con datos, criterio null (lo juzga la evidencia o él).
- Usá lo que sabés: su curva de energía, su historia de aciertos y errores, su agenda, su run, sus primarias. Aprendé de cómo te fue antes.
- «texto» en una oración, en tercera persona, concreta («Va a hacer al menos 6 bandas antes de las 12»).
Forma: {"predicciones": [{"texto": string, "probabilidad": number, "tipo": string, "criterio": object | null}]}`

/** Predice el día (si ya hay predicciones de ese día, no las repite). */
export async function predecirDia(db: Db, fecha = fechaLocal(), ahora = Date.now()): Promise<Prediccion[]> {
  const ya = prediccionesDe(db, fecha)
  if (ya.length) return ya
  const { eventos } = await agendaDelDia(fecha).catch(() => ({ eventos: [] as { titulo: string; inicio: number; todoElDia: boolean }[] }))
  const primarias = conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] }))
  const runs = listarRuns(db, { fecha, estados: ['propuesta', 'en_curso'] })
  const historia = curva(db, fecha, 14)
  const errores = (db.prepare(`SELECT texto, probabilidad, resultado FROM predicciones WHERE resultado IS NOT NULL ORDER BY id DESC LIMIT 20`).all() as any[])
    .map((p) => `- «${p.texto}» (${Math.round(p.probabilidad * 100)}%) → ${p.resultado ? 'pasó' : 'no pasó'}`)
  const usuario = [
    `Hoy: ${new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}.`,
    eventos.length ? `Su agenda: ${eventos.map((e) => `${e.todoElDia ? 'todo el día' : new Date(e.inicio).toTimeString().slice(0, 5)} ${e.titulo}`).join(' · ')}` : 'Agenda vacía.',
    runs.length ? `Runs propuestas para hoy: ${runs.map((r) => `${r.inicio}–${r.fin}, ${misionesDeRun(db, r.id).length} bandas`).join(' · ')}` : 'No tiene run propuesta.',
    primarias.length ? `Primarias de la semana: ${primarias.map((p) => `${p.titulo} (${p.avance.progreso}%, ${p.avance.bandas.hechas} bandas)`).join(' · ')}` : '',
    `Cómo le viene yendo en las runs:\n${calibracion(db, ahora) || '- sin datos todavía'}`,
    historia.calificadas ? `Tu puntería hasta ahora: «te conozco» ${historia.total}% en ${historia.calificadas} predicciones calificadas.` : 'Es tu primer día prediciendo.',
    errores.length ? `Tus últimas predicciones calificadas:\n${errores.join('\n')}` : '',
    `Lo que sabés de él:\n${memoriaParaPrompt(db, 60)}`,
  ].filter(Boolean).join('\n')
  const { datos } = await pedirJson<{ predicciones?: any[] }>({ db, clase: 'mastropiero', agenteId: 'gemelo' }, SISTEMA_PREDECIR, usuario, { temperatura: 0.5, maxTokens: 2500 })
  const alta = db.prepare(`INSERT INTO predicciones (fecha, texto, probabilidad, tipo, criterio, estado, creada_en) VALUES (?, ?, ?, ?, ?, 'abierta', ?)`)
  for (const p of (datos.predicciones ?? []).slice(0, 8)) {
    if (typeof p?.texto !== 'string' || !p.texto.trim()) continue
    const prob = Math.min(0.97, Math.max(0.03, Number(p.probabilidad) || 0.5))
    const c = criterioValido(p.criterio)
    alta.run(fecha, p.texto.trim().slice(0, 300), prob, String(p.tipo ?? 'otro').slice(0, 30), c ? JSON.stringify(c) : null, ahora)
  }
  return prediccionesDe(db, fecha)
}

// ─── calificar ──────────────────────────────────────────────────────────

const SISTEMA_CALIFICAR = `Sos el gemelo de Mastropiero y calificás tus predicciones del día con la evidencia de lo que pasó.
- Para cada predicción: «resultado» 1 si pasó, 0 si no pasó, o null si la evidencia no alcanza para decirlo (eso se lo preguntás a él). No adivines: ante la duda, null.
- «nota»: media línea con la evidencia.
- «aprendizajes»: 0 a 2 cosas sobre él que estos errores te enseñan («suele sobreestimar las mañanas», «los martes arranca tarde»). Solo si se ve un patrón.
Forma: {"calificaciones": [{"id": number, "resultado": 1 | 0 | null, "nota": string}], "aprendizajes": [string]}`

/** Califica el día: lo verificable solo, el resto con la evidencia; lo dudoso queda para él. */
export async function calificarDia(db: Db, fecha = fechaLocal(), o: { ahora?: number; conModelo?: boolean } = {}): Promise<{ predicciones: Prediccion[]; brier: number | null; conocimiento: number | null; aprendizajes: string[] }> {
  const ahora = o.ahora ?? Date.now()
  const ps = prediccionesDe(db, fecha).filter((p) => p.estado === 'abierta')
  const ev = evidencia(db, fecha)
  const upd = db.prepare('UPDATE predicciones SET resultado = ?, estado = ?, calificada_por = ?, nota = ?, calificada_en = ? WHERE id = ?')
  const resto: Prediccion[] = []
  for (const p of ps) {
    const r = p.criterio ? verificar(p.criterio, ev) : null
    if (r == null) resto.push(p)
    else upd.run(r, 'calificada', 'datos', null, ahora, p.id)
  }
  let aprendizajes: string[] = []
  if (resto.length && o.conModelo !== false) {
    const hechas = ev.bandas.filter((b) => b.estado === 'hecha').map((b) => b.titulo)
    const evText = [
      `Bandas: ${ev.bandas.length} en ${ev.runs.length} runs; hechas: ${hechas.join(' · ') || 'ninguna'}; no: ${ev.bandas.filter((b) => b.estado === 'no').map((b) => b.titulo).join(' · ') || 'ninguna'}.`,
      ev.bandas.filter((b) => b.feedback).length ? `Sus notas: ${ev.bandas.filter((b) => b.feedback).map((b) => `«${b.feedback}»`).join(' ')}` : '',
      ev.dijo.length ? `Lo que te dijo hoy:\n${ev.dijo.map((t) => `- ${t.slice(0, 400)}`).join('\n')}` : 'Hoy no te habló.',
      ev.directo.length ? `Informes del Directo:\n${ev.directo.map((d) => (d.informe ?? '').slice(0, 1500)).join('\n')}` : '',
      ev.cierre ? `Su cierre del día: ${ev.cierre}` : '',
    ].filter(Boolean).join('\n')
    try {
      const { datos } = await pedirJson<{ calificaciones?: any[]; aprendizajes?: string[] }>({ db, clase: 'mastropiero', agenteId: 'gemelo' }, SISTEMA_CALIFICAR,
        `Predicciones:\n${resto.map((p) => `#${p.id} «${p.texto}» (${Math.round(p.probabilidad * 100)}%)`).join('\n')}\n\nEvidencia del día:\n${evText}`, { temperatura: 0.2, maxTokens: 2000 })
      for (const c of datos.calificaciones ?? []) {
        const p = resto.find((x) => x.id === Number(c?.id))
        if (!p) continue
        if (c.resultado === 1 || c.resultado === 0) upd.run(c.resultado, 'calificada', 'mastropiero', typeof c.nota === 'string' ? c.nota.slice(0, 300) : null, ahora, p.id)
        else upd.run(null, 'para_el_jugador', null, typeof c.nota === 'string' ? c.nota.slice(0, 300) : null, ahora, p.id)
      }
      aprendizajes = (datos.aprendizajes ?? []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 2)
      for (const a of aprendizajes) recordar(db, { texto: a, tipo: 'preferencia', creadaPor: 'gemelo' }, ahora)
    } catch {
      // sin modelo: lo no verificable queda para él
    }
  }
  db.prepare(`UPDATE predicciones SET estado = 'para_el_jugador' WHERE fecha = ? AND estado = 'abierta'`).run(fecha)
  const todas = prediccionesDe(db, fecha)
  const b = brier(todas)
  return { predicciones: todas, brier: b, conocimiento: conocimiento(b), aprendizajes }
}

/** Él califica lo que el gemelo no pudo: ✓ pasó, ✗ no pasó. */
export function calificarAMano(db: Db, id: number, paso: boolean, ahora = Date.now()): Prediccion {
  const r = db.prepare('SELECT * FROM predicciones WHERE id = ?').get(id)
  if (!r) throw new Error(`No existe la predicción ${id}`)
  db.prepare(`UPDATE predicciones SET resultado = ?, estado = 'calificada', calificada_por = 'jugador', calificada_en = ? WHERE id = ?`).run(paso ? 1 : 0, ahora, id)
  return deFila(db.prepare('SELECT * FROM predicciones WHERE id = ?').get(id))
}

/** El texto que deja en Hoy a la noche. */
export function textoDeCalificacion(r: Awaited<ReturnType<typeof calificarDia>>): string {
  const cal = r.predicciones.filter((p) => p.resultado != null)
  const aciertos = cal.filter((p) => (p.probabilidad >= 0.5) === (p.resultado === 1)).length
  const pendientes = r.predicciones.filter((p) => p.estado === 'para_el_jugador').length
  return [
    `Me califiqué el día: acerté ${aciertos} de ${cal.length} predicciones${r.conocimiento != null ? ` («te conozco» ${r.conocimiento}% hoy)` : ''}.`,
    pendientes ? `Hay ${pendientes} que no puedo saber solo: marcalas en Hoy, en «El gemelo».` : '',
    r.aprendizajes.length ? `Aprendí: ${r.aprendizajes.join(' ')}` : '',
  ].filter(Boolean).join(' ')
}
