/**
 * El sueño estimado, sin reloj (Fragua #298). A qué hora te dormiste y a qué hora te despertaste, sacado de cuándo
 * hubo actividad tuya y cuándo no:
 * - la pantalla del teléfono prendida (las sesiones que manda la app con «Acceso a uso»): la señal más fuerte;
 * - los pasos del teléfono por hora (una hora con 150 pasos o más es que andabas);
 * - lo que le escribiste a Mastropiero (chat, Telegram, WhatsApp);
 * - la escucha: minutos en que hablaste o caminaste;
 * - la carga (Mobile 2.1): enchufar o desenchufar el teléfono es un gesto tuyo; y una noche enchufado y sin actividad
 *   sube la confianza.
 * El sueño es el hueco sin actividad más largo de la noche (de 19 a 14, de al menos 2 h 30). Si al lado hay otro hueco
 * largo separado por un ratito (una mirada al teléfono a las 4), se junta y cuenta como interrupción. Hace falta
 * actividad antes y después: si no, no se estima. Queda en salud como sueño «estimado» (nunca pisa uno que anotaste
 * vos) y así entra al Diario.
 */
import { fechaLocal, type Db } from './db.ts'
import { cambiosDeCarga, muestrasEntre, parteEnchufado } from './carga-telefono.ts'

export type Senal = 'pantalla' | 'pasos' | 'chat' | 'escucha' | 'carga'
type Tramo = { desde: number; hasta: number; fuente: Senal }
export type SuenoEstimado = { fecha: string; dormir: string; despertar: string; horas: number; interrupciones: number; confianza: 'alta' | 'media' | 'baja'; fuentes: Senal[]; desde: number; hasta: number }

const MIN = 60_000
const HUECO_MINIMO = 150 * MIN
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)
const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) : d } catch { return d } }
const existe = (db: Db, tabla: string) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tabla)

/** Toda la actividad entre a y b, como tramos (un mensaje o un minuto es un tramo corto). */
export function actividadEntre(db: Db, a: number, b: number): Tramo[] {
  const out: Tramo[] = []
  if (existe(db, 'uso_telefono')) {
    const filas = db.prepare(`SELECT sesiones FROM uso_telefono WHERE fecha BETWEEN ? AND ?`).all(fechaLocal(a), fechaLocal(b)) as { sesiones: string | null }[]
    for (const f of filas) for (const [x, y] of json<[number, number][]>(f.sesiones, [])) if (y > a && x < b) out.push({ desde: Math.max(x, a), hasta: Math.min(y, b), fuente: 'pantalla' })
  }
  if (existe(db, 'actividad_hora')) {
    const desde = fechaLocal(a), hasta = fechaLocal(b)
    for (const f of db.prepare(`SELECT hora, MAX(pasos) AS pasos FROM actividad_hora WHERE substr(hora, 1, 10) BETWEEN ? AND ? GROUP BY hora`).all(desde, hasta) as { hora: string; pasos: number }[]) {
      if (f.pasos < 150) continue
      const t = new Date(`${f.hora}:30:00`).getTime()
      if (t >= a && t < b) out.push({ desde: t, hasta: t + MIN, fuente: 'pasos' })
    }
  }
  for (const f of db.prepare(`SELECT en FROM mensajes WHERE rol = 'operador' AND en >= ? AND en < ?`).all(a, b) as { en: number }[]) out.push({ desde: f.en, hasta: f.en + MIN, fuente: 'chat' })
  if (existe(db, 'capas_minuto')) {
    for (const f of db.prepare(`SELECT minuto FROM capas_minuto WHERE minuto >= ? AND minuto < ? AND (hablo > 0 OR pasos > 20)`).all(a, b) as { minuto: number }[]) out.push({ desde: f.minuto, hasta: f.minuto + MIN, fuente: 'escucha' })
  }
  if (existe(db, 'carga_telefono')) {
    for (const x of cambiosDeCarga(muestrasEntre(db, a - 3_600_000, b + 3_600_000))) if (x.en >= a && x.en < b) out.push({ desde: x.en, hasta: x.en + MIN, fuente: 'carga' })
  }
  return out.sort((x, y) => x.desde - y.desde)
}

