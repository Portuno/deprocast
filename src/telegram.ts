/**
 * El canal de Telegram: Mastropiero en el bolsillo. Texto, audios (Whisper) y fotos (visión) entran a la conversación
 * de Hoy y lo que contesta vuelve por acá, con formato; lo que dice solo (saludo, alertas, reportes) también, y cada
 * banda de la run llega sola con botones para marcarla. Además: comandos para lo rápido (/gasto, /nota, /bitacora,
 * /buscar), la criba y las preguntas con botones, links que entran al corpus, archivos que se cargan (un chat de
 * WhatsApp exportado, el CSV del banco) y, si querés, las respuestas también en audio.
 * Sin URL pública: el servidor le pregunta a Telegram si hay mensajes (long polling). Solo atiende a su chat
 * (TELEGRAM_CHAT_ID): a cualquier otro le dice su id y nada más.
 */
import { anotarUso } from './uso.ts'
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
import { responderPregunta, siguientePregunta } from './preguntas.ts'
import { descartar, ejecutar, leerCarga, subir } from './cargas/index.ts'
import { sintetizar } from './taller.ts'
import { brujulaDelDia, textoDeBrujula } from './brujula.ts'
import { recomendar } from './mentor.ts'
import { cuadernoComoMd, descartarLink, piezaComoMd, procesarLink } from './lector/index.ts'

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
    let r = await pedir('sendMessage', { chat_id: chat, text: aHtml(p), parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
    if (r && r.ok === false) r = await pedir('sendMessage', { chat_id: chat, text: sinMarcas(p), ...extra }) // HTML que no le gustó: va plano
    id = r?.result?.message_id ?? id
  }
  return id
}

/** Manda un audio (mp3) a su chat, con un texto corto debajo. */
export async function mandarAudio(datos: Buffer, titulo: string, texto?: string): Promise<boolean> {
  const chat = suChat()
  if (!telegramActivo() || !chat) return false
  const r = await mandarArchivo('sendAudio', { chat_id: chat, title: titulo, ...(texto ? { caption: texto.slice(0, 1000) } : {}) }, 'audio', datos, 'mastropiero.mp3')
  return !!r?.ok
}

async function editar(mensajeId: number, texto: string, botones?: Botones) {
  const r = await pedir('editMessageText', { chat_id: suChat(), message_id: mensajeId, text: aHtml(texto), parse_mode: 'HTML', disable_web_page_preview: true, ...teclado(botones) })
  if (r && r.ok === false) await decir(texto, botones)
}

// ─── captura: fotos y textos que se registran solos ──────────────────────

/** mensaje de Telegram → lo que se registró, para que responder «a ese mensaje» lo corrija. */
const capturasEnviadas = new Map<number, { tabla: string; id: number | string; texto: string; foto: string | null }>()
const LETRA: Record<string, string> = { salud: 's', movimientos: 'm', practicas: 'p', woop: 'w' }
const TABLA: Record<string, string> = { s: 'salud', m: 'movimientos', p: 'practicas', w: 'woop' }

/** Si lo clasificado es un registro, lo anota y contesta con una línea (y ↩ para deshacer). false = no era un registro. */
async function registrarYContar(db: Db, c: Captura | null, o: { foto?: string | null; texto: string; umbral?: number }): Promise<boolean> {
  if (!c || c.tipo === 'otro' || c.confianza < (o.umbral ?? 0.7)) return false
  const r = registrarCaptura(db, c, { foto: o.foto, fuente: 'telegram' })
  if (!r) return false
  const id = await decir(`${r.resumen}\n_Respondé a este mensaje para corregir._`, [[{ texto: '↩ Deshacer', dato: `x:${LETRA[r.tabla]}:${r.id}` }]])
  if (id) capturasEnviadas.set(id, { tabla: r.tabla, id: r.id, texto: o.texto, foto: o.foto ?? null })
  return true
}

/** Su corrección a un registro: se borra el anterior y se vuelve a clasificar con lo que dijo (y la foto, si había). */
async function corregirCaptura(db: Db, previa: { tabla: string; id: number | string; texto: string; foto: string | null }, correccion: string) {
  deshacerCaptura(db, previa.tabla, previa.id)
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
  if (k === 'md') {
    if (a === 'x') {
      descartarLink(db, Number(b))
      return mensajeId ? editar(mensajeId, '🗑 No lo guardé.') : decir('🗑 No lo guardé.')
    }
    const md = a === 'c' ? cuadernoComoMd(db, Number(b)) : piezaComoMd(db, Number(b))
    return mandarArchivo('sendDocument', { chat_id: suChat()! }, 'document', Buffer.from(md.texto, 'utf8'), md.nombre)
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
    if (PARECE_REGISTRO.test(t) && (await registrarYContar(db, await clasificar(db, { texto: t }).catch(() => null), { texto: t }))) return
    return conversar(db, t, { porVoz: true })
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
let dbDeError: Db | null = null
export function escucharTelegram(db: Db) {
  if (estado.escuchando || !telegramActivo()) return
  estado.escuchando = true
  dbDeError = db
  void pedir('setMyCommands', { commands: COMANDOS.map(([command, description]) => ({ command, description })) }).catch(() => {})
  const vuelta = async () => {
    try {
      const r = await pedir('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'edited_message', 'callback_query'] })
      if (r?.ok === false && (r.error_code === 409 || /conflict/i.test(r.description ?? ''))) {
        // Otra instancia escucha el mismo bot: las dos contestarían lo mismo. Se avisa y se espera más.
        estado.ultimoError = 'Otra instancia está escuchando este bot (¿la compu y la nube a la vez?). Dejá Telegram prendido en una sola.'
        if (dbDeError) registrarError(dbDeError, 'servidor', `telegram: ${estado.ultimoError}`)
        await new Promise((ok) => setTimeout(ok, 60_000))
        if (estado.escuchando) setTimeout(vuelta, 300)
        return
      }
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
