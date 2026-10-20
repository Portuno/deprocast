/**
 * El canal de Telegram: Mastropiero en el bolsillo. Texto, audios (Whisper) y fotos (visión) entran a la conversación
 * de Hoy y lo que contesta vuelve por acá, con formato; lo que dice solo (saludo, alertas, reportes) también, y cada
 * banda de la run llega sola con botones para marcarla. Además: comandos para lo rápido (/gasto, /nota, /bitacora,
 * /buscar), la criba y las preguntas con botones, links que entran al corpus, archivos que se cargan (un chat de
 * WhatsApp exportado, el CSV del banco) y, si querés, las respuestas también en audio.
 * Sin URL pública: el servidor le pregunta a Telegram si hay mensajes (long polling). Solo atiende a su chat
 * (TELEGRAM_CHAT_ID): a cualquier otro le dice su id y nada más.
 */
import crypto from 'node:crypto'
import { anotarUso } from './uso.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { escribaDeMemoria } from './memoria.ts'
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
import { clasificar, deshacerCaptura, PARECE_REGISTRO, registrarCaptura, type Captura } from './captura.ts'
import { guardarFoto, leerFoto } from './chat/adjuntos.ts'
import { registrarSalud, resumenDia } from './salud.ts'
import { registrarError } from './autocritica.ts'
import { diaDelPlan, marcarHabito, VERBOS, votar } from './cien.ts'
import { cribar, marcador, siguiente } from './criba.ts'
import { jugar, robar, type Jugada } from './mano.ts'
import { responderPregunta, siguientePregunta } from './preguntas.ts'
import { descartar, ejecutar, leerCarga, subir } from './cargas/index.ts'
import { sintetizar } from './taller.ts'
import { brujulaDelDia, textoDeBrujula } from './brujula.ts'
import { recomendar } from './mentor.ts'
import { cuadernoComoMd, descartarLink, piezaComoMd, procesarLink } from './lector/index.ts'
import { abrirPractica, audioDeFrase, cerrarPractica, leerIdioma, listarIdiomas, marcarEnviada, marcarMensajePractica, practicaAbierta, practicasQueTocan, responderPractica } from './idiomas.ts'
import { CALIDADES, leerTarjeta, paraRepasar, responderTarjeta, type Calidad } from './tarjetas.ts'
import { dirAdjuntos } from './chat/adjuntos.ts'
import { bucleMasViejos, cerrarBucle } from './bucles.ts'
import { responderOferta, tipoDeIndice, umbralCaptura } from './sombra.ts'
import { TIPOS } from './decisiones.ts'
import { PARECE_SUENO, destilarSueno, registrarSueno } from './suenos.ts'
import { enLaNube } from './reproceso.ts'
import path from 'node:path'

