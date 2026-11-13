/**
 * Los tramos de voz en disco (Mobile 1.0, bloque 2): cada uno en su archivo de la carpeta de documentos (la de caché el
 * sistema la borra cuando falta lugar, y se perdían tramos en cola), y la recuperación al abrir la app: lo que quedó a
 * medias por un cierre forzado, o suelto en la carpeta, vuelve a la cola. Las reglas están en logica/tramos.
 */
import { Directory, File, Paths } from 'expo-file-system'
import { cerrarTramoEnDisco, tramosEnCurso, urisEnCola } from './almacen'
import { recuperar, type EnCurso } from './logica/tramos'

export function carpetaTramos(): Directory {
  const d = new Directory(Paths.document, 'tramos')
  if (!d.exists) d.create()
  return d
}
/** La ruta del archivo de un tramo nuevo. */
export const archivoParaTramo = (id: string) => new File(carpetaTramos(), `${id}.wav`).uri

/** Al abrir la app: lo que quedó en curso o suelto, a la cola (o a la basura, si es casi nada). Devuelve cuántos volvieron. */
export async function recuperarTramos(ahora = Date.now()): Promise<number> {
  const enCurso: EnCurso[] = (await tramosEnCurso()).map((r) => ({ id: r.id, uri: r.uri, inicio: r.inicio, meta: (() => { try { return JSON.parse(r.meta) } catch { return { modo: 'pasivo', caminando: false } } })() }))
  const archivos = carpetaTramos().list().filter((x): x is File => x instanceof File && /\.wav$/i.test(x.uri)).map((f) => ({ uri: f.uri, bytes: f.size, modificado: f.modificationTime }))
  const decisiones = recuperar(enCurso, archivos, await urisEnCola(), ahora)
  let n = 0
  for (const d of decisiones) {
    const id = enCurso.find((t) => t.uri === d.uri)?.id ?? d.meta?.id ?? ''
    if (d.accion === 'borrar') { try { new File(d.uri).delete() } catch { /* ya no está */ } await cerrarTramoEnDisco(id, null); continue }
    await cerrarTramoEnDisco(id, { uri: d.uri, meta: d.meta })
    n++
  }
  // Lo anotado en curso cuyo archivo ya no existe: se limpia.
  const existentes = new Set(archivos.map((a) => a.uri))
  for (const t of enCurso) if (!existentes.has(t.uri)) await cerrarTramoEnDisco(t.id, null)
  return n
}
