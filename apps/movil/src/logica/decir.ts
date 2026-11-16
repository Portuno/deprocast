/** Contestar en voz (Mobile 1.1): el texto como se dice, sin nada de React Native (se prueba desde el repo). */

/** Lo que se lee en voz alta: sin marcas de Markdown, sin links ni citas al corpus. */
export function paraDecir(texto: string): string {
  return texto
    .replace(/\[#\d+(?:,\s*#\d+)*\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000)
}
