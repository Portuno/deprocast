/**
 * Las propuestas de la Fragua agrupadas por causa raíz (Fragua #208). Varias son la misma enfermedad con dos nombres
 * (el abort del pedido que mata el trabajo de fondo, el N+1 de SQLite, el event loop clavado por trabajo síncrono):
 * forjarlas de a una es pagar varias veces el mismo arreglo. Entonces:
 * - se agrupan por causa: una causa conocida que citan (o el código de error), o el mismo vocabulario en la misma área;
 * - el grupo se muestra con un nombre y se forja una sola vez (las otras quedan cubiertas, con el rastro de cuál las
 *   absorbió), o se cierran a mano como cubiertas;
 * - una propuesta nueva que tiene la misma causa que una abierta no suma otra: se agrega a la que ya estaba.
 */
import type { Db } from './db.ts'

/** Causas que se repiten en el código de Deprocast: si dos propuestas citan la misma, son el mismo arreglo. */
export const CAUSAS: { id: string; nombre: string; re: RegExp }[] = [
  { id: 'abort', nombre: 'El corte del pedido mata el trabajo de fondo', re: /\babort|abortsignal|se cancela con el (pedido|request)|cuando se corta el (pedido|request)|request (cerrado|cancelado)/i },
  { id: 'n+1', nombre: 'Una consulta a SQLite por fila (N+1)', re: /\bn\s*\+\s*1\b|una consulta por (cada |)(fila|pieza|item|ítem|elemento)|consultas? en (un |el )?(bucle|loop)/i },
  { id: 'event-loop', nombre: 'Trabajo síncrono que clava el servidor', re: /event loop|bucle de eventos|traba(n)? el servidor|congela(miento)?s?\b|bloqueos? de \d+|trabajo s[ií]ncrono/i },
  { id: 'json', nombre: 'El modelo no devuelve el JSON pedido', re: /json inv[aá]lido|no parsea|parse_?fallo|json_invalido/i },
  { id: 'tiempo', nombre: 'Llamadas que no contestan a tiempo', re: /timeout|tiempo agotado|tiempo_agotado|\b504\b/i },
  { id: 'tokens', nombre: 'Se manda más contexto del que hace falta', re: /pieza entera|contexto entero|demasiados tokens|tokens? por llamada|recortar (la )?entrada/i },
  { id: 'credenciales', nombre: 'Credenciales de servicios externos', re: /nombre_ocupado|clave de agente|credencial(es)? (de|del) (agente|servicio)/i },
]

const VACIAS = new Set('para como cuando donde desde hasta pero porque sobre entre esto esta este esos esas todo toda todos todas cada otra otro otros otras hace hacer tiene tienen puede pueden queda quedan sigue mismo misma solo sola sino también tambien nada algo ahora antes después despues mientras según segun sería seria están estan está esta que qué los las del una uno unos unas con sin por más mas muy hay ser son fue era cambiar criterio hecho operador propuesta propuestas deprocast mastropiero fragua'.split(' '))

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export function palabras(texto: string): Set<string> {
  return new Set(norm(texto).split(/[^a-z0-9+]+/).filter((w) => w.length >= 4 && !VACIAS.has(w) && !/^\d+$/.test(w)))
}
/** Las causas que cita. Si cita tres o más, habla de causas en general (como esta misma propuesta): ninguna. */
export const causasDe = (texto: string) => { const cs = CAUSAS.filter((c) => c.re.test(texto)).map((c) => c.id); return cs.length > 2 ? [] : cs }

type P = { id: number; titulo: string; detalle: string; area: string | null }
type Firma = { p: P; titulo: Set<string>; todo: Set<string>; causas: string[]; propios: Set<string> }

