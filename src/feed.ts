/**
 * Tu feed, con tope (plan v38, fase 5: Fragua #153 y #160). Lo mejor de las redes sin quedar atrapado:
 * - Fuentes que él elige: cuentas de X, subreddits y canales de YouTube. Se recolectan solas (sin cuenta, con lo que ya
 *   trae el explorador: búsqueda pública en X, RSS en Reddit, la pestaña de videos o el RSS en YouTube).
 * - #160 X como fuente: lo que publican sus cuentas de X entra además al corpus, como un pozo propio («X»), sin duplicados.
 * - #153 El feed: una cantidad FIJA por día y por plataforma (15 de X, 5 de YouTube, 5 de Reddit, ajustables); al
 *   llegar al tope, se termina. Sin scroll infinito.
 * - Se criba como el Diario: importa / no. Su criterio se aprende por fuente y ordena lo que viene (lo que suele importarle,
 *   primero). Lo que importa de YouTube va a la cola de transcripción; lo de Reddit, al corpus.
 */
import { ajuste, fechaLocal, fijarAjuste, type Db } from './db.ts'

export const PLATAFORMAS = ['x', 'youtube', 'reddit'] as const
export type Plataforma = (typeof PLATAFORMAS)[number]
const TOPE_DEFECTO: Record<Plataforma, number> = { x: 15, youtube: 5, reddit: 5 }
export type Fuente = { id: number; plataforma: Plataforma; ref: string; nombre: string; activa: boolean; ultima: number | null; error: string | null }
export type ItemFeed = { id: number; plataforma: Plataforma; fuenteId: number; url: string; titulo: string; texto: string | null; autor: string | null; fecha: string | null; voto: 0 | 1 | null; sugerido: number; piezaId: number | null; creado: number }
const deFuente = (r: any): Fuente => ({ id: r.id, plataforma: r.plataforma, ref: r.ref, nombre: r.nombre, activa: !!r.activa, ultima: r.ultima, error: r.error })
const deItem = (r: any): ItemFeed => ({ id: r.id, plataforma: r.plataforma, fuenteId: r.fuente_id, url: r.url, titulo: r.titulo, texto: r.texto, autor: r.autor, fecha: r.fecha, voto: r.voto, sugerido: r.sugerido ?? 0.5, piezaId: r.pieza_id, creado: r.creado })

/** Cómo lo nombra él → la plataforma y la referencia («@pg», «r/typescript», un link de canal). */
export function interpretarFuente(texto: string): { plataforma: Plataforma; ref: string; nombre: string } {
  const t = texto.trim()
  let m = /^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/(\w{1,15})\/?$/i.exec(t) ?? /^@(\w{1,15})$/.exec(t)
  if (m) return { plataforma: 'x', ref: m[1], nombre: `@${m[1]}` }
  m = /^(?:https?:\/\/)?(?:www\.)?reddit\.com\/r\/(\w{2,30})\/?$/i.exec(t) ?? /^\/?r\/(\w{2,30})$/i.exec(t)
  if (m) return { plataforma: 'reddit', ref: m[1], nombre: `r/${m[1]}` }
  m = /^(?:https?:\/\/)?(?:www\.)?youtube\.com\/((?:@[\w.-]+)|(?:channel\/UC[\w-]+))\/?/i.exec(t)
  if (m) return { plataforma: 'youtube', ref: m[1], nombre: m[1].startsWith('@') ? m[1] : 'canal de YouTube' }
  throw new Error('No reconozco la fuente: «@cuenta» o un link de X, «r/subreddit», o el link de un canal de YouTube (@nombre o /channel/UC…)')
}

export function sumarFuente(db: Db, texto: string, ahora = Date.now()): Fuente {
  const f = interpretarFuente(texto)
  db.prepare(`INSERT INTO feed_fuentes (plataforma, ref, nombre, activa, creada) VALUES (?, ?, ?, 1, ?) ON CONFLICT (plataforma, ref) DO UPDATE SET activa = 1`).run(f.plataforma, f.ref, f.nombre, ahora)
  return deFuente(db.prepare('SELECT * FROM feed_fuentes WHERE plataforma = ? AND ref = ?').get(f.plataforma, f.ref))
}
export const fuentes = (db: Db) => (db.prepare('SELECT * FROM feed_fuentes ORDER BY plataforma, nombre').all() as any[]).map(deFuente)
export function quitarFuente(db: Db, id: number) { db.prepare('UPDATE feed_fuentes SET activa = 0 WHERE id = ?').run(id); return { ok: true } }

