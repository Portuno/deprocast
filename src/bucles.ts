/**
 * Lo que sigue volviendo: los bucles abiertos (lo que dijo que iba a hacer, lo que quedó sin resolver) no se van solos;
 * ocupan cabeza hasta que se cierran. Acá se juntan de donde aparecen —lo «abierto» de cada destilado (charlas, notas de
 * voz, lo importado) y las side quests quietas hace más de 14 días—, lo parecido se junta por sentido y se cuenta
 * cuántas veces volvió y desde cuándo. Cada uno termina de una de tres formas: se cierra ya (es de dos minutos: side quest
 * para hoy), se agenda (al calendario) o se suelta (decidir no hacerlo también lo cierra; no vuelve a molestar).
 */
import { ajuste, fechaLocal, fijarAjuste, json, type Db } from './db.ts'
import { blobAVec, cosenoNormalizados, vecABlob, vectoresDeTextos } from './semantica.ts'
import { actualizarMision, anotarSideQuest } from './misiones.ts'

export type Bucle = { id: number; texto: string; veces: number; primera: string | null; ultima: string | null; fuentes: { origen: string; fecha: string | null; texto: string }[]; estado: string; motivo: string | null; misionId: number | null; peso: number; dias: number }
export const FINALES = ['ya', 'agendar', 'soltar'] as const

const DIA = 86_400_000
const PARECIDO = 0.85
const clave = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
const diasEntre = (a: string, b: string) => Math.max(0, Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / DIA))

function deFila(r: any, hoy: string): Bucle {
  const dias = r.primera ? diasEntre(r.primera, hoy) : 0
  // Pesa lo que volvió muchas veces y lo que lleva más tiempo dando vueltas.
  return { id: r.id, texto: r.texto, veces: r.veces, primera: r.primera, ultima: r.ultima, fuentes: json<any[]>(r.fuentes, []) ?? [], estado: r.estado, motivo: r.motivo, misionId: r.mision_id, dias, peso: Math.round(r.veces * (1 + Math.log2(1 + dias / 7)) * 10) / 10 }
}

export function leerBucle(db: Db, id: number, ahora = Date.now()): Bucle | null {
  const r = db.prepare('SELECT * FROM bucles WHERE id = ?').get(id)
  return r ? deFila(r, fechaLocal(ahora)) : null
}

// ─── juntar ─────────────────────────────────────────────────────────────

type Mencion = { origen: string; texto: string; fecha: string | null; misionId?: number }

/** Las menciones que todavía no se contaron: lo abierto de los destilados y las side quests quietas. */
function mencionesNuevas(db: Db, limite: number, ahora: number): Mencion[] {
  const out: Mencion[] = []
  const visto = db.prepare('SELECT 1 FROM bucles_vistos WHERE origen = ?')
  // Solo los destilados nuevos desde la última vez (un cursor por hecho_en): leer el JSON de todos en cada vuelta del
  // reproceso trababa el servidor casi dos segundos (npm run medir).
  const desde = Number(ajuste(db, 'bucles_destilado_hasta') ?? 0)
  const filas = db.prepare(`SELECT d.pieza_id, d.salida, c.fecha, d.hecho_en FROM takeout_destilado d JOIN corpus c ON c.id = d.pieza_id
    WHERE d.estado = 'hecho' AND ${desde ? 'd.hecho_en >= ?' : '? = 0'} ORDER BY d.hecho_en, d.pieza_id LIMIT ?`).all(desde, limite * 3) as { pieza_id: number; salida: string; fecha: string | null; hecho_en: number | null }[]
  // El cursor avanza solo hasta lo que se miró (si se llenó el cupo, lo que sigue queda para la próxima).
  let mirado: number | null = null
  for (const s of filas) {
    if (out.length >= limite) break
    if (s.hecho_en) mirado = s.hecho_en
    if (visto.get(`abierto:${s.pieza_id}:0`)) continue
    const abiertos: string[] = (json<any>(s.salida, {})?.abierto ?? []).map((x: unknown) => String(x ?? '').trim())
    if (!abiertos.length) continue
    abiertos.forEach((texto, i) => { if (texto.length >= 8) out.push({ origen: `abierto:${s.pieza_id}:${i}`, texto: texto.slice(0, 300), fecha: (json<any>(s.salida, {})?.fecha ?? s.fecha ?? '').slice(0, 10) || null }) })
    // Que la pieza quede vista aunque sus abiertos sean cortos (la marca es el :0).
    if (!abiertos[0] || abiertos[0].length < 8) out.push({ origen: `abierto:${s.pieza_id}:0`, texto: '', fecha: null })
  }
  if (mirado) fijarAjuste(db, 'bucles_destilado_hasta', String(mirado))
  const quietas = db.prepare(`SELECT id, titulo, creada_en FROM misiones WHERE personaje = 'jugador' AND nivel = 'terciaria' AND estado = 'activa' AND creada_en < ? ORDER BY creada_en LIMIT ?`)
    .all(ahora - 14 * DIA, limite) as { id: number; titulo: string; creada_en: number }[]
  for (const m of quietas) if (!visto.get(`mision:${m.id}`)) out.push({ origen: `mision:${m.id}`, texto: m.titulo, fecha: fechaLocal(m.creada_en), misionId: m.id })
  return out
}

