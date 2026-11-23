/**
 * Ordenar su Gmail de verdad (Fragua #337): archivar, etiquetar y marcar leído o no leído por id, y reglas guardadas por
 * remitente, asunto o categoría que un encargo aplica solo («boletines y digests → archivar + leído»; clientes, equipo,
 * facturas y eventos → quedan en la bandeja). Antes las herramientas de correo solo leían y dejaban borradores: el
 * encargo «Archivar o marcar como leído» decía qué convendría y no hacía nada. Nada se borra: archivar saca de la
 * bandeja de entrada y el mail sigue en «Todos». Hace falta el permiso gmail.modify (volver a conectar Google).
 */
import type { Db } from '../db.ts'
import { llamarGoogle, permisosQueFaltan } from './oauth.ts'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
export const ALCANCE_MODIFICAR = 'https://www.googleapis.com/auth/gmail.modify'
const SIN_PERMISO = { sin_permiso: true as const, aviso: 'Para archivar, etiquetar o marcar leído en tu Gmail hace falta volver a conectar Google (Ajustes → Google) y aceptar el permiso de organizar el correo. Nada se borra: archivar solo lo saca de la bandeja de entrada.' }

export type Cambio = { archivar?: boolean; leido?: boolean; sumar?: string[]; quitar?: string[] }

/** Las etiquetas de Gmail por nombre (sin mayúsculas); las que no existen se crean si se pide. */
async function etiquetasPorNombre(db: Db, nombres: string[], crear: boolean): Promise<Map<string, string>> {
  const r = await llamarGoogle<{ labels?: { id: string; name: string }[] }>(db, `${API}/labels`)
  const m = new Map((r.labels ?? []).map((l) => [l.name.toLowerCase(), l.id]))
  for (const n of nombres) {
    const k = n.trim().toLowerCase()
    if (!k || m.has(k)) continue
    if (!crear) throw new Error(`No hay una etiqueta «${n}» en tu Gmail`)
    const nueva = await llamarGoogle<{ id: string }>(db, `${API}/labels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n.trim(), labelListVisibility: 'labelShow', messageListVisibility: 'show' }) })
    m.set(k, nueva.id)
  }
  return m
}

/**
 * Cambia mails en Gmail por id (de a 1000, como deja Gmail) y deja igual la copia de acá. Las etiquetas del sistema
 * (INBOX, UNREAD, STARRED, IMPORTANT) van por su nombre; las suyas, por como se llaman.
 */
export async function modificarMails(db: Db, ids: string[], c: Cambio): Promise<{ cambiados: number; ids: string[] } | typeof SIN_PERMISO> {
  if (permisosQueFaltan(db).includes(ALCANCE_MODIFICAR)) return SIN_PERMISO
  const unicos = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))]
  if (!unicos.length) return { cambiados: 0, ids: [] }
  const SISTEMA = new Set(['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT', 'SPAM'])
  const propias = [...(c.sumar ?? []), ...(c.quitar ?? [])].filter((n) => !SISTEMA.has(n.toUpperCase()))
  const porNombre = propias.length ? await etiquetasPorNombre(db, propias, true) : new Map<string, string>()
  const id = (n: string) => (SISTEMA.has(n.toUpperCase()) ? n.toUpperCase() : porNombre.get(n.trim().toLowerCase())!)
  const sumar = new Set((c.sumar ?? []).map(id))
  const quitar = new Set((c.quitar ?? []).map(id))
  if (c.archivar) quitar.add('INBOX')
  if (c.leido === true) quitar.add('UNREAD')
  if (c.leido === false) sumar.add('UNREAD')
  if (!sumar.size && !quitar.size) throw new Error('¿Qué hago con esos mails? Archivar, marcar leído o no leído, o poner o sacar una etiqueta.')
  try {
    for (let i = 0; i < unicos.length; i += 1000) {
      await llamarGoogle(db, `${API}/messages/batchModify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: unicos.slice(i, i + 1000), addLabelIds: [...sumar], removeLabelIds: [...quitar] }) })
    }
  } catch (e) {
    if ((e as { status?: number }).status === 403) return SIN_PERMISO
    throw e
  }
  // La copia local: mismas etiquetas, y leído según UNREAD.
  const leer = db.prepare('SELECT etiquetas FROM correos WHERE id = ?')
  const poner = db.prepare('UPDATE correos SET etiquetas = ?, leido = ? WHERE id = ?')
  for (const x of unicos) {
    const fila = leer.get(x) as { etiquetas: string } | undefined
    if (!fila) continue
    const ets = new Set(fila.etiquetas.split(' ').filter(Boolean))
    for (const q of quitar) ets.delete(q)
    for (const s of sumar) ets.add(s)
    poner.run([...ets].join(' '), ets.has('UNREAD') ? 0 : 1, x)
  }
  return { cambiados: unicos.length, ids: unicos }
}

