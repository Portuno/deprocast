/**
 * Lo que el teléfono necesita del servidor y no vive en otro módulo (Mobile 2.5):
 * - La run en el bolsillo: la run de hoy (en curso o propuesta), sus bandas con hora y estado, cuál toca ahora y cuál
 *   sigue. El teléfono programa un aviso por banda y la marca (hecha, a medias, no) desde el aviso o desde la pantalla.
 * - Lo que pide un lugar: las side quests con lugar o zona ya ubicados y las tiendas tuyas (lugares de tipo tienda o
 *   que se llaman como un súper) si hay compras pendientes. El teléfono los vigila como geovallas y avisa al llegar.
 * - El estado de la captura visto desde acá (la última vez que llegó cada cosa) y los errores que reporta la app.
 */
import { fechaLocal, type Db } from './db.ts'

const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)
const aMin = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + b }

// ─── la run ─────────────────────────────────────────────────────────────

export type BandaTelefono = { id: number; titulo: string; detalle: string | null; categoria: string | null; inicio: string; fin: string; minutos: number | null; estado: string; nota: string | null }
export type RunTelefono = { run: { id: number; fecha: string; inicio: string; fin: string; estado: string } | null; bandas: BandaTelefono[]; ahora: number | null; siguiente: number | null; hechas: number }

export async function runParaTelefono(db: Db, ahora = Date.now()): Promise<RunTelefono> {
  const m = await import('./misiones.ts')
  const run = m.runActual(db, ahora)
  if (!run) return { run: null, bandas: [], ahora: null, siguiente: null, hechas: 0 }
  const bandas = m.misionesDeRun(db, run.id).filter((x) => x.inicio && x.fin).sort((a, b) => aMin(a.inicio!) - aMin(b.inicio!))
    .map((x) => ({ id: x.id, titulo: x.titulo, detalle: x.detalle, categoria: x.categoria, inicio: x.inicio!, fin: x.fin!, minutos: x.minutos, estado: x.estado, nota: x.feedback }))
  const min = (() => { const d = new Date(ahora); return d.getHours() * 60 + d.getMinutes() })()
  const hoy = run.fecha === fechaLocal(ahora)
  const actual = hoy && run.estado === 'en_curso' ? bandas.find((b) => aMin(b.inicio) <= min && min < aMin(b.fin)) ?? null : null
  const sig = hoy ? bandas.find((b) => aMin(b.inicio) > min) ?? null : bandas[0] ?? null
  return {
    run: { id: run.id, fecha: run.fecha, inicio: run.inicio, fin: run.fin, estado: run.estado },
    bandas, ahora: actual?.id ?? null, siguiente: sig?.id ?? null, hechas: bandas.filter((b) => b.estado === 'hecha').length,
  }
}

export async function marcarBandaTelefono(db: Db, id: number, estado: string, nota?: string | null) {
  const m = await import('./misiones.ts')
  const b = m.leerMision(db, id)
  if (!b || b.nivel !== 'secundaria' || !b.runId) throw new Error('Esa banda no existe')
  if (!['hecha', 'parcial', 'no', 'activa'].includes(estado)) throw new Error('Estado inválido (hecha | parcial | no | activa)')
  const r = m.marcarSecundaria(db, id, estado as 'hecha', nota ?? null)
  return { id: r.id, estado: r.estado }
}

// ─── lo que pide un lugar ───────────────────────────────────────────────

/** Una tienda: un lugar de tipo tienda, o uno que se llama como un súper, un mercado o una farmacia. */
export const ES_TIENDA = /mercadona|carrefour|lidl|aldi|consum|dia\b|eroski|alcampo|hipercor|el corte ingl|super|mercado|almac[eé]n|farmacia|ferreter|chino|verduler|carnicer|panader/i

export type Region = { id: string; tipo: 'side' | 'compras'; lat: number; lon: number; radio: number; titulo: string; cuerpo: string }

