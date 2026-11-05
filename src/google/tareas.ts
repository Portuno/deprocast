/**
 * Google Tasks ↔ sus tareas de Deprocast (las misiones terciarias del jugador: side quests y tareas con fecha), plan
 * v35, fase 3. En las dos direcciones, comparando contra lo que había en la última pasada (así se sabe qué lado cambió):
 * - lo que cambió en Google (título, fecha, tachada) se aplica en Deprocast, y viceversa;
 * - una tarea nueva en Google entra a Deprocast; una nueva en Deprocast (creada desde que se prendió) va a «Mis tareas»;
 * - borrada en Google → descartada en Deprocast; descartada en Deprocast → borrada en Google.
 * Las tareas viejas de Deprocast no se suben solas (para no inundar su Google Tasks).
 */
import { ajuste, fijarAjuste, type Db } from '../db.ts'
import { actualizarMision, crearMision, leerMision } from '../misiones.ts'
import { llamarGoogle } from './oauth.ts'

const API = 'https://tasks.googleapis.com/tasks/v1'
type Tarea = { id: string; title?: string; notes?: string; due?: string; status?: 'needsAction' | 'completed'; deleted?: boolean; hidden?: boolean; updated?: string }
type Foto = { titulo: string; vence: string | null; hecha: boolean }
type Enlace = { mision_id: number; task_id: string; lista: string; titulo: string; vence: string | null; hecha: number }

const venceDe = (due?: string) => (due ? due.slice(0, 10) : null)
const dueDe = (vence: string | null) => (vence ? `${vence}T00:00:00.000Z` : null)
const CERRADA = new Set(['hecha', 'parcial', 'no', 'descartada'])

export const tareasActivas = (db: Db) => ajuste(db, 'tareas_google') === '1'

/** Prender la sincronización: desde ahora, lo que crea en Deprocast también va a Google. */
export function prenderTareas(db: Db, si: boolean, ahora = Date.now()) {
  fijarAjuste(db, 'tareas_google', si ? '1' : '0')
  if (si && !ajuste(db, 'tareas_google_desde')) fijarAjuste(db, 'tareas_google_desde', String(ahora))
}

async function listas(db: Db): Promise<{ id: string; title: string }[]> {
  return (await llamarGoogle<{ items?: { id: string; title: string }[] }>(db, `${API}/users/@me/lists?maxResults=100`)).items ?? []
}

async function tareasDe(db: Db, lista: string): Promise<Tarea[]> {
  const out: Tarea[] = []
  let pagina: string | undefined
  do {
    const r = await llamarGoogle<{ items?: Tarea[]; nextPageToken?: string }>(db, `${API}/lists/${encodeURIComponent(lista)}/tasks?showCompleted=true&showHidden=true&showDeleted=true&maxResults=100${pagina ? `&pageToken=${pagina}` : ''}`)
    out.push(...(r.items ?? []))
    pagina = r.nextPageToken
  } while (pagina && out.length < 2000)
  return out
}

