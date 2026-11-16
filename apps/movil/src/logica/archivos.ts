/**
 * Fotos y videos desde Hoy (Mobile 1.2), sin nada de React Native: se prueba desde el repo.
 * - nombreYTipo: el nombre y el tipo de lo que eligió (la galería a veces no dice el tipo, o dice solo «image»);
 * - queHacer: con lo que respondió el servidor, si sale de la cola, se reintenta o se descarta (con su porqué).
 */

export type Elegido = { uri: string; fileName?: string | null; mimeType?: string | null; type?: string | null; duration?: number | null }

const EXT_TIPO: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', webm: 'video/webm', mkv: 'video/x-matroska' }

export function nombreYTipo(a: Elegido, ahora = Date.now()): { nombre: string; tipo: string; esVideo: boolean } {
  const deUri = /([^/?#]+)(?:[?#].*)?$/.exec(a.uri)?.[1] ?? ''
  const ext = (/\.([a-z0-9]+)$/i.exec(a.fileName || deUri)?.[1] ?? '').toLowerCase()
  const esVideo = a.type === 'video' || /^video\//.test(a.mimeType ?? '') || /^video\//.test(EXT_TIPO[ext] ?? '')
  const tipo = a.mimeType && /\//.test(a.mimeType) ? a.mimeType : EXT_TIPO[ext] ?? (esVideo ? 'video/mp4' : 'image/jpeg')
  const fecha = new Date(ahora).toISOString().slice(0, 19).replace(/[-:T]/g, '')
  const nombre = (a.fileName || deUri || `${esVideo ? 'video' : 'foto'}-${fecha}`).replace(/[^\w.\- ]+/g, '_').slice(0, 80) || `archivo-${fecha}`
  return { nombre: /\.[a-z0-9]{2,5}$/i.test(nombre) ? nombre : `${nombre}.${esVideo ? 'mp4' : 'jpg'}`, tipo, esVideo }
}

/** Con lo que respondió el servidor (status, o null sin red): ok, reintentar o descartar. A los 8 intentos fallidos, se descarta. */
export function queHacer(status: number | null, intentos: number): 'ok' | 'reintentar' | 'descartar' {
  if (status != null && status >= 200 && status < 300) return 'ok'
  if (status === 422 || status === 413 || status === 400) return 'descartar' // no tiene arreglo: el tipo, vacío, demasiado grande
  return intentos + 1 >= 8 ? 'descartar' : 'reintentar'
}
