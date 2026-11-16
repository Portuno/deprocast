/**
 * El mapa propio (Fragua #259), sobre el recorrido que ya junta el teléfono (puntos y los minutos de la escucha):
 * - cada pieza suya (un audio, una foto, la charla) queda con el lugar donde estaba, y se puede buscar por lugar
 *   («lo que hablé en Xàtiva»): por las piezas ubicadas y por las veces que estuvo ahí;
 * - los lugares son entidades con nombre y coordenadas; las paradas que se repiten sin nombre se proponen para nombrar;
 * - el recorrido de un rango (semana, mes, todo) y por persona o proyecto (dónde se cruzaron);
 * - privacidad: zonas y franjas horarias que no se registran, pausa, exportar y borrar un rango.
 * Y la actividad física del día: pasos (del teléfono y de la escucha), minutos caminando y km.
 */
import { ajuste, fechaLocal, fijarAjuste, type Db } from './db.ts'
import { metros } from './ubicacion.ts'

const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) : d } catch { return d } }
const r1 = (n: number) => Math.round(n * 10) / 10

// ─── privacidad ──────────────────────────────────────────────────────────

export type Zona = { nombre: string; lat: number; lon: number; radio: number }
export type Franja = { desde: string; hasta: string }
export type Privacidad = { zonas: Zona[]; franjas: Franja[]; pausadoHasta: number | null }

export function leerPrivacidad(db: Db): Privacidad {
  const p = json<Partial<Privacidad>>(ajuste(db, 'recorrido_privacidad'), {})
  return { zonas: Array.isArray(p.zonas) ? p.zonas : [], franjas: Array.isArray(p.franjas) ? p.franjas : [], pausadoHasta: p.pausadoHasta ?? null }
}
export function fijarPrivacidad(db: Db, c: Partial<Privacidad>): Privacidad {
  const p = { ...leerPrivacidad(db), ...c }
  p.zonas = p.zonas.filter((z) => Number.isFinite(z.lat) && Number.isFinite(z.lon)).map((z) => ({ nombre: String(z.nombre ?? 'Zona').slice(0, 60), lat: Number(z.lat), lon: Number(z.lon), radio: Math.max(50, Math.min(5000, Number(z.radio) || 200)) }))
  p.franjas = p.franjas.filter((f) => /^\d{2}:\d{2}$/.test(f.desde) && /^\d{2}:\d{2}$/.test(f.hasta))
  fijarAjuste(db, 'recorrido_privacidad', JSON.stringify(p))
  return p
}

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const enFranja = (f: Franja, h: string) => (f.desde <= f.hasta ? h >= f.desde && h < f.hasta : h >= f.desde || h < f.hasta)

/** ¿Este punto no se registra? (en una zona privada, en una franja sin registro, o con el recorrido en pausa). */
export function esPrivado(p: Privacidad, punto: { lat: number; lon: number; en: number }): boolean {
  if (p.pausadoHasta && punto.en < p.pausadoHasta) return true
  if (p.franjas.some((f) => enFranja(f, hhmm(punto.en)))) return true
  return p.zonas.some((z) => metros(z, punto) <= z.radio)
}

/** Exporta un rango (GeoJSON: puntos y paradas) para llevárselo. */
export async function exportarRango(db: Db, desde: string, hasta: string) {
  const r = await recorridoRango(db, desde, hasta, { simplificar: false })
  return {
    type: 'FeatureCollection',
    features: [
      ...r.puntos.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { en: new Date(p.en).toISOString(), fuente: p.fuente, precision: p.precision } })),
      ...r.paradas.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { parada: true, desde: new Date(p.desde).toISOString(), hasta: new Date(p.hasta).toISOString(), minutos: p.minutos, lugar: p.lugar } })),
    ],
  }
}

/** Borra el recorrido de un rango (los puntos, y el lugar de los minutos de la escucha). Devuelve cuántos. */
export function borrarRango(db: Db, desde: string, hasta: string): { puntos: number; minutos: number } {
  const a = new Date(`${desde}T00:00:00`).getTime(), b = new Date(`${hasta}T00:00:00`).getTime() + 86_400_000
  if (!(b > a)) throw new Error('El rango no es válido.')
  const puntos = Number(db.prepare('DELETE FROM recorrido_puntos WHERE en >= ? AND en < ?').run(a, b).changes)
  const minutos = Number(db.prepare('UPDATE capas_minuto SET lat = NULL, lon = NULL, precision = NULL WHERE minuto >= ? AND minuto < ? AND lat IS NOT NULL').run(a, b).changes)
  return { puntos, minutos }
}

