/**
 * Encuestas y cuotas (Fragua #263): comparar y avisar, para un evento (una elección, un partido). Solo información:
 * apostar es plata y va por el Monedero con su tope, nunca por el chat.
 * - Mercados separados y nunca mezclados («X más votado», «Y presidente», «A+B con mayoría»): cada uno con sus
 *   resultados posibles (sí/no, o varios).
 * - Cuota ↔ probabilidad: 1,10 es 90,9 % implícita. El margen de la casa (overround) por mercado es la suma de las
 *   implícitas de todos sus resultados menos 1; la probabilidad «justa» le saca ese margen. Una casa que solo publica
 *   el «sí» no deja calcular su margen: se dice.
 * - Comparador: para cada resultado, qué casa paga más; el consenso (promedio de las justas) y el desvío de cada casa.
 *   Una casa que se aparta del consenso más que el umbral (ajuste mercados_umbral, 5 puntos) se avisa: la oportunidad.
 * - Encuestas: encuestadora, muestra, fechas de campo y cifras; promedio móvil de las últimas cinco con la dispersión.
 * - Histórico: cada cuota y cada encuesta quedan con su fecha (cómo se movió día a día).
 * Las cuotas las carga él (texto o captura al bot, que Mastropiero pasa a anotar_cuotas) o un comparador público; las
 * encuestas, también desde una tabla pública (Wikipedia) con importarEncuestas.
 */
