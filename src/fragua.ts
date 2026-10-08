/**
 * La Fragua: Mastropiero se mejora a sí mismo, pero nunca sobre lo que está andando. Toma una propuesta de mejora,
 * elige los archivos, escribe los cambios (buscar → reemplazar, exactos), los aplica en una copia aparte del repo (un
 * git worktree en la rama fragua/<n>), corre el typecheck y los tests ahí, y deja el diff para que él lo lea.
 * Solo con su ok (desde la pantalla) se mergea a main; después hay que reiniciar el servidor. Si algo falla, la rama
 * queda para revisar o se descarta, y main no se enteró.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { type Db } from './db.ts'
import { pedirJson } from './modelo.ts'

export type Forja = {
  id: number
  propuestaId: number | null
  pedido: string
  rama: string
  estado: 'haciendo' | 'lista' | 'rota' | 'fallo' | 'aplicada' | 'descartada'
  resumen: string | null
  archivos: string[]
  diff: string | null
  salida: string | null
  creadaEn: number
  resueltaEn: number | null
}

const deFila = (r: any): Forja => ({
  id: r.id, propuestaId: r.propuesta_id, pedido: r.pedido, rama: r.rama, estado: r.estado, resumen: r.resumen, archivos: r.archivos ? JSON.parse(r.archivos) : [],
  diff: r.diff, salida: r.salida, creadaEn: r.creada_en, resueltaEn: r.resuelta_en,
})

export const leerForja = (db: Db, id: number): Forja | null => { const r = db.prepare('SELECT * FROM fragua WHERE id = ?').get(id); return r ? deFila(r) : null }
export const listarForjas = (db: Db): Forja[] => db.prepare('SELECT * FROM fragua ORDER BY id DESC LIMIT 40').all().map(deFila)

type Opciones = {
  repo?: string
  /** Typecheck + tests dentro del worktree; devuelve ok y la salida. Inyectable para tests. */
  verificar?: (dir: string, repo: string) => { ok: boolean; salida: string }
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** Los tests corren como `npm test`: sin las claves ni la configuración del .env (y sin poder gastar ni publicar). */
function entornoLimpio(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(NAN_|GCAL_|TELEGRAM_|TAVILY_|BRAVE_|MASTRO_|OPENAI|ANTHROPIC|GITHUB_|GH_)/i.test(k) && !/(KEY|TOKEN|SECRET|CLAVE|PASSWORD)/i.test(k)))
}

/** Por defecto: el tsc y los tests del repo principal, corridos sobre la copia (el worktree no tiene node_modules). */
function verificarDefecto(dir: string, repo: string): { ok: boolean; salida: string } {
  const tsc = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc')
  const pasos: [string, string[]][] = [
    ...(fs.existsSync(tsc) ? [[process.execPath, [tsc, '-p', 'tsconfig.json']] as [string, string[]]] : []),
    [process.execPath, ['--disable-warning=ExperimentalWarning', '--test', 'test/**/*.test.ts']],
  ]
  const salida: string[] = []
  for (const [cmd, args] of pasos) {
    const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 10 * 60_000, env: entornoLimpio() })
    const txt = `${r.stdout ?? ''}${r.stderr ?? ''}`
    salida.push(`$ ${path.basename(args[0] === tsc ? 'tsc' : 'node --test')}\n${txt.split('\n').filter((l) => /✖|error|fail|ℹ (tests|pass|fail)/i.test(l)).slice(0, 60).join('\n')}`)
    if (r.status !== 0) return { ok: false, salida: salida.join('\n\n') }
  }
  return { ok: true, salida: salida.join('\n\n') }
}

const SISTEMA_ARCHIVOS = `Sos el herrero de La Fragua: mejorás el código de Mastropiero (Node 24, TypeScript nativo, node:sqlite, sin dependencias; frontend en web/js/*.js clásico).
Te paso una propuesta de mejora y la lista de archivos del repo. Elegí los archivos que hay que tocar o leer para hacerla (máximo 6), incluido el test que corresponda.
Forma: {"archivos": [string]}`

const SISTEMA_CAMBIOS = `Sos el herrero de La Fragua: mejorás el código de Mastropiero (Node 24, TypeScript nativo, node:sqlite, sin dependencias; frontend en web/js/*.js clásico; textos en castellano rioplatense).
Te paso la propuesta y el contenido de los archivos. Escribí los cambios mínimos y completos para hacerla, con su test si corresponde, siguiendo el estilo del código.
Forma: {"resumen": string (qué cambia y por qué, 2-4 oraciones), "cambios": [{"archivo": string, "buscar": string, "reemplazar": string}]}
- "buscar" es un tramo EXACTO y ÚNICO del archivo actual (copialo tal cual, con su sangría, de 2 a 15 líneas). Para crear un archivo nuevo, "buscar" va vacío y "reemplazar" es el archivo entero.
- Nada de cambios cosméticos ni refactors que no pidió la propuesta.`

