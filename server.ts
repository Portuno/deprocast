/**
 * Entrada que Vercel detecta y convierte en una función.
 * En la compu se sigue usando `npm run jugar` (src/servidor.ts).
 * El puerto de listen solo vale en local: en Vercel el tráfico entra por dentro.
 */
if (process.env.VERCEL) process.env.TZ = process.env.MASTRO_ZONA?.trim() || 'Europe/Madrid'

const { servidor } = await import('./src/servidor.ts')

servidor.listen(Number(process.env.PORT ?? 3000))
