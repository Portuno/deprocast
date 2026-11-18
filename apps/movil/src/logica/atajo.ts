/** El icono rápido «Dictar a Deprocast» (Fragua #300) abre la app con este link: ¿es un pedido de dictado? */
export const esPedidoDeDictado = (url: string | null | undefined) => !!url && /^deprocast:\/\/+dictar\b/i.test(url)
/** El widget de la pantalla de inicio abre la app en una pestaña: deprocast://validar o deprocast://hoy. */
export const pestanaDelLink = (url: string | null | undefined): 'hoy' | 'validar' | null => (!url ? null : /^deprocast:\/\/+validar\b/i.test(url) ? 'validar' : /^deprocast:\/\/+hoy\b/i.test(url) ? 'hoy' : null)
