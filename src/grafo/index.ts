/**
 * El Grafo de Deprocast (plan v25): las capas, sus fotos y el diccionario. Tres capas: «Tu voz» (la primordial: sus
 * piezas y lo que selló, con él en el centro), «Todo» (el corpus entero, muestreado) y los grafos que él arma sumando
 * fuentes. Cada cálculo corre en el hilo aparte y deja una foto (nodos, aristas, comunidades, huecos, métricas y el
 * dibujo); si el texto de entrada no cambió, no se guarda una foto nueva. La foto anterior es el punto de partida del
 * dibujo (el grafo no salta) y la base del diff en el tiempo.
 */
import { json, type Db } from '../db.ts'
import { calcularEnHilo } from './hilo.ts'
import { documentosDe, type Definicion, type Fuente } from './fuentes.ts'
import type { Resultado } from './calcular.ts'
import type { Diccionario } from './texto.ts'

export type Grafo = { id: number; clave: string | null; nombre: string; tipo: 'voz' | 'todo' | 'propio'; fuentes: Fuente[]; desde: string | null; hasta: string | null; creadoEn: number; editadoEn: number }
export type Foto = Resultado & { id: number; grafoId: number; firma: string; documentos: number; en: number }

const deGrafo = (r: any): Grafo => ({ id: r.id, clave: r.clave, nombre: r.nombre, tipo: r.tipo, fuentes: json<Fuente[]>(r.fuentes, []) ?? [], desde: r.desde, hasta: r.hasta, creadoEn: r.creado_en, editadoEn: r.editado_en })
const deFoto = (r: any): Foto => ({ ...json<Resultado>(r.datos, null as any), id: r.id, grafoId: r.grafo_id, firma: r.firma, documentos: r.documentos, en: r.en })

/** Las dos capas de siempre existen sin que nadie las cree. */
export function asegurarCapas(db: Db, ahora = Date.now()) {
  const ins = db.prepare(`INSERT OR IGNORE INTO grafos (clave, nombre, tipo, fuentes, creado_en, editado_en) VALUES (?, ?, ?, '[]', ?, ?)`)
  ins.run('voz', 'Tu voz', 'voz', ahora, ahora)
  ins.run('todo', 'Todo', 'todo', ahora, ahora)
}

export function listarGrafos(db: Db): (Grafo & { foto: { en: number; metricas: Resultado['metricas'] } | null; calculando: boolean })[] {
  asegurarCapas(db)
  return (db.prepare(`SELECT * FROM grafos ORDER BY tipo = 'voz' DESC, tipo = 'todo' DESC, editado_en DESC`).all() as any[]).map((r) => {
    const f = db.prepare('SELECT en, json_extract(datos, \'$.metricas\') AS m FROM grafo_fotos WHERE grafo_id = ? ORDER BY id DESC LIMIT 1').get(r.id) as { en: number; m: string } | undefined
    return { ...deGrafo(r), foto: f ? { en: f.en, metricas: json(f.m, null as any) } : null, calculando: calculandoAhora.has(r.id) }
  })
}
export const leerGrafo = (db: Db, id: number): Grafo | null => { const r = db.prepare('SELECT * FROM grafos WHERE id = ?').get(id); return r ? deGrafo(r) : null }
export const grafoPorClave = (db: Db, clave: 'voz' | 'todo'): Grafo => { asegurarCapas(db); return deGrafo(db.prepare('SELECT * FROM grafos WHERE clave = ?').get(clave)) }

const FUENTES_VALIDAS = ['entidad', 'conversacion', 'dominio', 'cuaderno', 'piezas', 'texto', 'epoca']
function limpiarFuentes(fs: unknown): Fuente[] {
  return (Array.isArray(fs) ? fs : []).filter((f: any) => FUENTES_VALIDAS.includes(f?.tipo)).slice(0, 40).map((f: any) => {
    if (f.tipo === 'piezas') return { tipo: 'piezas', ids: (Array.isArray(f.ids) ? f.ids : []).map(Number).filter(Number.isFinite).slice(0, 2000) }
    if (f.tipo === 'texto') return { tipo: 'texto', texto: String(f.texto ?? '').slice(0, 200_000), titulo: f.titulo ? String(f.titulo).slice(0, 120) : undefined }
    if (f.tipo === 'epoca') return { tipo: 'epoca', desde: String(f.desde ?? '').slice(0, 10), hasta: String(f.hasta ?? '').slice(0, 10) }
    return { tipo: f.tipo, id: Number(f.id) }
  }) as Fuente[]
}

