/**
 * Calendario de solo lectura por dirección secreta iCal (Google Calendar → Configuración → «Dirección secreta en formato iCal»).
 * Cero OAuth. Parser ICS mínimo: VEVENT con DTSTART/DTEND (UTC, TZID o día entero), SUMMARY, LOCATION y RRULE simple
 * (diaria, semanal, mensual, anual con INTERVAL, BYDAY, UNTIL, COUNT). Lo demás se ignora.
 */

export type Evento = { titulo: string; inicio: number; fin: number; todoElDia: boolean; lugar: string | null }

type Crudo = { props: Record<string, { valor: string; params: Record<string, string> }>; exdates: number[] }

function desplegar(ics: string): string[] {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function bloques(ics: string): Crudo[] {
  const out: Crudo[] = []
  let actual: Crudo | null = null
  for (const l of desplegar(ics)) {
    if (l === 'BEGIN:VEVENT') actual = { props: {}, exdates: [] }
    else if (l === 'END:VEVENT') {
      if (actual) out.push(actual)
      actual = null
    } else if (actual) {
      const i = l.indexOf(':')
      if (i < 0) continue
      const [nombre, ...ps] = l.slice(0, i).split(';')
      const params = Object.fromEntries(ps.map((p) => p.split('=') as [string, string]))
      const valor = l.slice(i + 1)
      if (nombre === 'EXDATE') {
        for (const v of valor.split(',')) {
          const t = fechaIcs(v, params)
          if (t) actual.exdates.push(t.ms)
        }
      } else actual.props[nombre] = { valor, params }
    }
  }
  return out
}

/** Diferencia (ms) entre la hora de pared en `tz` y UTC para un instante. */
function desfase(tz: string, ms: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms
}

/** Hora de pared en una zona → instante UTC. */
function enZona(a: number, m: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const ingenuo = Date.UTC(a, m, d, h, mi, s)
  let ms = ingenuo - desfase(tz, ingenuo)
  ms = ingenuo - desfase(tz, ms)
  return ms
}

function fechaIcs(v: string, params: Record<string, string>): { ms: number; todoElDia: boolean } | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return null
  const [, a, me, d, h, mi, s, z] = m
  if (!h || params.VALUE === 'DATE') return { ms: new Date(+a, +me - 1, +d).getTime(), todoElDia: true }
  if (z) return { ms: Date.UTC(+a, +me - 1, +d, +h, +mi, +s), todoElDia: false }
  if (params.TZID) {
    try {
      return { ms: enZona(+a, +me - 1, +d, +h, +mi, +s, params.TZID), todoElDia: false }
    } catch {
      // zona desconocida: se toma como hora local del servidor
    }
  }
  return { ms: new Date(+a, +me - 1, +d, +h, +mi, +s).getTime(), todoElDia: false }
}

const DIAS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
const DIA_MS = 86_400_000

