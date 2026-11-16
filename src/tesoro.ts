/**
 * El Monedero del Tesorero (Fragua #255 y #261, con #223). Un solo libro: lo que entra y sale de verdad sigue siendo
 * Finanzas (los movimientos que ya registra, de cualquier cuenta: la caja, el banco, Belo…). El Monedero agrega encima
 * las cuentas (la caja, las suyas, la reserva, la inversión, una por arquetipo, agente o proyecto) y los asientos de
 * adentro: asignar, atribuir un ingreso, repartir. Así un gasto es una línea, no dos.
 *
 * Reglas (las que fijó él):
 * - los agentes y arquetipos no gastan: lo que generan va a sus propias arcas, y solo si él lo atribuye (nada se infiere);
 * - el Tesorero calcula, ordena y propone; no mueve plata: lo que propone (un reparto) espera su firma en Para validar;
 * - cada asiento dice quién lo firmó; un asiento propuesto por encima del tope no se firma solo;
 * - nada de custodia ni de cambio de monedas: el Monedero anota y firma, la plata está en sus cuentas de siempre.
 */
import { ajuste, fechaLocal, fijarAjuste, type Db } from './db.ts'

export type TipoCuenta = 'caja' | 'banco' | 'reserva' | 'inversion' | 'deuda' | 'arquetipo' | 'agente' | 'proyecto'
export type Cuenta = { id: number; clave: string; tipo: TipoCuenta; nombre: string; moneda: string; saldoInicial: number; desde: string | null; tasa: number | null; riesgo: string | null; frenada: boolean }
export type Asiento = { id: number; fecha: string; desde: string; hacia: string; monto: number; moneda: string; motivo: string; tipo: string; movimientoId: number | null; estado: 'firmado' | 'propuesto' | 'rechazado'; firmadoPor: string | null; creadoEn: number; firmadoEn: number | null }

const ESQUEMA = `CREATE TABLE IF NOT EXISTS tesoro_cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'EUR',
  saldo_inicial REAL NOT NULL DEFAULT 0,
  desde TEXT,
  tasa REAL,
  riesgo TEXT,
  frenada INTEGER NOT NULL DEFAULT 0,
  creada_en INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tesoro_asientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  desde TEXT NOT NULL,
  hacia TEXT NOT NULL,
  monto REAL NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'EUR',
  motivo TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL,
  movimiento_id INTEGER,
  estado TEXT NOT NULL DEFAULT 'firmado',
  firmado_por TEXT,
  creado_en INTEGER NOT NULL,
  firmado_en INTEGER
);
CREATE INDEX IF NOT EXISTS tesoro_asientos_mov ON tesoro_asientos (movimiento_id, tipo);
CREATE TABLE IF NOT EXISTS tesoro_metas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monto REAL NOT NULL,
  fecha TEXT NOT NULL,
  nota TEXT,
  estado TEXT NOT NULL DEFAULT 'activa',
  creada_en INTEGER NOT NULL
);`
const listos = new WeakSet<Db>()
function asegurar(db: Db) {
  if (listos.has(db)) return
  db.exec(ESQUEMA)
  listos.add(db)
  const ins = db.prepare(`INSERT OR IGNORE INTO tesoro_cuentas (clave, tipo, nombre, creada_en) VALUES (?, ?, ?, ?)`)
  ins.run('caja', 'caja', 'Caja (lo tuyo sin cuenta)', Date.now())
  ins.run('reserva', 'reserva', 'Reserva', Date.now())
  ins.run('inversion', 'inversion', 'Inversión', Date.now())
}

const r2 = (n: number) => Math.round(n * 100) / 100
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const deCuenta = (r: any): Cuenta => ({ id: r.id, clave: r.clave, tipo: r.tipo, nombre: r.nombre, moneda: r.moneda, saldoInicial: r.saldo_inicial, desde: r.desde, tasa: r.tasa, riesgo: r.riesgo, frenada: r.frenada === 1 })
const deAsiento = (r: any): Asiento => ({ id: r.id, fecha: r.fecha, desde: r.desde, hacia: r.hacia, monto: r.monto, moneda: r.moneda, motivo: r.motivo, tipo: r.tipo, movimientoId: r.movimiento_id, estado: r.estado, firmadoPor: r.firmado_por, creadoEn: r.creado_en, firmadoEn: r.firmado_en })

// ─── cuentas ─────────────────────────────────────────────────────────────