// ─── reglas ────────────────────────────────────────────────────────────────

const CATEGORIAS = { promociones: 'CATEGORY_PROMOTIONS', social: 'CATEGORY_SOCIAL', foros: 'CATEGORY_FORUMS', notificaciones: 'CATEGORY_UPDATES', personal: 'CATEGORY_PERSONAL' } as const
export type Regla = { id: number; nombre: string; de: string | null; asunto: string | null; categoria: string | null; dejar: boolean; archivar: boolean; leido: boolean; etiqueta: string | null; activa: boolean }

const listas = new WeakSet<Db>()
function asegurar(db: Db) {
  if (listas.has(db)) return
  db.exec(`CREATE TABLE IF NOT EXISTS reglas_correo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    de TEXT,               -- parte del remitente (mail, dominio o nombre); varias separadas por coma
    asunto TEXT,           -- parte del asunto; varias separadas por coma
    categoria TEXT,        -- promociones | social | foros | notificaciones | personal
    dejar INTEGER NOT NULL DEFAULT 0, -- 1: lista blanca, se queda en la bandeja aunque otra regla diga otra cosa
    archivar INTEGER NOT NULL DEFAULT 0,
    leido INTEGER NOT NULL DEFAULT 0,
    etiqueta TEXT,
    activa INTEGER NOT NULL DEFAULT 1,
    creada_en INTEGER NOT NULL
  )`)
  listas.add(db)
}
const deRegla = (r: any): Regla => ({ id: r.id, nombre: r.nombre, de: r.de, asunto: r.asunto, categoria: r.categoria, dejar: !!r.dejar, archivar: !!r.archivar, leido: !!r.leido, etiqueta: r.etiqueta, activa: !!r.activa })

export function reglas(db: Db): Regla[] {
  asegurar(db)
  return (db.prepare('SELECT * FROM reglas_correo ORDER BY dejar DESC, id').all() as any[]).map(deRegla)
}

