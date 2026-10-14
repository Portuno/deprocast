/**
 * Rastrear un sitio (el deep crawl de crawl4ai, en chico): desde una página, en anchura, por los links del mismo
 * origen y del mismo tramo de ruta (/docs/…), sin repetir, respetando robots.txt y con una pausa entre pedidos.
 * Cada página entra al corpus (guardarLink) y todas juntas arman un cuaderno, listo para preguntarle o bajar en .md.
 */
import type { Db } from '../db.ts'
import { crearCuaderno, sumarFuentes } from '../cuadernos.ts'
import { guardarLink, leer, normalizarUrl, pedirLector, prefijoDe, type Lectura } from './index.ts'

const BINARIO = /\.(png|jpe?g|gif|webp|svg|ico|zip|gz|tar|rar|7z|mp3|mp4|webm|mov|avi|exe|dmg|woff2?|ttf|css|js|json|xml|rss|atom)(\?|$)/i

/** Las reglas Disallow para todos (User-agent: *). */
export function reglasRobots(txt: string): string[] {
  const reglas: string[] = []
  let aplica = false
  for (const l of txt.split(/\r?\n/)) {
    const [k, ...v] = l.replace(/#.*$/, '').split(':')
    const clave = k?.trim().toLowerCase()
    const valor = v.join(':').trim()
    if (clave === 'user-agent') aplica = valor === '*'
    else if (clave === 'disallow' && aplica && valor) reglas.push(valor)
  }
  return reglas
}

export async function rastrear(db: Db, url: string, o: { max?: number; esperaMs?: number; inicio?: Lectura; piezaInicio?: number; ahora?: number } = {}): Promise<{ cuadernoId: number; titulo: string; paginas: number; piezas: number[] }> {
  const max = Math.max(1, Math.min(o.max ?? 20, 60))
  const raiz = new URL(url)
  const prefijo = prefijoDe(raiz.pathname)
  let prohibidas: string[] = []
  try {
    const r = await pedirLector(`${raiz.origin}/robots.txt`)
    if (r.ok) prohibidas = reglasRobots(await r.text())
  } catch { /* sin robots.txt: todo permitido */ }
  const permitida = (u: URL) => u.origin === raiz.origin && u.pathname.startsWith(prefijo) && !BINARIO.test(u.pathname) && !prohibidas.some((p) => u.pathname.startsWith(p))
  const vistas = new Set<string>([normalizarUrl(url)])
  const cola: string[] = []
  const piezas: number[] = []
  const encolar = (l: Lectura) => {
    for (const x of l.links) {
      if (!x.interno) continue
      let u: URL
      try { u = new URL(x.url) } catch { continue }
      const n = normalizarUrl(u.toString())
      if (!vistas.has(n) && permitida(u)) { vistas.add(n); cola.push(u.toString()) }
    }
  }
  const primera = o.inicio ?? await leer(url)
  piezas.push(o.piezaInicio ?? (await guardarLink(db, url, { lectura: primera, ahora: o.ahora })).piezaId)
  encolar(primera)
  while (cola.length && piezas.length < max) {
    const u = cola.shift()!
    if (o.esperaMs !== 0) await new Promise((ok) => setTimeout(ok, o.esperaMs ?? 500))
    const l = await leer(u)
    if (!l.markdown || l.palabras < 30) continue // una página vacía o de error no suma
    piezas.push((await guardarLink(db, u, { lectura: l, ahora: o.ahora })).piezaId)
    encolar(l)
  }
  const titulo = `${primera.meta.sitio ?? raiz.host}${prefijo !== '/' ? ` · ${prefijo}` : ''}`
  const c = crearCuaderno(db, titulo, `Rastreado desde ${url}: ${piezas.length} página${piezas.length === 1 ? '' : 's'}.`, o.ahora)
  await sumarFuentes(db, c.id, { piezas })
  return { cuadernoId: c.id, titulo, paginas: piezas.length, piezas }
}
