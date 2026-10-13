/**
 * El oído del Diarizador (personaje 49), sin dependencias. ffmpeg pasa el audio a PCM (mono, 16 kHz); las palabras
 * de Whisper se agrupan en frases (los cambios de turno caen entre frases); por frase se mide el tono (YIN) y el
 * timbre. Las frases se agrupan en dos y solo se dice «dos voces» si los tonos están muy separados (una voz grave y
 * una aguda): la entonación de una misma persona mueve varios semitonos de frase a frase, y una pista dudosa
 * confunde más de lo que ayuda. La decisión final (quién dice cada frase y cuál es él) la toma el modelo con esta
 * pista y el contenido (tandas.ts, separarVoces). Probado con voces sintéticas: una sola voz no se parte, hombre y
 * mujer se separan; dos voces parecidas dependen del contenido.
 */
import { spawnSync } from 'node:child_process'

export type Palabra = { start: number; end: number; word: string }

const SR = 16000

/** El audio como muestras (mono, 16 kHz). null si ffmpeg no está o falla. */
export function pcm(ruta: string): Int16Array | null {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', ruta, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { maxBuffer: 1024 * 1024 * 1024 })
  if (r.status !== 0 || !r.stdout?.length) return null
  const b = r.stdout as Buffer
  return new Int16Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 2))
}

const CUADRO = 512 // 32 ms a 16 kHz

/** F0 de un cuadro con YIN (de Cheveigné y Kawahara, 2002), 60–400 Hz; null si no es sonoro. Comete pocos errores de octava. */
function yin(x: Float32Array): number | null {
  const min = Math.floor(SR / 400)
  const max = Math.min(Math.floor(SR / 60), x.length - 1)
  const d = new Float32Array(max + 1)
  for (let tau = 1; tau <= max; tau++) {
    let s = 0
    for (let i = 0; i + tau < x.length; i++) { const v = x[i] - x[i + tau]; s += v * v }
    d[tau] = s
  }
  // Diferencia acumulada normalizada; el primer mínimo bajo el umbral es el período.
  let acum = 0
  for (let tau = 1; tau <= max; tau++) {
    acum += d[tau]
    d[tau] = acum ? (d[tau] * tau) / acum : 1
  }
  for (let tau = min; tau <= max; tau++) {
    if (d[tau] < 0.15) {
      while (tau + 1 <= max && d[tau + 1] < d[tau]) tau++
      return SR / tau
    }
  }
  return null
}

/** FFT radix-2 in situ (re, im), para la forma del espectro. */
function fft(re: Float32Array, im: Float32Array) {
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
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k)
        const ar = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
        const ai = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai
        re[i + k] += ar; im[i + k] += ai
      }
    }
  }
}

/** 12 bandas en escala mel de 100 a 4000 Hz: log-energía menos su media (la forma, no el volumen). */
const BANDAS = (() => {
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700)
  const hz = (m: number) => 700 * (10 ** (m / 2595) - 1)
  const bordes = Array.from({ length: 13 }, (_, i) => hz(mel(100) + ((mel(4000) - mel(100)) * i) / 12))
  return bordes.slice(0, -1).map((a, i) => [Math.floor((a * CUADRO) / SR), Math.max(Math.floor((a * CUADRO) / SR) + 1, Math.floor((bordes[i + 1] * CUADRO) / SR))])
})()
const HANN = Float32Array.from({ length: CUADRO }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (CUADRO - 1)))

function timbre(x: Float32Array): number[] {
  const re = Float32Array.from(x, (v, i) => v * HANN[i])
  const im = new Float32Array(CUADRO)
  fft(re, im)
  const e = BANDAS.map(([a, b]) => { let s = 1e-10; for (let k = a; k < b; k++) s += re[k] * re[k] + im[k] * im[k]; return Math.log(s / (b - a)) })
  const media = e.reduce((s, v) => s + v, 0) / e.length
  return e.map((v) => v - media)
}

type Rasgo = { tono: number; timbre: number[]; sonoros: number }
export type Frase = { desde: number; hasta: number; texto: string; palabras: number }

/**
 * Frases: las palabras de Whisper partidas por puntuación de cierre (. ? ! …) o por una pausa de 0,35 s, con un
 * máximo de 30 palabras. Los cambios de turno caen casi siempre entre frases, y una frase tiene cuadros de sobra
 * para medir la voz con firmeza.
 */
