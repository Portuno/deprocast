/**
 * Ficha de entidad exportada por la 0.7.x (`deprocast.entity-card`): la entidad, su prosa,
 * sus quántomos y la línea de tiempo. Las menciones se enlazan a piezas que ya estén en el corpus.
 */
import type { TipoEntidad } from '../entidades.ts'
import { piezaPorOrigen } from '../corpus.ts'
import type { Analisis, Datos, Importador } from './tipos.ts'
import { INSTANCIA, ORIGEN } from './deprocast.ts'

const TIPO: Record<string, TipoEntidad> = { person: 'persona', persona: 'persona', project: 'proyecto', proyecto: 'proyecto', agrupacion: 'agrupacion', dominio: 'dominio', geografia: 'lugar', lugar: 'lugar' }

export const deprocastFicha: Importador = {
  id: 'deprocast-ficha',
  nombre: 'Ficha de Deprocast 0.7',
  detectar: (d) => d.json?.schema === 'deprocast.entity-card',
  analizar(d: Datos): Analisis {
    const c = d.json.card
    return {
      importador: 'deprocast-ficha',
      titulo: c.title,
      descripcion: `Ficha de ${c.kind} exportada el ${String(d.json.exported_at).slice(0, 10)}.`,
      segmentos: [
        { id: 'ficha', nombre: 'La ficha', descripcion: 'La entidad y su prosa, con la línea de tiempo como metadato.', nivel: 'propia', destino: 'corpus', cantidad: 1, porDefecto: true },
        { id: 'quantomos', nombre: 'Sus quántomos', descripcion: 'Los quántomos asociados. Si ya entraron con el respaldo, no se duplican.', nivel: null, destino: 'quantomos', cantidad: c.quantomos?.length ?? 0, porDefecto: true },
        { id: 'vinculos', nombre: 'Vínculos con la materia', descripcion: 'Marca con esta entidad las piezas del corpus que la mencionan (solo las que ya estén cargadas).', nivel: null, destino: 'entidades', cantidad: c.matter?.length ?? 0, porDefecto: true },
      ],
      fuente: { id: `${INSTANCIA}`, nombre: 'Deprocast 0.7.1', nivel: 'propia', padreId: 'deprocast-0.7' },
      nivelEditable: false,
      avisos: [],
    }
  },
  ejecutar(d, ctx) {
    const c = d.json.card
    const tipo = TIPO[c.kind] ?? 'concepto'
    const entidad = ctx.entidad('ficha', { tipo, nombre: c.title, alias: c.aliases ?? [], notas: c.notes, origenId: ORIGEN(tipo, c.id), meta: { similares: c.similar } })
    if (ctx.quiere('ficha')) {
      ctx.pieza('ficha', {
        tipo: 'ficha',
        titulo: c.title,
        contenido: [c.prose, c.notes].filter(Boolean).join('\n\n'),
        entidades: [entidad],
        etiquetas: [c.kind],
        meta: { linea_de_tiempo: c.timeline, similares: c.similar },
        origenId: ORIGEN('ficha', c.id),
      })
    }
    if (ctx.quiere('quantomos')) {
      for (const q of c.quantomos ?? []) {
        ctx.quantomo('quantomos', {
          titulo: q.title, texto: q.content || q.title, peso: q.hermetic_weight ?? null,
          etapa: q.stage === 'sealed' ? 'sellado' : 'proto', procedencia: q.procedencia ?? null, origenId: ORIGEN('quantomo', q.id),
        })
      }
    }
    if (ctx.quiere('vinculos')) {
      for (const m of c.matter ?? []) {
        const p = piezaPorOrigen(ctx.db, ORIGEN('entry', m.id))
        if (!p || p.entidades.includes(entidad)) continue
        ctx.db.prepare('UPDATE corpus SET entidades = ? WHERE id = ?').run(JSON.stringify([...p.entidades, entidad]), p.id)
      }
    }
  },
}
