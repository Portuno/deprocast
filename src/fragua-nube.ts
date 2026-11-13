/**
 * La Fragua que se prueba sola (plan v38, fase 2).
 *
 * - En la nube no hay git (el código baja como paquete): la Fragua forja sobre una COPIA del código que está corriendo,
 *   y si todo pasa abre un pull request en GitHub (con un token que solo puede tocar este repo, GITHUB_FRAGUA_TOKEN).
 *   «Aprobar» lo mergea; el supervisor de la nube lo baja y lo releva como cualquier push.
 * - Antes de ofrecer un cambio, además del typecheck y los tests, una PRUEBA DE HUMO: levanta el servidor forjado en un
 *   puerto libre con una base nueva (sin claves, sin rutinas, sin Telegram ni WhatsApp), recorre las rutas principales y
 *   compila cada script de la pantalla.
 * - Después de aprobarlo, la vigila: si la versión nueva no llega a correr en 15 minutos (el supervisor se queda con la
 *   vieja), la revierte sola en main y le avisa.
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { Db } from './db.ts'

// ─── GitHub ─────────────────────────────────────────────────────────────

const repoDe = () => process.env.MASTRO_REPO?.trim() ?? ''
const tokenDe = () => process.env.GITHUB_FRAGUA_TOKEN?.trim() ?? ''
export const githubDisponible = () => !!(repoDe() && tokenDe())

let red: typeof fetch = (...a) => fetch(...a)
export function _probarGithub(f: typeof fetch) { red = f }

/**
 * El vencimiento del token (Fragua #215): GitHub lo manda en cada respuesta a un token con fecha
 * (github-authentication-token-expiration). Se guarda el último visto y si el último pedido volvió 401.
 */
