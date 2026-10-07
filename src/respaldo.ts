/**
 * Respaldo y restauración: para mudar Mastropiero de compu sin perder nada.
 * El respaldo es una carpeta: la base (copia consistente con VACUUM INTO, aunque el servidor esté prendido),
 * los archivos de las cargas y un manifiesto. El .env no viaja (tiene las keys): se copia a mano.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolverRuta, type Db } from './db.ts'
import { dirCargas } from './cargas/index.ts'

const dos = (n: number) => String(n).padStart(2, '0')

function marca(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}`
}

export type Manifiesto = { creado: string; base: string; cargas: number; conteos: Record<string, number> }

const CONTEOS = ['agentes', 'tareas', 'corpus', 'quantomos', 'entidades', 'memoria', 'jornadas', 'conversaciones', 'mensajes', 'cargas']

export function respaldar(db: Db, o: { destino?: string; ahora?: number } = {}): { carpeta: string; manifiesto: Manifiesto } {
  const ahora = o.ahora ?? Date.now()
  const base = o.destino ?? path.join(path.dirname(resolverRuta()), 'respaldos')
  let carpeta = path.join(base, marca(ahora))
  for (let i = 2; fs.existsSync(carpeta); i++) carpeta = path.join(base, `${marca(ahora)}-${i}`)
  fs.mkdirSync(carpeta, { recursive: true })
  // VACUUM INTO no acepta parámetros: la ruta va escapada a mano.
  db.exec(`VACUUM INTO '${path.join(carpeta, 'mastro.db').replace(/'/g, "''")}'`)
  const origenCargas = dirCargas()
  let cargas = 0
  if (fs.existsSync(origenCargas)) {
    fs.cpSync(origenCargas, path.join(carpeta, 'cargas'), { recursive: true })
    cargas = fs.readdirSync(origenCargas).length
  }
  const conteos = Object.fromEntries(CONTEOS.map((t) => {
    try {
      return [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]
    } catch {
      return [t, 0]
    }
  }))
  const manifiesto: Manifiesto = { creado: new Date(ahora).toISOString(), base: 'mastro.db', cargas, conteos }
  fs.writeFileSync(path.join(carpeta, 'manifiesto.json'), JSON.stringify(manifiesto, null, 2))
  return { carpeta, manifiesto }
}

/**
 * Pone un respaldo en su lugar. Si ya hay una base, no la pisa salvo con `forzar`, y aun así la guarda antes
 * (mastro.db.antes-<fecha>). Los archivos de cargas se suman sin pisar y sus rutas se reescriben a esta compu.
 */
export function restaurar(origen: string, o: { forzar?: boolean; destino?: string; ahora?: number } = {}): { base: string; cargas: number; anterior: string | null; conteos: Record<string, number> } {
  const ahora = o.ahora ?? Date.now()
  const desde = path.resolve(origen)
  const baseOrigen = path.join(desde, 'mastro.db')
  if (!fs.existsSync(baseOrigen)) throw new Error(`No encuentro ${baseOrigen}: ¿es una carpeta de respaldo?`)
  const destino = path.resolve(o.destino ?? resolverRuta())
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  let anterior: string | null = null
  if (fs.existsSync(destino)) {
    if (!o.forzar) throw new Error(`Ya hay una base en ${destino}. Usá --forzar: la actual se guarda antes como copia.`)
    anterior = `${destino}.antes-${marca(ahora)}`
    fs.renameSync(destino, anterior)
    for (const s of ['-wal', '-shm']) if (fs.existsSync(destino + s)) fs.renameSync(destino + s, anterior + s)
  }
  fs.copyFileSync(baseOrigen, destino)

  // Archivos de cargas: se suman a los que haya, sin pisar.
  const cargasOrigen = path.join(desde, 'cargas')
  const cargasDestino = dirCargas()
  let cargas = 0
  if (fs.existsSync(cargasOrigen)) {
    fs.mkdirSync(cargasDestino, { recursive: true })
    for (const f of fs.readdirSync(cargasOrigen)) {
      const a = path.join(cargasDestino, f)
      if (!fs.existsSync(a)) fs.copyFileSync(path.join(cargasOrigen, f), a)
      cargas++
    }
  }
  // Las rutas guardadas eran de la otra compu: apuntan ahora a esta carpeta de cargas.
  const db = new DatabaseSync(destino)
  try {
    const filas = db.prepare('SELECT id, ruta FROM cargas WHERE ruta IS NOT NULL').all() as { id: number; ruta: string }[]
    const upd = db.prepare('UPDATE cargas SET ruta = ? WHERE id = ?')
    for (const f of filas) upd.run(path.join(cargasDestino, path.basename(f.ruta.replace(/\\/g, '/'))), f.id)
    const conteos = Object.fromEntries(CONTEOS.map((t) => {
      try {
        return [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]
      } catch {
        return [t, 0]
      }
    }))
    return { base: destino, cargas, anterior, conteos }
  } finally {
    db.close()
  }
}
