/**
 * Economía de agentes: cada agente tiene un monedero. Cobra por lo que entrega (más por un aporte a una primaria que
 * por una tarea de ingesta) y paga lo que gasta (tokens) y lo que rompe (fallos). Las temporadas son semanales: al
 * cierre se liquida y la liga se arregla sola — los que dieron pérdida van a la banca (y si ya estaban y vuelven a
 * perder, se retiran), y el mejor de una clase con trabajo acumulado se clona. Ejecutivos y gerentes no entran:
 * son únicos.
 */
import { type Db } from './db.ts'
import { alias, cambiarEstado, forjar, leer, listar, retirar, type Ficha } from './roster.ts'
import { semanaDe } from './misiones.ts'
import { CLASES, type ClaseId } from './clases.ts'

/** Lo que paga cada cosa. Los tokens se cobran por miles. */
export const TARIFAS = { tarea: 5, aporte: 15, fallo: -3, milTokens: -1 }
const FUERA = new Set(['ejecutivo', 'gerente'])
const TIPOS_APORTE = new Set(['aporte', 'preparar-run'])

/** Lunes 00:00 (local) de la semana ISO que se le pase, y el lunes siguiente. */
export function ventana(semana: string): [number, number] {
  const [a, w] = semana.split('-W').map(Number)
  const ene4 = new Date(a, 0, 4)
  const lunes1 = new Date(a, 0, 4 - ((ene4.getDay() + 6) % 7))
  const desde = new Date(lunes1.getFullYear(), lunes1.getMonth(), lunes1.getDate() + (w - 1) * 7).getTime()
  return [desde, desde + 7 * 86_400_000]
}

type Linea = { agente: string; monto: number; motivo: string }

/** Lo que ganó y gastó cada agente en la temporada, calculado de lo que pasó (tareas y llamadas). */
export function balance(db: Db, semana: string): Linea[] {
  const [desde, hasta] = ventana(semana)
  const out: Linea[] = []
  const hechas = db.prepare(`SELECT asignada_a AS a, tipo, COUNT(*) AS n FROM tareas WHERE estado = 'hecha' AND asignada_a IS NOT NULL AND actualizada_en >= ? AND actualizada_en < ? GROUP BY asignada_a, tipo`).all(desde, hasta) as any[]
  for (const r of hechas) {
    const aporte = TIPOS_APORTE.has(r.tipo)
    out.push({ agente: r.a, monto: r.n * (aporte ? TARIFAS.aporte : TARIFAS.tarea), motivo: `${r.n} ${aporte ? 'aporte' : 'tarea'}${r.n > 1 ? 's' : ''} (${r.tipo})` })
  }
  const fallas = db.prepare(`SELECT asignada_a AS a, COUNT(*) AS n FROM tareas WHERE estado = 'fallida' AND asignada_a IS NOT NULL AND actualizada_en >= ? AND actualizada_en < ? GROUP BY asignada_a`).all(desde, hasta) as any[]
  for (const r of fallas) out.push({ agente: r.a, monto: r.n * TARIFAS.fallo, motivo: `${r.n} fallo${r.n > 1 ? 's' : ''}` })
  const gasto = db.prepare(`SELECT agente_id AS a, SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)) AS t FROM llamadas WHERE en >= ? AND en < ? AND agente_id IS NOT NULL GROUP BY agente_id`).all(desde, hasta) as any[]
  const agentes = new Set((db.prepare('SELECT id FROM agentes').all() as any[]).map((r) => r.id))
  for (const r of gasto) if (agentes.has(r.a) && r.t > 0) out.push({ agente: r.a, monto: Math.round((r.t / 1000) * TARIFAS.milTokens * 100) / 100, motivo: `${Math.round(r.t / 1000)}K tokens` })
  return out.filter((l) => agentes.has(l.agente))
}

/** Asienta la temporada en el monedero (rehacerla la reemplaza: es idempotente). */
export function liquidar(db: Db, semana: string, ahora = Date.now()): Linea[] {
  const ls = balance(db, semana)
  db.prepare('DELETE FROM monedero WHERE temporada = ?').run(semana)
  const ins = db.prepare('INSERT INTO monedero (agente_id, monto, motivo, temporada, en) VALUES (?, ?, ?, ?, ?)')
  for (const l of ls) ins.run(l.agente, l.monto, l.motivo, semana, ahora)
  return ls
}

export function saldo(db: Db, agente: string): number {
  return Math.round(((db.prepare('SELECT SUM(monto) AS s FROM monedero WHERE agente_id = ?').get(agente) as any).s ?? 0) * 100) / 100
}

/** La tabla de la temporada: lo de esta semana (en vivo, sin asentar) y el saldo histórico. */
export function tabla(db: Db, semana = semanaDe()): { agente: string; nombre: string; clase: string; estado: string; temporada: number; saldo: number; detalle: string[] }[] {
  const ls = balance(db, semana)
  return listar(db).filter((f) => !FUERA.has(f.clase)).map((f) => {
    const mias = ls.filter((l) => l.agente === f.id)
    const asentado = (db.prepare('SELECT SUM(monto) AS s FROM monedero WHERE agente_id = ? AND temporada != ?').get(f.id, semana) as any).s ?? 0
    const temporada = Math.round(mias.reduce((s, l) => s + l.monto, 0) * 100) / 100
    return { agente: f.id, nombre: alias(f), clase: f.clase, estado: f.estado, temporada, saldo: Math.round((asentado + temporada) * 100) / 100, detalle: mias.map((l) => `${l.monto > 0 ? '+' : ''}${l.monto} ${l.motivo}`) }
  }).sort((a, b) => b.temporada - a.temporada || b.saldo - a.saldo)
}

