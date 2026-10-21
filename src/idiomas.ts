/**
 * Idiomas: una pista de aprendizaje por idioma, armada con lo que dice Languages Pedro, para alguien que habla castellano
 * y muchas veces arranca de cero.
 * - Sin un por qué no arranca: es lo que sostiene la constancia cuando la motivación se va. Y es lo que guía el temario.
 * - Todo lo que sale en el idioma viene con sus cuatro capas: el texto, la romanización (pinyin, romaji…), cómo suena
 *   para alguien que habla castellano y la traducción. Nada queda sin entender.
 * - La práctica es por sesiones, preparadas antes de abrirlas (una llamada al modelo trae el tema, las palabras, frases
 *   modelo, la pregunta y respuestas sugeridas, y los audios se generan todos juntos): abrir es instantáneo.
 * - El contenido es el idioma de todos los días al servicio de su para qué, por un temario por nivel. Nada de sus
 *   proyectos ni de su memoria: para eso está el resto de Deprocast.
 * - Las tarjetas son cortas (palabras y bloques) y también se hacen a mano. Cada sesión queda en el corpus y cuenta en
 *   Aprender. Telegram y el horario son opcionales: se practica en la app cuando quiera.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fechaLocal, json, type Db } from './db.ts'
import { crearAprendizaje, registrarPractica } from './aprender.ts'
import { crearTarjeta } from './tarjetas.ts'
import { pedirJson } from './modelo.ts'
import { nanTranscribir } from './nan.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { dirAdjuntos } from './chat/adjuntos.ts'
import { enLaNube } from './reproceso.ts'

/** Los idiomas que se pueden practicar: su nombre, si kokoro tiene una voz para escucharlo y su romanización (si no usa nuestro alfabeto). */
export const IDIOMAS: Record<string, { nombre: string; voz: string | null; roman?: string }> = {
  en: { nombre: 'Inglés', voz: 'af_heart' }, de: { nombre: 'Alemán', voz: null }, fr: { nombre: 'Francés', voz: 'ff_siwis' },
  it: { nombre: 'Italiano', voz: 'if_sara' }, pt: { nombre: 'Portugués', voz: 'pf_dora' }, ca: { nombre: 'Catalán', voz: null },
  nl: { nombre: 'Neerlandés', voz: null }, pl: { nombre: 'Polaco', voz: null }, ru: { nombre: 'Ruso', voz: null, roman: 'transliteración latina' },
  tr: { nombre: 'Turco', voz: null }, ar: { nombre: 'Árabe', voz: null, roman: 'transliteración latina' },
  ja: { nombre: 'Japonés', voz: 'jf_alpha', roman: 'romaji (Hepburn)' }, zh: { nombre: 'Chino', voz: 'zf_xiaobei', roman: 'pinyin con las marcas de tono' },
  ko: { nombre: 'Coreano', voz: null, roman: 'romanización revisada' }, hi: { nombre: 'Hindi', voz: 'hf_alpha', roman: 'transliteración latina' },
  el: { nombre: 'Griego', voz: null, roman: 'transliteración latina' }, sv: { nombre: 'Sueco', voz: null }, is: { nombre: 'Islandés', voz: null },
}
export const NIVELES = ['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const

/** Una frase (o palabra) en el idioma con sus cuatro capas, y su audio si ya está. */
export type Capa = { texto: string; pron: string | null; suena: string | null; es: string; nota?: string | null; audio?: string | null }
export type Paquete = { tema: string; objetivo: string; palabras: Capa[]; frases: Capa[]; pregunta: Capa; sugeridas: Capa[] }
export type Sesion = { id: number; aprendizajeId: number; tema: string; estado: 'lista' | 'en_curso' | 'hecha'; paquete: Paquete; piezaId: number | null; creadaEn: number; empezadaEn: number | null; cerradaEn: number | null }

type Charla = { abierta: boolean; pregunta: string | null; desde: number; ultima: number; mensajeId?: number | null; sesionId?: number | null }
export type Idioma = {
  aprendizajeId: number; codigo: string; nombre: string; nivel: string | null; objetivo: string | null; porQue: string | null; minutosDia: number; hora: string | null
  charla: Charla | null; ultimoEnvio: string | null; temario: string[]; temaIdx: number; sobreMi: string | null; intereses: string | null
}

const deFila = (r: any): Idioma => ({
  aprendizajeId: r.aprendizaje_id, codigo: r.codigo, nombre: r.nombre, nivel: r.nivel, objetivo: r.objetivo, porQue: r.por_que ?? null, minutosDia: r.minutos_dia, hora: r.hora,
  charla: json<Charla | null>(r.charla, null), ultimoEnvio: r.ultimo_envio, temario: json<string[]>(r.temario, []), temaIdx: r.tema_idx ?? 0, sobreMi: r.sobre_mi ?? null, intereses: r.intereses ?? null,
})
const SELECT = 'SELECT i.*, a.por_que FROM idiomas i JOIN aprendizajes a ON a.id = i.aprendizaje_id'
export const mazoDe = (aprendizajeId: number) => `idioma:${aprendizajeId}`
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const FUENTE = { id: 'idiomas', nombre: 'Idiomas', nivel: 'propia' as const, descripcion: 'Las sesiones de práctica de idiomas: tema, palabras, lo que dijo y las correcciones.' }

// ─── inyectable para tests ──────────────────────────────────────────────

let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'idiomas' }, sistema, usuario, { temperatura: 0.5, maxTokens: 3500 })).datos
let transcribir = (db: Db, audio: Buffer, nombre: string, idioma: string) => nanTranscribir(db, audio, nombre, idioma)
let voz = async (texto: string, v: string): Promise<Buffer> => (await import('./taller.ts')).sintetizar(texto, v)
let nube = enLaNube
export function _probarIdiomas(o: { modelo?: typeof modelo; transcribir?: typeof transcribir; voz?: typeof voz; nube?: () => boolean }) {
  if (o.modelo) modelo = o.modelo
  if (o.transcribir) transcribir = o.transcribir
  if (o.voz) voz = o.voz
  if (o.nube) nube = o.nube
}

