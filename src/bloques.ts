/**
 * Los bloques de foco guiados: él dice «arranco 25 minutos» y, solo porque lo arrancó él, Mastropiero lo cuida.
 * Con el Directo prendido mira los momentos: si se va del tema más de 3 minutos, le avisa una vez. Al terminar, la
 * tarjeta dice cuánto sostuvo y el descanso que le toca (el ciclo 90/20). Si estaba en una banda de su run, queda
 * colgado de ella; si no, queda en el Directo. Sin modelo: todo sale de lo registrado.
 */
import { type Db } from './db.ts'
import { sesionActiva } from './directo.ts'
import { appsEstimulo, metaDeBloque } from './foco.ts'
import { enCurso } from './misiones.ts'

const MIN = 60_000
const norm = (s: string | null) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const palabras = (s: string | null) => norm(s).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4)

export type Bloque = {
  id: number; inicio: number; minutos: number; tema: string | null; referencia: string | null
  sesionId: number | null; misionId: number | null; avisado: boolean; fin: number | null; sostenido: number | null
}

const deBloque = (r: any): Bloque => ({
  id: r.id, inicio: r.inicio, minutos: r.minutos, tema: r.tema, referencia: r.referencia, sesionId: r.sesion_id,
  misionId: r.mision_id, avisado: r.avisado === 1, fin: r.fin, sostenido: r.sostenido,
})

export function bloqueActivo(db: Db): Bloque | null {
  const r = db.prepare('SELECT * FROM bloques_foco WHERE fin IS NULL ORDER BY id DESC LIMIT 1').get()
  return r ? deBloque(r) : null
}

type MomentoPantalla = { desde: number; hasta: number; app: string | null; actividad: string | null; tema: string | null; detalle: string | null }

function pantallaDesde(db: Db, sesionId: number | null, desde: number, hasta: number): MomentoPantalla[] {
  if (sesionId == null) return []
  return db.prepare(`SELECT desde, hasta, app, actividad, tema, detalle FROM directo_momentos WHERE sesion_id = ? AND tipo = 'pantalla' AND hasta >= ? AND desde <= ? ORDER BY desde`)
    .all(sesionId, desde, hasta) as MomentoPantalla[]
}

