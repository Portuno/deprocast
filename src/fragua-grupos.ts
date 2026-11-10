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
type Firma = { p: P; titulo: Set<string>; todo: Set<string>; causas: string[] }

const firma = (p: P): Firma => {
  const texto = `${p.titulo}\n${p.detalle.slice(0, 1500)}`
  return { p, titulo: palabras(p.titulo), todo: palabras(texto), causas: causasDe(texto) }
}
const jaccard = (a: Set<string>, b: Set<string>) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i ? i / (a.size + b.size - i) : 0 }

/** ¿Misma causa? Una causa conocida compartida, o mucho vocabulario en común (más en el título). */
export function mismaCausa(a: Firma, b: Firma): string | null {
  const c = a.causas.find((x) => b.causas.includes(x))
  if (c) return c
  const mismaArea = !!a.p.area && a.p.area === b.p.area
  const s = 0.6 * jaccard(a.titulo, b.titulo) + 0.4 * jaccard(a.todo, b.todo) + (mismaArea ? 0.05 : 0)
  return s >= 0.3 ? 'parecidas' : null
}

export type Grupo = { nombre: string; causa: string; principal: number; ids: number[] }

/** Las abiertas agrupadas (solo los grupos de dos o más). La principal: la de prioridad más alta, o la más vieja. */
export function gruposDePropuestas(db: Db): Grupo[] {
  const ps = db.prepare(`SELECT id, titulo, detalle, area, prioridad FROM propuestas WHERE estado = 'abierta' ORDER BY id`).all() as (P & { prioridad: string | null })[]
  const fs = ps.map(firma)
  const padre = fs.map((_, i) => i)
  const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])))
  const motivo = new Map<number, string>()
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
    const m = mismaCausa(fs[i], fs[j])
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
    // Sin causa conocida: el nombre son las palabras que comparten los títulos.
    const comunes = [...fs[xs[0]].titulo].filter((w) => xs.every((i) => fs[i].todo.has(w))).slice(0, 4)
    return { nombre: conocida?.nombre ?? (comunes.length ? `Lo mismo: ${comunes.join(', ')}` : 'Propuestas parecidas'), causa, principal: miembros[0].id, ids: miembros.map((m) => m.id) }
  })
}

/** Las abiertas con la misma causa que un texto nuevo (la mejor primero). */
export function abiertaParecida(db: Db, titulo: string, detalle: string, area?: string | null): { id: number; titulo: string; causa: string } | null {
  const nueva = firma({ id: 0, titulo, detalle, area: area ?? null })
  const ps = db.prepare(`SELECT id, titulo, detalle, area FROM propuestas WHERE estado = 'abierta' ORDER BY id DESC LIMIT 200`).all() as P[]
  for (const p of ps) {
    const m = mismaCausa(nueva, firma(p))
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
