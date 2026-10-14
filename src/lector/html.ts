/**
 * HTML → Markdown limpio, sin dependencias (lo esencial de crawl4ai, en nuestro código): un parser chico, la poda de
 * lo que no es contenido (menús, pies, barras laterales, cookies, compartir, comentarios), la elección del bloque
 * principal (article/main, o el que más texto de párrafo junta, al estilo Readability) y el Markdown (GFM: títulos,
 * listas anidadas, links absolutos, imágenes con alt, código con lenguaje, citas y tablas). Más los metadatos.
 */

export type Nodo = { tag: string; attrs: Record<string, string>; hijos: (Nodo | string)[] }
export type Meta = { descripcion?: string; autor?: string; fecha?: string; sitio?: string; canonica?: string; idioma?: string; imagen?: string; tipo?: string }
export type LecturaHtml = { titulo: string; markdown: string; meta: Meta; links: { url: string; texto: string; interno: boolean }[]; palabras: number }

const VACIOS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const CRUDOS = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'svg'])
const BLOQUES_CIERRAN_P = new Set(['p', 'div', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'section', 'article', 'header', 'footer', 'figure', 'hr', 'dl'])

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', copy: '©', reg: '®', trade: '™', euro: '€', middot: '·', bull: '•', iexcl: '¡', iquest: '¿', deg: '°', times: '×',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', ccedil: 'ç', agrave: 'à', egrave: 'è', ograve: 'ò', acirc: 'â', ecirc: 'ê', ocirc: 'ô', zwj: '', zwnj: '', shy: '',
}
export function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTIDADES[e] ?? ENTIDADES[e.toLowerCase()] ?? m
  })
}

function atributos(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of s.matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] = decodificar(m[2] ?? m[3] ?? m[4] ?? '')
  return out
}

/** Un árbol liviano: tolera HTML real (etiquetas sin cerrar, párrafos implícitos, listas). */
export function parsear(html: string): Nodo {
  const raiz: Nodo = { tag: '#doc', attrs: {}, hijos: [] }
  const pila: Nodo[] = [raiz]
  const actual = () => pila[pila.length - 1]
  const cerrarHasta = (tag: string) => {
    const i = pila.map((n) => n.tag).lastIndexOf(tag)
    if (i > 0) pila.length = i
  }
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const [todo, cierre, apertura, attrs, auto] = m
    if (todo.startsWith('<!') || todo.startsWith('<?')) continue
    if (cierre) { cerrarHasta(cierre.toLowerCase()); continue }
    if (apertura) {
      const tag = apertura.toLowerCase()
      if (tag === 'p' || (BLOQUES_CIERRAN_P.has(tag) && actual().tag === 'p')) { if (actual().tag === 'p') pila.pop() }
      if (tag === 'li') { const i = pila.map((n) => n.tag).lastIndexOf('li'); const lista = Math.max(pila.map((n) => n.tag).lastIndexOf('ul'), pila.map((n) => n.tag).lastIndexOf('ol')); if (i > lista && i > 0) pila.length = i }
      if (tag === 'tr' || tag === 'td' || tag === 'th') {
        const fila = pila.map((n) => n.tag).lastIndexOf('tr')
        if (tag === 'tr' && fila > pila.map((n) => n.tag).lastIndexOf('table') && fila > 0) pila.length = fila
        if (tag !== 'tr') { const c = Math.max(pila.map((n) => n.tag).lastIndexOf('td'), pila.map((n) => n.tag).lastIndexOf('th')); if (c > fila && c > 0) pila.length = c }
      }
      const n: Nodo = { tag, attrs: atributos(attrs ?? ''), hijos: [] }
      actual().hijos.push(n)
      if (CRUDOS.has(tag)) {
        const fin = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex)
        const crudo = html.slice(re.lastIndex, fin < 0 ? html.length : fin)
        if (crudo) n.hijos.push(tag === 'title' || tag === 'textarea' ? decodificar(crudo) : crudo)
        re.lastIndex = fin < 0 ? html.length : html.indexOf('>', fin) + 1 || html.length
        continue
      }
      if (!auto && !VACIOS.has(tag)) pila.push(n)
      continue
    }
    actual().hijos.push(decodificar(todo))
  }
  return raiz
}

