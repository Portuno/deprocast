/**
 * La jornada: el día del operador en bloques cortos, armado por Mastropiero con lo que sabe de él
 * (memoria), lo que hablaron, su calendario y cómo le fue ayer. Los eventos del calendario son fijos;
 * los bloques se validan (sin solapes, dentro de la ventana, minutos permitidos) antes de guardarse.
 */
import { ajuste, fechaLocal, json, type Db } from './db.ts'
import { agendaDelDia, type Evento } from './calendario.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { pedirJson } from './modelo.ts'
import { estadoLiga } from './mastropiero.ts'

export type EstadoBloque = 'pendiente' | 'hecho' | 'saltado' | 'fijo'
export type Bloque = {
  id: string
  inicio: string
  fin: string
  minutos: number
  titulo: string
  por_que: string | null
  proyecto: string | null
  estado: EstadoBloque
}
export type Jornada = {
  fecha: string
  estado: 'en_curso' | 'cerrada'
  bloques: Bloque[]
  resumen: string | null
  cierre: string | null
  pidioCierre: boolean
  modelo: string | null
  actualizadaEn: number
}

const deFila = (r: any): Jornada => ({
  fecha: r.fecha, estado: r.estado, bloques: json(r.bloques, []), resumen: r.resumen, cierre: r.cierre,
  pidioCierre: r.pidio_cierre === 1, modelo: r.modelo, actualizadaEn: r.actualizada_en,
})

export function leerJornada(db: Db, fecha: string): Jornada | null {
  const r = db.prepare('SELECT * FROM jornadas WHERE fecha = ?').get(fecha)
  return r ? deFila(r) : null
}

// ─── horas ──────────────────────────────────────────────────────────────