export function topes(db: Db): Record<Plataforma, number> {
  try { return { ...TOPE_DEFECTO, ...JSON.parse(ajuste(db, 'feed_topes') ?? '{}') } } catch { return { ...TOPE_DEFECTO } }
}
export function fijarTope(db: Db, plataforma: Plataforma, n: number) {
  if (!PLATAFORMAS.includes(plataforma)) throw new Error('Plataforma desconocida')
  fijarAjuste(db, 'feed_topes', JSON.stringify({ ...topes(db), [plataforma]: Math.max(1, Math.min(50, Math.round(n))) }))
  return topes(db)
}

/** Cuánto le importa lo de cada fuente (con suavizado: sin votos, 0,5). */
export function sugerido(db: Db, fuenteId: number): number {
  const r = db.prepare('SELECT SUM(voto) AS si, COUNT(*) AS n FROM feed_items WHERE fuente_id = ? AND voto IS NOT NULL').get(fuenteId) as { si: number | null; n: number }
  return Math.round((((r.si ?? 0) + 1) / (r.n + 2)) * 100) / 100
}

// ─── recolectar ─────────────────────────────────────────────────────────

type Traido = { url: string; titulo: string; texto?: string | null; autor?: string | null; fecha?: string | null }
/** Lo que trae cada fuente (inyectable: en los tests no hay red). */
let traer = async (db: Db, f: Fuente): Promise<Traido[]> => {
  const ex = await import('./explorar/index.ts')
  if (f.plataforma === 'reddit') return (await ex.listar(db, 'reddit', 'subreddit', f.ref, { n: 25 })).items
  if (f.plataforma === 'x') {
    // Sin cuenta no hay perfiles: la búsqueda pública de sus tweets, y solo los que son de esa cuenta.
    const b = await ex.buscar(db, 'x', `from:${f.ref} OR @${f.ref}`, { n: 20 })
    return b.items.filter((i) => new RegExp(`(x|twitter)\\.com/${f.ref}/status/`, 'i').test(i.url))
  }
  try { return (await ex.listar(db, 'youtube', 'canal', f.ref, { n: 10 })).items } catch (e) {
    // YouTube suele bloquear a la nube: con el id del canal, el RSS.
    const id = /channel\/(UC[\w-]+)/.exec(f.ref)?.[1]
    if (!id) throw e
    const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { signal: AbortSignal.timeout(20_000) })).text()
    return [...xml.matchAll(/<entry>[\s\S]*?<title>([^<]*)<\/title>[\s\S]*?<link rel="alternate" href="([^"]+)"[\s\S]*?<published>([^<]+)<\/published>[\s\S]*?<\/entry>/g)].slice(0, 10).map((m) => ({ titulo: m[1], url: m[2], fecha: m[3].slice(0, 10) }))
  }
}
export function _probarFeed(f: typeof traer) { traer = f }

