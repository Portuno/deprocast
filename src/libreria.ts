/**
 * Librería: sus obras como planillas. Libros, películas, series, videojuegos, papers y repositorios, cada uno con su
 * estado (quiero, en curso, terminado, abandonado, referencia), su valoración en la escala de la criba (1–12), notas,
 * etiquetas y de qué piezas del corpus sale. Él carga a mano; Mastropiero también la puebla desde el corpus (repos y
 * papers por su URL; el resto, leyendo lo que él dijo o guardó, solo obras nombradas con todas las letras) y esas
 * filas quedan marcadas para que las revise. Después se usa para expandir el corpus y recomendar tareas.
 */
import { fechaLocal, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'

export const TIPOS_OBRA = ['libro', 'pelicula', 'serie', 'videojuego', 'paper', 'repositorio'] as const
export type TipoObra = (typeof TIPOS_OBRA)[number]
export const ESTADOS_OBRA = ['quiero', 'en_curso', 'terminado', 'abandonado', 'referencia'] as const

export type Obra = {
  id: number; tipo: TipoObra; titulo: string; autor: string | null; anio: number | null; estado: string; valoracion: number | null
  url: string | null; notas: string | null; etiquetas: string[]; piezas: number[]; origen: 'operador' | 'mastropiero'; revisada: boolean
  creadaEn: number; editadaEn: number
}

const deFila = (r: any): Obra => ({
  id: r.id, tipo: r.tipo, titulo: r.titulo, autor: r.autor, anio: r.anio, estado: r.estado, valoracion: r.valoracion, url: r.url, notas: r.notas,
  etiquetas: r.etiquetas ? JSON.parse(r.etiquetas) : [], piezas: r.piezas ? JSON.parse(r.piezas) : [], origen: r.origen, revisada: !!r.revisada,
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
export function obrasPorUrl(db: Db, ahora = Date.now()): number {
  let nuevas = 0
  const filas = db.prepare(`SELECT id, titulo, url FROM corpus WHERE url LIKE '%github.com/%' OR url LIKE '%gitlab.com/%' OR url LIKE '%arxiv.org/%' OR url LIKE '%doi.org/%' OR url LIKE '%semanticscholar.org/%'`).all() as any[]
  for (const p of filas) {
    const gh = /(?:github|gitlab)\.com\/([\w.-]+)\/([\w.-]+)/.exec(p.url)
    if (gh) {
      const r = agregarObra(db, { tipo: 'repositorio', titulo: `${gh[1]}/${gh[2].replace(/\.git$/, '')}`, autor: gh[1], url: `https://${/gitlab/.test(p.url) ? 'gitlab' : 'github'}.com/${gh[1]}/${gh[2].replace(/\.git$/, '')}`, notas: p.titulo, piezas: [p.id], origen: 'mastropiero' }, ahora)
      if (r.nueva) nuevas++
    } else {
      const r = agregarObra(db, { tipo: 'paper', titulo: String(p.titulo).replace(/^(Hallazgo|Paper)\s*[·:]\s*/i, ''), url: p.url, piezas: [p.id], origen: 'mastropiero' }, ahora)
      if (r.nueva) nuevas++
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
      ${lib ? `EXISTS (SELECT 1 FROM json_each(c.entidades) WHERE value = ${Number(lib.id)}) OR` : ''}
      c.contenido LIKE '%libro%' OR c.contenido LIKE '%novela%' OR c.contenido LIKE '%película%' OR c.contenido LIKE '%pelicula%' OR c.contenido LIKE '%serie %'
      OR c.contenido LIKE '%videojuego%' OR c.contenido LIKE '%film%' OR c.contenido LIKE '%book%' OR c.contenido LIKE '%paper%' OR c.contenido LIKE '%ensayo%')
    AND NOT EXISTS (SELECT 1 FROM libreria_leidas l WHERE l.pieza_id = c.id)
    ORDER BY ${lib ? `EXISTS (SELECT 1 FROM json_each(c.entidades) WHERE value = ${Number(lib.id)}) DESC,` : ''} c.id DESC LIMIT ?`).all(limite) as any[]
  return filas.map((r) => ({ id: r.id, texto: `${r.titulo}\n${String(r.contenido).slice(0, 1800)}` }))
}

export const poblando = { activo: false, paso: '' }

/** Puebla la Librería: URLs primero (gratis) y después lee de a 12 textos con el modelo. Lo leído no se vuelve a leer. */
export async function poblarLibreria(db: Db, o: { limite?: number; ahora?: number } = {}): Promise<{ porUrl: number; leidas: number; nuevas: number }> {
  if (poblando.activo) throw new Error('Ya la estoy poblando')
  poblando.activo = true
  const ahora = o.ahora ?? Date.now()
  try {
    poblando.paso = 'repos y papers por su link'
    const porUrl = obrasPorUrl(db, ahora)
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
        if (r.nueva) nuevas++
      }
      const ins = db.prepare('INSERT OR IGNORE INTO libreria_leidas (pieza_id, en) VALUES (?, ?)')
      for (const t of tanda) ins.run(t.id, ahora)
    }
    return { porUrl, leidas: textos.length, nuevas }
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
