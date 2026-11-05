/**
 * El correo en la web (plan v35): la bandeja ordenada para atender, no para leer todo.
 * - Triaje: a cada mail que llega (sin ruido) el modelo le pone si pide respuesta, la urgencia y una línea de qué es.
 *   Corre solo, después de cada pasada por Gmail, de a tandas.
 * - Una respuesta propuesta en SU voz (sus mails enviados como muestra, lo que se sabe de él), editable antes de
 *   guardarla como borrador en Gmail. Nunca se envía.
 * - «Listo»: sale de lo pendiente (solo en Deprocast; Gmail no se toca).
 */
import type { Db } from '../db.ts'
import { memoriaParaPrompt } from '../memoria.ts'
import { pedirJson } from '../modelo.ts'
import { enFondo } from '../nan.ts'
import { buscarMails, crearBorrador, sinCitas } from './gmail.ts'

export type Triaje = { pide_respuesta: boolean; urgencia: 'alta' | 'media' | 'baja'; resumen: string; accion: 'responder' | 'leer' | 'nada' }
export type Filtro = 'responder' | 'no_leidos' | 'todo' | 'enviados'

const json = <T>(s: string | null): T | null => { try { return s ? JSON.parse(s) : null } catch { return null } }
const ORDEN_URGENCIA = { alta: 0, media: 1, baja: 2 } as const

const SISTEMA_TRIAJE = `Ordenás la bandeja de correo de una persona (el jugador) para que atienda solo lo que importa.
Para cada mail decidí:
- "pide_respuesta": true si una persona real le pide algo, le pregunta algo o espera que conteste. Newsletters, avisos automáticos, recibos, notificaciones y confirmaciones: false.
- "urgencia": "alta" (hoy, o tiene fecha cercana, o es de alguien importante esperando), "media" (esta semana) o "baja".
- "resumen": UNA línea, máximo 120 caracteres, en castellano rioplatense: quién y qué pide o qué es. Sin repetir el asunto tal cual.
- "accion": "responder", "leer" (le sirve saberlo) o "nada".
Forma: {"correos": [{"id": string, "pide_respuesta": boolean, "urgencia": string, "resumen": string, "accion": string}]}`

/** Pone triaje a lo que llegó y todavía no lo tiene (los últimos 14 días, sin ruido), de a tandas de 12. */
export async function triarCorreos(db: Db, o: { max?: number } = {}): Promise<number> {
  const pendientes = db.prepare(`SELECT id, de, asunto, fecha, cuerpo FROM correos WHERE suyo = 0 AND ruido = 0 AND triado_en IS NULL AND fecha >= ? AND etiquetas LIKE '%INBOX%' ORDER BY fecha DESC LIMIT ?`)
    .all(Date.now() - 14 * 86_400_000, o.max ?? 36) as { id: string; de: string; asunto: string; fecha: number; cuerpo: string }[]
  if (!pendientes.length) return 0
  const quien = memoriaParaPrompt(db, 12)
  let n = 0
  for (let i = 0; i < pendientes.length; i += 12) {
    const tanda = pendientes.slice(i, i + 12)
    const usuario = `Lo que se sabe de él (para saber qué le importa):\n${quien}\n\nLos mails:\n${tanda.map((m) => `--- id: ${m.id}\nDe: ${m.de}\nAsunto: ${m.asunto}\nFecha: ${new Date(m.fecha).toISOString().slice(0, 16)}\n${sinCitas(m.cuerpo).slice(0, 1500)}`).join('\n\n')}`
    const { datos } = await enFondo(() => pedirJson<{ correos?: Partial<Triaje & { id: string }>[] }>({ db, clase: 'mastropiero', agenteId: 'correo' }, SISTEMA_TRIAJE, usuario, { temperatura: 0.2, maxTokens: 2500 }))
    const guardar = db.prepare('UPDATE correos SET triaje = ?, triado_en = ? WHERE id = ?')
    for (const c of datos.correos ?? []) {
      if (!c.id || !tanda.some((m) => m.id === c.id)) continue
      const t: Triaje = {
        pide_respuesta: !!c.pide_respuesta,
        urgencia: c.urgencia === 'alta' || c.urgencia === 'baja' ? c.urgencia : 'media',
        resumen: String(c.resumen ?? '').slice(0, 160),
        accion: c.accion === 'responder' || c.accion === 'nada' ? c.accion : 'leer',
      }
      guardar.run(JSON.stringify(t), Date.now(), c.id)
      n++
    }
  }
  return n
}

