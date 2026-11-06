/**
 * La Criba del 72 (plan v36): el formato que reemplaza a La Mano. Una criba son 72 frases: 6 ejes × 6 pares × 2 polos
 * opuestos que no se notan como opuestos, mezcladas. Él las vota del 1 al 6 por instinto (con un ancla en cada punta),
 * y recién al final se ve la estructura: qué pares están partidos (|delta| ≥ 3), cuáles son tensiones vivas (los dos
 * polos ≥ 5) y cuáles zonas frías (los dos ≤ 3).
 *
 * De dónde salen: él importa las suyas (el formato de su artefacto «Criba Polar»), o Mastropiero arma una nueva a partir
 * de parámetros (el tema, para qué, las anclas) y de lo que ya sabe de él, incluidas las cribas que votó. Al leerla,
 * Mastropiero sigue el protocolo (sin diagnosticar: hipótesis con los ítems que las sostienen y una sola pregunta), lo
 * que aprende queda en su memoria, y puede armar la siguiente para profundizar donde hay tensión.
 *
 * Nada de esto está en el código: las cribas son datos suyos.
 */
import type { Db } from './db.ts'

export type Grupo = 'origen' | 'adentro' | 'afuera' | 'abajo' | 'tuyas'
export type Par = [eje: number, tension: string, a: number, b: number]
export type Criba = {
  id: number; clave: string | null; titulo: string; grupo: string; ilumina: string | null; consigna: string; a1: string; a6: string
  ejes: string[]; pares: Par[]; items: string[]; origen: 'importada' | 'mastropiero'; parametros: Record<string, unknown> | null; padreId: number | null; creada: number
}
export type Sesion = {
  id: number; cribaId: number; enMente: string | null; inicio: number | null; fin: number | null; estado: 'abierta' | 'cerrada' | 'archivada'
  votos: Record<string, number>; dudas: Record<string, boolean>; tiempos: Record<string, number>; siguiente: { tema: string; para: string | null } | null; lectura: string | null; lecturaEn: number | null; creada: number
}

export const N = 72

/** El modelo, inyectable (en los tests no se gasta). */
let modelo = async (db: Db, sistema: string, usuario: string, o: { temperatura: number; maxTokens: number }): Promise<any> =>
  (await (await import('./modelo.ts')).pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'criba72' }, sistema, usuario, { ...o, largo: true })).datos
export function _probarCriba72(fn: typeof modelo) { modelo = fn }
const json = <T>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) as T : d } catch { return d } }

const cribaDe = (r: any): Criba => ({
  id: r.id, clave: r.clave, titulo: r.titulo, grupo: r.grupo, ilumina: r.ilumina, consigna: r.consigna, a1: r.a1, a6: r.a6,
  ejes: json(r.ejes, []), pares: json(r.pares, []), items: json(r.items, []), origen: r.origen, parametros: json(r.parametros, null), padreId: r.padre_id, creada: r.creada,
})
const sesionDe = (r: any): Sesion => ({
  id: r.id, cribaId: r.criba_id, enMente: r.en_mente, inicio: r.inicio, fin: r.fin, estado: r.estado,
  votos: json(r.votos, {}), dudas: json(r.dudas, {}), tiempos: json(r.tiempos, {}), siguiente: json(r.siguiente, null), lectura: r.lectura, lecturaEn: r.lectura_en, creada: r.creada,
})

