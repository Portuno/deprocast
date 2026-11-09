/**
 * Los criterios con nombre y peso (plan v38, fase 3, Fragua #156): lo que decide qué entra en una run y en qué orden
 * deja de ser una caja negra. Cada criterio es un personaje con su peso (en %, suman 100):
 * - La Urgente: lo que vence pronto o tiene fecha.
 * - El Ambicioso: lo que empuja su principal y sus primarias.
 * - La Medidora: que la tarea encaje con su energía y la hora.
 * - El Entusiasta: lo que tiene ganas de hacer o mencionó.
 * - La Curiosa: algo nuevo o distinto, para no estancarse.
 * - El Deudor: lo que viene postergando.
 * Él los mueve (pantalla o chat). Cada banda guarda qué criterio la empujó; con lo que marca (hecha / a medias / no), los
 * pesos se ajustan de a poco una vez por semana, y se le cuenta qué cambió y por qué.
 */
import { ajuste, fijarAjuste, type Db } from './db.ts'

export const CRITERIOS = [
  { clave: 'urgencia', nombre: 'La Urgente', que: 'lo que vence pronto o tiene fecha' },
  { clave: 'impacto', nombre: 'El Ambicioso', que: 'lo que empuja tu principal y tus primarias' },
  { clave: 'energia', nombre: 'La Medidora', que: 'que la tarea encaje con tu energía y la hora' },
  { clave: 'ganas', nombre: 'El Entusiasta', que: 'lo que tenés ganas de hacer o mencionaste' },
  { clave: 'novedad', nombre: 'La Curiosa', que: 'algo nuevo o distinto, para no estancarte' },
  { clave: 'deuda', nombre: 'El Deudor', que: 'lo que venís postergando' },
] as const
export type ClaveCriterio = (typeof CRITERIOS)[number]['clave']
const CLAVES = CRITERIOS.map((c) => c.clave) as string[]
const DEFECTO: Record<string, number> = { urgencia: 20, impacto: 25, energia: 15, ganas: 15, novedad: 10, deuda: 15 }
const DIA = 86_400_000

/** Que sumen 100, enteros y ninguno debajo de 2 (un criterio en 0 no se puede aprender de nuevo). */
function normalizar(p: Record<string, number>): Record<string, number> {
  const base = Object.fromEntries(CLAVES.map((k) => [k, Math.max(2, Number(p[k]) || 0)]))
  const total = Object.values(base).reduce((s, x) => s + x, 0)
  const out = Object.fromEntries(CLAVES.map((k) => [k, Math.round((base[k] / total) * 100)]))
  const ajusteFinal = 100 - Object.values(out).reduce((s, x) => s + x, 0)
  const mayor = CLAVES.reduce((a, b) => (out[a] >= out[b] ? a : b))
  out[mayor] += ajusteFinal
  return out
}

export function pesos(db: Db): Record<string, number> {
  try { const p = JSON.parse(ajuste(db, 'criterios_pesos') ?? 'null'); if (p) return normalizar(p) } catch { /* los de fábrica */ }
  return { ...DEFECTO }
}

/** Fija el peso de un criterio; los demás se reparten el resto en la misma proporción que tenían. */
export function fijarPeso(db: Db, clave: string, peso: number) {
  if (!CLAVES.includes(clave)) throw new Error(`Criterio desconocido: ${clave} (${CLAVES.join(', ')})`)
  const p = pesos(db)
  const nuevo = Math.max(2, Math.min(90, Math.round(peso)))
  const resto = CLAVES.filter((k) => k !== clave)
  const antes = resto.reduce((s, k) => s + p[k], 0) || 1
  const out: Record<string, number> = { [clave]: nuevo }
  for (const k of resto) out[k] = (p[k] / antes) * (100 - nuevo)
  fijarAjuste(db, 'criterios_pesos', JSON.stringify(normalizar(out)))
  return listar(db)
}

export function listar(db: Db, ahora = Date.now()) {
  const p = pesos(db)
  const r = rendimiento(db, ahora)
  return CRITERIOS.map((c) => ({ ...c, peso: p[c.clave], bandas: r[c.clave]?.n ?? 0, cumple: r[c.clave]?.tasa ?? null }))
}

/** Para el prompt de la run: los pesos, y que cada misión diga qué criterio la empujó. */
export function criteriosParaPrompt(db: Db): string {
  const p = pesos(db)
  return `Los criterios con que elegís y ordenás (los pesos los ajusta él; respetalos):\n${CRITERIOS.map((c) => `- ${c.nombre} (${c.clave}: ${c.que}) · ${p[c.clave]} %`).join('\n')}\nEn cada misión, «criterio» = la clave del criterio que más la empujó.`
}

export const criterioValido = (x: unknown): ClaveCriterio | null => (CLAVES.includes(String(x)) ? (String(x) as ClaveCriterio) : null)

/** Cuánto termina lo que empuja cada criterio (las bandas marcadas de los últimos 30 días). */
export function rendimiento(db: Db, ahora = Date.now(), dias = 30): Record<string, { n: number; tasa: number }> {
  const filas = db.prepare(`SELECT criterio, estado, COUNT(*) AS n FROM misiones WHERE personaje = 'jugador' AND nivel = 'secundaria' AND criterio IS NOT NULL AND estado IN ('hecha', 'parcial', 'no') AND creada_en > ? GROUP BY criterio, estado`).all(ahora - dias * DIA) as { criterio: string; estado: string; n: number }[]
  const out: Record<string, { n: number; hechas: number }> = {}
  for (const f of filas) {
    const x = (out[f.criterio] ??= { n: 0, hechas: 0 })
    x.n += f.n
    x.hechas += f.estado === 'hecha' ? f.n : f.estado === 'parcial' ? f.n / 2 : 0
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.n, tasa: v.hechas / v.n }]))
}

/**
 * Una vez por semana (al cerrar una run): cada criterio con al menos 4 bandas marcadas sube o baja según cuánto termina
 * lo que empuja (de ×0,85 si no termina nada a ×1,15 si termina todo). Devuelve qué le cuenta (lo que se movió 3 puntos o más).
 */
export function aprenderPesos(db: Db, ahora = Date.now()): string[] {
  if (ahora - (Number(ajuste(db, 'criterios_aprendido_en')) || 0) < 6 * DIA) return []
  const r = rendimiento(db, ahora)
  const p = pesos(db)
  const con = CLAVES.filter((k) => (r[k]?.n ?? 0) >= 4)
  if (!con.length) return []
  const nuevo = normalizar(Object.fromEntries(CLAVES.map((k) => [k, con.includes(k) ? p[k] * (0.85 + 0.3 * r[k].tasa) : p[k]])))
  fijarAjuste(db, 'criterios_pesos', JSON.stringify(nuevo))
  fijarAjuste(db, 'criterios_aprendido_en', String(ahora))
  const nombre = (k: string) => CRITERIOS.find((c) => c.clave === k)!.nombre
  return CLAVES.filter((k) => Math.abs(nuevo[k] - p[k]) >= 3).map((k) => {
    const de10 = Math.round(r[k].tasa * 10)
    return `${nombre(k)} ${nuevo[k] > p[k] ? 'subió' : 'bajó'} de ${p[k]} % a ${nuevo[k]} %: lo que empuja lo terminás ${de10} de cada 10 veces.`
  })
}
