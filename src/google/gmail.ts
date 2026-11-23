/**
 * Gmail (plan v35, fase 1). Al conectar trae los últimos 30 días; después, cada tanto, solo lo nuevo (el historial de
 * Gmail). Todo queda en la tabla `correos` (sin promociones, redes, foros ni spam en lo que se muestra) y las
 * conversaciones donde ÉL escribió entran al corpus: dicen cómo habla, con quién y de qué.
 *
 * Mastropiero lee, busca y arma borradores en su Gmail, en su tono. Nunca envía: el borrador queda para que él lo mande.
 */
import { ajuste, fijarAjuste, type Db } from '../db.ts'
import { ingerir } from '../mastropiero.ts'
import { asegurarFuente } from '../corpus.ts'
import { llamarGoogle, llamarGoogleCrudo } from './oauth.ts'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
/** Lo que no se muestra como correo para atender (queda guardado igual). */
const RUIDO = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'SPAM', 'TRASH'])

export type Correo = {
  id: string; hilo: string; de: string; para: string; asunto: string; fecha: number; etiquetas: string[]
  extracto: string; cuerpo: string; leido: boolean; suyo: boolean; ruido: boolean; mensajeId: string | null
}

type Parte = { mimeType?: string; filename?: string; body?: { data?: string }; parts?: Parte[]; headers?: { name: string; value: string }[] }
type Mensaje = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Parte }

const deB64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

/** El texto de un mail: la parte text/plain (o el HTML sin etiquetas si no hay). */
export function textoDe(p: Parte | undefined): string {
  if (!p) return ''
  const planos: string[] = []
  const htmls: string[] = []
  const recorrer = (x: Parte) => {
    if (x.filename) return // adjunto
    if (x.mimeType === 'text/plain' && x.body?.data) planos.push(deB64(x.body.data))
    else if (x.mimeType === 'text/html' && x.body?.data) htmls.push(deB64(x.body.data))
    for (const h of x.parts ?? []) recorrer(h)
  }
  recorrer(p)
  if (planos.length) return planos.join('\n').trim()
  return htmls.join('\n')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim()
}

/** Lo que escribió, sin lo citado de mails anteriores («El … escribió:», líneas con «>»). */
export function sinCitas(t: string): string {
  const lineas = t.split('\n')
  const corte = lineas.findIndex((l, i) => {
    const t = l.trim()
    return /^(El|On) .{4,200}(escribió|wrote):$/.test(t) || /^-{2,}\s*(Mensaje original|Original Message)/i.test(t) ||
      (/^(De|From): /.test(t) && lineas.slice(i + 1, i + 4).some((x) => /^(Enviado|Sent|Fecha|Date): /.test(x.trim())))
  })
  return (corte > 0 ? lineas.slice(0, corte) : lineas).filter((l) => !l.startsWith('>')).join('\n').trim()
}