let venceVisto: number | null = null
let vencidoVisto: boolean | null = null
export const vencimientoVisto = () => ({ vence: venceVisto, vencido: vencidoVisto })
export function _probarVencimiento(v: { vence: number | null; vencido: boolean | null }) { venceVisto = v.vence; vencidoVisto = v.vencido }
/** «2027-02-08 15:00:00 UTC» o «2027-02-08 12:00:00 -0300» → ms. */
export function leerVencimiento(v: string | null | undefined): number | null {
  if (!v) return null
  const iso = v.trim().replace(' ', 'T').replace(/ UTC$/, 'Z').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2')
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

async function gh<T = any>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await red(`https://api.github.com/repos/${repoDe()}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${tokenDe()}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'deprocast-fragua', ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(60_000),
  })
  const vence = leerVencimiento(r.headers.get('github-authentication-token-expiration'))
  if (vence) venceVisto = vence
  if (r.status === 401) vencidoVisto = true
  else if (r.ok) vencidoVisto = false
  const texto = await r.text()
  const j = texto ? (() => { try { return JSON.parse(texto) } catch { return texto } })() : null
  if (!r.ok) throw Object.assign(new Error(`GitHub ${r.status}: ${j?.message ?? String(texto).slice(0, 200)}`), { status: r.status })
  return j as T
}

/**
 * Abre el pull request con los archivos cambiados, sobre el commit que está corriendo (o main): blobs → árbol → commit
 * → rama fragua/<id> → PR. Devuelve su número y su link.
 */
export async function abrirPullRequest(p: { id: number; titulo: string; cuerpo: string; archivos: { ruta: string; contenido: string }[]; base?: string | null }) {
  const base = p.base || (await gh<{ sha: string }>('GET', '/commits/main')).sha
  const arbolBase = (await gh<{ tree: { sha: string } }>('GET', `/git/commits/${base}`)).tree.sha
  const entradas = []
  for (const a of p.archivos) {
    const b = await gh<{ sha: string }>('POST', '/git/blobs', { content: a.contenido, encoding: 'utf-8' })
    entradas.push({ path: a.ruta, mode: '100644', type: 'blob', sha: b.sha })
  }
  const arbol = await gh<{ sha: string }>('POST', '/git/trees', { base_tree: arbolBase, tree: entradas })
  const commit = await gh<{ sha: string }>('POST', '/git/commits', { message: `Forja #${p.id}: ${p.titulo}`, tree: arbol.sha, parents: [base] })
  const rama = `fragua/${p.id}`
  try { await gh('POST', '/git/refs', { ref: `refs/heads/${rama}`, sha: commit.sha }) } catch (e) {
    if ((e as { status?: number }).status !== 422) throw e
    await gh('PATCH', `/git/refs/heads/${rama}`, { sha: commit.sha, force: true }) // la rama ya estaba (otra vuelta)
  }
  const pr = await gh<{ number: number; html_url: string }>('POST', '/pulls', { title: `Forja #${p.id}: ${p.titulo}`, head: rama, base: 'main', body: p.cuerpo })
  return { numero: pr.number, url: pr.html_url, rama }
}

/** Aprobar: mergea el PR (squash) y borra su rama. Devuelve el commit que quedó en main. */
export async function mergearPullRequest(numero: number, titulo: string, rama: string): Promise<string> {
  const r = await gh<{ sha: string; merged: boolean; message?: string }>('PUT', `/pulls/${numero}/merge`, { merge_method: 'squash', commit_title: titulo })
  if (!r.merged) throw new Error(r.message ?? 'GitHub no lo mergeó')
  try { await gh('DELETE', `/git/refs/heads/${rama}`) } catch { /* la rama ya no estaba */ }
  return r.sha
}

export async function cerrarPullRequest(numero: number, rama: string) {
  try { await gh('PATCH', `/pulls/${numero}`, { state: 'closed' }) } catch { /* ya cerrado */ }
  try { await gh('DELETE', `/git/refs/heads/${rama}`) } catch { /* la rama ya no estaba */ }
}

/**
 * Revierte en main un cambio mergeado: un commit nuevo con el árbol de antes. Solo si es lo último que hay en main (si
 * después entró otra cosa, revertirlo así se la llevaría puesta: eso se hace a mano).
 */
export async function revertirEnMain(mergeSha: string, motivo: string): Promise<string> {
  const head = (await gh<{ sha: string }>('GET', '/commits/main')).sha
  if (head !== mergeSha) throw new Error('Después entró otro cambio a main: este hay que revertirlo a mano (git revert) para no llevarse lo otro')
  const c = await gh<{ parents: { sha: string }[] }>('GET', `/git/commits/${mergeSha}`)
  const padre = c.parents[0]?.sha
  if (!padre) throw new Error('No encuentro el commit anterior')
  const arbol = (await gh<{ tree: { sha: string } }>('GET', `/git/commits/${padre}`)).tree.sha
  const nuevo = await gh<{ sha: string }>('POST', '/git/commits', { message: `Revertir ${mergeSha.slice(0, 7)}: ${motivo}`, tree: arbol, parents: [mergeSha] })
  await gh('PATCH', '/git/refs/heads/main', { sha: nuevo.sha })
  return nuevo.sha
}

/** Un pedido liviano al repo, para saber si el token sigue valiendo (y leer su vencimiento). */
export async function tocarGithub(): Promise<{ ok: boolean; status: number | null }> {
  try { await gh('GET', ''); return { ok: true, status: 200 } } catch (e) { return { ok: false, status: (e as { status?: number }).status ?? null } }
}

/** Un commit (o un pull request mergeado) que puede nombrar propuestas de la Fragua (Fragua #211). */
export type CommitRef = { sha: string; url: string | null; autor: string; fecha: string; mensaje: string; pr?: number | null }

/** Los commits de main desde una fecha (hasta 500). */
export async function commitsDesde(desde: string): Promise<CommitRef[]> {
  const out: CommitRef[] = []
  for (let pagina = 1; pagina <= 5; pagina++) {
    const xs = await gh<any[]>('GET', `/commits?sha=main&since=${encodeURIComponent(desde)}&per_page=100&page=${pagina}`)
    out.push(...xs.map((c) => ({ sha: String(c.sha), url: c.html_url ?? null, autor: c.author?.login ?? c.commit?.author?.name ?? '?', fecha: c.commit?.committer?.date ?? c.commit?.author?.date ?? new Date().toISOString(), mensaje: String(c.commit?.message ?? '') })))
    if (xs.length < 100) break
  }
  return out
}

/** Los pull requests mergeados desde una fecha (su título y su descripción también pueden nombrar propuestas). */
export async function prsMergeadosDesde(desde: string): Promise<CommitRef[]> {
  const xs = await gh<any[]>('GET', '/pulls?state=closed&sort=updated&direction=desc&per_page=50')
  return xs.filter((p) => p.merged_at && p.merged_at >= desde).map((p) => ({ sha: String(p.merge_commit_sha ?? `pr-${p.number}`), url: p.html_url ?? null, autor: p.user?.login ?? '?', fecha: p.merged_at, mensaje: `${p.title ?? ''}\n\n${p.body ?? ''}`, pr: p.number }))
}

// ─── el taller de copia ─────────────────────────────────────────────────

// La app móvil: los tests leen su código (la conciencia acústica, la lógica de Mobile 1.0) y su configuración; sin eso,
// toda forja de la nube fallaba esos tests aunque no tocara nada de la app (forjas #14–#17, Fragua #266). Solo el código
// y la configuración: ni dist ni node_modules. Un test verifica que todo lo que leen los tests esté acá.
export const COPIAR = ['src', 'web', 'test', 'scripts', 'docs', 'apps/movil/src', 'apps/movil/App.tsx', 'apps/movil/index.ts', 'apps/movil/app.json', 'apps/movil/package.json', 'package.json', 'tsconfig.json', 'README.md']

/** Copia el código que está corriendo a un taller aparte (con los node_modules prestados). */
export function prepararCopia(origen: string, destino: string) {
  fs.rmSync(destino, { recursive: true, force: true })
  fs.mkdirSync(destino, { recursive: true })
  for (const x of COPIAR) {
    const de = path.join(origen, x)
    if (fs.existsSync(de)) fs.cpSync(de, path.join(destino, x), { recursive: true })
  }
  const nm = path.join(origen, 'node_modules')
  if (fs.existsSync(nm)) try { fs.symlinkSync(fs.realpathSync(nm), path.join(destino, 'node_modules'), 'junction') } catch { /* sin dependencias */ }
}

export function borrarCopia(dir: string) {
  const nm = path.join(dir, 'node_modules')
  try { if (fs.lstatSync(nm).isSymbolicLink()) fs.unlinkSync(nm) } catch { /* no había */ }
  fs.rmSync(dir, { recursive: true, force: true })
}

/** Un diff unificado simple de un archivo (lo cambiado, con tres líneas de contexto): sin git, para leerlo en la pantalla. */
export function diffDe(ruta: string, antes: string | null, despues: string): string {
  const lineas = (t: string) => { const l = t.split('\n'); if (l.at(-1) === '') l.pop(); return l } // el salto final no es una línea
  const a = antes == null ? [] : lineas(antes)
  const b = lineas(despues)
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  if (p === a.length && p === b.length) return ''
  const desde = Math.max(0, p - 3)
  const ctxFin = Math.min(3, s)
  const viejas = a.slice(p, a.length - s)
  const nuevas = b.slice(p, b.length - s)
  return [
    `--- ${antes == null ? '/dev/null' : `a/${ruta}`}`, `+++ b/${ruta}`,
    `@@ -${desde + 1},${p - desde + viejas.length + ctxFin} +${desde + 1},${p - desde + nuevas.length + ctxFin} @@`,
    ...a.slice(desde, p).map((l) => ` ${l}`), ...viejas.map((l) => `-${l}`), ...nuevas.map((l) => `+${l}`), ...a.slice(a.length - s, a.length - s + ctxFin).map((l) => ` ${l}`),
  ].join('\n')
}

// ─── la prueba de humo ──────────────────────────────────────────────────

/** Las rutas que una versión sana tiene que contestar (sin 5xx). */
export const RUTAS_HUMO = ['/version', '/', '/api/estado', '/api/meta', '/api/hoy', '/api/hoy/hud', '/api/bandeja', '/api/menciones', '/api/chat', '/api/personas', '/api/academia', '/api/criba72', '/api/prensa', '/api/programados', '/api/fragua']

const puertoLibre = () => new Promise<number>((ok, mal) => { const s = net.createServer(); s.unref(); s.on('error', mal); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)) }) })