/** Que la forma sea la de una criba: 6 ejes, 36 pares, 72 frases, y cada frase en un solo par. */
export function validar(d: { ejes?: unknown; pares?: unknown; items?: unknown; titulo?: unknown; consigna?: unknown; a1?: unknown; a6?: unknown }): string | null {
  if (!String(d.titulo ?? '').trim()) return 'Falta el título'
  if (!String(d.consigna ?? '').trim()) return 'Falta la consigna'
  if (!String(d.a1 ?? '').trim() || !String(d.a6 ?? '').trim()) return 'Faltan las anclas del 1 y del 6'
  const ejes = d.ejes as unknown[]
  const pares = d.pares as unknown[]
  const items = d.items as unknown[]
  if (!Array.isArray(ejes) || ejes.length !== 6 || ejes.some((e) => !String(e ?? '').trim())) return 'Tienen que ser 6 ejes'
  if (!Array.isArray(items) || items.length !== N || items.some((t) => !String(t ?? '').trim())) return `Tienen que ser ${N} frases`
  if (!Array.isArray(pares) || pares.length !== 36) return 'Tienen que ser 36 pares'
  const usados = new Set<number>()
  const porEje = [0, 0, 0, 0, 0, 0]
  for (const p of pares) {
    if (!Array.isArray(p) || p.length !== 4) return 'Un par mal armado'
    const [eje, , a, b] = p as [number, string, number, number]
    if (!(eje >= 0 && eje < 6) || !(a >= 1 && a <= N) || !(b >= 1 && b <= N) || a === b) return 'Un par mal armado'
    if (usados.has(a) || usados.has(b)) return 'Una frase está en dos pares'
    usados.add(a); usados.add(b); porEje[eje]++
  }
  if (porEje.some((n) => n !== 6)) return 'Cada eje lleva 6 pares'
  return null
}

// ─── las cribas ─────────────────────────────────────────────────────────

/**
 * Importa cribas en el formato de su artefacto: [{id, titulo, grupo, ilumina, consigna, a1, a6, ejes, pares, items}] (o
 * {cribas: [...]}). La misma clave se actualiza (los votos ya hechos no se tocan si la forma no cambió).
 */
export function importarCribas(db: Db, entrada: unknown, ahora = Date.now()): { nuevas: number; actualizadas: number; errores: string[] } {
  const lista = Array.isArray(entrada) ? entrada : Array.isArray((entrada as any)?.cribas) ? (entrada as any).cribas : null
  if (!lista) throw new Error('No es una lista de cribas (esperaba [{titulo, consigna, a1, a6, ejes, pares, items}, …]).')
  const r = { nuevas: 0, actualizadas: 0, errores: [] as string[] }
  for (const c of lista) {
    const mal = validar(c)
    if (mal) { r.errores.push(`«${c?.titulo ?? c?.id ?? '?'}»: ${mal}`); continue }
    const clave = String(c.id ?? c.clave ?? '').trim() || null
    const fila = [String(c.titulo).trim(), String(c.grupo ?? 'tuyas').trim() || 'tuyas', c.ilumina ? String(c.ilumina) : null, String(c.consigna), String(c.a1), String(c.a6), JSON.stringify(c.ejes), JSON.stringify(c.pares), JSON.stringify(c.items)] as const
    const ya = clave ? (db.prepare('SELECT id FROM cribas72 WHERE clave = ?').get(clave) as { id: number } | undefined) : undefined
    if (ya) { db.prepare('UPDATE cribas72 SET titulo = ?, grupo = ?, ilumina = ?, consigna = ?, a1 = ?, a6 = ?, ejes = ?, pares = ?, items = ? WHERE id = ?').run(...fila, ya.id); r.actualizadas++ }
    else { db.prepare(`INSERT INTO cribas72 (clave, titulo, grupo, ilumina, consigna, a1, a6, ejes, pares, items, origen, creada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'importada', ?)`).run(clave, ...fila, ahora); r.nuevas++ }
  }
  return r
}

export function leerCriba(db: Db, id: number): Criba | null {
  const r = db.prepare('SELECT * FROM cribas72 WHERE id = ?').get(id)
  return r ? cribaDe(r) : null
}

/** La sesión vigente de una criba (la abierta, o la última cerrada), o null si nunca se votó. */
export function sesionVigente(db: Db, cribaId: number): Sesion | null {
  const r = db.prepare(`SELECT * FROM criba72_sesiones WHERE criba_id = ? AND estado != 'archivada' ORDER BY id DESC LIMIT 1`).get(cribaId)
  return r ? sesionDe(r) : null
}

