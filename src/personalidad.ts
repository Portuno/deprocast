/**
 * La personalidad de Mastropiero: el compositor de Les Luthiers como origen del carácter y del humor de la entidad. El
 * texto vive en docs/personalidad/mastropiero.md (entre <!-- prompt --> y <!-- /prompt -->): se corrige ahí y cambia acá.
 * Cada superficie recibe su dosis: plena en las ceremonias, mínima en el chat, ninguna en lo íntimo o lo técnico.
 */
import fs from 'node:fs'

const ARCHIVO = new URL('../docs/personalidad/mastropiero.md', import.meta.url)

let cache: { mtime: number; texto: string } | null = null
/** El prompt de personalidad, leído del documento (si falta, vacío: Deprocast sigue con su voz base). */
export function personalidad(): string {
  try {
    const mtime = fs.statSync(ARCHIVO).mtimeMs
    if (cache?.mtime === mtime) return cache.texto
    // Las marcas, cada una sola en su línea (el encabezado del documento las menciona entre comillas).
    const m = /^<!-- prompt -->\s*$([\s\S]*?)^<!-- \/prompt -->\s*$/m.exec(fs.readFileSync(ARCHIVO, 'utf8'))
    cache = { mtime, texto: m?.[1]?.trim() ?? '' }
    return cache.texto
  } catch {
    return ''
  }
}

export type Superficie = 'ceremonia' | 'chat' | 'intima' | 'tecnica' | 'voz_del_operador'

const DOSIS: Record<Superficie, 'plena' | 'minima' | 'ninguna'> = {
  ceremonia: 'plena', chat: 'minima', intima: 'ninguna', tecnica: 'ninguna', voz_del_operador: 'ninguna',
}

/**
 * Lo que se suma al prompt de cada superficie: la personalidad con su dosis (plena: el compositor a pleno, siempre al
 * servicio de lo útil; mínima: un remate cuando viene al caso, nunca en preguntas cortas), o nada.
 */
export function vozPara(s: Superficie): string {
  const dosis = DOSIS[s]
  const p = personalidad()
  if (dosis === 'ninguna' || !p) return ''
  const regla = dosis === 'plena'
    ? 'Dosis de personalidad: PLENA. Es una ceremonia (un reporte, una carta, el audio de la mañana): el compositor puede asomar entero, con un remate y alguna digresión breve, sin tapar nunca lo que hay que decir.'
    : 'Dosis de personalidad: MÍNIMA. Es el trabajo de todos los días: trato de usted y como mucho un remate cuando de verdad viene al caso; en preguntas cortas, datos o pedidos concretos, ninguno.'
  return `${p}\n\n${regla}`
}

/**
 * La guardia del nombre: ¿el texto le pone un nombre de pila a Mastropiero? Busca una o dos palabras con mayúscula pegadas
 * a «Mastropiero» (sin escribir ningún nombre), y deja pasar lo que sí está permitido: sus parientes y los títulos.
 */
const PERMITIDOS = new Set(['Harold', 'Azuceno', 'Etcétera', 'Premios', 'Academia', 'Gloria', 'Bolero', 'Don', 'Juan', 'Querido', 'Querida', 'Maestro', 'Señor', 'El', 'La', 'Los', 'Las', 'De', 'Del', 'Usted', 'Soy', 'Sos', 'Es', 'Personalidad'])
export function nombraDePila(texto: string): string | null {
  for (const m of texto.matchAll(/((?:\b[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+\s+){1,2})Mastropiero\b/g)) {
    const palabras = m[1].trim().split(/\s+/)
    if (palabras.some((w) => !PERMITIDOS.has(w))) return m[0]
  }
  return null
}