// ─── recorrer ───────────────────────────────────────────────────────────

const esNodo = (x: Nodo | string): x is Nodo => typeof x !== 'string'
function* todos(n: Nodo): Generator<Nodo> { for (const h of n.hijos) if (esNodo(h)) { yield h; yield* todos(h) } }
const primero = (n: Nodo, tag: string) => { for (const x of todos(n)) if (x.tag === tag) return x; return null }
export function textoDe(n: Nodo | string): string { return typeof n === 'string' ? n : n.tag === 'script' || n.tag === 'style' ? '' : n.hijos.map(textoDe).join(' ') }
const limpio = (s: string) => s.replace(/\s+/g, ' ').trim()

// ─── metadatos ──────────────────────────────────────────────────────────

function jsonLd(doc: Nodo): any[] {
  const out: any[] = []
  for (const s of todos(doc)) {
    if (s.tag !== 'script' || !/ld\+json/i.test(s.attrs.type ?? '')) continue
    try {
      const j = JSON.parse(String(s.hijos[0] ?? ''))
      for (const x of Array.isArray(j) ? j : [j]) out.push(x, ...(Array.isArray(x?.['@graph']) ? x['@graph'] : []))
    } catch { /* JSON-LD roto: se ignora */ }
  }
  return out
}

function metadatos(doc: Nodo): { titulo: string; meta: Meta } {
  const metas: Record<string, string> = {}
  for (const n of todos(doc)) {
    if (n.tag === 'meta') { const k = (n.attrs.property ?? n.attrs.name ?? n.attrs.itemprop ?? '').toLowerCase(); if (k && n.attrs.content && !metas[k]) metas[k] = n.attrs.content.trim() }
  }
  const ld = jsonLd(doc).find((x) => x && (x.headline || x.datePublished || x.author)) ?? {}
  const autorLd = Array.isArray(ld.author) ? ld.author.map((a: any) => a?.name ?? a).filter(Boolean).join(', ') : typeof ld.author === 'object' ? ld.author?.name : ld.author
  const tiempo = primero(doc, 'time')?.attrs.datetime
  const canon = [...todos(doc)].find((n) => n.tag === 'link' && /canonical/i.test(n.attrs.rel ?? ''))?.attrs.href
  const titulo = limpio(metas['og:title'] ?? ld.headline ?? textoDe(primero(doc, 'title') ?? '') ?? '') || limpio(textoDe(primero(doc, 'h1') ?? ''))
  const meta: Meta = {
    descripcion: metas['og:description'] ?? metas.description, autor: metas.author ?? metas['article:author'] ?? autorLd,
    fecha: metas['article:published_time'] ?? ld.datePublished ?? metas['date'] ?? tiempo, sitio: metas['og:site_name'], canonica: canon,
    idioma: primero(doc, 'html')?.attrs.lang, imagen: metas['og:image'], tipo: metas['og:type'],
  }
  for (const k of Object.keys(meta) as (keyof Meta)[]) if (!meta[k]) delete meta[k]
  return { titulo, meta }
}

// ─── la poda ────────────────────────────────────────────────────────────

const AFUERA = new Set(['script', 'style', 'noscript', 'svg', 'iframe', 'form', 'button', 'nav', 'header', 'footer', 'aside', 'select', 'input', 'textarea', 'template', 'canvas', 'object', 'embed', 'video', 'audio', 'dialog', 'menu'])
const ROLES_AFUERA = /^(navigation|banner|contentinfo|complementary|search|dialog|alert|menu|menubar|toolbar)$/i
const CLASES_AFUERA = /(^|[\s_-])(nav|navbar|navigation|menu|footer|sidebar|side-bar|cookies?|consent|gdpr|banner|share|sharing|social|related|comments?|disqus|advert|ads?|adslot|promo|sponsor|subscribe|newsletter|breadcrumbs?|popup|modal|overlay|skip|toolbar|masthead|pagination|pager|tags|author-bio|signup|paywall|infobox|navbox|sidebar-box|mw-editsection|noprint|headerlink)([\s_-]|$)/i

