/**
 * Librería: sus obras como planillas. Libros, películas, series, videojuegos, papers y repositorios, cada uno con su
 * estado (quiero, en curso, terminado, abandonado, referencia), su valoración en la escala de la criba (1–12), notas,
 * etiquetas y de qué piezas del corpus sale. Él carga a mano; Mastropiero también la puebla desde el corpus (repos y
 * papers por su URL; el resto, leyendo lo que él dijo o guardó, solo obras nombradas con todas las letras) y esas
 * filas quedan marcadas para que las revise. Después se usa para expandir el corpus y recomendar tareas.
 */
import { fechaLocal, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { buscarWeb, hayBuscadorWeb, leerPagina } from './web.ts'
import { crearCuaderno, sumarFuentes } from './cuadernos.ts'

export const TIPOS_OBRA = ['libro', 'pelicula', 'serie', 'videojuego', 'paper', 'repositorio'] as const
export type TipoObra = (typeof TIPOS_OBRA)[number]
export const ESTADOS_OBRA = ['quiero', 'en_curso', 'terminado', 'abandonado', 'referencia'] as const

export type Obra = {
  id: number; tipo: TipoObra; titulo: string; autor: string | null; anio: number | null; estado: string; valoracion: number | null
  url: string | null; notas: string | null; etiquetas: string[]; piezas: number[]; origen: 'operador' | 'mastropiero'; revisada: boolean
  resumen: string | null; expandidaEn: number | null; expansion: string | null
  creadaEn: number; editadaEn: number
}

const deFila = (r: any): Obra => ({
  id: r.id, tipo: r.tipo, titulo: r.titulo, autor: r.autor, anio: r.anio, estado: r.estado, valoracion: r.valoracion, url: r.url, notas: r.notas,
  etiquetas: r.etiquetas ? JSON.parse(r.etiquetas) : [], piezas: r.piezas ? JSON.parse(r.piezas) : [], origen: r.origen, revisada: !!r.revisada,
  resumen: r.resumen ?? null, expandidaEn: r.expandida_en ?? null, expansion: r.expansion ?? null,
  creadaEn: r.creada_en, editadaEn: r.editada_en,
})

const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(el|la|los|las|the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim()
/** La misma obra no entra dos veces: por URL si la tiene; si no, por tipo + título (+ autor si lo hay). */
const huella = (o: { tipo: string; titulo: string; autor?: string | null; url?: string | null }) =>
  o.url && /github\.com|arxiv\.org|doi\.org/.test(o.url) ? `url:${o.url.toLowerCase().replace(/[#?].*$/, '').replace(/\/+$/, '')}` : `${o.tipo}:${norm(o.titulo)}`

export function agregarObra(db: Db, o: {
  tipo: string; titulo: string; autor?: string | null; anio?: number | string | null; estado?: string | null; valoracion?: number | string | null
  url?: string | null; notas?: string | null; etiquetas?: string[]; piezas?: number[]; origen?: 'operador' | 'mastropiero'
}, ahora = Date.now()): { obra: Obra; nueva: boolean } {
  if (!TIPOS_OBRA.includes(o.tipo as TipoObra)) throw new Error(`Tipo desconocido: ${o.tipo} (${TIPOS_OBRA.join(', ')})`)
  const titulo = String(o.titulo ?? '').trim().slice(0, 300)
  if (!titulo) throw new Error('La obra necesita un título')
  const origen = o.origen ?? 'operador'
  const h = huella({ ...o, titulo })
  const ya = db.prepare('SELECT * FROM obras WHERE huella = ?').get(h) as any
  if (ya) {
    // Ya estaba: suma las piezas donde aparece (y lo que faltaba), sin pisar lo que él escribió.
    const piezas = [...new Set([...(ya.piezas ? JSON.parse(ya.piezas) : []), ...(o.piezas ?? [])])]
    db.prepare('UPDATE obras SET piezas = ?, autor = COALESCE(autor, ?), anio = COALESCE(anio, ?), url = COALESCE(url, ?) WHERE id = ?')
      .run(JSON.stringify(piezas), o.autor || null, anioDe(o.anio), o.url || null, ya.id)
    return { obra: leerObra(db, ya.id)!, nueva: false }
  }
  const r = db.prepare(`INSERT INTO obras (tipo, titulo, autor, anio, estado, valoracion, url, notas, etiquetas, piezas, origen, revisada, huella, creada_en, editada_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    o.tipo, titulo, o.autor?.trim() || null, anioDe(o.anio), ESTADOS_OBRA.includes(o.estado as any) ? o.estado! : (origen === 'operador' ? 'quiero' : 'referencia'),
    valoracionDe(o.valoracion), o.url?.trim() || null, o.notas?.trim() || null, JSON.stringify(o.etiquetas ?? []), JSON.stringify(o.piezas ?? []),
    origen, origen === 'operador' ? 1 : 0, h, ahora, ahora)
  return { obra: leerObra(db, Number(r.lastInsertRowid))!, nueva: true }
}

const anioDe = (v: unknown) => { const n = Number(String(v ?? '').match(/\d{4}/)?.[0]); return n >= 1000 && n <= 2100 ? n : null }
const valoracionDe = (v: unknown) => (v == null || v === '' ? null : Math.max(1, Math.min(12, Math.round(Number(v)))) || null)

export const leerObra = (db: Db, id: number): Obra | null => { const r = db.prepare('SELECT * FROM obras WHERE id = ?').get(id); return r ? deFila(r) : null }

export function listarObras(db: Db, f: { tipo?: string | null; q?: string | null; estado?: string | null; limite?: number } = {}): Obra[] {
  const w: string[] = []
  const a: (string | number)[] = []
  if (f.tipo) w.push('tipo = ?'), a.push(f.tipo)
  if (f.estado) w.push('estado = ?'), a.push(f.estado)
  if (f.q) w.push('(titulo LIKE ? OR autor LIKE ? OR notas LIKE ? OR etiquetas LIKE ?)'), a.push(...Array(4).fill(`%${f.q}%`))
  return db.prepare(`SELECT * FROM obras ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY revisada, editada_en DESC, id DESC LIMIT ?`).all(...a, f.limite ?? 2000).map(deFila)
}

export function conteos(db: Db): Record<string, { total: number; sinRevisar: number }> {
  const out: Record<string, { total: number; sinRevisar: number }> = Object.fromEntries(TIPOS_OBRA.map((t) => [t, { total: 0, sinRevisar: 0 }]))
  for (const r of db.prepare('SELECT tipo, COUNT(*) AS n, SUM(revisada = 0) AS s FROM obras GROUP BY tipo').all() as any[]) out[r.tipo] = { total: r.n, sinRevisar: r.s ?? 0 }
  return out
}

/** Él edita una celda: lo que toca queda revisado. */
export function editarObra(db: Db, id: number, c: Partial<{ tipo: string; titulo: string; autor: string | null; anio: number | string | null; estado: string; valoracion: number | string | null; url: string | null; notas: string | null; etiquetas: string[] | string; revisada: boolean; borrar: boolean }>, ahora = Date.now()): Obra | null {
  const o = leerObra(db, id)
  if (!o) throw new Error(`No existe la obra ${id}`)
  if (c.borrar) { db.prepare('DELETE FROM obras WHERE id = ?').run(id); return null }
  const sets: [string, unknown][] = []
  if (c.tipo !== undefined) { if (!TIPOS_OBRA.includes(c.tipo as TipoObra)) throw new Error(`Tipo desconocido: ${c.tipo}`); sets.push(['tipo', c.tipo]) }
  if (c.titulo !== undefined) { if (!String(c.titulo).trim()) throw new Error('El título no puede quedar vacío'); sets.push(['titulo', String(c.titulo).trim()]) }
  if (c.autor !== undefined) sets.push(['autor', String(c.autor ?? '').trim() || null])
  if (c.anio !== undefined) sets.push(['anio', anioDe(c.anio)])
  if (c.estado !== undefined) { if (!ESTADOS_OBRA.includes(c.estado as any)) throw new Error(`Estado desconocido: ${c.estado}`); sets.push(['estado', c.estado]) }
  if (c.valoracion !== undefined) sets.push(['valoracion', valoracionDe(c.valoracion)])
  if (c.url !== undefined) sets.push(['url', String(c.url ?? '').trim() || null])
  if (c.notas !== undefined) sets.push(['notas', String(c.notas ?? '').trim() || null])
  if (c.etiquetas !== undefined) sets.push(['etiquetas', JSON.stringify(Array.isArray(c.etiquetas) ? c.etiquetas : String(c.etiquetas).split(',').map((x) => x.trim()).filter(Boolean))])
  sets.push(['revisada', c.revisada === false ? 0 : 1])
  db.prepare(`UPDATE obras SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, editada_en = ? WHERE id = ?`).run(...(sets.map(([, v]) => v) as any[]), ahora, id)
  return leerObra(db, id)
}

/** La planilla en CSV (para abrirla en Excel o Sheets). */
export function aCsv(obras: Obra[]): string {
  const c = (v: unknown) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return ['tipo,titulo,autor,anio,estado,valoracion,url,etiquetas,notas,origen', ...obras.map((o) => [o.tipo, o.titulo, o.autor, o.anio, o.estado, o.valoracion, o.url, o.etiquetas.join(' | '), o.notas, o.origen].map(c).join(','))].join('\n')
}

// ─── poblar desde el corpus ─────────────────────────────────────────────

/** Repos y papers salen de su URL, sin modelo. */
export function obrasPorUrl(db: Db, ahora = Date.now(), titulos: string[] = []): number {
  let nuevas = 0
  const filas = db.prepare(`SELECT id, titulo, url FROM corpus WHERE url LIKE '%github.com/%' OR url LIKE '%gitlab.com/%' OR url LIKE '%arxiv.org/%' OR url LIKE '%doi.org/%' OR url LIKE '%semanticscholar.org/%'`).all() as any[]
  for (const p of filas) {
    const gh = /(?:github|gitlab)\.com\/([\w.-]+)\/([\w.-]+)/.exec(p.url)
    if (gh) {
      const r = agregarObra(db, { tipo: 'repositorio', titulo: `${gh[1]}/${gh[2].replace(/\.git$/, '')}`, autor: gh[1], url: `https://${/gitlab/.test(p.url) ? 'gitlab' : 'github'}.com/${gh[1]}/${gh[2].replace(/\.git$/, '')}`, notas: p.titulo, piezas: [p.id], origen: 'mastropiero' }, ahora)
      if (r.nueva) (nuevas++, titulos.push(r.obra.titulo))
    } else {
      const r = agregarObra(db, { tipo: 'paper', titulo: String(p.titulo).replace(/^(Hallazgo|Paper)\s*[·:]\s*/i, ''), url: p.url, piezas: [p.id], origen: 'mastropiero' }, ahora)
      if (r.nueva) (nuevas++, titulos.push(r.obra.titulo))
    }
  }
  return nuevas
}

const SISTEMA_OBRAS = `Encontrás obras culturales NOMBRADAS en textos de un archivo personal: libros, películas, series, videojuegos, papers.
Forma: {"obras": [{"tipo": "libro"|"pelicula"|"serie"|"videojuego"|"paper", "titulo": string, "autor": string|null, "anio": number|null, "texto": number}]}
- Solo obras con título propio dicho o escrito en el texto (no «un libro de marketing», no temas, no personas solas, no cuentas de redes).
- "autor": autor, director o estudio, solo si aparece o es inequívoco por el título. "anio" solo si aparece.
- "texto" es el número del texto donde aparece. Si no hay ninguna, {"obras": []}.`

/** Lo que él dijo o guardó que nombra obras: lo de la Libroteca primero, después lo que habla de libros, series, etc. */
function textosCandidatos(db: Db, limite: number): { id: number; texto: string }[] {
  const lib = db.prepare(`SELECT id FROM entidades WHERE nombre LIKE '%ibroteca%' OR nombre LIKE '%Librería%' LIMIT 1`).get() as any
  const filas = db.prepare(`SELECT c.id, c.titulo, c.contenido FROM corpus c WHERE c.nivel != 'generada' AND (
      ${lib ? `c.id IN (SELECT pieza_id FROM corpus_entidades WHERE entidad_id = ${Number(lib.id)}) OR` : ''}
      c.contenido LIKE '%libro%' OR c.contenido LIKE '%novela%' OR c.contenido LIKE '%película%' OR c.contenido LIKE '%pelicula%' OR c.contenido LIKE '%serie %'
      OR c.contenido LIKE '%videojuego%' OR c.contenido LIKE '%film%' OR c.contenido LIKE '%book%' OR c.contenido LIKE '%paper%' OR c.contenido LIKE '%ensayo%')
    AND NOT EXISTS (SELECT 1 FROM libreria_leidas l WHERE l.pieza_id = c.id)
    ORDER BY ${lib ? `c.id IN (SELECT pieza_id FROM corpus_entidades WHERE entidad_id = ${Number(lib.id)}) DESC,` : ''} c.id DESC LIMIT ?`).all(limite) as any[]
  return filas.map((r) => ({ id: r.id, texto: `${r.titulo}\n${String(r.contenido).slice(0, 1800)}` }))
}

export const poblando = { activo: false, paso: '' }

/** Puebla la Librería: URLs primero (gratis) y después lee de a 12 textos con el modelo. Lo leído no se vuelve a leer. */
export async function poblarLibreria(db: Db, o: { limite?: number; ahora?: number } = {}): Promise<{ porUrl: number; leidas: number; nuevas: number; titulos: string[] }> {
  if (poblando.activo) throw new Error('Ya la estoy poblando')
  poblando.activo = true
  const ahora = o.ahora ?? Date.now()
  try {
    poblando.paso = 'repos y papers por su link'
    const titulos: string[] = []
    const porUrl = obrasPorUrl(db, ahora, titulos)
    const textos = textosCandidatos(db, o.limite ?? 120)
    let nuevas = 0
    for (let i = 0; i < textos.length; i += 12) {
      poblando.paso = `leyendo ${Math.min(i + 12, textos.length)} de ${textos.length} piezas`
      const tanda = textos.slice(i, i + 12)
      const { datos } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'libreria' }, SISTEMA_OBRAS, tanda.map((t, k) => `[${k + 1}]\n${t.texto}`).join('\n\n---\n\n'), { temperatura: 0.1, maxTokens: 3000 })
      for (const ob of Array.isArray(datos.obras) ? datos.obras : []) {
        const pieza = tanda[Number(ob.texto) - 1]?.id
        if (!TIPOS_OBRA.includes(ob.tipo) || !ob.titulo) continue
        const r = agregarObra(db, { tipo: ob.tipo, titulo: ob.titulo, autor: ob.autor ?? null, anio: ob.anio ?? null, piezas: pieza ? [pieza] : [], origen: 'mastropiero' }, ahora)
        if (r.nueva) (nuevas++, titulos.push(r.obra.titulo))
      }
      const ins = db.prepare('INSERT OR IGNORE INTO libreria_leidas (pieza_id, en) VALUES (?, ?)')
      for (const t of tanda) ins.run(t.id, ahora)
    }
    return { porUrl, leidas: textos.length, nuevas, titulos }
  } finally {
    poblando.activo = false
    poblando.paso = ''
  }
}

