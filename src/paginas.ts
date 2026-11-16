/**
 * Páginas propias: cada uno de los 72 arquetipos (las celdas de la Matriz 72) y cada dominio tiene su página, y cada
 * página es su propio mundo: se construye sola a su manera, a partir de lo que de verdad pasa ahí (los órganos y agentes
 * de la celda, su monedero; el material, las clases y las piezas del dominio), y él la va moldeando con instrucciones en
 * lenguaje natural («sumale una sección de proveedores», «sacá lo de las clases»).
 *
 * Reglas:
 * - El nombre de un arquetipo («El Modista») lo pone él y queda en su base: el código no trae nombres (sistema en blanco),
 *   y el constructor nunca lo inventa.
 * - El constructor no inventa datos: lo que no está en los datos va como pregunta o pendiente, marcado.
 * - Sus instrucciones mandan y siguen valiendo después de aplicadas; lo que escribió él a mano no se toca.
 * - Se reconstruye cuando él da una instrucción (en el momento) y, de noche, si cambió lo que pasa en ella.
 */
import crypto from 'node:crypto'
import type { Db } from './db.ts'
import { celda as celdaDe, DOMINIOS } from './geometria72.ts'

export type TipoPagina = 'arquetipo' | 'dominio'
export const TIPOS_PAGINA: TipoPagina[] = ['arquetipo', 'dominio']
export type Seccion = { id: string; titulo: string; cuerpo: string; origen: 'auto' | 'operador'; actualizada: number }
export type Instruccion = { texto: string; en: number; aplicada: boolean; nota?: string | null }
export type Pagina = {
  tipo: TipoPagina; clave: string; nombre: string | null; descripcion: string | null
  secciones: Seccion[]; instrucciones: Instruccion[]; construidaEn: number | null; firma: string | null; actualizadaEn: number | null
}

const ESQUEMA = `CREATE TABLE IF NOT EXISTS paginas (
  tipo TEXT NOT NULL,
  clave TEXT NOT NULL,
  nombre TEXT,
  descripcion TEXT,
  secciones TEXT NOT NULL DEFAULT '[]',
  instrucciones TEXT NOT NULL DEFAULT '[]',
  firma TEXT,
  construida_en INTEGER,
  actualizada_en INTEGER,
  PRIMARY KEY (tipo, clave)
)`
const listos = new WeakSet<Db>()
function asegurar(db: Db) {
  if (listos.has(db)) return
  db.exec(ESQUEMA)
  listos.add(db)
}

const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) : d } catch { return d } }
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const contar = (db: Db, sql: string, ...a: (string | number)[]) => { try { return Number((db.prepare(sql).get(...a) as { n?: number } | undefined)?.n ?? 0) } catch { return 0 } }

function deFila(tipo: TipoPagina, clave: string, r: any): Pagina {
  return {
    tipo, clave, nombre: r?.nombre ?? null, descripcion: r?.descripcion ?? null,
    secciones: json<Seccion[]>(r?.secciones, []), instrucciones: json<Instruccion[]>(r?.instrucciones, []),
    construidaEn: r?.construida_en ?? null, firma: r?.firma ?? null, actualizadaEn: r?.actualizada_en ?? null,
  }
}

export function leerPagina(db: Db, tipo: TipoPagina, clave: string): Pagina {
  asegurar(db)
  return deFila(tipo, clave, db.prepare('SELECT * FROM paginas WHERE tipo = ? AND clave = ?').get(tipo, clave))
}

function guardar(db: Db, p: Pagina, ahora: number) {
  asegurar(db)
  db.prepare(`INSERT INTO paginas (tipo, clave, nombre, descripcion, secciones, instrucciones, firma, construida_en, actualizada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (tipo, clave) DO UPDATE SET nombre = excluded.nombre, descripcion = excluded.descripcion, secciones = excluded.secciones,
    instrucciones = excluded.instrucciones, firma = excluded.firma, construida_en = excluded.construida_en, actualizada_en = excluded.actualizada_en`)
    .run(p.tipo, p.clave, p.nombre, p.descripcion, JSON.stringify(p.secciones), JSON.stringify(p.instrucciones), p.firma, p.construidaEn, ahora)
}

// ─── qué pasa en cada página (los datos reales) ─────────────────────────

