/**
 * Conectores de redes con API oficial y token (Fragua #224). Cada uno dice qué credencial pide, cómo publica un texto y
 * cómo se verifica que el token sigue andando (sin publicar nada). Nunca contraseñas de la red: tokens de acceso o
 * contraseñas de aplicación (Bluesky), que se revocan sin tocar la cuenta. Abrir una cuenta nueva sigue siendo a mano
 * (teléfono y verificación): acá se administran las que ya existen.
 * Lo que pide un video o una imagen (Instagram, TikTok) queda en manual.
 */

export type Credencial = Record<string, string>
export type CampoCredencial = { k: string; n: string; secreto: boolean; ayuda?: string }
export type ConectorApi = {
  id: string; nombre: string; red: string
  campos: CampoCredencial[]
  /** Publica un texto; devuelve el link si la red lo da. */
  publicar: (cred: Credencial, texto: string) => Promise<{ url: string | null }>
  /** Comprueba el token sin publicar: el nombre de la cuenta del otro lado, o un error (con `caido` si es de credencial). */
  verificar: (cred: Credencial) => Promise<{ cuenta: string }>
}

/** Un error de la red: `credencial` = el token venció, lo revocaron o no tiene permiso (la cuenta queda caída). */
export class ErrorRed extends Error {
  credencial: boolean
  constructor(m: string, credencial: boolean) { super(m); this.credencial = credencial }
}

let pedir = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
export function _probarRedes(f: typeof pedir) { pedir = f }

async function json(r: Response, red: string): Promise<any> {
  const t = await r.text()
  let j: any = null
  try { j = t ? JSON.parse(t) : {} } catch { j = { crudo: t.slice(0, 200) } }
  if (!r.ok) {
    const msg = String(j?.error?.message ?? j?.message ?? j?.error_description ?? j?.detail ?? j?.title ?? j?.error ?? j?.crudo ?? r.statusText).slice(0, 200)
    throw new ErrorRed(`${red} ${r.status}: ${msg}`, r.status === 401 || r.status === 403 || /token|expired|invalid.?(grant|auth)|unauthori[sz]ed|AuthenticationRequired|ExpiredToken/i.test(msg))
  }
  return j
}
const falta = (cred: Credencial, ...ks: string[]) => { for (const k of ks) if (!cred[k]?.trim()) throw new ErrorRed(`Falta ${k} en la credencial`, true) }

const largoMax = (texto: string, max: number, red: string) => { if ([...texto].length > max) throw new ErrorRed(`${red} acepta hasta ${max} caracteres (este tiene ${[...texto].length})`, false) }

