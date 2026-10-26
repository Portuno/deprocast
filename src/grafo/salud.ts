/**
 * La salud del corpus (plan v25): cómo está su discurso y cómo se mueve.
 * - El estado (sesgado, enfocado, diversificado, disperso) con los umbrales de la literatura, y su historia semanal de
 *   M, C1, C2 y E: con cuatro semanas, su rango habitual (los umbrales se calibran contra su corpus, no contra el de otro).
 * - Lo que cambió en la semana: grupos que nacen, crecen, se juntan, se parten o se disuelven; bisagras que suben.
 * - Posibles bucles: conceptos cuya intermediación crece sin que crezca su grupo (vuelve sobre lo mismo desde todos lados).
 *   Es una señal para mirar, no un diagnóstico.
 * - Alias y duplicados: palabras o entidades que se usan igual (vecindarios casi iguales en el grafo) y se escriben
 *   parecido. Las palabras van al diccionario («unificar»); las entidades, al «Es esa / Es otra» de siempre.
 * Todo sin modelo: solo las fotos.
 */
import { json, type Db } from '../db.ts'
import { UMBRALES, type Estado } from './medidas.ts'
import { diffFotos } from './leer.ts'
import { diccionario, leerFoto, ultimaFoto, type Foto } from './index.ts'
import { lemas } from './texto.ts'
import type { Metricas } from './calcular.ts'

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
const DIA = 86_400_000

/** La semana ISO de una fecha («2026-W43»), en su zona. */
function semanaDe(ms: number): string {
  const d = new Date(ms)
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3)
  const primero = new Date(t.getFullYear(), 0, 4)
  const n = 1 + Math.round(((t.getTime() - primero.getTime()) / DIA - 3 + ((primero.getDay() + 6) % 7)) / 7)
  return `${t.getFullYear()}-W${String(n).padStart(2, '0')}`
}

type Bisagra = { lema: string; forma: string; btw: number; grupo: number }
type Semana = { semana: string; metricas: Metricas; bisagras: Bisagra[]; grupos: { top: string[]; tam: number }[]; en: number }

/** Después de cada foto: la semana queda (la última foto de la semana manda). */
export function anotarSemana(db: Db, grafoId: number, f: Foto, ahora = Date.now()) {
  const tam = new Map(f.comunidades.map((c) => [c.id, c.tam]))
  const bisagras: Bisagra[] = f.nodos.filter((n) => !n.vos).sort((a, b) => b.btw - a.btw).slice(0, 40).map((n) => ({ lema: n.lema, forma: n.forma, btw: n.btw, grupo: tam.get(n.com) ?? 0 }))
  const grupos = f.comunidades.filter((c) => c.tam >= 3).sort((a, b) => b.tam - a.tam).slice(0, 15).map((c) => ({ top: c.top.slice(0, 5), tam: c.tam }))
  db.prepare(`INSERT INTO grafo_semanas (grafo_id, semana, metricas, bisagras, grupos, en) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(grafo_id, semana) DO UPDATE SET metricas = excluded.metricas, bisagras = excluded.bisagras, grupos = excluded.grupos, en = excluded.en`)
    .run(grafoId, semanaDe(ahora), JSON.stringify(f.metricas), JSON.stringify(bisagras), JSON.stringify(grupos), ahora)
}

export const semanas = (db: Db, grafoId: number, max = 26): Semana[] => (db.prepare('SELECT * FROM grafo_semanas WHERE grafo_id = ? ORDER BY semana DESC LIMIT ?').all(grafoId, max) as any[])
  .map((r) => ({ semana: r.semana, metricas: json<Metricas>(r.metricas, null as any), bisagras: json<Bisagra[]>(r.bisagras, []) ?? [], grupos: json(r.grupos, []) ?? [], en: r.en }))

/** Con cuántas semanas su rango ya dice algo suyo. */
export const SEMANAS_PARA_CALIBRAR = 4

/** Su rango habitual de cada medida y su estado más frecuente (null hasta tener semanas suficientes). */
export function calibracion(ss: Semana[]) {
  if (ss.length < SEMANAS_PARA_CALIBRAR) return null
  const rango = (k: 'M' | 'C1' | 'C2' | 'E') => {
    const xs = ss.map((s) => s.metricas[k])
    return { min: Math.min(...xs), max: Math.max(...xs), media: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) }
  }
  const cuenta = new Map<Estado, number>()
  for (const s of ss) cuenta.set(s.metricas.estado, (cuenta.get(s.metricas.estado) ?? 0) + 1)
  return { semanas: ss.length, M: rango('M'), C1: rango('C1'), C2: rango('C2'), E: rango('E'), habitual: [...cuenta].sort((a, b) => b[1] - a[1])[0][0] }
}

