/**
 * Lo que La Mano muestra de él, sin puntos ni volumen: si se está volviendo mejor (calibración y retención), su territorio
 * por fuente (lo sellado, las fronteras que movió, la niebla) y la honestidad de las sorpresas (cuántas salen, cuántas
 * fueron reales, cuántas casualidad y dónde está el umbral). Ningún número premia la cantidad.
 */
import type { Db } from './db.ts'
import { ascension, calibracion, retencion, umbralPuente } from './mano.ts'

export type Territorio = {
  fuente: string
  nombre: string
  selladas: number
  sinPesar: number
  /** Creencias que actualizó con algo de esta fuente. */
  fronteras: number
  /** De lo que hay de esta fuente, qué parte sigue sin pesar (0 = todo mapeado, 100 = todo niebla). */
  niebla: number
}

/** Por fuente: lo sellado ocupa territorio, lo actualizado es frontera que se movió, lo sin pesar es niebla. */
export function territorio(db: Db): Territorio[] {
  const filas = db.prepare(`SELECT c.fuente, COALESCE(f.nombre, c.fuente) AS nombre, SUM(q.etapa = 'sellado') AS selladas, SUM(q.etapa = 'proto') AS sin_pesar
    FROM quantomos q JOIN corpus c ON c.id = q.pieza_id LEFT JOIN fuentes f ON f.id = c.fuente
    WHERE q.etapa IN ('sellado', 'proto') GROUP BY c.fuente`).all() as { fuente: string; nombre: string; selladas: number; sin_pesar: number }[]
  const fronteras = new Map((db.prepare(`SELECT c.fuente, COUNT(*) AS n FROM mano_eventos e JOIN quantomos q ON q.id = e.quantomo_id JOIN corpus c ON c.id = q.pieza_id
    WHERE e.tipo = 'contradiccion' AND e.estado = 'actualizo' GROUP BY c.fuente`).all() as { fuente: string; n: number }[]).map((r) => [r.fuente, r.n]))
  return filas.map((r) => ({
    fuente: r.fuente, nombre: r.nombre, selladas: r.selladas, sinPesar: r.sin_pesar, fronteras: fronteras.get(r.fuente) ?? 0,
    niebla: Math.round((r.sin_pesar / Math.max(1, r.selladas + r.sin_pesar)) * 100),
  })).sort((a, b) => b.selladas - a.selladas || a.niebla - b.niebla)
}

/** La honestidad de las sorpresas: por tipo, cuántas salieron y qué hizo con ellas; y dónde está el umbral del puente. */
export function honestidad(db: Db) {
  const porTipo = db.prepare(`SELECT tipo, COUNT(*) AS mostradas, SUM(estado IN ('real', 'actualizo', 'pruebo')) AS valieron,
      SUM(estado IN ('casualidad', 'sostengo')) AS no_valieron, SUM(estado IN ('pendiente', 'sin_hipotesis')) AS pendientes
    FROM mano_eventos GROUP BY tipo ORDER BY tipo`).all() as { tipo: string; mostradas: number; valieron: number; no_valieron: number; pendientes: number }[]
  const pesadas = (db.prepare(`SELECT COUNT(*) AS n FROM mano_jugadas WHERE gesto = 'peso' AND deshecha = 0`).get() as { n: number }).n
  const total = porTipo.reduce((s, t) => s + t.mostradas, 0)
  return { porTipo, pesadas, unaCada: total ? Math.round(pesadas / total) : null, umbralPuente: umbralPuente(db) }
}

export function progresoDeMano(db: Db) {
  return { calibracion: calibracion(db), retencion: retencion(db), ascension: ascension(db), territorio: territorio(db), honestidad: honestidad(db) }
}