export function listarCribas(db: Db) {
  return (db.prepare('SELECT * FROM cribas72 WHERE archivada = 0 ORDER BY grupo, id').all() as any[]).map((r) => {
    const c = cribaDe(r)
    const s = sesionVigente(db, c.id)
    const votadas = s ? Object.keys(s.votos).length : 0
    return { id: c.id, titulo: c.titulo, grupo: c.grupo, ilumina: c.ilumina, a1: c.a1, a6: c.a6, origen: c.origen, padreId: c.padreId, votadas, estado: s?.estado ?? null, conLectura: !!s?.lectura, actualizada: s ? Math.max(s.creada, ...Object.values(s.tiempos)) : c.creada }
  })
}

/** Empezar (o seguir) a votar: la sesión abierta, o una nueva. */
export function empezar(db: Db, cribaId: number, enMente?: string | null, ahora = Date.now()): Sesion {
  if (!leerCriba(db, cribaId)) throw new Error(`No existe la criba ${cribaId}`)
  const ya = db.prepare(`SELECT * FROM criba72_sesiones WHERE criba_id = ? AND estado = 'abierta' ORDER BY id DESC LIMIT 1`).get(cribaId)
  if (ya) {
    if (enMente !== undefined) db.prepare('UPDATE criba72_sesiones SET en_mente = ? WHERE id = ?').run(enMente?.trim().slice(0, 200) || null, (ya as any).id)
    return sesionDe(db.prepare('SELECT * FROM criba72_sesiones WHERE id = ?').get((ya as any).id))
  }
  const r = db.prepare(`INSERT INTO criba72_sesiones (criba_id, en_mente, estado, creada) VALUES (?, ?, 'abierta', ?)`).run(cribaId, enMente?.trim().slice(0, 200) || null, ahora)
  return sesionDe(db.prepare('SELECT * FROM criba72_sesiones WHERE id = ?').get(Number(r.lastInsertRowid)))
}

/** Un voto (1–6, o null para borrarlo) y la marca de duda. Con los 72 votados, la sesión se cierra. */
export function votar(db: Db, sesionId: number, n: number, voto: number | null, o: { duda?: boolean } = {}, ahora = Date.now()): Sesion {
  const r = db.prepare('SELECT * FROM criba72_sesiones WHERE id = ?').get(sesionId)
  if (!r) throw new Error(`No existe la sesión ${sesionId}`)
  const s = sesionDe(r)
  if (s.estado === 'archivada') throw new Error('Esa sesión está archivada')
  if (!(n >= 1 && n <= N)) throw new Error(`El número va de 1 a ${N}`)
  const k = String(n)
  if (voto == null) { delete s.votos[k]; delete s.tiempos[k] } else {
    if (!(voto >= 1 && voto <= 6)) throw new Error('El voto va de 1 a 6')
    s.votos[k] = Math.round(voto)
    s.tiempos[k] = ahora
  }
  if (o.duda !== undefined) { if (o.duda) s.dudas[k] = true; else delete s.dudas[k] }
  const completa = Object.keys(s.votos).length === N
  db.prepare('UPDATE criba72_sesiones SET votos = ?, dudas = ?, tiempos = ?, inicio = COALESCE(inicio, ?), fin = ?, estado = ? WHERE id = ?')
    .run(JSON.stringify(s.votos), JSON.stringify(s.dudas), JSON.stringify(s.tiempos), ahora, completa ? s.fin ?? ahora : null, completa ? 'cerrada' : 'abierta', sesionId)
  return sesionDe(db.prepare('SELECT * FROM criba72_sesiones WHERE id = ?').get(sesionId))
}

/** Reiniciar: la sesión vigente queda archivada (en el historial) y la criba vuelve a cero. */
export function reiniciar(db: Db, cribaId: number) {
  db.prepare(`UPDATE criba72_sesiones SET estado = 'archivada' WHERE criba_id = ? AND estado != 'archivada'`).run(cribaId)
  return { ok: true }
}

export function archivarCriba(db: Db, cribaId: number) {
  db.prepare('UPDATE cribas72 SET archivada = 1 WHERE id = ?').run(cribaId)
  return { ok: true }
}

// ─── la lectura de datos (sin interpretación) ───────────────────────────

