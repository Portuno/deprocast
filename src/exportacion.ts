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

type ResultadoImportacion = { tablas: number; filas: number; archivos: number; respaldo: string | null; manifiesto: ReturnType<typeof leerExportacion>['manifiesto'] }

/** Con datos, importar pide confirmar y deja un respaldo antes. */
function respaldarAntes(db: Db, o: { forzar?: boolean }, ahora: number): string | null {
  if (tieneDatos(db) && !o.forzar) throw new Error('Esta base ya tiene datos: importar los reemplaza. Confirmá (forzar) y antes guardo un respaldo.')
  return tieneDatos(db) ? respaldar(db, { ahora }).carpeta : null
}

/** El que inserta las filas de una tabla exportada (solo las columnas que esta base tiene), o null si no hay dónde. */
function insertadorDe(db: Db, t: string, cols: string[]): ((fila: unknown[]) => void) | null {
  if (SALTEAR.test(t) || !tablasDe(db).includes(t)) return null
  const aca = new Set(columnas(db, t))
  const idx = cols.map((c, i) => [c, i] as const).filter(([c]) => aca.has(c))
  if (!idx.length) return null
  const ins = db.prepare(`INSERT OR REPLACE INTO "${t}" (${idx.map(([c]) => `"${c}"`).join(', ')}) VALUES (${idx.map(() => '?').join(', ')})`)
  return (fila) => void ins.run(...(idx.map(([, i]) => deJson(fila[i])) as any[]))
}

/** Lo de fábrica que falte, el índice, y lo que era de la otra compu (rutas de las cargas, forjas a medio camino). */
function cerrarImportacion(db: Db, ahora: number) {
  migrar(db)
  db.exec(`INSERT INTO corpus_fts(corpus_fts) VALUES ('rebuild')`)
  const upd = db.prepare('UPDATE cargas SET ruta = ? WHERE id = ?')
  for (const c of db.prepare('SELECT id, ruta FROM cargas WHERE ruta IS NOT NULL').all() as { id: number; ruta: string }[]) upd.run(path.join(dirCargas(), path.basename(c.ruta.replace(/\\/g, '/'))), c.id)
  db.prepare(`UPDATE fragua SET estado = 'descartada', salida = COALESCE(salida, '') || '\n(la rama quedó en la otra compu)', resuelta_en = ? WHERE estado IN ('haciendo', 'lista', 'rota')`).run(ahora)
}

/** Un archivo exportado a su carpeta de esta compu (lo que ya está igual, no se toca). false si no es de acá. */
function guardarArchivo(rel: string, buf: Buffer): boolean {
  const limpio = path.normalize(rel).replace(/^([/\\])+/, '')
  if (limpio.startsWith('..')) return false
  const [raiz, ...resto] = limpio.split(/[/\\]/)
  const destino = raiz === 'cargas' ? path.join(dirCargas(), ...resto)
    : raiz === 'taller' ? path.join(dirTaller(), ...resto)
      : raiz === 'bitacora.md' ? path.resolve(process.env.MASTRO_BITACORA ?? path.join(process.cwd(), 'data', 'bitacora.md'))
        : null
  if (!destino) return false
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  if (!fs.existsSync(destino) || fs.statSync(destino).size !== buf.length) fs.writeFileSync(destino, buf)
  return true
}

/**
 * Reemplaza el estado de esta base por el de la exportación. Si esta base ya tiene datos, pide `forzar` y antes
 * guarda un respaldo (carpeta en data/respaldos/). Las tablas que la exportación no trae quedan vacías, salvo lo de
 * fábrica (rutinas, ajustes, fuentes, plantillas), que se vuelve a sembrar.
 */
export function importarEstado(db: Db, texto: string, o: { forzar?: boolean; ahora?: number } = {}): ResultadoImportacion {
  const ahora = o.ahora ?? Date.now()
  const { datos, manifiesto } = leerExportacion(texto)
  const respaldo = respaldarAntes(db, o, ahora)

  const exp: Record<string, { columns: string[]; rows: unknown[][] }> = datos.tables ?? {}
  let filas = 0
  let tablas = 0
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN')
  try {
    for (const t of tablasDe(db)) db.exec(`DELETE FROM "${t}"`)
    for (const [t, e] of Object.entries(exp)) {
      const ins = e?.rows?.length ? insertadorDe(db, t, e.columns) : null
      if (!ins) continue
      for (const r of e.rows) { ins(r); filas++ }
      tablas++
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
  cerrarImportacion(db, ahora)
  let archivos = 0
  for (const [rel, b64] of Object.entries<string>(datos.files ?? {})) if (guardarArchivo(rel, Buffer.from(b64, 'base64'))) archivos++
  return { tablas, filas, archivos, respaldo, manifiesto }
}

/** Las líneas de un archivo, cortando solo en \n (readline también corta en los separadores Unicode que JSON deja crudos). */
async function* lineasDe(ruta: string): AsyncGenerator<string> {
  let resto: string[] = [] // una línea larga (un audio en base64) se junta una sola vez, no en cada pedazo
  for await (const pedazo of fs.createReadStream(ruta, { encoding: 'utf8', highWaterMark: 1 << 20 }) as AsyncIterable<string>) {
    if (!pedazo.includes('\n')) { resto.push(pedazo); continue }
    const partes = pedazo.split('\n')
    resto.push(partes[0])
    yield resto.join('')
    yield* partes.slice(1, -1)
    resto = [partes[partes.length - 1]]
  }
  if (resto.join('')) yield resto.join('')
}

const INICIO_TABLA = /^("(?:[^"\\]|\\.)*"):\{"columns":(\[.*\]),"rows":\[(\]\})?$/
const INICIO_ARCHIVO = /^("(?:[^"\\]|\\.)*"):"/

