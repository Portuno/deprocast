/**
 * Sus gustos musicales desde YouTube Premium (Fragua #336; corrige la #325, que se había escrito sobre Spotify).
 * Primera etapa, dos caminos que se suman:
 * - El historial: YouTube no lo da por API. Sale de Google Takeout («YouTube y YouTube Music»): el historial de
 *   reproducciones (watch-history.json), la biblioteca de YouTube Music y las listas. Lo de YouTube Music (y los videos
 *   de canales «- Topic», que son temas) entra como escuchas, sin repetir, a la misma tabla que usa gusto_musical.
 * - La cuenta: con la conexión de Google (permiso de solo lectura de YouTube), sus listas con sus temas y los temas que
 *   marcó «me gusta», como piezas que se rehacen cada vez que se traen.
 * Correrlo en local, sin depender del servicio, es la segunda etapa.
 */
import type { Db } from './db.ts'
import { asegurarFuente, corregirPieza, insertar, piezaPorOrigen } from './corpus.ts'
import { MS_ESTIMADO, type Escucha } from './musica.ts'

/** «Watched X», «Has visto X», «Viste X»: el título del historial trae el verbo adelante. */
const VERBO = /^(Watched|Listened to|Has visto|Has escuchado|Viste|Escuchaste|Ha visto|Visto)\s+/i
const TOPIC = /\s+-\s+(Topic|Tema)$/i

