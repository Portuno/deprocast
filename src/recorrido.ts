/**
 * El recorrido (Mobile 1.0.1): por dónde anduvo, guardado de verdad (la ubicación «en vivo» vence a los 15 minutos y
 * sirve para las side quests; esto es la historia). Llega del teléfono (la pestaña Mapa, en segundo plano), de Telegram
 * (ubicación fija o en vivo) y de WhatsApp (ubicación fija: WhatsApp no le pasa a los bots la ubicación en vivo).
 *
 * Del día salen las paradas (un lugar donde se quedó 5 minutos o más sin alejarse 100 m), con cuánto estuvo, el lugar
 * suyo más cercano si lo hay, y la distancia recorrida. Mastropiero lo lee con ver_recorrido para analizarlo (dónde
 * estuvo, cuánto, y qué dijo ahí, cruzándolo con sus audios).
 */
import { fechaLocal, type Db } from './db.ts'
import { metros } from './ubicacion.ts'

export type PuntoRecorrido = { en: number; lat: number; lon: number; precision: number | null; fuente: string }
export type Parada = { lat: number; lon: number; desde: number; hasta: number; minutos: number; puntos: number; lugar: string | null; lugarMetros: number | null }

export const RADIO_PARADA_M = 100
export const MINIMO_PARADA_MS = 5 * 60_000

/** Guarda los puntos de una fuente (un dispositivo, telegram, whatsapp). El mismo instante dos veces no se duplica. */
export function guardarPuntos(db: Db, fuente: string, puntos: unknown, ahora = Date.now()): { guardados: number; ultimo: PuntoRecorrido | null } {
  if (!Array.isArray(puntos)) throw new Error('Mandá una lista de puntos')
  const ins = db.prepare('INSERT OR IGNORE INTO recorrido_puntos (fuente, en, lat, lon, precision, recibido) VALUES (?, ?, ?, ?, ?, ?)')
  let guardados = 0
  let ultimo: PuntoRecorrido | null = null
  for (const p of puntos.slice(0, 5000) as any[]) {
    const lat = Number(p?.lat), lon = Number(p?.lon), en = Math.round(Number(p?.en))
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    if (!Number.isFinite(en) || en <= 0 || en > ahora + 120_000) continue
    const precision = p?.precision == null || !Number.isFinite(Number(p.precision)) ? null : Math.round(Number(p.precision))
    guardados += Number(ins.run(fuente.slice(0, 40), en, lat, lon, precision, ahora).changes)
    if (!ultimo || en > ultimo.en) ultimo = { en, lat, lon, precision, fuente }
  }
  return { guardados, ultimo }
}

const inicioDelDia = (fecha: string) => new Date(`${fecha}T00:00:00`).getTime()

/** Los puntos de un día (de todas las fuentes, y los minutos con lugar de la escucha), en orden. */
export function puntosDelDia(db: Db, fecha = fechaLocal()): PuntoRecorrido[] {
  const desde = inicioDelDia(fecha), hasta = desde + 86_400_000
  const propios = db.prepare('SELECT en, lat, lon, precision, fuente FROM recorrido_puntos WHERE en >= ? AND en < ? ORDER BY en').all(desde, hasta) as PuntoRecorrido[]
  const capas = (db.prepare(`SELECT minuto AS en, lat, lon, precision FROM capas_minuto WHERE minuto >= ? AND minuto < ? AND lat IS NOT NULL AND lon IS NOT NULL ORDER BY minuto`).all(desde, hasta) as any[])
    .map((x) => ({ ...x, fuente: 'escucha' }) as PuntoRecorrido)
  return [...propios, ...capas].sort((a, b) => a.en - b.en)
}

/** Las paradas: grupos de puntos seguidos que no se alejan más de 100 m y duran 5 minutos o más. */
export function paradasDe(puntos: PuntoRecorrido[]): Omit<Parada, 'lugar' | 'lugarMetros'>[] {
  const out: Omit<Parada, 'lugar' | 'lugarMetros'>[] = []
  let grupo: PuntoRecorrido[] = []
  const cerrar = () => {
    if (grupo.length && grupo.at(-1)!.en - grupo[0].en >= MINIMO_PARADA_MS) {
      out.push({ lat: grupo.reduce((s, p) => s + p.lat, 0) / grupo.length, lon: grupo.reduce((s, p) => s + p.lon, 0) / grupo.length, desde: grupo[0].en, hasta: grupo.at(-1)!.en, minutos: Math.round((grupo.at(-1)!.en - grupo[0].en) / 60_000), puntos: grupo.length })
    }
    grupo = []
  }
  for (const p of puntos) {
    if (grupo.length) {
      const c = { lat: grupo.reduce((s, x) => s + x.lat, 0) / grupo.length, lon: grupo.reduce((s, x) => s + x.lon, 0) / grupo.length }
      if (metros(c, p) > RADIO_PARADA_M) cerrar()
    }
    grupo.push(p)
  }
  cerrar()
  return out
}

/** La distancia recorrida en el día (sumando tramos; los saltos de más de 50 km entre dos puntos no cuentan: son errores). */
export function distanciaKm(puntos: PuntoRecorrido[]): number {
  let m = 0
  for (let i = 1; i < puntos.length; i++) { const d = metros(puntos[i - 1], puntos[i]); if (d < 50_000) m += d }
  return Math.round(m / 100) / 10
}

/** El día entero: puntos (para dibujar), paradas con el lugar suyo más cercano, y la distancia. */
export async function recorridoDelDia(db: Db, fecha = fechaLocal()) {
  const puntos = puntosDelDia(db, fecha)
  let lugares: { titulo: string; lat: number; lon: number }[] = []
  try { lugares = (await (await import('./mapa.ts')).puntosDelMapa(db, new Set(['lugar']))).puntos.filter((p) => !p.aprox) } catch { /* sin lugares */ }
  const paradas: Parada[] = paradasDe(puntos).map((p) => {
    const cerca = lugares.map((l) => ({ l, m: metros(p, l) })).sort((a, b) => a.m - b.m)[0]
    return { ...p, lugar: cerca && cerca.m <= 200 ? cerca.l.titulo : null, lugarMetros: cerca && cerca.m <= 200 ? cerca.m : null }
  })
  return { fecha, puntos, paradas, distanciaKm: distanciaKm(puntos), fuentes: [...new Set(puntos.map((p) => p.fuente))], ultimo: puntos.at(-1) ?? null }
}
