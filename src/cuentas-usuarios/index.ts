/**
 * La puerta de los usuarios (plan v33, paso 5). Corre en el proceso del dueño, antes que todo lo demás:
 * - con la cookie de sesión de un usuario, todo pedido va a SU Deprocast (su proceso, su base);
 * - `/u/<id>/…` es la entrada de sus apps, agentes (MCP) y teléfonos: con su token, sin sesión;
 * - `/entrar` (email y contraseña, o la clave del dueño), `/alta` (con invitación), `/salir` y `/cuenta`;
 * - `/usuarios`: el dueño invita, suspende, pone topes y borra.
 * Sin cookie de usuario y fuera de esas rutas no hace nada (no abre ni la base de cuentas): el dueño sigue igual.
 */
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { autorizado, cookieDeEntrada, detrasDeProxy, enUsuario, leerFormulario } from '../acceso.ts'
import {
  abrirCuentas, alta, anularInvitacion, borrarUsuario, cambiarClave, cambiarEstado, CLAVE_MIN, cerrarSesion, crearInvitacion, crearLimitador, crearSesion,
  entrar, fijarTope, listarInvitaciones, listarUsuarios, sesionDe, usuario, verInvitacion, type Cuentas, type Usuario,
} from './cuentas.ts'
import { crearHub, dirDeUsuario, type Hub } from './procesos.ts'

export const COOKIE = 'deprocast'
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function cookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of (req.headers.cookie ?? '').split(';')) {
    const i = c.indexOf('=')
    if (i > 0) try { out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()) } catch { /* cookie rota */ }
  }
  return out
}
const seguro = () => (detrasDeProxy() ? '; Secure' : '')
const cookieSesion = (token: string) => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${90 * 86_400}${seguro()}`
const borrarCookie = (nombre: string) => `${nombre}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${seguro()}`

function ipDe(req: http.IncomingMessage): string {
  if (detrasDeProxy()) return String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'proxy'
  return req.socket.remoteAddress ?? '?'
}
/** Un POST de un formulario de otro sitio no pasa (la cookie del dueño es Strict, pero en la compu no hay cookie). */
function mismoOrigen(req: http.IncomingMessage): boolean {
  const o = req.headers.origin
  if (!o) return true
  try { return new URL(o).host === req.headers.host } catch { return false }
}
function leerCuerpo(req: http.IncomingMessage, max = 64 * 1024): Promise<Buffer> {
  return new Promise((ok, mal) => {
    const partes: Buffer[] = []
    let n = 0
    req.on('data', (b: Buffer) => { n += b.length; if (n > max) { mal(new Error('Demasiado grande')); req.destroy() } else partes.push(b) })
    req.on('end', () => ok(Buffer.concat(partes)))
    req.on('error', mal)
  })
}

// ─── páginas ───────────────────────────────────────────────────────────

const ESTILO = `body{margin:0;min-height:100vh;background:#0f1012;color:#e6e6e8;font:15px/1.5 system-ui,sans-serif}main{max-width:720px;margin:0 auto;padding:32px 16px}form{display:grid;gap:10px}.angosto{width:min(340px,100%);margin:10vh auto 0}input,button,select{font:inherit;padding:10px 12px;border-radius:9px;border:1px solid #33353b;background:#16171a;color:inherit;box-sizing:border-box;max-width:100%}button{background:#c4a062;color:#17140d;border:0;font-weight:600;cursor:pointer}button.sec{background:#16171a;color:#e6e6e8;border:1px solid #33353b}button.mal{background:#5a2626;color:#f3dede}h1{font-size:20px;margin:0 0 6px}h2{font-size:16px;margin:28px 0 8px}.error{color:#d27272;margin:0}.ok{color:#8fc48f;margin:0}.tenue{color:#9a9ca4;font-size:13px}a{color:#c4a062}table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px 6px;border-bottom:1px solid #26282d;vertical-align:top}.fila{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.fila form{display:flex;gap:6px}code{word-break:break-all;background:#16171a;padding:2px 6px;border-radius:6px}.tabla{overflow-x:auto}`
const pagina = (titulo: string, cuerpo: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)} · Deprocast</title><style>${ESTILO}</style></head><body><main>${cuerpo}</main></body></html>`

export const PAGINA_LOGIN = (o: { error?: string; email?: string } = {}) => pagina('Entrar', `<form method="post" action="/entrar" class="angosto"><h1>☿ Deprocast</h1>${o.error ? `<p class="error">${esc(o.error)}</p>` : ''}
<input type="email" name="email" placeholder="Email" value="${esc(o.email)}" autocomplete="username" autofocus>
<input type="password" name="clave" placeholder="Contraseña" autocomplete="current-password" required>
<button>Entrar</button><p class="tenue">¿Sos el dueño? Dejá el email vacío y poné tu clave.</p></form>`)

const PAGINA_ALTA = (o: { codigo: string; email?: string | null; nombre?: string; error?: string }) => pagina('Crear tu cuenta', `<form method="post" action="/alta" class="angosto"><h1>☿ Tu Deprocast</h1>
<p class="tenue">Te invitaron. Vas a tener tu propio Deprocast: tu base, tu memoria y tus agentes, separados de los de cualquier otro.</p>
${o.error ? `<p class="error">${esc(o.error)}</p>` : ''}<input type="hidden" name="codigo" value="${esc(o.codigo)}">
<input name="nombre" placeholder="Tu nombre" value="${esc(o.nombre)}" required autocomplete="name">
<input type="email" name="email" placeholder="Email" value="${esc(o.email)}" ${o.email ? 'readonly' : ''} required autocomplete="username">
<input type="password" name="clave" placeholder="Contraseña (${CLAVE_MIN}+ caracteres)" minlength="${CLAVE_MIN}" required autocomplete="new-password">
<button>Crear mi cuenta</button></form>`)

const PAGINA_PREPARANDO = pagina('Preparando', `<div class="angosto"><h1>☿ Preparando tu Deprocast…</h1><p class="tenue">Unos segundos: se prende tu base. Esta página se recarga sola.</p></div><script>setTimeout(() => location.reload(), 2000)</script>`)

const fecha = (ms: number | null) => (ms ? new Date(ms).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const miles = (n: number) => n.toLocaleString('es-AR')

function PAGINA_CUENTA(u: Usuario, base: string, o: { error?: string; ok?: string } = {}) {
  return pagina('Tu cuenta', `<h1>Tu cuenta</h1><p class="tenue">${esc(u.nombre)} · ${esc(u.email)} · desde ${fecha(u.creado)}</p>
