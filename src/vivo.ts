/**
 * El Directo en vivo, para Hoy: qué está haciendo ahora, cuánto lleva en eso contra su meta de bloque, cuánto estímulo
 * va hoy, qué banda de la run toca, los últimos momentos (para la franja y las líneas en el chat) y lo que espera su ok.
 * Sin modelo: todo sale de lo que ya registró el Directo.
 */
import { fechaLocal, type Db } from './db.ts'
import { propuestasDe, sesionActiva, type Momento } from './directo.ts'
import { appsEstimulo, focoDelDia, metaDeBloque } from './foco.ts'
import { enCurso } from './misiones.ts'

const MIN = 60_000
const norm = (s: string | null) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

export type EstadoVivo = {
  sesion: { id: number; inicio: number; fuentes: string[] }
  actual: { app: string | null; actividad: string | null; tema: string | null; detalle: string | null; desde: number } | null
  /** Cuánto lleva en lo mismo (misma app y tema, sin cortes de más de 3 minutos), en minutos. */
  bloque: number
  meta: number | null
  estimuloHoy: number
  /** Lo de ahora es una app de alto estímulo. */
  enEstimulo: boolean
  banda: { titulo: string; restan: number | null; siguiente: string | null } | null
  momentos: { id: number; tipo: string; desde: number; app: string | null; actividad: string | null; tema: string | null; texto: string | null }[]
  pendientes: number
  /** Lo que cuesta: tokens por hora del Directo (mirar y escribir los tramos) y lo del copiloto hoy. */
  costo: { directoPorHora: number; copilotoHoy: number }
}

function costo(db: Db, inicio: number, ahora: number): EstadoVivo['costo'] {
  const t = (sql: string, ...xs: number[]) => (db.prepare(`SELECT COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0) AS t FROM llamadas WHERE ${sql}`).get(...xs) as { t: number }).t
  const d = new Date(ahora)
  const hoy = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const horas = Math.max(0.25, (ahora - inicio) / 3_600_000)
  return { directoPorHora: Math.round(t(`agente_id = 'directo' AND en >= ?`, inicio) / horas), copilotoHoy: t(`agente_id = 'copiloto' AND en >= ?`, hoy) }
}

export function estadoVivo(db: Db, ahora = Date.now()): EstadoVivo | null {
  const s = sesionActiva(db)
  if (!s) return null
  const ms = (db.prepare('SELECT * FROM directo_momentos WHERE sesion_id = ? ORDER BY desde DESC, id DESC LIMIT 80').all(s.id) as any[]).reverse()
  const pantalla = ms.filter((m) => m.tipo === 'pantalla')
  const ultimo = pantalla.at(-1) ?? null
  // El bloque de ahora: hacia atrás mientras siga la misma app y el mismo tema, sin cortes de más de 3 minutos.
  let desde = ultimo?.desde ?? ahora
  if (ultimo) {
    const clave = `${norm(ultimo.app)}|${norm(ultimo.tema)}`
    for (let i = pantalla.length - 2; i >= 0; i--) {
      const m = pantalla[i]
      if (`${norm(m.app)}|${norm(m.tema)}` !== clave || pantalla[i + 1].desde - m.hasta > 3 * MIN) break
      desde = m.desde
    }
  }
  const estimulo = appsEstimulo(db)
  const vivo = enCurso(db, ahora)
  return {
    sesion: { id: s.id, inicio: s.inicio, fuentes: s.fuentes },
    actual: ultimo ? { app: ultimo.app, actividad: ultimo.actividad, tema: ultimo.tema, detalle: ultimo.detalle, desde } : null,
    bloque: ultimo ? Math.max(0, Math.round((Math.max(ultimo.hasta, Math.min(ahora, ultimo.hasta + MIN)) - desde) / MIN)) : 0,
    meta: metaDeBloque(db, ahora),
    estimuloHoy: focoDelDia(db, fechaLocal(ahora), estimulo).estimulo,
    enEstimulo: !!ultimo && estimulo.some((e) => `${norm(ultimo.app)} ${norm(ultimo.detalle)}`.includes(e)),
    banda: vivo?.actual ? { titulo: vivo.actual.titulo, restan: vivo.restan, siguiente: vivo.siguientes[0]?.titulo ?? null } : vivo ? { titulo: 'Entre bandas', restan: null, siguiente: vivo.siguientes[0]?.titulo ?? null } : null,
    momentos: ms.slice(-40).map((m: Momento & any) => ({ id: m.id, tipo: m.tipo, desde: m.desde, app: m.app, actividad: m.actividad, tema: m.tema, texto: m.texto ? String(m.texto).slice(0, 200) : null })),
    pendientes: propuestasDe(s).filter((p) => p.estado === 'pendiente').length,
    costo: costo(db, s.inicio, ahora),
  }
}

/** Para el prompt de Mastropiero con el Directo prendido: lo de los últimos 15 minutos, el bloque y la run (sin modelo). */
export function vivoParaPrompt(db: Db, ahora = Date.now()): string {
  const v = estadoVivo(db, ahora)
  if (!v) return ''
  const recientes = v.momentos.filter((m) => m.desde >= ahora - 15 * MIN)
  const hora = (t: number) => new Date(t).toTimeString().slice(0, 5)
  return [
    `En vivo (el Directo está prendido desde las ${hora(v.sesion.inicio)}):`,
    v.actual ? `- Ahora: ${[v.actual.app, v.actual.actividad, v.actual.tema].filter(Boolean).join(' · ')}, hace ${v.bloque} min seguidos${v.meta ? ` (su meta de bloque es ${v.meta} min)` : ''}${v.enEstimulo ? '; es una app de alto estímulo' : ''}.` : '',
    v.estimuloHoy ? `- Hoy lleva ${v.estimuloHoy} min en apps de alto estímulo.` : '',
    v.banda ? `- Su run: ${v.banda.titulo}${v.banda.restan != null ? ` (le quedan ${v.banda.restan} min)` : ''}${v.banda.siguiente ? `; después, «${v.banda.siguiente}»` : ''}.` : '- No está en una run.',
    recientes.length ? `- Los últimos 15 minutos:\n${recientes.map((m) => `  ${hora(m.desde)} ${m.tipo === 'voz' ? `dijo: «${m.texto ?? ''}»` : m.tipo === 'medio' ? `escuchó: ${m.texto?.slice(0, 120) ?? ''}` : [m.app, m.actividad, m.tema].filter(Boolean).join(' · ')}`).join('\n')}` : '',
    v.pendientes ? `- Esperan su ok ${v.pendientes} cosas que vio el Directo (tareas, personas, conexiones).` : '',
  ].filter(Boolean).join('\n')
}
