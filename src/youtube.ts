/**
 * YouTube como fuente: un video o un canal entero, desde el chat, Telegram, Hoy o Importaciones.
 *
 * La nube no puede leer YouTube (la marca como bot: «confirmá que no sos un bot»). Por eso cada video o canal entra a una
 * cola y lo lee, en este orden:
 * 1. la nube misma, por si esta vez pasa (es barato probar);
 * 2. el servicio de transcripciones (Supadata, con SUPADATA_API_KEY en .env), si está y no se agotó;
 * 3. la compu: `npm run mastro -- youtube <url de la nube>` lee desde casa lo que la nube dejó esperando.
 *
 * Lo que se lee entra como pieza (título, canal, fecha, descripción y transcripción con su minuto) y se destila en la nube
 * con NaN: qué plantea, si el título cumple, ideas (→ protoquántomos), personas y las fuentes que recomienda. Los links que
 * el video recomienda (en la descripción) se leen y se destilan también; los videos que recomienda se encolan (un nivel,
 * no en cadena).
 */
import { ajuste, fechaLocal, fijarAjuste, type Db } from './db.ts'
import { asegurarFuente, insertar, slug } from './corpus.ts'
import { abrirLote, encolarDestilado, trabajarTakeout } from './takeout/nube.ts'
import { clasificarYoutube, leerVideo, transcripcionDeJson3, urlDeCanal, type VideoYoutube } from './lector/youtube.ts'

export type ItemCola = { id: string; tipo: 'video' | 'canal'; url: string; estado: string; motivo: string | null; intentos: number; pieza_id: number | null; de: string | null; max_videos: number | null; creado_en: number; leido_en: number | null }
export type VideoLeido = Pick<VideoYoutube, 'titulo' | 'canal' | 'canalId' | 'fecha' | 'descripcion' | 'transcripcion' | 'idioma' | 'automatica' | 'motivo' | 'rastro'>

const FUENTE = { id: 'youtube', nombre: 'YouTube', nivel: 'primaria', descripcion: 'Videos de YouTube que mandaste (y los que recomiendan), con su transcripción.' }
export const MAX_POR_CANAL = 50
/** Cuántos links de la descripción se exploran por video (los videos recomendados, aparte). */
const MAX_LINKS = 8
const MAX_VIDEOS_RECOMENDADOS = 5
/** Lo que no es una fuente para investigar: redes, donaciones, tiendas, acortadores de afiliado. */
const NO_ES_FUENTE = /(patreon|paypal|ko-fi|buymeacoffee|instagram|facebook|fb\.com|tiktok|twitter|\/\/x\.com|discord|linktr\.ee|t\.me|spotify|apple\.com\/|podcasts\.|teespring|spring\.com|merch|amzn\.to|amazon\.|bit\.ly|geni\.us|onlyfans|twitch|threads\.net|linkedin\.com\/in)/i

export const urlDeVideo = (id: string) => `https://www.youtube.com/watch?v=${id}`
const origenDeVideo = (id: string) => `url:https://youtube.com/watch?v=${id}`
const fila = (db: Db, id: string) => db.prepare('SELECT * FROM youtube_cola WHERE id = ?').get(id) as ItemCola | undefined

// ─── inyectable para tests ──────────────────────────────────────────────

type Pedir = (url: string, init?: RequestInit) => Promise<Response>
let pedirWeb: Pedir = async (url, init) => (await import('./lector/index.ts')).pedirLector(url, init)
let pedirServicio: Pedir = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(60_000) })
let esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))
export function _probarYoutube(o: { web?: Pedir; servicio?: Pedir; esperar?: typeof esperar }) {
  if (o.web) pedirWeb = o.web
  if (o.servicio) pedirServicio = o.servicio
  if (o.esperar) esperar = o.esperar
}

// ─── encolar ────────────────────────────────────────────────────────────

