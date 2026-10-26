/**
 * Leer el grafo (plan v25): del grafo al texto y entre fotos.
 * - Fragmentos: dónde aparecen juntos dos conceptos (o uno), con la pieza, la fecha y el pasaje. La procedencia no se
 *   guarda arista por arista (serían decenas de millones): se reconstruye a pedido con el FTS del corpus.
 * - Quitar lo obvio: la misma red sin sus k bisagras, medida y dibujada de nuevo (lo que queda son las ideas de segundo
 *   nivel, las que le dan especificidad a su discurso).
 * - Diff: qué comunidades nacieron, murieron, se juntaron o se partieron entre dos fotos, y qué bisagras subieron.
 * - El grafo de algo: abrir el grafo de una entidad, un dominio, un cuaderno o una charla (si ya existe, ese).
 */
import { json, type Db } from '../db.ts'
import { calcularEnHilo } from './hilo.ts'
import { crearGrafo, definicionDe, diccionario, leerFoto, leerGrafo, type Foto, type Grafo } from './index.ts'
import { documentosDe, type Fuente } from './fuentes.ts'
import type { Resultado } from './calcular.ts'

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/** El prefijo con que se busca un nodo: lo común entre su raíz y su forma («resistent» + «resistencia» → «resisten»). */
export function prefijo(lema: string, forma: string): string {
  const a = plano(lema), b = plano(forma.split(/\s+/)[0])
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return (i >= 3 ? a.slice(0, i) : b.slice(0, Math.max(3, Math.min(b.length, 6)))).replace(/[^a-z0-9ñ]/g, '')
}

/** Los ids que entran a un grafo (cacheados por foto: leerlos cuesta). Piezas y quántomos (en negativo). */
const idsPorFoto = new Map<number, Set<number>>()
function idsDe(db: Db, g: Grafo, fotoId: number): Set<number> {
  const ya = idsPorFoto.get(fotoId)
  if (ya) return ya
  const ids = new Set(documentosDe(db as any, definicionDe(g)).map((d) => d.id))
  idsPorFoto.set(fotoId, ids)
  if (idsPorFoto.size > 20) idsPorFoto.delete(idsPorFoto.keys().next().value!)
  return ids
}

export type Fragmento = { pieza: number | null; quantomo: number | null; titulo: string; fecha: string | null; texto: string }

/** El pasaje donde aparecen cerca los dos (o el uno), con ellos marcados «así». */
function recorte(texto: string, pa: string, pb: string | null, ancho = 220): string | null {
  const t = plano(texto)
  const re = (p: string) => new RegExp(`\\b${p}[a-z0-9ñ]*`, 'g')
  const as = [...t.matchAll(re(pa))].map((m) => m.index!)
  if (!as.length) return null
  let centro = as[0]
  if (pb) {
    const bs = [...t.matchAll(re(pb))].map((m) => m.index!)
    if (!bs.length) return null
    let mejor = Infinity
    for (const a of as) for (const b of bs) if (Math.abs(a - b) < mejor) { mejor = Math.abs(a - b); centro = Math.round((a + b) / 2) }
    if (mejor > 600) return null // no están cerca: no es co-aparición
  }
  const desde = Math.max(0, centro - ancho), hasta = Math.min(texto.length, centro + ancho)
  let s = texto.slice(desde, hasta).replace(/\s+/g, ' ').trim()
  // Marcar las palabras (sobre el original, por posición en el texto sin tildes: mismas longitudes).
  const marcar = (p: string) => { const pl = plano(s); let out = '', i = 0; for (const m of pl.matchAll(re(p))) { out += s.slice(i, m.index!) + '«' + s.slice(m.index!, m.index! + m[0].length) + '»'; i = m.index! + m[0].length } return out + s.slice(i) }
  s = marcar(pa)
  if (pb) s = marcar(pb)
  return `${desde > 0 ? '… ' : ''}${s}${hasta < texto.length ? ' …' : ''}`
}

