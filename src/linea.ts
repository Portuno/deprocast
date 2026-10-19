/**
 * La línea temporal: lo que pasó y lo que iba a pasar según cada pieza de su archivo, con la fecha resuelta contra la
 * de la pieza («el viernes» dicho el 4/10 es el 9/10), y cada mes con su crónica. Los eventos salen del destilado (el
 * mismo pedido que resume la pieza), así no hay una pasada aparte. Las relaciones entre personas que dice el texto van
 * al grafo (conexiones tipadas, con su evidencia).
 * Una nota de voz suma su propio evento «grabación»: cuándo empezó y, estimado por lo que dura lo dicho, cuándo terminó.
 */
import crypto from 'node:crypto'
import { fechaLocal, json, type Db } from './db.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { anotarConexion } from './entidades.ts'
import { entidadDelJugador, personaje } from './personajes.ts'
import { anotarSideQuest } from './misiones.ts'
import { pedirJson } from './modelo.ts'

type Buscar = (nombre: string) => { id: number; tipo: string } | null
const txt = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max)
const lista = (v: unknown) => (Array.isArray(v) ? v : [])
const clave = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** YYYY-MM-DD o YYYY-MM que existan de verdad. */
export function fechaValida(s: unknown): string | null {
  const f = String(s ?? '').trim()
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(f)) return null
  const d = new Date(`${f.length === 7 ? `${f}-01` : f}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const [a, m, dia] = f.split('-').map(Number)
  if (d.getFullYear() !== a || d.getMonth() + 1 !== m || (dia && d.getDate() !== dia)) return null
  return f
}

/** Guarda los eventos que el destilado encontró en una pieza (sin fecha no entran: la línea es por fecha). */
export function guardarEventos(db: Db, pieza: { id: number }, eventos: unknown[], buscar: Buscar, ahora = Date.now()): number {
  const ins = db.prepare(`INSERT OR IGNORE INTO eventos (pieza_id, titulo, fecha, precision, hora, tipo, lugar, lugar_id, personas, confianza, huella, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  let n = 0
  for (const e of eventos.slice(0, 10) as any[]) {
    const titulo = txt(e?.titulo, 200)
    const fecha = fechaValida(e?.fecha)
    if (!titulo || !fecha) continue
    const lugar = txt(e?.lugar, 100) || null
    const personas = lista(e?.personas).map((x) => txt(x, 80)).filter(Boolean).slice(0, 8).map((nombre) => ({ nombre, id: buscar(nombre)?.id ?? null }))
    const hora = /^\d{1,2}:\d{2}$/.test(String(e?.hora ?? '')) ? String(e.hora).padStart(5, '0') : null
    const conf = Number(e?.confianza)
    const huella = crypto.createHash('sha1').update(`${pieza.id}|${fecha}|${clave(titulo)}`).digest('hex')
    const r = ins.run(pieza.id, titulo, fecha, fecha.length === 7 ? 'mes' : 'dia', hora, e?.tipo === 'futuro' ? 'futuro' : 'pasado', lugar,
      lugar ? buscar(lugar)?.id ?? null : null, personas.length ? JSON.stringify(personas) : null, Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null, huella, ahora)
    n += Number(r.changes)
  }
  return n
}

/** Una nota de voz suya: el evento de la grabación misma (inicio por su título o su fecha; el fin, estimado por lo dicho). */
export function eventoGrabacion(db: Db, p: { id: number; titulo: string; contenido: string; fecha: string | null }, ahora = Date.now()): boolean {
  if (!/^(Audio|Nota de voz)\b/.test(p.titulo)) return false
  const m = /(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/.exec(p.titulo)
  const fecha = fechaValida(m?.[1] ?? p.fecha?.slice(0, 10))
  if (!fecha) return false
  const hora = m?.[2] ? m[2].padStart(5, '0') : null
  // ~140 palabras por minuto hablando.
  const minutos = Math.max(1, Math.round(p.contenido.split(/\s+/).length / 140))
  const fin = hora ? (() => { const t = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3)) + minutos; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` })() : null
  const huella = crypto.createHash('sha1').update(`${p.id}|grabacion`).digest('hex')
  const r = db.prepare(`INSERT OR IGNORE INTO eventos (pieza_id, titulo, fecha, precision, hora, fin, tipo, confianza, huella, creado_en) VALUES (?, ?, ?, 'dia', ?, ?, 'grabacion', 1, ?, ?)`)
    .run(p.id, `Grabó una nota de voz (~${minutos} min)`, fecha, hora, fin, huella, ahora)
  return r.changes > 0
}

export const TIPOS_RELACION = ['pareja', 'familia', 'amistad', 'trabajo', 'socios', 'cliente', 'proveedor', 'conocidos', 'otro'] as const

/** Las relaciones que dice el texto, al grafo: tipadas y con su evidencia. Repetidas suman evidencia, no se duplican. */
export function guardarRelaciones(db: Db, relaciones: unknown[], buscar: Buscar, piezaId: number, ahora = Date.now()): number {
  const yo = entidadDelJugador(db)
  const resolver = (n: string) => (/^(yo|él|el|el jugador)$/i.test(n.trim()) ? yo : (() => { const e = buscar(n); return e && (e.tipo === 'persona' || e.tipo === 'agrupacion') ? e.id : null })())
  let n = 0
  for (const r of relaciones.slice(0, 8) as any[]) {
    const a = resolver(txt(r?.de, 80))
    const b = resolver(txt(r?.con, 80))
    if (!a || !b || a === b) continue
    const [x, y] = a < b ? [a, b] : [b, a]
    const tipo = (TIPOS_RELACION as readonly string[]).includes(r?.tipo) ? String(r.tipo) : 'otro'
    const evidencia = [txt(r?.detalle, 120), txt(r?.evidencia, 200) ? `«${txt(r.evidencia, 200)}»` : ''].filter(Boolean).join(' ')
    const ya = db.prepare('SELECT id, nota FROM conexiones WHERE a = ? AND b = ? AND relacion = ?').get(x, y, tipo) as { id: number; nota: string | null } | undefined
    if (ya) {
      if (evidencia && !(ya.nota ?? '').includes(evidencia.slice(0, 60))) db.prepare('UPDATE conexiones SET nota = ? WHERE id = ?').run([ya.nota, evidencia].filter(Boolean).join(' · ').slice(0, 900), ya.id)
      continue
    }
    anotarConexion(db, { a: x, b: y, relacion: tipo, nota: evidencia || null, origen: `destilado:${piezaId}` }, ahora)
    n++
  }
  return n
}

// ─── la línea ───────────────────────────────────────────────────────────

export type EventoLinea = { id: number; piezaId: number; pieza: string; titulo: string; fecha: string; precision: string; hora: string | null; fin: string | null; tipo: string; lugar: string | null; personas: { nombre: string; id: number | null }[]; estado: string }

const deFila = (r: any): EventoLinea => ({ id: r.id, piezaId: r.pieza_id, pieza: r.pieza, titulo: r.titulo, fecha: r.fecha, precision: r.precision, hora: r.hora, fin: r.fin, tipo: r.tipo, lugar: r.lugar, personas: json(r.personas, []) ?? [], estado: r.estado })

/** Eventos por rango, persona, proyecto o lugar (una entidad), o tema; y las crónicas de los meses que tocan. */
export function lineaTemporal(db: Db, f: { desde?: string; hasta?: string; entidad?: number; tema?: string; tipo?: string; limite?: number } = {}, ahora = Date.now()) {
  const cond = [`e.estado != 'descartado'`]
  const args: (string | number)[] = []
  if (f.desde) cond.push('e.fecha >= ?'), args.push(f.desde)
  if (f.hasta) cond.push('e.fecha <= ?'), args.push(`${f.hasta}~`)
  if (f.tipo) cond.push('e.tipo = ?'), args.push(f.tipo)
  if (f.entidad) {
    cond.push(`(e.lugar_id = ? OR EXISTS (SELECT 1 FROM json_each(COALESCE(e.personas, '[]')) j WHERE json_extract(j.value, '$.id') = ?) OR EXISTS (SELECT 1 FROM json_each(COALESCE(c.entidades, '[]')) k WHERE k.value = ?))`)
    args.push(f.entidad, f.entidad, f.entidad)
  }
  if (f.tema) cond.push('e.pieza_id IN (SELECT pieza_id FROM temas_pulso WHERE clave = ?)'), args.push(clave(f.tema))
  const eventos = (db.prepare(`SELECT e.*, c.titulo AS pieza FROM eventos e JOIN corpus c ON c.id = e.pieza_id WHERE ${cond.join(' AND ')} ORDER BY e.fecha DESC, e.hora DESC LIMIT ?`).all(...args, f.limite ?? 400) as any[]).map(deFila)
  const hoy = fechaLocal(ahora)
  const futuros = (db.prepare(`SELECT e.*, c.titulo AS pieza FROM eventos e JOIN corpus c ON c.id = e.pieza_id WHERE e.tipo = 'futuro' AND e.estado = 'visto' AND e.fecha >= ? ORDER BY e.fecha LIMIT 30`).all(hoy.slice(0, 7)) as any[])
    .map(deFila).filter((e) => e.fecha >= (e.precision === 'mes' ? hoy.slice(0, 7) : hoy))
  const meses = [...new Set(eventos.map((e) => e.fecha.slice(0, 7)))]
  const cronicas = meses.length ? (db.prepare(`SELECT id, titulo, contenido, origen_id FROM corpus WHERE origen_id IN (${meses.map(() => '?').join(',')})`).all(...meses.map((m) => `linea:mes:${m}`)) as any[])
    .map((c) => ({ mes: String(c.origen_id).slice(-7), id: c.id, titulo: c.titulo, extracto: String(c.contenido).slice(0, 600) })) : []
  return { eventos, futuros, cronicas }
}

/** Un evento futuro que encontró en el archivo pasa a ser una side quest con fecha; o se descarta. */
export function resolverEvento(db: Db, id: number, accion: 'agendar' | 'descartar', ahora = Date.now()) {
  const e = db.prepare('SELECT e.*, c.titulo AS pieza FROM eventos e JOIN corpus c ON c.id = e.pieza_id WHERE e.id = ?').get(id) as any
  if (!e) throw new Error(`No existe el evento ${id}`)
  if (accion === 'descartar') return void db.prepare(`UPDATE eventos SET estado = 'descartado' WHERE id = ?`).run(id)
  const m = anotarSideQuest(db, { titulo: e.titulo, detalle: `Salió de «${e.pieza}» [#${e.pieza_id}]${e.hora ? ` · ${e.hora}` : ''}${e.lugar ? ` · ${e.lugar}` : ''}`, vence: e.precision === 'dia' ? e.fecha : null, creadaPor: 'linea' }, ahora)
  db.prepare(`UPDATE eventos SET estado = 'agendado' WHERE id = ?`).run(id)
  return m
}

// ─── la crónica de cada mes ─────────────────────────────────────────────

const FUENTE_CRONICAS = { id: 'cronicas', nombre: 'Crónicas del mes', nivel: 'investigacion' as const, descripcion: 'Cada mes de su archivo contado: qué pasó, en qué estuvo y qué cambió.' }

const SISTEMA_CRONICA = (yo: string) => `Sos Mastropiero. Tenés lo que el archivo de ${yo} dice de UN mes: los resúmenes de lo que escribió, dijo y guardó, y los eventos con fecha. Contá ese mes como una crónica: qué pasó, en qué anduvo, qué decidió, qué quedó abierto y qué cambió respecto de antes. En pasado, concreto, con nombres y fechas cuando estén. Nada que no esté en el material.
Forma: {"titulo": string (corto, que capture el mes), "cronica": string (markdown, 3 a 6 párrafos), "giros": [string] (lo que cambió de rumbo, si hubo), "abierto": [string]}`

let cronicar = async (db: Db, sistema: string, usuario: string) => (await pedirJson<any>({ db, clase: 'gerente', agenteId: 'reproceso-cronica' }, sistema, usuario, { temperatura: 0.4, maxTokens: 4000, largo: true })).datos
export function _probarCronica(f: typeof cronicar) {
  cronicar = f
}

/**
 * Los meses con material nuevo (3 destilados más que la última vez, o sin crónica todavía). Un mes cuya crónica falló
 * 3 veces no vuelve hasta que sume 3 piezas más (antes se reintentaba para siempre con el mismo material).
 */
export function mesesSinCronica(db: Db): { mes: string; n: number }[] {
  const porMes = db.prepare(`SELECT substr(c.fecha, 1, 7) AS mes, COUNT(*) AS n FROM takeout_destilado d JOIN corpus c ON c.id = d.pieza_id
    WHERE d.estado = 'hecho' AND c.fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]*' GROUP BY 1 HAVING n >= 3 ORDER BY 1`).all() as { mes: string; n: number }[]
  return porMes.filter((m) => {
    const fallo = db.prepare('SELECT intentos, piezas FROM cronica_fallos WHERE mes = ?').get(m.mes) as { intentos: number; piezas: number } | undefined
    if (fallo && fallo.intentos >= 3 && m.n < fallo.piezas + 3) return false
    const c = db.prepare('SELECT meta FROM corpus WHERE origen_id = ?').get(`linea:mes:${m.mes}`) as { meta: string | null } | undefined
    return !c || m.n >= (json<any>(c.meta, {})?.destilados ?? 0) + 3
  })
}

/**
 * Anota que la crónica de un mes no salió (con qué material) y devuelve un error que dice cuál: mes, piezas, largo y
 * huella. El log no repite: avisa al primer intento y cuando se deja (al tercero).
 */
function falloDeCronica(db: Db, mes: string, piezas: number, material: string, e: unknown, ahora: number): Error {
  const huella = crypto.createHash('sha1').update(material).digest('hex').slice(0, 10)
  const motivo = e instanceof Error ? e.message : String(e)
  const previo = db.prepare('SELECT intentos, huella FROM cronica_fallos WHERE mes = ?').get(mes) as { intentos: number; huella: string } | undefined
  const intentos = previo && previo.huella === huella ? previo.intentos + 1 : 1
  db.prepare(`INSERT INTO cronica_fallos (mes, intentos, piezas, largo, huella, error, ultimo_en) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (mes) DO UPDATE SET intentos = excluded.intentos, piezas = excluded.piezas, largo = excluded.largo, huella = excluded.huella, error = excluded.error, ultimo_en = excluded.ultimo_en`)
    .run(mes, intentos, piezas, material.length, huella, motivo.slice(0, 500), ahora)
  const err = new Error(`La crónica de ${mes} no salió (${piezas} piezas, ${material.length} caracteres, material ${huella}, intento ${intentos}): ${motivo}`)
  if (intentos === 1 || intentos === 3) console.error(`  crónica: ${err.message}${intentos === 3 ? ' · se deja hasta que el mes tenga material nuevo' : ''}`)
  return err
}

export async function cronicaDelMes(db: Db, mes: string, ahora = Date.now()): Promise<number> {
  const ds = (db.prepare(`SELECT d.salida, c.fecha, c.titulo FROM takeout_destilado d JOIN corpus c ON c.id = d.pieza_id WHERE d.estado = 'hecho' AND substr(c.fecha, 1, 7) = ? ORDER BY c.fecha`).all(mes) as { salida: string; fecha: string; titulo: string }[])
    .map((r) => ({ ...r, d: json<any>(r.salida, {}) ?? {} }))
  const evs = db.prepare(`SELECT titulo, fecha, hora, tipo, lugar FROM eventos WHERE substr(fecha, 1, 7) = ? AND estado != 'descartado' ORDER BY fecha, hora`).all(mes) as any[]
  let material = ds.map((x) => `- ${x.fecha.slice(0, 10)} · ${x.titulo}: ${txt(x.d.resumen, 900)}${lista(x.d.decisiones).length ? ` | decidió: ${lista(x.d.decisiones).slice(0, 3).join('; ')}` : ''}${lista(x.d.abierto).length ? ` | abierto: ${lista(x.d.abierto).slice(0, 2).join('; ')}` : ''}`).join('\n')
  // Más largo, el modelo se corta antes de cerrar el JSON: cabeza y cola del mes.
  if (material.length > 80_000) material = `${material.slice(0, 40_000)}\n…\n${material.slice(-40_000)}`
  const eventos = evs.map((e) => `- ${e.fecha}${e.hora ? ` ${e.hora}` : ''} [${e.tipo}] ${e.titulo}${e.lugar ? ` (${e.lugar})` : ''}`).join('\n')
  const usuario = `Mes: ${mes}\n\nLo que dice el archivo:\n${material}\n\nEventos:\n${eventos || '(ninguno con fecha)'}`
  let d: any
  try {
    d = await cronicar(db, SISTEMA_CRONICA(personaje(db, 'jugador').nombre), usuario)
    if (!txt(d?.cronica)) throw new Error('vino vacía')
  } catch (e) {
    throw falloDeCronica(db, mes, ds.length, usuario, e, ahora)
  }
  db.prepare('DELETE FROM cronica_fallos WHERE mes = ?').run(mes)
  const contenido = [
    txt(d?.cronica, 12_000),
    lista(d?.giros).length ? `## Giros\n${lista(d.giros).map((g) => `- ${txt(g)}`).join('\n')}` : '',
    lista(d?.abierto).length ? `## Quedó abierto\n${lista(d.abierto).map((g) => `- ${txt(g)}`).join('\n')}` : '',
    `— Armada con ${ds.length} piezas y ${evs.length} eventos del mes.`,
  ].filter(Boolean).join('\n\n')
  const titulo = `Mes · ${mes} · ${txt(d?.titulo, 80) || 'crónica'}`
  const ya = db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(`linea:mes:${mes}`) as { id: number } | undefined
  const meta = JSON.stringify({ destilados: ds.length, eventos: evs.length, cronica: mes })
  if (ya) {
    db.prepare('UPDATE corpus SET titulo = ?, contenido = ?, meta = ? WHERE id = ?').run(titulo, contenido, meta, ya.id)
    db.prepare('DELETE FROM pasajes WHERE pieza_id = ?').run(ya.id) // cambió el texto: sus pasajes se rehacen
    return ya.id
  }
  asegurarFuente(db, FUENTE_CRONICAS)
  return insertar(db, { fuente: FUENTE_CRONICAS.id, nivel: 'investigacion', estado: 'disponible', titulo, fecha: `${mes}-01`, contenido, etiquetas: ['cronica', 'linea'], origenId: `linea:mes:${mes}`, meta: JSON.parse(meta) }, ahora)!
}

/** Para Mastropiero: los eventos de un rango o de alguien, cortos. */
export function lineaParaHerramienta(db: Db, f: Parameters<typeof lineaTemporal>[1]) {
  const l = lineaTemporal(db, { ...f, limite: Math.min(f?.limite ?? 60, 150) })
  return {
    eventos: l.eventos.map((e) => ({ id: e.id, fecha: e.fecha, hora: e.hora ?? undefined, tipo: e.tipo, titulo: e.titulo, lugar: e.lugar ?? undefined, personas: e.personas.length ? e.personas.map((p) => p.nombre) : undefined, pieza: e.piezaId })),
    cronicas: l.cronicas.map((c) => ({ mes: c.mes, pieza: c.id, titulo: c.titulo })),
    por_venir: l.futuros.map((e) => ({ id: e.id, fecha: e.fecha, titulo: e.titulo, pieza: e.piezaId })),
  }
}
