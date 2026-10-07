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

export type Alerta = { clave: string; texto: string }

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
  const propias = listarMisiones(db, { personaje: 'jugador', estados: ['activa'] }).filter((m) => m.vence && m.vence <= fechaMas(ahora, 2))
  for (const m of propias) {
    if (loVieneHablando(charla, m.titulo)) continue
    const cuando = m.vence! < hoy ? `venció el ${m.vence}` : m.vence === hoy ? 'vence hoy' : 'vence mañana'
    out.push({ clave: `vence:${m.id}:${hoy}`, texto: `Ojo: «${m.titulo}» ${cuando} y no lo venimos hablando. ¿Lo encaramos, lo corremos de fecha o lo soltamos?` })
  }
  for (const m of seguimientos(db, ahora)) {
    let quien = m.personaje
    try { quien = personaje(db, m.personaje).nombre } catch { /* se fue */ }
    out.push({ clave: `debe:${m.id}:${hoy}`, texto: `${quien} te debía «${m.titulo}» (vencía el ${m.vence}). ¿Le escribís, o lo doy por perdido?` })
  }
  return out.filter((a) => !db.prepare('SELECT 1 FROM alertas WHERE clave = ?').get(a.clave))
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
  for (const a of alertasPendientes(db, ahora)) {
    alta.run(a.clave, a.texto, ahora)
    dichos.push(a.texto)
  }
  const cada = Number(ajuste(db, 'pensar_cada_horas') ?? 3)
  const ultima = Number(ajuste(db, 'pensar_ultima') ?? 0)
  if (o.conModelo !== false && cada > 0 && ahora - ultima >= cada * 3_600_000) {
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
