/**
 * La Fragua: Mastropiero se mejora a sí mismo, pero nunca sobre lo que está andando. Toma una propuesta de mejora,
 * elige los archivos, escribe los cambios (buscar → reemplazar, exactos), los aplica en una copia aparte del repo (un
 * git worktree en la rama fragua/<n>), corre el typecheck y los tests ahí, y deja el diff para que él lo lea.
 * Si no compila, fallan los tests, un tramo no está o falta el test, le devuelve el error y corrige (hasta dos vueltas).
 * Solo con su ok (desde la pantalla) se mergea a la rama que está andando; después hay que reiniciar el servidor. Si
 * algo falla, la rama queda para revisar o se descarta, y lo que anda no se enteró. Los commits salen con la identidad
 * del repo (la cuenta del operador), no con una inventada.
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

/** En qué paso va cada forja (para la pantalla). */
export const pasoDeForja = new Map<number, string>()

/** La rama del repo donde se aplicaría una forja (la que está andando). */
/** La rama que está andando (cacheada 30 s: preguntarle a git traba el servidor un rato en cada pedido). */
const ramas = new Map<string, { rama: string | null; en: number }>()
export function ramaActual(repo = process.cwd()): string | null {
  const k = path.resolve(repo)
  const ya = ramas.get(k)
  if (ya && Date.now() - ya.en < 30_000) return ya.rama
  let rama: string | null = null
  try { rama = git(k, 'rev-parse', '--abbrev-ref', 'HEAD') } catch { /* sin git */ }
  ramas.set(k, { rama, en: Date.now() })
  return rama
}

/** Si el servidor se cortó a mitad de una forja, queda «haciendo» y bloquearía las siguientes: pasa a fallo. */
export function retomarFragua(db: Db) {
  db.prepare(`UPDATE fragua SET estado = 'fallo', salida = COALESCE(salida, '') || 'Se cortó: el servidor se reinició mientras forjaba. Podés volver a forjarla.' WHERE estado = 'haciendo'`).run()
}

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

/** La salida del compilador, con archivo, línea y mensaje. No se recorta a las líneas que dicen error. */
export function salidaDeCompilador(txt: string): string {
  const lineas = txt.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(0, 80)
  return `$ tsc\n${lineas.join('\n')}`
}

export function salidaDeTests(txt: string): string {
  const lineas = txt.split('\n').filter((l) => /✖|error|fail|ℹ (tests|pass|fail)/i.test(l)).slice(0, 60)
  return `$ node --test\n${lineas.join('\n')}`
}

/** Si el typecheck falla, la suite no corre. */
export function sigueLaSuite(statusTsc: number): boolean {
  return statusTsc === 0
}

/** Por defecto: el tsc y los tests del repo principal, corridos sobre la copia (el worktree no tiene node_modules). */
function verificarDefecto(dir: string, repo: string): { ok: boolean; salida: string } {
  const tsc = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc')
  const salida: string[] = []
  if (fs.existsSync(tsc)) {
    const r = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: dir, encoding: 'utf8', timeout: 10 * 60_000, env: entornoLimpio() })
    salida.push(salidaDeCompilador(`${r.stdout ?? ''}${r.stderr ?? ''}`))
    if (!sigueLaSuite(r.status ?? 1)) return { ok: false, salida: salida.join('\n\n') }
  }
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', 'test/**/*.test.ts'], { cwd: dir, encoding: 'utf8', timeout: 10 * 60_000, env: entornoLimpio() })
  salida.push(salidaDeTests(`${r.stdout ?? ''}${r.stderr ?? ''}`))
  return { ok: r.status === 0, salida: salida.join('\n\n') }
}

const SISTEMA_ARCHIVOS = `Sos el herrero de La Fragua: mejorás el código de Mastropiero (Node 24, TypeScript nativo, node:sqlite, sin dependencias; frontend en web/js/*.js clásico).
Te paso una propuesta de mejora y la lista de archivos del repo. Elegí los archivos que hay que tocar o leer para hacerla (máximo 6), incluido el test que corresponda.
Forma: {"archivos": [string]}`

const SISTEMA_PLAN = `Sos el herrero de La Fragua. Ya elegiste los archivos. Dejá el plan en tres campos, antes de escribir el diff.
Forma: {"archivos": [string], "cambio": string, "verificacion": string}
- archivos: los que ya elegiste.
- cambio: una oración, qué va a cambiar.
- verificacion: qué tiene que pasar (typecheck, un test nombrado, o los dos).`

