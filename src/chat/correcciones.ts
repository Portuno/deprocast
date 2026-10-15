/**
 * Lo que él corrige manda. Cuando un mensaje suyo suena a corrección («es a las 16», «voy de oyente», «¿de dónde sacaste
 * eso?»), se lee junto con lo último que se dijo y se anota como hecho: queda arriba del prompt de toda la charla, antes
 * que las tareas o la memoria; si vale para siempre, también va a la memoria como corrección (la de mayor prioridad).
 * Además, al final de cada turno se mira si Mastropiero dijo que anotó o arregló algo sin haber guardado nada.
 */
import type { Db } from '../db.ts'
import { pedirJson } from '../modelo.ts'
import { recordar } from '../memoria.ts'

/** ¿Suena a que lo está corrigiendo? Barato: decide si vale la pena una llamada al modelo. */
export const pareceCorreccion = (t: string): boolean =>
  /\b(no es|no son|no era|no fue|no tengo|no voy|no estoy|no trabajo|es a las|son las|empieza a las|corrijo|eso no|en realidad|no es m[ií]o|no es m[ií]a|voy de oyente|ya pas[oó]|nunca dije|no dije)\b/i.test(t)
  || /\b(correcci|te equivoc|est[aá]s? mal|de d[oó]nde (lo )?(sac|sal))/i.test(t)
  || /^\s*no[,.!\s]/i.test(t)

const SISTEMA = `Sos el que anota las correcciones del operador a Mastropiero. Te paso lo último de la charla y el mensaje nuevo del operador.
Si el mensaje corrige algo (un dato, una hora, un rol, una fecha, algo que Mastropiero afirmó sin fuente), anotalo como HECHO CORRECTO, en una oración autocontenida en tercera persona, con fechas concretas (YYYY-MM-DD o día y mes) y sin referencias como «mañana» o «eso». Ejemplos: «La charla del 15/10 sobre IA jurídica es a las 16:00 y él va de oyente, no la da.» · «No hay ningún dato de una reunión con Varona el 16/10: la tarea del 4/10 hablaba del viernes 9/10.»
«duradera»: true si vale más allá de esta charla (su horario, dónde vive, qué rol tiene), false si es de este día o esta charla.
Si el mensaje no corrige nada, la lista va vacía.
Forma: {"correcciones": [{"texto": string, "duradera": boolean}]}`

let extraer = async (db: Db, usuario: string) => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'correcciones' }, SISTEMA, usuario, { temperatura: 0.1, maxTokens: 800 })).datos
export function _probarCorrecciones(f: typeof extraer) {
  extraer = f
}

/** Lee la corrección con su contexto y la anota. Devuelve lo anotado (vacío si no corregía nada). */
export async function registrarCorreccion(db: Db, cid: number, texto: string, ahora = Date.now()): Promise<string[]> {
  const ultimos = (db.prepare(`SELECT rol, texto FROM mensajes WHERE conversacion_id = ? AND rol IN ('operador', 'asistente') AND texto IS NOT NULL ORDER BY id DESC LIMIT 7`).all(cid) as { rol: string; texto: string }[])
    .reverse().map((m) => `${m.rol === 'operador' ? 'Operador' : 'Mastropiero'}: ${m.texto.replace(/\s+/g, ' ').slice(0, 1200)}`)
  const d = await extraer(db, `Hoy: ${new Date(ahora).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.\n\nLo último de la charla:\n${ultimos.join('\n')}\n\nMensaje nuevo del operador:\n${texto.slice(0, 2000)}`)
  const out: string[] = []
  for (const c of (Array.isArray(d?.correcciones) ? d.correcciones : []).slice(0, 3)) {
    const t = String(c?.texto ?? '').trim().slice(0, 400)
    if (t.length < 8) continue
    db.prepare('INSERT INTO correcciones (conversacion_id, texto, duradera, en) VALUES (?, ?, ?, ?)').run(cid, t, c?.duradera ? 1 : 0, ahora)
    if (c?.duradera) try { recordar(db, { texto: t, tipo: 'correccion', creadaPor: 'operador', revisada: true }, ahora) } catch { /* vacío */ }
    out.push(t)
  }
  return out
}

/** Las correcciones de esta charla, para arriba del prompt. */
export function correccionesParaPrompt(db: Db, cid: number | null | undefined): string {
  if (!cid) return ''
  const cs = (db.prepare('SELECT texto FROM correcciones WHERE conversacion_id = ? ORDER BY id').all(cid) as { texto: string }[]).map((c) => c.texto)
  return cs.length ? `Correcciones que te hizo en esta charla. Son hechos y mandan sobre todo lo demás (tareas, memoria, tu lectura); no vuelvas a afirmar lo contrario:\n${cs.map((c) => `- ${c}`).join('\n')}` : ''
}

/** ¿Dijo que anotó, guardó, corrigió o arregló algo? */
export const afirmaAccion = (texto: string) =>
  // (sin \b: en JavaScript la «é» de «anoté» no cuenta como letra y el borde fallaría)
  /(?<![a-záéíóúñ])(anoté|lo anoto|queda anotad[oa]|dej[ée] anotad[oa]|registré|guardé|corregí|arreglé|actualicé|cambié|fijé|agendé|lo dejo (bien )?puest[oa]|hicimos reci[ée]n|ya qued[oó])(?![a-záéíóúñ])/i.test(texto)
