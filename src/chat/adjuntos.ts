/**
 * Imágenes en el chat. Se suben aparte (quedan en data/adjuntos/) y el mensaje lleva una marca
 * `[imagen:/adjuntos/<archivo>|<descripción>]`. En el turno en que se manda, el modelo VE la imagen (DeepSeek y Qwen
 * aceptan imagen y herramientas juntas); en los turnos siguientes, y para la memoria y los títulos, viaja la
 * descripción (no se reenvía la imagen cada vez).
 * Archivos (PDF, Word, Excel, PowerPoint, texto): la marca es `[archivo:/adjuntos/<archivo>|<nombre>|<palabras>]`. Su texto
 * se saca al subirlo (queda al lado, en .txt) y viaja entero (hasta 40 mil caracteres) en el turno en que se manda; en
 * los siguientes, solo un comienzo.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { resolverRuta, type Db } from '../db.ts'
import { guardarLectura, leerImagen, type LecturaImagen } from '../lectura-imagen.ts'
import { aJpeg } from '../tandas.ts'

export const dirAdjuntos = () => path.resolve(process.env.MASTRO_ADJUNTOS ?? path.join(path.dirname(resolverRuta()), 'adjuntos'))
export const MARCA = /\[imagen:(\/adjuntos\/[^\]|\s]+)\|([^\]]*)\]/g
export const MARCA_ARCHIVO = /\[archivo:(\/adjuntos\/[^\]|\s]+)\|([^\]|]*)\|([^\]]*)\]/g
/** Lo que se acepta como archivo en el chat (sin HTML ni SVG: no se sirve nada que pueda correr en la página). */
export const EXT_ARCHIVO = /^(pdf|docx|xlsx|pptx|txt|md|csv|json)$/

/** El texto que se sacó de un archivo adjunto (o '' si no hay). */
export function textoDeArchivo(url: string): string {
  const t = path.join(dirAdjuntos(), `${path.basename(url)}.txt`)
  return fs.existsSync(t) ? fs.readFileSync(t, 'utf8') : ''
}

/** Guarda un archivo en data/adjuntos y deja su texto al lado. Devuelve la marca para el mensaje. */
export async function guardarArchivo(nombre: string, datos: Buffer, ahora = Date.now()): Promise<{ url: string; nombre: string; bytes: number; palabras: number; marca: string }> {
  if (!datos.length) throw new Error('El archivo está vacío')
  if (datos.length > 30 * 1024 * 1024) throw new Error('El archivo pesa más de 30 MB')
  const limpio = path.basename(nombre || 'archivo').replace(/[[\]|]/g, ' ').trim().slice(0, 120) || 'archivo'
  const ext = path.extname(limpio).toLowerCase().slice(1)
  if (!EXT_ARCHIVO.test(ext)) throw new Error('Por ahora el chat lee PDF, Word, Excel, PowerPoint y texto (txt, md, csv, json)')
  const { textoDeDocumento } = await import('../takeout/nube.ts')
  let texto = ''
  try { texto = textoDeDocumento(datos, ext).replace(/\u0000/g, '').trim() } catch { /* sin texto: se adjunta igual */ }
  const archivo = `${ahora}-${crypto.createHash('sha1').update(datos).digest('hex').slice(0, 10)}.${ext}`
  fs.mkdirSync(dirAdjuntos(), { recursive: true })
  fs.writeFileSync(path.join(dirAdjuntos(), archivo), datos)
  fs.writeFileSync(path.join(dirAdjuntos(), `${archivo}.txt`), texto)
  const palabras = texto ? texto.split(/\s+/).length : 0
  return { url: `/adjuntos/${archivo}`, nombre: limpio, bytes: datos.length, palabras, marca: `[archivo:/adjuntos/${archivo}|${limpio}|${palabras} palabras]` }
}

// La imagen se lee entera (texto, estructura y lo ilegible: Fragua #270); un test puede devolver una descripción suelta.
let describir = async (db: Db, datos: Buffer, mime: string): Promise<LecturaImagen | string> => leerImagen(db, { datos, mime })
export function _probarAdjuntos(f: typeof describir) {
  describir = f
}

const limpia = (d: string) => d.replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 700)

/** Guarda una imagen en data/adjuntos (achicada a JPEG si hace falta). La usan el chat y la captura (comidas, tickets). */
export function guardarFoto(nombre: string, datos: Buffer, ahora = Date.now()): { url: string; datos: Buffer; mime: string } {
  if (!datos.length) throw new Error('La imagen está vacía')
  if (datos.length > 25 * 1024 * 1024) throw new Error('La imagen pesa más de 25 MB')
  const tmp = path.join(os.tmpdir(), `mastro-adj-${ahora}-${path.basename(nombre || 'imagen').replace(/[^\w.-]/g, '_')}`)
  fs.writeFileSync(tmp, datos)
  let img: { datos: Buffer; mime: string }
  try { img = aJpeg(tmp, datos.length) } finally { fs.rmSync(tmp, { force: true }) }
  const ext = img.mime === 'image/png' ? 'png' : img.mime === 'image/webp' ? 'webp' : 'jpg'
  const archivo = `${ahora}-${crypto.createHash('sha1').update(img.datos).digest('hex').slice(0, 10)}.${ext}`
  fs.mkdirSync(dirAdjuntos(), { recursive: true })
  fs.writeFileSync(path.join(dirAdjuntos(), archivo), img.datos)
  return { url: `/adjuntos/${archivo}`, datos: img.datos, mime: img.mime }
}

