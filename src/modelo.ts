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
  const mensajes = [{ role: 'system', content: `${sistema}\nRespondé SOLO un objeto JSON válido.` }, { role: 'user', content: usuario }]
  // Un JSON roto (texto alrededor, cortado, una coma de más) merece un segundo intento antes de fallar.
  let ultimo = ''
  for (let intento = 0; intento < 2; intento++) {
    const r = await llamarModelo(l, {
      mensajes: intento ? [...mensajes, { role: 'assistant', content: ultimo.slice(0, 4000) }, { role: 'user', content: 'Eso no es un JSON válido. Devolvé SOLO el objeto JSON, completo y bien formado, sin texto alrededor.' }] : mensajes,
      herramientas: [], temperatura: o.temperatura ?? 0.4, maxTokens: o.maxTokens ?? 4096,
    })
    ultimo = r.texto
    const datos = leerJson<T>(r.texto)
    if (datos) return { datos, modelo: r.modelo, tokens: r.tokens }
  }
  throw new Error('El modelo no devolvió un JSON válido')
}

/** El objeto JSON de una respuesta: tal cual, dentro de un bloque de código, o el tramo entre la primera { y la última }. */
export function leerJson<T>(texto: string): T | null {
  const candidatos = [texto.trim(), texto.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], texto.match(/\{[\s\S]*\}/)?.[0]]
  for (const c of candidatos) {
    if (!c) continue
    try {
      const v = JSON.parse(c)
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as T
    } catch {
      // probar el siguiente
    }
  }
  return null
}
