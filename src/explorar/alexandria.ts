/**
 * Alexandria (Firecrawl, plan v32): no es un sitio sino un catálogo de herramientas de datos (430 proveedores: registros
 * públicos, empresas, finanzas, podcasts, papers, salud…). Buscar acá devuelve las herramientas que sirven para la
 * consulta (proveedor, capacidad, qué piden y cuánto cuestan): descubrirlas es gratis, usarlas (usar_alexandria) gasta
 * créditos. Todo pide la clave gratis de Firecrawl (FIRECRAWL_API_KEY).
 */
import type { Canal } from './index.ts'
import { herramientasAlexandria, clave } from './firecrawl.ts'

export function canalAlexandria(): Canal {
  return {
    id: 'alexandria', nombre: 'Alexandria (Firecrawl)',
    puede: 'Encontrar herramientas de datos para una consulta (registros públicos, empresas, finanzas, podcasts, papers…) con su proveedor, lo que piden y su precio; Mastropiero las usa con tu ok.',
    noPuede: clave() ? 'usar una herramienta sin gastar créditos (cada una dice su precio)' : 'nada todavía: pide la clave gratis de Firecrawl (FIRECRAWL_API_KEY en .env)',
    buscar: [{
      id: 'herramientas', nombre: 'catálogo de Alexandria',
      correr: async ({ consulta, n }, ctx) => (await herramientasAlexandria(ctx.pedir, consulta, n)).map((h) => ({
        titulo: `${h.nombre} (${h.proveedor} · ${h.capacidad})`, url: `https://www.firecrawl.dev/alexandria#${encodeURIComponent(h.proveedor)}/${encodeURIComponent(h.capacidad)}`,
        texto: h.descripcion || undefined, datos: { proveedor: h.proveedor, capacidad: h.capacidad, precio: h.precio ?? undefined, entradas: h.entradas ?? undefined },
      })),
    }],
  }
}