/** Una foto guardada, para volver a mirarla (la corrección de una captura). */
export function leerFoto(url: string): { datos: Buffer; mime: string } | null {
  const archivo = path.join(dirAdjuntos(), path.basename(url))
  if (!fs.existsSync(archivo)) return null
  return { datos: fs.readFileSync(archivo), mime: archivo.endsWith('.png') ? 'image/png' : archivo.endsWith('.webp') ? 'image/webp' : 'image/jpeg' }
}

/** Una descripción suelta (la de un test, o un modelo que no devolvió JSON) como lectura. */
export const comoLectura = (l: LecturaImagen | string): LecturaImagen => typeof l === 'string' ? { clase: 'otro', titulo: 'Imagen', descripcion: l.trim(), texto: '', grupos: [], ilegible: [], modelo: null } : l

/**
 * Guarda la imagen (achicada a JPEG si hace falta), la lee entera y deja la lectura como pieza del corpus (Fragua #270 y
 * #272: lo que se manda no se pierde con el turno). Devuelve la marca para el mensaje: en los turnos siguientes viaja un
 * resumen corto con el número de pieza, para volver a la lectura entera. Si no se pudo guardar, `aviso` lo dice.
 */
export async function guardarImagen(db: Db, nombre: string, datos: Buffer, ahora = Date.now()): Promise<{ url: string; descripcion: string; marca: string; pieza: number | null; drive: boolean; aviso?: string }> {
  const { url, datos: jpeg, mime } = guardarFoto(nombre, datos, ahora)
  let descripcion = '', pieza: number | null = null, aviso: string | undefined
  let lectura: LecturaImagen | null = null
  try { lectura = comoLectura(await describir(db, jpeg, mime)) } catch (e) { aviso = `No pude leer la imagen (${(e as Error).message}): la ve el modelo en este turno, pero no quedó leída en tu corpus.` }
  if (lectura) {
    try { pieza = guardarLectura(db, lectura, { datos: jpeg, url, canal: 'chat' }, ahora) } catch (e) { aviso = `No pude guardar la lectura en tu corpus: ${(e as Error).message}` }
    const estructura = lectura.grupos.length ? ` Estructura: ${lectura.grupos.map((g) => `${g.nombre}: ${g.items.join(', ')}`).join('; ')}.` : ''
    descripcion = limpia(`${lectura.descripcion || lectura.titulo}${estructura}${!estructura && lectura.texto ? ` Texto: ${lectura.texto}` : ''}`)
    if (pieza) descripcion = `${descripcion.slice(0, 640)} (lectura entera: pieza #${pieza})`
  }
  const { alDrive, guardaMedios } = await import('../google/drive.ts')
  const drive = guardaMedios(db)
  try { alDrive(db, { datos, nombre, tipo: 'imagen', origen: 'chat', descripcion }) } catch { /* la cola de Drive avisa sola */ }
  return { url, descripcion, marca: `[imagen:${url}|${descripcion || 'sin descripción'}]`, pieza, drive, ...(aviso ? { aviso } : {}) }
}

/** Para los turnos siguientes, la memoria y los títulos: la imagen como su descripción; el archivo, con su comienzo. */
export const comoTexto = (t: string) => t.replace(MARCA, (_, __, d) => `(imagen adjunta: ${d})`)
  .replace(MARCA_ARCHIVO, (_, url, nombre, p) => { const x = textoDeArchivo(url); return `(archivo adjunto «${nombre}», ${p}${x ? `; empieza: «${x.slice(0, 600).replace(/\s+/g, ' ')}…»` : ', sin texto legible'})` })

/** Para el turno en que se manda: el texto y las imágenes de verdad (como data URL), para que el modelo las vea. */
export function conImagenes(t: string): string | Record<string, unknown>[] {
  // Los archivos van como su texto (el que se sacó al subirlo), en este turno entero hasta 40 mil caracteres.
  t = t.replace(MARCA_ARCHIVO, (_, url, nombre, p) => { const x = textoDeArchivo(url); return x ? `\n\n--- Archivo adjunto «${nombre}» (${p}) ---\n${x.slice(0, 40_000)}${x.length > 40_000 ? '\n[…sigue: es más largo]' : ''}\n--- fin del archivo ---\n` : `(archivo adjunto «${nombre}»: no tiene texto legible)` })
  const urls = [...t.matchAll(MARCA)].map((m) => m[1])
  if (!urls.length) return t
  const partes: Record<string, unknown>[] = [{ type: 'text', text: t.replace(MARCA, '(imagen adjunta: la ves abajo)').trim() || 'Mirá esta imagen.' }]
  for (const u of urls) {
    const archivo = path.join(dirAdjuntos(), path.basename(u))
    if (!fs.existsSync(archivo)) continue
    const mime = archivo.endsWith('.png') ? 'image/png' : archivo.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
    partes.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${fs.readFileSync(archivo).toString('base64')}` } })
  }
  return partes.length > 1 ? partes : comoTexto(t)
}
