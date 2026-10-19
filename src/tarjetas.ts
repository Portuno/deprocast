/**
 * Tarjetas de recuerdo activo con repaso espaciado (SM-2): las frases de un idioma, lo que plantea un video que miró,
 * lo que estudió. Primero se pregunta «¿qué te acordás?» y recién después se muestra el dorso (recordar, no reconocer:
 * lo que dice monke sobre la ilusión de fluidez), y él marca cómo le fue: otra vez, difícil, bien o fácil.
 * La próxima vez que vuelve depende de eso y de su historia: lo que sabe se aleja, lo que no, vuelve pronto.
 */
import { fechaLocal, type Db } from './db.ts'

export type Tarjeta = {
  id: number; mazo: string; frente: string; dorso: string; contexto: string | null; origenTipo: string | null; origenId: number | null
  facilidad: number; intervalo: number; repeticiones: number; aciertos: number; fallos: number; proxima: string; estado: string; creadaEn: number; ultimaEn: number | null
}
export const CALIDADES = ['otra', 'dificil', 'bien', 'facil'] as const
export type Calidad = (typeof CALIDADES)[number]

const deFila = (r: any): Tarjeta => ({
  id: r.id, mazo: r.mazo, frente: r.frente, dorso: r.dorso, contexto: r.contexto, origenTipo: r.origen_tipo, origenId: r.origen_id,
  facilidad: r.facilidad, intervalo: r.intervalo, repeticiones: r.repeticiones, aciertos: r.aciertos, fallos: r.fallos, proxima: r.proxima, estado: r.estado, creadaEn: r.creada_en, ultimaEn: r.ultima_en,
})
const sumarDias = (dia: string, n: number) => { const [a, m, d] = dia.split('-').map(Number); return fechaLocal(new Date(a, m - 1, d + n).getTime()) }

/** Una tarjeta nueva (la misma pregunta en el mismo mazo no se repite). Vuelve hoy: lo nuevo se repasa enseguida. */
export function crearTarjeta(db: Db, t: { mazo: string; frente: string; dorso: string; contexto?: string | null; origenTipo?: string | null; origenId?: number | null }, ahora = Date.now()): { id: number; nueva: boolean } {
  const frente = String(t.frente ?? '').trim().slice(0, 400)
  const dorso = String(t.dorso ?? '').trim().slice(0, 1200)
  if (!frente || !dorso) throw new Error('Una tarjeta necesita frente y dorso')
  const r = db.prepare(`INSERT OR IGNORE INTO tarjetas (mazo, frente, dorso, contexto, origen_tipo, origen_id, proxima, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(t.mazo, frente, dorso, t.contexto?.trim().slice(0, 600) || null, t.origenTipo ?? null, t.origenId ?? null, fechaLocal(ahora), ahora)
  if (r.changes) return { id: Number(r.lastInsertRowid), nueva: true }
  return { id: (db.prepare('SELECT id FROM tarjetas WHERE mazo = ? AND frente = ?').get(t.mazo, frente) as { id: number }).id, nueva: false }
}

export function leerTarjeta(db: Db, id: number): Tarjeta | null {
  const r = db.prepare('SELECT * FROM tarjetas WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

/** Las que tocan hoy (las más atrasadas primero), de un mazo o de todos (un prefijo: «idioma:» = todos los idiomas). */
export function paraRepasar(db: Db, o: { mazo?: string | null; limite?: number } = {}, ahora = Date.now()): Tarjeta[] {
  const hoy = fechaLocal(ahora)
  const filtro = o.mazo ? (o.mazo.endsWith(':') ? `AND mazo LIKE ? || '%'` : 'AND mazo = ?') : ''
  return (db.prepare(`SELECT * FROM tarjetas WHERE estado = 'activa' AND proxima <= ? ${filtro} ORDER BY proxima, repeticiones, id LIMIT ?`)
    .all(...[hoy, ...(o.mazo ? [o.mazo] : []), o.limite ?? 20]) as any[]).map(deFila)
}

/**
 * Lo que él contestó (SM-2): «otra» la vuelve a hoy y reinicia la cuenta; las demás la alejan según la facilidad, que
 * sube con «fácil» y baja con «difícil» (nunca de 1,3 para abajo).
 */
export function responderTarjeta(db: Db, id: number, calidad: Calidad, ahora = Date.now()): Tarjeta {
  const t = leerTarjeta(db, id)
  if (!t) throw new Error(`No existe la tarjeta ${id}`)
  if (!CALIDADES.includes(calidad)) throw new Error('Calidad inválida')
  const q = { otra: 1, dificil: 3, bien: 4, facil: 5 }[calidad]
  const hoy = fechaLocal(ahora)
  let { facilidad, intervalo, repeticiones } = t
  facilidad = Math.max(1.3, Math.round((facilidad + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)) * 100) / 100)
  if (q < 3) {
    repeticiones = 0
    intervalo = 0
  } else {
    repeticiones += 1
    intervalo = repeticiones === 1 ? (calidad === 'facil' ? 3 : 1) : repeticiones === 2 ? (calidad === 'dificil' ? 3 : 6) : Math.round(intervalo * facilidad * (calidad === 'facil' ? 1.3 : calidad === 'dificil' ? 0.8 : 1))
  }
  db.prepare(`UPDATE tarjetas SET facilidad = ?, intervalo = ?, repeticiones = ?, aciertos = aciertos + ?, fallos = fallos + ?, proxima = ?, ultima_en = ? WHERE id = ?`)
    .run(facilidad, intervalo, repeticiones, q >= 3 ? 1 : 0, q < 3 ? 1 : 0, sumarDias(hoy, intervalo), ahora, id)
  return leerTarjeta(db, id)!
}

/** Cuántas tocan hoy y cuántas hay, por mazo (para Hoy y las secciones). */
export function resumenTarjetas(db: Db, ahora = Date.now()): { mazo: string; hoy: number; total: number; aprendidas: number }[] {
  return db.prepare(`SELECT mazo, SUM(proxima <= ?) AS hoy, COUNT(*) AS total, SUM(intervalo >= 21) AS aprendidas FROM tarjetas WHERE estado = 'activa' GROUP BY mazo ORDER BY mazo`).all(fechaLocal(ahora)) as any[]
}

/** Las tarjetas que salieron de algo (una pieza, un turno de idioma), toquen hoy o no. */
export function tarjetasDeOrigen(db: Db, tipo: string, id: number): Tarjeta[] {
  return (db.prepare(`SELECT * FROM tarjetas WHERE origen_tipo = ? AND origen_id = ? AND estado = 'activa' ORDER BY id`).all(tipo, id) as any[]).map(deFila)
}

export function suspenderTarjeta(db: Db, id: number) {
  db.prepare(`UPDATE tarjetas SET estado = 'suspendida' WHERE id = ?`).run(id)
}
