/**
 * La hoja citable (Fragua #292): por proyecto (y, a pedido, por persona de su mundo), un markdown canónico pensado para
 * que una IA lo cite entero: nombre único, qué hace, servicios (con precio solo si está), links oficiales, equipo, tres o
 * cuatro hechos verificables con fecha y un resumen de 60 palabras.
 * - Sale de lo que Deprocast ya sabe (la ficha, el equipo, las piezas que la nombran, las misiones cerradas). El modelo
 *   ordena y redacta; lo que no está en los datos NO entra: cada link tiene que estar en la ficha o en una pieza, cada
 *   hecho tiene que citar una pieza real, y los precios solo si aparecen. Lo que el modelo invente se descarta.
 * - Se regenera cuando cambian sus datos (o a pedido) y queda versionada en el corpus (fuente «hojas»), así el mismo
 *   texto sirve para el sitio, los perfiles y cualquier MCP que se conecte después. Es privada: publicarla es decisión suya.
 */
import crypto from 'node:crypto'
import { fechaLocal, json, type Db } from './db.ts'

export type DatosHoja = {
  entidad: { id: number; tipo: string; nombre: string; alias: string[]; notas: string | null; ficha: Record<string, unknown> }
  equipo: { nombre: string; rol: string | null }[]
  proyectos: { nombre: string; rol: string | null }[]
  piezas: { id: number; titulo: string; fecha: string | null; extracto: string }[]
  hechas: { titulo: string; fecha: string | null }[]
}
export type Hoja = { resumen: string; queHace: string; servicios: { nombre: string; precio: string | null }[]; links: { nombre: string; url: string }[]; equipo: { nombre: string; rol: string | null }[]; hechos: { fecha: string; hecho: string; pieza: number }[] }

