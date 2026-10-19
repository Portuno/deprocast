/**
 * El calendario de Deprocast: su Google Calendar (ida y vuelta, si está conectado; si no, en solo lectura por iCal) y lo
 * que Deprocast sabe con fecha, por capas: la Línea, el Radar (fecha del evento y fecha de cierre), las misiones que
 * vencen, las tareas de los Cien Días y su horario fijo.
 * Lo de Deprocast se puede «llevar a mi calendario»: queda atado a su evento de Google (calendario_vinculos), así no se
 * duplica y un cambio de fecha acá se edita allá.
 */
import { fechaLocal, type Db } from './db.ts'
import { bloquesDelDia } from './horario.ts'
import { eventosIcsDelRango, urlsCalendario } from './calendario.ts'
import { borrarGoogle, crearGoogle, editarGoogle, googleConectado, listarGoogle, mailDeLaCuenta, type DatosEvento, type EventoGoogle } from './google-calendario.ts'

export const CAPAS_CAL = ['google', 'linea', 'radar', 'mision', 'plan', 'horario'] as const
export type ItemCal = {
  id: string; capa: string; titulo: string; fecha: string; hora: string | null; fin: string | null; todoElDia: boolean; lugar: string | null; detalle: string | null
  url: string | null; ref: { tipo: string; id: number | string } | null
  /** El id del evento en Google (de Google, o de algo de Deprocast que ya se llevó). */
  google: string | null
  /** Se puede editar o borrar acá (es de Google y está conectado). */
  editable: boolean
  /** Es de Deprocast y se puede llevar a Google. */
  llevable: boolean
  /** Bloque de fondo (el horario fijo). */
  fondo?: boolean
  /** Es una fecha de cierre (Radar). */
  cierre?: boolean
}

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const diaDe = (ms: number) => fechaLocal(ms)
function dias(desde: string, hasta: string): string[] {
  const out: string[] = []
  const [a, m, d] = desde.split('-').map(Number)
  for (let i = 0; i < 100; i++) {
    const x = fechaLocal(new Date(a, m - 1, d + i).getTime())
    if (x > hasta) break
    out.push(x)
  }
  return out
}

/** Los vínculos con Google (origen:id → id de Google). */
function vinculos(db: Db): Map<string, string> {
  return new Map((db.prepare('SELECT origen, origen_id, google_id FROM calendario_vinculos').all() as { origen: string; origen_id: number; google_id: string }[]).map((v) => [`${v.origen}:${v.origen_id}`, v.google_id]))
}

export function estadoCalendario() {
  return { conectado: googleConectado(), soloLectura: !googleConectado() && urlsCalendario().length > 0, mail: mailDeLaCuenta() }
}

