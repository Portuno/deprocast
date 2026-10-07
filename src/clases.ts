/**
 * Las nueve clases forjables. La décima, Omnívoro, no se forja: es Mastropiero, la liga entera.
 * Cada clase trae atributos base (suman 9) y un contrato de salida que la liga valida.
 */

export type ClaseId =
  | 'generativo'
  | 'ejecutivo'
  | 'gerente'
  | 'buscador'
  | 'crawler'
  | 'vectorizador'
  | 'clasificador'
  | 'extractor'
  | 'auditor'

/** Lista6 de atributos. Cada uno mueve una perilla real del runtime (ver `efectos` en xp.ts). */
export type AtributoId = 'potencia' | 'precision' | 'memoria' | 'temple' | 'iniciativa' | 'ritmo'
export type Atributos = Record<AtributoId, number>

export const ATRIBUTOS: { id: AtributoId; sigla: string; nombre: string; efecto: string }[] = [
  { id: 'potencia', sigla: 'POT', nombre: 'Potencia', efecto: 'largo máximo de la salida' },
  { id: 'precision', sigla: 'PRE', nombre: 'Precisión', efecto: 'baja la temperatura del modelo' },
  { id: 'memoria', sigla: 'MEM', nombre: 'Memoria', efecto: 'cuántas tareas propias recuerda' },
  { id: 'temple', sigla: 'TEM', nombre: 'Temple', efecto: 'reintentos antes de rendirse' },
  { id: 'iniciativa', sigla: 'INI', nombre: 'Iniciativa', efecto: 'cuántas tareas nuevas puede publicar al bus' },
  { id: 'ritmo', sigla: 'RIT', nombre: 'Ritmo', efecto: 'tareas que corre por tick' },
]

export const ATRIBUTO_MAX = 6
export const PUNTOS_LIBRES = 6

export type Clase = {
  id: ClaseId
  sigla: string
  glifo: string
  nombre: string
  produce: string
  /** Forma JSON que se le pide al motor. */
  salida: string
  base: Atributos
  /** null si la salida cumple el contrato; si no, el motivo. */
  validar: (salida: Record<string, unknown>) => string | null
}

function atr(potencia: number, precision: number, memoria: number, temple: number, iniciativa: number, ritmo: number): Atributos {
  return { potencia, precision, memoria, temple, iniciativa, ritmo }
}

const texto = (v: unknown) => typeof v === 'string' && v.trim().length > 0
const listaDe = (v: unknown, pred: (x: unknown) => boolean) => Array.isArray(v) && v.length > 0 && v.every(pred)

export const CLASES: Record<ClaseId, Clase> = {
  generativo: {
    id: 'generativo', sigla: 'GEN', glifo: '✦', nombre: 'Generativo',
    produce: 'contenido nuevo (texto, código, imagen, sonido)',
    salida: '{"texto": string}',
    base: atr(3, 1, 2, 1, 1, 1),
    validar: (s) => (texto(s.texto) ? null : 'falta "texto"'),
  },
  ejecutivo: {
    id: 'ejecutivo', sigla: 'EJE', glifo: '➤', nombre: 'Ejecutivo',
    produce: 'efectos concretos (acciones, cambios)',
    salida: '{"efecto": string, "ok": boolean}',
    base: atr(1, 3, 1, 2, 0, 2),
    validar: (s) => (texto(s.efecto) && typeof s.ok === 'boolean' ? null : 'falta "efecto" u "ok"'),
  },
  gerente: {
    id: 'gerente', sigla: 'GER', glifo: '♛', nombre: 'Gerente',
    produce: 'asignaciones (qué agente hace qué)',
    salida: '{"decision": string}',
    base: atr(1, 2, 2, 1, 3, 0),
    validar: (s) => (texto(s.decision) ? null : 'falta "decision"'),
  },
  buscador: {
    id: 'buscador', sigla: 'BUS', glifo: '⌕', nombre: 'Buscador',
    produce: 'respuestas del corpus, siempre con cita',
    salida: '{"respuesta": string, "citas": number[]}',
    base: atr(1, 3, 2, 1, 0, 2),
    validar: (s) =>
      !texto(s.respuesta) ? 'falta "respuesta"'
        : !listaDe(s.citas, (c) => Number.isInteger(c)) ? 'sin citas: un buscador no responde sin fuente'
          : null,
  },
  crawler: {
    id: 'crawler', sigla: 'CRA', glifo: '≋', nombre: 'Crawler',
    produce: 'materia prima nueva de la web',
    salida: '{"items": [{"titulo": string, "contenido": string, "url": string}]}',
    base: atr(2, 0, 1, 2, 2, 2),
    validar: (s) =>
      listaDe(s.items, (i) => typeof i === 'object' && i !== null && texto((i as any).contenido) && texto((i as any).url))
        ? null : 'items vacíos o sin url/contenido',
  },
  vectorizador: {
    id: 'vectorizador', sigla: 'VEC', glifo: '∴', nombre: 'Vectorizador',
    produce: 'embeddings del corpus',
    salida: '{"embedding": number[]}',
    base: atr(0, 3, 0, 2, 0, 4),
    validar: (s) => (listaDe(s.embedding, (x) => typeof x === 'number' && Number.isFinite(x)) ? null : 'embedding vacío'),
  },
  clasificador: {
    id: 'clasificador', sigla: 'CLA', glifo: '⊞', nombre: 'Clasificador',
    produce: 'etiquetas sobre una base',
    salida: '{"etiquetas": string[]}',
    base: atr(1, 3, 1, 1, 0, 3),
    validar: (s) => (listaDe(s.etiquetas, texto) ? null : 'sin etiquetas'),
  },
  extractor: {
    id: 'extractor', sigla: 'EXT', glifo: '◈', nombre: 'Extractor',
    produce: 'datos estructurados de documentos',
    salida: '{"datos": object, "quantomos": string[] (afirmaciones atómicas, una idea cada una; pueden ser [])}',
    base: atr(2, 3, 0, 2, 0, 2),
    validar: (s) =>
      typeof s.datos === 'object' && s.datos !== null && !Array.isArray(s.datos) && Object.keys(s.datos).length > 0
        ? null : 'falta "datos"',
  },
  auditor: {
    id: 'auditor', sigla: 'AUD', glifo: '☉', nombre: 'Auditor',
    produce: 'juicio sobre input/decisión/output de los demás',
    salida: '{"veredicto": "ok" | "alerta", "hallazgos": string[]}',
    base: atr(1, 3, 3, 1, 1, 0),
    validar: (s) =>
      (s.veredicto === 'ok' || s.veredicto === 'alerta') && Array.isArray(s.hallazgos) ? null : 'veredicto inválido',
  },
}

export const CLASE_IDS = Object.keys(CLASES) as ClaseId[]

export function esClase(v: string): v is ClaseId {
  return v in CLASES
}