/** Aplica los cambios buscar → reemplazar; cada «buscar» tiene que aparecer exactamente una vez. */
export function aplicarCambios(dir: string, cambios: { archivo: string; buscar: string; reemplazar: string }[]): string[] {
  const tocados: string[] = []
  for (const c of cambios) {
    const rel = path.normalize(String(c.archivo ?? '')).replace(/^([/\\])+/, '')
    if (!rel || rel.startsWith('..') || /(^|[/\\])(\.git|node_modules|data)([/\\]|$)|\.env/.test(rel)) throw new Error(`Archivo no permitido: ${c.archivo}`)
    const ruta = path.join(dir, rel)
    if (!c.buscar) {
      if (fs.existsSync(ruta)) throw new Error(`${rel} ya existe (para cambiarlo, «buscar» no puede ir vacío)`)
      fs.mkdirSync(path.dirname(ruta), { recursive: true })
      fs.writeFileSync(ruta, c.reemplazar)
    } else {
      if (!fs.existsSync(ruta)) throw new Error(`No existe ${rel}`)
      const s = fs.readFileSync(ruta, 'utf8')
      const i = s.indexOf(c.buscar)
      if (i < 0) throw new Error(`En ${rel} no encontré el tramo a reemplazar: «${c.buscar.slice(0, 80)}…»`)
      if (s.indexOf(c.buscar, i + 1) >= 0) throw new Error(`En ${rel} el tramo a reemplazar aparece más de una vez`)
      fs.writeFileSync(ruta, s.slice(0, i) + c.reemplazar + s.slice(i + c.buscar.length))
    }
    tocados.push(rel.split(path.sep).join('/'))
  }
  return [...new Set(tocados)]
}

const dirDe = (repo: string, id: number) => path.join(repo, 'data', 'fragua', String(id))

/** Forja una propuesta (o un pedido en palabras) en su propia rama. No toca main. */
export async function forjarMejora(db: Db, p: { propuestaId?: number | null; pedido?: string | null }, o: Opciones = {}, ahora = Date.now()): Promise<Forja> {
  const repo = path.resolve(o.repo ?? process.cwd())
  const prop = p.propuestaId ? db.prepare('SELECT * FROM propuestas WHERE id = ?').get(p.propuestaId) as any : null
  if (p.propuestaId && !prop) throw new Error(`No existe la propuesta ${p.propuestaId}`)
  const pedido = prop ? `${prop.titulo}\n\n${prop.detalle}` : String(p.pedido ?? '').trim()
  if (!pedido) throw new Error('¿Qué mejora querés forjar?')
  if (db.prepare(`SELECT 1 FROM fragua WHERE estado = 'haciendo'`).get()) throw new Error('Ya hay algo en la fragua; esperá que termine')
  const r = db.prepare(`INSERT INTO fragua (propuesta_id, pedido, rama, estado, creada_en) VALUES (?, ?, '', 'haciendo', ?)`).run(prop?.id ?? null, pedido, ahora)
  const id = Number(r.lastInsertRowid)
  const rama = `fragua/${id}`
  const dir = dirDe(repo, id)
  const fin = (c: Partial<Forja> & { estado: Forja['estado'] }) => {
    db.prepare('UPDATE fragua SET rama = ?, estado = ?, resumen = ?, archivos = ?, diff = ?, salida = ? WHERE id = ?')
      .run(rama, c.estado, c.resumen ?? null, JSON.stringify(c.archivos ?? []), c.diff ?? null, c.salida ?? null, id)
    return leerForja(db, id)!
  }
  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    git(repo, 'worktree', 'add', '-b', rama, dir, 'HEAD')
    // node_modules del repo, enlazado (junction): el typecheck necesita los tipos. Se desenlaza antes de borrar la copia.
    if (fs.existsSync(path.join(repo, 'node_modules'))) fs.symlinkSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'), 'junction')
    const lista = git(dir, 'ls-files').split('\n').filter((f) => /^(src|web|test|scripts)\//.test(f) || /^(README\.md|package\.json)$/.test(f))
    const { datos: elegidos } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'fragua' }, SISTEMA_ARCHIVOS, `PROPUESTA:\n${pedido}\n\nARCHIVOS:\n${lista.join('\n')}`, { temperatura: 0.1, maxTokens: 800 })
    const archivos = (Array.isArray(elegidos.archivos) ? elegidos.archivos : []).map(String).filter((f: string) => lista.includes(f)).slice(0, 6)
    if (!archivos.length) return fin({ estado: 'fallo', salida: 'No supe qué archivos tocar para esta propuesta.' })
    const contenido = archivos.map((f: string) => `=== ${f} ===\n${fs.readFileSync(path.join(dir, f), 'utf8')}`).join('\n\n')
    const { datos: plan } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'fragua' }, SISTEMA_CAMBIOS, `PROPUESTA:\n${pedido}\n\n${contenido}`, { temperatura: 0.2, maxTokens: 12000 })
    const cambios = Array.isArray(plan.cambios) ? plan.cambios : []
    if (!cambios.length) return fin({ estado: 'fallo', resumen: plan.resumen ?? null, salida: 'El modelo no propuso cambios.' })
    let tocados: string[]
    try { tocados = aplicarCambios(dir, cambios) } catch (e) { return fin({ estado: 'fallo', resumen: plan.resumen ?? null, salida: e instanceof Error ? e.message : String(e) }) }
    const v = (o.verificar ?? verificarDefecto)(dir, repo)
    git(dir, 'add', '-A') // node_modules está en .gitignore
    git(dir, '-c', 'user.name=La Fragua', '-c', 'user.email=fragua@mastropiero.local', 'commit', '-q', '-m', `Fragua #${id}: ${String(plan.resumen ?? pedido).split('\n')[0].slice(0, 70)}`)
    const diff = git(dir, 'diff', 'HEAD~1', 'HEAD')
    return fin({ estado: v.ok ? 'lista' : 'rota', resumen: plan.resumen ?? null, archivos: tocados, diff: diff.slice(0, 200_000), salida: v.salida })
  } catch (e) {
    return fin({ estado: 'fallo', salida: e instanceof Error ? e.message : String(e) })
  }
}