export function frases(palabras: Palabra[]): Frase[] {
  const out: Frase[] = []
  let actual: Palabra[] = []
  const cerrar = () => {
    if (!actual.length) return
    out.push({ desde: actual[0].start, hasta: actual.at(-1)!.end, texto: actual.map((p) => p.word).join('').trim(), palabras: actual.length })
    actual = []
  }
  palabras.forEach((p, i) => {
    const sig = palabras[i + 1]
    actual.push(p)
    if (/[.?!…]["»”')]*\s*$/.test(p.word) || (sig && sig.start - p.end >= 0.35) || actual.length >= 30) cerrar()
  })
  cerrar()
  return out
}

/** Tono mediano y timbre medio de un tramo [desde, hasta] (en segundos), con los cuadros sonoros. */
export function rasgoDeTramo(muestras: Int16Array, desde: number, hasta: number): Rasgo {
  const a = Math.max(0, Math.floor(desde * SR))
  const b = Math.min(muestras.length, Math.ceil(hasta * SR))
  const tonos: number[] = []
  const ts: number[][] = []
  const x = new Float32Array(CUADRO)
  for (let j = a; j + CUADRO <= b; j += CUADRO / 2) {
    let e = 0
    for (let k = 0; k < CUADRO; k++) { x[k] = muestras[j + k] / 32768; e += x[k] * x[k] }
    if (e / CUADRO < 1e-5) continue // silencio
    const f = yin(x)
    if (!f) continue
    tonos.push(12 * Math.log2(f / 55))
    ts.push(timbre(x))
  }
  tonos.sort((p, q) => p - q)
  return {
    tono: tonos.length ? tonos[Math.floor(tonos.length / 2)] : NaN,
    timbre: ts.length ? ts[0].map((_, k) => ts.reduce((s, v) => s + v[k], 0) / ts.length) : [],
    sonoros: tonos.length,
  }
}

/**
 * Dos grupos de frases (k-means sobre tono + timbre normalizados; el tono pesa el doble y cada frase pesa por su
 * duración). Hay dos voces solo si sus tonos medianos están a 3,5 semitonos o más (o a 2 con un timbre bien
 * distinto) y la voz menor tiene al menos el 10 % del tiempo hablado. Si no, es una sola voz.
 */
export function agruparFrases(fs: Frase[], rs: Rasgo[]): { etiquetas: number[]; dos: boolean; distancia: number; separacion: number } {
  const validas = rs.map((r, i) => (r.sonoros >= 4 && Number.isFinite(r.tono) ? i : -1)).filter((i) => i >= 0)
  const una = { etiquetas: fs.map(() => 0), dos: false, distancia: 0, separacion: 0 }
  if (validas.length < 3) return una
  const crudo = validas.map((i) => [rs[i].tono, ...rs[i].timbre])
  const dims = crudo[0].length
  const media = Array.from({ length: dims }, (_, k) => crudo.reduce((s, v) => s + v[k], 0) / crudo.length)
  const desv = Array.from({ length: dims }, (_, k) => Math.sqrt(crudo.reduce((s, v) => s + (v[k] - media[k]) ** 2, 0) / crudo.length) || 1)
  // El tono manda (es lo que más separa voces); el timbre, en conjunto, pesa como un tercio del tono.
  const p = crudo.map((v) => v.map((x, k) => ((x - media[k]) / desv[k]) * (k === 0 ? 3 : 1 / Math.sqrt(dims - 1))))
  const w = validas.map((i) => Math.max(0.2, fs[i].hasta - fs[i].desde))
  const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, k) => s + (x - b[k]) ** 2, 0))
  const orden = [...p.keys()].sort((a, b) => p[a][0] - p[b][0])
  let c = [p[orden[0]], p[orden.at(-1)!]]
  let et = p.map(() => 0)
  for (let it = 0; it < 50; it++) {
    et = p.map((x) => (dist(x, c[0]) <= dist(x, c[1]) ? 0 : 1))
    const nuevo = [0, 1].map((k) => {
      const idx = et.map((e, i) => (e === k ? i : -1)).filter((i) => i >= 0)
      const tot = idx.reduce((s, i) => s + w[i], 0)
      return tot ? p[0].map((_, d) => idx.reduce((s, i) => s + p[i][d] * w[i], 0) / tot) : c[k]
    })
    if (nuevo.every((x, k) => dist(x, c[k]) < 1e-9)) break
    c = nuevo
  }
  const tonoMediano = (k: number) => { const g = validas.filter((_, j) => et[j] === k).map((i) => rs[i].tono).sort((a, b) => a - b); return g.length ? g[Math.floor(g.length / 2)] : NaN }
  const distancia = Math.abs(tonoMediano(0) - tonoMediano(1))
  const dentro = p.reduce((s, x, i) => s + dist(x, c[et[i]]) * w[i], 0) / w.reduce((s, x) => s + x, 0) || 1
  const separacion = dist(c[0], c[1]) / dentro
  const tiempo = [0, 1].map((k) => w.filter((_, i) => et[i] === k).reduce((s, x) => s + x, 0))
  const menor = Math.min(...tiempo) / (tiempo[0] + tiempo[1])
  // Exigente a propósito: la entonación de una misma persona mueve la mediana varios semitonos de una frase a otra.
  // Solo dos grupos bien separados (≥ 5 semitonos, como una voz grave y una aguda) cuentan como dos voces.
  const dos = Number.isFinite(distancia) && menor >= 0.1 && distancia >= 5
  // Las frases sin medida (cortas o sin voz) toman la voz de la frase anterior (o la siguiente).
  const etiquetas = fs.map(() => -1)
  validas.forEach((i, j) => (etiquetas[i] = dos ? et[j] : 0))
  for (let i = 0; i < etiquetas.length; i++) if (etiquetas[i] < 0) etiquetas[i] = i ? etiquetas[i - 1] : (etiquetas.find((e) => e >= 0) ?? 0)
  return { etiquetas, dos, distancia: Math.round(distancia * 10) / 10, separacion: Math.round(separacion * 100) / 100 }
}
