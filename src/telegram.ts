/**
 * El canal de Telegram: Mastropiero en el bolsillo. Texto, audios (Whisper) y fotos (visión) entran a la conversación
 * de Hoy y lo que contesta vuelve por acá, con formato; lo que dice solo (saludo, alertas, reportes) también, y cada
 * banda de la run llega sola con botones para marcarla. Además: comandos para lo rápido (/gasto, /nota, /bitacora,
 * /buscar), la criba y las preguntas con botones, links que entran al corpus, archivos que se cargan (un chat de
 * WhatsApp exportado, el CSV del banco) y, si querés, las respuestas también en audio.
 * Sin URL pública: el servidor le pregunta a Telegram si hay mensajes (long polling). Solo atiende a su chat
 * (TELEGRAM_CHAT_ID): a cualquier otro le dice su id y nada más.
 */
import fs from 'node:fs'
import { ajuste, fechaLocal, fijarAjuste, type Db } from './db.ts'
import { conversacionHoy, enviar, estaPensando, mensajes } from './chat/index.ts'
import { nanTranscribir, nanVision } from './nan.ts'
import { arrancarRun, conAvance, enCurso, listarMisiones, listarRuns, marcarSecundaria, misionesDeRun, semanaDe } from './misiones.ts'
import { progreso } from './jornada.ts'
import { ingerir } from './mastropiero.ts'
import { registrarMovimiento, resumenMes, importarCSV } from './finanzas.ts'
import { escribir } from './bitacora.ts'
import { buscarHibrido } from './semantica.ts'
import { cribar, marcador, siguiente } from './criba.ts'
import { responderPregunta, siguientePregunta } from './preguntas.ts'
import { descartar, ejecutar, leerCarga, subir } from './cargas/index.ts'
import { sintetizar } from './taller.ts'
import { brujulaDelDia, textoDeBrujula } from './brujula.ts'
import { recomendar } from './mentor.ts'

const api = (metodo: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`

let pedir = async (metodo: string, cuerpo: Record<string, unknown>): Promise<any> => {
  const r = await fetch(api(metodo), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(65_000) })
  return r.json()
}
/** Para mandar un archivo (el audio de la respuesta): multipart. */
let mandarArchivo = async (metodo: string, campos: Record<string, string>, campo: string, datos: Buffer, nombre: string): Promise<any> => {
  const form = new FormData()
  for (const [k, v] of Object.entries(campos)) form.append(k, v)
  form.append(campo, new Blob([new Uint8Array(datos)]), nombre)
  const r = await fetch(api(metodo), { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
  return r.json()
}
let bajar = async (fileId: string): Promise<{ datos: Buffer; nombre: string }> => {
  const f = await pedir('getFile', { file_id: fileId })
  if (!f.ok) throw new Error(`Telegram getFile: ${f.description}`)
  const r = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.result.file_path}`)
  return { datos: Buffer.from(await r.arrayBuffer()), nombre: String(f.result.file_path).split('/').pop() ?? 'archivo' }
}
let transcribir = (db: Db, audio: Buffer, nombre: string) => nanTranscribir(db, audio, nombre)
let ver = async (db: Db, imagen: Buffer) => (await nanVision({ db, clase: 'mastropiero', agenteId: 'telegram' }, {
  sistema: 'Describí la imagen con detalle útil (qué es, texto visible, contexto), en castellano rioplatense, en 2 a 5 oraciones.', texto: 'Te mandaron esta foto:', imagen: `data:image/jpeg;base64,${imagen.toString('base64')}`,
})).texto
let hablar = (texto: string) => sintetizar(texto, 'em_alex')
export function _probarTelegram(o: { pedir?: typeof pedir; bajar?: typeof bajar; transcribir?: typeof transcribir; ver?: typeof ver; mandarArchivo?: typeof mandarArchivo; hablar?: typeof hablar }) {
  if (o.pedir) pedir = o.pedir
  if (o.bajar) bajar = o.bajar
  if (o.transcribir) transcribir = o.transcribir
  if (o.ver) ver = o.ver
  if (o.mandarArchivo) mandarArchivo = o.mandarArchivo
  if (o.hablar) hablar = o.hablar
}

