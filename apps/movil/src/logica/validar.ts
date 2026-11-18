/**
 * Validar en 5 minutos: cuándo un deslizamiento es un sí o un no. Tiene que ser un gesto marcado (no hay deshacer):
 * pasar los 110 px de recorrido, o un tirón rápido de más de 0,9 px/ms que ya haya recorrido 40 px. Si no, la tarjeta vuelve.
 */
export const UMBRAL_PX = 110
export const UMBRAL_TIRON = 0.9

export function decidirDeslizar(dx: number, vx: number): 'aceptar' | 'descartar' | null {
  const marcado = Math.abs(dx) >= UMBRAL_PX || (Math.abs(vx) >= UMBRAL_TIRON && Math.abs(dx) >= 40 && Math.sign(vx) === Math.sign(dx))
  if (!marcado) return null
  return dx > 0 ? 'aceptar' : 'descartar'
}

/** El cierre de una tanda: lo que respondió y lo que queda en la bandeja. */
export function cierreDeTanda(respondidas: number, quedan: number): string {
  const r = respondidas === 0 ? 'No respondiste ninguna.' : respondidas === 1 ? 'Respondiste una.' : `Respondiste ${respondidas}.`
  const q = quedan <= 0 ? 'No queda nada para validar.' : quedan === 1 ? 'Queda una para validar.' : `Quedan ${quedan.toLocaleString('es-AR')} para validar.`
  return `${r} ${q}`
}
