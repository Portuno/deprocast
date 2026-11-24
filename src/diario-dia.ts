/**
 * El Diario del día (Mobile 2.2): todo lo que se capturó de un día, en una sola línea de tiempo, sin modelo.
 * - Arriba, los números: pasos, km, pantalla, sueño, ánimo, gastos, fotos y charlas.
 * - La línea: el sueño, lo que soñaste, la agenda, las paradas y los trayectos del recorrido, las fotos, lo que se dijo
 *   cerca del teléfono (agrupado en charlas), las comidas, el ejercicio, el ánimo y los gastos. Cada cosa con su hora.
 * - El mapa del día (los puntos, raleados) y los pasos por hora, para dibujarlos.
 * Lo usan la pantalla (/api/diario-dia), el teléfono (/api/dispositivo/diario) y Mastropiero (ver_diario_dia).
 * Distinto del «diario» de charla (contarle algo a Mastropiero) y del diario de prensa.
 */
import { fechaLocal, type Db } from './db.ts'
import { paradasDe, puntosDelDia, distanciaKm } from './recorrido.ts'
import { metros } from './ubicacion.ts'

export type Momento = {
  en: number
  tipo: 'sueno' | 'sonado' | 'evento' | 'parada' | 'trayecto' | 'foto' | 'charla' | 'comida' | 'ejercicio' | 'animo' | 'salud' | 'gasto' | 'musica' | 'bluetooth' | 'llamada' | 'mensajes'
  icono: string
  titulo: string
  sub: string | null
  hasta?: number | null
  lat?: number | null
  lon?: number | null
  foto?: string | null
}
export type Resumen = { llamadas: number; recibidos: number; pasos: number; km: number; pantallaMin: number | null; desbloqueos: number | null; suenoHoras: number | null; animo: number | null; gastos: number; fotos: number; charlas: number; paradas: number; mensajes: number }
export type DiarioDia = { fecha: string; resumen: Resumen; momentos: Momento[]; pasosPorHora: number[]; mapa: { puntos: [number, number][]; paradas: { lat: number; lon: number; n: number; lugar: string | null }[] } }