/** El título y el canal por oEmbed (eso sí lo da a la nube), para que la pieza nazca con nombre. */
async function cascara(id: string): Promise<{ titulo: string | null; canal: string | null }> {
  try {
    const r = await pedirWeb(`https://www.youtube.com/oembed?url=${encodeURIComponent(urlDeVideo(id))}&format=json`)
    if (!r.ok) return { titulo: null, canal: null }
    const j = await r.json()
    return { titulo: j?.title ?? null, canal: j?.author_name ?? null }
  } catch {
    return { titulo: null, canal: null }
  }
}

/**
 * Un video o un canal a la cola. El video nace como pieza pendiente (con su título, si se puede), así el chat la puede
 * nombrar ya; el canal, como una pieza que después dice cuántos videos trajo. Pedirlo de nuevo reintenta lo que no salió.
 */
export async function encolarYoutube(db: Db, url: string, o: { de?: string | null; max?: number | null; nota?: string | null } = {}, ahora = Date.now()): Promise<{ tipo: 'video' | 'canal'; id: string; piezaId: number; nueva: boolean; estado: string } | null> {
  const c = clasificarYoutube(url)
  if (!c) return null
  asegurarFuente(db, FUENTE)
  const clave = c.tipo === 'canal' ? `canal:${c.id}` : c.id
  const ya = fila(db, clave)
  if (ya) {
    // Pedido de nuevo: lo que no salió vuelve a la cola (y un canal puede pedir más videos).
    if (ya.estado !== 'listo' || (c.tipo === 'canal' && (o.max ?? 0) > (ya.max_videos ?? 0))) {
      db.prepare(`UPDATE youtube_cola SET estado = 'pendiente', intentos = 0, motivo = NULL, max_videos = COALESCE(?, max_videos) WHERE id = ?`).run(o.max ?? null, clave)
    }
    return { tipo: c.tipo, id: c.id, piezaId: ya.pieza_id ?? 0, nueva: false, estado: fila(db, clave)!.estado }
  }
  let piezaId: number
  if (c.tipo === 'video') {
    const previa = db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(origenDeVideo(c.id)) as { id: number } | undefined
    if (previa) piezaId = previa.id
    else {
      const k = await cascara(c.id)
      piezaId = insertar(db, {
        fuente: FUENTE.id, nivel: 'primaria', estado: 'pendiente', titulo: k.titulo ?? `Video de YouTube ${c.id}`, url: urlDeVideo(c.id), autor: k.canal,
        contenido: [`# ${k.titulo ?? c.id}`, k.canal ? `Canal: ${k.canal}` : '', o.nota ? `> Nota: ${o.nota}` : '', '_(La transcripción está en camino.)_'].filter(Boolean).join('\n\n'),
        etiquetas: ['youtube', 'sin-transcripcion'], origenId: origenDeVideo(c.id), meta: { youtube: c.id, sinTranscripcion: true, nota: o.nota ?? null, de: o.de ?? null },
      }, ahora)!
    }
  } else {
    piezaId = insertar(db, {
      fuente: FUENTE.id, nivel: 'primaria', estado: 'pendiente', titulo: `Canal de YouTube · ${c.id}`, url: urlDeCanal(c.id),
      contenido: `# Canal de YouTube · ${c.id}\n\n_(Trayendo la lista de videos.)_`, etiquetas: ['youtube', 'canal'], origenId: `url:${urlDeCanal(c.id).replace('www.', '')}`, meta: { youtubeCanal: c.id },
    }, ahora) ?? (db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(`url:${urlDeCanal(c.id).replace('www.', '')}`) as { id: number }).id
  }
  db.prepare(`INSERT INTO youtube_cola (id, tipo, url, estado, pieza_id, de, max_videos, creado_en) VALUES (?, ?, ?, 'pendiente', ?, ?, ?, ?)`)
    .run(clave, c.tipo, c.tipo === 'video' ? urlDeVideo(c.id) : urlDeCanal(c.id), piezaId, o.de ?? null, c.tipo === 'canal' ? Math.max(1, Math.min(5000, o.max ?? MAX_POR_CANAL)) : null, ahora)
  return { tipo: c.tipo, id: c.id, piezaId, nueva: true, estado: 'pendiente' }
}

