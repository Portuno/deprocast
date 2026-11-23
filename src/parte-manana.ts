/**
 * El resumen de la mañana, por puntos (Fragua #329): se lee en el teléfono de una pasada. Un bloque por cosa, con
 * guiones cortos y en este orden: la agenda con sus horas, las primarias de la semana con su porcentaje, las side
 * quests, a quién le debe respuesta, y al final el cuerpo y la plata en una línea cada uno. Sin párrafos ni relleno:
 * lo que no tiene datos no aparece. El audio de la mañana sigue siendo un guion para escuchar; esto es lo que se lee.
 */
import { fechaLocal, type Db } from './db.ts'
import { conAvance, listarMisiones, semanaDe, seguimientos, sideQuestsRelevantes, type Mision } from './misiones.ts'
import { resumenDia } from './salud.ts'
import { resumenMes } from './finanzas.ts'

export type EventoDelDia = { titulo: string; inicio?: number; todoElDia?: boolean; lugar?: string | null }

const MAX_SIDE = 4
const n = (x: number, dec = 0) => x.toLocaleString('es-ES', { maximumFractionDigits: dec, minimumFractionDigits: 0 })
const plata = (x: number) => `${n(Math.round(x))} €`
const diaMes = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const ayerDe = (fecha: string) => { const [a, m, d] = fecha.split('-').map(Number); return fechaLocal(new Date(a, m - 1, d - 1, 12).getTime()) }
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** El cuerpo de ayer en una línea (sueño de esta noche, comida, ejercicio, peso); null si no hay nada anotado. */
export function lineaCuerpo(db: Db, fecha: string): string | null {
  const hoy = resumenDia(db, fecha) // el sueño se anota el día en que se despertó
  const ayer = resumenDia(db, ayerDe(fecha))
  const xs = [
    hoy.sueno?.horas != null ? `dormiste ${n(Number(hoy.sueno.horas), 1)} h` : '',
    ayer.comidas ? `ayer ${n(ayer.kcal)} kcal${ayer.proteina ? ` y ${n(ayer.proteina)} g de proteína` : ''}` : '',
    ayer.ejercicio.sesiones ? `${ayer.ejercicio.minutos ? `${n(ayer.ejercicio.minutos)} min de ` : ''}ejercicio` : '',
    hoy.peso && hoy.peso.fecha >= ayerDe(ayerDe(fecha)) ? `${n(hoy.peso.peso, 1)} kg` : '', // el peso, solo si es de estos días
  ].filter(Boolean)
  return xs.length ? xs.join(' · ') : null
}

/** La plata del mes en una línea (lo que entró contra la meta, lo que se gastó); null si no hay movimientos. */
export function lineaPlata(db: Db, ahora: number): string | null {
  const r = resumenMes(db, fechaLocal(ahora).slice(0, 7))
  if (!r.movimientos) return null
  const mes = MESES[Number(r.mes.slice(5, 7)) - 1]
  const entro = r.meta ? `entró ${plata(r.ingresos)} de ${plata(r.meta)} (${r.avanceMeta}%)` : `entró ${plata(r.ingresos)}`
  return `${mes}: ${entro}, gastaste ${plata(r.gastos)}`
}

/** Las side quests que van: primero las que tocan con lo que hay en la agenda, después las que vencen antes. */
function sideQuestsDelDia(db: Db, eventos: EventoDelDia[]): Mision[] {
  const tocan = sideQuestsRelevantes(db, eventos.map((e) => `${e.titulo} ${e.lugar ?? ''}`).join(' '))
  const abiertas = listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria', estados: ['activa'] })
    .sort((a, b) => (a.vence ?? '9999').localeCompare(b.vence ?? '9999') || a.id - b.id)
  const out: Mision[] = []
  for (const m of [...tocan, ...abiertas]) if (!out.some((x) => x.id === m.id)) out.push(m)
  return out.slice(0, MAX_SIDE)
}

/** El parte de la mañana, en markdown por puntos. */
export function parteDeLaManana(db: Db, o: { fecha?: string; ahora?: number; eventos?: EventoDelDia[]; saludo?: boolean } = {}): string {
  const ahora = o.ahora ?? Date.now()
  const fecha = o.fecha ?? fechaLocal(ahora)
  const eventos = [...(o.eventos ?? [])].sort((a, b) => Number(!a.todoElDia) - Number(!b.todoElDia) || (a.inicio ?? 0) - (b.inicio ?? 0))
  const primarias = conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa', 'sugerida'] }))
  const aceptadas = primarias.filter((p) => p.estado === 'activa')
  const sides = sideQuestsDelDia(db, eventos)
  const deben = seguimientos(db, ahora)
  const cuerpo = lineaCuerpo(db, fecha)
  const dinero = lineaPlata(db, ahora)
  const hora = new Date(ahora).getHours()
  const bloques: string[] = []
  if (o.saludo !== false) bloques.push(hora < 13 ? 'Buen día.' : hora < 20 ? 'Buenas tardes.' : 'Buenas noches.')
  bloques.push(['**Agenda**', ...(eventos.length ? eventos.map((e) => `- ${e.todoElDia || e.inicio == null ? 'todo el día' : new Date(e.inicio).toTimeString().slice(0, 5)} ${e.titulo}`) : ['- Nada agendado'])].join('\n'))
  bloques.push(['**Primarias de la semana**', ...(aceptadas.length
    ? aceptadas.map((p) => `- ${p.titulo} — ${p.avance.progreso}%`)
    : [primarias.length ? '- Sugeridas, sin aceptar: aceptalas o cambialas en Misiones' : '- Ninguna esta semana'])].join('\n'))
  if (sides.length) bloques.push(['**Side quests**', ...sides.map((m) => `- ${m.titulo}${m.vence ? ` (vence ${diaMes(m.vence)})` : ''}`)].join('\n'))
  if (deben.length) bloques.push(['**Te deben respuesta**', ...deben.map((m) => `- ${m.titulo}`)].join('\n'))
  const finales = [cuerpo ? `- Cuerpo: ${cuerpo}` : '', dinero ? `- Plata: ${dinero}` : ''].filter(Boolean)
  if (finales.length) bloques.push(finales.join('\n'))
  return bloques.join('\n\n')
}
