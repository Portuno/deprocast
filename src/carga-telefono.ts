/**
 * La carga del teléfono (Mobile 2.1): cuándo estuvo enchufado. El teléfono manda una muestra por pasada de fondo (cada
 * ~15 min) y en cada cambio con la app abierta: { en, cargando, nivel }. Sirve al sueño estimado:
 * - enchufar y desenchufar son gestos tuyos (actividad): ubican el acostarte y el levantarte;
 * - una noche enchufado y sin actividad es una señal más de que dormías (sube la confianza).
 * Solo eso: ni la batería por la batería, ni nada de adentro del teléfono.
 */
import type { Db } from './db.ts'

export type Muestra = { en: number; cargando: boolean; nivel: number | null }

function asegurar(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS carga_telefono (fuente TEXT NOT NULL, en INTEGER NOT NULL, cargando INTEGER NOT NULL, nivel REAL, PRIMARY KEY (fuente, en))`)
}

/** Guarda las muestras (la misma hora dos veces no se duplica). Devuelve cuántas entraron. */
export function recibirCarga(db: Db, fuente: string, muestras: unknown, ahora = Date.now()): number {
  asegurar(db)
  if (!Array.isArray(muestras)) throw new Error('Mandá una lista de muestras')
  const ins = db.prepare('INSERT OR IGNORE INTO carga_telefono (fuente, en, cargando, nivel) VALUES (?, ?, ?, ?)')
  let n = 0
  for (const m of muestras.slice(0, 2000) as any[]) {
    const en = Math.round(Number(m?.en))
    if (!Number.isFinite(en) || en <= 0 || en > ahora + 120_000) continue
    const nivel = m?.nivel == null || !Number.isFinite(Number(m.nivel)) ? null : Math.min(1, Math.max(0, Number(m.nivel)))
    n += Number(ins.run(fuente.slice(0, 40), en, m?.cargando ? 1 : 0, nivel).changes)
  }
  // Más de 60 días no hace falta.
  db.prepare('DELETE FROM carga_telefono WHERE en < ?').run(ahora - 60 * 86_400_000)
  return n
}

export function muestrasEntre(db: Db, a: number, b: number): Muestra[] {
  asegurar(db)
  return (db.prepare('SELECT en, cargando, nivel FROM carga_telefono WHERE en >= ? AND en < ? ORDER BY en').all(a, b) as { en: number; cargando: number; nivel: number | null }[])
    .map((x) => ({ en: x.en, cargando: !!x.cargando, nivel: x.nivel }))
}

/** El máximo entre dos muestras para ubicar un cambio: más separadas, no se sabe cuándo fue. */
export const HUECO_CAMBIO = 40 * 60_000

/** Los instantes en que lo enchufaste o desenchufaste (en el medio de las dos muestras que lo muestran). */
export function cambiosDeCarga(ms: Muestra[]): { en: number; enchufado: boolean }[] {
  const out: { en: number; enchufado: boolean }[] = []
  for (let i = 1; i < ms.length; i++) {
    if (ms[i].cargando === ms[i - 1].cargando) continue
    if (ms[i].en - ms[i - 1].en > HUECO_CAMBIO) continue
    out.push({ en: Math.round((ms[i].en + ms[i - 1].en) / 2), enchufado: ms[i].cargando })
  }
  return out
}

/** Qué parte de [a, b] estuvo enchufado (0 a 1), según las muestras (cada una vale hasta la siguiente, como mucho 40 min). */
export function parteEnchufado(ms: Muestra[], a: number, b: number): number {
  if (!(b > a)) return 0
  let ms_ = 0
  for (let i = 0; i < ms.length; i++) {
    if (!ms[i].cargando) continue
    const desde = Math.max(a, ms[i].en)
    const hasta = Math.min(b, ms[i + 1]?.en ?? ms[i].en + HUECO_CAMBIO, ms[i].en + HUECO_CAMBIO)
    if (hasta > desde) ms_ += hasta - desde
  }
  return ms_ / (b - a)
}