// ─── dónde estaba ────────────────────────────────────────────────────────

type Punto = { en: number; lat: number; lon: number; precision: number | null; fuente: string }

/** Los puntos de un rango de tiempo (el recorrido y los minutos de la escucha con lugar). */
export function puntosEntre(db: Db, desde: number, hasta: number): Punto[] {
  const propios = db.prepare('SELECT en, lat, lon, precision, fuente FROM recorrido_puntos WHERE en >= ? AND en < ? ORDER BY en').all(desde, hasta) as Punto[]
  const capas = (db.prepare(`SELECT minuto AS en, lat, lon, precision FROM capas_minuto WHERE minuto >= ? AND minuto < ? AND lat IS NOT NULL ORDER BY minuto`).all(desde, hasta) as any[]).map((x) => ({ ...x, fuente: 'escucha' }) as Punto)
  return [...propios, ...capas].sort((a, b) => a.en - b.en)
}

/** Los lugares suyos con coordenadas (entidades tipo lugar). */
export function lugaresConCoordenadas(db: Db): { id: number; nombre: string; lat: number; lon: number }[] {
  return (db.prepare(`SELECT id, nombre, meta FROM entidades WHERE tipo = 'lugar'`).all() as { id: number; nombre: string; meta: string | null }[])
    .map((l) => ({ id: l.id, nombre: l.nombre, m: json<any>(l.meta, {}) }))
    .filter((l) => Number.isFinite(Number(l.m.lat)) && Number.isFinite(Number(l.m.lon)))
    .map((l) => ({ id: l.id, nombre: l.nombre, lat: Number(l.m.lat), lon: Number(l.m.lon) }))
}

/** Dónde estaba a una hora: el punto más cercano en ±10 minutos y, si hay un lugar suyo a 200 m, su nombre. */
export function lugarEn(db: Db, ts: number): { lat: number; lon: number; nombre: string | null; lugarId: number | null } | null {
  const ps = puntosEntre(db, ts - 10 * 60_000, ts + 10 * 60_000)
  if (!ps.length) return null
  const p = ps.reduce((a, b) => (Math.abs(b.en - ts) < Math.abs(a.en - ts) ? b : a))
  const cerca = lugaresConCoordenadas(db).map((l) => ({ l, m: metros(l, p) })).sort((a, b) => a.m - b.m)[0]
  return { lat: p.lat, lon: p.lon, nombre: cerca && cerca.m <= 200 ? cerca.l.nombre : null, lugarId: cerca && cerca.m <= 200 ? cerca.l.id : null }
}

/**
 * Le pone el lugar a las piezas suyas que todavía no lo tienen (audios, fotos, notas, la charla): por la hora en que se
 * grabaron o llegaron, contra el recorrido. Las que ya traen coordenadas (lo dictado en la escucha) se respetan.
 */
export function ubicarPiezas(db: Db, o: { desde?: number; limite?: number } = {}): number {
  const filas = db.prepare(`SELECT id, meta, datos, creado_en FROM corpus WHERE nivel = 'propia' AND creado_en >= ? AND (meta IS NULL OR json_extract(meta, '$.lugar') IS NULL) ORDER BY id DESC LIMIT ?`)
    .all(o.desde ?? Date.now() - 45 * 86_400_000, o.limite ?? 500) as { id: number; meta: string | null; datos: string | null; creado_en: number }[]
  const poner = db.prepare(`UPDATE corpus SET meta = json_set(COALESCE(meta, '{}'), '$.lugar', json(?)) WHERE id = ?`)
  let n = 0
  for (const f of filas) {
    const m = json<any>(f.meta, {}), d = json<any>(f.datos, {})
    const voz = m.voz ?? {}
    let l: { lat: number; lon: number; nombre: string | null; lugarId: number | null } | null = null
    if (Number.isFinite(Number(voz.lat)) && Number.isFinite(Number(voz.lon))) l = { lat: Number(voz.lat), lon: Number(voz.lon), nombre: null, lugarId: null }
    else l = lugarEn(db, Number(voz.inicio) || Number(d.en) || f.creado_en)
    if (!l) continue
    poner.run(JSON.stringify({ lat: Math.round(l.lat * 1e5) / 1e5, lon: Math.round(l.lon * 1e5) / 1e5, nombre: l.nombre, lugarId: l.lugarId }), f.id)
    n++
  }
  return n
}

