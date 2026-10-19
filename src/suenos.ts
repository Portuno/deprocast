/**
 * Sueños y creencias.
 * - Los sueños entran por Telegram (/sueño, o un audio que empieza con «soñé…»), a mano o desde una app conectada
 *   (Morpheon). Quedan como pieza suya (fuente «suenos», su voz) y se destilan en la nube: escenas, personas, símbolos,
 *   emociones, si fue lúcido y de qué fuente parece venir (corporal, mental, emocional o transpersonal), cruzado con la
 *   crónica del día anterior. La vista muestra los símbolos que vuelven, las emociones por semana y quién aparece.
 * - Las creencias: una vez por mes, las más fuertes de su memoria llegan como preguntas, de a una: «¿esto lo
 *   descubriste o lo heredaste?». Lo que conteste vuelve a la memoria por el escriba.
 */
import { fechaLocal, fijarAjuste, ajuste, json, type Db } from './db.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { encolarPregunta } from './preguntas.ts'
import { pedirJson } from './modelo.ts'
import { nanTranscribir } from './nan.ts'

const FUENTE = { id: 'suenos', nombre: 'Sueños', nivel: 'propia' as const, descripcion: 'Lo que soñaste, con lo que Mastropiero leyó de cada sueño.' }
export const FUENTES_SUENO = ['corporal', 'mental', 'emocional', 'transpersonal'] as const
const DIA = 86_400_000

export type Sueno = { id: number; piezaId: number | null; fecha: string; texto: string; despertar: string | null; duracionMin: number | null; lucido: boolean | null; emociones: string[]; nota: string | null; origen: string; destilado: Destilado | null; estado: string; creadoEn: number }
export type Destilado = { titulo: string; escenas: string[]; personas: string[]; simbolos: string[]; emociones: string[]; lucido: boolean | null; fuente: string | null; por_que_fuente: string | null; cruce: string | null }

let transcribir = (db: Db, audio: Buffer, nombre: string) => nanTranscribir(db, audio, nombre)
let modelo = async (db: Db, sistema: string, usuario: string, maxTokens = 1500): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'suenos' }, sistema, usuario, { temperatura: 0.3, maxTokens })).datos
export function _probarSuenos(o: { transcribir?: typeof transcribir; modelo?: typeof modelo }) {
  if (o.transcribir) transcribir = o.transcribir
  if (o.modelo) modelo = o.modelo
}

const deFila = (r: any): Sueno => ({
  id: r.id, piezaId: r.pieza_id, fecha: r.fecha, texto: r.texto, despertar: r.despertar, duracionMin: r.duracion_min, lucido: r.lucido == null ? null : r.lucido === 1,
  emociones: json<string[]>(r.emociones, []) ?? [], nota: r.nota, origen: r.origen, destilado: json<Destilado | null>(r.destilado, null), estado: r.estado, creadoEn: r.creado_en,
})

