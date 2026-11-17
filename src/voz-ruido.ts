/**
 * El ruido de la escucha (Fragua #305). Whisper, cuando le llega silencio, ruido o una TV lejos, «escucha» frases que
 * nadie dijo: «Gracias.», «Gracias por ver el video», «Subtítulos realizados por la comunidad de Amara.org»,
 * «¡Suscríbete!». Y una palabra suelta que se repite igual varias veces en pocos minutos es el mismo fenómeno.
 * Eso no se anota: ni turno en la Escucha, ni mensaje al chat, ni nota de voz.
 * - una de esas frases cuando es TODO lo que vino (dicha adentro de una frase real, pasa);
 * - una o dos palabras que ya llegaron iguales dos veces en los últimos 10 minutos (del mismo teléfono).
 */
import type { Db } from './db.ts'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()

const ALUCINACIONES = [
  'gracias', 'muchas gracias', 'gracias a todos', 'gracias por ver', 'gracias por ver el video', 'gracias por mirar',
  'subtitulos realizados por la comunidad de amara org', 'subtitulos por la comunidad de amara org', 'subtitulado por la comunidad de amara org',
  'suscribete', 'suscribete al canal', 'no olvides suscribirte', 'dale like', 'hasta la proxima', 'nos vemos en el proximo video',
  'amara org', 'musica', 'aplausos', 'risas', 'thank you', 'thanks for watching', 'you',
].map(norm)

/** ¿Es una de las frases que el transcriptor inventa sobre el silencio (y es todo lo que vino)? */
export function esAlucinacion(texto: string): boolean {
  const t = norm(texto)
  if (!t) return true
  return ALUCINACIONES.includes(t)
}

/**
 * ¿Es ruido? texto: lo transcripto; recientes: lo que llegó de ese teléfono en los últimos 10 minutos (los textos).
 * Devuelve el motivo, o null si es habla de verdad.
 */
export function motivoDeRuido(texto: string, recientes: string[]): 'alucinacion' | 'repetida' | null {
  if (esAlucinacion(texto)) return 'alucinacion'
  const t = norm(texto)
  if (t.split(' ').length <= 2 && recientes.filter((r) => norm(r) === t).length >= 2) return 'repetida'
  return null
}

/** Lo que llegó de un teléfono en los últimos 10 minutos (para ver si una palabra suelta se repite). */
export function recientesDe(db: Db, dispositivoId: number, ahora = Date.now()): string[] {
  try {
    return (db.prepare('SELECT texto FROM voz_segmentos WHERE dispositivo_id = ? AND creado_en >= ? ORDER BY id DESC LIMIT 40').all(dispositivoId, ahora - 10 * 60_000) as { texto: string }[]).map((r) => r.texto)
  } catch { return [] }
}
