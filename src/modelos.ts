/**
 * El consejo de modelos: 1 a 3 personas que él admira (entidades con la marca «modelo»). Para cada una, Mastropiero arma
 * su manual operativo con lo que hay en el corpus (y la web, si hay buscador): principios, estándares, cómo decide, lo
 * que evita. Con eso: se puede hablar con el modelo como personaje, preguntar «¿qué haría X?» en una decisión o una run,
 * y una vez por semana, una pregunta para calibrar su vara contra la de él. El manual corre en la nube (gasta tokens).
 */
import { fechaLocal, type Db } from './db.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { asegurarEntidad, leerEntidad } from './entidades.ts'
import { buscarHibrido } from './semantica.ts'
import { encolarPregunta } from './preguntas.ts'
import { pedirJson } from './modelo.ts'

export type Manual = { resumen: string; principios: { principio: string; en_la_practica: string }[]; estandares: string[]; como_decide: string[]; lo_que_evita: string[]; frases: { frase: string; fuente: string | null }[]; preguntas: string[] }
export type Modelo = { id: number; nombre: string; notas: string | null; manual: Manual | null; manualPieza: number | null; manualEn: number | null }

const FUENTE = { id: 'modelos', nombre: 'Consejo de modelos', nivel: 'investigacion' as const, descripcion: 'El manual operativo de cada persona que tomás de modelo: principios, estándares y cómo decide.' }
const MAX = 3

let modelo = async (db: Db, sistema: string, usuario: string, maxTokens = 3000): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'modelos' }, sistema, usuario, { temperatura: 0.3, maxTokens })).datos
let web = async (db: Db, q: string): Promise<{ titulo: string; url: string; texto: string }[]> => {
  try { return ((await (await import('./web.ts')).buscarWeb(db, q, { n: 5 })) as any[]).map((r) => ({ titulo: String(r.titulo ?? ''), url: String(r.url ?? ''), texto: String(r.texto ?? r.extracto ?? r.descripcion ?? '') })) } catch { return [] }
}
export function _probarModelos(o: { modelo?: typeof modelo; web?: typeof web }) {
  if (o.modelo) modelo = o.modelo
  if (o.web) web = o.web
}

function deEntidad(e: { id: number; nombre: string; notas: string | null; meta: Record<string, unknown> | null }): Modelo {
  const m = (e.meta ?? {}) as any
  return { id: e.id, nombre: e.nombre, notas: e.notas, manual: m.manual ?? null, manualPieza: m.manual_pieza ?? null, manualEn: m.manual_en ?? null }
}

export function listarModelos(db: Db): Modelo[] {
  return (db.prepare(`SELECT id FROM entidades WHERE json_extract(meta, '$.modelo') = 1 ORDER BY json_extract(meta, '$.modelo_desde'), id`).all() as { id: number }[])
    .map((r) => leerEntidad(db, r.id)).filter((e): e is NonNullable<typeof e> => !!e).map((e) => deEntidad(e as any))
}

export function leerModelo(db: Db, id: number): Modelo | null {
  const e = leerEntidad(db, id)
  return e && (e.meta as any)?.modelo === 1 ? deEntidad(e as any) : null
}

const fijarMeta = (db: Db, id: number, cambios: Record<string, unknown>) => {
  const e = leerEntidad(db, id)
  if (!e) throw new Error(`No existe la entidad ${id}`)
  db.prepare('UPDATE entidades SET meta = ? WHERE id = ?').run(JSON.stringify({ ...(e.meta ?? {}), ...cambios }), id)
}

