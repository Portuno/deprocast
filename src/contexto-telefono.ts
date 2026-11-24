/**
 * El contexto del teléfono (Mobile 2.3): a qué wifi estaba conectado y qué audio Bluetooth tenía (el auto, los
 * auriculares), cuando cambia. Llega por la cola de eventos del teléfono. Sirve al Diario del día (cuándo te subiste al
 * auto, cuándo llegaste a la wifi de casa) y, más adelante, a ubicar sin GPS.
 */
import type { Db } from './db.ts'

export type Muestra = { en: number; wifi: string | null; bt: string[] }

function asegurar(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS contexto_telefono (fuente TEXT NOT NULL, en INTEGER NOT NULL, wifi TEXT, bt TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (fuente, en))`)
}

export function recibirContexto(db: Db, fuente: string, m: any, ahora = Date.now()): boolean {
  asegurar(db)
  const en = Math.round(Number(m?.en))
  if (!Number.isFinite(en) || en <= 0 || en > ahora + 120_000) return false
  const wifi = m?.wifi ? String(m.wifi).slice(0, 64) : null
  const bt = (Array.isArray(m?.bt) ? m.bt : []).map((x: unknown) => String(x).slice(0, 64)).slice(0, 6)
  return Number(db.prepare('INSERT OR IGNORE INTO contexto_telefono (fuente, en, wifi, bt) VALUES (?, ?, ?, ?)').run(fuente.slice(0, 40), en, wifi, JSON.stringify(bt)).changes) > 0
}

export function contextoEntre(db: Db, a: number, b: number): Muestra[] {
  asegurar(db)
  return (db.prepare('SELECT en, wifi, bt FROM contexto_telefono WHERE en >= ? AND en < ? ORDER BY en').all(a, b) as { en: number; wifi: string | null; bt: string }[])
    .map((x) => ({ en: x.en, wifi: x.wifi, bt: (() => { try { return JSON.parse(x.bt) } catch { return [] } })() }))
}

/** Los tramos con un audio Bluetooth conectado: { nombre, desde, hasta }. */
export function tramosBluetooth(ms: Muestra[], fin: number): { nombre: string; desde: number; hasta: number }[] {
  const out: { nombre: string; desde: number; hasta: number }[] = []
  const abiertos = new Map<string, number>()
  for (const m of ms) {
    for (const n of m.bt) if (!abiertos.has(n)) abiertos.set(n, m.en)
    for (const [n, desde] of [...abiertos]) if (!m.bt.includes(n)) { out.push({ nombre: n, desde, hasta: m.en }); abiertos.delete(n) }
  }
  for (const [n, desde] of abiertos) out.push({ nombre: n, desde, hasta: fin })
  return out.sort((a, b) => a.desde - b.desde)
}