export type ClasePar = 'partido' | 'tension' | 'fria' | 'templado'
/** Lo mismo que muestra su artefacto: la forma, cada par con su delta, carga y clase, y cada eje. */
export function metricas(c: Criba, s: Sesion | null) {
  const v = (n: number) => s?.votos[String(n)] ?? null
  const dist = [0, 0, 0, 0, 0, 0]
  let suma = 0
  let n = 0
  for (let i = 1; i <= N; i++) { const x = v(i); if (x) { dist[x - 1]++; suma += x; n++ } }
  const pares = c.pares.map(([eje, tension, a, b], pi) => {
    const va = v(a)
    const vb = v(b)
    let clase: ClasePar | null = null
    let delta: number | null = null
    let carga: number | null = null
    if (va && vb) { delta = va - vb; carga = va + vb; clase = Math.abs(delta) >= 3 ? 'partido' : va >= 5 && vb >= 5 ? 'tension' : va <= 3 && vb <= 3 ? 'fria' : 'templado' }
    return { id: `P${String(pi + 1).padStart(2, '0')}`, eje, tension, a, b, textoA: c.items[a - 1], textoB: c.items[b - 1], va, vb, delta, carga, clase }
  })
  const ejes = c.ejes.map((nombre, ei) => {
    const ps = pares.filter((p) => p.eje === ei)
    const vals = ps.flatMap((p) => [p.va, p.vb]).filter((x): x is number => !!x)
    return { id: `E${ei + 1}`, nombre, media: vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null, partido: ps.filter((p) => p.clase === 'partido').length, tension: ps.filter((p) => p.clase === 'tension').length, fria: ps.filter((p) => p.clase === 'fria').length }
  })
  return { dist, votadas: n, media: n ? suma / n : null, altos: dist[4] + dist[5], bajos: dist[0] + dist[1], pares, ejes, dudas: Object.keys(s?.dudas ?? {}).map(Number).sort((a, b) => a - b) }
}

export const PROTOCOLO = [
  'Protocolo de lectura · Criba del 72',
  'Los votos son de él; tu lectura va aparte y la marcás como tuya.',
  'Escala de 1 a 6, sin punto medio (las anclas, en la criba). Cada par tiene dos polos opuestos (A y B).',
  'delta = voto A − voto B. carga = voto A + voto B (de 2 a 12).',
  'Clases de par: partido (|delta| ≥ 3), tensión viva (ambos ≥ 5), zona fría (ambos ≤ 3), templado (el resto).',
  '1. Forma: distribución, media, % en 5–6 y % en 1–2. ¿Hay sesgo?',
  '2. Extremos: los ítems con 1 y con 6.',
  '3. Pares: qué dicen los partidos, las tensiones vivas y las zonas frías.',
  '4. Ejes: resumen por eje.',
  '5. Hipótesis: como máximo 3, cada una citando los ítems (por número) que la sostienen.',
  '6. Cierre: una sola pregunta para él. No diagnostiques.',
].join('\n')

/** Para exportar o para el modelo: la criba, la sesión, cada voto y las métricas (el formato de su artefacto). */
export function exportarSesion(c: Criba, s: Sesion | null) {
  const m = metricas(c, s)
  const polo = new Map<number, { par: string; eje: string; polo: 'A' | 'B' }>()
  c.pares.forEach(([eje, , a, b], pi) => { const par = `P${String(pi + 1).padStart(2, '0')}`; polo.set(a, { par, eje: `E${eje + 1}`, polo: 'A' }); polo.set(b, { par, eje: `E${eje + 1}`, polo: 'B' }) })
  const iso = (t?: number | null) => (t ? new Date(t).toISOString() : null)
  return {
    criba: { id: c.id, titulo: c.titulo, consigna: c.consigna, escala: { min: 1, max: 6, ancla_1: c.a1, ancla_6: c.a6 }, ejes: c.ejes.map((n, i) => ({ id: `E${i + 1}`, nombre: n })), pares: m.pares.map((p) => ({ id: p.id, eje: `E${p.eje + 1}`, tension: p.tension, a: p.a, b: p.b })) },
    sesion: { en_mente: s?.enMente ?? null, inicio: iso(s?.inicio), fin: iso(s?.fin), votadas: m.votadas },
    votos: c.items.map((texto, i) => ({ n: i + 1, texto, ...polo.get(i + 1), voto: s?.votos[String(i + 1)] ?? null, duda: !!s?.dudas[String(i + 1)] })),
    metricas: {
      distribucion: Object.fromEntries(m.dist.map((x, i) => [i + 1, x])), media: m.media == null ? null : Math.round(m.media * 100) / 100,
      pct_5_6: m.votadas ? Math.round((m.altos / m.votadas) * 100) : null, pct_1_2: m.votadas ? Math.round((m.bajos / m.votadas) * 100) : null,
      pares: m.pares.map((p) => ({ par: p.id, voto_a: p.va, voto_b: p.vb, delta: p.delta, carga: p.carga, clase: p.clase })),
      ejes: m.ejes.map((e) => ({ eje: e.id, nombre: e.nombre, media: e.media == null ? null : Math.round(e.media * 100) / 100, partido: e.partido, tension_viva: e.tension, zona_fria: e.fria })),
    },
    lectura: s?.lectura ?? null,
  }
}