export function correoDe(m: Mensaje): Correo {
  const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? ''
  const etiquetas = m.labelIds ?? []
  return {
    id: m.id, hilo: m.threadId, de: h('From'), para: h('To'), asunto: h('Subject') || '(sin asunto)',
    fecha: Number(m.internalDate) || Date.parse(h('Date')) || Date.now(), etiquetas,
    extracto: (m.snippet ?? '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    cuerpo: textoDe(m.payload).slice(0, 20_000), leido: !etiquetas.includes('UNREAD'), suyo: etiquetas.includes('SENT'),
    ruido: etiquetas.some((e) => RUIDO.has(e)), mensajeId: h('Message-ID') || h('Message-Id') || null,
  }
}

function guardar(db: Db, c: Correo) {
  db.prepare(`INSERT INTO correos (id, hilo, de, para, asunto, fecha, etiquetas, extracto, cuerpo, leido, suyo, ruido, mensaje_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET etiquetas = excluded.etiquetas, leido = excluded.leido, ruido = excluded.ruido`)
    .run(c.id, c.hilo, c.de, c.para, c.asunto, c.fecha, c.etiquetas.join(' '), c.extracto, c.cuerpo, c.leido ? 1 : 0, c.suyo ? 1 : 0, c.ruido ? 1 : 0, c.mensajeId)
}

/** Lo que él escribió va al corpus, con el mail al que respondía (el contexto de la charla). */
function alCorpus(db: Db, c: Correo) {
  if (!c.suyo) return
  const propio = sinCitas(c.cuerpo)
  if (propio.length < 20) return
  const previo = db.prepare(`SELECT de, cuerpo FROM correos WHERE hilo = ? AND fecha < ? AND suyo = 0 ORDER BY fecha DESC LIMIT 1`).get(c.hilo, c.fecha) as { de: string; cuerpo: string } | undefined
  const contenido = `Le escribió a ${c.para} · ${c.asunto}\n\n${propio}${previo ? `\n\n— En respuesta a ${previo.de}:\n${sinCitas(previo.cuerpo).slice(0, 2500)}` : ''}`
  try {
    asegurarFuente(db, { id: 'gmail', nombre: 'Sus mails', nivel: 'propia', descripcion: 'Lo que él escribió por mail (Gmail), con el mail al que respondía.' })
    ingerir(db, { fuente: 'gmail', titulo: `Mail · ${c.asunto}`.slice(0, 160), contenido, fecha: new Date(c.fecha).toISOString().slice(0, 10), url: `https://mail.google.com/mail/u/0/#all/${c.id}`, origenId: `gmail:${c.id}`, dominio: 'correo', por: 'gmail' })
  } catch (e) { if (!/ya está|existe/i.test(String(e))) console.error('  gmail → corpus:', e instanceof Error ? e.message : e) }
}

async function traer(db: Db, ids: string[]): Promise<number> {
  let n = 0
  const existe = db.prepare('SELECT 1 FROM correos WHERE id = ?')
  const nuevos = ids.filter((id) => !existe.get(id))
  for (let i = 0; i < nuevos.length; i += 5) {
    const lote = await Promise.all(nuevos.slice(i, i + 5).map((id) => llamarGoogle<Mensaje>(db, `${API}/messages/${id}?format=full`).catch(() => null)))
    for (const m of lote) {
      if (!m) continue
      const c = correoDe(m)
      if (c.etiquetas.includes('SPAM') || c.etiquetas.includes('TRASH')) continue
      guardar(db, c)
      // Una respuesta suya cierra lo anterior de ese hilo (Fragua #317): no se le vuelve a proponer contestarlo.
      if (c.suyo) db.prepare('UPDATE correos SET atendido = 1 WHERE hilo = ? AND suyo = 0 AND fecha < ?').run(c.hilo, c.fecha)
      alCorpus(db, c)
      n++
    }
  }
  return n
}

let sincronizando = false

/** Trae lo nuevo. La primera vez (o si el historial venció), los últimos `dias`. */
export async function sincronizarGmail(db: Db, o: { dias?: number; max?: number } = {}): Promise<{ nuevos: number; completo: boolean }> {
  if (sincronizando) return { nuevos: 0, completo: false }
  sincronizando = true
  try {
    const desde = ajuste(db, 'gmail_historia')
    if (desde) {
      try {
        const ids = new Set<string>()
        const cambios: { id: string; agregar?: string[]; sacar?: string[] }[] = []
        let pagina: string | undefined
        let ultima = desde
        do {
          const r = await llamarGoogle<any>(db, `${API}/history?startHistoryId=${desde}&maxResults=500${pagina ? `&pageToken=${pagina}` : ''}`)
          for (const h of r.history ?? []) {
            for (const a of h.messagesAdded ?? []) ids.add(a.message.id)
            for (const a of h.labelsAdded ?? []) cambios.push({ id: a.message.id, agregar: a.labelIds })
            for (const a of h.labelsRemoved ?? []) cambios.push({ id: a.message.id, sacar: a.labelIds })
          }
          ultima = r.historyId ?? ultima
          pagina = r.nextPageToken
        } while (pagina)
        const nuevos = await traer(db, [...ids])
        // Leído / no leído y demás etiquetas, sin volver a bajar el mail.
        for (const ch of cambios) {
          const f = db.prepare('SELECT etiquetas FROM correos WHERE id = ?').get(ch.id) as { etiquetas: string } | undefined
          if (!f) continue
          const et = new Set(f.etiquetas.split(' ').filter(Boolean))
          for (const x of ch.agregar ?? []) et.add(x)
          for (const x of ch.sacar ?? []) et.delete(x)
          db.prepare('UPDATE correos SET etiquetas = ?, leido = ?, ruido = ? WHERE id = ?').run([...et].join(' '), et.has('UNREAD') ? 0 : 1, [...et].some((e) => RUIDO.has(e)) ? 1 : 0, ch.id)
        }
        fijarAjuste(db, 'gmail_historia', String(ultima))
        fijarAjuste(db, 'gmail_sincronizado', String(Date.now()))
        return { nuevos, completo: false }
      } catch (e) {
        if ((e as { status?: number }).status !== 404) throw e
        // El historial venció (pasó mucho sin sincronizar): de nuevo la ventana completa.
      }
    }
    const perfil = await llamarGoogle<{ historyId: string }>(db, `${API}/profile`)
    const ids: string[] = []
    let pagina: string | undefined
    const max = o.max ?? 400
    do {
      const r = await llamarGoogle<any>(db, `${API}/messages?q=${encodeURIComponent(`newer_than:${o.dias ?? 30}d -in:spam -in:trash`)}&maxResults=100${pagina ? `&pageToken=${pagina}` : ''}`)
      for (const m of r.messages ?? []) ids.push(m.id)
      pagina = r.nextPageToken
    } while (pagina && ids.length < max)
    // De lo más viejo a lo más nuevo: así cada respuesta suya encuentra el mail al que respondía.
    const nuevos = await traer(db, ids.slice(0, max).reverse())
    fijarAjuste(db, 'gmail_historia', perfil.historyId)
    fijarAjuste(db, 'gmail_sincronizado', String(Date.now()))
    return { nuevos, completo: true }
  } finally {
    sincronizando = false
  }
}

const fila = (r: any) => ({ id: r.id, hilo: r.hilo, de: r.de, para: r.para, asunto: r.asunto, fecha: new Date(r.fecha).toISOString(), leido: !!r.leido, suyo: !!r.suyo, extracto: r.extracto })

/** Si él ya contestó ese mail (una respuesta suya después, en el mismo hilo): cuándo y qué dijo. */
function contestadoDe(db: Db, r: { hilo: string; fecha: number; suyo: number }) {
  if (r.suyo) return null
  const x = db.prepare('SELECT fecha, cuerpo FROM correos WHERE hilo = ? AND suyo = 1 AND fecha > ? ORDER BY fecha DESC LIMIT 1').get(r.hilo, r.fecha) as { fecha: number; cuerpo: string } | undefined
  return x ? { fecha: new Date(x.fecha).toISOString(), dijo: sinCitas(x.cuerpo).slice(0, 200) } : null
}

/** Su bandeja: lo que le llegó (sin ruido), lo no leído primero. */
export function verMails(db: Db, o: { noLeidos?: boolean; dias?: number; limite?: number } = {}) {
  const desde = Date.now() - (o.dias ?? 7) * 86_400_000
  const filas = db.prepare(`SELECT * FROM correos WHERE suyo = 0 AND ruido = 0 AND fecha >= ? AND etiquetas LIKE '%INBOX%' ${o.noLeidos ? 'AND leido = 0' : ''} ORDER BY leido, fecha DESC LIMIT ?`).all(desde, Math.min(o.limite ?? 25, 100))
  const total = db.prepare(`SELECT COUNT(*) AS n FROM correos WHERE suyo = 0 AND ruido = 0 AND leido = 0 AND etiquetas LIKE '%INBOX%'`).get() as { n: number }
  return { no_leidos: total.n, sincronizado: Number(ajuste(db, 'gmail_sincronizado')) || null, correos: (filas as any[]).map((r) => { const ya = contestadoDe(db, r); return { ...fila(r), ...(ya ? { ya_contestado: ya } : {}) } }) }
}

/** Buscar en su Gmail en vivo, con la sintaxis de Gmail (from:, subject:, has:attachment, newer_than:…). */
export async function buscarMails(db: Db, q: string, limite = 10) {
  const r = await llamarGoogle<any>(db, `${API}/messages?q=${encodeURIComponent(q)}&maxResults=${Math.min(limite, 25)}`)
  const ms = await Promise.all((r.messages ?? []).map((m: { id: string }) => llamarGoogle<Mensaje>(db, `${API}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`).catch(() => null)))
  return ms.filter(Boolean).map((m) => { const c = correoDe(m as Mensaje); return { id: c.id, hilo: c.hilo, de: c.de, para: c.para, asunto: c.asunto, fecha: new Date(c.fecha).toISOString(), extracto: c.extracto } })
}

/** Un mail entero (de lo guardado o, si no está, de Gmail). */
export async function leerMail(db: Db, id: string) {
  let r = db.prepare('SELECT * FROM correos WHERE id = ?').get(id) as any
  if (!r) {
    const c = correoDe(await llamarGoogle<Mensaje>(db, `${API}/messages/${encodeURIComponent(id)}?format=full`))
    guardar(db, c)
    r = db.prepare('SELECT * FROM correos WHERE id = ?').get(id)
  }
  // El hilo entero (Fragua #317): lo de él también, no solo el último de la contraparte.
  const hilo = (db.prepare('SELECT id, de, fecha, suyo, cuerpo FROM correos WHERE hilo = ? ORDER BY fecha').all(r.hilo) as any[])
    .map((x) => ({ id: x.id, de: x.suyo ? 'él' : x.de, fecha: new Date(x.fecha).toISOString(), texto: sinCitas(x.cuerpo).slice(0, x.id === r.id ? 0 : 600) }))
  const ya = contestadoDe(db, r)
  return { ...fila(r), cuerpo: r.cuerpo, link: `https://mail.google.com/mail/u/0/#all/${r.id}`, ...(hilo.length > 1 ? { hilo } : {}), ...(ya ? { ya_contestado: ya } : {}) }
}

const encabezado = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`)

/** El mail en crudo (RFC 822) para Gmail. */
export type Adjunto = { nombre: string; mime: string; datos: Buffer }
const en76 = (b: Buffer) => b.toString('base64').replace(/.{76}/g, '$&\r\n')

export function mimeDe(d: { para: string; asunto: string; cuerpo: string; enRespuestaA?: string | null; adjuntos?: Adjunto[] }): string {
  const cabecera = [
    `To: ${d.para}`,
    `Subject: ${encabezado(d.asunto)}`,
    'MIME-Version: 1.0',
    ...(d.enRespuestaA ? [`In-Reply-To: ${d.enRespuestaA}`, `References: ${d.enRespuestaA}`] : []),
  ]
  if (!d.adjuntos?.length) {
    return [...cabecera, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', en76(Buffer.from(d.cuerpo, 'utf8'))].join('\r\n')
  }
  // Con adjuntos (Fragua #338): multipart/mixed, el texto primero y cada archivo como adjunto.
  const limite = `deprocast-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const partes = [
    [`--${limite}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', en76(Buffer.from(d.cuerpo, 'utf8'))].join('\r\n'),
    ...d.adjuntos.map((a) => {
      const nombre = encabezado(a.nombre).replace(/"/g, '')
      return [`--${limite}`, `Content-Type: ${a.mime}; name="${nombre}"`, `Content-Disposition: attachment; filename="${nombre}"`, 'Content-Transfer-Encoding: base64', '', en76(a.datos)].join('\r\n')
    }),
  ]
  return [...cabecera, `Content-Type: multipart/mixed; boundary="${limite}"`, '', ...partes, `--${limite}--`, ''].join('\r\n')
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files'
/** Los de Google (Docs, Sheets, Slides, dibujos) no son archivos: se mandan como PDF. */
const COMO_PDF = /^application\/vnd\.google-apps\.(document|spreadsheet|presentation|drawing)$/
/** Gmail deja hasta 25 MB por mail; el base64 lo infla un tercio. */
export const TOPE_ADJUNTOS = 18 * 1024 * 1024

/** Un archivo de su Drive (link o id) listo para adjuntar; un Google Doc, Sheet o Slide sale como PDF. */
export async function adjuntoDeDrive(db: Db, entrada: string): Promise<Adjunto> {
  const { idDeArchivo } = await import('./drive.ts')
  const id = idDeArchivo(entrada)
  const meta = await llamarGoogle<{ name: string; mimeType: string; size?: string }>(db, `${DRIVE}/${encodeURIComponent(id)}?fields=name,mimeType,size&supportsAllDrives=true`)
  if (meta.mimeType === 'application/vnd.google-apps.folder') throw new Error(`«${meta.name}» es una carpeta: adjuntá los archivos de adentro.`)
  if (COMO_PDF.test(meta.mimeType)) {
    const datos = await llamarGoogleCrudo(db, `${DRIVE}/${encodeURIComponent(id)}/export?mimeType=application%2Fpdf`)
    return { nombre: /\.pdf$/i.test(meta.name) ? meta.name : `${meta.name}.pdf`, mime: 'application/pdf', datos }
  }
  if (/^application\/vnd\.google-apps\./.test(meta.mimeType)) throw new Error(`«${meta.name}» es un archivo de Google que no se puede pasar a PDF: mandá el link en el cuerpo.`)
  if (Number(meta.size) > TOPE_ADJUNTOS) throw new Error(`«${meta.name}» pesa más de lo que Gmail deja adjuntar: mandá el link en el cuerpo.`)
  return { nombre: meta.name, mime: meta.mimeType || 'application/octet-stream', datos: await llamarGoogleCrudo(db, `${DRIVE}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`) }
}

/** Un borrador en su Gmail (nunca se envía). Si responde a un mail, va en el mismo hilo. */
export async function crearBorrador(db: Db, d: { para?: string; asunto?: string; cuerpo: string; responderA?: string | null; adjuntos?: string[] | null }) {
  let para = d.para?.trim() ?? ''
  let asunto = d.asunto?.trim() ?? ''
  let hilo: string | undefined
  let enRespuestaA: string | null = null
  if (d.responderA) {
    const o = await leerMail(db, d.responderA)
    const r = db.prepare('SELECT mensaje_id FROM correos WHERE id = ?').get(d.responderA) as { mensaje_id: string | null } | undefined
    hilo = o.hilo
    enRespuestaA = r?.mensaje_id ?? null
    para ||= o.de
    asunto ||= /^re:/i.test(o.asunto) ? o.asunto : `Re: ${o.asunto}`
  }
  if (!para) throw new Error('¿A quién? Falta el destinatario.')
  if (!d.cuerpo.trim()) throw new Error('El borrador está vacío.')
  // Los adjuntos de Drive (Fragua #338): se bajan (los Docs como PDF) antes de armar el borrador; si uno falla, no se arma.
  const adjuntos: Adjunto[] = []
  for (const x of (d.adjuntos ?? []).filter((y) => String(y ?? '').trim())) adjuntos.push(await adjuntoDeDrive(db, String(x)))
  const peso = adjuntos.reduce((s, a) => s + a.datos.length, 0)
  if (peso > TOPE_ADJUNTOS) throw new Error(`Los adjuntos suman ${Math.round(peso / 1024 / 1024)} MB y Gmail no deja más de 25 por mail: mandá alguno como link en el cuerpo.`)
  const mime = mimeDe({ para, asunto: asunto || '(sin asunto)', cuerpo: d.cuerpo, enRespuestaA, adjuntos })
  let r: any
  if (mime.length < 4_000_000) {
    r = await llamarGoogle<any>(db, `${API}/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: { raw: Buffer.from(mime).toString('base64url'), ...(hilo ? { threadId: hilo } : {}) } }) })
  } else {
    // Grande: por la subida de Gmail (multipart: el hilo en el JSON, el mail entero aparte).
    const limite = `subida-${Date.now().toString(36)}`
    const cuerpo = [`--${limite}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ message: hilo ? { threadId: hilo } : {} }), `--${limite}`, 'Content-Type: message/rfc822', '', mime, `--${limite}--`, ''].join('\r\n')
    r = await llamarGoogle<any>(db, `https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?uploadType=multipart`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${limite}` }, body: cuerpo })
  }
  return { borrador: r.id, para, asunto, ...(adjuntos.length ? { adjuntos: adjuntos.map((a) => a.nombre) } : {}), link: 'https://mail.google.com/mail/u/0/#drafts', nota: `Quedó como borrador en tu Gmail${adjuntos.length ? ` con ${adjuntos.length === 1 ? 'el adjunto' : `${adjuntos.length} adjuntos`}` : ''}: revisalo y mandalo vos.` }
}

export function estadoGmail(db: Db) {
  const n = db.prepare(`SELECT COUNT(*) AS total, SUM(suyo) AS suyos, SUM(CASE WHEN leido = 0 AND ruido = 0 AND suyo = 0 AND etiquetas LIKE '%INBOX%' THEN 1 ELSE 0 END) AS no_leidos FROM correos`).get() as { total: number; suyos: number | null; no_leidos: number | null }
  return { correos: n.total, suyos: n.suyos ?? 0, noLeidos: n.no_leidos ?? 0, sincronizado: Number(ajuste(db, 'gmail_sincronizado')) || null }
}
