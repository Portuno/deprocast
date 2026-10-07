/**
 * El radar: la liga sale a buscar afuera lo que sirve a las metas del jugador (comunidades donde está su público,
 * eventos, convocatorias, becas, premios, medios, contactos) y lo deja como oportunidades. Cada una puede tener un
 * borrador en su voz (un mensaje, un post, una postulación): él decide y publica. Nada se manda solo.
 */
import { fechaLocal, type Db } from './db.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { pedirJson } from './modelo.ts'
import { leerEntidad } from './entidades.ts'
import { leerMision, listarMisiones, principalDe, semanaDe, type Mision } from './misiones.ts'
import { buscarWeb, hayBuscadorWeb, leerPagina, type Resultado } from './web.ts'

export const TIPOS_OPORTUNIDAD = ['comunidad', 'evento', 'convocatoria', 'beca', 'premio', 'contacto', 'medio', 'otro'] as const
export type Oportunidad = {
  id: number; titulo: string; url: string | null; tipo: string; descripcion: string | null; porQue: string | null; cierre: string | null
  misionId: number | null; entidadId: number | null; borrador: string | null; estado: 'nueva' | 'me_interesa' | 'hecha' | 'descartada'; origen: string; creadaEn: number
}

const deFila = (r: any): Oportunidad => ({
  id: r.id, titulo: r.titulo, url: r.url, tipo: r.tipo, descripcion: r.descripcion, porQue: r.por_que, cierre: r.cierre, misionId: r.mision_id,
  entidadId: r.entidad_id, borrador: r.borrador, estado: r.estado, origen: r.origen, creadaEn: r.creada_en,
})

export function listarOportunidades(db: Db, f: { estados?: string[]; misionId?: number; limite?: number } = {}): Oportunidad[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (f.estados?.length) where.push(`estado IN (${f.estados.map(() => '?').join(',')})`), args.push(...f.estados)
  if (f.misionId != null) where.push('mision_id = ?'), args.push(f.misionId)
  return db.prepare(`SELECT * FROM oportunidades ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (cierre IS NULL), cierre, id DESC LIMIT ?`).all(...args, f.limite ?? 100).map(deFila)
}

export function leerOportunidad(db: Db, id: number): Oportunidad | null {
  const r = db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

export function marcarOportunidad(db: Db, id: number, estado: Oportunidad['estado'], ahora = Date.now()): Oportunidad {
  if (!['nueva', 'me_interesa', 'hecha', 'descartada'].includes(estado)) throw new Error('Estado inválido')
  if (!leerOportunidad(db, id)) throw new Error(`No existe la oportunidad ${id}`)
  db.prepare('UPDATE oportunidades SET estado = ?, actualizada_en = ? WHERE id = ?').run(estado, ahora, id)
  return leerOportunidad(db, id)!
}

export function guardarOportunidad(db: Db, o: { titulo: string; url?: string | null; tipo?: string; descripcion?: string | null; porQue?: string | null; cierre?: string | null; misionId?: number | null; entidadId?: number | null; origen?: string }, ahora = Date.now()): Oportunidad | null {
  const titulo = String(o.titulo ?? '').trim().slice(0, 200)
  if (!titulo) return null
  const url = o.url?.trim() || null
  if (url) {
    const ya = db.prepare('SELECT id FROM oportunidades WHERE url = ?').get(url) as { id: number } | undefined
    if (ya) return leerOportunidad(db, ya.id)
  }
  const tipo = TIPOS_OPORTUNIDAD.includes(o.tipo as any) ? o.tipo! : 'otro'
  const cierre = o.cierre && /^\d{4}-\d{2}-\d{2}$/.test(o.cierre) ? o.cierre : null
  const r = db.prepare(`INSERT INTO oportunidades (titulo, url, tipo, descripcion, por_que, cierre, mision_id, entidad_id, estado, origen, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'nueva', ?, ?, ?)`)
    .run(titulo, url, tipo, o.descripcion?.trim() || null, o.porQue?.trim() || null, cierre, o.misionId ?? null, o.entidadId ?? null, o.origen ?? 'radar', ahora, ahora)
  return leerOportunidad(db, Number(r.lastInsertRowid))
}

// ─── buscar ─────────────────────────────────────────────────────────────

const SISTEMA_CONSULTAS = `Sos el radar de Mastropiero. Pensás búsquedas web para encontrarle al jugador oportunidades concretas para su objetivo.
- Entre 3 y 5 búsquedas, cortas, como las escribiría alguien que sabe buscar (en castellano o en inglés según dónde esté lo que se busca).
- Apuntá a lugares concretos: comunidades (subreddits, servidores de Discord, grupos, foros), eventos y ferias, convocatorias, becas, premios, medios y creadores afines.
- Si sabés su zona (por su memoria), incluila donde tenga sentido; si no, Valencia, España y online.
Forma: {"consultas": [string]}`

const SISTEMA_EXTRAER = `Sos el radar de Mastropiero. De estos resultados de búsqueda (y lo leído de algunas páginas), sacá las oportunidades concretas que sirven para el objetivo del jugador.
- Solo lo que está en los resultados: nada inventado. Cada una con su URL tal cual aparece.
- tipo: comunidad | evento | convocatoria | beca | premio | contacto | medio | otro.
- «descripcion»: qué es, en una oración. «por_que»: por qué le sirve a ÉL, concreto. «cierre»: YYYY-MM-DD si tiene fecha límite visible, si no null.
- Descartá lo genérico (páginas de inicio sin nada específico, artículos que no llevan a ningún lugar donde actuar).
Forma: {"oportunidades": [{"titulo": string, "url": string, "tipo": string, "descripcion": string, "por_que": string, "cierre": string | null}]}`

function objetivoDe(db: Db, m: Mision | null, texto?: string | null): string {
  if (texto?.trim()) return texto.trim()
  if (m) {
    const e = m.entidadId ? leerEntidad(db, m.entidadId) : null
    return `${m.titulo}${m.detalle ? ` — ${m.detalle}` : ''}${e ? ` (sobre ${e.nombre}${e.notas ? `: ${e.notas.slice(0, 300)}` : ''})` : ''}`
  }
  const principal = principalDe(db, 'jugador')
  const primarias = listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(), estados: ['activa'] }).map((x) => x.titulo)
  return `Sus metas: ${principal?.titulo ?? '—'}${primarias.length ? `; esta semana: ${primarias.join(' · ')}` : ''}`
}