const api = (metodo: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`

let pedir = async (metodo: string, cuerpo: Record<string, unknown>): Promise<any> => {
  const r = await fetch(api(metodo), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(65_000) })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { ok: false, error_code: r.status, description: `HTTP ${r.status}` } }
}
/** Para mandar un archivo (el audio de la respuesta): multipart. */
let mandarArchivo = async (metodo: string, campos: Record<string, string>, campo: string, datos: Buffer, nombre: string): Promise<any> => {
  const form = new FormData()
  for (const [k, v] of Object.entries(campos)) form.append(k, v)
  form.append(campo, new Blob([new Uint8Array(datos)]), nombre)
  const r = await fetch(api(metodo), { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { ok: false, error_code: r.status, description: `HTTP ${r.status}` } }
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
/**
 * Un envío (mensaje, edición, audio, archivo) que se corta por timeout, sin red o un 5xx de Telegram se reintenta dos
 * veces (a los 1,5 y a los 4 s) antes de darlo por perdido. Un 4xx no: el problema es el mensaje, no la red.
 */
let esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))
async function conReintento<T extends { ok?: boolean; error_code?: number } | undefined>(metodo: string, f: () => Promise<T>): Promise<T> {
  const esperas = [1500, 4000]
  for (let i = 0; ; i++) {
    try {
      const r = await f()
      if (!(r && r.ok === false && (r.error_code ?? 0) >= 500) || i === esperas.length) return r
    } catch (e) {
      if (i === esperas.length) { console.error(`  telegram: ${metodo} no salió: ${e instanceof Error ? e.message : e}`); throw e }
    }
    await esperar(esperas[i])
  }
}
const enviar_ = (metodo: string, cuerpo: Record<string, unknown>) => conReintento(metodo, () => pedir(metodo, cuerpo))
const enviarArchivo = (metodo: string, campos: Record<string, string>, campo: string, datos: Buffer, nombre: string) => conReintento(metodo, () => mandarArchivo(metodo, campos, campo, datos, nombre))

export function _probarTelegram(o: { pedir?: typeof pedir; bajar?: typeof bajar; transcribir?: typeof transcribir; ver?: typeof ver; mandarArchivo?: typeof mandarArchivo; hablar?: typeof hablar; esperar?: typeof esperar }) {
  if (o.esperar) esperar = o.esperar
  if (o.pedir) pedir = o.pedir
  if (o.bajar) bajar = o.bajar
  if (o.transcribir) transcribir = o.transcribir
  if (o.ver) ver = o.ver
  if (o.mandarArchivo) mandarArchivo = o.mandarArchivo
  if (o.hablar) hablar = o.hablar
}

export const telegramConfigurado = () => !!process.env.TELEGRAM_BOT_TOKEN
/**
 * Un bot, un dueño: si dos instancias (la compu y la nube) escuchan el mismo bot, las dos contestan lo mismo.
 * En la nube (MASTRO_NUBE=1) Telegram está apagado salvo MASTRO_TELEGRAM=1; en la compu, MASTRO_TELEGRAM=0 lo apaga.
 */
export const telegramActivo = () => telegramConfigurado() && (process.env.MASTRO_TELEGRAM != null ? process.env.MASTRO_TELEGRAM !== '0' : process.env.MASTRO_NUBE !== '1')
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

/** Lo último que se mandó (texto → cuándo): el mismo mensaje largo dos veces en 2 minutos no sale dos veces. */
const recientes = new Map<string, number>()
function repetido(texto: string, ahora = Date.now()): boolean {
  if (texto.length < 40) return false // «Anotado. ✓» puede repetirse
  for (const [k, t] of recientes) if (ahora - t > 120_000) recientes.delete(k)
  if (recientes.has(texto)) return true
  recientes.set(texto, ahora)
  return false
}

/** Manda un texto a su chat, con formato y botones opcionales. Devuelve el id del último mensaje. */
export async function decir(texto: string, botones?: Botones): Promise<number | null> {
  const chat = suChat()
  if (!telegramActivo() || !chat || !texto.trim()) return null
  if (!botones && repetido(texto.trim())) return null
  const partes = pedazos(texto.replace(/\[#\d+\]/g, '').trim())
  let id: number | null = null
  for (const [i, p] of partes.entries()) {
    const extra = i === partes.length - 1 ? teclado(botones) : {}
    let r = await enviar_('sendMessage', { chat_id: chat, text: aHtml(p), parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
    if (r && r.ok === false) r = await enviar_('sendMessage', { chat_id: chat, text: sinMarcas(p), ...extra }) // HTML que no le gustó: va plano
    id = r?.result?.message_id ?? id
  }
  return id
}

/** Manda un audio (mp3) a su chat, con un texto corto debajo. */
export async function mandarAudio(datos: Buffer, titulo: string, texto?: string): Promise<boolean> {
  const chat = suChat()
  if (!telegramActivo() || !chat) return false
  const r = await enviarArchivo('sendAudio', { chat_id: chat, title: titulo, ...(texto ? { caption: texto.slice(0, 1000) } : {}) }, 'audio', datos, 'mastropiero.mp3')
  return !!r?.ok
}

async function editar(mensajeId: number, texto: string, botones?: Botones) {
  const r = await enviar_('editMessageText', { chat_id: suChat(), message_id: mensajeId, text: aHtml(texto), parse_mode: 'HTML', disable_web_page_preview: true, ...teclado(botones) })
  if (r && r.ok === false) await decir(texto, botones)
}

// ─── captura: fotos y textos que se registran solos ──────────────────────

/** mensaje de Telegram → lo que se registró, para que responder «a ese mensaje» lo corrija. */
const capturasEnviadas = new Map<number, { tabla: string; id: number | string; texto: string; foto: string | null }>()
const LETRA: Record<string, string> = { salud: 's', movimientos: 'm', practicas: 'p', woop: 'w' }
const TABLA: Record<string, string> = { s: 'salud', m: 'movimientos', p: 'practicas', w: 'woop' }

/** Si lo clasificado es un registro, lo anota y contesta con una línea (y ↩ para deshacer). false = no era un registro. */
async function registrarYContar(db: Db, c: Captura | null, o: { foto?: string | null; texto: string; umbral?: number }): Promise<boolean> {
  // El umbral sigue a cuánto acierta la captura (modo sombra): si viene errando, pide más confianza.
  if (!c || c.tipo === 'otro' || c.confianza < (o.umbral ?? umbralCaptura(db))) return false
  const r = registrarCaptura(db, c, { foto: o.foto, fuente: 'telegram' })
  if (!r) return false
  const id = await decir(`${r.resumen}\n_Respondé a este mensaje para corregir._`, [[{ texto: '↩ Deshacer', dato: `x:${LETRA[r.tabla]}:${r.id}` }]])
  if (id) capturasEnviadas.set(id, { tabla: r.tabla, id: r.id, texto: o.texto, foto: o.foto ?? null })
  return true
}

/** Su corrección a un registro: se borra el anterior y se vuelve a clasificar con lo que dijo (y la foto, si había). */
async function corregirCaptura(db: Db, previa: { tabla: string; id: number | string; texto: string; foto: string | null }, correccion: string) {
  deshacerCaptura(db, previa.tabla, previa.id, 'editada')
  const imagen = previa.foto ? leerFoto(previa.foto) ?? undefined : undefined
  const texto = `${previa.texto}\nCorrección del jugador (manda sobre lo anterior): ${correccion}`.trim()
  const c = await clasificar(db, { imagen, texto }).catch(() => null)
  if (!(await registrarYContar(db, c, { foto: previa.foto, texto, umbral: 0.4 }))) await decir('Lo borré, pero no entendí la corrección. Mandámelo de nuevo como querés que quede.')
}

/** A la mañana: ¿cuánto dormiste?, con botones (si ya lo anotó, nada). */
export async function preguntarSueno(db: Db, ahora = Date.now()) {
  if (!telegramActivo() || !suChat() || resumenDia(db, fechaLocal(ahora)).sueno?.horas != null) return
  await decir('😴 ¿Cuánto dormiste anoche?', [
    [{ texto: '≤5 h', dato: 'z:h:5' }, { texto: '6 h', dato: 'z:h:6' }, { texto: '7 h', dato: 'z:h:7' }, { texto: '8 h', dato: 'z:h:8' }, { texto: '9+ h', dato: 'z:h:9' }],
    [{ texto: '😩 Mal', dato: 'z:c:1' }, { texto: '🙂 Bien', dato: 'z:c:2' }, { texto: '💪 Muy bien', dato: 'z:c:3' }],
  ])
}

/** El voto de la noche: los seis verbos y los hábitos de hoy, como botones que se prenden y se apagan. */
function tarjetaVoto(db: Db, fecha: string): { texto: string; botones: Botones } | null {
  const d = diaDelPlan(db, fecha)
  if (!d) return null
  const v = (k: string, n: string) => ({ texto: `${d.dia.verbos[k] ? '✓ ' : ''}${n}`, dato: `v:${fecha}:${k}` })
  const hs = d.habitos.filter((h) => h.toca)
  return {
    texto: `🗳 **Día ${d.n} de ${d.total}.** ¿Qué verbos votaste hoy con hechos? Con 3 o 4 reales ya es un buen día.${hs.length ? '\nY los hábitos de hoy:' : ''}`,
    botones: [
      [v(VERBOS[0][0], VERBOS[0][1]), v(VERBOS[1][0], VERBOS[1][1]), v(VERBOS[2][0], VERBOS[2][1])],
      [v(VERBOS[3][0], VERBOS[3][1]), v(VERBOS[4][0], VERBOS[4][1]), v(VERBOS[5][0], VERBOS[5][1])],
      ...hs.map((h) => [{ texto: `${h.hecho ? '✓' : '○'} ${h.titulo.slice(0, 40)} (${h.enSemana}/${h.porSemana})`, dato: `g:${fecha}:${h.id}` }]),
      [{ texto: 'Listo', dato: `l:${fecha}` }],
    ],
  }
}

export async function mandarVotoNoche(db: Db, fecha = fechaLocal()) {
  if (!telegramActivo() || !suChat()) return
  const t = tarjetaVoto(db, fecha)
  if (t) await decir(t.texto, t.botones)
}

// ─── links: leer, guardar y bajar en .md ─────────────────────────────────

async function guardarLinkTelegram(db: Db, url: string, nota: string): Promise<{ piezaId: number; titulo: string } | null> {
  try {
    const r = await procesarLink(db, url, {
      nota,
      alTerminar: (x) => void decir(`🕸 Rastreé ${x.paginas} página${x.paginas === 1 ? '' : 's'} de «${x.titulo}»: están juntas en un cuaderno.`, [[{ texto: '📄 MD del cuaderno', dato: `md:c:${x.cuadernoId}` }]]).catch(() => {}),
    })
    if (!r.nueva || !r.lectura) {
      await decir(`📄 Ese link ya lo tenía guardado (pieza #${r.piezaId}).`, [[{ texto: '📄 MD', dato: `md:p:${r.piezaId}` }]])
      return { piezaId: r.piezaId, titulo: String((db.prepare('SELECT titulo FROM corpus WHERE id = ?').get(r.piezaId) as any)?.titulo ?? url) }
    }
    const l = r.lectura
    await decir([
      `📄 Guardé «${l.titulo}»${l.palabras ? ` (${l.palabras.toLocaleString('es-AR')} palabras)` : ''}.`,
      l.meta.descripcion ? `_${l.meta.descripcion.slice(0, 240)}_` : '',
      l.aviso ? `_${l.aviso}_` : '',
      r.rastreando ? '🕸 Es un sitio con índice: rastreo hasta 20 páginas y te aviso.' : '',
    ].filter(Boolean).join('\n'), [[{ texto: '📄 MD', dato: `md:p:${r.piezaId}` }, { texto: '🗑 No guardar', dato: `md:x:${r.piezaId}` }]])
    return { piezaId: r.piezaId, titulo: l.titulo }
  } catch {
    return null
  }
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
  if (!telegramConfigurado() || !suChat()) return
  await practicasProgramadas(db)
  await avisoBucles(db).catch((e) => console.error('[telegram] bucles:', e instanceof Error ? e.message : e))
  if (ajuste(db, 'telegram_bandas') === '0') return
  const v = enCurso(db)
  const id = v?.actual?.id ?? null
  if (id && id !== ultimaBanda) { ultimaBanda = id; await bandaActual(db) }
  if (!id) ultimaBanda = null
}

