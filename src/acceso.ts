/**
 * Acceso: por defecto Mastropiero escucha solo en esta compu (127.0.0.1). Para usarlo desde el celular (por Tailscale
 * o la red de casa) se pone MASTRO_HOST, y entonces exige una clave (MASTRO_CLAVE): sin clave no arranca. Lo que llega
 * desde la propia compu no pide clave. La clave viaja en una cookie HttpOnly, después de entrar una vez.
 */
import type http from 'node:http'
import crypto from 'node:crypto'

export const host = () => (process.env.MASTRO_HOST ?? '127.0.0.1').trim()
/** En Vercel el pedido llega por un puerto interno: la IP parece local, pero el sitio es público. */
export const enVercel = () => process.env.VERCEL === '1'
export const expuesto = () => enVercel() || !['127.0.0.1', 'localhost', '::1'].includes(host())
const clave = () => process.env.MASTRO_CLAVE?.trim() ?? ''

/** Si se expone a la red sin clave, mejor no arrancar. */
export function validarAcceso(): string | null {
  if (expuesto() && clave().length < 8) {
    return enVercel()
      ? 'En Vercel hace falta MASTRO_CLAVE (8 caracteres o más).'
      : `MASTRO_HOST=${host()} expone Mastropiero a la red: poné MASTRO_CLAVE (8 caracteres o más) en .env.`
  }
  return null
}

const local = (req: http.IncomingMessage) => !enVercel() && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
const huella = (s: string) => crypto.createHash('sha256').update(`mastro:${s}`).digest('hex')

function cookies(req: http.IncomingMessage): Record<string, string> {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, decodeURIComponent(v)]))
}

/** ¿Puede pasar? Desde esta compu, siempre; desde la red, con la cookie de la clave. */
export function autorizado(req: http.IncomingMessage): boolean {
  if (!expuesto() || local(req)) return true
  const c = cookies(req).mastro
  return !!c && crypto.timingSafeEqual(Buffer.from(c.padEnd(64).slice(0, 64)), Buffer.from(huella(clave())))
}

export function cookieDeEntrada(ingresada: string): string | null {
  if (!clave() || ingresada !== clave()) return null
  const secure = enVercel() ? '; Secure' : ''
  return `mastro=${huella(clave())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 180}${secure}`
}

export const PAGINA_ENTRAR = (error = false) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mastropiero</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1012;color:#e6e6e8;font:15px system-ui}form{display:grid;gap:10px;width:min(320px,90vw)}input,button{font:inherit;padding:10px 12px;border-radius:9px;border:1px solid #33353b;background:#16171a;color:inherit}button{background:#c4a062;color:#17140d;border:0;font-weight:600}h1{font-size:20px;margin:0 0 6px}p{color:#d27272;margin:0}</style></head>
<body><form method="post" action="/entrar"><h1>☿ Mastropiero</h1>${error ? '<p>Clave incorrecta.</p>' : ''}<input type="password" name="clave" placeholder="Clave" autofocus autocomplete="current-password"><button>Entrar</button></form></body></html>`

/** Lee un formulario (urlencoded o multipart) sin dependencias: solo los campos de texto. */
export function leerFormulario(cuerpo: Buffer, tipo: string): Record<string, string> {
  if (/application\/x-www-form-urlencoded/i.test(tipo)) return Object.fromEntries(new URLSearchParams(cuerpo.toString('utf8')))
  const borde = /boundary=([^;]+)/i.exec(tipo)?.[1]?.replace(/"/g, '')
  if (!borde) return {}
  const out: Record<string, string> = {}
  for (const parte of cuerpo.toString('latin1').split(`--${borde}`)) {
    const [cab, ...resto] = parte.split('\r\n\r\n')
    const nombre = /name="([^"]+)"/.exec(cab ?? '')?.[1]
    if (!nombre || /filename=/.test(cab)) continue
    out[nombre] = Buffer.from(resto.join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1').toString('utf8')
  }
  return out
}