type Fila = { id: string; hilo: string; de: string; para: string; asunto: string; fecha: number; leido: number; suyo: number; extracto: string; triaje: string | null; atendido: number }
const vista = (r: Fila) => ({ id: r.id, hilo: r.hilo, de: r.de, para: r.para, asunto: r.asunto, fecha: r.fecha, leido: !!r.leido, suyo: !!r.suyo, extracto: r.extracto, triaje: json<Triaje>(r.triaje), atendido: !!r.atendido })

/** La bandeja, por filtro (o una búsqueda en vivo en Gmail), con cuántos hay en cada uno. */
export async function bandeja(db: Db, o: { filtro?: Filtro; q?: string; dias?: number; limite?: number } = {}) {
  const desde = Date.now() - (o.dias ?? 30) * 86_400_000
  const limite = Math.min(o.limite ?? 80, 200)
  const base = `FROM correos WHERE fecha >= ? AND ruido = 0`
  const cuantos = {
    responder: (db.prepare(`SELECT COUNT(*) AS n ${base} AND suyo = 0 AND atendido = 0 AND json_extract(triaje, '$.pide_respuesta') = 1`).get(desde) as { n: number }).n,
    no_leidos: (db.prepare(`SELECT COUNT(*) AS n ${base} AND suyo = 0 AND leido = 0 AND etiquetas LIKE '%INBOX%'`).get(desde) as { n: number }).n,
    sin_triar: (db.prepare(`SELECT COUNT(*) AS n ${base} AND suyo = 0 AND triado_en IS NULL AND etiquetas LIKE '%INBOX%'`).get(Math.max(desde, Date.now() - 14 * 86_400_000)) as { n: number }).n,
  }
  if (o.q?.trim()) {
    const r = await buscarMails(db, o.q.trim(), 25)
    return { cuantos, busqueda: true, correos: r.map((m) => ({ ...m, fecha: Date.parse(m.fecha), leido: true, suyo: false, triaje: null, atendido: false })) }
  }
  const filtro = o.filtro ?? 'responder'
  const donde = filtro === 'responder' ? `AND suyo = 0 AND atendido = 0 AND json_extract(triaje, '$.pide_respuesta') = 1`
    : filtro === 'no_leidos' ? `AND suyo = 0 AND leido = 0 AND etiquetas LIKE '%INBOX%'`
      : filtro === 'enviados' ? 'AND suyo = 1' : `AND suyo = 0 AND etiquetas LIKE '%INBOX%'`
  let filas = (db.prepare(`SELECT id, hilo, de, para, asunto, fecha, leido, suyo, extracto, triaje, atendido ${base} ${donde} ORDER BY fecha DESC LIMIT ?`).all(desde, limite) as Fila[]).map(vista)
  if (filtro === 'responder') filas = filas.sort((a, b) => ORDEN_URGENCIA[a.triaje?.urgencia ?? 'media'] - ORDEN_URGENCIA[b.triaje?.urgencia ?? 'media'] || b.fecha - a.fecha)
  return { cuantos, busqueda: false, correos: filas }
}

