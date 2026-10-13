/**
 * Imágenes en el chat. Se suben aparte (quedan en data/adjuntos/) y el mensaje lleva una marca
 * `[imagen:/adjuntos/<archivo>|<descripción>]`. En el turno en que se manda, el modelo VE la imagen (DeepSeek y Qwen
 * aceptan imagen y herramientas juntas); en los turnos siguientes, y para la memoria y los títulos, viaja la
 * descripción (no se reenvía la imagen cada vez).
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

let describir = async (db: Db, datos: Buffer, mime: string): Promise<string> => (await nanVision({ db, clase: 'mastropiero', agenteId: 'chat' }, {
  sistema: 'Describís una imagen que el operador le manda a su asistente en una conversación. En castellano: qué es (captura de pantalla, foto, documento, gráfico…), todo el texto visible tal cual, y los detalles que importan. Entre 2 y 8 oraciones, sin adornos.',
  texto: 'Describí esta imagen.', imagen: `data:${mime};base64,${datos.toString('base64')}`, maxTokens: 1200,
})).texto
export function _probarAdjuntos(f: typeof describir) {
  describir = f
}

const limpia = (d: string) => d.replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 700)

/** Guarda la imagen (achicada a JPEG si hace falta) y la describe. Devuelve la marca para el mensaje. */
export async function guardarImagen(db: Db, nombre: string, datos: Buffer, ahora = Date.now()): Promise<{ url: string; descripcion: string; marca: string }> {
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
  let descripcion = ''
  try { descripcion = limpia(await describir(db, img.datos, img.mime)) } catch { /* sin descripción: igual se ve en el turno */ }
  const url = `/adjuntos/${archivo}`
  return { url, descripcion, marca: `[imagen:${url}|${descripcion || 'sin descripción'}]` }
}

/** Para los turnos siguientes, la memoria y los títulos: la imagen como su descripción. */
export const comoTexto = (t: string) => t.replace(MARCA, (_, __, d) => `(imagen adjunta: ${d})`)

/** Para el turno en que se manda: el texto y las imágenes de verdad (como data URL), para que el modelo las vea. */
export function conImagenes(t: string): string | Record<string, unknown>[] {
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
