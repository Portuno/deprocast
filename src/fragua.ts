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
import { fijarAjuste, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { abrirPullRequest, borrarCopia, cerrarPullRequest, diffDe, githubDisponible, mergearPullRequest, prepararCopia, pruebaDeHumo, revertirEnMain } from './fragua-nube.ts'

export type Forja = {
  id: number
  propuestaId: number | null
  pedido: string
  rama: string
  estado: 'haciendo' | 'lista' | 'rota' | 'fallo' | 'aplicada' | 'descartada' | 'revertida'
  /** git: una rama del repo de su compu; pr: una copia en la nube y un pull request en GitHub (plan v38, fase 2). */
  modo: 'git' | 'pr'
  prNumero: number | null
  prUrl: string | null
  mergeSha: string | null
  resumen: string | null
  archivos: string[]
  diff: string | null
  salida: string | null
  creadaEn: number
  resueltaEn: number | null
  /** La nube confirmó que corre el commit aprobado (o que se revirtió). */
  vigilada: boolean
  /** Fragua #208: las otras propuestas del grupo que esta forja resuelve. */
  cubre: number[]
}

const deFila = (r: any): Forja => ({
  id: r.id, propuestaId: r.propuesta_id, pedido: r.pedido, rama: r.rama, estado: r.estado, resumen: r.resumen, archivos: r.archivos ? JSON.parse(r.archivos) : [],
  diff: r.diff, salida: r.salida, creadaEn: r.creada_en, resueltaEn: r.resuelta_en,
  modo: r.modo === 'pr' ? 'pr' : 'git', prNumero: r.pr_numero ?? null, prUrl: r.pr_url ?? null, mergeSha: r.merge_sha ?? null,
  vigilada: r.vigilada === 1, cubre: r.cubre ? JSON.parse(r.cubre) : [],
})

/**
 * El estado real de una forja (Fragua #209): no solo «forjada», sino dónde está el cambio. En rama (esperando su ok,
 * con o sin los tests pasados), aplicada (en su compu, o en la nube y corriendo), descartada, revertida o no salió. Una
 * que pasó los tests y lleva más de una semana sin aplicarse queda marcada.
 */
export function estadoReal(f: Pick<Forja, 'estado' | 'modo' | 'rama' | 'prNumero' | 'prUrl' | 'mergeSha' | 'vigilada' | 'creadaEn' | 'resueltaEn' | 'archivos'>, ahora = Date.now()) {
  const dias = Math.floor((ahora - f.creadaEn) / 86_400_000)
  const donde = f.modo === 'pr' ? (f.prNumero ? `pull request #${f.prNumero}` : 'copia en la nube') : `rama ${f.rama}`
  const base = { donde, archivos: f.archivos.length, enlace: f.prUrl ?? null, dias }
  switch (f.estado) {
    case 'haciendo': return { ...base, clave: 'forjando', texto: 'forjándose ahora', pruebas: null, viejo: false }
    case 'lista': return { ...base, clave: 'en_rama', texto: `en ${donde}, pasa typecheck y tests: falta tu ok`, pruebas: true, viejo: dias >= 7 }
    case 'rota': return { ...base, clave: 'en_rama', texto: `en ${donde}, no pasa los tests`, pruebas: false, viejo: dias >= 7 }
    case 'fallo': return { ...base, clave: 'fallo', texto: 'no salió: no hay cambio escrito', pruebas: null, viejo: false }
    case 'aplicada': return f.modo === 'pr'
      ? (f.vigilada ? { ...base, clave: 'aplicada', texto: `aplicada en la nube (${f.mergeSha?.slice(0, 7) ?? 'main'}), corriendo`, pruebas: true, viejo: false }
        : { ...base, clave: 'aplicada', texto: 'aprobada: esperando que la nube la tome', pruebas: true, viejo: false })
      : { ...base, clave: 'aplicada', texto: `aplicada en tu compu (${donde})`, pruebas: true, viejo: false }
    case 'descartada': return { ...base, clave: 'descartada', texto: 'descartada', pruebas: null, viejo: false }
    case 'revertida': return { ...base, clave: 'revertida', texto: 'revertida: volvió lo de antes', pruebas: null, viejo: false }
  }
}

/** Fragua #208: al aplicarse la forja de un grupo, las otras propuestas quedan cubiertas por la principal. */
function cubrir(db: Db, f: Forja, ahora: number) {
  if (!f.propuestaId) return
  db.prepare(`UPDATE propuestas SET estado = 'aceptada', resuelta_en = ?, cerrada_por = 'forja' WHERE id = ?`).run(ahora, f.propuestaId)
  for (const otra of f.cubre) {
    if (otra === f.propuestaId) continue
    db.prepare(`UPDATE propuestas SET estado = 'aceptada', resuelta_en = ?, cerrada_por = 'grupo', cubierta_por = ? WHERE id = ? AND estado = 'abierta'`).run(ahora, f.propuestaId, otra)
  }
}

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
  // Leer .git/HEAD es instantáneo; lanzar git trababa el servidor ~300 ms en cada pedido (lo vio npm run medir).
  try {
    const head = fs.readFileSync(path.join(k, '.git', 'HEAD'), 'utf8').trim()
    rama = head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : 'HEAD'
  } catch {
    try { rama = git(k, 'rev-parse', '--abbrev-ref', 'HEAD') } catch { /* sin git */ }
  }
  ramas.set(k, { rama, en: Date.now() })
  return rama
}

