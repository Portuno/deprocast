/**
 * Aprender de verdad lo que consume: cada video, link o libro que valió la pena (valor ≥ 2 en el destilado) deja 3 a 5
 * tarjetas de recuerdo activo («¿qué plantea…?», «¿qué ejemplo usa para…?») en la pila «Lo que miraste». Mirar no es
 * aprender (la ilusión de fluidez): lo que queda es lo que se recuerda sin mirar. Corre en la nube, como paso del Procesar.
 * En la ficha de la pieza, «¿Qué te acordás?» primero pregunta y después muestra lo que plantea y sus tarjetas.
 */
import { json, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { crearTarjeta, tarjetasDeOrigen, type Tarjeta } from './tarjetas.ts'

export const MAZO_CONSUMIDO = 'consumido'
export const NOMBRE_CONSUMIDO = 'Lo que miraste'

/** Lo que miró o leyó (no lo que dijo él): videos de YouTube, links, lo que recomiendan y libros. */
const CONSUMIDO = `(c.fuente IN ('youtube', 'web') OR c.fuente LIKE 'libr%' OR json_extract(c.meta, '$.youtube') IS NOT NULL OR json_extract(c.meta, '$.recomendadoPor') IS NOT NULL)`

const SISTEMA = `Armás tarjetas de recuerdo activo de algo que él miró o leyó, para que lo recuerde de verdad (no para reconocerlo).
- 3 a 5 preguntas sobre lo central: qué plantea, los argumentos o ejemplos que lo sostienen, lo que propone hacer, lo que contradice. Nada de detalles triviales (fechas sueltas, nombres de pasada).
- Cada pregunta se entiende sola: nombrá el video, el autor o el tema si hace falta («En el video de X sobre la memoria, ¿por qué…?»).
- «respuesta»: 1 a 3 frases, lo esencial.
- «minuto»: "mm:ss" o "h:mm:ss" si el texto trae marcas de tiempo cerca de eso; si no, null.
- En castellano rioplatense, aunque el material esté en otro idioma.
Forma: {"tarjetas": [{"pregunta": string, "respuesta": string, "minuto": string | null}]}`

let modelo = async (db: Db, usuario: string): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'tarjetas' }, SISTEMA, usuario, { temperatura: 0.3, maxTokens: 1500 })).datos
export function _probarConsumido(f: typeof modelo) {
  modelo = f
}

/** Las piezas que valieron la pena y todavía no dejaron tarjetas (lo último primero). */
export function pendientesDeTarjetas(db: Db, n = 1): { id: number; titulo: string; contenido: string; url: string | null; salida: string }[] {
  return db.prepare(`SELECT c.id, c.titulo, c.contenido, c.url, d.salida FROM takeout_destilado d JOIN corpus c ON c.id = d.pieza_id
    WHERE d.estado = 'hecho' AND COALESCE(json_extract(d.salida, '$.valor'), 0) >= 2 AND ${CONSUMIDO}
    AND NOT EXISTS (SELECT 1 FROM tarjetas_piezas t WHERE t.pieza_id = c.id)
    ORDER BY d.hecho_en DESC LIMIT ?`).all(n) as any[]
}

export function cuantasFaltan(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM takeout_destilado d JOIN corpus c ON c.id = d.pieza_id
    WHERE d.estado = 'hecho' AND COALESCE(json_extract(d.salida, '$.valor'), 0) >= 2 AND ${CONSUMIDO}
    AND NOT EXISTS (SELECT 1 FROM tarjetas_piezas t WHERE t.pieza_id = c.id)`).get() as { n: number }).n
}

/** Las tarjetas de una pieza (con lo que el destilado dijo de ella). Devuelve cuántas nuevas. */
export async function tarjetasDePieza(db: Db, p: { id: number; titulo: string; contenido: string; url: string | null; salida: string }, ahora = Date.now()): Promise<number> {
  const d = json<any>(p.salida, {}) ?? {}
  const usuario = [
    `Título: ${p.titulo}`,
    d.tesis ? `Qué plantea (destilado): ${d.tesis}` : '',
    d.resumen ? `Resumen: ${d.resumen}` : '',
    Array.isArray(d.ideas) && d.ideas.length ? `Ideas: ${d.ideas.map((x: any) => x?.texto ?? x).join(' · ')}` : '',
    `Texto (puede estar cortado):\n${String(p.contenido).slice(0, 9000)}`,
  ].filter(Boolean).join('\n\n')
  const r = await modelo(db, usuario)
  let n = 0
  for (const t of (Array.isArray(r?.tarjetas) ? r.tarjetas : []).slice(0, 5)) {
    const pregunta = String(t?.pregunta ?? '').trim()
    const respuesta = String(t?.respuesta ?? '').trim()
    if (!pregunta || !respuesta) continue
    const minuto = typeof t?.minuto === 'string' && /^\d{1,2}(:\d{2}){1,2}$/.test(t.minuto.trim()) ? t.minuto.trim() : null
    const dorso = `${respuesta}\n\n${minuto ? `▶ ${minuto} · ` : '— '}${p.titulo}`
    if (crearTarjeta(db, { mazo: MAZO_CONSUMIDO, frente: pregunta, dorso, contexto: p.url ?? p.titulo, origenTipo: 'pieza', origenId: p.id }, ahora).nueva) n++
  }
  db.prepare('INSERT OR REPLACE INTO tarjetas_piezas (pieza_id, tarjetas, en) VALUES (?, ?, ?)').run(p.id, n, ahora)
  return n
}

/** El paso del Procesar: la próxima pieza pendiente. false = no quedaba ninguna. */
export async function tarjetasDeLoConsumido(db: Db, ahora = Date.now()): Promise<boolean> {
  const [p] = pendientesDeTarjetas(db, 1)
  if (!p) return false
  try {
    await tarjetasDePieza(db, p, ahora)
  } catch (e) {
    // Que una pieza rara no trabe la cola: queda marcada sin tarjetas (se puede rehacer desde su ficha).
    db.prepare('INSERT OR REPLACE INTO tarjetas_piezas (pieza_id, tarjetas, en) VALUES (?, 0, ?)').run(p.id, ahora)
    console.error(`  tarjetas de «${p.titulo}»:`, e instanceof Error ? e.message : e)
  }
  return true
}

/** Para la ficha: lo que plantea (para después de recordar) y sus tarjetas. */
export function recordarPieza(db: Db, piezaId: number): { titulo: string; tesis: string | null; resumen: string | null; tarjetas: Tarjeta[] } {
  const c = db.prepare('SELECT titulo FROM corpus WHERE id = ?').get(piezaId) as { titulo: string } | undefined
  if (!c) throw new Error(`No existe la pieza ${piezaId}`)
  const d = json<any>((db.prepare('SELECT salida FROM takeout_destilado WHERE pieza_id = ?').get(piezaId) as any)?.salida, {}) ?? {}
  return { titulo: c.titulo, tesis: d.tesis ?? null, resumen: d.resumen ?? null, tarjetas: tarjetasDeOrigen(db, 'pieza', piezaId) }
}
