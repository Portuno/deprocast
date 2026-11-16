/**
 * Avisos en el teléfono (Mobile 1.3), sin Firebase: el teléfono pregunta cada ~15 minutos (y al abrir) qué viene, y lo
 * programa como aviso local a su hora exacta. Así suena aunque esté sin red en ese momento.
 * - los eventos de tu calendario de las próximas 36 horas, unos minutos antes (ajuste aviso_evento_min, 10 por defecto);
 * - los recordatorios que le pedís a Mastropiero («recordame a las 18 que llame a…»).
 * Lo nuevo de Mastropiero en Hoy y lo que espera tu ok lo avisa el teléfono solo, comparando con lo último que vio.
 */
import { ajuste, fechaLocal, type Db } from './db.ts'

export type Aviso = { clave: string; titulo: string; cuerpo: string; en: number }

function asegurar(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS recordatorios_movil (id INTEGER PRIMARY KEY AUTOINCREMENT, texto TEXT NOT NULL, para_en INTEGER NOT NULL, creado_en INTEGER NOT NULL)`)
}

/** Para las pruebas: de dónde salen los eventos. */
let eventosDe = async (fecha: string) => (await import('./calendario.ts')).agendaDelDia(fecha).then((a) => a.eventos)
export function _probarAvisos(f: typeof eventosDe) { eventosDe = f; cache = null }

/**
 * «2026-11-16 18:30», «2026-11-16T18:30», «18:30» (hoy, o mañana si ya pasó), o en minutos. Devuelve el instante o null.
 */
export function cuandoDe(o: { cuando?: string | null; minutos?: number | null }, ahora = Date.now()): number | null {
  if (o.minutos != null && Number(o.minutos) > 0) return ahora + Math.round(Number(o.minutos)) * 60_000
  const s = String(o.cuando ?? '').trim()
  let m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/.exec(s)
  if (m) { const t = new Date(`${m[1]}T${m[2].padStart(2, '0')}:${m[3]}:00`).getTime(); return Number.isFinite(t) ? t : null }
  m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (m) {
    const t = new Date(`${fechaLocal(ahora)}T${m[1].padStart(2, '0')}:${m[2]}:00`).getTime()
    return t > ahora ? t : t + 86_400_000
  }
  return null
}

export function crearRecordatorio(db: Db, texto: string, paraEn: number, ahora = Date.now()) {
  asegurar(db)
  const t = String(texto ?? '').trim().slice(0, 300)
  if (!t) throw new Error('Falta qué recordarle')
  if (!(paraEn > ahora - 60_000) || paraEn > ahora + 366 * 86_400_000) throw new Error('La hora del recordatorio tiene que ser en el futuro (y dentro de un año)')
  const id = Number(db.prepare('INSERT INTO recordatorios_movil (texto, para_en, creado_en) VALUES (?, ?, ?)').run(t, Math.round(paraEn), ahora).lastInsertRowid)
  return { id, texto: t, en: Math.round(paraEn), cuando: new Date(paraEn).toLocaleString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }
}
export function borrarRecordatorio(db: Db, id: number): boolean { asegurar(db); return db.prepare('DELETE FROM recordatorios_movil WHERE id = ?').run(id).changes > 0 }
/** Los que todavía no sonaron. */
export function recordatorios(db: Db, ahora = Date.now()) {
  asegurar(db)
  return (db.prepare('SELECT id, texto, para_en FROM recordatorios_movil WHERE para_en > ? ORDER BY para_en').all(ahora - 60_000) as { id: number; texto: string; para_en: number }[])
    .map((r) => ({ id: r.id, texto: r.texto, en: r.para_en }))
}

let cache: { en: number; eventos: { titulo: string; inicio: number; lugar: string | null; todoElDia: boolean }[] } | null = null

/** Lo que el teléfono tiene que programar: eventos (unos minutos antes) y recordatorios, de ahora a 36 horas. */
export async function proximosAvisos(db: Db, ahora = Date.now()): Promise<{ minutosAntes: number; avisos: Aviso[] }> {
  const antes = Math.max(0, Math.min(120, Number(ajuste(db, 'aviso_evento_min') ?? 10) || 0))
  const hasta = ahora + 36 * 3_600_000
  // El calendario se pregunta como mucho cada 10 minutos (el teléfono pregunta seguido).
  if (!cache || ahora - cache.en > 10 * 60_000) {
    const eventos: NonNullable<typeof cache>['eventos'] = []
    for (const f of [fechaLocal(ahora), fechaLocal(ahora + 86_400_000)]) {
      try { for (const e of await eventosDe(f)) eventos.push({ titulo: e.titulo, inicio: e.inicio, lugar: e.lugar ?? null, todoElDia: !!e.todoElDia }) } catch { /* sin calendario */ }
    }
    cache = { en: ahora, eventos }
  }
  const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)
  const avisos: Aviso[] = []
  const vistos = new Set<string>()
  for (const e of cache.eventos) {
    const en = e.inicio - antes * 60_000
    if (e.todoElDia || en <= ahora || en > hasta) continue
    const clave = `ev:${e.inicio}:${e.titulo.slice(0, 40)}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    avisos.push({ clave, titulo: `📅 ${e.titulo}`, cuerpo: `${antes ? `En ${antes} min` : 'Ahora'} (${hm(e.inicio)})${e.lugar ? ` · ${e.lugar}` : ''}`, en })
  }
  for (const r of recordatorios(db, ahora)) if (r.en <= hasta) avisos.push({ clave: `rec:${r.id}`, titulo: '⏰ Recordatorio', cuerpo: r.texto, en: Math.max(r.en, ahora + 5_000) })
  return { minutosAntes: antes, avisos: avisos.sort((a, b) => a.en - b.en).slice(0, 40) }
}
