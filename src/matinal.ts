/**
 * El audio de la mañana: Mastropiero arma un guion de 2 a 3 minutos (qué pasó ayer, qué toca hoy, lo que trabajó solo
 * de noche y una pregunta), lo pasa a voz y se lo manda por Telegram. Él lo escucha caminando y contesta con una nota
 * de voz, que el bot ya entiende. En Hoy queda el texto.
 */
import { fechaLocal, type Db } from './db.ts'
import { agendaDelDia } from './calendario.ts'
import { progreso } from './jornada.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { aportes as aportesDe } from './ayudantes.ts'
import { conAvance, listarMisiones, semanaDe, seguimientos } from './misiones.ts'
import { pedirJson } from './modelo.ts'
import { saludParaPrompt } from './salud.ts'
import { finanzasParaPrompt } from './finanzas.ts'
import { cienParaPrompt, diaDelPlan } from './cien.ts'
import { aprenderParaPrompt } from './aprender.ts'
import { vozPara } from './personalidad.ts'

const SISTEMA = `Sos Mastropiero y grabás el audio de la mañana para el jugador: lo escucha caminando, antes de arrancar.
Escribí el guion para leer en voz alta, de 2 a 3 minutos (entre 300 y 450 palabras):
- Primero, en dos o tres frases, cómo le fue ayer (si hay datos), incluido su cuerpo si hay datos (comió, entrenó, durmió), sin sermones.
- Después qué tiene hoy: la agenda y la primaria que más conviene empujar, con su nombre.
- Lo que la plataforma hizo sola de noche, solo si hay algo que él tenga que mirar (una forja lista para aplicar, aportes de sus ayudantes), en una frase.
- Terminá con UNA pregunta concreta para que te conteste con una nota de voz.
Para escuchar, no para leer: frases cortas, sin listas, sin títulos, sin markdown, sin emojis, sin números de id. Castellano argentino, tratándolo de usted, cercano, sin exagerar. No inventes nada que no esté en los datos.
Forma: {"guion": string}`

let escribir = async (db: Db, usuario: string) => (await pedirJson<{ guion?: string }>({ db, clase: 'mastropiero', agenteId: 'matinal' }, `${SISTEMA}

${vozPara('ceremonia')}`, usuario, { temperatura: 0.6, maxTokens: 2500 })).datos
export function _probarMatinal(f: typeof escribir) {
  escribir = f
}

const ayerDe = (fecha: string) => { const [a, m, d] = fecha.split('-').map(Number); return fechaLocal(new Date(a, m - 1, d - 1, 12).getTime()) }

/** Lo que sabe del día para el guion. */
export async function materialMatinal(db: Db, fecha: string, ahora = Date.now()): Promise<string> {
  const ayer = ayerDe(fecha)
  const desdeAyer = new Date(`${ayer}T00:00:00`).getTime()
  const pAyer = progreso(db, ayer)
  const cierre = (db.prepare('SELECT cierre FROM jornadas WHERE fecha = ?').get(ayer) as { cierre: string | null } | undefined)?.cierre ?? null
  const directos = (db.prepare(`SELECT informe FROM directo_sesiones WHERE inicio >= ? AND inicio < ? AND informe IS NOT NULL`).all(desdeAyer, desdeAyer + 86_400_000) as { informe: string }[]).map((d) => d.informe.slice(0, 600))
  const { eventos } = await agendaDelDia(fecha).catch(() => ({ eventos: [] as { titulo: string; inicio: number; todoElDia: boolean }[] }))
  const primarias = conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] }))
  const deben = seguimientos(db, ahora)
  const forjas = db.prepare(`SELECT pedido FROM fragua WHERE estado = 'lista'`).all() as { pedido: string }[]
  const aportes = aportesDe(db, { desde: ahora - 86_400_000, limite: 5 })
  const dia = new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  return [
    `Hoy es ${dia}.`,
    pAyer.total ? `Ayer: ${pAyer.hechos} bandas hechas, ${pAyer.parciales} a medias y ${pAyer.saltados} que no, de ${pAyer.total}.` : 'Ayer no hubo run.',
    cierre ? `Su cierre de ayer: ${cierre.slice(0, 500)}` : '',
    directos.length ? `Lo que vio el Directo ayer:\n${directos.join('\n')}` : '',
    eventos.length ? `Agenda de hoy: ${eventos.map((e) => `${e.todoElDia ? 'todo el día' : new Date(e.inicio).toTimeString().slice(0, 5)} ${e.titulo}`).join(' · ')}` : 'Agenda de hoy vacía.',
    primarias.length ? `Primarias de la semana: ${primarias.map((p) => `${p.titulo} (${p.avance.progreso}%)`).join(' · ')}` : 'No tiene primarias aceptadas esta semana.',
    deben.length ? `Le deben respuesta: ${deben.map((m) => m.titulo).join(' · ')}` : '',
    forjas.length ? `La Fragua dejó ${forjas.length} mejora${forjas.length > 1 ? 's' : ''} lista${forjas.length > 1 ? 's' : ''} para aplicar: ${forjas.map((f) => f.pedido.split('\n')[0].slice(0, 80)).join(' · ')}` : '',
    saludParaPrompt(db, ahora),
    finanzasParaPrompt(db, ahora),
    cienParaPrompt(db, ahora),
    aprenderParaPrompt(db, ahora),
    (() => { const d = diaDelPlan(db, fecha); return d && fecha >= d.plan.desde && fecha <= d.plan.hasta && !d.dia.woop?.w ? 'Tiene un plan con WOOP diario y hoy todavía no lo hizo: tu pregunta final es que te dicte su WOOP de hoy (deseo, resultado, obstáculo interno, plan si-entonces) en una nota de voz.' : '' })(),
    aportes.length ? `Aportes nuevos de sus ayudantes: ${aportes.map((a) => a.titulo).join(' · ')}` : '',
    `Lo que sabés de él:\n${memoriaParaPrompt(db, 20)}`,
  ].filter(Boolean).join('\n')
}

/** El guion de la mañana (sin voz). */
export async function guionMatinal(db: Db, fecha = fechaLocal(), ahora = Date.now()): Promise<string> {
  const datos = await escribir(db, await materialMatinal(db, fecha, ahora))
  const guion = String(datos?.guion ?? '').replace(/[*_#`]+/g, '').trim()
  if (guion.length < 80) throw new Error('El guion de la mañana salió vacío')
  return guion.slice(0, 3200)
}