/** Un grafo nuevo, armado sumando fuentes (entidades, chats, dominios, cuadernos, una época, piezas, texto). */
export function crearGrafo(db: Db, g: { nombre: string; fuentes: unknown; desde?: string | null; hasta?: string | null }, ahora = Date.now()): Grafo {
  const fuentes = limpiarFuentes(g.fuentes)
  if (!fuentes.length) throw new Error('Sumale al menos una fuente: una entidad, un chat, un dominio, un cuaderno, una época o un texto')
  const id = Number(db.prepare(`INSERT INTO grafos (nombre, tipo, fuentes, desde, hasta, creado_en, editado_en) VALUES (?, 'propio', ?, ?, ?, ?, ?)`)
    .run(String(g.nombre ?? '').trim().slice(0, 120) || 'Grafo sin nombre', JSON.stringify(fuentes), g.desde || null, g.hasta || null, ahora, ahora).lastInsertRowid)
  return leerGrafo(db, id)!
}

export function editarGrafo(db: Db, id: number, c: { nombre?: string; fuentes?: unknown; desde?: string | null; hasta?: string | null; borrar?: boolean }, ahora = Date.now()) {
  const g = leerGrafo(db, id)
  if (!g) throw new Error(`No existe el grafo ${id}`)
  if (c.borrar) {
    if (g.tipo !== 'propio') throw new Error('Las capas de siempre no se borran')
    db.prepare('DELETE FROM grafo_fotos WHERE grafo_id = ?').run(id)
    db.prepare('DELETE FROM grafos WHERE id = ?').run(id)
    return null
  }
  db.prepare('UPDATE grafos SET nombre = ?, fuentes = ?, desde = ?, hasta = ?, editado_en = ? WHERE id = ?').run(
    c.nombre?.trim() ? c.nombre.trim().slice(0, 120) : g.nombre, c.fuentes === undefined ? JSON.stringify(g.fuentes) : JSON.stringify(g.tipo === 'propio' ? limpiarFuentes(c.fuentes) : []),
    c.desde === undefined ? g.desde : c.desde || null, c.hasta === undefined ? g.hasta : c.hasta || null, ahora, id)
  return leerGrafo(db, id)
}

export const definicionDe = (g: Grafo): Definicion => ({ tipo: g.tipo, fuentes: g.fuentes, desde: g.desde, hasta: g.hasta })

// ─── el diccionario ─────────────────────────────────────────────────────

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
export function diccionario(db: Db): Diccionario {
  const d: Diccionario = { stop: new Set(), alias: new Map(), proteger: new Set() }
  for (const r of db.prepare('SELECT forma, tipo, destino FROM grafo_diccionario').all() as { forma: string; tipo: string; destino: string | null }[]) {
    if (r.tipo === 'stop') d.stop.add(r.forma)
    else if (r.tipo === 'proteger') d.proteger.add(r.forma)
    else if (r.tipo === 'alias' && r.destino) d.alias.set(r.forma, r.destino)
  }
  return d
}
export const entradasDiccionario = (db: Db) => db.prepare('SELECT forma, tipo, destino, en FROM grafo_diccionario ORDER BY tipo, forma').all() as { forma: string; tipo: string; destino: string | null; en: number }[]

/** Él frena una palabra, la protege o declara un alias (forma → destino); sin tipo, la saca del diccionario. */
export function editarDiccionario(db: Db, e: { forma: string; tipo?: 'stop' | 'proteger' | 'alias' | null; destino?: string | null }, ahora = Date.now()) {
  const forma = plano(String(e.forma ?? ''))
  if (forma.length < 2) throw new Error('¿Qué palabra?')
  if (!e.tipo) db.prepare('DELETE FROM grafo_diccionario WHERE forma = ?').run(forma)
  else {
    if (e.tipo === 'alias' && !e.destino?.trim()) throw new Error('Un alias necesita a qué se unifica')
    db.prepare('INSERT INTO grafo_diccionario (forma, tipo, destino, en) VALUES (?, ?, ?, ?) ON CONFLICT(forma) DO UPDATE SET tipo = excluded.tipo, destino = excluded.destino, en = excluded.en')
      .run(forma, e.tipo, e.tipo === 'alias' ? e.destino!.trim().toLowerCase().slice(0, 80) : null, ahora)
  }
  return entradasDiccionario(db)
}