function limpiar(repo: string, f: Forja, borrarRama: boolean) {
  const dir = dirDe(repo, f.id)
  const enlace = path.join(dir, 'node_modules')
  try { if (fs.lstatSync(enlace).isSymbolicLink()) fs.unlinkSync(enlace) } catch { /* no había */ }
  try { git(repo, 'worktree', 'remove', '--force', dir) } catch { /* ya no estaba */ }
  if (borrarRama && f.rama) { try { git(repo, 'branch', '-D', f.rama) } catch { /* ya no estaba */ } }
}

/**
 * Su ok: mergea la rama a la rama actual del repo. Solo si la forja pasó los tests y el repo está limpio (no pisa
 * cambios suyos sin commitear). Después hay que reiniciar el servidor para que corra lo nuevo.
 */
export function aplicarForja(db: Db, id: number, o: Opciones = {}, ahora = Date.now()): Forja {
  const repo = path.resolve(o.repo ?? process.cwd())
  const f = leerForja(db, id)
  if (!f) throw new Error(`No existe la forja ${id}`)
  if (f.estado !== 'lista') throw new Error(`La forja ${id} está «${f.estado}»: solo se aplica una que pasó los tests`)
  const sucio = git(repo, 'status', '--porcelain', '--untracked-files=no')
  if (sucio) throw new Error('Hay cambios sin commitear en el repo: commitealos o descartalos antes de aplicar una forja')
  git(repo, '-c', 'user.name=La Fragua', '-c', 'user.email=fragua@mastropiero.local', 'merge', '--no-ff', '-q', '-m', `Fragua #${id} aplicada`, f.rama)
  limpiar(repo, f, true)
  db.prepare(`UPDATE fragua SET estado = 'aplicada', resuelta_en = ? WHERE id = ?`).run(ahora, id)
  if (f.propuestaId) db.prepare(`UPDATE propuestas SET estado = 'aceptada', resuelta_en = ? WHERE id = ?`).run(ahora, f.propuestaId)
  return leerForja(db, id)!
}

export function descartarForja(db: Db, id: number, o: Opciones = {}, ahora = Date.now()): Forja {
  const repo = path.resolve(o.repo ?? process.cwd())
  const f = leerForja(db, id)
  if (!f) throw new Error(`No existe la forja ${id}`)
  if (f.estado === 'aplicada') throw new Error('Ya está aplicada: para deshacerla, revertí el commit')
  limpiar(repo, f, true)
  db.prepare(`UPDATE fragua SET estado = 'descartada', resuelta_en = ? WHERE id = ?`).run(ahora, id)
  return leerForja(db, id)!
}