/** Recorre las fuentes activas y guarda lo nuevo. Lo de X entra además al corpus (el pozo, #160). */
export async function recolectar(db: Db, ahora = Date.now()): Promise<{ nuevos: number; errores: number }> {
  let nuevos = 0
  let errores = 0
  for (const f of fuentes(db).filter((x) => x.activa)) {
    try {
      const items = await traer(db, f)
      for (const it of items) {
        if (!it.url || db.prepare('SELECT 1 FROM feed_items WHERE url = ?').get(it.url)) continue
        let piezaId: number | null = null
        if (f.plataforma === 'x' && (it.texto || it.titulo)) {
          const { asegurarFuente } = await import('./corpus.ts')
          const { ingerir } = await import('./mastropiero.ts')
          asegurarFuente(db, { id: 'x', nombre: 'X (sus cuentas)', nivel: 'primaria', descripcion: 'Lo que publican las cuentas de X que él sigue en su feed.' })
          piezaId = ingerir(db, { fuente: 'x', titulo: `${f.nombre}: ${(it.titulo || it.texto || '').slice(0, 80)}`, contenido: [it.titulo, it.texto].filter(Boolean).join('\n\n'), url: it.url, fecha: it.fecha ?? fechaLocal(ahora), origenId: `x:${it.url}`, meta: { x: { cuenta: f.ref } }, por: 'feed' }, ahora).corpusId ?? null
        }
        db.prepare(`INSERT INTO feed_items (plataforma, fuente_id, url, titulo, texto, autor, fecha, sugerido, pieza_id, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(f.plataforma, f.id, it.url, (it.titulo || it.url).slice(0, 300), it.texto?.slice(0, 4000) ?? null, it.autor ?? null, it.fecha ?? null, sugerido(db, f.id), piezaId, ahora)
        nuevos++
      }
      db.prepare('UPDATE feed_fuentes SET ultima = ?, error = NULL WHERE id = ?').run(ahora, f.id)
    } catch (e) {
      errores++
      db.prepare('UPDATE feed_fuentes SET ultima = ?, error = ? WHERE id = ?').run(ahora, (e instanceof Error ? e.message : String(e)).slice(0, 200), f.id)
    }
  }
  return { nuevos, errores }
}

// ─── el feed del día, con tope ──────────────────────────────────────────

/**
 * Lo de hoy por plataforma: lo ya visto hoy (marcado) cuenta para el tope; lo que falta se completa con lo pendiente más
 * probable de importarle. Cuando lo visto llega al tope, «se terminó por hoy».
 */
export function feedDe(db: Db, ahora = Date.now()) {
  const hoy = fechaLocal(ahora)
  const t = topes(db)
  return PLATAFORMAS.map((p) => {
    const vistos = (db.prepare(`SELECT * FROM feed_items WHERE plataforma = ? AND votado_dia = ? ORDER BY votado_en`).all(p, hoy) as any[]).map(deItem)
    const quedan = Math.max(0, t[p] - vistos.length)
    const pendientes = quedan ? (db.prepare(`SELECT * FROM feed_items WHERE plataforma = ? AND voto IS NULL ORDER BY sugerido DESC, creado DESC LIMIT ?`).all(p, quedan) as any[]).map(deItem) : []
    return { plataforma: p, tope: t[p], vistos: vistos.length, terminado: quedan === 0, items: [...pendientes, ...vistos] }
  })
}

/** Importa (1) o no (0). Lo que importa de YouTube va a la cola de transcripción; lo de Reddit, al corpus. */
export async function votarItem(db: Db, id: number, voto: 0 | 1, ahora = Date.now()) {
  const r = db.prepare('SELECT * FROM feed_items WHERE id = ?').get(id)
  if (!r) throw new Error(`No existe el ítem ${id}`)
  const it = deItem(r)
  db.prepare('UPDATE feed_items SET voto = ?, votado_dia = ?, votado_en = ? WHERE id = ?').run(voto, fechaLocal(ahora), ahora, id)
  for (const x of db.prepare('SELECT id FROM feed_items WHERE fuente_id = ? AND voto IS NULL').all(it.fuenteId) as { id: number }[]) db.prepare('UPDATE feed_items SET sugerido = ? WHERE id = ?').run(sugerido(db, it.fuenteId), x.id)
  if (voto === 1 && !it.piezaId) {
    if (it.plataforma === 'youtube') void import('./youtube.ts').then((y) => y.encolarYoutube(db, it.url, { nota: 'del feed' })).catch(() => {})
    if (it.plataforma === 'reddit') {
      const { asegurarFuente } = await import('./corpus.ts')
      const { ingerir } = await import('./mastropiero.ts')
      asegurarFuente(db, { id: 'reddit', nombre: 'Reddit', nivel: 'primaria', descripcion: 'Hilos de Reddit que le importaron en su feed.' })
      const p = ingerir(db, { fuente: 'reddit', titulo: it.titulo, contenido: [it.titulo, it.texto].filter(Boolean).join('\n\n'), url: it.url, fecha: it.fecha ?? fechaLocal(ahora), origenId: `reddit:${it.url}`, por: 'feed' }, ahora).corpusId ?? null
      if (p) db.prepare('UPDATE feed_items SET pieza_id = ? WHERE id = ?').run(p, id)
    }
  }
  return deItem(db.prepare('SELECT * FROM feed_items WHERE id = ?').get(id))
}
