/**
 * El informe único (plan v29): todo lo de un período en un solo lugar, la semana o entre dos fechas que él elige.
 * - Una sección por área (lo que hizo, su archivo, su grafo, sus agentes, el Observatorio, la Academia, el cuerpo, la
 *   plata, lo que espera su ok, lo que dijeron las rutinas del domingo, los tokens). Sin movimiento, la sección no va.
 * - Las secciones salen sin modelo y al instante. Con modelo (en la nube) se suma una apertura de Mastropiero.
 * - Se guarda como reporte (tipo «informe») y como pieza del corpus, así el chat y el grafo lo ven.
 * - El domingo, la rutina «informe_semanal» reemplaza a los avisos sueltos: los de las rutinas que generan algo
 *   (gnosis, lecciones, huecos…) se guardan en informe_avisos y entran acá en vez de llegar uno por uno a Hoy.
 */
import { fechaLocal, type Db } from './db.ts'
import { conAvance, diasDeSemana, guardarReporte, listarMisiones, listarReportes, listarRuns, misionesDeRun, semanaDe, type Reporte } from './misiones.ts'
import { pedirJson } from './modelo.ts'
import { vozPara } from './personalidad.ts'

export type Seccion = { clave: string; titulo: string; vista: string | null; lineas: string[] }
export type Informe = { id: number; tipo: 'semanal' | 'rango'; desde: string; hasta: string; apertura: string | null; secciones: Seccion[]; texto: string; piezaId: number | null; creadoEn: number }

/** Las rutinas cuyo aviso del domingo entra al informe en vez de ir solo a Hoy (si el informe está prendido). */
export const AL_INFORME = ['gnosis', 'lecciones', 'huecos', 'evidencia', 'modelos', 'estrategias']
const DIA = 86_400_000
const MAX_DIAS = 366

const aMs = (f: string) => { const [a, m, d] = f.split('-').map(Number); return new Date(a, m - 1, d).getTime() }
const sumarDias = (f: string, n: number) => { const [a, m, d] = f.split('-').map(Number); return fechaLocal(new Date(a, m - 1, d + n).getTime()) }
const plural = (n: number, uno: string, varios = `${uno}s`) => `${n} ${n === 1 ? uno : varios}`
const redondo = (n: number) => Math.round(n * 10) / 10

/** La semana (lunes a domingo) de un momento. */
export function rangoDeSemana(ahora = Date.now()): { desde: string; hasta: string } {
  return diasDeSemana(semanaDe(ahora))
}

function validar(desde: string, hasta: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) throw new Error('Las fechas van como AAAA-MM-DD')
  if (desde > hasta) throw new Error('«Desde» tiene que ser antes de «hasta»')
  if ((aMs(hasta) - aMs(desde)) / DIA >= MAX_DIAS) throw new Error(`Hasta ${MAX_DIAS} días por informe`)
}

