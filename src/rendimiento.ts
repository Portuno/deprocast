/**
 * Cómo rinde (el Metrónomo, 70, y el Gemelo, 32): de sus runs reales sale en qué franjas horarias termina lo que
 * empieza, qué largo de banda le funciona y qué día de la semana. Se usa para armar la próxima run (lo hondo donde
 * rinde, el largo que termina) y para la brújula. Cuenta hecha = 1, a medias = ½, no = 0; con menos de 3 bandas en
 * un grupo, no opina.
 */
import type { Db } from './db.ts'

type Grupo = { clave: string; n: number; tasa: number }
export type Perfil = { bandas: number; porFranja: Grupo[]; porLargo: Grupo[]; porDia: Grupo[]; mejorFranja: string | null; peorFranja: string | null; mejorLargo: string | null; tasa: number | null }

const FRANJAS: [number, number, string][] = [[6, 9, '06–09'], [9, 11, '09–11'], [11, 13, '11–13'], [13, 15, '13–15'], [15, 17, '15–17'], [17, 19, '17–19'], [19, 21, '19–21'], [21, 24, '21–24']]
const LARGOS: [number, number, string][] = [[0, 15, 'hasta 15 min'], [16, 30, '16–30 min'], [31, 60, '31–60 min'], [61, 999, 'más de 60 min']]
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MINIMO = 3

export function perfilDeRendimiento(db: Db, ahora = Date.now(), dias = 45): Perfil {
  const filas = db.prepare(`SELECT m.inicio, m.minutos, m.estado, r.fecha FROM misiones m JOIN runs r ON r.id = m.run_id
    WHERE m.personaje = 'jugador' AND m.nivel = 'secundaria' AND m.estado IN ('hecha', 'parcial', 'no') AND m.inicio IS NOT NULL
      AND COALESCE(m.categoria, '') != 'pausa' AND r.creada_en > ?`).all(ahora - dias * 86_400_000) as { inicio: string; minutos: number | null; estado: string; fecha: string }[]
  const valor = (e: string) => (e === 'hecha' ? 1 : e === 'parcial' ? 0.5 : 0)
  const agrupar = (clave: (f: (typeof filas)[number]) => string | null) => {
    const g = new Map<string, number[]>()
    for (const f of filas) { const k = clave(f); if (k) g.set(k, [...(g.get(k) ?? []), valor(f.estado)]) }
    return [...g].map(([k, v]) => ({ clave: k, n: v.length, tasa: Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100 }))
  }
  const hora = (h: string) => Number(h.split(':')[0])
  const porFranja = agrupar((f) => FRANJAS.find(([a, b]) => hora(f.inicio) >= a && hora(f.inicio) < b)?.[2] ?? null).sort((a, b) => a.clave.localeCompare(b.clave))
  const porLargo = agrupar((f) => (f.minutos ? LARGOS.find(([a, b]) => f.minutos! >= a && f.minutos! <= b)?.[2] ?? null : null)).sort((a, b) => LARGOS.findIndex((l) => l[2] === a.clave) - LARGOS.findIndex((l) => l[2] === b.clave))
  const porDia = agrupar((f) => DIAS[new Date(`${f.fecha}T12:00:00`).getDay()])
  const validos = (gs: Grupo[]) => gs.filter((g) => g.n >= MINIMO).sort((a, b) => b.tasa - a.tasa)
  const f = validos(porFranja)
  return {
    bandas: filas.length, porFranja, porLargo, porDia,
    mejorFranja: f[0]?.clave ?? null, peorFranja: f.length > 1 ? f.at(-1)!.clave : null, mejorLargo: validos(porLargo)[0]?.clave ?? null,
    tasa: filas.length ? Math.round((filas.reduce((s, x) => s + valor(x.estado), 0) / filas.length) * 100) / 100 : null,
  }
}

/** Para el prompt de la run y la brújula (vacío si todavía no hay datos suficientes). */
export function textoDeRendimiento(p: Perfil): string {
  if (p.bandas < MINIMO) return ''
  const pct = (x: number) => `${Math.round(x * 100)} %`
  const lista = (gs: Grupo[]) => gs.filter((g) => g.n >= MINIMO).map((g) => `${g.clave} ${pct(g.tasa)} (${g.n})`).join(', ')
  return [
    `En ${p.bandas} bandas de las últimas semanas termina el ${pct(p.tasa ?? 0)}.`,
    lista(p.porFranja) ? `Por franja horaria: ${lista(p.porFranja)}.` : '',
    lista(p.porLargo) ? `Por largo de banda: ${lista(p.porLargo)}.` : '',
    lista(p.porDia) ? `Por día: ${lista(p.porDia)}.` : '',
    p.mejorFranja ? `Rinde más de ${p.mejorFranja}${p.peorFranja && p.peorFranja !== p.mejorFranja ? ` y menos de ${p.peorFranja}` : ''}${p.mejorLargo ? `; el largo que más termina: ${p.mejorLargo}` : ''}.` : '',
  ].filter(Boolean).join('\n')
}
