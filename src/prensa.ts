/**
 * El diario propio (Fragua #166): lo que entra de la prensa (páginas filmadas o fotografiadas de un diario en valenciano,
 * un recorte pegado) se parte en notas, cada una traducida al castellano con el original al lado, con su tema y su
 * territorio. Él marca qué importa y qué no: lo descartado queda guardado pero fuera de la vista, y su criterio se
 * aprende (por tema y por territorio) para ordenarle las notas nuevas y sugerirle cuáles le importan.
 */
import { fechaLocal, type Db } from './db.ts'

export const TEMAS = ['política', 'economía', 'sociedad', 'urbanismo y vivienda', 'cultura', 'deportes', 'sucesos', 'educación', 'salud', 'medio ambiente', 'tecnología', 'opinión', 'otros'] as const
export type Nota = { id: number; fecha: string; titular: string; original: string; idioma: string; traduccion: string; tema: string; territorio: string | null; voto: 0 | 1 | null; sugerido: number | null; piezaId: number | null; origen: string | null; creada: number }

const deFila = (r: any): Nota => ({ id: r.id, fecha: r.fecha, titular: r.titular, original: r.original, idioma: r.idioma, traduccion: r.traduccion, tema: r.tema, territorio: r.territorio, voto: r.voto, sugerido: r.sugerido, piezaId: r.pieza_id, origen: r.origen, creada: r.creada })

let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> =>
  (await (await import('./modelo.ts')).pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'prensa' }, sistema, usuario, { temperatura: 0.2, maxTokens: 9000, largo: true })).datos
export function _probarPrensa(f: typeof modelo) { modelo = f }

const SISTEMA = `Recibís el texto de páginas de diario (sacado de fotos o de un video: puede venir desordenado, repetido o con basura de la imagen) y lo partís en NOTAS periodísticas.
Para cada nota: el titular, el texto original completo tal cual (en su idioma: valenciano, catalán, castellano…), su traducción fiel al castellano (sin resumir), el tema y el territorio (municipio, comarca, provincia o país del que trata; null si no tiene).
Temas posibles: ${TEMAS.join(', ')}.
Ignorá publicidad, cabeceras, números de página y pies de foto sueltos. No inventes nada que no esté en el texto.
Forma: {"notas": [{"titular": "...", "original": "...", "idioma": "valenciano|catalán|castellano|…", "traduccion": "...", "tema": "...", "territorio": "..." | null}]}`

/** Lo que él aprendió a marcar: cuánto le importa cada tema y cada territorio (con suavizado: sin votos, 0,5). */
export function criterio(db: Db) {
  const tasa = (col: 'tema' | 'territorio') => (db.prepare(`SELECT ${col} AS k, SUM(voto) AS si, COUNT(*) AS n FROM prensa WHERE voto IS NOT NULL AND ${col} IS NOT NULL GROUP BY ${col}`).all() as { k: string; si: number; n: number }[])
    .map((r) => ({ k: r.k, tasa: (r.si + 1) / (r.n + 2), votos: r.n }))
    .sort((a, b) => b.tasa - a.tasa)
  return { temas: tasa('tema'), territorios: tasa('territorio'), votos: (db.prepare('SELECT COUNT(*) AS n FROM prensa WHERE voto IS NOT NULL').get() as { n: number }).n }
}

/** Qué tan probable es que le importe: el promedio de la tasa de su tema y de su territorio (0–1). */
export function sugerir(db: Db, tema: string, territorio: string | null): number {
  const c = criterio(db)
  const t = c.temas.find((x) => x.k === tema)?.tasa ?? 0.5
  const z = territorio ? c.territorios.find((x) => x.k === territorio)?.tasa ?? 0.5 : 0.5
  return Math.round(((t + z) / 2) * 100) / 100
}