/**
 * Levanta el servidor de `dir` con una base nueva y sin nada de afuera, recorre las rutas y compila los scripts de la
 * pantalla. ok = arrancó, ninguna ruta dio 5xx y todos los scripts compilan.
 */
export async function pruebaDeHumo(dir: string, entorno: NodeJS.ProcessEnv, o: { esperaMs?: number } = {}): Promise<{ ok: boolean; salida: string }> {
  const lineas: string[] = ['$ prueba de humo']
  let ok = true
  // Los scripts de la pantalla: que compilen (un error de sintaxis deja la web en blanco).
  const js = path.join(dir, 'web', 'js')
  if (fs.existsSync(js)) for (const f of fs.readdirSync(js).filter((x) => x.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', path.join(js, f)], { encoding: 'utf8', timeout: 30_000 })
    if (r.status !== 0) { ok = false; lineas.push(`✖ web/js/${f} no compila: ${(r.stderr ?? '').split('\n').find((l) => /Error/.test(l)) ?? 'error'}`) }
  }
  const puerto = await puertoLibre()
  const base = path.join(dir, 'data', 'humo')
  fs.mkdirSync(base, { recursive: true })
  const env = { ...entorno, MASTRO_PUERTO: String(puerto), MASTRO_DB: path.join(base, 'humo.db'), MASTRO_CARGAS: path.join(base, 'cargas'), MASTRO_SIN_RUTINAS: '1', MASTRO_SIN_PRECALENTAR: '1', MASTRO_TELEGRAM: '0', MASTRO_SUPERVISOR: '0' }
  const hijo = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join('src', 'servidor.ts')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  hijo.stdout?.on('data', (d) => { log = (log + d).slice(-4000) })
  hijo.stderr?.on('data', (d) => { log = (log + d).slice(-4000) })
  const t0 = Date.now()
  try {
    let arranco = false
    while (Date.now() - t0 < (o.esperaMs ?? 90_000)) {
      if (hijo.exitCode != null) break
      try { if ((await fetch(`http://127.0.0.1:${puerto}/version`, { signal: AbortSignal.timeout(2000) })).ok) { arranco = true; break } } catch { /* todavía no */ }
      await new Promise((r) => setTimeout(r, 500))
    }
    if (!arranco) {
      lineas.push(`✖ el servidor no arrancó en ${Math.round((Date.now() - t0) / 1000)} s`, log.split('\n').filter(Boolean).slice(-12).join('\n'))
      return { ok: false, salida: lineas.join('\n') }
    }
    lineas.push(`✔ arrancó en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    for (const r of RUTAS_HUMO) {
      const t = Date.now()
      try {
        const x = await fetch(`http://127.0.0.1:${puerto}${r}`, { signal: AbortSignal.timeout(20_000) })
        if (x.status >= 500) { ok = false; lineas.push(`✖ ${r} → ${x.status}: ${(await x.text()).slice(0, 160)}`) } else lineas.push(`✔ ${r} → ${x.status} (${Date.now() - t} ms)`)
      } catch (e) { ok = false; lineas.push(`✖ ${r} → no contestó: ${e instanceof Error ? e.message : e}`) }
    }
    return { ok, salida: lineas.join('\n') }
  } finally {
    // Que termine de verdad antes de borrar su base (en Windows, el archivo sigue tomado un rato).
    if (hijo.exitCode == null) await new Promise<void>((ok) => { hijo.once('exit', () => ok()); hijo.kill(); setTimeout(ok, 5000).unref() })
    try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }) } catch { /* se borra con la copia */ }
  }
}

