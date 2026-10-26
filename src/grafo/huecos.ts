/**
 * Los huecos estructurales y lo que se hace con ellos (plan v25). Un hueco es un par de grupos de ideas densos por dentro
 * y casi sin nada que los una (Burt: las ideas nuevas viven en los puentes). Son candidatos, no verdades: el filtro es él.
 * Cada hueco que aparece en una foto se sigue en el tiempo (¿se achicó?) y tiene tres salidas:
 * 1. Una pregunta para él (la escribe el modelo con pasajes de los dos lados): la responde y su respuesta entra como pieza
 *    propia y quántomo proto, que La Mano pesa. El grafo propone, él dispone.
 * 2. Un agente que investiga (en la nube): busca material que una los dos grupos y lo trae al corpus.
 * 3. Una idea para La Fragua o una búsqueda del Radar, si el hueco toca proyectos o el sistema.
 */
import { json, type Db } from '../db.ts'
import { pedirJson } from '../modelo.ts'
import { asegurarFuente, insertar } from '../corpus.ts'
import { crearQuantomo } from '../quantomos.ts'
import { fragmentos } from './leer.ts'
import { leerFoto, ultimaFoto, type Foto } from './index.ts'
import type { Hueco } from './calcular.ts'

export type HuecoSeguido = {
  id: number; grafoId: number; firma: string; terminosA: string[]; terminosB: string[]; bisagras: string[]; puntaje: number; puente: number
  estado: 'abierto' | 'en_curso' | 'cerrado' | 'descartado'; pregunta: string | null; porQue: string | null; puentes: string[]; tocaProyectos: boolean
  respuestaPieza: number | null; quantomoId: number | null; agente: { urls: string[]; en: number } | null; propuestaId: number | null
  historia: { en: number; puente: number | null }[]; creadoEn: number; actualizadoEn: number
}
const deFila = (r: any): HuecoSeguido => ({
  id: r.id, grafoId: r.grafo_id, firma: r.firma, terminosA: json(r.terminos_a, []) ?? [], terminosB: json(r.terminos_b, []) ?? [], bisagras: json(r.bisagras, []) ?? [], puntaje: r.puntaje, puente: r.puente,
  estado: r.estado, pregunta: r.pregunta, porQue: r.por_que, puentes: json(r.puentes, []) ?? [], tocaProyectos: !!r.toca_proyectos, respuestaPieza: r.respuesta_pieza, quantomoId: r.quantomo_id,
  agente: json(r.agente, null), propuestaId: r.propuesta_id, historia: json(r.historia, []) ?? [], creadoEn: r.creado_en, actualizadoEn: r.actualizado_en,
})
export const leerHueco = (db: Db, id: number) => { const r = db.prepare('SELECT * FROM grafo_huecos WHERE id = ?').get(id); return r ? deFila(r) : null }
export const huecosDe = (db: Db, grafoId: number) => (db.prepare(`SELECT * FROM grafo_huecos WHERE grafo_id = ? AND estado != 'descartado' ORDER BY estado = 'cerrado', puntaje DESC`).all(grafoId) as any[]).map(deFila)

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/** La huella de un hueco: los términos de los dos lados, ordenados (el mismo par de grupos, aunque cambien de número). */
const firmaDe = (h: Pick<Hueco, 'terminosA' | 'terminosB'>) => [h.terminosA.slice(0, 4).map(plano).sort().join(','), h.terminosB.slice(0, 4).map(plano).sort().join(',')].sort().join(' | ')

/** El puente actual entre dos grupos «parecidos» a los de un hueco: las comunidades de la foto que más términos comparten. */
function puenteActual(f: Foto, h: Pick<HuecoSeguido, 'terminosA' | 'terminosB'>): number | null {
  const comDe = (ts: string[]) => {
    const cuenta = new Map<number, number>()
    for (const t of ts) { const n = f.nodos.find((x) => plano(x.forma) === plano(t)); if (n && n.com >= 0) cuenta.set(n.com, (cuenta.get(n.com) ?? 0) + 1) }
    return [...cuenta].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }
  const a = comDe(h.terminosA), b = comDe(h.terminosB)
  if (a == null || b == null) return null
  if (a === b) return 1 // ya son el mismo grupo: el hueco se cerró
  return f.huecos.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))?.puente ?? 1
}

