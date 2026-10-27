/**
 * El Observatorio (plan v27): «qué se dice en cada lado». Él sigue un tema (una persona, un hashtag, un programa) y
 * Deprocast mira cada tanto qué se dice de eso en X, Reddit, YouTube, las noticias y los foros, solo leyendo lo público:
 * por cada plataforma, una búsqueda (con site:) y la lectura de lo más prometedor. El modelo resume cada ronda: las
 * narrativas de cada plataforma (con su peso y links de ejemplo), los saltos (una idea que aparece en una y después en
 * otra) y lo nuevo respecto de la ronda anterior.
 *
 * Límites honestos: no hay API de X y Reddit bloquea a los programas, así que se ve lo que indexan los buscadores; y
 * los buscadores tienen cuota mensual, por eso una ronda usa como mucho una búsqueda por plataforma.
 * Nunca publica, interactúa ni entra a ninguna red: solo lee lo público.
 */
import { json, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { buscarWeb, leerPagina, type Resultado } from './web.ts'

export const PLATAFORMAS = ['x', 'reddit', 'youtube', 'noticias', 'foros'] as const
export type Plataforma = (typeof PLATAFORMAS)[number]
export const NOMBRE_PLATAFORMA: Record<Plataforma, string> = { x: 'X', reddit: 'Reddit', youtube: 'YouTube', noticias: 'Noticias', foros: 'Foros' }

export type Tema = {
  id: number; nombre: string; consultas: string[]; plataformas: Plataforma[]; cadaHoras: number; intensivoDesde: number | null; intensivoHasta: number | null; activo: boolean
  aviso: string | null; creadoEn: number; actualizadoEn: number
}
export type Item = { id: number; temaId: number; plataforma: Plataforma; url: string; titulo: string; extracto: string | null; texto: string | null; ronda: number; en: number }
export type Narrativa = { frase: string; peso: number; ejemplos: string[] }
export type Resumen = {
  plataformas: { plataforma: Plataforma; narrativas: Narrativa[]; tono: string | null }[]
  saltos: { idea: string; de: Plataforma; a: Plataforma; evidencia: string[] }[]
  nuevo: string[]
  resumen: string
  fuerte: boolean
}
export type Ronda = { id: number; temaId: number; en: number; nuevos: number; resumen: Resumen | null; busquedas: number }

const deTema = (r: any): Tema => ({
  id: r.id, nombre: r.nombre, consultas: json<string[]>(r.consultas, []) ?? [], plataformas: (json<Plataforma[]>(r.plataformas, []) ?? []).filter((p) => PLATAFORMAS.includes(p)),
  cadaHoras: r.cada_horas, intensivoDesde: r.intensivo_desde ?? null, intensivoHasta: r.intensivo_hasta, activo: !!r.activo, aviso: r.aviso, creadoEn: r.creado_en, actualizadoEn: r.actualizado_en,
})
const deItem = (r: any): Item => ({ id: r.id, temaId: r.tema_id, plataforma: r.plataforma, url: r.url, titulo: r.titulo, extracto: r.extracto, texto: r.texto, ronda: r.ronda, en: r.en })
const deRonda = (r: any): Ronda => ({ id: r.id, temaId: r.tema_id, en: r.en, nuevos: r.nuevos, resumen: json<Resumen | null>(r.resumen, null), busquedas: r.busquedas })

export const leerTema = (db: Db, id: number): Tema | null => { const r = db.prepare('SELECT * FROM observatorio_temas WHERE id = ?').get(id); return r ? deTema(r) : null }
export const listarTemas = (db: Db): Tema[] => (db.prepare('SELECT * FROM observatorio_temas ORDER BY activo DESC, actualizado_en DESC').all() as any[]).map(deTema)
export const rondasDe = (db: Db, temaId: number, limite = 20): Ronda[] => (db.prepare('SELECT * FROM observatorio_rondas WHERE tema_id = ? ORDER BY id DESC LIMIT ?').all(temaId, limite) as any[]).map(deRonda)
export const itemsDe = (db: Db, temaId: number, o: { plataforma?: Plataforma; limite?: number } = {}): Item[] =>
  (db.prepare(`SELECT * FROM observatorio_items WHERE tema_id = ?${o.plataforma ? ' AND plataforma = ?' : ''} ORDER BY id DESC LIMIT ?`).all(...[temaId, ...(o.plataforma ? [o.plataforma] : []), o.limite ?? 200]) as any[]).map(deItem)

const limpiarConsultas = (xs: unknown) => (Array.isArray(xs) ? xs : String(xs ?? '').split(/\n|;/)).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 5)
const limpiarPlataformas = (xs: unknown) => {
  const ps = (Array.isArray(xs) ? xs : []).map(String).filter((p): p is Plataforma => (PLATAFORMAS as readonly string[]).includes(p))
  return ps.length ? [...new Set(ps)] : [...PLATAFORMAS]
}