/** Una celda de la Matriz 72: sus órganos (con la actividad de la semana), sus agentes y lo que tienen en el monedero. */
export async function datosArquetipo(db: Db, n: number, ahora = Date.now()) {
  const c = celdaDe(n)
  const { verEsqueleto } = await import('./esqueleto.ts')
  const organos = verEsqueleto(db, ahora).organos.filter((o) => o.celda === n)
    .map((o) => ({ nombre: o.nombre, tipo: o.tipo, funcion: o.funcion, hace: o.hace, virtudes: o.virtudes, semana: o.semana, erroresSemana: o.erroresSemana, vista: o.vista ?? null }))
  const agentes = (db.prepare('SELECT id, nombre, clase, estado, exitos, fallos, xp FROM agentes WHERE celda = ? ORDER BY xp DESC').all(n) as any[])
    .map((a) => ({ ...a, monedero: contar(db, 'SELECT COALESCE(ROUND(SUM(monto), 2), 0) AS n FROM monedero WHERE agente_id = ?', a.id) }))
  const vecinas = [n - 9, n + 9].filter((x) => x >= 1 && x <= 72).map((x) => ({ n: x, nombre: leerPagina(db, 'arquetipo', String(x)).nombre }))
  return {
    celda: { numero: n, etiqueta: c.etiqueta, dominio: c.dominio, ipo: c.ipo, cma: c.cma, oficio: c.oficio },
    organos, agentes, monederoTotal: Math.round(agentes.reduce((s, a) => s + a.monedero, 0) * 100) / 100, vecinas,
  }
}

/** Un dominio: su nivel en la Academia, el material, las últimas clases, las piezas de su fuente y su entidad en el grafo. */
export async function datosDominio(db: Db, id: number, ahora = Date.now()) {
  const { listarDominios, materialDe, sesionesDe } = await import('./academia.ts')
  const d = listarDominios(db, ahora).find((x: any) => x.id === id)
  if (!d) return null
  const fuente = db.prepare('SELECT id FROM fuentes WHERE nombre = ? COLLATE NOCASE ORDER BY creada_en LIMIT 1').get(d.tema) as { id: string } | undefined
  const piezas = fuente ? (db.prepare('SELECT id, titulo, fecha FROM corpus WHERE fuente = ? ORDER BY id DESC LIMIT 8').all(fuente.id) as any[]) : []
  const entidad = db.prepare(`SELECT id FROM entidades WHERE tipo = 'dominio' AND nombre = ? COLLATE NOCASE LIMIT 1`).get(d.tema) as { id: number } | undefined
  return {
    dominio: { id: d.id, tema: d.tema, porQue: d.porQue ?? null, estado: d.estado, nivel: d.tutorNivel, nivelNombre: d.nivelNombre, temaSiguiente: d.temaSiguiente, clases: d.clases, tarjetasHoy: d.tarjetasHoy, examen: d.examen, mapa: d.mapa, idioma: d.idioma },
    material: materialDe(db, id).slice(0, 15).map((m) => ({ titulo: m.titulo, url: m.url, piezaId: m.piezaId, origen: m.origen, util: m.util })),
    clases: sesionesDe(db, id, 8).map((s) => ({ tema: s.tema, tipo: s.tipo, nivel: s.nivel, puntaje: s.puntaje, estado: s.estado, en: s.cerradaEn ?? s.creadaEn })),
    practicas: contar(db, 'SELECT COUNT(*) AS n FROM practicas WHERE aprendizaje_id = ?', id),
    fuente: fuente ? { id: fuente.id, piezas: contar(db, 'SELECT COUNT(*) AS n FROM corpus WHERE fuente = ?', fuente.id), ultimas: piezas } : null,
    entidadId: entidad?.id ?? null,
  }
}

export async function datosDe(db: Db, tipo: TipoPagina, clave: string, ahora = Date.now()) {
  if (tipo === 'arquetipo') {
    const n = Number(clave)
    if (!Number.isInteger(n) || n < 1 || n > 72) throw new Error(`No hay arquetipo ${clave}: van del 1 al 72.`)
    return datosArquetipo(db, n, ahora)
  }
  const d = await datosDominio(db, Number(clave), ahora)
  if (!d) throw new Error(`No existe el dominio ${clave}`)
  return d
}

const firmaDe = (datos: unknown) => crypto.createHash('sha1').update(JSON.stringify(datos)).digest('hex').slice(0, 16)

// ─── construir ───────────────────────────────────────────────────────────