const SISTEMA_CAMBIOS = `Sos el herrero de La Fragua: mejorás el código de Mastropiero (Node 24, TypeScript nativo, node:sqlite, sin dependencias; frontend en web/js/*.js clásico; textos en castellano rioplatense).
Te paso la propuesta y el contenido de los archivos. Escribí los cambios mínimos y completos para hacerla, con su test si corresponde, siguiendo el estilo del código.
Forma: {"resumen": string (qué cambia y por qué, 2-4 oraciones), "cambios": [{"archivo": string, "buscar": string, "reemplazar": string}]}
- "buscar" es un tramo EXACTO y ÚNICO del archivo actual (copialo tal cual, con su sangría, de 2 a 15 líneas). Para crear un archivo nuevo, "buscar" va vacío y "reemplazar" es el archivo entero.
- Si tocás algo de src/, traé su test en test/*.test.ts (nuevo o ajustado) que pruebe lo que pide la propuesta: sin test no se acepta.
- Nada de cambios cosméticos ni refactors que no pidió la propuesta.`

const SISTEMA_CORRECCION = `Sos el herrero de La Fragua. Ya aplicaste cambios para una propuesta, pero algo falló: te paso qué (el error del compilador, los tests que fallan, un tramo que no encontraste, o que falta el test) y cómo están los archivos AHORA, con tus cambios ya aplicados.
Arreglalo con cambios nuevos sobre los archivos tal como están.
Forma: {"resumen": string, "cambios": [{"archivo": string, "buscar": string, "reemplazar": string}]}
- "buscar" es un tramo EXACTO y ÚNICO del archivo como está ahora (copialo tal cual, de 2 a 15 líneas). Para crear un archivo nuevo, "buscar" va vacío y "reemplazar" es el archivo entero.
- Si el que está mal es el test y no el código, arreglá el test; pero nunca lo vacíes, lo saltees ni lo borres para que pase.`

/** Cuántas veces vuelve sobre su propio error antes de dejar la forja rota. */
export const CORRECCIONES = 2

/** Si toca src/ tiene que traer su test: sin test no se sabe si hace lo que dice. (La pantalla, web/, no tiene tests.) */
export function faltaTest(tocados: string[]): string | null {
  return tocados.some((f) => f.startsWith('src/')) && !tocados.some((f) => /^test\/.+\.test\.ts$/.test(f))
    ? 'Cambiaste código de src/ sin tocar ningún test: agregá o ajustá el test (test/*.test.ts) que pruebe lo que pide la propuesta.'
    : null
}

