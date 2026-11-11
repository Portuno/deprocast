/**
 * YouTube como fuente: un video o un canal entero, desde el chat, Telegram, Hoy o Importaciones.
 *
 * La nube no puede leer YouTube (la marca como bot: «confirmá que no sos un bot»). Por eso cada video o canal entra a una
 * cola y lo lee, en este orden:
 * 1. la nube misma, por si esta vez pasa (es barato probar);
 * 2. Gemini (GEMINI_API_KEY): Google lee el video de su lado (YouTube no lo bloquea), lo transcribe aunque no tenga
 *    subtítulos y anota lo que se ve en pantalla;
 * 3. el servicio de transcripciones (Supadata, con SUPADATA_API_KEY en .env), si está y no se agotó;
 * 4. la compu: `npm run mastro -- youtube <url de la nube>` lee desde casa lo que la nube dejó esperando (el último recurso).
 *
 * Lo que se lee entra como pieza (título, canal, fecha, descripción y transcripción con su minuto) y se destila en la nube
 * con NaN: qué plantea, si el título cumple, ideas (→ protoquántomos), personas y las fuentes que recomienda. Los links que
 * el video recomienda (en la descripción) se leen y se destilan también; los videos que recomienda se encolan (un nivel,
 * no en cadena).
 */
import { ajuste, fechaLocal, fijarAjuste, type Db } from './db.ts'
import { asegurarFuente, insertar, slug } from './corpus.ts'
import { abrirLote, encolarDestilado, trabajarTakeout } from './takeout/nube.ts'
import { clasificarYoutube, leerVideo, transcripcionDeJson3, urlDeCanal, videosDelCanal, type VideoYoutube } from './lector/youtube.ts'

export type ItemCola = { id: string; tipo: 'video' | 'canal'; url: string; estado: string; motivo: string | null; intentos: number; pieza_id: number | null; de: string | null; max_videos: number | null; creado_en: number; leido_en: number | null }
export type VideoLeido = Pick<VideoYoutube, 'titulo' | 'canal' | 'canalId' | 'fecha' | 'descripcion' | 'transcripcion' | 'idioma' | 'automatica' | 'motivo' | 'rastro'>

export const FUENTE = { id: 'youtube', nombre: 'YouTube', nivel: 'primaria', descripcion: 'Videos de YouTube que mandaste (y los que recomiendan), con su transcripción.' }
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
let pedirGemini: Pedir = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10 * 60_000) })
export function _probarYoutube(o: { web?: Pedir; servicio?: Pedir; gemini?: Pedir; esperar?: typeof esperar }) {
  if (o.web) pedirWeb = o.web
  if (o.servicio) pedirServicio = o.servicio
  if (o.gemini) pedirGemini = o.gemini
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
/** El dominio (el bloque del corpus): en minúsculas, corto. */
export const dominioDe = (d?: string | null) => (d ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40) || null

export async function encolarYoutube(db: Db, url: string, o: { de?: string | null; max?: number | null; nota?: string | null; dominio?: string | null } = {}, ahora = Date.now()): Promise<{ tipo: 'video' | 'canal'; id: string; piezaId: number; nueva: boolean; estado: string } | null> {
  const c = clasificarYoutube(url)
  if (!c) return null
  const dominio = dominioDe(o.dominio)
  asegurarFuente(db, FUENTE)
  const clave = c.tipo === 'canal' ? `canal:${c.id}` : c.id
  const ya = fila(db, clave)
  if (ya) {
    // Pedido de nuevo: lo que no salió vuelve a la cola (y un canal puede pedir más videos).
    if (ya.estado !== 'listo' || (c.tipo === 'canal' && (o.max ?? 0) > (ya.max_videos ?? 0))) {
      db.prepare(`UPDATE youtube_cola SET estado = 'pendiente', intentos = 0, motivo = NULL, max_videos = COALESCE(?, max_videos) WHERE id = ?`).run(o.max ?? null, clave)
    }
    if (dominio) { db.prepare('UPDATE youtube_cola SET dominio = ? WHERE id = ?').run(dominio, clave); if (ya.pieza_id) etiquetarDominio(db, ya.pieza_id, dominio) }
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
        etiquetas: ['youtube', 'sin-transcripcion', ...(dominio ? [dominio] : [])], origenId: origenDeVideo(c.id), meta: { youtube: c.id, sinTranscripcion: true, nota: o.nota ?? null, de: o.de ?? null, ...(dominio ? { dominio } : {}) },
      }, ahora)!
    }
  } else {
    piezaId = insertar(db, {
      fuente: FUENTE.id, nivel: 'primaria', estado: 'pendiente', titulo: `Canal de YouTube · ${c.id}`, url: urlDeCanal(c.id),
      contenido: `# Canal de YouTube · ${c.id}\n\n_(Trayendo la lista de videos.)_`, etiquetas: ['youtube', 'canal', ...(dominio ? [dominio] : [])], origenId: `url:${urlDeCanal(c.id).replace('www.', '')}`, meta: { youtubeCanal: c.id, ...(dominio ? { dominio } : {}) },
    }, ahora) ?? (db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(`url:${urlDeCanal(c.id).replace('www.', '')}`) as { id: number }).id
  }
  db.prepare(`INSERT INTO youtube_cola (id, tipo, url, estado, pieza_id, de, max_videos, creado_en, dominio) VALUES (?, ?, ?, 'pendiente', ?, ?, ?, ?, ?)`)
    .run(clave, c.tipo, c.tipo === 'video' ? urlDeVideo(c.id) : urlDeCanal(c.id), piezaId, o.de ?? null, c.tipo === 'canal' ? Math.max(1, Math.min(5000, o.max ?? MAX_POR_CANAL)) : null, ahora, dominio)
  if (dominio) etiquetarDominio(db, piezaId, dominio)
  return { tipo: c.tipo, id: c.id, piezaId, nueva: true, estado: 'pendiente' }
}

