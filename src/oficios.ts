/**
 * Los oficios nuevos entran al plantel como arquetipos (Fragua #323). Antes, un oficio pedido («que alguien revise lo
 * visual») era un generativo ad hoc: entraba en prueba, trabajaba una misión y a los tres fallos se retiraba; el
 * filtro se rearmaba de cero cada vez. Ahora:
 * - «crear oficio» abre una celda de la Matriz con los campos de la ficha (oficio, elemento del Gnosis, qué maneja, un
 *   ejemplo) y la instrucción de oficio, y deja el nombre propio pendiente (lo elige él, como manda el plantel);
 * - todo oficio nuevo (del chat o de la pantalla) entra primero como propuesta en Para validar, con la celda sugerida:
 *   él la acepta o la mueve; nunca se nombra solo;
 * - un generativo que ya cumplió su misión (pasó la prueba: tres éxitos) puede ascender a ese arquetipo: conserva lo
 *   aprendido, pasa a su celda (con su página, su corrida y su tienda) con la instrucción del oficio, y deja de ser
 *   descartable (no se purga por no correr).
 * Hay plantillas (genéricas) para los tres filtros que más se piden —lo visual, la experiencia, la gamificación—, que
 * nacen con la instrucción de revisar piezas de Deprocast y devolver hallazgos numerados con su criterio de aprobación.
 */
import type { Db } from './db.ts'
import { asegurarFichas, ELEMENTOS, esOficio, fichaDe, fijarFicha, type Elemento } from './arquetipos.ts'
import { alias, leer } from './roster.ts'

/** Cómo devuelve su revisión cualquier oficio que revisa piezas: hallazgos numerados, cada uno con su criterio. */
export const FORMATO_REVISION = 'Revisás una pieza de Deprocast (una pantalla, un flujo, un texto, una función) desde tu oficio. Devolvés hallazgos numerados; cada uno con: qué viste (concreto, con dónde), por qué importa, qué cambiar, y el criterio de aprobación (cómo se comprueba que quedó bien). Al final, tu veredicto: aprobada, aprobada con cambios, o no aprobada, y qué falta para aprobarla.'

export const PLANTILLAS_OFICIO: Record<string, { oficio: string; elemento: Elemento; maneja: string; ejemplo: string; instruccion: string }> = {
  visual: {
    oficio: 'Diseñador visual', elemento: 'onda',
    maneja: 'La forma de lo que se ve: jerarquía, tipografía, color, espaciado y consistencia entre pantallas.',
    ejemplo: 'En una vista nueva marca que tres botones de la misma acción tienen pesos distintos y pide unificarlos.',
    instruccion: `Sos el diseñador visual del plantel: mirás lo estético y lo legible (jerarquía, tipografía, color, contraste, espaciado, alineación, consistencia con el resto). ${FORMATO_REVISION}`,
  },
  experiencia: {
    oficio: 'Investigador de experiencia', elemento: 'campo',
    maneja: 'El recorrido de quien usa: si se entiende qué hacer, cuántos pasos lleva y dónde se traba alguien que no lo conoce.',
    ejemplo: 'Recorre un flujo como si fuera la primera vez y cuenta dónde no supo qué tocar y por qué.',
    instruccion: `Sos el investigador de experiencia del plantel: recorrés cada pieza como alguien que la usa por primera vez (qué se entiende, qué no, cuántos pasos, qué espera que pase y qué pasa, qué pasa en el celular, con el teclado, sin datos). ${FORMATO_REVISION}`,
  },
  gamificacion: {
    oficio: 'Diseñador de juegos', elemento: 'tiempo-espacio',
    maneja: 'La motivación: progreso, recompensas y ritmo, siempre atados a algo hecho de verdad (nada de rachas vacías).',
    ejemplo: 'En una función con puntos señala uno que se gana sin hacer nada y propone a qué hecho real atarlo.',
    instruccion: `Sos el diseñador de juegos del plantel: mirás la motivación (progreso visible, recompensas, ritmo, desafío, cierre) y que cada punto corresponda a algo hecho de verdad. ${FORMATO_REVISION}`,
  },
}

