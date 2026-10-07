/**
 * La web para la liga: buscar y leer. Los buscadores rotan por cuota gratis (Brave y Tavily si hay clave en .env;
 * sin clave, solo Wikipedia: para encontrar comunidades y gente hace falta una clave gratis de Tavily o Brave). Cada búsqueda cuenta en la tabla `cuotas` del mes.
 */
import type { Db } from './db.ts'
import { htmlATexto } from './motores.ts'

export type Resultado = { titulo: string; url: string; extracto: string; proveedor: string }

type Proveedor = { id: string; limite: number; disponible: () => boolean; buscar: (q: string, n: number) => Promise<Resultado[]> }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const sinTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()

let pedir = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
export function _probarWeb(f: typeof pedir) {
  pedir = f
}

const PROVEEDORES: Proveedor[] = [
  {
    id: 'brave', limite: Number(process.env.BRAVE_CUOTA ?? 2000), disponible: () => !!process.env.BRAVE_API_KEY,
    async buscar(q, n) {
      const r = await pedir(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${n}&search_lang=es`, { headers: { accept: 'application/json', 'x-subscription-token': process.env.BRAVE_API_KEY! } })
      if (!r.ok) throw new Error(`Brave ${r.status}`)
      const j: any = await r.json()
      return (j.web?.results ?? []).map((x: any) => ({ titulo: sinTags(x.title ?? ''), url: x.url, extracto: sinTags(x.description ?? ''), proveedor: 'brave' }))
    },
  },
  {
    id: 'tavily', limite: Number(process.env.TAVILY_CUOTA ?? 1000), disponible: () => !!process.env.TAVILY_API_KEY,
    async buscar(q, n) {
      const r = await pedir('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: q, max_results: n }) })
      if (!r.ok) throw new Error(`Tavily ${r.status}`)
      const j: any = await r.json()
      return (j.results ?? []).map((x: any) => ({ titulo: x.title ?? '', url: x.url, extracto: String(x.content ?? '').slice(0, 400), proveedor: 'tavily' }))
    },
  },
  {
    // Sin clave solo hay Wikipedia: sirve para saber cosas, no para encontrar gente ni comunidades.
    // (DuckDuckGo, Mojeek y Reddit bloquean a los programas y Bing les devuelve basura a propósito.)
    id: 'wikipedia', limite: Number(process.env.WIKIPEDIA_CUOTA ?? 5000), disponible: () => true,
    async buscar(q, n) {
      const r = await pedir(`https://es.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${n}&srsearch=${encodeURIComponent(q)}`, { headers: { 'user-agent': 'Deprocast/1.0 (asistente personal)' } })
      if (!r.ok) throw new Error(`Wikipedia ${r.status}`)
      const j: any = await r.json()
      return (j.query?.search ?? []).map((x: any) => ({ titulo: x.title, url: `https://es.wikipedia.org/wiki/${encodeURIComponent(String(x.title).replace(/ /g, '_'))}`, extracto: sinTags(x.snippet ?? ''), proveedor: 'wikipedia' }))
    },
  },
]

const mes = (ahora: number) => new Date(ahora).toISOString().slice(0, 7)

function usadas(db: Db, proveedor: string, ahora: number): number {
  return (db.prepare('SELECT usadas FROM cuotas WHERE proveedor = ? AND mes = ?').get(proveedor, mes(ahora)) as { usadas: number } | undefined)?.usadas ?? 0
}

function contar(db: Db, proveedor: string, ahora: number) {
  db.prepare('INSERT INTO cuotas (proveedor, mes, usadas) VALUES (?, ?, 1) ON CONFLICT(proveedor, mes) DO UPDATE SET usadas = usadas + 1').run(proveedor, mes(ahora))
}

/** Cuánto queda de cada buscador este mes. */
export function cuotas(db: Db, ahora = Date.now()) {
  return PROVEEDORES.map((p) => ({ id: p.id, disponible: p.disponible(), usadas: usadas(db, p.id, ahora), limite: p.limite }))
}

/** ¿Hay un buscador de verdad (con clave)? Sin eso, solo Wikipedia. */
export const hayBuscadorWeb = () => !!(process.env.TAVILY_API_KEY || process.env.BRAVE_API_KEY)

/** Busca en la web: el primer buscador con clave y cuota; si falla, el siguiente. */
export async function buscarWeb(db: Db, consulta: string, o: { n?: number; ahora?: number } = {}): Promise<Resultado[]> {
  const ahora = o.ahora ?? Date.now()
  const errores: string[] = []
  for (const p of PROVEEDORES) {
    if (!p.disponible() || usadas(db, p.id, ahora) >= p.limite) continue
    try {
      contar(db, p.id, ahora)
      const rs = await p.buscar(consulta, o.n ?? 8)
      if (rs.length) return rs
    } catch (e) {
      errores.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (errores.length) throw new Error(`No pude buscar en la web: ${errores.join(' · ')}`)
  return []
}

/** Lee una página: su título y el texto, recortado. */
export async function leerPagina(url: string, max = 6000): Promise<{ titulo: string; texto: string } | null> {
  try {
    const r = await pedir(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' } })
    if (!r.ok || !/html|text/.test(r.headers.get('content-type') ?? '')) return null
    const { titulo, texto } = htmlATexto(await r.text())
    return { titulo, texto: texto.slice(0, max) }
  } catch {
    return null
  }
}
