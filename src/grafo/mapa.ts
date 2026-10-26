/**
 * El grafo le da mapa al modelo (plan v25).
 * - Las zonas de su memoria (el patrón GraphRAG): un resumen por comunidad («de qué va este grupo»), escrito por el
 *   modelo con pasajes de sus conceptos centrales y cacheado por la huella de la comunidad (si no cambió, no se pide).
 * - Las herramientas del chat: ver el grafo, conectar dos conceptos (camino y pasajes) y las preguntas globales («¿cuáles
 *   son mis temas?», «¿dónde me repito?»), que se responden zona por zona y ancladas a fragmentos.
 * - En tu grafo: para cada carta de La Mano, qué grupos toca, si une dos o cierra un hueco. Sin modelo: léxico, contra la
 *   última foto de «Tu voz».
 * - La Academia: los puntos de entrada y los huecos del grafo del material de un dominio (el nivel Frontera).
 * Es léxico, no semántico: dos palabras distintas para lo mismo son dos nodos (para eso, los alias del diccionario).
 */
import { type Db } from '../db.ts'
import { pedirJson } from '../modelo.ts'
import { fragmentos, grafoDe, type Fragmento } from './leer.ts'
import { diccionario, grafoPorClave, leerGrafo, recalcular, ultimaFoto, type Foto, type Grafo } from './index.ts'
import { huecosDe } from './huecos.ts'
import { lemas, raiz } from './texto.ts'
import type { Comunidad, Nodo } from './calcular.ts'

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
const fecha = (en: number) => new Date(en).toISOString().slice(0, 10)

/** Qué grafo: «voz» (por defecto), «todo», o uno suyo por id o por nombre. */
export function resolverGrafo(db: Db, cual?: string | number | null): Grafo {
  if (cual == null || cual === '' || /^(voz|tu voz|mi voz)$/i.test(String(cual))) return grafoPorClave(db, 'voz')
  if (/^todo$/i.test(String(cual))) return grafoPorClave(db, 'todo')
  if (Number.isFinite(Number(cual))) { const g = leerGrafo(db, Number(cual)); if (g) return g }
  const q = plano(String(cual))
  const r = (db.prepare('SELECT id, nombre FROM grafos').all() as { id: number; nombre: string }[]).find((x) => plano(x.nombre) === q)
    ?? (db.prepare('SELECT id, nombre FROM grafos').all() as { id: number; nombre: string }[]).find((x) => plano(x.nombre).includes(q))
  if (!r) throw new Error(`No hay un grafo «${cual}»: están Tu voz, Todo y los que armó en Mis grafos`)
  return leerGrafo(db, r.id)!
}

/** La última foto (si no hay, se calcula: solo CPU, en el hilo aparte). */
async function fotoDe(db: Db, g: Grafo): Promise<Foto | null> {
  return ultimaFoto(db, g.id) ?? (await recalcular(db, g.id))
}

// ─── las zonas (resúmenes por comunidad) ────────────────────────────────

export type Zona = { com: number; tam: number; top: string[]; titulo: string | null; resumen: string | null }

const firmaCom = (c: Comunidad) => c.top.slice(0, 8).map(plano).sort().join(',')
const grandes = (f: Foto, max: number) => f.comunidades.filter((c) => c.id >= 0 && c.tam >= 3).sort((a, b) => b.tam - a.tam).slice(0, max)

/** Las zonas con lo que ya hay escrito de cada una (sin pedir nada). */
export function zonas(db: Db, g: Grafo, f: Foto, max = 10): Zona[] {
  const q = db.prepare('SELECT titulo, resumen FROM grafo_resumenes WHERE grafo_id = ? AND firma = ?')
  return grandes(f, max).map((c) => {
    const r = q.get(g.id, firmaCom(c)) as { titulo: string; resumen: string } | undefined
    return { com: c.id, tam: c.tam, top: c.top, titulo: r?.titulo ?? null, resumen: r?.resumen ?? null }
  })
}

/** Los dos conceptos centrales de una comunidad (para buscar sus pasajes). */
const centrales = (f: Foto, com: number, k = 2): Nodo[] => f.nodos.filter((n) => n.com === com && !n.vos).sort((a, b) => b.btw - a.btw).slice(0, k)

let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'grafo' }, sistema, usuario, { temperatura: 0.4, maxTokens: 2400 })).datos
export function _probarMapa(o: { modelo?: typeof modelo }) {
  if (o.modelo) modelo = o.modelo
}

