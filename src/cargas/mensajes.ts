/**
 * Importadores de conversaciones y correo: chats de WhatsApp (.txt exportado), mensajes de Instagram (JSON de
 * «Descargar tu información»), exportes de Claude (conversations.json) y de Gemini (Mi actividad, JSON), y correo
 * (.mbox de Google Takeout o .eml). Los chats entran por día; los links compartidos (reels, posts) salen aparte,
 * uno por pieza, para que cada uno se pueda revisar y cribar.
 */
import type { Analisis, Contexto, Importador } from './tipos.ts'

const titulo = (n: string) => n.replace(/\.[^.]+$/, '')
const LINK = /https?:\/\/[^\s<>"')]+/g

type Linea = { fecha: string; hora: string; quien: string; texto: string }

function porDia(ls: Linea[]): Map<string, Linea[]> {
  const m = new Map<string, Linea[]>()
  for (const l of ls) m.set(l.fecha, [...(m.get(l.fecha) ?? []), l])
  return m
}

function enlaces(ls: Linea[]): { url: string; quien: string; fecha: string; contexto: string }[] {
  const vistos = new Set<string>()
  const out: { url: string; quien: string; fecha: string; contexto: string }[] = []
  for (const l of ls) for (const u of l.texto.match(LINK) ?? []) {
    if (vistos.has(u)) continue
    vistos.add(u)
    out.push({ url: u, quien: l.quien, fecha: l.fecha, contexto: l.texto.replace(u, '').trim().slice(0, 300) })
  }
  return out
}

function analisisChat(importador: string, nombre: string, ls: Linea[], fuente: { id: string; nombre: string }): Analisis {
  const dias = porDia(ls)
  const quienes = [...new Set(ls.map((l) => l.quien))]
  return {
    importador, titulo: titulo(nombre), descripcion: `${ls.length.toLocaleString('es-AR')} mensajes en ${dias.size} días, entre ${quienes.slice(0, 6).join(', ')}${quienes.length > 6 ? '…' : ''}.`,
    segmentos: [
      { id: 'dias', nombre: 'Conversación por día', descripcion: 'Una pieza por día, con quién dijo qué.', nivel: 'propia', destino: 'corpus', cantidad: dias.size, porDefecto: true },
      { id: 'enlaces', nombre: 'Links compartidos', descripcion: 'Cada reel, post o link, en su propia pieza (con quién lo mandó y el comentario).', nivel: 'primaria', destino: 'corpus', cantidad: enlaces(ls).length, porDefecto: true },
      { id: 'personas', nombre: 'Participantes', descripcion: 'Cada participante como persona.', nivel: null, destino: 'entidades', cantidad: quienes.length, porDefecto: true },
    ],
    fuente: { ...fuente, nivel: 'propia', padreId: null }, nivelEditable: false, avisos: [],
  }
}

function ejecutarChat(origen: string, nombre: string, ls: Linea[], ctx: Contexto) {
  const personas = new Map<string, number>()
  if (ctx.quiere('personas')) for (const q of new Set(ls.map((l) => l.quien))) personas.set(q, ctx.entidad('personas', { tipo: 'persona', nombre: q, origenId: `${origen}:persona:${q}` }))
  if (ctx.quiere('dias')) {
    for (const [dia, xs] of porDia(ls)) {
      ctx.pieza('dias', {
        titulo: `${titulo(nombre)} · ${dia}`, contenido: xs.map((l) => `[${l.hora}] ${l.quien}: ${l.texto}`).join('\n'), fecha: dia, origenId: `${origen}:dia:${dia}`,
        etiquetas: ['chat'], entidades: [...new Set(xs.map((l) => personas.get(l.quien)).filter((x): x is number => !!x))],
      })
    }
  }
  if (ctx.quiere('enlaces')) {
    for (const e of enlaces(ls)) {
      ctx.pieza('enlaces', {
        tipo: 'enlace', titulo: `${/instagram\.com\/(reel|p)\//.test(e.url) ? 'Reel' : 'Link'} de ${e.quien} · ${e.fecha}`, contenido: [e.url, e.contexto].filter(Boolean).join('\n'),
        url: e.url, fecha: e.fecha, origenId: `${origen}:link:${e.url}`, etiquetas: ['compartido', /instagram/.test(e.url) ? 'instagram' : 'link'],
        entidades: personas.get(e.quien) ? [personas.get(e.quien)!] : undefined,
      })
    }
  }
}

// ─── WhatsApp ───────────────────────────────────────────────────────────

/** Android: «31/12/26, 14:05 - Ana: hola». iOS: «[31/12/26, 14:05:33] Ana: hola». Las líneas siguientes son del mismo mensaje. */
export function leerWhatsApp(texto: string): Linea[] {
  const re = /^‎?\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}:\d{2})(?::\d{2})?\]?(?: -)? ([^:]{1,60}): ([\s\S]*)$/
  const out: Linea[] = []
  for (const linea of texto.replace(/\r/g, '').split('\n')) {
    const m = re.exec(linea)
    if (m) {
      const anio = m[3].length === 2 ? `20${m[3]}` : m[3]
      out.push({ fecha: `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, hora: m[4].padStart(5, '0'), quien: m[5].trim(), texto: m[6].trim() })
    } else if (out.length && linea.trim()) out[out.length - 1].texto += `\n${linea.trim()}`
  }
  return out.filter((l) => !/^<(Multimedia omitido|Media omitted)>$|^null$/.test(l.texto))
}

export const whatsapp: Importador = {
  id: 'whatsapp', nombre: 'Chat de WhatsApp',
  detectar: (d) => /\.txt$/i.test(d.nombre) && leerWhatsApp(d.texto.slice(0, 5000)).length >= 3,
  analizar: (d) => analisisChat('whatsapp', d.nombre, leerWhatsApp(d.texto), { id: 'whatsapp', nombre: 'WhatsApp' }),
  ejecutar: (d, ctx) => ejecutarChat(`whatsapp:${titulo(d.nombre)}`, d.nombre, leerWhatsApp(d.texto), ctx),
}

// ─── Instagram ──────────────────────────────────────────────────────────

/** Instagram exporta el texto como UTF-8 leído como Latin-1 («Ã¡»): se arregla. */
const arreglar = (s: string) => { try { return Buffer.from(s, 'latin1').toString('utf8') } catch { return s } }

export function leerInstagram(j: any): Linea[] {
  const out: Linea[] = []
  for (const m of j.messages ?? []) {
    const d = new Date(m.timestamp_ms ?? 0)
    const texto = [m.content ? arreglar(m.content) : '', m.share?.link ?? '', m.share?.share_text ? arreglar(m.share.share_text) : ''].filter(Boolean).join(' ').trim()
    if (!texto) continue
    out.push({ fecha: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, hora: d.toTimeString().slice(0, 5), quien: arreglar(m.sender_name ?? '?'), texto })
  }
  return out.reverse()
}

export const instagram: Importador = {
  id: 'instagram', nombre: 'Mensajes de Instagram',
  detectar: (d) => Array.isArray(d.json?.messages) && Array.isArray(d.json?.participants) && d.json.messages.some((m: any) => 'timestamp_ms' in m),
  analizar: (d) => analisisChat('instagram', d.json.title ? arreglar(d.json.title) : d.nombre, leerInstagram(d.json), { id: 'instagram', nombre: 'Instagram' }),
  ejecutar: (d, ctx) => ejecutarChat(`instagram:${d.json.thread_path ?? titulo(d.nombre)}`, d.json.title ? arreglar(d.json.title) : d.nombre, leerInstagram(d.json), ctx),
}

// ─── Claude y Gemini ────────────────────────────────────────────────────

export const claude: Importador = {
  id: 'claude', nombre: 'Exporte de Claude',
  detectar: (d) => Array.isArray(d.json) && d.json.some((c: any) => Array.isArray(c?.chat_messages)),
  analizar: (d) => ({
    importador: 'claude', titulo: 'Conversaciones de Claude', descripcion: `${d.json.length} conversaciones.`,
    segmentos: [{ id: 'conversaciones', nombre: 'Conversaciones', descripcion: 'Una pieza por conversación: lo que preguntaste y lo que te contestó.', nivel: 'investigacion', destino: 'corpus', cantidad: d.json.length, porDefecto: true }],
    fuente: { id: 'claude', nombre: 'Claude', nivel: 'investigacion', padreId: null }, nivelEditable: true, avisos: [],
  }),
  ejecutar(d, ctx) {
    for (const c of d.json) {
      const ms = (c.chat_messages ?? []).map((m: any) => `${m.sender === 'human' ? 'YO' : 'CLAUDE'}: ${m.text ?? (m.content ?? []).map((x: any) => x.text ?? '').join(' ')}`).filter((x: string) => x.length > 6)
      if (!ms.length) continue
      ctx.pieza('conversaciones', { nivel: ctx.opciones.nivel, titulo: `Claude · ${c.name || 'sin título'}`, contenido: ms.join('\n\n'), fecha: c.created_at ?? null, origenId: `claude:${c.uuid ?? c.name}`, etiquetas: ['claude'] })
    }
  },
}

export const gemini: Importador = {
  id: 'gemini', nombre: 'Actividad de Gemini (Takeout)',
  detectar: (d) => Array.isArray(d.json) && d.json.some((x: any) => /gemini|bard/i.test(String(x?.header ?? '')) && x?.title),
  analizar: (d) => {
    const xs = d.json.filter((x: any) => /gemini|bard/i.test(String(x?.header ?? '')))
    return {
      importador: 'gemini', titulo: 'Actividad de Gemini', descripcion: `${xs.length} pedidos.`,
      segmentos: [{ id: 'dias', nombre: 'Lo que le pediste, por día', descripcion: 'Una pieza por día con tus pedidos (tu voz).', nivel: 'propia', destino: 'corpus', cantidad: new Set(xs.map((x: any) => String(x.time).slice(0, 10))).size, porDefecto: true }],
      fuente: { id: 'gemini', nombre: 'Gemini', nivel: 'propia', padreId: null }, nivelEditable: true, avisos: [],
    }
  },
  ejecutar(d, ctx) {
    const xs = d.json.filter((x: any) => /gemini|bard/i.test(String(x?.header ?? '')))
    const dias = new Map<string, string[]>()
    for (const x of xs) dias.set(String(x.time).slice(0, 10), [...(dias.get(String(x.time).slice(0, 10)) ?? []), `[${String(x.time).slice(11, 16)}] ${String(x.title).replace(/^Prompted\s+|^Pediste\s+/i, '')}`])
    for (const [dia, ps] of dias) ctx.pieza('dias', { nivel: ctx.opciones.nivel, titulo: `Gemini · ${dia}`, contenido: ps.reverse().join('\n'), fecha: dia, origenId: `gemini:${dia}`, etiquetas: ['gemini'] })
  },
}

// ─── correo ─────────────────────────────────────────────────────────────

type Mail = { de: string; para: string; asunto: string; fecha: string; cuerpo: string; enviado: boolean }

/** «=?UTF-8?B?…?=» y «=?UTF-8?Q?…?=» → texto. */
function decodificarCabecera(s: string): string {
  return s.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, _cs, enc, t) => {
    try {
      return enc.toUpperCase() === 'B' ? Buffer.from(t, 'base64').toString('utf8') : Buffer.from(t.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m: string, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')
    } catch { return t }
  })
}

function cuerpoDe(crudo: string, cabeceras: string): string {
  const borde = /boundary="?([^";\r\n]+)"?/i.exec(cabeceras)?.[1]
  let texto = crudo
  let enc = /content-transfer-encoding:\s*([\w-]+)/i.exec(cabeceras)?.[1] ?? ''
  if (borde) {
    const partes = crudo.split(`--${borde}`)
    const plano = partes.find((p) => /content-type:\s*text\/plain/i.test(p)) ?? partes.find((p) => /content-type:\s*text\/html/i.test(p)) ?? ''
    const i = plano.search(/\r?\n\r?\n/)
    enc = /content-transfer-encoding:\s*([\w-]+)/i.exec(plano.slice(0, i))?.[1] ?? ''
    texto = plano.slice(i).trim()
    if (/content-type:\s*text\/html/i.test(plano.slice(0, i))) texto = texto.replace(/<[^>]+>/g, ' ')
  }
  if (/base64/i.test(enc)) { try { texto = Buffer.from(texto.replace(/\s+/g, ''), 'base64').toString('utf8') } catch { /* queda */ } }
  if (/quoted-printable/i.test(enc)) texto = Buffer.from(texto.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')
  return texto.replace(/\n>.*$/gm, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000)
}

export function leerCorreo(texto: string): Mail[] {
  const crudos = /^From .+\r?\n/m.test(texto) ? texto.split(/\r?\n(?=From .+\r?\n[A-Z][\w-]+:)/).map((m) => m.replace(/^From .+\r?\n/, '')) : [texto]
  return crudos.map((m) => {
    const i = m.search(/\r?\n\r?\n/)
    const cab = (i > 0 ? m.slice(0, i) : m).replace(/\r?\n[ \t]+/g, ' ')
    const h = (n: string) => decodificarCabecera(new RegExp(`^${n}:\\s*(.*)$`, 'im').exec(cab)?.[1]?.trim() ?? '')
    const f = new Date(h('Date'))
    return {
      de: h('From'), para: h('To'), asunto: h('Subject') || '(sin asunto)', fecha: Number.isNaN(f.getTime()) ? '' : f.toISOString().slice(0, 10),
      cuerpo: cuerpoDe(i > 0 ? m.slice(i) : '', cab), enviado: /(^|,)\s*(Sent|Enviados?)\s*(,|$)/i.test(h('X-Gmail-Labels')),
    }
  }).filter((x) => x.de || x.asunto !== '(sin asunto)')
}

export const correo: Importador = {
  id: 'correo', nombre: 'Correo (.mbox o .eml)',
  detectar: (d) => /\.(mbox|eml)$/i.test(d.nombre) || /^(Return-Path|Received|From|Delivered-To): /m.test(d.texto.slice(0, 2000)) && /^Subject: /m.test(d.texto.slice(0, 5000)),
  analizar(d) {
    const ms = leerCorreo(d.texto)
    const env = ms.filter((m) => m.enviado).length
    return {
      importador: 'correo', titulo: titulo(d.nombre), descripcion: `${ms.length} correos (${env} enviados por vos).`,
      segmentos: [
        { id: 'enviados', nombre: 'Los que mandaste', descripcion: 'Tu voz: entran como propios.', nivel: 'propia', destino: 'corpus', cantidad: env, porDefecto: true },
        { id: 'recibidos', nombre: 'Los que recibiste', descripcion: 'De otros: entran como fuente primaria.', nivel: 'primaria', destino: 'corpus', cantidad: ms.length - env, porDefecto: true },
      ],
      fuente: { id: 'correo', nombre: 'Correo', nivel: 'primaria', padreId: null }, nivelEditable: false,
      avisos: env ? [] : ['No encontré la marca de «Enviados» (Takeout la pone en X-Gmail-Labels): todos entran como recibidos.'],
    }
  },
  ejecutar(d, ctx) {
    for (const m of leerCorreo(d.texto)) {
      const seg = m.enviado ? 'enviados' : 'recibidos'
      if (!ctx.quiere(seg) || !m.cuerpo) continue
      ctx.pieza(seg, { titulo: `${m.asunto}${m.enviado ? ` → ${m.para}` : ` · de ${m.de}`}`.slice(0, 200), contenido: m.cuerpo, autor: m.de || null, fecha: m.fecha || null, origenId: `correo:${m.fecha}:${m.de}:${m.asunto}`.slice(0, 300), etiquetas: ['correo'] })
    }
  },
}