/** La clave de la cuenta de un movimiento de Finanzas: su cuenta (Belo, el banco) o la caja si no dice. */
export const claveDeMovimiento = (cuenta: string | null) => (cuenta?.trim() ? `banco:${norm(cuenta)}` : 'caja')

/** Las cuentas de los movimientos (Belo, el banco…) aparecen solas; las de arquetipo, agente o proyecto, al usarlas. */
export function asegurarCuenta(db: Db, clave: string, o: { tipo?: TipoCuenta; nombre?: string; moneda?: string } = {}): Cuenta {
  asegurar(db)
  const ya = db.prepare('SELECT * FROM tesoro_cuentas WHERE clave = ?').get(clave)
  if (ya) return deCuenta(ya)
  const [pref, resto] = clave.includes(':') ? [clave.slice(0, clave.indexOf(':')), clave.slice(clave.indexOf(':') + 1)] : [clave, '']
  const tipo = o.tipo ?? (pref as TipoCuenta)
  // Una cuenta de Finanzas se llama como la escribió él («Belo», no «belo»).
  const deFinanzas = tipo === 'banco' && !o.nombre ? (db.prepare('SELECT DISTINCT cuenta FROM movimientos WHERE cuenta IS NOT NULL').all() as { cuenta: string }[]).find((m) => claveDeMovimiento(m.cuenta) === clave)?.cuenta : undefined
  const nombre = o.nombre ?? deFinanzas ?? (tipo === 'agente' ? (db.prepare('SELECT COALESCE(nombre, id) AS n FROM agentes WHERE id = ?').get(resto) as { n: string } | undefined)?.n ?? resto
    : tipo === 'arquetipo' ? (() => { try { return (db.prepare(`SELECT nombre FROM paginas WHERE tipo = 'arquetipo' AND clave = ?`).get(resto) as { nombre: string | null } | undefined)?.nombre ?? `Arquetipo ${resto.padStart(2, '0')}` } catch { return `Arquetipo ${resto.padStart(2, '0')}` } })()
      : tipo === 'proyecto' ? (db.prepare('SELECT nombre FROM entidades WHERE id = ?').get(Number(resto)) as { nombre: string } | undefined)?.nombre ?? `Proyecto ${resto}` : resto || clave)
  db.prepare('INSERT INTO tesoro_cuentas (clave, tipo, nombre, moneda, creada_en) VALUES (?, ?, ?, ?, ?)').run(clave, tipo, nombre, o.moneda ?? 'EUR', Date.now())
  return deCuenta(db.prepare('SELECT * FROM tesoro_cuentas WHERE clave = ?').get(clave))
}

/** Lo que él dice («el Racializador», «la celda 12», «Belo», «reserva») → la clave de su cuenta. */
export function resolverCuenta(db: Db, que: string): string | null {
  asegurar(db)
  const q = que.trim()
  if (!q) return null
  if (/^(caja|reserva|inversion|inversión)$/i.test(q)) return norm(q) === 'inversion' ? 'inversion' : norm(q)
  if (/^(agente|arquetipo|proyecto|banco|deuda):/.test(q)) return q
  if (/^[A-Z]{3}-\d{4}$/.test(q) && db.prepare('SELECT 1 FROM agentes WHERE id = ?').get(q)) return `agente:${q}`
  const celda = /^(celda|arquetipo)?\s*(\d{1,2})$/i.exec(q)
  if (celda && Number(celda[2]) >= 1 && Number(celda[2]) <= 72) return `arquetipo:${Number(celda[2])}`
  const n = norm(q).replace(/^(el|la|los|las)-/, '')
  const cuenta = (db.prepare('SELECT clave, nombre FROM tesoro_cuentas').all() as { clave: string; nombre: string }[]).find((c) => norm(c.nombre).replace(/^(el|la|los|las)-/, '') === n)
  if (cuenta) return cuenta.clave
  const agente = (db.prepare('SELECT id, nombre FROM agentes WHERE nombre IS NOT NULL').all() as { id: string; nombre: string }[]).find((a) => norm(a.nombre).includes(n))
  if (agente) return `agente:${agente.id}`
  try {
    const arq = (db.prepare(`SELECT clave, nombre FROM paginas WHERE tipo = 'arquetipo' AND nombre IS NOT NULL`).all() as { clave: string; nombre: string }[]).find((a) => norm(a.nombre).replace(/^(el|la|los|las)-/, '') === n)
    if (arq) return `arquetipo:${arq.clave}`
  } catch { /* sin páginas todavía */ }
  const proy = (db.prepare(`SELECT id, nombre FROM entidades WHERE tipo = 'proyecto'`).all() as { id: number; nombre: string }[]).find((e) => norm(e.nombre) === n)
  if (proy) return `proyecto:${proy.id}`
  const banco = (db.prepare('SELECT DISTINCT cuenta FROM movimientos WHERE cuenta IS NOT NULL').all() as { cuenta: string }[]).find((m) => norm(m.cuenta) === n)
  return banco ? claveDeMovimiento(banco.cuenta) : null
}