const SISTEMA_ZONAS = `Sos Mastropiero leyendo el grafo de su memoria. Te paso grupos de conceptos que aparecen juntos en sus textos (cada grupo con sus conceptos centrales y algunos pasajes). Para cada grupo escribí:
- titulo: 2 a 5 palabras, de qué va esa zona (con sus palabras, no genérico).
- resumen: 2 o 3 oraciones: de qué habla ahí, qué le importa, qué tensión o pregunta tiene esa zona. Solo lo que se ve en los conceptos y los pasajes; si el grupo es ruido (palabras sueltas sin tema), decilo en el resumen.
Forma: {"zonas": [{"n": number, "titulo": string, "resumen": string}]}`

/**
 * Escribe (en una sola llamada) los resúmenes que falten de las zonas más grandes. Gasta tokens: lo llama el chat (en la
 * nube) o el botón «De qué va cada grupo» (solo en la nube).
 */
export async function resumir(db: Db, g: Grafo, f: Foto, o: { max?: number; ahora?: number } = {}): Promise<{ zonas: Zona[]; nuevas: number; aviso: string | null }> {
  const max = o.max ?? 10
  const faltan = zonas(db, g, f, max).filter((z) => !z.resumen)
  if (!faltan.length) return { zonas: zonas(db, g, f, max), nuevas: 0, aviso: null }
  const { topeAlcanzado } = await import('../nan.ts')
  const tope = topeAlcanzado(db, o.ahora ?? Date.now())
  if (tope) return { zonas: zonas(db, g, f, max), nuevas: 0, aviso: tope }
  const bloques = faltan.map((z, k) => {
    const [a, b] = centrales(f, z.com)
    const fs = a ? fragmentos(db, g.id, f.id, a, b ?? null, 3) : []
    return `Grupo ${k + 1}: ${z.top.join(', ')}\n${fs.map((x) => `- ${x.texto.replace(/[«»]/g, '').slice(0, 360)}`).join('\n')}`
  })
  const r = await modelo(db, SISTEMA_ZONAS, bloques.join('\n\n'))
  const ins = db.prepare(`INSERT INTO grafo_resumenes (grafo_id, firma, top, titulo, resumen, en) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(grafo_id, firma) DO UPDATE SET titulo = excluded.titulo, resumen = excluded.resumen, en = excluded.en`)
  let nuevas = 0
  for (const x of Array.isArray(r?.zonas) ? r.zonas : []) {
    const z = faltan[Number(x?.n) - 1]
    const titulo = String(x?.titulo ?? '').trim().slice(0, 80), resumen = String(x?.resumen ?? '').trim().slice(0, 700)
    if (!z || !titulo || !resumen) continue
    const c = f.comunidades.find((y) => y.id === z.com)!
    ins.run(g.id, firmaCom(c), JSON.stringify(c.top), titulo, resumen, o.ahora ?? Date.now())
    nuevas++
  }
  return { zonas: zonas(db, g, f, max), nuevas, aviso: nuevas ? null : 'El modelo no devolvió los resúmenes: probá de nuevo' }
}

// ─── las herramientas del chat ──────────────────────────────────────────

const fragCorto = (x: Fragmento) => ({ pieza: x.pieza ?? undefined, quantomo: x.quantomo ?? undefined, titulo: x.titulo, fecha: x.fecha ?? undefined, pasaje: x.texto })

/** La estructura de un grafo para el modelo: estado, zonas, bisagras, puntos de entrada y huecos. */
export async function verGrafo(db: Db, cual?: string | number | null) {
  const g = resolverGrafo(db, cual)
  const f = await fotoDe(db, g)
  if (!f) return { grafo: g.nombre, aviso: 'Este grafo todavía no tiene texto.' }
  const m = f.metricas
  const sinVos = f.nodos.filter((n) => !n.vos)
  return {
    grafo: g.nombre, foto_del: fecha(f.en), textos: f.documentos, conceptos: m.n,
    estado: m.estado, medidas: { modularidad: m.M, mayor_grupo: m.C1, conectado: m.C2, influencia_repartida: m.E },
    zonas: zonas(db, g, f, 10).map((z, k) => ({ grupo: k + 1, titulo: z.titulo ?? undefined, resumen: z.resumen ?? undefined, conceptos: z.top.slice(0, 8), tamaño: z.tam })),
    bisagras: [...sinVos].sort((a, b) => b.btw - a.btw).slice(0, 10).map((n) => n.forma),
    puntos_de_entrada: sinVos.filter((n) => n.entrada).map((n) => n.forma),
    huecos: huecosDe(db, g.id).filter((h) => h.estado !== 'cerrado').slice(0, 5).map((h) => ({ id: h.id, a: h.terminosA.slice(0, 4), b: h.terminosB.slice(0, 4), estado: h.estado, pregunta: h.pregunta ?? undefined })),
    nota: 'Es léxico (palabras que aparecen juntas), no semántico. Las zonas sin título todavía no tienen resumen (preguntar_al_corpus los escribe).',
  }
}