// ─── idiomas y tarjetas ─────────────────────────────────────────────────

const botonTerminar = (id: number): Botones => [[{ texto: '✋ Terminar', dato: `id:${id}:fin` }]]

/** El audio de unas frases en su idioma (si kokoro tiene voz), para escucharlas y repetirlas en voz alta. */
async function mandarFrasesEnAudio(codigo: string, titulo: string, texto: string) {
  try {
    const url = await audioDeFrase(texto, codigo, dirAdjuntos())
    if (url) await mandarAudio(fs.readFileSync(path.join(dirAdjuntos(), path.basename(url))), titulo)
  } catch { /* sin voz: queda el texto */ }
}

/** Abre una práctica: el mensaje en el idioma (con la ayuda en castellano) y, si hay voz, en audio. */
async function abrirPracticaTelegram(db: Db, id: number) {
  const i = leerIdioma(db, id)
  if (!i) return decir('No encontré ese idioma.')
  const p = await abrirPractica(db, id)
  const mensajeId = await decir(`🗣 **${i.nombre}** · práctica\n\n${p.mensaje}${p.ayuda ? `\n\n_(${p.ayuda})_` : ''}\n\n_Contestá por audio (mejor: hablar desde el día uno) o escribiendo._`, botonTerminar(id))
  marcarMensajePractica(db, id, mensajeId)
  await mandarFrasesEnAudio(i.codigo, `${i.nombre} · escuchá`, p.mensaje)
}