/** En texto para leer o pegar en otra IA (con el protocolo arriba). */
export function exportarTexto(c: Criba, s: Sesion | null, md = true): string {
  const m = metricas(c, s)
  const h = (t: string) => (md ? `## ${t}` : t.toUpperCase())
  const L: string[] = [md ? `# ${c.titulo}` : c.titulo.toUpperCase(), `Consigna: ${c.consigna}`, `Escala: 1 = ${c.a1} · 6 = ${c.a6}`, `Votadas: ${m.votadas} de ${N}${s?.enMente ? ` · En mente: ${s.enMente}` : ''}`, '', h('Protocolo'), PROTOCOLO, '', h('Votos')]
  c.items.forEach((t, i) => { const v = s?.votos[String(i + 1)]; L.push(`${String(i + 1).padStart(2, '0')}. [${v ?? '–'}]${s?.dudas[String(i + 1)] ? ' (duda)' : ''} ${t}`) })
  L.push('', h('Pares'))
  for (const e of m.ejes) {
    L.push(md ? `### ${e.nombre}` : `» ${e.nombre}`)
    for (const p of m.pares.filter((x) => x.eje === Number(e.id.slice(1)) - 1)) L.push(`- ${p.tension}: [${p.va ?? '–'}] ${p.textoA} ↔ [${p.vb ?? '–'}] ${p.textoB}${p.clase ? ` · ${{ partido: 'partido', tension: 'tensión viva', fria: 'zona fría', templado: 'templado' }[p.clase]}` : ''}`)
  }
  if (s?.lectura) L.push('', h('Lectura de Mastropiero'), s.lectura)
  return `${L.join('\n')}\n`
}

// ─── Mastropiero: armar una criba y leerla ──────────────────────────────

const SISTEMA_ARMAR = `Armás una CRIBA DEL 72 para él: 72 frases que va a votar del 1 al 6 por instinto, sin ver la estructura.
La estructura: 6 ejes (dimensiones del tema) × 6 pares por eje. Cada par es una TENSIÓN (un nombre corto, como «Visibilidad» o «Ahorro») con dos polos opuestos, A y B.
Las reglas de oro:
- Los dos polos de un par son opuestos de verdad, pero NO evidentes: nada de negar la frase («Me gusta X» / «No me gusta X»). Son dos maneras distintas de resolver la misma tensión, cada una con su atractivo y su sombra. Ejemplo bueno: «Habla todo el tiempo de sus logros» ↔ «Nunca muestra lo que consigue». «Busca ser el centro de atención» ↔ «Pasa desapercibido». «Planifica todo al detalle» ↔ «Improvisa todo».
- Cada frase se entiende sola, es concreta y cotidiana (una situación, una conducta, una frase que alguien dice), en castellano rioplatense, de 3 a 14 palabras. Nada de jerga psicológica ni de abstracciones.
- Votables con las anclas: cada frase tiene que poder votarse de 1 («ancla_1») a 6 («ancla_6») sin forzarla.
- Ninguna frase repetida ni casi igual a otra. Variá el registro entre ejes.
- Si el tema es suyo (un proyecto, una decisión, su trabajo), usá lo que se sabe de él para que las frases toquen SU realidad, sin nombrar datos privados que no hacen falta.
Forma: {"titulo": "Los 72 …" o "Las 72 …", "ilumina": una línea (qué ilumina), "consigna": cómo votar (una o dos frases, en segunda persona), "ancla_1": corto, "ancla_6": corto, "ejes": [6 nombres], "pares": [36 × {"eje": 0-5, "tension": "nombre corto", "a": "frase del polo A", "b": "frase del polo B"}]}`

