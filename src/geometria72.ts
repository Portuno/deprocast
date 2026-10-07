/**
 * La Matriz 72 de la 0.7.1 (agentes72.md): 8 dominios × 9 oficios.
 * Una ficha puede ocupar una celda (1–72); varias fichas pueden compartirla.
 */

export const DOMINIOS = [
  'Captura', 'Criba', 'Biblioteca', 'Memoria', 'Territorio', 'Finanzas', 'Derecho', 'Vitalidad',
] as const

const IPO = ['Input', 'Procesamiento', 'Output'] as const
const CMA = ['Cuerpo', 'Mente', 'Alma'] as const

export function celda(numero: number) {
  if (!Number.isInteger(numero) || numero < 1 || numero > 72) throw new Error(`Celda fuera de la matriz: ${numero}`)
  const indice = numero - 1
  const oficio = indice % 9
  return {
    numero,
    etiqueta: String(numero).padStart(2, '0'),
    dominio: DOMINIOS[Math.floor(indice / 9)],
    oficio,
    ipo: IPO[Math.floor(oficio / 3)],
    cma: CMA[oficio % 3],
  }
}

export function describirCelda(numero: number): string {
  const c = celda(numero)
  return `${c.etiqueta} · ${c.dominio} · ${c.ipo}·${c.cma}`
}