export function leerSueno(db: Db, id: number): Sueno | null {
  const r = db.prepare('SELECT * FROM suenos WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

/** ¿Un audio o un texto que cuenta un sueño? («soñé que…», «anoche soñé…», «tuve un sueño…») */
export const PARECE_SUENO = /^\s*(?:anoche\s+|hoy\s+|recién\s+)?(?:(?:me\s+)?so[ñn][eé](?![a-záéíóúñ])|tuve\s+un\s+sue[ñn]o)/i // (\b no sirve con la é)

/** Guarda un sueño (texto o audio, que se transcribe y no se guarda). Devuelve el sueño, todavía sin destilar. */
export async function registrarSueno(db: Db, x: { texto?: string | null; audio?: Buffer | null; nombreAudio?: string; fecha?: string | null; despertar?: string | null; duracionMin?: number | null; lucido?: boolean | null; emociones?: string[] | string | null; nota?: string | null; origen: string }, ahora = Date.now()): Promise<Sueno> {
  let texto = String(x.texto ?? '').trim()
  if (x.audio?.length) texto = [texto, (await transcribir(db, x.audio, x.nombreAudio || 'sueno.m4a')).trim()].filter(Boolean).join('\n\n')
  if (texto.length < 3) throw new Error('El sueño vino vacío: contalo por escrito o en un audio')
  const fecha = x.fecha && /^\d{4}-\d{2}-\d{2}$/.test(x.fecha) ? x.fecha : fechaLocal(ahora)
  const despertar = x.despertar && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.despertar) ? x.despertar : null
  const emociones = (Array.isArray(x.emociones) ? x.emociones : String(x.emociones ?? '').split(',')).map((e) => String(e).trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 10)
  asegurarFuente(db, FUENTE)
  const primeras = texto.replace(/\s+/g, ' ').slice(0, 60)
  const pieza = insertar(db, {
    fuente: FUENTE.id, nivel: 'propia', titulo: `Sueño · ${fecha} · ${primeras}`, contenido: [texto, x.nota ? `Nota: ${x.nota}` : ''].filter(Boolean).join('\n\n'),
    fecha, etiquetas: ['sueño', ...(x.lucido ? ['lúcido'] : [])], estado: 'disponible', origenId: `sueno:${fecha}:${ahora}`, meta: { origen: x.origen },
  }, ahora)
  const id = Number(db.prepare('INSERT INTO suenos (pieza_id, fecha, texto, despertar, duracion_min, lucido, emociones, nota, origen, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(pieza, fecha, texto, despertar, Number(x.duracionMin) > 0 ? Math.round(Number(x.duracionMin)) : null, x.lucido == null ? null : x.lucido ? 1 : 0, JSON.stringify(emociones), x.nota?.trim().slice(0, 600) || null, x.origen.slice(0, 60), ahora).lastInsertRowid)
  return leerSueno(db, id)!
}

const SISTEMA = `Leés un sueño que el jugador contó al despertar (puede venir de un audio transcripto, con errores). No lo interpretes como oráculo ni le des significados universales: describí lo que hay y cruzalo con su día anterior, con cuidado.
- "titulo": 3 a 6 palabras.
- "escenas": las escenas en orden, una frase cada una (hasta 6).
- "personas": quiénes aparecen (nombres como los dijo; «mi vieja», «un desconocido»).
- "simbolos": objetos, lugares o imágenes que se destacan (palabras sueltas, hasta 8).
- "emociones": las que se sienten en el sueño (hasta 5, una palabra).
- "lucido": true si se dio cuenta de que soñaba, false si no, null si no se sabe.
- "fuente": la que más parece (corporal: algo del cuerpo —hambre, frío, ruido, cansancio—; mental: lo que viene pensando o trabajando; emocional: algo que siente o vivió con otros; transpersonal: lo que no encaja en las otras) y "por_que_fuente" en una frase.
- "cruce": si algo del sueño se conecta con su día anterior (abajo), en una o dos frases; null si no.
Forma: {"titulo": string, "escenas": [string], "personas": [string], "simbolos": [string], "emociones": [string], "lucido": boolean | null, "fuente": string, "por_que_fuente": string, "cruce": string | null}`

const lista = (x: unknown, n: number, largo = 120) => (Array.isArray(x) ? x : []).map((v) => String(v ?? '').trim().slice(0, largo)).filter(Boolean).slice(0, n)

/** Destila un sueño (en la nube: gasta tokens). */
export async function destilarSueno(db: Db, id: number, ahora = Date.now()): Promise<Sueno> {
  const s = leerSueno(db, id)
  if (!s) throw new Error(`No existe el sueño ${id}`)
  const [a, m, d] = s.fecha.split('-').map(Number)
  const ayer = fechaLocal(new Date(a, m - 1, d - 1, 12).getTime())
  const cronica = (db.prepare('SELECT contenido FROM corpus WHERE origen_id = ?').get(`cronica:${ayer}`) as { contenido: string } | undefined)?.contenido
  try {
    const r = await modelo(db, SISTEMA, `El sueño (${s.fecha}${s.lucido ? ', dijo que fue lúcido' : ''}${s.emociones.length ? `, emociones que nombró: ${s.emociones.join(', ')}` : ''}):\n${s.texto.slice(0, 6000)}\n\nSu día anterior (${ayer}):\n${cronica ? cronica.slice(0, 3000) : '(no hay crónica de ese día)'}`)
    const destilado: Destilado = {
      titulo: String(r?.titulo ?? '').trim().slice(0, 80) || s.texto.slice(0, 40), escenas: lista(r?.escenas, 6, 240), personas: lista(r?.personas, 8, 60),
      simbolos: lista(r?.simbolos, 8, 40).map((x) => x.toLowerCase()), emociones: [...new Set([...s.emociones, ...lista(r?.emociones, 5, 30).map((x) => x.toLowerCase())])],
      lucido: typeof r?.lucido === 'boolean' ? r.lucido : s.lucido, fuente: FUENTES_SUENO.includes(r?.fuente) ? r.fuente : null,
      por_que_fuente: r?.por_que_fuente ? String(r.por_que_fuente).slice(0, 240) : null, cruce: r?.cruce ? String(r.cruce).slice(0, 400) : null,
    }
    db.prepare(`UPDATE suenos SET destilado = ?, estado = 'destilado' WHERE id = ?`).run(JSON.stringify(destilado), id)
    if (s.piezaId) db.prepare('UPDATE corpus SET titulo = ? WHERE id = ?').run(`Sueño · ${s.fecha} · ${destilado.titulo}`, s.piezaId)
  } catch (e) {
    db.prepare(`UPDATE suenos SET estado = 'fallo' WHERE id = ?`).run(id)
    throw e
  }
  return leerSueno(db, id)!
}

/** El próximo sueño sin destilar (para el Procesar). false = no había. */
export async function destilarSuenoPendiente(db: Db, ahora = Date.now()): Promise<boolean> {
  const r = db.prepare(`SELECT id FROM suenos WHERE estado = 'pendiente' ORDER BY id LIMIT 1`).get() as { id: number } | undefined
  if (!r) return false
  await destilarSueno(db, r.id, ahora).catch((e) => console.error('  sueño:', e instanceof Error ? e.message : e))
  return true
}

/** La vista: los sueños, los símbolos que vuelven, las emociones por semana y quién aparece. */
export function vistaSuenos(db: Db, ahora = Date.now()) {
  const xs = (db.prepare('SELECT * FROM suenos ORDER BY fecha DESC, id DESC LIMIT 200').all() as any[]).map(deFila)
  const contar = (f: (s: Sueno) => string[]) => {
    const m = new Map<string, { n: number; suenos: number[] }>()
    for (const s of xs) for (const k of new Set(f(s))) { const x = m.get(k) ?? { n: 0, suenos: [] }; x.n++; x.suenos.push(s.id); m.set(k, x) }
    return [...m].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.n - a.n)
  }
  const semanas = Array.from({ length: 8 }, (_, i) => {
    const hasta = fechaLocal(ahora - i * 7 * DIA)
    const desde = fechaLocal(ahora - (i * 7 + 6) * DIA)
    const de = xs.filter((s) => s.fecha >= desde && s.fecha <= hasta)
    const em = new Map<string, number>()
    for (const s of de) for (const e of s.destilado?.emociones ?? s.emociones) em.set(e, (em.get(e) ?? 0) + 1)
    return { desde, hasta, suenos: de.length, emociones: [...em].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e, n]) => ({ e, n })) }
  }).reverse()
  return {
    suenos: xs.slice(0, 60),
    simbolos: contar((s) => s.destilado?.simbolos ?? []).filter((x) => x.n >= 2).slice(0, 20),
    personas: contar((s) => (s.destilado?.personas ?? []).map((p) => p.toLowerCase())).slice(0, 15),
    fuentes: contar((s) => (s.destilado?.fuente ? [s.destilado.fuente] : [])),
    semanas, lucidos: xs.filter((s) => s.destilado?.lucido ?? s.lucido).length, total: xs.length,
    pendientes: xs.filter((s) => s.estado === 'pendiente').length,
  }
}