/** Todo lo que hay entre dos días (YYYY-MM-DD, incluidos) en las capas pedidas. */
export async function itemsDelCalendario(db: Db, desde: string, hasta: string, capas: Set<string> = new Set(CAPAS_CAL)): Promise<{ items: ItemCal[]; aviso: string | null; estado: ReturnType<typeof estadoCalendario> }> {
  const items: ItemCal[] = []
  const v = vinculos(db)
  const llevados = new Set(v.values())
  let aviso: string | null = null
  const enGoogle = (origen: string, id: number) => v.get(`${origen}:${id}`) ?? null

  if (capas.has('google')) {
    if (googleConectado()) {
      try {
        for (const e of await listarGoogle(desde, hasta)) {
          if (llevados.has(e.id)) continue // ya aparece como lo que es (una oportunidad, un evento de la Línea)
          items.push(deGoogle(e))
        }
      } catch (e) { aviso = e instanceof Error ? e.message : String(e) }
    } else if (urlsCalendario().length) {
      const { porDia, avisos } = await eventosIcsDelRango(dias(desde, hasta))
      if (avisos.length) aviso = avisos[0]
      for (const [dia, eventos] of porDia) {
        for (const e of eventos) items.push({ id: `ics:${dia}:${e.inicio}:${e.titulo}`, capa: 'google', titulo: e.titulo, fecha: dia, hora: e.todoElDia ? null : hhmm(e.inicio), fin: e.todoElDia ? null : hhmm(e.fin), todoElDia: e.todoElDia, lugar: e.lugar, detalle: null, url: null, ref: null, google: null, editable: false, llevable: false })
      }
    }
  }
  if (capas.has('linea')) {
    for (const e of db.prepare(`SELECT e.*, c.titulo AS pieza FROM eventos e JOIN corpus c ON c.id = e.pieza_id WHERE length(e.fecha) = 10 AND e.fecha BETWEEN ? AND ? AND e.estado != 'descartado' AND (e.tipo = 'futuro' OR e.estado = 'agendado') ORDER BY e.fecha, e.hora`).all(desde, hasta) as any[]) {
      items.push({ id: `evento:${e.id}`, capa: 'linea', titulo: e.titulo, fecha: e.fecha, hora: e.hora, fin: e.fin, todoElDia: !e.hora, lugar: e.lugar, detalle: `De «${e.pieza}»`, url: null, ref: { tipo: 'pieza', id: e.pieza_id }, google: enGoogle('evento', e.id), editable: false, llevable: true })
    }
  }
  if (capas.has('radar')) {
    for (const o of db.prepare(`SELECT * FROM oportunidades WHERE estado IN ('nueva', 'me_interesa') AND ((fecha BETWEEN ? AND ?) OR (cierre BETWEEN ? AND ?))`).all(desde, hasta, desde, hasta) as any[]) {
      if (o.fecha && o.fecha >= desde && o.fecha <= hasta) items.push({ id: `oportunidad:${o.id}`, capa: 'radar', titulo: o.titulo, fecha: o.fecha, hora: null, fin: o.fecha_fin, todoElDia: true, lugar: o.online ? 'online' : o.lugar, detalle: o.descripcion, url: o.url, ref: { tipo: 'oportunidad', id: o.id }, google: enGoogle('oportunidad', o.id), editable: false, llevable: true })
      if (o.cierre && o.cierre >= desde && o.cierre <= hasta && o.cierre !== o.fecha) items.push({ id: `cierre:${o.id}`, capa: 'radar', titulo: `Cierra: ${o.titulo}`, fecha: o.cierre, hora: null, fin: null, todoElDia: true, lugar: null, detalle: o.por_que, url: o.url, ref: { tipo: 'oportunidad', id: o.id }, google: null, editable: false, llevable: false, cierre: true })
    }
  }
  if (capas.has('mision') || capas.has('plan')) {
    const delPlan = new Set((db.prepare('SELECT mision_id FROM plan_tareas').all() as { mision_id: number }[]).map((r) => r.mision_id))
    for (const m of db.prepare(`SELECT id, titulo, detalle, vence, inicio, fin, nivel FROM misiones WHERE vence BETWEEN ? AND ? AND estado NOT IN ('hecha', 'descartada', 'no') AND personaje = 'jugador'`).all(desde, hasta) as any[]) {
      const capa = delPlan.has(m.id) ? 'plan' : 'mision'
      if (!capas.has(capa)) continue
      items.push({ id: `mision:${m.id}`, capa, titulo: m.titulo, fecha: m.vence, hora: m.inicio ?? null, fin: m.fin ?? null, todoElDia: !m.inicio, lugar: null, detalle: m.detalle, url: null, ref: { tipo: 'mision', id: m.id }, google: enGoogle('mision', m.id), editable: false, llevable: true })
    }
  }
  if (capas.has('horario')) {
    for (const dia of dias(desde, hasta)) for (const b of bloquesDelDia(db, dia)) items.push({ id: `horario:${dia}:${b.desde}`, capa: 'horario', titulo: b.que, fecha: dia, hora: b.desde, fin: b.hasta, todoElDia: false, lugar: null, detalle: 'Horario fijo', url: null, ref: null, google: null, editable: false, llevable: false, fondo: true })
  }
  items.sort((a, b) => a.fecha.localeCompare(b.fecha) || Number(b.todoElDia) - Number(a.todoElDia) || (a.hora ?? '').localeCompare(b.hora ?? ''))
  return { items, aviso, estado: estadoCalendario() }
}

function deGoogle(e: EventoGoogle): ItemCal {
  return { id: `google:${e.id}`, capa: 'google', titulo: e.titulo, fecha: diaDe(e.inicio), hora: e.todoElDia ? null : hhmm(e.inicio), fin: e.todoElDia ? null : hhmm(e.fin), todoElDia: e.todoElDia, lugar: e.lugar, detalle: e.descripcion, url: e.url, ref: { tipo: 'google', id: e.id }, google: e.id, editable: true, llevable: false }
}

// ─── llevar a Google ────────────────────────────────────────────────────

