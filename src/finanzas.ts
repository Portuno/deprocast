/**
 * Finanzas: sus números, para empujar la meta de plata. Movimientos a mano, desde el chat («gasté 20 € en comida»),
 * por foto (un ticket por Telegram) o importando el extracto del banco en CSV (se detectan columnas, fechas y montos con
 * coma decimal). Cada movimiento puede ir atado a un proyecto o persona suya (solo, si lo nombra la descripción): así se
 * ve cuánto deja o cuesta cada cosa. El resumen del mes compara lo que entró con su meta mensual y el ritmo que falta.
 * Sin conexión al banco (PSD2 queda para más adelante).
 */
import crypto from 'node:crypto'
import { ajuste, fechaLocal, json, type Db } from './db.ts'

export const CATEGORIAS = ['ingresos', 'vivienda', 'comida', 'transporte', 'salud', 'ocio', 'suscripciones', 'trabajo', 'proyectos', 'deudas', 'ahorro', 'otros'] as const
export type Movimiento = {
  id: number; fecha: string; monto: number; moneda: string; categoria: string; descripcion: string; cuenta: string | null; origen: string
  entidadId: number | null; entidad: string | null; misionId: number | null; foto: string | null; nota: string | null
}

const deFila = (r: any): Movimiento => ({
  id: r.id, fecha: r.fecha, monto: r.monto, moneda: r.moneda, categoria: r.categoria, descripcion: r.descripcion, cuenta: r.cuenta, origen: r.origen,
  entidadId: r.entidad_id ?? null, entidad: r.entidad_nombre ?? null, misionId: r.mision_id ?? null, foto: r.foto ?? null, nota: r.nota ?? null,
})
const SELECT = 'SELECT m.*, e.nombre AS entidad_nombre FROM movimientos m LEFT JOIN entidades e ON e.id = m.entidad_id'

// ─── a qué proyecto pertenece ───────────────────────────────────────────

const normE = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
const PREFERENCIA: Record<string, number> = { proyecto: 0, agrupacion: 1, persona: 2 }

/** Sus proyectos, agrupaciones y personas con nombre y alias (él mismo no: su plata es toda suya). */
function candidatas(db: Db): { id: number; tipo: string; nombres: string[] }[] {
  return (db.prepare(`SELECT id, nombre, tipo, alias, meta FROM entidades WHERE tipo IN ('proyecto', 'agrupacion', 'persona')`).all() as any[])
    .filter((e) => json<Record<string, unknown>>(e.meta, {}).operador !== 1)
    .map((e) => ({ id: e.id, tipo: e.tipo, nombres: [e.nombre, ...json<string[]>(e.alias, [])].map(normE).filter((n) => n.length >= 4) }))
}

/** El proyecto (o persona) que nombra un texto: el nombre más largo que aparece entero; entre iguales, el proyecto. */
export function entidadDeMovimiento(db: Db, texto: string): number | null {
  const t = ` ${normE(texto)} `
  const hits = candidatas(db).flatMap((e) => e.nombres.filter((n) => t.includes(` ${n} `)).map((n) => ({ id: e.id, tipo: e.tipo, largo: n.length })))
  hits.sort((a, b) => b.largo - a.largo || (PREFERENCIA[a.tipo] ?? 9) - (PREFERENCIA[b.tipo] ?? 9))
  return hits[0]?.id ?? null
}

/** Un nombre que dice él («para Corruptopolis»): el que coincide entero, o el que aparece adentro. */
export function entidadPorNombre(db: Db, nombre: string): number | null {
  const n = normE(nombre)
  if (!n) return null
  return candidatas(db).find((e) => e.nombres.includes(n))?.id ?? entidadDeMovimiento(db, nombre)
}
const huella = (m: { fecha: string; monto: number; descripcion: string }) => crypto.createHash('sha1').update(`${m.fecha}|${m.monto.toFixed(2)}|${m.descripcion.trim().toLowerCase()}`).digest('hex')

