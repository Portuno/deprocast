/**
 * Exportación de estado: todo Deprocast en un solo JSON, como el respaldo de la 0.7.1 pero completo y reversible.
 * Lleva cada tabla de la base (filas como listas, con sus columnas), y opcionalmente los archivos (cargas, Taller,
 * bitácora de la liga) en base64. Importarlo en otra compu deja esa base igual a esta: mismo corpus, memoria,
 * misiones, runs, chats, agentes, ajustes y rutinas. No viaja el .env (las claves se copian a mano).
 *
 * El índice de búsqueda (FTS) no viaja: se reconstruye al importar. Lo cifrado de la bitácora viaja cifrado.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { migrar, resolverRuta, type Db } from './db.ts'
import { dirCargas } from './cargas/index.ts'
import { dirTaller } from './taller.ts'
import { respaldar } from './respaldo.ts'

export const FORMATO = 'deprocast-estado'
export const VERSION = 1
/** Internas de SQLite y el índice FTS (se reconstruye). */
const SALTEAR = /^(sqlite_|corpus_fts)/

const dos = (n: number) => String(n).padStart(2, '0')
const marca = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}` }

export function tablasDe(db: Db): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]).map((t) => t.name).filter((n) => !SALTEAR.test(n))
}
const columnas = (db: Db, t: string) => (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name)
const contar = (db: Db, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n

/** Los BLOB (vectores) viajan como {"$b64": "..."}. */
const aJson = (v: unknown) => (v instanceof Uint8Array ? { $b64: Buffer.from(v).toString('base64') } : v)
const deJson = (v: any) => (v && typeof v === 'object' && typeof v.$b64 === 'string' ? Buffer.from(v.$b64, 'base64') : v)

function versionApp(): { version: string | null; commit: string | null } {
  let version: string | null = null
  let commit: string | null = null
  try { version = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version ?? null } catch { /* sin package.json */ }
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null } catch { /* sin git */ }
  return { version, commit }
}

/** Los archivos que acompañan a la base: { ruta relativa → ruta en disco }. */
function archivosDe(): Map<string, string> {
  const out = new Map<string, string>()
  const recorrer = (base: string, prefijo: string) => {
    if (!fs.existsSync(base)) return
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      const abs = path.join(base, e.name)
      if (e.isDirectory()) recorrer(abs, `${prefijo}${e.name}/`)
      else if (e.isFile()) out.set(`${prefijo}${e.name}`, abs)
    }
  }
  recorrer(dirCargas(), 'cargas/')
  recorrer(dirTaller(), 'taller/')
  const bit = path.resolve(process.env.MASTRO_BITACORA ?? path.join(process.cwd(), 'data', 'bitacora.md'))
  if (fs.existsSync(bit)) out.set('bitacora.md', bit)
  return out
}

export type Manifiesto = { format: string; version: number; app: { version: string | null; commit: string | null }; exported_at: string; include_files: boolean; counts: Record<string, number>; files: number; bytes_files: number }

/**
 * Escribe el JSON de a pedazos (la base puede ser grande y los archivos más). Queda en data/exportaciones/ y se
 * devuelve la ruta.
 */
export function exportarEstado(db: Db, o: { archivos?: boolean; destino?: string; ahora?: number } = {}): { ruta: string; bytes: number; manifiesto: Manifiesto } {
  const ahora = o.ahora ?? Date.now()
  const dir = path.resolve(o.destino ?? path.join(path.dirname(resolverRuta()), 'exportaciones'))
  fs.mkdirSync(dir, { recursive: true })
  const ruta = path.join(dir, `deprocast-estado-${marca(ahora)}.json`)
  const tablas = tablasDe(db)
  const archivos = o.archivos === false ? new Map<string, string>() : archivosDe()
  const manifiesto: Manifiesto = {
    format: FORMATO, version: VERSION, app: versionApp(), exported_at: new Date(ahora).toISOString(), include_files: o.archivos !== false,
    counts: Object.fromEntries(tablas.map((t) => [t, contar(db, t)])), files: archivos.size,
    bytes_files: [...archivos.values()].reduce((s, a) => s + fs.statSync(a).size, 0),
  }
  const fd = fs.openSync(`${ruta}.parcial`, 'w')
  const w = (s: string) => fs.writeSync(fd, s)
  try {
    const { counts: _, ...cabecera } = manifiesto
    w(`{${JSON.stringify(cabecera).slice(1, -1)},\n"purpose":"Estado completo de Deprocast 1.0 / Mastropiero para retomar en otra compu.",\n"counts":${JSON.stringify(manifiesto.counts)},\n"tables":{`)
    tablas.forEach((t, i) => {
      const cols = columnas(db, t)
      w(`${i ? ',' : ''}\n${JSON.stringify(t)}:{"columns":${JSON.stringify(cols)},"rows":[`)
      let n = 0
      for (const fila of db.prepare(`SELECT * FROM "${t}"`).iterate() as Iterable<Record<string, unknown>>) {
        w(`${n++ ? ',' : ''}\n${JSON.stringify(cols.map((c) => aJson(fila[c])))}`)
      }
      w(']}')
    })
    w('\n},\n"files":{')
    let k = 0
    for (const [rel, abs] of archivos) {
      w(`${k++ ? ',' : ''}\n${JSON.stringify(rel)}:${JSON.stringify(fs.readFileSync(abs).toString('base64'))}`)
    }
    w('\n}}\n')
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(`${ruta}.parcial`, ruta)
  return { ruta, bytes: fs.statSync(ruta).size, manifiesto }
}

/** Lo que dice el archivo sin importarlo (para confirmar antes). */
export function leerExportacion(texto: string): { datos: any; manifiesto: Omit<Manifiesto, 'files' | 'bytes_files'> & { files: number } } {
  let datos: any
  try { datos = JSON.parse(texto) } catch { throw new Error('No es un JSON válido') }
  if (datos?.format !== FORMATO) throw new Error(`No es una exportación de estado de Deprocast (formato «${datos?.format ?? '?'}»). Para el respaldo de la 0.7 usá Corpus → Ingerir.`)
  if (Number(datos.version) > VERSION) throw new Error(`La exportación es de una versión más nueva (${datos.version}); actualizá este Deprocast primero (git pull).`)
  return { datos, manifiesto: { format: datos.format, version: datos.version, app: datos.app ?? {}, exported_at: datos.exported_at, include_files: !!datos.include_files, counts: datos.counts ?? {}, files: Object.keys(datos.files ?? {}).length } }
}

const tieneDatos = (db: Db) => ['corpus', 'mensajes', 'memoria', 'misiones'].some((t) => { try { return contar(db, t) > 0 } catch { return false } })

/**
 * Reemplaza el estado de esta base por el de la exportación. Si esta base ya tiene datos, pide `forzar` y antes
 * guarda un respaldo (carpeta en data/respaldos/). Las tablas que la exportación no trae quedan vacías, salvo lo de
 * fábrica (rutinas, ajustes, fuentes, plantillas), que se vuelve a sembrar.
 */
export function importarEstado(db: Db, texto: string, o: { forzar?: boolean; ahora?: number } = {}): { tablas: number; filas: number; archivos: number; respaldo: string | null; manifiesto: ReturnType<typeof leerExportacion>['manifiesto'] } {
  const ahora = o.ahora ?? Date.now()
  const { datos, manifiesto } = leerExportacion(texto)
  if (tieneDatos(db) && !o.forzar) throw new Error('Esta base ya tiene datos: importar los reemplaza. Confirmá (forzar) y antes guardo un respaldo.')
  const respaldo = tieneDatos(db) ? respaldar(db, { ahora }).carpeta : null

  const exp: Record<string, { columns: string[]; rows: unknown[][] }> = datos.tables ?? {}
  let filas = 0
  let tablas = 0
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN')
  try {
    for (const t of tablasDe(db)) {
      db.exec(`DELETE FROM "${t}"`)
      const e = exp[t]
      if (!e?.rows?.length) continue
      const aca = new Set(columnas(db, t))
      const idx = e.columns.map((c, i) => [c, i] as const).filter(([c]) => aca.has(c))
      if (!idx.length) continue
      const ins = db.prepare(`INSERT OR REPLACE INTO "${t}" (${idx.map(([c]) => `"${c}"`).join(', ')}) VALUES (${idx.map(() => '?').join(', ')})`)
      for (const r of e.rows) { ins.run(...(idx.map(([, i]) => deJson(r[i])) as any[])); filas++ }
      tablas++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
  migrar(db) // lo de fábrica que falte (rutinas o ajustes nuevos) y el índice
  db.exec(`INSERT INTO corpus_fts(corpus_fts) VALUES ('rebuild')`)

  // Archivos: a sus carpetas de esta compu (lo que ya está igual, no se toca).
  let archivos = 0
  for (const [rel, b64] of Object.entries<string>(datos.files ?? {})) {
    const limpio = path.normalize(rel).replace(/^([/\\])+/, '')
    if (limpio.startsWith('..')) continue
    const [raiz, ...resto] = limpio.split(/[/\\]/)
    const destino = raiz === 'cargas' ? path.join(dirCargas(), ...resto)
      : raiz === 'taller' ? path.join(dirTaller(), ...resto)
        : raiz === 'bitacora.md' ? path.resolve(process.env.MASTRO_BITACORA ?? path.join(process.cwd(), 'data', 'bitacora.md'))
          : null
    if (!destino) continue
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    const buf = Buffer.from(b64, 'base64')
    if (!fs.existsSync(destino) || fs.statSync(destino).size !== buf.length) fs.writeFileSync(destino, buf)
    archivos++
  }
  // Las rutas de las cargas eran de la otra compu.
  const upd = db.prepare('UPDATE cargas SET ruta = ? WHERE id = ?')
  for (const c of db.prepare('SELECT id, ruta FROM cargas WHERE ruta IS NOT NULL').all() as { id: number; ruta: string }[]) upd.run(path.join(dirCargas(), path.basename(c.ruta.replace(/\\/g, '/'))), c.id)
  // Las forjas a medio camino vivían en ramas de la otra compu.
  db.prepare(`UPDATE fragua SET estado = 'descartada', salida = COALESCE(salida, '') || '\n(la rama quedó en la otra compu)', resuelta_en = ? WHERE estado IN ('haciendo', 'lista', 'rota')`).run(ahora)
  return { tablas, filas, archivos, respaldo, manifiesto }
}
