/**
 * Un canal de YouTube entero, en dos fases (Fragua #187).
 *
 * Fase 1 · el censo: todos sus videos con título, fecha, duración, vistas y si tienen subtítulos; agrupados por series
 * y formatos; los refritos marcados; cuántas horas son y cuánto costaría transcribirlo y destilarlo. El informe dice qué
 * hay en el canal y qué conviene hacer, y nada entra al corpus hasta su ok.
 * Fase 2 · la ingesta por tandas: con su ok, lo que va «entero» entra a la cola de YouTube (cada video, su pieza, su
 * transcripción y su destilado), con los que tienen subtítulos primero y a un ritmo que no tape lo que él manda a mano.
 * La cola ya es el checkpoint: si se corta, sigue desde donde quedó y lo leído no se vuelve a pagar. Lo que va «resumen»
 * queda en una pieza con título y descripción de cada video (barato y buscable).
 *
 * La lista sale de la API de datos de YouTube (YOUTUBE_API_KEY, o la clave de Gemini si en ese proyecto de Google está
 * habilitada la «YouTube Data API v3»): es de Google y no la bloquean como a la nube. Sin eso, la pestaña de videos del
 * canal o el servicio de transcripciones (solo los ids: el censo sale más pobre).
 */
import { ajuste, fijarAjuste, type Db } from './db.ts'

export type VideoCenso = { id: string; titulo: string; fecha: string | null; segundos: number | null; vistas: number | null; subtitulos: boolean | null; descripcion: string }
export type Grupo = { clave: string; nombre: string; tipo: 'serie' | 'formato'; ids: string[]; horas: number; vistas: number; conSubtitulos: number }
export type Decision = 'entero' | 'resumen' | 'nada'
export type Censo = {
  canal: string; titulo: string; fuente: string; videos: VideoCenso[]; grupos: Grupo[]; refritos: { id: string; de: string }[]
  horas: number; costo: { geminiTokens: number; destiladoTokens: number; horasEntero: number; videosEntero: number }
  plan: Record<string, Decision>; informe: { resumen: string; conviene: string }; estado: 'listo' | 'corriendo' | 'terminado'
}

// Los números para estimar (por hora de video). Gemini con resolución baja: ~100 tokens por segundo de video y audio;
// la transcripción, ~12.000 tokens por hora; el destilado lee la transcripción y escribe ~2.000.
const GEMINI_POR_HORA = 360_000 + 12_000
const DESTILADO_POR_HORA = 12_000 + 2_000
const UMBRAL_HORAS = 30 // arriba de esto, el plan recomienda entero solo lo mejor y el resto por título y descripción
const RITMO = 12 // videos por hora de un canal aprobado

type Pedir = (url: string, init?: RequestInit) => Promise<Response>
let pedir: Pedir = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
let escribir = async (db: Db, sistema: string, usuario: string) => (await (await import('./modelo.ts')).pedirJson<{ resumen?: string; conviene?: string; plan?: Record<string, string> }>({ db, clase: 'mastropiero', agenteId: 'youtube' }, sistema, usuario, { temperatura: 0.3, maxTokens: 2500 })).datos
export function _probarCanal(o: { pedir?: Pedir; escribir?: typeof escribir }) { if (o.pedir) pedir = o.pedir; if (o.escribir) escribir = o.escribir }

export const ritmoCanal = (db: Db) => Math.max(1, Number(ajuste(db, 'youtube_ritmo_canal')) || RITMO)
const claveDatos = () => process.env.YOUTUBE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || null

// ─── la lista ───────────────────────────────────────────────────────────

/** «PT1H2M3S» → segundos. */
export const segundosIso = (d: string | null | undefined) => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? '')
  return m ? (Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0)) : null
}

