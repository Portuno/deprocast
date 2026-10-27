/**
 * Campañas con su gente (plan v27). Una iniciativa suya alrededor de un momento (un programa, un evento): su mensaje, el
 * hashtag (con un chequeo de si ya se usa y para qué), las piezas para sus cuentas antes, durante y después, la
 * invitación para su comunidad, el evento en el calendario y el Observatorio siguiéndola en vivo; al terminar, un informe.
 *
 * Reglas (en el código y en los prompts): solo cuentas suyas registradas en Cuentas; nada se publica sin su ok (aunque
 * la cuenta sea libre); ningún texto se hace pasar por otra persona; la campaña dice que es una iniciativa suya y la
 * invitación invita (la gente decide). Nada de cuentas ajenas ni automatización de terceros.
 */
import { json, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { listarCuentas, listarPublicaciones, redactarPublicaciones, redDe, type Publicacion } from './cuentas.ts'
import { editarTema, leerTema, rondasDe, seguirTema } from './observatorio.ts'
import { buscarWeb, type Resultado } from './web.ts'

export type Candidato = { hashtag: string; enUso: boolean; ejemplos: { titulo: string; url: string }[] }
export type Campana = {
  id: number; titulo: string; objetivo: string; mensaje: string | null; hashtag: string | null; candidatos: Candidato[]; inicio: number; fin: number
  cuentas: number[]; temaId: number | null; comunidad: string | null; estado: 'borrador' | 'armada' | 'cerrada'; informePieza: number | null; creadaEn: number; actualizadaEn: number
}
const deFila = (r: any): Campana => ({
  id: r.id, titulo: r.titulo, objetivo: r.objetivo, mensaje: r.mensaje, hashtag: r.hashtag, candidatos: json<Candidato[]>(r.candidatos, []) ?? [], inicio: r.inicio, fin: r.fin,
  cuentas: json<number[]>(r.cuentas, []) ?? [], temaId: r.tema_id, comunidad: r.comunidad, estado: r.estado, informePieza: r.informe_pieza, creadaEn: r.creada_en, actualizadaEn: r.actualizada_en,
})
export const leerCampana = (db: Db, id: number): Campana | null => { const r = db.prepare('SELECT * FROM campanas WHERE id = ?').get(id); return r ? deFila(r) : null }
export const listarCampanas = (db: Db): Campana[] => (db.prepare(`SELECT * FROM campanas ORDER BY estado = 'cerrada', inicio DESC`).all() as any[]).map(deFila)
export const piezasDe = (db: Db, id: number): Publicacion[] => listarPublicaciones(db, { limite: 500 }).filter((p) => p.origen === `campana:${id}`)

/** Las cuentas que puede usar una campaña: solo las suyas, activas y que no son de lectura. */
function cuentasValidas(db: Db, ids: unknown): number[] {
  const suyas = listarCuentas(db).filter((c) => c.activa && c.modo !== 'lectura')
  const pedidas = Array.isArray(ids) ? ids.map(Number) : []
  const ajenas = pedidas.filter((i) => !suyas.some((c) => c.id === i))
  if (ajenas.length) throw new Error(`Esas cuentas no son tuyas (o son de solo lectura): ${ajenas.join(', ')}. Una campaña usa solo tus cuentas cargadas en Cuentas.`)
  return pedidas.length ? pedidas : suyas.map((c) => c.id)
}
const hashtagLimpio = (h: unknown) => {
  const t = String(h ?? '').trim().replace(/^#*/, '').replace(/[^\p{L}\p{N}_]/gu, '')
  return t.length >= 2 ? `#${t.slice(0, 60)}` : null
}

/** Una campaña nueva (en borrador): qué, para qué y cuándo; si no dice cuentas, todas las suyas que publican. */
export function crearCampana(db: Db, c: { titulo: string; objetivo: string; mensaje?: string | null; inicio: number; fin?: number | null; cuentas?: unknown; hashtag?: string | null }, ahora = Date.now()): Campana {
  const titulo = String(c.titulo ?? '').trim().slice(0, 160)
  const objetivo = String(c.objetivo ?? '').trim().slice(0, 2000)
  if (!titulo) throw new Error('Ponele un nombre a la campaña')
  if (objetivo.length < 10) throw new Error('Contame para qué es la campaña (qué querés que pase)')
  const inicio = Number(c.inicio)
  if (!Number.isFinite(inicio) || inicio <= 0) throw new Error('¿Cuándo es el momento? (fecha y hora del inicio)')
  const fin = Number(c.fin) > inicio ? Number(c.fin) : inicio + 2 * 3_600_000
  const cuentas = cuentasValidas(db, c.cuentas)
  const hashtag = c.hashtag ? hashtagLimpio(c.hashtag) : null
  const id = Number(db.prepare(`INSERT INTO campanas (titulo, objetivo, mensaje, hashtag, candidatos, inicio, fin, cuentas, estado, creada_en, actualizada_en) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, 'borrador', ?, ?)`)
    .run(titulo, objetivo, c.mensaje?.trim().slice(0, 2000) || null, hashtag, inicio, fin, JSON.stringify(cuentas), ahora, ahora).lastInsertRowid)
  return leerCampana(db, id)!
}

export function editarCampana(db: Db, id: number, c: { titulo?: string; objetivo?: string; mensaje?: string | null; inicio?: number; fin?: number; cuentas?: unknown; borrar?: boolean }, ahora = Date.now()): Campana | null {
  const x = leerCampana(db, id)
  if (!x) throw new Error(`No existe la campaña ${id}`)
  if (c.borrar) {
    db.prepare(`UPDATE publicaciones SET estado = 'descartada' WHERE origen = ? AND estado = 'borrador'`).run(`campana:${id}`)
    db.prepare('DELETE FROM campanas WHERE id = ?').run(id)
    return null
  }
  db.prepare('UPDATE campanas SET titulo = ?, objetivo = ?, mensaje = ?, inicio = ?, fin = ?, cuentas = ?, actualizada_en = ? WHERE id = ?').run(
    c.titulo?.trim() || x.titulo, c.objetivo?.trim() || x.objetivo, c.mensaje === undefined ? x.mensaje : c.mensaje?.trim() || null,
    c.inicio ?? x.inicio, c.fin ?? x.fin, JSON.stringify(c.cuentas === undefined ? x.cuentas : cuentasValidas(db, c.cuentas)), ahora, id)
  return leerCampana(db, id)
}

// ─── el modelo y el buscador (inyectables) ──────────────────────────────

let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'campanas' }, sistema, usuario, { temperatura: 0.6, maxTokens: 2000 })).datos
let buscador = (db: Db, q: string): Promise<Resultado[]> => buscarWeb(db, q, { n: 5 })
export function _probarCampanas(o: { modelo?: typeof modelo; buscador?: typeof buscador }) {
  if (o.modelo) modelo = o.modelo
  if (o.buscador) buscador = o.buscador
}