/** Lo que contestó en la práctica: la devolución (correcciones, frases nuevas, la charla sigue). */
async function responderPracticaTelegram(db: Db, id: number, r: { texto?: string; audio?: Buffer; nombreAudio?: string; segundos?: number | null }) {
  const i = leerIdioma(db, id)!
  let d
  try { d = await responderPractica(db, id, r) } catch (e) { return decir(e instanceof Error ? e.message : String(e)) }
  const texto = [
    d.transcripcion ? `🎙 _${d.transcripcion}_` : '',
    d.correcciones.length ? d.correcciones.map((c: any) => `✗ ${c.dijo}\n✓ **${c.natural}**${c.por_que ? `\n   _${c.por_que}_` : ''}`).join('\n') : '',
    d.frases.length ? `🃏 **Frases nuevas**${d.tarjetasNuevas ? ` (${d.tarjetasNuevas} a tus tarjetas)` : ''}\n${d.frases.map((f: any) => `• **${f.frase}** — ${f.traduccion}${f.patron ? `\n   _${f.patron}_` : ''}`).join('\n')}` : '',
    d.animo ? `💪 ${d.animo}` : '',
    [d.respuesta, d.pregunta].filter(Boolean).join(' '),
  ].filter(Boolean).join('\n\n')
  const mensajeId = await decir(texto, botonTerminar(id))
  marcarMensajePractica(db, id, mensajeId)
  if (d.frases.length) await mandarFrasesEnAudio(i.codigo, `${i.nombre} · repetí en voz alta`, d.frases.map((f: any) => f.frase).join('. '))
}

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

/** /idioma [nombre]: abre la práctica ya (si tiene uno solo, ese; si no, botones). /idioma fin la cierra. */
async function comandoIdioma(db: Db, resto: string) {
  if (/^(fin|terminar|listo|basta)$/i.test(resto)) {
    const p = practicaAbierta(db)
    if (p) cerrarPractica(db, p.aprendizajeId)
    return decir(p ? `✋ Cerramos la práctica de ${p.nombre.toLowerCase()}.` : 'No hay ninguna práctica abierta.')
  }
  const xs = listarIdiomas(db)
  if (!xs.length) return decir('Todavía no estás aprendiendo ningún idioma. Arrancá uno en Aprender → Idiomas (con tu por qué: es lo que te va a sostener).')
  const b = sinTildes(resto)
  const elegido = b ? xs.find((i) => i.codigo === b || sinTildes(i.nombre).startsWith(b)) : xs.length === 1 ? xs[0] : null
  if (elegido) return abrirPracticaTelegram(db, elegido.aprendizajeId)
  return decir('¿Cuál practicamos?', [xs.map((i) => ({ texto: `${i.nombre}${i.racha ? ` 🔥${i.racha}` : ''}`, dato: `id:${i.aprendizajeId}:abrir` }))])
}

const nombreDeMazo = (db: Db, mazo: string) => mazo.startsWith('idioma:') ? leerIdioma(db, Number(mazo.slice(7)))?.nombre ?? 'Idioma' : mazo === 'consumido' ? 'Lo que miraste' : mazo
const NOMBRE_CALIDAD: Record<Calidad, string> = { otra: '↺ Otra vez', dificil: '😓 Difícil', bien: '🙂 Bien', facil: '😎 Fácil' }

/** La próxima tarjeta que toca: primero solo el frente (recordar, no reconocer). */
async function mandarTarjeta(db: Db, mensajeId?: number) {
  const ts = paraRepasar(db, { limite: 200 })
  if (!ts.length) {
    const t = '🃏 No te queda ninguna tarjeta para hoy. ✓'
    return mensajeId ? editar(mensajeId, t) : decir(t)
  }
  const t = ts[0]
  const texto = `🃏 **${nombreDeMazo(db, t.mazo)}** · ${ts.length === 200 ? '200+' : ts.length} para hoy\n\n${t.frente}\n\n_Pensalo (o decilo en voz alta) y después mirá._`
  const botones: Botones = [[{ texto: '👀 Ver', dato: `tj:${t.id}:ver` }]]
  return mensajeId ? editar(mensajeId, texto, botones) : decir(texto, botones)
}

/** Si a algún idioma ya le toca su práctica de hoy, se la abre sola (una vez por día). */
let abriendoPracticas = false
async function practicasProgramadas(db: Db) {
  if (abriendoPracticas) return
  abriendoPracticas = true
  try {
    for (const i of practicasQueTocan(db)) {
      marcarEnviada(db, i.aprendizajeId) // antes: si el modelo falla, no se reintenta cada minuto
      await abrirPracticaTelegram(db, i.aprendizajeId).catch((e) => console.error(`[telegram] práctica de ${i.nombre}:`, e instanceof Error ? e.message : e))
    }
  } finally { abriendoPracticas = false }
}

// ─── sueños ─────────────────────────────────────────────────────────────

let esperandoSueno = 0
async function guardarSuenoTelegram(db: Db, x: { texto?: string; audio?: Buffer; nombreAudio?: string }) {
  esperandoSueno = 0
  try {
    const s = await registrarSueno(db, { ...x, origen: 'telegram' })
    await decir(`🌙 Guardé tu sueño del ${s.fecha.slice(8, 10)}/${s.fecha.slice(5, 7)}.${enLaNube() ? ' Lo leo y te cuento qué veo.' : ''}`)
    if (!enLaNube()) return
    const d = (await destilarSueno(db, s.id)).destilado
    if (d) await decir([`🌙 **${d.titulo}**`, d.simbolos.length ? `Símbolos: ${d.simbolos.join(', ')}` : '', d.emociones.length ? `Se sentía: ${d.emociones.join(', ')}` : '', d.fuente ? `Parece ${d.fuente}${d.por_que_fuente ? `: ${d.por_que_fuente}` : ''}` : '', d.cruce ? `_Con tu día anterior:_ ${d.cruce}` : ''].filter(Boolean).join('\n'))
  } catch (e) { await decir(e instanceof Error ? e.message : String(e)) }
}

// ─── lo que sigue volviendo ─────────────────────────────────────────────