const SISTEMA = `Construís la página propia de un mundo dentro de Deprocast, el sistema personal del operador. Cada página es su propio mundo y crece a su manera: vos decidís qué secciones necesita según lo que de verdad pasa en ella (los datos) y lo que él pide (sus instrucciones).
Reglas:
- Sus instrucciones mandan, también las ya aplicadas (siguen valiendo). Si una no se puede con los datos que hay, decilo en "notas".
- No inventes datos, cifras, nombres ni hechos. Lo que falta va como pregunta o pendiente, marcado con «(pendiente)».
- No le pongas nombre al mundo: el nombre lo pone él.
- Las secciones con origen "operador" las escribió él: copialas igual, salvo que una instrucción pida cambiarlas.
- Entre 3 y 10 secciones; cada cuerpo en Markdown corto (listas, negritas), concreto, en castellano rioplatense. Nada de relleno ni frases de folleto.
- Mantené los "id" de las secciones que siguen (para que no salten); las nuevas, con un id corto en minúsculas.
Forma: {"descripcion": "una línea: qué es este mundo hoy", "secciones": [{"id": string, "titulo": string, "cuerpo": string, "origen": "auto" | "operador"}], "aplicadas": [índices de las instrucciones pendientes que aplicaste], "notas": string}`

let modelo = async (db: Db, tipo: TipoPagina, usuario: string): Promise<any> =>
  (await (await import('./modelo.ts')).pedirJson<any>({ db, clase: 'mastropiero', agenteId: `pagina:${tipo}` }, SISTEMA, usuario, { temperatura: 0.5, maxTokens: 6000 })).datos
export function _probarPaginas(f: typeof modelo) { modelo = f }

const QUE_ES: Record<TipoPagina, string> = {
  arquetipo: 'un arquetipo de la Matriz 72 (una celda: un dominio del sistema por un oficio — entra, procesa o sale, por cuerpo, mente o alma). Su mundo son los órganos que trabajan ahí, sus agentes y su monedero (los agentes no gastan: crecen sus arcas).',
  dominio: 'un dominio de conocimiento suyo: lo que está aprendiendo o construyendo, con su nivel en la Academia, su material, sus clases y las piezas de su fuente.',
}