/** Las mezcla para que los dos polos de un par no queden cerca (determinístico con la semilla). */
export function mezclar(pares: { eje: number; tension: string; a: string; b: string }[], semilla = 1): { items: string[]; pares: Par[] } {
  let x = (semilla >>> 0) || 1
  const azar = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296 }
  const orden = pares.flatMap((_, pi) => [{ pi, polo: 'a' as const }, { pi, polo: 'b' as const }])
  for (let i = orden.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [orden[i], orden[j]] = [orden[j], orden[i]] }
  // Los dos polos, a 8 lugares o más (que no se note el par al votar): se arreglan con intercambios hasta que ninguno quede cerca.
  const lejos = 8
  const otro = (i: number) => orden.findIndex((o, k) => k !== i && o.pi === orden[i].pi)
  const bien = (i: number) => Math.abs(i - otro(i)) >= lejos
  for (let vuelta = 0; vuelta < 5000; vuelta++) {
    const mal = orden.findIndex((_, i) => !bien(i))
    if (mal < 0) break
    const j = Math.floor(azar() * orden.length)
    ;[orden[mal], orden[j]] = [orden[j], orden[mal]]
    if (!bien(mal) || !bien(j)) [orden[mal], orden[j]] = [orden[j], orden[mal]]
  }
  const pos = new Map<string, number>(orden.map((o, i) => [`${o.pi}${o.polo}`, i]))
  return { items: orden.map((o) => pares[o.pi][o.polo]), pares: pares.map((p, pi) => [p.eje, p.tension, pos.get(`${pi}a`)! + 1, pos.get(`${pi}b`)! + 1]) }
}

/** Lo que dejaron las cribas que votó (para que la nueva no repita y apunte a lo vivo). */
export function resumenDeCribas(db: Db, limite = 4): string {
  const cs = listarCribas(db).filter((c) => c.votadas >= 36).sort((a, b) => b.actualizada - a.actualizada).slice(0, limite)
  return cs.map((x) => {
    const c = leerCriba(db, x.id)!
    const m = metricas(c, sesionVigente(db, c.id))
    const de = (cl: ClasePar) => m.pares.filter((p) => p.clase === cl).slice(0, 4).map((p) => `${p.tension} («${p.textoA}» ${p.va} ↔ «${p.textoB}» ${p.vb})`).join('; ')
    return `- «${c.titulo}» (${m.votadas}/72): partidos: ${de('partido') || '—'} · tensiones vivas: ${de('tension') || '—'} · zonas frías: ${de('fria') || '—'}`
  }).join('\n')
}

export type Parametros = { tema: string; para?: string | null; grupo?: string | null; ancla1?: string | null; ancla6?: string | null; enMente?: string | null; padreId?: number | null }