// ─── buscar por lugar ────────────────────────────────────────────────────

/**
 * «Lo que hablé en Xàtiva»: el lugar (uno suyo por nombre, o buscado en el mapa), las veces que estuvo ahí (por el
 * recorrido) y las piezas suyas de ahí (las ubicadas y las de esas visitas).
 */
export async function buscarPorLugar(db: Db, que: string, o: { radio?: number; desde?: string | null; hasta?: string | null } = {}) {
  const q = que.trim()
  const n = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  let centro: { lat: number; lon: number; nombre: string } | null = lugaresConCoordenadas(db).find((l) => n(l.nombre) === n(q) || n(l.nombre).includes(n(q))) ?? null
  if (!centro) { try { centro = await (await import('./mapa.ts')).ubicar(db, q) } catch { centro = null } }
  if (!centro) return { lugar: null, aviso: `No encuentro «${q}» ni en tus lugares ni en el mapa.`, visitas: [], piezas: [] }
  const radio = o.radio ?? 1500
  const a = o.desde ? new Date(`${o.desde}T00:00:00`).getTime() : 0, b = o.hasta ? new Date(`${o.hasta}T00:00:00`).getTime() + 86_400_000 : Date.now() + 86_400_000
  // Las visitas: tramos seguidos de puntos adentro del radio (cortan a la media hora sin estar).
  const adentro = (db.prepare('SELECT en, lat, lon FROM recorrido_puntos WHERE en >= ? AND en < ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY en')
    .all(a, b, centro.lat - radio / 111_000, centro.lat + radio / 111_000, centro.lon - radio / 80_000, centro.lon + radio / 80_000) as { en: number; lat: number; lon: number }[])
    .filter((p) => metros(centro!, p) <= radio)
  const visitas: { desde: number; hasta: number }[] = []
  for (const p of adentro) {
    const v = visitas.at(-1)
    if (v && p.en - v.hasta <= 30 * 60_000) v.hasta = p.en
    else visitas.push({ desde: p.en, hasta: p.en })
  }
  const ids = new Set<number>()
  const piezas: { id: number; titulo: string; fecha: string | null; por: 'ubicada' | 'visita' }[] = []
  for (const f of db.prepare(`SELECT id, titulo, fecha, json_extract(meta, '$.lugar.lat') AS lat, json_extract(meta, '$.lugar.lon') AS lon FROM corpus WHERE nivel = 'propia' AND json_extract(meta, '$.lugar.lat') IS NOT NULL AND creado_en >= ? AND creado_en < ?`).all(a, b) as any[]) {
    if (metros(centro, { lat: f.lat, lon: f.lon }) <= radio && !ids.has(f.id)) { ids.add(f.id); piezas.push({ id: f.id, titulo: f.titulo, fecha: f.fecha, por: 'ubicada' }) }
  }
  for (const v of visitas) {
    for (const f of db.prepare(`SELECT id, titulo, fecha FROM corpus WHERE nivel = 'propia' AND creado_en BETWEEN ? AND ?`).all(v.desde - 10 * 60_000, v.hasta + 10 * 60_000) as any[]) {
      if (!ids.has(f.id)) { ids.add(f.id); piezas.push({ ...f, por: 'visita' }) }
    }
  }
  return {
    lugar: { ...centro, radio },
    visitas: visitas.map((v) => ({ fecha: fechaLocal(v.desde), desde: hhmm(v.desde), hasta: hhmm(v.hasta), minutos: Math.round((v.hasta - v.desde) / 60_000) })),
    piezas: piezas.slice(0, 80),
    aviso: null as string | null,
  }
}

// ─── lugares como entidad ───────────────────────────────────────────────

