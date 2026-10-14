/**
 * Mudar a la nube: la compu le manda a la instancia de la nube su base entera y sus archivos (fotos, Taller, tandas,
 * cargas, agentes, bitácora), y la nube arranca con todo lo suyo. Una sola base, la de la nube; la compu y el celular
 * pasan a ser pantallas que la usan.
 * - Recibir (en la nube): cada archivo va a su carpeta dentro de /data; la base llega al final como «mastro.db.entrante»
 *   y el servidor se reinicia: al arrancar la pone en su lugar (la anterior queda como copia) y corrige las rutas.
 * - Enviar (en la compu): `npm run mastro -- mudar <url>`, con la clave de la nube en MASTRO_CLAVE_NUBE.
 * Todo pasa por la clave de siempre: sin ella no se recibe nada.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolverRuta } from './db.ts'
import { dirCargas } from './cargas/index.ts'

/** Las carpetas de datos que viajan (relativas a la carpeta de la base), más la bitácora. */
export const RAICES = ['adjuntos', 'taller', 'tandas', 'cargas', 'agentes'] as const
const CABECERA_SQLITE = 'SQLite format 3\0'

const dirDatos = () => path.dirname(resolverRuta())
const dirBitacora = () => path.resolve(process.env.MASTRO_BITACORA ?? path.join(process.cwd(), 'data', 'bitacora.md'))
const dirTandas = () => path.resolve(process.env.MASTRO_TANDAS ?? path.join(dirDatos(), 'tandas'))

/** Dónde va un archivo recibido. Solo dentro de las carpetas de datos: nada de «..», ni la base, ni otra cosa. */
export function destinoDe(rel: string): string {
  const limpio = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  const partes = limpio.split('/')
  if (!limpio || partes.some((p) => !p || p === '.' || p === '..')) throw new Error(`Ruta no permitida: ${rel}`)
  if (limpio === 'bitacora.md') return dirBitacora()
  const [raiz, ...resto] = partes
  if (!(RAICES as readonly string[]).includes(raiz) || !resto.length) throw new Error(`Ruta no permitida: ${rel}`)
  const base = raiz === 'cargas' ? dirCargas() : raiz === 'tandas' ? dirTandas() : path.join(dirDatos(), raiz)
  const destino = path.join(base, ...resto)
  if (!destino.startsWith(base + path.sep)) throw new Error(`Ruta no permitida: ${rel}`)
  return destino
}

export function recibirArchivo(rel: string, datos: Buffer): { ruta: string; bytes: number } {
  const destino = destinoDe(rel)
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  fs.writeFileSync(destino, datos)
  return { ruta: rel, bytes: datos.length }
}

/** La base llega entera y queda esperando el reinicio (no se pisa la que está abierta). */
export function recibirBase(datos: Buffer): { bytes: number } {
  if (datos.subarray(0, 16).toString('latin1') !== CABECERA_SQLITE) throw new Error('Eso no es una base de Mastropiero (SQLite)')
  const entrante = `${resolverRuta()}.entrante`
  fs.mkdirSync(path.dirname(entrante), { recursive: true })
  fs.writeFileSync(`${entrante}.tmp`, datos)
  fs.renameSync(`${entrante}.tmp`, entrante)
  return { bytes: datos.length }
}

/**
 * Al arrancar, antes de abrir la base: si llegó una por mudanza, la pone en su lugar (la anterior queda como
 * «.antes-<fecha>») y corrige las rutas de las cargas y tandas, que eran de la otra compu.
 */