/** Seguir un tema: su nombre, las búsquedas (hasta 5, rotan de a una por ronda), las plataformas y cada cuánto. */
export function seguirTema(db: Db, t: { nombre: string; consultas?: unknown; plataformas?: unknown; cadaHoras?: number }, ahora = Date.now()): Tema {
  const nombre = String(t.nombre ?? '').trim().slice(0, 120)
  if (!nombre) throw new Error('¿Qué tema seguimos?')
  const consultas = limpiarConsultas(t.consultas)
  const id = Number(db.prepare(`INSERT INTO observatorio_temas (nombre, consultas, plataformas, cada_horas, activo, creado_en, actualizado_en) VALUES (?, ?, ?, ?, 1, ?, ?)`)
    .run(nombre, JSON.stringify(consultas.length ? consultas : [nombre]), JSON.stringify(limpiarPlataformas(t.plataformas)), Math.max(1, Math.min(168, Math.round(Number(t.cadaHoras) || 12))), ahora, ahora).lastInsertRowid)
  return leerTema(db, id)!
}

export function editarTema(db: Db, id: number, c: { nombre?: string; consultas?: unknown; plataformas?: unknown; cadaHoras?: number; activo?: boolean; intensivoDesde?: number | null; intensivoHasta?: number | null; borrar?: boolean }, ahora = Date.now()): Tema | null {
  const t = leerTema(db, id)
  if (!t) throw new Error(`No existe el tema ${id}`)
  if (c.borrar) {
    for (const tabla of ['observatorio_items', 'observatorio_rondas']) db.prepare(`DELETE FROM ${tabla} WHERE tema_id = ?`).run(id)
    db.prepare('DELETE FROM observatorio_temas WHERE id = ?').run(id)
    return null
  }
  const consultas = c.consultas === undefined ? t.consultas : limpiarConsultas(c.consultas)
  if (c.intensivoDesde !== undefined) db.prepare('UPDATE observatorio_temas SET intensivo_desde = ? WHERE id = ?').run(c.intensivoDesde, id)
  db.prepare('UPDATE observatorio_temas SET nombre = ?, consultas = ?, plataformas = ?, cada_horas = ?, activo = ?, intensivo_hasta = ?, actualizado_en = ? WHERE id = ?').run(
    c.nombre?.trim() ? c.nombre.trim().slice(0, 120) : t.nombre, JSON.stringify(consultas.length ? consultas : [t.nombre]),
    JSON.stringify(c.plataformas === undefined ? t.plataformas : limpiarPlataformas(c.plataformas)), c.cadaHoras ? Math.max(1, Math.min(168, Math.round(c.cadaHoras))) : t.cadaHoras,
    c.activo === undefined ? (t.activo ? 1 : 0) : c.activo ? 1 : 0, c.intensivoHasta === undefined ? t.intensivoHasta : c.intensivoHasta, ahora, id)
  return leerTema(db, id)
}

// ─── una ronda ──────────────────────────────────────────────────────────

/** La búsqueda de cada plataforma (lo que indexan los buscadores de cada sitio). */
export function consultaPara(p: Plataforma, q: string): string {
  if (p === 'x') return `site:x.com ${q}`
  if (p === 'reddit') return `site:reddit.com ${q}`
  if (p === 'youtube') return `site:youtube.com ${q}`
  if (p === 'noticias') return `${q} noticias`
  return `${q} foro OR meneame OR forocoches`
}
/** De qué plataforma es un link (por si el buscador trae algo de otro lado). */
function plataformaDe(url: string, pedida: Plataforma): Plataforma {
  if (/(^|\.)(x|twitter)\.com\//i.test(url.replace(/^https?:\/\//, ''))) return 'x'
  if (/reddit\.com\//i.test(url)) return 'reddit'
  if (/(youtube\.com|youtu\.be)\//i.test(url)) return 'youtube'
  return pedida
}
/** Las que se dejan leer (X y YouTube son páginas que no se leen sin navegador: queda el extracto del buscador). */
const SE_LEEN: Plataforma[] = ['noticias', 'foros', 'reddit']

let buscador = (db: Db, q: string): Promise<Resultado[]> => buscarWeb(db, q, { n: 8 })
let lector = (url: string) => leerPagina(url, 3000)
let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'observatorio' }, sistema, usuario, { temperatura: 0.3, maxTokens: 2500 })).datos
export function _probarObservatorio(o: { buscador?: typeof buscador; lector?: typeof lector; modelo?: typeof modelo }) {
  if (o.buscador) buscador = o.buscador
  if (o.lector) lector = o.lector
  if (o.modelo) modelo = o.modelo
}

