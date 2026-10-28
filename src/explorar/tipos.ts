/** Lo común de explorar internet (plan v31): los códigos de error de la cadena y lo que vuelve de buscar, leer y listar. */
import type { Db } from '../db.ts'

/**
 * NO_ENCONTRADO y ENTRADA_MALA cortan la cadena (no existe o está mal pedido: otro backend no lo arregla).
 * BLOQUEADO, LIMITE y ROTO pasan al siguiente. NO_SE_PUEDE: eso no se ve sin cuenta (lo dice, no lo intenta).
 */
export type Codigo = 'NO_ENCONTRADO' | 'BLOQUEADO' | 'LIMITE' | 'ROTO' | 'ENTRADA_MALA' | 'NO_SE_PUEDE'
export const CORTAN: Codigo[] = ['NO_ENCONTRADO', 'ENTRADA_MALA', 'NO_SE_PUEDE']
export const EN_CRIOLLO: Record<Codigo, string> = {
  NO_ENCONTRADO: 'no existe', BLOQUEADO: 'bloqueado por el sitio', LIMITE: 'límite de pedidos', ROTO: 'falló', ENTRADA_MALA: 'pedido mal armado', NO_SE_PUEDE: 'no se ve sin cuenta',
}

export class ErrorExplorar extends Error {
  codigo: Codigo
  constructor(codigo: Codigo, mensaje: string) {
    super(mensaje)
    this.codigo = codigo
  }
}

/** Un resultado: lo mínimo para mostrarlo y seguirlo (la URL es real: vino de la plataforma o del buscador). */
export type Item = { titulo: string; url: string; texto?: string; autor?: string; fecha?: string; datos?: Record<string, unknown> }
export type Leido = { url: string; titulo: string; markdown: string; autor?: string; fecha?: string; aviso?: string }

export type Ctx = { db: Db; pedir: (url: string, init?: RequestInit) => Promise<Response>; ahora: number }
export type Backend<A, R> = { id: string; nombre: string; correr: (a: A, ctx: Ctx) => Promise<R> }
