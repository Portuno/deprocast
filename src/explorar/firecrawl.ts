/**
 * Firecrawl (plan v32), en su plan gratis: 1.000 créditos por mes, sin tarjeta. Buscar y leer andan SIN clave (con menos
 * cupo); con FIRECRAWL_API_KEY en .env, más cupo y Alexandria.
 * - buscar: su buscador (resultados tipo Google), y con `dominios` solo adentro de esos sitios: trae tweets y perfiles
 *   reales de x.com, que Exa no indexa. 2 créditos cada 10 resultados.
 * - leer: su scrape (páginas que se arman con JavaScript, en Markdown). 1 crédito por página. Instagram no lo soporta.
 * - Alexandria (solo con clave): un catálogo de 430 proveedores de datos (registros públicos, empresas, podcasts,
 *   papers…). Descubrir herramientas es gratis; usarlas cuesta lo que diga cada una.
 * Los créditos se cuentan en la tabla `cuotas` (firecrawl = búsquedas, firecrawl_lectura = páginas) para no pasarse del
 * plan gratis: FIRECRAWL_CUOTA y FIRECRAWL_LECTURAS los ajustan.
 */
import type { Db } from '../db.ts'
import { ErrorExplorar, type Item } from './tipos.ts'

type Pedir = (url: string, init?: RequestInit) => Promise<Response>
const API = 'https://api.firecrawl.dev/v2'
export const clave = () => process.env.FIRECRAWL_API_KEY?.trim() || null
/** Búsquedas y páginas por mes (de a 10 resultados: 300 × 2 + 400 × 1 = 1.000 créditos, el plan gratis). */
export const CUPO = { busquedas: () => Number(process.env.FIRECRAWL_CUOTA ?? 300), lecturas: () => Number(process.env.FIRECRAWL_LECTURAS ?? 400) }

const mes = (ahora: number) => new Date(ahora).toISOString().slice(0, 7)
const usadas = (db: Db, k: string, ahora: number) => (db.prepare('SELECT usadas FROM cuotas WHERE proveedor = ? AND mes = ?').get(k, mes(ahora)) as { usadas: number } | undefined)?.usadas ?? 0
const contar = (db: Db, k: string, ahora: number) => db.prepare('INSERT INTO cuotas (proveedor, mes, usadas) VALUES (?, ?, 1) ON CONFLICT(proveedor, mes) DO UPDATE SET usadas = usadas + 1').run(k, mes(ahora))

/** Cuánto queda este mes. */
export function cupoFirecrawl(db: Db, ahora = Date.now()) {
  return { busquedas: usadas(db, 'firecrawl', ahora), limiteBusquedas: CUPO.busquedas(), lecturas: usadas(db, 'firecrawl_lectura', ahora), limiteLecturas: CUPO.lecturas(), conClave: !!clave() }
}