function asegurar(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS hojas_citables (entidad_id INTEGER PRIMARY KEY, version INTEGER NOT NULL, firma TEXT NOT NULL, markdown TEXT NOT NULL, pieza_id INTEGER, generada_en INTEGER NOT NULL)`)
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g

/** Todo lo que se sabe de la entidad, en crudo (lo único de lo que la hoja puede salir). */
export function datosParaHoja(db: Db, entidadId: number): DatosHoja {
  const e = db.prepare('SELECT id, tipo, nombre, alias, notas, meta FROM entidades WHERE id = ?').get(entidadId) as any
  if (!e) throw new Error(`No existe la entidad ${entidadId}`)
  const meta = json<Record<string, unknown>>(e.meta, {}) ?? {}
  // De la ficha, lo que sirve para una hoja pública (nada de notas privadas del grafo ni de pesos internos).
  const ficha: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) if (v != null && v !== '' && !/^(perfil|vec|peso|puntaje|privad|interno|criba|score)/i.test(k) && JSON.stringify(v).length < 2000) ficha[k] = v
  const equipo = e.tipo === 'proyecto'
    ? (db.prepare(`SELECT p.nombre, pp.rol FROM persona_proyecto pp JOIN entidades p ON p.id = pp.persona_id WHERE pp.proyecto_id = ? ORDER BY COALESCE(pp.importancia, 0) DESC LIMIT 12`).all(entidadId) as { nombre: string; rol: string | null }[])
    : []
  const proyectos = e.tipo === 'persona'
    ? (db.prepare(`SELECT p.nombre, pp.rol FROM persona_proyecto pp JOIN entidades p ON p.id = pp.proyecto_id WHERE pp.persona_id = ? LIMIT 12`).all(entidadId) as { nombre: string; rol: string | null }[])
    : []
  const piezas = (db.prepare(`SELECT c.id, c.titulo, c.fecha, substr(c.contenido, 1, 700) AS extracto FROM corpus_entidades ce JOIN corpus c ON c.id = ce.pieza_id
    WHERE ce.entidad_id = ? AND c.fuente != 'hojas' ORDER BY COALESCE(c.fecha, '') DESC, c.id DESC LIMIT 25`).all(entidadId) as { id: number; titulo: string; fecha: string | null; extracto: string }[])
    .map((p) => ({ ...p, extracto: String(p.extracto ?? '').replace(/\s+/g, ' ').trim() }))
  let hechas: { titulo: string; fecha: string | null }[] = []
  try { hechas = db.prepare(`SELECT titulo, date(cerrada_en / 1000, 'unixepoch', 'localtime') AS fecha FROM misiones WHERE entidad_id = ? AND estado = 'hecha' ORDER BY cerrada_en DESC LIMIT 10`).all(entidadId) as any[] } catch { /* sin misiones */ }
  return { entidad: { id: e.id, tipo: e.tipo, nombre: e.nombre, alias: json<string[]>(e.alias, []) ?? [], notas: e.notas ?? null, ficha }, equipo, proyectos, piezas, hechas }
}

export const firmaDe = (d: DatosHoja) => crypto.createHash('sha1').update(JSON.stringify(d)).digest('hex').slice(0, 16)

/** Lo que devolvió el modelo, sin lo inventado: links que no están en los datos, hechos sin pieza real, precios sin respaldo. */
export function depurar(h: Partial<Hoja>, d: DatosHoja): Hoja {
  const crudo = JSON.stringify(d)
  const urls = new Set(crudo.match(URL_RE) ?? [])
  const piezas = new Map(d.piezas.map((p) => [p.id, p]))
  const palabras = (s: string) => s.split(/\s+/).filter(Boolean).length
  let resumen = String(h.resumen ?? '').replace(/\s+/g, ' ').trim()
  if (palabras(resumen) > 70) resumen = `${resumen.split(/\s+/).slice(0, 60).join(' ')}…`
  return {
    resumen,
    queHace: String(h.queHace ?? '').trim().slice(0, 1200),
    // Un precio solo si ese número aparece en los datos.
    servicios: (Array.isArray(h.servicios) ? h.servicios : []).slice(0, 12).map((s) => ({ nombre: String(s?.nombre ?? '').trim().slice(0, 120), precio: s?.precio && String(s.precio).match(/\d+/g)?.every((n) => crudo.includes(n)) ? String(s.precio).slice(0, 60) : null })).filter((s) => s.nombre),
    links: (Array.isArray(h.links) ? h.links : []).filter((l) => l?.url && [...urls].some((u) => u.replace(/\/$/, '') === String(l.url).replace(/\/$/, ''))).slice(0, 10).map((l) => ({ nombre: String(l.nombre ?? l.url).slice(0, 60), url: String(l.url) })),
    equipo: (Array.isArray(h.equipo) ? h.equipo : []).filter((p) => p?.nombre && (d.equipo.some((x) => x.nombre === p.nombre) || crudo.includes(String(p.nombre)))).slice(0, 12).map((p) => ({ nombre: String(p.nombre), rol: p.rol ? String(p.rol).slice(0, 60) : null })),
    hechos: (Array.isArray(h.hechos) ? h.hechos : []).filter((x) => x && piezas.has(Number(x.pieza)) && String(x.hecho ?? '').trim()).slice(0, 4)
      .map((x) => ({ fecha: /^\d{4}-\d{2}(-\d{2})?$/.test(String(x.fecha)) ? String(x.fecha) : (piezas.get(Number(x.pieza))!.fecha ?? ''), hecho: String(x.hecho).trim().slice(0, 300), pieza: Number(x.pieza) })),
  }
}

/** El markdown canónico (determinístico: el mismo contenido da el mismo texto). */
export function comoMarkdown(d: DatosHoja, h: Hoja, version: number, fecha = fechaLocal()): string {
  const e = d.entidad
  const partes = [
    `# ${e.nombre}`,
    e.alias.length ? `_También: ${e.alias.join(', ')}_` : '',
    h.resumen ? `> ${h.resumen}` : '',
    h.queHace ? `## Qué hace\n${h.queHace}` : '',
    h.servicios.length ? `## Servicios\n${h.servicios.map((s) => `- ${s.nombre}${s.precio ? ` — ${s.precio}` : ''}`).join('\n')}` : '',
    h.links.length ? `## Links oficiales\n${h.links.map((l) => `- [${l.nombre}](${l.url})`).join('\n')}` : '',
    h.equipo.length ? `## ${e.tipo === 'persona' ? 'Con quién trabaja' : 'Equipo'}\n${h.equipo.map((p) => `- ${p.nombre}${p.rol ? ` (${p.rol})` : ''}`).join('\n')}` : '',
    d.proyectos.length && e.tipo === 'persona' ? `## Proyectos\n${d.proyectos.map((p) => `- ${p.nombre}${p.rol ? ` (${p.rol})` : ''}`).join('\n')}` : '',
    h.hechos.length ? `## Hechos verificables\n${h.hechos.map((x) => `- ${x.fecha ? `**${x.fecha}** · ` : ''}${x.hecho}`).join('\n')}` : '',
    `---\n_Hoja citable v${version} · ${fecha}. Fuente canónica de ${e.nombre}._`,
  ]
  return partes.filter(Boolean).join('\n\n')
}

const SISTEMA = `Armás la «hoja citable» de un proyecto o una persona: un texto canónico para que un modelo de IA lo cite cuando alguien pregunte por ellos. Reglas duras:
- Usá SOLO los datos que te paso. Nada de suponer, completar ni adornar. Si algo no está, dejalo vacío.
- resumen: 60 palabras como mucho, en tercera persona, autosuficiente (se entiende sin contexto), con el nombre exacto, qué hace y dónde; nada de adjetivos vacíos («líder», «innovador»).
- queHace: 2 a 4 oraciones concretas.
- servicios: lo que ofrece, con precio SOLO si el precio aparece en los datos.
- links: solo URLs que aparezcan textuales en los datos (web, redes oficiales).
- equipo: solo personas del equipo que te paso, con su rol.
- hechos: 3 o 4 hechos verificables, cada uno con su fecha y el id de la pieza de donde sale (campo pieza). Un hecho es algo que pasó (un lanzamiento, un trabajo entregado, un premio, una cifra), no una opinión.
Castellano neutro (lo va a leer cualquiera). Devolvé {"resumen","queHace","servicios":[{"nombre","precio"}],"links":[{"nombre","url"}],"equipo":[{"nombre","rol"}],"hechos":[{"fecha","hecho","pieza"}]}.`

