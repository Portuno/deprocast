/**
 * Discovery para clientes: el método de «Where to Begin With AI Transformation» (Vas) como herramienta de trabajo.
 * 1. Un encargo por cliente; sus áreas se puntúan por volumen, costo y alcance (cuántas áreas tocan) para elegir por dónde
 *    empezar (casi siempre finanzas).
 * 2. El valor se acuerda antes de construir: KPIs en tres categorías (tiempo/costo, ingresos netos de tokens, riesgo) con
 *    línea de base y objetivo: la hoja que el cliente lleva a su directorio.
 * 3. El as-is sale de cruzar los logs (minería, sin modelo), las entrevistas y la documentación: marca lo que no estaba
 *    escrito. Mastropiero arma la guía de entrevista (lo que hay que preguntar, y lo que el log contradice).
 * 4. El to-be: cada paso se borra, pasa a código, a un agente o queda en una persona (con su porqué).
 * 5. Modo sombra: lo que propone el agente contra lo que hizo la persona, por regla; se actúa donde acierta ≥ 99 %.
 * Los clientes son entidades (agrupación, conexión «cliente»); las entrevistas y documentos, piezas de la fuente
 * «discovery». Lo que gasta tokens corre en la nube.
 */
import { fechaLocal, json, type Db } from './db.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { anotarConexion, asegurarEntidad, leerEntidad } from './entidades.ts'
import { pedirJson } from './modelo.ts'
import { nanTranscribir } from './nan.ts'
import { analizarLog, leerCsv, logComoTexto, type Analisis, type Mapeo } from './discovery-logs.ts'

export const ESTADOS_ENCARGO = ['discovery', 'diseño', 'sombra', 'vivo', 'cerrado'] as const
export const DESTINOS = ['borrar', 'codigo', 'agente', 'persona'] as const
export const CATEGORIAS_KPI = ['tiempo_costo', 'ingresos', 'riesgo'] as const
const FUENTE = { id: 'discovery', nombre: 'Discovery (clientes)', nivel: 'primaria' as const, descripcion: 'Entrevistas, documentos y guías de los encargos de transformación con IA de tus clientes.' }

export type PasoAsis = { n: number; paso: string; area: string | null; sistema: string | null; quien: string | null; minutos: number | null; frecuencia: string | null; excepciones: string | null; fuente: string; en_la_doc: boolean }
export type PasoTobe = { n: number; destino: (typeof DESTINOS)[number]; por_que: string; regla: string | null }
export type Kpi = { categoria: (typeof CATEGORIAS_KPI)[number]; nombre: string; linea_base: string | null; objetivo: string | null; unidad: string | null; medido_en: string | null }

let modelo = async (db: Db, sistema: string, usuario: string, maxTokens = 4000): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'discovery' }, sistema, usuario, { temperatura: 0.2, maxTokens, largo: true })).datos
let transcribir = (db: Db, audio: Buffer, nombre: string) => nanTranscribir(db, audio, nombre)
export function _probarDiscovery(o: { modelo?: typeof modelo; transcribir?: typeof transcribir }) {
  if (o.modelo) modelo = o.modelo
  if (o.transcribir) transcribir = o.transcribir
}

// ─── encargos ───────────────────────────────────────────────────────────

const yo = (db: Db) => (db.prepare(`SELECT id FROM entidades WHERE json_extract(meta, '$.operador') = 1 ORDER BY id LIMIT 1`).get() as { id: number } | undefined)?.id ?? null

