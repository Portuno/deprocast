/**
 * La huella de una voz (plan v33): cómo suena alguien, para reconocerlo entre tramos, sin servicios externos.
 * Del WAV → cuadros de 32 ms (con salto de 10 ms) con voz → MFCC (los coeficientes cepstrales en escala Mel: el timbre)
 * → la huella es la media y el desvío de los coeficientes 1 a 12 (sin el 0, que es el volumen). Dos tramos de la misma
 * persona dan huellas parecidas (coseno alto). Es un método clásico y simple: con ruido o tramos muy cortos se confunde;
 * mejora con más tramos de cada uno (la huella de un hablante se promedia).
 * Puro: se prueba con voces sintéticas.
 */

export const DIM = 24

/** Las muestras (mono, -1 a 1) y la frecuencia de un WAV PCM de 16 bits o float de 32. null si no es un WAV que entienda. */
export function leerWav(buf: Uint8Array): { muestras: Float32Array; sr: number } | null {
  if (buf.length < 44) return null
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const txt = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])
  if (txt(0) !== 'RIFF' || txt(8) !== 'WAVE') return null
  let o = 12
  let formato = 0, canales = 1, sr = 16000, bits = 16
  while (o + 8 <= buf.length) {
    const id = txt(o)
    const tam = v.getUint32(o + 4, true)
    if (id === 'fmt ') {
      formato = v.getUint16(o + 8, true)
      canales = v.getUint16(o + 10, true)
      sr = v.getUint32(o + 12, true)
      bits = v.getUint16(o + 22, true)
    } else if (id === 'data') {
      const ini = o + 8
      const fin = Math.min(buf.length, ini + (tam || buf.length - ini))
      const paso = (bits / 8) * canales
      const n = Math.floor((fin - ini) / paso)
      const m = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const p = ini + i * paso
        m[i] = formato === 3 && bits === 32 ? v.getFloat32(p, true) : bits === 16 ? v.getInt16(p, true) / 32768 : 0
      }
      return formato === 1 || formato === 3 ? { muestras: m, sr } : null
    }
    o += 8 + tam + (tam % 2)
  }
  return null
}

/** FFT radix 2 (en el lugar). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k)
        const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s
        const xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c
        re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi
        re[i + k] += xr; im[i + k] += xi
      }
    }
  }
}

const mel = (f: number) => 2595 * Math.log10(1 + f / 700)
const desdeMel = (m: number) => 700 * (10 ** (m / 2595) - 1)

/** La huella (media y desvío de los MFCC 1–12 de los cuadros con voz). null si casi no hay voz. */
export function huellaDe(muestras: Float32Array, sr: number): number[] | null {
  const N = 512, hop = Math.round(sr * 0.01), ventana = Math.round(sr * 0.032)
  const nFiltros = 26, nCoef = 13
  const fMin = 80, fMax = Math.min(7600, sr / 2)
  const puntos = Array.from({ length: nFiltros + 2 }, (_, i) => Math.floor(((N + 1) * desdeMel(mel(fMin) + ((mel(fMax) - mel(fMin)) * i) / (nFiltros + 1))) / sr))
  const hamming = Float64Array.from({ length: ventana }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (ventana - 1)))
  const cuadros: number[][] = []
  const energias: number[] = []
  for (let ini = 0; ini + ventana <= muestras.length; ini += hop) {
    let e = 0
    for (let i = 0; i < ventana; i++) e += muestras[ini + i] ** 2
    energias.push(e / ventana)
  }
  const umbral = Math.max(1e-6, [...energias].sort((a, b) => a - b)[Math.floor(energias.length * 0.5)] ?? 0) // la mitad más fuerte: la voz
  for (let c = 0, ini = 0; ini + ventana <= muestras.length; c++, ini += hop) {
    if (energias[c] < umbral) continue
    const re = new Float64Array(N), im = new Float64Array(N)
    for (let i = 0; i < ventana && i < N; i++) re[i] = (muestras[ini + i] - (i ? 0.97 * muestras[ini + i - 1] : 0)) * hamming[i]
    fft(re, im)
    const pot = Array.from({ length: N / 2 + 1 }, (_, k) => (re[k] ** 2 + im[k] ** 2) / N)
    const fb = Array.from({ length: nFiltros }, (_, m) => {
      let s = 0
      for (let k = puntos[m]; k < puntos[m + 2]; k++) s += pot[k] * (k < puntos[m + 1] ? (k - puntos[m]) / Math.max(1, puntos[m + 1] - puntos[m]) : (puntos[m + 2] - k) / Math.max(1, puntos[m + 2] - puntos[m + 1]))
      return Math.log(s + 1e-10)
    })
    cuadros.push(Array.from({ length: nCoef }, (_, q) => fb.reduce((a, x, m) => a + x * Math.cos((Math.PI * q * (m + 0.5)) / nFiltros), 0)).slice(1))
  }
  if (cuadros.length < 20) return null
  const media = Array.from({ length: nCoef - 1 }, (_, q) => cuadros.reduce((a, f) => a + f[q], 0) / cuadros.length)
  const desvio = media.map((m, q) => Math.sqrt(cuadros.reduce((a, f) => a + (f[q] - m) ** 2, 0) / cuadros.length))
  return [...media, ...desvio]
}

/** Qué tan parecidas son dos huellas (coseno, de -1 a 1). */
export function parecido(a: number[], b: number[]): number {
  let ab = 0, aa = 0, bb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i] }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0
}

/** La huella de un hablante se promedia con cada tramo nuevo (pesa más lo que ya sabía). */
export const promediar = (vieja: number[], n: number, nueva: number[]) => vieja.map((x, i) => (x * n + nueva[i]) / (n + 1))
