/**
 * Los canales de fábrica para explorar (plan v31). Cada uno dice qué se puede y qué no sin cuenta, y arma sus cadenas.
 * La web: buscar con los buscadores de siempre (Brave, Tavily, Exa sin clave, Wikipedia) y leer con el lector propio,
 * después Jina (páginas que se arman con JavaScript) y después Exa.
 */
import type { Canal } from './index.ts'
import { ErrorExplorar, type Ctx, type Leido } from './tipos.ts'
import { leerExa, leerJina } from './web.ts'

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

export const jina = { id: 'jina', nombre: 'Jina Reader', correr: async ({ url }: { url: string }, ctx: Ctx): Promise<Leido> => ({ url, ...(await leerJina(ctx.pedir, url)) }) }
export const exaLeer = { id: 'exa', nombre: 'Exa', correr: async ({ url }: { url: string }, ctx: Ctx): Promise<Leido> => ({ url, ...(await leerExa(ctx.pedir, url)) }) }

export function canalWeb(): Canal {
  return {
    id: 'web', nombre: 'La web',
    puede: 'Buscar en toda la web y leer cualquier página pública (también las que se arman con JavaScript).',
    buscar: [{
      id: 'buscador', nombre: 'buscadores (Brave, Tavily, Exa, Wikipedia)',
      correr: async ({ consulta, n }, ctx) => {
        const { buscarWeb } = await import('../web.ts')
        return (await buscarWeb(ctx.db, consulta, { n, ahora: ctx.ahora })).map((r) => ({ titulo: r.titulo, url: r.url, texto: r.extracto, datos: { proveedor: r.proveedor } }))
      },
    }],
    leer: [{ id: 'lector', nombre: 'el lector propio', correr: ({ url }) => leerConLector(url) }, jina, exaLeer],
  }
}

export function canalesDeFabrica(): Canal[] {
  return [canalWeb()]
}
