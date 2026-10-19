/**
 * Aburrimiento y estímulo: cuánto puede sostener la atención, medido con lo que ya registra el Directo (sin modelo).
 * Por día: el tramo más largo sin cambiar de app ni de tema, los cambios por hora y los minutos en apps de alto estímulo
 * (lista editable: ajuste apps_estimulo). La tendencia de 14 días va en el Directo y en Hoy; la «meta de bloque» crece
 * de a poco (lo mejor de la semana + 5 minutos) y la run la usa para el largo de sus bandas de foco.
 */
import { ajuste, fechaLocal, type Db } from './db.ts'

const MIN = 60_000
const DIA = 86_400_000
const norm = (s: string | null) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

export type FocoDia = { fecha: string; minutos: number; bloqueMax: number; cambiosPorHora: number | null; estimulo: number; bloqueQue: string | null }

export const appsEstimulo = (db: Db): string[] => String(ajuste(db, 'apps_estimulo') ?? '').split(',').map((x) => norm(x)).filter((x) => x.length >= 1)

/** Las métricas de un día con lo que se vio en pantalla. */
export function focoDelDia(db: Db, fecha: string, estimulo = appsEstimulo(db)): FocoDia {
  const t0 = new Date(`${fecha}T00:00:00`).getTime()
  const ms = db.prepare(`SELECT desde, hasta, app, tema, detalle FROM directo_momentos WHERE tipo = 'pantalla' AND desde >= ? AND desde < ? ORDER BY desde`)
    .all(t0, t0 + DIA) as { desde: number; hasta: number; app: string | null; tema: string | null; detalle: string | null }[]
  if (!ms.length) return { fecha, minutos: 0, bloqueMax: 0, cambiosPorHora: null, estimulo: 0, bloqueQue: null }
  // Un momento de un solo cuadro dura al menos un minuto (lo que tarda el cuadro siguiente).
  const dur = (m: { desde: number; hasta: number }) => Math.max(MIN, m.hasta - m.desde)
  let minutos = 0
  let est = 0
  let cambios = 0
  let mejor = { largo: 0, que: null as string | null }
  let tramo = { desde: ms[0].desde, hasta: ms[0].desde + dur(ms[0]), clave: '' }
  const claveDe = (m: (typeof ms)[number]) => `${norm(m.app)}|${norm(m.tema)}`
  tramo.clave = claveDe(ms[0])
  ms.forEach((m, i) => {
    minutos += dur(m)
    const texto = `${norm(m.app)} ${norm(m.detalle)}`
    if (estimulo.some((e) => texto.includes(e))) est += dur(m)
    if (i === 0) return
    const ant = ms[i - 1]
    const seguido = m.desde - ant.hasta <= 3 * MIN
    const misma = claveDe(m) === tramo.clave
    // Un cambio: de una app o tema a otro sin cortar la sesión (más de 10 minutos sin pantalla es otro rato).
    if (claveDe(m) !== claveDe(ant) && m.desde - ant.hasta <= 10 * MIN) cambios++
    if (seguido && misma) tramo.hasta = Math.max(tramo.hasta, m.desde + dur(m))
    else {
      if (tramo.hasta - tramo.desde > mejor.largo) mejor = { largo: tramo.hasta - tramo.desde, que: tramo.clave }
      tramo = { desde: m.desde, hasta: m.desde + dur(m), clave: claveDe(m) }
    }
  })
  if (tramo.hasta - tramo.desde > mejor.largo) mejor = { largo: tramo.hasta - tramo.desde, que: tramo.clave }
  const horas = minutos / 60 / MIN
  const [app, tema] = (mejor.que ?? '|').split('|')
  return {
    fecha, minutos: Math.round(minutos / MIN), bloqueMax: Math.round(mejor.largo / MIN),
    cambiosPorHora: horas >= 0.25 ? Math.round((cambios / horas) * 10) / 10 : null, estimulo: Math.round(est / MIN),
    bloqueQue: [app, tema].filter(Boolean).join(' · ') || null,
  }
}

/** Los últimos n días (los sin datos, en cero) y la meta de bloque. */
export function tendenciaFoco(db: Db, dias = 14, ahora = Date.now()) {
  const est = appsEstimulo(db)
  const xs = Array.from({ length: dias }, (_, i) => focoDelDia(db, fechaLocal(ahora - (dias - 1 - i) * DIA), est))
  const conDatos = xs.filter((x) => x.minutos > 0)
  const semana = xs.slice(-7).filter((x) => x.minutos > 0)
  const promedio = (f: (x: FocoDia) => number) => (conDatos.length ? Math.round(conDatos.reduce((s, x) => s + f(x), 0) / conDatos.length) : null)
  return { dias: xs, meta: metaDeBloque(db, ahora, xs), promedioBloque: promedio((x) => x.bloqueMax), promedioEstimulo: promedio((x) => x.estimulo), mejorSemana: semana.length ? Math.max(...semana.map((x) => x.bloqueMax)) : null, apps: est }
}

/** Lo mejor de los últimos 7 días + 5 minutos (de 15 a 120): la atención se entrena de a poco. null sin datos. */
export function metaDeBloque(db: Db, ahora = Date.now(), xs?: FocoDia[]): number | null {
  const ultimos = (xs ?? Array.from({ length: 7 }, (_, i) => focoDelDia(db, fechaLocal(ahora - i * DIA)))).slice(-7).filter((x) => x.minutos > 0)
  if (!ultimos.length) return null
  return Math.max(15, Math.min(120, Math.max(...ultimos.map((x) => x.bloqueMax)) + 5))
}

/** Para el armado de la run: una línea (o nada si no hay Directo). */
export function focoParaRun(db: Db, ahora = Date.now()): string {
  const meta = metaDeBloque(db, ahora)
  return meta ? `Su atención sostenida (según el Directo): su mejor bloque de la semana fue de ${meta - 5} minutos sin cambiar de tema. Las bandas de foco hondo, de unos ${meta} minutos (un poco más que su mejor marca, para entrenarla); no más largas.` : ''
}