async function llamar(pedir: Pedir, ruta: string, cuerpo: unknown, timeoutMs = 60_000): Promise<any> {
  const k = clave()
  let r: Response
  try {
    r = await pedir(`${API}${ruta}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(k ? { authorization: `Bearer ${k}` } : {}) }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) { throw new ErrorExplorar('ROTO', `Firecrawl no respondió: ${e instanceof Error ? e.message : e}`) }
  const j: any = await r.json().catch(() => ({}))
  if (r.status === 429) throw new ErrorExplorar('LIMITE', 'Firecrawl: demasiados pedidos por ahora')
  if (r.status === 402) throw new ErrorExplorar('LIMITE', 'Firecrawl: se terminaron los créditos del mes')
  if (r.status === 401) throw new ErrorExplorar('BLOQUEADO', `Firecrawl: ${j.error ?? 'pide una clave (FIRECRAWL_API_KEY)'}`)
  if (!r.ok || j.success === false) {
    const msg = String(j.error ?? `respondió ${r.status}`)
    throw new ErrorExplorar(/do not support this site|not enabled|terms/i.test(msg) ? 'BLOQUEADO' : 'ROTO', `Firecrawl: ${msg.slice(0, 200)}`)
  }
  return j.data ?? {}
}

/** La búsqueda cruda (sin contar el cupo: buscarWeb lo cuenta en su tabla con la misma clave). */
export async function buscarFirecrawlCrudo(pedir: Pedir, consulta: string, n: number, dominios?: string[]): Promise<Item[]> {
  const d = await llamar(pedir, '/search', { query: consulta, limit: Math.min(Math.max(n, 1), 10), ...(dominios?.length ? { includeDomains: dominios } : {}) })
  return (d.web ?? []).filter((x: any) => x?.url).map((x: any) => ({ titulo: x.title || x.url, url: x.url, texto: x.description || undefined, datos: { proveedor: 'firecrawl' } }))
}

/** Buscar (con `dominios`, solo adentro de esos sitios), contando el cupo del mes. */
export async function buscarFirecrawl(db: Db, pedir: Pedir, consulta: string, n: number, o: { dominios?: string[]; ahora?: number } = {}): Promise<Item[]> {
  const ahora = o.ahora ?? Date.now()
  if (usadas(db, 'firecrawl', ahora) >= CUPO.busquedas()) throw new ErrorExplorar('LIMITE', 'Firecrawl: se usó el cupo de búsquedas del mes')
  contar(db, 'firecrawl', ahora)
  return buscarFirecrawlCrudo(pedir, consulta, n, o.dominios)
}

/** Leer una página en Markdown (lo principal, sin menús). */
export async function leerFirecrawl(db: Db, pedir: Pedir, url: string, ahora = Date.now()): Promise<{ titulo: string; markdown: string }> {
  if (usadas(db, 'firecrawl_lectura', ahora) >= CUPO.lecturas()) throw new ErrorExplorar('LIMITE', 'Firecrawl: se usó el cupo de lecturas del mes')
  contar(db, 'firecrawl_lectura', ahora)
  const d = await llamar(pedir, '/scrape', { url, formats: ['markdown'], onlyMainContent: true }, 90_000)
  const md = String(d.markdown ?? '').trim()
  if (md.split(/\s+/).length < 15) throw new ErrorExplorar('ROTO', 'Firecrawl trajo la página casi vacía')
  return { titulo: d.metadata?.title || /^#\s+(.+)$/m.exec(md)?.[1] || url, markdown: md }
}

export type Herramienta = { proveedor: string; capacidad: string; nombre: string; descripcion: string; precio: string | null; entradas: unknown }

/** Alexandria: las herramientas (proveedor + capacidad) que sirven para una consulta. Gratis, pero pide clave. */
export async function herramientasAlexandria(pedir: Pedir, consulta: string, n = 8): Promise<Herramienta[]> {
  if (!clave()) throw new ErrorExplorar('NO_SE_PUEDE', 'Alexandria pide la clave gratis de Firecrawl (FIRECRAWL_API_KEY en .env)')
  const d = await llamar(pedir, '/search', { query: consulta, sources: ['alexandria'], limit: Math.min(n, 10), toolDetail: 'full' })
  return (d.tools ?? []).map((t: any) => ({
    proveedor: String(t.provider ?? t.providerId ?? ''), capacidad: String(t.capability ?? t.path ?? ''), nombre: String(t.name ?? t.title ?? `${t.provider} · ${t.capability}`),
    descripcion: String(t.description ?? '').slice(0, 600), precio: t.creditsCost != null ? `${t.creditsCost} créditos${t.perRecord ? ' por resultado' : ''}` : t.price != null ? String(t.price) : null, entradas: t.inputs ?? t.options ?? t.parameters ?? null,
  })).filter((t: Herramienta) => t.proveedor && t.capacidad)
}

/** Alexandria: correr una herramienta. Cuesta lo que diga la herramienta (creditsCost vuelve con la respuesta). */
export async function usarAlexandria(pedir: Pedir, proveedor: string, capacidad: string, opciones: Record<string, unknown>): Promise<{ datos: unknown; creditos: number | null }> {
  if (!clave()) throw new ErrorExplorar('NO_SE_PUEDE', 'Alexandria pide la clave gratis de Firecrawl (FIRECRAWL_API_KEY en .env)')
  const d = await llamar(pedir, '/scrape', { alexandria: { provider: proveedor, capability: capacidad, options: opciones ?? {} } }, 90_000)
  const item = Array.isArray(d.alexandria) ? d.alexandria[0] : null
  if (item?.error) throw new ErrorExplorar('ROTO', `Alexandria: ${String(item.error.message ?? item.error).slice(0, 200)}`)
  return { datos: item?.data ?? d, creditos: d.creditsCost ?? null }
}