const REGLAS = `Reglas: es una iniciativa suya, con su nombre. Nada se hace pasar por otra persona ni simula ser «gente cualquiera». Se invita, no se ordena; se argumenta, no se insulta. Nada inventado sobre hechos.`

const SISTEMA_HASHTAGS = `Proponés hashtags para una campaña de él (una iniciativa suya). Tres opciones cortas, memorables, sin tildes ni espacios, que digan la idea y no se confundan con otra cosa. ${REGLAS}
Forma: {"hashtags": [string, string, string]}`

/**
 * Tres hashtags y, para cada uno, si ya se usa y para qué (una búsqueda cada uno): que no choque con otra cosa.
 * Gasta tokens y búsquedas (en la nube).
 */
export async function proponerHashtags(db: Db, id: number, ahora = Date.now()): Promise<Candidato[]> {
  const c = leerCampana(db, id)
  if (!c) throw new Error(`No existe la campaña ${id}`)
  const r = await modelo(db, SISTEMA_HASHTAGS, [`Campaña: ${c.titulo}`, `Para qué: ${c.objetivo}`, c.mensaje ? `Su mensaje: ${c.mensaje}` : ''].filter(Boolean).join('\n'))
  const tags = [...new Set((Array.isArray(r?.hashtags) ? r.hashtags : []).map(hashtagLimpio).filter(Boolean) as string[])].slice(0, 3)
  if (!tags.length) throw new Error('No salieron hashtags: probá de nuevo')
  const candidatos: Candidato[] = []
  for (const h of tags) {
    let rs: Resultado[] = []
    try { rs = await buscador(db, `"${h}"`) } catch { /* sin buscador: queda sin chequear */ }
    const usan = rs.filter((x) => `${x.titulo} ${x.extracto}`.toLowerCase().includes(h.toLowerCase()))
    candidatos.push({ hashtag: h, enUso: usan.length > 0, ejemplos: usan.slice(0, 3).map((x) => ({ titulo: x.titulo, url: x.url })) })
  }
  db.prepare('UPDATE campanas SET candidatos = ?, actualizada_en = ? WHERE id = ?').run(JSON.stringify(candidatos), ahora, id)
  return candidatos
}

/** Él elige (o escribe) el hashtag. */
export function elegirHashtag(db: Db, id: number, hashtag: string, ahora = Date.now()): Campana {
  const h = hashtagLimpio(hashtag)
  if (!h) throw new Error('Ese hashtag no sirve (letras, números o _)')
  if (!leerCampana(db, id)) throw new Error(`No existe la campaña ${id}`)
  db.prepare('UPDATE campanas SET hashtag = ?, actualizada_en = ? WHERE id = ?').run(h, ahora, id)
  return leerCampana(db, id)!
}