const SISTEMA = `Sos el Observatorio de Mastropiero: mirás qué se dice de un tema en cada plataforma (X, Reddit, YouTube, noticias, foros), a partir de resultados públicos de búsqueda y de algunas páginas leídas. No opinás: describís.
- Por plataforma, las narrativas que aparecen (frases cortas que digan qué se sostiene), con su peso (1 a 5, cuánto aparece) y 1 a 3 links de ejemplo TOMADOS DE LOS RESULTADOS. El tono dominante en una palabra o dos.
- Los saltos: una idea que aparece en una plataforma y también en otra (de dónde parece venir y a dónde llegó), con los links que lo muestran.
- Lo nuevo respecto de la ronda anterior (si te la paso): narrativas que aparecen o se apagan.
- «fuerte»: true solo si hay una narrativa nueva con peso alto o un salto claro.
- Solo lo que está en los resultados; si una plataforma no trajo nada útil, no la inventes.
Forma: {"plataformas": [{"plataforma": "x"|"reddit"|"youtube"|"noticias"|"foros", "narrativas": [{"frase": string, "peso": number, "ejemplos": [string]}], "tono": string}], "saltos": [{"idea": string, "de": string, "a": string, "evidencia": [string]}], "nuevo": [string], "resumen": string (dos o tres oraciones), "fuerte": boolean}`

/** Lo que devolvió el modelo, sin links inventados ni plataformas que no están. */
function validar(r: any, urls: Set<string>): Resumen {
  const plat = (x: unknown): Plataforma | null => ((PLATAFORMAS as readonly string[]).includes(String(x)) ? (String(x) as Plataforma) : null)
  const links = (xs: unknown) => (Array.isArray(xs) ? xs : []).map(String).filter((u) => urls.has(u)).slice(0, 3)
  return {
    plataformas: (Array.isArray(r?.plataformas) ? r.plataformas : []).flatMap((p: any) => {
      const id = plat(p?.plataforma)
      if (!id) return []
      const narrativas = (Array.isArray(p?.narrativas) ? p.narrativas : []).map((n: any) => ({ frase: String(n?.frase ?? '').trim().slice(0, 240), peso: Math.max(1, Math.min(5, Math.round(Number(n?.peso) || 1))), ejemplos: links(n?.ejemplos) }))
        .filter((n: Narrativa) => n.frase).slice(0, 6)
      return narrativas.length ? [{ plataforma: id, narrativas, tono: p?.tono ? String(p.tono).slice(0, 60) : null }] : []
    }),
    saltos: (Array.isArray(r?.saltos) ? r.saltos : []).map((s: any) => ({ idea: String(s?.idea ?? '').trim().slice(0, 240), de: plat(s?.de), a: plat(s?.a), evidencia: links(s?.evidencia) }))
      .filter((s: any) => s.idea && s.de && s.a && s.de !== s.a).slice(0, 6),
    nuevo: (Array.isArray(r?.nuevo) ? r.nuevo : []).map((x: unknown) => String(x).trim().slice(0, 240)).filter(Boolean).slice(0, 6),
    resumen: String(r?.resumen ?? '').trim().slice(0, 800),
    fuerte: !!r?.fuerte,
  }
}

const enCurso = new Set<number>()
export const rondaEnCurso = (id: number) => enCurso.has(id)

/**
 * Una ronda: una búsqueda por plataforma (las consultas rotan), la lectura de hasta tres páginas que se dejan leer, los
 * items nuevos (solo links que devolvió el buscador) y el resumen del modelo contra la ronda anterior. Gasta búsquedas y
 * tokens: la llama el latido (en la nube) o la pantalla (solo en la nube).
 */