/** Las secciones de un período (sin modelo). desde y hasta incluidos. */
export async function seccionesDe(db: Db, desde: string, hasta: string, o: { ahora?: number; avisosPendientes?: boolean } = {}): Promise<Seccion[]> {
  validar(desde, hasta)
  const ini = aMs(desde)
  const fin = aMs(sumarDias(hasta, 1))
  const ahora = o.ahora ?? Date.now()
  const n = (sql: string, ...args: (string | number)[]) => Number((db.prepare(sql).get(...args) as { n: number | null }).n ?? 0)
  const s: Seccion[] = []
  const sumar = (clave: string, titulo: string, vista: string | null, lineas: (string | false | null | undefined)[]) => {
    const ls = lineas.filter((l): l is string => !!l)
    if (ls.length) s.push({ clave, titulo, vista, lineas: ls })
  }

  // Lo que hizo: runs, bandas, side quests y primarias.
  const runs = listarRuns(db, { desde, hasta, estados: ['en_curso', 'cerrada'] })
  const bandas = runs.flatMap((r) => misionesDeRun(db, r.id))
  const hechas = bandas.filter((m) => m.estado === 'hecha').length
  const minutos = Math.round(bandas.reduce((t, m) => t + (m.estado === 'hecha' ? m.minutos ?? 0 : m.estado === 'parcial' ? (m.minutos ?? 0) / 2 : 0), 0))
  const terciarias = n(`SELECT COUNT(*) AS n FROM misiones WHERE personaje = 'jugador' AND nivel = 'terciaria' AND estado = 'hecha' AND cerrada_en >= ? AND cerrada_en < ?`, ini, fin)
  const semanas = new Set<string>()
  for (let t = ini; t < fin; t += DIA) semanas.add(semanaDe(t))
  const primarias = new Map<number, { titulo: string; progreso: number; estado: string }>()
  for (const semana of semanas) {
    for (const p of conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana }).filter((m) => m.estado !== 'sugerida' && m.estado !== 'descartada'))) primarias.set(p.id, { titulo: p.titulo, progreso: p.avance.progreso, estado: p.estado })
  }
  sumar('hiciste', 'Lo que hizo', 'misiones', [
    (runs.length > 0 || terciarias > 0) && `${plural(runs.length, 'run')}, ${hechas} de ${plural(bandas.length, 'banda')} hechas (${minutos} minutos de foco)${terciarias ? `, ${plural(terciarias, 'side quest cumplida', 'side quests cumplidas')}` : ''}.`,
    ...[...primarias.values()].slice(0, 8).map((p) => `${p.titulo}: ${p.progreso}%${p.estado === 'hecha' ? ' (cumplida)' : ''}`),
  ])

  // Su archivo: piezas nuevas por fuente y quántomos.
  const piezas = db.prepare(`SELECT COALESCE(f.nombre, c.fuente) AS nombre, COUNT(*) AS n FROM corpus c LEFT JOIN fuentes f ON f.id = c.fuente WHERE c.creado_en >= ? AND c.creado_en < ? GROUP BY 1 ORDER BY 2 DESC`).all(ini, fin) as { nombre: string; n: number }[]
  const totalPiezas = piezas.reduce((t, p) => t + p.n, 0)
  const quantomos = db.prepare(`SELECT etapa, COUNT(*) AS n FROM quantomos WHERE creado_en >= ? AND creado_en < ? GROUP BY etapa ORDER BY 2 DESC`).all(ini, fin) as { etapa: string; n: number }[]
  const totalQ = quantomos.reduce((t, q) => t + q.n, 0)
  sumar('archivo', 'Su archivo', 'corpus', [
    totalPiezas > 0 && `${plural(totalPiezas, 'pieza nueva', 'piezas nuevas')}: ${piezas.slice(0, 5).map((p) => `${p.nombre} (${p.n})`).join(', ')}${piezas.length > 5 ? ' y otras' : ''}.`,
    totalQ > 0 && `${plural(totalQ, 'quántomo nuevo', 'quántomos nuevos')} (${quantomos.map((q) => `${q.n} ${q.etapa}`).join(', ')}).`,
  ])

  // Su grafo: el estado del discurso al principio y al final, y los huecos.
  const voz = db.prepare(`SELECT id FROM grafos WHERE clave = 'voz'`).get() as { id: number } | undefined
  if (voz) {
    const estadoEn = (antesDe: number) => { const r = db.prepare('SELECT metricas FROM grafo_semanas WHERE grafo_id = ? AND en < ? ORDER BY en DESC LIMIT 1').get(voz.id, antesDe) as { metricas: string } | undefined; try { return r ? (JSON.parse(r.metricas).estado as string) : null } catch { return null } }
    const antes = estadoEn(ini)
    const despues = estadoEn(fin)
    const abiertos = n('SELECT COUNT(*) AS n FROM grafo_huecos WHERE grafo_id = ? AND creado_en >= ? AND creado_en < ?', voz.id, ini, fin)
    const cerrados = n(`SELECT COUNT(*) AS n FROM grafo_huecos WHERE grafo_id = ? AND estado = 'cerrado' AND actualizado_en >= ? AND actualizado_en < ?`, voz.id, ini, fin)
    const cambio = n('SELECT COUNT(*) AS n FROM grafo_semanas WHERE grafo_id = ? AND en >= ? AND en < ?', voz.id, ini, fin) > 0
    sumar('grafo', 'Su grafo', 'grafo', [
      cambio && despues && (antes && antes !== despues ? `Su discurso pasó de ${antes} a ${despues}.` : `Su discurso sigue ${despues}.`),
      abiertos > 0 && `${plural(abiertos, 'hueco nuevo', 'huecos nuevos')} entre zonas de su voz.`,
      cerrados > 0 && `${plural(cerrados, 'hueco cerrado', 'huecos cerrados')}.`,
    ])
  }

  // Sus agentes: misiones con sesiones en el período, pistas y cumplidas.
  const misiones = db.prepare(`SELECT m.titulo, m.estado, m.agente_id AS agente, COUNT(d.id) AS sesiones FROM agente_misiones m JOIN agente_diario d ON d.mision_id = m.id AND d.tipo = 'sesion' AND d.en >= ? AND d.en < ? GROUP BY m.id ORDER BY sesiones DESC`).all(ini, fin) as { titulo: string; estado: string; agente: string; sesiones: number }[]
  const pistas = n('SELECT COUNT(*) AS n FROM oportunidades WHERE agente_mision_id IS NOT NULL AND creada_en >= ? AND creada_en < ?', ini, fin)
  const cumplidas = db.prepare(`SELECT titulo FROM agente_misiones WHERE estado = 'cumplida' AND actualizada_en >= ? AND actualizada_en < ?`).all(ini, fin) as { titulo: string }[]
  sumar('agentes', 'Sus agentes', 'agmisiones', [
    ...misiones.slice(0, 6).map((m) => `${m.titulo} (${m.agente}, ${m.estado}): ${plural(m.sesiones, 'sesión', 'sesiones')}.`),
    pistas > 0 && `${plural(pistas, 'pista nueva', 'pistas nuevas')}.`,
    cumplidas.length > 0 && `Cumplida${cumplidas.length > 1 ? 's' : ''}: ${cumplidas.map((c) => c.titulo).join(', ')}.`,
  ])

  // Observatorio y campañas.
  const temas = db.prepare(`SELECT t.nombre, COUNT(r.id) AS rondas, COALESCE(SUM(r.nuevos), 0) AS nuevos FROM observatorio_rondas r JOIN observatorio_temas t ON t.id = r.tema_id WHERE r.en >= ? AND r.en < ? GROUP BY t.id ORDER BY nuevos DESC`).all(ini, fin) as { nombre: string; rondas: number; nuevos: number }[]
  const campanas = db.prepare(`SELECT titulo, estado, hashtag FROM campanas WHERE inicio >= ? AND inicio < ? ORDER BY inicio`).all(ini, fin) as { titulo: string; estado: string; hashtag: string | null }[]
  sumar('observatorio', 'Observatorio y campañas', 'observatorio', [
    ...temas.slice(0, 6).map((t) => `${t.nombre}: ${plural(t.rondas, 'ronda')}, ${plural(t.nuevos, 'cosa nueva', 'cosas nuevas')}.`),
    ...campanas.map((c) => `Campaña «${c.titulo}»${c.hashtag ? ` (${c.hashtag})` : ''}: ${c.estado}.`),
  ])

  // Academia, idiomas y prácticas.
  const clases = db.prepare(`SELECT a.tema, s.tipo, COUNT(*) AS n FROM tutor_sesiones s JOIN aprendizajes a ON a.id = s.aprendizaje_id WHERE s.estado = 'hecha' AND s.cerrada_en >= ? AND s.cerrada_en < ? GROUP BY a.tema, s.tipo ORDER BY 3 DESC`).all(ini, fin) as { tema: string; tipo: string; n: number }[]
  const idiomas = db.prepare(`SELECT a.tema, COUNT(*) AS n FROM idioma_sesiones s JOIN aprendizajes a ON a.id = s.aprendizaje_id WHERE s.estado = 'hecha' AND s.cerrada_en >= ? AND s.cerrada_en < ? GROUP BY a.tema ORDER BY 2 DESC`).all(ini, fin) as { tema: string; n: number }[]
  const practica = n('SELECT SUM(minutos) AS n FROM practicas WHERE fecha >= ? AND fecha <= ?', desde, hasta)
  sumar('academia', 'Academia e idiomas', 'aprender', [
    ...clases.slice(0, 6).map((c) => `${c.tema}: ${plural(c.n, c.tipo === 'examen' ? 'examen' : c.tipo === 'proyecto' ? 'proyecto' : 'clase', c.tipo === 'examen' ? 'exámenes' : undefined)}.`),
    ...idiomas.map((i) => `${i.tema}: ${plural(i.n, 'sesión', 'sesiones')}.`),
    practica > 0 && `${practica} minutos de práctica anotados.`,
  ])

  // El cuerpo: promedios de los días con datos.
  const { resumenDia } = await import('./salud.ts')
  const dias: ReturnType<typeof resumenDia>[] = []
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) dias.push(resumenDia(db, f))
  const conComida = dias.filter((d) => d.comidas)
  const conSueno = dias.filter((d) => d.sueno?.horas != null)
  const entrenos = dias.filter((d) => d.ejercicio.sesiones > 0)
  const prom = (xs: number[]) => redondo(xs.reduce((t, x) => t + x, 0) / xs.length)
  const pesoIni = dias.find((d) => d.peso)?.peso ?? null
  const pesoFin = [...dias].reverse().find((d) => d.peso)?.peso ?? null
  sumar('cuerpo', 'El cuerpo', 'salud', [
    conComida.length > 0 && `Comidas anotadas ${plural(conComida.length, 'día')}: ${prom(conComida.map((d) => d.kcal))} kcal y ${prom(conComida.map((d) => d.proteina))} g de proteína por día.`,
    conSueno.length > 0 && `Sueño: ${prom(conSueno.map((d) => Number(d.sueno!.horas)))} horas promedio (${plural(conSueno.length, 'noche')}).`,
    entrenos.length > 0 && `${plural(entrenos.length, 'día')} con entreno, ${dias.reduce((t, d) => t + d.ejercicio.minutos, 0)} minutos.`,
    pesoFin && pesoIni && pesoIni.fecha !== pesoFin.fecha ? `Peso: ${pesoIni.peso} → ${pesoFin.peso} kg.` : pesoFin && pesoFin.fecha >= desde ? `Peso: ${pesoFin.peso} kg.` : null,
  ])

  // La plata.
  const plata = db.prepare(`SELECT COALESCE(SUM(CASE WHEN monto > 0 THEN monto END), 0) AS ingresos, COALESCE(SUM(CASE WHEN monto < 0 THEN -monto END), 0) AS gastos, COUNT(*) AS n FROM movimientos WHERE fecha >= ? AND fecha <= ?`).get(desde, hasta) as { ingresos: number; gastos: number; n: number }
  const categorias = db.prepare(`SELECT categoria, SUM(-monto) AS t FROM movimientos WHERE monto < 0 AND fecha >= ? AND fecha <= ? GROUP BY categoria ORDER BY t DESC LIMIT 4`).all(desde, hasta) as { categoria: string; t: number }[]
  const eur = (x: number) => `${Math.round(x).toLocaleString('es-AR')} €`
  sumar('plata', 'La plata', 'jugador', [
    plata.n > 0 && `Entraron ${eur(plata.ingresos)} y salieron ${eur(plata.gastos)} (neto ${eur(plata.ingresos - plata.gastos)}).`,
    categorias.length > 0 && `Lo que más se llevó: ${categorias.map((c) => `${c.categoria} ${eur(c.t)}`).join(', ')}.`,
  ])

  // Lo que espera su ok (siempre de ahora, no del período).
  if (fin > ahora - DIA) {
    const { bandeja } = await import('./sombra.ts')
    sumar('espera', 'Lo que espera su ok', 'hoy', bandeja(db, ahora).grupos.filter((g) => g.n > 0).map((g) => `${g.nombre}: ${g.n}.`))
  }

  // Lo que dijeron las rutinas del domingo.
  const avisos = db.prepare(`SELECT rutina, texto FROM informe_avisos WHERE ${o.avisosPendientes ? '(informe_id IS NULL OR (en >= ? AND en < ?))' : 'en >= ? AND en < ?'} ORDER BY id`).all(ini, fin) as { rutina: string; texto: string }[]
  sumar('rutinas', 'Lo que dejaron sus rutinas', null, avisos.map((a) => a.texto.length > 900 ? `${a.texto.slice(0, 900)}…` : a.texto))

  // Los tokens.
  const tokens = db.prepare(`SELECT clase = 'mastropiero' AS suyo, COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0) AS t FROM llamadas WHERE en >= ? AND en < ? GROUP BY 1`).all(ini, fin) as { suyo: number; t: number }[]
  const suyos = tokens.find((x) => x.suyo)?.t ?? 0
  const fondo = tokens.filter((x) => !x.suyo).reduce((t, x) => t + x.t, 0)
  sumar('tokens', 'Tokens', null, [suyos + fondo > 0 && `${(suyos + fondo).toLocaleString('es-AR')} tokens: ${suyos.toLocaleString('es-AR')} en charlas con Mastropiero y ${fondo.toLocaleString('es-AR')} de fondo (agentes, rutinas).`])

  return s
}

