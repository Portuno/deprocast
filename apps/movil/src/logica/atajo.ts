/** El icono rápido «Dictar a Deprocast» (Fragua #300) abre la app con este link: ¿es un pedido de dictado? */
export const esPedidoDeDictado = (url: string | null | undefined) => !!url && /^deprocast:\/\/+dictar\b/i.test(url)
