/**
 * Arranque al 20 % y libro de evidencia: dos ideas de cómo se sostiene un cambio.
 * - Nadie arranca de cero: al crear una primaria, un aprendizaje o una meta, se busca en su corpus lo que ya hizo hacia
 *   eso («Ya empezaste: …», hasta 3) y cuenta como avance inicial (la señal «previo»). Un progreso que ya empezó se termina
 *   más que uno en cero.
 * - La identidad se vota con hechos: él elige 1 a 3 frases («soy alguien que termina lo que empieza») con su historia
 *   vieja, y las ata a primarias, hábitos, aprendizajes, categorías o palabras. Cada banda, hábito, misión o práctica que
 *   cae ahí es una línea de evidencia con su fecha (se cuentan solas; lo demás lo anota él). En Jugador: «23 evidencias en
 *   30 días» contra la historia vieja; el domingo, una pregunta para mirarlo.
 */
import { fechaLocal, json, type Db } from './db.ts'
import { buscarHibrido } from './semantica.ts'
import { encolarPregunta } from './preguntas.ts'

const DIA = 86_400_000
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
const VACIAS = new Set(['sobre', 'para', 'desde', 'hasta', 'entre', 'todos', 'todas', 'cosas', 'hacer', 'tengo', 'quiero', 'semana', 'porque', 'cuando', 'donde', 'tambien', 'mucho', 'mucha', 'otros', 'otras', 'estar', 'tener'])
const palabrasDe = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length >= 5 && !VACIAS.has(w)))

// ─── arranque al 20 % ───────────────────────────────────────────────────

export type Previo = { piezaId: number; titulo: string; fecha: string | null; fragmento: string }

/**
 * Lo que ya hizo hacia algo nuevo: piezas suyas (su voz) que hablan de eso. Con vectores, por sentido; sin vectores, solo
 * lo que comparte al menos dos palabras de peso (mejor nada que algo que no tiene que ver). Se guarda (hasta 3).
 */
export async function buscarPrevios(db: Db, tipo: 'mision' | 'aprendizaje' | 'meta', refId: number, texto: string, ahora = Date.now()): Promise<Previo[]> {
  const consulta = texto.trim().slice(0, 300)
  if (consulta.length < 6) return []
  let hallados: Awaited<ReturnType<typeof buscarHibrido>> = []
  try { hallados = await buscarHibrido(db, consulta, 10, ['propia']) } catch { return [] }
  const porSentido = hallados.filter((p) => p.por?.includes('sentido'))
  const clave = palabrasDe(consulta)
  const elegidos = (porSentido.length ? porSentido : hallados.filter((p) => {
    const ps = palabrasDe(`${p.titulo} ${p.contenido.slice(0, 3000)}`)
    return [...clave].filter((w) => ps.has(w)).length >= Math.min(2, clave.size)
  })).slice(0, 3)
  const ins = db.prepare('INSERT OR IGNORE INTO previos (tipo, ref_id, pieza_id, titulo, fecha, fragmento, en) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const p of elegidos) {
    const fragmento = (p.fragmento ?? p.contenido).replace(/\s+/g, ' ').trim().slice(0, 240)
    ins.run(tipo, refId, p.id, p.titulo.slice(0, 200), p.fecha ? String(p.fecha).slice(0, 10) : null, fragmento, ahora)
  }
  db.prepare('INSERT OR REPLACE INTO previos_buscados (tipo, ref_id, en) VALUES (?, ?, ?)').run(tipo, refId, ahora)
  return previosDe(db, tipo, refId)
}

/**
 * Lo nuevo de las últimas dos semanas que todavía no buscó lo previo: primarias (y la principal), aprendizajes y metas.
 * De a pocos por vuelta (lo llama el latido). Devuelve cuántos buscó.
 */
export async function buscarPreviosPendientes(db: Db, o: { limite?: number; ahora?: number } = {}): Promise<number> {
  const ahora = o.ahora ?? Date.now()
  const desde = ahora - 14 * DIA
  const sin = (tipo: string) => `NOT EXISTS (SELECT 1 FROM previos_buscados b WHERE b.tipo = '${tipo}' AND b.ref_id = x.id)`
  const xs = [
    ...(db.prepare(`SELECT 'mision' AS tipo, x.id, x.titulo || COALESCE('. ' || x.detalle, '') AS texto FROM misiones x WHERE x.personaje = 'jugador' AND x.nivel IN ('primaria', 'principal') AND x.estado IN ('activa', 'sugerida') AND x.creada_en > ? AND ${sin('mision')}`).all(desde) as any[]),
    ...(db.prepare(`SELECT 'aprendizaje' AS tipo, x.id, x.tema || COALESCE('. ' || x.por_que, '') AS texto FROM aprendizajes x WHERE x.creado_en > ? AND ${sin('aprendizaje')}`).all(desde) as any[]),
    ...(db.prepare(`SELECT 'meta' AS tipo, x.id, x.texto FROM memoria x WHERE x.tipo = 'meta' AND x.estado = 'vigente' AND x.creada_en > ? AND ${sin('meta')}`).all(desde) as any[]),
  ].slice(0, o.limite ?? 3)
  for (const x of xs) await buscarPrevios(db, x.tipo, x.id, x.texto, ahora)
  return xs.length
}