/** Suma un modelo (por id de entidad o por nombre: si no existe, se crea la persona). Hasta tres. */
export function sumarModelo(db: Db, x: { entidadId?: number | null; nombre?: string | null }, ahora = Date.now()): Modelo {
  const nombre = String(x.nombre ?? '').trim()
  if (!x.entidadId && nombre.length < 2) throw new Error('¿A quién tomás de modelo?')
  const id: number = x.entidadId ?? asegurarEntidad(db, { tipo: 'persona', nombre })
  if (leerModelo(db, id)) return leerModelo(db, id)!
  if (listarModelos(db).length >= MAX) throw new Error('El consejo es de hasta tres: sacá a alguien antes de sumar otro')
  fijarMeta(db, id, { modelo: 1, modelo_desde: ahora })
  return leerModelo(db, id)!
}

export function quitarModelo(db: Db, id: number) {
  fijarMeta(db, id, { modelo: 0 })
}

// ─── el manual ──────────────────────────────────────────────────────────

const SISTEMA_MANUAL = (nombre: string) => `Armás el manual operativo de ${nombre}, una persona que el jugador toma de modelo. Con el material que te paso (de su corpus y, si hay, de la web), no con lo que creas saber: si algo no está, no lo inventes.
- "resumen": quién es y por qué importa como modelo, en 2 o 3 frases.
- "principios": 3 a 8, cada uno {"principio": corto, "en_la_practica": cómo se ve en lo que hace}.
- "estandares": la vara con la que mide su trabajo (3 a 6, concretos).
- "como_decide": cómo decide (qué prioriza, qué pregunta antes, qué descarta), 3 a 6.
- "lo_que_evita": 2 a 5.
- "frases": hasta 5 frases suyas textuales del material, {"frase", "fuente": de dónde}.
- "preguntas": 3 preguntas que se haría ante una decisión.
En castellano rioplatense. Forma: {"resumen": string, "principios": [...], "estandares": [...], "como_decide": [...], "lo_que_evita": [...], "frases": [...], "preguntas": [...]}`

const lista = (x: unknown, n: number) => (Array.isArray(x) ? x : []).slice(0, n)
const txt = (x: unknown, n = 400) => String(x ?? '').trim().slice(0, n)