/** Mastropiero arma una criba nueva con esos parámetros (y lo que sabe de él). */
export async function armarCriba(db: Db, p: Parametros, ahora = Date.now()): Promise<Criba> {
  if (!p.tema?.trim()) throw new Error('¿Sobre qué? Falta el tema de la criba.')
  const { memoriaParaPrompt } = await import('./memoria.ts')
  const padre = p.padreId ? leerCriba(db, p.padreId) : null
  const padreTxt = padre ? (() => {
    const m = metricas(padre, sesionVigente(db, padre.id))
    const vivos = m.pares.filter((x) => x.clase === 'tension' || x.clase === 'partido').map((x) => `${x.tension} (${x.clase === 'tension' ? 'tensión viva' : 'partido'}: «${x.textoA}» ${x.va} ↔ «${x.textoB}» ${x.vb})`)
    return `Es para PROFUNDIZAR la criba «${padre.titulo}»: no repitas sus frases; abrí las tensiones vivas y los partidos que dejó:\n${vivos.slice(0, 14).join('\n') || '(todavía sin pares claros)'}${sesionVigente(db, padre.id)?.lectura ? `\nLo que leíste de esa criba:\n${sesionVigente(db, padre.id)!.lectura!.slice(0, 2500)}` : ''}`
  })() : ''
  const usuario = [
    `Tema: ${p.tema.trim()}`,
    p.para?.trim() ? `Para qué (qué tiene que iluminar): ${p.para.trim()}` : '',
    p.ancla1?.trim() || p.ancla6?.trim() ? `Anclas que pidió: 1 = «${p.ancla1?.trim() || '(proponela)'}» · 6 = «${p.ancla6?.trim() || '(proponela)'}»` : 'Anclas: proponelas (cortas, opuestas, que hagan votable cada frase).',
    p.enMente?.trim() ? `Lo que tiene en mente: ${p.enMente.trim()}` : '',
    padreTxt,
    `Lo que sabés de él:\n${memoriaParaPrompt(db, 30)}`,
    resumenDeCribas(db) ? `Lo que dejaron sus cribas anteriores (no repitas; apuntá a lo vivo):\n${resumenDeCribas(db)}` : '',
  ].filter(Boolean).join('\n\n')
  const datos = await modelo(db, SISTEMA_ARMAR, usuario, { temperatura: 0.8, maxTokens: 9000 })
  const crudos = (Array.isArray(datos?.pares) ? datos.pares : []).map((x: any) => ({ eje: Number(x?.eje), tension: String(x?.tension ?? '').trim().slice(0, 40), a: String(x?.a ?? '').trim().slice(0, 160), b: String(x?.b ?? '').trim().slice(0, 160) }))
    .filter((x: any) => x.eje >= 0 && x.eje < 6 && x.tension && x.a && x.b && x.a !== x.b)
  // 6 pares por eje (si sobran, los primeros); si falta alguno, no sirve.
  const pares = [0, 1, 2, 3, 4, 5].flatMap((e) => crudos.filter((x: any) => x.eje === e).slice(0, 6))
  const textos = new Set<string>()
  for (const x of pares) { textos.add(x.a.toLowerCase()); textos.add(x.b.toLowerCase()) }
  if (pares.length !== 36 || textos.size !== 72) throw new Error(`La criba no salió completa (${pares.length} de 36 pares, ${textos.size} frases distintas). Probá de nuevo.`)
  const { items, pares: ps } = mezclar(pares, ahora)
  const def = { titulo: String(datos.titulo ?? `Las 72 · ${p.tema}`).slice(0, 80), consigna: String(datos.consigna ?? '').slice(0, 400), a1: String(p.ancla1?.trim() || datos.ancla_1 || '').slice(0, 40), a6: String(p.ancla6?.trim() || datos.ancla_6 || '').slice(0, 40), ejes: (datos.ejes ?? []).slice(0, 6).map((e: unknown) => String(e).slice(0, 40)), pares: ps, items }
  const mal = validar(def)
  if (mal) throw new Error(`La criba no salió bien armada: ${mal}. Probá de nuevo.`)
  const r = db.prepare(`INSERT INTO cribas72 (clave, titulo, grupo, ilumina, consigna, a1, a6, ejes, pares, items, origen, parametros, padre_id, creada) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mastropiero', ?, ?, ?)`)
    .run(def.titulo, p.grupo?.trim() || 'tuyas', datos.ilumina ? String(datos.ilumina).slice(0, 200) : null, def.consigna, def.a1, def.a6, JSON.stringify(def.ejes), JSON.stringify(def.pares), JSON.stringify(def.items), JSON.stringify(p), p.padreId ?? null, ahora)
  return leerCriba(db, Number(r.lastInsertRowid))!
}

