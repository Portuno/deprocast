/**
 * La gnosis: lo que vive (cuerpo, plata, plan, aprendizaje, trabajo, Directo) no queda en tablas sueltas: entra al
 * núcleo de conocimiento, el mismo de siempre (corpus → quántomos → memoria → entidades).
 * - Cada noche, la crónica del día: una pieza propia (nivel I, «Mía») con todo lo que registró, armada sin modelo.
 *   Queda buscable, con sus entidades, y es materia para el escriba, los quántomos y las respuestas.
 * - Cada domingo, la síntesis: Mastropiero lee las crónicas de la semana y lo que sabe de él, y destila patrones que
 *   cruzan dominios («los días que entrena, vota más verbos»). Cada patrón es un quántomo proto (para que él lo pese,
 *   1–12, como cualquier otro) y un recuerdo sin revisar; más una o dos preguntas para seguir conociéndolo.
 */
import { fechaLocal, type Db } from './db.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { crearQuantomo } from './quantomos.ts'
import { memoriaParaPrompt, recordar } from './memoria.ts'
import { pedirJson } from './modelo.ts'
import { encolarPregunta } from './preguntas.ts'
import { resumenDia, listarSalud } from './salud.ts'
import { listarMovimientos } from './finanzas.ts'
import { diaDelPlan, VERBOS } from './cien.ts'
import { progreso } from './jornada.ts'
import { vozPara } from './personalidad.ts'

const FUENTE = { id: 'vida', nombre: 'Mi vida (registros)', nivel: 'propia', descripcion: 'La crónica de cada día: cuerpo, plata, plan, aprendizaje y trabajo, armada con lo que registró.' }
const FUENTE_SINTESIS = { id: 'gnosis', nombre: 'Gnosis (síntesis)', nivel: 'investigacion', descripcion: 'Lo que Mastropiero destila de sus semanas: patrones que cruzan dominios.' }

const dia = (fecha: string) => { const d = new Date(`${fecha}T00:00:00`).getTime(); return [d, d + 86_400_000] as const }

