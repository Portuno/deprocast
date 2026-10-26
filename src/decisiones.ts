/**
 * El libro de decisiones y el modo sombra (de «Where to Begin With AI Transformation», Vas): lo que Mastropiero propone
 * —un registro por foto, un monto que contaste, una tarea del Directo, un recuerdo del escriba— se anota con lo que
 * decidiste (aceptada, editada, rechazada, deshecha) o con «auto» si lo hizo solo. Con eso se sabe cuánto acierta cada
 * clase de cosa: si acierta casi siempre (cota inferior de Wilson ≥ 0,95 sobre las últimas 100: unos 80 aciertos casi
 * seguidos), te ofrece hacerla
 * solo, deshacible; nunca pasa a «auto» sin tu ok. A vos te llegan las excepciones.
 * Este módulo solo depende de db.ts: lo llaman los resolvers de todos lados.
 */
import { ajuste, fijarAjuste, json, type Db } from './db.ts'

export const ACCIONES = ['aceptada', 'editada', 'rechazada', 'deshecha', 'auto'] as const
export type Accion = (typeof ACCIONES)[number]
export type Modo = 'sombra' | 'auto' | 'manual'

/** Las clases de cosas que propone; «auto»: si se puede hacer sola y deshacer. */
export const TIPOS: Record<string, { nombre: string; auto: boolean }> = {
  captura: { nombre: 'Registros por foto o texto (comidas, gastos, entrenos)', auto: true },
  monto: { nombre: 'Montos que contás de pasada', auto: true },
  inventario: { nombre: 'Lo que tenés (inventario)', auto: true },
  recuerdo: { nombre: 'Lo que el escriba anota de vos', auto: true },
  'directo:tarea': { nombre: 'Directo · tareas que dijiste', auto: true },
  'directo:cumplida': { nombre: 'Directo · tareas que cumpliste', auto: true },
  'directo:banda': { nombre: 'Directo · bandas que hiciste', auto: true },
  'directo:idea': { nombre: 'Directo · ideas', auto: true },
  'directo:medio': { nombre: 'Directo · lo que miraste o escuchaste', auto: true },
  'directo:entidad': { nombre: 'Directo · personas, proyectos y lugares', auto: false },
  'directo:conexion': { nombre: 'Directo · conexiones entre personas', auto: false },
  side_quest: { nombre: 'Side quests que anota el escriba', auto: false },
  primaria: { nombre: 'Primarias que te propone', auto: false },
  nombre: { nombre: 'Nombres del archivo (personas, proyectos, lugares)', auto: false },
  quantomo: { nombre: 'Quántomos proto', auto: false },
  propuesta: { nombre: 'Propuestas de mejora', auto: false },
  aprender: { nombre: 'Lo que te propone aprender (Academia)', auto: false },
}
export const CLAVES_TIPO = Object.keys(TIPOS)

export const MINIMO = 30
export const COTA = 0.95
const VENTANA = 100 // con 50, la cota de Wilson no pasa de 0,93: nunca se llegaría a ofrecer

