/**
 * Encargos programados (plan v35, fase 7): el reemplazo de los agentes ejecutivos de Grok. «Cada lunes a las 9 revisá
 * qué salió sobre X y mandame un informe»: Mastropiero lo hace solo, con todas sus herramientas (la web, su corpus, su
 * correo, su Drive), y el informe llega a Hoy (y de ahí a Telegram o WhatsApp) y, si lo pide, a su Drive
 * (Mastropiero/Informes).
 *
 * Cada encargo tiene su propia conversación (archivada): así recuerda lo que informó las veces anteriores y puede
 * comparar («qué cambió desde la semana pasada»).
 */
import { fechaLocal, type Db } from './db.ts'

export type Cuando = { tipo: 'horas'; cada: number } | { tipo: 'diario'; hora: string } | { tipo: 'semanal'; dias: number[]; hora: string } | { tipo: 'mensual'; dia: number; hora: string }
export type Programado = {
  id: number; titulo: string; pedido: string; cuando: Cuando; cuandoTexto: string; drive: boolean; activo: boolean
  proximo: number | null; ultimo: number | null; resultado: string | null; error: string | null; conversacionId: number | null; creado: number
}

const DIAS: Record<string, number> = { domingo: 0, domingos: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, sabados: 6 }
const NOMBRE_DIA = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados']
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** La hora de un texto («a las 8», «8:30», «20 hs», «9 de la noche», «8 am»); si no dice, las 9. */
function horaDe(t: string): string {
  const m = /a las? (\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|hs|h|horas|de la manana|de la tarde|de la noche)?/.exec(t)
    ?? /\b(\d{1,2})[:.](\d{2})\s*(am|pm|hs|h|horas|de la manana|de la tarde|de la noche)?/.exec(t)
    ?? /\b(\d{1,2})()\s*(am|pm|hs|de la manana|de la tarde|de la noche)\b/.exec(t)
  if (!m) return '09:00'
  let h = Number(m[1])
  const min = Number(m[2] || 0)
  const suf = m[3] ?? ''
  if ((suf === 'pm' || suf === 'de la tarde' || suf === 'de la noche') && h < 12) h += 12
  if (suf === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) throw new Error(`No entiendo esa hora: «${m[0].trim()}».`)
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** Cuándo, en castellano: «todos los días a las 8», «los lunes y jueves 9:30», «de lunes a viernes a las 8», «cada 6 horas», «el 1 de cada mes». */
export function interpretarCuando(texto: string): Cuando {
  const t = norm(texto)
  const horas = /cada (\d+) ?(horas|hs|h)\b/.exec(t)
  if (horas) { const cada = Number(horas[1]); if (cada < 1 || cada > 168) throw new Error('Cada cuántas horas: entre 1 y 168.'); return { tipo: 'horas', cada } }
  if (/\bcada hora\b/.test(t)) return { tipo: 'horas', cada: 1 }
  const mes = /(?:el )?(\d{1,2}) de cada mes|mensual(?:mente)?(?: el (\d{1,2}))?|cada mes(?: el (\d{1,2}))?/.exec(t)
  if (mes) { const dia = Number(mes[1] ?? mes[2] ?? mes[3] ?? 1); if (dia < 1 || dia > 28) throw new Error('El día del mes: entre 1 y 28 (así existe en todos los meses).'); return { tipo: 'mensual', dia, hora: horaDe(t) } }
  if (/de lunes a viernes|dias habiles|dias de semana|entre semana/.test(t)) return { tipo: 'semanal', dias: [1, 2, 3, 4, 5], hora: horaDe(t) }
  if (/fines? de semana/.test(t)) return { tipo: 'semanal', dias: [6, 0], hora: horaDe(t) }
  const dias = [...new Set([...t.matchAll(/\b(domingos?|lunes|martes|miercoles|jueves|viernes|sabados?)\b/g)].map((m) => DIAS[m[1]]))]
  if (dias.length) return { tipo: 'semanal', dias: dias.sort(), hora: horaDe(t) }
  if (/todos los dias|cada dia|diario|diariamente|cada manana|todas las mananas|cada noche|todas las noches|a diario/.test(t)) {
    const hora = /noche/.test(t) && !/\d/.test(t) ? '21:00' : horaDe(t)
    return { tipo: 'diario', hora }
  }
  if (/semanal|cada semana|una vez por semana/.test(t)) return { tipo: 'semanal', dias: [1], hora: horaDe(t) }
  throw new Error('No entendí cuándo. Probá con «todos los días a las 8», «los lunes a las 9», «de lunes a viernes a las 8:30», «cada 6 horas» o «el 1 de cada mes».')
}

export function describirCuando(c: Cuando): string {
  if (c.tipo === 'horas') return c.cada === 1 ? 'cada hora' : `cada ${c.cada} horas`
  if (c.tipo === 'diario') return `todos los días a las ${c.hora}`
  if (c.tipo === 'mensual') return `el ${c.dia} de cada mes a las ${c.hora}`
  const d = c.dias.join() === '1,2,3,4,5' ? 'de lunes a viernes' : c.dias.join() === '0,6' ? 'los fines de semana' : `los ${c.dias.map((x) => NOMBRE_DIA[x]).join(', ').replace(/, ([^,]+)$/, ' y $1')}`
  return `${d} a las ${c.hora}`
}

/** La próxima vez después de `desde` (en su hora). */
export function proximoDe(c: Cuando, desde: number): number {
  if (c.tipo === 'horas') return desde + c.cada * 3_600_000
  const [h, m] = c.hora.split(':').map(Number)
  for (let i = 0; i <= 62; i++) {
    const d = new Date(desde)
    d.setDate(d.getDate() + i)
    d.setHours(h, m, 0, 0)
    if (d.getTime() <= desde) continue
    if (c.tipo === 'diario') return d.getTime()
    if (c.tipo === 'semanal' && c.dias.includes(d.getDay())) return d.getTime()
    if (c.tipo === 'mensual' && d.getDate() === c.dia) return d.getTime()
  }
  throw new Error('No encuentro la próxima vez')
}

const deFila = (r: any): Programado => ({
  id: r.id, titulo: r.titulo, pedido: r.pedido, cuando: JSON.parse(r.cuando), cuandoTexto: describirCuando(JSON.parse(r.cuando)), drive: !!r.drive, activo: !!r.activo,
  proximo: r.proximo, ultimo: r.ultimo, resultado: r.resultado, error: r.error, conversacionId: r.conversacion_id, creado: r.creado,
})

export function listarProgramados(db: Db): Programado[] {
  return (db.prepare('SELECT * FROM programados ORDER BY activo DESC, proximo').all() as any[]).map(deFila)
}
export function leerProgramado(db: Db, id: number): Programado | null {
  const r = db.prepare('SELECT * FROM programados WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

export function crearProgramado(db: Db, d: { titulo?: string; pedido: string; cuando: string; drive?: boolean }, ahora = Date.now()): Programado {
  const pedido = d.pedido?.trim()
  if (!pedido || pedido.length < 8) throw new Error('¿Qué tiene que hacer? Escribilo como se lo pedirías.')
  const cuando = interpretarCuando(d.cuando)
  const titulo = (d.titulo?.trim() || pedido.split(/[.\n]/)[0]).slice(0, 80)
  const r = db.prepare('INSERT INTO programados (titulo, pedido, cuando, drive, activo, proximo, creado) VALUES (?, ?, ?, ?, 1, ?, ?)').run(titulo, pedido.slice(0, 4000), JSON.stringify(cuando), d.drive ? 1 : 0, proximoDe(cuando, ahora), ahora)
  return leerProgramado(db, Number(r.lastInsertRowid))!
}

export function cambiarProgramado(db: Db, id: number, c: { titulo?: string; pedido?: string; cuando?: string; drive?: boolean; activo?: boolean }, ahora = Date.now()): Programado {
  const p = leerProgramado(db, id)
  if (!p) throw new Error(`No existe el encargo programado ${id}`)
  const cuando = c.cuando ? interpretarCuando(c.cuando) : p.cuando
  const activo = c.activo ?? p.activo
  db.prepare('UPDATE programados SET titulo = ?, pedido = ?, cuando = ?, drive = ?, activo = ?, proximo = ? WHERE id = ?').run(
    (c.titulo?.trim() || p.titulo).slice(0, 80), (c.pedido?.trim() || p.pedido).slice(0, 4000), JSON.stringify(cuando), (c.drive ?? p.drive) ? 1 : 0, activo ? 1 : 0,
    activo ? (c.cuando || (c.activo && !p.activo) ? proximoDe(cuando, ahora) : p.proximo ?? proximoDe(cuando, ahora)) : null, id)
  return leerProgramado(db, id)!
}

export function borrarProgramado(db: Db, id: number) {
  db.prepare('DELETE FROM programados WHERE id = ?').run(id)
  return { ok: true }
}

const INSTRUCCION = `Esto es un ENCARGO PROGRAMADO: él te lo dejó para que lo hagas solo, a esta hora, sin estar presente.
- Hacelo completo con tus herramientas (la web, su corpus, su correo, su Drive, lo que haga falta). No le preguntes nada: decidí con criterio.
- Devolvé un informe claro y accionable: lo importante primero, con las fuentes (links o [#id]). Si en esta misma conversación ya informaste antes, decí qué cambió desde la última vez.
- Si no encontraste nada nuevo o relevante, decilo en una línea.
- Nada irreversible: no publiques, no envíes ni borres nada (un borrador de mail sí, si sirve).`

let corriendo = false

/** Corre un encargo ahora: su conversación, el informe, y adónde va. */
export async function correrProgramado(db: Db, id: number, ahora = Date.now()): Promise<Programado> {
  const p = leerProgramado(db, id)
  if (!p) throw new Error(`No existe el encargo programado ${id}`)
  const chat = await import('./chat/index.ts')
  let cid = p.conversacionId && chat.leerConversacion(db, p.conversacionId) ? p.conversacionId : null
  if (!cid) {
    cid = chat.crearConversacion(db, 'mastropiero', 'chat', ahora).id
    db.prepare('UPDATE conversaciones SET titulo = ?, archivada = 1 WHERE id = ?').run(`⏰ ${p.titulo}`, cid)
    db.prepare('UPDATE programados SET conversacion_id = ? WHERE id = ?').run(cid, id)
  }
  const desde = (db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM mensajes WHERE conversacion_id = ?').get(cid) as { n: number }).n
  const proximo = p.activo ? proximoDe(p.cuando, ahora) : null
  try {
    await chat.enviar(db, cid, `${p.pedido}\n\n(Encargo programado «${p.titulo}», ${p.cuandoTexto}. Hoy: ${fechaLocal(ahora)}.)`, { via: 'encargo', extra: INSTRUCCION })
    const r = db.prepare(`SELECT rol, texto FROM mensajes WHERE conversacion_id = ? AND id > ? AND rol IN ('asistente', 'error') AND texto IS NOT NULL ORDER BY id`).all(cid, desde) as { rol: string; texto: string }[]
    const error = r.find((x) => x.rol === 'error')?.texto ?? null
    const informe = r.filter((x) => x.rol === 'asistente').map((x) => x.texto).join('\n\n').trim()
    if (!informe) throw new Error(error ?? 'No devolvió informe')
    db.prepare('UPDATE programados SET ultimo = ?, resultado = ?, error = NULL, proximo = ? WHERE id = ?').run(ahora, informe.slice(0, 20_000), proximo, id)
    // A Hoy (y de ahí a Telegram o WhatsApp) y, si lo pidió, a su Drive.
    chat.mensajeDeMastropiero(db, chat.conversacionHoy(db).id, `⏰ ${p.titulo}\n\n${informe}`)
    if (p.drive) {
      try { await (await import('./google/drive.ts')).guardarDocumento(db, `${fechaLocal(ahora)} · ${p.titulo}`, informe, 'Informes') } catch (e) { console.error('  programados → drive:', e instanceof Error ? e.message : e) }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    db.prepare('UPDATE programados SET ultimo = ?, error = ?, proximo = ? WHERE id = ?').run(ahora, msg.slice(0, 500), proximo, id)
    throw e
  }
  return leerProgramado(db, id)!
}

/** Cada minuto: los que tocan (de a uno, en orden). Con el tope de lo que corre solo alcanzado, esperan. */
export async function latidoProgramados(db: Db, ahora = Date.now()): Promise<number> {
  if (corriendo) return 0
  corriendo = true
  let n = 0
  try {
    const { topeAlcanzado } = await import('./nan.ts')
    const toca = db.prepare('SELECT id FROM programados WHERE activo = 1 AND proximo IS NOT NULL AND proximo <= ? ORDER BY proximo LIMIT 3').all(ahora) as { id: number }[]
    for (const { id } of toca) {
      if (topeAlcanzado(db, ahora)) break
      try { await (await import('./nan.ts')).enFondo(() => correrProgramado(db, id, ahora)); n++ } catch (e) { console.error(`  programado ${id}:`, e instanceof Error ? e.message : e) }
    }
  } finally { corriendo = false }
  return n
}
