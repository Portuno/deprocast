/**
 * YouTube con lo que dice el video, no solo el título: la transcripción (subtítulos manuales o automáticos, con una
 * marca [mm:ss] cada ~45 s para poder citar el minuto) y la descripción entera (donde suele estar el índice de
 * capítulos). Sin modelos ni navegador:
 * - La página del video trae la descripción, la clave pública del reproductor y el visitante.
 * - Los subtítulos se piden como el cliente de Android (youtubei/v1/player): la pista que da la página web ya no se
 *   entrega sin un token de origen (responde 200 vacío), la de Android sí (XML con el tiempo de cada frase).
 * - Si eso falla, se prueba la pista de la web en json3. Un bloqueo («confirmá que no sos un bot») se dice como tal,
 *   no como «no tiene subtítulos».
 */
import { leerJson } from '../modelo.ts'

type Pedir = (url: string, init?: RequestInit) => Promise<Response>
export type Pista = { baseUrl: string; languageCode?: string; kind?: string }
export type VideoYoutube = { titulo: string | null; canal: string | null; descripcion: string; transcripcion: string | null; idioma: string | null; automatica: boolean; motivo?: string }

/** El id del video de un link (watch?v=, youtu.be/, shorts/). */
export function idDeVideo(url: string): string | null {
  try {
    const u = new URL(url)
    if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1).split('/')[0] || null
    return u.searchParams.get('v') ?? /^\/shorts\/([\w-]+)/.exec(u.pathname)?.[1] ?? null
  } catch {
    return null
  }
}

