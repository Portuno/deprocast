/**
 * La compu como lectora de YouTube: la nube no puede leerlo (YouTube la marca como bot), la compu sí. Pregunta cada
 * minuto qué quedó esperando, lo lee desde acá (videos: título, descripción y transcripción; canales: la lista de
 * videos) y lo sube. Analizar, explorar lo que recomienda y armar los protoquántomos lo hace la nube.
 * Acá no se gasta un token.
 */
import { entrar } from './takeout/cliente.ts'
import { leerVideo, videosDelCanal } from './lector/youtube.ts'
import { pedirLector } from './lector/index.ts'

type Log = (t: string) => void

export async function lectorYoutube(url: string, clave: string, o: { unaVez?: boolean; log?: Log } = {}) {
  const log = o.log ?? (() => {})
  const base = url.replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) throw new Error('Decime la url de la nube: npm run mastro -- youtube https://…')
  let cookie = await entrar(base, clave)
  const pedir = async (ruta: string, cuerpo?: unknown) => {
    for (let intento = 1; ; intento++) {
      try {
        const r = await fetch(`${base}${ruta}`, {
          method: cuerpo === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json' },
          body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(120_000),
        })
        if (r.status === 401 || r.status === 303) { cookie = await entrar(base, clave); throw new Error('sesión vencida') }
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? `respondió ${r.status}`)
        return j
      } catch (e) {
        if (intento >= 3) throw e
        await new Promise((ok) => setTimeout(ok, 3000 * intento))
      }
    }
  }
  log(`Leyendo YouTube para ${base} (Ctrl+C para cortar).`)
  for (;;) {
    const { items } = await pedir('/api/youtube/compu').catch((e) => { log(`No pude preguntar: ${e instanceof Error ? e.message : e}`); return { items: [] } })
    for (const it of items as { id: string; tipo: string; url: string; max_videos: number | null }[]) {
      // Leer (acá) y subir (a la nube) fallan distinto: si no se pudo leer, la nube se entera; si no se pudo subir, se
      // reintenta en la próxima vuelta (no se manda un «no salió» que pise lo que quizás sí llegó).
      let cuerpo: Record<string, unknown>
      let linea: string
      try {
        if (it.tipo === 'canal') {
          const c = await videosDelCanal(it.id.replace(/^canal:/, ''), pedirLector, it.max_videos ?? 50)
          cuerpo = { id: it.id, titulo: c.titulo, videos: c.videos }
          linea = `📺 ${c.titulo ?? it.id}: ${c.videos.length} videos`
        } else {
          const v = await leerVideo(it.url, pedirLector)
          cuerpo = { id: it.id, video: v }
          linea = v?.transcripcion ? `▶ ${v.titulo ?? it.id}: ${v.transcripcion.split(/\s+/).length} palabras` : `▶ ${v?.titulo ?? it.id}: sin transcripción (${v?.motivo ?? '?'})`
        }
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e)
        log(`✗ ${it.id}: no se pudo leer (${motivo})`)
        await pedir('/api/youtube/leido', { id: it.id, error: motivo, video: { motivo } }).catch(() => {})
        continue
      }
      try {
        const r = await pedir('/api/youtube/leido', cuerpo)
        log(it.tipo === 'canal' ? `${linea} (${r.nuevos ?? 0} nuevos a la cola)` : linea)
      } catch (e) {
        log(`⟳ ${it.id}: leído, pero no se pudo subir (${e instanceof Error ? e.message : e}); va de nuevo en la próxima vuelta`)
      }
    }
    if (o.unaVez) return
    await new Promise((ok) => setTimeout(ok, items.length ? 2000 : 60_000))
  }
}