${o.error ? `<p class="error">${esc(o.error)}</p>` : ''}${o.ok ? `<p class="ok">${esc(o.ok)}</p>` : ''}
<p><a href="/">← Volver a tu Deprocast</a> · <a href="/salir">Salir</a></p>
<h2>Tus apps, agentes y teléfonos</h2><p class="tenue">Entran con su token por tu dirección: <code>${esc(base)}</code>. Por ejemplo, la puerta MCP es <code>${esc(base)}/mcp</code> y en la app del teléfono ponés <code>${esc(base)}</code> como servidor. Los tokens los creás adentro, en «Apps conectadas».</p>
<h2>Tope de tokens</h2><p class="tenue">${u.topeDia ? `Hasta ${miles(u.topeDia)} tokens por día entre todo lo que hace tu Deprocast. Si necesitás más, pedíselo a quien te invitó.` : 'Sin tope.'}</p>
<h2>Cambiar la contraseña</h2><form method="post" action="/cuenta/clave"><input type="password" name="actual" placeholder="Contraseña actual" required autocomplete="current-password"><input type="password" name="nueva" placeholder="Nueva (${CLAVE_MIN}+ caracteres)" minlength="${CLAVE_MIN}" required autocomplete="new-password"><button>Cambiarla</button><p class="tenue">Cierra todas tus sesiones: volvés a entrar con la nueva.</p></form>
<h2>Tus datos</h2><p class="tenue">Adentro, en la paleta (Ctrl+K): «Exportar o importar todo» baja todo lo tuyo, y «Exportar a medida», una parte.</p>
<h2>Borrar tu cuenta</h2><form method="post" action="/cuenta/borrar"><p class="tenue">Borra tu Deprocast entero (la base, lo que subiste, tus agentes). No se puede deshacer: exportá antes lo que quieras guardar.</p><input name="confirmar" placeholder="Escribí tu email para confirmar" autocomplete="off" required><input type="password" name="clave" placeholder="Tu contraseña" required autocomplete="current-password"><button class="mal">Borrar mi cuenta para siempre</button></form>`)
}

// ─── la puerta ─────────────────────────────────────────────────────────

export type OpcionesPuerta = { datos: string; hub?: Hub }

export function crearPuerta(o: OpcionesPuerta) {
  let cuentas: Cuentas | null = null
  const db = () => (cuentas ??= abrirCuentas(path.join(o.datos, 'cuentas.db')))
  const hub: Hub = o.hub ?? crearHub({ datos: o.datos, topeDe: (id) => usuario(db(), id)?.topeDia ?? 0 })
  /** Los usuarios quedan prendidos siempre: al arrancar se prenden todos los activos (si ya hay cuentas), escalonados. */
  function prenderTodos() {
    if (!fs.existsSync(path.join(o.datos, 'cuentas.db'))) return
    try { hub.mantener(listarUsuarios(db()).filter((u) => u.estado === 'activo').map((u) => u.id)) } catch (e) { console.error('  usuarios:', e instanceof Error ? e.message : e) }
  }
  const porIp = crearLimitador(20, 15 * 60_000)
  const porEmail = crearLimitador(8, 15 * 60_000)
  const html = (res: http.ServerResponse, codigo: number, cuerpo: string, extra: Record<string, string | string[]> = {}) =>
    void res.writeHead(codigo, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra }).end(cuerpo)
  const ir = (res: http.ServerResponse, a: string, extra: Record<string, string | string[]> = {}) => void res.writeHead(303, { location: a, ...extra }).end()
  const origen = (req: http.IncomingMessage) => `${detrasDeProxy() ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`

  /** Prende su Deprocast; mientras arranca, una navegación ve «preparando» (y se recarga) en vez de quedar colgada. */
  async function alSuyo(req: http.IncomingMessage, res: http.ServerResponse, u: Usuario, ruta: string) {
    const navegando = req.method === 'GET' && /text\/html/.test(String(req.headers.accept ?? ''))
    if (navegando && !hub.vivos().some((v) => v.id === u.id && v.listo)) {
      const listo = hub.asegurar(u.id).catch(() => { /* se ve al recargar */ })
      const ya = await Promise.race([listo.then(() => true), new Promise<boolean>((ok) => setTimeout(() => ok(false), 1500))])
      if (!ya) return html(res, 200, PAGINA_PREPARANDO)
    }
    return hub.reenviar(req, res, u.id, ruta, true)
  }

  /** true si lo atendió (es de un usuario o es una página de la puerta). */
  async function atender(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    if (enUsuario()) return false
    const p = url.pathname
    const token = cookies(req)[COOKIE]
    const esPuerta = p === '/entrar' || p === '/salir' || p === '/alta' || p === '/cuenta' || p.startsWith('/cuenta/') || p === '/usuarios' || p.startsWith('/usuarios/') || p.startsWith('/u/')
    if (!token && !esPuerta) return false

    // Apps, agentes y teléfonos de un usuario: /u/<id>/… con su token (lo verifica su Deprocast).
    const mu = /^\/u\/(\d{1,9})(\/.*)?$/.exec(p)
    if (mu) {
      const id = Number(mu[1])
      const u = usuario(db(), id)
      if (!u || u.estado !== 'activo') return void res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No existe'), true
      const suya = sesionDe(db(), token)?.id === id
      await hub.reenviar(req, res, id, (mu[2] || '/') + url.search, suya)
      return true
    }

    if (req.method === 'POST' && !mismoOrigen(req)) return void res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Origen no permitido'), true

    if (p === '/entrar') {
      if (req.method !== 'POST') return html(res, 200, PAGINA_LOGIN()), true
      const f = leerFormulario(await leerCuerpo(req), String(req.headers['content-type'] ?? ''))
      const email = (f.email ?? '').trim()
      if (!porIp(`ip:${ipDe(req)}`) || (email && !porEmail(`email:${email.toLowerCase()}`))) return html(res, 429, PAGINA_LOGIN({ error: 'Demasiados intentos. Esperá unos minutos.', email })), true
      if (!email) {
        // El dueño, con su clave de siempre (y fuera la sesión de usuario que hubiera en este navegador).
        const c = cookieDeEntrada(f.clave ?? '')
        if (!c) return html(res, 401, PAGINA_LOGIN({ error: 'Clave incorrecta.' })), true
        cerrarSesion(db(), token)
        return ir(res, '/', { 'set-cookie': [c, borrarCookie(COOKIE)] }), true
      }
      const u = await entrar(db(), email, f.clave ?? '')
      if (!u) return html(res, 401, PAGINA_LOGIN({ error: 'Email o contraseña incorrectos.', email })), true
      cerrarSesion(db(), token)
      void hub.asegurar(u.id).catch(() => {}) // que vaya arrancando mientras redirige
      return ir(res, '/', { 'set-cookie': cookieSesion(crearSesion(db(), u.id)) }), true
    }

    if (p === '/salir') {
      cerrarSesion(db(), token)
      return ir(res, '/entrar', { 'set-cookie': [borrarCookie(COOKIE), borrarCookie('mastro')] }), true
    }

    if (p === '/alta') {
      if (req.method !== 'POST') {
        const codigo = url.searchParams.get('codigo') ?? ''
        const inv = verInvitacion(db(), codigo)
        if (!inv) return html(res, 404, pagina('Invitación', '<div class="angosto"><h1>Esta invitación no vale</h1><p class="tenue">No existe, ya se usó o venció. Pedile otra a quien te invitó.</p></div>')), true
        return html(res, 200, PAGINA_ALTA({ codigo, email: inv.email })), true
      }
      if (!porIp(`ip:${ipDe(req)}`)) return html(res, 429, pagina('Invitación', '<p class="error">Demasiados intentos. Esperá unos minutos.</p>')), true
      const f = leerFormulario(await leerCuerpo(req), String(req.headers['content-type'] ?? ''))
      try {
        const u = await alta(db(), { codigo: f.codigo ?? '', email: f.email ?? '', nombre: f.nombre ?? '', clave: f.clave ?? '' })
        void hub.asegurar(u.id).catch(() => {})
        return ir(res, '/', { 'set-cookie': cookieSesion(crearSesion(db(), u.id)) }), true
      } catch (e) {
        const inv = verInvitacion(db(), f.codigo ?? '')
        return html(res, 400, PAGINA_ALTA({ codigo: f.codigo ?? '', email: inv?.email ?? f.email, nombre: f.nombre, error: e instanceof Error ? e.message : String(e) })), true
      }
    }

    if (p === '/usuarios' || p.startsWith('/usuarios/')) {
      if (!autorizado(req)) return ir(res, '/entrar'), true
      return atenderAdmin(req, res, url), true
    }

    const u = sesionDe(db(), token)
    if (!u) {
      // Una sesión vencida o de una cuenta suspendida: fuera la cookie, y a entrar.
      if (p === '/cuenta' || p.startsWith('/cuenta/') || !autorizado(req)) return ir(res, '/entrar', { 'set-cookie': borrarCookie(COOKIE) }), true
      res.setHeader('set-cookie', borrarCookie(COOKIE))
      return false
    }

    if (p === '/cuenta' || p.startsWith('/cuenta/')) {
      const base = `${origen(req)}/u/${u.id}`
      if (req.method !== 'POST') return html(res, 200, PAGINA_CUENTA(u, base)), true
      const f = leerFormulario(await leerCuerpo(req), String(req.headers['content-type'] ?? ''))
      if (p === '/cuenta/clave') {
        try { await cambiarClave(db(), u.id, f.actual ?? '', f.nueva ?? '') } catch (e) { return html(res, 400, PAGINA_CUENTA(u, base, { error: e instanceof Error ? e.message : String(e) })), true }
        return ir(res, '/entrar', { 'set-cookie': borrarCookie(COOKIE) }), true
      }
      if (p === '/cuenta/borrar') {
        if (!porEmail(`email:${u.email.toLowerCase()}`)) return html(res, 429, PAGINA_CUENTA(u, base, { error: 'Demasiados intentos. Esperá unos minutos.' })), true
        if ((f.confirmar ?? '').trim().toLowerCase() !== u.email.toLowerCase() || !(await entrar(db(), u.email, f.clave ?? ''))) return html(res, 400, PAGINA_CUENTA(u, base, { error: 'No coincide el email o la contraseña: no se borró nada.' })), true
        await borrarTodo(u.id)
        return html(res, 200, pagina('Cuenta borrada', '<div class="angosto"><h1>Listo</h1><p class="tenue">Tu cuenta y tu Deprocast se borraron.</p></div>'), { 'set-cookie': borrarCookie(COOKIE) }), true
      }
      return html(res, 404, pagina('No', '<p>No existe.</p>')), true
    }

    await alSuyo(req, res, u, p + url.search)
    return true
  }

  async function borrarTodo(id: number) {
    await hub.parar(id)
    borrarUsuario(db(), id)
    fs.rmSync(dirDeUsuario(o.datos, id), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }

  /** Lo que gastó hoy cada uno (de su propia base, solo lectura). */
  function gastoHoy(id: number): number | null {
    const ruta = path.join(dirDeUsuario(o.datos, id), 'deprocast.db')
    if (!fs.existsSync(ruta)) return null
    try {
      const d = new DatabaseSync(ruta, { readOnly: true })
      try {
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
        return Number((d.prepare(`SELECT COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0) AS t FROM llamadas WHERE en >= ?`).get(hoy.getTime()) as { t: number }).t)
      } finally { d.close() }
    } catch { return null }
  }

  async function atenderAdmin(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const p = url.pathname
    const m = /^\/usuarios\/(\d+)\/(estado|tope|borrar|reiniciar)$/.exec(p)
    const mi = /^\/usuarios\/invitaciones\/(\d+)\/anular$/.exec(p)
    let aviso = ''
    if (req.method === 'POST') {
      const f = leerFormulario(await leerCuerpo(req), String(req.headers['content-type'] ?? ''))
      if (p === '/usuarios/invitar') {
        try {
          const inv = crearInvitacion(db(), { email: f.email, nota: f.nota, dias: Number(f.dias) || 7 })
          aviso = `<p class="ok">Invitación lista${inv.email ? ` para ${esc(inv.email)}` : ''}. Mandale este link (se ve una sola vez, vale ${Number(f.dias) || 7} días y sirve una vez):</p><p><code>${esc(`${origen(req)}/alta?codigo=${inv.codigo}`)}</code></p>`
        } catch (e) { aviso = `<p class="error">${esc(e instanceof Error ? e.message : e)}</p>` }
      } else if (mi) {
        anularInvitacion(db(), Number(mi[1]))
        return ir(res, '/usuarios')
      } else if (m) {
        const id = Number(m[1])
        const u = usuario(db(), id)
        if (!u) return ir(res, '/usuarios')
        if (m[2] === 'estado') { cambiarEstado(db(), id, u.estado === 'activo' ? 'suspendido' : 'activo'); if (u.estado === 'activo') await hub.parar(id); else void hub.asegurar(id).catch(() => {}) }
        if (m[2] === 'tope') { fijarTope(db(), id, Number(f.tokens)); if (u.estado === 'activo') void hub.reiniciar(id).catch(() => {}) } // arranca de nuevo con el tope nuevo
        if (m[2] === 'reiniciar' && u.estado === 'activo') void hub.reiniciar(id).catch(() => {})
        if (m[2] === 'borrar') {
          if ((f.confirmar ?? '').trim().toLowerCase() !== u.email.toLowerCase()) return html(res, 400, paginaBorrar(u, 'Escribí el email exacto para confirmar.'))
          await borrarTodo(id)
        }
        return ir(res, '/usuarios')
      } else return ir(res, '/usuarios')
    } else if (m?.[2] === 'borrar') {
      const u = usuario(db(), Number(m[1]))
      return u ? html(res, 200, paginaBorrar(u)) : ir(res, '/usuarios')
    }
    const vivos = new Map(hub.vivos().map((v) => [v.id, v]))
    const filas = listarUsuarios(db()).map((u) => {
      const g = gastoHoy(u.id)
      return `<tr><td><b>${esc(u.nombre)}</b><br><span class="tenue">${esc(u.email)}</span></td><td>${u.estado === 'activo' ? (vivos.get(u.id)?.listo ? '● prendido' : vivos.has(u.id) ? '◌ arrancando' : 'activo (apagado)') : 'suspendido'}<br><span class="tenue">entró ${fecha(u.ultimo)}</span></td><td>${g === null ? '—' : miles(g)} / ${u.topeDia ? miles(u.topeDia) : '∞'}</td>