// ─── la vigilancia después de aprobar ───────────────────────────────────

/**
 * Cada pocos minutos, en la nube: una forja aprobada cuyo commit no llegó a correr en 15 minutos (el supervisor se quedó
 * con la versión vieja porque la nueva no levantó) se revierte en main y se le avisa. Si llegó a correr, queda vigilada.
 */
export async function vigilarAprobadas(db: Db, ahora = Date.now(), avisar: (texto: string) => void = () => {}): Promise<number> {
  if (!githubDisponible()) return 0
  const corriendo = process.env.MASTRO_COMMIT ?? null
  const filas = db.prepare(`SELECT id, merge_sha, resuelta_en, pedido FROM fragua WHERE estado = 'aplicada' AND modo = 'pr' AND merge_sha IS NOT NULL AND vigilada = 0 AND resuelta_en > ?`).all(ahora - 6 * 3_600_000) as { id: number; merge_sha: string; resuelta_en: number; pedido: string }[]
  let revertidas = 0
  for (const f of filas) {
    if (corriendo && corriendo === f.merge_sha) { db.prepare('UPDATE fragua SET vigilada = 1 WHERE id = ?').run(f.id); continue }
    if (ahora - f.resuelta_en < 15 * 60_000) continue
    const titulo = f.pedido.split('\n')[0].slice(0, 80)
    try {
      await revertirEnMain(f.merge_sha, `la Fragua #${f.id} no levantó en la nube`)
      db.prepare(`UPDATE fragua SET estado = 'revertida', vigilada = 1, salida = COALESCE(salida, '') || ? WHERE id = ?`).run('\n\n(Revertida sola: la versión nueva no llegó a correr en 15 minutos.)', f.id)
      revertidas++
      avisar(`⚠️ La Fragua #${f.id} («${titulo}») no levantó en la nube: la revertí sola y quedó lo de antes. Está en La Fragua para revisarla.`)
    } catch (e) {
      db.prepare('UPDATE fragua SET vigilada = 1 WHERE id = ?').run(f.id)
      avisar(`⚠️ La Fragua #${f.id} («${titulo}») no levantó en la nube y no pude revertirla sola: ${e instanceof Error ? e.message : e}`)
    }
  }
  return revertidas
}