/** Las geovallas que el teléfono vigila. Como mucho 90 (Android permite 100 por app). */
export async function regionesCerca(db: Db): Promise<Region[]> {
  const out: Region[] = []
  // Side quests con lugar o zona, ya ubicados (lo que no se ubicó todavía se pide de fondo y entra la próxima vez).
  const { enCache, ubicar } = await import('./mapa.ts')
  const qs = db.prepare(`SELECT id, titulo, disparador FROM misiones WHERE personaje = 'jugador' AND disparador IS NOT NULL AND estado IN ('sugerida', 'activa')`).all() as { id: number; titulo: string; disparador: string }[]
  for (const q of qs) {
    let d: { lugar?: string; zona?: string } = {}
    try { d = JSON.parse(q.disparador) } catch { /* roto */ }
    for (const [texto, radio] of [[d.lugar, 300], [d.zona, 1500]] as [string | undefined, number][]) {
      if (!texto?.trim()) continue
      const c = enCache(db, texto)
      if (c === undefined) { void ubicar(db, texto).catch(() => null); continue }
      if (!c) continue
      out.push({ id: `side-${q.id}`, tipo: 'side', lat: c.lat, lon: c.lon, radio, titulo: `📍 Cerca de ${texto}`, cuerpo: q.titulo })
      break
    }
  }
  // Las tiendas, si hay algo para comprar.
  const { listarCompras } = await import('./compras.ts')
  const pendientes = listarCompras(db, { estado: 'pendiente', limite: 100 })
  if (pendientes.length) {
    const { lugaresConCoordenadas } = await import('./territorio.ts')
    for (const l of lugaresConCoordenadas(db)) {
      if (l.tipo !== 'tienda' && !ES_TIENDA.test(l.nombre)) continue
      out.push({ id: `compras-${l.id}`, tipo: 'compras', lat: l.lat, lon: l.lon, radio: 120, titulo: `🛒 Estás en ${l.nombre}`, cuerpo: `${pendientes.length} en la lista: ${pendientes.slice(0, 4).map((c) => c.item).join(', ')}${pendientes.length > 4 ? '…' : ''}` })
    }
  }
  return out.slice(0, 90)
}

// ─── el estado y los errores ────────────────────────────────────────────

const existe = (db: Db, t: string) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t)

/** La última vez que llegó cada cosa de este teléfono (ms, o null). */
export function estadoDesdeServidor(db: Db, dispId: number): Record<string, number | null> {
  const f = `disp:${dispId}`
  const max = (sql: string, ...p: (string | number)[]) => (db.prepare(sql).get(...p) as { n: number | null } | undefined)?.n ?? null
  return {
    recorrido: existe(db, 'recorrido_puntos') ? max('SELECT MAX(en) AS n FROM recorrido_puntos WHERE fuente = ?', f) : null,
    escucha: existe(db, 'voz_turnos') ? max('SELECT MAX(inicio) AS n FROM voz_turnos WHERE dispositivo_id = ?', dispId) : null,
    pasos: existe(db, 'actividad_dia') ? max('SELECT MAX(actualizado) AS n FROM actividad_dia WHERE fuente = ?', f) : null,
    uso: existe(db, 'uso_telefono') ? max('SELECT MAX(actualizado) AS n FROM uso_telefono WHERE fuente = ?', f) : null,
    carga: existe(db, 'carga_telefono') ? max('SELECT MAX(en) AS n FROM carga_telefono WHERE fuente = ?', f) : null,
    llamadas: existe(db, 'llamadas_telefono') ? max('SELECT MAX(en) AS n FROM llamadas_telefono WHERE fuente = ?', f) : null,
    mensajes: existe(db, 'mensajes_recibidos') ? max('SELECT MAX(en) AS n FROM mensajes_recibidos WHERE fuente = ?', f) : null,
  }
}

