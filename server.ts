/**
 * Entrada que Vercel detecta y convierte en una función.
 * En la compu se sigue usando `npm run jugar` (src/servidor.ts).
 * El puerto de listen solo vale en local: en Vercel el tráfico entra por dentro.
 */
import { servidor } from './src/servidor.ts'

servidor.listen(Number(process.env.PORT ?? 3000))
