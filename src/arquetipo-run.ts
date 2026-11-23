/**
 * La run de un arquetipo (Fragua #330): el plantel de la Matriz 72 tenía ficha pero no dónde correr sus bandas (una run
 * es del jugador o de una misión), y el experimento de siete días del Modista cerró con cero sesiones. Cada arquetipo
 * tiene ahora su estado en cuatro piezas:
 * - ficha: nombre, oficio y celda (la de siempre, en arquetipos.ts);
 * - canal: dónde habla (interno, o una cuenta rotulada);
 * - bitácora: qué corrió y con qué resultado (cada banda que se marca deja su línea; también se anota a mano);
 * - corte: hasta cuándo y con qué umbral se juzga.
 * Sus bandas son de 12 minutos y se cargan y se marcan como las de una run, pero sin cuerpo, sin día y sin urgencia
 * propia: no compiten con las del jugador.
 */
import { fechaLocal, type Db } from './db.ts'
import { fichaDe } from './arquetipos.ts'

export const ESTADOS_BANDA_ARQUETIPO = ['pendiente', 'hecha', 'parcial', 'no'] as const
export type EstadoBandaArquetipo = (typeof ESTADOS_BANDA_ARQUETIPO)[number]
export const MINUTOS_BANDA = 12

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS arquetipo_runs (
  n INTEGER PRIMARY KEY,          -- la celda (1..72)
  canal TEXT NOT NULL DEFAULT 'interno', -- interno | cuenta:<rótulo>
  corte TEXT,                     -- YYYY-MM-DD: hasta cuándo
  umbral TEXT,                    -- con qué se juzga al corte («3 sesiones con resultado»)
  creada_en INTEGER NOT NULL,
  actualizada_en INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS arquetipo_bandas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  n INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  detalle TEXT,
  minutos INTEGER NOT NULL DEFAULT 12,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | hecha | parcial | no
  resultado TEXT,
  origen TEXT,                    -- de dónde salió (un PDF, el chat, la pantalla)
  creada_en INTEGER NOT NULL,
  cerrada_en INTEGER
);
CREATE INDEX IF NOT EXISTS arquetipo_bandas_n ON arquetipo_bandas(n, estado);
CREATE TABLE IF NOT EXISTS arquetipo_bitacora (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  n INTEGER NOT NULL,
  banda_id INTEGER,
  texto TEXT NOT NULL,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS arquetipo_bitacora_n ON arquetipo_bitacora(n, en);`

const listas = new WeakSet<Db>()
function asegurar(db: Db) {
  if (listas.has(db)) return
  db.exec(ESQUEMA)
  listas.add(db)
}

const celda = (n: unknown): number => {
  const x = Number(n)
  if (!Number.isInteger(x) || x < 1 || x > 72) throw new Error('El arquetipo es una celda del 1 al 72')
  return x
}

export type Banda = { id: number; titulo: string; detalle: string | null; minutos: number; estado: EstadoBandaArquetipo; resultado: string | null; origen: string | null; creadaEn: number; cerradaEn: number | null }
const deBanda = (r: any): Banda => ({ id: r.id, titulo: r.titulo, detalle: r.detalle, minutos: r.minutos, estado: r.estado, resultado: r.resultado, origen: r.origen, creadaEn: r.creada_en, cerradaEn: r.cerrada_en })

/** El estado entero de la run de un arquetipo: ficha, canal, bandas, bitácora y corte (con cuánto falta y cómo va). */
export function runDeArquetipo(db: Db, n: number, ahora = Date.now()) {
  asegurar(db)
  const c = celda(n)
  const f = fichaDe(db, c)
  const r = db.prepare('SELECT * FROM arquetipo_runs WHERE n = ?').get(c) as any
  const bandas = (db.prepare('SELECT * FROM arquetipo_bandas WHERE n = ? ORDER BY estado != \'pendiente\', id').all(c) as any[]).map(deBanda)
  const bitacora = (db.prepare('SELECT id, banda_id, texto, en FROM arquetipo_bitacora WHERE n = ? ORDER BY en DESC, id DESC LIMIT 60').all(c) as any[]).map((b) => ({ id: b.id, bandaId: b.banda_id, texto: b.texto, en: b.en }))
  const hoy = fechaLocal(ahora)
  const corte = r?.corte ?? null
  const diasAlCorte = corte ? Math.round((Date.parse(`${corte}T12:00:00`) - Date.parse(`${hoy}T12:00:00`)) / 86_400_000) : null
  const sesiones = bandas.filter((b) => b.estado === 'hecha' || b.estado === 'parcial').length
  return {
    ficha: { n: c, nombre: f.nombre, oficio: f.oficio, elemento: f.elemento, estado: f.estado },
    canal: r?.canal ?? 'interno',
    corte, umbral: r?.umbral ?? null, diasAlCorte, vencida: diasAlCorte != null && diasAlCorte < 0,
    bandas, pendientes: bandas.filter((b) => b.estado === 'pendiente').length, sesiones,
    minutos: bandas.filter((b) => b.estado === 'hecha').reduce((s, b) => s + b.minutos, 0) + bandas.filter((b) => b.estado === 'parcial').reduce((s, b) => s + Math.round(b.minutos / 2), 0),
    bitacora,
  }
}

/** Canal, corte y umbral de su run (lo que no se pasa queda como estaba). */
export function fijarRun(db: Db, n: number, c: { canal?: string | null; corte?: string | null; umbral?: string | null }, ahora = Date.now()) {
  asegurar(db)
  const x = celda(n)
  if (c.corte != null && c.corte !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(c.corte)) throw new Error('El corte es una fecha (AAAA-MM-DD)')
  const canal = c.canal == null ? undefined : (String(c.canal).trim() || 'interno')
  if (canal && canal !== 'interno' && !/^cuenta:.+/.test(canal)) throw new Error('El canal es «interno» o «cuenta:<rótulo>» (la cuenta donde habla)')
  db.prepare(`INSERT INTO arquetipo_runs (n, canal, corte, umbral, creada_en, actualizada_en) VALUES (?, COALESCE(?, 'interno'), ?, ?, ?, ?)
    ON CONFLICT (n) DO UPDATE SET canal = COALESCE(?, canal), corte = CASE WHEN ? THEN ? ELSE corte END, umbral = CASE WHEN ? THEN ? ELSE umbral END, actualizada_en = ?`)
    .run(x, canal ?? null, c.corte || null, c.umbral?.trim() || null, ahora, ahora,
      canal ?? null, c.corte !== undefined ? 1 : 0, c.corte || null, c.umbral !== undefined ? 1 : 0, c.umbral?.trim() || null, ahora)
  return runDeArquetipo(db, x, ahora)
}

/** Carga bandas a su run (de 12 minutos salvo que se diga otra cosa). */
export function cargarBandas(db: Db, n: number, bandas: { titulo: string; detalle?: string | null; minutos?: number | null }[], o: { origen?: string | null; ahora?: number } = {}) {
  asegurar(db)
  const x = celda(n)
  const ahora = o.ahora ?? Date.now()
  const ins = db.prepare('INSERT INTO arquetipo_bandas (n, titulo, detalle, minutos, origen, creada_en) VALUES (?, ?, ?, ?, ?, ?)')
  let cargadas = 0
  for (const b of bandas) {
    const titulo = String(b?.titulo ?? '').trim().slice(0, 200)
    if (!titulo) continue
    const min = Number(b.minutos)
    ins.run(x, titulo, b.detalle?.toString().trim().slice(0, 1000) || null, Number.isFinite(min) && min > 0 ? Math.min(240, Math.round(min)) : MINUTOS_BANDA, o.origen ?? null, ahora)
    cargadas++
  }
  if (!cargadas) throw new Error('No hay bandas para cargar (cada una necesita un título)')
  if (!db.prepare('SELECT 1 FROM arquetipo_runs WHERE n = ?').get(x)) fijarRun(db, x, {}, ahora)
  return runDeArquetipo(db, x, ahora)
}

/** Marca una banda como en una run (hecha, a medias, no) con su resultado; queda en la bitácora. */
export function marcarBanda(db: Db, id: number, estado: string, resultado?: string | null, ahora = Date.now()) {
  asegurar(db)
  if (!(ESTADOS_BANDA_ARQUETIPO as readonly string[]).includes(estado)) throw new Error(`Estado de banda: ${ESTADOS_BANDA_ARQUETIPO.join(', ')}`)
  const b = db.prepare('SELECT * FROM arquetipo_bandas WHERE id = ?').get(id) as any
  if (!b) throw new Error(`No existe la banda ${id}`)
  const res = resultado?.toString().trim().slice(0, 1000) || null
  db.prepare('UPDATE arquetipo_bandas SET estado = ?, resultado = COALESCE(?, resultado), cerrada_en = ? WHERE id = ?').run(estado, res, estado === 'pendiente' ? null : ahora, id)
  if (estado !== 'pendiente') {
    const como = { hecha: 'corrió', parcial: 'corrió a medias', no: 'no corrió' }[estado as 'hecha' | 'parcial' | 'no']
    anotar(db, b.n, `${como} «${b.titulo}» (${b.minutos} min)${res ? `: ${res}` : ''}`, ahora, id)
  }
  return runDeArquetipo(db, b.n, ahora)
}

/** Una línea a mano en la bitácora del arquetipo. */
export function anotar(db: Db, n: number, texto: string, ahora = Date.now(), bandaId: number | null = null) {
  asegurar(db)
  const t = String(texto ?? '').trim().slice(0, 2000)
  if (!t) throw new Error('La línea de la bitácora está vacía')
  db.prepare('INSERT INTO arquetipo_bitacora (n, banda_id, texto, en) VALUES (?, ?, ?, ?)').run(celda(n), bandaId, t, ahora)
  return runDeArquetipo(db, n, ahora)
}

/** El arquetipo por número, nombre propio («el Modista») u oficio. */
export async function arquetipoDe(db: Db, q: unknown): Promise<number | null> {
  if (/^\d+$/.test(String(q ?? '').trim())) { const n = Number(q); return n >= 1 && n <= 72 ? n : null }
  const { esOficioDeAlguno } = await import('./arquetipos.ts')
  const t = String(q ?? '').trim()
  if (!t) return null
  const porOficio = esOficioDeAlguno(db, t)
  if (porOficio) return porOficio
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^(el|la|los|las)\s+/, '').trim()
  try {
    const r = (db.prepare(`SELECT clave, nombre FROM paginas WHERE tipo = 'arquetipo' AND nombre IS NOT NULL`).all() as { clave: string; nombre: string }[]).find((p) => norm(p.nombre) === norm(t))
    return r ? Number(r.clave) : null
  } catch { return null }
}