const SISTEMA_COMUNIDAD = `Escribís, en SU voz, el mensaje con el que él invita a su gente (sus grupos, su comunidad) a sumarse a una iniciativa suya. Corto, claro y honesto: qué pasa, cuándo, por qué le importa, el hashtag y qué puede hacer quien quiera sumarse (publicar con sus palabras, compartir). Que quede claro que es una invitación: cada uno decide. ${REGLAS}
Forma: {"mensaje": string}`

const MOMENTOS = [
  { id: 'antes', cuando: (c: Campana) => c.inicio - 2 * 3_600_000, pedido: 'ANTES del momento: anunciar qué va a pasar y por qué le importa, con el hashtag.' },
  { id: 'durante', cuando: (c: Campana) => c.inicio + 15 * 60_000, pedido: 'DURANTE el momento: su reacción en primera persona, con el hashtag.' },
  { id: 'despues', cuando: (c: Campana) => c.fin + 30 * 60_000, pedido: 'DESPUÉS: su balance o su llamado a seguir, con el hashtag.' },
]

/**
 * Armar la campaña (en la nube): las piezas por cuenta para antes, durante y después (en borrador, programadas en su
 * ventana: nada sale sin su ok), la invitación para su comunidad (y un borrador en su canal de Telegram, si tiene uno en
 * Cuentas), el evento en su calendario (si Google está conectado) y el tema del Observatorio en vivo en la ventana.
 */
export async function armarCampana(db: Db, id: number, ahora = Date.now()): Promise<{ campana: Campana; piezas: Publicacion[]; fallas: string[]; calendario: string | null }> {
  const c = leerCampana(db, id)
  if (!c) throw new Error(`No existe la campaña ${id}`)
  if (!c.hashtag) throw new Error('Primero elegí el hashtag')
  if (c.estado === 'cerrada') throw new Error('Esa campaña ya cerró')
  const cuentas = cuentasValidas(db, c.cuentas)
  const piezas: Publicacion[] = []
  const fallas: string[] = []
  const base = [`Campaña suya: ${c.titulo}.`, `Para qué: ${c.objetivo}.`, c.mensaje ? `Su mensaje: ${c.mensaje}.` : '', `Hashtag: ${c.hashtag}.`, REGLAS].filter(Boolean).join(' ')
  for (const cid of cuentas) {
    for (const m of MOMENTOS) {
      try {
        const ps = await redactarPublicaciones(db, cid, { idea: `${base} Momento: ${m.pedido}`, origen: `campana:${id}`, borrador: true, ahora })
        for (const p of ps) db.prepare('UPDATE publicaciones SET programada_para = ? WHERE id = ?').run(m.cuando(c), p.id)
        piezas.push(...ps.map((p) => ({ ...p, programadaPara: m.cuando(c) })))
      } catch (e) { fallas.push(`cuenta ${cid} (${m.id}): ${e instanceof Error ? e.message : e}`) }
    }
  }
  // La invitación para su gente: para copiar, y en borrador en su canal de Telegram si lo tiene.
  const r = await modelo(db, SISTEMA_COMUNIDAD, [`Campaña: ${c.titulo}`, `Para qué: ${c.objetivo}`, c.mensaje ? `Su mensaje: ${c.mensaje}` : '', `Hashtag: ${c.hashtag}`, `Cuándo: ${new Date(c.inicio).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`].filter(Boolean).join('\n'))
  const comunidad = String(r?.mensaje ?? '').trim().slice(0, 3000) || null
  const canal = listarCuentas(db).find((x) => x.activa && x.modo !== 'lectura' && x.conector === 'telegram_canal')
  if (comunidad && canal) {
    const pid = Number(db.prepare(`INSERT INTO publicaciones (cuenta_id, texto, estado, tipo, origen, programada_para, creada_en) VALUES (?, ?, 'borrador', 'invitacion', ?, ?, ?)`).run(canal.id, comunidad, `campana:${id}`, c.inicio - 3 * 3_600_000, ahora).lastInsertRowid)
    piezas.push(listarPublicaciones(db, { cuentaId: canal.id, limite: 50 }).find((p) => p.id === pid)!)
  }
  // El Observatorio: el hashtag primero (para contar cuántas veces aparece en vivo), y en vivo de 30 minutos antes a 1 hora después.
  const consultas = [c.hashtag, c.titulo]
  const tema = c.temaId && leerTema(db, c.temaId) ? editarTema(db, c.temaId, { consultas, activo: true }, ahora)! : seguirTema(db, { nombre: `Campaña: ${c.titulo}`, consultas, cadaHoras: 12 }, ahora)
  editarTema(db, tema.id, { intensivoDesde: c.inicio - 30 * 60_000, intensivoHasta: c.fin + 60 * 60_000 }, ahora)
  db.prepare(`UPDATE campanas SET comunidad = ?, tema_id = ?, estado = 'armada', actualizada_en = ? WHERE id = ?`).run(comunidad, tema.id, ahora, id)
  // El calendario (si está conectado).
  let calendario: string | null = null
  try {
    const ag = await import('./agenda.ts')
    await ag.llevarAGoogle(db, 'campana', id, {}, ahora)
    calendario = 'agendada'
  } catch (e) { calendario = e instanceof Error ? e.message : String(e) }
  return { campana: leerCampana(db, id)!, piezas, fallas, calendario }
}

