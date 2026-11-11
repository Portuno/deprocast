/**
 * Mastropiero proactivo: alertas (vencimientos de cosas de las que no viene hablando, lo que otros le deben) y,
 * cada tantas horas, una reflexión que deja UNA sugerencia o nada. Nunca interrumpe en una reunión (un evento del
 * calendario en curso): lo guarda para después. Cada alerta llega una sola vez por día.
 */
import { ajuste, fechaLocal, fijarAjuste, type Db } from './db.ts'
import { agendaDelDia } from './calendario.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { pedirJson } from './modelo.ts'
import { charlaReciente, conAvance, enCurso, listarMisiones, misionesParaPrompt, seguimientos, semanaDe } from './misiones.ts'
import { directoParaPrompt } from './directo.ts'
import { personaje } from './personajes.ts'
import { oportunidadesQueCierran } from './radar.ts'
import { aContactar } from './personas.ts'
import { alertasSalud } from './salud.ts'

/** marcas: claves que se anotan junto con esta (los ítems de un bloque, para contar cuántas veces se avisó cada uno). */
export type Alerta = { clave: string; texto: string; marcas?: string[] }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
const VACIAS = new Set(['para', 'con', 'los', 'las', 'del', 'que', 'una', 'uno', 'por', 'sobre', 'hacer', 'mandar', 'escribir', 'cerrar'])

/** ¿Viene hablando de esto? Si en lo que dijo estos días aparecen las palabras fuertes del título. */
function loVieneHablando(charla: string, titulo: string): boolean {
  const palabras = norm(titulo).split(' ').filter((w) => w.length >= 4 && !VACIAS.has(w))
  if (!palabras.length) return false
  const hits = palabras.filter((w) => charla.includes(w)).length
  return hits / palabras.length >= 0.5
}

const fechaMas = (ahora: number, dias: number) => fechaLocal(ahora + dias * 86_400_000)

/** Las alertas de ahora (sin modelo). */
export function alertasPendientes(db: Db, ahora = Date.now()): Alerta[] {
  const hoy = fechaLocal(ahora)
  const charla = norm(charlaReciente(db, ahora, 72, 200).join(' '))
  const out: Alerta[] = []
  out.push(...alertaDeVencidos(db, charla, ahora))
  for (const m of seguimientos(db, ahora)) {
    let quien = m.personaje
    try { quien = personaje(db, m.personaje).nombre } catch { /* se fue */ }
    out.push({ clave: `debe:${m.id}:${hoy}`, texto: `${quien} te debía «${m.titulo}» (vencía el ${m.vence}). ¿Le escribís, o lo doy por perdido?` })
  }
  for (const o of oportunidadesQueCierran(db, ahora)) {
    out.push({ clave: `cierra:${o.id}:${hoy}`, texto: `«${o.titulo}» cierra el ${o.cierre}. ${o.borrador ? 'Ya tenés el borrador listo en Radar.' : '¿Te armo el borrador?'}` })
  }
  // Solo las que él pidió ver cada tanto (cada_dias); una por semana como mucho.
  for (const p of aContactar(db, ahora).slice(0, 1)) {
    out.push({ clave: `persona:${p.id}:${semanaDe(ahora)}`, texto: `Hace ${p.diasSinContacto ?? 'mucho'} días que no sabés de ${p.nombre}${p.cadaDias ? ` (querías cada ${p.cadaDias})` : ''}.${p.proxima ? ` Tenías pendiente: ${p.proxima}.` : ' ¿Le escribís?'}` })
  }
  out.push(...alertasSalud(db, ahora))
  return out.filter((a) => !db.prepare('SELECT 1 FROM alertas WHERE clave = ?').get(a.clave))
}

/**
 * Los vencidos (plan v34): UN bloque al día, agrupado por proyecto, en vez de un aviso por tarea. Fuera quedan:
 * - lo que viene hablando;
 * - lo de un proyecto en pausa (la entidad con meta.estado «pausa» o meta.pausado);
 * - lo que ya se le avisó 3 veces sin que lo tocara (silencio hasta que lo mueva).
 */
