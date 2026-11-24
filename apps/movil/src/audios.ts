/**
 * Los audios quedan en el teléfono (Mobile 2.0). Antes, un tramo de voz se subía, se transcribía y se borraba del
 * teléfono. Ahora, cuando el servidor confirma, el WAV se muda a documentos/audios/<día>/ (fuera de la carpeta de
 * tramos: lo de ahí se vuelve a encolar al abrir) y queda anotado con su texto, a dónde fue y quién hablaba. Se
 * escuchan, se comparten o se borran desde el módulo Audios; nada se borra solo.
 */
import { Directory, File, Paths } from 'expo-file-system'
import { anotarAudio, audiosAntesDe, leerAudios, olvidarAudio, resumenAudios, type AudioGuardado } from './almacen'

const dos = (n: number) => String(n).padStart(2, '0')
const diaDe = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}` }

function carpeta(...partes: string[]): Directory {
  let d = new Directory(Paths.document, 'audios')
  if (!d.exists) d.create()
  for (const p of partes) { d = new Directory(d, p); if (!d.exists) d.create() }
  return d
}

type Meta = { id?: string; modo: string; inicio: number; fin?: number; lat?: number; lon?: number }
type Respuesta = { texto?: string | null; destino?: string | null; hablante?: { nombre: string | null; etiqueta: string } | null }

/** El tramo ya subió: se muda al archivo de audios. Si algo falla, el archivo queda donde estaba (nunca se pierde). */
export async function archivar(uri: string, meta: Meta, r: Respuesta | null): Promise<boolean> {
  try {
    const f = new File(uri)
    if (!f.exists) return false
    const id = meta.id ?? (/([^/]+)\.wav$/i.exec(uri)?.[1] ?? String(meta.inicio))
    const destino = new File(carpeta(diaDe(meta.inicio)), `${id}.wav`)
    await f.move(destino)
    await anotarAudio({
      id, uri: f.uri, inicio: meta.inicio, fin: meta.fin ?? null, modo: meta.modo, texto: r?.texto ?? null, destino: r?.destino ?? null,
      hablante: r?.hablante ? r.hablante.nombre ?? r.hablante.etiqueta : null, bytes: f.size ?? 0, lat: meta.lat ?? null, lon: meta.lon ?? null,
    })
    return true
  } catch { return false }
}

export const audiosRecientes = (horas = 24) => leerAudios({ desde: Date.now() - horas * 3_600_000 })
export const todosLosAudios = (limite = 500) => leerAudios({ limite })
export const espacioAudios = resumenAudios

export async function borrarAudio(a: Pick<AudioGuardado, 'id' | 'uri'>) {
  try { new File(a.uri).delete() } catch { /* ya no estaba */ }
  await olvidarAudio(a.id)
}

/** Libera lugar: borra los audios de antes de una fecha. Devuelve cuántos borró. */
export async function borrarAudiosAntesDe(t: number): Promise<number> {
  const xs = await audiosAntesDe(t)
  for (const a of xs) await borrarAudio(a)
  return xs.length
}

/** Al desvincular: la carpeta entera. */
export function borrarCarpetaAudios() {
  try { const d = new Directory(Paths.document, 'audios'); if (d.exists) d.delete() } catch { /* ya no estaba */ }
}

/** El audio que se dijo a esta hora (±3 s), para tocarlo desde «Lo que se dijo». */
export function audioCerca(audios: AudioGuardado[], inicio: number): AudioGuardado | null {
  let mejor: AudioGuardado | null = null
  for (const a of audios) if (Math.abs(a.inicio - inicio) <= 3000 && (!mejor || Math.abs(a.inicio - inicio) < Math.abs(mejor.inicio - inicio))) mejor = a
  return mejor
}