/** Lo que se manda a Google por cada cosa de Deprocast (con cambios que él haya elegido: otra fecha, una hora). */
function datosDe(db: Db, origen: string, id: number, o: Partial<DatosEvento>): DatosEvento & { titulo: string; fecha: string } {
  if (origen === 'oportunidad') {
    const x = db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(id) as any
    if (!x) throw new Error(`No existe la oportunidad ${id}`)
    const fecha = o.fecha ?? x.fecha ?? x.cierre
    if (!fecha) throw new Error('Esta oportunidad no tiene fecha: decime qué día ponerla')
    return { titulo: o.titulo ?? x.titulo, fecha, hora: o.hora ?? null, duracionMin: o.duracionMin ?? null, lugar: o.lugar ?? (x.online ? 'Online' : x.lugar), descripcion: [x.descripcion, x.por_que ? `Por qué: ${x.por_que}` : '', x.cierre ? `Cierra: ${x.cierre}` : '', x.url].filter(Boolean).join('\n\n'), deDeprocast: `oportunidad:${id}` }
  }
  if (origen === 'evento') {
    const x = db.prepare('SELECT e.*, c.titulo AS pieza FROM eventos e JOIN corpus c ON c.id = e.pieza_id WHERE e.id = ?').get(id) as any
    if (!x) throw new Error(`No existe el evento ${id}`)
    if (!o.fecha && (!x.fecha || x.fecha.length !== 10)) throw new Error('Ese evento no tiene día exacto: decime cuándo')
    return { titulo: o.titulo ?? x.titulo, fecha: o.fecha ?? x.fecha, hora: o.hora !== undefined ? o.hora : x.hora, duracionMin: o.duracionMin ?? null, lugar: o.lugar ?? x.lugar, descripcion: `Salió de «${x.pieza}» (Deprocast)`, deDeprocast: `evento:${id}` }
  }
  if (origen === 'mision') {
    const x = db.prepare('SELECT * FROM misiones WHERE id = ?').get(id) as any
    if (!x) throw new Error(`No existe la misión ${id}`)
    const fecha = o.fecha ?? x.vence
    if (!fecha) throw new Error('Esa misión no tiene fecha: decime qué día ponerla')
    return { titulo: o.titulo ?? x.titulo, fecha, hora: o.hora !== undefined ? o.hora : x.inicio ?? null, duracionMin: o.duracionMin ?? x.minutos ?? null, lugar: o.lugar ?? null, descripcion: x.detalle ?? null, deDeprocast: `mision:${id}` }
  }
  throw new Error(`No sé llevar «${origen}» al calendario`)
}

/** Lleva algo de Deprocast a su Google Calendar (o lo actualiza si ya estaba). */
export async function llevarAGoogle(db: Db, origen: string, id: number, o: Partial<DatosEvento> = {}, ahora = Date.now()): Promise<EventoGoogle> {
  if (!googleConectado()) throw new Error('Tu Google Calendar no está conectado todavía (mirá Calendario → Conectar)')
  const d = datosDe(db, origen, id, o)
  const ya = db.prepare('SELECT google_id FROM calendario_vinculos WHERE origen = ? AND origen_id = ?').get(origen, id) as { google_id: string } | undefined
  let e: EventoGoogle | null = null
  if (ya) {
    try { e = await editarGoogle(ya.google_id, d) } catch (err) {
      // Si lo borró en Google, se vuelve a crear.
      if (!/404|Not Found|deleted|eliminad/i.test(err instanceof Error ? err.message : String(err))) throw err
    }
  }
  if (!e) e = await crearGoogle(d)
  db.prepare('INSERT OR REPLACE INTO calendario_vinculos (origen, origen_id, google_id, creado_en) VALUES (?, ?, ?, ?)').run(origen, id, e.id, ahora)
  if (origen === 'oportunidad') db.prepare(`UPDATE oportunidades SET estado = 'me_interesa', actualizada_en = ? WHERE id = ? AND estado = 'nueva'`).run(ahora, id)
  return e
}

/** Saca de Google lo que se había llevado (y el vínculo). */
export async function quitarDeGoogle(db: Db, origen: string, id: number): Promise<boolean> {
  const ya = db.prepare('SELECT google_id FROM calendario_vinculos WHERE origen = ? AND origen_id = ?').get(origen, id) as { google_id: string } | undefined
  if (!ya) return false
  await borrarGoogle(ya.google_id)
  db.prepare('DELETE FROM calendario_vinculos WHERE origen = ? AND origen_id = ?').run(origen, id)
  return true
}

// ─── CRUD directo sobre su calendario ───────────────────────────────────

const validar = (d: Partial<DatosEvento>) => {
  if (d.fecha != null && !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) throw new Error('La fecha va como YYYY-MM-DD')
  if (d.hora != null && d.hora !== '' && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(d.hora)) throw new Error('La hora va como HH:MM')
}
export async function crearEvento(d: DatosEvento & { titulo: string; fecha: string }) {
  validar(d)
  if (!d.titulo?.trim()) throw new Error('Falta el título')
  return crearGoogle({ ...d, titulo: d.titulo.trim(), hora: d.hora || null })
}
export async function editarEvento(id: string, d: DatosEvento) {
  validar(d)
  return editarGoogle(id, { ...d, ...(d.hora === '' ? { hora: null } : {}) })
}
export async function borrarEvento(db: Db, id: string) {
  await borrarGoogle(id)
  db.prepare('DELETE FROM calendario_vinculos WHERE google_id = ?').run(id)
}
