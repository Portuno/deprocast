/**
 * La ubicación en vivo (Fragua #195). Solo si él la prendió (ajuste ubicacion_en_vivo; apagada por defecto, se apaga
 * desde el Mapa): nada se registra si está apagada. Llega desde la compu (el navegador, con su permiso) o desde el
 * teléfono (los minutos de su día en capas), y queda como señal con vencimiento (15 minutos).
 *
 * Con cada posición nueva se revisan las side quests que tienen lugar o zona: si está cerca (300 m de un lugar, 1,5 km
 * de una zona), se le avisa UNA vez por sus canales y la side quest queda activa. El chat sabe dónde está ahora (el
 * lugar suyo más cercano), para cruzarlo con lo que está haciendo.
 */
import { ajuste, fijarAjuste, type Db } from './db.ts'

const VENCE_MS = 15 * 60_000
const RADIO_LUGAR = 300
const RADIO_ZONA = 1500

export const ubicacionPrendida = (db: Db) => ajuste(db, 'ubicacion_en_vivo') === '1'
export function prenderUbicacion(db: Db, prendida: boolean) {
  fijarAjuste(db, 'ubicacion_en_vivo', prendida ? '1' : '0')
  if (!prendida) db.prepare('DELETE FROM ubicacion_senales').run() // apagarla también borra lo que había
  return { prendida }
}

/** Distancia en metros (haversine). */
export function metros(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 6_371_000, rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * r * Math.asin(Math.sqrt(h)))
}

export type Posicion = { lat: number; lon: number; precision?: number | null; en?: number; fuente?: string }

/** Una posición nueva. Si está apagada, no se guarda nada. Devuelve las side quests que se activaron. */
export async function recibirUbicacion(db: Db, p: Posicion, ahora = Date.now()): Promise<{ guardada: boolean; activadas: { id: number; titulo: string; cerca: string; metros: number }[] }> {
  if (!ubicacionPrendida(db)) return { guardada: false, activadas: [] }
  const lat = Number(p.lat), lon = Number(p.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Esa posición no es válida')
  const en = Math.min(ahora, Number(p.en) || ahora)
  db.prepare('INSERT INTO ubicacion_senales (lat, lon, precision, fuente, en, vence) VALUES (?, ?, ?, ?, ?, ?)').run(lat, lon, p.precision ?? null, String(p.fuente ?? 'compu').slice(0, 30), en, en + VENCE_MS)
  db.prepare('DELETE FROM ubicacion_senales WHERE en < ?').run(ahora - 7 * 86_400_000) // una semana, no más
  return { guardada: true, activadas: await revisarSideQuests(db, { lat, lon }, ahora) }
}

/** Dónde está ahora (la última señal que no venció), o null. */
export function ubicacionActual(db: Db, ahora = Date.now()): (Posicion & { en: number; fuente: string }) | null {
  if (!ubicacionPrendida(db)) return null
  return (db.prepare('SELECT lat, lon, precision, fuente, en FROM ubicacion_senales WHERE vence > ? ORDER BY en DESC LIMIT 1').get(ahora) as any) ?? null
}

/** Las side quests con lugar o zona que quedan cerca: aviso una sola vez y quedan activas. */
async function revisarSideQuests(db: Db, aqui: { lat: number; lon: number }, ahora: number) {
  const { enCache, ubicar } = await import('./mapa.ts')
  const activadas: { id: number; titulo: string; cerca: string; metros: number }[] = []
  const qs = db.prepare(`SELECT id, titulo, disparador FROM misiones WHERE personaje = 'jugador' AND disparador IS NOT NULL AND estado IN ('sugerida', 'activa')
    AND id NOT IN (SELECT mision_id FROM ubicacion_avisos)`).all() as { id: number; titulo: string; disparador: string }[]
  for (const q of qs) {
    const d = (() => { try { return JSON.parse(q.disparador) } catch { return {} } })()
    for (const [texto, radio] of [[d.lugar, RADIO_LUGAR], [d.zona, RADIO_ZONA]] as [string | undefined, number][]) {
      if (!texto?.trim()) continue
      // Lo que ya está ubicado se mide ahora; lo que no, se busca de fondo (la próxima posición ya lo tiene).
      const c = enCache(db, texto)
      if (c === undefined) { void ubicar(db, texto).catch(() => null); continue }
      if (!c) continue
      const m = metros(aqui, c)
      if (m > radio) continue
      db.prepare('INSERT OR IGNORE INTO ubicacion_avisos (mision_id, en) VALUES (?, ?)').run(q.id, ahora)
      db.prepare(`UPDATE misiones SET estado = 'activa' WHERE id = ? AND estado = 'sugerida'`).run(q.id)
      activadas.push({ id: q.id, titulo: q.titulo, cerca: texto, metros: m })
      break
    }
  }
  if (activadas.length) {
    const { difundir } = await import('./chat/index.ts')
    difundir(activadas.map((a) => `📍 Estás cerca de ${a.cerca} (a ${a.metros < 1000 ? `${a.metros} m` : `${(a.metros / 1000).toFixed(1).replace('.', ',')} km`}): «${a.titulo}».`).join('\n'))
  }
  return activadas
}

/** Para el chat (y el Directo): dónde está ahora, por el lugar suyo más cercano. Vacío si está apagada o no hay señal. */
export function ubicacionParaPrompt(db: Db, ahora = Date.now()): string {
  const u = ubicacionActual(db, ahora)
  if (!u) return ''
  const lugares = (db.prepare(`SELECT nombre, meta FROM entidades WHERE tipo = 'lugar' AND meta IS NOT NULL`).all() as { nombre: string; meta: string }[])
    .map((l) => { try { const m = JSON.parse(l.meta); return Number.isFinite(m.lat) && Number.isFinite(m.lon) ? { nombre: l.nombre, d: metros(u, { lat: m.lat, lon: m.lon }) } : null } catch { return null } })
    .filter((x): x is { nombre: string; d: number } => !!x).sort((a, b) => a.d - b.d)
  const cerca = lugares[0] && lugares[0].d <= 2000 ? `cerca de ${lugares[0].nombre} (a ${lugares[0].d < 1000 ? `${lugares[0].d} m` : `${(lugares[0].d / 1000).toFixed(1).replace('.', ',')} km`})` : `en ${u.lat.toFixed(3)}, ${u.lon.toFixed(3)}`
  const hace = Math.max(0, Math.round((ahora - u.en) / 60_000))
  return `Dónde está ahora (ubicación en vivo, hace ${hace} min, por ${u.fuente}): ${cerca}.`
}