/** Anota una decisión. «deshacer»: cómo deshacer lo que hizo solo (lo usa la bandeja). */
export function anotarDecision(db: Db, tipo: string, ref: string | number, accion: Accion, o: { cambios?: unknown; deshacer?: unknown; confianza?: number | null; ahora?: number } = {}): number {
  return Number(db.prepare('INSERT INTO decisiones (tipo, ref, accion, cambios, deshacer, confianza, en) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(tipo, String(ref), accion, o.cambios == null ? null : JSON.stringify(o.cambios), o.deshacer == null ? null : JSON.stringify(o.deshacer), o.confianza ?? null, o.ahora ?? Date.now()).lastInsertRowid)
}

/** Que anotar nunca rompa lo que se está haciendo. */
export function anotar(db: Db, tipo: string, ref: string | number, accion: Accion, o: Parameters<typeof anotarDecision>[4] = {}) {
  try { anotarDecision(db, tipo, ref, accion, o) } catch (e) { console.error('  decisiones:', e instanceof Error ? e.message : e) }
}

// ─── modos ──────────────────────────────────────────────────────────────

const modos = (db: Db) => json<Record<string, Modo>>(ajuste(db, 'sombra_modos'), {}) ?? {}

/** El modo de un tipo: lo que él eligió; si no, lo de siempre (captura e ideas/medios del Directo ya iban solos). */
export function modoDe(db: Db, tipo: string): Modo {
  const m = modos(db)[tipo]
  if (m === 'sombra' || m === 'auto' || m === 'manual') return m
  if (tipo === 'captura') return 'auto'
  if (tipo === 'directo:idea' || tipo === 'directo:medio') return ajuste(db, 'directo_auto') === '0' ? 'sombra' : 'auto'
  return 'sombra'
}
export const haceSolo = (db: Db, tipo: string) => TIPOS[tipo]?.auto === true && modoDe(db, tipo) === 'auto'

export function fijarModo(db: Db, tipo: string, modo: Modo) {
  if (!TIPOS[tipo]) throw new Error(`No conozco «${tipo}»`)
  if (!['sombra', 'auto', 'manual'].includes(modo)) throw new Error('El modo es sombra, auto o manual')
  if (modo === 'auto' && !TIPOS[tipo].auto) throw new Error(`«${TIPOS[tipo].nombre}» todavía no se puede hacer solo (no tiene cómo deshacerse)`)
  fijarAjuste(db, 'sombra_modos', JSON.stringify({ ...modos(db), [tipo]: modo }))
}

// ─── cuánto acierta ─────────────────────────────────────────────────────

/** Cota inferior de Wilson (95 %): con pocos casos, no se confía. */
export function wilson(aciertos: number, n: number, z = 1.96): number {
  if (!n) return 0
  const p = aciertos / n
  const d = 1 + (z * z) / n
  return Math.max(0, (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d)
}

/**
 * El acierto de un tipo en sus últimas 100 cosas: cada cosa (ref) vale lo último que se decidió de ella. Acierto si se
 * aceptó tal cual o la hizo solo y nadie la deshizo; error si se editó, se rechazó o se deshizo.
 */
export function aciertoDe(db: Db, tipo: string) {
  const filas = db.prepare('SELECT ref, accion, en FROM decisiones WHERE tipo = ? ORDER BY id').all(tipo) as { ref: string; accion: Accion; en: number }[]
  const ultima = new Map<string, { accion: Accion; en: number; huboHumano: boolean }>()
  for (const f of filas) {
    const ya = ultima.get(f.ref)
    // Un «auto» después de una decisión de él no la pisa.
    if (ya && f.accion === 'auto' && ya.huboHumano) continue
    ultima.set(f.ref, { accion: f.accion, en: f.en, huboHumano: (ya?.huboHumano ?? false) || f.accion !== 'auto' })
  }
  const xs = [...ultima.values()].sort((a, b) => b.en - a.en).slice(0, VENTANA)
  const aciertos = xs.filter((x) => x.accion === 'aceptada' || x.accion === 'auto').length
  const n = xs.length
  return { n, aciertos, tasa: n ? Math.round((aciertos / n) * 1000) / 1000 : null, cota: Math.round(wilson(aciertos, n) * 1000) / 1000 }
}

/** Por tipo: modo, acierto y si conviene ofrecerle que lo haga solo. Solo los tipos con decisiones (o con modo elegido). */
export function estadoSombra(db: Db) {
  const conDatos = new Set((db.prepare('SELECT DISTINCT tipo FROM decisiones').all() as { tipo: string }[]).map((r) => r.tipo))
  const elegidos = Object.keys(modos(db))
  return CLAVES_TIPO.filter((t) => conDatos.has(t) || elegidos.includes(t)).map((tipo) => {
    const a = aciertoDe(db, tipo)
    const modo = modoDe(db, tipo)
    return { tipo, nombre: TIPOS[tipo].nombre, modo, puedeAuto: TIPOS[tipo].auto, ...a, ofrecerAuto: TIPOS[tipo].auto && modo === 'sombra' && a.n >= MINIMO && a.cota >= COTA }
  })
}

/** Lo que hizo solo desde una hora (para «Lo que hizo solo hoy»), con cómo deshacerlo. */
export function hechoSolo(db: Db, desde: number) {
  return (db.prepare(`SELECT * FROM decisiones WHERE accion = 'auto' AND en >= ? AND deshacer IS NOT NULL AND deshecha_en IS NULL ORDER BY id DESC LIMIT 60`).all(desde) as any[])
    .map((r) => ({ id: r.id, tipo: r.tipo, nombre: TIPOS[r.tipo]?.nombre ?? r.tipo, ref: r.ref, texto: (json<any>(r.cambios, {}) ?? {}).texto ?? null, confianza: r.confianza, en: r.en }))
}

export function leerDecision(db: Db, id: number) {
  const r = db.prepare('SELECT * FROM decisiones WHERE id = ?').get(id) as any
  return r ? { id: r.id, tipo: r.tipo as string, ref: r.ref as string, accion: r.accion as Accion, cambios: json<any>(r.cambios, null), deshacer: json<any>(r.deshacer, null), deshechaEn: r.deshecha_en as number | null } : null
}