/** Para Mastropiero: qué está leyendo o viendo ahora (corto; vacío si nada). */
export function libreriaParaPrompt(db: Db): string {
  const en = listarObras(db, { estado: 'en_curso', limite: 6 })
  return en.length ? `Lo que está leyendo/viendo (${fechaLocal()}): ${en.map((o) => `${o.titulo}${o.autor ? ` (${o.autor})` : ''} [${o.tipo}]`).join('; ')}.` : ''
}

// ─── usar la Librería: expandir el corpus con cada obra ─────────────────

const TIPO_LEGIBLE: Record<string, string> = { libro: 'libro', pelicula: 'película', serie: 'serie', videojuego: 'videojuego', paper: 'paper', repositorio: 'repositorio' }

/** Inyectables (tests): bajar una URL y buscar en la web. */
let bajarTexto = async (url: string): Promise<{ titulo: string; texto: string } | null> => {
  if (/raw\.githubusercontent\.com/.test(url)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Deprocast/1.0' } })
      return r.ok ? { titulo: url.split('/').slice(3, 5).join('/'), texto: (await r.text()).slice(0, 20_000) } : null
    } catch { return null }
  }
  return leerPagina(url, 20_000)
}
let buscar = (db: Db, q: string) => buscarWeb(db, q, { n: 5 })
export function _probarExpansion(o: { bajar?: typeof bajarTexto; buscar?: typeof buscar }) {
  if (o.bajar) bajarTexto = o.bajar
  if (o.buscar) buscar = o.buscar
}

