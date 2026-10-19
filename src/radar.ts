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
  /** Dónde y cuándo (para el mapa y el calendario): fecha/fechaFin son las del evento; cierre, la fecha límite. */
  lugar: string | null; online: boolean; lat: number | null; lon: number | null; fecha: string | null; fechaFin: string | null; enCalendario: boolean
  misionId: number | null; entidadId: number | null; borrador: string | null; estado: 'nueva' | 'me_interesa' | 'hecha' | 'descartada'; origen: string; creadaEn: number
}

const deFila = (r: any): Oportunidad => ({
  id: r.id, titulo: r.titulo, url: r.url, tipo: r.tipo, descripcion: r.descripcion, porQue: r.por_que, cierre: r.cierre,
  lugar: r.lugar ?? null, online: !!r.online, lat: r.lat ?? null, lon: r.lon ?? null, fecha: r.fecha ?? null, fechaFin: r.fecha_fin ?? null, enCalendario: !!r.en_calendario, misionId: r.mision_id,
  entidadId: r.entidad_id, borrador: r.borrador, estado: r.estado, origen: r.origen, creadaEn: r.creada_en,
})

export function listarOportunidades(db: Db, f: { estados?: string[]; misionId?: number; limite?: number } = {}): Oportunidad[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (f.estados?.length) where.push(`estado IN (${f.estados.map(() => '?').join(',')})`), args.push(...f.estados)
  if (f.misionId != null) where.push('mision_id = ?'), args.push(f.misionId)
  return db.prepare(`SELECT o.*, EXISTS (SELECT 1 FROM calendario_vinculos v WHERE v.origen = 'oportunidad' AND v.origen_id = o.id) AS en_calendario FROM oportunidades o ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (cierre IS NULL), cierre, id DESC LIMIT ?`).all(...args, f.limite ?? 200).map(deFila)
}

export function leerOportunidad(db: Db, id: number): Oportunidad | null {
  const r = db.prepare(`SELECT o.*, EXISTS (SELECT 1 FROM calendario_vinculos v WHERE v.origen = 'oportunidad' AND v.origen_id = o.id) AS en_calendario FROM oportunidades o WHERE id = ?`).get(id)
  return r ? deFila(r) : null
}

export function marcarOportunidad(db: Db, id: number, estado: Oportunidad['estado'], ahora = Date.now()): Oportunidad {
  if (!['nueva', 'me_interesa', 'hecha', 'descartada'].includes(estado)) throw new Error('Estado inválido')
  if (!leerOportunidad(db, id)) throw new Error(`No existe la oportunidad ${id}`)
  db.prepare('UPDATE oportunidades SET estado = ?, actualizada_en = ? WHERE id = ?').run(estado, ahora, id)
  return leerOportunidad(db, id)!
}

/** Dónde y cuándo, validado (lo que sale del modelo puede venir de cualquier forma). */
export function lugarYFecha(x: any): { lugar: string | null; online: number; lat: number | null; lon: number | null; fecha: string | null; fechaFin: string | null } {
  const dia = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const coord = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max && v !== 0 ? Math.round(v * 1000) / 1000 : null)
  const online = x?.online === true || /^(online|virtual|internet|remoto)$/i.test(String(x?.lugar ?? '').trim())
  const lugar = online ? null : String(x?.lugar ?? '').trim().slice(0, 120) || null
  const lat = online ? null : coord(x?.lat, 90)
  const lon = online ? null : coord(x?.lon, 180)
  return { lugar, online: online ? 1 : 0, lat: lat != null && lon != null ? lat : null, lon: lat != null && lon != null ? lon : null, fecha: dia(x?.fecha), fechaFin: dia(x?.fecha_fin ?? x?.fechaFin) }
}

