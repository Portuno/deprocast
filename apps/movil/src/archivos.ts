/**
 * Fotos y videos desde Hoy (Mobile 1.2), y lo que se comparte desde otras apps (1.3). Elegís de la galería (varios a la vez) o sacás con la cámara; cada uno se copia
 * a la carpeta de documentos de la app (la de caché la borra el sistema) y queda en la cola en disco con su nota, la
 * hora y el último lugar conocido. Sale con la sincronización de la app, con su clave (un reintento no lo duplica); sin
 * red, espera. Lo que hace Deprocast con cada uno (leerlo, anotarlo, transcribir el video) aparece en Hoy.
 */
import * as ImagePicker from 'expo-image-picker'
import { Directory, File, Paths } from 'expo-file-system'
import { archivosEnCola, encolarArchivo, fallaArchivo, sacarArchivo } from './almacen'
import { ErrorApi, subirArchivo, type Credenciales } from './api'
import { alSincronizar, sincronizar } from './sincronizar'
import { claveNueva } from './logica/sincro'
import { nombreYTipo, queHacer } from './logica/archivos'
import { ultimoPunto } from './recorrido'
import { ajustesCaptura } from './captura'
import { capta } from './logica/captura'

function carpeta(): Directory {
  const d = new Directory(Paths.document, 'archivos')
  if (!d.exists) d.create()
  return d
}

/**
 * Abre la galería o la cámara y deja en la cola lo elegido. nota: lo que había escrito (va con el archivo). Devuelve
 * cuántos quedaron en la cola, o un aviso si no hay permiso.
 */
export async function elegirArchivos(c: Credenciales, o: { camara: boolean; nota?: string | null }): Promise<{ encolados: number; aviso: string | null }> {
  const permiso = o.camara ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permiso.granted) return { encolados: 0, aviso: o.camara ? 'Sin permiso de cámara no puedo sacar la foto.' : 'Sin permiso a tus fotos no puedo elegirlas.' }
  const opciones: ImagePicker.ImagePickerOptions = { mediaTypes: ['images', 'videos'], quality: 0.85, videoMaxDuration: 600, exif: false }
  const r = o.camara ? await ImagePicker.launchCameraAsync(opciones) : await ImagePicker.launchImageLibraryAsync({ ...opciones, allowsMultipleSelection: true, selectionLimit: 20 })
  if (r.canceled || !r.assets?.length) return { encolados: 0, aviso: null }
  const conLugar = capta(await ajustesCaptura(), 'ubicacion')
  const p = conLugar ? ultimoPunto() : null
  const lugar = p && Date.now() - p.en < 15 * 60_000 ? { lat: p.lat, lon: p.lon } : { lat: null, lon: null }
  let n = 0
  for (const a of r.assets) {
    const { nombre, tipo } = nombreYTipo({ uri: a.uri, fileName: a.fileName, mimeType: a.mimeType, type: a.type, duration: a.duration })
    const id = claveNueva()
    // Una copia propia: la que da la galería o la cámara puede desaparecer antes de subir.
    const destino = new File(carpeta(), `${id}-${nombre}`)
    try { new File(a.uri).copy(destino) } catch { continue }
    await encolarArchivo({ id, uri: destino.uri, nombre, tipo, nota: o.nota?.trim() || null, en: Date.now(), ...lugar })
    n++
  }
  if (n) void sincronizar(c)
  return { encolados: n, aviso: n < r.assets.length ? `${r.assets.length - n} no se pudieron copiar.` : null }
}

/**
 * Lo que llegó por «Compartir → Deprocast» (Mobile 1.3): fotos, videos, audios o documentos. Se copian (la copia que deja
 * el sistema está en la caché y se borra) y quedan en la misma cola que lo de 📎, con la nota.
 */
export async function encolarCompartidos(c: Credenciales, archivos: { uri: string; nombre: string | null; mime: string | null }[], nota: string | null): Promise<number> {
  const conLugar = capta(await ajustesCaptura(), 'ubicacion')
  const p = conLugar ? ultimoPunto() : null
  const lugar = p && Date.now() - p.en < 15 * 60_000 ? { lat: p.lat, lon: p.lon } : { lat: null, lon: null }
  let n = 0
  for (const a of archivos) {
    const { nombre, tipo } = nombreYTipo({ uri: a.uri, fileName: a.nombre, mimeType: a.mime, type: 'file' })
    const id = claveNueva()
    const destino = new File(carpeta(), `${id}-${nombre}`)
    try { new File(a.uri).copy(destino) } catch { continue }
    await encolarArchivo({ id, uri: destino.uri, nombre, tipo, nota: nota?.trim() || null, en: Date.now(), ...lugar })
    n++
  }
  if (n) void sincronizar(c)
  return n
}

/** Sube lo que espera (de a uno, en orden). Lo subido sale de la cola y su copia se borra. */
export async function subirArchivos(c: Credenciales) {
  for (const a of await archivosEnCola()) {
    try {
      await subirArchivo(c, a.uri, { id: a.id, nombre: a.nombre, tipo: a.tipo, nota: a.nota, en: a.en, lat: a.lat, lon: a.lon })
      await sacarArchivo(a.id)
      try { new File(a.uri).delete() } catch { /* ya no estaba */ }
    } catch (e) {
      const status = e instanceof ErrorApi ? e.status : null
      const accion = queHacer(status, a.intentos)
      if (accion === 'descartar') { await sacarArchivo(a.id); try { new File(a.uri).delete() } catch { /* ya no estaba */ } }
      else await fallaArchivo(a.id, e instanceof Error ? e.message : String(e))
      if (status == null) return // sin red: el resto espera a la próxima
    }
  }
}

let registrado = false
export function registrarArchivos() {
  if (registrado) return
  registrado = true
  alSincronizar(subirArchivos)
}