/** Los nombres propios del título: palabras con mayúscula que no van al principio («El Benchmarkeador», «Los Logos»). */
const propiosDe = (titulo: string) => new Set(titulo.split(/[\s:,.;()«»"]+/).slice(1).filter((w) => /^\p{Lu}/u.test(w)).map((w) => norm(w)).filter((w) => w.length >= 5 && !VACIAS.has(w)))

const firma = (p: P): Firma => {
  const texto = `${p.titulo}\n${p.detalle.slice(0, 1500)}`
  return { p, titulo: palabras(p.titulo), todo: palabras(texto), causas: causasDe(texto), propios: propiosDe(p.titulo) }
}
const jaccard = (a: Set<string>, b: Set<string>) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i ? i / (a.size + b.size - i) : 0 }

/** Casi la misma palabra (una o dos letras de diferencia: «racializador» y «razalizador»), para nombres largos. */
function casiIgual(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length] <= 2
}

/**
 * El mismo nombre propio en los dos títulos: una palabra que casi no aparece en otros títulos («Benchmarkeador», «Los
 * Logos») o casi la misma palabra larga. Es la misma cosa pedida dos veces (una de sus anotaciones y otra del chat).
 */
function mismoNombre(a: Firma, b: Firma, raras: Set<string>): string | null {
  for (const w of a.propios) {
    if (raras.has(w) && b.propios.has(w)) return w
    if (w.length >= 9) for (const v of b.propios) if (v.length >= 9 && v !== w && casiIgual(w, v)) return w
  }
  return null
}

/** ¿Misma causa? Una causa conocida compartida, el mismo nombre propio, o mucho vocabulario en común (más en el título). */
export function mismaCausa(a: Firma, b: Firma, raras: Set<string> = new Set()): string | null {
  const c = a.causas.find((x) => b.causas.includes(x))
  if (c) return c
  const n = mismoNombre(a, b, raras)
  if (n) return `nombre:${n}`
  const mismaArea = !!a.p.area && a.p.area === b.p.area
  const s = 0.6 * jaccard(a.titulo, b.titulo) + 0.4 * jaccard(a.todo, b.todo) + (mismaArea ? 0.05 : 0)
  return s >= 0.3 ? 'parecidas' : null
}

export type Grupo = { nombre: string; causa: string; principal: number; ids: number[] }

/** Las palabras de los títulos que aparecen en dos títulos como mucho (un nombre propio, no vocabulario de todos). */
function rarasDe(fs: Firma[]): Set<string> {
  const df = new Map<string, number>()
  for (const f of fs) for (const w of f.propios) df.set(w, (df.get(w) ?? 0) + 1)
  return new Set([...df].filter(([, n]) => n <= 2).map(([w]) => w))
}

/** Las abiertas agrupadas (solo los grupos de dos o más). La principal: la de prioridad más alta, o la más vieja. */
export function gruposDePropuestas(db: Db): Grupo[] {
  const ps = db.prepare(`SELECT id, titulo, detalle, area, prioridad FROM propuestas WHERE estado = 'abierta' ORDER BY id`).all() as (P & { prioridad: string | null })[]
  const fs = ps.map(firma)
  const raras = rarasDe(fs)
  const padre = fs.map((_, i) => i)
  const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])))
  const motivo = new Map<number, string>()
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
    const m = mismaCausa(fs[i], fs[j], raras)
    if (!m) continue
    const a = raiz(i), b = raiz(j)
    if (a !== b) padre[b] = a
    if (m !== 'parecidas' || !motivo.has(raiz(i))) motivo.set(raiz(i), m)
  }
  const grupos = new Map<number, number[]>()
  fs.forEach((_, i) => { const r = raiz(i); grupos.set(r, [...(grupos.get(r) ?? []), i]) })
  const peso = (x: string | null) => (x === 'alta' ? 0 : x === 'media' ? 1 : 2)
  return [...grupos].filter(([, xs]) => xs.length >= 2).map(([r, xs]) => {
    const miembros = xs.map((i) => ps[i]).sort((a, b) => peso(a.prioridad) - peso(b.prioridad) || a.id - b.id)
    const causa = [...xs.map((i) => motivo.get(i)).filter(Boolean), motivo.get(r)].find((m) => m && m !== 'parecidas') ?? 'parecidas'
    const conocida = CAUSAS.find((c) => c.id === causa)
    if (causa.startsWith('nombre:')) {
      const titulo = ps[xs[0]].titulo
      return { nombre: `Lo mismo pedido dos veces: ${titulo.split(/[:.(]/)[0].trim().slice(0, 60)}`, causa, principal: miembros[0].id, ids: miembros.map((m) => m.id) }
    }
    // Sin causa conocida: el nombre son las palabras que comparten los títulos.
    const comunes = [...fs[xs[0]].titulo].filter((w) => xs.every((i) => fs[i].todo.has(w))).slice(0, 4)
    return { nombre: conocida?.nombre ?? (comunes.length ? `Lo mismo: ${comunes.join(', ')}` : 'Propuestas parecidas'), causa, principal: miembros[0].id, ids: miembros.map((m) => m.id) }
  })
}

/** Las abiertas con la misma causa que un texto nuevo (la mejor primero). */
export function abiertaParecida(db: Db, titulo: string, detalle: string, area?: string | null): { id: number; titulo: string; causa: string } | null {
  const nueva = firma({ id: 0, titulo, detalle, area: area ?? null })
  const ps = db.prepare(`SELECT id, titulo, detalle, area FROM propuestas WHERE estado = 'abierta' ORDER BY id DESC LIMIT 200`).all() as P[]
  const fs = ps.map(firma)
  const raras = rarasDe([...fs, nueva])
  for (const [k, p] of ps.entries()) {
    const m = mismaCausa(nueva, fs[k], raras)
    if (m) return { id: p.id, titulo: p.titulo, causa: CAUSAS.find((c) => c.id === m)?.nombre ?? 'el mismo problema' }
  }
  return null
}

/** Suma lo nuevo a la propuesta que ya estaba (en vez de abrir otra con la misma causa). */
export function sumarAPropuesta(db: Db, id: number, titulo: string, detalle: string, ahora = Date.now()) {
  const fecha = new Date(ahora).toISOString().slice(0, 10)
  db.prepare(`UPDATE propuestas SET detalle = detalle || ? WHERE id = ?`).run(`\n\nSUMADO EL ${fecha} (misma causa): ${titulo}. ${detalle.slice(0, 2000)}`, id)
}

/** Cerrar las otras del grupo como cubiertas por la principal (cuando el arreglo común ya está). */
export function cubrirCon(db: Db, principal: number, ids: number[], ahora = Date.now()) {
  const hechas: number[] = []
  for (const id of ids) {
    if (id === principal) continue
    const r = db.prepare(`UPDATE propuestas SET estado = 'aceptada', resuelta_en = ?, cerrada_por = 'grupo', cubierta_por = ? WHERE id = ? AND estado = 'abierta'`).run(ahora, principal, id)
    if (Number(r.changes)) hechas.push(id)
  }
  return { principal, cubiertas: hechas }
}
