/**
 * El agente de extracciones (Fragua #264): lo que él hace a mano con cada cliente de extracción de datos, armado:
 * - la ficha del cliente: quién decide, quién firma, qué sistema usa, qué le duele, el contacto, y el estado del cobro
 *   (quién responde cuándo se paga y la fecha comprometida);
 * - el plan de extracción: origen y destino (Microsoft, Azure Blob, Google Cloud Storage, S3…), qué se copia, con qué
 *   herramienta, ventana, volumen, costo estimado (con sus supuestos) y quién lo ejecuta (el ajuste extracciones_ejecuta,
 *   o lo que diga la ficha): para que quien ejecuta lo reciba listo. Y la explicación en dos versiones: para el técnico y
 *   para el que paga;
 * - los correos, listos para mandar y NUNCA mandados: asunto, cuerpo y un pedido concreto, en su voz. Con Gmail
 *   conectado quedan en sus borradores;
 * - la rutina de la mañana: los correos del día (hasta 10) para los clientes que lo necesitan, en una lista en Hoy;
 * - el seguimiento: qué se mandó (se ve en su Gmail), quién contestó, y un aviso cuando un cliente lleva 10 días sin
 *   respuesta.
 * Lo que no hace: mandar nada, prometer plazos, ni tocar la infraestructura de un cliente.
 */
import { ajuste, fechaLocal, json, type Db } from './db.ts'

