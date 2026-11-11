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
import { raiz, type Diccionario } from './texto.ts'

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

const FUENTES_VALIDAS = ['entidad', 'conversacion', 'dominio', 'cuaderno', 'piezas', 'texto', 'epoca', 'observatorio']
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
    db.prepare('DELETE FROM grafo_huecos WHERE grafo_id = ?').run(id)
    db.prepare('DELETE FROM grafo_resumenes WHERE grafo_id = ?').run(id)
    db.prepare('DELETE FROM grafo_semanas WHERE grafo_id = ?').run(id)
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
  // Su propio nombre (y sus alias) no es un concepto de su grafo: aparece en todo lo suyo, así que unía cualquier cosa
  // («deprocast → dev → sarni → lautaro → voz → camiones», Fragua #227). Salvo que lo haya protegido.
  for (const n of nombresDelOperadorParaGrafo(db)) if (!d.proteger.has(n)) d.stop.add(n)
  return d
}

/** Las palabras de su nombre y sus alias (de la entidad marcada como él), en minúsculas y sin tildes. */
function nombresDelOperadorParaGrafo(db: Db): string[] {
  const yo = db.prepare(`SELECT nombre, alias FROM entidades WHERE json_extract(meta, '$.operador') = 1`).all() as { nombre: string; alias: string | null }[]
  const out = new Set<string>()
  for (const e of yo) for (const n of [e.nombre, ...(json<string[]>(e.alias, []) ?? [])]) for (const w of plano(String(n)).split(/[^a-z0-9ñ]+/)) if (w.length >= 3) out.add(w)
  return [...out]
}

/**
 * Los nodos que son cosas de su archivo (Fragua #228): si un concepto coincide con una entidad (su nombre o un alias,
 * o la misma raíz para las de una palabra, o el nombre de pila de una persona cuando no hay otra con ese nombre),
 * hereda su tipo y su ficha. Devuelve, por índice de nodo, la entidad.
 */
export function entidadesDeNodos(db: Db, foto: Pick<Resultado, 'nodos'>): Record<number, { id: number; tipo: string; nombre: string }> {
  const ents = db.prepare(`SELECT id, tipo, nombre, alias FROM entidades WHERE COALESCE(json_extract(meta, '$.operador'), 0) != 1`).all() as { id: number; tipo: string; nombre: string; alias: string | null }[]
  const porForma = new Map<string, { id: number; tipo: string; nombre: string } | null>()
  const porRaiz = new Map<string, { id: number; tipo: string; nombre: string } | null>()
  const poner = (m: Map<string, { id: number; tipo: string; nombre: string } | null>, k: string, e: { id: number; tipo: string; nombre: string }) => {
    if (!k || k.length < 3) return
    const ya = m.get(k)
    m.set(k, ya === undefined || ya?.id === e.id ? e : null) // dos entidades con la misma clave: no se adivina
  }
  const pilas = new Map<string, { id: number; tipo: string; nombre: string } | null>()
  for (const r of ents) {
    const e = { id: r.id, tipo: r.tipo, nombre: r.nombre }
    for (const n of [r.nombre, ...(json<string[]>(r.alias, []) ?? [])]) {
      const p = plano(String(n))
      poner(porForma, p, e)
      if (!/\s/.test(p)) poner(porRaiz, raiz(p), e)
    }
    const pila = plano(r.nombre).split(/\s+/)[0]
    if (r.tipo === 'persona' && /\s/.test(plano(r.nombre)) && pila.length >= 4) poner(pilas, pila, e)
  }
  const out: Record<number, { id: number; tipo: string; nombre: string }> = {}
  for (const n of foto.nodos) {
    if ((n as { vos?: boolean }).vos) continue
    const f = plano(n.forma)
    const e = porForma.get(f) ?? (porForma.has(f) ? null : porRaiz.get(n.lema) ?? (porRaiz.has(n.lema) ? null : pilas.get(f) ?? null))
    if (e) out[n.i] = e
  }
  return out
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
    // Los huecos de esta foto entran a seguimiento; los que ya se seguían, ¿se achicaron?
    try { (await import('./huecos.ts')).sincronizarHuecos(db, id, fid, ahora) } catch (e) { console.error('  grafo huecos:', e instanceof Error ? e.message : e) }
    // La semana queda en la historia larga (las fotos se podan; las métricas semanales, no).
    try { (await import('./salud.ts')).anotarSemana(db, id, leerFoto(db, fid)!, ahora) } catch (e) { console.error('  grafo semana:', e instanceof Error ? e.message : e) }
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