/**
 * Después de cada foto: los huecos nuevos entran a seguimiento; los que ya se seguían suman su puente a la historia, y si
 * el puente creció claro (se escribió algo que une los dos grupos), se marcan cerrados.
 */
export function sincronizarHuecos(db: Db, grafoId: number, fotoId: number, ahora = Date.now()): HuecoSeguido[] {
  const f = leerFoto(db, fotoId)
  if (!f) return []
  for (const h of f.huecos.slice(0, 8)) {
    const firma = firmaDe(h)
    db.prepare(`INSERT INTO grafo_huecos (grafo_id, firma, terminos_a, terminos_b, bisagras, puntaje, puente, estado, historia, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, 'abierto', '[]', ?, ?)
      ON CONFLICT(grafo_id, firma) DO UPDATE SET puntaje = excluded.puntaje, bisagras = excluded.bisagras, actualizado_en = excluded.actualizado_en`)
      .run(grafoId, firma, JSON.stringify(h.terminosA), JSON.stringify(h.terminosB), JSON.stringify(h.bisagras), h.puntaje, h.puente, ahora, ahora)
  }
  for (const h of huecosDe(db, grafoId).filter((x) => x.estado !== 'cerrado')) {
    const p = puenteActual(f, h)
    const historia = [...h.historia, { en: ahora, puente: p }].slice(-30)
    const cerro = p != null && (p >= 0.5 || p >= h.puente * 3 + 0.05) && h.historia.length > 0
    db.prepare(`UPDATE grafo_huecos SET historia = ?, estado = ?, actualizado_en = ? WHERE id = ?`).run(JSON.stringify(historia), cerro ? 'cerrado' : h.estado, ahora, h.id)
  }
  return huecosDe(db, grafoId)
}

// ─── las tres salidas ───────────────────────────────────────────────────

let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'grafo' }, sistema, usuario, { temperatura: 0.6, maxTokens: 1200 })).datos
let buscador = async (db: Db, q: string): Promise<{ titulo: string; url: string }[]> => (await import('../web.ts')).buscarWeb(db, q, { n: 5 })
let guardador = async (db: Db, url: string, nota: string) => (await import('../lector/index.ts')).guardarLink(db, url, { nota })
export function _probarHuecosGrafo(o: { modelo?: typeof modelo; buscador?: typeof buscador; guardador?: typeof guardador }) {
  if (o.modelo) modelo = o.modelo
  if (o.buscador) buscador = o.buscador
  if (o.guardador) guardador = o.guardador
}

const SISTEMA = `Sos Mastropiero mirando el grafo de su memoria. Te paso dos grupos de ideas suyas que están densos por dentro y casi no se tocan (un hueco estructural), con pasajes de cada lado. Las ideas nuevas viven en esos puentes.
- pregunta: UNA pregunta concreta, en voseo, que lo haga conectar los dos grupos (no genérica: con sus palabras y sus proyectos).
- por_que: una oración de por qué vale la pena unirlos (o decí honestamente si probablemente no tienen nada que decirse).
- puentes: 2 a 4 conceptos o ideas que podrían unirlos.
- toca_proyectos: true si el hueco toca proyectos, trabajo o el sistema (para mandarlo a La Fragua o al Radar).
- consultas: 2 o 3 búsquedas web que traerían material que una los dos lados.
Forma: {"pregunta": string, "por_que": string, "puentes": [string], "toca_proyectos": boolean, "consultas": [string]}`

