/**
 * Las redes que sin cuenta muestran poco (plan v31): X, LinkedIn, Instagram y Facebook. Solo lo público, nunca con una
 * sesión ni un navegador disfrazado.
 * - buscar: Exa adentro del sitio (site:) → los buscadores con site:. Exa entiende «category:people» y
 *   «category:company» (perfiles y empresas de LinkedIn).
 * - leer: X → el tweet por oEmbed (su API pública de inserción); LinkedIn → Exa o Jina (artículos, empresas, empleos);
 *   Instagram y Facebook → Exa y la vista previa pública (lo que muestra cualquier chat al pegar el link).
 * Cada canal dice qué no se ve sin cuenta.
 */
import type { Canal } from './index.ts'
import { ErrorExplorar, type Ctx, type Leido } from './tipos.ts'
import { buscadorEnSitio, exaEnSitio, exaLeer, jinaLeer, sinTags, vistaPreviaDe } from './comun.ts'

async function tweet({ url }: { url: string }, ctx: Ctx): Promise<Leido> {
  if (!/\/status\/\d+/.test(url)) throw new ErrorExplorar('ROTO', 'No es un tweet: un perfil o una búsqueda no se leen sin cuenta')
  let r: Response
  try { r = await ctx.pedir(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1&dnt=true`) } catch (e) { throw new ErrorExplorar('ROTO', e instanceof Error ? e.message : String(e)) }
  if (r.status === 404) throw new ErrorExplorar('NO_ENCONTRADO', 'Ese tweet no existe o lo borraron')
  if (r.status === 403) throw new ErrorExplorar('NO_SE_PUEDE', 'Es de una cuenta protegida')
  if (!r.ok) throw new ErrorExplorar('ROTO', `X respondió ${r.status}`)
  const j: any = await r.json()
  const cuerpo = sinTags(String(j.html ?? '').replace(/<\/?blockquote[^>]*>/g, '')).replace(/pic\.twitter\.com\/\S+/g, '').trim()
  return { url, titulo: `${j.author_name ?? 'X'}: ${cuerpo.slice(0, 80)}`, markdown: `# ${j.author_name ?? 'X'}\n\n${cuerpo}\n\n${j.author_url ?? ''}`.trim(), autor: j.author_name }
}

export function canalesRedes(): Canal[] {
  const X = /(^|\.)(x\.com|twitter\.com)$/i
  const LI = /(^|\.)linkedin\.com$/i
  const IG = /(^|\.)instagram\.com$/i
  const FB = /(^|\.)(facebook\.com|fb\.com|fb\.watch)$/i
  return [
    {
      id: 'x', nombre: 'Twitter / X', hosts: /^https?:\/\/(www\.|mobile\.)?(x\.com|twitter\.com)\//i,
      puede: 'Buscar tweets y perfiles (a través de buscadores) y leer un tweet suelto con su texto.',
      noPuede: 'perfiles, hilos completos y respuestas: X los cerró a quien no tiene cuenta (y su API es paga)',
      buscar: [
        {
          // Exa no indexa x.com, pero sí los hilos públicos que alguien desplegó en Thread Reader App: de ahí sale el
          // tweet original (x.com/i/status/<id>).
          id: 'exa', nombre: 'Exa (hilos públicos)',
          correr: async ({ consulta, n }, ctx) => {
            const { buscarExa } = await import('./web.ts')
            const items = await buscarExa(ctx.pedir, `${consulta} twitter thread`, 20)
            return items.flatMap((x) => {
              const h = (() => { try { return new URL(x.url).hostname } catch { return '' } })()
              const hilo = /threadreaderapp\.com\/thread\/(\d+)/.exec(x.url)?.[1]
              if (hilo) return [{ ...x, url: `https://x.com/i/status/${hilo}`, datos: { hilo: x.url } }]
              return X.test(h) ? [x] : []
            })
          },
        },
        buscadorEnSitio('x.com', X),
      ],
      leer: [{ id: 'oembed', nombre: 'oEmbed de X', correr: tweet }, exaLeer],
    },
    {
      id: 'linkedin', nombre: 'LinkedIn', hosts: /^https?:\/\/([\w-]+\.)?linkedin\.com\//i,
      puede: 'Buscar perfiles, empresas, posts, artículos y empleos (con «personas:» o «empresas:» adelante, busca solo eso) y leer artículos, empresas y avisos públicos.',
      noPuede: 'el feed, los comentarios y los perfiles completos: LinkedIn pide cuenta (y prohíbe automatizarla)',
      buscar: [
        {
          id: 'exa', nombre: 'Exa',
          correr: async (a, ctx) => {
            const cat = /^personas?:\s*/i.test(a.consulta) ? 'category:people ' : /^empresas?:\s*/i.test(a.consulta) ? 'category:company ' : ''
            return exaEnSitio('linkedin.com', LI, cat).correr({ ...a, consulta: a.consulta.replace(/^(personas?|empresas?):\s*/i, '') }, ctx)
          },
        },
        buscadorEnSitio('linkedin.com', LI),
      ],
      leer: [exaLeer, jinaLeer, vistaPreviaDe('Sin cuenta, LinkedIn muestra solo la vista previa.')],
    },
    {
      id: 'instagram', nombre: 'Instagram', hosts: /^https?:\/\/(www\.)?instagram\.com\//i,
      puede: 'Buscar perfiles y posts públicos (a través de buscadores) y ver la vista previa de un perfil o un post (nombre, seguidores, texto del post).',
      noPuede: 'los posts de un perfil, los comentarios y las historias: Instagram pide cuenta',
      buscar: [exaEnSitio('instagram.com', IG), buscadorEnSitio('instagram.com', IG)],
      leer: [vistaPreviaDe('Sin cuenta, Instagram muestra solo la vista previa (nombre, seguidores, el texto del post).'), exaLeer],
    },
    {
      id: 'facebook', nombre: 'Facebook', hosts: /^https?:\/\/([\w-]+\.)?(facebook\.com|fb\.com|fb\.watch)\//i,
      puede: 'Buscar páginas, grupos y posts públicos (a través de buscadores) y ver la vista previa de una página o un post.',
      noPuede: 'los posts de una página, los comentarios y los grupos: Facebook pide cuenta',
      buscar: [exaEnSitio('facebook.com', FB), buscadorEnSitio('facebook.com', FB)],
      leer: [vistaPreviaDe('Sin cuenta, Facebook muestra solo la vista previa.'), exaLeer],
    },
  ]
}
