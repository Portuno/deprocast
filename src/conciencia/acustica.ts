/**
 * Conciencia acústica espacial (plan v33): el teléfono interpreta tu contexto físico por el audio y los sensores, sin
 * mandar nada a la nube para decidir. Este módulo es puro (sin dependencias): lo usa la app nativa cuadro a cuadro y se
 * prueba acá. Tres capacidades, como en el diseño:
 * 1. Aislamiento de fuente: ¿es tu voz directa o ruido ambiente? Voz probable (del detector de voz del teléfono) y una
 *    relación señal/ruido contra el piso de ruido que el módulo va aprendiendo (sube lento, baja rápido).
 * 2. Telemetría de distancia: ¿acercaste el teléfono para dictar o va lejos (bolsillo, mesa)? El sensor de proximidad
 *    manda; sin él, el nivel de voz cercana (una voz a centímetros suena 15–25 dB sobre el piso) y haberlo levantado.
 * 3. Reconocimiento de estado: «silencio intencional» (los ojos de un caminante) = caminás y no hablás, sostenido.
 * Para no saltar entre estados con cada cuadro, cada cambio necesita sostenerse un tiempo (histéresis).
 */

export type Cuadro = {
  /** Milisegundos (monotónicos) del cuadro. */
  t: number
  /** Nivel del micrófono en dBFS (de -160 a 0). */
  db: number
  /** Probabilidad de voz humana del detector del teléfono (0 a 1). */
  voz: number
  /** Sensor de proximidad: true = algo cerca (el teléfono contra la cara o la boca); null = no hay sensor. */
  cerca?: boolean | null
  /** ¿Caminando? (del podómetro o del acelerómetro); null = no se sabe. */
  caminando?: boolean | null
  /** ¿Lo levantaste recién? (un pico en el acelerómetro hacia la cara). */
  levantado?: boolean
}

export type Estado = 'dictado' | 'escucha' | 'silencio_intencional' | 'ruido'
export type Lectura = { estado: Estado; fuente: 'voz_directa' | 'ruido' | 'silencio'; distancia: 'cerca' | 'lejos'; snr: number; piso: number; cambio: boolean; desde: number }

export const AJUSTES = {
  /** Voz por encima de esta probabilidad cuenta como voz. */
  umbralVoz: 0.6,
  /** dB sobre el piso de ruido para que la voz sea «directa» (tuya, cerca) y no de fondo. */
  snrDirecta: 9,
  /** dB sobre el piso que tiene una voz pegada al micrófono (sin sensor de proximidad). */
  snrCerca: 18,
  /** Cuánto tiene que sostenerse un estado nuevo antes de cambiar (ms). */
  sostener: { dictado: 400, escucha: 900, silencio_intencional: 4000, ruido: 1500 } as Record<Estado, number>,
  /** El piso de ruido sube despacio (para no tomar la voz como ruido) y baja rápido. */
  pisoSube: 0.02,
  pisoBaja: 0.3,
}

export function crearConciencia(aj = AJUSTES) {
  let piso: number | null = null
  let estado: Estado = 'ruido'
  let desde = 0
  let candidato: { estado: Estado; desde: number } | null = null
  let ultimaVoz = -Infinity

  return {
    get estado() { return estado },
    /** Procesa un cuadro y devuelve la lectura (cambio = true si el estado cambió en este cuadro). */
    cuadro(c: Cuadro): Lectura {
      const esVoz = c.voz >= aj.umbralVoz
      // El piso de ruido se aprende sobre lo que NO es voz.
      // El primer cuadro sin voz fija el piso de una (no hay que esperar a que suba desde cero).
      if (!esVoz) piso = piso == null ? c.db : piso + (c.db - piso) * (c.db > piso ? aj.pisoSube : aj.pisoBaja)
      const base = piso ?? -60
      const snr = c.db - base
      const directa = esVoz && snr >= aj.snrDirecta
      if (directa) ultimaVoz = c.t
      const fuente: Lectura['fuente'] = directa ? 'voz_directa' : esVoz || snr > 6 ? 'ruido' : 'silencio'
      const cerca = c.cerca != null ? c.cerca : (directa && snr >= aj.snrCerca) || !!c.levantado
      const distancia: Lectura['distancia'] = cerca ? 'cerca' : 'lejos'

      let propuesto: Estado
      if (directa && cerca) propuesto = 'dictado'
      else if (directa) propuesto = 'escucha'
      else if (c.caminando && c.t - ultimaVoz > 2500) propuesto = 'silencio_intencional'
      else if (estado === 'dictado' || estado === 'escucha') propuesto = c.t - ultimaVoz > 1500 ? 'ruido' : estado // una pausa al hablar no corta
      else propuesto = 'ruido'

      let cambio = false
      if (propuesto === estado) candidato = null
      else if (!candidato || candidato.estado !== propuesto) candidato = { estado: propuesto, desde: c.t }
      else if (c.t - candidato.desde >= aj.sostener[propuesto]) {
        estado = propuesto
        desde = candidato.desde
        candidato = null
        cambio = true
      }
      return { estado, fuente, distancia, snr: Math.round(snr * 10) / 10, piso: Math.round(base * 10) / 10, cambio, desde }
    },
  }
}

/**
 * Qué hacer con lo grabado en un tramo, según el estado: el dictado va al chat (modo «dictado»), lo pensado en voz alta
 * queda como nota («pasivo»), y el ruido y el silencio no se mandan (ni se guardan).
 */
export const destinoDe = (e: Estado): 'dictado' | 'pasivo' | null => (e === 'dictado' ? 'dictado' : e === 'escucha' ? 'pasivo' : null)