export const CONECTORES_API: Record<string, ConectorApi> = {
  bluesky: {
    id: 'bluesky', nombre: 'Bluesky (contraseña de aplicación)', red: 'bluesky',
    campos: [{ k: 'usuario', n: 'Usuario (handle)', secreto: false, ayuda: 'tu.bsky.social' }, { k: 'clave_app', n: 'Contraseña de aplicación', secreto: true, ayuda: 'Ajustes → Privacidad y seguridad → Contraseñas de aplicación (no la de tu cuenta)' }],
    async publicar(cred, texto) {
      largoMax(texto, 300, 'Bluesky')
      const s = await sesionBluesky(cred)
      const r = await json(await pedir('https://bsky.social/xrpc/com.atproto.repo.createRecord', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.accessJwt}` }, body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text: texto, createdAt: new Date().toISOString() } }) }), 'Bluesky')
      const rkey = String(r.uri ?? '').split('/').pop()
      return { url: rkey ? `https://bsky.app/profile/${s.handle}/post/${rkey}` : null }
    },
    async verificar(cred) { const s = await sesionBluesky(cred); return { cuenta: `@${s.handle}` } },
  },
  mastodon: {
    id: 'mastodon', nombre: 'Mastodon (token)', red: 'mastodon',
    campos: [{ k: 'instancia', n: 'Instancia', secreto: false, ayuda: 'https://mastodon.social' }, { k: 'token', n: 'Token de acceso', secreto: true, ayuda: 'Preferencias → Desarrollo → Nueva aplicación (permiso write:statuses)' }],
    async publicar(cred, texto) {
      falta(cred, 'instancia', 'token')
      const r = await json(await pedir(`${base(cred.instancia)}/api/v1/statuses`, { method: 'POST', headers: { authorization: `Bearer ${cred.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: texto }) }), 'Mastodon')
      return { url: r.url ?? null }
    },
    async verificar(cred) { falta(cred, 'instancia', 'token'); const r = await json(await pedir(`${base(cred.instancia)}/api/v1/accounts/verify_credentials`, { headers: { authorization: `Bearer ${cred.token}` } }), 'Mastodon'); return { cuenta: `@${r.acct}` } },
  },
  linkedin: {
    id: 'linkedin', nombre: 'LinkedIn (token de la API)', red: 'linkedin',
    campos: [{ k: 'token', n: 'Token de acceso', secreto: true, ayuda: 'De tu app en LinkedIn Developers, con permiso w_member_social' }, { k: 'autor', n: 'Autor (URN)', secreto: false, ayuda: 'urn:li:person:… o urn:li:organization:…' }],
    async publicar(cred, texto) {
      falta(cred, 'token', 'autor')
      largoMax(texto, 3000, 'LinkedIn')
      const r = await pedir('https://api.linkedin.com/v2/ugcPosts', { method: 'POST', headers: { authorization: `Bearer ${cred.token}`, 'content-type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' }, body: JSON.stringify({ author: cred.autor, lifecycleState: 'PUBLISHED', specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: texto }, shareMediaCategory: 'NONE' } }, visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' } }) })
      await json(r, 'LinkedIn')
      const id = r.headers.get('x-restli-id')
      return { url: id ? `https://www.linkedin.com/feed/update/${id}` : null }
    },
    async verificar(cred) { falta(cred, 'token'); const r = await json(await pedir('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${cred.token}` } }), 'LinkedIn'); return { cuenta: r.name ?? r.email ?? 'LinkedIn' } },
  },
  x: {
    id: 'x', nombre: 'X / Twitter (token de usuario)', red: 'twitter',
    campos: [{ k: 'token', n: 'Token de usuario (OAuth 2.0)', secreto: true, ayuda: 'De tu app en el portal de desarrolladores de X, con tweet.write' }],
    async publicar(cred, texto) {
      falta(cred, 'token')
      largoMax(texto, 280, 'X')
      const r = await json(await pedir('https://api.twitter.com/2/tweets', { method: 'POST', headers: { authorization: `Bearer ${cred.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: texto }) }), 'X')
      return { url: r.data?.id ? `https://x.com/i/web/status/${r.data.id}` : null }
    },
    async verificar(cred) { falta(cred, 'token'); const r = await json(await pedir('https://api.twitter.com/2/users/me', { headers: { authorization: `Bearer ${cred.token}` } }), 'X'); return { cuenta: `@${r.data?.username ?? '?'}` } },
  },
  facebook_pagina: {
    id: 'facebook_pagina', nombre: 'Página de Facebook (token de página)', red: 'facebook',
    campos: [{ k: 'pagina', n: 'ID de la página', secreto: false }, { k: 'token', n: 'Token de la página', secreto: true, ayuda: 'De la Graph API, con pages_manage_posts' }],
    async publicar(cred, texto) {
      falta(cred, 'pagina', 'token')
      const r = await json(await pedir(`https://graph.facebook.com/v21.0/${encodeURIComponent(cred.pagina)}/feed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: texto, access_token: cred.token }) }), 'Facebook')
      return { url: r.id ? `https://www.facebook.com/${r.id}` : null }
    },
    async verificar(cred) { falta(cred, 'pagina', 'token'); const r = await json(await pedir(`https://graph.facebook.com/v21.0/${encodeURIComponent(cred.pagina)}?fields=name&access_token=${encodeURIComponent(cred.token)}`), 'Facebook'); return { cuenta: r.name ?? cred.pagina } },
  },
}

const base = (u: string) => (/^https?:\/\//.test(u.trim()) ? u.trim() : `https://${u.trim()}`).replace(/\/+$/, '')

async function sesionBluesky(cred: Credencial): Promise<{ accessJwt: string; did: string; handle: string }> {
  falta(cred, 'usuario', 'clave_app')
  const r = await json(await pedir('https://bsky.social/xrpc/com.atproto.server.createSession', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: cred.usuario.replace(/^@/, ''), password: cred.clave_app }) }), 'Bluesky')
  return { accessJwt: r.accessJwt, did: r.did, handle: r.handle }
}
