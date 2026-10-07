/**
 * El modelo con el que piensa Mastropiero (chat, jornada, escriba de memoria). Un solo punto, inyectable para tests.
 */
import { nanChatHerramientas, nanChatHerramientasStream, nanConfigurado } from './nan.ts'

export type Modelo = (
  l: Parameters<typeof nanChatHerramientas>[0],
  o: Parameters<typeof nanChatHerramientas>[1],
  alTexto?: (parcial: string) => void,
) => ReturnType<typeof nanChatHerramientas>

let proveedor: Modelo = async (l, o, alTexto) => {
  if (!nanConfigurado()) throw new Error('Sin modelo: configurá NAN_API_KEY en .env')
  return alTexto ? nanChatHerramientasStream(l, o, alTexto) : nanChatHerramientas(l, o)
}

export const llamarModelo: Modelo = (l, o, alTexto) => proveedor(l, o, alTexto)

export function _probarModelo(m: Modelo) {
  proveedor = m
}

/** Pide un objeto JSON y lo devuelve parseado (sin herramientas). */
export async function pedirJson<T = any>(
  l: Parameters<Modelo>[0],
  sistema: string,
  usuario: string,
  o: { temperatura?: number; maxTokens?: number } = {},
): Promise<{ datos: T; modelo: string; tokens: number }> {
  const r = await llamarModelo(l, {
    mensajes: [{ role: 'system', content: `${sistema}\nRespondé SOLO un objeto JSON válido.` }, { role: 'user', content: usuario }],
    herramientas: [], temperatura: o.temperatura ?? 0.4, maxTokens: o.maxTokens ?? 4096,
  })
  const crudo = r.texto.match(/\{[\s\S]*\}/)?.[0]
  if (!crudo) throw new Error('El modelo no devolvió JSON')
  return { datos: JSON.parse(crudo) as T, modelo: r.modelo, tokens: r.tokens }
}