/** Arma (o rehace) el manual con el corpus y la web; queda como pieza buscable y en la ficha del modelo. */
export async function armarManual(db: Db, id: number, ahora = Date.now()): Promise<Modelo> {
  const m = leerModelo(db, id)
  if (!m) throw new Error(`#${id} no está en tu consejo de modelos`)
  const suyas = db.prepare(`SELECT id, titulo, contenido, fecha FROM corpus WHERE EXISTS (SELECT 1 FROM json_each(corpus.entidades) WHERE value = ?) AND fuente != 'modelos' ORDER BY COALESCE(fecha, '') DESC LIMIT 12`).all(id) as any[]
  const halladas = (await buscarHibrido(db, m.nombre, 8).catch(() => [])).filter((p) => p.fuente !== 'modelos' && !suyas.some((s) => s.id === p.id))
  const deLaWeb = await web(db, `${m.nombre} principios cómo trabaja cómo decide entrevista`)
  const material = [
    ...suyas.map((p) => `[corpus #${p.id}${p.fecha ? ` · ${String(p.fecha).slice(0, 10)}` : ''}] ${p.titulo}\n${String(p.contenido).slice(0, 1800)}`),
    ...halladas.slice(0, 6).map((p) => `[corpus #${p.id}] ${p.titulo}\n${(p.fragmento ?? p.contenido).slice(0, 1200)}`),
    ...deLaWeb.map((r) => `[web] ${r.titulo} (${r.url})\n${r.texto.slice(0, 1200)}`),
  ]
  if (!material.length) throw new Error(`No tengo material sobre ${m.nombre}: mandame un link, un video o un libro suyo y lo armo`)
  const d = await modelo(db, SISTEMA_MANUAL(m.nombre), `${m.notas ? `Lo que el jugador anotó de ${m.nombre}: ${m.notas}\n\n` : ''}Material:\n\n${material.join('\n\n---\n\n').slice(0, 24000)}`, 3500)
  const manual: Manual = {
    resumen: txt(d?.resumen, 600),
    principios: lista(d?.principios, 8).map((p: any) => ({ principio: txt(p?.principio, 160), en_la_practica: txt(p?.en_la_practica, 300) })).filter((p) => p.principio),
    estandares: lista(d?.estandares, 6).map((x) => txt(x, 240)).filter(Boolean),
    como_decide: lista(d?.como_decide, 6).map((x) => txt(x, 240)).filter(Boolean),
    lo_que_evita: lista(d?.lo_que_evita, 5).map((x) => txt(x, 240)).filter(Boolean),
    frases: lista(d?.frases, 5).map((f: any) => ({ frase: txt(f?.frase, 300), fuente: txt(f?.fuente, 120) || null })).filter((f) => f.frase),
    preguntas: lista(d?.preguntas, 3).map((x) => txt(x, 200)).filter(Boolean),
  }
  if (!manual.principios.length) throw new Error('No salió un manual con principios: probá de nuevo con más material')
  const contenido = [
    `# Manual operativo de ${m.nombre}`, manual.resumen,
    `## Principios\n${manual.principios.map((p) => `- **${p.principio}**: ${p.en_la_practica}`).join('\n')}`,
    manual.estandares.length ? `## Su vara\n${manual.estandares.map((x) => `- ${x}`).join('\n')}` : '',
    manual.como_decide.length ? `## Cómo decide\n${manual.como_decide.map((x) => `- ${x}`).join('\n')}` : '',
    manual.lo_que_evita.length ? `## Lo que evita\n${manual.lo_que_evita.map((x) => `- ${x}`).join('\n')}` : '',
    manual.frases.length ? `## En sus palabras\n${manual.frases.map((f) => `> ${f.frase}${f.fuente ? ` (${f.fuente})` : ''}`).join('\n')}` : '',
    manual.preguntas.length ? `## Lo que se preguntaría\n${manual.preguntas.map((x) => `- ${x}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
  asegurarFuente(db, FUENTE)
  const origenId = `modelo:manual:${id}`
  const ya = db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(origenId) as { id: number } | undefined
  let pieza: number
  if (ya) {
    db.prepare('UPDATE corpus SET contenido = ?, titulo = ?, fecha = ? WHERE id = ?').run(contenido, `Manual operativo · ${m.nombre}`, fechaLocal(ahora), ya.id)
    pieza = ya.id
  } else {
    pieza = insertar(db, { fuente: FUENTE.id, nivel: 'investigacion', titulo: `Manual operativo · ${m.nombre}`, contenido, fecha: fechaLocal(ahora), entidades: [id], origenId, estado: 'disponible' }, ahora)!
  }
  fijarMeta(db, id, { manual, manual_pieza: pieza, manual_en: ahora })
  return leerModelo(db, id)!
}

const manualComoTexto = (m: Modelo) => m.manual ? [
  m.manual.resumen,
  `Principios: ${m.manual.principios.map((p) => `${p.principio} (${p.en_la_practica})`).join(' · ')}`,
  m.manual.estandares.length ? `Su vara: ${m.manual.estandares.join(' · ')}` : '',
  m.manual.como_decide.length ? `Cómo decide: ${m.manual.como_decide.join(' · ')}` : '',
  m.manual.lo_que_evita.length ? `Evita: ${m.manual.lo_que_evita.join(' · ')}` : '',
  m.manual.frases.length ? `En sus palabras: ${m.manual.frases.map((f) => `«${f.frase}»`).join(' ')}` : '',
].filter(Boolean).join('\n') : ''

/** Busca un modelo por id o por nombre (sin tildes, el comienzo alcanza). */
export function modeloPor(db: Db, quien: number | string): Modelo | null {
  if (typeof quien === 'number' || /^\d+$/.test(String(quien))) return leerModelo(db, Number(quien))
  const n = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return listarModelos(db).find((m) => n(m.nombre).includes(n(String(quien)).trim())) ?? null
}

const SISTEMA_QUE_HARIA = (nombre: string, manual: string) => `Respondés qué haría ${nombre} en la situación del jugador, SOLO desde su manual operativo (abajo). No lo imites ni inventes anécdotas: razoná con sus principios.
Manual de ${nombre}:
${manual}
- "haria": qué haría, concreto, 1 a 3 frases.
- "por_que": qué principio o estándar suyo lo lleva ahí (nombralo).
- "primer_paso": la acción de hoy, de 25 minutos o menos.
- "no_haria": lo que evitaría en esta situación.
- "confianza": "alta" si el manual cubre esto de lleno, "media" o "baja" si estás extrapolando.
Forma: {"haria": string, "por_que": string, "primer_paso": string, "no_haria": string, "confianza": "alta" | "media" | "baja"}`

/** ¿Qué haría X? Con su manual (si todavía no tiene, se avisa). */
export async function queHaria(db: Db, quien: number | string, situacion: string) {
  const m = modeloPor(db, quien)
  if (!m) throw new Error('Esa persona no está en tu consejo de modelos')
  if (!m.manual) throw new Error(`${m.nombre} todavía no tiene manual: armalo primero (en la nube)`)
  const s = String(situacion ?? '').trim()
  if (s.length < 8) throw new Error('Contame la situación')
  const d = await modelo(db, SISTEMA_QUE_HARIA(m.nombre, manualComoTexto(m)), `La situación: ${s.slice(0, 3000)}`, 900)
  return { modelo: m.nombre, haria: txt(d?.haria, 600), porQue: txt(d?.por_que, 400), primerPaso: txt(d?.primer_paso, 300), noHaria: txt(d?.no_haria, 300), confianza: ['alta', 'media', 'baja'].includes(d?.confianza) ? d.confianza : 'media' }
}

/** El prompt para hablar con el modelo como personaje (desde su manual, en primera persona, sin inventar). */
export function promptModelo(db: Db, id: number): string {
  const m = leerModelo(db, id)
  if (!m) throw new Error('Ese modelo ya no está en tu consejo')
  return `Sos ${m.nombre}, tal como lo describe su manual operativo (abajo), hablando con alguien que te toma de modelo. Hablás en primera persona, desde tus principios y tu vara, breve y directo.
- No inventes datos biográficos ni anécdotas: si te preguntan algo que tu manual no cubre, decilo («eso no lo sé de mí; desde mis principios, diría…»).
- Ayudalo a decidir y a medir su trabajo con tu vara, sin ser complaciente.
- En castellano rioplatense.
${m.manual ? `\nTu manual:\n${manualComoTexto(m)}` : `\nTodavía no hay un manual de ${m.nombre}: decíselo y sugerile armarlo (con material suyo en el corpus).`}`
}

/** El domingo: tu vara contra la de cada modelo (una pregunta por modelo, sobre uno de sus principios). */
export function preguntasDeCalibracion(db: Db, ahora = Date.now()): number {
  let n = 0
  const semana = Math.floor(ahora / (7 * 86_400_000))
  for (const m of listarModelos(db)) {
    const ps = m.manual?.principios ?? []
    if (!ps.length) continue
    const p = ps[semana % ps.length]
    const texto = `Tu vara contra la de ${m.nombre}: esta semana, ¿en qué decisión actuaste distinto de «${p.principio}»? ¿Fue a favor o en contra tuyo?`
    if (encolarPregunta(db, { texto, porQue: `Calibrar con un modelo es mirar tus hechos con su vara (${p.en_la_practica.slice(0, 120)}).`, tema: m.nombre, origen: 'modelo' }, ahora)) n++
  }
  return n
}

export const resumenManual = (m: Modelo) => (m.manual ? { resumen: m.manual.resumen, principios: m.manual.principios.map((p) => p.principio) } : null)