/** Los domingos (desde las 11): los tres bucles abiertos más viejos, cada uno con sus tres finales. Una vez por semana. */
async function avisoBucles(db: Db, ahora = Date.now()) {
  const d = new Date(ahora)
  if (d.getDay() !== 0 || d.getHours() < 11 || ajuste(db, 'telegram_bucles') === '0') return
  const semana = semanaDe(ahora)
  if (ajuste(db, 'bucles_aviso') === semana) return
  fijarAjuste(db, 'bucles_aviso', semana)
  const bs = bucleMasViejos(db, 3, ahora)
  if (!bs.length) return
  await decir(`🔁 **Lo que sigue volviendo**\nTres cosas abiertas hace rato. Cada una se termina de una de tres formas: hacerla ya, agendarla o soltarla.\n\n${bs.map((b, i) => `${i + 1}. ${b.texto}\n   _volvió ${b.veces} ${b.veces === 1 ? 'vez' : 'veces'}${b.primera ? `, desde el ${b.primera.slice(8, 10)}/${b.primera.slice(5, 7)}` : ''}_`).join('\n')}`,
    bs.map((b, i) => [{ texto: `${i + 1} ✓ Hoy`, dato: `b:${b.id}:ya` }, { texto: '📅 Mañana', dato: `b:${b.id}:manana` }, { texto: '🗑 Soltar', dato: `b:${b.id}:soltar` }]))
}

// ─── conversar ──────────────────────────────────────────────────────────

/** Lo que dice él → la conversación de Hoy → la respuesta de Mastropiero vuelve por Telegram (y en audio, si quiere). */
/** Lo que dice un audio sin mayúsculas, tildes, puntuación ni espacios de más: el mismo audio reenviado da lo mismo. */
export const textoDeVozNormal = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

/** Una nota que ya estaba (por su huella; o, en las viejas sin huella, por el mismo comienzo y un largo parecido). */
function notaQueYaEstaba(db: Db, normal: string, huella: string): { id: number; fecha: string | null } | null {
  const exacta = db.prepare(`SELECT id, fecha FROM corpus WHERE fuente = 'voz' AND json_extract(meta, '$.huella') = ?`).get(huella) as { id: number; fecha: string | null } | undefined
  if (exacta) return exacta
  const inicio = normal.slice(0, 400)
  const viejas = db.prepare(`SELECT id, fecha, contenido FROM corpus WHERE fuente = 'voz' AND json_extract(meta, '$.huella') IS NULL AND length(contenido) BETWEEN ? AND ?`)
    .all(Math.floor(normal.length * 0.8), Math.ceil(normal.length * 1.3)) as { id: number; fecha: string | null; contenido: string }[]
  for (const v of viejas) {
    const n = textoDeVozNormal(v.contenido)
    if (n.slice(0, 400) === inicio && Math.abs(n.length - normal.length) <= normal.length * 0.1) return { id: v.id, fecha: v.fecha }
  }
  return null
}

/**
 * Una nota de voz larga queda como pieza suya (con fecha) y el escriba saca recuerdos y side quests de ella. Si es una
 * que ya estaba (la reenvió), no entra de nuevo: se cuenta el reenvío en la original.
 */
export function guardarNotaDeVoz(db: Db, texto: string, segundos: number | null, id: string | null): { pieza: number | null; repetida: { id: number; fecha: string | null } | null } {
  asegurarFuente(db, { id: 'voz', nombre: 'Notas de voz', nivel: 'propia', descripcion: 'Lo que grabás caminando o pensando en voz alta.' })
  const normal = textoDeVozNormal(texto)
  const huella = crypto.createHash('sha1').update(normal).digest('hex')
  const ya = notaQueYaEstaba(db, normal, huella)
  if (ya) {
    db.prepare(`UPDATE corpus SET meta = json_set(COALESCE(meta, '{}'), '$.reenvios', COALESCE(json_extract(meta, '$.reenvios'), 0) + 1) WHERE id = ?`).run(ya.id)
    return { pieza: null, repetida: ya }
  }
  const pieza = insertar(db, {
    fuente: 'voz', nivel: 'propia', estado: 'disponible', fecha: fechaLocal(), contenido: texto, etiquetas: ['audio', 'telegram'],
    titulo: `Nota de voz · ${fechaLocal()} ${new Date().toTimeString().slice(0, 5)} · ${texto.replace(/\s+/g, ' ').slice(0, 50)}`,
    origenId: id ? `telegram-voz:${id}` : null, datos: { segundos }, meta: { huella },
  })
  if (pieza) void escribaDeMemoria(db, texto, null, { pieza }).catch(() => [])
  return { pieza, repetida: null }
}

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
      await enviarArchivo('sendAudio', { chat_id: suChat()!, title: 'Mastropiero' }, 'audio', await hablar(sinMarcas(respuesta).slice(0, 2500)), 'mastropiero.mp3')
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

const salteadasMano: number[] = []
/** Cómo cayó una carta jugada, en una línea o dos (lo que conecta, lo que refuerza o con qué choca). */
function caidaMano(j: Jugada): string {
  const cab = j.gesto === 'peso' ? `✓ Pesada ${j.carta.peso}` : j.gesto === 'choca' ? '⚡ Marcada: choca con lo que ya sabías' : '✕ Descartada'
  const v = (x: Jugada['vecinos'][number]) => `«${x.texto.slice(0, 90)}${x.texto.length > 90 ? '…' : ''}» (${Math.round(x.sim * 100)} %)`
  const lineas = [cab]
  if (j.refuerza.length) lineas.push(`Refuerza lo que ya creías: ${v(j.refuerza[0])}`)
  if (j.chocaCon.length) lineas.push(`¿Choca con ${v(j.chocaCon[0])}?`)
  if (j.gesto !== 'descartar') lineas.push(j.vecinos.length ? `Cae cerca de ${v(j.vecinos[0])}` : 'No se parece a nada que hayas pesado: territorio nuevo.')
  return lineas.join('\n')
}

