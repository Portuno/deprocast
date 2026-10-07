/**
 * Progresión. Seis niveles; cada uno abre una capa más de contexto.
 * El nombre se gana en el nivel 3. Hasta entonces el agente es su designación (GEN-0007).
 */
import type { Atributos } from './clases.ts'

export const NIVEL_MAX = 6
export const NIVEL_BAUTISMO = 3
export const XP_POR_EXITO = 10
export const XP_POR_ASIGNACION = 2

/** XP total para llegar al nivel n: 0, 50, 200, 450, 800, 1250. */
export function umbral(n: number): number {
  return 50 * (n - 1) ** 2
}

export function nivelDe(xp: number): number {
  let n = 1
  while (n < NIVEL_MAX && xp >= umbral(n + 1)) n++
  return n
}

/** Capas de contexto: lo que la liga le precarga al agente según su nivel. Lectura siempre; escritura nunca (eso es el bus). */
export const CAPAS: { nivel: number; nombre: string; abre: string; lecturaMax: number }[] = [
  { nivel: 1, nombre: 'Tarea', abre: 'esquema chico + payload de la tarea', lecturaMax: 3 },
  { nivel: 2, nombre: 'Memoria', abre: 'sus últimas tareas propias', lecturaMax: 3 },
  { nivel: 3, nombre: 'Proyecto', abre: 'lo reciente de su proyecto', lecturaMax: 6 },
  { nivel: 4, nombre: 'Especialidad', abre: 'corpus de su dominio precargado', lecturaMax: 6 },
  { nivel: 5, nombre: 'Corpus', abre: 'lectura amplia del corpus', lecturaMax: 12 },
  { nivel: 6, nombre: 'Liga', abre: 'roster y auditoría ajena', lecturaMax: 12 },
]

export function capa(nivel: number) {
  return CAPAS[Math.min(Math.max(nivel, 1), NIVEL_MAX) - 1]
}

/** Atributos → perillas del runtime. */
export function efectos(a: Atributos) {
  return {
    maxTokens: 256 * (1 + a.potencia),
    temperatura: Math.max(0.1, 1 - a.precision * 0.15),
    memoria: a.memoria * 2,
    reintentos: Math.floor(a.temple / 2),
    iniciativa: a.iniciativa,
    ritmo: 1 + Math.floor(a.ritmo / 2),
  }
}
export type Efectos = ReturnType<typeof efectos>