/** Parte el texto en notas, las traduce y las guarda (y cada una entra al corpus para buscarla). */
export async function procesarPrensa(db: Db, texto: string, o: { fecha?: string; origen?: string | null } = {}, ahora = Date.now()): Promise<Nota[]> {
  if (!texto.trim()) throw new Error('No hay texto de prensa para procesar')
  const d = await modelo(db, SISTEMA, texto.slice(0, 60_000))
  const fecha = o.fecha ?? fechaLocal(ahora)
  const { asegurarFuente } = await import('./corpus.ts')
  const { ingerir } = await import('./mastropiero.ts')
  asegurarFuente(db, { id: 'prensa', nombre: 'Prensa', nivel: 'primaria', descripcion: 'Notas de diarios que él trajo (fotos o videos de páginas), traducidas.' })
  const ids: number[] = []
  for (const n of Array.isArray(d?.notas) ? d.notas : []) {
    const titular = String(n?.titular ?? '').trim().slice(0, 300)
    const original = String(n?.original ?? '').trim().slice(0, 20_000)
    const traduccion = String(n?.traduccion ?? '').trim().slice(0, 20_000) || original
    if (!titular || !original) continue
    // La misma nota dos veces (dos tomas del mismo video, o la misma página otra vez): una sola.
    if (db.prepare('SELECT 1 FROM prensa WHERE fecha = ? AND titular = ?').get(fecha, titular)) continue
    const tema = (TEMAS as readonly string[]).includes(String(n?.tema)) ? String(n.tema) : 'otros'
    const territorio = n?.territorio ? String(n.territorio).trim().slice(0, 80) : null
    const idioma = String(n?.idioma ?? '').trim().slice(0, 30) || 'desconocido'
    const { corpusId } = ingerir(db, { fuente: 'prensa', titulo: titular, contenido: `${traduccion}\n\n— Original (${idioma}) —\n${original}`, fecha, origenId: `prensa:${fecha}:${titular.slice(0, 120)}`, dominio: tema, meta: { prensa: { idioma, territorio, tema } }, por: 'prensa' }, ahora)
    const r = db.prepare('INSERT INTO prensa (fecha, titular, original, idioma, traduccion, tema, territorio, sugerido, pieza_id, origen, creada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(fecha, titular, original, idioma, traduccion, tema, territorio, sugerir(db, tema, territorio), corpusId ?? null, o.origen ?? null, ahora)
    ids.push(Number(r.lastInsertRowid))
  }
  return ids.map((id) => deFila(db.prepare('SELECT * FROM prensa WHERE id = ?').get(id)))
}

/** Importa (1) o no (0); null lo vuelve a dejar sin marcar. Las sugeridas de las pendientes se recalculan. */
export function votarNota(db: Db, id: number, voto: 0 | 1 | null) {
  if (!db.prepare('SELECT 1 FROM prensa WHERE id = ?').get(id)) throw new Error(`No existe la nota ${id}`)
  db.prepare('UPDATE prensa SET voto = ? WHERE id = ?').run(voto, id)
  for (const r of db.prepare('SELECT id, tema, territorio FROM prensa WHERE voto IS NULL').all() as { id: number; tema: string; territorio: string | null }[]) {
    db.prepare('UPDATE prensa SET sugerido = ? WHERE id = ?').run(sugerir(db, r.tema, r.territorio), r.id)
  }
  return deFila(db.prepare('SELECT * FROM prensa WHERE id = ?').get(id))
}

/** El diario de un día: por tema, lo que importa primero, lo pendiente ordenado por lo que probablemente le importe; lo descartado, aparte. */
export function diarioDe(db: Db, fecha?: string | null) {
  const dias = (db.prepare('SELECT fecha, COUNT(*) AS n, SUM(CASE WHEN voto IS NULL THEN 1 ELSE 0 END) AS pendientes FROM prensa GROUP BY fecha ORDER BY fecha DESC LIMIT 60').all() as { fecha: string; n: number; pendientes: number }[])
  const dia = fecha ?? dias[0]?.fecha ?? null
  const notas = dia ? (db.prepare('SELECT * FROM prensa WHERE fecha = ? ORDER BY COALESCE(voto, 0.5 + sugerido / 10) DESC, sugerido DESC, id').all(dia) as any[]).map(deFila) : []
  const temas = new Map<string, Nota[]>()
  for (const n of notas.filter((x) => x.voto !== 0)) (temas.get(n.tema) ?? temas.set(n.tema, []).get(n.tema)!).push(n)
  return { dia, dias, temas: [...temas].map(([tema, ns]) => ({ tema, notas: ns })), descartadas: notas.filter((x) => x.voto === 0), criterio: criterio(db) }
}