export function guardarRegla(db: Db, r: { nombre?: string; de?: string | null; asunto?: string | null; categoria?: string | null; dejar?: boolean; archivar?: boolean; leido?: boolean; etiqueta?: string | null }, ahora = Date.now()): Regla {
  asegurar(db)
  const de = r.de?.trim() || null, asunto = r.asunto?.trim() || null
  const categoria = r.categoria?.trim().toLowerCase() || null
  if (categoria && !(categoria in CATEGORIAS)) throw new Error(`Categoría: ${Object.keys(CATEGORIAS).join(', ')}`)
  if (!de && !asunto && !categoria) throw new Error('La regla necesita a qué mails se aplica: un remitente, una parte del asunto o una categoría.')
  const dejar = !!r.dejar
  if (!dejar && !r.archivar && !r.leido && !r.etiqueta?.trim()) throw new Error('¿Qué hace la regla? Archivar, marcar leído, etiquetar, o dejar en la bandeja (lista blanca).')
  const nombre = r.nombre?.trim() || [de && `de ${de}`, asunto && `«${asunto}»`, categoria].filter(Boolean).join(' · ')
  const res = db.prepare('INSERT INTO reglas_correo (nombre, de, asunto, categoria, dejar, archivar, leido, etiqueta, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(nombre.slice(0, 120), de, asunto, categoria, dejar ? 1 : 0, !dejar && r.archivar ? 1 : 0, !dejar && r.leido ? 1 : 0, dejar ? null : r.etiqueta?.trim() || null, ahora)
  return deRegla(db.prepare('SELECT * FROM reglas_correo WHERE id = ?').get(Number(res.lastInsertRowid)))
}

export function borrarRegla(db: Db, id: number): boolean {
  asegurar(db)
  return Number(db.prepare('DELETE FROM reglas_correo WHERE id = ?').run(id).changes) > 0
}

const partes = (s: string | null) => (s ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
export function aplica(r: Regla, c: { de: string; asunto: string; etiquetas: string }): boolean {
  if (!r.activa) return false
  if (r.de && !partes(r.de).some((p) => c.de.toLowerCase().includes(p))) return false
  if (r.asunto && !partes(r.asunto).some((p) => c.asunto.toLowerCase().includes(p))) return false
  if (r.categoria && !c.etiquetas.split(' ').includes(CATEGORIAS[r.categoria as keyof typeof CATEGORIAS])) return false
  return true
}

/**
 * Aplica las reglas a lo que está en la bandeja de entrada (lo de los últimos días, que no es suyo). La lista blanca va
 * primero: lo que entra ahí no se toca. Con probar, dice qué haría sin cambiar nada. Devuelve qué se hizo, mail por mail.
 */
export async function aplicarReglas(db: Db, o: { dias?: number; probar?: boolean; ahora?: number } = {}) {
  const rs = reglas(db).filter((r) => r.activa)
  if (!rs.length) return { sin_reglas: true, aviso: 'No hay reglas de correo: armalas con regla_de_correo (por ejemplo, boletines → archivar y marcar leído; clientes y facturas → dejar).' }
  const desde = (o.ahora ?? Date.now()) - (o.dias ?? 7) * 86_400_000
  const bandeja = db.prepare(`SELECT id, de, asunto, etiquetas FROM correos WHERE fecha >= ? AND suyo = 0 AND (' ' || etiquetas || ' ') LIKE '% INBOX %' ORDER BY fecha DESC`).all(desde) as { id: string; de: string; asunto: string; etiquetas: string }[]
  const blancas = rs.filter((r) => r.dejar), accion = rs.filter((r) => !r.dejar)
  const grupos = new Map<string, { cambio: Cambio; regla: string; mails: { id: string; de: string; asunto: string }[] }>()
  let protegidos = 0
  for (const c of bandeja) {
    if (blancas.some((r) => aplica(r, c))) { protegidos++; continue }
    const r = accion.find((x) => aplica(x, c))
    if (!r) continue
    const clave = `${r.archivar}|${r.leido}|${r.etiqueta ?? ''}`
    const g = grupos.get(clave) ?? { cambio: { archivar: r.archivar, leido: r.leido ? true : undefined, sumar: r.etiqueta ? [r.etiqueta] : [] }, regla: r.nombre, mails: [] }
    g.mails.push({ id: c.id, de: c.de.replace(/\s*<[^>]+>$/, ''), asunto: c.asunto })
    grupos.set(clave, g)
  }
  const hecho: { que: string; regla: string; mails: { de: string; asunto: string }[] }[] = []
  for (const g of grupos.values()) {
    const que = [g.cambio.archivar && 'archivado', g.cambio.leido && 'marcado leído', g.cambio.sumar?.length && `etiquetado «${g.cambio.sumar[0]}»`].filter(Boolean).join(', ')
    if (!o.probar) {
      const r = await modificarMails(db, g.mails.map((m) => m.id), g.cambio)
      if ('sin_permiso' in r) return r
    }
    hecho.push({ que, regla: g.regla, mails: g.mails.map(({ de, asunto }) => ({ de, asunto })) })
  }
  const total = hecho.reduce((s, h) => s + h.mails.length, 0)
  return {
    probado: !!o.probar, revisados: bandeja.length, cambiados: total, protegidos,
    resumen: total ? `${o.probar ? 'Haría' : 'Hice'}: ${hecho.map((h) => `${h.mails.length} ${h.que} (${h.regla})`).join('; ')}. ${protegidos} quedaron en la bandeja por la lista blanca.` : `Nada para ${o.probar ? 'tocar' : 'ordenar'}: ${bandeja.length} en la bandeja, ${protegidos} protegidos por la lista blanca.`,
    detalle: hecho,
  }
}
