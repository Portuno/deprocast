/**
 * «Cargá lo de ayer» (Fragua #241): una sola orden que junta todo lo de un día, sin pasar por Drive, NotebookLM ni el
 * Takeout a mano.
 * 1. Trae lo que dejó en sus carpetas vigiladas de Drive (las que entran al corpus) y procesa lo que esperaba en la
 *    cola (audios y hojas subidos).
 * 2. Lo que charló ese día (por la web, Telegram o WhatsApp, también lo dictado) entra como una pieza suya, «Charla del
 *    día», y pasa por la ingesta (entidades y quántomos), una sola vez: si se vuelve a cargar, se actualiza.
 * 3. Arma el diario de ese día (y lo que lo contiene).
 * 4. Devuelve cada pieza del día con su origen: el archivo, el link o el canal de donde salió.
 */
import { fechaLocal, type Db } from './db.ts'

/** «ayer», «hoy», «anteayer» o una fecha YYYY-MM-DD → la fecha. */
export function fechaPedida(que: string | null | undefined, ahora = Date.now()): string {
  const q = String(que ?? 'ayer').trim().toLowerCase()
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return q
  if (q === 'hoy') return fechaLocal(ahora)
  if (q === 'anteayer') return fechaLocal(ahora - 2 * 86_400_000)
  return fechaLocal(ahora - 86_400_000)
}

const DIA_DE_PIEZA = `substr(COALESCE(fecha, date(creado_en / 1000, 'unixepoch', 'localtime')), 1, 10)`
const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) : d } catch { return d } }

/** De dónde salió una pieza, en palabras: el archivo, el link o el canal. */
export function origenDe(p: { url: string | null; fuente: string; datos: string | null; meta: string | null }): string {
  const d = json<Record<string, any>>(p.datos, {}), m = json<Record<string, any>>(p.meta, {})
  if (p.url) return p.url
  const archivo = d.archivo ?? m.archivo ?? m.drive?.nombre ?? m.nombre
  if (archivo) return `archivo: ${archivo}`
  const canal = d.canal ?? m.voz?.dispositivo ?? m.canal
  if (canal) return `${canal}${d.url ? ` · ${d.url}` : ''}`
  if (d.url) return d.url
  return `fuente: ${p.fuente}`
}

/** Lo que charló ese día, como texto (lo suyo y lo de Mastropiero, con la hora y el canal). */
function charlaDelDia(db: Db, fecha: string): { texto: string; suyos: number } {
  const desde = new Date(`${fecha}T00:00:00`).getTime(), hasta = desde + 86_400_000
  const ms = db.prepare(`SELECT m.rol, m.texto, m.en, m.via FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
      WHERE m.en >= ? AND m.en < ? AND m.rol IN ('operador', 'asistente') AND m.texto IS NOT NULL AND m.texto != '' AND COALESCE(m.via, '') NOT IN ('encargo', 'rapida')
      AND c.con = 'mastropiero' ORDER BY m.en`).all(desde, hasta) as { rol: string; texto: string; en: number; via: string | null }[]
  const suyos = ms.filter((m) => m.rol === 'operador').length
  const texto = ms.map((m) => `**${new Date(m.en).toTimeString().slice(0, 5)} · ${m.rol === 'operador' ? `Él${m.via === 'voz' ? ' (dictado)' : ''}` : 'Mastropiero'}**: ${m.texto.replace(/\[imagen:[^\]]*\]/g, '(imagen)').trim()}`).join('\n\n')
  return { texto, suyos }
}

/** Para las pruebas: lo que sale a la red (Drive y la cola) y la ingesta. */
let externos = {
  drive: async (db: Db) => (await import('./google/drive.ts')).sincronizarCorpus(db),
  tandas: async (db: Db) => (await import('./tandas.ts')).procesarTandas(db),
  diario: async (db: Db, fecha: string) => (await import('./escalas.ts')).armarHaciaArriba(db, fecha),
}
export function _probarCargarDia(o: Partial<typeof externos>) { externos = { ...externos, ...o } }

