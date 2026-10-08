/**
 * Finanzas: sus números, para empujar la meta de plata. Movimientos a mano, desde el chat («gasté 20 € en comida»)
 * o importando el extracto del banco en CSV (se detectan columnas, fechas y montos con coma decimal). El resumen del
 * mes compara lo que entró con su meta mensual. Sin conexión al banco (PSD2 queda para más adelante).
 */
import crypto from 'node:crypto'
import { ajuste, fechaLocal, type Db } from './db.ts'

export const CATEGORIAS = ['ingresos', 'vivienda', 'comida', 'transporte', 'salud', 'ocio', 'suscripciones', 'trabajo', 'proyectos', 'deudas', 'ahorro', 'otros'] as const
export type Movimiento = { id: number; fecha: string; monto: number; moneda: string; categoria: string; descripcion: string; cuenta: string | null; origen: string }

const deFila = (r: any): Movimiento => ({ id: r.id, fecha: r.fecha, monto: r.monto, moneda: r.moneda, categoria: r.categoria, descripcion: r.descripcion, cuenta: r.cuenta, origen: r.origen })
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

export function registrarMovimiento(db: Db, m: { fecha?: string; monto: number; moneda?: string; categoria?: string | null; descripcion: string; cuenta?: string | null; origen?: string }, ahora = Date.now()): Movimiento | null {
  const monto = Number(m.monto)
  if (!Number.isFinite(monto) || monto === 0) throw new Error('El monto tiene que ser un número distinto de cero')
  const fecha = m.fecha && /^\d{4}-\d{2}-\d{2}$/.test(m.fecha) ? m.fecha : fechaLocal(ahora)
  const descripcion = String(m.descripcion ?? '').trim().slice(0, 200) || (monto > 0 ? 'Ingreso' : 'Gasto')
  const categoria = m.categoria && CATEGORIAS.includes(m.categoria as any) ? m.categoria : categorizar(descripcion, monto)
  const r = db.prepare('INSERT OR IGNORE INTO movimientos (fecha, monto, moneda, categoria, descripcion, cuenta, origen, huella, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(fecha, monto, m.moneda ?? 'EUR', categoria, descripcion, m.cuenta ?? null, m.origen ?? 'manual', huella({ fecha, monto, descripcion }), ahora)
  return r.changes ? deFila(db.prepare('SELECT * FROM movimientos WHERE id = ?').get(Number(r.lastInsertRowid))) : null
}

export function listarMovimientos(db: Db, f: { mes?: string; limite?: number } = {}): Movimiento[] {
  return (f.mes
    ? db.prepare('SELECT * FROM movimientos WHERE fecha LIKE ? ORDER BY fecha DESC, id DESC LIMIT ?').all(`${f.mes}%`, f.limite ?? 500)
    : db.prepare('SELECT * FROM movimientos ORDER BY fecha DESC, id DESC LIMIT ?').all(f.limite ?? 200)).map(deFila)
}

export function editarMovimiento(db: Db, id: number, c: { categoria?: string; descripcion?: string; borrar?: boolean }) {
  if (c.borrar) return void db.prepare('DELETE FROM movimientos WHERE id = ?').run(id)
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

/** Para Mastropiero: una línea con cómo viene el mes (si hay datos). */
export function finanzasParaPrompt(db: Db): string {
  const r = resumenMes(db)
  if (!r.movimientos) return ''
  return `Sus números del mes (${r.mes}): entraron ${r.ingresos} €, salieron ${r.gastos} € (neto ${r.neto} €)${r.meta ? `; su meta es ${r.meta} €/mes: va ${r.avanceMeta}%` : ''}.`
}
