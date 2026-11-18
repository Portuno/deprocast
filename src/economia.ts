/**
 * Economía de agentes: cada agente tiene un monedero. Cobra por lo que le sirve al operador y paga lo que gasta (tokens)
 * y lo que rompe (fallos). Desde el plan v26 lo que más paga es el resultado: en una misión, cada pista que él no
 * descarta, cada borrador que manda (menos si lo tuvo que editar, y resta si lo descarta), cada respuesta, reunión y
 * cliente; su 👍/👎; y lo suyo que él sella alto en La Mano. Cumplir el formato de una tarea de ingesta paga poco: así
 * la selección (banca, quiebra, clon) elige agentes útiles, no prolijos. Las temporadas son semanales: al
 * cierre se liquida y la liga se arregla sola — los que dieron pérdida van a la banca (y si ya estaban y vuelven a
 * perder, se retiran), y el mejor de una clase con trabajo acumulado se clona. Ejecutivos y gerentes no entran:
 * son únicos.
 * La vara (nov 2026): lo que gasta se cobra en créditos de NaN (la plata de verdad; los tokens, solo donde no hay precio),
 * y cada pieza suya —que escribió o procesó— que Mastropiero te citó en una respuesta le paga: lo que usaste, no lo que hizo.
 */
import { type Db } from './db.ts'
import { alias, cambiarEstado, forjar, leer, listar, retirar, type Ficha } from './roster.ts'
import { semanaDe } from './misiones.ts'
import { CLASES, type ClaseId } from './clases.ts'

/** Lo que paga cada cosa. Los tokens se cobran por miles. */
export const TARIFAS = { tarea: 1, aporte: 15, fallo: -3, milTokens: -1, credito: -10 }
/** Lo que paga cada resultado de una misión (y su feedback). */
export const RESULTADOS = {
  pista: 2, borradorAceptado: 5, borradorEditado: 3, borradorRechazado: -2,
  enviada: 3, respondio: 10, reunion: 25, cliente: 100, pulgarArriba: 3, pulgarAbajo: -3, piezaUsada: 3,
} as const
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
  // Lo que gastó, en créditos (la plata de verdad); las llamadas sin precio (un modelo local, una fila vieja), por tokens.
  const gasto = db.prepare(`SELECT agente_id AS a, ROUND(SUM(COALESCE(creditos, 0)), 2) AS c, SUM(CASE WHEN creditos IS NULL THEN COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0) ELSE 0 END) AS t
    FROM llamadas WHERE en >= ? AND en < ? AND agente_id IS NOT NULL GROUP BY agente_id`).all(desde, hasta) as { a: string; c: number; t: number }[]
  const agentes = new Set((db.prepare('SELECT id FROM agentes').all() as any[]).map((r) => r.id))
  for (const r of gasto) {
    if (!agentes.has(r.a)) continue
    if (r.c > 0) out.push({ agente: r.a, monto: Math.round(r.c * TARIFAS.credito * 100) / 100, motivo: `${r.c} créditos` })
    if (r.t > 0) out.push({ agente: r.a, monto: Math.round((r.t / 1000) * TARIFAS.milTokens * 100) / 100, motivo: `${Math.round(r.t / 1000)}K tokens` })
  }
  out.push(...resultados(db, desde, hasta))
  return out.filter((l) => agentes.has(l.agente))
}