const SISTEMA_INFORME = `Escribís el informe de una campaña de él, en primera persona suya y corto: qué se propuso, qué publicó (y qué quedó sin publicar), qué se dijo en cada plataforma durante el momento (según el Observatorio), si el hashtag apareció y qué aprendió para la próxima. Solo lo que está en los datos.
Forma: {"informe": string}`

/** El cierre (en la nube, una hora después del fin): el informe queda como pieza suya y la campaña, cerrada. */
export async function cerrarCampana(db: Db, id: number, ahora = Date.now()): Promise<Campana> {
  const c = leerCampana(db, id)
  if (!c) throw new Error(`No existe la campaña ${id}`)
  if (c.estado === 'cerrada') return c
  const piezas = piezasDe(db, id)
  const rondas = c.temaId ? rondasDe(db, c.temaId, 40).filter((r) => r.en >= c.inicio - 3_600_000 && r.en <= c.fin + 2 * 3_600_000) : []
  const r = await modelo(db, SISTEMA_INFORME, [
    `Campaña: ${c.titulo} · ${c.hashtag ?? ''}\nPara qué: ${c.objetivo}`,
    `Piezas: ${piezas.map((p) => `[${p.estado}${p.url ? ` ${p.url}` : ''}] ${p.texto.slice(0, 160)}`).join('\n') || 'ninguna'}`,
    `El Observatorio durante el momento:\n${rondas.map((x) => `- ${new Date(x.en).toISOString().slice(11, 16)}: ${x.resumen?.resumen ?? 'sin resumen'}`).join('\n') || 'sin rondas'}`,
  ].join('\n\n'))
  const texto = String(r?.informe ?? '').trim()
  let piezaId: number | null = null
  if (texto) {
    asegurarFuente(db, { id: 'campanas', nombre: 'Sus campañas', nivel: 'propia', descripcion: 'Los informes de las campañas que hizo con su gente.' })
    piezaId = insertar(db, { fuente: 'campanas', nivel: 'propia', titulo: `Campaña: ${c.titulo}`, contenido: texto, estado: 'disponible', origenId: `campana:${id}:informe`, etiquetas: ['campaña', ...(c.hashtag ? [c.hashtag] : [])] }, ahora) ?? null
  }
  if (c.temaId) editarTema(db, c.temaId, { intensivoDesde: null, intensivoHasta: null, cadaHoras: 24 }, ahora)
  db.prepare(`UPDATE campanas SET estado = 'cerrada', informe_pieza = ?, actualizada_en = ? WHERE id = ?`).run(piezaId, ahora, id)
  return leerCampana(db, id)!
}

/** En el latido del Observatorio (en la nube): las campañas armadas cuyo momento terminó hace más de una hora se cierran. */
export async function latidoCampanas(db: Db, ahora = Date.now()): Promise<string[]> {
  const avisos: string[] = []
  for (const c of listarCampanas(db).filter((x) => x.estado === 'armada' && ahora > x.fin + 3_600_000)) {
    try { const x = await cerrarCampana(db, c.id, ahora); avisos.push(`📣 La campaña **${x.titulo}** terminó: el informe quedó en tu corpus (Afuera → Campañas).`) } catch (e) { console.error(`  campaña ${c.id}:`, e instanceof Error ? e.message : e) }
  }
  return avisos
}

/** Para el chat y la pantalla: la campaña con sus piezas por momento y lo último del Observatorio. */
export function verCampana(db: Db, id: number) {
  const c = leerCampana(db, id)
  if (!c) throw new Error(`No existe la campaña ${id}`)
  const cuentas = listarCuentas(db)
  const piezas = piezasDe(db, id).map((p) => {
    const cu = cuentas.find((x) => x.id === p.cuentaId)
    return { ...p, red: cu ? redDe(cu.red)?.nombre ?? cu.red : '?', usuario: cu?.usuario ?? '' }
  })
  return { campana: c, piezas, ultima: c.temaId ? rondasDe(db, c.temaId, 1)[0] ?? null : null, tema: c.temaId ? leerTema(db, c.temaId) : null }
}