/** La crónica de un día, en texto (sin modelo). Vacía si ese día no registró nada. */
export function cronicaDelDia(db: Db, fecha: string): { texto: string; entidades: number[] } {
  const [desde, hasta] = dia(fecha)
  const partes: string[] = []
  const entidades = new Set<number>()

  const plan = diaDelPlan(db, fecha)
  if (plan && fecha >= plan.plan.desde && fecha <= plan.plan.hasta) {
    const votados = VERBOS.filter(([k]) => plan.dia.verbos[k]).map(([, n]) => n)
    const hechos = plan.habitos.filter((h) => h.hecho).map((h) => h.titulo)
    const lineas = [
      votados.length ? `Verbos votados: ${votados.join(', ')}.` : '',
      hechos.length ? `Hábitos hechos: ${hechos.join('; ')}.` : '',
      plan.dia.woop?.w ? `WOOP — deseo: ${plan.dia.woop.w}${plan.dia.woop.ob ? `; obstáculo: ${plan.dia.woop.ob}` : ''}${plan.dia.woop.p ? `; plan: ${plan.dia.woop.p}` : ''}.` : '',
      plan.dia.nota ? `Nota: ${plan.dia.nota}` : '',
    ].filter(Boolean)
    if (lineas.length) partes.push(`## ${plan.plan.nombre}, día ${plan.n} de ${plan.total}\n${lineas.join('\n')}`)
  }

  const cerradas = db.prepare(`SELECT titulo, entidad_id, nivel FROM misiones WHERE personaje = 'jugador' AND estado = 'hecha' AND cerrada_en >= ? AND cerrada_en < ?`).all(desde, hasta) as { titulo: string; entidad_id: number | null; nivel: string }[]
  const p = progreso(db, fecha)
  const directos = (db.prepare(`SELECT informe FROM directo_sesiones WHERE inicio >= ? AND inicio < ? AND informe IS NOT NULL`).all(desde, hasta) as { informe: string }[]).map((d) => d.informe.split(/\n{2,}/)[0].slice(0, 600))
  for (const m of cerradas) if (m.entidad_id) entidades.add(m.entidad_id)
  const trabajo = [
    p.total ? `Run: ${p.hechos} bandas hechas, ${p.parciales} a medias, ${p.saltados} no, de ${p.total}.` : '',
    cerradas.length ? `Cerró: ${cerradas.map((m) => m.titulo).join('; ')}.` : '',
    ...directos.map((d) => `Directo: ${d}`),
  ].filter(Boolean)
  if (trabajo.length) partes.push(`## Trabajo\n${trabajo.join('\n')}`)

  const s = resumenDia(db, fecha)
  const comidas = listarSalud(db, { fecha, tipo: 'comida' })
  const ejercicio = listarSalud(db, { fecha, tipo: 'ejercicio' })
  const cuerpo = [
    comidas.length ? `Comió (${s.kcal} kcal, ${s.proteina} g de proteína): ${comidas.map((c) => `${c.hora ?? ''} ${c.titulo}`.trim()).join('; ')}.` : '',
    ejercicio.length ? `Ejercicio: ${ejercicio.map((e) => `${e.titulo}${e.datos.minutos ? ` (${e.datos.minutos} min)` : ''}`).join('; ')}.` : '',
    s.sueno?.horas != null ? `Durmió ${s.sueno.horas} h${s.sueno.calidad ? ` (${['', 'mal', 'bien', 'muy bien'][s.sueno.calidad]})` : ''}.` : '',
    s.peso?.fecha === fecha ? `Peso: ${s.peso.peso} kg.` : '',
  ].filter(Boolean)
  if (cuerpo.length) partes.push(`## Cuerpo\n${cuerpo.join('\n')}`)

  const plata = listarMovimientos(db, { mes: fecha.slice(0, 7), limite: 5000 }).filter((m) => m.fecha === fecha)
  for (const m of plata) if (m.entidadId) entidades.add(m.entidadId)
  if (plata.length) partes.push(`## Plata\n${plata.map((m) => `${m.monto > 0 ? '+' : ''}${m.monto} ${m.moneda} · ${m.descripcion} (${m.categoria}${m.entidad ? ` · ${m.entidad}` : ''})`).join('\n')}`)

  const practicas = db.prepare(`SELECT a.tema, p.minutos, p.que FROM practicas p JOIN aprendizajes a ON a.id = p.aprendizaje_id WHERE p.fecha = ?`).all(fecha) as { tema: string; minutos: number | null; que: string | null }[]
  if (practicas.length) partes.push(`## Aprendizaje\n${practicas.map((x) => `${x.tema}${x.minutos ? ` ${x.minutos} min` : ''}${x.que ? `: ${x.que}` : ''}`).join('\n')}`)

  const dijo = (db.prepare(`SELECT COUNT(*) AS n FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id WHERE m.rol = 'operador' AND c.con = 'mastropiero' AND m.en >= ? AND m.en < ?`).get(desde, hasta) as { n: number }).n
  if (!partes.length) return { texto: '', entidades: [] }
  const encabezado = `# Crónica del ${new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${dijo ? `\n(Le habló a Mastropiero ${dijo} ${dijo === 1 ? 'vez' : 'veces'}.)` : ''}`
  return { texto: [encabezado, ...partes].join('\n\n'), entidades: [...entidades] }
}

/** Escribe (o reescribe) la crónica del día en el corpus. null si no hubo nada que contar. */
export function escribirCronica(db: Db, fecha: string, ahora = Date.now()): number | null {
  const { texto, entidades } = cronicaDelDia(db, fecha)
  if (!texto) return null
  asegurarFuente(db, FUENTE)
  const origen = `cronica:${fecha}`
  const ya = db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(origen) as { id: number } | undefined
  if (ya) {
    db.prepare('UPDATE corpus SET contenido = ?, entidades = ? WHERE id = ?').run(texto, JSON.stringify(entidades), ya.id)
    return ya.id
  }
  return insertar(db, {
    fuente: FUENTE.id, nivel: 'propia', titulo: `Crónica · ${fecha}`, contenido: texto, estado: 'disponible', fecha, etiquetas: ['cronica', 'vida'],
    entidades, origenId: origen, meta: { tipo: 'cronica' },
  }, ahora)
}

// ─── la síntesis de la semana ───────────────────────────────────────────

