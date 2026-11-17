/**
 * Las reservas (Fragua #254, capa 1): que Deprocast las maneje, no solo las recuerde. Sin integraciones:
 * - una reserva con sitio, fecha, hora, personas, contacto (teléfono, mail, link) y estado: a buscar → pedida →
 *   confirmada (o cancelada), con su comprobante;
 * - Deprocast arma el texto de la solicitud (mail o WhatsApp) y el guion de la llamada, en su voz y con su nombre
 *   (el de su ficha); él lo manda con un toque (los links abren el mail, WhatsApp o el teléfono ya cargados);
 * - el seguimiento: una pedida sin confirmar a las 48 h se avisa en Hoy (una vez por día), con el recordatorio armado;
 * - una confirmada entra a la agenda del día (y de ahí al Hoy, la línea y los avisos del teléfono).
 * Lo que NO hace: mandar nada solo, ni pagar (una seña es decisión suya). Las capas 2 (formularios web) y 3 (cuentas y
 * claves) van aparte.
 */
import { fechaLocal, json, type Db } from './db.ts'

export type EstadoReserva = 'a_buscar' | 'pedida' | 'confirmada' | 'cancelada'
export type Reserva = {
  id: number; sitio: string; fecha: string | null; hora: string | null; personas: number | null; telefono: string | null; email: string | null; link: string | null
  estado: EstadoReserva; nota: string | null; comprobante: string | null; entidadId: number | null; pedidaEn: number | null; confirmadaEn: number | null; avisadaEn: number | null
  historia: { en: number; estado: string; nota?: string }[]; creadaEn: number
}
export const ESTADOS_RESERVA: EstadoReserva[] = ['a_buscar', 'pedida', 'confirmada', 'cancelada']
const NOMBRE_ESTADO: Record<EstadoReserva, string> = { a_buscar: 'a buscar', pedida: 'pedida', confirmada: 'confirmada', cancelada: 'cancelada' }

const ESQUEMA = `CREATE TABLE IF NOT EXISTS reservas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sitio TEXT NOT NULL,
  fecha TEXT, hora TEXT, personas INTEGER,
  telefono TEXT, email TEXT, link TEXT,
  estado TEXT NOT NULL DEFAULT 'a_buscar',
  nota TEXT, comprobante TEXT,
  entidad_id INTEGER,
  pedida_en INTEGER, confirmada_en INTEGER, avisada_en INTEGER,
  historia TEXT NOT NULL DEFAULT '[]',
  creada_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reservas_estado ON reservas(estado, fecha);`
const listos = new WeakSet<Db>()
function asegurar(db: Db) { if (!listos.has(db)) { db.exec(ESQUEMA); listos.add(db) } }

const deFila = (r: any): Reserva => ({
  id: r.id, sitio: r.sitio, fecha: r.fecha, hora: r.hora, personas: r.personas, telefono: r.telefono, email: r.email, link: r.link, estado: r.estado, nota: r.nota,
  comprobante: r.comprobante, entidadId: r.entidad_id, pedidaEn: r.pedida_en, confirmadaEn: r.confirmada_en, avisadaEn: r.avisada_en, historia: json(r.historia, []), creadaEn: r.creada_en,
})
export function leerReserva(db: Db, id: number): Reserva | null { asegurar(db); const r = db.prepare('SELECT * FROM reservas WHERE id = ?').get(id); return r ? deFila(r) : null }

const fechaValida = (f: unknown) => (typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null)
const horaValida = (h: unknown) => (typeof h === 'string' && /^\d{1,2}:\d{2}$/.test(h.trim()) ? h.trim().padStart(5, '0') : null)
const texto = (x: unknown, n: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : null)

export type DatosReserva = { sitio?: string; fecha?: string | null; hora?: string | null; personas?: number | null; telefono?: string | null; email?: string | null; link?: string | null; nota?: string | null; estado?: EstadoReserva; comprobante?: string | null }