const MIN = 60_000
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)
const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) : d } catch { return d } }
const existe = (db: Db, tabla: string) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tabla)
const recorte = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const enHora = (fecha: string, hora: string | null, def = '12:00') => new Date(`${fecha}T${hora && /^\d{2}:\d{2}$/.test(hora) ? hora : def}:00`).getTime()
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`)

/** Lo dicho cerca del teléfono, agrupado: turnos separados por menos de 5 minutos son una charla. */
export function agruparCharlas(turnos: { inicio: number; fin: number | null; texto: string; quien: string | null; modo: string }[]): Momento[] {
  const out: Momento[] = []
  let g: typeof turnos = []
  const cerrar = () => {
    if (!g.length) return
    const quienes = [...new Set(g.map((x) => x.quien).filter(Boolean))] as string[]
    const sola = g.length === 1 && g[0].modo !== 'conversacion'
    out.push({
      en: g[0].inicio, hasta: g.at(-1)!.fin ?? g.at(-1)!.inicio, tipo: 'charla', icono: sola ? (g[0].modo === 'dictado' ? '💬' : '🎙') : '🗣',
      titulo: sola ? (g[0].modo === 'dictado' ? 'Le dictaste' : 'Pensaste en voz alta') : `Charla${quienes.length ? ` con ${quienes.join(', ')}` : ''} · ${g.length} turnos`,
      sub: recorte(g.map((x) => x.texto).join(' · '), 220),
    })
    g = []
  }
  for (const t of [...turnos].sort((a, b) => a.inicio - b.inicio)) {
    if (g.length && t.inicio - (g.at(-1)!.fin ?? g.at(-1)!.inicio) > 5 * MIN) cerrar()
    g.push(t)
  }
  cerrar()
  return out
}

export async function diarioDelDia(db: Db, fecha = fechaLocal(), o: { agenda?: boolean } = {}): Promise<DiarioDia> {
  const a = new Date(`${fecha}T00:00:00`).getTime(), b = a + 86_400_000
  const momentos: Momento[] = []

  // ─── el recorrido: paradas y trayectos ───
  const puntos = puntosDelDia(db, fecha)
  let lugares: { titulo: string; lat: number; lon: number }[] = []
  try { lugares = (await (await import('./mapa.ts')).puntosDelMapa(db, new Set(['lugar']))).puntos.filter((p) => !p.aprox) } catch { /* sin lugares */ }
  const paradas = paradasDe(puntos).map((p, i) => {
    const cerca = lugares.map((l) => ({ l, m: metros(p, l) })).sort((x, y) => x.m - y.m)[0]
    return { ...p, n: i + 1, lugar: cerca && cerca.m <= 200 ? cerca.l.titulo : null }
  })
  let desde = puntos[0]?.en ?? null
  const trayecto = (hasta: number) => {
    if (desde == null) return
    const tramo = puntos.filter((p) => p.en >= desde! && p.en <= hasta)
    const km = distanciaKm(tramo)
    if (km >= 0.1) momentos.push({ en: desde, hasta, tipo: 'trayecto', icono: '🚶', titulo: `${String(km).replace('.', ',')} km`, sub: `${hm(desde)}–${hm(hasta)} · ${dur(Math.round((hasta - desde) / MIN))}`, lat: tramo[0]?.lat, lon: tramo[0]?.lon })
  }
  for (const p of paradas) {
    trayecto(p.desde)
    momentos.push({ en: p.desde, hasta: p.hasta, tipo: 'parada', icono: '📍', titulo: p.lugar ?? `Parada ${p.n}`, sub: `${hm(p.desde)}–${hm(p.hasta)} · ${dur(p.minutos)}`, lat: p.lat, lon: p.lon })
    desde = p.hasta
  }
  if (puntos.length) trayecto(puntos.at(-1)!.en)

  // ─── salud: sueño, comidas, ejercicio, ánimo, medidas ───
  const salud = db.prepare('SELECT * FROM salud WHERE fecha = ? ORDER BY hora').all(fecha) as any[]
  let suenoHoras: number | null = null
  const animos: number[] = []
  for (const r of salud) {
    const d = json<Record<string, any>>(r.datos, {})
    if (r.tipo === 'sueno') {
      suenoHoras = Number(d.horas) || suenoHoras
      momentos.push({ en: enHora(fecha, d.despertar ?? null, '07:00'), tipo: 'sueno', icono: '😴', titulo: r.titulo, sub: d.dormir && d.despertar ? `${d.dormir}–${d.despertar}` : null })
      continue
    }
    if (r.tipo === 'animo' && d.animo) animos.push(Number(d.animo))
    const tipo = r.tipo === 'comida' ? 'comida' : r.tipo === 'ejercicio' ? 'ejercicio' : r.tipo === 'animo' ? 'animo' : 'salud'
    const icono = { comida: '🍽', ejercicio: '💪', animo: '🙂', salud: '🩺' }[tipo]
    momentos.push({ en: enHora(fecha, r.hora), tipo, icono, titulo: r.titulo, sub: d.kcal ? `${d.kcal} kcal` : d.minutos ? `${d.minutos} min` : null, foto: r.foto ?? null })
  }

  // ─── lo que soñaste ───
  if (existe(db, 'suenos')) for (const s of db.prepare('SELECT texto, despertar FROM suenos WHERE fecha = ?').all(fecha) as any[]) {
    momentos.push({ en: enHora(fecha, s.despertar, '07:01') + 1000, tipo: 'sonado', icono: '🌙', titulo: 'Soñaste', sub: recorte(String(s.texto), 220) })
  }

  // ─── las fotos (leídas y guardadas en el corpus) ───
  let fotos = 0
  for (const f of db.prepare(`SELECT titulo, datos, creado_en FROM corpus WHERE fuente = 'capturas' AND creado_en >= ? AND creado_en < ? ORDER BY creado_en`).all(a, b) as any[]) {
    const d = json<Record<string, any>>(f.datos, {})
    fotos++
    momentos.push({ en: f.creado_en, tipo: 'foto', icono: '📷', titulo: String(f.titulo).replace(/^Imagen · \d{4}-\d{2}-\d{2} · /, ''), sub: null, foto: d.url ?? null })
  }

  // ─── lo que se dijo cerca del teléfono ───
  let charlas: Momento[] = []
  if (existe(db, 'voz_turnos')) {
    const turnos = db.prepare(`SELECT t.inicio, t.fin, t.texto, t.modo, COALESCE(e.nombre, h.etiqueta) AS quien FROM voz_turnos t LEFT JOIN voz_hablantes h ON h.id = t.hablante_id LEFT JOIN entidades e ON e.id = h.entidad_id WHERE t.inicio >= ? AND t.inicio < ?`).all(a, b) as any[]
    charlas = agruparCharlas(turnos)
    momentos.push(...charlas)
  }

  // ─── la plata ───
  let gastos = 0
  if (existe(db, 'movimientos')) for (const m of db.prepare('SELECT monto, moneda, categoria, descripcion, creado_en FROM movimientos WHERE fecha = ?').all(fecha) as any[]) {
    if (m.monto < 0) gastos += -m.monto
    const en = m.creado_en >= a && m.creado_en < b ? m.creado_en : enHora(fecha, null, '23:59')
    momentos.push({ en, tipo: 'gasto', icono: m.monto < 0 ? '💸' : '💰', titulo: `${m.monto < 0 ? '' : '+'}${Math.abs(m.monto).toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${m.moneda === 'EUR' ? '€' : m.moneda}`, sub: [m.descripcion, m.categoria].filter(Boolean).join(' · ') || null })
  }

  // ─── la música (los temas seguidos, a menos de 15 min, son una tanda) ───
  if (existe(db, 'escuchas')) {
    const xs = (db.prepare(`SELECT en, artista, tema, ms FROM escuchas WHERE en >= ? AND en < ? ORDER BY en`).all(new Date(a).toISOString().slice(0, 16).replace('T', ' '), new Date(b).toISOString().slice(0, 16).replace('T', ' ')) as { en: string; artista: string; tema: string; ms: number }[])
      .map((x) => ({ ...x, fin: new Date(`${x.en.replace(' ', 'T')}:00Z`).getTime() }))
    let g: typeof xs = []
    const cerrar = () => {
      if (!g.length) return
      const artistas = [...new Set(g.map((x) => x.artista))]
      momentos.push({ en: g[0].fin - g[0].ms, hasta: g.at(-1)!.fin, tipo: 'musica', icono: '🎵', titulo: g.length === 1 ? `${g[0].artista} — ${g[0].tema}` : `${g.length} temas`, sub: g.length === 1 ? null : recorte(artistas.slice(0, 5).join(', '), 160) })
      g = []
    }
    for (const x of xs) { if (g.length && x.fin - x.ms - g.at(-1)!.fin > 15 * MIN) cerrar(); g.push(x) }
    cerrar()
  }

  // ─── el audio Bluetooth (el auto, los auriculares) ───
  if (existe(db, 'contexto_telefono')) {
    const { contextoEntre, tramosBluetooth } = await import('./contexto-telefono.ts')
    for (const t of tramosBluetooth(contextoEntre(db, a, b), Math.min(b, Date.now()))) {
      if (t.hasta - t.desde < 3 * MIN) continue
      momentos.push({ en: t.desde, hasta: t.hasta, tipo: 'bluetooth', icono: '🎧', titulo: t.nombre, sub: `${hm(t.desde)}–${hm(t.hasta)} · ${dur(Math.round((t.hasta - t.desde) / MIN))}` })
    }
  }

  // ─── quién te llamó y quién te escribió (Mobile 2.4): cada llamada, y los mensajes por hora ───
  let llamadas = 0, recibidos = 0
  if (existe(db, 'llamadas_telefono')) {
    const { llamadasEntre, recibidosEntre } = await import('./comunicaciones.ts')
    for (const l of llamadasEntre(db, a, b)) {
      llamadas++
      const quien = l.nombre ?? l.numero ?? 'Número oculto'
      const icono = l.tipo === 'perdida' || l.tipo === 'rechazada' ? '📵' : l.tipo === 'saliente' ? '📞' : '📲'
      momentos.push({ en: l.en, hasta: l.en + l.duracionS * 1000, tipo: 'llamada', icono, titulo: quien, sub: l.tipo === 'perdida' ? 'Perdida' : l.tipo === 'rechazada' ? 'Rechazada' : `${l.tipo === 'saliente' ? 'Llamaste' : 'Te llamó'} · ${l.duracionS >= 60 ? dur(Math.round(l.duracionS / 60)) : `${l.duracionS} s`}` })
    }
    const xs = recibidosEntre(db, a, b)
    const porHora = new Map<number, typeof xs>()
    recibidos = xs.length
    for (const m of xs) { const h = Math.floor(m.en / 3_600_000); porHora.set(h, [...(porHora.get(h) ?? []), m]) }
    for (const [, ms] of porHora) {
      const cuenta = new Map<string, number>()
      for (const m of ms) { const k = m.grupo && m.conversacion ? m.conversacion : m.remitente; cuenta.set(k, (cuenta.get(k) ?? 0) + 1) }
      const quienes = [...cuenta].sort((x, y) => y[1] - x[1]).map(([k, n]) => (n > 1 ? `${k} (${n})` : k))
      const apps = [...new Set(ms.map((m) => m.app))]
      momentos.push({ en: ms[0].en, hasta: ms.at(-1)!.en, tipo: 'mensajes', icono: '💬', titulo: `${ms.length} mensaje${ms.length === 1 ? '' : 's'} · ${apps.join(', ')}`, sub: recorte(quienes.join(', '), 200) })
    }
  }

  // ─── la agenda (de la red: si no contesta, sigue sin ella) ───
  if (o.agenda !== false) {
    try {
      const { agendaDelDia } = await import('./calendario.ts')
      const ag = await Promise.race([agendaDelDia(fecha), new Promise<null>((ok) => setTimeout(() => ok(null), 4000))])
      for (const e of ag?.eventos ?? []) if (!e.todoElDia) momentos.push({ en: e.inicio, hasta: e.fin, tipo: 'evento', icono: '📅', titulo: e.titulo, sub: [`${hm(e.inicio)}–${hm(e.fin)}`, e.lugar].filter(Boolean).join(' · ') })
    } catch { /* sin agenda */ }
  }

  // ─── los números ───
  const pasosPorHora = Array.from({ length: 24 }, () => 0)
  if (existe(db, 'actividad_hora')) for (const f of db.prepare(`SELECT hora, MAX(pasos) AS pasos FROM actividad_hora WHERE hora LIKE ? GROUP BY hora`).all(`${fecha}%`) as { hora: string; pasos: number }[]) pasosPorHora[Number(f.hora.slice(11, 13))] = f.pasos
  const act = await import('./territorio.ts').then((t) => t.actividadDelDia(db, fecha)).catch(() => null)
  const uso = await import('./uso-telefono.ts').then((u) => u.usoDelDia(db, fecha)).catch(() => null)
  const mensajes = (db.prepare(`SELECT COUNT(*) AS n FROM mensajes WHERE rol = 'operador' AND en >= ? AND en < ?`).get(a, b) as { n: number }).n
  const resumen: Resumen = {
    llamadas, recibidos,
    pasos: Math.max(act?.pasos ?? 0, pasosPorHora.reduce((s, x) => s + x, 0)),
    km: distanciaKm(puntos),
    pantallaMin: uso?.hayDatos ? uso.pantallaMin : null,
    desbloqueos: uso?.hayDatos ? uso.desbloqueos : null,
    suenoHoras,
    animo: animos.length ? Math.round((animos.reduce((s, x) => s + x, 0) / animos.length) * 10) / 10 : null,
    gastos: Math.round(gastos * 100) / 100,
    fotos,
    charlas: charlas.length,
    paradas: paradas.length,
    mensajes,
  }
  const paso = Math.max(1, Math.ceil(puntos.length / 1500))
  return {
    fecha, resumen, pasosPorHora,
    momentos: momentos.sort((x, y) => x.en - y.en),
    mapa: { puntos: puntos.filter((_, i) => i % paso === 0).map((p) => [p.lat, p.lon]), paradas: paradas.map((p) => ({ lat: p.lat, lon: p.lon, n: p.n, lugar: p.lugar })) },
  }
}
