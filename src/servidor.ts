/**
 * La entrada de Deprocast. Casi siempre arranca el servidor (`servidor-app.ts`). En la nube, cuando lo lanza el arranque
 * de la imagen (MASTRO_REPO, y no supervisado todavía), arranca en cambio el supervisor (plan v33, paso 6): se queda con
 * el puerto público y corre el servidor de verdad atrás, así cada versión nueva entra sin cortar (la vieja atiende hasta
 * que la nueva está caliente).
 *
 * Es mínima a propósito: el supervisor tiene que tomar el puerto en un instante, sin cargar todo el servidor.
 */
const supervisar =
  process.env.MASTRO_NUBE === '1' && !!process.env.MASTRO_REPO && !process.env.MASTRO_SUPERVISADO && !process.env.MASTRO_USUARIO &&
  process.env.VERCEL !== '1' && process.env.MASTRO_SUPERVISOR !== '0'

if (supervisar) await (await import('./supervisor.ts')).principal()
else await import('./servidor-app.ts')

export {}