export const AVISOS_SIN_RESPUESTA = 3
export function alertaDeVencidos(db: Db, charla: string, ahora = Date.now()): Alerta[] {
  const hoy = fechaLocal(ahora)
  if (db.prepare('SELECT 1 FROM alertas WHERE clave = ?').get(`vencidos:${hoy}`)) return []
  const enPausa = (entidadId: number | null) => {
    if (!entidadId) return false
    const e = db.prepare('SELECT meta FROM entidades WHERE id = ?').get(entidadId) as { meta: string | null } | undefined
    try { const m = JSON.parse(e?.meta ?? 'null'); return !!m && (m.pausado === true || /^(en )?pausa(do|da)?$/i.test(String(m.estado ?? ''))) } catch { return false }
  }
  const avisos = db.prepare(`SELECT COUNT(*) AS n FROM alertas WHERE clave LIKE ?`)
  const items = listarMisiones(db, { personaje: 'jugador', estados: ['activa'] })
    .filter((m) => m.vence && m.vence <= fechaMas(ahora, 2))
    .filter((m) => !loVieneHablando(charla, m.titulo) && !enPausa(m.entidadId))
    .filter((m) => (avisos.get(`vence:${m.id}:%`) as { n: number }).n < AVISOS_SIN_RESPUESTA)
  if (!items.length) return []
  const cuando = (v: string) => (v < hoy ? `venció el ${v}` : v === hoy ? 'vence hoy' : 'vence mañana')
  // Cada ítem queda anotado (para contar cuántas veces se le avisó), pero sale un solo mensaje.
  const marcas = items.map((m) => `vence:${m.id}:${hoy}`)
  if (items.length === 1) {
    const m = items[0]
    return [{ clave: `vencidos:${hoy}`, texto: `Ojo: «${m.titulo}» ${cuando(m.vence!)} y no lo venimos hablando. ¿Lo encaramos, lo corremos de fecha o lo soltamos?`, marcas }]
  }
  const nombre = new Map<number, string>()
  for (const m of items) if (m.entidadId && !nombre.has(m.entidadId)) nombre.set(m.entidadId, (db.prepare('SELECT nombre FROM entidades WHERE id = ?').get(m.entidadId) as { nombre: string } | undefined)?.nombre ?? 'Sin proyecto')
  const grupos = new Map<string, typeof items>()
  for (const m of items) { const g = m.entidadId ? nombre.get(m.entidadId)! : 'Sin proyecto'; grupos.set(g, [...(grupos.get(g) ?? []), m]) }
  const lineas = [...grupos].sort((a, b) => b[1].length - a[1].length).map(([g, ms]) => `${g}:\n${ms.map((m) => `- «${m.titulo}» (${cuando(m.vence!)})`).join('\n')}`)
  return [{ clave: `vencidos:${hoy}`, texto: `Tenés ${items.length} cosas vencidas o por vencer que no venimos hablando:\n\n${lineas.join('\n\n')}\n\nDecime con cuáles seguimos, cuáles corremos de fecha y cuáles soltamos (sirve «soltá todo lo de X»).`, marcas }]
}

/**
 * ¿Está charlando ahora? Lo último que escribió es de hace menos de 20 minutos, o hay un pedido suyo esperando respuesta
 * (sin contestar, o el turno se cortó con un error) de las últimas tres horas. Los avisos esperan a que termine: un
 * aviso de primarias o de vencidas después de un pedido que no se contestó parecía la respuesta a otro tema (Fragua #237).
 */
export function charlando(db: Db, ahora: number): boolean {
  const u = db.prepare(`SELECT MAX(en) AS en FROM mensajes WHERE rol = 'operador'`).get() as { en: number | null }
  if (u.en && ahora - u.en < 20 * 60_000) return true
  return pedidoSinContestar(db, ahora, 3 * 3_600_000)
}

/** Un pedido suyo de hace menos de `ventana` que todavía no tuvo una respuesta de verdad (no un aviso de rutina, no un error). */
export function pedidoSinContestar(db: Db, ahora: number, ventana: number): boolean {
  const u = db.prepare(`SELECT MAX(en) AS en FROM mensajes WHERE rol = 'operador'`).get() as { en: number | null }
  if (!u.en || ahora - u.en > ventana) return false
  const respondida = db.prepare(`SELECT 1 FROM mensajes m WHERE m.rol = 'asistente' AND m.en >= ? AND TRIM(COALESCE(m.texto, '')) != '' AND COALESCE(m.modelo, '') != 'rutina' LIMIT 1`).get(u.en)
  return !respondida
}

/** ¿Está en una reunión? Un evento del calendario (no de día entero) en curso. */
export async function enReunion(ahora = Date.now()): Promise<string | null> {
  try {
    const { eventos } = await agendaDelDia(fechaLocal(ahora))
    const e = eventos.find((x) => !x.todoElDia && x.inicio <= ahora && ahora < x.fin)
    return e?.titulo ?? null
  } catch {
    return null
  }
}

