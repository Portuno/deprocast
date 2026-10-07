/**
 * Partida de ejemplo, neutra a propósito: no trae nada del operador. Un proyecto con su gerente,
 * dos agentes forjados a mano y cuatro piezas de cuatro niveles entrando por la pipeline.
 * No corre ningún tick: eso lo hace quien juega.
 */
import type { Db } from './db.ts'
import { asegurarFuente } from './corpus.ts'
import { crearProyecto, ingerir } from './mastropiero.ts'
import { forjar } from './roster.ts'

export const PREGUNTA_EJEMPLO = '¿Cómo conviene regar la huerta del balcón?'

export function sembrarEjemplo(db: Db): { proyectoId: string } {
  const { id } = crearProyecto(db, 'Huerta de balcón')
  forjar(db, { clase: 'buscador', instrucciones: 'Respondo solo con lo que hay en el corpus, siempre citando.', reparto: { precision: 2, ritmo: 2, potencia: 2 } })
  forjar(db, { clase: 'ejecutivo', motor: 'funcion:bitacora', instrucciones: 'Dejo constancia en la bitácora.', proyectoId: id })
  asegurarFuente(db, { id: 'ejemplo-manual', nombre: 'Manual de jardinería (ejemplo)', nivel: 'primaria' })
  asegurarFuente(db, { id: 'ejemplo-informe', nombre: 'Informe de investigación (ejemplo)', nivel: 'investigacion' })
  const piezas: { fuente: string; titulo: string; contenido: string; dominio: string; proyecto: boolean }[] = [
    { fuente: 'operador', titulo: 'Nota de voz: el balcón', dominio: 'huerta', proyecto: true, contenido: 'Caminando pensé que las tomateras del balcón se secan los días de viento. Conviene regar temprano, antes del sol fuerte, y poner algo de mulch para que la tierra no pierda humedad.' },
    { fuente: 'ejemplo-manual', titulo: 'Riego por goteo en macetas', dominio: 'huerta', proyecto: true, contenido: 'El riego por goteo entrega agua lenta y localizada en la raíz. En macetas reduce el desperdicio y evita mojar las hojas, lo que baja el riesgo de hongos.' },
    { fuente: 'ejemplo-informe', titulo: 'Investigación: horario de riego', dominio: 'huerta', proyecto: true, contenido: 'Regar a primera hora de la mañana reduce la evaporación frente al riego del mediodía. El mulch orgánico conserva la humedad del sustrato y modera la temperatura de la raíz.' },
    { fuente: 'operador', titulo: 'Idea suelta: cuaderno de cosechas', dominio: 'cuaderno', proyecto: false, contenido: 'Llevar un cuaderno con fecha de siembra, riego y cosecha de cada maceta. Con un mes de datos se ve qué funciona.' },
  ]
  for (const p of piezas) ingerir(db, { fuente: p.fuente, titulo: p.titulo, contenido: p.contenido, dominio: p.dominio, proyectoId: p.proyecto ? id : null })
  return { proyectoId: id }
}
