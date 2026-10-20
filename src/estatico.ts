/**
 * Servir rápido lo que no cambia y comprimir lo que viaja:
 * - La pantalla (JS, CSS, HTML): cada archivo con el hash de su contenido en «?v=» → caché inmutable de un año; el
 *   index.html, con ETag y no-cache (se revalida en un pedido de 0 bytes). Brotli o gzip según lo que acepte el
 *   navegador, comprimido una vez y guardado en memoria (se rehace si el archivo cambia: en la compu se edita en vivo).
 * - Los adjuntos (fotos, audios, PDF): content-length, ETag y Range (206), para adelantar un audio o un video.
 * - El JSON de la API: gzip si pesa, y ETag/304 en los GET (si no cambió, no viaja ni se vuelve a leer).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'

type Archivo = { mtime: number; tamano: number; crudo: Buffer; hash: string; br?: Buffer; gz?: Buffer }
const cache = new Map<string, Archivo>()
const COMPRIMIBLE = /\.(js|css|html|svg|json|webmanifest|txt|md)$/i

function leer(archivo: string): Archivo {
  const st = fs.statSync(archivo)
  const ya = cache.get(archivo)
  if (ya && ya.mtime === st.mtimeMs && ya.tamano === st.size) return ya
  const crudo = fs.readFileSync(archivo)
  const a = { mtime: st.mtimeMs, tamano: st.size, crudo, hash: crypto.createHash('sha1').update(crudo).digest('hex').slice(0, 12) }
  cache.set(archivo, a)
  return a
}

/** El hash del contenido de un archivo de la pantalla (para su «?v=»). */
export const versionDe = (archivo: string) => leer(archivo).hash

const acepta = (req: http.IncomingMessage) => String(req.headers['accept-encoding'] ?? '')

/** Manda un cuerpo comprimido si conviene (y lo guarda si viene de un archivo). */
function cuerpoPara(req: http.IncomingMessage, a: Archivo | null, crudo: Buffer, comprimible: boolean): { cuerpo: Buffer; codificacion: string | null } {
  if (!comprimible || crudo.length < 1024) return { cuerpo: crudo, codificacion: null }
  const ae = acepta(req)
  if (/\bbr\b/.test(ae)) {
    const br = a?.br ?? zlib.brotliCompressSync(crudo, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: a ? 9 : 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: crudo.length } })
    if (a) a.br = br
    return { cuerpo: br, codificacion: 'br' }
  }
  if (/\bgzip\b/.test(ae)) {
    const gz = a?.gz ?? zlib.gzipSync(crudo, { level: a ? 9 : 5 })
    if (a) a.gz = gz
    return { cuerpo: gz, codificacion: 'gzip' }
  }
  return { cuerpo: crudo, codificacion: null }
}

/**
 * Un archivo de la pantalla. inmutable: el pedido trae «?v=» con su hash (cambia el contenido → cambia la URL).
 * contenido: para el index.html ya reescrito (se sirve igual, con ETag de su propio texto).
 */
export function servirEstatico(req: http.IncomingMessage, res: http.ServerResponse, archivo: string, tipo: string, o: { inmutable?: boolean; contenido?: string } = {}) {
  const a = o.contenido == null ? leer(archivo) : null
  const crudo = a ? a.crudo : Buffer.from(o.contenido!, 'utf8')
  const etag = `"${a ? a.hash : crypto.createHash('sha1').update(crudo).digest('hex').slice(0, 12)}"`
  const comunes = { etag, vary: 'accept-encoding', 'cache-control': o.inmutable ? 'public, max-age=31536000, immutable' : 'no-cache' }
  if (req.headers['if-none-match'] === etag) return void res.writeHead(304, comunes).end()
  const { cuerpo, codificacion } = cuerpoPara(req, a, crudo, COMPRIMIBLE.test(archivo))
  res.writeHead(200, { ...comunes, 'content-type': tipo, 'content-length': cuerpo.length, ...(codificacion ? { 'content-encoding': codificacion } : {}) })
  res.end(req.method === 'HEAD' ? undefined : cuerpo)
}

