/**
 * Tu día en capas (plan v38, fase 6; Fragua #133). Mientras la app del teléfono escucha, junta un minuto por vez:
 * cuánto hablaste vos (tu voz directa), cuánto escuchaste (otras voces), ruido y silencio, el nivel de tu voz y del
 * ambiente, los pasos (del acelerómetro: el Huawei no tiene podómetro) y la ubicación si la app tiene el permiso.
 * Acá se guardan (sin audio: solo números), se arma la línea de tiempo del día y el recorrido, y salen dos o tres
 * consejos concretos para el parte de la mañana.
 *
 * La distancia al micrófono se estima con tu voz: cuando le hablás de cerca (lo levantaste, dictado) queda la
 * referencia de tu nivel; cada 6 dB menos que eso es el doble de distancia (cuadrado inverso).
 */
import { fechaLocal, type Db } from './db.ts'

export type MinutoCapa = {
  minuto: number // el comienzo del minuto (ms)
  hablo: number; escucho: number; ruido: number; silencio: number // segundos de cada cosa en el minuto
  vozDb?: number | null; vozCercaDb?: number | null; pisoDb?: number | null
  pasos?: number; caminando?: number // pasos en el minuto y segundos caminando
  lat?: number | null; lon?: number | null; precision?: number | null
}

const CERCA_CM = 15 // a cuánto lo tenés cuando le dictás
const seg = (n: unknown) => Math.max(0, Math.min(60, Math.round(Number(n) || 0)))
const num = (n: unknown) => (n == null || !Number.isFinite(Number(n)) ? null : Number(n))

/** Guarda los minutos que mandó un dispositivo (si repite uno, lo reemplaza). */
export function recibirCapas(db: Db, dispositivoId: number, minutos: MinutoCapa[], ahora = Date.now()) {
  if (!Array.isArray(minutos)) throw new Error('Mandá una lista de minutos')
  const ins = db.prepare(`INSERT INTO capas_minuto (dispositivo_id, minuto, hablo, escucho, ruido, silencio, voz_db, voz_cerca_db, piso_db, pasos, caminando, lat, lon, precision, recibido)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dispositivo_id, minuto) DO UPDATE SET hablo = excluded.hablo, escucho = excluded.escucho, ruido = excluded.ruido, silencio = excluded.silencio,
      voz_db = excluded.voz_db, voz_cerca_db = excluded.voz_cerca_db, piso_db = excluded.piso_db, pasos = excluded.pasos, caminando = excluded.caminando,
      lat = excluded.lat, lon = excluded.lon, precision = excluded.precision, recibido = excluded.recibido`)
  let n = 0
  for (const m of minutos.slice(0, 1440)) {
    const t = Math.floor(Number(m?.minuto) / 60_000) * 60_000
    if (!Number.isFinite(t) || t <= 0 || t > ahora + 120_000) continue
    const lat = num(m.lat), lon = num(m.lon)
    const conLugar = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ins.run(dispositivoId, t, seg(m.hablo), seg(m.escucho), seg(m.ruido), seg(m.silencio), num(m.vozDb), num(m.vozCercaDb), num(m.pisoDb),
      Math.max(0, Math.min(400, Math.round(Number(m.pasos) || 0))), seg(m.caminando), conLugar ? lat : null, conLugar ? lon : null, conLugar ? num(m.precision) : null, ahora)
    n++
  }
  return { guardados: n }
}

/** Tu nivel de voz de cerca (la mediana de los minutos en que le dictaste), o null si todavía no hay con qué. */
export function referenciaVoz(db: Db, ahora = Date.now()): number | null {
  const xs = (db.prepare('SELECT voz_cerca_db AS v FROM capas_minuto WHERE voz_cerca_db IS NOT NULL AND minuto >= ? ORDER BY v').all(ahora - 30 * 86_400_000) as { v: number }[]).map((r) => r.v)
  return xs.length >= 3 ? xs[Math.floor(xs.length / 2)] : null
}

/** A qué distancia del micrófono hablabas (en cm), por el nivel de tu voz contra tu referencia de cerca. */
export const distanciaCm = (vozDb: number, ref: number) => Math.round(CERCA_CM * 10 ** ((ref - vozDb) / 20))