export const telegramConfigurado = () => !!process.env.TELEGRAM_BOT_TOKEN
const suChat = () => process.env.TELEGRAM_CHAT_ID?.trim() || null

const estado = { escuchando: false, ultimoMensaje: null as number | null, ultimoError: null as string | null }
export const estadoTelegram = () => ({ configurado: telegramConfigurado(), chat: !!suChat(), ...estado })

// ─── formato ────────────────────────────────────────────────────────────

/** Markdown de Mastropiero → el HTML que entiende Telegram (negritas, cursivas, código, links, títulos, viñetas). */
export function aHtml(md: string): string {
  let s = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  s = s.replace(/```[a-z]*\n?([\s\S]*?)```/g, (_, c) => `<pre>${c}</pre>`)
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/gm, '$1<i>$2</i>')
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/gm, '$1<i>$2</i>')
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
  s = s.replace(/^(\s*)[-*] /gm, '$1• ')
  return s
}
const sinMarcas = (md: string) => md.replace(/\[#\d+\]/g, '').replace(/[*_`#]+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

/** Corta en pedazos de hasta ~3.500 caracteres por párrafos (el límite de Telegram es 4.096, y el HTML suma). */
function pedazos(texto: string, max = 3500): string[] {
  const out: string[] = []
  let actual = ''
  for (const p of texto.split(/\n{2,}/)) {
    if ((actual + '\n\n' + p).length > max && actual) { out.push(actual); actual = '' }
    actual = actual ? `${actual}\n\n${p}` : p
    while (actual.length > max) { out.push(actual.slice(0, max)); actual = actual.slice(max) }
  }
  if (actual.trim()) out.push(actual)
  return out
}

type Botones = { texto: string; dato: string }[][]
const teclado = (b?: Botones) => (b ? { reply_markup: { inline_keyboard: b.map((f) => f.map((x) => ({ text: x.texto, callback_data: x.dato }))) } } : {})

/** Manda un texto a su chat, con formato y botones opcionales. Devuelve el id del último mensaje. */
export async function decir(texto: string, botones?: Botones): Promise<number | null> {
  const chat = suChat()
  if (!telegramConfigurado() || !chat || !texto.trim()) return null
  const partes = pedazos(texto.replace(/\[#\d+\]/g, '').trim())
  let id: number | null = null
  for (const [i, p] of partes.entries()) {
    const extra = i === partes.length - 1 ? teclado(botones) : {}
    let r = await pedir('sendMessage', { chat_id: chat, text: aHtml(p), parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
    if (r && r.ok === false) r = await pedir('sendMessage', { chat_id: chat, text: sinMarcas(p), ...extra }) // HTML que no le gustó: va plano
    id = r?.result?.message_id ?? id
  }
  return id
}

async function editar(mensajeId: number, texto: string, botones?: Botones) {
  const r = await pedir('editMessageText', { chat_id: suChat(), message_id: mensajeId, text: aHtml(texto), parse_mode: 'HTML', disable_web_page_preview: true, ...teclado(botones) })
  if (r && r.ok === false) await decir(texto, botones)
}

// ─── la run ─────────────────────────────────────────────────────────────

const botonesBanda = (id: number): Botones => [[{ texto: '✓ Hecha', dato: `m:${id}:hecha` }, { texto: '◐ A medias', dato: `m:${id}:parcial` }, { texto: '✗ No', dato: `m:${id}:no` }]]

/** La banda que toca ahora, con botones para marcarla. */
async function bandaActual(db: Db) {
  const v = enCurso(db)
  if (!v) {
    const prop = listarRuns(db, { fecha: fechaLocal(), estados: ['propuesta'] })[0]
    if (prop) return decir(`No hay una run en curso. Tenés una propuesta para hoy: **${prop.inicio}–${prop.fin}**, ${misionesDeRun(db, prop.id).length} bandas.`, [[{ texto: '▶ Arrancarla', dato: `r:${prop.id}:arrancar` }]])
    return decir('No hay una run en curso. Pedime una («armame una run de dos horas para…»).')
  }
  if (!v.actual) return decir(`Run ${v.run.inicio}–${v.run.fin}: estás entre bandas.${v.siguientes[0] ? ` Lo que sigue: ${v.siguientes[0].inicio} ${v.siguientes[0].titulo}` : ''}`)
  const sigue = v.siguientes[0] ? `\n_Después: ${v.siguientes[0].inicio} ${v.siguientes[0].titulo}_` : ''
  return decir(`**${v.actual.inicio}–${v.actual.fin} · ${v.actual.titulo}**${v.actual.detalle ? `\n${v.actual.detalle}` : ''}\nTe quedan ${v.restan} min.${sigue}`, botonesBanda(v.actual.id))
}

let ultimaBanda: number | null = null
/** Cada minuto: si arrancó una banda nueva, se la manda sola (con botones). */
export async function latidoTelegram(db: Db) {
  if (!telegramConfigurado() || !suChat() || ajuste(db, 'telegram_bandas') === '0') return
  const v = enCurso(db)
  const id = v?.actual?.id ?? null
  if (id && id !== ultimaBanda) { ultimaBanda = id; await bandaActual(db) }
  if (!id) ultimaBanda = null
}

// ─── conversar ──────────────────────────────────────────────────────────

/** Lo que dice él → la conversación de Hoy → la respuesta de Mastropiero vuelve por Telegram (y en audio, si quiere). */
async function conversar(db: Db, texto: string, o: { porVoz?: boolean } = {}) {
  const c = conversacionHoy(db)
  if (estaPensando(c.id)) return decir('Esperá, todavía estoy contestando lo anterior.')
  const desde = mensajes(db, c.id).at(-1)?.id ?? 0
  await pedir('sendChatAction', { chat_id: suChat(), action: 'typing' }).catch(() => {})
  await enviar(db, c.id, texto)
  const respuesta = mensajes(db, c.id, desde).filter((m) => m.rol === 'asistente' && m.texto).map((m) => m.texto).join('\n\n')
  const error = mensajes(db, c.id, desde).find((m) => m.rol === 'error')
  await decir(respuesta || (error ? `No pude: ${error.texto}` : 'Listo.'))
  const voz = ajuste(db, 'telegram_voz') ?? '0'
  if (respuesta && (voz === 'siempre' || (voz === '1' && o.porVoz))) {
    try {
      await pedir('sendChatAction', { chat_id: suChat(), action: 'upload_voice' }).catch(() => {})
      await mandarArchivo('sendAudio', { chat_id: suChat()!, title: 'Mastropiero' }, 'audio', await hablar(sinMarcas(respuesta).slice(0, 2500)), 'mastropiero.mp3')
    } catch { /* el texto ya llegó */ }
  }
}

// ─── criba y preguntas ──────────────────────────────────────────────────

const salteadas: number[] = []
function cartaCriba(db: Db): { texto: string; botones?: Botones } {
  const p = siguiente(db, { saltear: salteadas.slice(-50) })
  const m = marcador(db)
  if (!p) return { texto: `No queda nada para cribar. 🎉 (${m.cribadas} pesadas)` }
  const c = (peso: number | 's', t?: string) => ({ texto: t ?? String(peso), dato: `c:${p.id}:${peso}` })
  return {
    texto: `**${p.titulo}**${p.url ? `\n${p.url}` : ''}\n${p.contenido.slice(0, 700)}${p.contenido.length > 700 ? '…' : ''}\n\n_Hoy ${m.hoy} · racha ${m.racha} · faltan ${m.faltan}_`,
    botones: [[c(0, '✕'), c(1), c(2), c(3), c(4), c(5), c(6)], [c(7), c(8), c(9), c(10), c(11), c(12), c('s', '⏭')]],
  }
}

/** mensaje de Telegram → id de la pregunta, para que responder «a ese mensaje» la conteste. */
const preguntasEnviadas = new Map<number, number>()
async function mandarPregunta(db: Db) {
  const q = siguientePregunta(db)
  if (!q) return decir('No tengo preguntas pendientes por ahora.')
  const botones: Botones = [...(q.opciones.length ? [q.opciones.slice(0, 6).map((op, i) => ({ texto: op.slice(0, 40), dato: `p:${q.id}:${i}` }))] : []), [{ texto: 'Saltear', dato: `p:${q.id}:s` }]]
  const id = await decir(`❓ ${q.texto}${q.porQue ? `\n_${q.porQue}_` : ''}\n\n_Respondé a este mensaje para contestar con tus palabras._`, botones)
  if (id) preguntasEnviadas.set(id, q.id)
}

// ─── comandos ───────────────────────────────────────────────────────────

export const COMANDOS = [
  ['hoy', 'Cómo viene el día'], ['run', 'La banda que toca ahora (o arrancar la propuesta)'], ['gasto', 'Anotar un gasto: /gasto 12,5 súper'],
  ['ingreso', 'Anotar un ingreso: /ingreso 800 freelance'], ['nota', 'Guardar algo sin charlar'], ['bitacora', 'Escribir en tu bitácora (privada)'],
  ['brujula', 'El tridente del día'], ['mentor', 'Qué leer o ver ahora'], ['buscar', 'Buscar en tu corpus'], ['criba', 'Pesar piezas con botones'], ['pregunta', 'Que Mastropiero te pregunte algo'], ['voz', 'Respuestas también en audio: sí / no'], ['ayuda', 'Qué sé hacer'],
] as const

function resumenHoy(db: Db): string {
  const fecha = fechaLocal()
  const p = progreso(db, fecha)
  const v = enCurso(db)
  const prims = conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(), estados: ['activa', 'hecha', 'parcial'] }))
  const sq = listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria', abiertas: true }).length
  const plata = resumenMes(db)
  const pq = siguientePregunta(db)
  return [
    `**Hoy, ${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}**`,
    v ? `Run en curso ${v.run.inicio}–${v.run.fin}${v.actual ? `: ahora «${v.actual.titulo}» (${v.restan} min)` : ''}.` : listarRuns(db, { fecha, estados: ['propuesta'] }).length ? 'Tenés una run propuesta sin arrancar (/run).' : 'Sin run por ahora.',
    p.total ? `Bandas: ${p.hechos} hechas, ${p.parciales} a medias, ${p.saltados} no, de ${p.total}.` : '',
    prims.length ? `Primarias de la semana:\n${prims.map((m) => `• ${m.titulo} (${m.avance.progreso}%)${m.estado === 'hecha' ? ' ✓' : ''}`).join('\n')}` : '',
    sq ? `${sq} side quest${sq > 1 ? 's' : ''} abierta${sq > 1 ? 's' : ''}.` : '',
    plata.movimientos ? `Plata del mes: entró ${plata.ingresos} €, salió ${plata.gastos} €${plata.meta ? ` (meta ${plata.avanceMeta}%)` : ''}.` : '',
    pq ? 'Tengo una pregunta para vos (/pregunta).' : '',
  ].filter(Boolean).join('\n')
}

async function comando(db: Db, cmd: string, resto: string) {
  switch (cmd) {
    case '/start': case '/ayuda': case '/help':
      return decir(`Acá estoy. Escribime, mandame audios, fotos, links o archivos (un chat de WhatsApp exportado, el CSV del banco).\n\n${COMANDOS.map(([c, d]) => `/${c} — ${d}`).join('\n')}`)
    case '/hoy': return decir(resumenHoy(db))
    case '/run': case '/banda': case '/ahora': return bandaActual(db)
    case '/gasto': case '/ingreso': {
      const m = /^(-?[\d.,]+)\s*(?:€|eur|euros)?\s*(.*)$/i.exec(resto)
      const n = m ? Number(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : NaN
      if (!m || !Number.isFinite(n) || !n) return decir(`Así: ${cmd} 12,5 súper`)
      const mov = registrarMovimiento(db, { monto: cmd === '/gasto' ? -Math.abs(n) : Math.abs(n), descripcion: m[2] || (cmd === '/gasto' ? 'Gasto' : 'Ingreso'), origen: 'telegram' })
      const r = resumenMes(db)
      return decir(mov ? `Anotado: ${mov.monto} € · ${mov.descripcion} (${mov.categoria}). En el mes: entró ${r.ingresos} €, salió ${r.gastos} €.` : 'Ese ya estaba anotado.')
    }
    case '/nota': {
      if (!resto) return decir('Así: /nota lo que quieras guardar')
      ingerir(db, { fuente: 'operador', titulo: `Nota · ${resto.slice(0, 60)}`, contenido: resto, nivel: 'propia', dominio: 'telegram' })
      return decir('Guardada en tu corpus. ✓')
    }
    case '/bitacora': {
      if (!resto) return decir('Así: /bitacora lo que quieras escribir. Queda en tu bitácora, privada: no la lee ningún modelo.')
      escribir(db, { texto: resto })
      return decir('Escrito en tu bitácora. 🔒 Nadie más lo lee.')
    }
    case '/buscar': {
      if (!resto) return decir('Así: /buscar lo que quieras encontrar')
      const ps = await buscarHibrido(db, resto, 6)
      if (!ps.length) return decir('No encontré nada.')
      return decir(ps.map((p) => `**#${p.id} ${p.titulo}**\n${p.contenido.replace(/\s+/g, ' ').slice(0, 160)}…`).join('\n\n'))
    }
    case '/criba': { const c = cartaCriba(db); return decir(c.texto, c.botones) }
    case '/brujula': return decir(textoDeBrujula(await brujulaDelDia(db, { forzar: /^(de nuevo|otra|rehacer)/i.test(resto) })))
    case '/mentor': {
      const rs = await recomendar(db)
      return decir(rs.length ? `🧭 **El Mentor**\n${rs.map((r) => `• **${r.accion}**\n  ${r.porQue}`).join('\n')}` : 'No encontré nada en tu Librería que empuje lo de esta semana.')
    }
    case '/pregunta': case '/preguntas': return mandarPregunta(db)
    case '/voz': {
      const v = /^(no|off|0|apag)/i.test(resto) ? '0' : /^siempre/i.test(resto) ? 'siempre' : (ajuste(db, 'telegram_voz') ?? '0') === '0' || /^(s[ií]|on|1)/i.test(resto) ? '1' : '0'
      fijarAjuste(db, 'telegram_voz', v)
      return decir(v === '0' ? 'Listo: te contesto solo por escrito.' : v === 'siempre' ? 'Listo: te contesto siempre también en audio.' : 'Listo: cuando me mandes un audio, te contesto también en audio. (/voz siempre para todo, /voz no para apagarlo)')
    }
    default: return conversar(db, `${cmd.slice(1)} ${resto}`.trim())
  }
}

// ─── botones ────────────────────────────────────────────────────────────

async function boton(db: Db, q: any) {
  await pedir('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {})
  const [k, a, b] = String(q.data ?? '').split(':')
  const mensajeId = q.message?.message_id
  if (k === 'm') {
    const m = marcarSecundaria(db, Number(a), b as any)
    return decir(`Marcada «${m.titulo}» como ${b === 'parcial' ? 'a medias' : b}.`)
  }
  if (k === 'r' && b === 'arrancar') {
    arrancarRun(db, Number(a))
    ultimaBanda = null
    await decir('▶ Arrancó la run.')
    return latidoTelegram(db)
  }
  if (k === 'c') {
    if (b === 's') salteadas.push(Number(a))
    else cribar(db, Number(a), Number(b))
    const c = cartaCriba(db)
    return mensajeId ? editar(mensajeId, c.texto, c.botones) : decir(c.texto, c.botones)
  }
  if (k === 'p') {
    const pq = db.prepare('SELECT opciones FROM preguntas WHERE id = ?').get(Number(a)) as any
    const ops: string[] = pq?.opciones ? JSON.parse(pq.opciones) : []
    await responderPregunta(db, Number(a), b === 's' ? null : ops[Number(b)] ?? null)
    if (mensajeId) preguntasEnviadas.delete(mensajeId)
    await decir(b === 's' ? 'Salteada.' : `Anotado: ${ops[Number(b)]}.`)
    return siguientePregunta(db) ? mandarPregunta(db) : undefined
  }
  if (k === 'k') {
    const id = Number(a)
    if (b === 'ok') {
      const c = ejecutar(db, id, {})
      return decir(`Cargado: ${c.resumen?.piezas ?? 0} piezas nuevas${c.resumen?.repetidas ? ` (${c.resumen.repetidas} ya estaban)` : ''}${c.resumen?.entidades ? `, ${c.resumen.entidades} entidades` : ''}.`)
    }
    if (b === 'banco') {
      const ruta = (db.prepare('SELECT ruta FROM cargas WHERE id = ?').get(id) as any)?.ruta
      const crudo = fs.readFileSync(ruta)
      const utf = crudo.toString('utf8')
      const r = importarCSV(db, utf.includes('�') ? crudo.toString('latin1') : utf)
      descartar(db, id)
      return decir(`Extracto leído: ${r.nuevos} movimientos nuevos, ${r.repetidos} ya estaban.`)
    }
    descartar(db, id)
    return decir('Descartado.')
  }
}

// ─── archivos ───────────────────────────────────────────────────────────

async function archivo(db: Db, doc: any) {
  if ((doc.file_size ?? 0) > 20 * 1024 * 1024) return decir('Es más grande que lo que Telegram me deja bajar (20 MB). Subilo desde Corpus → Ingerir.')
  const { datos } = await bajar(doc.file_id)
  const nombre = String(doc.file_name ?? 'archivo')
  const esCsv = /\.csv$/i.test(nombre)
  let carga
  try { carga = subir(db, nombre, datos) } catch (e) {
    if (!esCsv) return decir(`No sé leer «${nombre}»: ${e instanceof Error ? e.message : e}`)
    const utf = datos.toString('utf8')
    const r = importarCSV(db, utf.includes('�') ? datos.toString('latin1') : utf)
    return decir(`Lo leí como extracto del banco: ${r.nuevos} movimientos nuevos, ${r.repetidos} ya estaban.`)
  }
  const a = leerCarga(db, carga.id)!.analisis!
  const segs = a.segmentos.filter((s) => s.porDefecto && s.cantidad).map((s) => `• ${s.nombre}: ${s.cantidad}`).join('\n')
  return decir(`📄 **${a.titulo}**\n${a.descripcion}${segs ? `\n${segs}` : ''}${a.avisos.length ? `\n_${a.avisos.join(' ')}_` : ''}`, [[
    { texto: '✓ Cargar', dato: `k:${carga.id}:ok` }, ...(esCsv ? [{ texto: '€ Es del banco', dato: `k:${carga.id}:banco` }] : []), { texto: '✕ Descartar', dato: `k:${carga.id}:no` },
  ]])
}

// ─── entrada ────────────────────────────────────────────────────────────

/** Una actualización de Telegram (mensaje o botón). */
export async function procesarActualizacion(db: Db, u: any): Promise<unknown> {
  const msg = u.message ?? u.edited_message
  const chatId = String(msg?.chat?.id ?? u.callback_query?.message?.chat?.id ?? '')
  if (!chatId) return
  if (!suChat()) {
    // Sin chat configurado: no atiende a nadie; le dice a quien escribe su id para que lo pongan en .env.
    await pedir('sendMessage', { chat_id: chatId, text: `Hola. Para que te atienda, poné en .env: TELEGRAM_CHAT_ID=${chatId} y reiniciá Mastropiero.` })
    return
  }
  if (chatId !== suChat()) return // otro: silencio
  estado.ultimoMensaje = Date.now()
  if (u.callback_query) return boton(db, u.callback_query)
  const texto: string | undefined = msg.text ?? msg.caption
  // Responder a una pregunta que mandó: la contesta.
  const aPregunta = msg.reply_to_message ? preguntasEnviadas.get(msg.reply_to_message.message_id) : undefined
  if (aPregunta && texto) {
    await responderPregunta(db, aPregunta, texto)
    preguntasEnviadas.delete(msg.reply_to_message.message_id)
    await decir('Anotado. ✓')
    return siguientePregunta(db) ? mandarPregunta(db) : undefined
  }
  if (texto?.startsWith('/')) {
    const [cmd] = texto.split(/\s+/)
    return comando(db, cmd.toLowerCase().replace(/@\w+$/, ''), texto.slice(cmd.length).trim())
  }
  if (msg.document) return archivo(db, msg.document)
  const voz = msg.voice ?? msg.audio
  if (voz) {
    const { datos, nombre } = await bajar(voz.file_id)
    const t = await transcribir(db, datos, nombre.endsWith('.oga') ? nombre.replace(/\.oga$/, '.ogg') : nombre)
    if (!t.trim()) return decir('No entendí el audio.')
    return conversar(db, t, { porVoz: true })
  }
  if (msg.photo?.length) {
    const { datos } = await bajar(msg.photo.at(-1).file_id)
    const descripcion = await ver(db, datos)
    return conversar(db, `(Te mandé una foto por Telegram. Lo que se ve: ${descripcion})${texto ? `\n${texto}` : ''}`)
  }
  if (texto) {
    // Un link (un reel, una nota): entra al corpus como compartido, y además lo charlamos.
    const link = /https?:\/\/\S+/.exec(texto)?.[0]
    if (link) ingerir(db, { fuente: 'operador', titulo: `Compartido · ${(texto.replace(link, '').trim() || link).slice(0, 80)}`, contenido: texto, url: link, dominio: 'compartido' })
    return conversar(db, link ? `Te comparto esto por Telegram:\n${texto}` : texto)
  }
}

let offset = 0
/** El bucle de long polling: pregunta, procesa de a una (en orden), y vuelve a preguntar. */
export function escucharTelegram(db: Db) {
  if (estado.escuchando || !telegramConfigurado()) return
  estado.escuchando = true
  void pedir('setMyCommands', { commands: COMANDOS.map(([command, description]) => ({ command, description })) }).catch(() => {})
  const vuelta = async () => {
    try {
      const r = await pedir('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'edited_message', 'callback_query'] })
      if (r?.ok === false) throw new Error(r.description ?? 'Telegram dijo que no')
      estado.ultimoError = null
      for (const u of r.result ?? []) {
        offset = u.update_id + 1
        await procesarActualizacion(db, u).catch((e) => decir(`Se me trabó algo: ${e instanceof Error ? e.message : e}`))
      }
    } catch (e) {
      estado.ultimoError = e instanceof Error ? e.message : String(e)
      console.error('  telegram:', estado.ultimoError)
      await new Promise((ok) => setTimeout(ok, 10_000))
    }
    if (estado.escuchando) setTimeout(vuelta, 300)
  }
  void vuelta()
}
export function dejarDeEscuchar() {
  estado.escuchando = false
}