/** Anota una reserva (a buscar, o pedida si él ya la pidió). El sitio queda como lugar en el grafo. */
export async function crearReserva(db: Db, d: DatosReserva, ahora = Date.now()): Promise<Reserva> {
  asegurar(db)
  const sitio = texto(d.sitio, 120)
  if (!sitio) throw new Error('Falta el sitio de la reserva (el restaurante, el médico, el lugar)')
  const estado = d.estado && ESTADOS_RESERVA.includes(d.estado) ? d.estado : 'a_buscar'
  let entidad: number | null = null
  try { entidad = (await import('./entidades.ts')).asegurarEntidad(db, { tipo: 'lugar', nombre: sitio }) } catch { /* el grafo es un plus */ }
  const id = Number(db.prepare(`INSERT INTO reservas (sitio, fecha, hora, personas, telefono, email, link, estado, nota, comprobante, entidad_id, pedida_en, confirmada_en, historia, creada_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    sitio, fechaValida(d.fecha), horaValida(d.hora), d.personas != null && Number(d.personas) > 0 ? Math.round(Number(d.personas)) : null,
    texto(d.telefono, 40), texto(d.email, 120), texto(d.link, 500), estado, texto(d.nota, 500), texto(d.comprobante, 500), entidad,
    estado === 'pedida' ? ahora : null, estado === 'confirmada' ? ahora : null, JSON.stringify([{ en: ahora, estado }]), ahora,
  ).lastInsertRowid)
  return leerReserva(db, id)!
}

/** Cambia datos o el estado (pedida, confirmada con su comprobante, cancelada). Cada cambio de estado queda en su historia. */
export function actualizarReserva(db: Db, id: number, d: DatosReserva, ahora = Date.now()): Reserva {
  const r = leerReserva(db, id)
  if (!r) throw new Error(`No existe la reserva ${id}`)
  const sets: string[] = [], args: unknown[] = []
  const poner = (col: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v) }
  if (d.sitio !== undefined && texto(d.sitio, 120)) poner('sitio', texto(d.sitio, 120))
  if (d.fecha !== undefined) poner('fecha', fechaValida(d.fecha))
  if (d.hora !== undefined) poner('hora', horaValida(d.hora))
  if (d.personas !== undefined) poner('personas', d.personas != null && Number(d.personas) > 0 ? Math.round(Number(d.personas)) : null)
  for (const [k, n] of [['telefono', 40], ['email', 120], ['link', 500], ['nota', 500], ['comprobante', 500]] as const) if (d[k] !== undefined) poner(k, texto(d[k], n))
  if (d.estado && d.estado !== r.estado) {
    if (!ESTADOS_RESERVA.includes(d.estado)) throw new Error(`Estado inválido: ${d.estado} (a_buscar | pedida | confirmada | cancelada)`)
    poner('estado', d.estado)
    if (d.estado === 'pedida') { poner('pedida_en', ahora); poner('avisada_en', null) }
    if (d.estado === 'confirmada') poner('confirmada_en', ahora)
    poner('historia', JSON.stringify([...r.historia, { en: ahora, estado: d.estado, ...(d.nota ? { nota: d.nota.slice(0, 200) } : {}) }].slice(-30)))
  }
  if (sets.length) db.prepare(`UPDATE reservas SET ${sets.join(', ')} WHERE id = ?`).run(...(args as any[]), id)
  return leerReserva(db, id)!
}

export function listarReservas(db: Db, o: { estado?: EstadoReserva | 'abiertas' | 'todas'; desde?: string; limite?: number } = {}): Reserva[] {
  asegurar(db)
  const where: string[] = [], args: unknown[] = []
  if (!o.estado || o.estado === 'abiertas') where.push(`estado IN ('a_buscar', 'pedida', 'confirmada')`)
  else if (o.estado !== 'todas') { where.push('estado = ?'); args.push(o.estado) }
  if (o.desde) { where.push('(fecha IS NULL OR fecha >= ?)'); args.push(o.desde) }
  return (db.prepare(`SELECT * FROM reservas ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY fecha IS NULL, fecha, hora, id DESC LIMIT ?`).all(...(args as any[]), o.limite ?? 100) as any[]).map(deFila)
}

// ─── los textos ─────────────────────────────────────────────────────────

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «el viernes 21 de noviembre a las 21:00». */
export function cuandoEnPalabras(fecha: string | null, hora: string | null): string {
  if (!fecha) return hora ? `a las ${hora}` : ''
  const d = new Date(`${fecha}T12:00:00`)
  return `el ${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}${hora ? ` a las ${hora}` : ''}`
}

async function nombreSuyo(db: Db): Promise<string | null> {
  try {
    const { entidadDelJugador } = await import('./personajes.ts')
    const id = entidadDelJugador(db)
    return id ? ((db.prepare('SELECT nombre FROM entidades WHERE id = ?').get(id) as { nombre: string } | undefined)?.nombre ?? null) : null
  } catch { return null }
}

const sinTel = (t: string) => t.replace(/[^\d+]/g, '')

/**
 * Lo que hace falta para pedirla: el mail (asunto y cuerpo), el mensaje de WhatsApp, el guion de la llamada y los links
 * que abren cada cosa ya cargada. recordatorio: el texto para insistir (si ya se pidió y no contestaron).
 */
export async function textosDeReserva(db: Db, id: number) {
  const r = leerReserva(db, id)
  if (!r) throw new Error(`No existe la reserva ${id}`)
  const yo = await nombreSuyo(db)
  const cuando = cuandoEnPalabras(r.fecha, r.hora)
  const para = r.personas ? `para ${r.personas} persona${r.personas === 1 ? '' : 's'}` : ''
  const pedido = [para, cuando].filter(Boolean).join(' ')
  const firma = yo ? `\n\nGracias,\n${yo}` : '\n\nGracias.'
  const asunto = `Reserva${pedido ? ` ${pedido}` : ''}`
  const cuerpo = `Hola, buenas.\n\nQuería reservar${pedido ? ` ${pedido}` : ''}${r.nota ? ` (${r.nota})` : ''}. ¿Tienen disponibilidad? Si no, ¿qué opción cercana me pueden ofrecer?${firma}`
  const whatsapp = `Hola, buenas. Quería reservar${pedido ? ` ${pedido}` : ''}${r.nota ? ` (${r.nota})` : ''}. ¿Tienen lugar?${yo ? ` Soy ${yo}.` : ''} ¡Gracias!`
  const llamada = [
    `Hola, buenas${yo ? `, soy ${yo}` : ''}. Llamo para hacer una reserva${pedido ? ` ${pedido}` : ''}.`,
    r.nota ? `Si preguntan algo más: ${r.nota}.` : null,
    'Si no hay lugar: preguntar qué hora o qué día cercano tienen.',
    'Antes de cortar: confirmar el nombre de la reserva, el día y la hora, y si piden seña o una tarjeta.',
  ].filter(Boolean) as string[]
  const recordatorio = `Hola, buenas. Les escribí${r.pedidaEn ? ` el ${new Date(r.pedidaEn).getDate()}/${new Date(r.pedidaEn).getMonth() + 1}` : ''} para reservar${pedido ? ` ${pedido}` : ''} y no tuve respuesta. ¿Me pueden confirmar si hay lugar?${yo ? ` Soy ${yo}.` : ''} ¡Gracias!`
  const enc = encodeURIComponent
  return {
    reserva: r, asunto, cuerpo, whatsapp, llamada, recordatorio,
    links: {
      mail: r.email ? `mailto:${r.email}?subject=${enc(asunto)}&body=${enc(cuerpo)}` : null,
      whatsapp: r.telefono ? `https://wa.me/${sinTel(r.telefono).replace(/^\+/, '')}?text=${enc(r.estado === 'pedida' ? recordatorio : whatsapp)}` : null,
      llamar: r.telefono ? `tel:${sinTel(r.telefono)}` : null,
      web: r.link,
    },
  }
}