/** El ytInitialPlayerResponse de la página (un objeto JSON dentro de un <script>). */
export function respuestaDelReproductor(html: string): any | null {
  const i = html.search(/ytInitialPlayerResponse\s*=\s*\{/)
  if (i < 0) return null
  return leerJson<any>(html.slice(html.indexOf('{', i)))
}

/** La mejor pista: español hecho a mano, español automático, otra hecha a mano, otra automática. */
export function elegirPista(pistas: Pista[]): Pista | null {
  const es = (p: Pista) => /^es/i.test(p.languageCode ?? '')
  const auto = (p: Pista) => p.kind === 'asr'
  return pistas.find((p) => es(p) && !auto(p)) ?? pistas.find((p) => es(p) && auto(p)) ?? pistas.find((p) => !auto(p)) ?? pistas[0] ?? null
}

const reloj = (ms: number) => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`
}

/** Los subtítulos (json3) en párrafos, cada uno con su minuto: [m:ss] texto… */
export function transcripcionDeJson3(j: any, cada = 45_000): string {
  const parrafos: string[] = []
  let actual = ''
  let desde = -Infinity
  for (const ev of Array.isArray(j?.events) ? j.events : []) {
    const texto = (Array.isArray(ev?.segs) ? ev.segs.map((s: any) => s?.utf8 ?? '').join('') : '').replace(/\s+/g, ' ').trim()
    if (!texto) continue
    const t = Number(ev.tStartMs) || 0
    if (t - desde >= cada) {
      if (actual) parrafos.push(actual)
      actual = `[${reloj(t)}] ${texto}`
      desde = t
    } else actual += ` ${texto}`
  }
  if (actual) parrafos.push(actual)
  return parrafos.join('\n\n')
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }
const desentidad = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e] ?? m))

/** Los subtítulos en XML (<text start="1.2" dur="3">…</text>) al mismo formato que el json3: párrafos con su minuto. */
export function transcripcionDeXml(xml: string, cada = 45_000): string {
  const events = [...xml.matchAll(/<(?:text|p)\b([^>]*)>([\s\S]*?)<\/(?:text|p)>/g)].map((m) => {
    const start = /\bstart="([\d.]+)"/.exec(m[1])?.[1]
    const t = /\bt="(\d+)"/.exec(m[1])?.[1]
    const ms = start != null ? Math.round(Number(start) * 1000) : Number(t ?? 0)
    // Dos pasadas: el XML trae el texto con entidades y a veces con entidades dentro de entidades (&amp;#39;).
    return { tStartMs: ms, segs: [{ utf8: desentidad(desentidad(m[2].replace(/<[^>]+>/g, ''))) }] }
  })
  return transcripcionDeJson3({ events }, cada)
}

/** La clave pública del reproductor web (va en cada página de YouTube; si la página no llega, se usa esta). */
const CLAVE_WEB = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const ANDROID = '20.10.38'

type Jugador = { videoDetails?: any; captions?: any; playabilityStatus?: { status?: string; reason?: string } }
const pistasDe = (j: Jugador | null): Pista[] => j?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
const bloqueado = (j: Jugador | null) => !!j?.playabilityStatus?.status && j.playabilityStatus.status !== 'OK'

/** Lee un video: título, canal, descripción y transcripción (o el motivo por el que no hay). Nunca tira. */
export async function leerVideo(url: string, pedir: Pedir): Promise<VideoYoutube | null> {
  const id = idDeVideo(url)
  if (!id) return null
  // 1. La página: descripción, clave y visitante (el consentimiento de la UE se da por aceptado con la cookie).
  let web: Jugador | null = null
  let clave = CLAVE_WEB
  let visitante: string | null = null
  let motivoPagina = ''
  try {
    const r = await pedir(`https://www.youtube.com/watch?v=${id}&hl=es`, { headers: { cookie: 'CONSENT=YES+cb; SOCS=CAI' } })
    if (r.ok) {
      const html = await r.text()
      web = respuestaDelReproductor(html)
      clave = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1] ?? clave
      visitante = /"VISITOR_DATA":"([^"]+)"/.exec(html)?.[1] ?? null
    } else motivoPagina = `YouTube respondió ${r.status}`
  } catch (e) {
    motivoPagina = `no pude abrir el video (${e instanceof Error ? e.message : e})`
  }
  // 2. El reproductor como Android: trae las pistas que sí se pueden bajar.
  let android: Jugador | null = null
  try {
    const r = await pedir(`https://www.youtube.com/youtubei/v1/player?key=${clave}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': `com.google.android.youtube/${ANDROID} (Linux; U; Android 14) gzip`, ...(visitante ? { 'x-goog-visitor-id': visitante } : {}) },
      body: JSON.stringify({ videoId: id, context: { client: { clientName: 'ANDROID', clientVersion: ANDROID, androidSdkVersion: 34, hl: 'es', gl: 'ES', ...(visitante ? { visitorData: visitante } : {}) } } }),
    })
    if (r.ok) android = await r.json()
  } catch { /* queda la pista de la web */ }

  const d = (web?.videoDetails?.shortDescription ? web.videoDetails : android?.videoDetails) ?? web?.videoDetails ?? {}
  const base = { titulo: d.title ?? null, canal: d.author ?? null, descripcion: String(d.shortDescription ?? '').trim() }
  const sin = (motivo: string, extra: Partial<VideoYoutube> = {}): VideoYoutube => ({ ...base, transcripcion: null, idioma: null, automatica: false, motivo, ...extra })

  // 3. Las pistas, en orden: Android (XML) y después la de la web (json3, y si no, XML).
  const candidatas: { pista: Pista; formatos: string[] }[] = []
  const pa = elegirPista(pistasDe(android))
  if (pa?.baseUrl) candidatas.push({ pista: pa, formatos: [''] })
  const pw = elegirPista(pistasDe(web))
  if (pw?.baseUrl) candidatas.push({ pista: pw, formatos: ['json3', ''] })
  if (!candidatas.length) {
    if (bloqueado(web) && (!android || bloqueado(android))) return sin(`YouTube no dejó leer el video desde acá (${web?.playabilityStatus?.reason ?? android?.playabilityStatus?.reason ?? web?.playabilityStatus?.status})`)
    if (!web && !android) return sin(motivoPagina || 'YouTube no mostró el reproductor (¿bloqueo o consentimiento?)')
    return sin('el video no tiene subtítulos')
  }
  for (const { pista, formatos } of candidatas) {
    for (const fmt of formatos) {
      try {
        const u = pista.baseUrl.replace(/&fmt=[^&]*/, '') + (fmt ? `&fmt=${fmt}` : '')
        const r = await pedir(u, pista === pa ? { headers: { 'user-agent': `com.google.android.youtube/${ANDROID} (Linux; U; Android 14) gzip` } } : undefined)
        if (!r.ok) continue
        const cuerpo = await r.text()
        const texto = !cuerpo.trim() ? '' : fmt === 'json3' ? transcripcionDeJson3(JSON.parse(cuerpo)) : transcripcionDeXml(cuerpo)
        if (texto) return { ...base, transcripcion: texto, idioma: pista.languageCode ?? null, automatica: pista.kind === 'asr' }
      } catch { /* la siguiente */ }
    }
  }
  return sin('YouTube no entregó los subtítulos (los tiene, pero vinieron vacíos)')
}