export function cambiarCuenta(db: Db, clave: string, c: { saldoInicial?: number; desde?: string; tasa?: number | null; riesgo?: string | null; frenada?: boolean; nombre?: string; tipo?: TipoCuenta }) {
  const cu = asegurarCuenta(db, clave, c.tipo ? { tipo: c.tipo } : {})
  db.prepare('UPDATE tesoro_cuentas SET saldo_inicial = ?, desde = ?, tasa = ?, riesgo = ?, frenada = ?, nombre = ? WHERE clave = ?').run(
    c.saldoInicial ?? cu.saldoInicial, c.desde ?? cu.desde ?? (c.saldoInicial != null ? fechaLocal() : null), c.tasa !== undefined ? c.tasa : cu.tasa, c.riesgo !== undefined ? c.riesgo : cu.riesgo,
    (c.frenada ?? cu.frenada) ? 1 : 0, c.nombre?.trim() || cu.nombre, clave)
  return asegurarCuenta(db, clave)
}

// ─── asientos ────────────────────────────────────────────────────────────

/** El tope por asiento que propone la máquina (sin tope fijado: 500). Por encima, nunca se firma solo. */
export const topeAsiento = (db: Db) => Number(ajuste(db, 'tesoro_tope') ?? 500) || 500

/**
 * Un asiento de adentro (de una cuenta a otra). Lo que ordena él queda firmado por él; lo que propone el Tesorero
 * queda propuesto hasta que lo firme. Una cuenta frenada no recibe nada. Los agentes y arquetipos no gastan: lo que sale
 * de sus arcas lo firma él siempre.
 */
