/**
 * Fotos y videos desde Hoy (Mobile 1.2) y lo que se comparte desde otras apps (1.3: también audios y documentos), sin
 * nada de React Native: se prueba desde el repo.
 * - nombreYTipo: el nombre y el tipo de lo elegido (la galería a veces no dice el tipo, o dice solo «image»);
 * - queHacer: con lo que respondió el servidor, si sale de la cola, se reintenta o se descarta (con su porqué);
 * - armarCompartido: lo que llegó por «Compartir → Deprocast», separado en un mensaje (textos y links) y archivos.
 */

export type Elegido = { uri: string; fileName?: string | null; mimeType?: string | null; type?: string | null; duration?: number | null }

const EXT_TIPO: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', webm: 'video/webm', mkv: 'video/x-matroska',
  ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', amr: 'audio/amr',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', md: 'text/markdown',
}
const EXT_DE_TIPO: Record<string, string> = { video: 'mp4', audio: 'm4a', foto: 'jpg', archivo: 'bin' }

export function nombreYTipo(a: Elegido, ahora = Date.now()): { nombre: string; tipo: string; esVideo: boolean } {
  const deUri = /([^/?#]+)(?:[?#].*)?$/.exec(a.uri)?.[1] ?? ''
  const ext = (/\.([a-z0-9]+)$/i.exec(a.fileName || deUri)?.[1] ?? '').toLowerCase()
  const esVideo = a.type === 'video' || /^video\//.test(a.mimeType ?? '') || /^video\//.test(EXT_TIPO[ext] ?? '')
  const porDefecto = esVideo ? 'video/mp4' : a.type === 'image' || a.type == null ? 'image/jpeg' : a.type === 'audio' ? 'audio/mp4' : 'application/octet-stream'
  const tipo = a.mimeType && /\//.test(a.mimeType) && a.mimeType !== '*/*' ? a.mimeType : EXT_TIPO[ext] ?? porDefecto
  const familia = esVideo ? 'video' : /^audio\//.test(tipo) ? 'audio' : /^image\//.test(tipo) ? 'foto' : 'archivo'
  const fecha = new Date(ahora).toISOString().slice(0, 19).replace(/[-:T]/g, '')
  const nombre = (a.fileName || deUri || `${familia}-${fecha}`).replace(/[^\w.\- ]+/g, '_').slice(0, 80) || `archivo-${fecha}`
  return { nombre: /\.[a-z0-9]{2,5}$/i.test(nombre) ? nombre : `${nombre}.${EXT_DE_TIPO[familia]}`, tipo, esVideo }
}

/** Con lo que respondió el servidor (status, o null sin red): ok, reintentar o descartar. A los 8 intentos fallidos, se descarta. */
export function queHacer(status: number | null, intentos: number): 'ok' | 'reintentar' | 'descartar' {
  if (status != null && status >= 200 && status < 300) return 'ok'
  if (status === 422 || status === 413 || status === 400) return 'descartar' // no tiene arreglo: el tipo, vacío, demasiado grande
  return intentos + 1 >= 8 ? 'descartar' : 'reintentar'
}

export type Compartido = { shareType?: string | null; value?: string | null; mimeType?: string | null; contentUri?: string | null; contentMimeType?: string | null; originalName?: string | null }

/**
 * Lo compartido: los textos y links van juntos como un mensaje a Mastropiero (con la nota adelante); fotos, videos,
 * audios y documentos van como archivos (cada uno con la nota). Sin archivos, la nota va en el mensaje; con archivos y
 * sin textos, no hay mensaje aparte.
 */
export function armarCompartido(items: Compartido[], nota: string | null): { mensaje: string | null; archivos: { uri: string; nombre: string | null; mime: string | null }[] } {
  const textos: string[] = []
  const archivos: { uri: string; nombre: string | null; mime: string | null }[] = []
  for (const x of items) {
    const tipo = x.shareType ?? 'text'
    if (tipo === 'text' || tipo === 'url') { const v = (x.value ?? '').trim(); if (v && !textos.includes(v)) textos.push(v); continue }
    const uri = x.contentUri ?? x.value
    if (uri) archivos.push({ uri, nombre: x.originalName ?? null, mime: x.contentMimeType ?? x.mimeType ?? null })
  }
  const n = nota?.trim() || null
  const mensaje = textos.length ? [n, ...textos].filter(Boolean).join('\n\n') : !archivos.length && n ? n : null
  return { mensaje, archivos }
}
