/**
 * GitHub por su API pública (plan v31), sin token: 60 pedidos por hora por IP (cacheados 30 min).
 * - buscar repos (por relevancia) y, con «issues:» adelante, issues y PRs;
 * - leer un repo (sus datos y su README) o un issue/PR con sus comentarios; un archivo suelto lo lee la web (raw);
 * - listar los repos de alguien o los issues abiertos de un repo.
 * Un 403 sin pedidos restantes es LIMITE, con la hora en que se libera.
 */
import type { Canal } from './index.ts'
import { ErrorExplorar, type Ctx, type Item, type Leido } from './tipos.ts'

const API = 'https://api.github.com'

async function gh(ctx: Ctx, ruta: string, accept = 'application/vnd.github+json'): Promise<any> {
  let r: Response
  try { r = await ctx.pedir(`${API}${ruta}`, { headers: { accept, 'user-agent': 'Deprocast/1.0', 'x-github-api-version': '2022-11-28' } }) } catch (e) { throw new ErrorExplorar('ROTO', e instanceof Error ? e.message : String(e)) }
  if (r.status === 404) throw new ErrorExplorar('NO_ENCONTRADO', 'Eso no existe en GitHub (o es privado)')
  if (r.status === 429 || (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0')) {
    const reset = Number(r.headers.get('x-ratelimit-reset') ?? 0)
    throw new ErrorExplorar('LIMITE', `GitHub: se gastaron los 60 pedidos de la hora${reset ? ` (vuelve a las ${new Date(reset * 1000).toTimeString().slice(0, 5)})` : ''}`)
  }
  if (r.status === 422) throw new ErrorExplorar('ENTRADA_MALA', 'GitHub no entendió la búsqueda')
  if (!r.ok) throw new ErrorExplorar('ROTO', `GitHub respondió ${r.status}`)
  return accept.endsWith('raw') ? r.text() : r.json()
}

const repoItem = (x: any): Item => ({
  titulo: x.full_name, url: x.html_url, autor: x.owner?.login, fecha: x.pushed_at ?? x.updated_at, texto: x.description ?? undefined,
  datos: { estrellas: x.stargazers_count, lenguaje: x.language ?? undefined, forks: x.forks_count, temas: x.topics?.length ? x.topics : undefined, archivado: x.archived || undefined },
})
const issueItem = (x: any): Item => ({
  titulo: x.title, url: x.html_url, autor: x.user?.login, fecha: x.updated_at, texto: String(x.body ?? '').slice(0, 500) || undefined,
  datos: { estado: x.state, comentarios: x.comments, esPR: !!x.pull_request || undefined, etiquetas: x.labels?.map((l: any) => l.name).filter(Boolean) },
})

/** owner/repo, y si es un issue o PR, su número. null si el link no es de un repo (un archivo: lo lee la web). */
export function rutaGithub(url: string): { dueno: string; repo: string; numero?: number } | null {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(issues|pull|discussions)\/(\d+))?\/?(?:[?#].*)?$/i.exec(url)
  return m ? { dueno: m[1], repo: m[2], numero: m[4] ? Number(m[4]) : undefined } : null
}

async function leerGithub({ url }: { url: string }, ctx: Ctx): Promise<Leido> {
  const r = rutaGithub(url)
  if (!r) throw new ErrorExplorar('ROTO', 'No es un repo ni un issue: lo lee la web')
  const base = `/repos/${r.dueno}/${r.repo}`
  if (r.numero) {
    const i = await gh(ctx, `${base}/issues/${r.numero}`)
    const cs = i.comments ? await gh(ctx, `${base}/issues/${r.numero}/comments?per_page=50`) : []
    const md = [
      `# ${i.title}`, `${i.pull_request ? 'PR' : 'Issue'} #${i.number} de ${r.dueno}/${r.repo} · ${i.state} · por @${i.user?.login} · ${String(i.created_at).slice(0, 10)}${i.labels?.length ? ` · ${i.labels.map((l: any) => l.name).join(', ')}` : ''}`,
      i.body ?? '', cs.length ? `## Comentarios (${cs.length})\n\n${cs.map((c: any) => `**@${c.user?.login}** (${String(c.created_at).slice(0, 10)}):\n${c.body}`).join('\n\n')}` : '',
    ].filter(Boolean).join('\n\n')
    return { url, titulo: i.title, markdown: md, autor: i.user?.login, fecha: i.created_at }
  }
  const repo = await gh(ctx, base)
  const readme = await gh(ctx, `${base}/readme`, 'application/vnd.github.raw').catch((e) => { if (e instanceof ErrorExplorar && e.codigo === 'NO_ENCONTRADO') return ''; throw e })
  const md = [
    `# ${repo.full_name}`, repo.description ?? '',
    `★ ${repo.stargazers_count} · ${repo.forks_count} forks · ${repo.language ?? 'sin lenguaje'} · ${repo.license?.spdx_id ?? 'sin licencia'} · último push ${String(repo.pushed_at).slice(0, 10)}${repo.archived ? ' · archivado' : ''}${repo.topics?.length ? `\nTemas: ${repo.topics.join(', ')}` : ''}${repo.homepage ? `\nSitio: ${repo.homepage}` : ''}`,
    readme ? `## README\n\n${String(readme).slice(0, 50_000)}` : '_(sin README)_',
  ].filter(Boolean).join('\n\n')
  return { url, titulo: repo.full_name, markdown: md, autor: repo.owner?.login, fecha: repo.pushed_at }
}

export function canalGithub(): Canal {
  return {
    id: 'github', nombre: 'GitHub', hosts: /^https?:\/\/(www\.)?github\.com\//i,
    puede: 'Buscar repos (o issues y PRs con «issues: …»), leer un repo con su README o un issue/PR con sus comentarios, y listar los repos de alguien o los issues abiertos de un repo.',
    noPuede: 'más de 60 pedidos por hora (sin token); lo repetido sale de la caché',
    buscar: [{
      id: 'api', nombre: 'API de GitHub',
      correr: async ({ consulta, n }, ctx) => {
        const issues = /^issues?:\s*/i.test(consulta)
        const q = encodeURIComponent(consulta.replace(/^issues?:\s*/i, ''))
        const j = await gh(ctx, issues ? `/search/issues?q=${q}&per_page=${n}` : `/search/repositories?q=${q}&per_page=${n}`)
        return (j.items ?? []).map(issues ? issueItem : repoItem)
      },
    }],
    leer: [{ id: 'api', nombre: 'API de GitHub', correr: leerGithub }],
    listar: {
      repos: {
        nombre: 'Los repos de alguien', ayuda: 'el usuario u organización («anthropics»)',
        backends: [{
          id: 'api', nombre: 'API de GitHub',
          correr: async ({ id, n }, ctx) => {
            if (!/^[\w.-]{1,39}$/.test(id)) throw new ErrorExplorar('ENTRADA_MALA', 'Un usuario u organización de GitHub')
            return (await gh(ctx, `/users/${id}/repos?sort=pushed&per_page=${n}`)).map(repoItem)
          },
        }],
      },
      issues: {
        nombre: 'Los issues abiertos de un repo', ayuda: '«dueño/repo»',
        backends: [{
          id: 'api', nombre: 'API de GitHub',
          correr: async ({ id, n }, ctx) => {
            if (!/^[\w.-]+\/[\w.-]+$/.test(id)) throw new ErrorExplorar('ENTRADA_MALA', 'Un repo: «dueño/repo»')
            return (await gh(ctx, `/repos/${id}/issues?state=open&sort=updated&per_page=${n}`)).map(issueItem)
          },
        }],
      },
    },
  }
}