export function previosDe(db: Db, tipo: string, refId: number): Previo[] {
  return (db.prepare('SELECT pieza_id, titulo, fecha, fragmento FROM previos WHERE tipo = ? AND ref_id = ? ORDER BY fecha DESC').all(tipo, refId) as any[])
    .map((r) => ({ piezaId: r.pieza_id, titulo: r.titulo, fecha: r.fecha, fragmento: r.fragmento }))
}

export const textoYaEmpezaste = (ps: Previo[]) => ps.length ? `Ya empezaste: ${ps.map((p) => `«${p.titulo}»${p.fecha ? ` (${p.fecha})` : ''}`).join(', ')}.` : ''

// ─── identidades ────────────────────────────────────────────────────────

export type Ataduras = { primarias: number[]; habitos: string[]; aprendizajes: number[]; categorias: string[]; palabras: string[] }
export type Identidad = { id: number; frase: string; historiaVieja: string | null; ataduras: Ataduras; estado: string; creadaEn: number }
export type Evidencia = { tipo: 'banda' | 'mision' | 'habito' | 'practica' | 'anotada'; texto: string; fecha: string }

const limpiarAtaduras = (a: any): Ataduras => ({
  primarias: [...new Set<number>((Array.isArray(a?.primarias) ? a.primarias : []).map(Number).filter((n: number) => n > 0))],
  habitos: [...new Set<string>((Array.isArray(a?.habitos) ? a.habitos : []).map(String).filter(Boolean))],
  aprendizajes: [...new Set<number>((Array.isArray(a?.aprendizajes) ? a.aprendizajes : []).map(Number).filter((n: number) => n > 0))],
  categorias: [...new Set<string>((Array.isArray(a?.categorias) ? a.categorias : String(a?.categorias ?? '').split(',')).map((x: unknown) => norm(String(x))).filter(Boolean))],
  palabras: [...new Set<string>((Array.isArray(a?.palabras) ? a.palabras : String(a?.palabras ?? '').split(',')).map((x: unknown) => norm(String(x))).filter((x: string) => x.length >= 3))],
})
const deFila = (r: any): Identidad => ({ id: r.id, frase: r.frase, historiaVieja: r.historia_vieja, ataduras: limpiarAtaduras(json<any>(r.ataduras, {})), estado: r.estado, creadaEn: r.creada_en })

