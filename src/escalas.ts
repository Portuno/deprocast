/**
 * El diario por escalas (Fragua #286). Cada pieza suya (un audio de caminata, una foto, una nota, una hoja, lo que
 * dictó) cae en su día por su propia fecha, sin que nadie la asigne a mano. El día se resume desde esas piezas y desde
 * lo que hizo (mensajes, misiones cerradas, registros de salud, gastos), no desde un listado plano del chat. Y cada
 * escala se arma desde la de abajo: la semana desde sus días, el mes desde sus semanas, el trimestre, el cuatrimestre y
 * el semestre desde sus meses, el año desde sus meses y el lustro desde sus años. Un audio del 15/11 queda en su día,
 * su semana y su mes solo.
 *
 * Se mantiene de noche: el día de ayer (y el de hoy, si ya tiene algo), las escalas que los contienen si cambió algo
 * abajo, y el pasado de a poco (los días con piezas y sin resumen, de los más nuevos a los más viejos).
 */
import crypto from 'node:crypto'
import { fechaLocal, type Db } from './db.ts'

export const ESCALAS = ['dia', 'semana', 'mes', 'trimestre', 'cuatrimestre', 'semestre', 'año', 'lustro'] as const
export type Escala = (typeof ESCALAS)[number]
/** De qué escala se arma cada una (la de abajo). */
const DE: Record<Exclude<Escala, 'dia'>, Escala> = { semana: 'dia', mes: 'semana', trimestre: 'mes', cuatrimestre: 'mes', semestre: 'mes', año: 'mes', lustro: 'año' }

const ESQUEMA = `CREATE TABLE IF NOT EXISTS escalas (
  escala TEXT NOT NULL,
  clave TEXT NOT NULL,
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL,
  texto TEXT NOT NULL,
  piezas INTEGER NOT NULL DEFAULT 0,
  firma TEXT NOT NULL,
  hecho_en INTEGER NOT NULL,
  PRIMARY KEY (escala, clave)
)`
const listos = new WeakSet<Db>()
function asegurar(db: Db) {
  if (listos.has(db)) return
  db.exec(ESQUEMA)
  listos.add(db)
}

// ─── el calendario de las escalas ────────────────────────────────────────

const fecha = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const masDias = (f: string, n: number) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** La semana ISO de una fecha: su clave (2026-W46) y su lunes. */
function semanaIso(f: string): { clave: string; lunes: string } {
  const d = new Date(`${f}T12:00:00Z`)
  const dia = (d.getUTCDay() + 6) % 7
  const lunes = masDias(f, -dia)
  // ISO 8601: la semana es del año de su jueves, y su número sale del día del año de ese jueves.
  const jueves = new Date(`${masDias(lunes, 3)}T12:00:00Z`)
  const diaDelAnio = Math.round((jueves.getTime() - Date.UTC(jueves.getUTCFullYear(), 0, 1, 12)) / 86_400_000) + 1
  const n = Math.floor((diaDelAnio - 1) / 7) + 1
  return { clave: `${jueves.getUTCFullYear()}-W${String(n).padStart(2, '0')}`, lunes }
}

/** El período de una escala que contiene la fecha: su clave y sus límites (inclusive). */
export function periodo(escala: Escala, f: string): { clave: string; desde: string; hasta: string } {
  const [y, m] = f.split('-').map(Number)
  switch (escala) {
    case 'dia': return { clave: f, desde: f, hasta: f }
    case 'semana': { const s = semanaIso(f); return { clave: s.clave, desde: s.lunes, hasta: masDias(s.lunes, 6) } }
    case 'mes': return { clave: f.slice(0, 7), desde: fecha(y, m, 1), hasta: fecha(y, m, ultimoDia(y, m)) }
    case 'trimestre': { const q = Math.ceil(m / 3); return { clave: `${y}-T${q}`, desde: fecha(y, q * 3 - 2, 1), hasta: fecha(y, q * 3, ultimoDia(y, q * 3)) } }
    case 'cuatrimestre': { const c = Math.ceil(m / 4); return { clave: `${y}-C${c}`, desde: fecha(y, c * 4 - 3, 1), hasta: fecha(y, c * 4, ultimoDia(y, c * 4)) } }
    case 'semestre': { const s = m <= 6 ? 1 : 2; return { clave: `${y}-S${s}`, desde: fecha(y, s * 6 - 5, 1), hasta: fecha(y, s * 6, ultimoDia(y, s * 6)) } }
    case 'año': return { clave: String(y), desde: fecha(y, 1, 1), hasta: fecha(y, 12, 31) }
    case 'lustro': { const l = Math.floor(y / 5) * 5; return { clave: `${l}-${l + 4}`, desde: fecha(l, 1, 1), hasta: fecha(l + 4, 12, 31) } }
  }
}

