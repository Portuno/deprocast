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
import { nanVision } from '../nan.ts'
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

let describir = async (db: Db, datos: Buffer, mime: string): Promise<string> => (await nanVision({ db, clase: 'mastropiero', agenteId: 'chat' }, {
  sistema: 'Describís una imagen que el operador le manda a su asistente en una conversación. En castellano: qué es (captura de pantalla, foto, documento, gráfico…), todo el texto visible tal cual, y los detalles que importan. Entre 2 y 8 oraciones, sin adornos.',
  texto: 'Describí esta imagen.', imagen: `data:${mime};base64,${datos.toString('base64')}`, maxTokens: 1200,
})).texto
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

/** Guarda la imagen (achicada a JPEG si hace falta) y la describe. Devuelve la marca para el mensaje. */
export async function guardarImagen(db: Db, nombre: string, datos: Buffer, ahora = Date.now()): Promise<{ url: string; descripcion: string; marca: string }> {
  const { url, datos: jpeg, mime } = guardarFoto(nombre, datos, ahora)
  let descripcion = ''
  try { descripcion = limpia(await describir(db, jpeg, mime)) } catch { /* sin descripción: igual se ve en el turno */ }
  return { url, descripcion, marca: `[imagen:${url}|${descripcion || 'sin descripción'}]` }
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
