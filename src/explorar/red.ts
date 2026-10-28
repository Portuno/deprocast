/**
 * La red segura para leer internet (plan v31). Ahora que los agentes, el Observatorio y la puerta MCP leen cualquier link,
 * un link no puede apuntar adentro: ni a esta compu, ni a la red de la casa, ni a la metadata de la nube.
 * - Solo http y https; se resuelve el DNS y se rechaza loopback, privadas, link-local, CGNAT, multicast y `.local`.
 * - Las redirecciones se siguen a mano (hasta 5) y cada salto pasa por el mismo chequeo.
 * - Timeout y un turno por host (Reddit pide espacio entre pedidos).
 */
import dns from 'node:dns/promises'
import net from 'node:net'

export const UA_NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
export const UA_PROPIO = 'Deprocast/1.0 (lector de links publicos)'
const MAX_SALTOS = 5

type Transporte = (url: string, init: RequestInit) => Promise<Response>
type Resolver = (host: string) => Promise<string[]>
let transporte: Transporte = (url, init) => fetch(url, init)
let resolver: Resolver = async (host) => (await dns.lookup(host, { all: true, verbatim: true })).map((x) => x.address)
export function _probarRed(o: { transporte?: Transporte; resolver?: Resolver }) {
  if (o.transporte) transporte = o.transporte
  if (o.resolver) resolver = o.resolver
}

export class RedBloqueada extends Error {}

function v4Privada(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
}

/** ¿Una IP de adentro (esta compu, la red local, la metadata de la nube)? */
export function ipPrivada(ip: string): boolean {
  const x = ip.replace(/^\[|\]$/g, '').toLowerCase()
  if (net.isIPv4(x)) return v4Privada(x)
  if (!net.isIPv6(x)) return true
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x)?.[1]
  if (mapeada) return v4Privada(mapeada)
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x)
}

/** Chequea que la URL salga a internet. Tira RedBloqueada si apunta adentro. */
export async function chequearDestino(url: string): Promise<URL> {
  let u: URL
  try { u = new URL(url) } catch { throw new RedBloqueada('No es un link válido') }
  if (!/^https?:$/.test(u.protocol)) throw new RedBloqueada('Solo se leen links http o https')
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || /\.(local|localhost|internal|lan|home|arpa)$/.test(host)) throw new RedBloqueada('Ese link apunta adentro (esta compu o la red local)')
  const ips = net.isIP(host) ? [host] : await resolver(host).catch(() => { throw new RedBloqueada(`No existe el sitio ${host}`) })
  if (!ips.length || ips.some(ipPrivada)) throw new RedBloqueada('Ese link apunta adentro (esta compu o la red local)')
  return u
}

const turnos = new Map<string, number>()
/** Espera su turno con el host (para los que piden espacio entre pedidos). */
export async function turno(host: string, msEntre: number) {
  const ahora = Date.now()
  const libre = turnos.get(host) ?? 0
  turnos.set(host, Math.max(ahora, libre) + msEntre)
  if (libre > ahora) await new Promise((r) => setTimeout(r, libre - ahora))
}
export function _reiniciarTurnos() { turnos.clear() }

/**
 * fetch con el chequeo de destino en cada salto. Mismo contrato que fetch (devuelve la Response final; su .url es la
 * del último salto). Una redirección a un lugar de adentro corta con RedBloqueada.
 */
export async function pedirSeguro(url: string, init: RequestInit = {}, o: { timeoutMs?: number } = {}): Promise<Response> {
  let actual = url
  const headers = { 'user-agent': UA_NAVEGADOR, accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8', 'accept-language': 'es,en;q=0.8', ...(init.headers as Record<string, string> ?? {}) }
  for (let salto = 0; salto <= MAX_SALTOS; salto++) {
    await chequearDestino(actual)
    const r = await transporte(actual, { ...init, headers, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(o.timeoutMs ?? 20_000) })
    const destino = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null
    if (!destino) return r
    actual = new URL(destino, actual).toString()
    // Un 303 (o un POST redirigido) sigue como GET y sin cuerpo.
    if (r.status === 303 || ((r.status === 301 || r.status === 302) && init.method && init.method !== 'GET')) init = { ...init, method: 'GET', body: undefined }
  }
  throw new RedBloqueada('Demasiadas redirecciones')
}
