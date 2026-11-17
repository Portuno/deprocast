/**
 * Gastos solos (Fragua #296): los avisos de pago que manda el teléfono (Mercado Pago, Belo, el banco) se leen y quedan
 * como movimientos sugeridos en el Monedero, para que él los firme en un toque (o entran solos si puso el modo auto).
 * - El monto con su moneda: «1.234,56 €», «$ 1.500» (pesos, si la app es argentina), «US$ 20», «20 EUR».
 * - Si es un pago (pagaste, compra, débito, enviaste) o un cobro (recibiste, te transfirieron, devolución): el pago va
 *   en negativo. Un código de verificación o un aviso sin dirección clara no se anota.
 * - El comercio o quién: lo que sigue a «en», «a», «at» o «de».
 * El mismo aviso (la app lo vuelve a publicar) no entra dos veces.
 */
import crypto from 'node:crypto'
import { fechaLocal, type Db } from './db.ts'

export type AvisoPago = { paquete: string; app: string; titulo: string; texto: string; en: number }
export type PagoLeido = { monto: number; moneda: string; tipo: 'pago' | 'cobro'; quien: string | null; fecha: string }

const ARGENTINAS = /mercado ?pago|mercadopago|belo|ual[aá]|brubank|naranja|galicia|lemon|prex|bna|macro|santander ?rio|personal pay|cuenta dni/i