// ─── las capas ──────────────────────────────────────────────────────────

const txt = (x: unknown, n = 300) => String(x ?? '').trim().slice(0, n)

/** Lo que vino del modelo, como capa: sin texto o sin traducción no sirve (se descarta). */
export function capa(x: any): Capa | null {
  const texto = txt(x?.texto ?? x?.frase)
  const es = txt(x?.es ?? x?.traduccion)
  if (!texto || !es) return null
  return { texto, pron: txt(x?.pron) || null, suena: txt(x?.suena) || null, es, nota: txt(x?.nota ?? x?.patron, 200) || null }
}
const capas = (xs: unknown, max: number) => (Array.isArray(xs) ? xs : []).map(capa).filter((c): c is Capa => !!c).slice(0, max)

/** Una capa en texto plano (Telegram, el corpus): el texto, la romanización y cómo suena, y la traducción. */
export function capaComoTexto(c: Capa, o: { negrita?: boolean } = {}): string {
  const lectura = [c.pron, c.suena ? `suena «${c.suena}»` : null].filter(Boolean).join(' · ')
  return [o.negrita ? `**${c.texto}**` : c.texto, lectura, o.negrita ? `_${c.es}_` : c.es].filter(Boolean).join('\n')
}

const REGLAS_CAPAS = (codigo: string, nombre: string) => {
  const roman = IDIOMAS[codigo]?.roman
  return `TODO lo que escribas en ${nombre} va con sus cuatro capas: {"texto": en ${nombre}, "pron": ${roman ? `la ${roman}` : 'null (usa nuestro alfabeto)'}, "suena": cómo suena para alguien que habla castellano rioplatense, por sílabas, con la sílaba fuerte con tilde (ej.: 你好 → "ni jáo"; bonjour → "bon-yúr"; thank you → "zénk-iu"), "es": la traducción natural al castellano}. Nunca dejes una capa vacía salvo "pron" cuando corresponde null.`
}
const REGLAS_NIVEL: Record<string, string> = {
  A0: 'Arranca de cero: frases de 2 a 6 palabras, vocabulario de altísima frecuencia, UNA sola estructura nueva por sesión, todo repetible.',
  A1: 'Frases cortas y simples, presente, vocabulario de todos los días; una o dos estructuras nuevas.',
  A2: 'Frases simples encadenadas, pasado y futuro básicos, situaciones de la vida diaria.',
  B1: 'Lenguaje natural de todos los días, opiniones simples, conectores.',
}
const reglaNivel = (nivel: string | null) => REGLAS_NIVEL[nivel ?? 'A1'] ?? 'Natural y con matices, como habla un nativo.'

/** Lo que guía el contenido: su para qué, su nivel, lo que le interesa y una línea sobre él. Nunca su memoria ni sus proyectos. */
function contexto(i: Idioma, extra: string[] = []) {
  return [
    `Su para qué (lo que guía todo): ${i.porQue ?? '(no dijo)'}`,
    `Nivel: ${i.nivel ?? 'A1'}${i.objetivo ? ` → quiere llegar a ${i.objetivo}` : ''}`,
    i.intereses ? `Temas que le interesan: ${i.intereses}` : '',
    i.sobreMi ? `Sobre él (solo para personalizar un poco; no hables de su trabajo ni de sus proyectos): ${i.sobreMi}` : '',
    ...extra,
  ].filter(Boolean).join('\n')
}

// ─── los idiomas ────────────────────────────────────────────────────────

export function leerIdioma(db: Db, aprendizajeId: number): Idioma | null {
  const r = db.prepare(`${SELECT} WHERE i.aprendizaje_id = ?`).get(aprendizajeId)
  return r ? deFila(r) : null
}