/**
 * Posibles bucles: entre la semana más vieja de la ventana (hasta 5 atrás) y la última, conceptos cuya intermediación
 * creció al menos 1,5 veces mientras su grupo no creció (≤ 10 %).
 */
export function bucles(ss: Semana[], ventana = 5): { forma: string; antes: number; ahora: number; grupo: number }[] {
  if (ss.length < 2) return []
  const ahora = ss[0], antes = ss[Math.min(ss.length - 1, ventana)]
  const previa = new Map(antes.bisagras.map((b) => [b.lema, b]))
  return ahora.bisagras.flatMap((b) => {
    const p = previa.get(b.lema)
    return p && p.btw > 0 && b.btw >= p.btw * 1.5 && b.grupo <= p.grupo * 1.1 ? [{ forma: b.forma, antes: p.btw, ahora: b.btw, grupo: b.grupo }] : []
  }).slice(0, 8)
}

/** La foto contra la que se compara la semana: la más nueva que tenga al menos 6 días menos (o la más vieja que haya). */
function fotoDeAntes(db: Db, grafoId: number, f: Foto): Foto | null {
  const r = (db.prepare('SELECT id FROM grafo_fotos WHERE grafo_id = ? AND id != ? AND en <= ? ORDER BY en DESC LIMIT 1').get(grafoId, f.id, f.en - 6 * DIA)
    ?? db.prepare('SELECT id FROM grafo_fotos WHERE grafo_id = ? AND id != ? ORDER BY en ASC LIMIT 1').get(grafoId, f.id)) as { id: number } | undefined
  return r ? leerFoto(db, r.id) : null
}

// ─── alias y duplicados ─────────────────────────────────────────────────

function levenshtein(a: string, b: string, tope = 3): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/**
 * ¿Se escriben como para ser lo mismo? Una empieza como la otra («sponsor/sponsors», «línea/líneas», que la raíz no
 * junta), o difieren en una letra (dos, si son largas: «servicios/services»). Más que eso junta «mundo» con «fondo».
 */
export function escrituraCompatible(a: string, b: string): boolean {
  const x = plano(a), y = plano(b)
  if (x === y || x.length < 3 || y.length < 3) return false
  const [c, l] = x.length <= y.length ? [x, y] : [y, x]
  if (c.length >= 4 && l.startsWith(c)) return true
  const d = levenshtein(x, y, 2)
  return (c.length >= 5 && d <= 1) || (c.length >= 8 && d <= 2)
}

/** Los vecinos de cada nodo (sin «Vos»). */
function vecinos(f: Foto): Set<number>[] {
  const v = f.nodos.map(() => new Set<number>())
  for (const [a, b] of f.aristas) if (!f.nodos[a]?.vos && !f.nodos[b]?.vos) { v[a].add(b); v[b].add(a) }
  return v
}
const jaccard = (x: Set<number>, y: Set<number>, sin: number[]) => {
  let i = 0, u = 0
  const todos = new Set([...x, ...y])
  for (const k of todos) { if (sin.includes(k)) continue; u++; if (x.has(k) && y.has(k)) i++ }
  return u ? i / u : 0
}
/** Calibrado con la base de prueba: cada nodo guarda hasta 12 aristas, así que dos grafías de lo mismo comparten entre 8 y 18 % de vecinos. */
export const UMBRAL_VECINDARIO = 0.08

/** Palabras que se usan igual y se escriben parecido: candidatas a alias del diccionario (las decide él). */
export function aliasSugeridos(db: Db, f: Foto, max = 10): { a: string; b: string; parecido: number }[] {
  const ya = new Set((db.prepare(`SELECT forma FROM grafo_diccionario WHERE tipo IN ('alias', 'stop')`).all() as { forma: string }[]).map((r) => r.forma))
  const v = vecinos(f)
  const ns = f.nodos.filter((n) => !n.vos && v[n.i].size >= 2 && !ya.has(plano(n.forma))).sort((a, b) => b.frec - a.frec).slice(0, 500)
  const out: { a: string; b: string; parecido: number }[] = []
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
    const a = ns[i], b = ns[j]
    if (!escrituraCompatible(a.forma, b.forma)) continue
    const p = jaccard(v[a.i], v[b.i], [a.i, b.i])
    if (p >= UMBRAL_VECINDARIO) out.push({ a: b.forma, b: a.forma, parecido: +p.toFixed(2) }) // a → b: la menos frecuente se une a la más
  }
  return out.sort((x, y) => y.parecido - x.parecido).slice(0, max)
}

