/** Tokenizado mínimo compartido: minúsculas, sin tildes, 3+ letras, sin palabras vacías. */
const VACIAS = new Set(
  'para como pero esto esta este todo todos porque cuando donde sobre entre desde hasta tiene hace muy mas sus les que con una uno los las del por sin hay ser fue son the and with that this from'.split(' '),
)

export function palabras(s: string): string[] {
  return (s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9ñ]{3,}/g) ?? []).filter((w) => !VACIAS.has(w))
}
