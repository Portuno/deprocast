/**
 * Explorar internet (plan v31): lo mejor de Agent Reach, a la manera de Deprocast. Solo lo público, sin cuentas ni
 * navegadores disfrazados.
 * - Un canal por plataforma (web, Reddit, YouTube, GitHub, X, LinkedIn, Instagram, Facebook). Cada acción (buscar, leer,
 *   listar) es una cadena de backends que se prueban en orden: si uno está bloqueado, limitado o roto, va el siguiente;
 *   si lo pedido no existe o está mal armado, se corta ahí.
 * - leerLink(url) elige el canal por el sitio del link.
 * - Caché de 30 minutos (no se le pide dos veces lo mismo a nadie) y salud por backend: el último ok, el último error y,
 *   si lo limitaron o bloquearon, hasta cuándo no se le pide.
 * Todo sale por pedirSeguro: ningún link puede apuntar adentro.
 */
import type { Db } from '../db.ts'
import { CORTAN, ErrorExplorar, EN_CRIOLLO, type Backend, type Codigo, type Ctx, type Item, type Leido } from './tipos.ts'
import { chequearDestino, pedirSeguro, RedBloqueada } from './red.ts'
import { canalesDeFabrica } from './canales.ts'

export { ErrorExplorar, type Item, type Leido } from './tipos.ts'

export type Accion = 'buscar' | 'leer' | 'listar'
export type Listado = { nombre: string; ayuda: string; backends: Backend<{ id: string; n: number }, Item[]>[] }
export type Canal = {
  id: string
  nombre: string
  /** Los links que son suyos (para leerLink). */
  hosts?: RegExp
  /** Qué se puede y qué no sin cuenta, dicho para él. */
  puede: string
  noPuede?: string
  buscar?: Backend<{ consulta: string; n: number }, Item[]>[]
  leer?: Backend<{ url: string }, Leido>[]
  listar?: Record<string, Listado>
}

export const CANALES: Canal[] = []
export function registrar(c: Canal) {
  const i = CANALES.findIndex((x) => x.id === c.id)
  if (i >= 0) CANALES[i] = c
  else CANALES.push(c)
}
export const canal = (id: string) => CANALES.find((c) => c.id === id.toLowerCase().replace(/^twitter$/, 'x'))

const TTL = 30 * 60_000
const FRENO: Partial<Record<Codigo, number>> = { LIMITE: 10 * 60_000, BLOQUEADO: 30 * 60_000 }

let pedirPrueba: Ctx['pedir'] | null = null
/** Para los tests: todos los pedidos de explorar pasan por acá (sin DNS). */
export function _probarExplorar(f: Ctx['pedir'] | null) { pedirPrueba = f }
const ctxDe = (db: Db, ahora = Date.now()): Ctx => ({ db, ahora, pedir: pedirPrueba ?? ((u, i) => pedirSeguro(u, i)) })

function deCache<R>(db: Db, clave: string, ahora: number): { valor: R; via: string } | null {
  const r = db.prepare('SELECT valor, via, en FROM explorar_cache WHERE clave = ?').get(clave) as { valor: string; via: string; en: number } | undefined
  if (!r || ahora - r.en > TTL) return null
  try { return { valor: JSON.parse(r.valor), via: r.via } } catch { return null }
}

function anotarSalud(db: Db, c: string, b: string, ahora: number, error?: ErrorExplorar) {
  if (!error) {
    db.prepare(`INSERT INTO explorar_salud (canal, backend, ok_en) VALUES (?, ?, ?) ON CONFLICT(canal, backend) DO UPDATE SET ok_en = excluded.ok_en, frenado_hasta = NULL`).run(c, b, ahora)
    return
  }
  const freno = FRENO[error.codigo] ? ahora + FRENO[error.codigo]! : null
  db.prepare(`INSERT INTO explorar_salud (canal, backend, error_en, codigo, mensaje, frenado_hasta) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(canal, backend) DO UPDATE SET error_en = excluded.error_en, codigo = excluded.codigo, mensaje = excluded.mensaje, frenado_hasta = COALESCE(excluded.frenado_hasta, frenado_hasta)`)
    .run(c, b, ahora, error.codigo, error.message.slice(0, 300), freno)
}