/**
 * Lo mismo que importarEstado, pero leyendo el archivo de a líneas: no carga la exportación entera en memoria (un
 * respaldo con audios pesa cientos de MB). Se apoya en cómo la escribe exportarEstado: una fila o un archivo por línea.
 */
export async function importarEstadoArchivo(db: Db, ruta: string, o: { forzar?: boolean; ahora?: number; alAvanzar?: (leidos: number, total: number) => void } = {}): Promise<ResultadoImportacion> {
  const ahora = o.ahora ?? Date.now()
  const total = fs.statSync(ruta).size
  const lineas = lineasDe(ruta)
  const cortada = () => new Error('La exportación está cortada o no tiene el formato de Deprocast')
  let etapa: 'cabecera' | 'tablas' | 'archivos' | 'fin' = 'cabecera'
  let cabecera = ''
  let manifiesto: ResultadoImportacion['manifiesto'] | null = null
  let respaldo: string | null = null
  let filas = 0
  let archivos = 0
  const conFilas = new Set<string>()
  let tabla = ''
  let insertar: ((fila: unknown[]) => void) | null = null
  let abierta = false
  let leidos = 0
  try {
    for await (const cruda of lineas) {
      leidos += cruda.length + 1
      const linea = cruda.endsWith(',') ? cruda.slice(0, -1) : cruda
      if (etapa === 'cabecera') {
        cabecera += `${cruda}\n`
        if (cruda === '"tables":{') {
          manifiesto = leerExportacion(`${cabecera}}}`).manifiesto
          respaldo = respaldarAntes(db, o, ahora)
          db.exec('PRAGMA foreign_keys = OFF')
          db.exec('BEGIN')
          abierta = true
          for (const t of tablasDe(db)) db.exec(`DELETE FROM "${t}"`)
          etapa = 'tablas'
        } else if (cabecera.length > 4 * 1024 * 1024) throw cortada()
      } else if (etapa === 'tablas') {
        if (linea === '}') {
          db.exec('COMMIT')
          abierta = false
          db.exec('PRAGMA foreign_keys = ON')
          cerrarImportacion(db, ahora)
          etapa = 'archivos'
        } else if (linea.startsWith('[')) {
          let fila: unknown[]
          try { fila = JSON.parse(linea) } catch { fila = JSON.parse(linea.slice(0, -2)) } // la última fila trae el «]}» de la tabla
          if (insertar) { insertar(fila); filas++; conFilas.add(tabla) }
        } else {
          const m = INICIO_TABLA.exec(linea)
          if (!m) throw cortada()
          tabla = JSON.parse(m[1])
          insertar = m[3] ? null : insertadorDe(db, tabla, JSON.parse(m[2]))
        }
      } else if (etapa === 'archivos') {
        if (linea === '"files":{') continue
        if (linea === '}}') { etapa = 'fin'; continue }
        const m = INICIO_ARCHIVO.exec(linea)
        if (!m || !linea.endsWith('"')) throw cortada()
        if (guardarArchivo(JSON.parse(m[1]), Buffer.from(linea.slice(m[0].length, -1), 'base64'))) archivos++
      }
      o.alAvanzar?.(Math.min(leidos, total), total)
    }
    if (etapa !== 'fin') throw cortada()
    o.alAvanzar?.(total, total)
  } catch (err) {
    if (abierta) {
      db.exec('ROLLBACK')
      db.exec('PRAGMA foreign_keys = ON')
    }
    if (etapa === 'cabecera' && !(err instanceof Error && /exportación|versión/.test(err.message))) throw cortada()
    throw err
  } finally {
    await lineas.return(undefined)
  }
  return { tablas: conFilas.size, filas, archivos, respaldo, manifiesto: manifiesto! }
}
