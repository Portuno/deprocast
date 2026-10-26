/**
 * Adelantar: dejar listo de fondo lo que él va a abrir, para que nada lo haga esperar al modelo. Corre en la nube (gasta
 * tokens) tres veces por día y un rato después de arrancar el servidor; cada cosa se hace una vez y queda guardada.
 * - La Academia: la próxima clase de cada dominio (con la voz de su explicación), el examen si ya está habilitado, el
 *   proyecto del nivel si le toca y la ubicación de los dominios nuevos.
 * - Los idiomas: la próxima sesión de cada uno.
 * - El grafo de su voz: de qué va cada zona (los resúmenes) y la pregunta de los huecos abiertos más fuertes.
 * Antes, la próxima clase se preparaba solo al cerrar la anterior: si eso fallaba, si sumaba un dominio a mano o si el
 * servidor se reiniciaba, al abrirla esperaba al modelo. Frena si se llega al tope diario.
 */
import type { Db } from './db.ts'
import { topeAlcanzado } from './nan.ts'

let enCurso: Promise<{ hechos: string[]; frenado: string | null }> | null = null

export function adelantar(db: Db, ahora = Date.now()): Promise<{ hechos: string[]; frenado: string | null }> {
  if (enCurso) return enCurso
  enCurso = (async () => {
    const tope = () => !!topeAlcanzado(db)
    const hechos: string[] = []
    hechos.push(...await (await import('./academia.ts')).adelantarAcademia(db, { tope, ahora }))
    hechos.push(...await (await import('./idiomas.ts')).adelantarIdiomas(db, { tope }))
    hechos.push(...await adelantarGrafo(db, tope))
    return { hechos, frenado: topeAlcanzado(db) }
  })()
  enCurso.finally(() => (enCurso = null)).catch(() => {})
  return enCurso
}

/** El grafo de su voz: los resúmenes de las zonas que falten y la pregunta de los dos huecos abiertos más fuertes. */
async function adelantarGrafo(db: Db, tope: () => boolean): Promise<string[]> {
  const hechos: string[] = []
  const gr = await import('./grafo/index.ts')
  const voz = gr.grafoPorClave(db, 'voz')
  const f = gr.ultimaFoto(db, voz.id)
  if (!f) return hechos
  if (!tope()) {
    try { const r = await (await import('./grafo/mapa.ts')).resumir(db, voz, f, { max: 10 }); if (r.nuevas) hechos.push(`de qué va cada zona de tu grafo (${r.nuevas})`) } catch (e) { console.error('  adelantar zonas:', e instanceof Error ? e.message : e) }
  }
  const hu = await import('./grafo/huecos.ts')
  for (const h of hu.huecosDe(db, voz.id).filter((x) => x.estado === 'abierto' && !x.pregunta).slice(0, 2)) {
    if (tope()) break
    try { await hu.preguntarHueco(db, h.id); hechos.push('la pregunta de un hueco de tu grafo') } catch (e) { console.error('  adelantar hueco:', e instanceof Error ? e.message : e) }
  }
  return hechos
}