/**
 * Los bucles con su vector, en memoria y al día de a tandas (cargar los 14 mil de un tirón en cada vuelta trababa el
 * servidor). Los nuevos se suman al crearse; uno que ya no está se saltea al leerlo.
 */
const cacheBucles = new WeakMap<Db, { hasta: number; filas: { id: number; clave: string; vec: Float32Array | null }[] }>()
async function bucleExistentes(db: Db) {
  let c = cacheBucles.get(db)
  if (!c) { c = { hasta: 0, filas: [] }; cacheBucles.set(db, c) }
  const tanda = db.prepare('SELECT id, clave, vec FROM bucles WHERE id > ? ORDER BY id LIMIT 2000')
  for (;;) {
    const xs = tanda.all(c.hasta) as { id: number; clave: string; vec: Uint8Array | null }[]
    for (const b of xs) { c.filas.push({ id: b.id, clave: b.clave, vec: b.vec ? blobAVec(b.vec) : null }); c.hasta = b.id }
    if (xs.length < 2000) break
    await new Promise<void>((ok) => setImmediate(ok))
  }
  return c.filas
}

/**
 * Cuenta las menciones nuevas: cada una suma a un bucle parecido (por sentido si hay vectores; si no, por el mismo
 * texto) o abre uno nuevo. Un bucle soltado también cuenta la vuelta, pero sigue soltado. Devuelve cuántas contó.
 */
export async function juntarBucles(db: Db, o: { limite?: number; ahora?: number } = {}): Promise<number> {
  const ahora = o.ahora ?? Date.now()
  const ms = mencionesNuevas(db, o.limite ?? 40, ahora)
  if (!ms.length) return 0
  const conTexto = ms.filter((m) => m.texto)
  const vecs = conTexto.length ? await vectoresDeTextos(db, conTexto.map((m) => m.texto), 'bucles') : null
  const existentes = await bucleExistentes(db)
  const marcar = db.prepare('INSERT OR IGNORE INTO bucles_vistos (origen, bucle_id, en) VALUES (?, ?, ?)')
  let n = 0
  for (const [i, m] of ms.entries()) {
    if (i % 3 === 2) await new Promise<void>((ok) => setImmediate(ok)) // con miles de bucles, que no trabe el servidor
    if (!m.texto) { marcar.run(m.origen, null, ahora); continue }
    const k = clave(m.texto)
    const v = vecs?.[conTexto.indexOf(m)] ?? null
    let mejor: { id: number; sim: number } | null = null
    for (const b of existentes) {
      // Los dos ya vienen normalizados: el coseno es un producto punto (sin volver a normalizar 14 mil veces por mención).
      const sim = b.clave === k ? 1 : v && b.vec ? cosenoNormalizados(v, b.vec) : 0
      if (sim >= PARECIDO && (!mejor || sim > mejor.sim)) mejor = { id: b.id, sim }
    }
    const fuente = { origen: m.origen, fecha: m.fecha, texto: m.texto }
    const b = mejor ? (db.prepare('SELECT * FROM bucles WHERE id = ?').get(mejor.id) as any) : null
    if (mejor && b) {
      const fechas = [b.primera, b.ultima, m.fecha].filter(Boolean).sort()
      db.prepare('UPDATE bucles SET veces = veces + 1, primera = ?, ultima = ?, fuentes = ?, mision_id = COALESCE(mision_id, ?) WHERE id = ?')
        .run(fechas[0] ?? null, fechas.at(-1) ?? null, JSON.stringify([...(json<any[]>(b.fuentes, []) ?? []), fuente].slice(-12)), m.misionId ?? null, mejor.id)
      marcar.run(m.origen, mejor.id, ahora)
    } else {
      const id = Number(db.prepare('INSERT INTO bucles (texto, clave, veces, primera, ultima, fuentes, vec, mision_id, creado_en) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)')
        .run(m.texto, k, m.fecha, m.fecha, JSON.stringify([fuente]), v ? vecABlob(v) : null, m.misionId ?? null, ahora).lastInsertRowid)
      existentes.push({ id, clave: k, vec: v })
      const cache = cacheBucles.get(db)
      if (cache && cache.filas === existentes) cache.hasta = Math.max(cache.hasta, id)
      marcar.run(m.origen, id, ahora)
    }
    n++
  }
  return n
}

// ─── ver ────────────────────────────────────────────────────────────────

