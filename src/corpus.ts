/**
 * El corpus vive afuera de los agentes. Cada pieza tiene una fuente (dinámica, se crean más) y un nivel:
 * de quién es la voz que habla en ella. Lo nuevo entra crudo y recorre la pipeline de ingesta
 * (extractor → clasificador → vectorizador) hasta quedar disponible; lo que llega ya estructurado puede saltearla.
 */
import { json, type Db } from './db.ts'
import type { ClaseId } from './clases.ts'
import { palabras } from './texto.ts'

/** Los cuatro niveles. El orden es de cercanía al operador, no de valor. */
export const NIVELES = {
  propia: { numero: 'I', nombre: 'Mía', descripcion: 'Lo que dije, escribí o viví: audios, notas, cuadernos, chats.' },
  primaria: { numero: 'II', nombre: 'Fuente primaria', descripcion: 'Una obra o documento de un tercero, tal cual: libro, paper, ley, repo, post.' },
  investigacion: { numero: 'III', nombre: 'Investigación', descripcion: 'Síntesis o curación hecha con ayuda: informes, packs, repertorios.' },
  generada: { numero: 'IV', nombre: 'Generada', descripcion: 'Producida por agentes o modelos: informes, borradores, resúmenes.' },
} as const
export type Nivel = keyof typeof NIVELES
export const esNivel = (v: unknown): v is Nivel => typeof v === 'string' && v in NIVELES

/** materia: contenido · referencia: apunta a una obra externa · ficha: tarjeta de entidad · lista: tridente/lista6 · enlace: url por traer */
export const TIPOS = ['materia', 'referencia', 'ficha', 'lista', 'enlace'] as const
export type TipoPieza = (typeof TIPOS)[number]

export const PIPELINE_INGESTA: { clase: ClaseId; deja: string }[] = [
  { clase: 'extractor', deja: 'extraido' },
  { clase: 'clasificador', deja: 'clasificado' },
  { clase: 'vectorizador', deja: 'disponible' },
]

// ─── fuentes ────────────────────────────────────────────────────────────

export type Fuente = { id: string; nombre: string; nivel: Nivel; descripcion: string | null; padreId: string | null; sistema: boolean; piezas: number }

export function fuentes(db: Db): Fuente[] {
  return (db.prepare(
    `SELECT f.*, (SELECT COUNT(*) FROM corpus c WHERE c.fuente = f.id) AS piezas FROM fuentes f ORDER BY f.sistema DESC, f.padre_id IS NOT NULL, f.nombre`,
  ).all() as any[]).map((r) => ({ id: r.id, nombre: r.nombre, nivel: r.nivel, descripcion: r.descripcion, padreId: r.padre_id, sistema: r.sistema === 1, piezas: r.piezas }))
}

export function leerFuente(db: Db, id: string): Fuente | null {
  return fuentes(db).find((f) => f.id === id) ?? null
}

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '')
}

