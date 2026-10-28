/**
 * YouTube sin cuenta (plan v31).
 * - buscar: la búsqueda de YouTube (InnerTube, la misma API que usa su página) → los buscadores con site:youtube.com;
 * - leer un video: título, canal, descripción y transcripción (src/lector/youtube.ts, leerVideo);
 * - listar los videos de un canal (videosDelCanal).
 * YouTube suele bloquear a la nube: ahí la búsqueda cae a los buscadores y la lectura avisa (la cola de YouTube la
 * completa desde la compu).
 */
import type { Canal } from './index.ts'
import { ErrorExplorar, type Ctx, type Item, type Leido } from './tipos.ts'
import { buscadorEnSitio } from './comun.ts'

const HOSTS = /(^|\.)(youtube\.com|youtu\.be)$/i
const texto = (x: any): string => x?.simpleText ?? (x?.runs ?? []).map((r: any) => r.text).join('') ?? ''

/** Todos los videoRenderer de una respuesta de búsqueda (vienen anidados a distintas profundidades). */
export function videosDeBusqueda(j: any): Item[] {
  const out: Item[] = []
  const ver = (o: any) => {
    if (!o || typeof o !== 'object') return
    if (o.videoRenderer?.videoId) {
      const v = o.videoRenderer
      out.push({
        titulo: texto(v.title), url: `https://www.youtube.com/watch?v=${v.videoId}`, autor: texto(v.ownerText) || undefined,
        texto: [texto(v.detailedMetadataSnippets?.[0]?.snippetText), texto(v.descriptionSnippet)].filter(Boolean)[0] || undefined,
        datos: { vistas: texto(v.viewCountText) || undefined, duracion: texto(v.lengthText) || undefined, publicado: texto(v.publishedTimeText) || undefined },
      })
      return
    }
    for (const k of Object.keys(o)) ver(o[k])
  }
  ver(j)
  return out
}

async function buscarInnertube({ consulta, n }: { consulta: string; n: number }, ctx: Ctx): Promise<Item[]> {
  let r: Response
  try {
    r = await ctx.pedir('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'es' } }, query: consulta }),
    })
  } catch (e) { throw new ErrorExplorar('ROTO', e instanceof Error ? e.message : String(e)) }
  if (r.status === 429) throw new ErrorExplorar('LIMITE', 'YouTube pide esperar')
  if (r.status === 403) throw new ErrorExplorar('BLOQUEADO', 'YouTube no deja buscar desde acá')
  if (!r.ok) throw new ErrorExplorar('ROTO', `YouTube respondió ${r.status}`)
  return videosDeBusqueda(await r.json()).slice(0, n)
}

async function leerVideoYt({ url }: { url: string }, ctx: Ctx): Promise<Leido> {
  const { clasificarYoutube, leerVideo } = await import('../lector/youtube.ts')
  if (clasificarYoutube(url)?.tipo !== 'video') throw new ErrorExplorar('ROTO', 'No es un video: lo lee la web')
  const v = await leerVideo(url, ctx.pedir).catch(() => null)
  if (!v || (!v.titulo && !v.transcripcion)) throw new ErrorExplorar('BLOQUEADO', v?.motivo ?? 'YouTube no deja leer el video desde acá')
  const md = [
    `# ${v.titulo ?? url}`, `Canal: ${v.canal ?? '?'}${v.fecha ? ` · ${v.fecha}` : ''}`,
    v.descripcion ? `## Descripción\n\n${v.descripcion}` : '',
    v.transcripcion ? `## Transcripción${v.automatica ? ' (subtítulos automáticos)' : ''}${v.idioma ? ` · ${v.idioma}` : ''}\n\n${v.transcripcion}` : '',
  ].filter(Boolean).join('\n\n')
  return { url, titulo: v.titulo ?? url, markdown: md, autor: v.canal ?? undefined, fecha: v.fecha ?? undefined, ...(v.transcripcion ? {} : { aviso: `Sin transcripción (${v.motivo ?? 'el video no tiene subtítulos'}).` }) }
}

export function canalYoutube(): Canal {
  return {
    id: 'youtube', nombre: 'YouTube', hosts: /^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be)\//i,
    puede: 'Buscar videos (con vistas, duración y canal), leer un video con su descripción y su transcripción, y listar los videos de un canal.',
    buscar: [{ id: 'innertube', nombre: 'búsqueda de YouTube', correr: buscarInnertube }, buscadorEnSitio('youtube.com', HOSTS)],
    leer: [{ id: 'video', nombre: 'el lector de videos', correr: leerVideoYt }],
    listar: {
      canal: {
        nombre: 'Los videos de un canal', ayuda: 'el canal: «@nombre» o su link',
        backends: [{
          id: 'canal', nombre: 'la pestaña de videos',
          correr: async ({ id, n }, ctx) => {
            const { videosDelCanal } = await import('../lector/youtube.ts')
            const limpio = id.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/\/(videos|featured)?$/, '')
            if (!/^(@[\w.-]+|channel\/UC[\w-]+|c\/[\w.-]+|user\/[\w.-]+)$/.test(limpio)) throw new ErrorExplorar('ENTRADA_MALA', 'Un canal: «@nombre» o su link')
            const c = await videosDelCanal(limpio, ctx.pedir, n).catch((e) => { throw new ErrorExplorar(/403|429/.test(String(e)) ? 'BLOQUEADO' : 'ROTO', String(e instanceof Error ? e.message : e)) })
            return c.videos.map((v) => ({ titulo: `Video de ${c.titulo ?? limpio}`, url: `https://www.youtube.com/watch?v=${v}`, autor: c.titulo ?? undefined }))
          },
        }],
      },
    },
  }
}
