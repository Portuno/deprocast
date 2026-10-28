/**
 * La web abierta para explorar (plan v31, lo mejor de Agent Reach):
 * - Exa, por su MCP público y sin clave (mcp.exa.ai): buscar (web_search_exa) y leer (web_fetch_exa). Trae el texto
 *   de lo que encuentra (un post de Reddit con su cuerpo, un perfil de empresa de LinkedIn) y entiende
 *   «category:people» y «category:company» (perfiles y empresas de LinkedIn).
 * - Jina Reader (r.jina.ai): una página en Markdown aunque se arme con JavaScript. Detecta cuando lo bloquean.
 * Cada falla vuelve como ErrorExplorar con su código, para que la cadena pase al siguiente.
 */
import { ErrorExplorar, type Item } from './tipos.ts'

export type Pedir = (url: string, init?: RequestInit) => Promise<Response>
const EXA_MCP = 'https://mcp.exa.ai/mcp'

/** Una llamada al MCP de Exa. La respuesta puede venir como SSE (líneas «data:»): vale la última. */
export async function exa(pedir: Pedir, herramienta: 'web_search_exa' | 'web_fetch_exa', args: Record<string, unknown>): Promise<string> {
  let r: Response
  try {
    r = await pedir(EXA_MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: herramienta, arguments: args } }) })
  } catch (e) { throw new ErrorExplorar('ROTO', `Exa no respondió: ${e instanceof Error ? e.message : e}`) }
  if (r.status === 429) throw new ErrorExplorar('LIMITE', 'Exa: demasiados pedidos por ahora')
  if (!r.ok) throw new ErrorExplorar('ROTO', `Exa respondió ${r.status}`)
  const crudo = await r.text()
  const datos = crudo.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean)
  let j: any
  try { j = JSON.parse(datos.at(-1) ?? crudo) } catch { throw new ErrorExplorar('ROTO', 'Exa devolvió algo que no se entiende') }
  if (j.error) throw new ErrorExplorar(/limit|rate/i.test(j.error.message ?? '') ? 'LIMITE' : j.error.code === -32602 ? 'ENTRADA_MALA' : 'ROTO', `Exa: ${j.error.message ?? 'error'}`)
  const texto = (j.result?.content ?? []).map((c: any) => c?.text ?? '').join('\n').trim()
  if (j.result?.isError) throw new ErrorExplorar(/limit|rate/i.test(texto) ? 'LIMITE' : 'ROTO', `Exa: ${texto.slice(0, 200)}`)
  return texto
}

/** Los resultados de web_search_exa: bloques «Title: / URL: / Published: / Author: / Highlights:». */
export function parsearExa(texto: string): Item[] {
  return texto.split(/\n(?=Title: )/).map((b) => {
    const campo = (k: string) => new RegExp(`^${k}: (.*)$`, 'm').exec(b)?.[1]?.trim()
    const url = campo('URL')
    if (!url) return null
    const cuerpo = b.split(/^Highlights:\s*$/m)[1] ?? b.split(/^Text:\s*/m)[1] ?? ''
    return { titulo: campo('Title') || url, url, autor: campo('Author') || undefined, fecha: campo('Published') || undefined, texto: cuerpo.replace(/\n---\s*$/, '').trim().slice(0, 1500) || undefined }
  }).filter((x): x is NonNullable<typeof x> => !!x)
}

export async function buscarExa(pedir: Pedir, consulta: string, n: number): Promise<Item[]> {
  const items = parsearExa(await exa(pedir, 'web_search_exa', { query: consulta, objective: consulta, numResults: Math.min(Math.max(n, 1), 20) }))
  if (!items.length) throw new ErrorExplorar('ROTO', 'Exa no trajo resultados que se puedan leer')
  return items
}

/** Una página por Exa (web_fetch_exa): «# Título\nURL: …\n\n<texto>». */
export async function leerExa(pedir: Pedir, url: string, max = 20_000): Promise<{ titulo: string; markdown: string }> {
  const t = await exa(pedir, 'web_fetch_exa', { urls: [url], maxCharacters: max })
  if (!t || t.length < 40) throw new ErrorExplorar('ROTO', 'Exa no pudo leer esa página')
  const titulo = /^#\s+(.+)$/m.exec(t)?.[1]?.trim() ?? url
  return { titulo, markdown: t.replace(/^URL: .*\n?/m, '').trim() }
}

const ANTIBOT = /AbuseAlleviationError|Anonymous access to domain|cf-chl|challenge-platform|Just a moment\.\.\.|captcha|Attention Required!|Access denied/i

/** Una página por Jina Reader. Si el sitio (o Jina) bloquea, es BLOQUEADO; si es mucho pedir, LIMITE. */
export async function leerJina(pedir: Pedir, url: string): Promise<{ titulo: string; markdown: string; fecha?: string }> {
  let r: Response
  try { r = await pedir(`https://r.jina.ai/${url}`, { headers: { accept: 'text/plain', 'x-no-cache': 'false' } }) } catch (e) { throw new ErrorExplorar('ROTO', `Jina no respondió: ${e instanceof Error ? e.message : e}`) }
  const t = await r.text().catch(() => '')
  if (r.status === 429) throw new ErrorExplorar('LIMITE', 'Jina: demasiados pedidos por ahora')
  if (ANTIBOT.test(t.slice(0, 4000))) throw new ErrorExplorar('BLOQUEADO', `Ese sitio no deja leer a Jina${/blocked until ([^(]+)/.exec(t)?.[1] ? ` (hasta ${/blocked until ([^(]+)/.exec(t)![1].trim()})` : ''}`)
  if (r.status === 404 || r.status === 410) throw new ErrorExplorar('NO_ENCONTRADO', 'La página no existe')
  if (!r.ok) throw new ErrorExplorar('ROTO', `Jina respondió ${r.status}`)
  const md = t.split(/^Markdown Content:\s*$/m)[1]?.trim() ?? ''
  if (md.split(/\s+/).length < 15) throw new ErrorExplorar('ROTO', 'Jina trajo la página casi vacía')
  return { titulo: /^Title: (.*)$/m.exec(t)?.[1]?.trim() || url, markdown: md, fecha: /^Published Time: (.*)$/m.exec(t)?.[1]?.trim() }
}

/** La vista previa pública de un link (lo que muestra cualquier chat al pegarlo): etiquetas og y title. */
export function vistaPrevia(html: string): { titulo: string | null; descripcion: string | null; imagen: string | null; tipo: string | null } {
  const og = (k: string) => {
    const m = new RegExp(`<meta[^>]+(?:property|name)=["'](?:og:|twitter:)?${k}["'][^>]*>`, 'i').exec(html)?.[0]
    const v = m ? /content=["']([^"']*)["']/i.exec(m)?.[1] ?? null : null
    return v ? v.replace(/&#x?([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, /x/i.test(_) ? 16 : 10))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim() : null
  }
  return { titulo: og('title') ?? /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null, descripcion: og('description'), imagen: og('image'), tipo: og('type') }
}
