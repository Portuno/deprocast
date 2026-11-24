/**
 * Quién te llama y quién te escribe (Mobile 2.4). Del teléfono llegan:
 * - las llamadas (del registro de llamadas, con su permiso): quién, cuándo, cuánto duró y si fue entrante, saliente o
 *   perdida; nunca lo que se habló;
 * - quién te escribe (de los avisos de WhatsApp, Telegram, Instagram, Signal, Messenger y los SMS, con «Acceso a
 *   notificaciones»): el remitente, la app, si era un grupo y cuándo; nunca el texto.
 * Cada uno se ata a una persona tuya si el nombre la identifica sin dudas (personaPorNombre). De acá salen el último
 * contacto de cada persona (Personas), las llamadas y los mensajes del Diario del día, y ver_comunicaciones.
 */
import { fechaLocal, type Db } from './db.ts'

export type Llamada = { en: number; numero: string | null; nombre: string | null; tipo: 'entrante' | 'saliente' | 'perdida' | 'rechazada'; duracionS: number; personaId: number | null }
export type Recibido = { en: number; app: string; remitente: string; conversacion: string | null; grupo: boolean; personaId: number | null }
const TIPOS = ['entrante', 'saliente', 'perdida', 'rechazada'] as const

function asegurar(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS llamadas_telefono (fuente TEXT NOT NULL, en INTEGER NOT NULL, numero TEXT, nombre TEXT, tipo TEXT NOT NULL, duracion_s INTEGER NOT NULL DEFAULT 0, persona_id INTEGER, PRIMARY KEY (fuente, en, numero));
    CREATE INDEX IF NOT EXISTS llamadas_tel_en ON llamadas_telefono (en);
    CREATE TABLE IF NOT EXISTS mensajes_recibidos (fuente TEXT NOT NULL, en INTEGER NOT NULL, app TEXT NOT NULL, remitente TEXT NOT NULL, conversacion TEXT, grupo INTEGER NOT NULL DEFAULT 0, persona_id INTEGER, PRIMARY KEY (fuente, en, app, remitente));
    CREATE INDEX IF NOT EXISTS recibidos_en ON mensajes_recibidos (en);`)
}

async function personaDe(db: Db, nombre: string | null): Promise<number | null> {
  if (!nombre || nombre.length < 3 || /^[+\d\s()-]+$/.test(nombre)) return null
  try { return (await import('./personajes.ts')).personaPorNombre(db, nombre, { sinJugador: true }) } catch { return null }
}

const valido = (en: number, ahora: number) => Number.isFinite(en) && en > 0 && en <= ahora + 120_000

export async function recibirLlamadas(db: Db, fuente: string, xs: unknown, ahora = Date.now()): Promise<number> {
  asegurar(db)
  const ins = db.prepare('INSERT OR IGNORE INTO llamadas_telefono (fuente, en, numero, nombre, tipo, duracion_s, persona_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
  let n = 0
  for (const x of (Array.isArray(xs) ? xs : []).slice(0, 2000) as any[]) {
    const en = Math.round(Number(x?.en))
    if (!valido(en, ahora)) continue
    const tipo = (TIPOS as readonly string[]).includes(String(x?.tipo)) ? String(x.tipo) : 'entrante'
    const nombre = x?.nombre ? String(x.nombre).trim().slice(0, 80) : null
    const numero = x?.numero ? String(x.numero).replace(/[^\d+]/g, '').slice(0, 20) || null : null
    n += Number(ins.run(fuente.slice(0, 40), en, numero, nombre, tipo, Math.max(0, Math.round(Number(x?.duracionS) || 0)), await personaDe(db, nombre)).changes)
  }
  return n
}

export async function recibirMensajes(db: Db, fuente: string, xs: unknown, ahora = Date.now()): Promise<number> {
  asegurar(db)
  const ins = db.prepare('INSERT OR IGNORE INTO mensajes_recibidos (fuente, en, app, remitente, conversacion, grupo, persona_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
  let n = 0
  for (const x of (Array.isArray(xs) ? xs : []).slice(0, 3000) as any[]) {
    const en = Math.round(Number(x?.en))
    const remitente = String(x?.remitente ?? '').trim().slice(0, 80)
    if (!valido(en, ahora) || !remitente) continue
    const conversacion = x?.conversacion ? String(x.conversacion).trim().slice(0, 80) : null
    n += Number(ins.run(fuente.slice(0, 40), en, String(x?.app ?? '').slice(0, 40) || 'otra', remitente, conversacion, x?.grupo ? 1 : 0, await personaDe(db, remitente)).changes)
  }
  return n
}

export function llamadasEntre(db: Db, a: number, b: number): Llamada[] {
  asegurar(db)
  return (db.prepare('SELECT * FROM llamadas_telefono WHERE en >= ? AND en < ? ORDER BY en').all(a, b) as any[])
    .map((r) => ({ en: r.en, numero: r.numero, nombre: r.nombre, tipo: r.tipo, duracionS: r.duracion_s, personaId: r.persona_id }))
}
export function recibidosEntre(db: Db, a: number, b: number): Recibido[] {
  asegurar(db)
  return (db.prepare('SELECT * FROM mensajes_recibidos WHERE en >= ? AND en < ? ORDER BY en').all(a, b) as any[])
    .map((r) => ({ en: r.en, app: r.app, remitente: r.remitente, conversacion: r.conversacion, grupo: !!r.grupo, personaId: r.persona_id }))
}

/** El último contacto de cada persona (por llamadas con duración o mensajes suyos), 'AAAA-MM-DD'. Para Personas. */
export function ultimosContactos(db: Db): Map<number, string> {
  const m = new Map<number, string>()
  const existe = (t: string) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t)
  if (!existe('llamadas_telefono')) return m
  const filas = db.prepare(`SELECT persona_id AS p, MAX(en) AS en FROM (
      SELECT persona_id, en FROM llamadas_telefono WHERE persona_id IS NOT NULL AND (duracion_s > 0 OR tipo = 'saliente')
      UNION ALL SELECT persona_id, en FROM mensajes_recibidos WHERE persona_id IS NOT NULL AND grupo = 0) GROUP BY persona_id`).all() as { p: number; en: number }[]
  for (const f of filas) m.set(f.p, fechaLocal(f.en))
  return m
}

/** De quién supiste en los últimos días: llamadas y mensajes por persona (o por nombre si no hay persona). */
export function comunicacionesRecientes(db: Db, dias = 7, ahora = Date.now()) {
  const a = ahora - dias * 86_400_000
  const ls = llamadasEntre(db, a, ahora + 1), ms = recibidosEntre(db, a, ahora + 1)
  const por = new Map<string, { quien: string; llamadas: number; minutos: number; perdidas: number; mensajes: number; ultima: number }>()
  const de = (k: string) => por.get(k) ?? por.set(k, { quien: k, llamadas: 0, minutos: 0, perdidas: 0, mensajes: 0, ultima: 0 }).get(k)!
  for (const l of ls) { const x = de(l.nombre ?? l.numero ?? 'Desconocido'); x.llamadas++; x.minutos += Math.round(l.duracionS / 60); if (l.tipo === 'perdida') x.perdidas++; x.ultima = Math.max(x.ultima, l.en) }
  for (const m of ms) { const x = de(m.grupo && m.conversacion ? m.conversacion : m.remitente); x.mensajes++; x.ultima = Math.max(x.ultima, m.en) }
  return { dias, llamadas: ls.length, mensajes: ms.length, personas: [...por.values()].sort((x, y) => y.mensajes + y.llamadas * 5 - (x.mensajes + x.llamadas * 5)).slice(0, 40) }
}