async function api(ruta: string, params: Record<string, string>) {
  const clave = claveDatos()
  if (!clave) throw new Error('Falta YOUTUBE_API_KEY')
  const r = await pedir(`https://www.googleapis.com/youtube/v3/${ruta}?${new URLSearchParams({ ...params, key: clave })}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const razon = j?.error?.errors?.[0]?.reason ?? j?.error?.status ?? r.status
    throw new Error(razon === 'accessNotConfigured' || razon === 'SERVICE_DISABLED' ? 'La clave no tiene habilitada la «YouTube Data API v3» (se habilita en un clic en console.cloud.google.com, en el mismo proyecto de la clave)' : `La API de YouTube respondió ${razon}`)
  }
  return j
}

/** Todos los videos del canal, con sus datos, por la API de datos de YouTube. */
export async function listarPorApi(canal: string, max = 5000): Promise<{ titulo: string; videos: VideoCenso[] }> {
  const limpio = canal.replace(/^canal:/, '').replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/\/(videos|featured)?$/, '')
  const q: Record<string, string> = /^channel\/(UC[\w-]+)$/.test(limpio) ? { id: limpio.slice(8) } : /^user\/(.+)$/.test(limpio) ? { forUsername: limpio.slice(5) } : { forHandle: limpio.replace(/^c\//, '@').replace(/^(?!@)/, '@') }
  const c = (await api('channels', { part: 'snippet,contentDetails', ...q })).items?.[0]
  if (!c) throw new Error('No encontré ese canal')
  const subidas = c.contentDetails?.relatedPlaylists?.uploads
  const ids: string[] = []
  let token = ''
  do {
    const p = await api('playlistItems', { part: 'contentDetails', playlistId: subidas, maxResults: '50', ...(token ? { pageToken: token } : {}) })
    for (const it of p.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId)
    token = p.nextPageToken ?? ''
  } while (token && ids.length < max)
  const videos: VideoCenso[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const v = await api('videos', { part: 'snippet,contentDetails,statistics', id: ids.slice(i, i + 50).join(',') })
    for (const x of v.items ?? []) videos.push({
      id: x.id, titulo: x.snippet?.title ?? x.id, fecha: x.snippet?.publishedAt?.slice(0, 10) ?? null, segundos: segundosIso(x.contentDetails?.duration),
      vistas: x.statistics?.viewCount != null ? Number(x.statistics.viewCount) : null, subtitulos: x.contentDetails?.caption == null ? null : x.contentDetails.caption === 'true',
      descripcion: String(x.snippet?.description ?? '').slice(0, 1500),
    })
  }
  return { titulo: c.snippet?.title ?? limpio, videos }
}

// ─── agrupar (sin modelo) ───────────────────────────────────────────────

const normal = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
/** La serie de un título: lo que va antes de « | », «: », « - » o de «#12», «Ep. 3», «Parte 2», «Capítulo 4». */
export function serieDe(titulo: string): string | null {
  const t = titulo.trim()
  const m = /^(.{3,60}?)\s*(?:\||:|–|—|\s-\s|#\d+|\b(?:ep(?:isodio)?|cap(?:itulo|ítulo)?|parte|part|vol)\.?\s*\d+)/i.exec(t)
  return m ? m[1].trim().replace(/[\s|:–—-]+$/, '') || null : null
}
const formatoDe = (s: number | null) => (s == null ? 'sin duración' : s <= 60 ? 'shorts' : s <= 600 ? 'cortos (hasta 10 min)' : s <= 2400 ? 'medios (10 a 40 min)' : 'largos (más de 40 min)')

function similares(a: string, b: string) {
  // «Clase 12» y «Clase 13» no son el mismo video aunque el resto del título sea igual.
  if ((a.match(/\d+/g) ?? []).join(',') !== (b.match(/\d+/g) ?? []).join(',')) return 0
  const x = new Set(a.split(' ')), y = new Set(b.split(' '))
  const comun = [...x].filter((w) => y.has(w)).length
  return comun / Math.max(1, new Set([...x, ...y]).size)
}

/** Series (3 o más videos con el mismo prefijo), el resto por formato, y los refritos (mismo título, duración parecida). */
export function agrupar(videos: VideoCenso[]): { grupos: Grupo[]; refritos: { id: string; de: string }[] } {
  // Refritos: el más viejo es el original.
  const refritos: { id: string; de: string }[] = []
  const vistos: { v: VideoCenso; n: string }[] = []
  for (const v of [...videos].sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''))) {
    const n = normal(v.titulo)
    const orig = n.length >= 12 ? vistos.find((o) => similares(o.n, n) >= 0.85 && (o.v.segundos == null || v.segundos == null || Math.abs(o.v.segundos - v.segundos) <= Math.max(30, o.v.segundos * 0.1))) : undefined
    if (orig) refritos.push({ id: v.id, de: orig.v.id })
    else vistos.push({ v, n })
  }
  const fuera = new Set(refritos.map((r) => r.id))
  const vivos = videos.filter((v) => !fuera.has(v.id))
  const porSerie = new Map<string, VideoCenso[]>()
  for (const v of vivos) { const s = serieDe(v.titulo); if (s) { const k = normal(s); if (k) porSerie.set(k, [...(porSerie.get(k) ?? []), v]) } }
  const grupos: Grupo[] = []
  const enSerie = new Set<string>()
  const armar = (clave: string, nombre: string, tipo: Grupo['tipo'], vs: VideoCenso[]): Grupo => ({
    clave, nombre, tipo, ids: vs.map((v) => v.id), horas: Math.round((vs.reduce((s, v) => s + (v.segundos ?? 0), 0) / 3600) * 10) / 10,
    vistas: vs.reduce((s, v) => s + (v.vistas ?? 0), 0), conSubtitulos: vs.filter((v) => v.subtitulos).length,
  })
  for (const [k, vs] of porSerie) if (vs.length >= 3) { grupos.push(armar(`serie:${k}`, serieDe(vs[0].titulo)!, 'serie', vs)); vs.forEach((v) => enSerie.add(v.id)) }
  const porFormato = new Map<string, VideoCenso[]>()
  for (const v of vivos) if (!enSerie.has(v.id)) porFormato.set(formatoDe(v.segundos), [...(porFormato.get(formatoDe(v.segundos)) ?? []), v])
  for (const [f, vs] of porFormato) grupos.push(armar(`formato:${f}`, `Sueltos · ${f}`, 'formato', vs))
  return { grupos: grupos.sort((a, b) => b.vistas - a.vistas), refritos }
}

/** El plan por defecto: chico, todo entero; grande, entero lo más visto hasta el umbral de horas y el resto por título. */
export function planPorDefecto(grupos: Grupo[], umbral = UMBRAL_HORAS): Record<string, Decision> {
  const plan: Record<string, Decision> = {}
  const total = grupos.reduce((s, g) => s + g.horas, 0)
  let horas = 0
  for (const g of grupos) {
    if (g.clave === 'formato:shorts') { plan[g.clave] = 'resumen'; continue }
    const entra = total <= umbral || horas + g.horas <= umbral
    plan[g.clave] = entra ? 'entero' : 'resumen'
    if (entra) horas += g.horas
  }
  return plan
}

function costoDe(c: Pick<Censo, 'videos' | 'grupos' | 'plan' | 'refritos'>) {
  const ids = new Set(c.grupos.filter((g) => c.plan[g.clave] === 'entero').flatMap((g) => g.ids))
  const horas = c.videos.filter((v) => ids.has(v.id)).reduce((s, v) => s + (v.segundos ?? 0), 0) / 3600
  return { geminiTokens: Math.round(horas * GEMINI_POR_HORA), destiladoTokens: Math.round(horas * DESTILADO_POR_HORA), horasEntero: Math.round(horas * 10) / 10, videosEntero: ids.size }
}

// ─── el censo ───────────────────────────────────────────────────────────

const fila = (db: Db, canal: string) => db.prepare('SELECT * FROM youtube_censos WHERE canal = ?').get(canal) as any
export function leerCenso(db: Db, canal: string): Censo | null {
  const r = fila(db, canal.startsWith('canal:') ? canal : `canal:${canal.replace(/^@?/, '@')}`) ?? fila(db, canal)
  return r ? { canal: r.canal, titulo: r.titulo, fuente: r.fuente, estado: r.estado, ...JSON.parse(r.datos) } : null
}

const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : `${Math.round(n / 1000)} mil`)
/** El informe en Markdown (va a la pieza del canal, así queda en el corpus aunque no se apruebe nada). */
export function informeMd(c: Censo): string {
  const horasTot = Math.round(c.horas * 10) / 10
  const sinDur = c.videos.filter((v) => v.segundos == null).length
  return [
    `# Censo del canal · ${c.titulo}`,
    `${c.videos.length} videos${horasTot ? ` · ${String(horasTot).replace('.', ',')} horas` : ''}${sinDur ? ` (${sinDur} sin duración conocida)` : ''} · ${c.videos.filter((v) => v.subtitulos).length} con subtítulos · lista de ${c.fuente}.`,
    c.informe.resumen ? `## Qué hay\n\n${c.informe.resumen}` : '',
    `## Qué conviene\n\n${c.informe.conviene}`,
    `## Plan\n\n${c.grupos.map((g) => `- **${g.nombre}** (${g.ids.length} videos, ${String(g.horas).replace('.', ',')} h${g.conSubtitulos ? `, ${g.conSubtitulos} con subtítulos` : ''}): ${c.plan[g.clave] === 'entero' ? 'entero' : c.plan[g.clave] === 'resumen' ? 'por título y descripción' : 'nada'}`).join('\n')}`,
    c.refritos.length ? `## Refritos (no se repiten)\n\n${c.refritos.slice(0, 30).map((r) => `- ${c.videos.find((v) => v.id === r.id)?.titulo ?? r.id} → repite ${c.videos.find((v) => v.id === r.de)?.titulo ?? r.de}`).join('\n')}${c.refritos.length > 30 ? `\n- y ${c.refritos.length - 30} más` : ''}` : '',
    `## Costo del plan\n\n${c.costo.videosEntero} videos enteros, ${String(c.costo.horasEntero).replace('.', ',')} h: unos ${tokens(c.costo.geminiTokens)} de tokens de Gemini para transcribir (los que la nube lea con subtítulos salen gratis) y ${tokens(c.costo.destiladoTokens)} para destilarlos. A ${RITMO} videos por hora, ${Math.max(1, Math.ceil(c.costo.videosEntero / RITMO))} h de cola.`,
  ].filter(Boolean).join('\n\n')
}