/** Un lugar suyo con nombre y coordenadas (nuevo, o le pone coordenadas a uno que ya existía). */
export async function guardarLugar(db: Db, l: { nombre: string; lat: number; lon: number; direccion?: string | null; nota?: string | null }, ahora = Date.now()) {
  if (!l.nombre.trim() || !Number.isFinite(l.lat) || !Number.isFinite(l.lon)) throw new Error('Un lugar necesita nombre y coordenadas.')
  const { asegurarEntidad } = await import('./entidades.ts')
  const id = asegurarEntidad(db, { tipo: 'lugar', nombre: l.nombre.trim().slice(0, 100), notas: l.nota ?? null, meta: { lat: l.lat, lon: l.lon, ...(l.direccion ? { direccion: l.direccion } : {}) } }, ahora)
  db.prepare(`UPDATE entidades SET meta = json_set(json_set(COALESCE(meta, '{}'), '$.lat', ?), '$.lon', ?) WHERE id = ?`).run(l.lat, l.lon, id)
  return { id, nombre: l.nombre.trim() }
}

/** Las paradas que se repiten (3 días distintos o más en el último mes) y no tienen nombre: para que les ponga uno. */
export function paradasFrecuentes(db: Db, ahora = Date.now(), dias = 30) {
  const grupos: { lat: number; lon: number; dias: Set<string>; minutos: number }[] = []
  for (let i = 0; i < dias; i++) {
    const f = fechaLocal(ahora - i * 86_400_000)
    const inicio = new Date(`${f}T00:00:00`).getTime()
    for (const p of paradasDeLocal(puntosEntre(db, inicio, inicio + 86_400_000))) {
      const g = grupos.find((x) => metros(x, p) <= 150)
      if (g) { g.dias.add(f); g.minutos += p.minutos } else grupos.push({ lat: p.lat, lon: p.lon, dias: new Set([f]), minutos: p.minutos })
    }
  }
  const lugares = lugaresConCoordenadas(db)
  return grupos.filter((g) => g.dias.size >= 3 && !lugares.some((l) => metros(l, g) <= 200))
    .map((g) => ({ lat: Math.round(g.lat * 1e5) / 1e5, lon: Math.round(g.lon * 1e5) / 1e5, dias: g.dias.size, horas: r1(g.minutos / 60) }))
    .sort((a, b) => b.dias - a.dias).slice(0, 10)
}

function paradasDeLocal(ps: Punto[]) {
  const out: { lat: number; lon: number; minutos: number }[] = []
  let g: Punto[] = []
  const cerrar = () => { if (g.length && g.at(-1)!.en - g[0].en >= 5 * 60_000) out.push({ lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lon: g.reduce((s, p) => s + p.lon, 0) / g.length, minutos: Math.round((g.at(-1)!.en - g[0].en) / 60_000) }); g = [] }
  for (const p of ps) {
    if (g.length) { const c = { lat: g.reduce((s, x) => s + x.lat, 0) / g.length, lon: g.reduce((s, x) => s + x.lon, 0) / g.length }; if (metros(c, p) > 100) cerrar() }
    g.push(p)
  }
  cerrar()
  return out
}

// ─── el recorrido de un rango, y por persona o proyecto ──────────────────

/** El recorrido de varios días (para la semana, el mes o todo), con los puntos raleados si son muchos. */
export async function recorridoRango(db: Db, desde: string, hasta: string, o: { simplificar?: boolean; entidad?: number | null } = {}) {
  const a = new Date(`${desde}T00:00:00`).getTime(), b = new Date(`${hasta}T00:00:00`).getTime() + 86_400_000
  let puntos = puntosEntre(db, a, b)
  const total = puntos.length
  if (o.simplificar !== false && puntos.length > 3000) { const paso = Math.ceil(puntos.length / 3000); puntos = puntos.filter((_, i) => i % paso === 0) }
  const { recorridoDelDia, distanciaKm } = await import('./recorrido.ts')
  const paradas: { lat: number; lon: number; desde: number; hasta: number; minutos: number; lugar: string | null }[] = []
  for (let t = a; t < b && paradas.length < 400; t += 86_400_000) {
    const d = await recorridoDelDia(db, fechaLocal(t))
    paradas.push(...d.paradas.map((p) => ({ lat: p.lat, lon: p.lon, desde: p.desde, hasta: p.hasta, minutos: p.minutos, lugar: p.lugar })))
  }
  // Por persona o proyecto: las piezas ubicadas que la nombran (dónde se cruzaron).
  const cruces = o.entidad ? (db.prepare(`SELECT c.id, c.titulo, c.fecha, json_extract(c.meta, '$.lugar.lat') AS lat, json_extract(c.meta, '$.lugar.lon') AS lon FROM corpus c JOIN corpus_entidades ce ON ce.pieza_id = c.id
      WHERE ce.entidad_id = ? AND json_extract(c.meta, '$.lugar.lat') IS NOT NULL ORDER BY c.id DESC LIMIT 300`).all(o.entidad) as any[]) : []
  return { desde, hasta, puntos, total, paradas, distanciaKm: distanciaKm(puntosEntre(db, a, b)), cruces }
}