import { ajuste, fechaLocal, json, type Db } from './db.ts'

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS mercados (
  id INTEGER PRIMARY KEY AUTOINCREMENT, evento TEXT NOT NULL, nombre TEXT NOT NULL, resultados TEXT NOT NULL DEFAULT '["sí","no"]',
  cierra TEXT, resultado_final TEXT, creado_en INTEGER NOT NULL, UNIQUE (evento, nombre)
);
CREATE TABLE IF NOT EXISTS mercado_cuotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mercado_id INTEGER NOT NULL, casa TEXT NOT NULL, resultado TEXT NOT NULL, cuota REAL NOT NULL,
  en INTEGER NOT NULL, fuente TEXT
);
CREATE INDEX IF NOT EXISTS mercado_cuotas_i ON mercado_cuotas(mercado_id, casa, resultado, en);
CREATE TABLE IF NOT EXISTS mercado_encuestas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, evento TEXT NOT NULL, encuestadora TEXT NOT NULL, campo_desde TEXT, campo_hasta TEXT NOT NULL,
  muestra INTEGER, cifras TEXT NOT NULL, fuente TEXT, cargada_en INTEGER NOT NULL, UNIQUE (evento, encuestadora, campo_hasta)
);`
const listos = new WeakSet<Db>()
function asegurar(db: Db) { if (!listos.has(db)) { db.exec(ESQUEMA); listos.add(db) } }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const r1 = (n: number) => Math.round(n * 10) / 10

// ─── las cuentas ─────────────────────────────────────────────────────────

/** Probabilidad implícita (0–1) de una cuota decimal. */
export const implicita = (cuota: number) => (cuota > 1 ? 1 / cuota : 1)
/** Lo que devuelve y lo que gana una apuesta: 10.000 a 1,16 devuelve 11.600 y gana 1.600 (antes de impuestos). */
export function retorno(monto: number, cuota: number) { return { devuelve: Math.round(monto * cuota * 100) / 100, gana: Math.round(monto * (cuota - 1) * 100) / 100 } }
/** El valor esperado por euro apostado a esa cuota, con una probabilidad dada (0–1): >0 conviene, <0 no. */
export const valorEsperado = (cuota: number, prob: number) => Math.round((prob * cuota - 1) * 1000) / 1000

// ─── mercados y cuotas ──────────────────────────────────────────────────

export type Mercado = { id: number; evento: string; nombre: string; resultados: string[]; cierra: string | null; resultadoFinal: string | null }
const deMercado = (r: any): Mercado => ({ id: r.id, evento: r.evento, nombre: r.nombre, resultados: json<string[]>(r.resultados, ['sí', 'no']), cierra: r.cierra, resultadoFinal: r.resultado_final })

/** Un mercado de un evento (si ya existe con ese nombre, el mismo). resultados: por defecto sí/no. */
export function asegurarMercado(db: Db, m: { evento: string; nombre: string; resultados?: string[]; cierra?: string | null }, ahora = Date.now()): Mercado {
  asegurar(db)
  const evento = String(m.evento ?? '').trim().slice(0, 60), nombre = String(m.nombre ?? '').trim().slice(0, 120)
  if (!evento || !nombre) throw new Error('Un mercado necesita evento y nombre («29N», «Feijóo presidente»)')
  const ya = (db.prepare('SELECT * FROM mercados WHERE evento = ?').all(evento) as any[]).find((r) => norm(r.nombre) === norm(nombre))
  if (ya) return deMercado(ya)
  const resultados = (m.resultados?.length ? m.resultados : ['sí', 'no']).map((x) => String(x).trim().slice(0, 60)).filter(Boolean)
  const id = Number(db.prepare('INSERT INTO mercados (evento, nombre, resultados, cierra, creado_en) VALUES (?, ?, ?, ?, ?)').run(evento, nombre, JSON.stringify(resultados), /^\d{4}-\d{2}-\d{2}$/.test(String(m.cierra)) ? String(m.cierra) : null, ahora).lastInsertRowid)
  return deMercado(db.prepare('SELECT * FROM mercados WHERE id = ?').get(id))
}
export function listarMercados(db: Db, evento?: string | null): Mercado[] {
  asegurar(db)
  return (evento ? db.prepare('SELECT * FROM mercados WHERE evento = ? ORDER BY id').all(evento) : db.prepare('SELECT * FROM mercados WHERE resultado_final IS NULL ORDER BY evento, id').all()).map(deMercado)
}
function buscarMercado(db: Db, mercado: number | string, evento?: string | null): Mercado | null {
  asegurar(db)
  if (typeof mercado === 'number' || /^\d+$/.test(String(mercado))) { const r = db.prepare('SELECT * FROM mercados WHERE id = ?').get(Number(mercado)); return r ? deMercado(r) : null }
  const xs = listarMercados(db, evento ?? null)
  return xs.find((x) => norm(x.nombre) === norm(String(mercado))) ?? xs.find((x) => norm(x.nombre).includes(norm(String(mercado)))) ?? null
}

/** Anota las cuotas de una casa para un mercado (cada una con su resultado). Se guardan todas: es el histórico. */
export function anotarCuotas(db: Db, a: { mercado: number | string; evento?: string | null; casa: string; cuotas: { resultado: string; cuota: number | string }[]; fuente?: string | null }, ahora = Date.now()) {
  const m = buscarMercado(db, a.mercado, a.evento)
  if (!m) throw new Error(`No encuentro el mercado «${a.mercado}». Crealo primero (evento y nombre).`)
  const casa = String(a.casa ?? '').trim().slice(0, 60)
  if (!casa) throw new Error('Falta la casa')
  let n = 0
  for (const c of a.cuotas ?? []) {
    const cuota = Number(String(c.cuota).replace(',', '.'))
    const res = m.resultados.find((x) => norm(x) === norm(String(c.resultado))) ?? (m.resultados.length === 2 && /^(si|sí|yes|gana)$/i.test(String(c.resultado).trim()) ? m.resultados[0] : null)
    if (!res) throw new Error(`«${c.resultado}» no es un resultado de «${m.nombre}» (${m.resultados.join(', ')})`)
    if (!(cuota > 1 && cuota < 1000)) throw new Error(`Cuota inválida: ${c.cuota} (las cuotas decimales van de 1,01 para arriba)`)
    db.prepare('INSERT INTO mercado_cuotas (mercado_id, casa, resultado, cuota, en, fuente) VALUES (?, ?, ?, ?, ?, ?)').run(m.id, casa, res, cuota, ahora, a.fuente?.slice(0, 200) ?? null)
    n++
  }
  return { mercado: m.nombre, casa, anotadas: n }
}

export type Casa = { casa: string; cuotas: Record<string, number>; margen: number | null; justas: Record<string, number> | null; en: number }
/** Las últimas cuotas de cada casa (hasta `hasta`), con su margen y sus probabilidades justas si publicó todos los resultados. */
export function casasDe(db: Db, m: Mercado, hasta = Date.now()): Casa[] {
  const filas = db.prepare(`SELECT casa, resultado, cuota, en FROM mercado_cuotas c WHERE mercado_id = ? AND en <= ? AND en = (SELECT MAX(en) FROM mercado_cuotas d WHERE d.mercado_id = c.mercado_id AND d.casa = c.casa AND d.resultado = c.resultado AND d.en <= ?)`).all(m.id, hasta, hasta) as { casa: string; resultado: string; cuota: number; en: number }[]
  const por = new Map<string, Casa>()
  for (const f of filas) {
    const x = por.get(f.casa) ?? { casa: f.casa, cuotas: {}, margen: null, justas: null, en: 0 }
    x.cuotas[f.resultado] = f.cuota
    x.en = Math.max(x.en, f.en)
    por.set(f.casa, x)
  }
  for (const x of por.values()) {
    if (m.resultados.every((r) => x.cuotas[r])) {
      const suma = m.resultados.reduce((s, r) => s + implicita(x.cuotas[r]), 0)
      x.margen = r1((suma - 1) * 100)
      x.justas = Object.fromEntries(m.resultados.map((r) => [r, implicita(x.cuotas[r]) / suma]))
    }
  }
  return [...por.values()].sort((a, b) => a.casa.localeCompare(b.casa))
}

/**
 * El mercado entero: por resultado, la mejor cuota y su casa, el consenso (la mediana de las probabilidades justas de
 * las casas; si una no deja calcular su margen, su implícita) y el desvío de cada casa contra ese consenso. La mediana y
 * no el promedio: con pocas casas, una que se aparta mucho arrastraría el promedio y haría parecer raras a las demás.
 * Con «desde», el movimiento del consenso desde entonces.
 */
export function analizarMercado(db: Db, mercado: number | string, o: { ahora?: number; desde?: number; evento?: string | null } = {}) {
  const m = buscarMercado(db, mercado, o.evento)
  if (!m) throw new Error(`No encuentro el mercado «${mercado}»`)
  const ahora = o.ahora ?? Date.now()
  const umbral = Number(ajuste(db, 'mercados_umbral') ?? 5) || 5
  const casas = casasDe(db, m, ahora)
  const probDe = (c: Casa, r: string) => (c.justas ? c.justas[r] : c.cuotas[r] ? implicita(c.cuotas[r]) : null)
  const mediana = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2 }
  const consensoDe = (cs: Casa[], r: string) => mediana(cs.map((c) => probDe(c, r)).filter((p): p is number => p != null))
  const antes = o.desde != null ? casasDe(db, m, o.desde) : null
  const resultados = m.resultados.map((r) => {
    const conCuota = casas.filter((c) => c.cuotas[r])
    const mejor = conCuota.sort((a, b) => b.cuotas[r] - a.cuotas[r])[0] ?? null
    const consenso = consensoDe(casas, r)
    const consensoAntes = antes ? consensoDe(antes, r) : null
    // Con una sola casa no hay contra qué comparar.
    const desvios = casas.filter((c) => probDe(c, r) != null && casas.length > 1).map((c) => ({ casa: c.casa, prob: r1(probDe(c, r)! * 100), desvio: consenso == null ? null : r1((probDe(c, r)! - consenso) * 100) }))
    return {
      resultado: r,
      consenso: consenso == null ? null : r1(consenso * 100),
      movimiento: consenso != null && consensoAntes != null ? r1((consenso - consensoAntes) * 100) : null,
      mejor: mejor ? { casa: mejor.casa, cuota: mejor.cuotas[r], implicita: r1(implicita(mejor.cuotas[r]) * 100), valorEsperado: consenso == null ? null : valorEsperado(mejor.cuotas[r], consenso) } : null,
      desvios,
      avisos: desvios.filter((d) => d.desvio != null && Math.abs(d.desvio) >= umbral),
    }
  })
  return { mercado: m, umbral, casas: casas.map((c) => ({ casa: c.casa, cuotas: c.cuotas, margen: c.margen, actualizada: fechaLocal(c.en) })), resultados }
}

// ─── encuestas ──────────────────────────────────────────────────────────

export type Encuesta = { id: number; evento: string; encuestadora: string; campoDesde: string | null; campoHasta: string; muestra: number | null; cifras: Record<string, number>; fuente: string | null }
const deEncuesta = (r: any): Encuesta => ({ id: r.id, evento: r.evento, encuestadora: r.encuestadora, campoDesde: r.campo_desde, campoHasta: r.campo_hasta, muestra: r.muestra, cifras: json(r.cifras, {}), fuente: r.fuente })

/** Anota encuestas (la misma encuestadora con el mismo fin de campo no se repite: se actualiza). */
export function anotarEncuestas(db: Db, evento: string, xs: { encuestadora: string; campoDesde?: string | null; campoHasta: string; muestra?: number | string | null; cifras: Record<string, number | string>; fuente?: string | null }[], ahora = Date.now()) {
  asegurar(db)
  let nuevas = 0, actualizadas = 0
  for (const x of xs) {
    const casa = String(x.encuestadora ?? '').trim().slice(0, 80)
    if (!casa || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.campoHasta))) continue
    const cifras = Object.fromEntries(Object.entries(x.cifras ?? {}).map(([k, v]) => [String(k).trim().slice(0, 40), Number(String(v).replace(',', '.').replace('%', ''))]).filter(([k, v]) => k && Number.isFinite(v as number) && (v as number) >= 0 && (v as number) <= 100))
    if (!Object.keys(cifras).length) continue
    const muestra = x.muestra == null || x.muestra === '' ? null : Math.round(Number(String(x.muestra).replace(/[.\s]/g, ''))) || null
    const ya = db.prepare('SELECT id FROM mercado_encuestas WHERE evento = ? AND encuestadora = ? AND campo_hasta = ?').get(evento, casa, x.campoHasta)
    db.prepare(`INSERT INTO mercado_encuestas (evento, encuestadora, campo_desde, campo_hasta, muestra, cifras, fuente, cargada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (evento, encuestadora, campo_hasta) DO UPDATE SET campo_desde = excluded.campo_desde, muestra = excluded.muestra, cifras = excluded.cifras, fuente = COALESCE(excluded.fuente, fuente)`)
      .run(evento, casa, /^\d{4}-\d{2}-\d{2}$/.test(String(x.campoDesde)) ? x.campoDesde! : null, x.campoHasta, muestra, JSON.stringify(cifras), x.fuente?.slice(0, 300) ?? null, ahora)
    if (ya) actualizadas++; else nuevas++
  }
  return { nuevas, actualizadas }
}

/** El promedio de las últimas n encuestas por opción, con la dispersión (desvío estándar, mínimo y máximo). */
export function promedioEncuestas(db: Db, evento: string, n = 5, hasta?: string) {
  asegurar(db)
  const xs = (db.prepare(`SELECT * FROM mercado_encuestas WHERE evento = ? ${hasta ? 'AND campo_hasta <= ?' : ''} ORDER BY campo_hasta DESC, id DESC LIMIT ?`).all(...(hasta ? [evento, hasta, n] : [evento, n])) as any[]).map(deEncuesta)
  const opciones = [...new Set(xs.flatMap((e) => Object.keys(e.cifras)))]
  const filas = opciones.map((op) => {
    const vs = xs.map((e) => e.cifras[op]).filter((v): v is number => v != null)
    const prom = vs.reduce((a, b) => a + b, 0) / vs.length
    const desvio = Math.sqrt(vs.reduce((s, v) => s + (v - prom) ** 2, 0) / vs.length)
    return { opcion: op, promedio: r1(prom), desvio: r1(desvio), min: Math.min(...vs), max: Math.max(...vs), encuestas: vs.length }
  }).sort((a, b) => b.promedio - a.promedio)
  return { evento, ultimas: xs.map((e) => ({ encuestadora: e.encuestadora, campo: `${e.campoDesde ? `${e.campoDesde} a ` : ''}${e.campoHasta}`, muestra: e.muestra, cifras: e.cifras })), promedio: filas }
}

/** Para las pruebas: leer una página y sacarle la tabla de encuestas con el modelo. */
let extraer = async (db: Db, url: string): Promise<{ encuestadora: string; campoDesde?: string; campoHasta: string; muestra?: number; cifras: Record<string, number> }[]> => {
  const l = await (await import('./lector/index.ts')).leer(url)
  const { pedirJson } = await import('./modelo.ts')
  const { datos } = await pedirJson<{ encuestas?: any[] }>({ db, clase: 'mastropiero', agenteId: 'encuestas' },
    'Sacás la tabla de encuestas de una página. Solo las filas que están en el texto, tal cual (nada inventado). Cada una: encuestadora (sin el medio si va aparte), campoDesde y campoHasta (YYYY-MM-DD; si hay un solo día, va en los dos), muestra (número o null), cifras (opción → porcentaje, solo números). Las 30 más recientes. Devolvé {"encuestas":[…]}.',
    l.markdown.slice(0, 60_000), { temperatura: 0, maxTokens: 6000, largo: true })
  return Array.isArray(datos.encuestas) ? datos.encuestas : []
}
export function _probarExtraer(f: typeof extraer) { extraer = f }
export async function importarEncuestas(db: Db, evento: string, url: string, ahora = Date.now()) {
  const xs = await extraer(db, url)
  return { leidas: xs.length, ...anotarEncuestas(db, evento, xs.map((x) => ({ ...x, fuente: url })), ahora) }
}

// ─── el informe y los avisos ────────────────────────────────────────────

const pct = (n: number | null) => (n == null ? '—' : `${String(n).replace('.', ',')} %`)
const signo = (n: number) => `${n > 0 ? '+' : ''}${String(n).replace('.', ',')}`

/** El informe del día de un evento: cada mercado (consenso, movimiento desde ayer, quién paga más, márgenes, desvíos) y las encuestas. */
export function informeMercados(db: Db, evento: string, ahora = Date.now()): string {
  const partes: string[] = [`📊 ${evento} · ${fechaLocal(ahora)}`]
  for (const m of listarMercados(db, evento)) {
    const a = analizarMercado(db, m.id, { ahora, desde: ahora - 86_400_000 })
    if (!a.casas.length) { partes.push(`**${m.nombre}**: sin cuotas cargadas.`); continue }
    const lineas = a.resultados.map((r) => `- ${r.resultado}: consenso ${pct(r.consenso)}${r.movimiento ? ` (${signo(r.movimiento)} desde ayer)` : ''}${r.mejor ? ` · paga más ${r.mejor.casa} a ${String(r.mejor.cuota).replace('.', ',')}` : ''}`)
    const margenes = a.casas.map((c) => `${c.casa} ${c.margen == null ? 'margen ?' : `margen ${String(c.margen).replace('.', ',')} %`}`).join(' · ')
    const avisos = a.resultados.flatMap((r) => r.avisos.map((d) => `⚠ ${d.casa} en «${r.resultado}»: ${pct(d.prob)}, ${signo(d.desvio!)} puntos contra el resto`))
    partes.push([`**${m.nombre}**`, ...lineas, `_${margenes}_`, ...avisos].join('\n'))
  }
  const e = promedioEncuestas(db, evento)
  if (e.promedio.length) partes.push(`**Encuestas** (promedio de las últimas ${Math.max(...e.promedio.map((p) => p.encuestas))}):\n${e.promedio.slice(0, 8).map((p) => `- ${p.opcion}: ${String(p.promedio).replace('.', ',')} % (±${String(p.desvio).replace('.', ',')}; ${p.min}–${p.max})`).join('\n')}`)
  partes.push('_Información, no consejo: apostar es plata y va por el Monedero, con su tope._')
  return partes.join('\n\n')
}

/** Los desvíos de hoy (una alerta por casa, mercado y resultado al día), para Hoy. */
export function alertasMercados(db: Db, ahora = Date.now()): { clave: string; texto: string }[] {
  try { asegurar(db) } catch { return [] }
  const hoy = fechaLocal(ahora)
  const out: { clave: string; texto: string }[] = []
  for (const m of listarMercados(db)) {
    if (m.cierra && m.cierra < hoy) continue
    let a
    try { a = analizarMercado(db, m.id, { ahora }) } catch { continue }
    for (const r of a.resultados) for (const d of r.avisos) {
      out.push({ clave: `mercado:${m.id}:${d.casa}:${r.resultado}:${hoy}`, texto: `📊 ${m.evento} · ${m.nombre}: ${d.casa} da «${r.resultado}» al ${pct(d.prob)}, ${signo(d.desvio!)} puntos contra el resto de las casas (umbral ${a.umbral}). ${r.mejor ? `La que más paga: ${r.mejor.casa} a ${String(r.mejor.cuota).replace('.', ',')}.` : ''}` })
    }
  }
  return out
}