/** Una carta de La Mano, con sus pesos en botones (y lo que pasó con la anterior arriba, si hubo). */
function cartaMano(db: Db, previo = ''): { texto: string; botones?: Botones } {
  const c = robar(db, { n: 1, saltear: salteadasMano })[0]
  const arriba = previo ? `${previo}\n\n— — —\n` : ''
  if (!c) return { texto: `${arriba}No quedan afirmaciones sin pesar. 🎉` }
  const b = (g: number | string, t?: string) => ({ texto: t ?? String(g), dato: `mn:${c.id}:${g}` })
  const nov = c.novedad === 'nueva' ? '✦ nueva' : c.novedad === 'variacion' ? '≈ variación' : c.novedad === 'repetida' ? '= casi repetida' : ''
  const toca = c.toca.primaria ? `→ ${c.toca.primaria.titulo}` : '→ suelta'
  return {
    texto: `${arriba}♤ ${nov ? `_${nov}_ · ` : ''}${c.fuente ? `de «${c.fuente.titulo.slice(0, 60)}»` : ''}\n\n**${c.texto}**\n\n_${toca}_`,
    botones: [[b(1), b(2), b(3), b(4), b(5), b(6)], [b(7), b(8), b(9), b(10), b(11), b(12)], [b('x', '✕'), b('c', '⚡ choca'), b('s', '⏭')]],
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
  ['brujula', 'El tridente del día'], ['mentor', 'Qué leer o ver ahora'], ['buscar', 'Buscar en tu corpus'], ['criba', 'Pesar piezas con botones'], ['mano', 'Jugar tus afirmaciones sin pesar, de a una'], ['pregunta', 'Que Mastropiero te pregunte algo'], ['idioma', 'Practicar un idioma ahora: /idioma inglés (/idioma fin la cierra)'], ['tarjetas', 'Repasar las tarjetas que tocan hoy'], ['sueno', 'Anotar un sueño: /sueno y lo contás (o mandá un audio que empiece con «soñé…»)'], ['voz', 'Respuestas también en audio: sí / no'], ['ayuda', 'Qué sé hacer'],
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
  try { anotarUso(db, 'telegram', cmd.replace(/^\//, '')) } catch { /* no frena */ }
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
    case '/mano': { const c = cartaMano(db); return decir(c.texto, c.botones) }
    case '/brujula': return decir(textoDeBrujula(await brujulaDelDia(db, { forzar: /^(de nuevo|otra|rehacer)/i.test(resto) })))
    case '/mentor': {
      const rs = await recomendar(db)
      return decir(rs.length ? `🧭 **El Mentor**\n${rs.map((r) => `• **${r.accion}**\n  ${r.porQue}`).join('\n')}` : 'No encontré nada en tu Librería que empuje lo de esta semana.')
    }
    case '/pregunta': case '/preguntas': return mandarPregunta(db)
    case '/idioma': case '/idiomas': case '/practica': return comandoIdioma(db, resto)
    case '/tarjetas': case '/repasar': return mandarTarjeta(db)
    case '/sueno': case '/sueño': case '/soñé': case '/sone': {
      if (!resto) { esperandoSueno = Date.now(); return decir('🌙 Contámelo: escribilo o mandá un audio (en los próximos 10 minutos lo guardo como sueño).') }
      return guardarSuenoTelegram(db, { texto: resto })
    }
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
  if (k === 'md') {
    if (a === 'x') {
      descartarLink(db, Number(b))
      return mensajeId ? editar(mensajeId, '🗑 No lo guardé.') : decir('🗑 No lo guardé.')
    }
    const md = a === 'c' ? cuadernoComoMd(db, Number(b)) : piezaComoMd(db, Number(b))
    return enviarArchivo('sendDocument', { chat_id: suChat()! }, 'document', Buffer.from(md.texto, 'utf8'), md.nombre)
  }
  if (k === 'x') {
    deshacerCaptura(db, TABLA[a] ?? 'salud', b)
    if (mensajeId) capturasEnviadas.delete(mensajeId)
    return mensajeId ? editar(mensajeId, '↩ Deshecho: no quedó anotado.') : decir('↩ Deshecho.')
  }
  if (k === 'v' || k === 'g') {
    // El botón trae la fecha: «v:2026-10-14:entreno» (los guiones de la fecha no son ':').
    const [, fecha, cual] = String(q.data).split(':')
    if (k === 'v') votar(db, fecha, cual)
    else marcarHabito(db, fecha, cual)
    const t = tarjetaVoto(db, fecha)
    return t && mensajeId ? editar(mensajeId, t.texto, t.botones) : undefined
  }
  if (k === 'l') {
    const d = diaDelPlan(db, a)
    const votados = d ? VERBOS.filter(([v]) => d.dia.verbos[v]).map(([, n]) => n) : []
    return mensajeId ? editar(mensajeId, `🗳 ${votados.length ? `Votaste ${votados.join(', ')}` : 'Hoy sin verbos votados'}. ${d ? `Intensidad del día: ${'●'.repeat(d.intensidad)}${'○'.repeat(4 - d.intensidad)}.` : ''}`) : undefined
  }
  if (k === 'z') {
    const r = registrarSalud(db, { tipo: 'sueno', datos: a === 'h' ? { horas: Number(b) } : { calidad: Number(b) }, fuente: 'telegram' })
    return decir(`😴 ${r.titulo}${r.datos.calidad ? ` (${['', 'mal', 'bien', 'muy bien'][r.datos.calidad]})` : ''}. Anotado.`)
  }
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
  if (k === 'mn') {
    let previo = ''
    if (b === 's') salteadasMano.push(Number(a))
    else {
      try { previo = caidaMano(await jugar(db, Number(a), b === 'x' ? { gesto: 'descartar' } : b === 'c' ? { gesto: 'choca' } : { gesto: 'peso', peso: Number(b) })) } catch (e) { previo = e instanceof Error ? e.message : String(e) }
    }
    const c = cartaMano(db, previo)
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
  if (k === 'id') {
    const id = Number(a)
    if (b === 'fin') {
      cerrarPractica(db, id)
      return decir('✋ Listo por hoy. Lo que practicaste ya cuenta en Aprender.')
    }
    return abrirPracticaTelegram(db, id)
  }
  if (k === 'sm') {
    const tipo = tipoDeIndice(Number(a))
    if (!tipo) return
    const r = responderOferta(db, tipo, b === 'auto')
    const t = r.modo === 'auto' ? `🤖 Listo: «${TIPOS[tipo].nombre}» lo hago solo. Todo queda deshacible en Hoy → 📥.` : `👌 Sigo proponiendo «${TIPOS[tipo].nombre}» y espero tu ok.`
    return mensajeId ? editar(mensajeId, t) : decir(t)
  }
  if (k === 'b') {
    const manana = fechaLocal(Date.now() + 86_400_000)
    try {
      const r = await cerrarBucle(db, Number(a), b === 'manana' ? 'agendar' : b === 'soltar' ? 'soltar' : 'ya', { fecha: manana })
      return decir(b === 'soltar' ? `🗑 Soltado: «${r.bucle.texto}». No vuelve a molestar.` : b === 'manana' ? `📅 «${r.bucle.texto}» quedó para mañana${r.google ? ' en tu calendario' : ' (side quest)'}.` : `✓ «${r.bucle.texto}» quedó como side quest para hoy.`)
    } catch (e) { return decir(e instanceof Error ? e.message : String(e)) }
  }
  if (k === 'tj') {
    const t = leerTarjeta(db, Number(a))
    if (!t) return mandarTarjeta(db)
    if (b === 'ver') {
      const texto = `🃏 **${nombreDeMazo(db, t.mazo)}**\n\n${t.frente}\n\n———\n${t.dorso}\n\n_¿Cómo te fue?_`
      const botones: Botones = [CALIDADES.map((c) => ({ texto: NOMBRE_CALIDAD[c], dato: `tj:${t.id}:${c}` }))]
      return mensajeId ? editar(mensajeId, texto, botones) : decir(texto, botones)
    }
    if (!CALIDADES.includes(b as Calidad)) return
    const r = responderTarjeta(db, t.id, b as Calidad)
    if (mensajeId) await editar(mensajeId, `🃏 ${t.frente}\n**${t.dorso.split('\n')[0]}**\n${NOMBRE_CALIDAD[b as Calidad]} · ${r.intervalo ? `vuelve en ${r.intervalo} día${r.intervalo === 1 ? '' : 's'}` : 'vuelve hoy'}`)
    return mandarTarjeta(db)
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
    await enviar_('sendMessage', { chat_id: chatId, text: `Hola. Para que te atienda, poné en .env: TELEGRAM_CHAT_ID=${chatId} y reiniciá Mastropiero.` })
    return
  }
  if (chatId !== suChat()) return // otro: silencio
  estado.ultimoMensaje = Date.now()
  if (u.callback_query) return boton(db, u.callback_query)
  const texto: string | undefined = msg.text ?? msg.caption
  // Responder a un registro que anotó (una comida, un gasto): lo corrige.
  const aCaptura = msg.reply_to_message ? capturasEnviadas.get(msg.reply_to_message.message_id) : undefined
  if (aCaptura && texto) {
    capturasEnviadas.delete(msg.reply_to_message.message_id)
    return corregirCaptura(db, aCaptura, texto)
  }
  // Responder a una pregunta que mandó: la contesta.
  const aPregunta = msg.reply_to_message ? preguntasEnviadas.get(msg.reply_to_message.message_id) : undefined
  if (aPregunta && texto) {
    await responderPregunta(db, aPregunta, texto)
    preguntasEnviadas.delete(msg.reply_to_message.message_id)
    await decir('Anotado. ✓')
    return siguientePregunta(db) ? mandarPregunta(db) : undefined
  }
  // Con una práctica de idioma abierta, lo que diga (audio o texto, sin links ni comandos) es su respuesta.
  const practica = practicaAbierta(db)
  const vozPractica = msg.voice ?? msg.audio
  if (practica && !msg.document && !msg.photo?.length && (vozPractica || (texto && !texto.startsWith('/') && !/https?:\/\//.test(texto)))) {
    if (vozPractica) {
      const { datos, nombre } = await bajar(vozPractica.file_id)
      return responderPracticaTelegram(db, practica.aprendizajeId, { audio: datos, nombreAudio: nombre.endsWith('.oga') ? nombre.replace(/\.oga$/, '.ogg') : nombre, segundos: vozPractica.duration ?? null })
    }
    return responderPracticaTelegram(db, practica.aprendizajeId, { texto })
  }
  // Después de /sueno, lo siguiente que diga (texto o audio) es el sueño.
  const vozSueno = msg.voice ?? msg.audio
  if (esperandoSueno && Date.now() - esperandoSueno < 10 * 60_000 && (vozSueno || (texto && !texto.startsWith('/')))) {
    if (vozSueno) { const { datos, nombre } = await bajar(vozSueno.file_id); return guardarSuenoTelegram(db, { audio: datos, nombreAudio: nombre.endsWith('.oga') ? nombre.replace(/\.oga$/, '.ogg') : nombre }) }
    return guardarSuenoTelegram(db, { texto })
  }
  if (texto && !texto.startsWith('/') && PARECE_SUENO.test(texto)) return guardarSuenoTelegram(db, { texto })
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
    // Un audio que cuenta un sueño («soñé que…») va a Sueños, no a la charla.
    if (PARECE_SUENO.test(t)) return guardarSuenoTelegram(db, { texto: t })
    // Una nota larga es material (una caminata pensando en voz alta): queda como pieza suya, además de lo que se haga con ella.
    const larga = (voz.duration ?? 0) >= 90 || t.length >= 900
    const g = larga ? guardarNotaDeVoz(db, t, voz.duration ?? null, voz.file_unique_id ?? voz.file_id) : null
    const pieza = g?.pieza ?? null
    if (PARECE_REGISTRO.test(t) && (await registrarYContar(db, await clasificar(db, { texto: t }).catch(() => null), { texto: t }))) return
    if (g?.repetida) await decir(`🎙 Ya lo tenía: es la nota${g.repetida.fecha ? ` del ${g.repetida.fecha.slice(8, 10)}/${g.repetida.fecha.slice(5, 7)}` : ''} (#${g.repetida.id}). No la guardo de nuevo.`)
    else if (pieza) await decir(`🎙 Guardé tu nota de voz${voz.duration ? ` (${Math.max(1, Math.round(voz.duration / 60))} min)` : ''} en tu corpus, como tuya.`)
    const guardada = pieza ?? g?.repetida?.id
    return conversar(db, guardada ? `(Nota de voz por Telegram, ya guardada en su corpus [#${guardada}]. Si trae algo para anotar —una side quest, un gasto, una idea de proyecto— anotalo.) ${t}` : t, { porVoz: true })
  }
  if (msg.photo?.length) {
    // Una foto (una comida, un ticket, la balanza…): se registra sola si es un registro; si no, se charla.
    const { datos, nombre } = await bajar(msg.photo.at(-1).file_id)
    let foto: ReturnType<typeof guardarFoto> | null = null
    try { foto = guardarFoto(nombre, datos) } catch { /* sin ffmpeg ni nada raro: se sigue con la original */ }
    const c = await clasificar(db, { imagen: foto ? { datos: foto.datos, mime: foto.mime } : { datos, mime: 'image/jpeg' }, texto }).catch(() => null)
    if (await registrarYContar(db, c, { foto: foto?.url ?? null, texto: texto ?? '' })) return
    const descripcion = c?.descripcion || await ver(db, datos)
    return conversar(db, `(Te mandé una foto por Telegram. Lo que se ve: ${descripcion})${texto ? `\n${texto}` : ''}`)
  }
  if (texto && !/https?:\/\//.test(texto) && PARECE_REGISTRO.test(texto)) {
    if (await registrarYContar(db, await clasificar(db, { texto }).catch(() => null), { texto })) return
  }
  if (texto) {
    // Un link: se lee y se guarda en Markdown (y si es un sitio con índice, se rastrea); después lo charlamos.
    const link = /https?:\/\/\S+/.exec(texto)?.[0]
    if (!link) return conversar(db, texto)
    const g = await guardarLinkTelegram(db, link, texto.replace(link, '').trim())
    return conversar(db, `Te comparto esto por Telegram:\n${texto}${g ? `\n(Ya quedó guardado en el corpus como pieza #${g.piezaId}: «${g.titulo}».)` : ''}`)
  }
}

let offset = 0
/** El bucle de long polling: pregunta, procesa de a una (en orden), y vuelve a preguntar. */
/**
 * Cuánto esperar después de fallar n veces seguidas. Un 409 (otra instancia con el mismo bot) espera largo: 1, 2, 4 y
 * hasta 10 minutos. Lo demás (timeout, fetch failed, 5xx) es pasajero: 5, 10, 20 y hasta 2 minutos.
 */
export function esperaTelegram(conflicto: boolean, seguidas: number): number {
  return conflicto ? Math.min(600_000, 60_000 * 2 ** Math.max(0, seguidas - 1)) : Math.min(120_000, 5_000 * 2 ** Math.max(0, seguidas - 1))
}
export const AVISO_OTRA_INSTANCIA = 'Otra instancia está escuchando este bot (¿la compu y la nube a la vez?). Dejá Telegram prendido en una sola.'
const racha = { conflictos: 0, fallas: 0 }
/** Una vuelta del polling; devuelve cuánto esperar antes de la siguiente (para los tests, sin timers). */
export async function vueltaTelegram(db: Db): Promise<number> {
  try {
    const r = await pedir('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'edited_message', 'callback_query'] })
    if (r?.ok === false && (r.error_code === 409 || /conflict/i.test(r.description ?? ''))) {
      // Otra instancia escucha el mismo bot: las dos contestarían lo mismo. Se avisa UNA vez por racha y se espera cada vez más.
      racha.conflictos++
      estado.ultimoError = AVISO_OTRA_INSTANCIA
      if (racha.conflictos === 1) registrarError(db, 'servidor', `telegram: ${AVISO_OTRA_INSTANCIA}`)
      return esperaTelegram(true, racha.conflictos)
    }
    if (r?.ok === false) throw new Error(r.description ?? 'Telegram dijo que no')
    if (racha.conflictos || racha.fallas) console.log('  telegram: volvió a andar')
    racha.conflictos = 0
    racha.fallas = 0
    estado.ultimoError = null
    for (const u of r.result ?? []) {
      offset = u.update_id + 1
      await procesarActualizacion(db, u).catch((e) => decir(`Se me trabó algo: ${e instanceof Error ? e.message : e}`))
    }
    return 300
  } catch (e) {
    // Un corte (timeout, sin red, 5xx) no es otra instancia: se reintenta con espera creciente y se loguea solo la primera.
    racha.fallas++
    estado.ultimoError = e instanceof Error ? e.message : String(e)
    if (racha.fallas === 1) console.error('  telegram:', estado.ultimoError)
    return esperaTelegram(false, racha.fallas)
  }
}
export function escucharTelegram(db: Db) {
  if (estado.escuchando || !telegramActivo()) return
  estado.escuchando = true
  void pedir('setMyCommands', { commands: COMANDOS.map(([command, description]) => ({ command, description })) }).catch(() => {})
  const vuelta = async () => {
    const espera = await vueltaTelegram(db)
    if (estado.escuchando) setTimeout(vuelta, espera)
  }
  void vuelta()
}
export function dejarDeEscuchar() {
  estado.escuchando = false
}