<td><div class="fila"><form method="post" action="/usuarios/${u.id}/estado"><button class="sec">${u.estado === 'activo' ? 'Suspender' : 'Reactivar'}</button></form>
<form method="post" action="/usuarios/${u.id}/tope"><input name="tokens" type="number" min="0" step="10000" value="${u.topeDia}" aria-label="Tope de tokens por día" style="width:120px"><button class="sec">Tope</button></form>
${u.estado === 'activo' ? `<form method="post" action="/usuarios/${u.id}/reiniciar"><button class="sec">Reiniciar</button></form>` : ''}<a href="/usuarios/${u.id}/borrar">Borrar…</a></div></td></tr>`
    }).join('')
    const invs = listarInvitaciones(db()).map((i) => `<tr><td>${esc(i.email ?? 'cualquier email')}${i.nota ? `<br><span class="tenue">${esc(i.nota)}</span>` : ''}</td><td>vence ${fecha(i.vence)}</td><td><form method="post" action="/usuarios/invitaciones/${i.id}/anular"><button class="sec">Anular</button></form></td></tr>`).join('')
    return html(res, 200, pagina('Usuarios', `<h1>Usuarios</h1><p class="tenue">Cada usuario tiene su propio Deprocast (su base, su memoria, sus agentes) en un proceso aparte. Usan tu clave de NaN, con un tope de tokens por día cada uno. <a href="/">← Volver</a></p>${aviso}