/** Lo que cobra cada agente por los resultados de sus misiones en la ventana (y por su feedback y La Mano). */
export function resultados(db: Db, desde: number, hasta: number): Linea[] {
  const out: Linea[] = []
  const suma = new Map<string, Map<string, { n: number; monto: number }>>()
  const sumar = (agente: string | null | undefined, que: string, monto: number) => {
    if (!agente) return
    const m = suma.get(agente) ?? new Map()
    const x = m.get(que) ?? { n: 0, monto: 0 }
    m.set(que, { n: x.n + 1, monto: x.monto + monto })
    suma.set(agente, m)
  }
  const agenteDePista = db.prepare('SELECT m.agente_id AS a FROM oportunidades o JOIN agente_misiones m ON m.id = o.agente_mision_id WHERE o.id = ?')
  // Pistas que él no descartó.
  for (const r of db.prepare(`SELECT m.agente_id AS a FROM oportunidades o JOIN agente_misiones m ON m.id = o.agente_mision_id WHERE o.creada_en >= ? AND o.creada_en < ? AND COALESCE(o.etapa, '') != 'descartada'`).all(desde, hasta) as { a: string }[]) sumar(r.a, 'pista', RESULTADOS.pista)
  // Sus borradores: mandados tal cual, editados o descartados.
  for (const r of db.prepare(`SELECT ref, accion FROM decisiones WHERE tipo = 'agente:borrador' AND en >= ? AND en < ?`).all(desde, hasta) as { ref: string; accion: string }[]) {
    const a = (agenteDePista.get(Number(r.ref)) as { a: string } | undefined)?.a
    if (r.accion === 'aceptada') sumar(a, 'borrador mandado', RESULTADOS.borradorAceptado)
    else if (r.accion === 'editada') sumar(a, 'borrador mandado con cambios', RESULTADOS.borradorEditado)
    else if (r.accion === 'rechazada') sumar(a, 'borrador descartado', RESULTADOS.borradorRechazado)
  }
  // Lo que pasó con sus pistas (la primera vez que cada una llega a cada etapa), según lo que él marcó.
  const etapas: Record<string, [string, number]> = { enviada: ['enviada', RESULTADOS.enviada], respondio: ['respuesta', RESULTADOS.respondio], reunion: ['reunión', RESULTADOS.reunion], cliente: ['cliente', RESULTADOS.cliente] }
  const marcas = db.prepare(`SELECT agente_id AS a, json_extract(refs, '$.pista') AS pista, json_extract(refs, '$.etapa') AS etapa, MIN(en) AS en FROM agente_diario
    WHERE tipo = 'resultado' AND json_extract(refs, '$.etapa') IS NOT NULL GROUP BY json_extract(refs, '$.pista'), json_extract(refs, '$.etapa')`).all() as { a: string; pista: number; etapa: string; en: number }[]
  for (const r of marcas) if (r.en >= desde && r.en < hasta && etapas[r.etapa]) sumar(r.a, etapas[r.etapa][0], etapas[r.etapa][1])
  // Su 👍/👎 (pistas y sesiones).
  for (const r of db.prepare(`SELECT ref, valor FROM devoluciones WHERE superficie = 'agentes' AND en >= ? AND en < ?`).all(desde, hasta) as { ref: string; valor: number }[]) {
    const [tipo, id] = r.ref.split(':')
    const a = tipo === 'pista' ? (agenteDePista.get(Number(id)) as { a: string } | undefined)?.a : tipo === 'diario' ? (db.prepare('SELECT agente_id AS a FROM agente_diario WHERE id = ?').get(Number(id)) as { a: string } | undefined)?.a : null
    if (r.valor > 0) sumar(a, '👍', RESULTADOS.pulgarArriba)
    else if (r.valor < 0) sumar(a, '👎', RESULTADOS.pulgarAbajo)
  }
  // Lo suyo que él selló alto en La Mano (7 o más paga lo que pasa del 6; 3 o menos resta uno).
  for (const r of db.prepare(`SELECT c.autor AS a, q.peso FROM quantomos q JOIN corpus c ON c.id = q.pieza_id WHERE q.etapa = 'sellado' AND q.actualizado_en >= ? AND q.actualizado_en < ? AND c.autor IS NOT NULL`).all(desde, hasta) as { a: string; peso: number }[]) {
    if (r.peso >= 7) sumar(r.a, 'sellado alto en La Mano', r.peso - 6)
    else if (r.peso <= 3) sumar(r.a, 'sellado bajo en La Mano', -1)
  }
  // Lo que usaste: cada pieza suya (la escribió o la procesó) que Mastropiero te citó en una respuesta, una vez por pieza.
  for (const [agente, piezas] of piezasUsadas(db, desde, hasta)) for (let i = 0; i < piezas.size; i++) sumar(agente, 'de sus piezas que Mastropiero usó con vos', RESULTADOS.piezaUsada)
  for (const [agente, m] of suma) for (const [que, x] of m) out.push({ agente, monto: x.monto, motivo: `${x.n} ${que}` })
  return out
}