/** Arma el censo de un canal de la cola (sin tocar el corpus más que la pieza del canal, con el informe). */
export async function censar(db: Db, canal: string, o: { videos?: VideoCenso[]; titulo?: string | null; fuente?: string } = {}, ahora = Date.now()): Promise<Censo> {
  let lista: { titulo: string; videos: VideoCenso[] }
  let fuente = o.fuente ?? 'la API de datos de YouTube'
  if (o.videos) lista = { titulo: o.titulo ?? canal.replace(/^canal:/, ''), videos: o.videos }
  else lista = await listarPorApi(canal)
  if (!lista.videos.length) throw new Error('El canal no tiene videos (o no se pudieron listar)')
  const { grupos, refritos } = agrupar(lista.videos)
  const horas = lista.videos.reduce((s, v) => s + (v.segundos ?? 0), 0) / 3600
  let plan = planPorDefecto(grupos)
  let informe = { resumen: '', conviene: horas > UMBRAL_HORAS ? `Son ${Math.round(horas)} horas: lo caro no es transcribir sino destilar todo eso al corpus. Entero, lo más visto hasta ~${UMBRAL_HORAS} h; el resto, por título y descripción.` : 'Es chico: conviene entero.' }
  // El modelo escribe qué hay y qué conviene (y puede mover el plan); si falla, queda el plan por defecto.
  try {
    const muestra = grupos.slice(0, 25).map((g) => `${g.clave} | ${g.nombre} | ${g.ids.length} videos | ${g.horas} h | ${g.vistas} vistas | ej.: ${g.ids.slice(0, 3).map((id) => lista.videos.find((v) => v.id === id)?.titulo).join(' · ')}`).join('\n')
    const d = await escribir(db, `Sos Mastropiero y le presentás al operador el censo de un canal de YouTube antes de meterlo a su corpus. Contestá qué hay en el canal y qué conviene hacer. El costo real no es transcribir sino destilar cientos de horas: si el canal es grande, recomendá qué va entero y qué solo por título y descripción. Castellano argentino, tratándolo de usted, concreto, sin listas largas.
Forma: {"resumen": "2 a 4 frases: de qué trata, series y formatos, para quién sirve", "conviene": "2 o 3 frases con la recomendación y por qué", "plan": {"<clave del grupo>": "entero" | "resumen" | "nada"}}`,
      `Canal: ${lista.titulo}. ${lista.videos.length} videos, ${Math.round(horas * 10) / 10} horas, ${refritos.length} refritos.\nGrupos (clave | nombre | videos | horas | vistas | ejemplos):\n${muestra}\nPlan por defecto: ${JSON.stringify(plan)}`)
    if (d?.resumen) informe.resumen = String(d.resumen).trim()
    if (d?.conviene) informe.conviene = String(d.conviene).trim()
    for (const [k, v] of Object.entries(d?.plan ?? {})) if (k in plan && (v === 'entero' || v === 'resumen' || v === 'nada')) plan[k] = v
  } catch { /* sin modelo: el informe va con el plan por defecto */ }
  const c: Censo = { canal, titulo: lista.titulo, fuente, videos: lista.videos, grupos, refritos, horas, plan, informe, estado: 'listo', costo: { geminiTokens: 0, destiladoTokens: 0, horasEntero: 0, videosEntero: 0 } }
  c.costo = costoDe(c)
  guardar(db, c, ahora)
  return c
}