// ─── el seguimiento y la agenda ────────────────────────────────────────

/**
 * Las pedidas sin confirmar hace 48 h o más: una alerta por reserva y por día (va a Hoy con el resto de las alertas).
 * También avisa las confirmadas de mañana (para no olvidarse), una vez.
 */
export function alertasReservas(db: Db, ahora = Date.now()): { clave: string; texto: string }[] {
  asegurar(db)
  const hoy = fechaLocal(ahora)
  const out: { clave: string; texto: string }[] = []
  for (const r of listarReservas(db, { estado: 'pedida' })) {
    if (!r.pedidaEn || ahora - r.pedidaEn < 48 * 3_600_000) continue
    if (r.fecha && r.fecha < hoy) continue
    const dias = Math.floor((ahora - r.pedidaEn) / 86_400_000)
    out.push({ clave: `reserva:${r.id}:${hoy}`, texto: `🍽 La reserva en ${r.sitio}${r.fecha || r.hora ? ` (${cuandoEnPalabras(r.fecha, r.hora)})` : ''} la pediste hace ${dias} días y no hay confirmación. ¿Insisto? Te tengo el recordatorio armado (decime «recordatorio de la reserva ${r.id}»)${r.telefono ? ', o llamalos' : ''}.` })
  }
  const manana = fechaLocal(ahora + 86_400_000)
  for (const r of listarReservas(db, { estado: 'confirmada' })) {
    if (r.fecha !== manana) continue
    out.push({ clave: `reserva:${r.id}:manana`, texto: `🍽 Mañana: ${r.sitio}${r.hora ? ` a las ${r.hora}` : ''}${r.personas ? `, ${r.personas} personas` : ''}. Confirmada${r.comprobante ? ` (${r.comprobante})` : ''}.` })
  }
  return out
}

/** Las confirmadas (y las pedidas, marcadas) de una fecha, como eventos de la agenda (sin fecha u hora, no entran). */
export function eventosDeReservas(db: Db, fecha: string): { titulo: string; inicio: number; fin: number; todoElDia: boolean; lugar: string | null }[] {
  try { asegurar(db) } catch { return [] }
  return (db.prepare(`SELECT * FROM reservas WHERE fecha = ? AND hora IS NOT NULL AND estado IN ('pedida', 'confirmada')`).all(fecha) as any[]).map(deFila).map((r) => {
    const inicio = new Date(`${r.fecha}T${r.hora}:00`).getTime()
    return { titulo: `${r.estado === 'pedida' ? '(sin confirmar) ' : ''}Reserva · ${r.sitio}${r.personas ? ` · ${r.personas} p.` : ''}`, inicio, fin: inicio + 2 * 3_600_000, todoElDia: false, lugar: r.sitio }
  })
}

export const estadoEnPalabras = (e: EstadoReserva) => NOMBRE_ESTADO[e]