/**
 * Sale a buscar: piensa las búsquedas, busca, lee lo más prometedor y deja oportunidades nuevas (sin repetir URLs).
 * `mision`: la primaria para la que se busca; `texto`: lo que pide él («gente que juegue juegos de mesa políticos»).
 */
export async function buscarOportunidades(db: Db, o: { misionId?: number | null; texto?: string | null; ahora?: number; leer?: number } = {}): Promise<{ nuevas: Oportunidad[]; consultas: string[]; aviso: string | null }> {
  const ahora = o.ahora ?? Date.now()
  const m = o.misionId != null ? leerMision(db, o.misionId) : null
  const objetivo = objetivoDe(db, m, o.texto)
  const { datos: c } = await pedirJson<{ consultas?: string[] }>({ db, clase: 'mastropiero', agenteId: 'radar' }, SISTEMA_CONSULTAS,
    `Objetivo: ${objetivo}\n\nLo que sabés de él:\n${memoriaParaPrompt(db, 40)}`, { temperatura: 0.5, maxTokens: 800 })
  const consultas = (c.consultas ?? []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 5)
  const vistos = new Map<string, Resultado>()
  for (const q of consultas) {
    try {
      for (const r of await buscarWeb(db, q, { n: 6, ahora })) if (!vistos.has(r.url)) vistos.set(r.url, r)
    } catch { /* un buscador caído no frena el resto */ }
  }
  const resultados = [...vistos.values()]
  if (!resultados.length) return { nuevas: [], consultas, aviso: hayBuscadorWeb() ? 'La búsqueda no trajo nada.' : 'Sin clave de buscador solo puedo consultar Wikipedia: cargá TAVILY_API_KEY (gratis) en .env para encontrar comunidades y gente.' }
  const leidas: string[] = []
  for (const r of resultados.slice(0, o.leer ?? 4)) {
    const p = await leerPagina(r.url, 2500)
    if (p?.texto) leidas.push(`== ${r.url}\n${p.texto}`)
  }
  const { datos } = await pedirJson<{ oportunidades?: any[] }>({ db, clase: 'mastropiero', agenteId: 'radar' }, SISTEMA_EXTRAER, [
    `Objetivo: ${objetivo}`,
    `Resultados:\n${resultados.map((r) => `- ${r.titulo} | ${r.url} | ${r.extracto}`).join('\n')}`,
    leidas.length ? `Páginas leídas:\n${leidas.join('\n\n')}` : '',
  ].filter(Boolean).join('\n\n'), { temperatura: 0.2, maxTokens: 3500 })
  const urls = new Set(resultados.map((r) => r.url))
  const antes = new Set((db.prepare('SELECT id FROM oportunidades').all() as { id: number }[]).map((x) => x.id))
  const nuevas: Oportunidad[] = []
  for (const x of datos.oportunidades ?? []) {
    // Solo URLs que vinieron en los resultados: lo inventado no entra.
    if (typeof x?.url !== 'string' || !urls.has(x.url)) continue
    const g = guardarOportunidad(db, { titulo: x.titulo, url: x.url, tipo: x.tipo, descripcion: x.descripcion, porQue: x.por_que, cierre: x.cierre, misionId: m?.id ?? null, entidadId: m?.entidadId ?? null, origen: o.misionId != null ? 'ayudante' : 'radar' }, ahora)
    if (g && !antes.has(g.id)) nuevas.push(g)
  }
  return { nuevas, consultas, aviso: hayBuscadorWeb() ? null : 'Busqué solo en Wikipedia (no hay clave de buscador).' }
}