export type Propuesta = { id: number; oficio: string; elemento: string | null; maneja: string | null; ejemplo: string | null; instruccion: string | null; celda: number; fila: number | null; columna: number | null; agenteId: string | null; origen: string; estado: string; creadaEn: number }
const deFila = (r: any): Propuesta => ({ id: r.id, oficio: r.oficio, elemento: r.elemento, maneja: r.maneja, ejemplo: r.ejemplo, instruccion: r.instruccion, celda: r.celda, fila: r.fila, columna: r.columna, agenteId: r.agente_id, origen: r.origen, estado: r.estado, creadaEn: r.creada_en })

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** La plantilla por su clave o por su oficio («visual», «Diseñador visual», «gamificación»…). */
export function plantillaDe(q: string) {
  const t = sinTildes(q)
  return Object.entries(PLANTILLAS_OFICIO).find(([k, p]) => sinTildes(k) === t || sinTildes(p.oficio) === t || t.includes(sinTildes(k).slice(0, 6)))?.[1] ?? null
}

/**
 * La celda que se sugiere: la primera vacía (sin oficio ni nombre, ni otra propuesta pendiente); y en la matriz 6×6,
 * la fila de su elemento y la primera columna libre de esa fila.
 */
export function celdaSugerida(db: Db, elemento: string | null): { celda: number; fila: number | null; columna: number | null } {
  asegurarFichas(db)
  const tomadas = new Set((db.prepare(`SELECT celda FROM oficios_propuestos WHERE estado = 'propuesta'`).all() as { celda: number }[]).map((r) => r.celda))
  let celda = 0
  for (let n = 1; n <= 72 && !celda; n++) { const f = fichaDe(db, n); if (f.estado === 'vacío' && !f.oficio && !tomadas.has(n)) celda = n }
  if (!celda) throw new Error('No queda ninguna celda vacía en la Matriz 72')
  const i = elemento ? ELEMENTOS.indexOf(elemento as Elemento) : -1
  if (i < 0) return { celda, fila: null, columna: null }
  const fila = i + 1
  const usadas = new Set([
    ...(db.prepare('SELECT columna FROM arquetipo_fichas WHERE fila = ? AND columna IS NOT NULL').all(fila) as { columna: number }[]).map((r) => r.columna),
    ...(db.prepare(`SELECT columna FROM oficios_propuestos WHERE estado = 'propuesta' AND fila = ? AND columna IS NOT NULL`).all(fila) as { columna: number }[]).map((r) => r.columna),
  ])
  const columna = [1, 2, 3, 4, 5, 6].find((c) => !usadas.has(c)) ?? null
  return { celda, fila: columna ? fila : null, columna }
}

/**
 * Propone un oficio nuevo como arquetipo: queda en Para validar con su celda sugerida (nunca se acepta ni se nombra
 * solo). Con una plantilla, trae sus campos; lo que se pase encima manda. El oficio tiene que ser una profesión.
 */
export function proponerOficio(db: Db, p: { oficio?: string | null; plantilla?: string | null; elemento?: string | null; maneja?: string | null; ejemplo?: string | null; instruccion?: string | null; agente?: string | null; origen?: string }, ahora = Date.now()): Propuesta {
  asegurarFichas(db)
  const base = p.plantilla ? plantillaDe(p.plantilla) : p.oficio ? plantillaDe(p.oficio) : null
  if (p.plantilla && !base) throw new Error(`No hay plantilla «${p.plantilla}» (hay: ${Object.keys(PLANTILLAS_OFICIO).join(', ')})`)
  const oficio = (p.oficio?.trim() && !plantillaDe(p.oficio) ? p.oficio.trim() : base?.oficio ?? p.oficio?.trim() ?? '').slice(0, 60)
  const v = esOficio(oficio)
  if (!v.ok) throw new Error(v.porQue)
  if (db.prepare(`SELECT 1 FROM arquetipo_fichas WHERE oficio = ? COLLATE NOCASE`).get(oficio)) throw new Error(`«${oficio}» ya es el oficio de un arquetipo`)
  if (db.prepare(`SELECT 1 FROM oficios_propuestos WHERE oficio = ? COLLATE NOCASE AND estado = 'propuesta'`).get(oficio)) throw new Error(`«${oficio}» ya está propuesto: esperá en Para validar`)
  const elemento = p.elemento ? ELEMENTOS.find((e) => sinTildes(e) === sinTildes(p.elemento!).replace(/\s+/g, '-')) ?? null : base?.elemento ?? null
  if (p.elemento && !elemento) throw new Error(`Elemento inválido: ${p.elemento} (${ELEMENTOS.join(', ')})`)
  let agenteId: string | null = null
  if (p.agente) {
    const ag = leer(db, p.agente)
    if (!ag) throw new Error(`No existe el agente «${p.agente}»`)
    if (ag.estado === 'prueba') throw new Error(`${alias(ag)} todavía está en prueba: asciende cuando cumple su misión (tres éxitos)`)
    agenteId = ag.id
  }
  const s = celdaSugerida(db, elemento)
  const r = db.prepare('INSERT INTO oficios_propuestos (oficio, elemento, maneja, ejemplo, instruccion, celda, fila, columna, agente_id, origen, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    oficio, elemento, (p.maneja ?? base?.maneja ?? null)?.slice(0, 200) ?? null, (p.ejemplo ?? base?.ejemplo ?? null)?.slice(0, 300) ?? null,
    (p.instruccion ?? base?.instruccion ?? `Sos el ${oficio.toLowerCase()} del plantel. ${FORMATO_REVISION}`).slice(0, 2000), s.celda, s.fila, s.columna, agenteId, agenteId ? 'ascenso' : p.origen ?? 'chat', ahora)
  return leerPropuesta(db, Number(r.lastInsertRowid))!
}