const SISTEMA_APERTURA = `Sos Mastropiero y abrís el informe de un período del jugador. Te paso las secciones con sus números.
- Un párrafo de cuatro a seis oraciones, tratándolo de usted: lo que de verdad importa del período (lo que avanzó, lo que quedó quieto, un patrón que cruce secciones) y una sola sugerencia para lo que viene.
- Solo con los datos que te paso. No repitas la lista: leela.
Forma: {"apertura": string}`

export function textoDe(desde: string, hasta: string, apertura: string | null, secciones: Seccion[]): string {
  return [
    `# Informe del ${desde} al ${hasta}`,
    apertura ?? '',
    ...secciones.map((x) => `## ${x.titulo}\n${x.lineas.map((l) => `- ${l}`).join('\n')}`),
    secciones.length ? '' : 'No hubo movimiento en este período.',
  ].filter(Boolean).join('\n\n')
}

/** Arma, guarda y devuelve el informe de un período. */
export async function armarInforme(db: Db, o: { desde: string; hasta: string; tipo?: 'semanal' | 'rango'; conModelo?: boolean; ahora?: number }): Promise<Informe> {
  const ahora = o.ahora ?? Date.now()
  const tipo = o.tipo ?? 'rango'
  const secciones = await seccionesDe(db, o.desde, o.hasta, { ahora, avisosPendientes: tipo === 'semanal' })
  let apertura: string | null = null
  if (o.conModelo && secciones.length) {
    try {
      const { datos } = await pedirJson<{ apertura?: string }>({ db, clase: 'mastropiero', agenteId: 'reporte' }, `${SISTEMA_APERTURA}\n\n${vozPara('ceremonia')}`, textoDe(o.desde, o.hasta, null, secciones), { temperatura: 0.4, maxTokens: 1200 })
      if (typeof datos.apertura === 'string' && datos.apertura.trim()) apertura = datos.apertura.trim()
    } catch {
      // sin apertura: el informe sale igual, con las secciones
    }
  }
  const texto = textoDe(o.desde, o.hasta, apertura, secciones)
  const r = guardarReporte(db, {
    tipo: 'informe', personaje: 'jugador', desde: aMs(o.desde), hasta: aMs(sumarDias(o.hasta, 1)), runId: null, texto,
    metricas: { tipo, desde: o.desde, hasta: o.hasta, apertura, secciones }, enCorpus: `Informe${tipo === 'semanal' ? ' semanal' : ''} · ${o.desde} a ${o.hasta}`,
  }, ahora)
  if (tipo === 'semanal') db.prepare('UPDATE informe_avisos SET informe_id = ? WHERE informe_id IS NULL AND en < ?').run(r.id, aMs(sumarDias(o.hasta, 1)))
  return deReporte(r)
}