const SISTEMA = `Sos Mastropiero y destilás la semana del jugador: leés sus crónicas diarias (cuerpo, plata, plan, aprendizaje, trabajo) y lo que ya sabés de él, y encontrás lo que él no ve día a día.
- «patrones»: de 2 a 5 afirmaciones atómicas y verificables que CRUZAN dominios o se repiten en la semana («Los tres días que entrenó votó al menos tres verbos», «El gasto en comida fuera sube los días de oficina», «Practica francés cuando camina»). Cada una con su evidencia (días o números). Nada genérico ni de autoayuda. Si no hay patrón real, menos o ninguno.
- «texto»: la carta de la semana en dos o tres párrafos cortos, tratándolo de usted, directa: qué se movió, qué se trabó, qué conviene la semana que viene.
- «preguntas»: 1 o 2 preguntas concretas cuya respuesta te haría entenderlo mejor (lo que los datos no dicen).
Forma: {"patrones": [{"texto": string, "evidencia": string}], "texto": string, "preguntas": [string]}`

let modelo = async (db: Db, usuario: string) => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'gnosis' }, `${SISTEMA}

${vozPara('ceremonia')}`, usuario, { temperatura: 0.4, maxTokens: 3000, largo: true })).datos
export function _probarGnosis(f: typeof modelo) {
  modelo = f
}

/** La semana que termina en «hasta»: escribe las crónicas que falten, destila patrones y deja la carta. */
export async function sintesisSemanal(db: Db, hasta = fechaLocal(), ahora = Date.now()): Promise<{ piezaId: number | null; patrones: number; preguntas: number; texto: string } | null> {
  const fechas = Array.from({ length: 7 }, (_, i) => fechaLocal(new Date(`${hasta}T12:00:00`).getTime() - (6 - i) * 86_400_000))
  for (const f of fechas) escribirCronica(db, f, ahora)
  const cronicas = (db.prepare(`SELECT titulo, contenido FROM corpus WHERE origen_id IN (${fechas.map(() => '?').join(',')}) ORDER BY fecha`).all(...fechas.map((f) => `cronica:${f}`)) as { titulo: string; contenido: string }[])
  if (cronicas.length < 2) return null // con menos de dos días registrados no hay semana que leer
  const d = await modelo(db, `Semana del ${fechas[0]} al ${hasta}.\n\nCrónicas:\n${cronicas.map((c) => c.contenido.slice(0, 3000)).join('\n\n---\n\n')}\n\nLo que sabés de él:\n${memoriaParaPrompt(db, 40)}`) ?? {}
  const texto = String(d.texto ?? '').trim()
  asegurarFuente(db, FUENTE_SINTESIS)
  const piezaId = texto ? insertar(db, {
    fuente: FUENTE_SINTESIS.id, nivel: 'investigacion', titulo: `Semana del ${fechas[0]} al ${hasta}`, contenido: [texto, ...(d.patrones ?? []).map((p: any) => `- ${p.texto} (${p.evidencia ?? ''})`)].join('\n\n'),
    estado: 'disponible', fecha: hasta, etiquetas: ['gnosis', 'semana'], origenId: `gnosis:${hasta}`,
  }, ahora) : null
  let patrones = 0
  for (const p of (Array.isArray(d.patrones) ? d.patrones : []).slice(0, 5)) {
    const t = String(p?.texto ?? '').trim()
    if (t.length < 12) continue
    // Un quántomo proto: él lo pesa (1–12) como cualquier otro. Y un recuerdo sin revisar, para que Mastropiero lo use ya.
    if (crearQuantomo(db, { texto: t, titulo: 'Patrón de la semana', piezaId, universo: 'vida', procedencia: `gnosis ${hasta}${p.evidencia ? ` · ${String(p.evidencia).slice(0, 200)}` : ''}`, origenId: `gnosis:${hasta}:${patrones}` }, ahora)) {
      recordar(db, { texto: t, tipo: 'hecho', creadaPor: 'gnosis', revisada: false, piezaId, fecha: hasta }, ahora)
      patrones++
    }
  }
  let preguntas = 0
  for (const q of (Array.isArray(d.preguntas) ? d.preguntas : []).slice(0, 2)) if (encolarPregunta(db, { texto: String(q), porQue: 'De la síntesis de la semana', origen: 'gnosis' }, ahora)) preguntas++
  return { piezaId, patrones, preguntas, texto }
}