export const aMin = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return NaN
  return Number(m[1]) * 60 + Number(m[2])
}
export const aHora = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const horaDe = (ms: number) => {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

export function minutosPermitidos(db: Db): number[] {
  const v = (ajuste(db, 'bloques_minutos') ?? '12,25,50').split(',').map(Number).filter((n) => n > 0 && n <= 240)
  return v.length ? v : [12, 25, 50]
}

/**
 * Pasa los bloques que propuso el modelo por las reglas: horas válidas, minutos permitidos (se ajusta al más cercano),
 * dentro de la ventana, sin pisar lo ocupado ni entre sí. Lo que no entra se descarta.
 */
export function validarBloques(
  crudos: { inicio?: unknown; minutos?: unknown; titulo?: unknown; por_que?: unknown; proyecto?: unknown }[],
  reglas: { inicio: number; fin: number; minutos: number[]; ocupado: [number, number][] },
): Bloque[] {
  const ocupado = [...reglas.ocupado]
  const choca = (a: number, b: number) => ocupado.some(([x, y]) => a < y && x < b)
  const out: Bloque[] = []
  const ordenados = crudos
    .map((c) => ({ c, ini: aMin(String(c.inicio ?? '')) }))
    .filter((x) => Number.isFinite(x.ini))
    .sort((x, y) => x.ini - y.ini)
  for (const { c, ini } of ordenados) {
    const titulo = typeof c.titulo === 'string' ? c.titulo.trim() : ''
    if (!titulo) continue
    const pedido = Number(c.minutos)
    const minutos = reglas.minutos.reduce((m, x) => (Math.abs(x - pedido) < Math.abs(m - pedido) ? x : m), reglas.minutos[0])
    const fin = ini + minutos
    if (ini < reglas.inicio || fin > reglas.fin || choca(ini, fin)) continue
    ocupado.push([ini, fin])
    out.push({
      id: `b${ini}`, inicio: aHora(ini), fin: aHora(fin), minutos, titulo: titulo.slice(0, 160),
      por_que: typeof c.por_que === 'string' && c.por_que.trim() ? c.por_que.trim().slice(0, 300) : null,
      proyecto: typeof c.proyecto === 'string' && c.proyecto.trim() ? c.proyecto.trim().slice(0, 80) : null,
      estado: 'pendiente',
    })
  }
  return out
}

function eventosComoBloques(eventos: Evento[]): Bloque[] {
  return eventos.filter((e) => !e.todoElDia).map((e) => {
    const ini = horaDe(e.inicio)
    const fin = Math.max(ini + 5, Math.min(24 * 60 - 1, horaDe(e.fin) || 24 * 60 - 1))
    return { id: `e${ini}-${e.titulo.slice(0, 12)}`, inicio: aHora(ini), fin: aHora(fin), minutos: fin - ini, titulo: e.titulo, por_que: e.lugar, proyecto: null, estado: 'fijo' as const }
  })
}

// ─── contexto ───────────────────────────────────────────────────────────

function ayer(fecha: string) {
  const [a, m, d] = fecha.split('-').map(Number)
  return fechaLocal(new Date(a, m - 1, d - 1).getTime())
}

function contexto(db: Db, fecha: string, eventos: Evento[], conservados: Bloque[], desde: string, ahora: number): string {
  const ay = leerJornada(db, ayer(fecha))
  const charla = (db.prepare(
    `SELECT m.texto, m.en FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
     WHERE m.rol = 'operador' AND c.con = 'mastropiero' AND m.en > ? ORDER BY m.id DESC LIMIT 30`,
  ).all(ahora - 36 * 3_600_000) as { texto: string; en: number }[]).reverse()
  const liga = estadoLiga(db)
  const memoria = memoriaParaPrompt(db, 50)
  return [
    `Fecha: ${fecha} (${new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}). Armá desde las ${desde}.`,
    `\nLo que sabés de él (memoria):\n${memoria || '- (todavía casi nada: armá un día corto y decíselo en el resumen)'}`,
    `\nSu calendario de ese día (fijo, no lo pises):\n${eventos.length ? eventos.map((e) => `- ${e.todoElDia ? 'todo el día' : `${aHora(horaDe(e.inicio))}–${aHora(horaDe(e.fin))}`}: ${e.titulo}${e.lugar ? ` (${e.lugar})` : ''}`).join('\n') : '- nada agendado'}`,
    conservados.length ? `\nYa hecho o en marcha hoy (no lo repitas):\n${conservados.map((b) => `- ${b.inicio} ${b.titulo} [${b.estado}]`).join('\n')}` : '',
    ay ? `\nAyer:\n${ay.bloques.filter((b) => b.estado !== 'fijo').map((b) => `- ${b.titulo} [${b.estado}]`).join('\n') || '- sin bloques'}${ay.cierre ? `\nSu cierre de ayer: ${ay.cierre}` : ''}` : '',
    charla.length ? `\nLo que te dijo en las últimas horas:\n${charla.map((c) => `- ${c.texto.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')}` : '',
    liga.proyectos.length ? `\nProyectos que tiene en la plataforma: ${liga.proyectos.map((p: any) => p.nombre).join(', ')}.` : '',
  ].filter(Boolean).join('\n')
}

const SISTEMA = (minutos: number[], inicio: string, fin: string) => `Sos Mastropiero y armás la jornada del operador: su día en bloques concretos.
Reglas:
- Bloques de ${minutos.join(', ')} minutos. Si su memoria dice cómo le gusta trabajar (por ejemplo, series de cierto largo), respetalo.
- Entre las ${inicio} y las ${fin}. No pises su calendario. Dejá respiros cortos entre series; incluí comidas y descanso si corresponde.
- Cada bloque es una acción concreta que se puede empezar ya («Escribir el mail a…», «Revisar la escena 7»), no un tema. Variá proyectos según sus metas; priorizá lo que lo acerca a ellas y lo que quedó colgado ayer.
- Solo usá lo que está en su memoria, su calendario y lo que te dijo. No inventes proyectos, personas ni tareas que no aparezcan ahí. Si sabés poco de él, mejor pocos bloques y buenos que un día lleno de relleno.
- No metas tareas sobre la plataforma misma (revisar el bus, los agentes, el corpus) salvo que él lo haya pedido.
- «por_que»: una frase corta que conecte el bloque con algo suyo (una meta, algo que dijo, algo pendiente). En castellano rioplatense, cálido.
- «resumen»: dos o tres oraciones, como si le hablaras: el sentido del día, sin listar los bloques.
Forma: {"resumen": string, "bloques": [{"inicio": "HH:MM", "minutos": number, "titulo": string, "por_que": string, "proyecto": string | null}]}`

/** Arma (o rehace desde una hora) la jornada de una fecha. */
export async function armarJornada(db: Db, fecha: string, o: { desde?: string; ahora?: number } = {}): Promise<{ jornada: Jornada; avisos: string[] }> {
  const ahora = o.ahora ?? Date.now()
  const inicioVentana = aMin(ajuste(db, 'jornada_inicio') ?? '09:00')
  const finVentana = aMin(ajuste(db, 'jornada_fin') ?? '23:00')
  // Para hoy, sin hora pedida, se arma desde ahora: no tiene sentido llenar horas que ya pasaron.
  const ahoraMin = fecha === fechaLocal(ahora) ? Math.ceil((new Date(ahora).getHours() * 60 + new Date(ahora).getMinutes()) / 5) * 5 : 0
  const desde = Math.max(inicioVentana, o.desde ? aMin(o.desde) : ahoraMin)
  const previa = leerJornada(db, fecha)
  const conservados = (previa?.bloques ?? []).filter((b) => b.estado !== 'fijo' && (aMin(b.inicio) < desde || b.estado === 'hecho' || b.estado === 'saltado'))
  const { eventos, avisos } = await agendaDelDia(fecha)
  const fijos = eventosComoBloques(eventos)
  const minutos = minutosPermitidos(db)
  const { datos, modelo } = await pedirJson<{ resumen?: string; bloques?: any[] }>(
    { db, clase: 'mastropiero', agenteId: 'jornada' },
    SISTEMA(minutos, aHora(desde), aHora(finVentana)),
    contexto(db, fecha, eventos, conservados, aHora(desde), ahora),
    { temperatura: 0.6, maxTokens: 6000 },
  )
  const nuevos = validarBloques(datos.bloques ?? [], {
    inicio: desde, fin: finVentana, minutos,
    ocupado: [...fijos, ...conservados].map((b) => [aMin(b.inicio), aMin(b.fin)] as [number, number]),
  })
  if (!nuevos.length && !conservados.length) throw new Error('El modelo no propuso ningún bloque que entre en el día')
  const bloques = [...conservados, ...fijos, ...nuevos].sort((a, b) => aMin(a.inicio) - aMin(b.inicio))
  const resumen = typeof datos.resumen === 'string' ? datos.resumen.trim() : previa?.resumen ?? null
  db.prepare(
    `INSERT INTO jornadas (fecha, estado, bloques, resumen, modelo, creada_en, actualizada_en) VALUES (?, 'en_curso', ?, ?, ?, ?, ?)
     ON CONFLICT(fecha) DO UPDATE SET bloques = excluded.bloques, resumen = excluded.resumen, modelo = excluded.modelo, actualizada_en = excluded.actualizada_en`,
  ).run(fecha, JSON.stringify(bloques), resumen, modelo, ahora, ahora)
  return { jornada: leerJornada(db, fecha)!, avisos }
}

export function marcarBloque(db: Db, fecha: string, id: string, estado: EstadoBloque, ahora = Date.now()): Jornada {
  const j = leerJornada(db, fecha)
  if (!j) throw new Error(`No hay jornada para ${fecha}`)
  if (!['pendiente', 'hecho', 'saltado'].includes(estado)) throw new Error('Estado de bloque inválido')
  const b = j.bloques.find((x) => x.id === id)
  if (!b) throw new Error(`No hay un bloque ${id} ese día`)
  if (b.estado === 'fijo') throw new Error('Los eventos del calendario no se marcan')
  b.estado = estado
  db.prepare('UPDATE jornadas SET bloques = ?, actualizada_en = ? WHERE fecha = ?').run(JSON.stringify(j.bloques), ahora, fecha)
  return leerJornada(db, fecha)!
}

export function progreso(j: Jornada | null) {
  const propios = (j?.bloques ?? []).filter((b) => b.estado !== 'fijo')
  return { hechos: propios.filter((b) => b.estado === 'hecho').length, saltados: propios.filter((b) => b.estado === 'saltado').length, total: propios.length }
}

/** Bloques hechos por día en los últimos n días. */
export function semana(db: Db, hasta: string, n = 7) {
  const [a, m, d] = hasta.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const f = fechaLocal(new Date(a, m - 1, d - (n - 1 - i)).getTime())
    return { fecha: f, ...progreso(leerJornada(db, f)) }
  })
}