export function aplicarBaseEntrante(ahora = Date.now()): { anterior: string | null } | null {
  const ruta = resolverRuta()
  const entrante = `${ruta}.entrante`
  if (!fs.existsSync(entrante)) return null
  let anterior: string | null = null
  if (fs.existsSync(ruta)) {
    anterior = `${ruta}.antes-${new Date(ahora).toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
    fs.renameSync(ruta, anterior)
  }
  for (const s of ['-wal', '-shm']) fs.rmSync(ruta + s, { force: true })
  fs.renameSync(entrante, ruta)
  const db = new DatabaseSync(ruta)
  try {
    const mover = (tabla: string, dir: string) => {
      try {
        const filas = db.prepare(`SELECT id, ruta FROM ${tabla} WHERE ruta IS NOT NULL`).all() as { id: number; ruta: string }[]
        const upd = db.prepare(`UPDATE ${tabla} SET ruta = ? WHERE id = ?`)
        for (const f of filas) upd.run(path.join(dir, path.basename(f.ruta.replace(/\\/g, '/'))), f.id)
      } catch { /* una base vieja sin esa tabla */ }
    }
    mover('cargas', dirCargas())
    mover('tandas', dirTandas())
  } finally {
    db.close()
  }
  return { anterior }
}

// ─── enviar (desde la compu) ────────────────────────────────────────────

type Pedir = (url: string, init: RequestInit) => Promise<Response>

/** Los archivos que viajan, con su ruta relativa (como la entiende destinoDe). */
export function archivosParaMudar(o: { sinCargas?: boolean } = {}): { rel: string; abs: string; bytes: number }[] {
  const out: { rel: string; abs: string; bytes: number }[] = []
  const recorrer = (dir: string, prefijo: string) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) recorrer(abs, `${prefijo}/${e.name}`)
      else if (e.isFile()) out.push({ rel: `${prefijo}/${e.name}`, abs, bytes: fs.statSync(abs).size })
    }
  }
  for (const r of RAICES) {
    if (r === 'cargas' && o.sinCargas) continue
    recorrer(r === 'cargas' ? dirCargas() : r === 'tandas' ? dirTandas() : path.join(dirDatos(), r), r)
  }
  if (fs.existsSync(dirBitacora())) out.push({ rel: 'bitacora.md', abs: dirBitacora(), bytes: fs.statSync(dirBitacora()).size })
  return out
}

/** Copia consistente de la base local (aunque el servidor esté prendido). */
export function fotoDeLaBase(): string {
  const tmp = path.join(os.tmpdir(), `mastro-mudanza-${Date.now()}.db`)
  const db = new DatabaseSync(resolverRuta())
  try { db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`) } finally { db.close() }
  return tmp
}

/**
 * Manda todo a la nube: entra con la clave, sube los archivos y al final la base (la nube se reinicia sola con ella).
 * Devuelve lo que la nube dice tener después.
 */
export async function mudar(url: string, clave: string, o: { sinCargas?: boolean; pedir?: Pedir; log?: (t: string) => void; esperarMs?: number } = {}) {
  const pedir = o.pedir ?? ((u, i) => fetch(u, i))
  const log = o.log ?? (() => {})
  const base = url.replace(/\/+$/, '')
  if (!clave || clave.length < 8) throw new Error('Falta la clave de la nube (MASTRO_CLAVE_NUBE, 8 caracteres o más)')
  const entrada = await pedir(`${base}/entrar`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ clave }).toString(), redirect: 'manual' })
  const cookie = /mastro=[^;]+/.exec(entrada.headers.get('set-cookie') ?? '')?.[0]
  if (!cookie) throw new Error(`La nube no aceptó la clave (respondió ${entrada.status})`)
  const subir = async (ruta: string, cuerpo: Buffer) => {
    for (let intento = 1; ; intento++) {
      try {
        const r = await pedir(`${base}${ruta}`, { method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream' }, body: new Uint8Array(cuerpo) })
        if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
        return
      } catch (e) {
        if (intento >= 3) throw new Error(`No pude subir ${ruta}: ${e instanceof Error ? e.message : e}`)
        await new Promise((ok) => setTimeout(ok, 2000 * intento))
      }
    }
  }
  const archivos = archivosParaMudar(o)
  const total = archivos.reduce((s, a) => s + a.bytes, 0)
  log(`Subiendo ${archivos.length} archivos (${Math.round(total / 1024 / 1024)} MB)…`)
  let hechos = 0
  for (const a of archivos) {
    await subir(`/api/mudanza/archivo?ruta=${encodeURIComponent(a.rel)}`, fs.readFileSync(a.abs))
    if (++hechos % 25 === 0 || hechos === archivos.length) log(`  ${hechos}/${archivos.length}`)
  }
  const foto = fotoDeLaBase()
  try {
    log(`Subiendo la base (${Math.round(fs.statSync(foto).size / 1024 / 1024)} MB)…`)
    await subir('/api/mudanza/base', fs.readFileSync(foto))
  } finally {
    fs.rmSync(foto, { force: true })
  }
  log('La nube se reinicia con tu base. Esperando que vuelva…')
  const hasta = Date.now() + (o.esperarMs ?? 180_000)
  do {
    if (o.esperarMs !== 0) await new Promise((ok) => setTimeout(ok, 4000))
    try {
      const r = await pedir(`${base}/api/mudanza`, { headers: { cookie } })
      if (r.ok) return await r.json() as { conteos: Record<string, number> }
    } catch { /* todavía arrancando */ }
  } while (Date.now() < hasta)
  throw new Error('La nube no volvió a tiempo: fijate en NaN si el contenedor arrancó (logs).')
}