// ─── creencias ──────────────────────────────────────────────────────────

const SISTEMA_CREENCIAS = `Te paso lo que se sabe del jugador (su memoria). Encontrá sus CREENCIAS fuertes: afirmaciones sobre cómo es el mundo, la plata, el trabajo, la gente o él mismo, que guían lo que hace («hay que hacer todo solo», «la plata viene del esfuerzo», «no soy bueno con los números»). No hechos ni gustos.
- Hasta 4, las que más pesan. Cada una en una frase corta, como la diría él (en primera persona o impersonal).
- "por_que": de qué recuerdo sale.
Forma: {"creencias": [{"creencia": string, "por_que": string}]}`

/** Una vez por mes (si toca): las creencias fuertes de su memoria, como preguntas de a una. Devuelve cuántas encoló. */
export async function preguntarCreencias(db: Db, ahora = Date.now(), o: { forzar?: boolean } = {}): Promise<number> {
  const ultima = Number(ajuste(db, 'creencias_ultima') ?? 0)
  if (!o.forzar && ahora - ultima < 28 * DIA) return 0
  const recuerdos = db.prepare(`SELECT texto FROM memoria WHERE estado = 'vigente' AND tipo IN ('hecho', 'preferencia', 'vision', 'meta') ORDER BY id DESC LIMIT 120`).all() as { texto: string }[]
  if (recuerdos.length < 5) return 0
  fijarAjuste(db, 'creencias_ultima', String(ahora))
  const r = await modelo(db, SISTEMA_CREENCIAS, recuerdos.map((x) => `- ${x.texto}`).join('\n'), 900)
  let n = 0
  for (const c of (Array.isArray(r?.creencias) ? r.creencias : []).slice(0, 4)) {
    const creencia = String(c?.creencia ?? '').trim().slice(0, 200)
    if (creencia.length < 8) continue
    const q = encolarPregunta(db, {
      texto: `«${creencia}»: ¿esto lo descubriste vos o lo heredaste (de tu familia, tu entorno, tu época)?`, tipo: 'opciones',
      opciones: ['Lo descubrí yo', 'Lo heredé', 'Las dos cosas', 'Ya no lo creo'], porQue: c?.por_que ? String(c.por_que).slice(0, 200) : 'Saber de dónde viene una creencia te deja elegir si la seguís.',
      tema: 'creencias', origen: 'creencias',
    }, ahora)
    if (q) n++
  }
  return n
}