/** Una fila del historial de Takeout, si es música: lo de YouTube Music, o un video de un canal «- Topic». */
export function escuchaDeYoutube(x: unknown): Escucha | null {
  if (!x || typeof x !== 'object') return null
  const r = x as { header?: unknown; title?: unknown; titleUrl?: unknown; subtitles?: { name?: unknown }[]; time?: unknown }
  const canal = typeof r.subtitles?.[0]?.name === 'string' ? r.subtitles[0].name.trim() : ''
  const esMusica = r.header === 'YouTube Music' || /music\.youtube\.com/.test(String(r.titleUrl ?? '')) || TOPIC.test(canal)
  if (!esMusica || !canal) return null
  const tema = String(r.title ?? '').replace(VERBO, '').trim()
  const cuando = String(r.time ?? '')
  if (!tema || /^https?:\/\//.test(tema) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(cuando)) return null
  return { en: `${cuando.slice(0, 10)} ${cuando.slice(11, 16)}`, artista: canal.replace(TOPIC, '').trim(), tema, album: null, ms: MS_ESTIMADO, fuente: 'youtube' }
}

export const esHistorialYoutube = (j: unknown): boolean =>
  Array.isArray(j) && j.slice(0, 50).some((x) => x && typeof x === 'object' && typeof (x as any).header === 'string' && /^YouTube( Music)?$/.test((x as any).header) && 'time' in (x as any))

/** El id de video de una url de YouTube («watch?v=…»). */
export const idDeVideo = (url: unknown): string | null => /[?&]v=([\w-]{6,})/.exec(String(url ?? ''))?.[1] ?? null

// ─── la cuenta (YouTube Data API, solo lectura) ───────────────────────────

export const ALCANCE_YOUTUBE = 'https://www.googleapis.com/auth/youtube.readonly'
const API = 'https://www.googleapis.com/youtube/v3'
const PAGINAS = 4 // de a 50: hasta 200 por lista, 200 «me gusta»

type Llamar = <T = any>(db: Db, url: string) => Promise<T>
let llamar: Llamar = async (db, url) => (await import('./google/oauth.ts')).llamarGoogle(db, url)
export function _probarYoutubeMusica(f: Llamar) { llamar = f }

async function paginas<T>(db: Db, url: string): Promise<T[]> {
  const out: T[] = []
  let token = ''
  for (let i = 0; i < PAGINAS; i++) {
    const j = await llamar<{ items?: T[]; nextPageToken?: string }>(db, `${url}${url.includes('?') ? '&' : '?'}maxResults=50${token ? `&pageToken=${token}` : ''}`)
    out.push(...(j.items ?? []))
    if (!j.nextPageToken) break
    token = j.nextPageToken
  }
  return out
}

const temaDe = (s: { title?: string; videoOwnerChannelTitle?: string; channelTitle?: string }) => {
  const canal = String(s.videoOwnerChannelTitle ?? s.channelTitle ?? '').replace(TOPIC, '').trim()
  return `${String(s.title ?? '').trim()}${canal ? ` — ${canal}` : ''}`
}

/** Una pieza que se rehace: si cambió, se corrige con versión; si él la retiró, queda retirada. */
function ponerPieza(db: Db, p: { origenId: string; titulo: string; contenido: string; tipo?: 'lista' | 'materia'; etiquetas: string[] }, ahora: number): 'nueva' | 'cambio' | 'igual' {
  const ya = piezaPorOrigen(db, p.origenId)
  if (!ya) { insertar(db, { fuente: 'youtube-musica', nivel: 'propia', tipo: p.tipo ?? 'lista', estado: 'disponible', titulo: p.titulo, contenido: p.contenido, fecha: null, origenId: p.origenId, etiquetas: p.etiquetas }, ahora); return 'nueva' }
  if (ya.estado === 'retirada' || ya.contenido.trim() === p.contenido.trim()) return 'igual'
  corregirPieza(db, ya.id, p.contenido, 'La traje de nuevo de YouTube', 'youtube', ahora)
  return 'cambio'
}

export function asegurarFuenteYoutubeMusica(db: Db) {
  asegurarFuente(db, { id: 'youtube-musica', nombre: 'YouTube Music', nivel: 'propia', descripcion: 'Lo que escuchás en YouTube Premium: historial, listas, biblioteca y «me gusta».' })
}

/**
 * Trae de su cuenta sus listas (con sus temas) y los temas que marcó «me gusta». Sin el permiso de YouTube, no rompe:
 * dice que hay que volver a conectar Google.
 */
export async function traerDeLaCuenta(db: Db, ahora = Date.now()): Promise<{ listas: number; temas: number; meGusta: number; nuevas: number; cambiadas: number } | { sin_permiso: true; aviso: string }> {
  const { permisosQueFaltan, googleConectado } = await import('./google/oauth.ts')
  const sinPermiso = { sin_permiso: true as const, aviso: 'Para leer tu YouTube hace falta volver a conectar Google (en Ajustes → Google) y aceptar el permiso de solo lectura de YouTube. El historial completo no sale por ahí: pedilo en Google Takeout («YouTube y YouTube Music») y subí el .zip en Cargas.' }
  if (!googleConectado(db) || permisosQueFaltan(db).includes(ALCANCE_YOUTUBE)) return sinPermiso
  asegurarFuenteYoutubeMusica(db)
  let listas: any[]
  try { listas = await paginas<any>(db, `${API}/playlists?part=snippet,contentDetails&mine=true`) } catch (e) {
    if ((e as { status?: number }).status === 403) return sinPermiso
    throw e
  }
  const r = { listas: 0, temas: 0, meGusta: 0, nuevas: 0, cambiadas: 0 }
  const contar = (x: 'nueva' | 'cambio' | 'igual') => { if (x === 'nueva') r.nuevas++; else if (x === 'cambio') r.cambiadas++ }
  for (const l of listas) {
    const items = await paginas<any>(db, `${API}/playlistItems?part=snippet&playlistId=${encodeURIComponent(l.id)}`)
    const temas = items.map((i) => i.snippet).filter((s) => s?.title && !/^(Deleted|Private) video$/i.test(s.title)).map(temaDe)
    if (!temas.length) continue
    r.listas++; r.temas += temas.length
    const nombre = String(l.snippet?.title ?? 'Lista sin nombre')
    contar(ponerPieza(db, { origenId: `youtube-musica:lista:${l.id}`, titulo: `Lista de YouTube · ${nombre}`, contenido: [`# ${nombre}`, `_${temas.length} temas._`, '', ...temas.map((t, i) => `${i + 1}. ${t}`)].join('\n'), etiquetas: ['youtube', 'música', 'lista'] }, ahora))
  }
  // Los «me gusta» que son música (categoría 10 de YouTube).
  const gustan = (await paginas<any>(db, `${API}/videos?part=snippet&myRating=like`).catch(() => [])).filter((v) => v?.snippet?.categoryId === '10').map((v) => temaDe(v.snippet))
  if (gustan.length) {
    r.meGusta = gustan.length
    contar(ponerPieza(db, { origenId: 'youtube-musica:me-gusta', titulo: 'Me gusta de YouTube (música)', contenido: ['# Me gusta de YouTube (música)', `_${gustan.length} temas que marcaste «me gusta»._`, '', ...gustan.map((t) => `- ${t}`)].join('\n'), etiquetas: ['youtube', 'música', 'gusto'] }, ahora))
  }
  return r
}
