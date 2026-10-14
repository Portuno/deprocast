/**
 * Arranque en la nube que no depende del deploy de la plataforma: baja de GitHub el código más nuevo de la rama, lo
 * deja en el disco persistente y corre ese servidor. Cada tanto mira si la rama se movió y, si sí, baja la versión
 * nueva y reinicia el servidor con ella. Si GitHub no responde, sigue con la última bajada (o con la de la imagen); si
 * una versión se cae apenas arranca, vuelve a la anterior y no la reintenta.
 *
 * Sin MASTRO_REPO no baja nada: corre el servidor de la imagen, igual que antes.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const REPO = process.env.MASTRO_REPO ?? ''
const RAMA = process.env.MASTRO_RAMA ?? 'main'
const DIR = process.env.MASTRO_CODIGO ?? '/data/codigo'
const CADA_MS = Number(process.env.MASTRO_ACTUALIZAR_MIN ?? 5) * 60_000
const PROPIO = path.resolve(import.meta.dirname, '..')
const CAIDA_RAPIDA_MS = 30_000

const log = (t: string) => console.log(`  ⟳ ${t}`)

/** El commit de la punta de la rama, por el protocolo de git (no gasta el límite de la API de GitHub). */
export async function shaDeRama(repo: string, rama: string, f: typeof fetch = fetch): Promise<string | null> {
  const r = await f(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`, { signal: AbortSignal.timeout(15_000) })
  if (!r.ok) return null
  const m = new RegExp(`([0-9a-f]{40}) refs/heads/${rama.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w./-])`).exec(await r.text())
  return m?.[1] ?? null
}

/** Baja el código de ese commit a DIR/<sha> (si ya está, no hace nada) y le presta los node_modules de la imagen. */
async function bajar(sha: string): Promise<string> {
  const destino = path.join(DIR, sha)
  if (fs.existsSync(path.join(destino, 'src', 'servidor.ts'))) return destino
  fs.mkdirSync(DIR, { recursive: true })
  const r = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${sha}`, { signal: AbortSignal.timeout(120_000) })
  if (!r.ok) throw new Error(`GitHub respondió ${r.status}`)
  const tgz = Buffer.from(await r.arrayBuffer())
  const tmp = `${destino}.tmp`
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp)
  execFileSync('tar', ['-xz', '--strip-components=1'], { cwd: tmp, input: tgz, maxBuffer: 64 * 1024 * 1024 })
  if (!fs.existsSync(path.join(tmp, 'src', 'servidor.ts'))) throw new Error('el paquete no trae src/servidor.ts')
  fs.rmSync(destino, { recursive: true, force: true })
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, destino)
      break
    } catch (e) {
      if (i >= 10) throw e // en Windows el antivirus tiene un rato tomados los archivos recién extraídos
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  const nm = path.join(PROPIO, 'node_modules')
  if (fs.existsSync(nm)) try { fs.symlinkSync(nm, path.join(destino, 'node_modules'), 'junction') } catch { /* sin dependencias, también anda */ }
  return destino
}

const archivoActual = () => path.join(DIR, 'actual')
const shaDe = (dir: string) => (dir === PROPIO ? 'imagen' : path.basename(dir))

function ultimaBajada(): string | null {
  try {
    const sha = fs.readFileSync(archivoActual(), 'utf8').trim()
    const dir = path.join(DIR, sha)
    return fs.existsSync(path.join(dir, 'src', 'servidor.ts')) ? dir : null
  } catch {
    return null
  }
}

/** Deja en disco solo las versiones que sirven (la que corre y la anterior). */
function limpiar(mantener: string[]) {
  try {
    for (const d of fs.readdirSync(DIR)) if (d !== 'actual' && !mantener.includes(d)) fs.rmSync(path.join(DIR, d), { recursive: true, force: true })
  } catch { /* nada que limpiar */ }
}

async function buscar(malas: Set<string>): Promise<string | null> {
  try {
    const sha = await shaDeRama(REPO, RAMA)
    if (!sha || malas.has(sha)) return null
    return await bajar(sha)
  } catch (e) {
    log(`no pude traer la versión nueva: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

async function principal() {
  const malas = new Set<string>()
  let codigo = PROPIO
  let anterior = PROPIO
  if (REPO) codigo = (await buscar(malas)) ?? ultimaBajada() ?? PROPIO
  let hijo: ChildProcess | null = null
  let saliendo = false
  let arranco = 0

  const correr = () => {
    if (codigo !== PROPIO) fs.writeFileSync(archivoActual(), shaDe(codigo))
    log(`arranco el servidor (${shaDe(codigo).slice(0, 7)})`)
    arranco = Date.now()
    const este = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(codigo, 'src', 'servidor.ts'), ...process.argv.slice(2)], {
      cwd: codigo,
      stdio: 'inherit',
      env: { ...process.env, MASTRO_COMMIT: shaDe(codigo) },
    })
    hijo = este
    este.on('exit', (code) => {
      if (saliendo) process.exit(code ?? 0)
      if (hijo !== este) return // lo bajamos nosotros para cambiar de versión
      if (Date.now() - arranco < CAIDA_RAPIDA_MS && codigo !== PROPIO) {
        malas.add(shaDe(codigo))
        log(`la versión ${shaDe(codigo).slice(0, 7)} se cayó al arrancar: vuelvo a la anterior`)
        codigo = anterior === codigo ? PROPIO : anterior
      } else log(`el servidor salió (${code}): lo vuelvo a arrancar`)
      setTimeout(correr, 1000)
    })
  }

  const cambiarA = async (dir: string) => {
    const viejo = hijo
    hijo = null
    if (viejo && viejo.exitCode == null) {
      await new Promise<void>((r) => {
        viejo.once('exit', () => r())
        viejo.kill('SIGTERM')
        setTimeout(() => viejo.kill('SIGKILL'), 10_000).unref()
      })
    }
    anterior = codigo
    codigo = dir
    correr()
  }

  for (const s of ['SIGTERM', 'SIGINT'] as const) {
    process.on(s, () => {
      saliendo = true
      if (hijo && hijo.exitCode == null) hijo.kill(s)
      else process.exit(0)
    })
  }

  correr()
  if (!REPO) return
  setInterval(async () => {
    const dir = await buscar(malas)
    if (!dir || dir === codigo || saliendo) return
    log(`hay versión nueva (${shaDe(dir).slice(0, 7)}): reinicio el servidor con ella`)
    await cambiarA(dir)
    limpiar([shaDe(codigo), shaDe(anterior)])
  }, CADA_MS)
}

if (import.meta.main) await principal()