export async function sincronizarTareas(db: Db, ahora = Date.now()): Promise<{ deGoogle: number; aGoogle: number; cambios: number }> {
  const res = { deGoogle: 0, aGoogle: 0, cambios: 0 }
  if (!tareasActivas(db)) return res
  const desde = Number(ajuste(db, 'tareas_google_desde')) || ahora
  const enlaces = new Map((db.prepare('SELECT * FROM tareas_google').all() as Enlace[]).map((e) => [e.task_id, e]))
  const foto = db.prepare('INSERT INTO tareas_google (mision_id, task_id, lista, titulo, vence, hecha) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (mision_id) DO UPDATE SET task_id = excluded.task_id, lista = excluded.lista, titulo = excluded.titulo, vence = excluded.vence, hecha = excluded.hecha')
  const guardarFoto = (misionId: number, t: { id: string }, lista: string, f: Foto) => foto.run(misionId, t.id, lista, f.titulo, f.vence, f.hecha ? 1 : 0)
  const parche = (lista: string, id: string, cuerpo: Record<string, unknown>) => llamarGoogle(db, `${API}/lists/${encodeURIComponent(lista)}/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) })
  const vistas = new Set<string>()

  for (const l of await listas(db)) {
    for (const t of await tareasDe(db, l.id)) {
      vistas.add(t.id)
      const e = enlaces.get(t.id)
      const g: Foto = { titulo: (t.title ?? '').trim(), vence: venceDe(t.due), hecha: t.status === 'completed' }
      if (!e) {
        // Nueva en Google (sin título, borrada o ya tachada antes de prender: no entra).
        if (t.deleted || !g.titulo || g.hecha) continue
        const m = crearMision(db, { personaje: 'jugador', nivel: 'terciaria', titulo: g.titulo.slice(0, 140), detalle: t.notes?.trim() || null, vence: g.vence, estado: 'activa', creadaPor: 'google' }, { por: 'google', ahora })
        guardarFoto(m.id, t, l.id, g)
        res.deGoogle++
        continue
      }
      const m = leerMision(db, e.mision_id)
      if (!m) { db.prepare('DELETE FROM tareas_google WHERE mision_id = ?').run(e.mision_id); continue }
      if (t.deleted) {
        if (!CERRADA.has(m.estado)) { actualizarMision(db, m.id, { estado: 'descartada' }, { por: 'google', ahora }); res.cambios++ }
        db.prepare('DELETE FROM tareas_google WHERE mision_id = ?').run(m.id)
        continue
      }
      const s: Foto = { titulo: e.titulo, vence: e.vence, hecha: !!e.hecha }
      const d: Foto = { titulo: m.titulo, vence: m.vence, hecha: CERRADA.has(m.estado) }
      if (m.estado === 'descartada') {
        await llamarGoogle(db, `${API}/lists/${encodeURIComponent(l.id)}/tasks/${encodeURIComponent(t.id)}`, { method: 'DELETE' }).catch(() => {})
        db.prepare('DELETE FROM tareas_google WHERE mision_id = ?').run(m.id)
        res.cambios++
        continue
      }
      // Cada campo: si cambió en Google, gana Google; si no, y cambió en Deprocast, va a Google.
      const aDeprocast: Record<string, unknown> = {}
      const aGoogle: Record<string, unknown> = {}
      if (g.titulo !== s.titulo) aDeprocast.titulo = g.titulo.slice(0, 140); else if (d.titulo !== s.titulo) aGoogle.title = d.titulo
      if (g.vence !== s.vence) aDeprocast.vence = g.vence; else if (d.vence !== s.vence) aGoogle.due = dueDe(d.vence)
      if (g.hecha !== s.hecha) aDeprocast.estado = g.hecha ? 'hecha' : 'activa'; else if (d.hecha !== s.hecha) aGoogle.status = d.hecha ? 'completed' : 'needsAction'
      if (Object.keys(aDeprocast).length) { actualizarMision(db, m.id, aDeprocast, { por: 'google', ahora }); res.cambios++ }
      if (Object.keys(aGoogle).length) { await parche(l.id, t.id, aGoogle); res.cambios++ }
      const ahoraM = leerMision(db, m.id)!
      guardarFoto(m.id, t, l.id, { titulo: ahoraM.titulo, vence: ahoraM.vence, hecha: CERRADA.has(ahoraM.estado) })
    }
  }

  // Enlaces cuya tarea ya no aparece en ninguna lista (la borraron del todo): fuera el enlace.
  for (const [id, e] of enlaces) if (!vistas.has(id)) db.prepare('DELETE FROM tareas_google WHERE mision_id = ?').run(e.mision_id)

  // Nuevas en Deprocast (creadas desde que se prendió, abiertas, no vinieron de Google): a «Mis tareas».
  const nuevas = db.prepare(`SELECT m.id FROM misiones m LEFT JOIN tareas_google t ON t.mision_id = m.id
    WHERE t.mision_id IS NULL AND m.personaje = 'jugador' AND m.nivel = 'terciaria' AND m.estado = 'activa' AND m.creada_en >= ? AND m.creada_por != 'google'`).all(desde) as { id: number }[]
  for (const { id } of nuevas) {
    const m = leerMision(db, id)!
    const t = await llamarGoogle<Tarea>(db, `${API}/lists/@default/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: m.titulo, ...(m.detalle ? { notes: m.detalle } : {}), ...(m.vence ? { due: dueDe(m.vence) } : {}) }) })
    guardarFoto(m.id, t, '@default', { titulo: m.titulo, vence: m.vence, hecha: false })
    res.aGoogle++
  }
  fijarAjuste(db, 'tareas_sincronizado', String(ahora))
  return res
}

export function estadoTareas(db: Db) {
  return { activa: tareasActivas(db), enlazadas: (db.prepare('SELECT COUNT(*) AS n FROM tareas_google').get() as { n: number }).n, sincronizado: Number(ajuste(db, 'tareas_sincronizado')) || null }
}