function guardar(db: Db, c: Censo, ahora = Date.now()) {
  const { canal, titulo, fuente, estado, ...resto } = c
  db.prepare(`INSERT INTO youtube_censos (canal, titulo, fuente, estado, datos, creado) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(canal) DO UPDATE SET titulo = excluded.titulo, fuente = excluded.fuente, estado = excluded.estado, datos = excluded.datos`).run(canal, titulo, fuente, estado, JSON.stringify(resto), ahora)
  const pieza = (db.prepare('SELECT pieza_id FROM youtube_cola WHERE id = ?').get(canal) as { pieza_id: number | null } | undefined)?.pieza_id
  if (pieza) db.prepare(`UPDATE corpus SET titulo = ?, contenido = ?, estado = 'disponible' WHERE id = ?`).run(`Canal de YouTube · ${titulo}`.slice(0, 300), informeMd(c), pieza)
}

/** Con su ok (y sus cambios al plan): lo entero a la cola, lo resumido a una pieza. Devuelve qué se hizo. */
export async function aprobarCenso(db: Db, canal: string, cambios: Record<string, string> = {}, ahora = Date.now()) {
  const c = leerCenso(db, canal)
  if (!c) throw new Error('Ese canal no tiene censo todavía')
  if (c.estado !== 'listo') throw new Error(c.estado === 'corriendo' ? 'Ya está corriendo' : 'Ese canal ya terminó')
  for (const [k, v] of Object.entries(cambios)) {
    const g = c.grupos.find((x) => x.clave === k || x.nombre.toLowerCase() === k.toLowerCase())
    if (!g) throw new Error(`No hay un grupo «${k}» (los grupos: ${c.grupos.map((x) => x.nombre).join(', ')})`)
    if (v !== 'entero' && v !== 'resumen' && v !== 'nada') throw new Error('Cada grupo va «entero», «resumen» o «nada»')
    c.plan[g.clave] = v
  }
  c.costo = costoDe(c)
  const y = await import('./youtube.ts')
  const dominio = (db.prepare('SELECT dominio FROM youtube_cola WHERE id = ?').get(c.canal) as { dominio: string | null } | undefined)?.dominio ?? null
  // Lo entero, a la cola: primero los que tienen subtítulos, después por vistas (el orden de llegada es el de lectura).
  const enteros = c.videos.filter((v) => c.grupos.some((g) => c.plan[g.clave] === 'entero' && g.ids.includes(v.id)))
    .sort((a, b) => Number(!!b.subtitulos) - Number(!!a.subtitulos) || (b.vistas ?? 0) - (a.vistas ?? 0))
  let nuevos = 0
  for (const [i, v] of enteros.entries()) if ((await y.encolarYoutube(db, y.urlDeVideo(v.id), { de: c.canal, dominio }, ahora + i))?.nueva) nuevos++
  // Lo resumido: una pieza (o varias, de a 200 videos) con título, fecha, duración y descripción.
  const resumidos = c.videos.filter((v) => c.grupos.some((g) => c.plan[g.clave] === 'resumen' && g.ids.includes(v.id)))
  const { asegurarFuente, insertar } = await import('./corpus.ts')
  asegurarFuente(db, y.FUENTE)
  for (let i = 0; i < resumidos.length; i += 200) {
    const parte = resumidos.slice(i, i + 200)
    insertar(db, {
      fuente: 'youtube', nivel: 'primaria', titulo: `${c.titulo} · por título y descripción${resumidos.length > 200 ? ` (${i / 200 + 1})` : ''}`, url: `https://www.youtube.com/${c.canal.replace(/^canal:/, '')}`,
      contenido: parte.map((v) => `## ${v.titulo}\n${[v.fecha, v.segundos ? `${Math.round(v.segundos / 60)} min` : null, v.vistas != null ? `${v.vistas.toLocaleString('es-AR')} vistas` : null, `https://www.youtube.com/watch?v=${v.id}`].filter(Boolean).join(' · ')}${v.descripcion ? `\n\n${v.descripcion.slice(0, 600)}` : ''}`).join('\n\n'),
      etiquetas: ['youtube', 'canal', 'resumen', ...(dominio ? [dominio] : [])], origenId: `youtube:resumen:${c.canal}:${i / 200}`,
    }, ahora)
  }
  c.estado = enteros.length ? 'corriendo' : 'terminado'
  guardar(db, c, ahora)
  db.prepare(`UPDATE youtube_cola SET estado = 'listo', motivo = NULL, leido_en = ? WHERE id = ?`).run(ahora, c.canal)
  void y.trabajarYoutube(db).catch(() => {})
  return { canal: c.titulo, enteros: enteros.length, nuevosEnCola: nuevos, resumidos: resumidos.length, horas: c.costo.horasEntero, tokensGemini: c.costo.geminiTokens, ritmo: `${ritmoCanal(db)} por hora` }
}

/** ¿El próximo video de un canal aprobado puede salir ya, o se pasaría del ritmo? */
export function dentroDelRitmo(db: Db, ahora = Date.now()) {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM youtube_cola WHERE de LIKE 'canal:%' AND leido_en > ?`).get(ahora - 3_600_000) as { n: number }).n
  return n < ritmoCanal(db)
}

/** Después de cada video de un canal: si ya no queda nada suyo por leer, el canal terminó (y se le avisa). */
export function quizasTermino(db: Db, canal: string, ahora = Date.now()): boolean {
  const c = leerCenso(db, canal)
  if (!c || c.estado !== 'corriendo') return false
  const quedan = (db.prepare(`SELECT COUNT(*) AS n FROM youtube_cola WHERE de = ? AND estado IN ('pendiente', 'compu')`).get(canal) as { n: number }).n
  if (quedan) return false
  c.estado = 'terminado'
  guardar(db, c, ahora)
  fijarAjuste(db, `youtube_censo_fin:${canal}`, String(ahora))
  const leidos = (db.prepare(`SELECT COUNT(*) AS n FROM youtube_cola WHERE de = ? AND estado = 'listo'`).get(canal) as { n: number }).n
  void import('./chat/index.ts').then((ch) => ch.difundir(`Terminé el canal «${c.titulo}»: ${leidos} de ${c.costo.videosEntero} videos leídos enteros y destilados. Lo resumido ya estaba en el corpus.`)).catch(() => {})
  return true
}