/** Los abiertos que más pesan (veces × antigüedad). */
export function listarBucles(db: Db, o: { limite?: number; estado?: string } = {}, ahora = Date.now()): Bucle[] {
  const hoy = fechaLocal(ahora)
  // Primero el peso con lo justo (id, veces, desde cuándo) y después la fila entera solo de los que se muestran: leer los
  // 14 mil abiertos con su vector y sus fuentes para mostrar 3 trababa /api/hoy/hud 200 a 400 ms (npm run medir).
  // El peso se calcula en SQL sobre el índice y vuelven solo los que se muestran (con 14 mil, armarlos en JS eran 35 ms en
  // cada /api/hoy/hud). Sin las funciones matemáticas de SQLite, lo mismo en JS.
  let ids: number[]
  try {
    ids = (db.prepare(`SELECT id FROM bucles INDEXED BY bucles_peso WHERE estado = ?
      ORDER BY ROUND(veces * (1 + log2(1 + MAX(0, COALESCE(ROUND(julianday(?) - julianday(primera)), 0)) / 7.0)) * 10) DESC, COALESCE(primera, '') LIMIT ?`)
      .all(o.estado ?? 'abierto', hoy, o.limite ?? 7) as { id: number }[]).map((r) => r.id)
  } catch {
    const peso = (veces: number, primera: string | null) => veces * (1 + Math.log2(1 + (primera ? diasEntre(primera, hoy) : 0) / 7))
    ids = (db.prepare('SELECT id, veces, primera FROM bucles INDEXED BY bucles_peso WHERE estado = ?').all(o.estado ?? 'abierto') as { id: number; veces: number; primera: string | null }[])
      .map((r) => ({ id: r.id, p: Math.round(peso(r.veces, r.primera) * 10) / 10, primera: r.primera ?? '' }))
      .sort((a, b) => b.p - a.p || a.primera.localeCompare(b.primera)).slice(0, o.limite ?? 7).map((r) => r.id)
  }
  const una = db.prepare('SELECT * FROM bucles WHERE id = ?')
  return ids.map((id) => una.get(id)).filter(Boolean).map((r) => deFila(r, hoy))
}

export function resumenBucles(db: Db) {
  return Object.fromEntries((db.prepare('SELECT estado, COUNT(*) AS n FROM bucles GROUP BY estado').all() as { estado: string; n: number }[]).map((r) => [r.estado, r.n]))
}

/** Los más viejos (para el aviso semanal). */
export function bucleMasViejos(db: Db, n = 3, ahora = Date.now()): Bucle[] {
  const hoy = fechaLocal(ahora)
  return (db.prepare(`SELECT * FROM bucles WHERE estado = 'abierto' ORDER BY primera, veces DESC LIMIT ?`).all(n) as any[]).map((r) => deFila(r, hoy))
}

// ─── cerrar ─────────────────────────────────────────────────────────────

/**
 * Los tres finales. «ya»: es de dos minutos, queda como side quest para hoy (si ya era una, vence hoy). «agendar»: al
 * calendario (su Google si está conectado; si no, side quest con esa fecha). «soltar»: decidir no hacerlo, con un motivo.
 */
export async function cerrarBucle(db: Db, id: number, final: string, o: { fecha?: string | null; hora?: string | null; motivo?: string | null } = {}, ahora = Date.now()): Promise<{ bucle: Bucle; misionId: number | null; google: string | null }> {
  const b = leerBucle(db, id, ahora)
  if (!b) throw new Error(`No existe el bucle ${id}`)
  if (b.estado !== 'abierto') throw new Error('Ese bucle ya está cerrado')
  if (!FINALES.includes(final as any)) throw new Error('El final es ya, agendar o soltar')
  const hoy = fechaLocal(ahora)
  let misionId = b.misionId
  let google: string | null = null
  const enMision = (vence: string) => {
    if (misionId) actualizarMision(db, misionId, { vence, estado: 'activa' }, { por: 'operador', ahora })
    else misionId = anotarSideQuest(db, { titulo: b.texto.slice(0, 160), detalle: `Volvió ${b.veces} ${b.veces === 1 ? 'vez' : 'veces'}${b.primera ? ` desde el ${b.primera}` : ''} (lo que sigue volviendo).`, vence, creadaPor: 'bucles' }, ahora).id
  }
  if (final === 'ya') enMision(hoy)
  if (final === 'agendar') {
    const fecha = o.fecha && /^\d{4}-\d{2}-\d{2}$/.test(o.fecha) ? o.fecha : null
    if (!fecha) throw new Error('¿Para qué día lo agendo? (YYYY-MM-DD)')
    const ag = await import('./agenda.ts')
    if (ag.estadoCalendario().conectado) google = (await ag.llevarAGoogle(db, 'bucle', id, { fecha, hora: o.hora ?? null }, ahora)).id
    else enMision(fecha)
  }
  db.prepare('UPDATE bucles SET estado = ?, motivo = ?, mision_id = ?, cerrado_en = ? WHERE id = ?')
    .run(final === 'ya' ? 'cerrado' : final === 'agendar' ? 'agendado' : 'soltado', final === 'soltar' ? o.motivo?.trim().slice(0, 300) || null : null, misionId, ahora, id)
  return { bucle: leerBucle(db, id, ahora)!, misionId, google }
}

/** Para el prompt del chat: los que más pesan, en una línea cada uno. */
export function buclesParaPrompt(db: Db, ahora = Date.now()): string {
  return listarBucles(db, { limite: 5 }, ahora).filter((b) => b.veces >= 2).map((b) => `- #${b.id} «${b.texto}» (volvió ${b.veces} veces, desde ${b.primera ?? '?'})`).join('\n')
}