// ─── Gemini: Google lee el video de su lado ─────────────────────────────

const claveGemini = () => process.env.GEMINI_API_KEY?.trim() || null
export const geminiDisponible = (db: Db, ahora = Date.now()) => !!claveGemini() && Number(ajuste(db, 'youtube_gemini_hasta') ?? 0) < ahora
// En renglones y no en un JSON (Fragua #239): con un video largo la respuesta se cortaba, el JSON quedaba sin cerrar y se
// perdía todo. Así, lo que llegó sirve, y si se cortó se sigue desde el último minuto.
const PEDIDO_GEMINI = (desde: string | null) => `Transcribí este video de YouTube${desde ? ` DESDE EL MINUTO ${desde} hasta el final` : ' COMPLETO'}, fiel, en su idioma original, sin resumir ni traducir.
Formato, en texto plano (sin JSON, sin markdown):
${desde ? '' : `TITULO: el título del video
CANAL: el canal
IDIOMA: es|en|…
`}Después, un párrafo por renglón, de unos 30 a 60 segundos cada uno, empezando con su minuto entre corchetes: [mm:ss] lo que se dice. Si cambia quien habla, poné su nombre o su rol al principio del párrafo.
Al final, un renglón que diga solo «EN PANTALLA» y debajo, un renglón por texto importante que aparece en pantalla (títulos, gráficos, datos, nombres): [mm:ss] el texto.`

const aSegundos = (t: string) => t.split(':').map(Number).reduce((s, x) => s * 60 + (Number.isFinite(x) ? x : 0), 0)

/** Lee la respuesta en renglones: la cabecera, los párrafos con su minuto y lo que se ve en pantalla. */
export function leerRenglonesGemini(texto: string): { titulo: string | null; canal: string | null; idioma: string | null; parrafos: string[]; pantalla: string[]; ultimo: string | null } {
  let titulo: string | null = null, canal: string | null = null, idioma: string | null = null
  const parrafos: string[] = []
  const pantalla: string[] = []
  let enPantalla = false
  // Si igual contestó en JSON (entero, o cortado): se toman los párrafos completos que haya.
  const limpio = texto.replace(/^```\w*\s*|```\s*$/g, '').trim()
  if (limpio.startsWith('{')) {
    const campo = (k: string) => { const m = new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(limpio); return m ? JSON.parse(`"${m[1]}"`) as string : null }
    // Cada {"t": "...", "texto": "..."} completo: los de antes de "en_pantalla" son la transcripción; los de después, la pantalla.
    const objetos = (s: string) => [...s.matchAll(/\{\s*"t"\s*:\s*"([^"]*)"\s*,\s*"texto"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g)]
      .map((m) => ({ t: m[1].trim(), x: (JSON.parse(`"${m[2]}"`) as string).replace(/\s+/g, ' ').trim() })).filter((o) => o.x)
    const corte = limpio.indexOf('"en_pantalla"')
    for (const o of objetos(corte >= 0 ? limpio.slice(0, corte) : limpio)) parrafos.push(`[${o.t || '00:00'}] ${o.x}`)
    if (corte >= 0) for (const o of objetos(limpio.slice(corte))) pantalla.push(`[${o.t}] ${o.x}`)
    const ultimoJ = parrafos.length ? /^\[([^\]]+)\]/.exec(parrafos.at(-1)!)![1] : null
    return { titulo: campo('titulo'), canal: campo('canal'), idioma: campo('idioma')?.slice(0, 10) ?? null, parrafos, pantalla, ultimo: ultimoJ }
  }
  for (const crudo of texto.replace(/^```\w*\s*|```\s*$/g, '').split('\n')) {
    const l = crudo.trim()
    if (!l) continue
    const cab = /^(TITULO|TÍTULO|CANAL|IDIOMA)\s*:\s*(.+)$/i.exec(l)
    if (cab) { const k = cab[1].toUpperCase(); if (k.startsWith('T')) titulo = cab[2].trim(); else if (k === 'CANAL') canal = cab[2].trim(); else idioma = cab[2].trim().slice(0, 10); continue }
    if (/^[«"]?EN PANTALLA[»"]?:?$/i.test(l)) { enPantalla = true; continue }
    const m = /^\[(\d{1,2}(?::\d{2}){1,2})\]\s*(.+)$/.exec(l)
    if (!m) continue
    ;(enPantalla ? pantalla : parrafos).push(`[${m[1]}] ${m[2].replace(/\s+/g, ' ').trim()}`)
  }
  const ultimo = parrafos.length ? /^\[([^\]]+)\]/.exec(parrafos.at(-1)!)![1] : null
  return { titulo, canal, idioma, parrafos, pantalla, ultimo }
}

