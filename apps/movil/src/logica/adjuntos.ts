/**
 * Lo adjunto en la charla (Mobile 2.0), sin nada de React Native: se prueba desde el repo.
 * El servidor guarda los adjuntos en el texto del mensaje con una marca (src/chat/adjuntos.ts):
 * - `[imagen:/adjuntos/<archivo>|<descripción>]`
 * - `[archivo:/adjuntos/<archivo>|<nombre>|<detalle>]` (PDF, Word, una presentación…)
 * y a veces el modelo escribe un link a un adjunto: `[texto](/adjuntos/<archivo>)`.
 * Antes el teléfono mostraba la marca tal cual; ahora el mensaje se parte en texto, imágenes y archivos.
 */

export type Parte =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'imagen'; archivo: string; descripcion: string }
  | { tipo: 'archivo'; archivo: string; nombre: string; detalle: string }

const MARCAS = /\[imagen:\/adjuntos\/([^\]|\s]+)\|([^\]]*)\]|\[archivo:\/adjuntos\/([^\]|\s]+)\|([^\]|]*)\|([^\]]*)\]|!?\[([^\]]*)\]\(\/adjuntos\/([^)\s]+)\)/g
const IMAGEN = /\.(jpe?g|png|webp|gif|heic)$/i

/** El mensaje en partes, en orden. Un texto sin marcas es una sola parte. */
export function partesDe(texto: string): Parte[] {
  const out: Parte[] = []
  let desde = 0
  for (const m of texto.matchAll(MARCAS)) {
    const antes = texto.slice(desde, m.index).trim()
    if (antes) out.push({ tipo: 'texto', texto: antes })
    desde = m.index! + m[0].length
    if (m[1]) out.push({ tipo: 'imagen', archivo: m[1], descripcion: m[2].trim() })
    else if (m[3]) out.push({ tipo: 'archivo', archivo: m[3], nombre: m[4].trim() || m[3], detalle: m[5].trim() })
    else if (m[7]) out.push(IMAGEN.test(m[7]) ? { tipo: 'imagen', archivo: m[7], descripcion: m[6].trim() } : { tipo: 'archivo', archivo: m[7], nombre: m[6].trim() || m[7], detalle: '' })
  }
  const resto = texto.slice(desde).trim()
  if (resto) out.push({ tipo: 'texto', texto: resto })
  return out.length ? out : [{ tipo: 'texto', texto }]
}

/** ¿Tiene algo adjunto? */
export const tieneAdjuntos = (texto: string) => partesDe(texto).some((p) => p.tipo !== 'texto')

/** La ruta del adjunto en la API del teléfono (con el token del dispositivo, no con la clave de la pantalla). */
export const rutaAdjunto = (archivo: string, ancho?: number) => `adjunto/${encodeURIComponent(archivo)}${ancho ? `?ancho=${ancho}` : ''}`

/** El ícono de un archivo por su extensión (para la ficha en la burbuja). */
export function iconoArchivo(nombre: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(nombre)?.[1]?.toLowerCase() ?? ''
  if (ext === 'pdf') return '📄'
  if (['doc', 'docx', 'odt', 'md', 'txt'].includes(ext)) return '📝'
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return '📊'
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return '📽'
  if (['mp3', 'm4a', 'wav', 'ogg', 'opus'].includes(ext)) return '🎧'
  if (['mp4', 'mov', 'webm'].includes(ext)) return '🎬'
  return '📎'
}
