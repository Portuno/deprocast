/** Tokenizado mínimo compartido: minúsculas, sin tildes, 3+ letras, sin palabras vacías. */
const VACIAS = new Set(
  'para como pero esto esta este todo todos porque cuando donde sobre entre desde hasta tiene hace muy mas sus les que con una uno los las del por sin hay ser fue son the and with that this from'.split(' '),
)

export function palabras(s: string): string[] {
  return (s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9ñ]{3,}/g) ?? []).filter((w) => !VACIAS.has(w))
}

/**
 * Los números literales de un bloque de lista numerada, en orden: «1. a\n7. b» → [1, 7].
 * Devuelve [] si no hay números explícitos (una lista con viñetas, o texto suelto).
 * Sirve para que el render respete lo escrito y no auto-numere otra vez desde 1.
 */
export function numerosDeLista(texto: string): number[] {
  const ns: number[] = []
  for (const l of (texto ?? '').split('\n')) {
    const m = /^\s*(\d+)[.)]\s/.exec(l)
    if (m) ns.push(Number(m[1]))
  }
  return ns
}
