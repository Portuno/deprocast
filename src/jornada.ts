/**
 * La jornada: el día del operador como contenedor. El trabajo vive en runs (ver misiones.ts): tandas que él diseña
 * y Mastropiero arma en misiones secundarias. Acá queda lo del día entero: horas, progreso de lo marcado,
 * el resumen y el cierre de la noche (su respuesta es materia para la calibración y la memoria).
 */
import { fechaLocal, type Db } from './db.ts'

export type Jornada = {
  fecha: string
  estado: 'en_curso' | 'cerrada'
  resumen: string | null
  cierre: string | null
  pidioCierre: boolean
  actualizadaEn: number
}

const deFila = (r: any): Jornada => ({
  fecha: r.fecha, estado: r.estado, resumen: r.resumen, cierre: r.cierre, pidioCierre: r.pidio_cierre === 1, actualizadaEn: r.actualizada_en,
})

export function leerJornada(db: Db, fecha: string): Jornada | null {
  const r = db.prepare('SELECT * FROM jornadas WHERE fecha = ?').get(fecha)
  return r ? deFila(r) : null
}

/** El registro del día existe desde que pasa algo (un saludo, un cierre). */
export function asegurarJornada(db: Db, fecha: string, ahora = Date.now()): Jornada {
  db.prepare(`INSERT OR IGNORE INTO jornadas (fecha, estado, bloques, creada_en, actualizada_en) VALUES (?, 'en_curso', '[]', ?, ?)`).run(fecha, ahora, ahora)
  return leerJornada(db, fecha)!
}

export function fijarResumen(db: Db, fecha: string, resumen: string, ahora = Date.now()) {
  asegurarJornada(db, fecha, ahora)
  db.prepare('UPDATE jornadas SET resumen = ?, actualizada_en = ? WHERE fecha = ?').run(resumen, ahora, fecha)
}

// ─── horas ──────────────────────────────────────────────────────────────

export const aMin = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim())
  if (!m) return NaN
  return Number(m[1]) * 60 + Number(m[2])
}
export const aHora = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

// ─── progreso del día ───────────────────────────────────────────────────

/** Las bandas del jugador en runs de ese día (sin las descartadas ni las de propuestas que no arrancaron). */
export function progreso(db: Db, fecha: string) {
  const filas = db.prepare(
    `SELECT m.estado, COUNT(*) AS n FROM misiones m JOIN runs r ON r.id = m.run_id
     WHERE r.fecha = ? AND r.estado IN ('en_curso', 'cerrada') AND m.nivel = 'secundaria' AND m.personaje = 'jugador' AND m.estado != 'descartada' GROUP BY m.estado`,
  ).all(fecha) as { estado: string; n: number }[]
  const n = (e: string) => filas.find((f) => f.estado === e)?.n ?? 0
  return { hechos: n('hecha'), parciales: n('parcial'), saltados: n('no'), total: filas.reduce((s, f) => s + f.n, 0) }
}

/** Bandas hechas por día en los últimos n días. */
export function semana(db: Db, hasta: string, n = 7) {
  const [a, m, d] = hasta.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const f = fechaLocal(new Date(a, m - 1, d - (n - 1 - i)).getTime())
    return { fecha: f, ...progreso(db, f) }
  })
}

// ─── cierre ─────────────────────────────────────────────────────────────

/** El texto con el que Mastropiero abre el cierre del día. Sin modelo: sale de lo marcado. */
export function textoDeCierre(db: Db, fecha: string, ahora = Date.now()): string {
  asegurarJornada(db, fecha, ahora)
  const p = progreso(db, fecha)
  const hechas = (db.prepare(
    `SELECT m.titulo FROM misiones m JOIN runs r ON r.id = m.run_id WHERE r.fecha = ? AND m.nivel = 'secundaria' AND m.estado = 'hecha' ORDER BY m.inicio LIMIT 3`,
  ).all(fecha) as { titulo: string }[]).map((x) => x.titulo.toLowerCase())
  db.prepare('UPDATE jornadas SET pidio_cierre = 1 WHERE fecha = ?').run(fecha)
  return [
    `Cerramos el día. ${p.total ? `Hiciste ${p.hechos} de ${p.total} bandas${p.parciales ? ` (y ${p.parciales} a medias)` : ''}${hechas.length ? `: ${hechas.join(', ')}` : ''}.` : ''}`,
    '¿Cómo te fue? Contame lo que quieras, lo que salió, lo que no y lo que te quedó dando vueltas; con eso calibro las próximas runs.',
  ].join(' ').trim()
}

/** Guarda la respuesta del operador al cierre y da el día por cerrado. */
export function registrarCierre(db: Db, fecha: string, texto: string, ahora = Date.now()) {
  asegurarJornada(db, fecha, ahora)
  db.prepare(`UPDATE jornadas SET cierre = ?, estado = 'cerrada', actualizada_en = ? WHERE fecha = ?`).run(texto.trim(), ahora, fecha)
}