/** Dónde aparecen juntos (o dónde aparece uno): los pasajes originales, dentro de lo que entra a ese grafo. */
export function fragmentos(db: Db, grafoId: number, fotoId: number, a: { lema: string; forma: string }, b?: { lema: string; forma: string } | null, max = 12): Fragmento[] {
  const g = leerGrafo(db, grafoId)
  if (!g) throw new Error(`No existe el grafo ${grafoId}`)
  const pa = prefijo(a.lema, a.forma), pb = b ? prefijo(b.lema, b.forma) : null
  if (!pa) return []
  const ids = idsDe(db, g, fotoId)
  const out: Fragmento[] = []
  // Las piezas: por el FTS (las dos palabras), y que estén en el grafo.
  const q = pb ? `${pa}* AND ${pb}*` : `${pa}*`
  let filas: any[] = []
  try { filas = db.prepare(`SELECT c.id, c.titulo, c.fecha, c.contenido FROM corpus_fts f JOIN corpus c ON c.id = f.rowid WHERE corpus_fts MATCH ? ORDER BY c.fecha DESC LIMIT 400`).all(q) as any[] } catch { /* consulta rara */ }
  for (const r of filas) {
    if (out.length >= max) break
    if (!ids.has(r.id)) continue
    const texto = recorte(`${r.titulo ?? ''}\n${r.contenido ?? ''}`, pa, pb)
    if (texto) out.push({ pieza: r.id, quantomo: null, titulo: r.titulo ?? '(sin título)', fecha: r.fecha, texto })
  }
  // Los quántomos sellados (no están en el FTS): por texto.
  if (out.length < max && [...ids].some((x) => x < 0)) {
    const qs = db.prepare(`SELECT id, titulo, texto, creado_en FROM quantomos WHERE etapa = 'sellado' AND texto LIKE ? ORDER BY id DESC LIMIT 200`).all(`%${pa}%`) as any[]
    for (const r of qs) {
      if (out.length >= max) break
      if (!ids.has(-r.id)) continue
      const texto = recorte(`${r.titulo ?? ''}\n${r.texto}`, pa, pb)
      if (texto) out.push({ pieza: null, quantomo: r.id, titulo: r.titulo ?? 'Quántomo', fecha: new Date(r.creado_en).toISOString().slice(0, 10), texto })
    }
  }
  return out
}

/** Quitar lo obvio: la red de la foto sin sus k nodos de más intermediación, medida y dibujada de nuevo (no se guarda). */
export async function sinLoObvio(db: Db, fotoId: number, k: number): Promise<Resultado & { quitados: string[] }> {
  const f = leerFoto(db, fotoId)
  if (!f) throw new Error('Esa foto ya no está')
  const reales = f.nodos.filter((n) => !n.vos)
  const quitar = new Set([...reales].sort((a, b) => b.btw - a.btw).slice(0, Math.max(1, Math.min(50, k))).map((n) => n.i))
  const quedan = reales.filter((n) => !quitar.has(n.i))
  const nuevo = new Map(quedan.map((n, j) => [n.i, j]))
  const aristas = f.aristas.filter(([a, b]) => nuevo.has(a) && nuevo.has(b)).map(([a, b, p]) => [nuevo.get(a)!, nuevo.get(b)!, p] as [number, number, number])
  const red = { nodos: quedan.map((n) => ({ lema: n.lema, forma: n.forma, frec: n.frec, docs: n.docs })), aristas, documentos: f.documentos, lemas: f.metricas.lemas, automaticas: f.automaticas ?? [] }
  const previas = Object.fromEntries(quedan.map((n) => [n.lema, [n.x, n.y] as [number, number]]))
  const r = await calcularEnHilo({ red, opciones: { dic: diccionario(db), previas } })
  return { ...r.resultado, quitados: reales.filter((n) => quitar.has(n.i)).map((n) => n.forma) }
}

export type Diff = {
  desde: number; hasta: number
  metricas: Record<string, { antes: number; ahora: number }>
  nacieron: { com: number; top: string[] }[]; murieron: { com: number; top: string[] }[]
  juntaron: { en: number; top: string[]; eran: string[][] }[]; partieron: { de: string[]; en: string[][] }[]
  bisagrasSuben: string[]; bisagrasBajan: string[]; nuevos: string[]; perdidos: string[]
}