// ─── el servicio de transcripciones (Supadata) ──────────────────────────

const SUPADATA = 'https://api.supadata.ai/v1'
const claveServicio = () => process.env.SUPADATA_API_KEY?.trim() || null
/** Si se agotó el cupo (o la clave no anda), se deja descansar unas horas: mientras, lo lee la compu. */
const servicioDisponible = (db: Db, ahora = Date.now()) => !!claveServicio() && Number(ajuste(db, 'youtube_servicio_hasta') ?? 0) < ahora
function servicioAgotado(db: Db, motivo: string, ahora = Date.now()) {
  fijarAjuste(db, 'youtube_servicio_hasta', String(ahora + 6 * 3_600_000))
  fijarAjuste(db, 'youtube_servicio_motivo', motivo.slice(0, 200))
}

async function servicio(db: Db, ruta: string): Promise<{ status: number; j: any }> {
  const r = await pedirServicio(`${SUPADATA}${ruta}`, { headers: { 'x-api-key': claveServicio()! } })
  const j = await r.json().catch(() => null)
  if ([401, 402, 403, 429].includes(r.status)) servicioAgotado(db, `${r.status}: ${j?.message ?? j?.error ?? 'sin cupo'}`)
  return { status: r.status, j }
}

const deTrozos = (content: any) => (typeof content === 'string' ? content : transcripcionDeJson3({ events: (Array.isArray(content) ? content : []).map((c: any) => ({ tStartMs: Number(c?.offset) || 0, segs: [{ utf8: String(c?.text ?? '') }] })) }))

/** Un video por el servicio. null: el servicio no está o no anduvo (que lo lea la compu). */
async function videoPorServicio(db: Db, id: string): Promise<VideoLeido | null> {
  if (!servicioDisponible(db)) return null
  const meta = await servicio(db, `/youtube/video?id=${encodeURIComponent(id)}`)
  if (meta.status >= 400 && meta.status !== 404) return null
  const m = meta.j ?? {}
  const base = { titulo: m.title ?? null, canal: m.channel?.name ?? null, canalId: m.channel?.id ?? null, fecha: m.uploadDate ? String(m.uploadDate).slice(0, 10) : null, descripcion: String(m.description ?? '').trim(), idioma: null, automatica: false }
  let t = await servicio(db, `/transcript?url=${encodeURIComponent(urlDeVideo(id))}&lang=es&mode=native`)
  if (t.status === 202 && t.j?.jobId) {
    for (let i = 0; i < 30; i++) {
      await esperar(3000)
      const job = await servicio(db, `/transcript/${t.j.jobId}`)
      if (job.j?.status === 'completed') { t = { status: 200, j: job.j }; break }
      if (job.j?.status === 'failed') { t = { status: 206, j: job.j }; break }
    }
  }
  if (t.status === 200 && t.j?.content) {
    const texto = deTrozos(t.j.content)
    if (texto.trim()) return { ...base, transcripcion: texto, idioma: t.j.lang ?? null }
  }
  if (t.status === 206 || t.status === 200 || t.status === 404) return { ...base, transcripcion: null, motivo: 'el video no tiene subtítulos (según el servicio)' }
  return null
}

async function canalPorServicio(db: Db, id: string, max: number): Promise<string[] | null> {
  if (!servicioDisponible(db)) return null
  const r = await servicio(db, `/youtube/channel/videos?id=${encodeURIComponent(urlDeCanal(id))}&limit=${max}&type=video`)
  return r.status === 200 && Array.isArray(r.j?.videoIds) ? r.j.videoIds.slice(0, max) : null
}

// ─── completar ──────────────────────────────────────────────────────────