/** Reconstruye la página: datos reales + secciones actuales + sus instrucciones → secciones nuevas. */
export async function construirPagina(db: Db, tipo: TipoPagina, clave: string, ahora = Date.now()): Promise<Pagina & { notas: string | null }> {
  const datos = await datosDe(db, tipo, clave, ahora)
  const p = leerPagina(db, tipo, clave)
  const pendientes = p.instrucciones.map((x, i) => ({ ...x, i })).filter((x) => !x.aplicada)
  const usuario = [
    `Es ${QUE_ES[tipo]}`,
    p.nombre ? `Su nombre (lo puso él): ${p.nombre}.` : 'Todavía no tiene nombre (no le pongas uno).',
    `Datos de hoy:\n${JSON.stringify(datos).slice(0, 14_000)}`,
    p.secciones.length ? `Secciones actuales:\n${JSON.stringify(p.secciones.map(({ id, titulo, cuerpo, origen }) => ({ id, titulo, cuerpo, origen }))).slice(0, 12_000)}` : 'Es la primera vez: armala desde cero.',
    p.instrucciones.filter((x) => x.aplicada).length ? `Instrucciones ya aplicadas (siguen valiendo):\n${p.instrucciones.filter((x) => x.aplicada).map((x) => `- ${x.texto}`).join('\n')}` : '',
    pendientes.length ? `Instrucciones nuevas (aplicalas):\n${pendientes.map((x) => `${x.i}. ${x.texto}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
  const d = await modelo(db, tipo, usuario)
  const previas = new Map(p.secciones.map((s) => [s.id, s]))
  const secciones: Seccion[] = (Array.isArray(d?.secciones) ? d.secciones : []).slice(0, 10).map((s: any, i: number) => {
    const id = String(s?.id ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `seccion-${i + 1}`
    const antes = previas.get(id)
    const cuerpo = String(s?.cuerpo ?? '').trim().slice(0, 6000)
    // Lo que escribió él no lo pisa el constructor (salvo que lo haya pedido: entonces viene con origen operador igual).
    if (antes?.origen === 'operador' && !pendientes.length) return antes
    return { id, titulo: String(s?.titulo ?? '').trim().slice(0, 120) || 'Sin título', cuerpo, origen: s?.origen === 'operador' && antes?.origen === 'operador' ? 'operador' : 'auto', actualizada: antes && antes.cuerpo === cuerpo ? antes.actualizada : ahora }
  }).filter((s: Seccion) => s.cuerpo)
  // Las secciones suyas que el modelo se olvidó, vuelven (nunca se pierden en silencio).
  for (const s of p.secciones) if (s.origen === 'operador' && !secciones.some((x) => x.id === s.id)) secciones.push(s)
  if (!secciones.length) throw new Error('El constructor no devolvió secciones: probá de nuevo.')
  const aplicadas = new Set((Array.isArray(d?.aplicadas) ? d.aplicadas : []).map(Number))
  const notas = String(d?.notas ?? '').trim().slice(0, 600) || null
  const nueva: Pagina = {
    ...p, descripcion: String(d?.descripcion ?? '').trim().slice(0, 240) || p.descripcion, secciones,
    // Lo que no se aplicó queda pendiente con la nota del porqué (no se pierde ni se da por hecho).
    instrucciones: p.instrucciones.map((x, i) => (x.aplicada ? x : aplicadas.has(i) ? { ...x, aplicada: true, nota: null } : { ...x, nota: notas })),
    construidaEn: ahora, firma: firmaDe(datos),
  }
  guardar(db, nueva, ahora)
  return { ...nueva, notas }
}

/** Él le da una instrucción en lenguaje natural: se anota y la página se reconstruye en el momento. */
export async function instruirPagina(db: Db, tipo: TipoPagina, clave: string, texto: string, ahora = Date.now()) {
  const t = texto.trim()
  if (!t) throw new Error('La instrucción está vacía.')
  await datosDe(db, tipo, clave, ahora) // que exista antes de anotar nada
  const p = leerPagina(db, tipo, clave)
  guardar(db, { ...p, instrucciones: [...p.instrucciones, { texto: t.slice(0, 1000), en: ahora, aplicada: false }] }, ahora)
  return construirPagina(db, tipo, clave, ahora)
}

/** El nombre (y una línea de qué es) lo pone él. */
export function nombrarPagina(db: Db, tipo: TipoPagina, clave: string, nombre: string | null, ahora = Date.now()): Pagina {
  if (tipo === 'arquetipo') celdaDe(Number(clave)) // valida 1..72
  const p = leerPagina(db, tipo, clave)
  const limpio = nombre?.trim().slice(0, 80) || null
  if (limpio && tipo === 'arquetipo') {
    const otro = (db.prepare(`SELECT clave FROM paginas WHERE tipo = 'arquetipo' AND clave != ? AND nombre = ? COLLATE NOCASE`).get(clave, limpio) as { clave: string } | undefined)?.clave
    if (otro) throw new Error(`«${limpio}» ya es el nombre del arquetipo ${otro}.`)
  }
  const nueva = { ...p, nombre: limpio }
  guardar(db, nueva, ahora)
  return nueva
}

/** Él escribe (o borra) una sección a mano: queda como suya y el constructor no la pisa. */
export function escribirSeccion(db: Db, tipo: TipoPagina, clave: string, s: { id?: string | null; titulo: string; cuerpo: string | null }, ahora = Date.now()): Pagina {
  const p = leerPagina(db, tipo, clave)
  const id = (s.id || s.titulo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `suya-${ahora}`
  const nueva_: Seccion | null = s.cuerpo?.trim() ? { id, titulo: s.titulo.trim().slice(0, 120) || 'Sin título', cuerpo: s.cuerpo.trim().slice(0, 6000), origen: 'operador', actualizada: ahora } : null
  // Editada queda en su lugar; nueva, al final; vacía, se va.
  const secciones = p.secciones.some((x) => x.id === id)
    ? p.secciones.flatMap((x) => (x.id === id ? (nueva_ ? [nueva_] : []) : [x]))
    : nueva_ ? [...p.secciones, nueva_] : p.secciones
  const nueva = { ...p, secciones }
  guardar(db, nueva, ahora)
  return nueva
}

// ─── buscar por nombre e índices ─────────────────────────────────────────

/** Un arquetipo por número, por su nombre («el modista», «Modista») o por «dominio oficio»; un dominio por id o por tema. */
export function resolverPagina(db: Db, tipo: TipoPagina, que: string | number): string | null {
  asegurar(db)
  const q = String(que ?? '').trim()
  if (!q) return null
  if (/^\d+$/.test(q)) return q
  const n = sinTildes(q).replace(/^(el|la|los|las)\s+/, '')
  if (tipo === 'arquetipo') {
    const filas = db.prepare(`SELECT clave, nombre FROM paginas WHERE tipo = 'arquetipo' AND nombre IS NOT NULL`).all() as { clave: string; nombre: string }[]
    const exacta = filas.find((f) => sinTildes(f.nombre).replace(/^(el|la|los|las)\s+/, '') === n)
    return exacta?.clave ?? filas.find((f) => sinTildes(f.nombre).includes(n))?.clave ?? null
  }
  const doms = db.prepare(`SELECT id, tema FROM aprendizajes WHERE estado != 'descartado'`).all() as { id: number; tema: string }[]
  return String(doms.find((d) => sinTildes(d.tema) === n)?.id ?? doms.find((d) => sinTildes(d.tema).includes(n))?.id ?? '') || null
}

/** Los 72, con su nombre (si lo tiene), qué hay en cada uno y si ya tiene página construida. */
export async function listarArquetipos(db: Db, ahora = Date.now()) {
  asegurar(db)
  const { ORGANOS } = await import('./esqueleto.ts')
  const paginas = new Map((db.prepare(`SELECT clave, nombre, descripcion, construida_en, instrucciones FROM paginas WHERE tipo = 'arquetipo'`).all() as any[]).map((r) => [Number(r.clave), r]))
  const agentes = db.prepare('SELECT celda, COUNT(*) AS n FROM agentes WHERE celda IS NOT NULL GROUP BY celda').all() as { celda: number; n: number }[]
  const porCelda = new Map(agentes.map((a) => [a.celda, a.n]))
  void ahora
  return { dominios: DOMINIOS, arquetipos: Array.from({ length: 72 }, (_, i) => {
    const n = i + 1, c = celdaDe(n), p = paginas.get(n)
    return {
      n, etiqueta: c.etiqueta, dominio: c.dominio, ipo: c.ipo, cma: c.cma, nombre: p?.nombre ?? null, descripcion: p?.descripcion ?? null,
      organos: ORGANOS.filter((o) => o.celda === n && o.tipo === 'organo').map((o) => o.nombre), propuestos: ORGANOS.filter((o) => o.celda === n && o.tipo === 'propuesto').length,
      agentes: porCelda.get(n) ?? 0, construida: p?.construida_en ?? null, instrucciones: json<Instruccion[]>(p?.instrucciones, []).length,
    }
  }) }
}

/** Los dominios con su página (o sin construir todavía). */
export function listarPaginasDominio(db: Db) {
  asegurar(db)
  const paginas = new Map((db.prepare(`SELECT clave, descripcion, construida_en FROM paginas WHERE tipo = 'dominio'`).all() as any[]).map((r) => [Number(r.clave), r]))
  return (db.prepare(`SELECT id, tema, estado, tutor_nivel FROM aprendizajes WHERE estado IN ('activo', 'pausado', 'logrado') ORDER BY estado = 'activo' DESC, tema`).all() as any[])
    .map((d) => ({ id: d.id, tema: d.tema, estado: d.estado, nivel: d.tutor_nivel ?? 1, descripcion: paginas.get(d.id)?.descripcion ?? null, construida: paginas.get(d.id)?.construida_en ?? null }))
}

// ─── la rutina: se construyen solas ──────────────────────────────────────

/**
 * Las que toca reconstruir: las que tienen instrucciones sin aplicar y las que cambiaron (otra firma de datos) hace más
 * de 20 horas. Un arquetipo vacío (sin nombre, sin órganos, sin agentes, sin instrucciones) no se construye: no hay mundo.
 */
export async function paginasParaConstruir(db: Db, ahora = Date.now(), max = 12): Promise<{ tipo: TipoPagina; clave: string }[]> {
  asegurar(db)
  const out: { tipo: TipoPagina; clave: string }[] = []
  const candidatas: { tipo: TipoPagina; clave: string }[] = [
    ...listarPaginasDominio(db).filter((d) => d.estado === 'activo').map((d) => ({ tipo: 'dominio' as const, clave: String(d.id) })),
    ...(await listarArquetipos(db, ahora)).arquetipos.filter((a) => a.nombre || a.organos.length || a.agentes || a.instrucciones).map((a) => ({ tipo: 'arquetipo' as const, clave: String(a.n) })),
  ]
  for (const c of candidatas) {
    if (out.length >= max) break
    const p = leerPagina(db, c.tipo, c.clave)
    if (p.instrucciones.some((x) => !x.aplicada)) { out.push(c); continue }
    if (p.construidaEn && ahora - p.construidaEn < 20 * 3_600_000) continue
    const datos = await datosDe(db, c.tipo, c.clave, ahora).catch(() => null)
    if (datos && firmaDe(datos) !== p.firma) out.push(c)
  }
  return out
}

/** Reconstruye las que tocan, de a una (si una falla, sigue con la otra). */
export async function construirPendientes(db: Db, ahora = Date.now(), max = 12): Promise<{ hechas: string[]; fallas: string[] }> {
  const hechas: string[] = [], fallas: string[] = []
  for (const c of await paginasParaConstruir(db, ahora, max)) {
    try { await construirPagina(db, c.tipo, c.clave, ahora); hechas.push(`${c.tipo}:${c.clave}`) } catch (e) { fallas.push(`${c.tipo}:${c.clave}: ${e instanceof Error ? e.message : e}`) }
  }
  return { hechas, fallas }
}