/** Si el servidor se cortó a mitad de una forja, queda «haciendo» y bloquearía las siguientes: pasa a fallo. */
/** La Fragua escribe el código de Deprocast: en el Deprocast de un usuario (plan v33, paso 5) no está. */
function soloDelDueno() {
  if (process.env.MASTRO_USUARIO) throw new Error('La Fragua es solo del dueño de este Deprocast.')
}

export function retomarFragua(db: Db) {
  db.prepare(`UPDATE fragua SET estado = 'fallo', salida = COALESCE(salida, '') || 'Se cortó: el servidor se reinició mientras forjaba. Podés volver a forjarla.' WHERE estado = 'haciendo'`).run()
}

export const leerForja = (db: Db, id: number): Forja | null => { const r = db.prepare('SELECT * FROM fragua WHERE id = ?').get(id); return r ? deFila(r) : null }
export const listarForjas = (db: Db): Forja[] => db.prepare('SELECT * FROM fragua ORDER BY id DESC LIMIT 40').all().map(deFila)

type Opciones = {
  repo?: string
  /** Typecheck + tests dentro del worktree; devuelve ok y la salida. Inyectable para tests. */
  verificar?: (dir: string, repo: string) => { ok: boolean; salida: string }
  /** La prueba de humo (levantar el servidor forjado y recorrerlo). Por defecto, la real; con `verificar` inyectado y sin esto, no corre. */
  humo?: (dir: string) => Promise<{ ok: boolean; salida: string }>
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

/** Los archivos de una copia (sin git), con rutas relativas y barras normales. */
function archivosDe(dir: string): string[] {
  const out: string[] = []
  const ir = (d: string) => { for (const e of fs.readdirSync(path.join(dir, d), { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === 'data') continue; const r = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) ir(r); else out.push(r) } }
  ir('')
  return out
}

/**
 * ¿Se puede forjar acá? (plan v34, #132) La forja necesita git y el repositorio. En la nube no hay ninguno de los
 * dos (el código baja de GitHub como paquete): antes moría con «spawnSync git ENOENT» a mitad de camino.
 * Devuelve el motivo si no se puede, o null.
 */
/** ¿Hay git en esta máquina? Se pregunta una vez por proceso (lanzarlo traba el servidor un rato). */
let hayGit: boolean | null = null
const gitInstalado = () => {
  if (hayGit === null) { const g = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }); hayGit = !g.error && g.status === 0 }
  return hayGit
}