const fuenteDelCanal = (db: Db, canal: string | null) => {
  asegurarFuente(db, FUENTE)
  if (!canal) return FUENTE.id
  return asegurarFuente(db, { id: `youtube-${slug(canal).slice(0, 50) || 'canal'}`, nombre: `YouTube › ${canal}`.slice(0, 120), nivel: 'primaria', padreId: FUENTE.id, descripcion: `Los videos de «${canal}».` }).id
}

/** El lote de lo que se leyó hoy (cada día uno: así el Procesar muestra el avance de lo que llegó). */
const loteDeHoy = (ahora: number) => `youtube-${fechaLocal(ahora).replace(/-/g, '')}`

/**
 * Llegó un video leído (de la nube, del servicio o de la compu). Con transcripción: la pieza se completa, se destila y se
 * exploran los links que recomienda. Sin: queda pendiente con el motivo.
 */
export async function completarVideo(db: Db, id: string, v: VideoLeido, ahora = Date.now()): Promise<{ piezaId: number; listo: boolean }> {
  let item = fila(db, id)
  if (!item) { await encolarYoutube(db, urlDeVideo(id), {}, ahora); item = fila(db, id)! }
  const piezaId = item.pieza_id!
  const titulo = v.titulo || (db.prepare('SELECT titulo FROM corpus WHERE id = ?').get(piezaId) as any)?.titulo || id
  const md = [
    `# ${titulo}`, `Canal: ${v.canal ?? '?'}${v.fecha ? ` · publicado el ${v.fecha}` : ''}`,
    v.descripcion ? `## Descripción\n\n${v.descripcion}` : '',
    v.transcripcion ? `## Transcripción${v.automatica ? ' (subtítulos automáticos)' : ''}${v.idioma ? ` · ${v.idioma}` : ''}\n\n${v.transcripcion}` : '',
  ].filter(Boolean).join('\n\n')
  if (!v.transcripcion) {
    // Uno que ya está leído no se pisa con un «no salió» (un reintento tardío, un error al subir).
    if (item.estado === 'listo') return { piezaId, listo: true }
    const aviso = `Sin transcripción (${v.motivo ?? 'no se pudo leer'})`
    db.prepare(`UPDATE corpus SET titulo = ?, autor = COALESCE(?, autor), contenido = ?, meta = json_set(COALESCE(meta, '{}'), '$.aviso', ?) WHERE id = ?`).run(titulo.slice(0, 300), v.canal, `${md}\n\n_(${aviso}. Si me pasás el audio, lo transcribo.)_`, aviso, piezaId)
    db.prepare(`UPDATE youtube_cola SET estado = 'sin_subtitulos', motivo = ?, leido_en = ? WHERE id = ?`).run(v.motivo ?? null, ahora, id)
    return { piezaId, listo: false }
  }
  const lote = loteDeHoy(ahora)
  db.prepare(`UPDATE corpus SET titulo = ?, autor = ?, contenido = ?, fuente = ?, estado = 'disponible', fecha = COALESCE(?, fecha),
    meta = json_remove(json_set(COALESCE(meta, '{}'), '$.youtube', ?, '$.canal', ?, '$.canalId', ?, '$.publicado', ?, '$.idioma', ?, '$.palabras', ?, '$.takeout', ?), '$.sinTranscripcion', '$.aviso'),
    etiquetas = (SELECT json_group_array(value) FROM json_each(COALESCE(corpus.etiquetas, '[]')) WHERE value != 'sin-transcripcion') WHERE id = ?`)
    .run(titulo.slice(0, 300), v.canal ?? null, md, fuenteDelCanal(db, v.canal ?? null), v.fecha ?? null, id, v.canal ?? null, v.canalId ?? null, v.fecha ?? null, v.idioma ?? null, md.split(/\s+/).length, lote, piezaId)
  db.prepare('DELETE FROM pasajes WHERE pieza_id = ?').run(piezaId)
  db.prepare(`UPDATE youtube_cola SET estado = 'listo', motivo = NULL, leido_en = ? WHERE id = ?`).run(ahora, id)
  abrirLote(db, lote, ahora)
  encolarDestilado(db, lote, piezaId, 1)
  // Lo que recomienda se explora de fondo: leer 8 páginas puede llevar minutos y quien subió el video no tiene por qué esperar.
  void explorarRecomendados(db, item, titulo, v.descripcion, lote, ahora).catch((e) => console.error('  youtube recomendados:', e instanceof Error ? e.message : e))
  void trabajarTakeout(db).catch(() => {})
  return { piezaId, listo: true }
}