/** La pregunta del hueco (con pasajes de los dos lados como contexto). Se guarda: no se vuelve a pedir. */
export async function preguntarHueco(db: Db, id: number, o: { forzar?: boolean } = {}): Promise<HuecoSeguido> {
  const h = leerHueco(db, id)
  if (!h) throw new Error('Ese hueco ya no está')
  if (h.pregunta && !o.forzar) return h
  const f = ultimaFoto(db, h.grafoId)
  const lado = (ts: string[]) => {
    if (!f) return ''
    const ns = ts.map((t) => f.nodos.find((n) => plano(n.forma) === plano(t))).filter(Boolean) as Foto['nodos']
    const fs = ns.length >= 2 ? fragmentos(db, h.grafoId, f.id, ns[0], ns[1], 3) : ns.length ? fragmentos(db, h.grafoId, f.id, ns[0], null, 3) : []
    return fs.map((x) => `- ${x.texto.replace(/[«»]/g, '').slice(0, 400)}`).join('\n')
  }
  const r = await modelo(db, SISTEMA, [
    `Grupo A: ${h.terminosA.join(', ')}\n${lado(h.terminosA)}`,
    `Grupo B: ${h.terminosB.join(', ')}\n${lado(h.terminosB)}`,
    h.bisagras.length ? `Hoy los une apenas: ${h.bisagras.join(', ')}` : 'Hoy nada los une.',
  ].join('\n\n'))
  const pregunta = String(r?.pregunta ?? '').trim().slice(0, 500)
  if (!pregunta) throw new Error('No salió la pregunta: probá de nuevo')
  db.prepare('UPDATE grafo_huecos SET pregunta = ?, por_que = ?, puentes = ?, toca_proyectos = ?, consultas = ?, actualizado_en = ? WHERE id = ?').run(
    pregunta, String(r?.por_que ?? '').slice(0, 500) || null, JSON.stringify((Array.isArray(r?.puentes) ? r.puentes : []).map(String).slice(0, 4)), r?.toca_proyectos ? 1 : 0,
    JSON.stringify((Array.isArray(r?.consultas) ? r.consultas : []).map(String).slice(0, 3)), Date.now(), id)
  return leerHueco(db, id)!
}

const FUENTE = { id: 'grafo', nombre: 'El grafo', nivel: 'propia' as const, descripcion: 'Sus respuestas a las preguntas de los huecos del grafo: las ideas que unen grupos que no se tocaban.' }

/** Su respuesta: pieza propia y quántomo proto (La Mano lo pesa). El hueco queda en curso hasta que la foto lo vea cerrarse. */
export function responderHueco(db: Db, id: number, texto: string, ahora = Date.now()): HuecoSeguido & { piezaId: number; quantomo: number | null } {
  const h = leerHueco(db, id)
  if (!h) throw new Error('Ese hueco ya no está')
  const t = texto.trim()
  if (t.length < 10) throw new Error('Contá un poco más: con tu respuesta se cierra el hueco')
  asegurarFuente(db, FUENTE)
  const titulo = `Puente: ${h.terminosA.slice(0, 3).join(', ')} ↔ ${h.terminosB.slice(0, 3).join(', ')}`
  const contenido = [`> ${h.pregunta ?? 'El hueco entre estos dos grupos'}`, t].join('\n\n')
  const piezaId = insertar(db, { fuente: FUENTE.id, nivel: 'propia', titulo, contenido, estado: 'disponible', origenId: `grafo:hueco:${id}:${ahora}`, etiquetas: ['grafo', 'hueco'], meta: { tipo: 'grafo_hueco', hueco: id } }, ahora)!
  const quantomo = crearQuantomo(db, { texto: t.slice(0, 2000), titulo, piezaId, etapa: 'proto', procedencia: 'grafo: un hueco', origenId: `grafo:hueco:${id}:${ahora}` }, ahora)
  db.prepare(`UPDATE grafo_huecos SET estado = 'en_curso', respuesta_pieza = ?, quantomo_id = ?, actualizado_en = ? WHERE id = ?`).run(piezaId, quantomo, ahora, id)
  return { ...leerHueco(db, id)!, piezaId, quantomo }
}