/** De dónde sacar la fuente de una obra: su README, su página, o la mejor página que aparezca buscándola (Wikipedia primero). */
async function fuenteDe(db: Db, o: Obra): Promise<{ url: string; titulo: string; texto: string } | null> {
  const gh = o.url ? /github\.com\/([\w.-]+)\/([\w.-]+)/.exec(o.url) : null
  if (gh) {
    for (const archivo of ['README.md', 'readme.md', 'README.rst', 'README']) {
      const url = `https://raw.githubusercontent.com/${gh[1]}/${gh[2].replace(/\.git$/, '')}/HEAD/${archivo}`
      const r = await bajarTexto(url)
      if (r?.texto?.trim()) return { url: o.url!, titulo: `${gh[1]}/${gh[2]} · README`, texto: r.texto }
    }
  }
  if (o.url) {
    const r = await bajarTexto(o.url)
    if (r?.texto?.trim()) return { url: o.url, titulo: r.titulo || o.titulo, texto: r.texto }
  }
  let rs: { url: string; titulo: string }[] = []
  try { rs = await buscar(db, `${o.titulo}${o.autor ? ` ${o.autor}` : ''} ${TIPO_LEGIBLE[o.tipo] ?? ''}`.trim()) } catch { /* sin buscador */ }
  for (const r of [...rs.filter((x) => /wikipedia\.org/.test(x.url)), ...rs.filter((x) => !/wikipedia\.org/.test(x.url))].slice(0, 3)) {
    const p = await bajarTexto(r.url)
    if (p?.texto && p.texto.length > 300) return { url: r.url, titulo: p.titulo || r.titulo, texto: p.texto }
  }
  return null
}

