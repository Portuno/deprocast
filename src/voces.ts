/**
 * El Diarizador (personaje 49): quién habla cuándo, por cómo suena, sin dependencias. ffmpeg pasa el audio a PCM
 * (mono, 16 kHz); por ventanas de medio segundo se mide el tono (F0 por autocorrelación) y el brillo (cruces por
 * cero); las ventanas con voz se agrupan en dos con k-means y, si los grupos suenan distinto de verdad (más de unos
 * semitonos o un timbre bien distinto) y los dos tienen peso, hay dos voces. Cada palabra de Whisper toma la voz que
 * sonaba en su momento, y se suavizan los saltos cortos. Distinguir voces de tono parecido es más difícil: ahí el
 * texto (y el modelo) ayudan, y ante la duda no se le atribuye nada a él.
 */
import { spawnSync } from 'node:child_process'

export type Palabra = { start: number; end: number; word: string }
export type Turno = { voz: string; desde: number; hasta: number; texto: string }

const SR = 16000
const VENTANA = 0.25 // segundos: más corto, los cortes de turno caen más cerca de donde están

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

type Rasgo = { t: number; tono: number; timbre: number[] }

/** Rasgos por ventana con voz: tono mediano (semitonos sobre 55 Hz) y timbre medio. */
export function rasgos(muestras: Int16Array): Rasgo[] {
  const paso = Math.floor(SR * VENTANA)
  const out: Rasgo[] = []
  const rmsDe = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += (muestras[i] / 32768) ** 2; return Math.sqrt(s / Math.max(1, b - a)) }
  const rmsVentanas: number[] = []
  for (let i = 0; i + paso <= muestras.length; i += paso) rmsVentanas.push(rmsDe(i, i + paso))
  const ordenados = [...rmsVentanas].sort((a, b) => a - b)
  // Voz = bastante por encima del piso y no muy por debajo de lo típico (sirve con y sin silencios entre frases).
  const umbral = Math.max(0.004, (ordenados[Math.floor(ordenados.length * 0.1)] ?? 0) * 1.5, (ordenados[Math.floor(ordenados.length / 2)] ?? 0) * 0.35)
  for (let w = 0, i = 0; i + paso <= muestras.length; i += paso, w++) {
    if (rmsVentanas[w] < umbral) continue
    const tonos: number[] = []
    const ts: number[][] = []
    for (let j = i; j + CUADRO <= i + paso; j += CUADRO / 2) {
      const x = new Float32Array(CUADRO)
      for (let k = 0; k < CUADRO; k++) x[k] = muestras[j + k] / 32768
      const f = yin(x)
      if (f) { tonos.push(12 * Math.log2(f / 55)); ts.push(timbre(x)) }
    }
    if (tonos.length < 2) continue
    tonos.sort((a, b) => a - b)
    out.push({ t: i / SR, tono: tonos[Math.floor(tonos.length / 2)], timbre: ts[0].map((_, k) => ts.reduce((s, v) => s + v[k], 0) / ts.length) })
  }
  return out
}

/**
 * k-means de 2 sobre tono + timbre (cada dimensión normalizada; el tono pesa el doble). Las etiquetas se suavizan en
 * el tiempo (moda de 5 ventanas ≈ 1,25 s: nadie cambia de voz cada cuarto de segundo). «dos» solo si los grupos están
 * bien separados respecto de su dispersión, o a varios semitonos, y el menor pesa al menos un 12 %.
 */
