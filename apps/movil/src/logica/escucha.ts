/**
 * La escucha automática (Mobile 2.0), sin nada de React Native: se prueba desde el repo.
 * Antes el «modo conversación» era un interruptor: o solo tu voz, o todo. Ahora, por defecto, la escucha se da cuenta
 * sola de que estás en una charla:
 * - tu voz directa (cerca del teléfono) siempre se graba;
 * - la voz de otros se graba solo si vos hablaste hace poco (estás en la charla): así la tele, el bar o la gente de al
 *   lado no llenan la cola, pero lo que te contestan sí queda;
 * - un tramo con un segundo o más de otra voz es conversación (se corta por turnos y se separa quién dice qué); si no,
 *   dictado o nota, como siempre.
 * «Solo yo» y «Charla» quedan como preferencias fijas para quien las quiera.
 */

export type Preferencia = 'auto' | 'yo' | 'charla'
export const PREFERENCIAS: { clave: Preferencia; nombre: string }[] = [
  { clave: 'auto', nombre: 'Auto' },
  { clave: 'yo', nombre: 'Solo yo' },
  { clave: 'charla', nombre: 'Charla' },
]

/** Cuánto dura «estás en una charla» después de que hablaste. */
export const VENTANA_CHARLA_MS = 90_000
/** Cuadros de 100 ms de otra voz para que un tramo sea conversación. */
export const OTRA_VOZ_CONVERSACION = 10

/** ¿Estás en una charla? (hablaste hace menos de 90 s). Con «Charla», siempre; con «Solo yo», nunca. */
export function enCharla(pref: Preferencia, ultimaVozPropia: number | null, ahora: number): boolean {
  if (pref === 'charla') return true
  if (pref === 'yo') return false
  return ultimaVozPropia != null && ahora - ultimaVozPropia < VENTANA_CHARLA_MS
}

/** ¿Este cuadro cuenta como voz para grabar? */
export function cuentaComoVoz(pref: Preferencia, c: { directa: boolean; otra: boolean }, charla: boolean): boolean {
  if (c.directa) return true
  return c.otra && charla
}

/** El modo del tramo al cerrarse: conversación si hubo otra voz de verdad; si no, por lo que predominó. */
export function modoDelTramo(pref: Preferencia, t: { dictado: number; escucha: number; otras: number }): 'dictado' | 'pasivo' | 'conversacion' {
  if (pref === 'charla') return 'conversacion'
  if (pref === 'auto' && t.otras >= OTRA_VOZ_CONVERSACION) return 'conversacion'
  return t.dictado >= t.escucha ? 'dictado' : 'pasivo'
}