const SISTEMA_LEER = `Sos Mastropiero. Leés la CRIBA DEL 72 que él votó, siguiendo el protocolo al pie de la letra. Hablale a él, en segunda persona, castellano rioplatense, cálido y filoso. Separá lo que dicen los datos (con los números de los ítems) de tu lectura («mi lectura es…»). No diagnostiques ni etiquetes.
Forma: {"lectura": el texto (con los 6 pasos, breve: entre 250 y 450 palabras), "aprendizajes": [hasta 3 cosas de él que valga recordar, cada una como hecho prudente con su fuente («en la criba X votó…»)], "pregunta": la única pregunta del cierre, "siguiente": {"tema": una criba para profundizar donde hay tensión, "para": qué iluminaría}}`

/** Mastropiero la lee (con el protocolo): la lectura queda en la sesión, lo aprendido en su memoria (para revisar) y la pregunta en su cola. */
export async function leerConMastropiero(db: Db, cribaId: number, ahora = Date.now()) {
  const c = leerCriba(db, cribaId)
  const s = sesionVigente(db, cribaId)
  if (!c || !s) throw new Error('Todavía no votaste esta criba.')
  if (Object.keys(s.votos).length < 36) throw new Error('Votá al menos la mitad para que la lectura diga algo.')
  const r: { lectura?: string; aprendizajes?: string[]; pregunta?: string; siguiente?: { tema?: string; para?: string } } =
    (await modelo(db, `${SISTEMA_LEER}\n\n${PROTOCOLO}`, JSON.stringify(exportarSesion(c, s)), { temperatura: 0.5, maxTokens: 4000 })) ?? {}
  const lectura = String(r.lectura ?? '').trim()
  if (!lectura) throw new Error('No me salió la lectura: probá de nuevo.')
  const final = `${lectura}${r.pregunta ? `\n\n**Para vos:** ${String(r.pregunta).trim()}` : ''}`
  db.prepare('UPDATE criba72_sesiones SET lectura = ?, lectura_en = ? WHERE id = ?').run(final, ahora, s.id)
  // Lo que aprendió va a su memoria sin revisar (él confirma) y la pregunta a su cola de preguntas.
  const { recordar } = await import('./memoria.ts')
  for (const a of (r.aprendizajes ?? []).slice(0, 3)) { try { recordar(db, { texto: String(a).slice(0, 400), tipo: 'hecho', creadaPor: 'criba72', revisada: false }, ahora) } catch { /* uno que no entra no frena */ } }
  if (r.pregunta) { try { (await import('./preguntas.ts')).encolarPregunta(db, { texto: String(r.pregunta), porQue: `De tu criba «${c.titulo}»`, origen: 'criba72', tema: 'criba' }, ahora) } catch { /* ya estaba */ } }
  const siguiente = r.siguiente?.tema ? { tema: String(r.siguiente.tema).slice(0, 200), para: r.siguiente.para ? String(r.siguiente.para).slice(0, 300) : null } : null
  db.prepare('UPDATE criba72_sesiones SET siguiente = ? WHERE id = ?').run(siguiente ? JSON.stringify(siguiente) : null, s.id)
  return { lectura: final, siguiente, aprendizajes: r.aprendizajes ?? [] }
}

// ─── de fondo: armar y leer tardan (un modelo largo); la pantalla pregunta ──

const trabajos = new Map<string, { estado: 'andando' | 'listo' | 'error'; resultado?: unknown; error?: string; desde: number }>()
/** Arranca algo de fondo y devuelve su clave; `trabajo(clave)` dice cómo va. */
export function deFondo(clave: string, fn: () => Promise<unknown>, ahora = Date.now()): string {
  const ya = trabajos.get(clave)
  if (ya?.estado === 'andando' && ahora - ya.desde < 10 * 60_000) return clave
  for (const [k, t] of trabajos) if (ahora - t.desde > 60 * 60_000) trabajos.delete(k)
  trabajos.set(clave, { estado: 'andando', desde: ahora })
  fn().then((resultado) => trabajos.set(clave, { estado: 'listo', resultado, desde: ahora }))
    .catch((e) => trabajos.set(clave, { estado: 'error', error: e instanceof Error ? e.message : String(e), desde: ahora }))
  return clave
}
export const trabajo = (clave: string) => trabajos.get(clave) ?? null