export function agrupar(rs: Rasgo[]): { etiquetas: number[]; dos: boolean; distancia: number; separacion: number } {
  const nada = { etiquetas: rs.map(() => 0), dos: false, distancia: 0, separacion: 0 }
  if (rs.length < 8) return nada
  const crudo = rs.map((r) => [r.tono, ...r.timbre])
  const dims = crudo[0].length
  const media = Array.from({ length: dims }, (_, k) => crudo.reduce((s, v) => s + v[k], 0) / crudo.length)
  const desv = Array.from({ length: dims }, (_, k) => Math.sqrt(crudo.reduce((s, v) => s + (v[k] - media[k]) ** 2, 0) / crudo.length) || 1)
  const p = crudo.map((v) => v.map((x, k) => ((x - media[k]) / desv[k]) * (k === 0 ? 2 : 1)))
  const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, k) => s + (x - b[k]) ** 2, 0))
  const porTono = [...p.keys()].sort((a, b) => p[a][0] - p[b][0])
  let c = [p[porTono[Math.floor(p.length * 0.15)]], p[porTono[Math.floor(p.length * 0.85)]]]
  let et = p.map(() => 0)
  for (let it = 0; it < 40; it++) {
    et = p.map((x) => (dist(x, c[0]) <= dist(x, c[1]) ? 0 : 1))
    const nuevo = [0, 1].map((k) => { const g = p.filter((_, i) => et[i] === k); return g.length ? g[0].map((_, d) => g.reduce((s, v) => s + v[d], 0) / g.length) : c[k] })
    if (nuevo.every((x, k) => dist(x, c[k]) < 1e-6)) break
    c = nuevo
  }
  // Suavizado temporal: moda de 5 ventanas vecinas (solo entre ventanas a menos de 1 s, para no pegar turnos lejanos).
  const suave = et.map((_, i) => {
    const vecinas = et.filter((__, j) => Math.abs(j - i) <= 2 && Math.abs(rs[j].t - rs[i].t) <= 1)
    return vecinas.filter((x) => x === 1).length * 2 > vecinas.length ? 1 : 0
  })
  const dentro = p.reduce((s, x, i) => s + dist(x, c[et[i]]), 0) / p.length || 1
  const separacion = Math.round((dist(c[0], c[1]) / dentro) * 100) / 100
  const tonoDe = (k: number) => { const g = rs.filter((_, i) => et[i] === k).map((r) => r.tono).sort((a, b) => a - b); return g[Math.floor(g.length / 2)] ?? 0 }
  const distancia = Math.round(Math.abs(tonoDe(0) - tonoDe(1)) * 10) / 10
  const menor = Math.min(suave.filter((e) => e === 0).length, suave.filter((e) => e === 1).length) / suave.length
  const dos = menor >= 0.12 && (separacion >= 1.4 || distancia >= 4)
  return { etiquetas: dos ? suave : suave.map(() => 0), dos, distancia, separacion }
}

/** Cada palabra toma la voz de su ventana; saltos de menos de 3 palabras se suavizan; palabras seguidas de la misma voz, un turno. */
export function turnos(palabras: Palabra[], rs: Rasgo[], etiquetas: number[]): Turno[] {
  if (!palabras.length) return []
  // Cada palabra vota con las ventanas que pisa (si no pisa ninguna, la más cercana a menos de 1 s).
  const vozDe = (p: Palabra) => {
    const votos = [0, 0]
    rs.forEach((r, i) => { const solape = Math.min(p.end, r.t + VENTANA) - Math.max(p.start, r.t); if (solape > 0) votos[etiquetas[i]] += solape })
    if (votos[0] || votos[1]) return votos[1] > votos[0] ? 1 : 0
    let mejor = -1
    let d = Infinity
    rs.forEach((r, i) => { const dd = Math.abs(r.t + VENTANA / 2 - (p.start + p.end) / 2); if (dd < d) { d = dd; mejor = i } })
    return mejor >= 0 && d <= 1 ? etiquetas[mejor] : -1
  }
  const vs = palabras.map(vozDe)
  // Las palabras sin ventana (silencio, ruido) heredan la voz de la anterior.
  for (let i = 0; i < vs.length; i++) if (vs[i] < 0) vs[i] = i ? vs[i - 1] : (vs.find((v) => v >= 0) ?? 0)
  // Suavizar: una racha de menos de 3 palabras entre dos de la misma voz es ruido de medición.
  for (let i = 0; i < vs.length;) {
    let j = i
    while (j < vs.length && vs[j] === vs[i]) j++
    if (j - i < 3 && i > 0 && j < vs.length && vs[i - 1] === vs[j]) for (let k = i; k < j; k++) vs[k] = vs[i - 1]
    i = j
  }
  const out: Turno[] = []
  palabras.forEach((p, i) => {
    const voz = String.fromCharCode(65 + vs[i])
    const ult = out.at(-1)
    if (ult && ult.voz === voz) { ult.texto += p.word; ult.hasta = p.end } else out.push({ voz, desde: p.start, hasta: p.end, texto: p.word })
  })
  return out.map((t) => ({ ...t, texto: t.texto.trim() }))
}

/** Todo junto: del archivo y las palabras de Whisper a turnos por voz (o null si no hay ffmpeg o no se pudo medir). */
export function diarizar(ruta: string, palabras: Palabra[]): { turnos: Turno[]; voces: number; distancia: number; separacion: number } | null {
  const m = pcm(ruta)
  if (!m || !palabras.length) return null
  const rs = rasgos(m)
  const g = agrupar(rs)
  const ts = turnos(palabras, rs, g.etiquetas)
  return { turnos: ts, voces: g.dos ? new Set(ts.map((t) => t.voz)).size : 1, distancia: g.distancia, separacion: g.separacion }
}