/** Para las pruebas: el modelo. */
let redactar = async (db: Db, usuario: string): Promise<Partial<Hoja>> => (await (await import('./modelo.ts')).pedirJson<Partial<Hoja>>({ db, clase: 'mastropiero', agenteId: 'hoja-citable' }, SISTEMA, usuario, { temperatura: 0.2, maxTokens: 1800 })).datos
export function _probarHojas(f: typeof redactar) { redactar = f }

export function leerHoja(db: Db, entidadId: number): { version: number; firma: string; markdown: string; piezaId: number | null; generadaEn: number } | null {
  asegurar(db)
  const r = db.prepare('SELECT * FROM hojas_citables WHERE entidad_id = ?').get(entidadId) as any
  return r ? { version: r.version, firma: r.firma, markdown: r.markdown, piezaId: r.pieza_id, generadaEn: r.generada_en } : null
}

/**
 * Arma (o rehace) la hoja. Si sus datos no cambiaron desde la última, devuelve esa (salvo forzar). Cada versión nueva
 * queda como pieza del corpus.
 */
export async function hojaCitable(db: Db, entidadId: number, o: { forzar?: boolean; ahora?: number } = {}): Promise<{ markdown: string; version: number; nueva: boolean; piezaId: number | null }> {
  asegurar(db)
  const ahora = o.ahora ?? Date.now()
  const d = datosParaHoja(db, entidadId)
  const firma = firmaDe(d)
  const ya = leerHoja(db, entidadId)
  if (ya && ya.firma === firma && !o.forzar) return { markdown: ya.markdown, version: ya.version, nueva: false, piezaId: ya.piezaId }
  if (!d.piezas.length && !Object.keys(d.entidad.ficha).length && !d.entidad.notas) throw new Error(`Todavía no sé casi nada de «${d.entidad.nombre}»: cargale la ficha (qué hace, web) o mandame material, y armo la hoja.`)
  const h = depurar(await redactar(db, JSON.stringify(d).slice(0, 24_000)), d)
  const version = (ya?.version ?? 0) + 1
  const markdown = comoMarkdown(d, h, version, fechaLocal(ahora))
  const { asegurarFuente, insertar } = await import('./corpus.ts')
  asegurarFuente(db, { id: 'hojas', nombre: 'Hojas citables', nivel: 'propia', descripcion: 'La fuente canónica de cada proyecto (y de quien pidas): lo que una IA debería citar. Versionada.' })
  const piezaId = insertar(db, {
    fuente: 'hojas', nivel: 'propia', tipo: 'materia', estado: 'disponible', titulo: `Hoja citable · ${d.entidad.nombre} · v${version}`, contenido: markdown, fecha: fechaLocal(ahora),
    etiquetas: ['hoja-citable'], origenId: `hoja:${entidadId}:${firma}`, entidades: [entidadId], meta: { hojaCitable: { entidad: entidadId, version, firma } },
  }, ahora) ?? null
  db.prepare(`INSERT INTO hojas_citables (entidad_id, version, firma, markdown, pieza_id, generada_en) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (entidad_id) DO UPDATE SET version = excluded.version, firma = excluded.firma, markdown = excluded.markdown, pieza_id = excluded.pieza_id, generada_en = excluded.generada_en`).run(entidadId, version, firma, markdown, piezaId, ahora)
  return { markdown, version, nueva: true, piezaId }
}

/** De noche: los proyectos cuyos datos cambiaron desde su hoja (y que tienen material), de a pocos. */
export async function rehacerHojas(db: Db, o: { maximo?: number; ahora?: number } = {}): Promise<number> {
  asegurar(db)
  const proyectos = db.prepare(`SELECT e.id FROM entidades e WHERE e.tipo = 'proyecto' AND (SELECT COUNT(*) FROM corpus_entidades ce WHERE ce.entidad_id = e.id) >= 3 ORDER BY e.id`).all() as { id: number }[]
  let n = 0
  for (const p of proyectos) {
    if (n >= (o.maximo ?? 6)) break
    try {
      const ya = leerHoja(db, p.id)
      if (ya && ya.firma === firmaDe(datosParaHoja(db, p.id))) continue
      if ((await hojaCitable(db, p.id, { ahora: o.ahora })).nueva) n++
    } catch (e) { console.error('  hoja citable:', e instanceof Error ? e.message : e) }
  }
  return n
}
