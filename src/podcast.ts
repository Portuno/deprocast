/**
 * La charla a dos voces con largo fijado (Fragua #312): las cuentas del podcast. Él da los temas, el contexto y los
 * minutos; el guion se arma a ritmo real (unas 140 palabras por minuto: hablan de a uno, así que es el ritmo del audio),
 * en capítulos, y la transcripción marca dónde empieza cada uno.
 */

export const PALABRAS_POR_MINUTO = 140
export const MINUTOS_MAX = 40

/** Cuántas palabras y cuántos capítulos para un largo pedido (un capítulo cada 3 o 4 minutos, de 1 a 10). */
export function planDeLargo(minutos: number): { minutos: number; palabras: number; capitulos: number; porCapitulo: number } {
  const m = Math.min(MINUTOS_MAX, Math.max(1, Math.round(Number(minutos) || 0)))
  const palabras = m * PALABRAS_POR_MINUTO
  const capitulos = Math.min(10, Math.max(1, Math.round(m / 3.5)))
  return { minutos: m, palabras, capitulos, porCapitulo: Math.round(palabras / capitulos) }
}

export const contarPalabras = (t: string) => (String(t ?? '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length

/** Bitrates de MPEG-1 y MPEG-2/2.5 capa III (kbps) y frecuencias (Hz). */
const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const SR: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

/**
 * Cuántos segundos dura un mp3 (recorriendo sus cuadros; sirve con bitrate variable). Sin cuadros reconocibles,
 * estima por el tamaño a 128 kbps.
 */
export function duracionMp3(b: Buffer): number {
  let i = 0
  if (b.length > 10 && b.toString('latin1', 0, 3) === 'ID3') i = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f))
  let seg = 0, cuadros = 0
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) { i++; continue }
    const version = (b[i + 1] >> 3) & 3, capa = (b[i + 1] >> 1) & 3
    const bri = (b[i + 2] >> 4) & 15, sri = (b[i + 2] >> 2) & 3, relleno = (b[i + 2] >> 1) & 1
    if (version === 1 || capa !== 1 || bri === 0 || bri === 15 || sri === 3) { i++; continue }
    const kbps = (version === 3 ? BR1 : BR2)[bri], hz = SR[version][sri]
    const muestras = version === 3 ? 1152 : 576
    const largo = Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / hz) + relleno
    if (largo < 4) { i++; continue }
    seg += muestras / hz
    cuadros++
    i += largo
  }
  return cuadros ? seg : (b.length * 8) / 128_000
}

export const reloj = (s: number) => { const t = Math.max(0, Math.round(s)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60; return `${h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` }

export type TurnoPodcast = { voz: string; quien: string; texto: string; capitulo: number; desde?: number }
/** La transcripción con los capítulos marcados (minuto en que empieza cada uno) y quién dice qué. */
export function transcripcion(titulo: string, capitulos: { titulo: string; desde: number }[], turnos: TurnoPodcast[], duracion: number): string {
  const out = [`# ${titulo}`, '', `Duración: ${reloj(duracion)}`, '', '## Capítulos', ...capitulos.map((c, i) => `- [${reloj(c.desde)}] ${i + 1}. ${c.titulo}`), '']
  for (const [i, c] of capitulos.entries()) {
    out.push(`## [${reloj(c.desde)}] ${i + 1}. ${c.titulo}`, '')
    for (const t of turnos.filter((x) => x.capitulo === i)) out.push(`**${t.quien}** (${reloj(t.desde ?? 0)}): ${t.texto}`, '')
  }
  return out.join('\n')
}
