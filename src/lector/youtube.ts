/**
 * YouTube con lo que dice el video, no solo el título: la transcripción (subtítulos manuales o automáticos, con una
 * marca [mm:ss] cada ~45 s para poder citar el minuto) y la descripción entera (donde suele estar el índice de
 * capítulos). Sin modelos ni navegador: la página del video trae ytInitialPlayerResponse con sus pistas de subtítulos,
 * y cada pista se baja en json3.
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

/** Lee un video: título, canal, descripción y transcripción (o el motivo por el que no hay). Nunca tira. */
export async function leerVideo(url: string, pedir: Pedir): Promise<VideoYoutube | null> {
  const id = idDeVideo(url)
  if (!id) return null
  let jugador: any
  try {
    // El consentimiento de la UE devuelve otra página sin el reproductor: la cookie lo da por aceptado.
    const r = await pedir(`https://www.youtube.com/watch?v=${id}&hl=es`, { headers: { cookie: 'CONSENT=YES+cb; SOCS=CAI' } })
    if (!r.ok) return { titulo: null, canal: null, descripcion: '', transcripcion: null, idioma: null, automatica: false, motivo: `YouTube respondió ${r.status}` }
    jugador = respuestaDelReproductor(await r.text())
  } catch (e) {
    return { titulo: null, canal: null, descripcion: '', transcripcion: null, idioma: null, automatica: false, motivo: `no pude abrir el video (${e instanceof Error ? e.message : e})` }
  }
  if (!jugador) return { titulo: null, canal: null, descripcion: '', transcripcion: null, idioma: null, automatica: false, motivo: 'YouTube no mostró el reproductor (¿bloqueo o consentimiento?)' }
  const d = jugador.videoDetails ?? {}
  const base = { titulo: d.title ?? null, canal: d.author ?? null, descripcion: String(d.shortDescription ?? '').trim() }
  const pista = elegirPista(jugador.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [])
  if (!pista?.baseUrl) return { ...base, transcripcion: null, idioma: null, automatica: false, motivo: 'el video no tiene subtítulos' }
  try {
    const r = await pedir(`${pista.baseUrl}&fmt=json3`)
    const texto = r.ok ? transcripcionDeJson3(await r.json()) : ''
    if (!texto) return { ...base, transcripcion: null, idioma: pista.languageCode ?? null, automatica: pista.kind === 'asr', motivo: 'los subtítulos vinieron vacíos' }
    return { ...base, transcripcion: texto, idioma: pista.languageCode ?? null, automatica: pista.kind === 'asr' }
  } catch (e) {
    return { ...base, transcripcion: null, idioma: null, automatica: false, motivo: `no pude bajar los subtítulos (${e instanceof Error ? e.message : e})` }
  }
}