/** El nodo de un concepto escrito a mano: por su forma, su raíz o su comienzo. */
export function nodoPorTexto(f: Foto, q: string): Nodo | null {
  const p = plano(q), r = raiz(q.toLowerCase())
  const ns = f.nodos.filter((n) => !n.vos)
  return ns.find((n) => plano(n.forma) === p) ?? ns.find((n) => n.lema === r) ?? ns.find((n) => plano(n.forma).startsWith(p) && p.length >= 4)
    ?? ns.find((n) => n.lema.startsWith(r) && r.length >= 4) ?? null
}

/** El camino más barato (costo 1/peso) entre dos nodos, sin pasar por «Vos». */
export function camino(f: Foto, a: number, b: number): number[] | null {
  const n = f.nodos.length
  const ady: [number, number][][] = Array.from({ length: n }, () => [])
  for (const [x, y, p] of f.aristas) if (!f.nodos[x]?.vos && !f.nodos[y]?.vos) { ady[x].push([y, 1 / p]); ady[y].push([x, 1 / p]) }
  const dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), hecho = new Uint8Array(n)
  dist[a] = 0
  for (;;) {
    let u = -1
    for (let i = 0; i < n; i++) if (!hecho[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
    if (u < 0 || u === b) break
    hecho[u] = 1
    for (const [v, c] of ady[u]) if (dist[u] + c < dist[v]) { dist[v] = dist[u] + c; prev[v] = u }
  }
  if (dist[b] === Infinity) return null
  const out = [b]
  while (out[0] !== a) out.unshift(prev[out[0]])
  return out
}

/** Qué conecta X con Y en su grafo: el camino, si son del mismo grupo y los pasajes de cada tramo. */
export async function conectarConceptos(db: Db, a: string, b: string, cual?: string | number | null) {
  const g = resolverGrafo(db, cual)
  const f = await fotoDe(db, g)
  if (!f) return { error: 'Este grafo todavía no tiene texto.' }
  const na = nodoPorTexto(f, a), nb = nodoPorTexto(f, b)
  const parecidos = (q: string) => f.nodos.filter((n) => !n.vos && plano(n.forma).startsWith(plano(q).slice(0, 3))).sort((x, y) => y.btw - x.btw).slice(0, 6).map((n) => n.forma)
  if (!na || !nb) return { error: `${!na ? `«${a}»` : `«${b}»`} no está entre los conceptos de «${g.nombre}» (o es muy poco frecuente).`, parecidos: parecidos(!na ? a : b) }
  const zs = zonas(db, g, f, 30)
  const zona = (c: number) => { const z = zs.find((x) => x.com === c); return z ? z.titulo ?? z.top.slice(0, 3).join(', ') : null }
  const c = camino(f, na.i, nb.i)
  const directos = fragmentos(db, g.id, f.id, na, nb, 4).map(fragCorto)
  return {
    grafo: g.nombre, de: na.forma, a: nb.forma, mismo_grupo: na.com === nb.com, grupo_de: { [na.forma]: zona(na.com), [nb.forma]: zona(nb.com) },
    camino: c?.map((i) => f.nodos[i].forma) ?? null,
    tramos: c && c.length > 2 ? c.slice(0, -1).slice(0, 4).map((i, k) => ({ de: f.nodos[i].forma, a: f.nodos[c[k + 1]].forma, pasajes: fragmentos(db, g.id, f.id, f.nodos[i], f.nodos[c[k + 1]], 2).map(fragCorto) })) : undefined,
    juntos: directos,
    lectura: !c ? 'No hay camino: viven en partes sueltas de su grafo (un hueco).' : c.length === 2 ? 'Aparecen juntos en sus textos.' : `Se tocan a través de ${c.slice(1, -1).map((i) => f.nodos[i].forma).join(' → ')}.`,
  }
}

/**
 * Las preguntas globales («¿cuáles son mis temas?», «¿qué conecta mis proyectos?», «¿dónde me repito?»): no las responde
 * una búsqueda, las responde el mapa. Se escriben los resúmenes que falten y vuelven las zonas ordenadas por lo que tocan
 * de la pregunta, cada una con sus pasajes ancla; el modelo del chat hace la síntesis citando zonas y piezas.
 */
export async function preguntarAlCorpus(db: Db, pregunta: string, cual?: string | number | null) {
  const g = resolverGrafo(db, cual)
  const f = await fotoDe(db, g)
  if (!f) return { error: 'Este grafo todavía no tiene texto.' }
  const r = await resumir(db, g, f, { max: 10 }).catch((e) => ({ zonas: zonas(db, g, f, 10), nuevas: 0, aviso: e instanceof Error ? e.message : String(e) }))
  const pide = new Set(lemas(pregunta, diccionario(db)))
  const toca = (com: number) => f.nodos.filter((n) => n.com === com && pide.has(n.lema))
  const ordenadas = r.zonas.map((z) => ({ z, t: toca(z.com) })).sort((x, y) => y.t.length - x.t.length || y.z.tam - x.z.tam)
  const total = f.nodos.filter((n) => !n.vos).length || 1
  return {
    grafo: g.nombre, estado: f.metricas.estado, foto_del: fecha(f.en),
    zonas: ordenadas.map(({ z, t }, k) => {
      const [a, b] = t.length ? [t[0], t[1] ?? null] : [centrales(f, z.com)[0], centrales(f, z.com)[1] ?? null]
      return {
        grupo: k + 1, titulo: z.titulo ?? undefined, resumen: z.resumen ?? undefined, conceptos: z.top.slice(0, 8), peso: `${Math.round((z.tam / total) * 100)} %`,
        toca_la_pregunta: t.length ? t.map((n) => n.forma) : undefined, pasajes: a ? fragmentos(db, g.id, f.id, a, b, 2).map(fragCorto) : [],
      }
    }),
    huecos: huecosDe(db, g.id).filter((h) => h.estado !== 'cerrado').slice(0, 4).map((h) => `[${h.terminosA.slice(0, 3).join(', ')}] ↔ [${h.terminosB.slice(0, 3).join(', ')}]${h.pregunta ? `: ${h.pregunta}` : ''}`),
    aviso: r.aviso ?? undefined,
    como_responder: 'Cada zona es un mapa parcial de su memoria. Respondé juntando las zonas que tocan la pregunta (si es global, todas por su peso): cada afirmación anclada a una zona («en tu zona de …») y a un pasaje [#pieza]. Lo que el mapa no muestra, no lo afirmes.',
  }
}

// ─── en tu grafo (La Mano) ──────────────────────────────────────────────

export type EnTuGrafo = { tipo: 'nuevo' | 'refuerza' | 'une' | 'cierra'; grupos: string[][]; conceptos: string[]; hueco?: number }

/** La última foto de «Tu voz», leída una vez por foto (por base: una carta no vuelve a parsear 1.200 nodos). */
const cacheVoz = new WeakMap<Db, { fotoId: number; f: Foto; porLema: Map<string, Nodo> }>()
function fotoVoz(db: Db) {
  const g = db.prepare(`SELECT id FROM grafos WHERE clave = 'voz'`).get() as { id: number } | undefined
  if (!g) return null
  const u = db.prepare('SELECT id FROM grafo_fotos WHERE grafo_id = ? ORDER BY id DESC LIMIT 1').get(g.id) as { id: number } | undefined
  if (!u) return null
  let c = cacheVoz.get(db)
  if (c?.fotoId !== u.id) {
    const f = ultimaFoto(db, g.id)!
    c = { fotoId: u.id, f, porLema: new Map(f.nodos.filter((n) => !n.vos).map((n) => [n.lema, n])) }
    cacheVoz.set(db, c)
  }
  return { grafoId: g.id, ...c }
}

/**
 * Qué hace una afirmación en su grafo: si no toca nada que ya tenga (nuevo), si refuerza un grupo, si une dos grupos o si
 * cierra uno de los huecos que se siguen. Contra la última foto de «Tu voz», sin modelo.
 */
export function enTuGrafo(db: Db, texto: string): EnTuGrafo | null {
  const v = fotoVoz(db)
  if (!v) return null
  const ls = [...new Set(lemas(texto, diccionario(db)))]
  if (ls.length < 3) return null
  const ns = ls.map((l) => v.porLema.get(l)).filter((n): n is Nodo => !!n)
  if (!ns.length) return { tipo: 'nuevo', grupos: [], conceptos: [] }
  const porCom = new Map<number, Nodo[]>()
  for (const n of ns) porCom.set(n.com, [...(porCom.get(n.com) ?? []), n])
  const coms = [...porCom].sort((a, b) => b[1].length - a[1].length)
  const topDe = (c: number) => v.f.comunidades.find((x) => x.id === c)?.top.slice(0, 3) ?? []
  const conceptos = [...ns].sort((a, b) => b.btw - a.btw).slice(0, 5).map((n) => n.forma)
  // ¿Cierra un hueco? Toca los dos lados de uno que se sigue, con al menos tres de sus términos (uno suelto de cada lado,
  // si es una palabra muy común, no une nada).
  const formas = new Set(ns.map((n) => plano(n.forma)))
  const de = (ts: string[]) => ts.filter((t) => formas.has(plano(t))).length
  const hueco = huecosDe(db, v.grafoId).find((h) => (h.estado === 'abierto' || h.estado === 'en_curso') && de(h.terminosA) >= 1 && de(h.terminosB) >= 1 && de(h.terminosA) + de(h.terminosB) >= 3)
  if (hueco) return { tipo: 'cierra', grupos: [hueco.terminosA.slice(0, 3), hueco.terminosB.slice(0, 3)], conceptos, hueco: hueco.id }
  if (coms.length >= 2) return { tipo: 'une', grupos: coms.slice(0, 2).map(([c]) => topDe(c)), conceptos }
  return { tipo: 'refuerza', grupos: [topDe(coms[0][0])], conceptos }
}

// ─── la Academia ────────────────────────────────────────────────────────

/** El grafo del material de un dominio (el mismo que abre «☍ Grafo del material»), sin calcular. */
function grafoDelDominio(db: Db, dominioId: number): Grafo | null {
  const clave = JSON.stringify([{ tipo: 'dominio', id: dominioId }])
  const r = (db.prepare(`SELECT id, fuentes FROM grafos WHERE tipo = 'propio'`).all() as { id: number; fuentes: string }[]).find((x) => x.fuentes === clave)
  return r ? leerGrafo(db, r.id) : null
}

/** Para la vista del dominio: por dónde entrar y qué no se toca en su material (de la última foto, si hay). */
export function mapaDelDominio(db: Db, dominioId: number): { entradas: string[]; bisagras: string[]; huecos: string[][][] } | null {
  const g = grafoDelDominio(db, dominioId)
  const f = g ? ultimaFoto(db, g.id) : null
  if (!f) return null
  const ns = f.nodos.filter((n) => !n.vos)
  return {
    entradas: ns.filter((n) => n.entrada).slice(0, 6).map((n) => n.forma),
    bisagras: [...ns].sort((a, b) => b.btw - a.btw).slice(0, 6).map((n) => n.forma),
    huecos: f.huecos.slice(0, 3).map((h) => [h.terminosA.slice(0, 3), h.terminosB.slice(0, 3)]),
  }
}

/**
 * Para el nivel Frontera: los huecos del grafo de su material (lo que sus fuentes todavía no unen) como «qué falta
 * saber». Si el dominio no tiene grafo, se arma (solo CPU).
 */
export async function fronteraDelDominio(db: Db, d: { id: number; tema: string }): Promise<string> {
  const g = grafoDelDominio(db, d.id) ?? grafoDe(db, { tipo: 'dominio', id: d.id }, `${d.tema} (Academia)`)
  if (!ultimaFoto(db, g.id)) await recalcular(db, g.id)
  const m = mapaDelDominio(db, d.id)
  if (!m || (!m.huecos.length && !m.entradas.length)) return ''
  return [
    m.huecos.length ? `Huecos del grafo de su material (grupos de ideas que sus fuentes todavía no unen: buen lugar para las preguntas abiertas de la frontera):\n${m.huecos.map(([a, b]) => `- [${a.join(', ')}] ↔ [${b.join(', ')}]`).join('\n')}` : '',
    m.entradas.length ? `Puntos de entrada de su material (aparecen poco, conectan mucho): ${m.entradas.join(', ')}` : '',
  ].filter(Boolean).join('\n')
}
