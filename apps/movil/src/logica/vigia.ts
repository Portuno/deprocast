/**
 * El vigía de la escucha (Mobile 1.1, Fragua #283 y #284), sin nada de React Native: se prueba desde el repo.
 *
 * Mientras escucha, el micrófono entrega un cuadro cada 100 ms. Si entre dos cuadros pasan más de 5 segundos, la
 * escucha se cortó (el sistema la frenó, la pantalla se apagó y Android la mató) y ese hueco queda anotado. Al volver a
 * la app se dice en palabras qué pasó mientras no mirabas: si siguió todo el tiempo, si tuvo cortes (de cuándo a cuándo)
 * o si sigue cortada (y desde qué minuto), en vez de reanudar a ciegas.
 */

export type Corte = { desde: number; hasta: number }
export const HUECO_MS = 5000

const hora = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const minutos = (ms: number) => Math.max(1, Math.round(ms / 60_000))

/** El hueco entre el cuadro anterior y este, si es un corte. */
export function corteEntre(anterior: number | null, t: number): Corte | null {
  return anterior != null && t - anterior > HUECO_MS ? { desde: anterior, hasta: t } : null
}

/**
 * Qué pasó mientras no mirabas: desde que la app pasó al fondo (fueraDesde) hasta que volvió (vuelta). ultimoCuadro: el
 * último que llegó; si es de hace más de 5 s, la escucha sigue cortada ahora.
 */
export function resumenRetorno(o: { fueraDesde: number; vuelta: number; ultimoCuadro: number | null; cortes: Corte[] }): { siguio: boolean; cortadaAhora: boolean; texto: string } | null {
  const fuera = o.vuelta - o.fueraDesde
  if (fuera < 15_000) return null // un vistazo a otra app no merece aviso
  const cortadaAhora = o.ultimoCuadro == null || o.vuelta - o.ultimoCuadro > HUECO_MS
  const enMedio = o.cortes.filter((c) => c.hasta > o.fueraDesde && c.desde < o.vuelta)
  if (cortadaAhora) {
    const desde = Math.max(o.ultimoCuadro ?? o.fueraDesde, o.fueraDesde)
    return { siguio: false, cortadaAhora, texto: `La escucha se cortó a las ${hora(desde)} y estuvo ${minutos(o.vuelta - desde)} min sin escuchar. La retomé ahora.` }
  }
  if (enMedio.length) {
    const perdido = enMedio.reduce((s, c) => s + (Math.min(c.hasta, o.vuelta) - Math.max(c.desde, o.fueraDesde)), 0)
    return { siguio: false, cortadaAhora, texto: `Siguió escuchando, con ${enMedio.length === 1 ? 'un corte' : `${enMedio.length} cortes`}: ${enMedio.map((c) => `${hora(c.desde)}–${hora(c.hasta)}`).join(', ')} (${minutos(perdido)} min sin escuchar).` }
  }
  return { siguio: true, cortadaAhora, texto: `Siguió escuchando los ${minutos(fuera)} min que no miraste.` }
}

/** Lo que dejó una sesión de escucha, para el cierre: qué se guardó y dónde. */
export type Sesion = { desde: number; dictados: number; notas: number; charlas: number; descartados: number; cortes: Corte[] }
export const sesionNueva = (t: number): Sesion => ({ desde: t, dictados: 0, notas: 0, charlas: 0, descartados: 0, cortes: [] })

export function textoDeCierre(s: Sesion, fin: number): string {
  const partes = [
    s.dictados ? `${s.dictados} dictado${s.dictados === 1 ? '' : 's'} al chat de Hoy` : '',
    s.notas ? `${s.notas} nota${s.notas === 1 ? '' : 's'} de voz al corpus` : '',
    s.charlas ? `${s.charlas} turno${s.charlas === 1 ? '' : 's'} de conversación` : '',
  ].filter(Boolean)
  const cortes = s.cortes.length ? ` Tuvo ${s.cortes.length === 1 ? 'un corte' : `${s.cortes.length} cortes`} (${minutos(s.cortes.reduce((a, c) => a + c.hasta - c.desde, 0))} min sin escuchar).` : ''
  return `Escuchó ${minutos(fin - s.desde)} min (${hora(s.desde)}–${hora(fin)}). ${partes.length ? `Guardó ${partes.join(', ')}.` : 'No guardó nada: no hubo voz tuya cerca.'}${s.descartados ? ` Descartó ${s.descartados} ruido${s.descartados === 1 ? '' : 's'} suelto${s.descartados === 1 ? '' : 's'}.` : ''}${cortes}`
}