export const ESTADOS_EXTRACCION = ['prospecto', 'plan', 'en_curso', 'hecha', 'pausa'] as const
export type EstadoExtraccion = (typeof ESTADOS_EXTRACCION)[number]
export type Ficha = {
  origen?: string | null; destino?: string | null; que?: string | null; herramienta?: string | null; ventana?: string | null; volumen?: string | null; costo?: string | null; ejecuta?: string | null
  decide?: string | null; firma?: string | null; sistema?: string | null; dolor?: string | null; contacto?: string | null; email?: string | null
  cobroEstado?: string | null; cobroFecha?: string | null; cobroQuien?: string | null; notas?: string | null
}
export type Extraccion = { id: number; cliente: string; entidadId: number | null; estado: EstadoExtraccion; ficha: Ficha; plan: string | null; paraTecnico: string | null; paraQuienPaga: string | null; creadaEn: number; actualizadaEn: number }
export type CorreoExtraccion = { id: number; extraccionId: number; para: string | null; asunto: string; cuerpo: string; pedido: string | null; estado: 'borrador' | 'mandado' | 'respondido' | 'descartado'; borradorGmail: string | null; creadoEn: number; mandadoEn: number | null; respondidoEn: number | null }

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS extracciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT NOT NULL, entidad_id INTEGER, estado TEXT NOT NULL DEFAULT 'prospecto',
  ficha TEXT NOT NULL DEFAULT '{}', plan TEXT, para_tecnico TEXT, para_quien_paga TEXT, creada_en INTEGER NOT NULL, actualizada_en INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS extraccion_correos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, extraccion_id INTEGER NOT NULL, para TEXT, asunto TEXT NOT NULL, cuerpo TEXT NOT NULL, pedido TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador', borrador_gmail TEXT, creado_en INTEGER NOT NULL, mandado_en INTEGER, respondido_en INTEGER
);
CREATE INDEX IF NOT EXISTS extraccion_correos_e ON extraccion_correos(extraccion_id, estado);`
const listos = new WeakSet<Db>()
function asegurar(db: Db) { if (!listos.has(db)) { db.exec(ESQUEMA); listos.add(db) } }

const deFila = (r: any): Extraccion => ({ id: r.id, cliente: r.cliente, entidadId: r.entidad_id, estado: r.estado, ficha: json<Ficha>(r.ficha, {}) ?? {}, plan: r.plan, paraTecnico: r.para_tecnico, paraQuienPaga: r.para_quien_paga, creadaEn: r.creada_en, actualizadaEn: r.actualizada_en })
const deCorreo = (r: any): CorreoExtraccion => ({ id: r.id, extraccionId: r.extraccion_id, para: r.para, asunto: r.asunto, cuerpo: r.cuerpo, pedido: r.pedido, estado: r.estado, borradorGmail: r.borrador_gmail, creadoEn: r.creado_en, mandadoEn: r.mandado_en, respondidoEn: r.respondido_en })
const CAMPOS: (keyof Ficha)[] = ['origen', 'destino', 'que', 'herramienta', 'ventana', 'volumen', 'costo', 'ejecuta', 'decide', 'firma', 'sistema', 'dolor', 'contacto', 'email', 'cobroEstado', 'cobroFecha', 'cobroQuien', 'notas']
const limpiarFicha = (f: Record<string, unknown>): Ficha => Object.fromEntries(CAMPOS.filter((k) => f[k] !== undefined).map((k) => [k, f[k] == null || String(f[k]).trim() === '' ? null : String(f[k]).trim().slice(0, k === 'notas' || k === 'dolor' ? 1500 : 300)]))

export function leerExtraccion(db: Db, id: number): Extraccion | null { asegurar(db); const r = db.prepare('SELECT * FROM extracciones WHERE id = ?').get(id); return r ? deFila(r) : null }
export function listarExtracciones(db: Db, o: { abiertas?: boolean } = {}): Extraccion[] {
  asegurar(db)
  return (db.prepare(`SELECT * FROM extracciones ${o.abiertas ? `WHERE estado IN ('prospecto', 'plan', 'en_curso')` : ''} ORDER BY actualizada_en DESC`).all() as any[]).map(deFila)
}
/** Por id o por nombre del cliente (sin tildes ni mayúsculas). */
export function buscarExtraccion(db: Db, cual: number | string): Extraccion | null {
  if (typeof cual === 'number' || /^\d+$/.test(String(cual))) return leerExtraccion(db, Number(cual))
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const xs = listarExtracciones(db)
  return xs.find((x) => n(x.cliente) === n(String(cual))) ?? xs.find((x) => n(x.cliente).includes(n(String(cual)))) ?? null
}

/** Un cliente nuevo (queda como empresa en el grafo) o, si ya está, el mismo con la ficha completada. */
export async function crearExtraccion(db: Db, cliente: string, ficha: Record<string, unknown> = {}, ahora = Date.now()): Promise<Extraccion> {
  asegurar(db)
  const nombre = String(cliente ?? '').trim().slice(0, 120)
  if (!nombre) throw new Error('Falta el cliente')
  const ya = buscarExtraccion(db, nombre)
  if (ya && ya.cliente.toLowerCase() === nombre.toLowerCase()) return actualizarExtraccion(db, ya.id, { ficha }, ahora)
  let entidad: number | null = null
  try { entidad = (await import('./entidades.ts')).asegurarEntidad(db, { tipo: 'empresa', nombre }) } catch { /* el grafo es un plus */ }
  const id = Number(db.prepare('INSERT INTO extracciones (cliente, entidad_id, ficha, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?)').run(nombre, entidad, JSON.stringify(limpiarFicha(ficha)), ahora, ahora).lastInsertRowid)
  return leerExtraccion(db, id)!
}

/** Completa la ficha (solo lo que viene) o cambia el estado. */
export function actualizarExtraccion(db: Db, id: number, c: { ficha?: Record<string, unknown>; estado?: string }, ahora = Date.now()): Extraccion {
  const x = leerExtraccion(db, id)
  if (!x) throw new Error(`No existe la extracción ${id}`)
  if (c.estado && !(ESTADOS_EXTRACCION as readonly string[]).includes(c.estado)) throw new Error(`Estado inválido (${ESTADOS_EXTRACCION.join(' | ')})`)
  const ficha = { ...x.ficha, ...limpiarFicha(c.ficha ?? {}) }
  db.prepare('UPDATE extracciones SET ficha = ?, estado = COALESCE(?, estado), actualizada_en = ? WHERE id = ?').run(JSON.stringify(ficha), c.estado ?? null, ahora, id)
  return leerExtraccion(db, id)!
}

// ─── el plan ─────────────────────────────────────────────────────────────

const SISTEMA_PLAN = `Armás el plan de extracción de datos de un cliente, para que quien lo ejecuta lo reciba listo. Con lo que te paso de la ficha; lo que falte, lo decís como supuesto o como pregunta abierta (nunca lo inventes como dato).
- plan (markdown): Origen → destino; qué se copia; herramienta (la adecuada al par: AzCopy o Azure Data Factory desde Microsoft/Azure, AWS DataSync o S3 Batch desde/hacia S3, Storage Transfer Service hacia Google Cloud, rclone si mezcla nubes; con por qué); ventana de ejecución; volumen estimado; costo estimado con sus supuestos (transferencia de salida, almacenamiento, horas de servicio; en rangos, nunca un número firme); quién lo ejecuta; pasos numerados para el ejecutor (con la verificación: conteo de objetos y sumas de control); riesgos y qué hacer si algo falla; preguntas abiertas para el cliente.
- paraTecnico: la explicación para el técnico del cliente (qué va a pasar en su sistema, qué permisos hacen falta, qué ventana), 6 a 10 líneas.
- paraQuienPaga: la explicación para el que paga (qué se resuelve, cuánto cuesta en rango, cuánto tarda en días hábiles, qué riesgo saca de encima), 4 a 6 líneas, sin jerga.
Nunca prometas plazos cerrados ni toques nada de su infraestructura: es un plan. Devolvé {"plan","paraTecnico","paraQuienPaga"}.`

let redactar = async (db: Db, sistema: string, usuario: string): Promise<any> => (await (await import('./modelo.ts')).pedirJson({ db, clase: 'mastropiero', agenteId: 'extracciones' }, sistema, usuario, { temperatura: 0.3, maxTokens: 3500, largo: true })).datos
export function _probarExtracciones(f: typeof redactar) { redactar = f }

export async function armarPlan(db: Db, id: number, ahora = Date.now()): Promise<Extraccion> {
  const x = leerExtraccion(db, id)
  if (!x) throw new Error(`No existe la extracción ${id}`)
  const ejecuta = x.ficha.ejecuta ?? ajuste(db, 'extracciones_ejecuta')
  const r = await redactar(db, SISTEMA_PLAN, JSON.stringify({ cliente: x.cliente, ...x.ficha, ejecuta: ejecuta ?? '(sin definir)' }))
  const plan = String(r?.plan ?? '').trim()
  if (!plan) throw new Error('No salió el plan: probá de nuevo en un rato')
  db.prepare(`UPDATE extracciones SET plan = ?, para_tecnico = ?, para_quien_paga = ?, estado = CASE WHEN estado = 'prospecto' THEN 'plan' ELSE estado END, actualizada_en = ? WHERE id = ?`)
    .run(plan.slice(0, 20_000), String(r?.paraTecnico ?? '').trim().slice(0, 4000) || null, String(r?.paraQuienPaga ?? '').trim().slice(0, 3000) || null, ahora, id)
  return leerExtraccion(db, id)!
}

// ─── los correos ─────────────────────────────────────────────────────────

const SISTEMA_CORREO = (voz: string) => `Escribís un correo de él a un cliente de extracción de datos, listo para que él lo mande (vos no mandás nada). ${voz}
- Corto (5 a 10 líneas), concreto, con UN pedido claro al final (una fecha para hablar, un acceso, un ok, una respuesta sobre el cobro).
- Que se note que conoce su problema (lo que le duele, su sistema).
- Nada de plazos prometidos ni de precios cerrados: rangos y «lo vemos».
- Si es un seguimiento, no reproches: retomá el hilo y facilitá la respuesta (una pregunta de sí o no).
Devolvé {"asunto","cuerpo","pedido"} (pedido: el pedido en una línea).`

export function correosDe(db: Db, extraccionId: number): CorreoExtraccion[] {
  asegurar(db)
  return (db.prepare('SELECT * FROM extraccion_correos WHERE extraccion_id = ? ORDER BY id DESC').all(extraccionId) as any[]).map(deCorreo)
}

/**
 * Arma un correo para el cliente (proposito: «primer contacto», «seguimiento», «mandar el plan», «el cobro», o lo que
 * él diga). Con Gmail conectado, queda en sus borradores; si no, acá, para copiar.
 */
export async function armarCorreo(db: Db, id: number, proposito: string, ahora = Date.now()): Promise<CorreoExtraccion & { nota: string }> {
  const x = leerExtraccion(db, id)
  if (!x) throw new Error(`No existe la extracción ${id}`)
  const previos = correosDe(db, id).slice(0, 4).map((c) => ({ asunto: c.asunto, estado: c.estado, cuando: fechaLocal(c.mandadoEn ?? c.creadoEn) }))
  let voz = 'En su voz: directo, cálido, sin formalidades vacías.'
  try { voz = (await import('./personalidad.ts')).vozPara('voz_del_operador') || voz } catch { /* la voz por defecto */ }
  const r = await redactar(db, SISTEMA_CORREO(voz), JSON.stringify({ proposito: String(proposito ?? '').slice(0, 500) || 'seguimiento', cliente: x.cliente, estado: x.estado, ficha: x.ficha, plan: x.paraQuienPaga ?? null, correos_anteriores: previos }))
  const asunto = String(r?.asunto ?? '').trim().slice(0, 200), cuerpo = String(r?.cuerpo ?? '').trim().slice(0, 8000)
  if (!asunto || !cuerpo) throw new Error('No salió el correo: probá de nuevo')
  const para = x.ficha.email ?? null
  let borrador: string | null = null, nota = 'Quedó acá para copiar (sin Gmail conectado, o sin el mail del cliente en la ficha).'
  if (para) {
    try { const g = await import('./google/gmail.ts'); const b = await g.crearBorrador(db, { para, asunto, cuerpo }); borrador = b.borrador; nota = b.nota } catch { /* sin Gmail: queda acá */ }
  }
  const cid = Number(db.prepare('INSERT INTO extraccion_correos (extraccion_id, para, asunto, cuerpo, pedido, borrador_gmail, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, para, asunto, cuerpo, String(r?.pedido ?? '').trim().slice(0, 300) || null, borrador, ahora).lastInsertRowid)
  db.prepare('UPDATE extracciones SET actualizada_en = ? WHERE id = ?').run(ahora, id)
  return { ...deCorreo(db.prepare('SELECT * FROM extraccion_correos WHERE id = ?').get(cid)), nota }
}

export function marcarCorreo(db: Db, correoId: number, estado: 'mandado' | 'respondido' | 'descartado', ahora = Date.now()) {
  asegurar(db)
  const col = estado === 'mandado' ? ', mandado_en = COALESCE(mandado_en, ?)' : estado === 'respondido' ? ', respondido_en = COALESCE(respondido_en, ?), mandado_en = COALESCE(mandado_en, ?)' : ''
  const args = estado === 'mandado' ? [ahora] : estado === 'respondido' ? [ahora, ahora] : []
  if (!db.prepare(`UPDATE extraccion_correos SET estado = ?${col} WHERE id = ?`).run(estado, ...args, correoId).changes) throw new Error(`No existe el correo ${correoId}`)
}

/**
 * Lo que ya pasó en su Gmail (si está conectado y sincronizado): un borrador que él mandó (un correo suyo a ese mail
 * con el mismo asunto) pasa a mandado; un correo del cliente después de lo mandado, a respondido.
 */
export function seguirEnGmail(db: Db): { mandados: number; respondidos: number } {
  asegurar(db)
  const r = { mandados: 0, respondidos: 0 }
  try { db.prepare('SELECT 1 FROM correos LIMIT 1').get() } catch { return r }
  for (const c of (db.prepare(`SELECT * FROM extraccion_correos WHERE estado IN ('borrador', 'mandado') AND para IS NOT NULL`).all() as any[]).map(deCorreo)) {
    const para = c.para!.toLowerCase()
    if (c.estado === 'borrador') {
      const m = db.prepare(`SELECT fecha FROM correos WHERE suyo = 1 AND lower(para) LIKE ? AND fecha >= ? AND lower(asunto) LIKE ? ORDER BY fecha LIMIT 1`).get(`%${para}%`, c.creadoEn - 60_000, `%${c.asunto.toLowerCase().slice(0, 40)}%`) as { fecha: number } | undefined
      if (m) { db.prepare(`UPDATE extraccion_correos SET estado = 'mandado', mandado_en = ? WHERE id = ?`).run(m.fecha, c.id); c.estado = 'mandado'; c.mandadoEn = m.fecha; r.mandados++ }
    }
    if (c.estado === 'mandado' && c.mandadoEn) {
      const dominio = para.includes('@') ? para.split('@')[1] : para
      const resp = db.prepare(`SELECT fecha FROM correos WHERE suyo = 0 AND lower(de) LIKE ? AND fecha > ? ORDER BY fecha LIMIT 1`).get(`%${dominio}%`, c.mandadoEn) as { fecha: number } | undefined
      if (resp) { db.prepare(`UPDATE extraccion_correos SET estado = 'respondido', respondido_en = ? WHERE id = ?`).run(resp.fecha, c.id); r.respondidos++ }
    }
  }
  return r
}

/** Días desde el último correo mandado sin respuesta (o null si no hay ninguno esperando). */
export function diasSinRespuesta(db: Db, id: number, ahora = Date.now()): number | null {
  const c = correosDe(db, id).find((x) => x.estado === 'mandado' && x.mandadoEn)
  if (!c) return null
  if (correosDe(db, id).some((x) => x.estado === 'respondido' && (x.respondidoEn ?? 0) > c.mandadoEn!)) return null
  return Math.floor((ahora - c.mandadoEn!) / 86_400_000)
}

/** A quién le toca un correo hoy: sin ningún correo todavía, o con lo último mandado sin respuesta hace 3 días o más. */
export function quienesHoy(db: Db, ahora = Date.now()): { extraccion: Extraccion; proposito: string }[] {
  const out: { extraccion: Extraccion; proposito: string }[] = []
  for (const x of listarExtracciones(db, { abiertas: true })) {
    const cs = correosDe(db, x.id)
    if (cs.some((c) => c.estado === 'borrador' && ahora - c.creadoEn < 3 * 86_400_000)) continue // ya tiene uno esperando
    if (!cs.length) { out.push({ extraccion: x, proposito: x.plan ? 'mandar el plan y pedir una llamada' : 'primer contacto: entender su caso y pedir una llamada' }); continue }
    const d = diasSinRespuesta(db, x.id, ahora)
    if (d != null && d >= 3) out.push({ extraccion: x, proposito: `seguimiento: hace ${d} días que no contesta` })
    else if (x.ficha.cobroFecha && x.ficha.cobroFecha <= fechaLocal(ahora) && !/pagad|cobrad/i.test(x.ficha.cobroEstado ?? '')) out.push({ extraccion: x, proposito: `el cobro: la fecha comprometida era el ${x.ficha.cobroFecha}` })
  }
  return out.slice(0, 10)
}

/** La rutina de la mañana: arma los correos del día y devuelve la lista para Hoy (o null si no hay nada). */
export async function correosDelDia(db: Db, ahora = Date.now()): Promise<string | null> {
  seguirEnGmail(db)
  const hoy = quienesHoy(db, ahora)
  if (!hoy.length) return null
  const hechos: string[] = []
  for (const h of hoy) {
    try { const c = await armarCorreo(db, h.extraccion.id, h.proposito, ahora); hechos.push(`- **${h.extraccion.cliente}** (${h.proposito}): «${c.asunto}»${c.borradorGmail ? ' — en tus borradores de Gmail' : ''}`) } catch (e) { hechos.push(`- ${h.extraccion.cliente}: no pude armarlo (${e instanceof Error ? e.message : e})`) }
  }
  return `✉ Los correos de hoy (${hoy.length}), listos para que los mandes vos:\n${hechos.join('\n')}`
}

/** Los clientes que llevan 10 días o más sin contestar: una alerta por cliente y por semana. */
export function alertasExtracciones(db: Db, ahora = Date.now()): { clave: string; texto: string }[] {
  try { asegurar(db) } catch { return [] }
  const semana = Math.floor(ahora / (7 * 86_400_000))
  return listarExtracciones(db, { abiertas: true }).flatMap((x) => {
    const d = diasSinRespuesta(db, x.id, ahora)
    return d != null && d >= 10 ? [{ clave: `extraccion:${x.id}:${semana}`, texto: `✉ ${x.cliente} lleva ${d} días sin contestar tu último correo. ¿Te armo otro, lo llamás, o lo pongo en pausa?` }] : []
  })
}