function asegurarErrores(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS errores_telefono (id INTEGER PRIMARY KEY AUTOINCREMENT, dispositivo_id INTEGER NOT NULL, en INTEGER NOT NULL, donde TEXT, mensaje TEXT NOT NULL, pila TEXT, version TEXT, recibido INTEGER NOT NULL)`)
}

/** Un error que reporta la app (con dónde, la pila y la versión). Los iguales de la última hora no se repiten. */
export function anotarError(db: Db, dispId: number, e: any, ahora = Date.now()): boolean {
  asegurarErrores(db)
  const mensaje = String(e?.mensaje ?? '').slice(0, 500)
  if (!mensaje) return false
  const en = Number.isFinite(Number(e?.en)) ? Number(e.en) : ahora
  const ya = db.prepare('SELECT 1 FROM errores_telefono WHERE dispositivo_id = ? AND mensaje = ? AND en > ?').get(dispId, mensaje, en - 3_600_000)
  if (ya) return false
  db.prepare('INSERT INTO errores_telefono (dispositivo_id, en, donde, mensaje, pila, version, recibido) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(dispId, en, e?.donde ? String(e.donde).slice(0, 80) : null, mensaje, e?.pila ? String(e.pila).slice(0, 4000) : null, e?.version ? String(e.version).slice(0, 40) : null, ahora)
  db.prepare('DELETE FROM errores_telefono WHERE recibido < ?').run(ahora - 30 * 86_400_000)
  return true
}

export function erroresRecientes(db: Db, dias = 7, ahora = Date.now()) {
  asegurarErrores(db)
  return (db.prepare('SELECT e.*, d.nombre FROM errores_telefono e LEFT JOIN dispositivos d ON d.id = e.dispositivo_id WHERE e.en > ? ORDER BY e.en DESC LIMIT 50').all(ahora - dias * 86_400_000) as any[])
    .map((r) => ({ cuando: `${fechaLocal(r.en)} ${hm(r.en)}`, telefono: r.nombre, donde: r.donde, mensaje: r.mensaje, version: r.version, pila: r.pila ? String(r.pila).split('\n').slice(0, 6).join('\n') : null }))
}

// ─── la plata (Mobile 2.6) ───────────────────────────────────────────────

/** El mes, lo de hoy y lo que espera tu firma (lo que vino de los avisos del banco). */
export async function plataParaTelefono(db: Db, ahora = Date.now()) {
  const f = await import('./finanzas.ts')
  const hoy = fechaLocal(ahora)
  return {
    mes: f.resumenMes(db, hoy.slice(0, 7)),
    hoy: f.listarMovimientos(db, { mes: hoy.slice(0, 7), limite: 200 }).filter((m) => m.fecha === hoy).map((m) => ({ id: m.id, monto: m.monto, moneda: m.moneda, descripcion: m.descripcion, categoria: m.categoria })),
    sugeridos: f.sugeridos(db).map((s) => ({ id: s.id, fecha: s.fecha, monto: s.monto, moneda: s.moneda, descripcion: s.descripcion })),
    categorias: [...f.CATEGORIAS],
  }
}

/** Un gasto (monto negativo) o un ingreso, anotado desde el teléfono. */
export async function anotarPlata(db: Db, b: any, ahora = Date.now()) {
  const f = await import('./finanzas.ts')
  const monto = Number(String(b?.monto ?? '').replace(',', '.'))
  if (!Number.isFinite(monto) || monto === 0) throw new Error('El monto tiene que ser un número distinto de cero')
  const m = f.registrarMovimiento(db, { monto, descripcion: String(b?.descripcion ?? '').slice(0, 200), categoria: b?.categoria ?? null, origen: 'teléfono', fecha: b?.fecha ?? undefined }, ahora)
  return m ? { id: m.id, monto: m.monto, descripcion: m.descripcion, categoria: m.categoria } : { repetido: true }
}

// ─── la semana (Mobile 2.6) ──────────────────────────────────────────────

/** Los últimos 7 días en números (sin la agenda, que es de la red) y los promedios de los días con dato. */
export async function semanaParaTelefono(db: Db, ahora = Date.now()) {
  const { diarioDelDia } = await import('./diario-dia.ts')
  const dias: { fecha: string; pasos: number; km: number; suenoHoras: number | null; animo: number | null; pantallaMin: number | null; gastos: number; llamadas: number; recibidos: number; fotos: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const fecha = fechaLocal(ahora - i * 86_400_000)
    const r = (await diarioDelDia(db, fecha, { agenda: false })).resumen
    dias.push({ fecha, pasos: r.pasos, km: r.km, suenoHoras: r.suenoHoras, animo: r.animo, pantallaMin: r.pantallaMin, gastos: r.gastos, llamadas: r.llamadas, recibidos: r.recibidos, fotos: r.fotos })
  }
  const prom = (k: keyof (typeof dias)[number]) => {
    const xs = dias.map((d) => d[k]).filter((x): x is number => typeof x === 'number' && x > 0)
    return xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null
  }
  return { dias, promedio: { pasos: prom('pasos'), suenoHoras: prom('suenoHoras'), animo: prom('animo'), pantallaMin: prom('pantallaMin'), gastos: prom('gastos') } }
}