export function crearIdioma(db: Db, x: { codigo: string; nivel?: string | null; objetivo?: string | null; porQue?: string | null; minutosDia?: number | null; hora?: string | null; sobreMi?: string | null; intereses?: string | null }, ahora = Date.now()): Idioma {
  const codigo = String(x.codigo ?? '').toLowerCase().trim()
  const def = IDIOMAS[codigo]
  if (!def) throw new Error(`No conozco el idioma «${x.codigo}»`)
  // Sin un por qué no arranca (Pedro): es lo que lo sostiene cuando la motivación se va.
  const porQue = String(x.porQue ?? '').trim()
  if (porQue.length < 10) throw new Error(`Antes de arrancar: ¿para qué querés aprender ${def.nombre.toLowerCase()}? (una o dos frases: es lo que te va a sostener cuando baje la motivación)`)
  if (x.hora && !HORA.test(x.hora)) throw new Error('La hora va como HH:MM')
  const nivel = NIVELES.includes(x.nivel as any) ? x.nivel! : 'A0'
  const a = crearAprendizaje(db, { tema: `Idioma · ${def.nombre}`, porQue, nivelActual: nivel, nivelObjetivo: x.objetivo ?? null }, ahora)
  if (leerIdioma(db, a.id)) throw new Error(`Ya estás aprendiendo ${def.nombre.toLowerCase()}`)
  db.prepare('INSERT INTO idiomas (aprendizaje_id, codigo, nombre, nivel, objetivo, minutos_dia, hora, sobre_mi, intereses, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(a.id, codigo, def.nombre, nivel, x.objetivo?.trim() || null, Math.max(5, Math.min(240, Number(x.minutosDia) || 15)), x.hora || null, txt(x.sobreMi) || null, txt(x.intereses) || null, ahora)
  return leerIdioma(db, a.id)!
}

export function editarIdioma(db: Db, id: number, c: { nivel?: string; objetivo?: string; porQue?: string; minutosDia?: number; hora?: string | null; sobreMi?: string | null; intereses?: string | null }) {
  const i = leerIdioma(db, id)
  if (!i) throw new Error(`No existe el idioma ${id}`)
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
  if (c.sobreMi !== undefined) db.prepare('UPDATE idiomas SET sobre_mi = ? WHERE aprendizaje_id = ?').run(txt(c.sobreMi) || null, id)
  // Si cambian los intereses o el nivel, el temario se vuelve a armar en la próxima sesión (y las sesiones listas se rehacen).
  const intereses = c.intereses === undefined ? i.intereses : txt(c.intereses) || null
  if (intereses !== i.intereses || (c.nivel && c.nivel !== i.nivel)) {
    db.prepare('UPDATE idiomas SET intereses = ?, temario = NULL, tema_idx = 0 WHERE aprendizaje_id = ?').run(intereses, id)
    db.prepare(`DELETE FROM idioma_sesiones WHERE aprendizaje_id = ? AND estado = 'lista'`).run(id)
  }
  return leerIdioma(db, id)!
}

/** Los días de este mes con práctica: un conteo que no se borra (un día sin practicar no le resta nada). */
function diasDelMes(db: Db, id: number, ahora: number): number {
  const hoy = fechaLocal(ahora)
  return (db.prepare('SELECT COUNT(DISTINCT fecha) AS n FROM practicas WHERE aprendizaje_id = ? AND fecha >= ? AND fecha <= ?').get(id, `${hoy.slice(0, 7)}-01`, hoy) as { n: number }).n
}

/** Cada idioma con su progreso: días de este mes, minutos de la semana, sesiones, palabras (tarjetas), el temario y la próxima sesión lista. */
export function listarIdiomas(db: Db, ahora = Date.now()) {
  const hoy = fechaLocal(ahora)
  const semana = fechaLocal(ahora - 6 * 86_400_000)
  return (db.prepare(`${SELECT} ORDER BY i.creado_en`).all() as any[]).map(deFila).map((i) => {
    const t = db.prepare(`SELECT COUNT(*) AS total, SUM(proxima <= ?) AS hoy, SUM(intervalo >= 21) AS aprendidas FROM tarjetas WHERE mazo = ? AND estado = 'activa'`).get(hoy, mazoDe(i.aprendizajeId)) as any
    const minutos = (db.prepare('SELECT COALESCE(SUM(minutos), 0) AS m FROM practicas WHERE aprendizaje_id = ? AND fecha >= ?').get(i.aprendizajeId, semana) as { m: number }).m
    const turnos = db.prepare('SELECT id, fecha, pregunta, respuesta, por_voz, devolucion FROM idioma_turnos WHERE aprendizaje_id = ? AND respuesta IS NOT NULL ORDER BY id DESC LIMIT 6').all(i.aprendizajeId) as any[]
    const s = db.prepare(`SELECT SUM(estado = 'hecha') AS hechas FROM idioma_sesiones WHERE aprendizaje_id = ?`).get(i.aprendizajeId) as { hechas: number | null }
    const lista = sesionLista(db, i.aprendizajeId)
    const enCurso = sesionEnCurso(db, i.aprendizajeId, ahora)
    return {
      ...i, diasMes: diasDelMes(db, i.aprendizajeId, ahora), minutosSemana: minutos, metaSemana: i.minutosDia * 7,
      charlas: turnos.length ? (db.prepare('SELECT COUNT(*) AS n FROM idioma_turnos WHERE aprendizaje_id = ? AND respuesta IS NOT NULL').get(i.aprendizajeId) as { n: number }).n : 0,
      sesiones: s.hechas ?? 0, proxima: lista ? { id: lista.id, tema: lista.tema } : null, enCurso: enCurso ? { id: enCurso.id, tema: enCurso.tema } : null,
      tarjetas: { total: t.total ?? 0, hoy: t.hoy ?? 0, aprendidas: t.aprendidas ?? 0 }, conVoz: !!IDIOMAS[i.codigo]?.voz, roman: IDIOMAS[i.codigo]?.roman ?? null,
      ultimos: turnos.map((x) => ({ ...x, devolucion: json<any>(x.devolucion, null) })),
    }
  })
}

// ─── el audio ───────────────────────────────────────────────────────────

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

/** Los audios de muchas capas a la vez (de a 4): cada una queda con su «audio». Si uno falla, esa capa queda sin audio. */
async function conAudios(codigo: string, xs: Capa[]): Promise<void> {
  if (!IDIOMAS[codigo]?.voz) return
  const cola = xs.filter((c) => !c.audio)
  const trabajar = async () => {
    for (let c = cola.shift(); c; c = cola.shift()) {
      try { c.audio = await audioDeFrase(c.texto, codigo, dirAdjuntos()) } catch { c.audio = null }
    }
  }
  await Promise.all(Array.from({ length: 4 }, trabajar))
}

// ─── las sesiones ───────────────────────────────────────────────────────

const deSesion = (r: any): Sesion => ({ id: r.id, aprendizajeId: r.aprendizaje_id, tema: r.tema, estado: r.estado, paquete: json<Paquete>(r.paquete, null as any), piezaId: r.pieza_id, creadaEn: r.creada_en, empezadaEn: r.empezada_en, cerradaEn: r.cerrada_en })
export function leerSesion(db: Db, id: number): Sesion | null {
  const r = db.prepare('SELECT * FROM idioma_sesiones WHERE id = ?').get(id)
  return r ? deSesion(r) : null
}
export function sesionLista(db: Db, id: number): Sesion | null {
  const r = db.prepare(`SELECT * FROM idioma_sesiones WHERE aprendizaje_id = ? AND estado = 'lista' ORDER BY id LIMIT 1`).get(id)
  return r ? deSesion(r) : null
}
/** La sesión que está en curso (si se movió en los últimos 45 minutos): abrir de nuevo la retoma. */
function sesionEnCurso(db: Db, id: number, ahora: number): Sesion | null {
  const r = db.prepare(`SELECT * FROM idioma_sesiones WHERE aprendizaje_id = ? AND estado = 'en_curso' ORDER BY id DESC LIMIT 1`).get(id) as any
  if (!r) return null
  const i = leerIdioma(db, id)
  const ultima = i?.charla?.sesionId === r.id ? i!.charla!.ultima : r.empezada_en
  return ahora - (ultima ?? 0) < 45 * 60_000 ? deSesion(r) : null
}

const FORMA_SESION = `{"tema": string, "objetivo": string, "palabras": [capa + "nota"], "frases": [capa + "nota"], "pregunta": capa, "sugeridas": [capa]}`
const PIDE_SESION = `- "tema": el título corto, en castellano.
- "objetivo": en castellano, qué va a poder decir al terminar (una frase).
- "palabras": de 6 a 10 palabras o bloques cortos (1 a 4 palabras) clave para el tema, cada una con sus capas y "nota" (cuándo se usa, en castellano y corto, o null).
- "frases": 3 frases modelo cortas que usen esas palabras, con sus capas y "nota" (la estructura que muestran, en castellano).
- "pregunta": tu primera pregunta, simple, para que conteste usando lo de hoy, con sus capas.
- "sugeridas": 3 respuestas que él podría dar, cortas y de su nivel, con sus capas.`

const SISTEMA_SESION = (i: Idioma) => `Sos el profe de ${i.nombre} de alguien que habla castellano. Armás UNA sesión de práctica corta sobre el tema que te paso: lo que necesita para decir cosas útiles sobre ese tema en una situación real, al servicio de su para qué. Es el idioma de todos los días; nada de su trabajo ni de sus proyectos.
${PIDE_SESION}
${REGLAS_CAPAS(i.codigo, i.nombre)}
Nivel: ${reglaNivel(i.nivel)}
Forma: ${FORMA_SESION}`

const SISTEMA_KIT = (i: Idioma) => `Sos el profe de ${i.nombre} de alguien que habla castellano y recién empieza este camino. Le armás el arranque completo, de una:
- "temario": 12 temas en orden, cortos y en castellano, del más básico al más avanzado para su nivel, guiados por su para qué (ej. para chino A0: "Saludar y presentarte", "Números y precios", "Pedir comida", …).
- "basicas": 8 bloques supervivencia que sirven siempre (hola, gracias, por favor, no entiendo, ¿cómo se dice…?, más despacio por favor, …), con sus capas y "nota".
- "sesion": la primera sesión, sobre el primer tema del temario:
${PIDE_SESION.replace(/^/gm, '  ')}
${REGLAS_CAPAS(i.codigo, i.nombre)}
Nivel: ${reglaNivel(i.nivel)}
Forma: {"temario": [string], "basicas": [capa + "nota"], "sesion": ${FORMA_SESION}}`

/** El paquete normalizado: sin pregunta no hay sesión. */
function paqueteDe(d: any, tema: string): Paquete {
  const pregunta = capa(d?.pregunta)
  if (!pregunta) throw new Error('No pude armar la sesión, probá de nuevo')
  return { tema: txt(d?.tema, 120) || tema, objetivo: txt(d?.objetivo, 300), palabras: capas(d?.palabras, 10), frases: capas(d?.frases, 3), pregunta, sugeridas: capas(d?.sugeridas, 3) }
}

const preparando = new Map<number, Promise<Sesion>>()

/**
 * Prepara la próxima sesión de un idioma: una llamada al modelo (la primera vez, el kit: temario, básicas como tarjetas y la
 * primera sesión) y después todos los audios juntos. Queda «lista» para abrir al instante. tema: uno elegido por él.
 */
export function prepararSesion(db: Db, id: number, o: { tema?: string | null; ahora?: number } = {}): Promise<Sesion> {
  const ya = preparando.get(id)
  if (ya && !o.tema) return ya
  const p = (async () => {
    const ahora = o.ahora ?? Date.now()
    const i = leerIdioma(db, id)
    if (!i) throw new Error(`No existe el idioma ${id}`)
    const sabe = (db.prepare(`SELECT dorso FROM tarjetas WHERE mazo = ? AND estado = 'activa' ORDER BY id DESC LIMIT 30`).all(mazoDe(id)) as { dorso: string }[]).map((t) => t.dorso.split('\n')[0])
    const hechos = (db.prepare(`SELECT tema FROM idioma_sesiones WHERE aprendizaje_id = ? ORDER BY id DESC LIMIT 6`).all(id) as { tema: string }[]).map((s) => s.tema)
    let paquete: Paquete
    if (!i.temario.length) {
      const d = await modelo(db, SISTEMA_KIT(i), contexto(i))
      const temario = (Array.isArray(d?.temario) ? d.temario : []).map((t: unknown) => txt(t, 80)).filter(Boolean).slice(0, 20)
      paquete = paqueteDe(d?.sesion, o.tema || temario[0] || 'Saludar y presentarte')
      db.prepare('UPDATE idiomas SET temario = ?, tema_idx = 0 WHERE aprendizaje_id = ?').run(JSON.stringify(temario.length ? temario : [paquete.tema]), id)
      // Las básicas, de una como tarjetas: puede empezar a repasar antes de la primera charla.
      const basicas = capas(d?.basicas, 10)
      await conAudios(i.codigo, basicas)
      for (const b of basicas) tarjetaDeCapa(db, id, b, ahora, { tipo: 'idioma_basica', id })
    } else {
      const tema = o.tema || i.temario[i.temaIdx % i.temario.length]
      const extra = [`Tema de hoy: ${tema}`, hechos.length ? `Ya practicó: ${hechos.join(' · ')}` : '', sabe.length ? `Lo que ya está aprendiendo (reusalo y sumá poco nuevo): ${sabe.join(' · ')}` : '']
      paquete = paqueteDe(await modelo(db, SISTEMA_SESION(i), contexto(i, extra)), tema)
    }
    await conAudios(i.codigo, [...paquete.palabras, ...paquete.frases, paquete.pregunta, ...paquete.sugeridas])
    const sid = Number(db.prepare('INSERT INTO idioma_sesiones (aprendizaje_id, tema, paquete, estado, creada_en) VALUES (?, ?, ?, ?, ?)').run(id, paquete.tema, JSON.stringify(paquete), 'lista', ahora).lastInsertRowid)
    return leerSesion(db, sid)!
  })()
  if (!o.tema) {
    preparando.set(id, p)
    p.then(() => preparando.delete(id), () => preparando.delete(id))
  }
  return p
}

/** En la nube, la próxima sesión se prepara sola (gasta tokens: en la compu, solo cuando la pedís). */
export function prepararEnFondo(db: Db, id: number) {
  if (!nube() || sesionLista(db, id)) return
  prepararSesion(db, id).catch((e) => console.error('  idiomas: preparar sesión:', e instanceof Error ? e.message : e))
}

const guardarCharla = (db: Db, id: number, c: Charla | null) => db.prepare('UPDATE idiomas SET charla = ? WHERE aprendizaje_id = ?').run(c ? JSON.stringify(c) : null, id)

/**
 * Abre la práctica: la sesión en curso (si la dejó hace poco), la que ya estaba lista o, si no hay, la prepara ahora. tema:
 * una sesión sobre otro tema (se prepara en el momento). Devuelve la sesión entera (para la app) y el mensaje (para Telegram).
 */
export async function abrirPractica(db: Db, id: number, ahora = Date.now(), o: { tema?: string | null } = {}): Promise<{ sesion: Sesion; mensaje: string; ayuda: string; turnoId: number | null; retomar?: { vueltas: number; respuesta: Capa | null; pregunta: Capa | null; sugeridas: Capa[] } }> {
  const i = leerIdioma(db, id)
  if (!i) throw new Error(`No existe el idioma ${id}`)
  const seguir = !o.tema ? sesionEnCurso(db, id, ahora) : null
  if (seguir) {
    const turno = db.prepare('SELECT id, pregunta FROM idioma_turnos WHERE sesion_id = ? AND respuesta IS NULL ORDER BY id DESC LIMIT 1').get(seguir.id) as { id: number; pregunta: string } | undefined
    guardarCharla(db, id, { abierta: true, pregunta: turno?.pregunta ?? seguir.paquete.pregunta.texto, desde: i.charla?.desde ?? ahora, ultima: ahora, sesionId: seguir.id, mensajeId: i.charla?.mensajeId ?? null })
    // Retomar donde quedó: la última pregunta (con sus capas) y sus respuestas sugeridas.
    const vueltas = db.prepare('SELECT devolucion FROM idioma_turnos WHERE sesion_id = ? AND devolucion IS NOT NULL ORDER BY id').all(seguir.id) as { devolucion: string }[]
    const ult = json<any>(vueltas.at(-1)?.devolucion, null)
    const pregunta = ult?.pregunta ?? seguir.paquete.pregunta
    return { sesion: seguir, mensaje: pregunta.texto, ayuda: pregunta.es, turnoId: turno?.id ?? null, retomar: { vueltas: vueltas.length, respuesta: ult?.respuesta ?? null, pregunta, sugeridas: ult?.sugeridas ?? seguir.paquete.sugeridas } }
  }
  const s = (!o.tema && sesionLista(db, id)) || await prepararSesion(db, id, { tema: o.tema, ahora })
  // La que estaba en curso (vieja) se da por hecha; la nueva arranca.
  for (const v of db.prepare(`SELECT id FROM idioma_sesiones WHERE aprendizaje_id = ? AND estado = 'en_curso'`).all(id) as { id: number }[]) cerrarSesion(db, v.id, ahora)
  db.prepare(`UPDATE idioma_sesiones SET estado = 'en_curso', empezada_en = ? WHERE id = ?`).run(ahora, s.id)
  if (!o.tema) db.prepare('UPDATE idiomas SET tema_idx = tema_idx + 1 WHERE aprendizaje_id = ?').run(id)
  db.prepare('DELETE FROM idioma_turnos WHERE aprendizaje_id = ? AND respuesta IS NULL').run(id)
  const turnoId = Number(db.prepare('INSERT INTO idioma_turnos (aprendizaje_id, sesion_id, fecha, pregunta, en) VALUES (?, ?, ?, ?, ?)').run(id, s.id, fechaLocal(ahora), s.paquete.pregunta.texto, ahora).lastInsertRowid)
  guardarCharla(db, id, { abierta: true, pregunta: s.paquete.pregunta.texto, desde: ahora, ultima: ahora, sesionId: s.id, mensajeId: null })
  piezaDeSesion(db, s.id, ahora)
  prepararEnFondo(db, id) // la siguiente, para que también abra al instante
  return { sesion: leerSesion(db, s.id)!, mensaje: s.paquete.pregunta.texto, ayuda: s.paquete.pregunta.es, turnoId }
}

/** La práctica que está abierta (la última, si hubo actividad en los últimos 45 minutos): para Telegram. */
export function practicaAbierta(db: Db, ahora = Date.now()): Idioma | null {
  const xs = (db.prepare(`${SELECT} WHERE i.charla IS NOT NULL`).all() as any[]).map(deFila).filter((i) => i.charla?.abierta && ahora - i.charla.ultima < 45 * 60_000)
  return xs.sort((a, b) => b.charla!.ultima - a.charla!.ultima)[0] ?? null
}

/** Termina la práctica: la sesión queda hecha y su pieza al día. Devuelve el resumen (palabras, tarjetas, minutos, la pieza). */
export function cerrarPractica(db: Db, id: number, ahora = Date.now()) {
  const i = leerIdioma(db, id)
  if (i?.charla) guardarCharla(db, id, { ...i.charla, abierta: false })
  const s = i?.charla?.sesionId ? leerSesion(db, i.charla.sesionId) : null
  return s && s.estado === 'en_curso' ? cerrarSesion(db, s.id, ahora) : null
}

function cerrarSesion(db: Db, sid: number, ahora: number) {
  db.prepare(`UPDATE idioma_sesiones SET estado = 'hecha', cerrada_en = ? WHERE id = ?`).run(ahora, sid)
  const piezaId = piezaDeSesion(db, sid, ahora)
  const s = leerSesion(db, sid)!
  const vueltas = (db.prepare('SELECT COUNT(*) AS n FROM idioma_turnos WHERE sesion_id = ? AND respuesta IS NOT NULL').get(sid) as { n: number }).n
  // Las tarjetas nuevas mientras duró la sesión: las de sus palabras, lo que le faltó y las ⭐ que marcó.
  const tarjetas = (db.prepare(`SELECT COUNT(*) AS n FROM tarjetas WHERE mazo = ? AND ((origen_tipo = 'idioma_sesion' AND origen_id = ?) OR (origen_tipo = 'idioma_mano' AND creada_en BETWEEN ? AND ?))`).get(mazoDe(s.aprendizajeId), sid, s.empezadaEn ?? ahora, ahora) as { n: number }).n
  return { sesionId: sid, tema: s.tema, vueltas, palabras: s.paquete.palabras.length, tarjetas, minutos: Math.max(1, Math.round((ahora - (s.empezadaEn ?? ahora)) / 60_000)), piezaId }
}

export function marcarMensajePractica(db: Db, id: number, mensajeId: number | null) {
  const i = leerIdioma(db, id)
  if (i?.charla) guardarCharla(db, id, { ...i.charla, mensajeId })
}

// ─── la respuesta y la devolución ───────────────────────────────────────

const SISTEMA_DEVOLUCION = (i: Idioma, tema: string) => `Sos el profe de ${i.nombre} de alguien que habla castellano (nivel ${i.nivel ?? 'A1'}). Están practicando «${tema}». Te paso tu pregunta y lo que él contestó (si vino de un audio, ignorá muletillas y errores de transcripción obvios; si contestó en castellano porque no le salía, ayudalo a decirlo en ${i.nombre}).
Devolvé:
- "correcciones": 0 a 3 cosas para mejorar, solo si hace falta: {"dijo": el fragmento tal cual, "natural": cómo lo diría un nativo (con sus capas), "por_que": en castellano, una frase, el patrón en contexto}.
- "nuevas": 0 a 3 palabras o bloques cortos (1 a 4 palabras) que le faltaron para decir lo que quiso, con sus capas y "nota".
- "respuesta": tu respuesta corta a lo que dijo, con sus capas; y "pregunta": la siguiente pregunta, simple y sobre el mismo tema, con sus capas.
- "sugeridas": 3 respuestas posibles a esa pregunta, cortas y de su nivel, con sus capas.
- "animo": en castellano, una frase corta con lo que hizo bien.
- "nivel": el nivel que muestra esta respuesta (A0…C2) o null.
${REGLAS_CAPAS(i.codigo, i.nombre)}
Nivel: ${reglaNivel(i.nivel)}
Forma: {"correcciones": [{"dijo": string, "natural": capa, "por_que": string}], "nuevas": [capa + "nota"], "respuesta": capa, "pregunta": capa, "sugeridas": [capa], "animo": string, "nivel": string|null}`

/** Una tarjeta corta de una capa: de lo que quiere decir (castellano) a cómo se dice, con cómo se lee y cómo suena. */
function tarjetaDeCapa(db: Db, id: number, c: Capa, ahora: number, origen: { tipo: string; id: number } | null = null): boolean {
  const lectura = [c.pron, c.suena ? `suena «${c.suena}»` : null].filter(Boolean).join(' · ')
  return crearTarjeta(db, {
    mazo: mazoDe(id), frente: `¿Cómo se dice: «${c.es}»?`, dorso: [c.texto, lectura, c.nota].filter(Boolean).join('\n'),
    origenTipo: origen?.tipo ?? 'idioma_mano', origenId: origen?.id ?? null,
  }, ahora).nueva
}

/**
 * Lo que contestó (texto o audio): la devolución con capas (correcciones, palabras que le faltaron, la charla sigue con
 * respuestas sugeridas) y sus audios, todo en el mismo pedido. La primera vuelta de la sesión deja sus palabras como
 * tarjetas (hasta 6); las que le faltaron también. Cuenta en Aprender y la sesión queda al día en el corpus.
 */
export async function responderPractica(db: Db, id: number, r: { texto?: string | null; audio?: Buffer | null; nombreAudio?: string; segundos?: number | null }, ahora = Date.now()) {
  const i = leerIdioma(db, id)
  if (!i) throw new Error(`No existe el idioma ${id}`)
  let texto = String(r.texto ?? '').trim()
  const porVoz = !!r.audio?.length
  if (porVoz) texto = (await transcribir(db, r.audio!, r.nombreAudio || 'audio.ogg', i.codigo)).trim()
  if (!texto) throw new Error(porVoz ? 'No se entendió el audio: probá de nuevo, más cerca del micrófono' : 'Escribí o grabá tu respuesta')
  const sesion = i.charla?.sesionId ? leerSesion(db, i.charla.sesionId) : null
  const pregunta = i.charla?.pregunta ?? '(sin pregunta: habló él primero)'
  const d = await modelo(db, SISTEMA_DEVOLUCION(i, sesion?.tema ?? 'charla libre'), `Tu pregunta: ${pregunta}\n\nLo que contestó${porVoz ? ' (por audio, transcripto)' : ''}: ${texto}`)
  const devolucion = {
    correcciones: (Array.isArray(d?.correcciones) ? d.correcciones : []).slice(0, 3)
      .map((c: any) => ({ dijo: txt(c?.dijo), natural: capa(c?.natural), por_que: txt(c?.por_que) }))
      .filter((c: any): c is { dijo: string; natural: Capa; por_que: string } => !!c.dijo && !!c.natural),
    nuevas: capas(d?.nuevas, 3), respuesta: capa(d?.respuesta), pregunta: capa(d?.pregunta), sugeridas: capas(d?.sugeridas, 3),
    animo: txt(d?.animo), nivel: NIVELES.includes(d?.nivel) ? (d.nivel as string) : null,
  }
  // Todos los audios de la devolución juntos: llega lista para escuchar.
  await conAudios(i.codigo, [...devolucion.correcciones.map((c: { natural: Capa }) => c.natural), ...devolucion.nuevas, ...[devolucion.respuesta, devolucion.pregunta].filter((c): c is Capa => !!c), ...devolucion.sugeridas])

  const abierto = db.prepare('SELECT id FROM idioma_turnos WHERE aprendizaje_id = ? AND respuesta IS NULL ORDER BY id DESC LIMIT 1').get(id) as { id: number } | undefined
  let turnoId: number
  if (abierto) {
    db.prepare('UPDATE idioma_turnos SET respuesta = ?, por_voz = ?, devolucion = ?, en = ? WHERE id = ?').run(texto, porVoz ? 1 : 0, JSON.stringify(devolucion), ahora, abierto.id)
    turnoId = abierto.id
  } else {
    turnoId = Number(db.prepare('INSERT INTO idioma_turnos (aprendizaje_id, sesion_id, fecha, pregunta, respuesta, por_voz, devolucion, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, sesion?.id ?? null, fechaLocal(ahora), pregunta, texto, porVoz ? 1 : 0, JSON.stringify(devolucion), ahora).lastInsertRowid)
  }
  // Tarjetas cortas: las palabras de la sesión la primera vez que practica en ella (hasta 6) y lo que le faltó.
  let nuevas = 0
  if (sesion && !(db.prepare(`SELECT 1 FROM tarjetas WHERE mazo = ? AND origen_tipo = 'idioma_sesion' AND origen_id = ?`).get(mazoDe(id), sesion.id))) {
    for (const p of sesion.paquete.palabras.slice(0, 6)) if (tarjetaDeCapa(db, id, p, ahora, { tipo: 'idioma_sesion', id: sesion.id })) nuevas++
  }
  for (const n of devolucion.nuevas) if (tarjetaDeCapa(db, id, n, ahora, { tipo: sesion ? 'idioma_sesion' : 'idioma_turno', id: sesion?.id ?? turnoId })) nuevas++

  const siguiente = [devolucion.respuesta?.texto, devolucion.pregunta?.texto].filter(Boolean).join(' ')
  if (devolucion.pregunta) db.prepare('INSERT INTO idioma_turnos (aprendizaje_id, sesion_id, fecha, pregunta, en) VALUES (?, ?, ?, ?, ?)').run(id, sesion?.id ?? null, fechaLocal(ahora), siguiente, ahora)
  guardarCharla(db, id, { abierta: true, pregunta: siguiente || pregunta, desde: i.charla?.desde ?? ahora, ultima: ahora, mensajeId: i.charla?.mensajeId ?? null, sesionId: sesion?.id ?? null })
  const minutos = porVoz ? Math.max(2, Math.round((r.segundos ?? 60) / 60) + 2) : 3
  registrarPractica(db, { aprendizajeId: id, minutos, que: `${sesion ? `${sesion.tema} · ` : ''}charla en ${i.nombre.toLowerCase()}: ${texto.slice(0, 120)}`, fuente: 'idiomas' }, ahora)
  if (sesion) piezaDeSesion(db, sesion.id, ahora)
  return { transcripcion: porVoz ? texto : null, ...devolucion, tarjetasNuevas: nuevas, turnoId }
}

// ─── tarjetas a mano ────────────────────────────────────────────────────

const SISTEMA_COMPLETAR = (i: Idioma) => `Te paso líneas que alguien que habla castellano quiere saber decir en ${i.nombre} (pueden venir en castellano o ya en ${i.nombre}). Para cada una devolvé la forma más natural y corta, con sus capas y "nota" (cuándo se usa, corto, o null). Respetá el orden; una por línea.
${REGLAS_CAPAS(i.codigo, i.nombre)}
Forma: {"tarjetas": [capa + "nota"]}`

/** Completa varias tarjetas de una (una llamada): devuelve borradores para revisar, no guarda nada. */
export async function completarTarjetas(db: Db, id: number, lineas: string[]): Promise<Capa[]> {
  const i = leerIdioma(db, id)
  if (!i) throw new Error(`No existe el idioma ${id}`)
  const xs = lineas.map((l) => txt(l, 200)).filter(Boolean).slice(0, 30)
  if (!xs.length) throw new Error('Escribí al menos una cosa que quieras saber decir')
  const borradores = capas((await modelo(db, SISTEMA_COMPLETAR(i), xs.map((l, n) => `${n + 1}. ${l}`).join('\n')))?.tarjetas, 30)
  await conAudios(i.codigo, borradores)
  return borradores
}

/** Guarda tarjetas hechas o revisadas a mano (texto y traducción obligatorios). Devuelve cuántas nuevas. */
export function guardarTarjetas(db: Db, id: number, items: unknown[], ahora = Date.now()): number {
  if (!leerIdioma(db, id)) throw new Error(`No existe el idioma ${id}`)
  let n = 0
  for (const x of Array.isArray(items) ? items : []) {
    const c = capa(x)
    if (c && tarjetaDeCapa(db, id, c, ahora)) n++
  }
  return n
}

// ─── el registro en el corpus ───────────────────────────────────────────

/** La sesión como pieza del corpus (una por sesión, al día en cada vuelta): tema, palabras, la charla y las correcciones. */
function piezaDeSesion(db: Db, sid: number, ahora: number): number | null {
  const s = leerSesion(db, sid)
  const i = s ? leerIdioma(db, s.aprendizajeId) : null
  if (!s || !i) return null
  asegurarFuente(db, FUENTE)
  const turnos = db.prepare('SELECT pregunta, respuesta, devolucion FROM idioma_turnos WHERE sesion_id = ? AND respuesta IS NOT NULL ORDER BY id').all(sid) as { pregunta: string; respuesta: string; devolucion: string | null }[]
  const p = s.paquete
  const contenido = [
    `Práctica de ${i.nombre.toLowerCase()} (${i.nivel ?? 'A1'}) · ${s.tema}`,
    p.objetivo ? `Objetivo: ${p.objetivo}` : '',
    `Palabras de la sesión:\n${p.palabras.map((c) => `- ${c.texto}${c.pron ? ` (${c.pron})` : ''}: ${c.es}`).join('\n')}`,
    turnos.length ? `La charla:\n${turnos.map((t) => {
      const d = json<any>(t.devolucion, null)
      return `- Pregunta: ${t.pregunta}\n  Dije: ${t.respuesta}${d?.correcciones?.length ? `\n  Correcciones: ${d.correcciones.map((c: any) => `${c.dijo} → ${c.natural?.texto ?? c.natural}`).join('; ')}` : ''}${d?.nuevas?.length ? `\n  Me faltó: ${d.nuevas.map((c: any) => `${c.texto} (${c.es})`).join('; ')}` : ''}`
    }).join('\n')}` : 'Todavía sin vueltas.',
  ].filter(Boolean).join('\n\n')
  const origen = `idiomas:${s.aprendizajeId}:${sid}`
  const fecha = fechaLocal(s.empezadaEn ?? ahora)
  const ya = db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(origen) as { id: number } | undefined
  let pieza: number | null
  if (ya) {
    db.prepare('UPDATE corpus SET contenido = ? WHERE id = ?').run(contenido, ya.id)
    pieza = ya.id
  } else {
    pieza = insertar(db, {
      fuente: FUENTE.id, nivel: 'propia', titulo: `Práctica de ${i.nombre.toLowerCase()} · ${fecha} · ${s.tema}`, contenido, estado: 'disponible', fecha,
      etiquetas: ['idiomas', i.codigo], origenId: origen, meta: { tipo: 'idioma_sesion', idioma: i.codigo, sesion: sid },
    }, ahora)
  }
  if (pieza && s.piezaId !== pieza) db.prepare('UPDATE idioma_sesiones SET pieza_id = ? WHERE id = ?').run(pieza, sid)
  return pieza
}

// ─── la práctica programada (por Telegram, opcional) ────────────────────

/** Los idiomas a los que hoy ya les toca la práctica (pasó su hora y todavía no se mandó). Sin hora, nunca: se practica en la app. */
export function practicasQueTocan(db: Db, ahora = Date.now()): Idioma[] {
  const d = new Date(ahora)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const hoy = fechaLocal(ahora)
  return (db.prepare(`${SELECT} WHERE i.hora IS NOT NULL`).all() as any[]).map(deFila).filter((i) => i.hora! <= hhmm && i.ultimoEnvio !== hoy)
}
export const marcarEnviada = (db: Db, id: number, ahora = Date.now()) => db.prepare('UPDATE idiomas SET ultimo_envio = ? WHERE aprendizaje_id = ?').run(fechaLocal(ahora), id)