export function leerPropuesta(db: Db, id: number): Propuesta | null {
  const r = db.prepare('SELECT * FROM oficios_propuestos WHERE id = ?').get(id)
  return r ? deFila(r) : null
}
export const pendientes = (db: Db) => (db.prepare(`SELECT * FROM oficios_propuestos WHERE estado = 'propuesta' ORDER BY id`).all() as any[]).map(deFila)

/** Para Para validar: cada propuesta con su celda sugerida y, si es un ascenso, quién asciende. */
export function oficiosParaBandeja(db: Db) {
  const xs = pendientes(db)
  return {
    n: xs.length,
    items: xs.map((p) => {
      const ag = p.agenteId ? leer(db, p.agenteId) : null
      return { id: p.id, texto: `${p.oficio} → celda ${p.celda}${p.fila ? ` (fila ${p.fila}, columna ${p.columna})` : ''}${ag ? ` · asciende ${alias(ag)}` : ''}`, sub: [p.maneja, p.elemento ? `elemento: ${p.elemento}` : '', 'El nombre propio lo ponés vos, en su página.'].filter(Boolean).join(' · ') }
    }),
  }
}

/**
 * Acepta (en su celda o en otra que él elija) o descarta. Al aceptar se completa la ficha del arquetipo (oficio,
 * elemento, fila y columna, qué maneja, ejemplo) y queda su instrucción; si es un ascenso, el agente pasa a esa celda
 * con la instrucción del oficio (sus aprendizajes siguen) y deja de ser descartable.
 */
export function resolverOficio(db: Db, id: number, accion: 'aceptar' | 'descartar', o: { celda?: number | null } = {}, ahora = Date.now()) {
  const p = leerPropuesta(db, id)
  if (!p) throw new Error(`No existe la propuesta de oficio ${id}`)
  if (p.estado !== 'propuesta') throw new Error(`Esa propuesta ya está ${p.estado}`)
  if (accion === 'descartar') {
    db.prepare(`UPDATE oficios_propuestos SET estado = 'descartada', resuelta_en = ? WHERE id = ?`).run(ahora, id)
    return { descartada: p.oficio }
  }
  const celda = o.celda ? Number(o.celda) : p.celda
  const f = fichaDe(db, celda)
  if (f.oficio || f.nombre) throw new Error(`La celda ${celda} ya está ocupada (${f.nombre ?? f.oficio}): elegí otra`)
  const ficha = fijarFicha(db, celda, { oficio: p.oficio, elemento: p.elemento, fila: celda === p.celda ? p.fila : null, columna: celda === p.celda ? p.columna : null, maneja: p.maneja, ejemplo: p.ejemplo }, ahora)
  db.prepare('UPDATE arquetipo_fichas SET instruccion = ?, titular = ? WHERE n = ?').run(p.instruccion, p.agenteId, celda)
  db.prepare(`UPDATE oficios_propuestos SET estado = 'aceptada', celda = ?, resuelta_en = ? WHERE id = ?`).run(celda, ahora, id)
  let ascendio: string | null = null
  if (p.agenteId) {
    const ag = leer(db, p.agenteId)
    if (ag) {
      // Conserva lo que aprendió (su estrategia): cambia de celda y suma la instrucción del oficio a la suya.
      db.prepare('UPDATE agentes SET celda = ?, instrucciones = ? WHERE id = ?').run(celda, `${p.instruccion}\n\n(Lo que traías de antes: ${ag.instrucciones.slice(0, 1500)})`, ag.id)
      ascendio = alias(ag)
    }
  }
  return { arquetipo: celda, ficha, ascendio }
}

/** ¿Es el titular de un arquetipo (un generativo que ascendió)? Los titulares no se purgan por no correr. */
export function esTitular(db: Db, agenteId: string): boolean {
  try { return !!db.prepare('SELECT 1 FROM arquetipo_fichas WHERE titular = ?').get(agenteId) } catch { return false }
}