type Fila = { minuto: number; hablo: number; escucho: number; ruido: number; silencio: number; voz_db: number | null; piso_db: number | null; pasos: number; caminando: number; lat: number | null; lon: number | null }
type Tramo = { desde: number; hasta: number } // minutos del día (0–1439), hasta incluido

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const duracion = (min: number) => (min >= 90 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}` : `${min} minutos`)

/** Junta los minutos marcados en tramos, tolerando huecos cortos. */
function tramos(marcados: number[], hueco = 2): Tramo[] {
  const ts: Tramo[] = []
  for (const m of [...marcados].sort((a, b) => a - b)) {
    const u = ts.at(-1)
    if (u && m - u.hasta <= hueco + 1) u.hasta = m
    else ts.push({ desde: m, hasta: m })
  }
  return ts
}
const largo = (t: Tramo) => t.hasta - t.desde + 1

/** El día en capas: la línea de tiempo (habló / escuchó / caminó / quieto), el recorrido, los totales y los consejos. */
export function diaEnCapas(db: Db, fecha = fechaLocal(), ahora = Date.now()) {
  const inicio = new Date(`${fecha}T00:00:00`).getTime()
  // Si hay más de un dispositivo, por minuto se queda el que más oyó (sin sumar dos veces la misma voz).
  const filas = db.prepare(`SELECT minuto, MAX(hablo) AS hablo, MAX(escucho) AS escucho, MAX(ruido) AS ruido, MAX(silencio) AS silencio, MAX(voz_db) AS voz_db, MIN(piso_db) AS piso_db,
      MAX(pasos) AS pasos, MAX(caminando) AS caminando, MAX(lat) AS lat, MAX(lon) AS lon
    FROM capas_minuto WHERE minuto >= ? AND minuto < ? GROUP BY minuto ORDER BY minuto`).all(inicio, inicio + 86_400_000) as Fila[]
  const ref = referenciaVoz(db, ahora)
  const idx = (f: Fila) => Math.round((f.minuto - inicio) / 60_000)
  const hablo = filas.filter((f) => f.hablo >= 10)
  const escucho = filas.filter((f) => f.escucho >= 10 && f.hablo < 10)
  const camino = filas.filter((f) => f.caminando >= 20)
  const quieto = filas.filter((f) => f.caminando < 5 && f.pasos < 10)
  const lejos = hablo.filter((f) => ref != null && f.voz_db != null && distanciaCm(f.voz_db, ref) > 150)
  const tapado = hablo.filter((f) => f.voz_db != null && f.piso_db != null && f.voz_db - f.piso_db < 10)
  const capas = {
    hablo: tramos(hablo.map(idx)), escucho: tramos(escucho.map(idx)), camino: tramos(camino.map(idx), 1), quieto: tramos(quieto.map(idx), 1),
    lejos: tramos(lejos.map(idx)), sinDatos: [] as Tramo[],
  }
  const conDatos = new Set(filas.map(idx))
  capas.sinDatos = tramos(Array.from({ length: Math.min(1440, Math.max(0, Math.ceil((Math.min(ahora, inicio + 86_400_000) - inicio) / 60_000))) }, (_, i) => i).filter((i) => !conDatos.has(i)), 0)
  // El recorrido: un punto cada tanto (si se movió más de ~30 m o pasaron 10 minutos).
  const recorrido: [number, number, string][] = []
  for (const f of filas) {
    if (f.lat == null || f.lon == null) continue
    const u = recorrido.at(-1)
    const lejosDelUltimo = !u || Math.hypot((f.lat - u[0]) * 111_000, (f.lon - u[1]) * 85_000) > 30
    if (lejosDelUltimo || recorrido.length % 10 === 0) recorrido.push([f.lat, f.lon, hhmm(idx(f))])
  }
  const totales = {
    minutos: filas.length, hablo: hablo.length, escucho: escucho.length, camino: camino.length, quieto: quieto.length,
    pasos: filas.reduce((s, f) => s + f.pasos, 0), lejos: lejos.length,
  }
  return { fecha, referenciaVoz: ref, totales, capas, recorrido, consejos: consejos(db, fecha, { hablo, tapado, lejos, capas, totales, ref, idx }) }
}

/** Dos o tres consejos concretos, con hora y número (sin modelo). */
function consejos(db: Db, fecha: string, d: { hablo: Fila[]; tapado: Fila[]; lejos: Fila[]; capas: { hablo: Tramo[]; quieto: Tramo[] }; totales: { minutos: number; pasos: number }; ref: number | null; idx: (f: Fila) => number }): string[] {
  const out: { peso: number; texto: string }[] = []
  // El tramo más largo hablando, si el ruido o la distancia se comieron una parte.
  const charla = [...d.capas.hablo].sort((a, b) => largo(b) - largo(a))[0]
  if (charla && largo(charla) >= 15) {
    const adentro = (f: Fila) => d.idx(f) >= charla.desde && d.idx(f) <= charla.hasta
    const enCharla = d.hablo.filter(adentro)
    const tapados = d.tapado.filter(adentro).length
    const lejos = d.lejos.filter(adentro).length
    const parte = enCharla.length ? tapados / enCharla.length : 0
    if (parte >= 0.3 || lejos >= enCharla.length / 2) {
      const cuanto = parte >= 0.45 ? 'la mitad' : parte >= 0.3 ? 'un tercio' : 'una parte'
      const metros = d.ref != null && enCharla.some((f) => f.voz_db != null) ? Math.round(enCharla.filter((f) => f.voz_db != null).reduce((s, f) => s + distanciaCm(f.voz_db!, d.ref!), 0) / enCharla.filter((f) => f.voz_db != null).length / 10) / 10 : null
      out.push({ peso: largo(charla), texto: `Hablaste ${duracion(largo(charla))} seguidos (${hhmm(charla.desde)}–${hhmm(charla.hasta + 1)})${lejos >= enCharla.length / 2 ? ` lejos del micrófono${metros ? ` (unos ${String(metros).replace('.', ',')} m)` : ''}` : ''}: el ruido se comió ${cuanto}. La próxima, el teléfono más cerca o el modo conversación.` })
    }
  }
  // Mucho tiempo quieto de corrido.
  const quieto = [...d.capas.quieto].sort((a, b) => largo(b) - largo(a))[0]
  if (quieto && largo(quieto) >= 120) out.push({ peso: largo(quieto) / 2, texto: `Estuviste ${duracion(largo(quieto))} quieto de ${hhmm(quieto.desde)} a ${hhmm(quieto.hasta + 1)}: una caminata de 10 minutos a la mitad lo corta.` })
  // Los pasos contra tu semana (solo si hay días con qué comparar y el día tuvo datos suficientes).
  if (d.totales.minutos >= 240) {
    const inicio = new Date(`${fecha}T00:00:00`).getTime()
    const dias = (db.prepare(`SELECT minuto / 86400000 AS dia, SUM(pasos) AS p, COUNT(*) AS n FROM capas_minuto WHERE minuto >= ? AND minuto < ? GROUP BY dia HAVING n >= 240`).all(inicio - 7 * 86_400_000, inicio) as { p: number }[]).map((r) => r.p).sort((a, b) => a - b)
    if (dias.length >= 3) {
      const mediana = dias[Math.floor(dias.length / 2)]
      if (mediana > 500 && d.totales.pasos < mediana * 0.6) out.push({ peso: 60, texto: `Caminaste ${d.totales.pasos.toLocaleString('es-AR')} pasos, bastante menos que tu día habitual (${mediana.toLocaleString('es-AR')}). Una vuelta a la manzana después de comer los empareja.` })
    }
  }
  return out.sort((a, b) => b.peso - a.peso).slice(0, 3).map((c) => c.texto)
}

/** Para el parte de la mañana: el día de ayer en capas (vacío si no hubo escucha). */
export function capasParaPrompt(db: Db, fecha: string, ahora = Date.now()): string {
  const d = diaEnCapas(db, fecha, ahora)
  if (d.totales.minutos < 30) return ''
  const t = d.totales
  return [
    `Su día de ayer en capas (lo que oyó y midió el teléfono, ${duracion(t.minutos)} con datos): habló ${duracion(t.hablo)}, escuchó ${duracion(t.escucho)}, caminó ${duracion(t.camino)} (${t.pasos.toLocaleString('es-AR')} pasos), quieto ${duracion(t.quieto)}.`,
    d.consejos.length ? `Consejos concretos para decirle: ${d.consejos.join(' ')}` : '',
  ].filter(Boolean).join('\n')
}