/**
 * El modelo de Gemini: el que él fijó (GEMINI_MODELO), el último que anduvo, o uno por defecto. Google retira modelos
 * («gemini-2.5-flash is no longer available to new users»: por eso se caía todo a la compu, Fragua #239): cuando el
 * modelo ya no está, se busca en la lista de Google el flash más nuevo que genere contenido, se guarda y se sigue.
 */
const MODELO_POR_DEFECTO = 'gemini-2.5-flash'
const modeloGemini = (db: Db) => process.env.GEMINI_MODELO?.trim() || ajuste(db, 'youtube_gemini_modelo') || MODELO_POR_DEFECTO
export const modeloRetirado = (status: number, mensaje: string) => (status === 404 && /\bmodels?\b/i.test(mensaje)) || /no longer available|not found for API version|is not supported for generateContent|deprecated/i.test(mensaje)

/** De la lista de modelos, el mejor flash: la versión más alta, estable antes que preview, y nunca lite/imagen/voz. */
export function elegirFlash(nombres: string[], sin: string[] = []): string | null {
  const candidatos = nombres.map((n) => n.replace(/^models\//, '')).filter((n) => !sin.includes(n))
    .filter((n) => /^gemini-(\d+(?:\.\d+)?)-flash(-preview(-[\w.-]+)?|-\d{3})?$/.test(n))
  const version = (n: string) => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(n)![1])
  candidatos.sort((a, b) => version(b) - version(a) || Number(/preview/.test(a)) - Number(/preview/.test(b)) || a.length - b.length)
  return candidatos[0] ?? (nombres.map((n) => n.replace(/^models\//, '')).includes('gemini-flash-latest') && !sin.includes('gemini-flash-latest') ? 'gemini-flash-latest' : null)
}

async function buscarModeloNuevo(db: Db, retirado: string, aviso = ''): Promise<string | null> {
  // Google suele decir cuál usar («Please update your code to use models/…»): si lo dice, ese.
  const sugerido = /use\s+(?:models\/)?(gemini-[\w.-]+?)[.,;\s]*$/i.exec(aviso.trim())?.[1] ?? /use\s+models\/(gemini-[\w.-]+)/i.exec(aviso)?.[1]
  if (sugerido && sugerido !== retirado) {
    fijarAjuste(db, 'youtube_gemini_modelo', sugerido)
    return sugerido
  }
  const r = await pedirGemini('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { method: 'GET', headers: { 'x-goog-api-key': claveGemini()! } }).catch(() => null)
  const j = r?.ok ? await r.json().catch(() => null) as any : null
  const nombres = (Array.isArray(j?.models) ? j.models : []).filter((m: any) => (m?.supportedGenerationMethods ?? []).includes('generateContent')).map((m: any) => String(m.name))
  const nuevo = elegirFlash(nombres, [retirado])
  if (nuevo) {
    fijarAjuste(db, 'youtube_gemini_modelo', nuevo)
    void import('./fallos.ts').then((f) => f.registrarFallo(db, { origen: 'youtube:gemini', mensaje: `El modelo ${retirado} ya no está: paso a ${nuevo}`, donde: retirado, recuperado: true })).catch(() => {})
  }
  return nuevo
}

/**
 * Un video por Gemini. Devuelve el video, o por qué no (para que la cola lo diga: antes se perdía y solo quedaba el
 * «Inicia sesión» de YouTube). Si la respuesta se cortó por largo, sigue desde el último minuto (hasta 6 tramos).
 */
async function videoPorGemini(db: Db, id: string): Promise<{ video: VideoLeido } | { motivo: string }> {
  if (!geminiDisponible(db)) return { motivo: claveGemini() ? `sin cupo por ahora (${ajuste(db, 'youtube_gemini_motivo') ?? 'descansa unas horas'})` : 'no está configurado' }
  let modelo = modeloGemini(db)
  let cambioDeModelo = false
  const parrafos: string[] = [], pantalla: string[] = []
  let cab: { titulo: string | null; canal: string | null; idioma: string | null } = { titulo: null, canal: null, idioma: null }
  let desde: string | null = null
  for (let tramo = 0; tramo < 6; tramo++) {
    const r = await pedirGemini(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': claveGemini()! },
      body: JSON.stringify({
        contents: [{ parts: [{ file_data: { file_uri: urlDeVideo(id) }, ...(desde ? { video_metadata: { start_offset: `${aSegundos(desde)}s` } } : {}) }, { text: PEDIDO_GEMINI(desde) }] }],
        // Resolución baja: alcanza para leer la pantalla y entra en el cupo gratis aun con videos largos.
        generationConfig: { temperature: 0.1, mediaResolution: 'MEDIA_RESOLUTION_LOW', maxOutputTokens: 65536 },
      }),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e instanceof Error ? e.message : String(e) } }) }) as unknown as Response)
    const j = await r.json().catch(() => null) as any
    if (!r.ok) {
      const motivo = `${r.status || 'sin respuesta'}: ${j?.error?.message ?? 'falló'}`.slice(0, 200)
      // El modelo ya no existe: se busca el nuevo una vez y se repite este tramo con él.
      if (!cambioDeModelo && modeloRetirado(r.status, motivo) && !process.env.GEMINI_MODELO?.trim()) {
        cambioDeModelo = true
        const nuevo = await buscarModeloNuevo(db, modelo, String(j?.error?.message ?? ''))
        if (nuevo) { modelo = nuevo; tramo--; continue }
      }
      // Sin cupo o clave mala: descansa unas horas (mientras, prueba el siguiente). Un video privado o raro: solo ese.
      // Un 403 «sin permiso» es de ese video (los «para niños», restringidos), no de la cuenta: no frena a los demás.
      const deEseVideo = r.status === 403 && /caller does not have permission|permission denied/i.test(motivo) && !/api key|billing|project/i.test(motivo)
      if (!deEseVideo && ([401, 403, 429].includes(r.status) || /quota|exhausted|rate/i.test(motivo))) { fijarAjuste(db, 'youtube_gemini_hasta', String(Date.now() + 3 * 3_600_000)); fijarAjuste(db, 'youtube_gemini_motivo', motivo) }
      if (deEseVideo) return { motivo: `Google no deja leer este video (suele ser uno «para niños» o restringido): ${motivo}` }
      if (parrafos.length) break // lo que ya llegó sirve
      return { motivo }
    }
    const c = j?.candidates?.[0]
    const texto = (c?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
    const x = leerRenglonesGemini(texto)
    if (!tramo) cab = { titulo: x.titulo, canal: x.canal, idioma: x.idioma }
    // Al seguir desde un minuto, Gemini a veces repite el último párrafo: no se duplica.
    for (const p of x.parrafos) if (p !== parrafos.at(-1)) parrafos.push(p)
    pantalla.push(...x.pantalla)
    const cortado = c?.finishReason === 'MAX_TOKENS'
    if (!cortado || !x.ultimo || x.ultimo === desde) break
    desde = x.ultimo
  }
  if (!parrafos.length) return { motivo: 'Gemini no devolvió transcripción (¿video sin habla, o que no puede ver?)' }
  return {
    video: {
      titulo: cab.titulo?.slice(0, 300) ?? null, canal: cab.canal?.slice(0, 200) ?? null, canalId: null, fecha: null, descripcion: '',
      transcripcion: `${parrafos.join('\n\n')}${pantalla.length ? `\n\n— Lo que se ve en pantalla —\n${pantalla.join('\n')}` : ''}`,
      idioma: cab.idioma, automatica: true, rastro: ['gemini'],
    } as VideoLeido,
  }
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
/** La pieza lleva el dominio como etiqueta (y en su meta): así el corpus se consulta por bloque. */
function etiquetarDominio(db: Db, piezaId: number, dominio: string) {
  db.prepare(`UPDATE corpus SET etiquetas = json_insert(COALESCE(etiquetas, '[]'), '$[#]', ?), meta = json_set(COALESCE(meta, '{}'), '$.dominio', ?)
    WHERE id = ? AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(corpus.etiquetas, '[]')) WHERE value = ?)`).run(dominio, dominio, piezaId, dominio)
}

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
  // Los videos heredan el dominio del canal.
  const dominio = (db.prepare('SELECT dominio FROM youtube_cola WHERE id = ?').get(id) as { dominio: string | null } | undefined)?.dominio ?? null
  for (const v of d.videos.slice(0, item.max_videos ?? MAX_POR_CANAL)) if ((await encolarYoutube(db, urlDeVideo(v), { de: id, dominio }, ahora))?.nueva) nuevos++
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
      // Lo que él manda a mano va primero; lo de un canal aprobado, a su ritmo (Fragua #187: que no sature).
      const k = await import('./youtube-canal.ts')
      const item = db.prepare(`SELECT * FROM youtube_cola WHERE estado = 'pendiente' AND (? OR de IS NULL OR de NOT LIKE 'canal:%')
        ORDER BY tipo = 'canal' DESC, de IS NULL DESC, creado_en LIMIT 1`).get(k.dentroDelRitmo(db) ? 1 : 0) as ItemCola | undefined
      if (!item) break
      db.prepare('UPDATE youtube_cola SET intentos = intentos + 1 WHERE id = ?').run(item.id)
      try {
        if (item.tipo === 'canal') {
          // Un canal entero (Fragua #187): primero el censo y el informe; nada entra al corpus hasta su ok.
          const r = await censarCanal(db, item)
          if (r.censo) { censoListo(db, item, r.censo); continue }
          db.prepare(`UPDATE youtube_cola SET estado = 'compu', motivo = ? WHERE id = ?`).run(`la nube no puede listar el canal${r.motivo ? ` (${r.motivo})` : ''}: lo trae tu compu`, item.id)
          continue
        }
        const directo = await leerVideo(item.url, pedirWeb).catch(() => null)
        if (directo?.transcripcion) { await completarVideo(db, item.id, directo); continue }
        // Privado o borrado: ni Gemini ni la compu lo pueden leer; no queda esperando (Fragua #239).
        if (directo?.motivo && /privad|private|no (est[aá] )?disponible|unavailable|eliminad|removed/i.test(directo.motivo)) {
          db.prepare(`UPDATE youtube_cola SET estado = 'fallo', motivo = ? WHERE id = ?`).run(`${directo.motivo}: nadie lo puede leer`, item.id)
          sinTexto(db, item, directo.motivo)
          continue
        }
        const g = await videoPorGemini(db, item.id).catch((e) => ({ motivo: e instanceof Error ? e.message : String(e) }))
        const porGemini = 'video' in g ? g.video : null
        // Lo que la nube sí pudo leer (título, canal, fecha, descripción) completa lo que trae Gemini.
        if (porGemini) {
          // El título manda el de YouTube (el que vino con el link); si el de Gemini no se le parece, queda la duda anotada.
          const deYoutube = directo?.titulo || tituloDeLaPieza(db, item)
          const otro = deYoutube && porGemini.titulo && !titulosParecidos(deYoutube, porGemini.titulo) ? porGemini.titulo : null
          const r = await completarVideo(db, item.id, { ...porGemini, titulo: deYoutube || porGemini.titulo, canal: directo?.canal || porGemini.canal, canalId: directo?.canalId ?? null, fecha: directo?.fecha ?? null,
            descripcion: [directo?.descripcion ?? '', otro ? `(Gemini lo tituló «${otro}»: revisá que la transcripción sea de este video.)` : ''].filter(Boolean).join('\n\n') })
          if (r.listo) void retomarPedido(db, item, r.piezaId).catch((e) => console.error('  youtube → retomar:', e instanceof Error ? e.message : e))
          continue
        }
        const porServicio = await videoPorServicio(db, item.id).catch(() => null)
        if (porServicio) { const r = await completarVideo(db, item.id, porServicio); if (r.listo && porServicio.transcripcion) void retomarPedido(db, item, r.piezaId).catch(() => {}); continue }
        // Ni directo, ni Gemini, ni el servicio: queda para la compu, con todos los motivos (antes solo se veía el de YouTube).
        const motivoGemini = 'motivo' in g ? g.motivo : null
        const motivo = [directo?.motivo ? `desde la nube: ${directo.motivo}` : 'la nube no pudo leerlo', motivoGemini ? `Gemini: ${motivoGemini}` : '', servicioDisponible(db) ? '' : 'el servicio de transcripciones no está configurado'].filter(Boolean).join(' · ')
        db.prepare(`UPDATE youtube_cola SET estado = 'compu', motivo = ? WHERE id = ?`).run(motivo.slice(0, 300), item.id)
        if (motivoGemini) void import('./fallos.ts').then((f) => f.registrarFallo(db, { origen: 'youtube:gemini', mensaje: motivoGemini, donde: item.id })).catch(() => {})
        // Al tercer intento (la cola reintenta sola cada 15 minutos), queda para la compu de verdad: la pieza lo dice y avisa.
        if (item.intentos + 1 >= INTENTOS_NUBE) sinTexto(db, item, motivo, true)
      } catch (e) {
        db.prepare(`UPDATE youtube_cola SET estado = ?, motivo = ? WHERE id = ?`).run(item.intentos + 1 >= 3 ? 'fallo' : 'pendiente', (e instanceof Error ? e.message : String(e)).slice(0, 300), item.id)
      } finally {
        if (item.de?.startsWith('canal:')) k.quizasTermino(db, item.de)
      }
    }
  } finally {
    trabajando.delete(db)
  }
}

