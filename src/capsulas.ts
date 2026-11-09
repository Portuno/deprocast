/**
 * Las cápsulas de 40 segundos (plan v38, fase 4, Fragua #163, con su ok explícito): grabar a una persona diciendo algo,
 * con cámara, solo después de su consentimiento. Lo que se puede hacer con ese material queda escrito y atado al video
 * («la aprobación no son 40 segundos libres de hacer cualquier cosa»), y la persona puede pedir que se borre: se borra
 * el video, y queda solo el rastro de que existió, con qué consentimiento y cuándo se borró.
 * El video no entra al corpus ni a ningún modelo: queda en su servidor.
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolverRuta, type Db } from './db.ts'

export const MAX_SEGUNDOS = 40
export type Capsula = { id: number; persona: string; entidadId: number | null; uso: string; consentimiento: string; aceptadoEn: number; duracion: number | null; mime: string; estado: 'vigente' | 'borrada'; borradaEn: number | null; motivoBorrado: string | null; creada: number }
const deFila = (r: any): Capsula => ({ id: r.id, persona: r.persona, entidadId: r.entidad_id, uso: r.uso, consentimiento: r.consentimiento, aceptadoEn: r.aceptado_en, duracion: r.duracion, mime: r.mime, estado: r.estado, borradaEn: r.borrada_en, motivoBorrado: r.motivo_borrado, creada: r.creada })
const dir = () => path.join(path.dirname(resolverRuta()), 'capsulas')
const ext = (mime: string) => (/mp4/.test(mime) ? 'mp4' : 'webm')
export const archivoDe = (c: Capsula) => path.join(dir(), `${c.id}.${ext(c.mime)}`)

/** Guarda una cápsula: sin persona, sin uso escrito o sin el consentimiento, no se guarda nada. */
export async function guardarCapsula(db: Db, datos: Buffer, m: { persona?: string | null; uso?: string | null; consentimiento?: string | null; acepto?: boolean | string | null; duracion?: number | string | null; mime?: string | null }, ahora = Date.now()): Promise<Capsula> {
  const persona = String(m.persona ?? '').trim().slice(0, 120)
  const uso = String(m.uso ?? '').trim().slice(0, 600)
  const consentimiento = String(m.consentimiento ?? '').trim().slice(0, 1200)
  if (!persona) throw new Error('¿Quién es la persona que se graba?')
  if (!uso) throw new Error('Falta para qué se va a usar: tiene que quedar escrito antes de grabar')
  if (!(m.acepto === true || m.acepto === '1' || m.acepto === 'true') || !consentimiento) throw new Error('Sin el consentimiento de la persona no se guarda nada')
  if (!datos.length) throw new Error('El video vino vacío')
  const duracion = m.duracion == null || m.duracion === '' ? null : Number(m.duracion)
  if (duracion != null && duracion > MAX_SEGUNDOS + 2) throw new Error(`Una cápsula dura como mucho ${MAX_SEGUNDOS} segundos`)
  const mime = /mp4/.test(String(m.mime ?? '')) ? 'video/mp4' : 'video/webm'
  const { entidadPorNombre } = await import('./personajes.ts')
  const r = db.prepare(`INSERT INTO capsulas (persona, entidad_id, uso, consentimiento, aceptado_en, duracion, mime, estado, creada) VALUES (?, ?, ?, ?, ?, ?, ?, 'vigente', ?)`)
    .run(persona, entidadPorNombre(db, persona), uso, consentimiento, ahora, duracion, mime, ahora)
  const c = deFila(db.prepare('SELECT * FROM capsulas WHERE id = ?').get(Number(r.lastInsertRowid)))
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(archivoDe(c), datos)
  return c
}

export const listarCapsulas = (db: Db) => (db.prepare('SELECT * FROM capsulas ORDER BY id DESC LIMIT 200').all() as any[]).map(deFila)
export function leerCapsula(db: Db, id: number): Capsula | null { const r = db.prepare('SELECT * FROM capsulas WHERE id = ?').get(id); return r ? deFila(r) : null }

/** A pedido de la persona (o suyo): se borra el video; queda el rastro de que existió, con su consentimiento y cuándo se borró. */
export function borrarCapsula(db: Db, id: number, motivo: string | null = null, ahora = Date.now()): Capsula {
  const c = leerCapsula(db, id)
  if (!c) throw new Error(`No existe la cápsula ${id}`)
  fs.rmSync(archivoDe(c), { force: true })
  db.prepare(`UPDATE capsulas SET estado = 'borrada', borrada_en = ?, motivo_borrado = ? WHERE id = ?`).run(ahora, motivo?.trim().slice(0, 300) || 'a pedido', id)
  return leerCapsula(db, id)!
}
