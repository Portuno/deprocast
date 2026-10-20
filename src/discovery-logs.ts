/**
 * Minería de procesos sin modelo: el log de eventos que exporta el ERP o el CRM del cliente (caso, actividad, fecha y hora,
 * área o recurso) dice cómo es el proceso de verdad, no cómo está documentado. De ahí salen las variantes (y la más
 * común), los pasos reales, el tiempo entre pasos (mediana y p90), los retrabajos (un paso que se repite en un caso),
 * los traspasos entre áreas con su espera, la duración de cada caso y el volumen por mes.
 * «Se documentó en 11 pasos; en el ERP eran 20 y 4 más en el mail.»
 */

export type Mapeo = { caso: string; actividad: string; fecha: string; area: string | null }
export type Analisis = {
  columnas: string[]; mapeo: Mapeo; eventos: number; casos: number; descartados: number; desde: string | null; hasta: string | null
  volumenMes: { mes: string; casos: number }[]
  actividades: { nombre: string; veces: number; casos: number; area: string | null; hastaSiguiente: { mediana: number | null; p90: number | null } }[]
  variantes: { pasos: string[]; casos: number; pct: number }[]
  pasosVarianteComun: number; actividadesDistintas: number
  retrabajos: { actividad: string; casos: number; pct: number }[]
  traspasos: { de: string; a: string; veces: number; espera: { mediana: number | null; p90: number | null } }[]
  duracionCaso: { mediana: number | null; p90: number | null } // horas
}

const MIN = 60_000

/** Lee un CSV (coma o punto y coma, con comillas). Primera fila: encabezados. */
export function leerCsv(texto: string): { columnas: string[]; filas: string[][] } {
  const t = texto.replace(/^﻿/, '')
  const primera = t.split(/\r?\n/, 1)[0] ?? ''
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : primera.includes('\t') && !primera.includes(',') ? '\t' : ','
  const filas: string[][] = []
  let fila: string[] = []
  let campo = ''
  let comillas = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++ } else if (c === '"') comillas = false
      else campo += c
    } else if (c === '"') comillas = true
    else if (c === sep) { fila.push(campo); campo = '' } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      fila.push(campo); campo = ''
      if (fila.some((x) => x.trim())) filas.push(fila)
      fila = []
    } else campo += c
  }
  fila.push(campo)
  if (fila.some((x) => x.trim())) filas.push(fila)
  const [cab = [], ...resto] = filas
  return { columnas: cab.map((x) => x.trim()), filas: resto }
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** Adivina qué columna es cada cosa por su nombre (caso, actividad, fecha, área). */
export function adivinarMapeo(columnas: string[]): Mapeo {
  const buscar = (re: RegExp) => columnas.find((c) => re.test(norm(c))) ?? null
  const caso = buscar(/^(case|caso|case id|id caso|expediente|ticket|factura|pedido|orden|documento|id)( id)?$/) ?? buscar(/case|caso|expediente|ticket|factura|pedido|orden/)
  const actividad = buscar(/^(activity|actividad|paso|evento|event|tarea|estado|step|accion)/) ?? buscar(/activ|paso|evento|tarea|estado/)
  const fecha = buscar(/^(timestamp|fecha|date|datetime|hora|time|cuando)/) ?? buscar(/fecha|date|time|hora/)
  const area = buscar(/^(area|departamento|department|resource|recurso|rol|role|equipo|team|sector|usuario|user)/)
  if (!caso || !actividad || !fecha) throw new Error(`No reconozco las columnas (${columnas.join(', ')}): decime cuál es el caso, la actividad y la fecha`)
  return { caso, actividad, fecha, area }
}

/** Fecha y hora: ISO, «dd/mm/aaaa hh:mm(:ss)» o «aaaa-mm-dd hh:mm». null si no se entiende. */
export function leerFecha(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t)
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)).getTime()
  m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)).getTime()
  const d = Date.parse(t)
  return Number.isFinite(d) ? d : null
}

const percentil = (xs: number[], p: number) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
}
const redondo = (x: number | null, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d)