const SISTEMA_PENSAR = `Sos Mastropiero y, sin que nadie te hable, mirás cómo viene el día del jugador para decidir si vale decirle algo AHORA.
- Decí UNA sola cosa, concreta y accionable, con opinión propia: una sugerencia que él no esté viendo, una conexión entre cosas, un empujón para lo que se trabó, o una pregunta que destrabe. Nada de recordatorios obvios ni de repetir lo que ya sabe.
- Si no hay nada que valga la pena, no digas nada: {"decir": false}. Mejor callar que hacer ruido.
- Tené en cuenta su energía por la hora (según su memoria) y lo que está haciendo ahora.
- Una a tres oraciones, castellano rioplatense, cálido y directo. Sin listas.
Forma: {"decir": boolean, "texto": string}`

/** Una reflexión: una sugerencia o nada. */
export async function reflexionar(db: Db, ahora = Date.now()): Promise<string | null> {
  const primarias = conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] }))
  const vivo = enCurso(db, ahora)
  const dichos = (db.prepare(`SELECT m.texto FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id WHERE c.modo = 'hoy' AND m.modelo = 'rutina' AND m.en > ? ORDER BY m.id DESC LIMIT 5`).all(ahora - 12 * 3_600_000) as { texto: string }[]).map((x) => x.texto)
  const usuario = [
    `Ahora: ${new Date(ahora).toLocaleString('es-AR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}.`,
    misionesParaPrompt(db, ahora),
    primarias.length ? `Avance de sus primarias: ${primarias.map((p) => `${p.titulo} ${p.avance.progreso}% (${p.avance.bandas.hechas} bandas)`).join(' · ')}` : '',
    vivo ? `Está en una run: ${vivo.actual ? `ahora «${vivo.actual.titulo}»` : 'entre bandas'}.` : 'No está en una run.',
    directoParaPrompt(db),
    `Lo que te dijo en las últimas horas:\n${charlaReciente(db, ahora, 12, 15).map((c) => `- ${c}`).join('\n') || '- nada'}`,
    dichos.length ? `Lo que ya le dijiste solo hoy (no repitas):\n${dichos.map((d) => `- ${d.slice(0, 200)}`).join('\n')}` : '',
    `Lo que sabés de él:\n${memoriaParaPrompt(db, 40)}`,
  ].filter(Boolean).join('\n')
  const { datos } = await pedirJson<{ decir?: boolean; texto?: string }>({ db, clase: 'mastropiero', agenteId: 'pensar' }, SISTEMA_PENSAR, usuario, { temperatura: 0.7, maxTokens: 800 })
  return datos.decir && typeof datos.texto === 'string' && datos.texto.trim() ? datos.texto.trim() : null
}

/**
 * El latido proactivo: alertas (si hay) y, cada `pensar_cada_horas`, una reflexión; dentro de la jornada y nunca
 * en una reunión. Devuelve lo que hay que dejar en Hoy.
 */
export async function pensar(db: Db, ahora = Date.now(), o: { conModelo?: boolean } = {}): Promise<string[]> {
  const d = new Date(ahora)
  const min = d.getHours() * 60 + d.getMinutes()
  const [hi, mi] = (ajuste(db, 'jornada_inicio') ?? '09:00').split(':').map(Number)
  const [hf, mf] = (ajuste(db, 'jornada_fin') ?? '23:00').split(':').map(Number)
  if (min < hi * 60 + mi || min > hf * 60 + mf) return []
  if (await enReunion(ahora)) return []
  const dichos: string[] = []
  const alta = db.prepare('INSERT OR IGNORE INTO alertas (clave, texto, en) VALUES (?, ?, ?)')
  // Nunca en medio de una charla: los avisos esperan a que haga una pausa.
  if (!charlando(db, ahora)) {
    for (const a of alertasPendientes(db, ahora)) {
      alta.run(a.clave, a.texto, ahora)
      for (const k of a.marcas ?? []) alta.run(k, '', ahora)
      dichos.push(a.texto)
    }
  }
  const cada = Number(ajuste(db, 'pensar_cada_horas') ?? 3)
  const ultima = Number(ajuste(db, 'pensar_ultima') ?? 0)
  // La reflexión tampoco interrumpe una charla ni un pedido sin contestar.
  if (o.conModelo !== false && cada > 0 && ahora - ultima >= cada * 3_600_000 && !charlando(db, ahora)) {
    fijarAjuste(db, 'pensar_ultima', String(ahora))
    try {
      const r = await reflexionar(db, ahora)
      if (r) dichos.push(r)
    } catch (e) {
      console.error('  pensar:', e instanceof Error ? e.message : e)
    }
  }
  return dichos
}
