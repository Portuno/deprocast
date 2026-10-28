/**
 * El lector de la web: cualquier link → Markdown limpio (lo esencial de crawl4ai, en nuestro código y sin navegador).
 * - leer(url): elige cómo leer (GitHub → el README; Wikipedia → su API; Reddit → el .json; YouTube, X y TikTok →
 *   oEmbed; PDF → su texto; HTML → el lector de html.ts) y devuelve título, Markdown, metadatos y links.
 * - guardarLink: lo guarda en el corpus como fuente primaria (una sola vez por URL) y lo manda a la liga.
 * - procesarLink: guardar y, si es un sitio con índice (documentación, blog, wiki), rastrearlo y armar un cuaderno.
 * Las páginas que solo se arman con JavaScript vienen casi vacías: se avisa, no se inventa.
 */
import { leerHtml, type Meta } from './html.ts'
import { textoDePdf } from '../cargas/pdf.ts'
import { clasificarYoutube, leerVideo } from './youtube.ts'
import type { Db } from '../db.ts'
import { pedirSeguro } from '../explorar/red.ts'

/** sinMateria: entró solo la cáscara (un video sin subtítulos): la pieza queda pendiente y no cuenta como materia. */
export type Lectura = { url: string; titulo: string; markdown: string; meta: Meta; links: { url: string; texto: string; interno: boolean }[]; palabras: number; fuente: string; aviso?: string; sinMateria?: boolean }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
type Pedir = (url: string, init?: RequestInit) => Promise<Response>
// Todo link sale por la red segura (src/explorar/red.ts): ninguno puede apuntar adentro, ni en una redirección.
let pedir: Pedir = (url, init = {}) => pedirSeguro(url, { ...init, headers: { 'user-agent': UA, ...(init.headers as Record<string, string> ?? {}) } })
export function _probarLector(f: Pedir) {
  pedir = f
}
export const pedirLector = (url: string, init?: RequestInit) => pedir(url, init)

const palabras = (md: string) => md.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length
const lectura = (url: string, fuente: string, titulo: string, markdown: string, extra: Partial<Lectura> = {}): Lectura =>
  ({ url, fuente, titulo: titulo.trim() || url, markdown: markdown.trim(), meta: {}, links: [], palabras: palabras(markdown), ...extra })

/** La URL sin lo que no cambia el contenido (#, utm_, la barra final): la clave para no guardar dos veces lo mismo. */
export function normalizarUrl(u: string): string {
  try {
    const x = new URL(u.trim())
    x.hash = ''
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|igshid|si$|ref$|ref_src)/i.test(k)) x.searchParams.delete(k)
    x.hostname = x.hostname.replace(/^www\./, '')
    return x.toString().replace(/\/$/, '')
  } catch {
    return u.trim()
  }
}

// ─── fuentes especiales ─────────────────────────────────────────────────

async function json(url: string, init?: RequestInit): Promise<any> {
  const r = await pedir(url, init)
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}

async function github(url: string, m: RegExpExecArray): Promise<Lectura | null> {
  const [, dueno, repo, resto] = m
  const nombre = repo.replace(/\.git$/, '')
  // Un archivo puntual (blob .md): su versión cruda. Un repo: su README.
  const blob = /^\/blob\/([^/]+)\/(.+\.(md|markdown|txt|rst))$/i.exec(resto ?? '')
  const candidatos = blob ? [`https://raw.githubusercontent.com/${dueno}/${nombre}/${blob[1]}/${blob[2]}`] : !resto || /^\/?(tree\/[^/]+\/?)?$/.test(resto) ? ['README.md', 'readme.md', 'README.rst', 'README'].map((a) => `https://raw.githubusercontent.com/${dueno}/${nombre}/HEAD/${a}`) : []
  for (const c of candidatos) {
    const r = await pedir(c).catch(() => null)
    if (r?.ok) {
      const texto = await r.text()
      if (texto.trim()) return lectura(url, 'github', `${dueno}/${nombre}${blob ? ` · ${blob[2]}` : ''}`, texto, { meta: { sitio: 'GitHub' } })
    }
  }
  return null
}