/** El análisis entero de un log. */
export function analizarLog(texto: string, mapeo?: Partial<Mapeo> | null): Analisis {
  const { columnas, filas } = leerCsv(texto)
  if (!columnas.length || !filas.length) throw new Error('El CSV está vacío')
  const m: Mapeo = { ...adivinarMapeo(columnas), ...Object.fromEntries(Object.entries(mapeo ?? {}).filter(([, v]) => v)) } as Mapeo
  const col = (n: string | null) => (n ? columnas.indexOf(n) : -1)
  const [ic, ia, iff, iar] = [col(m.caso), col(m.actividad), col(m.fecha), col(m.area)]
  if (ic < 0 || ia < 0 || iff < 0) throw new Error('El mapeo no coincide con las columnas del CSV')

  type Ev = { caso: string; act: string; t: number; area: string | null }
  const evs: Ev[] = []
  let descartados = 0
  for (const f of filas) {
    const t = leerFecha(f[iff] ?? '')
    const caso = (f[ic] ?? '').trim()
    const act = (f[ia] ?? '').trim()
    if (t == null || !caso || !act) { descartados++; continue }
    evs.push({ caso, act, t, area: iar >= 0 ? (f[iar] ?? '').trim() || null : null })
  }
  if (!evs.length) throw new Error('Ninguna fila tiene caso, actividad y fecha legibles')
  const porCaso = new Map<string, Ev[]>()
  for (const e of evs) porCaso.set(e.caso, [...(porCaso.get(e.caso) ?? []), e])
  for (const xs of porCaso.values()) xs.sort((a, b) => a.t - b.t)

  // Actividades: cuántas veces, en cuántos casos, su área más común y cuánto falta hasta el paso siguiente.
  const acts = new Map<string, { veces: number; casos: Set<string>; areas: Map<string, number>; espera: number[] }>()
  const trasp = new Map<string, { de: string; a: string; veces: number; espera: number[] }>()
  const variantes = new Map<string, { pasos: string[]; casos: number }>()
  const retr = new Map<string, number>()
  const duraciones: number[] = []
  const meses = new Map<string, number>()
  for (const [caso, xs] of porCaso) {
    const firma = xs.map((x) => x.act)
    const k = firma.join(' → ')
    variantes.set(k, { pasos: firma, casos: (variantes.get(k)?.casos ?? 0) + 1 })
    duraciones.push((xs[xs.length - 1].t - xs[0].t) / 3_600_000)
    const d0 = new Date(xs[0].t)
    const mes = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}`
    meses.set(mes, (meses.get(mes) ?? 0) + 1)
    const vistas = new Map<string, number>()
    xs.forEach((x, i) => {
      const a = acts.get(x.act) ?? { veces: 0, casos: new Set<string>(), areas: new Map<string, number>(), espera: [] }
      a.veces++
      a.casos.add(caso)
      if (x.area) a.areas.set(x.area, (a.areas.get(x.area) ?? 0) + 1)
      const sig = xs[i + 1]
      if (sig) {
        a.espera.push((sig.t - x.t) / MIN)
        if (x.area && sig.area && x.area !== sig.area) {
          const kt = `${x.area}→${sig.area}`
          const tr = trasp.get(kt) ?? { de: x.area, a: sig.area, veces: 0, espera: [] }
          tr.veces++
          tr.espera.push((sig.t - x.t) / MIN)
          trasp.set(kt, tr)
        }
      }
      acts.set(x.act, a)
      vistas.set(x.act, (vistas.get(x.act) ?? 0) + 1)
    })
    for (const [act, n] of vistas) if (n > 1) retr.set(act, (retr.get(act) ?? 0) + 1)
  }
  const casos = porCaso.size
  const vs = [...variantes.values()].sort((a, b) => b.casos - a.casos)
  const fechas = evs.map((e) => e.t)
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  return {
    columnas, mapeo: m, eventos: evs.length, casos, descartados, desde: iso(Math.min(...fechas)), hasta: iso(Math.max(...fechas)),
    volumenMes: [...meses].sort(([a], [b]) => a.localeCompare(b)).map(([mes, n]) => ({ mes, casos: n })),
    actividades: [...acts].map(([nombre, a]) => ({
      nombre, veces: a.veces, casos: a.casos.size, area: [...a.areas].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
      hastaSiguiente: { mediana: redondo(percentil(a.espera, 0.5)), p90: redondo(percentil(a.espera, 0.9)) },
    })).sort((a, b) => b.casos - a.casos || b.veces - a.veces),
    variantes: vs.slice(0, 10).map((v) => ({ pasos: v.pasos, casos: v.casos, pct: Math.round((v.casos / casos) * 1000) / 10 })),
    pasosVarianteComun: vs[0]?.pasos.length ?? 0, actividadesDistintas: acts.size,
    retrabajos: [...retr].map(([actividad, n]) => ({ actividad, casos: n, pct: Math.round((n / casos) * 1000) / 10 })).sort((a, b) => b.casos - a.casos),
    traspasos: [...trasp.values()].map((t) => ({ de: t.de, a: t.a, veces: t.veces, espera: { mediana: redondo(percentil(t.espera, 0.5)), p90: redondo(percentil(t.espera, 0.9)) } }))
      .sort((a, b) => b.veces * (b.espera.mediana ?? 0) - a.veces * (a.espera.mediana ?? 0)),
    duracionCaso: { mediana: redondo(percentil(duraciones, 0.5)), p90: redondo(percentil(duraciones, 0.9)) },
  }
}

const dur = (min: number | null) => (min == null ? '—' : min < 120 ? `${Math.round(min)} min` : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} días`)

/** El análisis en texto (para el prompt del as-is y para leerlo). */
export function logComoTexto(a: Analisis, nombre = 'log'): string {
  return [
    `Log «${nombre}»: ${a.eventos} eventos, ${a.casos} casos, del ${a.desde} al ${a.hasta}. Duración de un caso: mediana ${a.duracionCaso.mediana ?? '—'} h, p90 ${a.duracionCaso.p90 ?? '—'} h.`,
    `Volumen por mes: ${a.volumenMes.map((v) => `${v.mes}: ${v.casos}`).join(' · ')}.`,
    `${a.actividadesDistintas} actividades distintas; la variante más común tiene ${a.pasosVarianteComun} pasos y cubre ${a.variantes[0]?.pct ?? 0} % de los casos.`,
    `Variantes: ${a.variantes.slice(0, 5).map((v) => `[${v.pct} %] ${v.pasos.join(' → ')}`).join('\n')}`,
    `Actividades (casos · área · hasta el paso siguiente mediana/p90): ${a.actividades.map((x) => `${x.nombre} (${x.casos} · ${x.area ?? '?'} · ${dur(x.hastaSiguiente.mediana)}/${dur(x.hastaSiguiente.p90)})`).join('; ')}`,
    a.retrabajos.length ? `Retrabajos: ${a.retrabajos.slice(0, 6).map((r) => `${r.actividad} se repite en ${r.pct} % de los casos`).join('; ')}` : 'Sin retrabajos.',
    a.traspasos.length ? `Traspasos entre áreas (veces · espera mediana/p90): ${a.traspasos.slice(0, 8).map((t) => `${t.de} → ${t.a} (${t.veces} · ${dur(t.espera.mediana)}/${dur(t.espera.p90)})`).join('; ')}` : 'Sin traspasos entre áreas (o el log no trae el área).',
  ].join('\n')
}