export function asentar(db: Db, a: { desde: string; hacia: string; monto: number; moneda?: string; motivo?: string; tipo: string; movimientoId?: number | null; fecha?: string; por: 'operador' | 'tesorero' }, ahora = Date.now()): Asiento {
  asegurar(db)
  const monto = r2(Number(a.monto))
  if (!(monto > 0)) throw new Error('El monto tiene que ser positivo (el sentido lo dan «desde» y «hacia»).')
  if (a.desde === a.hacia) throw new Error('Desde y hacia son la misma cuenta.')
  const hacia = asegurarCuenta(db, a.hacia)
  asegurarCuenta(db, a.desde)
  if (hacia.frenada) throw new Error(`«${hacia.nombre}» tiene el freno de mano puesto: no recibe nada hasta que lo saques.`)
  const sale = /^(agente|arquetipo):/.test(a.desde)
  const firmado = a.por === 'operador' && !sale
  const id = Number(db.prepare(`INSERT INTO tesoro_asientos (fecha, desde, hacia, monto, moneda, motivo, tipo, movimiento_id, estado, firmado_por, creado_en, firmado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(a.fecha ?? fechaLocal(ahora), a.desde, a.hacia, monto, a.moneda ?? 'EUR', (a.motivo ?? '').slice(0, 300), a.tipo, a.movimientoId ?? null, firmado ? 'firmado' : 'propuesto', firmado ? 'operador' : null, ahora, firmado ? ahora : null).lastInsertRowid)
  return deAsiento(db.prepare('SELECT * FROM tesoro_asientos WHERE id = ?').get(id))
}

/** Él firma (o rechaza) lo que propuso el Tesorero. */
export function firmar(db: Db, id: number, si: boolean, ahora = Date.now()): Asiento {
  asegurar(db)
  const a = db.prepare('SELECT * FROM tesoro_asientos WHERE id = ?').get(id) as any
  if (!a) throw new Error(`No existe el asiento ${id}`)
  if (a.estado !== 'propuesto') return deAsiento(a)
  if (si && asegurarCuenta(db, a.hacia).frenada) throw new Error('La cuenta de destino tiene el freno de mano puesto.')
  db.prepare('UPDATE tesoro_asientos SET estado = ?, firmado_por = ?, firmado_en = ? WHERE id = ?').run(si ? 'firmado' : 'rechazado', 'operador', ahora, id)
  return deAsiento(db.prepare('SELECT * FROM tesoro_asientos WHERE id = ?').get(id))
}

export const asientosPropuestos = (db: Db): Asiento[] => { asegurar(db); return (db.prepare(`SELECT * FROM tesoro_asientos WHERE estado = 'propuesto' ORDER BY id`).all() as any[]).map(deAsiento) }

/**
 * Un ingreso que generó un agente, un arquetipo o un proyecto va a sus arcas (#223). Solo si él lo dice: el movimiento
 * es de verdad (está en su cuenta), y el asiento lo pasa de la cuenta donde entró a las arcas de quien lo generó.
 */
export function atribuirIngreso(db: Db, movimientoId: number, hacia: string, ahora = Date.now()): Asiento {
  asegurar(db)
  const m = db.prepare('SELECT id, monto, moneda, cuenta, descripcion, fecha FROM movimientos WHERE id = ?').get(movimientoId) as any
  if (!m) throw new Error(`No existe el movimiento ${movimientoId}`)
  if (!(m.monto > 0)) throw new Error('Solo se atribuye un ingreso (este movimiento es un gasto).')
  if (!/^(agente|arquetipo|proyecto):/.test(hacia)) throw new Error('Un ingreso se atribuye a un agente, un arquetipo o un proyecto.')
  const ya = db.prepare(`SELECT id FROM tesoro_asientos WHERE movimiento_id = ? AND tipo = 'atribucion' AND estado != 'rechazado'`).get(movimientoId) as { id: number } | undefined
  if (ya) db.prepare(`UPDATE tesoro_asientos SET estado = 'rechazado', motivo = motivo || ' (reatribuido)' WHERE id = ?`).run(ya.id)
  return asentar(db, { desde: claveDeMovimiento(m.cuenta), hacia, monto: m.monto, moneda: m.moneda, motivo: `Generó: ${m.descripcion}`, tipo: 'atribucion', movimientoId, fecha: m.fecha, por: 'operador' }, ahora)
}

// ─── saldos y patrimonio ─────────────────────────────────────────────────

/** El saldo de una cuenta a una fecha: su saldo inicial + los movimientos de Finanzas de esa cuenta + los asientos firmados. */
export function saldo(db: Db, clave: string, hasta = fechaLocal()): number {
  asegurar(db)
  const c = asegurarCuenta(db, clave)
  let s = c.desde && c.desde > hasta ? 0 : c.saldoInicial
  if (c.tipo === 'caja' || c.tipo === 'banco') {
    // Los nombres de cuenta de Finanzas que caen en esta (sin importar mayúsculas ni tildes), y la suma en SQL.
    const nombres = (db.prepare('SELECT DISTINCT cuenta FROM movimientos WHERE cuenta IS NOT NULL').all() as { cuenta: string }[]).map((m) => m.cuenta).filter((n) => claveDeMovimiento(n) === clave)
    const cond = c.tipo === 'caja' ? `(cuenta IS NULL OR TRIM(cuenta) = '')` : nombres.length ? `cuenta IN (${nombres.map(() => '?').join(',')})` : '0'
    s += (db.prepare(`SELECT COALESCE(SUM(monto), 0) AS n FROM movimientos WHERE ${cond} AND fecha <= ? AND fecha >= ? AND moneda = ?`).get(...(c.tipo === 'caja' ? [] : nombres), hasta, c.desde ?? '0000', c.moneda) as { n: number }).n
  }
  const ent = db.prepare(`SELECT COALESCE(SUM(monto), 0) AS n FROM tesoro_asientos WHERE hacia = ? AND estado = 'firmado' AND fecha <= ?`).get(clave, hasta) as { n: number }
  const sal = db.prepare(`SELECT COALESCE(SUM(monto), 0) AS n FROM tesoro_asientos WHERE desde = ? AND estado = 'firmado' AND fecha <= ?`).get(clave, hasta) as { n: number }
  return r2(s + ent.n - sal.n)
}

/** El saldo de una cuenta que puede no existir todavía (0, sin crearla: mirar no abre cuentas). */
export function saldoSiExiste(db: Db, clave: string): number {
  asegurar(db)
  return db.prepare('SELECT 1 FROM tesoro_cuentas WHERE clave = ?').get(clave) ? saldo(db, clave) : 0
}

/** Las cuentas con su saldo. Las de los movimientos (Belo, el banco) aparecen solas. */
export function cuentasConSaldo(db: Db, hasta = fechaLocal()) {
  asegurar(db)
  for (const m of db.prepare('SELECT DISTINCT cuenta, moneda FROM movimientos WHERE cuenta IS NOT NULL').all() as { cuenta: string; moneda: string }[]) asegurarCuenta(db, claveDeMovimiento(m.cuenta), { tipo: 'banco', nombre: m.cuenta, moneda: m.moneda })
  return (db.prepare('SELECT * FROM tesoro_cuentas ORDER BY id').all() as any[]).map(deCuenta).map((c) => ({ ...c, saldo: saldo(db, c.clave, hasta) }))
}

/**
 * El patrimonio a una fecha, por moneda: lo propio de él (caja, bancos, reserva, inversión, menos deudas). Las arcas de
 * agentes, arquetipos y proyectos son una parte de eso (la plata salió de sus cuentas), así que se muestran aparte y no
 * se suman dos veces.
 */
export function patrimonio(db: Db, hasta = fechaLocal()) {
  const cs = cuentasConSaldo(db, hasta)
  const propias = cs.filter((c) => ['caja', 'banco', 'reserva', 'inversion', 'deuda'].includes(c.tipo))
  const porMoneda: Record<string, number> = {}
  for (const c of propias) porMoneda[c.moneda] = r2((porMoneda[c.moneda] ?? 0) + c.saldo)
  const arcas = cs.filter((c) => ['agente', 'arquetipo', 'proyecto'].includes(c.tipo) && c.saldo !== 0)
  return { fecha: hasta, total: porMoneda.EUR ?? 0, porMoneda, activos: r2(propias.filter((c) => c.saldo > 0).reduce((s, c) => s + (c.moneda === 'EUR' ? c.saldo : 0), 0)), pasivos: r2(-propias.filter((c) => c.saldo < 0).reduce((s, c) => s + (c.moneda === 'EUR' ? c.saldo : 0), 0)), cuentas: propias, arcas }
}

const finDeMes = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`

/** La serie mensual (en EUR) de los últimos meses, y si cayó dos meses seguidos (la alerta). */
export function serieMensual(db: Db, meses = 12, ahora = Date.now()) {
  const hoy = fechaLocal(ahora)
  const [y, m] = hoy.split('-').map(Number)
  const serie: { mes: string; total: number }[] = []
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    const fin = i === 0 ? hoy : finDeMes(d.getUTCFullYear(), d.getUTCMonth() + 1)
    serie.push({ mes: fin.slice(0, 7), total: patrimonio(db, fin).total })
  }
  const n = serie.length
  const cae = n >= 3 && serie[n - 1].total < serie[n - 2].total && serie[n - 2].total < serie[n - 3].total
  return { serie, alerta: cae ? `El patrimonio cayó dos meses seguidos: ${serie[n - 3].total} → ${serie[n - 2].total} → ${serie[n - 1].total} €.` : null }
}

/** Lo que dejó quieto, a interés compuesto (con su riesgo dicho al lado): cuánto sería en `meses`. */
export function proyeccion(db: Db, meses = 12) {
  return cuentasConSaldo(db).filter((c) => c.tasa != null && c.saldo > 0).map((c) => ({
    cuenta: c.nombre, saldo: c.saldo, tasaAnual: c.tasa, riesgo: c.riesgo ?? 'sin decir: preguntale cuál es',
    en: meses, seria: r2(c.saldo * Math.pow(1 + (c.tasa! / 100) / 12, meses)), ganancia: r2(c.saldo * Math.pow(1 + (c.tasa! / 100) / 12, meses) - c.saldo),
  }))
}

// ─── reparto y metas ─────────────────────────────────────────────────────

export type Reparto = { reserva: number; inversion: number }
export const leerReparto = (db: Db): Reparto | null => { try { const r = JSON.parse(ajuste(db, 'tesoro_reparto') ?? 'null'); return r && (r.reserva > 0 || r.inversion > 0) ? r : null } catch { return null } }
export function fijarReparto(db: Db, r: Reparto) {
  const reserva = Math.max(0, Math.min(100, Number(r.reserva) || 0)), inversion = Math.max(0, Math.min(100, Number(r.inversion) || 0))
  if (reserva + inversion > 100) throw new Error('Reserva más inversión no puede pasar el 100 %.')
  fijarAjuste(db, 'tesoro_reparto', JSON.stringify({ reserva, inversion }))
  return { reserva, inversion, gasto: 100 - reserva - inversion }
}

/**
 * Cada ingreso nuevo (desde que fijó la regla) se reparte: el Tesorero propone los asientos a reserva e inversión y
 * esperan su firma. Un ingreso ya repartido (o atribuido a otro) no se vuelve a repartir.
 */
export function proponerRepartos(db: Db, ahora = Date.now()): Asiento[] {
  asegurar(db)
  const r = leerReparto(db)
  if (!r) return []
  const desde = ajuste(db, 'tesoro_reparto_desde') ?? fechaLocal(ahora)
  if (!ajuste(db, 'tesoro_reparto_desde')) fijarAjuste(db, 'tesoro_reparto_desde', desde)
  const ingresos = db.prepare(`SELECT id, monto, moneda, cuenta, descripcion, fecha FROM movimientos m WHERE monto > 0 AND fecha >= ?
      AND NOT EXISTS (SELECT 1 FROM tesoro_asientos a WHERE a.movimiento_id = m.id AND a.tipo IN ('reparto', 'atribucion'))`).all(desde) as any[]
  const out: Asiento[] = []
  for (const m of ingresos) {
    for (const [hacia, pct] of [['reserva', r.reserva], ['inversion', r.inversion]] as const) {
      const monto = r2((m.monto * pct) / 100)
      if (monto > 0) out.push(asentar(db, { desde: claveDeMovimiento(m.cuenta), hacia, monto, moneda: m.moneda, motivo: `${pct} % de «${m.descripcion}»`, tipo: 'reparto', movimientoId: m.id, fecha: m.fecha, por: 'tesorero' }, ahora))
    }
  }
  return out
}

export function fijarMeta(db: Db, monto: number, fecha: string, nota?: string | null, ahora = Date.now()) {
  asegurar(db)
  if (!(monto > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('La meta es un monto positivo con su fecha (YYYY-MM-DD).')
  db.prepare(`UPDATE tesoro_metas SET estado = 'reemplazada' WHERE estado = 'activa' AND fecha = ?`).run(fecha)
  db.prepare('INSERT INTO tesoro_metas (monto, fecha, nota, creada_en) VALUES (?, ?, ?, ?)').run(r2(monto), fecha, nota ?? null, ahora)
  return metas(db, ahora)
}

/** Cada meta con cuánto falta y a qué ritmo por mes. */
export function metas(db: Db, ahora = Date.now()) {
  asegurar(db)
  const actual = patrimonio(db, fechaLocal(ahora)).total
  return (db.prepare(`SELECT * FROM tesoro_metas WHERE estado = 'activa' ORDER BY fecha`).all() as any[]).map((x) => {
    const meses = Math.max(1, Math.round((Date.parse(`${x.fecha}T12:00:00`) - ahora) / (30.44 * 86_400_000)))
    const falta = r2(Math.max(0, x.monto - actual))
    return { id: x.id, monto: x.monto, fecha: x.fecha, nota: x.nota, actual, falta, porMes: r2(falta / meses), avance: x.monto ? Math.min(100, Math.round((actual / x.monto) * 100)) : 0 }
  })
}

// ─── lo que generó cada uno (#223) y el parte ───────────────────────────

/** Cuánto generó cada agente, arquetipo o proyecto (lo atribuido a sus arcas), desde una fecha. */
export function generado(db: Db, desde = '0000-00-00') {
  asegurar(db)
  return (db.prepare(`SELECT a.hacia AS clave, c.nombre, c.tipo, ROUND(SUM(a.monto), 2) AS total, COUNT(*) AS ingresos FROM tesoro_asientos a JOIN tesoro_cuentas c ON c.clave = a.hacia
      WHERE a.tipo = 'atribucion' AND a.estado = 'firmado' AND a.fecha >= ? GROUP BY a.hacia ORDER BY total DESC`).all(desde) as { clave: string; nombre: string; tipo: string; total: number; ingresos: number }[])
}

/** Todo junto, para la pantalla y el chat. */
export function verMonedero(db: Db, ahora = Date.now()) {
  const hoy = fechaLocal(ahora)
  const p = patrimonio(db, hoy)
  const s = serieMensual(db, 12, ahora)
  return {
    patrimonio: p, serie: s.serie, alerta: s.alerta, metas: metas(db, ahora), reparto: leerReparto(db), tope: topeAsiento(db),
    // Sin saldo inicial, una cuenta con movimientos solo suma flujos: el patrimonio no es real hasta que lo diga.
    sinSaldoInicial: p.cuentas.filter((c) => (c.tipo === 'caja' || c.tipo === 'banco') && !c.desde && c.saldo !== 0).map((c) => c.nombre),
    propuestos: asientosPropuestos(db), generadoMes: generado(db, `${hoy.slice(0, 7)}-01`), generadoTotal: generado(db),
    proyeccion: proyeccion(db), ultimos: (db.prepare(`SELECT * FROM tesoro_asientos ORDER BY id DESC LIMIT 20`).all() as any[]).map(deAsiento),
    sinAtribuir: (db.prepare(`SELECT id, fecha, monto, moneda, descripcion FROM movimientos m WHERE monto > 0 AND fecha >= ? AND NOT EXISTS (SELECT 1 FROM tesoro_asientos a WHERE a.movimiento_id = m.id AND a.tipo = 'atribucion' AND a.estado != 'rechazado') ORDER BY fecha DESC LIMIT 15`).all(`${hoy.slice(0, 7)}-01`) as any[]),
  }
}

/** El parte del mes (sin modelo): patrimonio, cómo se movió, lo que generó cada uno, las metas y la alerta. */
export function parteMensual(db: Db, ahora = Date.now()): string {
  const v = verMonedero(db, ahora)
  const [ant, act] = [v.serie.at(-2), v.serie.at(-1)]
  const dif = ant && act ? r2(act.total - ant.total) : null
  const mesPasado = (() => { const d = new Date(ahora); d.setDate(0); return fechaLocal(d.getTime()).slice(0, 7) })()
  const gen = generado(db, `${mesPasado}-01`)
  return [
    `💰 **Parte del Tesorero**: patrimonio ${v.patrimonio.total.toLocaleString('es-AR')} €${dif != null ? ` (${dif >= 0 ? '+' : ''}${dif.toLocaleString('es-AR')} € contra el mes anterior)` : ''}.`,
    Object.keys(v.patrimonio.porMoneda).filter((m) => m !== 'EUR').length ? `En otras monedas: ${Object.entries(v.patrimonio.porMoneda).filter(([m]) => m !== 'EUR').map(([m, n]) => `${n} ${m}`).join(' · ')}.` : '',
    v.patrimonio.cuentas.filter((c) => c.saldo).map((c) => `- ${c.nombre}: ${c.saldo.toLocaleString('es-AR')} ${c.moneda}`).join('\n'),
    gen.length ? `Lo que generó cada uno desde el 1 de ${mesPasado}:\n${gen.map((g) => `- ${g.nombre}: ${g.total.toLocaleString('es-AR')} € (${g.ingresos} ingreso${g.ingresos === 1 ? '' : 's'})`).join('\n')}` : 'Nadie tiene ingresos atribuidos este período (se atribuyen con «este ingreso lo generó …»).',
    v.metas.length ? v.metas.map((m) => `Meta ${m.monto.toLocaleString('es-AR')} € al ${m.fecha}: ${m.avance} %, faltan ${m.falta.toLocaleString('es-AR')} € (${m.porMes.toLocaleString('es-AR')} € por mes).`).join('\n') : '',
    v.propuestos.length ? `${v.propuestos.length} asiento${v.propuestos.length === 1 ? '' : 's'} esperan tu firma en Para validar.` : '',
    v.alerta ? `⚠ ${v.alerta}` : '',
  ].filter(Boolean).join('\n\n')
}

/** Para la bandeja: los asientos que esperan su firma. */
export function propuestosParaBandeja(db: Db) {
  const ps = asientosPropuestos(db)
  const nombre = (clave: string) => (db.prepare('SELECT nombre FROM tesoro_cuentas WHERE clave = ?').get(clave) as { nombre: string } | undefined)?.nombre ?? clave
  const tope = topeAsiento(db)
  return { n: ps.length, items: ps.slice(0, 12).map((a) => ({ id: a.id, texto: `${a.monto.toLocaleString('es-AR')} ${a.moneda}: ${nombre(a.desde)} → ${nombre(a.hacia)}${a.monto > tope ? ' (pasa el tope)' : ''}`, sub: a.motivo })) }
}
