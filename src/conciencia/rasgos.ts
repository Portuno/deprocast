/**
 * Rasgos de un cuadro de audio (plan v33, paso 3): lo que necesita la conciencia acústica, calculado en el teléfono sobre
 * el PCM crudo, sin modelos ni red. Puro y compartido con la app (apps/movil/src/conciencia/rasgos.ts, copia exacta).
 * - db: el nivel (RMS en dBFS).
 * - banda: qué parte de la energía cae en la banda de la voz (300–3.400 Hz), con dos filtros de un polo.
 * - zcr: cruces por cero por muestra (la voz tiene pocos; el siseo y el viento, muchos).
 * - voz: la probabilidad de voz humana, de juntar banda, zcr y cuánto «se mueve» el nivel (la voz sube y baja con las
 *   sílabas, 3 a 8 veces por segundo; un ruido parejo, no).
 */

export type Rasgos = { db: number; banda: number; zcr: number; voz: number }

const sigmoide = (x: number) => 1 / (1 + Math.exp(-x))

/** Un detector por stream: guarda el estado de los filtros y la historia corta del nivel. */
export function crearRasgos(sampleRate: number) {
  const aBaja = Math.exp((-2 * Math.PI * 300) / sampleRate) // pasa-altos en 300 Hz (sobre su complemento)
  const aAlta = Math.exp((-2 * Math.PI * 3400) / sampleRate) // pasa-bajos en 3.400 Hz
  let lp300 = 0
  let lp3400 = 0
  const historia: number[] = []

  return {
    /** Un cuadro de muestras en float (-1 a 1), mono. */
    cuadro(x: Float32Array): Rasgos {
      if (!x.length) return { db: -160, banda: 0, zcr: 0, voz: 0 }
      let total = 0
      let enBanda = 0
      let cruces = 0
      let previo = x[0]
      for (let i = 0; i < x.length; i++) {
        const s = x[i]
        total += s * s
        lp300 = (1 - aBaja) * s + aBaja * lp300
        lp3400 = (1 - aAlta) * s + aAlta * lp3400
        const b = lp3400 - lp300 // lo que está entre 300 y 3.400 Hz
        enBanda += b * b
        if ((s >= 0) !== (previo >= 0)) cruces++
        previo = s
      }
      const rms = Math.sqrt(total / x.length)
      const db = rms > 0 ? Math.max(-160, 20 * Math.log10(rms)) : -160
      const banda = total > 0 ? Math.min(1, enBanda / total) : 0
      const zcr = cruces / x.length
      historia.push(db)
      if (historia.length > 8) historia.shift()
      const media = historia.reduce((a, b) => a + b, 0) / historia.length
      const movimiento = Math.sqrt(historia.reduce((a, b) => a + (b - media) ** 2, 0) / historia.length)
      // La voz: mucha energía en su banda, pocos cruces por cero (a 16 kHz, menos de ~0,15) y un nivel que se mueve.
      const fZcr = zcr * (sampleRate / 16000)
      const puntaje = 6 * (banda - 0.45) - 25 * Math.max(0, fZcr - 0.15) + 0.5 * Math.min(movimiento, 8) - 1.5
      return { db, banda: Math.round(banda * 100) / 100, zcr: Math.round(zcr * 1000) / 1000, voz: db < -70 ? 0 : Math.round(sigmoide(puntaje) * 100) / 100 }
    },
  }
}
