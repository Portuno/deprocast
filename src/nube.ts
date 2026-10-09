/**
 * En Vercel el disco se borra cuando la función se duerme. Si hay un Blob privado,
 * la base y los archivos (cargas, taller, tandas, bitácora) se bajan al arrancar
 * y se suben después de cada cambio.
 */
import fs from 'node:fs'
import path from 'node:path'
import type http from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { waitUntil } from '@vercel/functions'
import { resolverRuta } from './db.ts'

const DB_BLOB = 'deprocast/mastro.db'
const ARCHIVOS = 'deprocast/archivos'

let puntoDeControl: () => void = () => {}
let cola: Promise<void> = Promise.resolve()

export const hayNube = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)

export function alGuardar(f: () => void) {
  puntoDeControl = f
}

async function cliente() {
  return import('@vercel/blob')
}

async function volcar(origen: import('node:stream/web').ReadableStream, destino: string) {
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  const tmp = `${destino}.bajando`
  await pipeline(Readable.fromWeb(origen), fs.createWriteStream(tmp))
  fs.renameSync(tmp, destino)
}

/** Antes de abrir la base: trae lo último que se guardó, si hay. */
export async function bajarNube() {
  if (!hayNube()) return
  try {
    const { get, list } = await cliente()
    const archivo = await get(DB_BLOB, { access: 'private', useCache: false }).catch(() => null)
    if (archivo && archivo.statusCode === 200 && archivo.stream) await volcar(archivo.stream as import('node:stream/web').ReadableStream, resolverRuta())
    let cursor: string | undefined
    do {
      const pagina = await list({ prefix: `${ARCHIVOS}/`, cursor, limit: 200 })
      for (const item of pagina.blobs) {
        const rel = item.pathname.slice(`${ARCHIVOS}/`.length)
        const dest = rutaDe(rel)
        if (!dest) continue
        const uno = await get(item.pathname, { access: 'private', useCache: false }).catch(() => null)
        if (!uno || uno.statusCode !== 200 || !uno.stream) continue
        await volcar(uno.stream as import('node:stream/web').ReadableStream, dest)
      }
      cursor = pagina.hasMore ? pagina.cursor : undefined
    } while (cursor)
  } catch (e) {
    console.error('  nube: no pude bajar la base:', e instanceof Error ? e.message : e)
  }
}

function rutaDe(rel: string): string | null {
  const limpio = path.normalize(rel).replace(/^[/\\]+/, '')
  if (!limpio || limpio.startsWith('..') || path.isAbsolute(limpio)) return null
  const [raiz, ...resto] = limpio.split(/[/\\]/)
  if (raiz === 'cargas' && process.env.MASTRO_CARGAS) return path.join(process.env.MASTRO_CARGAS, ...resto)
  if (raiz === 'taller') return path.join(path.dirname(resolverRuta()), 'taller', ...resto)
  if (raiz === 'tandas') return path.join(path.dirname(resolverRuta()), 'tandas', ...resto)
  if (raiz === 'bitacora.md' && resto.length === 0 && process.env.MASTRO_BITACORA) return process.env.MASTRO_BITACORA
  return null
}

function archivosLocales(): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = []
  const recorrer = (dir: string, prefijo: string) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) recorrer(abs, `${prefijo}${e.name}/`)
      else if (e.isFile() && !e.name.endsWith('.bajando')) out.push({ rel: `${prefijo}${e.name}`, abs })
    }
  }
  if (process.env.MASTRO_CARGAS) recorrer(process.env.MASTRO_CARGAS, 'cargas/')
  recorrer(path.join(path.dirname(resolverRuta()), 'taller'), 'taller/')
  recorrer(path.join(path.dirname(resolverRuta()), 'tandas'), 'tandas/')
  const bit = process.env.MASTRO_BITACORA
  if (bit && fs.existsSync(bit)) out.push({ rel: 'bitacora.md', abs: bit })
  return out
}

export async function subirAhora() {
  if (!hayNube()) return
  const turno = cola.then(() => subir())
  cola = turno.catch((e) => console.error('  nube: no pude guardar:', e instanceof Error ? e.message : e))
  await turno
}

async function subir() {
  try { puntoDeControl() } catch { /* la base puede no estar abierta */ }
  const { put } = await cliente()
  const opts = { access: 'private' as const, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/octet-stream' }
  const ruta = resolverRuta()
  if (fs.existsSync(ruta)) await put(DB_BLOB, fs.readFileSync(ruta), opts)
  for (const a of archivosLocales()) {
    if (fs.statSync(a.abs).size > 100 * 1024 * 1024) {
      console.error(`  nube: ${a.rel} pesa más de 100 MB y no entra en un guardado`)
      continue
    }
    await put(`${ARCHIVOS}/${a.rel}`, fs.readFileSync(a.abs), opts)
  }
}

/** Mantiene viva la función hasta que el guardado termina, después de responder. */
export function esperarSubida(res: http.ServerResponse) {
  let hecho = false
  let listo: () => void = () => {}
  const cuando = new Promise<void>((ok) => {
    listo = () => { if (hecho) return; hecho = true; ok() }
  })
  res.on('finish', listo)
  res.on('close', listo)
  try { waitUntil(cuando.then(() => subirAhora())) } catch { /* fuera de un pedido de Vercel */ }
}