/** Categoría por palabras (sin modelo): lo obvio se clasifica solo; el resto, «otros». */
export function categorizar(descripcion: string, monto: number): string {
  const d = descripcion.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') // «súper» = «super»
  if (monto > 0) return 'ingresos'
  const reglas: [RegExp, string][] = [
    [/alquiler|hipoteca|comunidad|luz|agua|gas natural|iberdrola|endesa|naturgy/, 'vivienda'],
    [/mercadona|carrefour|lidl|dia |consum|aldi|super|restaurante|bar |caf[eé]|glovo|uber eats|just eat|comida/, 'comida'],
    [/metro|emt|renfe|taxi|uber|cabify|gasolina|repsol|cepsa|parking|bus|vuelo|ryanair|vueling/, 'transporte'],
    [/farmacia|m[eé]dic|dentista|sanitas|adeslas|gimnasio|gym/, 'salud'],
    [/netflix|spotify|hbo|disney|prime|apple\.com|google|openai|anthropic|claude|cursor|grok|x\.ai|nan|suscrip/, 'suscripciones'],
    [/cine|concierto|entradas|steam|playstation|libro|amazon/, 'ocio'],
    [/pr[eé]stamo|tarjeta de cr[eé]dito|deuda|cuota/, 'deudas'],
  ]
  return reglas.find(([r]) => r.test(d))?.[1] ?? 'otros'
}