/** Todas las escalas que contienen la fecha. */
export const escalasDe = (f: string) => ESCALAS.map((e) => ({ escala: e, ...periodo(e, f) }))

/** Las claves de la escala de abajo que forman un período (los días de la semana, las semanas del mes…). */
function partes(escala: Exclude<Escala, 'dia'>, desde: string, hasta: string): { clave: string; desde: string; hasta: string }[] {
  const de = DE[escala]
  const out: { clave: string; desde: string; hasta: string }[] = []
  for (let f = desde; f <= hasta;) {
    const p = periodo(de, f)
    if (!out.some((x) => x.clave === p.clave)) out.push(p)
    f = masDias(p.hasta, 1)
  }
  return out
}

// ─── lo que pasó (las piezas y la actividad) ─────────────────────────────

const DIA_DE_PIEZA = `substr(COALESCE(fecha, date(creado_en / 1000, 'unixepoch', 'localtime')), 1, 10)`
const contar = (db: Db, sql: string, ...a: (string | number)[]) => { try { return Number((db.prepare(sql).get(...a) as { n?: number } | undefined)?.n ?? 0) } catch { return 0 } }

/** Las piezas suyas (nivel propia) de un día, por su fecha: lo que dijo, mandó, escribió o fotografió. */
export function piezasDelDia(db: Db, f: string, limite = 60): { id: number; fuente: string; titulo: string; extracto: string }[] {
  return (db.prepare(`SELECT id, fuente, titulo, SUBSTR(contenido, 1, 500) AS extracto FROM corpus WHERE nivel = 'propia' AND ${DIA_DE_PIEZA} = ? ORDER BY id LIMIT ?`).all(f, limite) as any[])
}

/** Lo que hizo ese día, en números (sin modelo). */
function actividadDelDia(db: Db, f: string) {
  const desde = new Date(`${f}T00:00:00`).getTime(), hasta = desde + 86_400_000
  return {
    mensajes: contar(db, `SELECT COUNT(*) AS n FROM mensajes WHERE rol = 'operador' AND en >= ? AND en < ?`, desde, hasta),
    misionesHechas: (db.prepare(`SELECT titulo FROM misiones WHERE estado = 'hecha' AND cerrada_en >= ? AND cerrada_en < ? LIMIT 20`).all(desde, hasta) as { titulo: string }[]).map((m) => m.titulo),
    salud: (db.prepare(`SELECT tipo, titulo FROM salud WHERE fecha = ? LIMIT 30`).all(f) as { tipo: string; titulo: string }[]).map((s) => `${s.tipo}: ${s.titulo}`),
    gastos: contar(db, `SELECT COUNT(*) AS n FROM movimientos WHERE fecha = ?`, f),
  }
}

const firmaDe = (x: unknown) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16)

// ─── armar ───────────────────────────────────────────────────────────────