const SISTEMA_RESUMEN_OBRA = `Te paso una obra de la Librería del operador (libro, película, serie, videojuego, paper o repositorio) y el texto de una fuente sobre ella.
Forma: {"es_la_obra": boolean, "resumen": string}
- «es_la_obra»: false si la fuente habla de otra cosa (otra obra con nombre parecido, una página genérica).
- «resumen»: 2 o 3 oraciones en castellano: de qué trata y qué tiene de distintivo. Solo lo que dice la fuente.`

/**
 * Expande el corpus con una obra: busca su fuente, la guarda como pieza primaria (enlazada a la obra) y le escribe un
 * resumen corto. Si la fuente no es de esa obra, no guarda nada.
 */
export async function expandirObra(db: Db, id: number, ahora = Date.now()): Promise<{ obra: Obra; piezaId: number | null; aviso: string | null }> {
  const o = leerObra(db, id)
  if (!o) throw new Error(`No existe la obra ${id}`)
  const f = await fuenteDe(db, o)
  if (!f) {
    db.prepare('UPDATE obras SET expandida_en = ?, expansion = ? WHERE id = ?').run(ahora, 'sin fuente', id)
    return { obra: leerObra(db, id)!, piezaId: null, aviso: `No encontré una fuente para «${o.titulo}»${hayBuscadorWeb() ? '' : ' (sin clave de búsqueda web, solo pruebo con su link y Wikipedia)'}.` }
  }
  let resumen: string | null = null
  try {
    const { datos } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'libreria' }, SISTEMA_RESUMEN_OBRA,
      `OBRA: [${o.tipo}] ${o.titulo}${o.autor ? ` — ${o.autor}` : ''}${o.anio ? ` (${o.anio})` : ''}\n\nFUENTE (${f.url}):\n${f.texto.slice(0, 8000)}`, { temperatura: 0.2, maxTokens: 600 })
    if (datos.es_la_obra === false) {
      db.prepare('UPDATE obras SET expandida_en = ?, expansion = ? WHERE id = ?').run(ahora, 'fuente dudosa', id)
      return { obra: leerObra(db, id)!, piezaId: null, aviso: `Lo que encontré para «${o.titulo}» habla de otra cosa: no lo guardé.` }
    }
    resumen = typeof datos.resumen === 'string' ? datos.resumen.trim().slice(0, 600) : null
  } catch { /* sin resumen igual se guarda la fuente */ }
  asegurarFuente(db, { id: 'libreria', nombre: 'Librería', nivel: 'primaria', descripcion: 'Lo que se trae de las obras de tu Librería: READMEs, abstracts, fichas.' })
  const pieza = insertar(db, {
    fuente: 'libreria', nivel: 'primaria', tipo: 'referencia', estado: 'disponible',
    titulo: `${o.titulo}${o.autor ? ` — ${o.autor}` : ''} · ${TIPO_LEGIBLE[o.tipo] ?? o.tipo}`,
    contenido: [resumen ? `${resumen}\n` : '', f.texto].join('\n').trim(), url: f.url,
    etiquetas: ['libreria', o.tipo, ...o.etiquetas], origenId: `obra:${o.id}`, datos: { obraId: o.id, fuente: f.titulo },
  }, ahora) ?? (db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(`obra:${o.id}`) as any)?.id ?? null
  const piezas = [...new Set([...(pieza ? [pieza] : []), ...o.piezas])]
  db.prepare('UPDATE obras SET piezas = ?, resumen = COALESCE(?, resumen), expandida_en = ?, expansion = ?, url = COALESCE(url, ?) WHERE id = ?')
    .run(JSON.stringify(piezas), resumen, ahora, 'ok', f.url, id)
  return { obra: leerObra(db, id)!, piezaId: pieza, aviso: null }
}