function esBasura(n: Nodo): boolean {
  if (AFUERA.has(n.tag)) return true
  // Las llamadas a nota ([1], [nota 2]) y la marca ¶ de los títulos: ruido al leer.
  if (n.tag === 'sup' && (/reference|cite|footnote|noprint/i.test(n.attrs.class ?? '') || /^\s*\[[^\]]{1,12}\]\s*$/.test(textoDe(n)))) return true
  if (n.tag === 'a' && /^\s*[¶#§]\s*$/.test(textoDe(n))) return true
  if (n.attrs.hidden != null || n.attrs['aria-hidden'] === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.attrs.style ?? '')) return true
  if (ROLES_AFUERA.test(n.attrs.role ?? '')) return true
  if (n.tag === 'main' || n.tag === 'article' || n.tag === 'body' || n.tag === 'html') return false
  return CLASES_AFUERA.test(`${n.attrs.class ?? ''} ${n.attrs.id ?? ''}`)
}

function podar(n: Nodo): Nodo {
  return { ...n, hijos: n.hijos.filter((h) => typeof h === 'string' || !esBasura(h)).map((h) => (typeof h === 'string' ? h : podar(h))) }
}

function largoLinks(n: Nodo): number { let t = 0; for (const x of todos(n)) if (x.tag === 'a') t += limpio(textoDe(x)).length; return t }

/** El bloque principal: article/main con más texto; si no, el que junta más texto de párrafo con pocos links. */
function principal(body: Nodo): Nodo {
  const marcados = [...todos(body)].filter((n) => n.tag === 'article' || n.tag === 'main' || /^main$/i.test(n.attrs.role ?? ''))
  const mejorMarcado = marcados.map((n) => ({ n, l: limpio(textoDe(n)).length })).sort((a, b) => b.l - a.l)[0]
  if (mejorMarcado && mejorMarcado.l > 200) return mejorMarcado.n
  const puntos = new Map<Nodo, number>()
  const padreDe = new Map<Nodo, Nodo>()
  const recorrer = (n: Nodo) => { for (const h of n.hijos) if (esNodo(h)) { padreDe.set(h, n); recorrer(h) } }
  recorrer(body)
  for (const p of todos(body)) {
    if (!['p', 'pre', 'td', 'blockquote'].includes(p.tag)) continue // las listas (de links, de referencias) no cuentan como contenido
    const t = limpio(textoDe(p))
    if (t.length < 25) continue
    const pts = 1 + (t.match(/,/g)?.length ?? 0) + Math.min(3, Math.floor(t.length / 100))
    const padre = padreDe.get(p)
    if (padre) puntos.set(padre, (puntos.get(padre) ?? 0) + pts)
    const abuelo = padre && padreDe.get(padre)
    if (abuelo) puntos.set(abuelo, (puntos.get(abuelo) ?? 0) + pts / 2)
  }
  let mejor: Nodo = body
  let max = 0
  for (const [n, p] of puntos) {
    const total = Math.max(1, limpio(textoDe(n)).length)
    const s = p * (1 - Math.min(1, largoLinks(n) / total))
    if (s > max) { max = s; mejor = n }
  }
  // Si el ganador se queda con muy poco del cuerpo (una página de notas sueltas), mejor el cuerpo podado entero.
  return limpio(textoDe(mejor)).length < 0.25 * limpio(textoDe(body)).length ? body : mejor
}

// ─── Markdown ───────────────────────────────────────────────────────────

