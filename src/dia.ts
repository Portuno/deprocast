/**
 * El día entero en un solo lugar, y cada cosa con su fuente: para que «¿hoy qué tengo?» se conteste con lo que hay
 * (su agenda, su horario fijo, la run, las primarias, las side quests) y no con deducciones.
 */
import { fechaLocal, type Db } from './db.ts'
import { agendaDelDia } from './calendario.ts'
import { bloquesDelDia } from './horario.ts'
import { listarMisiones, listarRuns, misionesDeRun, semanaDe } from './misiones.ts'
import { diaSemana } from './zona.ts'

const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

export async function verDia(db: Db, fecha = fechaLocal()) {
  const { eventos, avisos } = await agendaDelDia(fecha).catch(() => ({ eventos: [], avisos: ['No pude leer el calendario'] }))
  const runs = listarRuns(db, { fecha }).filter((r) => r.estado !== 'descartada')
  const semana = semanaDe(new Date(`${fecha}T12:00:00`).getTime())
  return {
    fecha, dia: diaSemana(fecha),
    agenda: eventos.map((e) => ({ hora: e.todoElDia ? 'todo el día' : `${hora(e.inicio)}–${hora(e.fin)}`, titulo: e.titulo, lugar: e.lugar, fuente: 'su calendario' })),
    fijo: bloquesDelDia(db, fecha).map((b) => ({ ...b, fuente: 'su horario fijo' })),
    runs: runs.map((r) => ({ inicio: r.inicio, fin: r.fin, estado: r.estado, bandas: misionesDeRun(db, r.id).map((m) => `${m.inicio}–${m.fin} ${m.titulo} [${m.estado}]`), fuente: 'la run' })),
    primarias: listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana, abiertas: true }).map((m) => ({ id: m.id, titulo: m.titulo, estado: m.estado, fuente: 'sus primarias de la semana' })),
    sideQuestsDeHoy: listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria', abiertas: true }).filter((m) => m.vence === fecha).map((m) => ({ id: m.id, titulo: m.titulo, fuente: 'side quest con fecha' })),
    avisos,
    nota: 'Todo esto sale de lo que tiene cargado. Lo que no figura acá (una reunión, un horario) no lo afirmes: preguntá.',
  }
}

/** La agenda de varios días (como máximo 14). */
export async function verAgenda(db: Db, desde = fechaLocal(), hasta?: string) {
  const fin = hasta && hasta >= desde ? hasta : desde
  const dias: { fecha: string; dia: string; eventos: { hora: string; titulo: string; lugar: string | null }[]; fijo: { desde: string; hasta: string; que: string }[] }[] = []
  for (let f = desde, i = 0; f <= fin && i < 14; i++) {
    const { eventos } = await agendaDelDia(f).catch(() => ({ eventos: [] as Awaited<ReturnType<typeof agendaDelDia>>['eventos'] }))
    dias.push({ fecha: f, dia: diaSemana(f), eventos: eventos.map((e) => ({ hora: e.todoElDia ? 'todo el día' : `${hora(e.inicio)}–${hora(e.fin)}`, titulo: e.titulo, lugar: e.lugar })), fijo: bloquesDelDia(db, f) })
    f = fechaLocal(new Date(`${f}T12:00:00`).getTime() + 86_400_000)
  }
  return dias
}