export async function ronda(db: Db, temaId: number, ahora = Date.now()): Promise<Ronda> {
  const t = leerTema(db, temaId)
  if (!t) throw new Error(`No existe el tema ${temaId}`)
  if (enCurso.has(temaId)) throw new Error('Ese tema ya está en una ronda')
  enCurso.add(temaId)
  try {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM observatorio_rondas WHERE tema_id = ?').get(temaId) as { n: number }).n
    const q = t.consultas[n % Math.max(1, t.consultas.length)] ?? t.nombre
    const nuevos: Item[] = []
    let busquedas = 0
    const errores: string[] = []
    const ins = db.prepare(`INSERT OR IGNORE INTO observatorio_items (tema_id, plataforma, url, titulo, extracto, texto, ronda, en) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`)
    for (const p of t.plataformas) {
      let rs: Resultado[] = []
      try { rs = await buscador(db, consultaPara(p, q)); busquedas++ } catch (e) { errores.push(e instanceof Error ? e.message : String(e)); continue }
      for (const r of rs.filter((x) => /^https?:\/\//.test(x.url)).slice(0, 8)) {
        const cambio = ins.run(temaId, plataformaDe(r.url, p), r.url, String(r.titulo ?? '').slice(0, 300), String(r.extracto ?? '').slice(0, 600), n + 1, ahora)
        if (cambio.changes) nuevos.push(deItem(db.prepare('SELECT * FROM observatorio_items WHERE tema_id = ? AND url = ?').get(temaId, r.url)))
      }
    }
    if (!busquedas && errores.length) {
      db.prepare('UPDATE observatorio_temas SET aviso = ?, actualizado_en = ? WHERE id = ?').run(`No pude buscar: ${errores[0].slice(0, 200)}`, ahora, temaId)
      throw new Error(`No pude buscar: ${errores[0]}`)
    }
    // Lo que se deja leer, un poco más a fondo (hasta tres páginas por ronda).
    for (const it of nuevos.filter((x) => SE_LEEN.includes(x.plataforma)).slice(0, 3)) {
      try { const l = await lector(it.url); if (l?.texto) { db.prepare('UPDATE observatorio_items SET texto = ? WHERE id = ?').run(l.texto.slice(0, 3000), it.id); it.texto = l.texto.slice(0, 3000) } } catch { /* una página que no se deja leer */ }
    }
    // El resumen: lo de esta ronda (y lo que ya se sabía del tema) contra la ronda anterior.
    const previa = rondasDe(db, temaId, 1)[0]?.resumen ?? null
    const vistos = nuevos.length ? nuevos : itemsDe(db, temaId, { limite: 30 })
    const urls = new Set(vistos.map((x) => x.url))
    let resumen: Resumen | null = null
    if (vistos.length) {
      const porPlataforma = t.plataformas.map((p) => {
        const xs = vistos.filter((x) => x.plataforma === p)
        return xs.length ? `## ${NOMBRE_PLATAFORMA[p]}\n${xs.map((x) => `- ${x.titulo} — ${x.url}\n  ${(x.texto ?? x.extracto ?? '').replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')}` : ''
      }).filter(Boolean)
      resumen = validar(await modelo(db, SISTEMA, [`Tema: ${t.nombre} (búsqueda: ${q})`, ...porPlataforma, previa ? `Ronda anterior: ${previa.resumen}\nNarrativas: ${previa.plataformas.flatMap((p) => p.narrativas.map((x) => `[${p.plataforma}] ${x.frase}`)).join(' · ')}` : 'Es la primera ronda.'].join('\n\n')), urls)
    }
    const id = Number(db.prepare('INSERT INTO observatorio_rondas (tema_id, en, nuevos, resumen, busquedas) VALUES (?, ?, ?, ?, ?)').run(temaId, ahora, nuevos.length, resumen ? JSON.stringify(resumen) : null, busquedas).lastInsertRowid)
    db.prepare('UPDATE observatorio_temas SET aviso = ?, actualizado_en = ? WHERE id = ?').run(errores.length ? `Algunas plataformas no se pudieron buscar: ${errores[0].slice(0, 160)}` : null, ahora, temaId)
    return deRonda(db.prepare('SELECT * FROM observatorio_rondas WHERE id = ?').get(id))
  } finally {
    enCurso.delete(temaId)
  }
}

/** Si está en vivo (una campaña): entre el inicio y el fin de su ventana intensiva. */
export const enVivo = (t: Pick<Tema, 'intensivoDesde' | 'intensivoHasta'>, ahora = Date.now()) => !!t.intensivoHasta && t.intensivoHasta > ahora && (t.intensivoDesde ?? 0) <= ahora

/** Si a un tema le toca ronda: por su cadencia, o cada 15 minutos mientras está en vivo (una campaña). */
export function leToca(db: Db, t: Tema, ahora = Date.now()): boolean {
  if (!t.activo || enCurso.has(t.id)) return false
  const ultima = (db.prepare('SELECT MAX(en) AS en FROM observatorio_rondas WHERE tema_id = ?').get(t.id) as { en: number | null }).en
  if (ultima == null) return true
  const cada = enVivo(t, ahora) ? 15 * 60_000 : t.cadaHoras * 3_600_000
  return ahora - ultima >= cada
}

/**
 * El latido (cada 10 minutos, en la nube): las rondas que tocan, de a una, mientras no se llegue al tope del día. Devuelve
 * los avisos para Hoy (solo lo fuerte: una narrativa nueva con peso o un salto claro; en modo intensivo, cada ronda).
 */
export async function latidoObservatorio(db: Db, ahora = Date.now()): Promise<string[]> {
  const { topeAlcanzado } = await import('./nan.ts')
  const avisos: string[] = []
  for (const t of listarTemas(db).filter((x) => leToca(db, x, ahora))) {
    if (topeAlcanzado(db, ahora)) break
    try {
      const r = await ronda(db, t.id, ahora)
      const intensivo = enVivo(t, ahora)
      // En vivo con un hashtag (la primera búsqueda de una campaña): cuántos de lo nuevo lo nombran.
      const tag = t.consultas[0]?.startsWith('#') ? t.consultas[0].toLowerCase() : null
      const conTag = tag && intensivo ? (db.prepare(`SELECT COUNT(*) AS n FROM observatorio_items WHERE tema_id = ? AND ronda = (SELECT MAX(ronda) FROM observatorio_items WHERE tema_id = ?) AND (LOWER(titulo) LIKE ? OR LOWER(COALESCE(extracto, '')) LIKE ?)`).get(t.id, t.id, `%${tag}%`, `%${tag}%`) as { n: number }).n : null
      if (r.resumen && (r.resumen.fuerte || intensivo)) avisos.push(`🔭 **${t.nombre}**${intensivo ? ' (en vivo)' : ''}: ${r.resumen.resumen}${r.resumen.saltos.length ? ` Salta de ${NOMBRE_PLATAFORMA[r.resumen.saltos[0].de]} a ${NOMBRE_PLATAFORMA[r.resumen.saltos[0].a]}: ${r.resumen.saltos[0].idea}.` : ''}${conTag != null ? ` ${tag} aparece en ${conTag} de lo nuevo.` : ''} (Afuera → Observatorio)`)
    } catch (e) { console.error(`  observatorio ${t.id}:`, e instanceof Error ? e.message : e) }
  }
  return avisos
}

/** Para el chat: la última ronda de un tema (o de todos), con los saltos y cómo viene. */
export function verObservatorio(db: Db, cual?: string | number | null) {
  const temas = listarTemas(db)
  const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const elegidos = cual == null || cual === '' ? temas : temas.filter((t) => t.id === Number(cual) || plano(t.nombre).includes(plano(String(cual))))
  if (!elegidos.length) return { error: temas.length ? `No sigo un tema «${cual}»: ${temas.map((t) => t.nombre).join(', ')}` : 'Todavía no sigo ningún tema (seguir_tema).' }
  return elegidos.slice(0, 5).map((t) => {
    const rs = rondasDe(db, t.id, 6)
    return {
      id: t.id, tema: t.nombre, consultas: t.consultas, plataformas: t.plataformas, cada_horas: t.cadaHoras, en_vivo: enVivo(t) || undefined, aviso: t.aviso ?? undefined,
      ultima: rs[0] ? { fecha: new Date(rs[0].en).toISOString().slice(0, 16), nuevos: rs[0].nuevos, ...rs[0].resumen } : null,
      antes: rs.slice(1).map((r) => ({ fecha: new Date(r.en).toISOString().slice(0, 16), resumen: r.resumen?.resumen ?? null })),
      nota: 'De X se ve lo que indexan los buscadores (no hay API): no es todo lo que se dice ahí.',
    }
  })
}
