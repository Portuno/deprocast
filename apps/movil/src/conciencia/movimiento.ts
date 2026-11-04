/**
 * El movimiento (plan v33, paso 3): con el acelerómetro solo (en Android el podómetro depende de Google, que en un Huawei
 * no está). Puro y compartido con la app (apps/movil/src/conciencia/movimiento.ts, copia exacta).
 * - caminando: picos de aceleración (sin la gravedad) a ritmo de paso, 1,2 a 2,6 por segundo, sostenidos ~3 s.
 * - levantado: lo llevaste hacia la cara (un giro grande del eje vertical en menos de medio segundo).
 */

export type Lectura3 = { t: number; x: number; y: number; z: number }

export function crearMovimiento() {
  let gravedad = 1
  const picos: number[] = []
  let arriba = false
  const inclinacion: { t: number; z: number }[] = []
  let ultimoLevantado = -Infinity

  return {
    /** Una medición del acelerómetro (en g). Devuelve si está caminando y si recién lo levantaste. */
    medir(m: Lectura3): { caminando: boolean; levantado: boolean } {
      const mag = Math.sqrt(m.x * m.x + m.y * m.y + m.z * m.z)
      gravedad = gravedad * 0.95 + mag * 0.05
      const dinamica = mag - gravedad
      // Un paso: la aceleración cruza 0,12 g hacia arriba (con rebote: tiene que volver a bajar antes del próximo).
      if (!arriba && dinamica > 0.12) { arriba = true; picos.push(m.t) } else if (arriba && dinamica < 0.04) arriba = false
      while (picos.length && m.t - picos[0] > 3000) picos.shift()
      let caminando = false
      if (picos.length >= 4) {
        const ritmo = (picos.length - 1) / ((picos[picos.length - 1] - picos[0]) / 1000)
        caminando = ritmo >= 1.2 && ritmo <= 2.6
      }
      // Levantarlo: el eje z (pantalla) pasa de horizontal a casi vertical (o al revés) en menos de 500 ms.
      inclinacion.push({ t: m.t, z: m.z / Math.max(mag, 0.01) })
      while (inclinacion.length && m.t - inclinacion[0].t > 500) inclinacion.shift()
      const giro = Math.max(...inclinacion.map((i) => i.z)) - Math.min(...inclinacion.map((i) => i.z))
      if (giro > 0.6 && m.t - ultimoLevantado > 1500) ultimoLevantado = m.t
      return { caminando, levantado: m.t - ultimoLevantado < 1200 }
    },
  }
}