/** Los commits de la Fragua llevan la identidad del repo (en este, la cuenta del operador); si no tiene, una propia. */
function firma(repo: string): string[] {
  const leer = (k: string) => { try { return git(repo, 'config', k) } catch { return '' } }
  return ['-c', `user.name=${leer('user.name') || 'La Fragua'}`, '-c', `user.email=${leer('user.email') || 'fragua@mastropiero.local'}`]
}

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
  const paso = (t: string) => pasoDeForja.set(id, t)
  const fin = (c: Partial<Forja> & { estado: Forja['estado'] }) => {
    pasoDeForja.delete(id)
    db.prepare('UPDATE fragua SET rama = ?, estado = ?, resumen = ?, archivos = ?, diff = ?, salida = ? WHERE id = ?')
      .run(rama, c.estado, c.resumen ?? null, JSON.stringify(c.archivos ?? []), c.diff ?? null, c.salida ?? null, id)
    return leerForja(db, id)!
  }
  try {
    paso('preparando una copia aparte del código')
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    git(repo, 'worktree', 'add', '-b', rama, dir, 'HEAD')
    // node_modules del repo, enlazado (junction): el typecheck necesita los tipos. Se desenlaza antes de borrar la copia.
    if (fs.existsSync(path.join(repo, 'node_modules'))) fs.symlinkSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'), 'junction')
    const lista = git(dir, 'ls-files').split('\n').filter((f) => /^(src|web|test|scripts)\//.test(f) || /^(README\.md|package\.json)$/.test(f))
    paso('eligiendo qué archivos tocar')
    const { datos: elegidos } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'fragua' }, SISTEMA_ARCHIVOS, `PROPUESTA:\n${pedido}\n\nARCHIVOS:\n${lista.join('\n')}`, { temperatura: 0.1, maxTokens: 800 })
    const archivos = (Array.isArray(elegidos.archivos) ? elegidos.archivos : []).map(String).filter((f: string) => lista.includes(f)).slice(0, 6)
    if (!archivos.length) return fin({ estado: 'fallo', salida: 'No supe qué archivos tocar para esta propuesta.' })
    paso('armando el plan')
    const { datos: tres } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'fragua' }, SISTEMA_PLAN, `PROPUESTA:\n${pedido}\n\nARCHIVOS ELEGIDOS:\n${archivos.join('\n')}`, { temperatura: 0.1, maxTokens: 400 })
    const lineas = [
      `Archivos: ${(Array.isArray(tres.archivos) ? tres.archivos : archivos).map(String).join(', ')}`,
      `Cambio: ${String(tres.cambio ?? '').trim()}`,
      `Verificación: ${String(tres.verificacion ?? '').trim()}`,
    ].join('\n')
    const contenido = archivos.map((f: string) => `=== ${f} ===\n${fs.readFileSync(path.join(dir, f), 'utf8')}`).join('\n\n')
    paso('escribiendo los cambios')
    const { datos: plan } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'fragua' }, SISTEMA_CAMBIOS, `PROPUESTA:\n${pedido}\n\nPLAN:\n${lineas}\n\n${contenido}`, { temperatura: 0.2, maxTokens: 12000, largo: true })
    let cambios = Array.isArray(plan.cambios) ? plan.cambios : []
    const resumen = [lineas, plan.resumen].filter(Boolean).join('\n\n')
    if (!cambios.length) return fin({ estado: 'fallo', resumen, salida: 'El modelo no propuso cambios.' })
    // Aplicar → ¿trae test? → typecheck y tests. Si algo falla, le devuelve el error y corrige sobre lo que quedó.
    const tocados = new Set<string>()
    const vueltas: string[] = []
    let ok = false
    let verifico = false
    for (let vuelta = 0; ; vuelta++) {
      let problema: string | null = null
      try { aplicarCambios(dir, cambios).forEach((t) => tocados.add(t)) } catch (e) { problema = `Al aplicar los cambios: ${e instanceof Error ? e.message : String(e)}` }
      problema ??= faltaTest([...tocados])
      if (!problema) {
        paso(vuelta ? `typecheck y tests, otra vez (corrección ${vuelta})` : 'typecheck y tests (unos minutos)')
        const v = (o.verificar ?? verificarDefecto)(dir, repo)
        verifico = true
        if (v.ok) { vueltas.push(v.salida); ok = true; break }
        problema = v.salida
      }
      vueltas.push(problema)
      if (vuelta >= CORRECCIONES) break
      paso(`corrigiendo su error (vuelta ${vuelta + 1} de ${CORRECCIONES})`)
      const actuales = [...new Set([...archivos, ...tocados])].filter((f) => fs.existsSync(path.join(dir, f)))
      const { datos: arreglo } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'fragua' }, SISTEMA_CORRECCION,
        `PROPUESTA:\n${pedido}\n\nPLAN:\n${lineas}\n\nLO QUE FALLÓ:\n${problema}\n\nASÍ ESTÁN LOS ARCHIVOS AHORA:\n${actuales.map((f) => `=== ${f} ===\n${fs.readFileSync(path.join(dir, f), 'utf8')}`).join('\n\n')}`,
        { temperatura: 0.2, maxTokens: 12000, largo: true })
      cambios = Array.isArray(arreglo.cambios) ? arreglo.cambios : []
      if (!cambios.length) break
    }
    const salida = vueltas.length > 1 ? vueltas.map((t, i) => `— ${i ? `corrección ${i}` : 'primera vuelta'} —\n${t}`).join('\n\n') : vueltas[0] ?? ''
    if (!tocados.size) return fin({ estado: 'fallo', resumen, salida })
    git(dir, 'add', '-A') // node_modules está en .gitignore
    git(dir, ...firma(repo), 'commit', '-q', '-m', `Fragua #${id}: ${String(plan.resumen ?? pedido).split('\n')[0].slice(0, 70)}`)
    const diff = git(dir, 'diff', 'HEAD~1', 'HEAD')
    return fin({ estado: ok ? 'lista' : verifico ? 'rota' : 'fallo', resumen, archivos: [...tocados], diff: diff.slice(0, 200_000), salida })
  } catch (e) {
    return fin({ estado: 'fallo', salida: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * Las propuestas abiertas que todavía no tienen forja (o cuyas forjas fallaron por algo ajeno, como un corte, y van
 * menos de dos intentos): primero las de prioridad alta, después las más viejas.
 */
export function propuestasParaForjar(db: Db, limite: number): { id: number; titulo: string }[] {
  return db.prepare(`
    SELECT p.id, p.titulo FROM propuestas p
    WHERE p.estado = 'abierta'
      AND NOT EXISTS (SELECT 1 FROM fragua f WHERE f.propuesta_id = p.id AND f.estado IN ('haciendo', 'lista', 'rota', 'aplicada'))
      AND (SELECT COUNT(*) FROM fragua f WHERE f.propuesta_id = p.id) < 2
    ORDER BY CASE p.prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, p.id
    LIMIT ?`).all(limite) as { id: number; titulo: string }[]
}

/** La Fragua de noche: forja de a una las propuestas que tocan, hasta el límite o el tope de gasto. */
export async function forjarPendientes(db: Db, o: Opciones & { limite?: number; frenar?: () => string | null } = {}): Promise<{ forjas: Forja[]; frenado: string | null }> {
  const forjas: Forja[] = []
  for (const p of propuestasParaForjar(db, o.limite ?? 3)) {
    const frenado = o.frenar?.() ?? null
    if (frenado) return { forjas, frenado }
    forjas.push(await forjarMejora(db, { propuestaId: p.id }, o))
  }
  return { forjas, frenado: null }
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
  git(repo, ...firma(repo), 'merge', '--no-ff', '-q', '-m', `Fragua #${id} aplicada`, f.rama)
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