const SISTEMA_DIA = `Escribís la entrada del diario de un día del operador, a partir de lo que de verdad quedó de ese día: sus piezas (audios transcritos, fotos leídas, notas, hojas, lo que dictó) y su actividad. En castellano rioplatense, en segunda persona («caminaste», «pensaste en…»), corto: de 4 a 10 líneas.
- Primero qué fue el día en una línea; después lo que pensaste, hiciste y decidiste, con los nombres y los datos que aparecen.
- Nada que no esté en lo que te paso. Si hay poco, el día es corto: no lo infles.
- Al final, si hay, «Quedó abierto:» con lo pendiente que aparece.
Devolvé solo el texto.`
const SISTEMA_ESCALA = (escala: Escala) => `Escribís el resumen de ${escala === 'semana' ? 'una semana' : escala === 'mes' ? 'un mes' : escala === 'año' ? 'un año' : escala === 'lustro' ? 'un lustro' : `un ${escala}`} del operador a partir de los resúmenes de sus partes (que van en orden). En castellano rioplatense, en segunda persona, de 5 a 12 líneas.
- Lo que atraviesa el período (temas, proyectos, personas que vuelven), lo que cambió de una parte a otra y lo que se cerró.
- Nada que no esté en las partes; si una parte no tiene resumen, no la inventes.
- Al final, «Sigue abierto:» con lo que viene arrastrándose.
Devolvé solo el texto.`

let escribir = async (db: Db, sistema: string, usuario: string): Promise<string> =>
  (await (await import('./modelo.ts')).llamarModelo({ db, clase: 'mastropiero', agenteId: 'escalas' }, { mensajes: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }], herramientas: [], temperatura: 0.4, maxTokens: 1500 })).texto.trim()
export function _probarEscalas(f: typeof escribir) { escribir = f }

function guardar(db: Db, escala: Escala, p: { clave: string; desde: string; hasta: string }, texto: string, piezas: number, firma: string, ahora: number) {
  db.prepare(`INSERT INTO escalas (escala, clave, desde, hasta, texto, piezas, firma, hecho_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (escala, clave) DO UPDATE SET texto = excluded.texto, piezas = excluded.piezas, firma = excluded.firma, hecho_en = excluded.hecho_en`)
    .run(escala, p.clave, p.desde, p.hasta, texto, piezas, firma, ahora)
}

export function leerEscala(db: Db, escala: Escala, clave: string): { escala: Escala; clave: string; desde: string; hasta: string; texto: string; piezas: number; firma: string; hechoEn: number } | null {
  asegurar(db)
  const r = db.prepare('SELECT * FROM escalas WHERE escala = ? AND clave = ?').get(escala, clave) as any
  return r ? { escala: r.escala, clave: r.clave, desde: r.desde, hasta: r.hasta, texto: r.texto, piezas: r.piezas, firma: r.firma, hechoEn: r.hecho_en } : null
}

