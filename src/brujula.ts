/**
 * La Brújula del día (el personaje 71): un tridente Cuerpo · Mente · Alma para arrancar, no una lista de tareas.
 * Sale de lo que hay: cómo le fue ayer (bandas, Directo: en qué se fue el foco), su ánimo (solo lo que compartió de
 * la bitácora), su energía por hora (memoria), la agenda de hoy, sus primarias y su principal. Si sabe poco, lo dice
 * y deja una pregunta. Llega a la mañana a Hoy (y por Telegram).
 */
import { fechaLocal, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { listarMisiones, principalDe, semanaDe } from './misiones.ts'
import { progreso } from './jornada.ts'
import { compartidas } from './bitacora.ts'
import { metricas, momentos } from './directo.ts'
import { agendaDelDia } from './calendario.ts'
import { encolarPregunta } from './preguntas.ts'
import { perfilDeRendimiento, textoDeRendimiento } from './rendimiento.ts'

export type Brujula = { fecha: string; cuerpo: string; mente: string; alma: string; foco: string; pregunta: string | null; creadaEn: number }
const deFila = (r: any): Brujula => ({ fecha: r.fecha, cuerpo: r.cuerpo, mente: r.mente, alma: r.alma, foco: r.foco, pregunta: r.pregunta, creadaEn: r.creada_en })

export const leerBrujula = (db: Db, fecha = fechaLocal()): Brujula | null => { const r = db.prepare('SELECT * FROM brujulas WHERE fecha = ?').get(fecha); return r ? deFila(r) : null }

/** Lo que pasó ayer en el Directo: minutos por actividad y por app, y lo que consumió. */
function directoDeAyer(db: Db, ayer: string): string {
  const ses = db.prepare(`SELECT id FROM directo_sesiones WHERE date(inicio / 1000, 'unixepoch', 'localtime') = ?`).all(ayer) as { id: number }[]
  if (!ses.length) return ''
  const ms = ses.flatMap((s) => momentos(db, s.id, { limite: 2000 }))
  const m = metricas(ms)
  const top = (o: Record<string, number>) => Object.entries(o).slice(0, 5).map(([k, v]) => `${k} ${v} min`).join(', ')
  return [`Directo de ayer: actividades ${top(m.minutosPorActividad) || '—'}; apps ${top(m.minutosPorApp) || '—'}.`, m.consumido.length ? `Consumió: ${m.consumido.slice(0, 4).map((c) => c.titulo).join('; ')}.` : ''].filter(Boolean).join(' ')
}

export async function reunirDatos(db: Db, ahora = Date.now()): Promise<{ texto: string; poco: boolean }> {
  const hoy = fechaLocal(ahora)
  const ayer = fechaLocal(ahora - 86_400_000)
  const p = progreso(db, ayer)
  const animo = compartidas(db, 5).filter((e) => e.fecha >= fechaLocal(ahora - 3 * 86_400_000))
  let agenda = ''
  try {
    const { eventos } = await agendaDelDia(hoy)
    agenda = eventos.map((e) => `${e.todoElDia ? 'todo el día' : new Date(e.inicio).toTimeString().slice(0, 5)} ${e.titulo}`).join('; ')
  } catch { /* sin calendario */ }
  const prims = listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] })
  const principal = principalDe(db, 'jugador')
  const directo = directoDeAyer(db, ayer)
  const rinde = textoDeRendimiento(perfilDeRendimiento(db, ahora))
  const memoria = memoriaParaPrompt(db, 30)
  const partes = [
    `Hoy es ${new Date(ahora).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}.`,
    p.total ? `Ayer: ${p.hechos} bandas hechas, ${p.parciales} a medias, ${p.saltados} no, de ${p.total}.` : 'Ayer no hubo run.',
    directo,
    animo.length ? `Lo que compartió de su bitácora estos días: ${animo.map((e) => `${e.fecha}${e.animo ? ` (ánimo ${e.animo}/5)` : ''}: ${String(e.texto).slice(0, 200)}`).join(' | ')}` : '',
    agenda ? `Agenda de hoy: ${agenda}.` : 'Agenda de hoy: nada cargado.',
    principal ? `Su misión principal: ${principal.titulo}.` : '',
    prims.length ? `Primarias de la semana: ${prims.map((m) => m.titulo).join('; ')}.` : '',
    rinde ? `Cómo rinde según sus runs:\n${rinde}` : '',
    memoria ? `Lo que sabés de él:\n${memoria}` : '',
  ].filter(Boolean)
  return { texto: partes.join('\n'), poco: !p.total && !directo && !animo.length && !prims.length }
}

const SISTEMA = `Sos Mastropiero hablando como la Brújula: le das al jugador el tridente del día para arrancar. No es una lista de tareas.
Forma: {"cuerpo": string, "mente": string, "alma": string, "foco": string, "pregunta": string | null}
- «cuerpo» (Trinchera): cómo cuidar el cuerpo y la energía hoy (horas buenas, pausas, moverse), según lo que se sabe.
- «mente» (Campamento): dónde poner la cabeza hoy, conectado con sus primarias y su agenda.
- «alma» (Castillo): el sentido del día en una frase, conectado con su principal o con lo que compartió.
- «foco»: una sola cosa que, si la hace, el día ya valió.
- Cada campo, una o dos oraciones, castellano rioplatense, cálido y directo, sin sermones ni frases de autoayuda.
- Usá solo lo que está en los datos. Si sabés poco, decilo con naturalidad y en «pregunta» dejá UNA pregunta que te ayude a conocerlo mejor (si no, null).`

export async function brujulaDelDia(db: Db, o: { ahora?: number; forzar?: boolean } = {}): Promise<Brujula> {
  const ahora = o.ahora ?? Date.now()
  const fecha = fechaLocal(ahora)
  const ya = leerBrujula(db, fecha)
  if (ya && !o.forzar) return ya
  const { texto, poco } = await reunirDatos(db, ahora)
  const { datos } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'brujula' }, SISTEMA, texto, { temperatura: 0.6, maxTokens: 1200 })
  const s = (x: unknown) => String(x ?? '').trim().slice(0, 500)
  const b = { fecha, cuerpo: s(datos.cuerpo), mente: s(datos.mente), alma: s(datos.alma), foco: s(datos.foco), pregunta: datos.pregunta ? s(datos.pregunta) : null }
  if (!b.cuerpo && !b.mente && !b.alma) throw new Error('La brújula salió vacía')
  db.prepare('INSERT OR REPLACE INTO brujulas (fecha, cuerpo, mente, alma, foco, pregunta, datos, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(fecha, b.cuerpo, b.mente, b.alma, b.foco, b.pregunta, JSON.stringify({ poco }), ahora)
  if (b.pregunta) encolarPregunta(db, { texto: b.pregunta, porQue: 'Para que la brújula te conozca mejor', origen: 'brujula' }, ahora)
  return leerBrujula(db, fecha)!
}

export const textoDeBrujula = (b: Brujula) => `🧭 **La brújula de hoy**\n**Cuerpo:** ${b.cuerpo}\n**Mente:** ${b.mente}\n**Alma:** ${b.alma}\n\n**Si hacés una sola cosa:** ${b.foco}`