function inicioDelDia(ms: number) {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Días calendario entre dos fechas locales (robusto al cambio de horario). */
function diasEntre(a: number, b: number) {
  return Math.round((inicioDelDia(b) - inicioDelDia(a)) / DIA_MS)
}

/** ¿La regla de repetición cae en el día `dia` (inicio local)? */
function repiteEn(rrule: string, inicio: number, dia: number, exdates: number[]): boolean {
  const r = Object.fromEntries(rrule.split(';').map((x) => x.split('=')))
  const intervalo = Math.max(1, Number(r.INTERVAL ?? 1))
  const dias = diasEntre(inicio, dia)
  if (dias < 0) return false
  if (r.UNTIL) {
    const u = fechaIcs(r.UNTIL, {})
    if (u && inicioDelDia(u.ms) < dia) return false
  }
  const d0 = new Date(inicio)
  const dd = new Date(dia)
  let cae = false
  let ocurrencia = 0
  switch (r.FREQ) {
    case 'DAILY':
      cae = dias % intervalo === 0
      ocurrencia = dias / intervalo
      break
    case 'WEEKLY': {
      const byday = r.BYDAY ? r.BYDAY.split(',').map((x: string) => DIAS[x.slice(-2)]) : [d0.getDay()]
      const semanas = Math.floor((dias + ((d0.getDay() + 6) % 7)) / 7)
      cae = byday.includes(dd.getDay()) && semanas % intervalo === 0
      ocurrencia = semanas * byday.length
      break
    }
    case 'MONTHLY': {
      const meses = (dd.getFullYear() - d0.getFullYear()) * 12 + dd.getMonth() - d0.getMonth()
      cae = dd.getDate() === d0.getDate() && meses % intervalo === 0
      ocurrencia = meses / intervalo
      break
    }
    case 'YEARLY':
      cae = dd.getDate() === d0.getDate() && dd.getMonth() === d0.getMonth() && (dd.getFullYear() - d0.getFullYear()) % intervalo === 0
      ocurrencia = dd.getFullYear() - d0.getFullYear()
      break
    default:
      return false
  }
  if (!cae) return false
  if (r.COUNT && ocurrencia >= Number(r.COUNT)) return false
  return !exdates.some((x) => inicioDelDia(x) === dia)
}

/** Los eventos de un día local (YYYY-MM-DD) en uno o más ICS. */
export function eventosDelDia(icss: string[], fecha: string): Evento[] {
  const [a, m, d] = fecha.split('-').map(Number)
  const dia = new Date(a, m - 1, d).getTime()
  const out: Evento[] = []
  for (const ics of icss) {
    for (const b of bloques(ics)) {
      if (b.props.STATUS?.valor === 'CANCELLED' || !b.props.DTSTART) continue
      const ini = fechaIcs(b.props.DTSTART.valor, b.props.DTSTART.params)
      if (!ini) continue
      const finCrudo = b.props.DTEND ? fechaIcs(b.props.DTEND.valor, b.props.DTEND.params) : null
      const dur = finCrudo ? finCrudo.ms - ini.ms : ini.todoElDia ? DIA_MS : 3_600_000
      const rrule = b.props.RRULE?.valor
      let inicio: number | null = null
      if (rrule) {
        if (repiteEn(rrule, ini.ms, dia, b.exdates)) {
          const o = new Date(ini.ms)
          inicio = ini.todoElDia ? dia : new Date(a, m - 1, d, o.getHours(), o.getMinutes()).getTime()
        }
      } else if (ini.todoElDia ? inicioDelDia(ini.ms) <= dia && dia < inicioDelDia(ini.ms) + dur : inicioDelDia(ini.ms) === dia) {
        inicio = ini.todoElDia ? dia : ini.ms
      }
      if (inicio == null) continue
      out.push({
        titulo: (b.props.SUMMARY?.valor ?? '(sin título)').replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' '),
        inicio, fin: ini.todoElDia ? inicio + DIA_MS : inicio + dur, todoElDia: ini.todoElDia,
        lugar: b.props.LOCATION?.valor?.replace(/\\([,;\\])/g, '$1') || null,
      })
    }
  }
  return out.sort((x, y) => x.inicio - y.inicio)
}

// ─── lectura remota ─────────────────────────────────────────────────────

const cache = new Map<string, { en: number; texto: string }>()
let traer = async (url: string): Promise<string> => {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`calendario HTTP ${r.status}`)
  return r.text()
}
export function _probarCalendario(f: typeof traer) {
  traer = f
  cache.clear()
}

export function urlsCalendario(): string[] {
  return (process.env.GCAL_ICS_URLS ?? '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
}

/** Eventos del día de todos los calendarios configurados. Un calendario que falla no frena a los otros. */
export async function agendaDelDia(fecha: string): Promise<{ eventos: Evento[]; avisos: string[] }> {
  const avisos: string[] = []
  const textos: string[] = []
  for (const url of urlsCalendario()) {
    const c = cache.get(url)
    if (c && Date.now() - c.en < 10 * 60_000) {
      textos.push(c.texto)
      continue
    }
    try {
      const texto = await traer(url)
      cache.set(url, { en: Date.now(), texto })
      textos.push(texto)
    } catch (e) {
      avisos.push(`No pude leer un calendario: ${e instanceof Error ? e.message : e}`)
    }
  }
  return { eventos: eventosDelDia(textos, fecha), avisos }
}