/**
 * Cierre de temporada: liquida y aplica las consecuencias. Solo actúa si hubo liga esa semana (alguien cobró algo).
 * - Pérdida y activo → a la banca. Pérdida y ya en banca desde antes → se retira («quebró»).
 * - El mejor (con ganancia) de una clase que tiene trabajo esperando (≥ 20 pendientes) → se clona con su receta.
 */
export function cerrarTemporada(db: Db, semana: string, ahora = Date.now()): { liquidadas: number; banca: string[]; retirados: string[]; clones: string[]; texto: string | null } {
  const ls = liquidar(db, semana, ahora)
  const r = { liquidadas: ls.length, banca: [] as string[], retirados: [] as string[], clones: [] as string[], texto: null as string | null }
  // Sin liga esa semana, o ya cerrada antes: solo se asienta, sin consecuencias (nadie va dos veces a la banca ni se clona doble).
  if (!ls.some((l) => l.monto > 0) || db.prepare('SELECT 1 FROM temporadas WHERE semana = ? LIMIT 1').get(semana)) return r
  const porAgente = new Map<string, number>()
  for (const l of ls) porAgente.set(l.agente, (porAgente.get(l.agente) ?? 0) + l.monto)
  const yaEnBanca = new Set((db.prepare(`SELECT agente_id FROM temporadas WHERE semana < ? AND estado_al_cierre = 'banca'`).all(semana) as any[]).map((x) => x.agente_id))
  for (const f of listar(db).filter((x) => !FUERA.has(x.clase))) {
    const neto = porAgente.get(f.id) ?? 0
    if (neto >= 0 || f.estado === 'prueba') continue
    if (f.estado === 'banca' && yaEnBanca.has(f.id)) {
      retirar(db, f.id, `quebró: dos temporadas con pérdida (${neto})`, ahora)
      r.retirados.push(alias(f))
    } else if (f.estado === 'activo') {
      cambiarEstado(db, f.id, 'banca')
      r.banca.push(alias(f))
    }
  }
  const pendientesPorClase = new Map((db.prepare(`SELECT clase, COUNT(*) AS n FROM tareas WHERE estado = 'pendiente' GROUP BY clase`).all() as any[]).map((x) => [x.clase, x.n]))
  const mejores = new Map<string, Ficha>()
  for (const [id, neto] of [...porAgente].sort((a, b) => b[1] - a[1])) {
    const f = leer(db, id)
    if (!f || FUERA.has(f.clase) || neto <= 0 || f.estado !== 'activo' || mejores.has(f.clase)) continue
    mejores.set(f.clase, f)
  }
  for (const [clase, f] of mejores) {
    if ((pendientesPorClase.get(clase) ?? 0) < 20) continue
    // La misma receta: los puntos que tenía por encima de la base de su clase.
    const base = CLASES[f.clase as ClaseId].base as Record<string, number>
    const reparto = Object.fromEntries(Object.entries(f.atributos).map(([k, v]) => [k, Math.max(0, Number(v) - (base[k] ?? 0))]))
    const hijo = forjar(db, { clase: f.clase, motor: f.motor, reparto, instrucciones: f.instrucciones, proyectoId: f.proyectoId, creador: 'economia', misionPrincipal: `Heredero de ${alias(f)}: producir como él`, ahora })
    r.clones.push(`${alias(f)} → ${hijo.id}`)
  }
  const ins = db.prepare('INSERT OR REPLACE INTO temporadas (semana, agente_id, neto, estado_al_cierre, en) VALUES (?, ?, ?, ?, ?)')
  for (const f of listar(db)) if (!FUERA.has(f.clase)) ins.run(semana, f.id, Math.round((porAgente.get(f.id) ?? 0) * 100) / 100, f.estado, ahora)
  const top = [...porAgente].sort((a, b) => b[1] - a[1])[0]
  const partes = [
    top ? `Ganó ${alias(leer(db, top[0]) ?? { id: top[0], nombre: null })} (${top[1] > 0 ? '+' : ''}${Math.round(top[1])})` : '',
    r.banca.length ? `a la banca: ${r.banca.join(', ')}` : '',
    r.retirados.length ? `quebraron: ${r.retirados.join(', ')}` : '',
    r.clones.length ? `clonados: ${r.clones.join(', ')}` : '',
  ].filter(Boolean)
  r.texto = `Temporada ${semana} cerrada. ${partes.join(' · ')}.`
  db.prepare('INSERT INTO cronica (tick, tipo, texto, en) VALUES (?, ?, ?, ?)').run((db.prepare('SELECT COALESCE(MAX(tick), 0) AS t FROM cronica').get() as any).t, 'temporada', r.texto, ahora)
  return r
}
