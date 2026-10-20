/**
 * Idiomas: una pista de aprendizaje por idioma, armada con lo que dice Languages Pedro.
 * - Sin un por qué no arranca: es lo que sostiene la constancia cuando la motivación se va.
 * - Hablar desde el día uno: la práctica es una charla corta sobre su vida real (sus proyectos, su día), en el idioma y a
 *   su nivel. Contesta por escrito o por audio (Whisper en ese idioma).
 * - La gramática en contexto, nunca reglas sueltas: cada respuesta vuelve con correcciones («lo que dijiste → cómo sonaría
 *   natural», con el patrón) y 2 o 3 frases útiles que quedan como tarjetas de recuerdo activo (repaso espaciado).
 * - Nadie te enseña un idioma, lo aprendés vos: la práctica es diaria, a su hora (por Telegram) o cuando quiera (en la
 *   sección), y cuenta como práctica en Aprender.
 * Es la plantilla de una «pista de aprendizaje» (práctica diaria + tarjetas + progreso) que después sirve para otras áreas.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fechaLocal, json, type Db } from './db.ts'
import { crearAprendizaje, registrarPractica } from './aprender.ts'
import { crearTarjeta, paraRepasar } from './tarjetas.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { pedirJson } from './modelo.ts'
import { nanTranscribir } from './nan.ts'

/** Los idiomas que se pueden practicar: su nombre y, si kokoro tiene, una voz para escuchar las frases. */
export const IDIOMAS: Record<string, { nombre: string; voz: string | null }> = {
  en: { nombre: 'Inglés', voz: 'af_heart' }, de: { nombre: 'Alemán', voz: null }, fr: { nombre: 'Francés', voz: 'ff_siwis' },
  it: { nombre: 'Italiano', voz: 'if_sara' }, pt: { nombre: 'Portugués', voz: 'pf_dora' }, ca: { nombre: 'Catalán', voz: null },
  nl: { nombre: 'Neerlandés', voz: null }, pl: { nombre: 'Polaco', voz: null }, ru: { nombre: 'Ruso', voz: null }, tr: { nombre: 'Turco', voz: null },
  ar: { nombre: 'Árabe', voz: null }, ja: { nombre: 'Japonés', voz: 'jf_alpha' }, zh: { nombre: 'Chino', voz: 'zf_xiaobei' }, ko: { nombre: 'Coreano', voz: null },
  hi: { nombre: 'Hindi', voz: 'hf_alpha' }, el: { nombre: 'Griego', voz: null }, sv: { nombre: 'Sueco', voz: null }, is: { nombre: 'Islandés', voz: null },
}
export const NIVELES = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const

type Charla = { abierta: boolean; pregunta: string | null; desde: number; ultima: number; mensajeId?: number | null }
export type Idioma = { aprendizajeId: number; codigo: string; nombre: string; nivel: string | null; objetivo: string | null; porQue: string | null; minutosDia: number; hora: string | null; charla: Charla | null; ultimoEnvio: string | null }

const deFila = (r: any): Idioma => ({ aprendizajeId: r.aprendizaje_id, codigo: r.codigo, nombre: r.nombre, nivel: r.nivel, objetivo: r.objetivo, porQue: r.por_que ?? null, minutosDia: r.minutos_dia, hora: r.hora, charla: json<Charla | null>(r.charla, null), ultimoEnvio: r.ultimo_envio })
const SELECT = 'SELECT i.*, a.por_que FROM idiomas i JOIN aprendizajes a ON a.id = i.aprendizaje_id'
export const mazoDe = (aprendizajeId: number) => `idioma:${aprendizajeId}`
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

// ─── inyectable para tests ──────────────────────────────────────────────

let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'idiomas' }, sistema, usuario, { temperatura: 0.5, maxTokens: 1800 })).datos
let transcribir = (db: Db, audio: Buffer, nombre: string, idioma: string) => nanTranscribir(db, audio, nombre, idioma)
let voz = async (texto: string, v: string): Promise<Buffer> => (await import('./taller.ts')).sintetizar(texto, v)
export function _probarIdiomas(o: { modelo?: typeof modelo; transcribir?: typeof transcribir; voz?: typeof voz }) {
  if (o.modelo) modelo = o.modelo
  if (o.transcribir) transcribir = o.transcribir
  if (o.voz) voz = o.voz
}