let retomar = async (db: Db, texto: string): Promise<string> => {
  const c = await import('./chat/index.ts')
  const cid = c.conversacionHoy(db).id
  const desde = (db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM mensajes WHERE conversacion_id = ?').get(cid) as { n: number }).n
  await c.enviar(db, cid, texto, { via: 'encargo' })
  const dicho = (db.prepare(`SELECT texto FROM mensajes WHERE conversacion_id = ? AND id > ? AND rol = 'asistente' AND texto IS NOT NULL`).all(cid, desde) as { texto: string }[]).map((m) => m.texto).join('\n\n')
  if (dicho) c.difundir(dicho)
  return dicho
}
export function _probarRetomar(f: typeof retomar) { retomar = f }

/** Los títulos de una lista de ids (por oEmbed, que la nube sí ve), para un censo sin la API de datos. */
async function conTitulos(ids: string[]) {
  const out: import('./youtube-canal.ts').VideoCenso[] = []
  for (const [i, id] of ids.entries()) out.push({ id, titulo: i < 300 ? (await cascara(id)).titulo ?? id : id, fecha: null, segundos: null, vistas: null, subtitulos: null, descripcion: '' })
  return out
}

/** El censo de un canal de la cola: por la API de datos; si no, la lista de ids (servicio o pestaña de videos). */
async function censarCanal(db: Db, item: ItemCola): Promise<{ censo: import('./youtube-canal.ts').Censo | null; motivo: string | null }> {
  const k = await import('./youtube-canal.ts')
  const nombre = item.id.replace(/^canal:/, '')
  let motivo: string | null = null
  let censo = await k.censar(db, item.id).catch((e) => { motivo = e instanceof Error ? e.message : String(e); return null })
  if (!censo) {
    const ids = await canalPorServicio(db, nombre, item.max_videos ?? MAX_POR_CANAL).catch(() => null)
      ?? await videosDelCanal(nombre, pedirWeb, item.max_videos ?? MAX_POR_CANAL).then((c) => (c.videos.length ? c.videos : null)).catch(() => null)
    if (ids) censo = await k.censar(db, item.id, { videos: await conTitulos(ids), fuente: 'la lista de videos (sin duración ni vistas: la API de datos de YouTube daría más)' })
  }
  return { censo, motivo }
}

/**
 * El censo a pedido (Fragua #194): un canal que él nombra en el chat («@nombre» o su link) y que todavía no tiene censo
 * se encola y se censa en el momento. Queda esperando su ok, igual que el que llega por la cola.
 */
export async function censoAPedido(db: Db, canal: string): Promise<import('./youtube-canal.ts').Censo> {
  const limpio = canal.trim().replace(/^canal:/, '')
  const url = /^https?:\/\//i.test(limpio) ? limpio : `https://www.youtube.com/${limpio.startsWith('@') || /^(channel|c|user)\//.test(limpio) ? limpio : `@${limpio}`}`
  const x = await encolarYoutube(db, url, {})
  if (!x || x.tipo !== 'canal') throw new Error('Eso no es un canal de YouTube («@nombre» o el link del canal)')
  const item = fila(db, `canal:${x.id}`)!
  const r = await censarCanal(db, item)
  if (!r.censo) throw new Error(`No pude listar el canal${r.motivo ? `: ${r.motivo}` : ''}`)
  db.prepare(`UPDATE youtube_cola SET estado = 'censo', motivo = 'esperando tu ok', leido_en = ? WHERE id = ?`).run(Date.now(), item.id)
  return r.censo
}

/** El censo está: el canal espera su ok, y si lo mandó él, Mastropiero se lo presenta por donde le habla. */
function censoListo(db: Db, item: ItemCola, c: import('./youtube-canal.ts').Censo) {
  db.prepare(`UPDATE youtube_cola SET estado = 'censo', motivo = 'esperando tu ok', leido_en = ? WHERE id = ?`).run(Date.now(), item.id)
  if (item.de) return
  const plan = c.grupos.map((g) => `${g.nombre} (${g.ids.length} videos, ${g.horas} h): ${c.plan[g.clave]}`).join('; ')
  void retomar(db, `(Aviso del sistema, no lo escribió él: está listo el censo del canal «${c.titulo}»${item.pieza_id ? ` [#${item.pieza_id}]` : ''}: ${c.videos.length} videos, ${Math.round(c.horas * 10) / 10} horas, ${c.refritos.length} refritos. ${c.informe.resumen} ${c.informe.conviene} Plan: ${plan}. Costo del plan: ${c.costo.videosEntero} videos enteros, ${c.costo.horasEntero} h, ~${Math.round(c.costo.geminiTokens / 1000)} mil tokens de Gemini y ~${Math.round(c.costo.destiladoTokens / 1000)} mil de destilado. Presentáselo corto y pedile el ok o los cambios; con su ok, usá aprobar_censo_canal con canal="${item.id}" (y los cambios que pida). No lo apruebes vos.)`).catch((e) => console.error('  youtube → censo:', e instanceof Error ? e.message : e))
}

/**
 * Un video que él mandó (no uno de un canal ni uno recomendado) y llegó tarde: Mastropiero retoma lo que le había
 * pedido sobre él, ahora con la transcripción, y se lo manda por donde le habla. Respeta lo que pidió (si quería el
 * reporte antes de tocar nada, solo propone).
 */
async function retomarPedido(db: Db, item: ItemCola, piezaId: number, ahora = Date.now()) {
  if (item.de || ahora - item.creado_en > 3 * 86_400_000) return
  const titulo = (db.prepare('SELECT titulo FROM corpus WHERE id = ?').get(piezaId) as { titulo: string } | undefined)?.titulo ?? item.url
  await retomar(db, `(Aviso del sistema, no lo escribió él: ya llegó la transcripción del video «${titulo}» [#${piezaId}]. Si en esta charla te había pedido algo sobre ese video, hacelo ahora con la transcripción completa (leela con leer_pieza) y respetá cómo lo pidió: si quería ver el reporte antes de que toques el corpus, solo proponé. Si no te había pedido nada, contale en dos o tres líneas de qué va.)`)
}

/**
 * Lo que espera a la compu vuelve a probar con el servicio o Gemini (por si se configuró o volvió el cupo), hasta
 * INTENTOS_NUBE veces: antes reintentaba cada 15 minutos para siempre, gastando cupo en los mismos videos (Fragua #239).
 * Pedirlo de nuevo (o «reintentar» en la pantalla) vuelve a empezar la cuenta.
 */
export const INTENTOS_NUBE = 3
export function reintentarConServicio(db: Db) {
  if (!servicioDisponible(db) && !geminiDisponible(db)) return 0
  return db.prepare(`UPDATE youtube_cola SET estado = 'pendiente' WHERE estado = 'compu' AND intentos < ?`).run(INTENTOS_NUBE).changes
}

/** El título que ya tenía la pieza (el de YouTube, por oEmbed), si no es el de relleno. */
function tituloDeLaPieza(db: Db, item: ItemCola): string | null {
  const t = item.pieza_id ? (db.prepare('SELECT titulo FROM corpus WHERE id = ?').get(item.pieza_id) as { titulo: string } | undefined)?.titulo : null
  return t && !/^Video de YouTube /.test(t) ? t : null
}
/** ¿Hablan de lo mismo? Comparten al menos un tercio de las palabras con contenido. */
export function titulosParecidos(a: string, b: string): boolean {
  const ws = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4))
  const x = ws(a), y = ws(b)
  if (!x.size || !y.size) return true
  let comun = 0
  for (const w of x) if (y.has(w)) comun++
  return comun / Math.min(x.size, y.size) >= 1 / 3
}

/**
 * La pieza no queda «en camino» con texto vacío (Fragua #239): dice por qué no tiene transcripción y qué hacer. Si quedó
 * definitivamente para la compu, avisa una vez por los canales.
 */
function sinTexto(db: Db, item: ItemCola, motivo: string, avisar = false) {
  if (!item.pieza_id) return
  const p = db.prepare('SELECT titulo, contenido FROM corpus WHERE id = ?').get(item.pieza_id) as { titulo: string; contenido: string } | undefined
  if (!p) return
  const nota = `_(Sin transcripción todavía: ${motivo}.${avisar ? ' La puede leer tu compu: `npm run mastro -- youtube`.' : ''})_`
  const contenido = /_\((La transcripción está en camino|Sin transcripción todavía)[^\n]*\)_/.test(p.contenido) ? p.contenido.replace(/_\((La transcripción está en camino|Sin transcripción todavía)[^\n]*\)_/, nota) : `${p.contenido}\n\n${nota}`
  db.prepare('UPDATE corpus SET contenido = ? WHERE id = ?').run(contenido, item.pieza_id)
  if (avisar) void import('./chat/index.ts').then((c) => c.mensajeDeMastropiero(db, c.conversacionHoy(db).id, `📺 No pude leer «${p.titulo}» en la nube (${motivo}). Quedó esperando a tu compu: \`npm run mastro -- youtube\`.`, { canales: true })).catch(() => {})
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
    const ids = (Array.isArray(b.videos) ? b.videos : []).filter((v: unknown) => typeof v === 'string' && /^[\w-]{6,20}$/.test(v)) as string[]
    const c = await (await import('./youtube-canal.ts')).censar(db, id, { videos: await conTitulos(ids), titulo: b.titulo ?? null, fuente: 'la lista que trajo tu compu' }, ahora)
    censoListo(db, item, c)
    return { ok: true, videos: ids.length, censo: true }
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
    // Cada canal: si todavía espera su lista (la nube no lista canales), cuántos videos trajo y cuántos ya se leyeron.
    listaCanales: (db.prepare(`SELECT y.id, y.estado, y.motivo, y.dominio, y.max_videos, y.pieza_id, c.titulo,
        (SELECT COUNT(*) FROM youtube_cola v WHERE v.de = y.id) AS videos,
        (SELECT COUNT(*) FROM youtube_cola v WHERE v.de = y.id AND v.estado = 'listo') AS leidos
      FROM youtube_cola y LEFT JOIN corpus c ON c.id = y.pieza_id WHERE y.tipo = 'canal' ORDER BY y.creado_en DESC LIMIT 30`).all() as any[])
      .map((x) => {
        const c = db.prepare('SELECT estado, datos FROM youtube_censos WHERE canal = ?').get(x.id) as { estado: string; datos: string } | undefined
        const d = c ? JSON.parse(c.datos) : null
        return { id: x.id, titulo: x.titulo, estado: x.estado, motivo: x.motivo, dominio: x.dominio, pedidos: x.max_videos, videos: x.videos, leidos: x.leidos, piezaId: x.pieza_id,
          censo: d ? { estado: c!.estado, videos: d.videos.length, horas: Math.round(d.horas * 10) / 10, enteros: d.costo.videosEntero, horasEntero: d.costo.horasEntero, tokens: d.costo.geminiTokens + d.costo.destiladoTokens, conviene: d.informe.conviene } : null }
      }),
    dominios: (db.prepare(`SELECT DISTINCT dominio FROM youtube_cola WHERE dominio IS NOT NULL ORDER BY dominio`).all() as { dominio: string }[]).map((x) => x.dominio),
    servicio: { configurado: !!claveServicio(), disponible: servicioDisponible(db, ahora), motivo: servicioDisponible(db, ahora) ? null : ajuste(db, 'youtube_servicio_motivo') },
    gemini: { configurado: !!claveGemini(), disponible: geminiDisponible(db, ahora), motivo: geminiDisponible(db, ahora) ? null : ajuste(db, 'youtube_gemini_motivo') },
    compu: { vista: visto || null, activa: visto > ahora - 5 * 60_000 },
    ultimos: ultimos.map((u) => ({ id: u.id, tipo: u.tipo, estado: u.estado, motivo: u.motivo, piezaId: u.pieza_id, titulo: u.titulo, recomendado: !!u.de?.startsWith('video:') })),
    trabajando: trabajando.has(db),
  }
}