export function guardarOportunidad(db: Db, o: { titulo: string; url?: string | null; tipo?: string; descripcion?: string | null; porQue?: string | null; cierre?: string | null; misionId?: number | null; entidadId?: number | null; origen?: string; donde?: ReturnType<typeof lugarYFecha> | null }, ahora = Date.now()): Oportunidad | null {
  const titulo = String(o.titulo ?? '').trim().slice(0, 200)
  if (!titulo) return null
  const url = o.url?.trim() || null
  if (url) {
    const ya = db.prepare('SELECT id FROM oportunidades WHERE url = ?').get(url) as { id: number } | undefined
    if (ya) return leerOportunidad(db, ya.id)
  }
  const tipo = TIPOS_OPORTUNIDAD.includes(o.tipo as any) ? o.tipo! : 'otro'
  const cierre = o.cierre && /^\d{4}-\d{2}-\d{2}$/.test(o.cierre) ? o.cierre : null
  const d = o.donde
  const r = db.prepare(`INSERT INTO oportunidades (titulo, url, tipo, descripcion, por_que, cierre, mision_id, entidad_id, estado, origen, creada_en, actualizada_en, lugar, online, lat, lon, fecha, fecha_fin, ubicada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'nueva', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(titulo, url, tipo, o.descripcion?.trim() || null, o.porQue?.trim() || null, cierre, o.misionId ?? null, o.entidadId ?? null, o.origen ?? 'radar', ahora, ahora,
      d?.lugar ?? null, d ? d.online : null, d?.lat ?? null, d?.lon ?? null, d?.fecha ?? null, d?.fechaFin ?? null, d ? 1 : null)
  const id = Number(r.lastInsertRowid)
  // Un lugar sin coordenadas se busca en el mapa de fondo.
  if (d?.lugar && d.lat == null) void ubicarOportunidadEnMapa(db, id, d.lugar)
  return leerOportunidad(db, id)
}

// ─── buscar ─────────────────────────────────────────────────────────────

const SISTEMA_CONSULTAS = `Sos el radar de Mastropiero. Pensás búsquedas web para encontrarle al jugador oportunidades concretas para su objetivo.
- Entre 3 y 5 búsquedas, cortas, como las escribiría alguien que sabe buscar (en castellano o en inglés según dónde esté lo que se busca).
- Apuntá a lugares concretos: comunidades (subreddits, servidores de Discord, grupos, foros), eventos y ferias, convocatorias, becas, premios, medios y creadores afines.
- Si sabés su zona (por su memoria), incluila donde tenga sentido; si no, Valencia, España y online.
Forma: {"consultas": [string]}`

/** Lo que se pide de cada oportunidad para el mapa y el calendario. */
const DONDE_Y_CUANDO = `- «lugar»: la ciudad o el sitio donde pasa (por ejemplo «Valencia», «Madrid · La Casa Encendida»); null si no se sabe. «online»: true si es virtual o a distancia.
- «lat» y «lon»: aproximadas, SOLO si el lugar es una ciudad o un sitio muy conocido; si no, null.
- «fecha» y «fecha_fin»: YYYY-MM-DD de cuándo PASA (el evento, el festival, el curso), distinta de «cierre» (la fecha límite para anotarse); null si no se sabe.`

const SISTEMA_EXTRAER = `Sos el radar de Mastropiero. De estos resultados de búsqueda (y lo leído de algunas páginas), sacá las oportunidades concretas que sirven para el objetivo del jugador.
- Solo lo que está en los resultados: nada inventado. Cada una con su URL tal cual aparece.
- tipo: comunidad | evento | convocatoria | beca | premio | contacto | medio | otro.
- «descripcion»: qué es, en una oración. «por_que»: por qué le sirve a ÉL, concreto. «cierre»: YYYY-MM-DD si tiene fecha límite visible, si no null.
${DONDE_Y_CUANDO}
- Descartá lo genérico (páginas de inicio sin nada específico, artículos que no llevan a ningún lugar donde actuar).
Forma: {"oportunidades": [{"titulo": string, "url": string, "tipo": string, "descripcion": string, "por_que": string, "cierre": string | null, "lugar": string | null, "online": boolean, "lat": number | null, "lon": number | null, "fecha": string | null, "fecha_fin": string | null}]}`

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
    const g = guardarOportunidad(db, { titulo: x.titulo, url: x.url, tipo: x.tipo, descripcion: x.descripcion, porQue: x.por_que, cierre: x.cierre, misionId: m?.id ?? null, entidadId: m?.entidadId ?? null, origen: o.misionId != null ? 'ayudante' : 'radar', donde: lugarYFecha(x) }, ahora)
    if (g && !antes.has(g.id)) nuevas.push(g)
  }
  return { nuevas, consultas, aviso: hayBuscadorWeb() ? null : 'Busqué solo en Wikipedia (no hay clave de buscador).' }
}

// ─── dónde y cuándo (para el mapa y el calendario) ──────────────────────

async function ubicarOportunidadEnMapa(db: Db, id: number, lugar: string) {
  try {
    const { ubicar } = await import('./mapa.ts')
    const h = await ubicar(db, lugar)
    if (h) db.prepare('UPDATE oportunidades SET lat = ?, lon = ? WHERE id = ? AND lat IS NULL').run(h.lat, h.lon, id)
  } catch { /* sin mapa no pasa nada */ }
}

const SISTEMA_UBICAR = `Sos el radar de Mastropiero. Para cada oportunidad (título, descripción y link), decí dónde y cuándo pasa, con lo que se pueda saber de ese texto. No inventes: si no está, null.
${DONDE_Y_CUANDO}
Forma: {"oportunidades": [{"id": number, "lugar": string | null, "online": boolean, "lat": number | null, "lon": number | null, "fecha": string | null, "fecha_fin": string | null}]}`

/**
 * Las oportunidades que todavía no tienen dónde ni cuándo (las de antes del mapa): de a 20 por pedido, en la nube.
 * Después, los lugares sin coordenadas se buscan en el mapa. Devuelve cuántas completó.
 */
export async function ubicarOportunidades(db: Db, o: { max?: number } = {}): Promise<{ ubicadas: number; quedan: number }> {
  let ubicadas = 0
  for (let vuelta = 0; vuelta < Math.ceil((o.max ?? 200) / 20); vuelta++) {
    const lote = db.prepare(`SELECT id, titulo, descripcion, url FROM oportunidades WHERE ubicada IS NULL AND estado != 'descartada' ORDER BY id LIMIT 20`).all() as { id: number; titulo: string; descripcion: string | null; url: string | null }[]
    if (!lote.length) break
    const { datos } = await pedirJson<{ oportunidades?: any[] }>({ db, clase: 'mastropiero', agenteId: 'radar' }, SISTEMA_UBICAR,
      lote.map((x) => `- id ${x.id}: ${x.titulo}${x.descripcion ? ` — ${x.descripcion}` : ''}${x.url ? ` (${x.url})` : ''}`).join('\n'), { temperatura: 0.1, maxTokens: 3000 })
    const porId = new Map((datos.oportunidades ?? []).map((x) => [Number(x?.id), x]))
    for (const x of lote) {
      const d = lugarYFecha(porId.get(x.id) ?? {})
      db.prepare('UPDATE oportunidades SET lugar = ?, online = ?, lat = COALESCE(?, lat), lon = COALESCE(?, lon), fecha = COALESCE(?, fecha), fecha_fin = COALESCE(?, fecha_fin), ubicada = 1 WHERE id = ?')
        .run(d.lugar, d.online, d.lat, d.lon, d.fecha, d.fechaFin, x.id)
      if (d.lugar && d.lat == null) await ubicarOportunidadEnMapa(db, x.id, d.lugar)
      ubicadas++
    }
  }
  const quedan = (db.prepare(`SELECT COUNT(*) AS n FROM oportunidades WHERE ubicada IS NULL AND estado != 'descartada'`).get() as { n: number }).n
  return { ubicadas, quedan }
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