/** Crea la fuente si no existe; si existe la devuelve tal cual. */
export function asegurarFuente(db: Db, f: { id?: string; nombre: string; nivel: string; descripcion?: string | null; padreId?: string | null }, ahora = Date.now()): Fuente {
  if (!esNivel(f.nivel)) throw new Error(`Nivel desconocido: ${f.nivel}`)
  const nombre = f.nombre.trim()
  if (!nombre) throw new Error('La fuente necesita nombre')
  const id = f.id ?? slug(nombre)
  if (f.padreId && !leerFuente(db, f.padreId)) throw new Error(`No existe la fuente madre ${f.padreId}`)
  db.prepare('INSERT OR IGNORE INTO fuentes (id, nombre, nivel, descripcion, padre_id, sistema, creada_en) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(id, nombre, f.nivel, f.descripcion ?? null, f.padreId ?? null, ahora)
  return leerFuente(db, id)!
}

// ─── piezas ─────────────────────────────────────────────────────────────

export type Pieza = {
  id: number
  fuente: string
  nivel: Nivel
  tipo: TipoPieza
  titulo: string
  contenido: string
  estado: string
  datos: Record<string, unknown> | null
  etiquetas: string[]
  entidades: number[]
  url: string | null
  autor: string | null
  fecha: string | null
  peso: number | null
  origenId: string | null
  meta: Record<string, unknown> | null
  cargaId: number | null
  creadoEn: number
}

function deFila(r: any): Pieza {
  return {
    id: r.id,
    fuente: r.fuente,
    nivel: r.nivel ?? 'propia',
    tipo: r.tipo ?? 'materia',
    titulo: r.titulo,
    contenido: r.contenido,
    estado: r.estado,
    datos: json(r.datos, null),
    etiquetas: json<string[]>(r.etiquetas, []),
    entidades: json<number[]>(r.entidades, []),
    url: r.url,
    autor: r.autor ?? null,
    fecha: r.fecha ?? null,
    peso: r.peso ?? null,
    origenId: r.origen_id ?? null,
    meta: json(r.meta, null),
    cargaId: r.carga_id ?? null,
    creadoEn: r.creado_en,
  }
}

export type NuevaPieza = {
  fuente: string
  titulo: string
  contenido: string
  nivel?: string
  tipo?: TipoPieza
  estado?: 'crudo' | 'clasificado' | 'disponible' | 'pendiente'
  url?: string | null
  autor?: string | null
  fecha?: string | null
  peso?: number | null
  etiquetas?: string[]
  entidades?: number[]
  datos?: Record<string, unknown> | null
  meta?: Record<string, unknown> | null
  origenId?: string | null
  cargaId?: number | null
}

/** Devuelve el id, o null si ya existía una pieza con el mismo origen (las cargas se pueden repetir sin duplicar). */
export function insertar(db: Db, p: NuevaPieza, ahora = Date.now()): number | null {
  const fuente = leerFuente(db, p.fuente)
  if (!fuente) throw new Error(`Fuente desconocida: ${p.fuente}`)
  const nivel = p.nivel || fuente.nivel
  if (!esNivel(nivel)) throw new Error(`Nivel desconocido: ${nivel}`)
  const r = db
    .prepare(
      `INSERT OR IGNORE INTO corpus (fuente, nivel, tipo, titulo, contenido, estado, url, autor, fecha, peso, etiquetas, entidades, datos, meta, origen_id, carga_id, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.fuente, nivel, p.tipo ?? 'materia', p.titulo.trim().slice(0, 300) || '(sin título)', p.contenido, p.estado ?? 'crudo',
      p.url ?? null, p.autor ?? null, p.fecha ?? null, p.peso ?? null,
      p.etiquetas?.length ? JSON.stringify(p.etiquetas) : null,
      p.entidades?.length ? JSON.stringify(p.entidades) : null,
      p.datos ? JSON.stringify(p.datos) : null, p.meta ? JSON.stringify(p.meta) : null,
      p.origenId ?? null, p.cargaId ?? null, ahora,
    )
  return r.changes ? Number(r.lastInsertRowid) : null
}

export function leerPieza(db: Db, id: number): Pieza | null {
  const r = db.prepare('SELECT * FROM corpus WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

export function piezaPorOrigen(db: Db, origenId: string): Pieza | null {
  const r = db.prepare('SELECT * FROM corpus WHERE origen_id = ?').get(origenId)
  return r ? deFila(r) : null
}

/** Aplica la salida de una etapa de la pipeline sobre la pieza. */
export function aplicarEtapa(db: Db, id: number, clase: ClaseId, salida: Record<string, unknown>, estado: string) {
  if (clase === 'extractor') db.prepare('UPDATE corpus SET datos = ?, estado = ? WHERE id = ?').run(JSON.stringify(salida.datos), estado, id)
  else if (clase === 'clasificador') {
    // Las etiquetas que traía la pieza (de una carga) se conservan; se suman las del clasificador.
    const previas = leerPieza(db, id)?.etiquetas ?? []
    const nuevas = [...new Set([...previas, ...((salida.etiquetas as string[]) ?? [])])]
    db.prepare('UPDATE corpus SET etiquetas = ?, estado = ? WHERE id = ?').run(JSON.stringify(nuevas), estado, id)
  } else if (clase === 'vectorizador') db.prepare('UPDATE corpus SET embedding = ?, estado = ? WHERE id = ?').run(JSON.stringify(salida.embedding), estado, id)
}

/** Consulta FTS5: cada palabra es un prefijo, cualquiera alcanza; bm25 ordena. */
function consultaFts(texto: string): string | null {
  const ws = [...new Set(palabras(texto))].slice(0, 24)
  return ws.length ? ws.map((w) => `"${w}"*`).join(' OR ') : null
}

/**
 * Lo que leen los agentes: piezas disponibles que matchean. Si el dominio aparece en las etiquetas, sube.
 * Se puede acotar por nivel (por ejemplo, un buscador que solo cite fuentes primarias).
 */
export function buscar(db: Db, consulta: string, limite: number, dominio?: string | null, niveles?: Nivel[]): Pieza[] {
  const q = consultaFts(consulta)
  const filtroNivel = niveles?.length ? `AND c.nivel IN (${niveles.map(() => '?').join(',')})` : ''
  const filas = q
    ? db.prepare(
      `SELECT c.* FROM corpus_fts JOIN corpus c ON c.id = corpus_fts.rowid
       WHERE corpus_fts MATCH ? AND c.estado = 'disponible' ${filtroNivel} ORDER BY bm25(corpus_fts, 3.0, 1.0, 2.0, 1.0) LIMIT ?`,
    ).all(q, ...(niveles ?? []), limite * 3)
    : []
  return (filas as any[])
    .map((r, i) => ({ p: deFila(r), orden: i - (dominio && json<string[]>(r.etiquetas, []).includes(dominio) ? limite : 0) }))
    .sort((a, b) => a.orden - b.orden)
    .slice(0, limite)
    .map((x) => x.p)
}

export type FiltroPiezas = { fuente?: string; nivel?: string; tipo?: string; estado?: string; q?: string; cargaId?: number; entidad?: number; desde?: number; limite?: number }

/** Para la pantalla: listado paginado con filtros y búsqueda. */
export function listarPiezas(db: Db, f: FiltroPiezas = {}): { total: number; piezas: Pieza[] } {
  const where: string[] = []
  const args: (string | number)[] = []
  const q = f.q ? consultaFts(f.q) : null
  if (q) where.push('corpus_fts MATCH ?'), args.push(q)
  if (f.fuente) {
    // Una fuente madre incluye a sus hijas.
    where.push('(c.fuente = ? OR c.fuente IN (SELECT id FROM fuentes WHERE padre_id = ?))')
    args.push(f.fuente, f.fuente)
  }
  if (f.nivel) where.push('c.nivel = ?'), args.push(f.nivel)
  if (f.tipo) where.push('c.tipo = ?'), args.push(f.tipo)
  if (f.estado) where.push('c.estado = ?'), args.push(f.estado)
  if (f.cargaId) where.push('c.carga_id = ?'), args.push(f.cargaId)
  if (f.entidad) where.push('EXISTS (SELECT 1 FROM json_each(c.entidades) WHERE value = ?)'), args.push(f.entidad)
  const desde = q ? 'corpus_fts JOIN corpus c ON c.id = corpus_fts.rowid' : 'corpus c'
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM ${desde} ${w}`).get(...args) as { n: number }).n
  const orden = q ? 'bm25(corpus_fts, 3.0, 1.0, 2.0, 1.0)' : 'c.id DESC'
  const piezas = (db.prepare(`SELECT c.* FROM ${desde} ${w} ORDER BY ${orden} LIMIT ? OFFSET ?`).all(...args, f.limite ?? 40, f.desde ?? 0) as any[]).map(deFila)
  return { total, piezas }
}

export function resumenCorpus(db: Db) {
  return db.prepare('SELECT nivel, estado, COUNT(*) AS n FROM corpus GROUP BY nivel, estado ORDER BY nivel').all() as {
    nivel: Nivel; estado: string; n: number
  }[]
}