const absoluta = (href: string, base: string) => { try { return new URL(href, base).toString() } catch { return '' } }
const escaparTabla = (s: string) => s.replace(/\|/g, '\\|')
/** **negrita** sin comerse los espacios de afuera («hola **mundo** y»). */
const envolver = (t: string, m: string) => (t.trim() ? `${/^\s/.test(t) ? ' ' : ''}${m}${t.trim()}${m}${/\s$/.test(t) ? ' ' : ''}` : t)

function aMd(n: Nodo | string, base: string, o: { pre?: boolean } = {}): string {
  if (typeof n === 'string') return o.pre ? n : n.replace(/\s+/g, ' ')
  const hijos = (opts = o) => n.hijos.map((h) => aMd(h, base, opts)).join('')
  const bloque = (s: string) => (s.trim() ? `\n\n${s.trim()}\n\n` : '')
  switch (n.tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const t = limpio(hijos())
      return t ? `\n\n${'#'.repeat(Number(n.tag[1]))} ${t}\n\n` : ''
    }
    case 'p': case 'div': case 'section': case 'article': case 'main': case 'figure': case 'details': case 'body': case 'center':
      return bloque(hijos())
    case 'br': return '  \n'
    case 'hr': return '\n\n---\n\n'
    case 'strong': case 'b': return envolver(hijos(), '**')
    case 'em': case 'i': case 'cite': return envolver(hijos(), '*')
    case 'del': case 's': case 'strike': { const t = hijos(); return t.trim() ? `~~${t.trim()}~~` : t }
    case 'code': case 'kbd': case 'samp': {
      if (o.pre) return hijos()
      const t = textoDe(n).replace(/\s+/g, ' ').trim()
      return t ? (t.includes('`') ? `\`\` ${t} \`\`` : `\`${t}\``) : ''
    }
    case 'pre': {
      const codigo = n.hijos.map((h) => aMd(h, base, { pre: true })).join('').replace(/^\n+|\s+$/g, '')
      const clase = `${n.attrs.class ?? ''} ${(primero(n, 'code')?.attrs.class) ?? ''}`
      const lang = /(?:language|lang)-([\w+#-]+)/.exec(clase)?.[1] ?? ''
      return codigo ? `\n\n\`\`\`${lang}\n${codigo}\n\`\`\`\n\n` : ''
    }
    case 'blockquote': {
      const t = hijos().trim().replace(/\n{3,}/g, '\n\n')
      return t ? `\n\n${t.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}\n\n` : ''
    }
    case 'a': {
      const t = hijos().replace(/\s+/g, ' ').trim()
      const href = n.attrs.href ?? ''
      if (!href || /^(javascript:|#)/i.test(href)) return t
      const url = absoluta(href, base)
      if (!t) return ''
      if (/^!\[/.test(t)) return t // un link que solo envuelve una imagen: la imagen alcanza
      return url ? `[${t}](${url})` : t
    }
    case 'img': {
      const alt = limpio(n.attrs.alt ?? '')
      const src = n.attrs.src && !n.attrs.src.startsWith('data:') ? n.attrs.src : n.attrs['data-src'] ?? n.attrs.srcset?.split(/[\s,]+/)[0] ?? ''
      return alt && src ? `![${alt}](${absoluta(src, base)})` : ''
    }
    case 'figcaption': { const t = limpio(hijos()); return t ? `\n\n*${t}*\n\n` : '' }
    case 'summary': { const t = limpio(hijos()); return t ? `\n\n**${t}**\n\n` : '' }
    case 'ul': case 'ol': {
      let i = Number(n.attrs.start) || 1
      const items = n.hijos.filter((h): h is Nodo => esNodo(h) && h.tag === 'li').map((li) => {
        const marca = n.tag === 'ol' ? `${i++}. ` : '- '
        const cuerpo = li.hijos.map((h) => aMd(h, base, o)).join('').trim().replace(/\n{3,}/g, '\n\n')
        if (!cuerpo) return ''
        const [primera, ...resto] = cuerpo.split('\n')
        return [marca + primera, ...resto.map((l) => (l ? ' '.repeat(marca.length) + l : l))].join('\n')
      }).filter(Boolean)
      return items.length ? `\n\n${items.join('\n')}\n\n` : ''
    }
    case 'li': return bloque(hijos())
    case 'dl': return bloque(hijos())
    case 'dt': { const t = limpio(hijos()); return t ? `\n\n**${t}**\n` : '' }
    case 'dd': { const t = hijos().trim(); return t ? `\n${t}\n\n` : '' }
    case 'table': {
      const filas: Nodo[] = []
      const juntar = (x: Nodo) => { for (const h of x.hijos) if (esNodo(h)) { if (h.tag === 'tr') filas.push(h); else if (['thead', 'tbody', 'tfoot'].includes(h.tag)) juntar(h) } }
      juntar(n)
      const celdas = filas.map((f) => f.hijos.filter((h): h is Nodo => esNodo(h) && (h.tag === 'td' || h.tag === 'th')))
      const ancho = Math.max(0, ...celdas.map((c) => c.length))
      // Tabla de maquetación (anidada o con bloques largos): se lee como texto, no como tabla.
      if (!ancho || [...todos(n)].some((x) => x.tag === 'table') || celdas.flat().some((c) => limpio(textoDe(c)).length > 400)) return bloque(hijos())
      if (ancho === 1) return bloque(celdas.map((c) => limpio(aMd(c[0], base))).join('\n\n'))
      const linea = (cs: Nodo[]) => `| ${Array.from({ length: ancho }, (_, k) => escaparTabla(limpio(cs[k] ? aMd(cs[k], base) : ''))).join(' | ')} |`
      const [cab, ...cuerpo] = celdas
      return `\n\n${[linea(cab), `| ${Array(ancho).fill('---').join(' | ')} |`, ...cuerpo.map(linea)].join('\n')}\n\n`
    }
    case 'td': case 'th': return hijos()
    case 'title': case 'head': case 'meta': case 'link': return ''
    default: return hijos()
  }
}

function pulir(md: string): string {
  return md
    .replace(/(?: {2}\n[ \t]*){2,}/g, '\n\n') // saltos de línea en cadena (páginas viejas armadas con <br>): un párrafo
    .replace(/[ \t]+\n/g, (m) => (m.startsWith('  ') && m.length === 3 ? m : '\n'))
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.replace(/^[ \t]+(?=[^\s-*\d>|`])/, (s) => (s.length >= 2 ? s : ''))).join('\n')
    .trim()
}

/** Lee una página: título, Markdown del contenido principal, metadatos y links. */
export function leerHtml(html: string, url = 'https://ejemplo.invalid/', o: { entero?: boolean } = {}): LecturaHtml {
  const doc = parsear(html)
  const { titulo, meta } = metadatos(doc)
  const base = absoluta(primero(doc, 'base')?.attrs.href ?? '', url) || url
  let host = ''
  try { host = new URL(url).host } catch { /* sin url */ }
  const links: LecturaHtml['links'] = []
  const vistos = new Set<string>()
  for (const a of todos(doc)) {
    if (a.tag !== 'a' || !a.attrs.href || /^(javascript:|mailto:|tel:|#)/i.test(a.attrs.href)) continue
    const u = absoluta(a.attrs.href, base).replace(/#.*$/, '')
    if (!u || vistos.has(u)) continue
    vistos.add(u)
    let interno = false
    try { interno = new URL(u).host === host } catch { /* url rara */ }
    links.push({ url: u, texto: limpio(textoDe(a)).slice(0, 120), interno })
  }
  const body = primero(doc, 'body') ?? doc
  // «entero»: la fuente ya trae solo el contenido (la API de Wikipedia): se poda, pero no se elige un bloque.
  const contenido = o.entero ? podar(body) : principal(podar(body))
  const markdown = pulir(aMd(contenido, base))
  return { titulo, markdown, meta, links, palabras: markdown.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length }
}