/** Los links de la descripción que valen como fuente: se leen y se destilan; los videos, a la cola (un nivel). */
export async function explorarRecomendados(db: Db, item: ItemCola, titulo: string, descripcion: string, lote: string, ahora = Date.now()) {
  const links = [...new Set((descripcion.match(/https?:\/\/[^\s<>)"'\]]+/g) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')))]
  const videos = links.filter((u) => clasificarYoutube(u)?.tipo === 'video')
  // Solo un nivel: lo que trajo un video recomendado no trae más.
  if (!item.de?.startsWith('video:')) {
    let nuevos = 0
    for (const u of videos.slice(0, MAX_VIDEOS_RECOMENDADOS)) if ((await encolarYoutube(db, u, { de: `video:${item.id}` }, ahora))?.nueva) nuevos++
    if (nuevos) void trabajarYoutube(db).catch(() => {})
  }
  const web = links.filter((u) => !clasificarYoutube(u) && !NO_ES_FUENTE.test(u)).slice(0, MAX_LINKS)
  if (!web.length) return
  const { guardarLink } = await import('./lector/index.ts')
  for (const u of web) {
    try {
      const g = await guardarLink(db, u, { nota: `Lo recomienda el video «${titulo}»`, ahora })
      db.prepare(`UPDATE corpus SET meta = json_set(COALESCE(meta, '{}'), '$.recomendadoPor', ?, '$.recomendadoPorVideo', ?) WHERE id = ?`).run(titulo.slice(0, 200), item.id, g.piezaId)
      if (g.nueva && (g.lectura?.palabras ?? 0) >= 150) encolarDestilado(db, lote, g.piezaId, 0)
    } catch { /* un link que no se deja leer no frena al resto */ }
  }
  abrirLote(db, lote, ahora)
  void trabajarTakeout(db).catch(() => {})
}

/** Llegó la lista de un canal: cada video a la cola, y la pieza del canal lo cuenta. */
export async function completarCanal(db: Db, id: string, d: { titulo?: string | null; videos: string[] }, ahora = Date.now()) {
  const item = fila(db, id)
  if (!item) throw new Error(`No conozco el canal ${id}`)
  const nombre = id.replace(/^canal:/, '')
  let nuevos = 0
  for (const v of d.videos.slice(0, item.max_videos ?? MAX_POR_CANAL)) if ((await encolarYoutube(db, urlDeVideo(v), { de: id }, ahora))?.nueva) nuevos++
  if (item.pieza_id) {
    db.prepare(`UPDATE corpus SET titulo = ?, contenido = ?, estado = 'disponible' WHERE id = ?`).run(`Canal de YouTube · ${d.titulo ?? nombre}`.slice(0, 300),
      `# Canal de YouTube · ${d.titulo ?? nombre}\n\n${urlDeCanal(nombre)}\n\nSe pidieron ${d.videos.length} videos (hasta ${item.max_videos ?? MAX_POR_CANAL}); ${nuevos} nuevos entraron a la cola.\n\n${d.videos.map((v) => `- ${urlDeVideo(v)}`).join('\n')}`, item.pieza_id)
  }
  db.prepare(`UPDATE youtube_cola SET estado = 'listo', motivo = NULL, leido_en = ? WHERE id = ?`).run(ahora, id)
  return { videos: d.videos.length, nuevos }
}

// ─── el obrero de la nube ───────────────────────────────────────────────

/** Las bases con el obrero andando (una sola en la nube; en los tests, varias). */
const trabajando = new WeakSet<Db>()
/**
 * Lee lo que hay en la cola: primero prueba directo (por si pasa), después el servicio; si nada anduvo, lo deja para la
 * compu (estado «compu»). Se puede llamar cuantas veces se quiera: si ya anda, no hace nada.
 */
export async function trabajarYoutube(db: Db): Promise<void> {
  if (trabajando.has(db)) return
  trabajando.add(db)
  try {
    for (;;) {
      const item = db.prepare(`SELECT * FROM youtube_cola WHERE estado = 'pendiente' ORDER BY tipo = 'canal' DESC, creado_en LIMIT 1`).get() as ItemCola | undefined
      if (!item) break
      db.prepare('UPDATE youtube_cola SET intentos = intentos + 1 WHERE id = ?').run(item.id)
      try {
        if (item.tipo === 'canal') {
          const nombre = item.id.replace(/^canal:/, '')
          const ids = await canalPorServicio(db, nombre, item.max_videos ?? MAX_POR_CANAL).catch(() => null)
          if (ids) await completarCanal(db, item.id, { videos: ids })
          else db.prepare(`UPDATE youtube_cola SET estado = 'compu', motivo = ? WHERE id = ?`).run('la nube no puede listar el canal: lo trae tu compu', item.id)
          continue
        }
        const directo = await leerVideo(item.url, pedirWeb).catch(() => null)
        if (directo?.transcripcion) { await completarVideo(db, item.id, directo); continue }
        const porServicio = await videoPorServicio(db, item.id).catch(() => null)
        if (porServicio) { await completarVideo(db, item.id, porServicio); continue }
        db.prepare(`UPDATE youtube_cola SET estado = 'compu', motivo = ? WHERE id = ?`).run(directo?.motivo ? `desde la nube: ${directo.motivo}` : 'esperando a tu compu', item.id)
      } catch (e) {
        db.prepare(`UPDATE youtube_cola SET estado = ?, motivo = ? WHERE id = ?`).run(item.intentos + 1 >= 3 ? 'fallo' : 'pendiente', (e instanceof Error ? e.message : String(e)).slice(0, 300), item.id)
      }
    }
  } finally {
    trabajando.delete(db)
  }
}

/** Lo que espera a la compu vuelve a probar con el servicio (por si se configuró o volvió el cupo). */
export function reintentarConServicio(db: Db) {
  if (!servicioDisponible(db)) return 0
  return db.prepare(`UPDATE youtube_cola SET estado = 'pendiente' WHERE estado = 'compu'`).run().changes
}

// ─── la compu ───────────────────────────────────────────────────────────

/** Lo que la compu tiene que leer (y se anota que la compu pasó, para que la pantalla lo diga). */
export function paraLaCompu(db: Db, limite = 20, ahora = Date.now()): ItemCola[] {
  fijarAjuste(db, 'youtube_compu_visto', String(ahora))
  return db.prepare(`SELECT * FROM youtube_cola WHERE estado = 'compu' ORDER BY tipo = 'canal' DESC, creado_en LIMIT ?`).all(limite) as ItemCola[]
}

/** Lo que mandó la compu: un video leído o la lista de un canal. */
export async function recibirDeLaCompu(db: Db, b: any, ahora = Date.now()) {
  const id = String(b?.id ?? '')
  const item = fila(db, id)
  if (!item) throw new Error(`No conozco ${id}`)
  if (item.tipo === 'canal') {
    if (b.error) { db.prepare(`UPDATE youtube_cola SET estado = 'fallo', motivo = ? WHERE id = ?`).run(String(b.error).slice(0, 300), id); return { ok: true } }
    return { ok: true, ...(await completarCanal(db, id, { titulo: b.titulo ?? null, videos: (Array.isArray(b.videos) ? b.videos : []).filter((v: unknown) => typeof v === 'string' && /^[\w-]{6,20}$/.test(v)) }, ahora)) }
  }
  const v = b.video ?? {}
  const r = await completarVideo(db, id, {
    titulo: v.titulo ?? null, canal: v.canal ?? null, canalId: v.canalId ?? null, fecha: v.fecha ?? null, descripcion: String(v.descripcion ?? ''),
    transcripcion: v.transcripcion ? String(v.transcripcion) : null, idioma: v.idioma ?? null, automatica: !!v.automatica, motivo: v.motivo ?? b.error ?? null,
  }, ahora)
  return { ok: true, ...r }
}

// ─── lo que ve la pantalla ──────────────────────────────────────────────

export function estadoYoutube(db: Db, ahora = Date.now()) {
  const cuenta = Object.fromEntries((db.prepare(`SELECT estado, COUNT(*) AS n FROM youtube_cola WHERE tipo = 'video' GROUP BY estado`).all() as { estado: string; n: number }[]).map((r) => [r.estado, r.n]))
  const ultimos = (db.prepare(`SELECT y.id, y.tipo, y.estado, y.motivo, y.pieza_id, y.de, c.titulo FROM youtube_cola y LEFT JOIN corpus c ON c.id = y.pieza_id ORDER BY y.creado_en DESC LIMIT 40`).all() as any[])
  const visto = Number(ajuste(db, 'youtube_compu_visto') ?? 0)
  return {
    cuenta: { pendiente: cuenta.pendiente ?? 0, compu: cuenta.compu ?? 0, listo: cuenta.listo ?? 0, sin_subtitulos: cuenta.sin_subtitulos ?? 0, fallo: cuenta.fallo ?? 0 },
    canales: (db.prepare(`SELECT COUNT(*) AS n FROM youtube_cola WHERE tipo = 'canal' AND estado != 'listo'`).get() as { n: number }).n,
    servicio: { configurado: !!claveServicio(), disponible: servicioDisponible(db, ahora), motivo: servicioDisponible(db, ahora) ? null : ajuste(db, 'youtube_servicio_motivo') },
    compu: { vista: visto || null, activa: visto > ahora - 5 * 60_000 },
    ultimos: ultimos.map((u) => ({ id: u.id, tipo: u.tipo, estado: u.estado, motivo: u.motivo, piezaId: u.pieza_id, titulo: u.titulo, recomendado: !!u.de?.startsWith('video:') })),
    trabajando: trabajando.has(db),
  }
}

/** Para importar varios de una: videos y canales, uno por línea (o separados por espacios). */
export async function importarYoutube(db: Db, texto: string, o: { max?: number | null } = {}) {
  const links = [...new Set(texto.match(/https?:\/\/[^\s<>)"']+/g) ?? [])]
  const r = { videos: 0, canales: 0, yaEstaban: 0, noSonDeYoutube: 0 }
  for (const u of links) {
    const x = await encolarYoutube(db, u, { max: o.max ?? null })
    if (!x) r.noSonDeYoutube++
    else if (!x.nueva) r.yaEstaban++
    else if (x.tipo === 'canal') r.canales++
    else r.videos++
  }
  void trabajarYoutube(db).catch(() => {})
  return r
}

/** La nota que acompaña a un video del chat: qué va a pasar con él. */
export function avisoDeCola(db: Db, tipo: 'video' | 'canal', estado: string): string {
  const s = estadoYoutube(db)
  const quien = s.servicio.disponible ? 'el servicio de transcripciones' : 'tu compu (npm run mastro -- youtube <url de la nube>)'
  if (tipo === 'canal') return `Canal en cola: traigo la lista de videos (con ${quien}) y cada uno entra con su transcripción y su análisis.`
  return estado === 'listo' ? '' : `La transcripción está en camino (la nube no puede leer YouTube; la trae ${quien}). Cuando llegue, se analiza sola: qué plantea, si el título cumple, ideas y las fuentes que recomienda.`
}

