/**
 * Criba lúdica: pesar el corpus como un juego. Una pieza por vez (primero links compartidos y lo propio sin peso),
 * él le pone un peso de 1 a 12 o la descarta, con una tecla. Cuenta las de hoy y la racha de días seguidos. El peso
 * ordena todo lo demás: lo pesado sube en las búsquedas y en lo que leen los ayudantes; lo descartado no estorba.
 */
import { fechaLocal, type Db } from './db.ts'
import { leerPieza, type Pieza } from './corpus.ts'

/** Peso 0 = descartada (queda, pero al fondo). */
export function siguiente(db: Db, f: { nivel?: string | null; saltear?: number[] } = {}): Pieza | null {
  const saltear = (f.saltear ?? []).filter(Number.isFinite)
  const r = db.prepare(`SELECT id FROM corpus WHERE peso IS NULL AND nivel != 'generada' ${f.nivel ? 'AND nivel = ?' : ''}
      ${saltear.length ? `AND id NOT IN (${saltear.map(() => '?').join(',')})` : ''}
    ORDER BY tipo = 'enlace' DESC, nivel = 'propia' DESC, (abs(random()) % 100) LIMIT 1`).get(...(f.nivel ? [f.nivel] : []), ...saltear) as any
  return r ? leerPieza(db, r.id) : null
}

export function cribar(db: Db, id: number, peso: number, ahora = Date.now()) {
  const p = Math.round(Number(peso))
  if (!Number.isFinite(p) || p < 0 || p > 12) throw new Error('El peso va de 1 a 12 (0 = descartar)')
  if (!leerPieza(db, id)) throw new Error(`No existe la pieza ${id}`)
  db.prepare('UPDATE corpus SET peso = ? WHERE id = ?').run(p, id)
  db.prepare('INSERT INTO criba (pieza_id, peso, fecha, en) VALUES (?, ?, ?, ?)').run(id, p, fechaLocal(ahora), ahora)
  return marcador(db, ahora)
}

/** Deshace la última (por si se equivocó de tecla). */
export function deshacerUltima(db: Db, ahora = Date.now()) {
  const u = db.prepare('SELECT id, pieza_id FROM criba ORDER BY id DESC LIMIT 1').get() as any
  if (!u) return { pieza: null, marcador: marcador(db, ahora) }
  db.prepare('DELETE FROM criba WHERE id = ?').run(u.id)
  const previo = db.prepare('SELECT peso FROM criba WHERE pieza_id = ? ORDER BY id DESC LIMIT 1').get(u.pieza_id) as any
  db.prepare('UPDATE corpus SET peso = ? WHERE id = ?').run(previo?.peso ?? null, u.pieza_id)
  return { pieza: leerPieza(db, u.pieza_id), marcador: marcador(db, ahora) }
}

export function marcador(db: Db, ahora = Date.now()) {
  const hoy = fechaLocal(ahora)
  const dias = new Set((db.prepare('SELECT DISTINCT fecha FROM criba').all() as any[]).map((r) => r.fecha))
  // Días seguidos con al menos una; si hoy todavía no cribó, la racha de ayer sigue viva.
  let racha = 0
  const d = new Date(`${hoy}T12:00:00`)
  if (!dias.has(hoy)) d.setDate(d.getDate() - 1)
  while (dias.has(fechaLocal(d.getTime()))) { racha++; d.setDate(d.getDate() - 1) }
  const n = (sql: string, ...a: any[]) => (db.prepare(sql).get(...a) as any).n as number
  return {
    hoy: n('SELECT COUNT(*) AS n FROM criba WHERE fecha = ?', hoy),
    racha,
    cribadas: n('SELECT COUNT(*) AS n FROM corpus WHERE peso IS NOT NULL'),
    faltan: n(`SELECT COUNT(*) AS n FROM corpus WHERE peso IS NULL AND nivel != 'generada'`),
    descartadas: n('SELECT COUNT(*) AS n FROM corpus WHERE peso = 0'),
  }
}