/** Arma (o rehace, si cambió lo que tiene adentro) el día. Devuelve si escribió algo. */
export async function armarDia(db: Db, f: string, ahora = Date.now()): Promise<boolean> {
  asegurar(db)
  const piezas = piezasDelDia(db, f)
  const act = actividadDelDia(db, f)
  if (!piezas.length && !act.mensajes && !act.misionesHechas.length && !act.salud.length) return false
  // Mobile 1.3: el tiempo en el teléfono de ese día (pantalla, distracción), si lo mandó (cambia la firma solo si hay).
  const telefono = await import('./uso-telefono.ts').then((u) => u.lineaDelDia(db, f)).catch(() => null)
  const firma = firmaDe(telefono ? { p: piezas.map((p) => p.id), act, telefono } : { p: piezas.map((p) => p.id), act })
  if (leerEscala(db, 'dia', f)?.firma === firma) return false
  const usuario = [
    `Día: ${f}.`,
    piezas.length ? `Sus piezas de ese día:\n${piezas.map((p) => `- [#${p.id}] ${p.titulo}: ${p.extracto.replace(/\s+/g, ' ')}`).join('\n')}` : 'No dejó piezas ese día.',
    `Actividad: ${act.mensajes} mensajes suyos${act.misionesHechas.length ? `; misiones cerradas: ${act.misionesHechas.join('; ')}` : ''}${act.salud.length ? `; salud: ${act.salud.join('; ')}` : ''}${act.gastos ? `; ${act.gastos} movimientos de plata` : ''}.`,
  ].join('\n\n')
  const texto = await escribir(db, SISTEMA_DIA, (telefono ? `${usuario}\n\nEn el teléfono: ${telefono}.` : usuario).slice(0, 30_000))
  if (!texto) return false
  guardar(db, 'dia', periodo('dia', f), texto, piezas.length, firma, ahora)
  return true
}

/** Arma una escala desde los resúmenes de la de abajo (si cambió alguno). Devuelve si escribió algo. */
export async function armarEscala(db: Db, escala: Exclude<Escala, 'dia'>, f: string, ahora = Date.now()): Promise<boolean> {
  asegurar(db)
  const p = periodo(escala, f)
  const de = DE[escala]
  const hijos = partes(escala, p.desde, p.hasta).map((x) => ({ ...x, r: leerEscala(db, de, x.clave) })).filter((x) => x.r)
  if (!hijos.length) return false
  const firma = firmaDe(hijos.map((h) => [h.clave, h.r!.firma]))
  if (leerEscala(db, escala, p.clave)?.firma === firma) return false
  const usuario = `${escala} ${p.clave} (${p.desde} a ${p.hasta}). Sus partes (${de}), en orden:\n\n${hijos.map((h) => `## ${h.clave}\n${h.r!.texto}`).join('\n\n')}`
  const texto = await escribir(db, SISTEMA_ESCALA(escala), usuario.slice(0, 40_000))
  if (!texto) return false
  guardar(db, escala, p, texto, hijos.reduce((s, h) => s + h.r!.piezas, 0), firma, ahora)
  return true
}

/** Rehace hacia arriba todo lo que contiene la fecha (la semana, el mes… hasta el lustro), en orden. */
export async function armarHaciaArriba(db: Db, f: string, ahora = Date.now()): Promise<string[]> {
  const hechas: string[] = []
  if (await armarDia(db, f, ahora)) hechas.push(`dia ${f}`)
  for (const e of ESCALAS.slice(1) as Exclude<Escala, 'dia'>[]) if (await armarEscala(db, e, f, ahora)) hechas.push(`${e} ${periodo(e, f).clave}`)
  return hechas
}

/**
 * La pasada de la noche: ayer y hoy, y hacia arriba; después el pasado, de a `pasado` días con piezas y sin resumen
 * (de los más nuevos a los más viejos), cada uno con lo que lo contiene.
 */
export async function pasadaNocturna(db: Db, ahora = Date.now(), o: { pasado?: number } = {}): Promise<{ hechas: string[]; fallas: string[] }> {
  asegurar(db)
  const hechas: string[] = [], fallas: string[] = []
  const hoy = fechaLocal(ahora), ayer = fechaLocal(ahora - 86_400_000)
  const intentar = async (f: string) => { try { hechas.push(...(await armarHaciaArriba(db, f, ahora))) } catch (e) { fallas.push(`${f}: ${e instanceof Error ? e.message : e}`) } }
  await intentar(ayer)
  await intentar(hoy)
  const sinResumen = (db.prepare(`SELECT ${DIA_DE_PIEZA} AS dia FROM corpus WHERE nivel = 'propia' GROUP BY dia
      HAVING dia IS NOT NULL AND dia < ? AND dia NOT IN (SELECT clave FROM escalas WHERE escala = 'dia') ORDER BY dia DESC LIMIT ?`).all(ayer, o.pasado ?? 14) as { dia: string }[])
    .map((r) => r.dia).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  for (const d of sinResumen) await intentar(d)
  return { hechas, fallas }
}

/** Para la pantalla y el chat: una escala con sus partes (los resúmenes de abajo) y, si es un día, sus piezas. */
export function verEscala(db: Db, escala: Escala, f: string) {
  asegurar(db)
  const p = periodo(escala, /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : fechaLocal())
  const r = leerEscala(db, escala, p.clave)
  const hijos = escala === 'dia' ? [] : partes(escala, p.desde, p.hasta).map((x) => ({ clave: x.clave, desde: x.desde, texto: leerEscala(db, DE[escala], x.clave)?.texto ?? null }))
  return {
    escala, ...p, texto: r?.texto ?? null, hechoEn: r?.hechoEn ?? null, piezas: r?.piezas ?? 0,
    partes: hijos, de: escala === 'dia' ? null : DE[escala],
    piezasDelDia: escala === 'dia' ? piezasDelDia(db, p.desde).map((x) => ({ id: x.id, titulo: x.titulo, fuente: x.fuente })) : [],
    anterior: masDias(p.desde, -1), siguiente: masDias(p.hasta, 1),
  }
}