export function crearEncargo(db: Db, x: { cliente: string | number; nombre?: string | null; departamento?: string | null; notas?: string | null }, ahora = Date.now()) {
  const clienteId = typeof x.cliente === 'number' || /^\d+$/.test(String(x.cliente)) ? Number(x.cliente) : asegurarEntidad(db, { tipo: 'agrupacion', nombre: String(x.cliente ?? '').trim().slice(0, 120) }, ahora)
  const cliente = leerEntidad(db, clienteId)
  if (!cliente || cliente.nombre.length < 2) throw new Error('¿Para qué cliente?')
  const nombre = (x.nombre?.trim() || `Transformación con IA · ${cliente.nombre}`).slice(0, 160)
  const proyectoId = asegurarEntidad(db, { tipo: 'proyecto', nombre }, ahora)
  try { anotarConexion(db, { a: proyectoId, b: clienteId, relacion: 'para', origen: 'discovery' }, ahora) } catch { /* ya estaba */ }
  const y = yo(db)
  if (y && y !== clienteId) try { anotarConexion(db, { a: clienteId, b: y, relacion: 'cliente', origen: 'discovery' }, ahora) } catch { /* ya estaba */ }
  const id = Number(db.prepare('INSERT INTO encargos_ia (nombre, cliente_id, proyecto_id, departamento, notas, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nombre, clienteId, proyectoId, x.departamento?.trim() || null, x.notas?.trim() || null, ahora, ahora).lastInsertRowid)
  return leerEncargo(db, id)!
}

const deEncargo = (db: Db, r: any) => ({ id: r.id as number, nombre: r.nombre as string, clienteId: r.cliente_id as number, cliente: leerEntidad(db, r.cliente_id)?.nombre ?? '?', proyectoId: r.proyecto_id as number | null, departamento: r.departamento as string | null, estado: r.estado as string, notas: r.notas as string | null, creadoEn: r.creado_en as number, actualizadoEn: r.actualizado_en as number })
export type Encargo = ReturnType<typeof deEncargo>

export function leerEncargo(db: Db, id: number): Encargo | null {
  const r = db.prepare('SELECT * FROM encargos_ia WHERE id = ?').get(id)
  return r ? deEncargo(db, r) : null
}
const encargoOError = (db: Db, id: number) => { const e = leerEncargo(db, id); if (!e) throw new Error(`No existe el encargo ${id}`); return e }
const tocar = (db: Db, id: number, ahora: number) => db.prepare('UPDATE encargos_ia SET actualizado_en = ? WHERE id = ?').run(ahora, id)

export function listarEncargos(db: Db) {
  return (db.prepare(`SELECT * FROM encargos_ia ORDER BY estado = 'cerrado', actualizado_en DESC`).all() as any[]).map((r) => {
    const e = deEncargo(db, r)
    const n = (sql: string, ...a: (string | number)[]) => (db.prepare(sql).get(...a) as { n: number }).n
    return { ...e, entrevistas: n(`SELECT COUNT(*) AS n FROM corpus WHERE fuente = 'discovery' AND json_extract(meta, '$.encargo') = ? AND json_extract(meta, '$.tipo') = 'entrevista'`, e.id), logs: n('SELECT COUNT(*) AS n FROM encargo_logs WHERE encargo_id = ?', e.id), procesos: n('SELECT COUNT(*) AS n FROM procesos WHERE ambito = ?', `encargo:${e.id}`) }
  })
}

export function editarEncargo(db: Db, id: number, c: { estado?: string; departamento?: string | null; notas?: string | null; nombre?: string }, ahora = Date.now()) {
  encargoOError(db, id)
  if (c.estado !== undefined) {
    if (!(ESTADOS_ENCARGO as readonly string[]).includes(c.estado)) throw new Error(`El estado es ${ESTADOS_ENCARGO.join(', ')}`)
    db.prepare('UPDATE encargos_ia SET estado = ? WHERE id = ?').run(c.estado, id)
  }
  if (c.departamento !== undefined) db.prepare('UPDATE encargos_ia SET departamento = ? WHERE id = ?').run(c.departamento?.trim() || null, id)
  if (c.notas !== undefined) db.prepare('UPDATE encargos_ia SET notas = ? WHERE id = ?').run(c.notas?.trim() || null, id)
  if (c.nombre?.trim()) db.prepare('UPDATE encargos_ia SET nombre = ? WHERE id = ?').run(c.nombre.trim().slice(0, 160), id)
  tocar(db, id, ahora)
  return leerEncargo(db, id)!
}

// ─── áreas: por dónde empezar ───────────────────────────────────────────

/** Guarda un área con sus números (volumen por mes, costo por mes, cuántas áreas toca). */
export function guardarArea(db: Db, encargoId: number, a: { nombre: string; volumenMes?: number | null; costoMes?: number | null; alcance?: number | null; notas?: string | null }, ahora = Date.now()) {
  encargoOError(db, encargoId)
  const nombre = String(a.nombre ?? '').trim().slice(0, 80)
  if (!nombre) throw new Error('¿Qué área?')
  const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  db.prepare(`INSERT INTO encargo_areas (encargo_id, nombre, volumen_mes, costo_mes, alcance, notas) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (encargo_id, nombre) DO UPDATE SET volumen_mes = excluded.volumen_mes, costo_mes = excluded.costo_mes, alcance = excluded.alcance, notas = COALESCE(excluded.notas, notas)`)
    .run(encargoId, nombre, num(a.volumenMes), num(a.costoMes), num(a.alcance), a.notas?.trim() || null)
  tocar(db, encargoId, ahora)
  return areasDe(db, encargoId)
}

/** Las áreas puntuadas (0 a 100): volumen 40 %, costo 40 %, alcance 20 %, cada uno contra la mayor. La primera es por donde empezar. */
export function areasDe(db: Db, encargoId: number) {
  const xs = db.prepare('SELECT * FROM encargo_areas WHERE encargo_id = ?').all(encargoId) as any[]
  const max = (k: string) => Math.max(0, ...xs.map((x) => Number(x[k]) || 0)) || 1
  const [mv, mc, ma] = [max('volumen_mes'), max('costo_mes'), max('alcance')]
  return xs.map((x) => ({
    id: x.id, nombre: x.nombre, volumenMes: x.volumen_mes, costoMes: x.costo_mes, alcance: x.alcance, notas: x.notas,
    puntaje: Math.round(100 * (0.4 * ((x.volumen_mes ?? 0) / mv) + 0.4 * ((x.costo_mes ?? 0) / mc) + 0.2 * ((x.alcance ?? 0) / ma))),
  })).sort((a, b) => b.puntaje - a.puntaje)
}

// ─── entradas: entrevistas, documentos y logs ───────────────────────────

function piezaDeEncargo(db: Db, e: Encargo, tipo: 'entrevista' | 'documento' | 'guia', titulo: string, contenido: string, meta: Record<string, unknown>, ahora: number, origenId?: string) {
  asegurarFuente(db, FUENTE)
  if (origenId) {
    const ya = db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(origenId) as { id: number } | undefined
    if (ya) { db.prepare('UPDATE corpus SET contenido = ?, titulo = ? WHERE id = ?').run(contenido, titulo, ya.id); return ya.id }
  }
  return insertar(db, {
    fuente: FUENTE.id, nivel: 'primaria', titulo: titulo.slice(0, 200), contenido, fecha: fechaLocal(ahora), estado: 'disponible',
    etiquetas: ['discovery', tipo, e.cliente], entidades: [e.clienteId, ...(e.proyectoId ? [e.proyectoId] : [])],
    origenId: origenId ?? `discovery:${e.id}:${tipo}:${ahora}:${Math.random().toString(36).slice(2, 6)}`, meta: { encargo: e.id, tipo, ...meta },
  }, ahora)!
}

/** Una entrevista (texto o audio, que se transcribe y no se guarda). */
export async function agregarEntrevista(db: Db, encargoId: number, x: { quien?: string | null; rol?: string | null; area?: string | null; texto?: string | null; audio?: Buffer | null; nombreAudio?: string }, ahora = Date.now()) {
  const e = encargoOError(db, encargoId)
  let texto = String(x.texto ?? '').trim()
  if (x.audio?.length) texto = [texto, (await transcribir(db, x.audio, x.nombreAudio || 'entrevista.m4a')).trim()].filter(Boolean).join('\n\n')
  if (texto.length < 20) throw new Error('La entrevista vino vacía: pegá las notas o subí el audio')
  const quien = [x.quien?.trim(), x.rol?.trim()].filter(Boolean).join(', ')
  const id = piezaDeEncargo(db, e, 'entrevista', `Entrevista · ${e.cliente}${quien ? ` · ${quien}` : ''}${x.area ? ` (${x.area})` : ''}`, texto, { quien: x.quien ?? null, rol: x.rol ?? null, area: x.area ?? null }, ahora)
  tocar(db, encargoId, ahora)
  return { piezaId: id, palabras: texto.split(/\s+/).length }
}

/** Un documento de procedimiento (PDF, Word, Excel, texto): lo que dice que se hace. */
export async function agregarDocumento(db: Db, encargoId: number, nombre: string, datos: Buffer, area?: string | null, ahora = Date.now()) {
  const e = encargoOError(db, encargoId)
  const ext = nombre.split('.').pop()?.toLowerCase() ?? ''
  const { textoDeDocumento } = await import('./takeout/nube.ts')
  const texto = (ext === 'txt' || ext === 'md' ? datos.toString('utf8') : textoDeDocumento(datos, ext)).replace(/\u0000/g, '').trim()
  if (texto.length < 20) throw new Error('No pude sacar texto de ese documento')
  const id = piezaDeEncargo(db, e, 'documento', `Procedimiento · ${e.cliente} · ${nombre}`, texto, { archivo: nombre, area: area ?? null }, ahora)
  tocar(db, encargoId, ahora)
  return { piezaId: id, palabras: texto.split(/\s+/).length }
}

/** El log de eventos (CSV): se analiza y se guarda el análisis (el CSV no queda). */
export function subirLog(db: Db, encargoId: number, nombre: string, csv: string, o: { area?: string | null; mapeo?: Partial<Mapeo> | null } = {}, ahora = Date.now()) {
  encargoOError(db, encargoId)
  const a = analizarLog(csv, o.mapeo)
  const id = Number(db.prepare('INSERT INTO encargo_logs (encargo_id, nombre, area, analisis, en) VALUES (?, ?, ?, ?, ?)').run(encargoId, nombre.slice(0, 120), o.area ?? null, JSON.stringify(a), ahora).lastInsertRowid)
  tocar(db, encargoId, ahora)
  return { id, analisis: a }
}

export function logsDe(db: Db, encargoId: number) {
  return (db.prepare('SELECT * FROM encargo_logs WHERE encargo_id = ? ORDER BY id DESC').all(encargoId) as any[]).map((r) => ({ id: r.id, nombre: r.nombre, area: r.area, en: r.en, analisis: json<Analisis>(r.analisis, null as any) }))
}

const piezasDe = (db: Db, encargoId: number, tipo: string) =>
  db.prepare(`SELECT id, titulo, contenido, meta FROM corpus WHERE fuente = 'discovery' AND json_extract(meta, '$.encargo') = ? AND json_extract(meta, '$.tipo') = ? ORDER BY id`).all(encargoId, tipo) as { id: number; titulo: string; contenido: string; meta: string }[]

// ─── lo que arma Mastropiero ────────────────────────────────────────────

const SISTEMA_GUIA = (area: string) => `Armás la guía de entrevista de un discovery de transformación con IA para el área «${area}» de un cliente. El valor está en saber qué preguntar: lo que no está escrito, las excepciones y los traspasos entre áreas.
Bloques (3 a 6 preguntas cada uno, concretas, que se respondan con números o ejemplos):
- "volumen_y_costo": cuántas veces por mes corre cada proceso, cuánto cuesta una unidad (una factura, un contrato), cuánta gente.
- "sistemas": en qué sistemas pasa cada paso (ERP, CRM, mail, planillas), qué se copia a mano.
- "pasos_y_traspasos": el recorrido real de un caso típico, de quién a quién pasa, dónde espera.
- "excepciones": qué sale del camino feliz, cuántas por mes, quién las resuelve y cómo.
- "lo_no_escrito": lo que se hace y no está en el procedimiento (mails, llamadas, planillas propias).
- "aprobaciones_y_auditoria": quién aprueba, qué exige la auditoría o la ley (lo que tiene que seguir haciendo una persona).
- "dependencias": qué depende de otras áreas arriba y abajo.
- "lo_que_el_log_contradice": si te paso el análisis del log, preguntas para confrontar lo que dicen con lo que muestran los datos (si no, lista vacía).
- "champions": cómo detectar quién ya usa IA para trabajar mejor.
Forma: {"volumen_y_costo": [string], "sistemas": [string], "pasos_y_traspasos": [string], "excepciones": [string], "lo_no_escrito": [string], "aprobaciones_y_auditoria": [string], "dependencias": [string], "lo_que_el_log_contradice": [string], "champions": [string]}`

const BLOQUES_GUIA: [string, string][] = [['volumen_y_costo', 'Volumen y costo'], ['sistemas', 'Sistemas'], ['pasos_y_traspasos', 'Pasos y traspasos'], ['excepciones', 'Excepciones'], ['lo_no_escrito', 'Lo que no está escrito'], ['aprobaciones_y_auditoria', 'Aprobaciones y auditoría'], ['dependencias', 'Dependencias'], ['lo_que_el_log_contradice', 'Lo que el log contradice'], ['champions', 'Champions']]

/** La guía de entrevista de un área (con lo que el log contradice, si hay log). Queda como pieza. */
export async function guiaDeEntrevista(db: Db, encargoId: number, area: string, ahora = Date.now()) {
  const e = encargoOError(db, encargoId)
  const logs = logsDe(db, encargoId).filter((l) => !l.area || !area || l.area.toLowerCase() === area.toLowerCase())
  const d = await modelo(db, SISTEMA_GUIA(area), [`Cliente: ${e.cliente}.${e.notas ? ` Notas: ${e.notas}` : ''}`, logs.length ? logs.map((l) => logComoTexto(l.analisis, l.nombre)).join('\n\n') : 'Todavía no hay log.'].join('\n\n'), 2500)
  const bloques = BLOQUES_GUIA.map(([k, t]) => ({ clave: k, titulo: t, preguntas: (Array.isArray(d?.[k]) ? d[k] : []).map((x: unknown) => String(x ?? '').trim()).filter(Boolean).slice(0, 8) as string[] })).filter((b) => b.preguntas.length)
  if (!bloques.length) throw new Error('No salió la guía: probá de nuevo')
  const md = `# Guía de entrevista · ${e.cliente} · ${area}\n\n${bloques.map((b) => `## ${b.titulo}\n${b.preguntas.map((p) => `- ${p}`).join('\n')}`).join('\n\n')}`
  const piezaId = piezaDeEncargo(db, e, 'guia', `Guía de entrevista · ${e.cliente} · ${area}`, md, { area }, ahora, `discovery:${e.id}:guia:${area.toLowerCase()}`)
  return { piezaId, bloques, md }
}

const SISTEMA_ASIS = `Armás el mapa AS-IS de un proceso para un discovery de transformación con IA. Tenés: el análisis del log de eventos (lo que pasa de verdad), las entrevistas (lo que cuenta la gente) y la documentación (lo que dice que se hace).
- "pasos": en orden, el recorrido real de un caso típico, incluyendo los pasos fuera del sistema (mails, llamadas, planillas) que aparezcan en entrevistas. Cada uno: {"paso": corto, "area", "sistema" (o null), "quien" (rol), "minutos" (de trabajo por caso, estimado; null si no hay base), "frecuencia" (texto corto, p. ej. «700 por mes»), "excepciones" (qué sale mal acá, o null), "fuente": "log" | "entrevista" | "documento", "en_la_doc": true si la documentación lo menciona}.
- "documentados": cuántos pasos describe la documentación (null si no hay documentos).
- "hallazgos": 3 a 6 frases: lo que no estaba escrito, dónde se espera, los retrabajos, los traspasos que más cuestan.
No inventes pasos sin base en el material. Forma: {"nombre": nombre del proceso, "pasos": [...], "documentados": number | null, "hallazgos": [string]}`

/** El as-is de un área: log + entrevistas + documentos. Crea o reemplaza el proceso del encargo para esa área. */
export async function armarAsis(db: Db, encargoId: number, area: string, ahora = Date.now()) {
  const e = encargoOError(db, encargoId)
  const ent = piezasDe(db, encargoId, 'entrevista')
  const docs = piezasDe(db, encargoId, 'documento')
  const logs = logsDe(db, encargoId)
  if (!ent.length && !logs.length) throw new Error('Para el as-is hace falta al menos un log o una entrevista')
  const material = [
    `Cliente: ${e.cliente}. Área: ${area}.`,
    logs.length ? `LOGS:\n${logs.map((l) => logComoTexto(l.analisis, l.nombre)).join('\n\n')}` : 'Sin log.',
    ent.length ? `ENTREVISTAS:\n${ent.map((p) => `[${p.titulo}]\n${p.contenido.slice(0, 6000)}`).join('\n\n')}` : 'Sin entrevistas.',
    docs.length ? `DOCUMENTACIÓN:\n${docs.map((p) => `[${p.titulo}]\n${p.contenido.slice(0, 5000)}`).join('\n\n')}` : 'Sin documentación.',
  ].join('\n\n').slice(0, 60000)
  const d = await modelo(db, SISTEMA_ASIS, material, 6000)
  const pasos: PasoAsis[] = (Array.isArray(d?.pasos) ? d.pasos : []).slice(0, 60).map((p: any, i: number) => ({
    n: i + 1, paso: String(p?.paso ?? '').trim().slice(0, 160), area: p?.area ? String(p.area).slice(0, 60) : null, sistema: p?.sistema ? String(p.sistema).slice(0, 60) : null,
    quien: p?.quien ? String(p.quien).slice(0, 60) : null, minutos: Number.isFinite(Number(p?.minutos)) && p?.minutos != null ? Number(p.minutos) : null,
    frecuencia: p?.frecuencia ? String(p.frecuencia).slice(0, 60) : null, excepciones: p?.excepciones ? String(p.excepciones).slice(0, 240) : null,
    fuente: ['log', 'entrevista', 'documento'].includes(p?.fuente) ? p.fuente : 'entrevista', en_la_doc: p?.en_la_doc === true,
  })).filter((p: PasoAsis) => p.paso)
  if (!pasos.length) throw new Error('No salió el as-is: sumá material y probá de nuevo')
  const nombre = String(d?.nombre ?? `${area} · ${e.cliente}`).slice(0, 120)
  const documentados = Number.isFinite(Number(d?.documentados)) && d?.documentados != null ? Number(d.documentados) : null
  const ambito = `encargo:${encargoId}`
  const ya = db.prepare('SELECT id FROM procesos WHERE ambito = ? AND area = ?').get(ambito, area) as { id: number } | undefined
  let id: number
  if (ya) {
    db.prepare('UPDATE procesos SET nombre = ?, pasos_asis = ?, documentados = ?, actualizado_en = ? WHERE id = ?').run(nombre, JSON.stringify(pasos), documentados, ahora, ya.id)
    id = ya.id
  } else id = Number(db.prepare('INSERT INTO procesos (ambito, nombre, area, pasos_asis, documentados, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ambito, nombre, area, JSON.stringify(pasos), documentados, ahora, ahora).lastInsertRowid)
  tocar(db, encargoId, ahora)
  return { proceso: leerProceso(db, id)!, hallazgos: (Array.isArray(d?.hallazgos) ? d.hallazgos : []).map(String).slice(0, 6) as string[] }
}

const SISTEMA_TOBE = `Diseñás el TO-BE de un proceso: para cada paso del as-is, la pregunta es ¿se puede borrar?, ¿lo hace código?, ¿lo hace un agente?, ¿o lo tiene que seguir haciendo una persona?
- "borrar": si existe por un problema aguas arriba que se puede arreglar, o no agrega valor. El error más común es automatizar el as-is sin borrar.
- "codigo": si la regla es determinística (validar, cruzar, mover datos entre sistemas).
- "agente": solo donde la entrada es impredecible (leer un formato nuevo, clasificar con criterio aprendido de casos anteriores).
- "persona": si la auditoría, la ley o el juicio lo exigen (decilo), o para las excepciones.
Cada paso: {"n": el número del as-is, "destino": "borrar" | "codigo" | "agente" | "persona", "por_que": una frase, "regla": la regla o el criterio del agente (o null)}.
Forma: {"pasos": [...]}`

/** El to-be: un destino por paso del as-is. */
export async function armarTobe(db: Db, procesoId: number, ahora = Date.now()) {
  const p = leerProceso(db, procesoId)
  if (!p?.pasosAsis?.length) throw new Error('Primero el as-is')
  const d = await modelo(db, SISTEMA_TOBE, `Proceso: ${p.nombre}\nAs-is:\n${p.pasosAsis.map((x) => `${x.n}. ${x.paso} [${x.area ?? '?'} · ${x.sistema ?? 'sin sistema'} · ${x.quien ?? '?'}${x.minutos != null ? ` · ${x.minutos} min` : ''}${x.excepciones ? ` · excepciones: ${x.excepciones}` : ''}]`).join('\n')}`, 4000)
  const porN = new Map<number, any>((Array.isArray(d?.pasos) ? d.pasos : []).map((x: any) => [Number(x?.n), x]))
  const tobe: PasoTobe[] = p.pasosAsis.map((x) => {
    const t = porN.get(x.n)
    return { n: x.n, destino: (DESTINOS as readonly string[]).includes(t?.destino) ? t.destino : 'persona', por_que: String(t?.por_que ?? 'Sin propuesta: queda en una persona hasta revisarlo').slice(0, 240), regla: t?.regla ? String(t.regla).slice(0, 300) : null }
  })
  db.prepare('UPDATE procesos SET pasos_tobe = ?, actualizado_en = ? WHERE id = ?').run(JSON.stringify(tobe), ahora, procesoId)
  return leerProceso(db, procesoId)!
}

/** Cambiar el destino de un paso (él decide). */
export function editarPaso(db: Db, procesoId: number, n: number, c: { destino?: string; por_que?: string; regla?: string | null }, ahora = Date.now()) {
  const p = leerProceso(db, procesoId)
  if (!p) throw new Error(`No existe el proceso ${procesoId}`)
  const tobe = p.pasosTobe ?? p.pasosAsis!.map((x) => ({ n: x.n, destino: 'persona' as const, por_que: '', regla: null }))
  const t = tobe.find((x) => x.n === n)
  if (!t) throw new Error(`No hay paso ${n}`)
  if (c.destino !== undefined) {
    if (!(DESTINOS as readonly string[]).includes(c.destino)) throw new Error(`El destino es ${DESTINOS.join(', ')}`)
    t.destino = c.destino as PasoTobe['destino']
  }
  if (c.por_que !== undefined) t.por_que = String(c.por_que).slice(0, 240)
  if (c.regla !== undefined) t.regla = c.regla ? String(c.regla).slice(0, 300) : null
  db.prepare('UPDATE procesos SET pasos_tobe = ?, actualizado_en = ? WHERE id = ?').run(JSON.stringify(tobe), ahora, procesoId)
  return leerProceso(db, procesoId)!
}

export function leerProceso(db: Db, id: number) {
  const r = db.prepare('SELECT * FROM procesos WHERE id = ?').get(id) as any
  if (!r) return null
  const pasosAsis = json<PasoAsis[] | null>(r.pasos_asis, null)
  const pasosTobe = json<PasoTobe[] | null>(r.pasos_tobe, null)
  return { id: r.id as number, ambito: r.ambito as string, nombre: r.nombre as string, area: r.area as string | null, pasosAsis, pasosTobe, kpis: json<Kpi[]>(r.kpis, []) ?? [], documentados: r.documentados as number | null, resumen: resumenTobe(pasosAsis, pasosTobe), actualizadoEn: r.actualizado_en as number }
}
export type Proceso = NonNullable<ReturnType<typeof leerProceso>>

/** «De 24 pasos: 7 se borran, 4 código, 6 agentes, 3 personas», con los minutos por caso antes y después. */
export function resumenTobe(asis: PasoAsis[] | null, tobe: PasoTobe[] | null) {
  if (!asis?.length) return null
  const cuenta = { borrar: 0, codigo: 0, agente: 0, persona: 0 }
  for (const t of tobe ?? []) cuenta[t.destino]++
  const minutosAntes = asis.reduce((s, p) => s + (p.minutos ?? 0), 0)
  const quedan = new Set((tobe ?? []).filter((t) => t.destino === 'persona').map((t) => t.n))
  const minutosDespues = tobe ? asis.filter((p) => quedan.has(p.n)).reduce((s, p) => s + (p.minutos ?? 0), 0) : null
  const fueraDeLaDoc = asis.filter((p) => !p.en_la_doc).length
  return {
    pasos: asis.length, ...cuenta, fueraDeLaDoc, minutosAntes, minutosDespues,
    texto: tobe ? `De ${asis.length} pasos: ${cuenta.borrar} ${cuenta.borrar === 1 ? 'se borra' : 'se borran'}, ${cuenta.codigo} ${cuenta.codigo === 1 ? 'pasa' : 'pasan'} a código, ${cuenta.agente} a ${cuenta.agente === 1 ? 'un agente' : 'agentes'} y ${cuenta.persona} ${cuenta.persona === 1 ? 'queda' : 'quedan'} en una persona.` : `${asis.length} pasos reales${fueraDeLaDoc ? `, ${fueraDeLaDoc} fuera de la documentación` : ''}.`,
  }
}

export function procesosDe(db: Db, ambito: string) {
  return (db.prepare('SELECT id FROM procesos WHERE ambito = ? ORDER BY id').all(ambito) as { id: number }[]).map((r) => leerProceso(db, r.id)!)
}

// ─── la hoja de valor ───────────────────────────────────────────────────

const SISTEMA_KPIS = `Proponés los KPIs de un proyecto de transformación con IA, ANTES de construir, para acordarlos con el CEO y el CFO del cliente. Tres categorías: "tiempo_costo" (días de cierre, costo por unidad, horas), "ingresos" (ingresos netos del gasto en tokens), "riesgo" (errores, excepciones, cumplimiento).
Con la línea de base que sale del material (log, as-is); si no hay base, "linea_base": null y "medido_en": cómo medirla. "objetivo": realista para 16 semanas.
Cada uno: {"categoria", "nombre", "linea_base": string | null, "objetivo": string | null, "unidad": string | null, "medido_en": de dónde sale el número}. 3 a 7 en total.
Forma: {"kpis": [...]}`

const limpiarKpi = (k: any): Kpi | null => {
  const nombre = String(k?.nombre ?? '').trim().slice(0, 120)
  if (!nombre) return null
  const s = (v: unknown, n = 80) => (v == null || v === '' ? null : String(v).slice(0, n))
  return { categoria: (CATEGORIAS_KPI as readonly string[]).includes(k?.categoria) ? k.categoria : 'tiempo_costo', nombre, linea_base: s(k?.linea_base), objetivo: s(k?.objetivo), unidad: s(k?.unidad, 30), medido_en: s(k?.medido_en, 160) }
}

/** Mastropiero propone los KPIs de un proceso (después él los ajusta). */
export async function proponerKpis(db: Db, procesoId: number, ahora = Date.now()) {
  const p = leerProceso(db, procesoId)
  if (!p) throw new Error(`No existe el proceso ${procesoId}`)
  const encargo = p.ambito.startsWith('encargo:') ? Number(p.ambito.slice(8)) : null
  const logs = encargo ? logsDe(db, encargo) : []
  const d = await modelo(db, SISTEMA_KPIS, [`Proceso: ${p.nombre}`, p.pasosAsis ? `As-is: ${p.pasosAsis.map((x) => `${x.n}. ${x.paso}${x.minutos != null ? ` (${x.minutos} min)` : ''}${x.frecuencia ? ` · ${x.frecuencia}` : ''}`).join('; ')}` : '', p.resumen ? p.resumen.texto : '', logs.map((l) => logComoTexto(l.analisis, l.nombre)).join('\n\n')].filter(Boolean).join('\n\n'), 1800)
  return guardarKpis(db, procesoId, (Array.isArray(d?.kpis) ? d.kpis : []).map(limpiarKpi).filter(Boolean) as Kpi[], ahora)
}

export function guardarKpis(db: Db, procesoId: number, kpis: unknown[], ahora = Date.now()) {
  if (!leerProceso(db, procesoId)) throw new Error(`No existe el proceso ${procesoId}`)
  const ks = (Array.isArray(kpis) ? kpis : []).map(limpiarKpi).filter(Boolean).slice(0, 12)
  db.prepare('UPDATE procesos SET kpis = ?, actualizado_en = ? WHERE id = ?').run(JSON.stringify(ks), ahora, procesoId)
  return leerProceso(db, procesoId)!
}

const NOMBRE_CATEGORIA: Record<string, string> = { tiempo_costo: 'Tiempo y costo', ingresos: 'Ingresos (netos de tokens)', riesgo: 'Riesgo' }
const NOMBRE_DESTINO: Record<string, string> = { borrar: 'se borra', codigo: 'código', agente: 'agente', persona: 'persona' }

/** La hoja de valor del encargo en Markdown: lo que el cliente lleva al directorio. */
export function hojaDeValor(db: Db, encargoId: number): string {
  const e = encargoOError(db, encargoId)
  const ps = procesosDe(db, `encargo:${encargoId}`)
  const areas = areasDe(db, encargoId)
  return [
    `# ${e.nombre}`,
    `**Cliente:** ${e.cliente} · **Por dónde empezamos:** ${e.departamento ?? areas[0]?.nombre ?? 'a definir'} · **Estado:** ${e.estado}`,
    areas.length ? `## Por qué esta área\n| Área | Volumen/mes | Costo/mes | Áreas que toca | Puntaje |\n|---|---|---|---|---|\n${areas.map((a) => `| ${a.nombre} | ${a.volumenMes ?? '—'} | ${a.costoMes ?? '—'} | ${a.alcance ?? '—'} | ${a.puntaje} |`).join('\n')}` : '',
    ...ps.map((p) => [
      `## ${p.nombre}`,
      p.resumen ? `${p.resumen.texto}${p.documentados != null ? ` La documentación describía ${p.documentados}; en la realidad son ${p.resumen.pasos}.` : ''}${p.resumen.minutosAntes ? ` Trabajo por caso: ${p.resumen.minutosAntes} min hoy${p.resumen.minutosDespues != null ? ` → ${p.resumen.minutosDespues} min` : ''}.` : ''}` : '',
      p.kpis.length ? `### Lo que acordamos medir\n| Categoría | KPI | Hoy | Objetivo | Cómo se mide |\n|---|---|---|---|---|\n${p.kpis.map((k) => `| ${NOMBRE_CATEGORIA[k.categoria]} | ${k.nombre} | ${k.linea_base ?? 'a medir'}${k.unidad && k.linea_base ? ` ${k.unidad}` : ''} | ${k.objetivo ?? '—'}${k.unidad && k.objetivo ? ` ${k.unidad}` : ''} | ${k.medido_en ?? '—'} |`).join('\n')}` : '',
      p.pasosTobe ? `### El rediseño\n${p.pasosAsis!.map((x) => { const t = p.pasosTobe!.find((y) => y.n === x.n); return `${x.n}. ${x.paso} → **${NOMBRE_DESTINO[t?.destino ?? 'persona']}**${t?.por_que ? ` (${t.por_que})` : ''}` }).join('\n')}` : '',
    ].filter(Boolean).join('\n\n')),
    `## Cómo llegamos\n1. Sombra (2 semanas, todo el volumen, sin actuar): cada diferencia entre el agente y la persona se revisa.\n2. Desde la semana 3, el agente actúa solo donde las reglas aciertan 99 % o más; la persona queda con las excepciones.\n3. Semana 12: el agente toma la gran mayoría; el área siguiente la construyen los champions.`,
  ].filter(Boolean).join('\n\n')
}

// ─── modo sombra del cliente ────────────────────────────────────────────

const igual = (a: string, b: string) => a.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim() === b.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()

/** Casos en sombra desde un CSV (regla, propuesta del agente, lo que hizo la persona, fecha; caso opcional). */
export function cargarSombra(db: Db, encargoId: number, csv: string, procesoId?: number | null, ahora = Date.now()) {
  encargoOError(db, encargoId)
  const { columnas, filas } = leerCsv(csv)
  const i = (re: RegExp) => columnas.findIndex((c) => re.test(c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
  const [ir, ip, irl, iff, ic] = [i(/^(regla|rule|tipo|categoria)/), i(/^(propuesta|agente|agent|prediccion|sugerido)/), i(/^(real|persona|humano|human|final|decision)/), i(/^(fecha|date|dia)/), i(/^(caso|case|id)/)]
  if (ir < 0 || ip < 0 || irl < 0) throw new Error('El CSV necesita las columnas regla, propuesta (del agente) y real (lo que hizo la persona)')
  const ins = db.prepare('INSERT INTO sombra_casos (encargo_id, proceso_id, caso, regla, propuesta, real, coincide, fecha, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  let n = 0
  for (const f of filas) {
    const regla = (f[ir] ?? '').trim()
    if (!regla) continue
    const propuesta = (f[ip] ?? '').trim()
    const real = (f[irl] ?? '').trim()
    const fecha = iff >= 0 && /^\d{4}-\d{2}-\d{2}/.test((f[iff] ?? '').trim()) ? f[iff].trim().slice(0, 10) : fechaLocal(ahora)
    ins.run(encargoId, procesoId ?? null, ic >= 0 ? f[ic]?.trim() || null : null, regla.slice(0, 120), propuesta.slice(0, 300), real.slice(0, 300), igual(propuesta, real) ? 1 : 0, fecha, ahora)
    n++
  }
  tocar(db, encargoId, ahora)
  return { cargados: n, ...sombraDe(db, encargoId) }
}

/** Por regla: casos, acierto y si ya puede actuar sola (≥ 99 % con 50 casos o más). Y la curva por semana. */
export function sombraDe(db: Db, encargoId: number) {
  const reglas = (db.prepare('SELECT regla, COUNT(*) AS casos, SUM(coincide) AS aciertos, MIN(fecha) AS desde, MAX(fecha) AS hasta FROM sombra_casos WHERE encargo_id = ? GROUP BY regla').all(encargoId) as any[])
    .map((r) => ({ regla: r.regla as string, casos: r.casos as number, aciertos: r.aciertos as number, acierto: Math.round((r.aciertos / r.casos) * 1000) / 10, desde: r.desde, hasta: r.hasta, lista: r.casos >= 50 && r.aciertos / r.casos >= 0.99 }))
    .sort((a, b) => b.casos - a.casos)
  const total = reglas.reduce((s, r) => s + r.casos, 0)
  const cubiertos = reglas.filter((r) => r.lista).reduce((s, r) => s + r.casos, 0)
  const semanas = (db.prepare(`SELECT strftime('%Y-%W', fecha) AS semana, COUNT(*) AS casos, SUM(coincide) AS aciertos FROM sombra_casos WHERE encargo_id = ? GROUP BY semana ORDER BY semana`).all(encargoId) as any[])
    .map((s) => ({ semana: s.semana as string, casos: s.casos as number, acierto: Math.round((s.aciertos / s.casos) * 1000) / 10 }))
  return { reglas, total, puedeTomar: total ? Math.round((cubiertos / total) * 1000) / 10 : 0, semanas }
}

/** Una persona del cliente en el encargo: el sponsor (quien decide) o un champion (quien ya usa IA y construye lo próximo). */
export function sumarPersona(db: Db, encargoId: number, x: { nombre: string; rol: 'champion' | 'sponsor' | string; notas?: string | null }, ahora = Date.now()) {
  const e = encargoOError(db, encargoId)
  const nombre = String(x.nombre ?? '').trim().slice(0, 120)
  if (nombre.length < 2) throw new Error('¿Quién?')
  const rol = x.rol === 'sponsor' ? 'sponsor' : 'champion'
  const personaId = asegurarEntidad(db, { tipo: 'persona', nombre }, ahora)
  try { anotarConexion(db, { a: personaId, b: e.clienteId, relacion: 'trabaja en', origen: 'discovery' }, ahora) } catch { /* ya estaba */ }
  db.prepare(`INSERT INTO persona_proyecto (persona_id, proyecto_id, rol, notas, desde) VALUES (?, ?, ?, ?, ?) ON CONFLICT (persona_id, proyecto_id) DO UPDATE SET rol = excluded.rol, notas = COALESCE(excluded.notas, notas)`)
    .run(personaId, e.proyectoId, rol, x.notas?.trim() || null, ahora)
  return fichaEncargo(db, encargoId).champions
}

const tableroDeChampions = (db: Db, id: number) => (db.prepare(`SELECT e.id, e.nombre, SUM(CASE WHEN a.fecha >= ? THEN a.minutos ELSE 0 END) AS minutos4, SUM(a.minutos) AS total FROM champion_ahorros a JOIN entidades e ON e.id = a.persona_id WHERE a.encargo_id = ? GROUP BY a.persona_id ORDER BY minutos4 DESC`).all(fechaLocal(Date.now() - 28 * 86_400_000), id) as any[])

/** Todo lo de un encargo para su pantalla. */
export function fichaEncargo(db: Db, id: number) {
  const e = encargoOError(db, id)
  const desc = (p: { id: number; titulo: string; contenido: string; meta: string }) => ({ id: p.id, titulo: p.titulo, palabras: p.contenido.split(/\s+/).length, meta: json<any>(p.meta, {}) })
  return {
    encargo: e, areas: areasDe(db, id), entrevistas: piezasDe(db, id, 'entrevista').map(desc), documentos: piezasDe(db, id, 'documento').map(desc),
    guias: piezasDe(db, id, 'guia').map((p) => ({ id: p.id, titulo: p.titulo, md: p.contenido, area: json<any>(p.meta, {})?.area ?? null })),
    logs: logsDe(db, id), procesos: procesosDe(db, `encargo:${id}`), sombra: sombraDe(db, id),
    tablero: tableroDeChampions(db, id),
    champions: db.prepare(`SELECT e.id, e.nombre, pp.rol FROM persona_proyecto pp JOIN entidades e ON e.id = pp.persona_id WHERE pp.proyecto_id = ? AND pp.rol IN ('champion', 'sponsor')`).all(e.proyectoId ?? -1),
  }
}