export function porQueNoSePuedeForjar(repo = process.cwd()): string | null {
  if (process.env.MASTRO_USUARIO) return 'La Fragua es solo del dueño de este Deprocast.'
  if (!gitInstalado() && !(githubDisponible() && !fs.existsSync(path.join(repo, '.git')))) return 'Acá no hay git, y La Fragua lo necesita para trabajar en una rama aparte. En la nube no se puede forjar: copiá la propuesta y pasásela a Claude Code, o forjala desde Deprocast en tu compu.'
  // En la nube no hay repositorio (el código baja como paquete): se forja sobre una copia y se abre un pull request.
  if (!fs.existsSync(path.join(repo, '.git'))) return githubDisponible() ? null : 'En la nube La Fragua forja sobre una copia y abre un pull request en GitHub: falta GITHUB_FRAGUA_TOKEN (un token con permiso solo sobre este repo) en las variables de NaN. Mientras tanto, copiá la propuesta y pasásela a Claude Code.'
  return null
}

/** Forja una propuesta (o un pedido en palabras) en su propia rama. No toca main. */
export async function forjarMejora(db: Db, p: { propuestaId?: number | null; pedido?: string | null; cubre?: number[] }, o: Opciones = {}, ahora = Date.now()): Promise<Forja> {
  soloDelDueno()
  const repo = path.resolve(o.repo ?? process.cwd())
  const motivo = o.repo ? null : porQueNoSePuedeForjar(repo)
  if (motivo) throw new Error(motivo)
  const prop = p.propuestaId ? db.prepare('SELECT * FROM propuestas WHERE id = ?').get(p.propuestaId) as any : null
  if (p.propuestaId && !prop) throw new Error(`No existe la propuesta ${p.propuestaId}`)
  // Un grupo (Fragua #208): la principal y las que comparten su causa, en un solo pedido; el arreglo común, una vez.
  const otras = prop ? (p.cubre ?? []).filter((x) => x !== prop.id).map((x) => db.prepare(`SELECT id, titulo, detalle FROM propuestas WHERE id = ? AND estado = 'abierta'`).get(x) as { id: number; titulo: string; detalle: string } | undefined).filter((x): x is { id: number; titulo: string; detalle: string } => !!x) : []
  const pedido = prop ? `${prop.titulo}\n\n${prop.detalle}${otras.length ? `\n\nMISMA CAUSA (un solo arreglo común que resuelva también estas):\n${otras.map((x) => `- #${x.id} ${x.titulo}: ${x.detalle.slice(0, 1200)}`).join('\n')}` : ''}` : String(p.pedido ?? '').trim()
  if (!pedido) throw new Error('¿Qué mejora querés forjar?')
  if (db.prepare(`SELECT 1 FROM fragua WHERE estado = 'haciendo'`).get()) throw new Error('Ya hay algo en la fragua; esperá que termine')
  const r = db.prepare(`INSERT INTO fragua (propuesta_id, pedido, rama, estado, creada_en, cubre) VALUES (?, ?, '', 'haciendo', ?, ?)`).run(prop?.id ?? null, pedido, ahora, otras.length ? JSON.stringify(otras.map((x) => x.id)) : null)
  const id = Number(r.lastInsertRowid)
  const rama = `fragua/${id}`
  const modo: Forja['modo'] = fs.existsSync(path.join(repo, '.git')) ? 'git' : 'pr'
  const dir = dirDe(repo, id)
  const paso = (t: string) => pasoDeForja.set(id, t)
  const refs = prop ? ` (Fragua #${[prop.id, ...otras.map((x) => x.id)].join(', #')})` : ''
  let pr: { numero: number; url: string } | null = null
  const fin = (c: Partial<Forja> & { estado: Forja['estado'] }) => {
    pasoDeForja.delete(id)
    db.prepare('UPDATE fragua SET rama = ?, estado = ?, resumen = ?, archivos = ?, diff = ?, salida = ?, modo = ?, pr_numero = ?, pr_url = ? WHERE id = ?')
      .run(rama, c.estado, c.resumen ?? null, JSON.stringify(c.archivos ?? []), c.diff ?? null, c.salida ?? null, modo, pr?.numero ?? null, pr?.url ?? null, id)
    if (modo === 'pr') borrarCopia(dir) // la copia de la nube no se guarda: lo que queda es el PR
    return leerForja(db, id)!
  }
  try {
    paso('preparando una copia aparte del código')
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    if (modo === 'git') {
      git(repo, 'worktree', 'add', '-b', rama, dir, 'HEAD')
      // node_modules del repo, enlazado (junction): el typecheck necesita los tipos. Se desenlaza antes de borrar la copia.
      if (fs.existsSync(path.join(repo, 'node_modules'))) fs.symlinkSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'), 'junction')
    } else prepararCopia(repo, dir)
    const lista = (modo === 'git' ? git(dir, 'ls-files').split('\n') : archivosDe(dir)).filter((f) => /^(src|web|test|scripts)\//.test(f) || /^(README\.md|package\.json)$/.test(f))
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
        if (v.ok) {
          // Plan v38, fase 2: además, que el servidor forjado levante y conteste (la prueba de humo).
          const humo = o.humo ?? (o.verificar ? null : (d: string) => pruebaDeHumo(d, entornoLimpio()))
          if (humo) {
            paso('prueba de humo: levantando el servidor forjado')
            const h = await humo(dir)
            if (!h.ok) { problema = `${v.salida}\n\n${h.salida}` } else { vueltas.push(`${v.salida}\n\n${h.salida}`); ok = true; break }
          } else { vueltas.push(v.salida); ok = true; break }
        } else problema = v.salida
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
    if (modo === 'pr') {
      // En la nube: el diff se arma comparando con el código que corre, y si pasó todo, el pull request.
      const diff = [...tocados].map((f) => diffDe(f, fs.existsSync(path.join(repo, f)) ? fs.readFileSync(path.join(repo, f), 'utf8') : null, fs.readFileSync(path.join(dir, f), 'utf8'))).filter(Boolean).join('\n')
      if (!ok) return fin({ estado: verifico ? 'rota' : 'fallo', resumen, archivos: [...tocados], diff: diff.slice(0, 200_000), salida })
      paso('abriendo el pull request en GitHub')
      try {
        pr = await abrirPullRequest({
          id, titulo: `${String(plan.resumen ?? pedido).split('\n')[0].slice(0, 70)}${refs}`,
          cuerpo: `${resumen}\n\n---\n\n\`\`\`\n${salida.slice(0, 50_000)}\n\`\`\`\n\nForjado y probado por La Fragua de Deprocast (typecheck, tests y prueba de humo). Se aprueba desde La Fragua o acá.`,
          archivos: [...tocados].map((f) => ({ ruta: f, contenido: fs.readFileSync(path.join(dir, f), 'utf8') })), base: process.env.MASTRO_COMMIT ?? null,
        })
      } catch (e) {
        // Token vencido (Fragua #215): la propuesta no se pierde, queda en cola para cuando vuelva.
        const vencio = (e as { status?: number }).status === 401
        if (vencio) { fijarAjuste(db, 'fragua_token_vencido', '1'); if (prop) db.prepare('UPDATE propuestas SET en_cola = ? WHERE id = ?').run(Date.now(), prop.id) }
        return fin({ estado: 'fallo', resumen, archivos: [...tocados], diff: diff.slice(0, 200_000), salida: `${salida}\n\nPasó todo, pero no pude abrir el pull request: ${e instanceof Error ? e.message : e}${vencio ? '\n\nEl token de GitHub venció: la propuesta quedó en cola y se forja sola cuando lo renueves.' : ''}` })
      }
      return fin({ estado: 'lista', resumen, archivos: [...tocados], diff: diff.slice(0, 200_000), salida })
    }
    git(dir, 'add', '-A') // node_modules está en .gitignore
    git(dir, ...firma(repo), 'commit', '-q', '-m', `Forja #${id}: ${String(plan.resumen ?? pedido).split('\n')[0].slice(0, 70)}${refs}`)
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
export function propuestasParaForjar(db: Db, limite: number, o: { soloAutocritica?: boolean } = {}): { id: number; titulo: string }[] {
  return db.prepare(`
    SELECT p.id, p.titulo FROM propuestas p
    WHERE p.estado = 'abierta' ${o.soloAutocritica ? "AND p.origen = 'autocritica' AND p.prioridad = 'alta'" : ''}
      AND NOT EXISTS (SELECT 1 FROM fragua f WHERE f.propuesta_id = p.id AND f.estado IN ('haciendo', 'lista', 'rota', 'aplicada'))
      AND (SELECT COUNT(*) FROM fragua f WHERE f.propuesta_id = p.id) < 2
    ORDER BY CASE p.prioridad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, p.id
    LIMIT ?`).all(limite) as { id: number; titulo: string }[]
}

/** La Fragua de noche: forja de a una las propuestas que tocan, hasta el límite o el tope de gasto. */
export async function forjarPendientes(db: Db, o: Opciones & { limite?: number; frenar?: () => string | null; soloAutocritica?: boolean } = {}): Promise<{ forjas: Forja[]; frenado: string | null }> {
  soloDelDueno()
  const forjas: Forja[] = []
  for (const p of propuestasParaForjar(db, o.limite ?? 3, { soloAutocritica: o.soloAutocritica })) {
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
  soloDelDueno()
  const repo = path.resolve(o.repo ?? process.cwd())
  const f = leerForja(db, id)
  if (!f) throw new Error(`No existe la forja ${id}`)
  if (f.estado !== 'lista') throw new Error(`La forja ${id} está «${f.estado}»: solo se aplica una que pasó los tests`)
  const sucio = git(repo, 'status', '--porcelain', '--untracked-files=no')
  if (sucio) throw new Error('Hay cambios sin commitear en el repo: commitealos o descartalos antes de aplicar una forja')
  git(repo, ...firma(repo), 'merge', '--no-ff', '-q', '-m', `Forja #${id} aplicada`, f.rama)
  limpiar(repo, f, true)
  db.prepare(`UPDATE fragua SET estado = 'aplicada', resuelta_en = ? WHERE id = ?`).run(ahora, id)
  cubrir(db, f, ahora)
  return leerForja(db, id)!
}

/** Aprobar una forja de la nube: mergea su pull request; el supervisor la baja y la releva. Después se vigila (fragua-nube). */
export async function aprobarForja(db: Db, id: number, ahora = Date.now()): Promise<Forja> {
  soloDelDueno()
  const f = leerForja(db, id)
  if (!f) throw new Error(`No existe la forja ${id}`)
  if (f.modo !== 'pr' || !f.prNumero) return aplicarForja(db, id, {}, ahora)
  if (f.estado !== 'lista') throw new Error(`La forja ${id} está «${f.estado}»: solo se aprueba una que pasó los tests y la prueba de humo`)
  const sha = await mergearPullRequest(f.prNumero, `Forja #${id}: ${f.pedido.split('\n')[0].slice(0, 60)}${f.propuestaId ? ` (Fragua #${[f.propuestaId, ...f.cubre].join(', #')})` : ''}`, f.rama)
  db.prepare(`UPDATE fragua SET estado = 'aplicada', merge_sha = ?, vigilada = 0, resuelta_en = ? WHERE id = ?`).run(sha, ahora, id)
  cubrir(db, f, ahora)
  return leerForja(db, id)!
}

/** Volver atrás una forja aprobada en la nube (si es lo último que entró a main). */
export async function revertirForja(db: Db, id: number, ahora = Date.now()): Promise<Forja> {
  soloDelDueno()
  const f = leerForja(db, id)
  if (!f) throw new Error(`No existe la forja ${id}`)
  if (f.estado !== 'aplicada' || !f.mergeSha) throw new Error('Solo se revierte una forja aprobada desde la nube (las de tu compu: git revert)')
  await revertirEnMain(f.mergeSha, `él revirtió la Fragua #${id}`)
  db.prepare(`UPDATE fragua SET estado = 'revertida', vigilada = 1, resuelta_en = ? WHERE id = ?`).run(ahora, id)
  return leerForja(db, id)!
}

export function descartarForja(db: Db, id: number, o: Opciones = {}, ahora = Date.now()): Forja {
  const repo = path.resolve(o.repo ?? process.cwd())
  const f = leerForja(db, id)
  if (!f) throw new Error(`No existe la forja ${id}`)
  if (f.estado === 'aplicada') throw new Error('Ya está aplicada: para deshacerla, revertí el commit')
  if (f.modo === 'pr') { if (f.prNumero) void cerrarPullRequest(f.prNumero, f.rama).catch(() => {}) } else limpiar(repo, f, true)
  db.prepare(`UPDATE fragua SET estado = 'descartada', resuelta_en = ? WHERE id = ?`).run(ahora, id)
  return leerForja(db, id)!
}