// ─── calcular y las fotos ───────────────────────────────────────────────

const calculandoAhora = new Map<number, Promise<Foto | null>>()
export const estaCalculando = (id: number) => calculandoAhora.has(id)

export function ultimaFoto(db: Db, id: number): Foto | null {
  const r = db.prepare('SELECT * FROM grafo_fotos WHERE grafo_id = ? ORDER BY id DESC LIMIT 1').get(id)
  return r ? deFoto(r) : null
}
export const leerFoto = (db: Db, fid: number): Foto | null => { const r = db.prepare('SELECT * FROM grafo_fotos WHERE id = ?').get(fid); return r ? deFoto(r) : null }
/** La historia de un grafo: cada foto con sus métricas (para el diff y la salud). */
export const historia = (db: Db, id: number) => (db.prepare(`SELECT id, en, documentos, json_extract(datos, '$.metricas') AS m FROM grafo_fotos WHERE grafo_id = ? ORDER BY id DESC LIMIT 60`).all(id) as any[]).map((r) => ({ id: r.id, en: r.en, documentos: r.documentos, metricas: json(r.m, null as any) }))

/** Cuántas fotos se guardan por grafo (las más nuevas; la historia larga queda en las métricas de la salud). */
const FOTOS_POR_GRAFO = 20

/**
 * Recalcula un grafo en el hilo aparte. Si el texto de entrada es el mismo que el de la última foto, no guarda otra
 * (salvo que se fuerce). Si ya se está calculando, devuelve ese mismo cálculo.
 */
export function recalcular(db: Db, id: number, o: { forzar?: boolean; ahora?: number } = {}): Promise<Foto | null> {
  const ya = calculandoAhora.get(id)
  if (ya) return ya
  const p = (async () => {
    const g = leerGrafo(db, id)
    if (!g) throw new Error(`No existe el grafo ${id}`)
    const anterior = ultimaFoto(db, id)
    const previas = anterior ? Object.fromEntries(anterior.nodos.filter((n) => !n.vos).map((n) => [n.lema, [n.x, n.y] as [number, number]])) : undefined
    const definicion = definicionDe(g)
    const ruta = (db as any).location?.() as string | null
    // Con una base en archivo, el hilo lee él mismo; en memoria (tests), se le pasan los documentos.
    const r = await calcularEnHilo(ruta ? { ruta, definicion, opciones: { dic: diccionario(db), previas, vos: g.tipo === 'voz' } } : { docs: documentosDe(db as any, definicion), opciones: { dic: diccionario(db), previas, vos: g.tipo === 'voz' } })
    if (anterior && anterior.firma === r.firma && !o.forzar) return anterior
    const ahora = o.ahora ?? Date.now()
    const fid = Number(db.prepare('INSERT INTO grafo_fotos (grafo_id, firma, documentos, datos, en) VALUES (?, ?, ?, ?, ?)').run(id, r.firma, r.documentos, JSON.stringify(r.resultado), ahora).lastInsertRowid)
    db.prepare(`DELETE FROM grafo_fotos WHERE grafo_id = ? AND id NOT IN (SELECT id FROM grafo_fotos WHERE grafo_id = ? ORDER BY id DESC LIMIT ${FOTOS_POR_GRAFO})`).run(id, id)
    return leerFoto(db, fid)
  })()
  calculandoAhora.set(id, p)
  p.then(() => calculandoAhora.delete(id), () => calculandoAhora.delete(id))
  return p
}

/** Un texto suelto, al instante (no se guarda): «analizar este texto». */
export async function analizarTexto(db: Db, texto: string): Promise<Resultado> {
  const t = texto.trim()
  if (t.length < 80) throw new Error('Pegá un texto un poco más largo (un párrafo por lo menos)')
  return (await calcularEnHilo({ docs: [{ id: 1, texto: t.slice(0, 500_000), tipo: 'texto' }], opciones: { dic: diccionario(db) } })).resultado
}