/**
 * Un documento de Google (Docs, Sheets, Slides) compartido con el link: su exportación entera (Markdown, CSV o texto),
 * no la página del editor. Si es privado, Google devuelve su login: se avisa cómo compartirlo.
 */
async function google(url: string, m: RegExpExecArray): Promise<Lectura | null> {
  const [, tipo, id] = m
  const gid = /[#&?]gid=(\d+)/.exec(url)?.[1]
  const base = `https://docs.google.com/${tipo}/d/${id}`
  const candidatos = tipo === 'document' ? [`${base}/export?format=md`, `${base}/export?format=txt`]
    : tipo === 'spreadsheets' ? [`${base}/export?format=csv${gid ? `&gid=${gid}` : ''}`]
      : [`${base}/export/txt`]
  let privado = false
  for (const c of candidatos) {
    const r = await pedir(c).catch(() => null)
    if (!r?.ok) { if (r && [401, 403].includes(r.status)) privado = true; continue }
    if (/html/i.test(r.headers.get('content-type') ?? '')) { privado = true; continue } // el login de Google
    const texto = (await r.text()).replace(/^﻿/, '')
    if (!texto.trim()) continue
    const titulo = texto.match(/^#{1,3}\s+(.+)$/m)?.[1] ?? texto.split('\n').find((l) => l.trim())?.replace(/[#*_]/g, '').trim().slice(0, 100) ?? url
    const md = tipo === 'spreadsheets' ? `\`\`\`csv\n${texto.trim()}\n\`\`\`` : texto
    return lectura(url, 'google', titulo, md, { meta: { sitio: tipo === 'document' ? 'Google Docs' : tipo === 'spreadsheets' ? 'Google Sheets' : 'Google Slides' } })
  }
  return privado ? lectura(url, 'google', url, '', { aviso: 'Ese documento de Google es privado: compartilo como «Cualquier persona con el enlace puede ver» y mandámelo de nuevo.' }) : null
}

/**
 * Un tramo de un texto largo, para leerlo entero de a partes (sin cortar una línea al medio). `sigue` es desde dónde
 * pedir el próximo; null si ya es el final.
 */
export function tramo(texto: string, desde = 0, largo = 10_000) {
  const total = texto.length
  const ini = Math.max(0, Math.min(Math.trunc(desde) || 0, total))
  let fin = Math.min(total, ini + largo)
  if (fin < total) {
    const corte = texto.lastIndexOf('\n', fin)
    if (corte > ini + largo * 0.6) fin = corte
  }
  return { texto: texto.slice(ini, fin), desde: ini, hasta: fin, total, sigue: fin < total ? fin : null }
}

async function wikipedia(url: string, m: RegExpExecArray): Promise<Lectura | null> {
  const [, idioma, articulo] = m
  const r = await pedir(`https://${idioma}.wikipedia.org/api/rest_v1/page/html/${articulo}`).catch(() => null)
  if (!r?.ok) return null
  const l = leerHtml(await r.text(), url, { entero: true })
  const titulo = decodeURIComponent(articulo).replace(/_/g, ' ')
  // Las referencias y «véase también» del final son una lista larga de links: se cortan.
  const md = l.markdown.split(/\n## (Referencias|Notas|Véase también|Enlaces externos|References|See also|External links|Notes)\b/)[0]
  return lectura(url, 'wikipedia', titulo, `# ${titulo}\n\n${md.replace(/^# .*\n+/, '')}`, { meta: { sitio: 'Wikipedia', idioma }, links: l.links })
}

async function reddit(url: string): Promise<Lectura | null> {
  const base = url.split('?')[0].replace(/\/$/, '')
  const j = await json(`${base}.json?limit=20&sort=top`).catch(() => null)
  const post = j?.[0]?.data?.children?.[0]?.data
  if (!post) return null
  const comentarios = (j?.[1]?.data?.children ?? []).map((c: any) => c.data).filter((c: any) => c?.body && c.author !== 'AutoModerator').sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10)
  const md = [
    `# ${post.title}`, `r/${post.subreddit} · u/${post.author} · ${post.score ?? 0} puntos`,
    post.selftext || (post.url && post.url !== base ? `[${post.url}](${post.url})` : ''),
    comentarios.length ? `## Comentarios principales\n\n${comentarios.map((c: any) => `- **u/${c.author}** (${c.score ?? 0}): ${String(c.body).replace(/\n+/g, ' ')}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
  return lectura(url, 'reddit', post.title, md, { meta: { sitio: 'Reddit', autor: `u/${post.author}`, fecha: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined } })
}

async function oembed(url: string, endpoint: string, fuente: string): Promise<Lectura | null> {
  const j = await json(`${endpoint}?url=${encodeURIComponent(url)}&format=json`).catch(() => null)
  if (!j) return null
  const cuerpo = j.html ? leerHtml(j.html, url).markdown : ''
  const titulo = j.title || `${j.author_name ?? fuente}`
  if (fuente === 'youtube') {
    // Lo que dice el video: la descripción entera y la transcripción. Sin subtítulos, se guarda la cáscara y se avisa.
    const v = await leerVideo(url, pedir).catch(() => null)
    const md = [
      `# ${v?.titulo || titulo}`, `Canal: ${v?.canal || j.author_name || '?'}`,
      v?.descripcion ? `## Descripción\n\n${v.descripcion}` : '',
      v?.transcripcion ? `## Transcripción${v.automatica ? ' (subtítulos automáticos)' : ''}${v.idioma ? ` · ${v.idioma}` : ''}\n\n${v.transcripcion}` : '',
    ].filter(Boolean).join('\n\n')
    const sin = !v?.transcripcion
    return lectura(url, fuente, v?.titulo || titulo, md, {
      meta: { sitio: 'YouTube', autor: v?.canal || j.author_name },
      ...(sin ? { sinMateria: true, aviso: `Sin transcripción (${v?.motivo ?? 'no pude leer el video'}): guardé el título${v?.descripcion ? ' y la descripción' : ''}. Si me pasás el audio, lo transcribo.${v?.rastro?.length ? ` [${v.rastro.join(' · ')}]` : ''}` } : {}),
    })
  }
  const md = [`# ${titulo}`, j.author_name ? `De: ${j.author_name}` : '', cuerpo].filter(Boolean).join('\n\n')
  return lectura(url, fuente, titulo, md, { meta: { sitio: j.provider_name ?? fuente, autor: j.author_name } })
}

const ESPECIALES: [RegExp, (url: string, m: RegExpExecArray) => Promise<Lectura | null>][] = [
  [/^https?:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]{20,})/i, google],
  [/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(\/.*)?$/i, github],
  [/^https?:\/\/(\w+)\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i, wikipedia],
  [/^https?:\/\/(?:www\.|old\.|new\.)?reddit\.com\/r\/\w+\/comments\//i, (u) => reddit(u)],
  [/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch|shorts)|youtu\.be\/)/i, (u) => oembed(u, 'https://www.youtube.com/oembed', 'youtube')],
  [/^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/\w+\/status\//i, (u) => oembed(u, 'https://publish.twitter.com/oembed', 'x')],
  [/^https?:\/\/(?:www\.)?tiktok\.com\//i, (u) => oembed(u, 'https://www.tiktok.com/oembed', 'tiktok')],
]
const SIN_CUENTA = /^https?:\/\/(?:www\.)?(instagram\.com|facebook\.com|fb\.watch|linkedin\.com|threads\.net)\//i

/** Lee un link y lo devuelve en Markdown limpio. Nunca tira por la red: si no se puede, avisa por qué. */
export async function leer(url: string): Promise<Lectura> {
  const u = url.trim()
  if (!/^https?:\/\//i.test(u)) return lectura(u, 'nada', u, '', { aviso: 'Eso no es un link (http o https).' })
  for (const [re, f] of ESPECIALES) {
    const m = re.exec(u)
    if (!m) continue
    // Un Google privado vuelve sin texto pero con el aviso de cómo compartirlo (si no, se leería el login de Google).
    try { const l = await f(u, m); if (l?.markdown || (l?.fuente === 'google' && l.aviso)) return l } catch { /* se prueba como página común */ }
  }
  if (SIN_CUENTA.test(u)) return lectura(u, 'red', u, '', { aviso: 'Esa red no deja leer sin cuenta: guardo el link y lo que me contaste.' })
  let r: Response
  try { r = await pedir(u) } catch (e) { return lectura(u, 'error', u, '', { aviso: `No pude abrirla: ${e instanceof Error ? e.message : e}` }) }
  if (!r.ok) return lectura(u, 'error', u, '', { aviso: `La página respondió ${r.status}.` })
  const tipo = r.headers.get('content-type') ?? ''
  if (/pdf/i.test(tipo) || /\.pdf($|\?)/i.test(u)) {
    const texto = textoDePdf(Buffer.from(await r.arrayBuffer()))
    return lectura(u, 'pdf', decodeURIComponent(u.split('/').pop() ?? u).replace(/\.pdf.*$/i, ''), texto, texto ? {} : { aviso: 'Es un PDF escaneado, sin texto.' })
  }
  if (/text\/(plain|markdown)|\.md($|\?)/i.test(tipo + u) && !/html/i.test(tipo)) {
    const texto = await r.text()
    return lectura(u, 'texto', texto.match(/^#\s+(.+)$/m)?.[1] ?? u.split('/').pop() ?? u, texto)
  }
  if (!/html|xml/i.test(tipo)) return lectura(u, 'archivo', u, '', { aviso: `Es un archivo (${tipo || 'sin tipo'}), no una página.` })
  const html = await r.text()
  const l = leerHtml(html, r.url || u)
  const aviso = l.palabras < 40 && /id="(root|app|__next)"|__NEXT_DATA__|data-reactroot|ng-version/i.test(html)
    ? 'La página se arma con JavaScript y sin navegador casi no trae texto: guardé lo que había.' : undefined
  return { url: u, titulo: l.titulo || u, markdown: l.markdown, meta: l.meta, links: l.links, palabras: l.palabras, fuente: 'html', ...(aviso ? { aviso } : {}) }
}

/** ¿Es un sitio con índice (documentación, guía, wiki, blog) que conviene rastrear? */
export function esSitioConIndice(l: Lectura): boolean {
  if (l.fuente !== 'html') return false
  let u: URL
  try { u = new URL(l.url) } catch { return false }
  const prefijo = prefijoDe(u.pathname)
  const hermanos = l.links.filter((x) => x.interno && (() => { try { const p = new URL(x.url).pathname; return p !== u.pathname && p.startsWith(prefijo) } catch { return false } })())
  return /\/(docs?|documentation|guide|guides|wiki|learn|manual|tutorial|handbook|reference|blog)(\/|$)/i.test(u.pathname) ? hermanos.length >= 2 : hermanos.length >= 5
}

/** El tramo de ruta que define el sitio a rastrear: /docs/intro → /docs/ ; /blog/post → /blog/ ; / → /. */
export function prefijoDe(ruta: string): string {
  const partes = ruta.split('/').filter(Boolean)
  return partes.length <= 1 ? '/' : `/${partes.slice(0, -1).join('/')}/`
}

// ─── guardar ────────────────────────────────────────────────────────────

export type Guardado = { piezaId: number; nueva: boolean; lectura: Lectura | null }

/** Lee y guarda el link en el corpus (fuente primaria, en Markdown). Si ya estaba, devuelve esa pieza sin volver a leer. */
export async function guardarLink(db: Db, url: string, o: { nota?: string | null; lectura?: Lectura; ahora?: number } = {}): Promise<Guardado> {
  // YouTube (un video o un canal) no se lee acá: va a su cola (la nube no puede leerlo; lo trae el servicio o la compu).
  const yt = clasificarYoutube(url)
  if (yt && !o.lectura) {
    const { avisoDeCola, encolarYoutube, trabajarYoutube } = await import('../youtube.ts')
    const r = await encolarYoutube(db, url, { nota: o.nota ?? null }, o.ahora)
    if (r) {
      void trabajarYoutube(db).catch(() => {})
      const p = db.prepare('SELECT titulo, contenido FROM corpus WHERE id = ?').get(r.piezaId) as { titulo: string; contenido: string } | undefined
      const aviso = avisoDeCola(db, r.tipo, r.estado)
      return { piezaId: r.piezaId, nueva: r.nueva, lectura: lectura(url, 'youtube', p?.titulo ?? url, p?.contenido ?? '', aviso ? { aviso } : {}) }
    }
  }
  const { ingerir } = await import('../mastropiero.ts')
  const origen = `url:${normalizarUrl(url)}`
  const ya = db.prepare('SELECT id, meta FROM corpus WHERE origen_id = ?').get(origen) as { id: number; meta: string | null } | undefined
  if (ya) {
    // Si entró solo la cáscara (un video sin transcripción), mandarlo de nuevo vuelve a leerlo: si ahora sale, se completa.
    if (!/"sinTranscripcion":true/.test(ya.meta ?? '')) return { piezaId: ya.id, nueva: false, lectura: null }
    const l = o.lectura ?? await leer(url)
    if (l.sinMateria) {
      // Sigue sin salir: al menos queda el motivo de ahora (y la descripción, si esta vez llegó).
      db.prepare(`UPDATE corpus SET contenido = ?, meta = json_set(COALESCE(meta, '{}'), '$.aviso', ?) WHERE id = ?`).run([l.markdown, l.aviso ? `_(${l.aviso})_` : ''].filter(Boolean).join('\n\n'), l.aviso ?? null, ya.id)
      return { piezaId: ya.id, nueva: false, lectura: l }
    }
    db.prepare(`UPDATE corpus SET contenido = ?, titulo = ?, estado = 'disponible', autor = COALESCE(?, autor),
      meta = json_remove(json_set(COALESCE(meta, '{}'), '$.palabras', ?, '$.aviso', NULL), '$.sinTranscripcion'),
      etiquetas = (SELECT json_group_array(value) FROM json_each(COALESCE(corpus.etiquetas, '[]')) WHERE value != 'sin-transcripcion') WHERE id = ?`)
      .run(l.markdown, l.titulo.slice(0, 200), l.meta.autor ?? null, l.palabras, ya.id)
    db.prepare('DELETE FROM pasajes WHERE pieza_id = ?').run(ya.id) // cambió el texto: sus pasajes se rehacen
    return { piezaId: ya.id, nueva: false, lectura: l }
  }
  const l = o.lectura ?? await leer(url)
  const nota = o.nota?.trim()
  const contenido = [nota ? `> Nota: ${nota}` : '', l.markdown || `[${l.url}](${l.url})`, l.aviso ? `_(${l.aviso})_` : ''].filter(Boolean).join('\n\n')
  const { corpusId } = ingerir(db, {
    fuente: 'web', nivel: 'primaria', titulo: l.titulo.slice(0, 200), contenido, url: l.url, autor: l.meta.autor ?? null,
    fecha: l.meta.fecha ? String(l.meta.fecha).slice(0, 10) : null, dominio: 'compartido', origenId: origen,
    meta: { ...l.meta, fuenteLectura: l.fuente, palabras: l.palabras, aviso: l.aviso ?? null, nota: nota ?? null, ...(l.sinMateria ? { sinTranscripcion: true } : {}) },
  }, o.ahora)
  // Solo la cáscara (un video sin subtítulos): queda pendiente, así no cuenta como materia hasta que llegue el audio.
  if (l.sinMateria) db.prepare(`UPDATE corpus SET estado = 'pendiente', etiquetas = json_insert(COALESCE(etiquetas, '[]'), '$[#]', 'sin-transcripcion') WHERE id = ?`).run(corpusId)
  return { piezaId: corpusId, nueva: true, lectura: l }
}

export type Procesado = Guardado & { rastreando: boolean }

/**
 * Lo que pasa cuando él manda un link: se lee y se guarda; si es un sitio con índice y es la primera vez, se rastrea de
 * fondo (hasta 20 páginas) y se arma un cuaderno. alTerminar avisa cuando el rastreo termina (Telegram, Hoy).
 */
export async function procesarLink(db: Db, url: string, o: { nota?: string | null; rastrear?: boolean; alTerminar?: (r: { cuadernoId: number; titulo: string; paginas: number }) => void; ahora?: number } = {}): Promise<Procesado> {
  const g = await guardarLink(db, url, o)
  const rastreando = !!(g.nueva && g.lectura && (o.rastrear ?? esSitioConIndice(g.lectura)))
  if (rastreando) {
    const { rastrear } = await import('./rastreo.ts')
    void rastrear(db, url, { inicio: g.lectura!, piezaInicio: g.piezaId }).then((r) => o.alTerminar?.(r)).catch(() => {})
  }
  return { ...g, rastreando }
}

/** «No guardar»: se borra la pieza y lo que la liga todavía no hizo con ella. */
export function descartarLink(db: Db, piezaId: number) {
  db.prepare(`DELETE FROM tareas WHERE corpus_id = ? AND estado IN ('pendiente', 'asignada')`).run(piezaId)
  db.prepare('DELETE FROM cuaderno_fuentes WHERE pieza_id = ?').run(piezaId)
  db.prepare('DELETE FROM corpus WHERE id = ?').run(piezaId)
}

// ─── bajar como .md ─────────────────────────────────────────────────────

const yaml = (v: unknown) => JSON.stringify(String(v ?? ''))
const archivoDe = (t: string) => `${t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 70) || 'pieza'}.md`

/** Una pieza del corpus como archivo .md (con encabezado YAML). */
export function piezaComoMd(db: Db, id: number): { nombre: string; texto: string } {
  const p = db.prepare('SELECT * FROM corpus WHERE id = ?').get(id) as any
  if (!p) throw new Error(`No existe la pieza ${id}`)
  const cuerpo = String(p.contenido ?? '')
  const titulo = String(p.titulo ?? `Pieza ${id}`)
  const front = ['---', `titulo: ${yaml(titulo)}`, p.url ? `url: ${yaml(p.url)}` : '', p.autor ? `autor: ${yaml(p.autor)}` : '', p.fecha ? `fecha: ${yaml(p.fecha)}` : '', `fuente: ${yaml(p.fuente)}`, `pieza: ${id}`, '---'].filter(Boolean).join('\n')
  // El título como encabezado, salvo que el texto ya lo traiga al principio (después de la nota, si hay).
  const yaTieneTitulo = /^#\s/m.test(cuerpo.split('\n').slice(0, 6).join('\n'))
  return { nombre: archivoDe(titulo), texto: `${front}\n\n${yaTieneTitulo ? '' : `# ${titulo}\n\n`}${cuerpo}\n` }
}

/** Un cuaderno entero (sus piezas) en un solo .md. */
export function cuadernoComoMd(db: Db, id: number): { nombre: string; texto: string } {
  const c = db.prepare('SELECT * FROM cuadernos WHERE id = ?').get(id) as any
  if (!c) throw new Error(`No existe el cuaderno ${id}`)
  const ids = (db.prepare('SELECT pieza_id FROM cuaderno_fuentes WHERE cuaderno_id = ? ORDER BY rowid').all(id) as { pieza_id: number }[]).map((r) => r.pieza_id)
  // Cada página, sin su encabezado YAML, separada por una raya.
  const partes = ids.map((p) => { try { return piezaComoMd(db, p).texto.replace(/^---[\s\S]*?---\n+/, '').trim() } catch { return '' } }).filter(Boolean)
  return { nombre: archivoDe(c.titulo), texto: `# ${c.titulo}\n\n${c.descripcion ? `${c.descripcion}\n\n` : ''}${partes.join('\n\n---\n\n')}\n` }
}