/** El index.html con cada script y la hoja de estilos apuntando a su versión (el hash de su contenido). */
export function indexConVersiones(web: string): string {
  let html = leer(path.join(web, 'index.html')).crudo.toString('utf8')
  // Las vistas perezosas no se cargan al arrancar: salen del HTML y se anuncian (versión, funciones, lo que necesitan)
  // para que 05-comun.js las pida la primera vez que hacen falta.
  const perezosos: Record<string, { v: string; funciones: string[]; necesita: string[] }> = {}
  html = html.replace(/[ \t]*<script data-perezoso src="\/js\/([^"]+)"(?: data-necesita="([^"]*)")?><\/script>\r?\n?/g, (_, archivo: string, necesita?: string) => {
    try {
      const a = leer(path.join(web, 'js', archivo))
      const funciones = [...a.crudo.toString('utf8').matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
      perezosos[archivo] = { v: a.hash, funciones, necesita: (necesita ?? '').split(/\s+/).filter(Boolean) }
    } catch { /* un archivo que falta no rompe el index */ }
    return ''
  })
  if (Object.keys(perezosos).length) {
    const i = html.indexOf('<script defer')
    const manifiesto = `<script>window.PEREZOSOS = ${JSON.stringify(perezosos).replace(/</g, '\\u003c')}</script>\n  `
    html = i >= 0 ? html.slice(0, i) + manifiesto + html.slice(i) : html.replace('</body>', `${manifiesto}</body>`)
  }
  return html.replace(/(src|href)="(\/(?:js\/[^"?]+\.js|estilo\.css))"/g, (_, attr: string, ruta: string) => {
    try { return `${attr}="${ruta}?v=${versionDe(path.join(web, ruta))}"` } catch { return `${attr}="${ruta}"` }
  })
}

/** Un archivo grande (adjunto): ETag por tamaño y fecha, y Range para pedir un pedazo (audio y video). */
export function servirArchivo(req: http.IncomingMessage, res: http.ServerResponse, archivo: string, headers: Record<string, string>) {
  const st = fs.statSync(archivo)
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`
  const comunes = { ...headers, etag, 'accept-ranges': 'bytes' }
  if (req.headers['if-none-match'] === etag) return void res.writeHead(304, comunes).end()
  const rango = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
  if (rango && (rango[1] || rango[2])) {
    let desde = rango[1] ? Number(rango[1]) : st.size - Number(rango[2])
    let hasta = rango[1] && rango[2] ? Number(rango[2]) : st.size - 1
    desde = Math.max(0, desde)
    hasta = Math.min(st.size - 1, hasta)
    if (desde > hasta || desde >= st.size) return void res.writeHead(416, { 'content-range': `bytes */${st.size}` }).end()
    res.writeHead(206, { ...comunes, 'content-range': `bytes ${desde}-${hasta}/${st.size}`, 'content-length': hasta - desde + 1 })
    return void fs.createReadStream(archivo, { start: desde, end: hasta }).pipe(res)
  }
  res.writeHead(200, { ...comunes, 'content-length': st.size })
  if (req.method === 'HEAD') return void res.end()
  fs.createReadStream(archivo).pipe(res)
}

/**
 * Para las respuestas JSON de la API: si es un GET, ETag (y 304 si el navegador ya lo tiene); si pesa más de 2 KB, gzip.
 * Se engancha al principio del pedido y actúa en el res.end del JSON (no toca lo que ya mandó sus headers).
 */
export function comprimirJson(req: http.IncomingMessage, res: http.ServerResponse) {
  const end = res.end.bind(res) as (...a: any[]) => http.ServerResponse
  ;(res as any).end = (chunk?: any, ...resto: any[]) => {
    if (res.headersSent || chunk == null || typeof chunk === 'function' || res.statusCode !== 200 || !/json/.test(String(res.getHeader('content-type') ?? ''))) return end(chunk, ...resto)
    const crudo = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
    if (req.method === 'GET') {
      const etag = `W/"${crypto.createHash('sha1').update(crudo).digest('base64url').slice(0, 16)}"`
      res.setHeader('etag', etag)
      res.setHeader('cache-control', 'no-cache')
      if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return end() }
    }
    const { cuerpo, codificacion } = cuerpoPara(req, null, crudo, crudo.length > 2048)
    if (codificacion) { res.setHeader('content-encoding', codificacion); res.setHeader('vary', 'accept-encoding') }
    res.setHeader('content-length', cuerpo.length)
    return end(cuerpo, ...resto)
  }
}