export function leerIdentidad(db: Db, id: number): Identidad | null {
  const r = db.prepare('SELECT * FROM identidades WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

export function crearIdentidad(db: Db, x: { frase: string; historiaVieja?: string | null; ataduras?: Partial<Ataduras> }, ahora = Date.now()): Identidad {
  const frase = String(x.frase ?? '').trim().slice(0, 200)
  if (frase.length < 8) throw new Error('Una frase de identidad, como «Soy alguien que termina lo que empieza»')
  const activas = (db.prepare(`SELECT COUNT(*) AS n FROM identidades WHERE estado = 'activa'`).get() as { n: number }).n
  if (activas >= 3) throw new Error('Hasta tres identidades a la vez: archivá una antes de sumar otra')
  const id = Number(db.prepare('INSERT INTO identidades (frase, historia_vieja, ataduras, creada_en) VALUES (?, ?, ?, ?)')
    .run(frase, x.historiaVieja?.trim().slice(0, 400) || null, JSON.stringify(limpiarAtaduras(x.ataduras ?? {})), ahora).lastInsertRowid)
  return leerIdentidad(db, id)!
}

export function editarIdentidad(db: Db, id: number, c: { frase?: string; historiaVieja?: string | null; ataduras?: Partial<Ataduras>; estado?: 'activa' | 'archivada' }): Identidad {
  const i = leerIdentidad(db, id)
  if (!i) throw new Error(`No existe la identidad ${id}`)
  if (c.frase !== undefined && c.frase.trim().length >= 8) db.prepare('UPDATE identidades SET frase = ? WHERE id = ?').run(c.frase.trim().slice(0, 200), id)
  if (c.historiaVieja !== undefined) db.prepare('UPDATE identidades SET historia_vieja = ? WHERE id = ?').run(c.historiaVieja?.trim().slice(0, 400) || null, id)
  if (c.ataduras) db.prepare('UPDATE identidades SET ataduras = ? WHERE id = ?').run(JSON.stringify(limpiarAtaduras({ ...i.ataduras, ...c.ataduras })), id)
  if (c.estado === 'activa' || c.estado === 'archivada') db.prepare('UPDATE identidades SET estado = ? WHERE id = ?').run(c.estado, id)
  return leerIdentidad(db, id)!
}

export function anotarEvidencia(db: Db, id: number, texto: string, fecha?: string | null, ahora = Date.now()) {
  if (!leerIdentidad(db, id)) throw new Error(`No existe la identidad ${id}`)
  const t = String(texto ?? '').trim().slice(0, 300)
  if (!t) throw new Error('¿Qué hiciste?')
  db.prepare('INSERT INTO evidencias (identidad_id, texto, fecha, en) VALUES (?, ?, ?, ?)').run(id, t, fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : fechaLocal(ahora), ahora)
}

/** La evidencia de una identidad desde una fecha: lo que se cuenta solo (bandas, misiones, hábitos, prácticas) y lo anotado. */
export function evidenciasDe(db: Db, i: Identidad, desde: string): Evidencia[] {
  const a = i.ataduras
  const out: Evidencia[] = []
  const t0 = new Date(`${desde}T00:00:00`).getTime()
  const toca = (titulo: string, categoria: string | null, padre: number | null) =>
    (padre != null && a.primarias.includes(padre)) || (!!categoria && a.categorias.includes(norm(categoria))) || a.palabras.some((p) => norm(titulo).includes(p))
  const ms = db.prepare(`SELECT id, nivel, titulo, categoria, padre_id, cerrada_en FROM misiones WHERE personaje = 'jugador' AND estado = 'hecha' AND cerrada_en >= ?`).all(t0) as any[]
  for (const m of ms) {
    if (m.nivel === 'secundaria' ? toca(m.titulo, m.categoria, m.padre_id) : a.primarias.includes(m.id) || toca(m.titulo, m.categoria, m.padre_id)) {
      out.push({ tipo: m.nivel === 'secundaria' ? 'banda' : 'mision', texto: m.titulo, fecha: fechaLocal(m.cerrada_en) })
    }
  }
  if (a.habitos.length) {
    const nombres = new Map((db.prepare('SELECT id, titulo FROM habitos').all() as { id: string; titulo: string }[]).map((h) => [h.id, h.titulo]))
    for (const d of db.prepare('SELECT fecha, habitos FROM plan_dias WHERE fecha >= ?').all(desde) as { fecha: string; habitos: string }[]) {
      const hs = json<Record<string, boolean>>(d.habitos, {}) ?? {}
      for (const h of a.habitos) if (hs[h]) out.push({ tipo: 'habito', texto: nombres.get(h) ?? h, fecha: d.fecha })
    }
  }
  if (a.aprendizajes.length) {
    const ps = db.prepare(`SELECT p.fecha, p.que, p.minutos, a.tema FROM practicas p JOIN aprendizajes a ON a.id = p.aprendizaje_id WHERE p.fecha >= ? AND p.aprendizaje_id IN (${a.aprendizajes.map(() => '?').join(',')})`).all(desde, ...a.aprendizajes) as any[]
    for (const p of ps) out.push({ tipo: 'practica', texto: `${p.tema}: ${p.que ?? 'práctica'}${p.minutos ? ` (${p.minutos} min)` : ''}`, fecha: p.fecha })
  }
  for (const e of db.prepare('SELECT texto, fecha FROM evidencias WHERE identidad_id = ? AND fecha >= ?').all(i.id, desde) as { texto: string; fecha: string }[]) out.push({ tipo: 'anotada', texto: e.texto, fecha: e.fecha })
  return out.sort((x, y) => y.fecha.localeCompare(x.fecha))
}

/** Para Jugador: cada identidad con su evidencia de 30 días, la de cada una de las últimas 4 semanas y las últimas líneas. */
export function libroDeEvidencia(db: Db, ahora = Date.now()) {
  const hoy = fechaLocal(ahora)
  const hace = (d: number) => fechaLocal(ahora - d * DIA)
  return (db.prepare(`SELECT * FROM identidades WHERE estado = 'activa' ORDER BY id`).all() as any[]).map(deFila).map((i) => {
    const ev = evidenciasDe(db, i, hace(29))
    const semanas = [3, 2, 1, 0].map((k) => ev.filter((e) => e.fecha > hace(7 * (k + 1)) && e.fecha <= hace(7 * k)).length)
    return { ...i, dias30: ev.length, semana: semanas[3], semanas, diasConEvidencia: new Set(ev.map((e) => e.fecha)).size, hoy: ev.filter((e) => e.fecha === hoy).length, ultimas: ev.slice(0, 8) }
  })
}

/** El domingo: una pregunta por identidad, la evidencia de la semana contra la historia vieja. */
export function preguntasDeEvidencia(db: Db, ahora = Date.now()): number {
  let n = 0
  for (const i of libroDeEvidencia(db, ahora)) {
    const texto = i.semana
      ? `Esta semana juntaste ${i.semana} ${i.semana === 1 ? 'evidencia' : 'evidencias'} de «${i.frase}»${i.historiaVieja ? `, contra tu historia vieja («${i.historiaVieja}»)` : ''}. ¿Qué te dice eso de quién estás siendo?`
      : `Esta semana no hubo evidencia de «${i.frase}». ¿Qué pasó, y cuál sería el voto más chico que podés hacer mañana?`
    if (encolarPregunta(db, { texto, porQue: 'La identidad se vota con hechos: mirarlos una vez por semana la sostiene.', tema: i.frase, origen: 'identidad' }, ahora)) n++
  }
  return n
}
