/**
 * Los huecos (plan v24): dónde la información no alcanza. Todo lo de Deprocast vive como puntos en un mapa de sentido
 * (los vectores de cada pasaje); un hueco es una zona donde algo pide y no hay puntos cerca.
 * - De material: un concepto de su mapa sin nada parecido en su archivo (ni en lo que sumó al dominio). Se marca y la
 *   búsqueda de fuentes va por ese concepto.
 * - De conocimiento: lo que falla seguido, o lo flojo que frena a otros conceptos.
 * - De sus metas: lo que sus metas, sus primarias y lo que viene con fecha piden, y su archivo casi no tiene.
 * Medir cuesta solo vectores (no modelo); las ideas de qué hacer con cada hueco las escribe el modelo, en la nube.
 */
import { fechaLocal, type Db } from './db.ts'
import { cercanas } from './semantica.ts'
import { conceptosDe, dominioHoy, SABIDO, type Concepto } from './conceptos.ts'

/** Lo de verdad cerca (el umbral medido para la Academia, un poco más exigente: acá decide si «hay» o «no hay»). */
export const UMBRAL_HUECO = 0.55

/** Lo más parecido que hay en el archivo para un texto (null si no hay vectores: no se puede saber). */
let cercania = async (db: Db, texto: string): Promise<number | null> => {
  const cs = await cercanas(db, texto, 5)
  return cs.length ? cs[0].sim : null
}
export function _probarHuecos(f: typeof cercania) { cercania = f }

export type HuecosDominio = { sinMaterial: Concepto[]; flojos: Concepto[]; bloqueantes: { concepto: Concepto; frena: string[] }[]; medido: boolean }

/** Los huecos de un dominio: sin material (los mide y los marca), los que fallan seguido y los que frenan a otros. */
export async function huecosDeDominio(db: Db, d: { id: number; tema: string; tutorNivel: number }, ahora = Date.now()): Promise<HuecosDominio> {
  const cs = conceptosDe(db, d.id)
  // Sin material: lo de su nivel y el siguiente que todavía no sabe (hasta 12 por vez).
  const aMedir = cs.filter((c) => c.nivel >= d.tutorNivel && c.nivel <= d.tutorNivel + 1 && dominioHoy(c, ahora) < SABIDO).slice(0, 12)
  let medido = false
  for (const c of aMedir) {
    let sim: number | null = null
    try { sim = await cercania(db, `${c.nombre} — ${d.tema}`) } catch { /* sin red */ }
    if (sim == null) continue
    medido = true
    db.prepare('UPDATE conceptos SET sin_material = ? WHERE id = ?').run(sim < UMBRAL_HUECO ? 1 : 0, c.id)
  }
  const ahoraCs = conceptosDe(db, d.id)
  const porId = new Map(ahoraCs.map((c) => [c.id, c]))
  const flojos = ahoraCs.filter((c) => c.intentos >= 2 && c.aciertos / c.intentos < 0.5 && dominioHoy(c, ahora) < 0.45)
  const bloqueantes = ahoraCs.filter((c) => dominioHoy(c, ahora) < SABIDO)
    .map((c) => ({ concepto: c, frena: ahoraCs.filter((x) => x.requisitos.includes(c.id) && dominioHoy(x, ahora) < SABIDO).map((x) => x.nombre) }))
    .filter((b) => b.frena.length >= 2 && (b.concepto.intentos > 0 || b.concepto.nivel < d.tutorNivel))
  return { sinMaterial: ahoraCs.filter((c) => c.sinMaterial === true && dominioHoy(c, ahora) < SABIDO), flojos, bloqueantes, medido: medido || ahoraCs.some((c) => c.sinMaterial != null) }
}

export type HuecoMeta = { texto: string; de: 'meta' | 'primaria' | 'agenda'; sim: number }

/**
 * Lo que sus metas piden y su archivo casi no tiene: cada meta (memoria), primaria activa y cosa con fecha de los
 * próximos 60 días, contra el mapa de sentido. Sin vectores devuelve null (no se puede medir).
 */
export async function huecosDeMetas(db: Db, ahora = Date.now()): Promise<HuecoMeta[] | null> {
  const pedidos: { texto: string; de: HuecoMeta['de'] }[] = []
  const { memoriaVigente } = await import('./memoria.ts')
  for (const tipo of ['meta', 'vision']) for (const r of memoriaVigente(db, { tipo, limite: 12 })) pedidos.push({ texto: r.texto, de: 'meta' })
  const { listarMisiones, semanaDe } = await import('./misiones.ts')
  for (const m of listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] })) pedidos.push({ texto: m.titulo, de: 'primaria' })
  try {
    const { itemsDelCalendario } = await import('./agenda.ts')
    const r = await itemsDelCalendario(db, fechaLocal(ahora), fechaLocal(ahora + 60 * 86_400_000), new Set(['linea', 'radar', 'mision']))
    for (const i of r.items.slice(0, 10)) pedidos.push({ texto: i.titulo, de: 'agenda' })
  } catch { /* sin calendario */ }
  const out: HuecoMeta[] = []
  let alguna = false
  for (const p of pedidos.slice(0, 30)) {
    let sim: number | null = null
    try { sim = await cercania(db, p.texto) } catch { /* sin red */ }
    if (sim == null) continue
    alguna = true
    if (sim < UMBRAL_HUECO) out.push({ ...p, sim: +sim.toFixed(3) })
  }
  return alguna || !pedidos.length ? out.sort((a, b) => a.sim - b.sim) : null
}

/** Para los prompts (sugerir qué aprender, el reporte): los huecos en una lista corta. */
export const huecosParaPrompt = (hs: HuecoMeta[] | null) =>
  hs?.length ? `Lo que sus metas piden y su archivo casi no tiene (huecos):\n${hs.slice(0, 10).map((h) => `- [${h.de}] ${h.texto}`).join('\n')}` : ''