export function registrarMovimiento(db: Db, m: { fecha?: string; monto: number; moneda?: string; categoria?: string | null; descripcion: string; cuenta?: string | null; origen?: string; entidadId?: number | null; proyecto?: string | null; misionId?: number | null; foto?: string | null; nota?: string | null }, ahora = Date.now()): Movimiento | null {
  const monto = Number(m.monto)
  if (!Number.isFinite(monto) || monto === 0) throw new Error('El monto tiene que ser un número distinto de cero')
  const fecha = m.fecha && /^\d{4}-\d{2}-\d{2}$/.test(m.fecha) ? m.fecha : fechaLocal(ahora)
  const descripcion = String(m.descripcion ?? '').trim().slice(0, 200) || (monto > 0 ? 'Ingreso' : 'Gasto')
  const categoria = m.categoria && CATEGORIAS.includes(m.categoria as any) ? m.categoria : categorizar(descripcion, monto)
  const entidad = m.entidadId ?? (m.proyecto ? entidadPorNombre(db, m.proyecto) : null) ?? entidadDeMovimiento(db, `${descripcion} ${m.nota ?? ''}`)
  const r = db.prepare('INSERT OR IGNORE INTO movimientos (fecha, monto, moneda, categoria, descripcion, cuenta, origen, huella, creado_en, entidad_id, mision_id, foto, nota) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(fecha, monto, m.moneda ?? 'EUR', categoria, descripcion, m.cuenta ?? null, m.origen ?? 'manual', huella({ fecha, monto, descripcion }), ahora, entidad, m.misionId ?? null, m.foto ?? null, m.nota?.trim().slice(0, 400) || null)
  return r.changes ? leerMovimiento(db, Number(r.lastInsertRowid)) : null
}

// ─── lo que contó charlando ─────────────────────────────────────────────

export type Sugerido = { id: number; fecha: string; monto: number; moneda: string; descripcion: string; dicho: string | null; creadoEn: number }
const DIA = 86_400_000

/**
 * Un monto que contó («me pagaron 800», «gasté 40 en…») queda como movimiento sugerido: entra a Finanzas con su ok.
 * Si ya está anotado (el mismo monto, días cerca) o ya se sugirió, no se repite.
 */
export function sugerirMovimiento(db: Db, m: { monto: number; descripcion: string; fecha?: string | null; moneda?: string | null; dicho?: string | null }, ahora = Date.now()): Sugerido | null {
  const monto = Math.round(Number(m.monto) * 100) / 100
  if (!Number.isFinite(monto) || monto === 0) return null
  const fecha = m.fecha && /^\d{4}-\d{2}-\d{2}$/.test(m.fecha) ? m.fecha : fechaLocal(ahora)
  const cerca = [fechaLocal(new Date(`${fecha}T12:00:00`).getTime() - 3 * DIA), fechaLocal(new Date(`${fecha}T12:00:00`).getTime() + 3 * DIA)]
  if (db.prepare('SELECT 1 FROM movimientos WHERE ABS(monto - ?) < 0.01 AND fecha BETWEEN ? AND ?').get(monto, ...cerca)) return null
  if (db.prepare(`SELECT 1 FROM movimientos_sugeridos WHERE ABS(monto - ?) < 0.01 AND fecha BETWEEN ? AND ? AND estado != 'descartado'`).get(monto, ...cerca)) return null
  const descripcion = String(m.descripcion ?? '').trim().slice(0, 200) || (monto > 0 ? 'Ingreso' : 'Gasto')
  const r = db.prepare('INSERT INTO movimientos_sugeridos (fecha, monto, moneda, descripcion, dicho, creado_en) VALUES (?, ?, ?, ?, ?, ?)')
    .run(fecha, monto, (m.moneda || 'EUR').toUpperCase().slice(0, 3), descripcion, m.dicho?.trim().slice(0, 300) || null, ahora)
  return sugeridos(db).find((x) => x.id === Number(r.lastInsertRowid)) ?? null
}

export function sugeridos(db: Db): Sugerido[] {
  return (db.prepare(`SELECT * FROM movimientos_sugeridos WHERE estado = 'pendiente' ORDER BY fecha DESC, id DESC LIMIT 50`).all() as any[])
    .map((r) => ({ id: r.id, fecha: r.fecha, monto: r.monto, moneda: r.moneda, descripcion: r.descripcion, dicho: r.dicho, creadoEn: r.creado_en }))
}

/** Aceptar lo pasa a Finanzas (con lo que él corrija del monto o la descripción); descartar lo olvida. */
export function resolverSugerido(db: Db, id: number, accion: 'aceptar' | 'descartar', c: { monto?: number; descripcion?: string } = {}, ahora = Date.now()): Movimiento | null {
  const s = db.prepare(`SELECT * FROM movimientos_sugeridos WHERE id = ? AND estado = 'pendiente'`).get(id) as any
  if (!s) throw new Error(`No hay un movimiento sugerido ${id} pendiente`)
  if (accion === 'descartar') {
    db.prepare(`UPDATE movimientos_sugeridos SET estado = 'descartado' WHERE id = ?`).run(id)
    return null
  }
  const m = registrarMovimiento(db, { fecha: s.fecha, monto: c.monto ?? s.monto, moneda: s.moneda, descripcion: c.descripcion?.trim() || s.descripcion, origen: 'charla', nota: s.dicho }, ahora)
  db.prepare(`UPDATE movimientos_sugeridos SET estado = 'aceptado', movimiento_id = ? WHERE id = ?`).run(m?.id ?? null, id)
  return m
}

export function leerMovimiento(db: Db, id: number): Movimiento | null {
  const r = db.prepare(`${SELECT} WHERE m.id = ?`).get(id)
  return r ? deFila(r) : null
}

export function listarMovimientos(db: Db, f: { mes?: string; limite?: number } = {}): Movimiento[] {
  return (f.mes
    ? db.prepare(`${SELECT} WHERE m.fecha LIKE ? ORDER BY m.fecha DESC, m.id DESC LIMIT ?`).all(`${f.mes}%`, f.limite ?? 500)
    : db.prepare(`${SELECT} ORDER BY m.fecha DESC, m.id DESC LIMIT ?`).all(f.limite ?? 200)).map(deFila)
}

export function editarMovimiento(db: Db, id: number, c: { categoria?: string; descripcion?: string; borrar?: boolean; entidadId?: number | null; proyecto?: string | null; nota?: string }) {
  if (c.borrar) return void db.prepare('DELETE FROM movimientos WHERE id = ?').run(id)
  if (c.entidadId !== undefined || c.proyecto !== undefined) {
    const e = c.entidadId !== undefined ? c.entidadId : c.proyecto ? entidadPorNombre(db, c.proyecto) : null
    if (c.proyecto && !e) throw new Error(`No encuentro «${c.proyecto}» entre tus proyectos y personas`)
    db.prepare('UPDATE movimientos SET entidad_id = ? WHERE id = ?').run(e, id)
  }
  if (c.nota !== undefined) db.prepare('UPDATE movimientos SET nota = ? WHERE id = ?').run(c.nota.trim().slice(0, 400) || null, id)
  if (c.categoria && CATEGORIAS.includes(c.categoria as any)) db.prepare('UPDATE movimientos SET categoria = ? WHERE id = ?').run(c.categoria, id)
  if (c.descripcion) db.prepare('UPDATE movimientos SET descripcion = ? WHERE id = ?').run(c.descripcion.trim(), id)
}

// ─── CSV del banco ──────────────────────────────────────────────────────

/** «1.234,56», «-12,30», «1,234.56», «12.30 €» → número. */
export function numero(s: string): number | null {
  let t = String(s ?? '').replace(/[€$\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (!t) return null
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** «31/12/2026», «31-12-26», «2026-12-31» → YYYY-MM-DD. */
export function fecha(s: string): string | null {
  const t = String(s ?? '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t)
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

function filas(texto: string): string[][] {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const sep = [';', '\t', ','].map((s) => [s, (lineas[0] ?? '').split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  return lineas.map((l) => {
    const out: string[] = []
    let actual = ''
    let comillas = false
    for (const ch of l) {
      if (ch === '"') comillas = !comillas
      else if (ch === sep && !comillas) { out.push(actual.trim()); actual = '' }
      else actual += ch
    }
    out.push(actual.trim())
    return out
  })
}

/** Importa un extracto en CSV: encuentra la cabecera (fecha, concepto, importe o cargo/abono) y suma lo nuevo. */
export function importarCSV(db: Db, texto: string, o: { cuenta?: string | null; ahora?: number } = {}): { nuevos: number; repetidos: number; ignorados: number } {
  const fs_ = filas(texto)
  const iCab = fs_.findIndex((f) => f.some((c) => /fecha|date/i.test(c)) && f.some((c) => /importe|monto|amount|cargo|abono|debe|haber/i.test(c)))
  if (iCab < 0) throw new Error('No encuentro la cabecera (fecha + importe) en el CSV')
  const cab = fs_[iCab].map((c) => c.toLowerCase())
  const col = (re: RegExp) => cab.findIndex((c) => re.test(c))
  const cFecha = col(/fecha( valor| operaci[oó]n)?$|^fecha|date/)
  const cDesc = col(/concepto|descripci|detalle|description|movimiento/)
  const cImporte = col(/importe|monto|amount/)
  const cCargo = col(/cargo|debe|debit/)
  const cAbono = col(/abono|haber|credit/)
  let nuevos = 0, repetidos = 0, ignorados = 0
  for (const f of fs_.slice(iCab + 1)) {
    const fe = fecha(f[cFecha] ?? '')
    const monto = cImporte >= 0 ? numero(f[cImporte] ?? '') : (numero(f[cAbono] ?? '') ?? 0) - Math.abs(numero(f[cCargo] ?? '') ?? 0)
    if (!fe || !monto) { ignorados++; continue }
    const r = registrarMovimiento(db, { fecha: fe, monto, descripcion: cDesc >= 0 ? f[cDesc] : 'Movimiento', cuenta: o.cuenta ?? null, origen: 'csv' }, o.ahora)
    if (r) nuevos++
    else repetidos++
  }
  return { nuevos, repetidos, ignorados }
}

// ─── resumen ────────────────────────────────────────────────────────────

/** El mes: lo que entró, lo que salió, por categoría, y la distancia a su meta mensual de ingresos. */
export function resumenMes(db: Db, mes = fechaLocal().slice(0, 7)) {
  const ms = listarMovimientos(db, { mes, limite: 5000 })
  const ingresos = ms.filter((m) => m.monto > 0).reduce((s, m) => s + m.monto, 0)
  const gastos = ms.filter((m) => m.monto < 0).reduce((s, m) => s - m.monto, 0)
  const porCategoria: Record<string, number> = {}
  for (const m of ms.filter((x) => x.monto < 0)) porCategoria[m.categoria] = (porCategoria[m.categoria] ?? 0) - m.monto
  const meta = Number(ajuste(db, 'meta_ingresos_mes') ?? 0) || null
  return {
    mes, ingresos: Math.round(ingresos * 100) / 100, gastos: Math.round(gastos * 100) / 100, neto: Math.round((ingresos - gastos) * 100) / 100,
    porCategoria: Object.fromEntries(Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    meta, avanceMeta: meta ? Math.round((ingresos / meta) * 100) : null, movimientos: ms.length,
  }
}

/** Por proyecto (o persona) en un mes: cuánto entró, cuánto salió y el neto. Lo sin asignar va aparte. */
export function resumenPorProyecto(db: Db, mes = fechaLocal().slice(0, 7)) {
  const grupos = new Map<number | null, { entidadId: number | null; nombre: string; ingresos: number; gastos: number; neto: number; movimientos: number }>()
  for (const m of listarMovimientos(db, { mes, limite: 5000 })) {
    const g = grupos.get(m.entidadId) ?? { entidadId: m.entidadId, nombre: m.entidad ?? 'Sin proyecto', ingresos: 0, gastos: 0, neto: 0, movimientos: 0 }
    if (m.monto > 0) g.ingresos += m.monto
    else g.gastos -= m.monto
    g.neto += m.monto
    g.movimientos++
    grupos.set(m.entidadId, g)
  }
  const r2 = (n: number) => Math.round(n * 100) / 100
  return [...grupos.values()].map((g) => ({ ...g, ingresos: r2(g.ingresos), gastos: r2(g.gastos), neto: r2(g.neto) }))
    .sort((a, b) => (a.entidadId == null ? 1 : 0) - (b.entidadId == null ? 1 : 0) || Math.abs(b.neto) - Math.abs(a.neto))
}

/** Cuánto falta para la meta del mes y a qué ritmo por día (null si no hay meta). */
export function ritmoMeta(db: Db, ahora = Date.now()) {
  const r = resumenMes(db, fechaLocal(ahora).slice(0, 7))
  if (!r.meta) return null
  const d = new Date(ahora)
  const quedan = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1
  const falta = Math.max(0, Math.round((r.meta - r.ingresos) * 100) / 100)
  return { meta: r.meta, entro: r.ingresos, falta, diasQuedan: quedan, porDia: Math.round((falta / quedan) * 100) / 100 }
}

/** Para Mastropiero (chat, preguntas, runs, primarias, Brújula, audio de la mañana): cómo viene la plata, si hay datos. */
export function finanzasParaPrompt(db: Db, ahora = Date.now()): string {
  const r = resumenMes(db, fechaLocal(ahora).slice(0, 7))
  if (!r.movimientos && !r.meta) return ''
  const ritmo = ritmoMeta(db, ahora)
  const proyectos = resumenPorProyecto(db, r.mes).filter((p) => p.entidadId != null).slice(0, 6)
  return [
    `Sus números del mes (${r.mes}): entraron ${r.ingresos} €, salieron ${r.gastos} € (neto ${r.neto} €).`,
    ritmo ? `Su meta es ${ritmo.meta} €/mes: ${ritmo.falta ? `faltan ${ritmo.falta} € en ${ritmo.diasQuedan} días (${ritmo.porDia} € por día)` : 'ya la pasó'}.` : '',
    proyectos.length ? `Por proyecto: ${proyectos.map((p) => `${p.nombre} ${p.neto >= 0 ? '+' : ''}${p.neto} €`).join(', ')}.` : '',
    Object.keys(r.porCategoria).length ? `En qué se va: ${Object.entries(r.porCategoria).slice(0, 4).map(([k, v]) => `${k} ${v} €`).join(', ')}.` : '',
  ].filter(Boolean).join(' ')
}