export const expandiendo = { activo: false, hechas: 0, total: 0, actual: '' }

/** Las que más valen primero: en curso, quiero, valoradas 7+; después lo que él revisó. Las ya expandidas no se repiten. */
export function paraExpandir(db: Db, limite = 20): Obra[] {
  return listarObras(db, { limite: 5000 })
    .filter((o) => !o.expandidaEn && (o.estado === 'en_curso' || o.estado === 'quiero' || (o.valoracion ?? 0) >= 7 || o.revisada))
    .sort((a, b) => Number(b.estado === 'en_curso') - Number(a.estado === 'en_curso') || (b.valoracion ?? 0) - (a.valoracion ?? 0) || Number(b.estado === 'quiero') - Number(a.estado === 'quiero'))
    .slice(0, limite)
}

export async function expandirTanda(db: Db, limite = 20): Promise<{ hechas: number; sinFuente: number }> {
  if (expandiendo.activo) throw new Error('Ya estoy expandiendo')
  const os = paraExpandir(db, limite)
  Object.assign(expandiendo, { activo: true, hechas: 0, total: os.length, actual: '' })
  let sinFuente = 0
  try {
    for (const o of os) {
      expandiendo.actual = o.titulo
      try { if (!(await expandirObra(db, o.id)).piezaId) sinFuente++ } catch { sinFuente++ }
      expandiendo.hechas++
    }
  } finally {
    expandiendo.activo = false
    expandiendo.actual = ''
  }
  return { hechas: os.length - sinFuente, sinFuente }
}

