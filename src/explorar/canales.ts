/**
 * Los canales de fábrica para explorar (plan v31). Cada uno dice qué se puede y qué no sin cuenta, y arma sus cadenas.
 * La web: buscar con los buscadores de siempre (Brave, Tavily, Exa sin clave, Wikipedia) y leer con el lector propio,
 * después Jina (páginas que se arman con JavaScript) y después Exa. Las plataformas, en sus archivos.
 */
import type { Canal } from './index.ts'
import { exaLeer, jinaLeer, lector } from './comun.ts'
import { canalReddit } from './reddit.ts'
import { canalYoutube } from './youtube.ts'
import { canalGithub } from './github.ts'
import { canalesRedes } from './redes.ts'

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
    leer: [lector, jinaLeer, exaLeer],
  }
}

export function canalesDeFabrica(): Canal[] {
  // Lo que un canal no sabe leer (un archivo suelto de GitHub, la página de un canal de YouTube) lo lee la web.
  const conWeb = (c: Canal): Canal => ({ ...c, leer: [...(c.leer ?? []), lector] })
  return [canalWeb(), conWeb(canalReddit()), conWeb(canalYoutube()), conWeb(canalGithub()), ...canalesRedes()]
}