/** Un mail con su hilo (lo guardado del mismo hilo, en orden). */
export function hiloDe(db: Db, id: string) {
  const m = db.prepare('SELECT * FROM correos WHERE id = ?').get(id) as (Fila & { cuerpo: string }) | undefined
  if (!m) return null
  const otros = (db.prepare('SELECT id, de, para, fecha, suyo, cuerpo FROM correos WHERE hilo = ? AND id != ? ORDER BY fecha').all(m.hilo, id) as { id: string; de: string; para: string; fecha: number; suyo: number; cuerpo: string }[])
    .map((x) => ({ id: x.id, de: x.de, para: x.para, fecha: x.fecha, suyo: !!x.suyo, texto: sinCitas(x.cuerpo).slice(0, 4000) }))
  return { ...vista(m), cuerpo: m.cuerpo, hilo_previo: otros.filter((x) => x.fecha < m.fecha), hilo_despues: otros.filter((x) => x.fecha > m.fecha), link: `https://mail.google.com/mail/u/0/#all/${m.id}` }
}

const SISTEMA_RESPUESTA = `Escribís la respuesta a un mail EN NOMBRE del jugador y CON SU VOZ: como escribe él (mirá sus mails de muestra: largo, saludo, despedida, tuteo o no, tono). No suenes a asistente.
- Contestá lo que le piden; si falta un dato que solo él sabe, dejá un hueco claro entre corchetes: [qué falta].
- Si te da una indicación, seguila al pie de la letra.
- Solo el cuerpo del mail (sin asunto). Sin firma inventada: si él firma siempre igual en sus muestras, usá esa.
Forma: {"texto": string}`

/** Una respuesta propuesta en su voz (no se guarda en ningún lado hasta que él la pasa a borrador). */
export async function proponerRespuesta(db: Db, id: string, indicacion?: string | null): Promise<{ texto: string }> {
  const h = hiloDe(db, id)
  if (!h) throw new Error('No encuentro ese mail.')
  const direccion = /<([^>]+)>/.exec(h.de)?.[1] ?? h.de
  // Sus muestras: primero lo que le escribió a esta misma persona; si no alcanza, lo último que mandó.
  const muestras = [
    ...(db.prepare(`SELECT cuerpo FROM correos WHERE suyo = 1 AND para LIKE ? ORDER BY fecha DESC LIMIT 3`).all(`%${direccion}%`) as { cuerpo: string }[]),
    ...(db.prepare(`SELECT cuerpo FROM correos WHERE suyo = 1 ORDER BY fecha DESC LIMIT 5`).all() as { cuerpo: string }[]),
  ].map((x) => sinCitas(x.cuerpo).slice(0, 900)).filter((x, i, xs) => x.length > 20 && xs.indexOf(x) === i).slice(0, 5)
  const usuario = [
    `Lo que se sabe de él:\n${memoriaParaPrompt(db, 20)}`,
    muestras.length ? `Mails que escribió él (su voz):\n${muestras.map((m) => `---\n${m}`).join('\n')}` : 'Todavía no hay mails suyos de muestra: escribí corto, directo, castellano rioplatense.',
    h.hilo_previo.length ? `Lo anterior del hilo:\n${h.hilo_previo.slice(-3).map((x) => `De ${x.suyo ? 'él' : x.de}: ${x.texto.slice(0, 1200)}`).join('\n\n')}` : '',
    `El mail a contestar:\nDe: ${h.de}\nAsunto: ${h.asunto}\n${sinCitas(h.cuerpo).slice(0, 5000)}`,
    indicacion?.trim() ? `Su indicación: ${indicacion.trim()}` : '',
  ].filter(Boolean).join('\n\n')
  const { datos } = await pedirJson<{ texto?: string }>({ db, clase: 'mastropiero', agenteId: 'correo' }, SISTEMA_RESPUESTA, usuario, { temperatura: 0.6, maxTokens: 1500 })
  const texto = String(datos.texto ?? '').trim()
  if (!texto) throw new Error('No me salió una respuesta: probá con una indicación.')
  return { texto }
}

/** El borrador en Gmail (en el mismo hilo) y el mail sale de lo pendiente. */
export async function guardarBorrador(db: Db, id: string, texto: string) {
  const r = await crearBorrador(db, { responderA: id, cuerpo: texto })
  marcarAtendido(db, id, true)
  return r
}

export function marcarAtendido(db: Db, id: string, si: boolean) {
  db.prepare('UPDATE correos SET atendido = ? WHERE id = ?').run(si ? 1 : 0, id)
  return { ok: true }
}