// ─── redactar ───────────────────────────────────────────────────────────

const SISTEMA_BORRADOR = `Sos Mastropiero y le redactás al jugador, en SU voz, lo que tiene que mandar o publicar para aprovechar una oportunidad: un mensaje para una comunidad, un post, un correo, una postulación.
- Primera persona, como escribe él (según su memoria), natural y sin sonar a bot ni a spam: aporta algo a la comunidad, no solo pide.
- Adaptado al lugar (las reglas y el tono de una comunidad de Reddit no son las de un correo a un festival).
- Corto. Si hace falta un dato que no tenés (un link, una fecha), dejá [entre corchetes] lo que falta.
Forma: {"borrador": string, "donde": string, "consejo": string}`

export async function redactarOportunidad(db: Db, id: number, pedido?: string | null, ahora = Date.now()): Promise<Oportunidad> {
  const o = leerOportunidad(db, id)
  if (!o) throw new Error(`No existe la oportunidad ${id}`)
  const m = o.misionId ? leerMision(db, o.misionId) : null
  const e = o.entidadId ? leerEntidad(db, o.entidadId) : null
  const { datos } = await pedirJson<{ borrador?: string; donde?: string; consejo?: string }>({ db, clase: 'mastropiero', agenteId: 'radar' }, SISTEMA_BORRADOR, [
    `Oportunidad: ${o.titulo} (${o.tipo}) — ${o.url ?? 'sin link'}\n${o.descripcion ?? ''}\nPor qué le sirve: ${o.porQue ?? ''}${o.cierre ? `\nCierre: ${o.cierre}` : ''}`,
    m ? `Para su misión: ${m.titulo}${m.detalle ? ` — ${m.detalle}` : ''}` : '',
    e ? `Sobre ${e.nombre}: ${e.notas?.slice(0, 600) ?? ''}` : '',
    pedido ? `Lo que pide para este borrador: ${pedido}` : '',
    `Lo que sabés de él:\n${memoriaParaPrompt(db, 40)}`,
  ].filter(Boolean).join('\n'), { temperatura: 0.6, maxTokens: 2000 })
  const texto = [datos.borrador?.trim(), datos.donde ? `\n— Dónde: ${datos.donde}` : '', datos.consejo ? `— Consejo: ${datos.consejo}` : ''].filter(Boolean).join('\n')
  db.prepare(`UPDATE oportunidades SET borrador = ?, estado = CASE estado WHEN 'nueva' THEN 'me_interesa' ELSE estado END, actualizada_en = ? WHERE id = ?`).run(texto || null, ahora, id)
  return leerOportunidad(db, id)!
}

/** Las que cierran pronto y le interesan: para las alertas. */
export function oportunidadesQueCierran(db: Db, ahora = Date.now(), dias = 3): Oportunidad[] {
  const hoy = fechaLocal(ahora)
  const limite = fechaLocal(ahora + dias * 86_400_000)
  return listarOportunidades(db, { estados: ['nueva', 'me_interesa'] }).filter((o) => o.cierre && o.cierre >= hoy && o.cierre <= limite)
}
