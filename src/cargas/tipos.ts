/**
 * Contrato de una carga. Un importador detecta su formato, analiza el archivo en segmentos
 * (qué hay, cuánto y en qué nivel) y, cuando el operador elige, lo ejecuta.
 */
import type { Db } from '../db.ts'
import type { NuevaPieza, Nivel } from '../corpus.ts'
import type { NuevoQuantomo } from '../quantomos.ts'
import type { TipoEntidad } from '../entidades.ts'

export type Segmento = {
  id: string
  nombre: string
  descripcion: string
  /** Nivel de las piezas del segmento; null si no van al corpus (entidades, quántomos). */
  nivel: Nivel | null
  destino: 'corpus' | 'quantomos' | 'entidades'
  cantidad: number
  porDefecto: boolean
  nota?: string
}

export type FuentePropuesta = { id: string; nombre: string; nivel: Nivel; padreId: string | null; descripcion?: string }

export type Analisis = {
  importador: string
  titulo: string
  descripcion: string
  segmentos: Segmento[]
  fuente: FuentePropuesta
  /** El operador puede fijar el nivel de todas las piezas (cargas sin niveles propios: texto, CSV). */
  nivelEditable: boolean
  /** Umbral de peso para segmentos con criba (bookmarks). */
  umbralPeso?: number
  avisos: string[]
}

export type Pipeline = 'ninguna' | 'vectorizar' | 'completa'

export type Opciones = {
  segmentos: string[]
  fuenteId: string
  pipeline: Pipeline
  nivel?: Nivel
  umbralPeso?: number
}

export type Datos = { nombre: string; texto: string; json?: any }

/** Lo que la carga le pide al sistema; el núcleo aplica pipeline, carga_id y conteos. */
export type Contexto = {
  db: Db
  cargaId: number
  ahora: number
  fuenteId: string
  opciones: Opciones
  pieza: (segmento: string, p: Omit<NuevaPieza, 'fuente' | 'cargaId'> & { fuente?: string }) => number | null
  quantomo: (segmento: string, q: Omit<NuevoQuantomo, 'cargaId'>) => number | null
  entidad: (segmento: string, e: { tipo: TipoEntidad; nombre: string; alias?: string[]; notas?: string | null; meta?: Record<string, unknown> | null; origenId: string }) => number
  quiere: (segmento: string) => boolean
}

export type Importador = {
  id: string
  nombre: string
  detectar: (d: Datos) => boolean
  analizar: (d: Datos) => Analisis
  ejecutar: (d: Datos, ctx: Contexto) => void
}