// ─── los idiomas ────────────────────────────────────────────────────────

export function leerIdioma(db: Db, aprendizajeId: number): Idioma | null {
  const r = db.prepare(`${SELECT} WHERE i.aprendizaje_id = ?`).get(aprendizajeId)
  return r ? deFila(r) : null
}

export function crearIdioma(db: Db, x: { codigo: string; nivel?: string | null; objetivo?: string | null; porQue?: string | null; minutosDia?: number | null; hora?: string | null }, ahora = Date.now()): Idioma {
  const codigo = String(x.codigo ?? '').toLowerCase().trim()
  const def = IDIOMAS[codigo]
  if (!def) throw new Error(`No conozco el idioma «${x.codigo}»`)
  // Sin un por qué no arranca (Pedro): es lo que lo sostiene cuando la motivación se va.
  const porQue = String(x.porQue ?? '').trim()
  if (porQue.length < 10) throw new Error(`Antes de arrancar: ¿para qué querés aprender ${def.nombre.toLowerCase()}? (una o dos frases: es lo que te va a sostener cuando baje la motivación)`)
  if (x.hora && !HORA.test(x.hora)) throw new Error('La hora va como HH:MM')
  const nivel = NIVELES.includes(x.nivel as any) ? x.nivel! : 'A1'
  const a = crearAprendizaje(db, { tema: `Idioma · ${def.nombre}`, porQue, nivelActual: nivel, nivelObjetivo: x.objetivo ?? null }, ahora)
  if (leerIdioma(db, a.id)) throw new Error(`Ya estás aprendiendo ${def.nombre.toLowerCase()}`)
  db.prepare('INSERT INTO idiomas (aprendizaje_id, codigo, nombre, nivel, objetivo, minutos_dia, hora, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(a.id, codigo, def.nombre, nivel, x.objetivo?.trim() || null, Math.max(5, Math.min(240, Number(x.minutosDia) || 15)), x.hora || null, ahora)
  return leerIdioma(db, a.id)!
}

export function editarIdioma(db: Db, id: number, c: { nivel?: string; objetivo?: string; porQue?: string; minutosDia?: number; hora?: string | null }) {
  if (!leerIdioma(db, id)) throw new Error(`No existe el idioma ${id}`)
  if (c.nivel && NIVELES.includes(c.nivel as any)) {
    db.prepare('UPDATE idiomas SET nivel = ? WHERE aprendizaje_id = ?').run(c.nivel, id)
    db.prepare('UPDATE aprendizajes SET nivel_actual = ? WHERE id = ?').run(c.nivel, id)
  }
  if (c.objetivo !== undefined) db.prepare('UPDATE idiomas SET objetivo = ? WHERE aprendizaje_id = ?').run(c.objetivo || null, id)
  if (c.porQue && c.porQue.trim().length >= 10) db.prepare('UPDATE aprendizajes SET por_que = ? WHERE id = ?').run(c.porQue.trim(), id)
  if (c.minutosDia) db.prepare('UPDATE idiomas SET minutos_dia = ? WHERE aprendizaje_id = ?').run(Math.max(5, Math.min(240, Math.round(c.minutosDia))), id)
  if (c.hora !== undefined) {
    if (c.hora && !HORA.test(c.hora)) throw new Error('La hora va como HH:MM')
    db.prepare('UPDATE idiomas SET hora = ? WHERE aprendizaje_id = ?').run(c.hora || null, id)
  }
  return leerIdioma(db, id)!
}

/** Los días de este mes con práctica: un conteo que no se borra (un día sin practicar no le resta nada). */
function diasDelMes(db: Db, id: number, ahora: number): number {
  const hoy = fechaLocal(ahora)
  return (db.prepare('SELECT COUNT(DISTINCT fecha) AS n FROM practicas WHERE aprendizaje_id = ? AND fecha >= ? AND fecha <= ?').get(id, `${hoy.slice(0, 7)}-01`, hoy) as { n: number }).n
}

/** Cada idioma con su progreso: días practicados este mes, minutos de la semana, charlas, frases (tarjetas) y las que tocan hoy. */
export function listarIdiomas(db: Db, ahora = Date.now()) {
  const hoy = fechaLocal(ahora)
  const semana = fechaLocal(ahora - 6 * 86_400_000)
  return (db.prepare(`${SELECT} ORDER BY i.creado_en`).all() as any[]).map(deFila).map((i) => {
    const t = db.prepare(`SELECT COUNT(*) AS total, SUM(proxima <= ?) AS hoy, SUM(intervalo >= 21) AS aprendidas FROM tarjetas WHERE mazo = ? AND estado = 'activa'`).get(hoy, mazoDe(i.aprendizajeId)) as any
    const minutos = (db.prepare('SELECT COALESCE(SUM(minutos), 0) AS m FROM practicas WHERE aprendizaje_id = ? AND fecha >= ?').get(i.aprendizajeId, semana) as { m: number }).m
    const turnos = db.prepare('SELECT id, fecha, pregunta, respuesta, por_voz, devolucion FROM idioma_turnos WHERE aprendizaje_id = ? AND respuesta IS NOT NULL ORDER BY id DESC LIMIT 6').all(i.aprendizajeId) as any[]
    return {
      ...i, diasMes: diasDelMes(db, i.aprendizajeId, ahora), minutosSemana: minutos, metaSemana: i.minutosDia * 7,
      charlas: turnos.length ? (db.prepare('SELECT COUNT(*) AS n FROM idioma_turnos WHERE aprendizaje_id = ? AND respuesta IS NOT NULL').get(i.aprendizajeId) as { n: number }).n : 0,
      tarjetas: { total: t.total ?? 0, hoy: t.hoy ?? 0, aprendidas: t.aprendidas ?? 0 }, conVoz: !!IDIOMAS[i.codigo]?.voz,
      ultimos: turnos.map((x) => ({ ...x, devolucion: json<any>(x.devolucion, null) })),
    }
  })
}

// ─── la práctica ────────────────────────────────────────────────────────

const SISTEMA_ABRIR = (nombre: string, nivel: string) => `Sos Mastropiero y practicás ${nombre} con el jugador (nivel ${nivel}). Abrís una charla corta EN ${nombre} sobre su vida real (lo que está haciendo, sus proyectos, su día), con lo que sabés de él.
- Una o dos frases y UNA pregunta abierta que lo haga hablar. A su nivel: en A0-A1 frases muy simples y concretas; en B2-C1, natural y con matices.
- Si te paso frases que está aprendiendo, usá alguna en tu mensaje (así las escucha en contexto).
- «ayuda»: la misma idea en castellano, muy corta (por si no entiende).
Forma: {"mensaje": string, "ayuda": string}`

const SISTEMA_DEVOLUCION = (nombre: string, nivel: string) => `Sos Mastropiero, el profe de ${nombre} del jugador (nivel ${nivel}). Te paso tu pregunta y lo que él contestó (si vino de un audio, ignorá muletillas y errores de transcripción obvios).
Devolvé:
- "correcciones": 0 a 4 cosas para mejorar, solo si hace falta: {"dijo": el fragmento tal cual, "natural": cómo lo diría un nativo, "por_que": en castellano y en una frase, el patrón en contexto (nada de reglas abstractas)}.
- "frases": 2 o 3 frases EN ${nombre}, naturales y útiles para SU vida, sacadas de lo que quiso decir: {"frase": string, "traduccion": en castellano, "patron": qué estructura muestra, corto}.
- "respuesta": tu respuesta EN ${nombre} a lo que dijo (seguí la charla, 1 o 2 frases) y "pregunta": la siguiente pregunta EN ${nombre}.
- "animo": en castellano, una frase corta con lo que hizo bien.
- "nivel": el nivel que muestra esta respuesta (A1…C2) o null.
Forma: {"correcciones": [...], "frases": [...], "respuesta": string, "pregunta": string, "animo": string, "nivel": string | null}`

const guardarCharla = (db: Db, id: number, c: Charla | null) => db.prepare('UPDATE idiomas SET charla = ? WHERE aprendizaje_id = ?').run(c ? JSON.stringify(c) : null, id)

/** Abre la práctica: un mensaje de Mastropiero en el idioma (sobre su vida) que él contesta. */
export async function abrirPractica(db: Db, id: number, ahora = Date.now()): Promise<{ mensaje: string; ayuda: string; turnoId: number }> {
  const i = leerIdioma(db, id)
  if (!i) throw new Error(`No existe el idioma ${id}`)
  const frases = paraRepasar(db, { mazo: mazoDe(id), limite: 3 }, ahora).map((t) => t.dorso.split('\n')[0])
  const contexto = [`Lo que sabés de él:\n${memoriaParaPrompt(db, 14)}`, frases.length ? `Frases que está aprendiendo: ${frases.join(' · ')}` : '', `Hoy es ${fechaLocal(ahora)}.`].filter(Boolean).join('\n\n')
  const d = await modelo(db, SISTEMA_ABRIR(i.nombre, i.nivel ?? 'A1'), contexto)
  const mensaje = String(d?.mensaje ?? '').trim()
  if (!mensaje) throw new Error('No pude armar la práctica, probá de nuevo')
  // Si quedaba una pregunta sin contestar, se reemplaza: la práctica arranca de nuevo.
  db.prepare('DELETE FROM idioma_turnos WHERE aprendizaje_id = ? AND respuesta IS NULL').run(id)
  const turnoId = Number(db.prepare('INSERT INTO idioma_turnos (aprendizaje_id, fecha, pregunta, en) VALUES (?, ?, ?, ?)').run(id, fechaLocal(ahora), mensaje, ahora).lastInsertRowid)
  guardarCharla(db, id, { abierta: true, pregunta: mensaje, desde: ahora, ultima: ahora })
  return { mensaje, ayuda: String(d?.ayuda ?? '').trim(), turnoId }
}

/** La práctica que está abierta (la última, si hubo actividad en los últimos 45 minutos): para Telegram. */
export function practicaAbierta(db: Db, ahora = Date.now()): Idioma | null {
  const xs = (db.prepare(`${SELECT} WHERE i.charla IS NOT NULL`).all() as any[]).map(deFila).filter((i) => i.charla?.abierta && ahora - i.charla.ultima < 45 * 60_000)
  return xs.sort((a, b) => b.charla!.ultima - a.charla!.ultima)[0] ?? null
}

export function cerrarPractica(db: Db, id: number) {
  const i = leerIdioma(db, id)
  if (i?.charla) guardarCharla(db, id, { ...i.charla, abierta: false })
}

export function marcarMensajePractica(db: Db, id: number, mensajeId: number | null) {
  const i = leerIdioma(db, id)
  if (i?.charla) guardarCharla(db, id, { ...i.charla, mensajeId })
}

/**
 * Lo que contestó (texto o audio): la devolución (correcciones, frases, la charla sigue), las frases como tarjetas y la
 * práctica anotada en Aprender.
 */
export async function responderPractica(db: Db, id: number, r: { texto?: string | null; audio?: Buffer | null; nombreAudio?: string; segundos?: number | null }, ahora = Date.now()) {
  const i = leerIdioma(db, id)
  if (!i) throw new Error(`No existe el idioma ${id}`)
  let texto = String(r.texto ?? '').trim()
  const porVoz = !!r.audio?.length
  if (porVoz) texto = (await transcribir(db, r.audio!, r.nombreAudio || 'audio.ogg', i.codigo)).trim()
  if (!texto) throw new Error(porVoz ? 'No se entendió el audio: probá de nuevo, más cerca del micrófono' : 'Escribí o grabá tu respuesta')
  const pregunta = i.charla?.pregunta ?? '(sin pregunta: habló él primero)'
  const d = await modelo(db, SISTEMA_DEVOLUCION(i.nombre, i.nivel ?? 'A1'), `Tu pregunta: ${pregunta}\n\nLo que contestó${porVoz ? ' (por audio, transcripto)' : ''}: ${texto}`)
  const devolucion = {
    correcciones: (Array.isArray(d?.correcciones) ? d.correcciones : []).slice(0, 4).map((c: any) => ({ dijo: String(c?.dijo ?? ''), natural: String(c?.natural ?? ''), por_que: String(c?.por_que ?? '') })).filter((c: any) => c.dijo && c.natural),
    frases: (Array.isArray(d?.frases) ? d.frases : []).slice(0, 3).map((f: any) => ({ frase: String(f?.frase ?? '').trim(), traduccion: String(f?.traduccion ?? '').trim(), patron: String(f?.patron ?? '').trim() })).filter((f: any) => f.frase && f.traduccion),
    respuesta: String(d?.respuesta ?? '').trim(), pregunta: String(d?.pregunta ?? '').trim(), animo: String(d?.animo ?? '').trim(),
    nivel: NIVELES.includes(d?.nivel) ? (d.nivel as string) : null,
  }
  // El turno abierto (el de la pregunta) se completa; si no había, uno nuevo.
  const abierto = db.prepare('SELECT id FROM idioma_turnos WHERE aprendizaje_id = ? AND respuesta IS NULL ORDER BY id DESC LIMIT 1').get(id) as { id: number } | undefined
  let turnoId: number
  if (abierto) {
    db.prepare('UPDATE idioma_turnos SET respuesta = ?, por_voz = ?, devolucion = ?, en = ? WHERE id = ?').run(texto, porVoz ? 1 : 0, JSON.stringify(devolucion), ahora, abierto.id)
    turnoId = abierto.id
  } else {
    turnoId = Number(db.prepare('INSERT INTO idioma_turnos (aprendizaje_id, fecha, pregunta, respuesta, por_voz, devolucion, en) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, fechaLocal(ahora), pregunta, texto, porVoz ? 1 : 0, JSON.stringify(devolucion), ahora).lastInsertRowid)
  }
  // Las frases, como tarjetas de producción: de lo que quiere decir (castellano) a cómo se dice.
  let nuevas = 0
  for (const f of devolucion.frases) {
    if (crearTarjeta(db, { mazo: mazoDe(id), frente: `¿Cómo dirías: «${f.traduccion}»?`, dorso: `${f.frase}${f.patron ? `\n\n${f.patron}` : ''}`, contexto: pregunta, origenTipo: 'idioma_turno', origenId: turnoId }, ahora).nueva) nuevas++
  }
  // La siguiente pregunta queda abierta como un turno nuevo.
  const siguiente = `${devolucion.respuesta} ${devolucion.pregunta}`.trim()
  if (devolucion.pregunta) db.prepare('INSERT INTO idioma_turnos (aprendizaje_id, fecha, pregunta, en) VALUES (?, ?, ?, ?)').run(id, fechaLocal(ahora), siguiente, ahora)
  guardarCharla(db, id, { abierta: true, pregunta: siguiente || pregunta, desde: i.charla?.desde ?? ahora, ultima: ahora, mensajeId: i.charla?.mensajeId ?? null })
  const minutos = porVoz ? Math.max(2, Math.round((r.segundos ?? 60) / 60) + 2) : 3
  registrarPractica(db, { aprendizajeId: id, minutos, que: `Charla en ${i.nombre.toLowerCase()}: ${texto.slice(0, 120)}`, fuente: 'idiomas' }, ahora)
  return { transcripcion: porVoz ? texto : null, ...devolucion, tarjetasNuevas: nuevas, turnoId }
}

// ─── escuchar ───────────────────────────────────────────────────────────

/** El audio de una frase en su idioma (kokoro), guardado para no volver a pedirlo. null si no hay voz para ese idioma. */
export async function audioDeFrase(texto: string, codigo: string, dir: string): Promise<string | null> {
  const v = IDIOMAS[codigo]?.voz
  const t = texto.trim().slice(0, 400)
  if (!v || !t) return null
  const archivo = `tts-${crypto.createHash('sha1').update(`${v}|${t}`).digest('hex').slice(0, 16)}.mp3`
  const ruta = path.join(dir, archivo)
  if (!fs.existsSync(ruta)) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(ruta, await voz(t, v))
  }
  return `/adjuntos/${archivo}`
}

// ─── la práctica programada (por Telegram) ──────────────────────────────

/** Los idiomas a los que hoy ya les toca la práctica (pasó su hora y todavía no se mandó). */
export function practicasQueTocan(db: Db, ahora = Date.now()): Idioma[] {
  const d = new Date(ahora)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const hoy = fechaLocal(ahora)
  return (db.prepare(`${SELECT} WHERE i.hora IS NOT NULL`).all() as any[]).map(deFila).filter((i) => i.hora! <= hhmm && i.ultimoEnvio !== hoy)
}
export const marcarEnviada = (db: Db, id: number, ahora = Date.now()) => db.prepare('UPDATE idiomas SET ultimo_envio = ? WHERE aprendizaje_id = ?').run(fechaLocal(ahora), id)
