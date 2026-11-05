/**
 * Sus contactos de Google (plan v35, fase 3). Se traen todos a una tabla propia (para buscarlos: el mail de alguien
 * para un borrador, un teléfono, un cumpleaños) y los que son la misma persona que una de sus personas de Deprocast se
 * vinculan: la persona suma su mail, su teléfono, su trabajo y su cumpleaños (en meta.google). No se crea ninguna
 * persona nueva por cada contacto: serían cientos y la mayoría no importa.
 */
import type { Db } from '../db.ts'
import { fijarAjuste } from '../db.ts'
import { llamarGoogle } from './oauth.ts'

const API = 'https://people.googleapis.com/v1/people/me/connections'
const CAMPOS = 'names,emailAddresses,phoneNumbers,organizations,birthdays,nicknames'

export type Contacto = { recurso: string; nombre: string; emails: string[]; telefonos: string[]; trabajo: string | null; cumple: string | null; alias: string[] }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()

export function contactoDe(p: any): Contacto | null {
  const nombre = p.names?.[0]?.displayName?.trim()
  if (!nombre || !p.resourceName) return null
  const b = p.birthdays?.find((x: any) => x.date)?.date
  return {
    recurso: p.resourceName,
    nombre,
    emails: (p.emailAddresses ?? []).map((e: any) => String(e.value)).filter(Boolean),
    telefonos: (p.phoneNumbers ?? []).map((t: any) => String(t.canonicalForm ?? t.value)).filter(Boolean),
    trabajo: [p.organizations?.[0]?.title, p.organizations?.[0]?.name].filter(Boolean).join(' en ') || null,
    cumple: b?.month && b?.day ? `${b.year ? `${b.year}-` : ''}${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}` : null,
    alias: (p.nicknames ?? []).map((n: any) => String(n.value)).filter(Boolean),
  }
}

/** La persona de Deprocast que es este contacto: mismo nombre completo (o un alias completo), sin ambigüedad. */
function personaDe(personas: { id: number; claves: string[] }[], c: Contacto): number | null {
  // Solo nombre y apellido (o un alias de dos palabras): un nombre suelto sería adivinar.
  const claves = new Set([c.nombre, ...c.alias].map(norm).filter((x) => x.includes(' ')))
  const hits = personas.filter((p) => p.claves.some((k) => claves.has(k)))
  return hits.length === 1 ? hits[0].id : null
}

/** Trae sus contactos, los guarda y vincula los que coinciden con sus personas. */
export async function sincronizarContactos(db: Db, ahora = Date.now()): Promise<{ contactos: number; vinculados: number }> {
  const todos: Contacto[] = []
  let pagina: string | undefined
  do {
    const r = await llamarGoogle<any>(db, `${API}?personFields=${CAMPOS}&pageSize=1000${pagina ? `&pageToken=${pagina}` : ''}`)
    for (const p of r.connections ?? []) { const c = contactoDe(p); if (c) todos.push(c) }
    pagina = r.nextPageToken
  } while (pagina && todos.length < 10_000)
  const personas = (db.prepare(`SELECT id, nombre, alias FROM entidades WHERE tipo = 'persona'`).all() as { id: number; nombre: string; alias: string | null }[])
    .map((p) => ({ id: p.id, claves: [p.nombre, ...((() => { try { return JSON.parse(p.alias ?? '[]') as string[] } catch { return [] } })())].map(norm) }))
  const guardar = db.prepare(`INSERT INTO contactos_google (recurso, nombre, emails, telefonos, trabajo, cumple, entidad_id, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (recurso) DO UPDATE SET nombre = excluded.nombre, emails = excluded.emails, telefonos = excluded.telefonos, trabajo = excluded.trabajo, cumple = excluded.cumple, entidad_id = excluded.entidad_id, actualizado = excluded.actualizado`)
  const enriquecer = db.prepare(`UPDATE entidades SET meta = json_set(COALESCE(meta, '{}'), '$.google', json(?)) WHERE id = ?`)
  let vinculados = 0
  db.exec('BEGIN')
  try {
    for (const c of todos) {
      const entidad = personaDe(personas, c)
      guardar.run(c.recurso, c.nombre, JSON.stringify(c.emails), JSON.stringify(c.telefonos), c.trabajo, c.cumple, entidad, ahora)
      if (entidad) { enriquecer.run(JSON.stringify({ emails: c.emails, telefonos: c.telefonos, trabajo: c.trabajo, cumple: c.cumple, contacto: c.recurso }), entidad); vinculados++ }
    }
    // Los que ya no están en Google, fuera.
    db.prepare('DELETE FROM contactos_google WHERE actualizado < ?').run(ahora)
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  fijarAjuste(db, 'contactos_sincronizado', String(ahora))
  return { contactos: todos.length, vinculados }
}

/** Buscar en sus contactos (nombre, mail, teléfono o trabajo). */
export function buscarContactos(db: Db, q: string, limite = 10) {
  const t = `%${q.trim()}%`
  return (db.prepare(`SELECT c.*, e.nombre AS persona FROM contactos_google c LEFT JOIN entidades e ON e.id = c.entidad_id
    WHERE c.nombre LIKE ? OR c.emails LIKE ? OR c.telefonos LIKE ? OR c.trabajo LIKE ? ORDER BY c.entidad_id IS NULL, c.nombre LIMIT ?`).all(t, t, t, t, Math.min(limite, 50)) as any[])
    .map((c) => ({ nombre: c.nombre, emails: JSON.parse(c.emails), telefonos: JSON.parse(c.telefonos), trabajo: c.trabajo, cumple: c.cumple, persona_en_deprocast: c.persona ?? null, entidad: c.entidad_id }))
}

export function estadoContactos(db: Db) {
  const n = db.prepare('SELECT COUNT(*) AS total, COUNT(entidad_id) AS vinculados FROM contactos_google').get() as { total: number; vinculados: number }
  return n
}
