/**
 * El mapa: dónde pasa lo de su mundo. Junta, por capas, los lugares que ya conoce (con su posición aproximada), los
 * eventos de la Línea, las oportunidades del Radar, las side quests con lugar y los eventos de su calendario.
 * Lo que tiene nombre pero no coordenadas se busca en OpenStreetMap (Nominatim: un pedido por segundo, con caché; lo que
 * no se encuentra también queda anotado para no volver a pedirlo).
 */
import { type Db } from './db.ts'

export const CAPAS_MAPA = ['lugar', 'linea', 'radar', 'mision', 'google'] as const
export type Punto = { id: string; capa: string; titulo: string; lat: number; lon: number; aprox: boolean; detalle: string | null; fecha: string | null; ref: { tipo: string; id: number | string } | null; peso?: number; url?: string | null }

// ─── geocodificar ───────────────────────────────────────────────────────

const claveDeLugar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
type Hallado = { lat: number; lon: number; nombre: string } | null
let buscarLugar = async (texto: string): Promise<Hallado> => {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: texto, format: 'json', limit: '1', 'accept-language': 'es' })}`, {
    headers: { 'user-agent': 'Deprocast/1.0 (asistente personal; uso de una sola persona)' }, signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error(`OpenStreetMap respondió ${r.status}`)
  const j = (await r.json()) as any[]
  return j?.[0] ? { lat: Number(j[0].lat), lon: Number(j[0].lon), nombre: String(j[0].display_name ?? texto) } : null
}
let esperar = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))
export function _probarMapa(o: { buscar?: typeof buscarLugar; esperar?: typeof esperar }) {
  if (o.buscar) buscarLugar = o.buscar
  if (o.esperar) esperar = o.esperar
}

/** Lo que ya se sabe de un texto (sin salir a buscar): undefined = nunca se buscó; null = se buscó y no está. */
export function enCache(db: Db, texto: string): Hallado | undefined {
  const r = db.prepare('SELECT lat, lon, nombre FROM geocache WHERE clave = ?').get(claveDeLugar(texto)) as { lat: number | null; lon: number | null; nombre: string | null } | undefined
  if (!r) return undefined
  return r.lat != null && r.lon != null ? { lat: r.lat, lon: r.lon, nombre: r.nombre ?? texto } : null
}

let ultimoPedido = 0
let fila: Promise<unknown> = Promise.resolve()
/** Busca un lugar por su nombre (con caché y de a uno por segundo, como pide OpenStreetMap). */
export function ubicar(db: Db, texto: string): Promise<Hallado> {
  const t = texto.trim()
  if (!t || /^(online|virtual|internet|remoto|en l[ií]nea)$/i.test(t) || /^https?:\/\/|\b(zoom\.us|meet\.google|teams\.microsoft)\b/i.test(t)) return Promise.resolve(null)
  const ya = enCache(db, t)
  if (ya !== undefined) return Promise.resolve(ya)
  const turno = fila.then(async () => {
    const otra = enCache(db, t)
    if (otra !== undefined) return otra
    const espera = ultimoPedido + 1100 - Date.now()
    if (espera > 0) await esperar(espera)
    ultimoPedido = Date.now()
    let h: Hallado = null
    try { h = await buscarLugar(t) } catch { return null } // un corte no se anota: se reintenta otra vez
    db.prepare('INSERT OR REPLACE INTO geocache (clave, texto, lat, lon, nombre, buscado_en) VALUES (?, ?, ?, ?, ?, ?)').run(claveDeLugar(t), t.slice(0, 300), h?.lat ?? null, h?.lon ?? null, h?.nombre?.slice(0, 300) ?? null, Date.now())
    return h
  })
  fila = turno.catch(() => null)
  return turno
}

/** Los textos sin buscar se buscan de fondo (aparecen en el mapa la próxima vez que se abre). */
export function ubicarDeFondo(db: Db, textos: string[]) {
  for (const t of [...new Set(textos.filter(Boolean))].slice(0, 40)) if (enCache(db, t) === undefined) void ubicar(db, t).catch(() => null)
}

// ─── los puntos ─────────────────────────────────────────────────────────

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)

/** Los puntos de las capas pedidas. Lo que no tiene posición todavía se manda a buscar de fondo. */
export async function puntosDelMapa(db: Db, capas: Set<string> = new Set(CAPAS_MAPA), ahora = Date.now()): Promise<{ puntos: Punto[]; sinUbicar: number }> {
  const puntos: Punto[] = []
  const faltan: string[] = []
  const lugares = db.prepare(`SELECT id, nombre, notas, meta FROM entidades WHERE tipo = 'lugar'`).all() as { id: number; nombre: string; notas: string | null; meta: string | null }[]
  const posDeLugar = new Map<number, { lat: number; lon: number; aprox: boolean }>()
  const porNombre = new Map<string, number>()
  for (const l of lugares) {
    const m = (() => { try { return JSON.parse(l.meta ?? '{}') } catch { return {} } })()
    const lat = num(m.lat)
    const lon = num(m.lon)
    porNombre.set(claveDeLugar(l.nombre), l.id)
    if (lat != null && lon != null) posDeLugar.set(l.id, { lat, lon, aprox: !!m.aprox })
    else { const c = enCache(db, l.nombre); if (c) posDeLugar.set(l.id, { lat: c.lat, lon: c.lon, aprox: false }); else if (c === undefined) faltan.push(l.nombre) }
  }
  const posDeTexto = (t: string | null | undefined): { lat: number; lon: number; aprox: boolean } | null => {
    if (!t || /^https?:\/\//i.test(t.trim())) return null
    const id = porNombre.get(claveDeLugar(t))
    if (id && posDeLugar.has(id)) return posDeLugar.get(id)!
    const c = enCache(db, t)
    if (c) return { lat: c.lat, lon: c.lon, aprox: false }
    if (c === undefined) faltan.push(t)
    return null
  }

  if (capas.has('lugar')) {
    // Cuántas veces aparece cada lugar en el corpus (una sola pasada).
    const menciones = new Map((db.prepare(`SELECT entidad_id AS id, COUNT(*) AS n FROM corpus_entidades GROUP BY entidad_id`).all() as { id: number; n: number }[]).map((r) => [r.id, r.n]))
    for (const l of lugares) {
      const p = posDeLugar.get(l.id)
      if (p) puntos.push({ id: `lugar:${l.id}`, capa: 'lugar', titulo: l.nombre, ...p, detalle: l.notas, fecha: null, ref: { tipo: 'entidad', id: l.id }, peso: menciones.get(l.id) ?? 0 })
    }
  }
  if (capas.has('linea')) {
    for (const e of db.prepare(`SELECT id, titulo, fecha, hora, lugar, lugar_id, tipo, pieza_id FROM eventos WHERE estado != 'descartado' AND (lugar IS NOT NULL OR lugar_id IS NOT NULL) ORDER BY fecha DESC LIMIT 600`).all() as any[]) {
      const p = (e.lugar_id && posDeLugar.get(e.lugar_id)) || posDeTexto(e.lugar)
      if (p) puntos.push({ id: `evento:${e.id}`, capa: 'linea', titulo: e.titulo, ...p, detalle: e.lugar, fecha: e.fecha, ref: { tipo: 'pieza', id: e.pieza_id } })
    }
  }
  if (capas.has('radar')) {
    for (const o of db.prepare(`SELECT id, titulo, lugar, lat, lon, fecha, cierre, url, tipo, online FROM oportunidades WHERE estado != 'descartada'`).all() as any[]) {
      const p = o.lat != null && o.lon != null ? { lat: o.lat, lon: o.lon, aprox: true } : o.online ? null : posDeTexto(o.lugar)
      if (p) puntos.push({ id: `oportunidad:${o.id}`, capa: 'radar', titulo: o.titulo, ...p, detalle: [o.tipo, o.lugar].filter(Boolean).join(' · '), fecha: o.fecha ?? o.cierre, ref: { tipo: 'oportunidad', id: o.id }, url: o.url })
    }
  }
  if (capas.has('mision')) {
    for (const m of db.prepare(`SELECT id, titulo, vence, disparador FROM misiones WHERE disparador IS NOT NULL AND estado NOT IN ('hecha', 'descartada', 'no')`).all() as any[]) {
      const d = (() => { try { return JSON.parse(m.disparador) } catch { return {} } })()
      const p = posDeTexto(d?.lugar ?? d?.zona)
      if (p) puntos.push({ id: `mision:${m.id}`, capa: 'mision', titulo: m.titulo, ...p, detalle: [d?.lugar, d?.actividad].filter(Boolean).join(' · ') || null, fecha: m.vence, ref: { tipo: 'mision', id: m.id } })
    }
  }
  if (capas.has('google')) {
    try {
      const { googleConectado, listarGoogle } = await import('./google-calendario.ts')
      if (googleConectado()) {
        const hoy = new Date(ahora).toISOString().slice(0, 10)
        const en60 = new Date(ahora + 60 * 86_400_000).toISOString().slice(0, 10)
        for (const e of await listarGoogle(hoy, en60)) {
          const p = posDeTexto(e.lugar)
          if (p) puntos.push({ id: `google:${e.id}`, capa: 'google', titulo: e.titulo, ...p, detalle: e.lugar, fecha: new Date(e.inicio).toISOString().slice(0, 10), ref: { tipo: 'google', id: e.id }, url: e.url })
        }
      }
    } catch { /* sin calendario, el resto del mapa sigue */ }
  }
  ubicarDeFondo(db, faltan)
  return { puntos, sinUbicar: new Set(faltan).size }
}