/** Lo que cambió entre dos fotos: comunidades (por cuánto se parecen sus nodos), métricas, bisagras y conceptos. */
export function diffFotos(a: Foto, b: Foto): Diff {
  const set = (f: Foto, c: number) => new Set(f.nodos.filter((n) => n.com === c).map((n) => n.lema))
  const jac = (x: Set<string>, y: Set<string>) => { let i = 0; for (const v of x) if (y.has(v)) i++; return i / (x.size + y.size - i || 1) }
  const comsA = a.comunidades.filter((c) => c.tam >= 3), comsB = b.comunidades.filter((c) => c.tam >= 3)
  const SA = new Map(comsA.map((c) => [c.id, set(a, c.id)])), SB = new Map(comsB.map((c) => [c.id, set(b, c.id)]))
  // Cada comunidad nueva con su antecesora (la vieja con la que más comparte), si comparte algo de verdad.
  const padre = new Map<number, number>()
  for (const [cb, sb] of SB) { let mejor = -1, j = 0.12; for (const [ca, sa] of SA) { const v = jac(sa, sb); if (v > j) { j = v; mejor = ca } } if (mejor >= 0) padre.set(cb, mejor) }
  const hijo = new Map<number, number>()
  for (const [ca, sa] of SA) { let mejor = -1, j = 0.12; for (const [cb, sb] of SB) { const v = jac(sa, sb); if (v > j) { j = v; mejor = cb } } if (mejor >= 0) hijo.set(ca, mejor) }
  const top = (f: Foto, c: number) => f.comunidades.find((x) => x.id === c)?.top.slice(0, 5) ?? []
  const juntaron = [...new Set(hijo.values())].map((cb) => ({ cb, eran: [...hijo].filter(([, v]) => v === cb).map(([ca]) => ca) })).filter((x) => x.eran.length > 1)
    .map((x) => ({ en: x.cb, top: top(b, x.cb), eran: x.eran.map((ca) => top(a, ca)) }))
  const partieron = [...new Set(padre.values())].map((ca) => ({ ca, en: [...padre].filter(([, v]) => v === ca).map(([cb]) => cb) })).filter((x) => x.en.length > 1)
    .map((x) => ({ de: top(a, x.ca), en: x.en.map((cb) => top(b, cb)) }))
  const rango = (f: Foto) => new Map([...f.nodos].filter((n) => !n.vos).sort((x, y) => y.btw - x.btw).map((n, i) => [n.lema, i]))
  const ra = rango(a), rb = rango(b)
  const forma = new Map([...a.nodos, ...b.nodos].map((n) => [n.lema, n.forma]))
  const comunes = [...rb.keys()].filter((l) => ra.has(l))
  return {
    desde: a.en, hasta: b.en,
    metricas: Object.fromEntries((['M', 'C1', 'C2', 'E', 'n', 'comunidades'] as const).map((k) => [k, { antes: a.metricas[k] as number, ahora: b.metricas[k] as number }])),
    nacieron: comsB.filter((c) => !padre.has(c.id)).map((c) => ({ com: c.id, top: c.top.slice(0, 5) })),
    murieron: comsA.filter((c) => !hijo.has(c.id)).map((c) => ({ com: c.id, top: c.top.slice(0, 5) })),
    juntaron, partieron,
    bisagrasSuben: comunes.filter((l) => rb.get(l)! < 30 && ra.get(l)! - rb.get(l)! >= 15).sort((x, y) => rb.get(x)! - rb.get(y)!).slice(0, 8).map((l) => forma.get(l)!),
    bisagrasBajan: comunes.filter((l) => ra.get(l)! < 30 && rb.get(l)! - ra.get(l)! >= 15).sort((x, y) => ra.get(x)! - ra.get(y)!).slice(0, 8).map((l) => forma.get(l)!),
    nuevos: [...rb.keys()].filter((l) => !ra.has(l)).slice(0, 15).map((l) => forma.get(l)!),
    perdidos: [...ra.keys()].filter((l) => !rb.has(l)).slice(0, 15).map((l) => forma.get(l)!),
  }
}

/** El grafo de algo (una entidad, un dominio, un cuaderno, una charla): si ya hay uno con esa sola fuente, ese. */
export function grafoDe(db: Db, fuente: Fuente, nombre: string, ahora = Date.now()): Grafo {
  const clave = JSON.stringify([fuente])
  const ya = (db.prepare(`SELECT id, fuentes FROM grafos WHERE tipo = 'propio'`).all() as { id: number; fuentes: string }[]).find((r) => JSON.stringify(json(r.fuentes, [])) === clave)
  return ya ? leerGrafo(db, ya.id)! : crearGrafo(db, { nombre, fuentes: [fuente] }, ahora)
}