/**
 * Las piezas que Mastropiero te citó ([#id]) en sus respuestas de la ventana, por agente: el que la escribió (autor) y
 * los que la procesaron (sus tareas hechas sobre esa pieza). Una pieza cuenta una vez por agente.
 */
export function piezasUsadas(db: Db, desde: number, hasta: number): Map<string, Set<number>> {
  db.exec('CREATE INDEX IF NOT EXISTS ix_tareas_corpus ON tareas(corpus_id, estado)')
  const ids = new Set<number>()
  for (const r of db.prepare(`SELECT texto FROM mensajes WHERE rol = 'asistente' AND en >= ? AND en < ? AND texto LIKE '%[#%'`).all(desde, hasta) as { texto: string }[]) {
    for (const m of r.texto.matchAll(/\[#(\d+)\]/g)) ids.add(Number(m[1]))
  }
  const out = new Map<string, Set<number>>()
  const sumar = (a: string | null, p: number) => { if (!a) return; const s = out.get(a) ?? new Set<number>(); s.add(p); out.set(a, s) }
  const autor = db.prepare('SELECT autor FROM corpus WHERE id = ?')
  const procesaron = db.prepare(`SELECT DISTINCT asignada_a AS a FROM tareas WHERE corpus_id = ? AND estado = 'hecha' AND asignada_a IS NOT NULL`)
  for (const p of ids) {
    sumar((autor.get(p) as { autor: string | null } | undefined)?.autor ?? null, p)
    for (const r of procesaron.all(p) as { a: string }[]) sumar(r.a, p)
  }
  return out
}

export type Rinde = { agente: string; nombre: string; clase: string; estado: string; creditos: number; tareas: number; fallos: number; usadas: number; valor: number; porCredito: number | null; veredicto: 'rinde' | 'rinde poco' | 'caro sin resultados' | 'sin gasto' }

/**
 * Lo que rinde cada agente en los últimos días: lo que gastó (créditos), lo que hizo (tareas), lo que usaste (piezas
 * citadas) y lo que valió para vos (resultados: pistas, borradores, respuestas, clientes, 👍, sellos altos, piezas
 * usadas), y cuánto valor da por crédito. Ordenado por lo que gasta: arriba, lo que más conviene mirar.
 */
export function rendimiento(db: Db, dias = 30, ahora = Date.now()): Rinde[] {
  const desde = ahora - dias * 86_400_000
  const gasto = new Map((db.prepare(`SELECT agente_id AS a, ROUND(SUM(COALESCE(creditos, 0)), 2) AS c FROM llamadas WHERE en >= ? AND agente_id IS NOT NULL GROUP BY agente_id`).all(desde) as { a: string; c: number }[]).map((r) => [r.a, r.c]))
  const hechas = new Map((db.prepare(`SELECT asignada_a AS a, SUM(estado = 'hecha') AS h, SUM(estado = 'fallida') AS f FROM tareas WHERE asignada_a IS NOT NULL AND actualizada_en >= ? GROUP BY asignada_a`).all(desde) as { a: string; h: number; f: number }[]).map((r) => [r.a, r]))
  const valor = new Map<string, number>()
  for (const l of resultados(db, desde, ahora + 1)) valor.set(l.agente, (valor.get(l.agente) ?? 0) + l.monto)
  const usadas = piezasUsadas(db, desde, ahora + 1)
  return listar(db).filter((f) => !FUERA.has(f.clase)).map((f): Rinde => {
    const creditos = gasto.get(f.id) ?? 0
    const v = Math.round((valor.get(f.id) ?? 0) * 100) / 100
    const porCredito = creditos > 0 ? Math.round((v / creditos) * 100) / 100 : null
    const veredicto = creditos < 0.5 ? 'sin gasto' : v <= 0 ? 'caro sin resultados' : (porCredito ?? 0) < 1 ? 'rinde poco' : 'rinde'
    return { agente: f.id, nombre: alias(f), clase: f.clase, estado: f.estado, creditos, tareas: hechas.get(f.id)?.h ?? 0, fallos: hechas.get(f.id)?.f ?? 0, usadas: usadas.get(f.id)?.size ?? 0, valor: v, porCredito, veredicto }
  }).sort((a, b) => b.creditos - a.creditos || b.valor - a.valor)
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
