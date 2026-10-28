/** Piezas comunes de los canales de plataformas (plan v31): buscar «adentro de un sitio» con Exa o con los buscadores. */
import { ErrorExplorar, type Backend, type Ctx, type Item, type Leido } from './tipos.ts'
import { buscarExa, leerExa, leerJina, vistaPrevia } from './web.ts'

export const desentidad = (s: string) => s.replace(/&#x?([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, /x/i.test(m) ? 16 : 10)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
export const sinTags = (s: string) => desentidad(s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

/** Solo los resultados que de verdad son del sitio (un buscador puede colar otros). */
const delSitio = (items: Item[], hosts: RegExp) => items.filter((x) => { try { return hosts.test(new URL(x.url).hostname) } catch { return false } })

/** Exa buscando adentro de un sitio («site:» lo entiende). */
export function exaEnSitio(sitio: string, hosts: RegExp, extra = ''): Backend<{ consulta: string; n: number }, Item[]> {
  return {
    id: 'exa', nombre: 'Exa',
    correr: async ({ consulta, n }, ctx) => delSitio(await buscarExa(ctx.pedir, `${extra}${consulta} site:${sitio}`.trim(), Math.min(n + 3, 20)), hosts),
  }
}

/** Los buscadores de siempre (Brave, Tavily, Exa, Wikipedia) con «site:». */
export function buscadorEnSitio(sitio: string, hosts: RegExp): Backend<{ consulta: string; n: number }, Item[]> {
  return {
    id: 'buscador', nombre: 'buscadores',
    correr: async ({ consulta, n }, ctx) => {
      const { buscarWeb } = await import('../web.ts')
      return delSitio((await buscarWeb(ctx.db, `site:${sitio} ${consulta}`, { n: Math.min(n + 3, 10), ahora: ctx.ahora })).map((r) => ({ titulo: r.titulo, url: r.url, texto: r.extracto, datos: { proveedor: r.proveedor } })), hosts)
    },
  }
}

/** Leer con Exa (trae el texto de páginas que sin cuenta no se ven enteras, cuando lo tiene indexado). */
export const exaLeer: Backend<{ url: string }, Leido> = { id: 'exa', nombre: 'Exa', correr: async ({ url }, ctx) => ({ url, ...(await leerExa(ctx.pedir, url)) }) }

const palabras = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length

/** El lector propio (src/lector): si trae poco (una página de JavaScript), es ROTO y prueba el siguiente. */
export async function leerConLector(url: string): Promise<Leido> {
  const { leer } = await import('../lector/index.ts')
  const l = await leer(url)
  if (l.fuente === 'error' && /respondió (404|410)/.test(l.aviso ?? '')) throw new ErrorExplorar('NO_ENCONTRADO', 'La página no existe')
  if (l.fuente === 'error' && /respondió (401|403|429)/.test(l.aviso ?? '')) throw new ErrorExplorar(/429/.test(l.aviso!) ? 'LIMITE' : 'BLOQUEADO', l.aviso!)
  if (!l.markdown || palabras(l.markdown) < 40) throw new ErrorExplorar('ROTO', l.aviso ?? 'La página vino casi vacía')
  return { url: l.url, titulo: l.titulo, markdown: l.markdown, autor: l.meta.autor ? String(l.meta.autor) : undefined, fecha: l.meta.fecha ? String(l.meta.fecha) : undefined, ...(l.aviso ? { aviso: l.aviso } : {}) }
}
export const lector: Backend<{ url: string }, Leido> = { id: 'lector', nombre: 'el lector propio', correr: ({ url }) => leerConLector(url) }

/** Leer con Jina Reader (páginas que se arman con JavaScript). */
export const jinaLeer: Backend<{ url: string }, Leido> = { id: 'jina', nombre: 'Jina Reader', correr: async ({ url }, ctx) => ({ url, ...(await leerJina(ctx.pedir, url)) }) }

/** La vista previa pública de un link (lo que muestra cualquier chat al pegarlo), con un aviso de qué no se ve sin cuenta. */
export function vistaPreviaDe(aviso: string): Backend<{ url: string }, Leido> {
  return {
    id: 'vista', nombre: 'vista previa pública',
    correr: async ({ url }, ctx: Ctx) => {
      let r: Response
      try { r = await ctx.pedir(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Deprocast/1.0; vista previa de links)' } }) } catch (e) { throw new ErrorExplorar('ROTO', e instanceof Error ? e.message : String(e)) }
      if (r.status === 404) throw new ErrorExplorar('NO_ENCONTRADO', 'No existe')
      if (r.status === 429) throw new ErrorExplorar('LIMITE', 'Demasiados pedidos por ahora')
      const v = vistaPrevia(await r.text().catch(() => ''))
      if (!v.titulo && !v.descripcion) throw new ErrorExplorar('BLOQUEADO', 'Sin cuenta no muestra ni la vista previa')
      return { url, titulo: v.titulo ?? url, markdown: [`# ${v.titulo ?? url}`, v.descripcion ?? '', v.imagen ? `![](${v.imagen})` : ''].filter(Boolean).join('\n\n'), aviso }
    },
  }
}