/** El sueño de la noche que termina el día `fecha` (te despertaste ese día). null si no alcanza para estimarlo. */
export function estimarSueno(db: Db, fecha: string): SuenoEstimado | null {
  const dia = new Date(`${fecha}T00:00:00`).getTime()
  const a = dia - 5 * 3_600_000, b = dia + 14 * 3_600_000 // de las 19 de la víspera a las 14
  const tramos = actividadEntre(db, a, b)
  if (tramos.length < 2) return null
  // Los huecos entre actividad (juntando lo que se pisa).
  const huecos: { desde: number; hasta: number; antes: Tramo; despues: Tramo }[] = []
  let fin = tramos[0].hasta, ultimo = tramos[0]
  for (const t of tramos.slice(1)) {
    if (t.desde > fin) huecos.push({ desde: fin, hasta: t.desde, antes: ultimo, despues: t })
    if (t.hasta >= fin) { fin = t.hasta; ultimo = t }
  }
  if (!huecos.length) return null
  let i = huecos.reduce((m, h, k) => (h.hasta - h.desde > huecos[m].hasta - huecos[m].desde ? k : m), 0)
  if (huecos[i].hasta - huecos[i].desde < HUECO_MINIMO) return null
  let desde = huecos[i].desde, hasta = huecos[i].hasta, interrupciones = 0
  // Una interrupción corta (menos de 15 min) entre dos huecos largos (de 45 min o más) es parte de la misma noche.
  const largo = (h: typeof huecos[number]) => h.hasta - h.desde >= 45 * MIN
  for (let k = i + 1; k < huecos.length && largo(huecos[k]) && huecos[k].desde - hasta < 15 * MIN; k++) { hasta = huecos[k].hasta; interrupciones++ }
  for (let k = i - 1; k >= 0 && largo(huecos[k]) && desde - huecos[k].hasta < 15 * MIN; k--) { desde = huecos[k].desde; interrupciones++; i = k }
  // Tiene que haber actividad antes y después dentro de la ventana (si no, el borde es el de la ventana, no el tuyo).
  if (desde <= a || hasta >= b) return null
  const cerca = tramos.filter((t) => t.hasta >= desde - 3 * 3_600_000 && t.desde <= hasta + 3 * 3_600_000)
  const fuentes = [...new Set(cerca.map((t) => t.fuente))]
  // Enchufado la mayor parte del hueco: una señal más de que dormías.
  const enchufado = existe(db, 'carga_telefono') && parteEnchufado(muestrasEntre(db, desde - 3_600_000, hasta), desde, hasta) >= 0.6
  if (enchufado && !fuentes.includes('carga')) fuentes.push('carga')
  const confianza = fuentes.includes('pantalla') ? 'alta' : fuentes.length >= 2 ? 'media' : 'baja'
  return { fecha, dormir: hm(desde), despertar: hm(hasta), horas: Math.round(((hasta - desde) / 3_600_000) * 10) / 10, interrupciones, confianza, fuentes, desde, hasta }
}

/**
 * Lo anota en salud como sueño estimado del día (nunca pisa uno anotado a mano: ese manda). Devuelve lo anotado, o
 * null si no se pudo estimar o ya había uno suyo.
 */
export async function anotarSuenoEstimado(db: Db, fecha: string, ahora = Date.now()): Promise<SuenoEstimado | null> {
  const s = estimarSueno(db, fecha)
  if (!s) return null
  const ya = db.prepare(`SELECT fuente FROM salud WHERE tipo = 'sueno' AND fecha = ?`).get(fecha) as { fuente: string } | undefined
  if (ya && ya.fuente !== 'estimado') return null
  if (ya) db.prepare(`DELETE FROM salud WHERE tipo = 'sueno' AND fecha = ? AND fuente = 'estimado'`).run(fecha)
  const { registrarSalud } = await import('./salud.ts')
  registrarSalud(db, {
    tipo: 'sueno', fecha, fuente: 'estimado',
    titulo: `Dormiste ~${String(s.horas).replace('.', ',')} h (estimado, ${s.dormir}–${s.despertar}${s.interrupciones ? `, ${s.interrupciones} interrupción${s.interrupciones === 1 ? '' : 'es'}` : ''})`,
    datos: { horas: s.horas, dormir: s.dormir, despertar: s.despertar, origen: 'estimado', confianza: s.confianza, nota: `Estimado sin reloj, por ${s.fuentes.join(', ')}: no es una medición.` },
  }, ahora)
  return s
}