/** El texto con el que Mastropiero abre el cierre del día. Sin modelo: sale de los bloques. */
export function textoDeCierre(db: Db, fecha: string): string {
  const j = leerJornada(db, fecha)
  if (!j) return 'Cerramos el día. ¿Cómo te fue? Contame lo que quieras; con eso armo mañana.'
  const p = progreso(j)
  const hechos = j.bloques.filter((b) => b.estado === 'hecho').slice(0, 3).map((b) => b.titulo.toLowerCase())
  db.prepare('UPDATE jornadas SET pidio_cierre = 1 WHERE fecha = ?').run(fecha)
  return [
    `Cerramos el día. ${p.total ? `Hiciste ${p.hechos} de ${p.total} bloques${hechos.length ? `: ${hechos.join(', ')}` : ''}.` : ''}`,
    '¿Cómo te fue? Contame lo que quieras, lo que salió, lo que no y lo que te quedó dando vueltas; con eso armo mañana.',
  ].join(' ').trim()
}

/** Guarda la respuesta del operador al cierre y da el día por cerrado. */
export function registrarCierre(db: Db, fecha: string, texto: string, ahora = Date.now()) {
  db.prepare(`UPDATE jornadas SET cierre = ?, estado = 'cerrada', actualizada_en = ? WHERE fecha = ?`).run(texto.trim(), ahora, fecha)
}