<h2>Invitar</h2><form method="post" action="/usuarios/invitar"><input type="email" name="email" placeholder="Email (opcional: si lo ponés, solo sirve para ese)"><input name="nota" placeholder="Nota para vos (opcional)"><select name="dias" aria-label="Vence en"><option value="1">Vence en 1 día</option><option value="7" selected>Vence en 7 días</option><option value="30">Vence en 30 días</option></select><button>Generar el link</button></form>
${invs ? `<h2>Invitaciones sin usar</h2><div class="tabla"><table>${invs}</table></div>` : ''}
<h2>Cuentas</h2>${filas ? `<div class="tabla"><table><tr><th>Quién</th><th>Estado</th><th>Tokens hoy / tope</th><th></th></tr>${filas}</table></div>` : '<p class="tenue">Todavía nadie.</p>'}
<p class="tenue">Prendidos ahora: ${vivos.size}. Cada cuenta activa queda prendida siempre (si se cae, vuelve sola); suspender la apaga y borrar la elimina.</p>`))
  }

  const paginaBorrar = (u: Usuario, error = '') => pagina('Borrar', `<form method="post" action="/usuarios/${u.id}/borrar" class="angosto"><h1>¿Borrar a ${esc(u.nombre)}?</h1><p class="tenue">Se borra su cuenta y su Deprocast entero (base, archivos, agentes). No se puede deshacer.</p>${error ? `<p class="error">${esc(error)}</p>` : ''}<input name="confirmar" placeholder="Escribí ${esc(u.email)}" autocomplete="off" required><button class="mal">Borrar para siempre</button><a href="/usuarios">Cancelar</a></form>`)

  return { atender, hub, cuentas: db, prenderTodos }
}