/** «Arranco 25 minutos con el informe»: sin largo, su meta de bloque (o 25). Si ya había uno, lo cierra primero. */
export function arrancarBloque(db: Db, o: { minutos?: number | null; tema?: string | null } = {}, ahora = Date.now()): Bloque {
  if (bloqueActivo(db)) terminarBloque(db, ahora)
  const minutos = Math.max(5, Math.min(180, Math.round(o.minutos || metaDeBloque(db, ahora) || 25)))
  const s = sesionActiva(db)
  // Lo que estaba haciendo al arrancar: la referencia del tema si no lo dijo.
  const ultimo = s ? (pantallaDesde(db, s.id, ahora - 5 * MIN, ahora).at(-1) ?? null) : null
  const referencia = ultimo ? `${norm(ultimo.app)}|${norm(ultimo.tema)}` : null
  const banda = enCurso(db, ahora)?.actual ?? null
  const r = db.prepare('INSERT INTO bloques_foco (inicio, minutos, tema, referencia, sesion_id, mision_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ahora, minutos, o.tema?.trim() || null, referencia, s?.id ?? null, banda?.id ?? null)
  return deBloque(db.prepare('SELECT * FROM bloques_foco WHERE id = ?').get(Number(r.lastInsertRowid)))
}

/** Un momento está en el tema si no es de alto estímulo y es lo mismo que al arrancar o nombra el tema que dijo. */
function enTema(b: Bloque, m: MomentoPantalla, estimulo: string[]) {
  if (estimulo.some((e) => `${norm(m.app)} ${norm(m.detalle)}`.includes(e))) return false
  if (!b.tema && !b.referencia) return true
  if (b.referencia && `${norm(m.app)}|${norm(m.tema)}` === b.referencia) return true
  if (b.referencia && norm(m.app) === b.referencia.split('|')[0] && !b.tema) return true
  const ws = new Set(palabras(`${m.app} ${m.actividad} ${m.tema} ${m.detalle}`))
  return palabras(b.tema).some((w) => ws.has(w))
}

/** Cuánto lleva fuera del tema ahora mismo (el tramo final de momentos que no son del tema), en minutos. */
export function fueraDelTema(db: Db, b: Bloque, ahora = Date.now()): { minutos: number; donde: string } | null {
  const ms = pantallaDesde(db, b.sesionId, b.inicio, ahora)
  const est = appsEstimulo(db)
  let i = ms.length
  while (i > 0 && !enTema(b, ms[i - 1], est)) i--
  if (i === ms.length) return null
  const fuera = ms.slice(i)
  const ultimo = fuera.at(-1)!
  const minutos = Math.round((Math.max(ultimo.hasta, Math.min(ahora, ultimo.hasta + MIN)) - Math.max(fuera[0].desde, b.inicio)) / MIN)
  return { minutos, donde: [ultimo.app, ultimo.tema].filter(Boolean).join(' · ') || 'otra cosa' }
}

/** Los minutos del bloque que estuvo en el tema (null sin Directo: no hay cómo saberlo). */
function sostenidoDe(db: Db, b: Bloque, fin: number): number | null {
  if (b.sesionId == null) return null
  const est = appsEstimulo(db)
  const ms = pantallaDesde(db, b.sesionId, b.inicio, fin)
  if (!ms.length) return null
  const en = ms.filter((m) => enTema(b, m, est)).reduce((s, m) => s + Math.max(0, Math.min(m.hasta, fin) - Math.max(m.desde, b.inicio)), 0)
  return Math.min(b.minutos, Math.round(en / MIN))
}

/** Lo que lleva de foco encadenado hoy (bloques con menos de 30 minutos entre uno y otro), para el ciclo 90/20. */
function encadenado(db: Db, hasta: number): number {
  const bs = db.prepare('SELECT inicio, fin FROM bloques_foco WHERE fin IS NOT NULL AND fin <= ? ORDER BY inicio DESC LIMIT 20').all(hasta) as { inicio: number; fin: number }[]
  let total = 0
  let corte = hasta
  for (const b of bs) {
    if (corte - b.fin > 30 * MIN) break
    total += b.fin - b.inicio
    corte = b.inicio
  }
  return Math.round(total / MIN)
}

/** Cierra el bloque: cuánto sostuvo, el descanso que le toca y la tarjeta para el chat. */
export function terminarBloque(db: Db, ahora = Date.now()): { bloque: Bloque; tarjeta: string } | null {
  const b = bloqueActivo(db)
  if (!b) return null
  const fin = Math.min(ahora, b.inicio + b.minutos * MIN)
  const sostenido = sostenidoDe(db, b, fin)
  db.prepare('UPDATE bloques_foco SET fin = ?, sostenido = ? WHERE id = ?').run(fin, sostenido, b.id)
  const hecho = deBloque(db.prepare('SELECT * FROM bloques_foco WHERE id = ?').get(b.id))
  const duro = Math.round((fin - b.inicio) / MIN)
  const cadena = encadenado(db, fin)
  const descanso = cadena >= 90 ? `Lleva ${cadena} minutos de foco encadenado: le corresponden 20 de descanso de verdad, lejos de la pantalla.`
    : duro >= 10 ? 'Le corresponden unos 5 minutos para pararse y estirarse.' : ''
  const banda = b.misionId != null ? (db.prepare('SELECT titulo, estado FROM misiones WHERE id = ?').get(b.misionId) as { titulo: string; estado: string } | undefined) : undefined
  const tarjeta = [
    `⏱ Bloque terminado${b.tema ? ` (${b.tema})` : ''}: ${duro < b.minutos ? `${duro} de ${b.minutos}` : `${b.minutos}`} minutos.`,
    sostenido != null ? `Sostuvo ${sostenido} en el tema.` : '',
    descanso,
    `[[seguir]]\n${banda && banda.estado !== 'hecha' ? `Marcá la banda «${banda.titulo}» como hecha\n` : ''}Arranco otro bloque de ${b.minutos}\n[[/seguir]]`,
  ].filter(Boolean).join(' ').replace(' [[seguir]]', '\n[[seguir]]')
  return { bloque: hecho, tarjeta }
}

/**
 * El latido: si el bloque ya cumplió su tiempo, lo cierra (y devuelve la tarjeta); si se fue del tema más de 3 minutos,
 * le avisa una vez. Devuelve lo que hay que decirle, o null.
 */
export function vigilarBloque(db: Db, ahora = Date.now()): string | null {
  const b = bloqueActivo(db)
  if (!b) return null
  if (ahora >= b.inicio + b.minutos * MIN) return terminarBloque(db, ahora)?.tarjeta ?? null
  if (b.avisado) return null
  const f = fueraDelTema(db, b, ahora)
  if (!f || f.minutos < 3) return null
  db.prepare('UPDATE bloques_foco SET avisado = 1 WHERE id = ?').run(b.id)
  const quedan = Math.max(1, Math.round((b.inicio + b.minutos * MIN - ahora) / MIN))
  return `⏱ Lleva ${f.minutos} minutos en ${f.donde}; el bloque era ${b.tema ? `«${b.tema}»` : 'otra cosa'}. Le quedan ${quedan}.`
}

/** Para la franja y el prompt: el bloque de ahora, con lo que lleva y lo que le queda. */
export function bloqueParaVivo(db: Db, ahora = Date.now()) {
  const b = bloqueActivo(db)
  if (!b) return null
  const lleva = Math.round((ahora - b.inicio) / MIN)
  return { id: b.id, tema: b.tema, minutos: b.minutos, lleva, quedan: Math.max(0, b.minutos - lleva), avisado: b.avisado, fuera: fueraDelTema(db, b, ahora) }
}

/** Para el prompt de Mastropiero: una línea con el bloque en curso (o nada). */
export function bloqueParaPrompt(db: Db, ahora = Date.now()): string {
  const b = bloqueParaVivo(db, ahora)
  if (!b) return ''
  return `Está en un bloque de foco guiado que arrancó él${b.tema ? ` («${b.tema}»)` : ''}: lleva ${b.lleva} de ${b.minutos} minutos${b.fuera && b.fuera.minutos >= 1 ? `; hace ${b.fuera.minutos} min que está en ${b.fuera.donde}, fuera del tema` : ''}. Cuidale el bloque: corto y al grano.`
}