/** Para importar varios de una: videos y canales, uno por línea (o separados por espacios). */
export async function importarYoutube(db: Db, texto: string, o: { max?: number | null; dominio?: string | null } = {}) {
  const links = [...new Set(texto.match(/https?:\/\/[^\s<>)"']+/g) ?? [])]
  const r = { videos: 0, canales: 0, yaEstaban: 0, noSonDeYoutube: 0 }
  for (const u of links) {
    const x = await encolarYoutube(db, u, { max: o.max ?? null, dominio: o.dominio ?? null })
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
  if (tipo === 'canal') return `Canal en cola. Primero armo el censo (todos sus videos con duración, vistas y subtítulos, agrupados, con horas y costo) y te lo traigo: nada entra al corpus hasta tu ok. Para la lista uso la API de datos de YouTube; si no está, (${s.servicio.disponible ? 'con el servicio de transcripciones' : 'necesito SUPADATA_API_KEY en NaN para listar canales desde la nube'}) y cada uno entra con su transcripción y su análisis.`
  if (estado === 'listo') return ''
  if (s.gemini.disponible || s.servicio.disponible) return `La transcripción está en camino (la lee ${s.gemini.disponible ? 'Gemini, del lado de Google' : 'el servicio de transcripciones'}, en el servidor). Cuando llegue, se analiza sola: qué plantea, si el título cumple, ideas y las fuentes que recomienda.`
  return `La transcripción no la puedo traer desde el servidor: YouTube bloquea a la nube y no hay ninguna vía configurada. Falta GEMINI_API_KEY en las variables de NaN (gratis, en aistudio.google.com). En cuanto esté, la leo y te aviso.`
}