// ─── actividad física ───────────────────────────────────────────────────

const ESQUEMA_ACTIVIDAD = `CREATE TABLE IF NOT EXISTS actividad_dia (
  fecha TEXT NOT NULL,
  fuente TEXT NOT NULL,
  pasos INTEGER NOT NULL DEFAULT 0,
  actualizado INTEGER NOT NULL,
  PRIMARY KEY (fecha, fuente)
)`
const listos = new WeakSet<Db>()
function asegurar(db: Db) { if (!listos.has(db)) { db.exec(ESQUEMA_ACTIVIDAD); listos.add(db) } }

/** El teléfono informa los pasos del día (su contador). Se guarda el mayor que haya visto (el contador solo sube). */
export function anotarPasos(db: Db, fuente: string, fecha: string, pasos: number, ahora = Date.now()) {
  asegurar(db)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !(pasos >= 0)) throw new Error('Pasos inválidos')
  db.prepare(`INSERT INTO actividad_dia (fecha, fuente, pasos, actualizado) VALUES (?, ?, ?, ?)
    ON CONFLICT (fecha, fuente) DO UPDATE SET pasos = MAX(pasos, excluded.pasos), actualizado = excluded.actualizado`).run(fecha, fuente.slice(0, 40), Math.round(pasos), ahora)
}

/** La actividad de un día: pasos (lo que diga el contador del teléfono, o la escucha si es más), minutos caminando, km y la meta. */
export function actividadDelDia(db: Db, fecha = fechaLocal()) {
  asegurar(db)
  const a = new Date(`${fecha}T00:00:00`).getTime(), b = a + 86_400_000
  const telefono = (db.prepare('SELECT COALESCE(MAX(pasos), 0) AS n FROM actividad_dia WHERE fecha = ?').get(fecha) as { n: number }).n
  const capas = db.prepare('SELECT COALESCE(SUM(pasos), 0) AS pasos, COALESCE(SUM(caminando), 0) AS seg FROM capas_minuto WHERE minuto >= ? AND minuto < ?').get(a, b) as { pasos: number; seg: number }
  const puntos = puntosEntre(db, a, b)
  let km = 0, enMovimiento = 0
  for (let i = 1; i < puntos.length; i++) {
    const d = metros(puntos[i - 1], puntos[i]), dt = puntos[i].en - puntos[i - 1].en
    if (d < 50_000) km += d
    // Caminando: entre 2 y 8 km/h, en tramos de menos de 10 minutos.
    if (dt > 0 && dt < 10 * 60_000) { const kmh = (d / 1000) / (dt / 3_600_000); if (kmh >= 2 && kmh <= 8) enMovimiento += dt }
  }
  const pasos = Math.max(telefono, capas.pasos)
  const meta = Number(ajuste(db, 'meta_pasos') ?? 8000) || 8000
  return { fecha, pasos, meta, avance: Math.min(100, Math.round((pasos / meta) * 100)), minutosCaminando: Math.max(Math.round(capas.seg / 60), Math.round(enMovimiento / 60_000)), km: r1(km / 1000), fuente: telefono >= capas.pasos ? 'teléfono' : 'escucha' }
}

/** La semana: un día por fila, y el promedio. */
export function actividadSemana(db: Db, ahora = Date.now()) {
  const dias = Array.from({ length: 7 }, (_, i) => actividadDelDia(db, fechaLocal(ahora - (6 - i) * 86_400_000)))
  const conDatos = dias.filter((d) => d.pasos > 0)
  return { dias, promedioPasos: conDatos.length ? Math.round(conDatos.reduce((s, d) => s + d.pasos, 0) / conDatos.length) : 0, kmTotal: r1(dias.reduce((s, d) => s + d.km, 0)) }
}