const frenado = (db: Db, c: string, b: string, ahora: number) =>
  ((db.prepare('SELECT frenado_hasta AS f FROM explorar_salud WHERE canal = ? AND backend = ?').get(c, b) as { f: number | null } | undefined)?.f ?? 0) > ahora

/** La cadena: cada backend en orden, con caché, salud y freno. Vacío no es error, pero se prueba el siguiente. */
async function cadena<A, R>(ctx: Ctx, c: Canal, accion: string, backends: Backend<A, R>[], args: A, vacio: (r: R) => boolean): Promise<{ valor: R; via: string }> {
  if (!backends.length) throw new ErrorExplorar('NO_SE_PUEDE', `${c.nombre}: eso no se puede${c.noPuede ? ` (${c.noPuede})` : ''}`)
  const clave = `${c.id}:${accion}:${JSON.stringify(args)}`
  const ya = deCache<R>(ctx.db, clave, ctx.ahora)
  if (ya) return ya
  const fallas: string[] = []
  let ultimo: Codigo = 'ROTO'
  let vacioDe: { valor: R; via: string } | null = null
  for (const b of backends) {
    if (frenado(ctx.db, c.id, b.id, ctx.ahora) && backends.length > 1) { fallas.push(`${b.nombre}: en pausa`); continue }
    try {
      const valor = await b.correr(args, ctx)
      anotarSalud(ctx.db, c.id, b.id, ctx.ahora)
      if (vacio(valor)) { vacioDe ??= { valor, via: b.nombre }; continue }
      ctx.db.prepare('INSERT INTO explorar_cache (clave, valor, via, en) VALUES (?, ?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, via = excluded.via, en = excluded.en').run(clave, JSON.stringify(valor), b.nombre, ctx.ahora)
      return { valor, via: b.nombre }
    } catch (e) {
      const err = e instanceof ErrorExplorar ? e : new ErrorExplorar('ROTO', e instanceof Error ? e.message : String(e))
      anotarSalud(ctx.db, c.id, b.id, ctx.ahora, err)
      if (CORTAN.includes(err.codigo)) throw err
      ultimo = err.codigo
      fallas.push(`${b.nombre}: ${err.message}`)
    }
  }
  if (vacioDe) return vacioDe
  throw new ErrorExplorar(ultimo, `${c.nombre}: no pude (${fallas.join(' · ')})`)
}

export type Busqueda = { plataforma: string; via: string; items: Item[]; aviso?: string }

/** Buscar en una plataforma. */
export async function buscar(db: Db, plataforma: string, consulta: string, o: { n?: number; ahora?: number } = {}): Promise<Busqueda> {
  const c = canal(plataforma)
  if (!c) throw new ErrorExplorar('ENTRADA_MALA', `No conozco «${plataforma}». Hay: ${CANALES.map((x) => x.id).join(', ')}`)
  const q = consulta.trim()
  if (!q) throw new ErrorExplorar('ENTRADA_MALA', '¿Qué busco?')
  const n = Math.min(Math.max(o.n ?? 8, 1), 20)
  const r = await cadena(ctxDe(db, o.ahora), c, 'buscar', c.buscar ?? [], { consulta: q, n }, (x) => !x.length)
  return { plataforma: c.id, via: r.via, items: r.valor.slice(0, n), ...(c.noPuede ? { aviso: `Sin cuenta: ${c.noPuede}` } : {}) }
}