/** «1.234,56» → 1234.56; «1,234.56» → 1234.56; «1.500» (miles) → 1500; «12,5» → 12.5. */
export function numero(s: string): number | null {
  const t = s.replace(/\s/g, '')
  if (!/\d/.test(t)) return null
  const punto = t.lastIndexOf('.'), coma = t.lastIndexOf(',')
  let limpio: string
  if (punto >= 0 && coma >= 0) limpio = punto > coma ? t.replace(/,/g, '') : t.replace(/\./g, '').replace(',', '.')
  else if (coma >= 0) limpio = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (punto >= 0) limpio = /\.\d{3}$/.test(t) && !/\.\d{3}\./.test(t) ? t.replace(/\./g, '') : /\.\d{3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t
  else limpio = t
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

const MONEDA_ANTES = /(US\$|U\$S|USD|USDC|USDT|EUR|ARS|€|\$)\s?(\d[\d.,]*)/i
const MONEDA_DESPUES = /(\d[\d.,]*)\s?(€|EUR|USD|USDC|USDT|ARS|euros?|pesos?|d[oó]lares?)(?![A-Za-zÀ-ÿ])/i
const COBRO = /(recibiste|te (enviaron|envi[oó]|transfiri[oó]|transfirieron|pagaron|pag[oó]|depositaron|acreditaron)|cobraste|ingreso|ingres[oó]|abono|devoluci[oó]n|reembolso|reintegro|acreditamos|received|refund)/i
const PAGO = /(pagaste|pago (con|en|a|de)|compra|compraste|cargo|d[eé]bito|debitamos|enviaste|transferiste|retiro|retiraste|extracci[oó]n|cobro de|payment|spent|paid|purchase)/i
const NO_ES = /(c[oó]digo|code|clave|contraseña|verific|token|otp|inici(a|aste) sesi[oó]n|promo|cup[oó]n|descuento de|hasta \d+ ?%|cuotas sin inter[eé]s|te regalamos)/i

function monedaDe(simbolo: string, app: string): string {
  const s = simbolo.toLowerCase()
  if (s === '€' || s.startsWith('eur') || s.startsWith('euro')) return 'EUR'
  if (s === 'us$' || s === 'u$s' || s.startsWith('usd') || s.startsWith('d')) return s === 'usdc' ? 'USDC' : s === 'usdt' ? 'USDT' : 'USD'
  if (s === 'ars' || s.startsWith('peso')) return 'ARS'
  // «$» solo: pesos en una app argentina; si no, dólares.
  return ARGENTINAS.test(app) ? 'ARS' : 'USD'
}

/** Lee un aviso. null si no es un pago ni un cobro claro (un código, una promo, un aviso sin monto). */
export function leerAvisoPago(a: AvisoPago): PagoLeido | null {
  const todo = `${a.titulo}. ${a.texto}`.replace(/\s+/g, ' ').trim()
  if (NO_ES.test(todo)) return null
  const tipo = COBRO.test(todo) ? 'cobro' : PAGO.test(todo) ? 'pago' : null
  if (!tipo) return null
  const antes = MONEDA_ANTES.exec(todo), despues = MONEDA_DESPUES.exec(todo)
  const m = antes && (!despues || (antes.index ?? 0) <= (despues.index ?? 0)) ? { simbolo: antes[1], cifra: antes[2] } : despues ? { simbolo: despues[2], cifra: despues[1] } : null
  if (!m) return null
  const valor = numero(m.cifra.replace(/[.,]$/, ''))
  if (valor == null || valor <= 0 || valor > 10_000_000) return null
  // Quién: primero lo que sigue a «en» o «at» (el comercio); si no, a «a», «de», «desde», «para» (la persona). Nunca un número.
  const NOMBRE = String.raw`([A-Za-zÁÉÍÓÚÑáéíóúñ][\wÁÉÍÓÚÑáéíóúñ&'.\- ]{1,40}?)(?=[.,;:!]|\s+(?:por|con|el|del|a las|hoy|ayer|\d)|$)`
  const buscar = (prep: string) => [...todo.matchAll(new RegExp(String.raw`\b(?:${prep})\s+${NOMBRE}`, 'g'))].map((x) => x[1].trim().replace(/\s+/g, ' ')).find((n) => !/^(tu|su|la|el|un|una|mi|cuenta|tarjeta|dinero)\b/i.test(n)) ?? null
  const quien = buscar('en|at') ?? buscar('a|de|desde|para')
  return { monto: Math.round((tipo === 'pago' ? -valor : valor) * 100) / 100, moneda: monedaDe(m.simbolo, `${a.app} ${a.paquete}`), tipo, quien: quien && !/^(tu|su|la|el|un|una)$/i.test(quien) ? quien : null, fecha: fechaLocal(a.en || Date.now()) }
}

function asegurar(db: Db) { db.exec(`CREATE TABLE IF NOT EXISTS avisos_pago (huella TEXT PRIMARY KEY, sugerido_id INTEGER, en INTEGER NOT NULL)`) }

/** Lo que mandó el teléfono: cada aviso leído queda sugerido en el Monedero (el mismo aviso, una sola vez). */
export async function recibirAvisosPago(db: Db, avisos: unknown, ahora = Date.now()): Promise<{ recibidos: number; sugeridos: number; ignorados: number; repetidos: number }> {
  asegurar(db)
  const { sugerirMovimiento } = await import('./finanzas.ts')
  const r = { recibidos: 0, sugeridos: 0, ignorados: 0, repetidos: 0 }
  for (const x of (Array.isArray(avisos) ? avisos : []).slice(0, 300) as AvisoPago[]) {
    r.recibidos++
    const a: AvisoPago = { paquete: String(x?.paquete ?? '').slice(0, 120), app: String(x?.app ?? '').slice(0, 80), titulo: String(x?.titulo ?? '').slice(0, 200), texto: String(x?.texto ?? '').slice(0, 600), en: Number(x?.en) || ahora }
    const huella = crypto.createHash('sha1').update(`${a.paquete}|${a.titulo}|${a.texto}|${Math.round(a.en / 60_000)}`).digest('hex')
    if (db.prepare('SELECT 1 FROM avisos_pago WHERE huella = ?').get(huella)) { r.repetidos++; continue }
    const p = leerAvisoPago(a)
    if (!p) { db.prepare('INSERT INTO avisos_pago (huella, sugerido_id, en) VALUES (?, NULL, ?)').run(huella, ahora); r.ignorados++; continue }
    const s = sugerirMovimiento(db, { monto: p.monto, moneda: p.moneda, fecha: p.fecha, descripcion: `${p.tipo === 'pago' ? 'Pago' : 'Cobro'}${p.quien ? ` · ${p.quien}` : ''} (${a.app})`, dicho: `${a.app}: ${a.titulo} — ${a.texto}`.slice(0, 300), exacto: true }, ahora)
    db.prepare('INSERT INTO avisos_pago (huella, sugerido_id, en) VALUES (?, ?, ?)').run(huella, s?.id ?? null, ahora)
    if (s) r.sugeridos++; else r.repetidos++
  }
  return r
}
