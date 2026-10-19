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
  o: { temperatura?: number; maxTokens?: number; largo?: boolean } = {},
): Promise<{ datos: T; modelo: string; tokens: number }> {
  const mensajes = [{ role: 'system', content: `${sistema}\nRespondé SOLO un objeto JSON válido.` }, { role: 'user', content: usuario }]
  // Un JSON roto (texto alrededor, cortado, una coma de más) merece un segundo intento antes de fallar.
  let ultimo = ''
  for (let intento = 0; intento < 2; intento++) {
    const r = await llamarModelo(l, {
      mensajes: intento ? [...mensajes, { role: 'assistant', content: ultimo.slice(0, 4000) }, { role: 'user', content: 'Eso no es un JSON válido. Devolvé SOLO el objeto JSON, completo y bien formado, sin texto alrededor.' }] : mensajes,
      // Modo JSON (response_format): el modelo no puede contestar prosa. El que no lo acepta pasa al siguiente de la cadena.
      herramientas: [], json: true, temperatura: o.temperatura ?? 0.4, maxTokens: o.maxTokens ?? 4096, razonarPoco: o.largo || undefined,
      // Respuesta larga: en streaming (el proxy de NaN corta a los ~125 s lo que no manda nada) y razonando poco
      // (el razonamiento come del mismo tope que la respuesta).
    }, o.largo ? () => {} : undefined)
    ultimo = r.texto
    const datos = leerJson<T>(r.texto)
    if (datos) return { datos, modelo: r.modelo, tokens: r.tokens }
  }
  throw new Error(`El modelo no devolvió un JSON válido: ${porQueNoEsJson(ultimo)}`)
}

/** Qué tiene de malo una respuesta que no dio JSON (para que el error diga qué pasó). */
export function porQueNoEsJson(texto: string): string {
  const t = texto.trim()
  if (!t) return 'vino vacía'
  const i = t.indexOf('{')
  if (i < 0) return `contestó texto sin JSON («${t.slice(0, 80).replace(/\s+/g, ' ')}…»)`
  if (objetoBalanceado(t, i) == null) return `se cortó antes de cerrar el JSON (${t.length} caracteres, termina en «…${t.slice(-60).replace(/\s+/g, ' ')}»)`
  return `JSON mal formado («${t.slice(i, i + 80).replace(/\s+/g, ' ')}…»)`
}

/** El primer objeto {…} balanceado desde «desde» (respetando strings y escapes), o null si no cierra. */
function objetoBalanceado(t: string, desde: number): string | null {
  let prof = 0
  let enCadena = false
  for (let i = desde; i < t.length; i++) {
    const c = t[i]
    if (enCadena) {
      if (c === '\\') i++
      else if (c === '"') enCadena = false
    } else if (c === '"') enCadena = true
    else if (c === '{') prof++
    else if (c === '}' && --prof === 0) return t.slice(desde, i + 1)
  }
  return null
}

/**
 * El objeto JSON de una respuesta: tal cual, dentro de un bloque de código, el primer objeto balanceado (aunque venga
 * otro objeto o texto después) o el tramo entre la primera { y la última }. Cada uno se prueba también sin comas finales.
 */
export function leerJson<T>(texto: string): T | null {
  const t = texto.trim()
  const bloque = t.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]
  const candidatos = [t, bloque, ...[t, bloque].map((x) => (x && x.indexOf('{') >= 0 ? objetoBalanceado(x, x.indexOf('{')) : null)), t.match(/\{[\s\S]*\}/)?.[0]]
  for (const c of candidatos) {
    if (!c) continue
    for (const intento of [c, c.replace(/,(\s*[}\]])/g, '$1')]) {
      try {
        const v = JSON.parse(intento)
        if (v && typeof v === 'object' && !Array.isArray(v)) return v as T
      } catch {
        // probar el siguiente
      }
    }
  }
  return null
}