/** Leer un link: el canal se elige por el sitio (si no es de ninguna plataforma, la web). */
export async function leerLink(db: Db, url: string, o: { ahora?: number } = {}): Promise<Leido & { via: string; plataforma: string }> {
  const u = url.trim()
  if (!/^https?:\/\//i.test(u)) throw new ErrorExplorar('ENTRADA_MALA', 'Eso no es un link (http o https)')
  // Un link que apunta adentro no se lee, ni directo ni a través de un lector de afuera.
  if (!pedirPrueba) await chequearDestino(u).catch((e) => { throw new ErrorExplorar('ENTRADA_MALA', e instanceof RedBloqueada ? e.message : String(e)) })
  const c = CANALES.find((x) => x.hosts?.test(u) && x.leer?.length) ?? canal('web')!
  const r = await cadena(ctxDe(db, o.ahora), c, 'leer', c.leer ?? [], { url: u }, (x) => !x.markdown?.trim())
  return { ...r.valor, via: r.via, plataforma: c.id }
}

/** Listar lo de algo: los posts de un subreddit, los videos de un canal, los repos de alguien. */
export async function listar(db: Db, plataforma: string, que: string, id: string, o: { n?: number; ahora?: number } = {}): Promise<Busqueda> {
  const c = canal(plataforma)
  if (!c) throw new ErrorExplorar('ENTRADA_MALA', `No conozco «${plataforma}»`)
  const l = c.listar?.[que]
  if (!l) throw new ErrorExplorar('ENTRADA_MALA', `${c.nombre} no lista «${que}»${c.listar ? `. Lista: ${Object.keys(c.listar).join(', ')}` : ''}`)
  const n = Math.min(Math.max(o.n ?? 10, 1), 25)
  const r = await cadena(ctxDe(db, o.ahora), c, `listar:${que}`, l.backends, { id: id.trim(), n }, (x) => !x.length)
  return { plataforma: c.id, via: r.via, items: r.valor.slice(0, n) }
}

/** Para la pantalla y el doctor: cada canal, qué hace, por dónde va y cómo anda cada backend. */
export function estadoCanales(db: Db, ahora = Date.now()) {
  const salud = new Map((db.prepare('SELECT * FROM explorar_salud').all() as any[]).map((r) => [`${r.canal}:${r.backend}`, r]))
  const back = (c: Canal, b: Backend<any, any>) => {
    const s = salud.get(`${c.id}:${b.id}`)
    const estado = !s ? 'sin_usar' : s.frenado_hasta && s.frenado_hasta > ahora ? 'en_pausa' : (s.error_en ?? 0) > (s.ok_en ?? 0) ? 'fallo' : 'ok'
    return { id: b.id, nombre: b.nombre, estado, okEn: s?.ok_en ?? null, errorEn: s?.error_en ?? null, error: s?.codigo ? `${EN_CRIOLLO[s.codigo as Codigo] ?? s.codigo}: ${s.mensaje}` : null, pausaHasta: s?.frenado_hasta && s.frenado_hasta > ahora ? s.frenado_hasta : null }
  }
  return CANALES.map((c) => ({
    id: c.id, nombre: c.nombre, puede: c.puede, noPuede: c.noPuede ?? null,
    buscar: (c.buscar ?? []).map((b) => back(c, b)),
    leer: (c.leer ?? []).map((b) => back(c, b)),
    listar: Object.entries(c.listar ?? {}).map(([k, l]) => ({ que: k, nombre: l.nombre, ayuda: l.ayuda, backends: l.backends.map((b) => back(c, b)) })),
  }))
}

/** El Markdown de una búsqueda, para el chat y los agentes (con las URLs, que son reales). */
export function textoDeBusqueda(b: Busqueda): string {
  return [`${b.items.length} resultado${b.items.length === 1 ? '' : 's'} en ${b.plataforma} (vía ${b.via})${b.aviso ? ` — ${b.aviso}` : ''}`,
    ...b.items.map((x, i) => `${i + 1}. ${x.titulo}\n   ${x.url}${x.autor ? ` · ${x.autor}` : ''}${x.fecha ? ` · ${x.fecha.slice(0, 10)}` : ''}${x.texto ? `\n   ${x.texto.replace(/\s+/g, ' ').slice(0, 400)}` : ''}`)].join('\n')
}

// Los canales de fábrica (src/explorar/canales.ts) se registran al cargar el módulo.
for (const c of canalesDeFabrica()) registrar(c)