export async function cargarDia(db: Db, que?: string | null, ahora = Date.now()) {
  const fecha = fechaPedida(que, ahora)
  const avisos: string[] = []
  // 1. Lo que dejó en sus carpetas de Drive, y la cola de audios y hojas.
  let drive: { nuevos: number; actualizados: number } | null = null
  try { const r = await externos.drive(db); drive = { nuevos: r.nuevos, actualizados: r.actualizados } } catch (e) { avisos.push(`Drive: ${e instanceof Error ? e.message : e}`) }
  let tandas = 0
  try { tandas = await externos.tandas(db) } catch (e) { avisos.push(`La cola de audios y hojas: ${e instanceof Error ? e.message : e}`) }

  // 2. La charla del día, como pieza suya (una por día: si ya estaba y creció, se actualiza).
  let charla: { piezaId: number; mensajes: number; nueva: boolean } | null = null
  const c = charlaDelDia(db, fecha)
  if (c.suyos >= 2) {
    const origenId = `charla:${fecha}`
    const ya = db.prepare('SELECT id, contenido FROM corpus WHERE origen_id = ?').get(origenId) as { id: number; contenido: string } | undefined
    const titulo = `Charla del día · ${fecha}`
    if (ya) {
      if (ya.contenido !== c.texto) {
        db.prepare('UPDATE corpus SET contenido = ? WHERE id = ?').run(c.texto, ya.id)
        db.prepare('DELETE FROM pasajes WHERE pieza_id = ?').run(ya.id) // cambió el texto: sus pasajes se rehacen
      }
      charla = { piezaId: ya.id, mensajes: c.suyos, nueva: false }
    } else {
      const { asegurarFuente } = await import('./corpus.ts')
      asegurarFuente(db, { id: 'charlas', nombre: 'Charlas con Mastropiero', nivel: 'propia', descripcion: 'Lo que charló cada día (web, Telegram, WhatsApp y lo dictado), cargado con «cargá lo de ayer».' })
      const { ingerir } = await import('./mastropiero.ts')
      const r = ingerir(db, { fuente: 'charlas', nivel: 'propia', titulo, contenido: c.texto, fecha, origenId, dominio: 'charla', meta: { canal: 'chat', mensajes: c.suyos } }, ahora)
      charla = { piezaId: r.corpusId, mensajes: c.suyos, nueva: true }
    }
  }

  // 3. El diario de ese día (y lo que lo contiene).
  let diario: string[] = []
  try { diario = await externos.diario(db, fecha) } catch (e) { avisos.push(`El diario: ${e instanceof Error ? e.message : e}`) }

  // 4. Cada pieza suya del día, con su origen.
  const piezas = (db.prepare(`SELECT id, titulo, fuente, url, datos, meta, (SELECT COUNT(*) FROM corpus_entidades ce WHERE ce.pieza_id = corpus.id) AS entidades
      FROM corpus WHERE nivel = 'propia' AND estado != 'retirada' AND ${DIA_DE_PIEZA} = ? ORDER BY id`).all(fecha) as any[])
    .map((p) => ({ id: p.id, titulo: p.titulo, fuente: p.fuente, origen: origenDe(p), entidades: p.entidades }))
  return { fecha, drive, tandas, charla, diario, piezas, avisos }
}

/** En palabras, para el chat y Telegram. */
export function textoDeCarga(r: Awaited<ReturnType<typeof cargarDia>>): string {
  const lineas = [
    `📥 Cargué lo del ${r.fecha}: ${r.piezas.length} pieza${r.piezas.length === 1 ? '' : 's'}${r.charla ? ` (con la charla del día, ${r.charla.mensajes} mensajes tuyos${r.charla.nueva ? '' : ', actualizada'})` : ''}.`,
    r.drive ? `Drive: ${r.drive.nuevos} nuevos, ${r.drive.actualizados} actualizados.` : '',
    r.tandas ? `La cola: ${r.tandas} audio${r.tandas === 1 ? '' : 's'} u hoja${r.tandas === 1 ? '' : 's'} procesados.` : '',
    r.piezas.slice(0, 30).map((p) => `- [#${p.id}] ${p.titulo} — ${p.origen}`).join('\n'),
    r.piezas.length > 30 ? `…y ${r.piezas.length - 30} más.` : '',
    r.diario.length ? `El diario quedó armado (${r.diario.join(', ')}).` : '',
    r.avisos.length ? `⚠ ${r.avisos.join(' · ')}` : '',
  ]
  return lineas.filter(Boolean).join('\n')
}