function deReporte(r: Reporte): Informe {
  const m = r.metricas ?? {}
  return { id: r.id, tipo: m.tipo ?? 'rango', desde: m.desde, hasta: m.hasta, apertura: m.apertura ?? null, secciones: m.secciones ?? [], texto: r.texto, piezaId: r.piezaId, creadoEn: r.creadoEn }
}

export function listarInformes(db: Db, limite = 20): Omit<Informe, 'secciones' | 'texto'>[] {
  return listarReportes(db, { tipo: 'informe', limite }).map(deReporte).map(({ secciones: _s, texto: _t, ...x }) => x)
}

export function leerInforme(db: Db, id: number): Informe | null {
  const r = listarReportes(db, { tipo: 'informe', limite: 500 }).find((x) => x.id === id)
  return r ? deReporte(r) : null
}

/** Un aviso de una rutina del domingo que va al informe en vez de a Hoy. */
export function guardarAviso(db: Db, rutina: string, texto: string, ahora = Date.now()) {
  db.prepare('INSERT INTO informe_avisos (rutina, texto, en) VALUES (?, ?, ?)').run(rutina, texto, ahora)
}

/**
 * ¿El aviso de esta rutina va al informe? Solo si es de las del domingo, el informe semanal está prendido y todavía no
 * corrió hoy (si ya corrió, el aviso va a Hoy como siempre: no se pierde hasta la semana siguiente).
 */
export function vaAlInforme(db: Db, rutina: string, hoy: string): boolean {
  if (!AL_INFORME.includes(rutina)) return false
  const r = db.prepare(`SELECT activa, ultima_fecha FROM rutinas WHERE id = 'informe_semanal'`).get() as { activa: number; ultima_fecha: string | null } | undefined
  return !!r?.activa && r.ultima_fecha !== hoy
}

/** El informe de la semana que termina (la rutina del domingo). null si no hubo nada. */
export async function informeSemanal(db: Db, o: { conModelo?: boolean; ahora?: number } = {}): Promise<Informe | null> {
  const ahora = o.ahora ?? Date.now()
  const { desde, hasta } = rangoDeSemana(ahora)
  const secciones = await seccionesDe(db, desde, hasta, { ahora, avisosPendientes: true })
  if (!secciones.some((x) => x.clave !== 'espera' && x.clave !== 'tokens')) return null
  return armarInforme(db, { desde, hasta, tipo: 'semanal', conModelo: o.conModelo, ahora })
}