/**
 * Pares de entidades que se usan igual en su grafo (vecindarios parecidos) y se escriben parecido: entran a
 * duplicadosProbables, al «Es esa / Es otra» de siempre (lo que él dice que no es, no vuelve).
 */
export function paresPorGrafo(db: Db): [number, number, string][] {
  const g = db.prepare(`SELECT id FROM grafos WHERE clave = 'voz'`).get() as { id: number } | undefined
  const f = g ? ultimaFoto(db, g.id) : null
  if (!f) return []
  const porLema = new Map(f.nodos.filter((n) => !n.vos).map((n) => [n.lema, n]))
  const dic = diccionario(db)
  const es = (db.prepare('SELECT id, nombre FROM entidades').all() as { id: number; nombre: string }[]).flatMap((e) => {
    const ls = lemas(e.nombre, dic)
    const n = ls.length === 1 ? porLema.get(ls[0]) : undefined
    return n ? [{ ...e, n }] : []
  })
  const v = vecinos(f)
  const out: [number, number, string][] = []
  for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
    const a = es[i], b = es[j]
    if (a.n.i === b.n.i || !escrituraCompatible(a.nombre, b.nombre)) continue
    if (jaccard(v[a.n.i], v[b.n.i], [a.n.i, b.n.i]) >= UMBRAL_VECINDARIO) out.push([a.id, b.id, 'se usan igual en su grafo'])
  }
  return out.slice(0, 40)
}

// ─── el panel y el aviso ────────────────────────────────────────────────

export function saludDe(db: Db, grafoId: number) {
  const f = ultimaFoto(db, grafoId)
  const ss = semanas(db, grafoId)
  const antes = f ? fotoDeAntes(db, grafoId, f) : null
  const d = f && antes ? diffFotos(antes, f) : null
  return {
    estado: f?.metricas.estado ?? null, metricas: f?.metricas ?? null, umbrales: UMBRALES,
    calibracion: calibracion(ss), semanasParaCalibrar: SEMANAS_PARA_CALIBRAR,
    semanas: ss.map((s) => ({ semana: s.semana, metricas: s.metricas })),
    cambios: d ? { desde: d.desde, nacieron: d.nacieron.map((x) => x.top), crecen: d.crecen, achican: d.achican, juntaron: d.juntaron, partieron: d.partieron, disueltos: d.murieron.map((x) => x.top), bisagrasSuben: d.bisagrasSuben, nuevos: d.nuevos } : null,
    bucles: bucles(ss),
    alias: f ? aliasSugeridos(db, f) : [],
  }
}

/** El domingo, en Hoy: lo que cambió en su voz. Nada si no hay contra qué comparar o si no cambió nada que valga decir. */
export function avisoSemanal(db: Db, _ahora = Date.now()): string | null {
  const g = db.prepare(`SELECT id FROM grafos WHERE clave = 'voz'`).get() as { id: number } | undefined
  if (!g) return null
  const s = saludDe(db, g.id)
  if (!s.cambios || !s.metricas) return null
  const c = s.cambios
  const grupo = (ts: string[]) => `«${ts.slice(0, 3).join(', ')}»`
  const partes = [
    c.nacieron.length ? `${c.nacieron.length === 1 ? 'nació el grupo' : 'nacieron los grupos'} ${c.nacieron.slice(0, 2).map(grupo).join(' y ')}` : '',
    c.crecen.length ? `creció ${c.crecen.slice(0, 2).map((x) => `${grupo(x.top)} (${x.antes} → ${x.ahora})`).join(' y ')}` : '',
    c.juntaron.length ? `se juntaron ${c.juntaron[0].eran.slice(0, 2).map(grupo).join(' con ')}` : '',
    c.disueltos.length ? `se disolvió ${grupo(c.disueltos[0])}` : '',
    c.bisagrasSuben.length ? `bisagras que suben: ${c.bisagrasSuben.slice(0, 3).join(', ')}` : '',
    s.bucles.length ? `posible bucle (crece sin que crezca su grupo): ${s.bucles.slice(0, 2).map((b) => b.forma).join(', ')}` : '',
  ].filter(Boolean)
  if (!partes.length) return null
  return `☍ **Tu grafo esta semana** (${s.estado}): ${partes.join('; ')}. Lo ves en Grafo → Salud.`
}