/** Un cuaderno con lo que hay de una obra (su fuente y las piezas donde aparece), para preguntarle. */
export async function cuadernoDeObra(db: Db, id: number) {
  const o = leerObra(db, id)
  if (!o) throw new Error(`No existe la obra ${id}`)
  if (!o.piezas.length) throw new Error('Esa obra todavía no tiene nada en el corpus: expandila primero')
  const c = crearCuaderno(db, o.titulo, `De la Librería: ${TIPO_LEGIBLE[o.tipo] ?? o.tipo}${o.autor ? ` de ${o.autor}` : ''}.`)
  await sumarFuentes(db, c.id, { piezas: o.piezas })
  return c
}

/** Para la cabecera: cuántas hay, cuántas por revisar, en curso, valoradas y ya en el corpus. */
export function panorama(db: Db) {
  const n = (w: string) => (db.prepare(`SELECT COUNT(*) AS n FROM obras ${w}`).get() as any).n as number
  return {
    total: n(''), sinRevisar: n('WHERE revisada = 0'), enCurso: n(`WHERE estado = 'en_curso'`), quiero: n(`WHERE estado = 'quiero'`),
    valoradas: n('WHERE valoracion IS NOT NULL'), enCorpus: n(`WHERE expansion = 'ok'`), porExpandir: paraExpandir(db, 5000).length,
  }
}

/** El aviso de «poblé la Librería»: solo si entró algo, y con los títulos para poder verificarlo de un toque. */
export function avisoLibreria(r: { titulos: string[] }): string | null {
  if (!r.titulos.length) return null
  const n = r.titulos.length
  const lista = r.titulos.slice(0, 8).map((t) => `«${t}»`).join(', ')
  return `Sumé ${n} obra${n === 1 ? '' : 's'} a la Librería: ${lista}${n > 8 ? ` y ${n - 8} más` : ''}. Están marcadas para que las revises.`
}
