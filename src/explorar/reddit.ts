/**
 * Reddit sin cuenta (plan v31). Desde 2024 Reddit le niega su .json a quien no está logueado (403), pero sus feeds RSS
 * (Atom) siguen abiertos, con poca cuota: un pedido cada pocos segundos y caché. Por eso:
 * - buscar: Exa (trae el cuerpo del post) → el RSS de búsqueda → los buscadores con site:reddit.com;
 * - leer un hilo: su RSS (el post y sus comentarios) → Exa → Jina;
 * - listar un subreddit: su RSS (hot, top o new).
 */
import type { Canal } from './index.ts'
import { ErrorExplorar, type Ctx, type Item, type Leido } from './tipos.ts'
import { buscadorEnSitio, desentidad, exaEnSitio, exaLeer, jinaLeer, sinTags } from './comun.ts'
import { turno, UA_PROPIO } from './red.ts'

const HOSTS = /(^|\.)(reddit\.com|redd\.it)$/i
const ESPERA_MS = 3_000

export type Entrada = { titulo: string; url: string; autor: string; fecha: string; html: string }

/** Las entradas de un feed Atom de Reddit. */
export function entradasAtom(xml: string): Entrada[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    titulo: desentidad(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? '').trim(),
    url: /<link href="([^"]+)"/.exec(e)?.[1] ?? '',
    autor: (/<author>\s*<name>([^<]+)<\/name>/.exec(e)?.[1] ?? '').replace(/^\/u\//, 'u/'),
    fecha: /<(?:published|updated)>([^<]+)</.exec(e)?.[1] ?? '',
    html: desentidad(/<content type="html">([\s\S]*?)<\/content>/.exec(e)?.[1] ?? ''),
  })).filter((x) => x.url)
}

async function rss(ctx: Ctx, url: string): Promise<Entrada[]> {
  await turno('reddit.com', ESPERA_MS)
  let r: Response
  try { r = await ctx.pedir(url, { headers: { 'user-agent': UA_PROPIO, accept: 'application/atom+xml' } }) } catch (e) { throw new ErrorExplorar('ROTO', e instanceof Error ? e.message : String(e)) }
  if (r.status === 429) throw new ErrorExplorar('LIMITE', 'Reddit pide esperar (RSS)')
  if (r.status === 403) throw new ErrorExplorar('BLOQUEADO', 'Reddit no deja leer el RSS desde acá')
  if (r.status === 404) throw new ErrorExplorar('NO_ENCONTRADO', 'Eso no existe en Reddit')
  if (!r.ok) throw new ErrorExplorar('ROTO', `Reddit respondió ${r.status}`)
  return entradasAtom(await r.text())
}

/** El texto de una entrada sin la firma «submitted by … [link] [comments]». */
const cuerpo = (html: string) => sinTags(html).replace(/\s*submitted by\s+\/u\/\S+.*$/s, '').replace(/\[link\]\s*\[comments\]\s*$/, '').trim()
const subDe = (url: string) => /reddit\.com\/r\/([^/]+)/i.exec(url)?.[1]

const item = (e: Entrada): Item => ({ titulo: e.titulo, url: e.url, autor: e.autor || undefined, fecha: e.fecha || undefined, texto: cuerpo(e.html).slice(0, 800) || undefined, datos: { subreddit: subDe(e.url) } })

async function leerHilo({ url }: { url: string }, ctx: Ctx): Promise<Leido> {
  if (!/\/comments\/[a-z0-9]+/i.test(url)) throw new ErrorExplorar('ROTO', 'No es un hilo: lo lee la web')
  const base = url.split(/[?#]/)[0].replace(/\/$/, '')
  const [post, ...comentarios] = await rss(ctx, `${base}/.rss?limit=25`)
  if (!post) throw new ErrorExplorar('NO_ENCONTRADO', 'Ese hilo no existe o está vacío')
  const md = [
    `# ${post.titulo}`, `r/${subDe(post.url) ?? '?'} · ${post.autor}${post.fecha ? ` · ${post.fecha.slice(0, 10)}` : ''}`,
    cuerpo(post.html),
    comentarios.length ? `## Comentarios\n\n${comentarios.map((c) => `- **${c.autor}**: ${cuerpo(c.html).replace(/\n+/g, ' ').slice(0, 600)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
  return { url, titulo: post.titulo, markdown: md, autor: post.autor, fecha: post.fecha }
}

export function canalReddit(): Canal {
  return {
    id: 'reddit', nombre: 'Reddit', hosts: /^https?:\/\/([\w-]+\.)?(reddit\.com|redd\.it)\//i,
    puede: 'Buscar posts (con su texto), leer un hilo con sus comentarios y listar lo de un subreddit (hot, top o new).',
    noPuede: 'los votos exactos y los comentarios anidados: Reddit cerró su API a quien no tiene cuenta, se lee por sus feeds',
    buscar: [
      exaEnSitio('reddit.com', HOSTS),
      { id: 'rss', nombre: 'RSS de Reddit', correr: async ({ consulta, n }, ctx) => (await rss(ctx, `https://www.reddit.com/search.rss?q=${encodeURIComponent(consulta)}&sort=relevance&limit=${n}`)).map(item) },
      buscadorEnSitio('reddit.com', HOSTS),
    ],
    leer: [{ id: 'rss', nombre: 'RSS de Reddit', correr: leerHilo }, exaLeer, jinaLeer],
    listar: {
      subreddit: {
        nombre: 'Un subreddit', ayuda: 'el nombre (sin r/), y si querés el orden: «typescript», «typescript/top», «typescript/new»',
        backends: [{
          id: 'rss', nombre: 'RSS de Reddit',
          correr: async ({ id, n }, ctx) => {
            const [sub, orden = 'hot'] = id.replace(/^\/?r\//i, '').split('/')
            if (!/^\w{2,30}$/.test(sub) || !['hot', 'top', 'new', 'rising'].includes(orden)) throw new ErrorExplorar('ENTRADA_MALA', 'Un subreddit: «nombre» o «nombre/top»')
            return (await rss(ctx, `https://www.reddit.com/r/${sub}/${orden}.rss?limit=${n}${orden === 'top' ? '&t=week' : ''}`)).map(item)
          },
        }],
      },
    },
  }
}