/** Un agente investiga (en la nube): busca material que una los dos grupos y lo guarda con la nota del hueco. Solo URLs que volvieron. */
export async function investigarHueco(db: Db, id: number, ahora = Date.now()): Promise<{ guardadas: string[]; aviso: string | null }> {
  let h = leerHueco(db, id)
  if (!h) throw new Error('Ese hueco ya no está')
  const { topeAlcanzado } = await import('../nan.ts')
  const tope = topeAlcanzado(db, ahora)
  if (tope) return { guardadas: [], aviso: tope }
  if (!h.pregunta) h = await preguntarHueco(db, id)
  const consultas = json<string[]>((db.prepare('SELECT consultas FROM grafo_huecos WHERE id = ?').get(id) as any).consultas, []) ?? []
  const qs = consultas.length ? consultas : [`${h.terminosA.slice(0, 2).join(' ')} ${h.terminosB.slice(0, 2).join(' ')}`]
  const nota = `Para el hueco del grafo: ${h.terminosA.slice(0, 3).join(', ')} ↔ ${h.terminosB.slice(0, 3).join(', ')}${h.pregunta ? ` — ${h.pregunta}` : ''}`
  const guardadas: string[] = []
  const vistas = new Set<string>()
  for (const q of qs.slice(0, 3)) {
    let rs: { titulo: string; url: string }[] = []
    try { rs = await buscador(db, q) } catch { /* un buscador caído no frena el resto */ }
    for (const r of rs.filter((x) => /^https?:\/\//.test(x.url) && !vistas.has(x.url)).slice(0, 2)) {
      vistas.add(r.url)
      try { const g = await guardador(db, r.url, nota); if (g.nueva) guardadas.push(r.url) } catch { /* una página que no se deja leer */ }
      if (guardadas.length >= 5) break
    }
  }
  db.prepare(`UPDATE grafo_huecos SET agente = ?, estado = CASE WHEN estado = 'abierto' THEN 'en_curso' ELSE estado END, actualizado_en = ? WHERE id = ?`).run(JSON.stringify({ urls: guardadas, en: ahora }), ahora, id)
  return { guardadas, aviso: vistas.size ? null : 'La búsqueda no trajo nada.' }
}

/** Una idea para La Fragua (si el hueco toca el sistema o sus proyectos): queda como propuesta abierta. */
export function aLaFragua(db: Db, id: number, ahora = Date.now()): { propuestaId: number } {
  const h = leerHueco(db, id)
  if (!h) throw new Error('Ese hueco ya no está')
  if (h.propuestaId) return { propuestaId: h.propuestaId }
  const titulo = `Unir ${h.terminosA.slice(0, 2).join(' y ')} con ${h.terminosB.slice(0, 2).join(' y ')}`
  const detalle = [`Un hueco de su grafo: dos grupos de ideas que casi no se tocan.`, `A: ${h.terminosA.join(', ')}`, `B: ${h.terminosB.join(', ')}`, h.pregunta ? `La pregunta: ${h.pregunta}` : '', h.puentes.length ? `Posibles puentes: ${h.puentes.join(', ')}` : ''].filter(Boolean).join('\n')
  const propuestaId = Number(db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, origen, creada_en) VALUES (?, ?, 'otro', 'media', 'abierta', 'grafo', ?)`).run(titulo.slice(0, 160), detalle, ahora).lastInsertRowid)
  db.prepare('UPDATE grafo_huecos SET propuesta_id = ?, actualizado_en = ? WHERE id = ?').run(propuestaId, ahora, id)
  return { propuestaId }
}

/** El Radar sale a buscar oportunidades con la pregunta del hueco (en la nube: gasta tokens). */
export async function alRadar(db: Db, id: number) {
  let h = leerHueco(db, id)
  if (!h) throw new Error('Ese hueco ya no está')
  if (!h.pregunta) h = await preguntarHueco(db, id)
  const r = await (await import('../radar.ts')).buscarOportunidades(db, { texto: `${h.pregunta} (une: ${h.terminosA.slice(0, 3).join(', ')} con ${h.terminosB.slice(0, 3).join(', ')})` })
  return { nuevas: r.nuevas.map((o) => o.titulo), aviso: r.aviso }
}

export function descartarHueco(db: Db, id: number) {
  db.prepare(`UPDATE grafo_huecos SET estado = 'descartado', actualizado_en = ? WHERE id = ?`).run(Date.now(), id)
  return { ok: true }
}

/** Para «Lo que te falta» y el chat: los huecos abiertos de su voz, en texto. */
export function huecosParaPrompt(db: Db, max = 5): string {
  const g = db.prepare(`SELECT id FROM grafos WHERE clave = 'voz'`).get() as { id: number } | undefined
  if (!g) return ''
  const hs = huecosDe(db, g.id).filter((h) => h.estado === 'abierto' || h.estado === 'en_curso').slice(0, max)
  return hs.length ? `Huecos estructurales de su grafo (grupos de ideas suyos que casi no se tocan):\n${hs.map((h) => `- [${h.terminosA.slice(0, 4).join(', ')}] ↔ [${h.terminosB.slice(0, 4).join(', ')}]${h.pregunta ? `: ${h.pregunta}` : ''}`).join('\n')}` : ''
}

