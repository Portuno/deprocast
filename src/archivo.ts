/**
 * El Archivo (Fragua #320): un solo lugar para ver todo lo que Deprocast generó, en vez de buscarlo en el hilo de
 * WhatsApp, en Drive, en el Taller o en el chat. Los PDF y las presentaciones que pidió por el chat, las obras del
 * Taller (imágenes, audios, podcasts, videos, juegos, visuales), los informes de los encargos programados, los aportes
 * de los ayudantes y las guías de los cuadernos.
 *
 * Cada fila de `generados` es un puntero: al adjunto (que puede vivir ya solo en su Drive), a la obra del Taller, a la
 * pieza del corpus o al texto del informe. Nunca se copia un archivo. Lo nuevo se registra solo cuando se arma (el
 * chat, los programados); lo que vive en otro lado (el Taller, los aportes, los cuadernos) se suma al listar, sin
 * duplicar, por su clave.
 */
import fs from 'node:fs'
import path from 'node:path'
import { json, type Db } from './db.ts'

export type TipoGenerado = 'pdf' | 'presentacion' | 'imagen' | 'audio' | 'video' | 'informe' | 'planilla' | 'documento' | 'cuaderno' | 'aporte' | 'juego' | 'pagina'
export type OrigenGenerado = 'chat' | 'taller' | 'programado' | 'ayudante' | 'cuaderno'

export const TIPOS_GENERADO: Record<TipoGenerado, string> = {
  pdf: 'PDF', presentacion: 'Presentación', imagen: 'Imagen', audio: 'Audio', video: 'Video', informe: 'Informe', planilla: 'Planilla',
  documento: 'Documento', cuaderno: 'Cuaderno', aporte: 'Aporte', juego: 'Juego', pagina: 'Página',
}
export const ORIGENES_GENERADO: Record<OrigenGenerado, string> = { chat: 'Pedido en el chat', taller: 'Taller', programado: 'Encargo programado', ayudante: 'Ayudante de una primaria', cuaderno: 'Cuaderno' }

export type NuevoGenerado = {
  clave: string; tipo: TipoGenerado; titulo: string; origen: OrigenGenerado; nombre?: string | null; mime?: string | null
  origenRef?: string | null; origenTexto?: string | null; adjunto?: string | null; artefactoId?: number | null; piezaId?: number | null
  texto?: string | null; resumen?: string | null; entidadId?: number | null; canal?: string | null; creadoEn?: number
}

export type Generado = {
  id: number; clave: string; tipo: TipoGenerado; titulo: string; nombre: string | null; mime: string | null; origen: OrigenGenerado
  origenRef: string | null; origenTexto: string | null; adjunto: string | null; artefactoId: number | null; piezaId: number | null
  resumen: string | null; entidadId: number | null; entidad: string | null; canal: string | null; creadoEn: number
  /** Para verlo o bajarlo: el archivo (adjunto u obra), o null si es un texto (se baja como .md). */
  url: string | null
  /** Una miniatura (solo imágenes). */
  miniatura: string | null
  /** El link de su Drive, si ya subió. */
  drive: string | null
}

/** Del nombre del archivo, el tipo. */
export function tipoDeArchivo(nombre: string): TipoGenerado {
  const ext = path.extname(nombre).slice(1).toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'pptx' || ext === 'key' || ext === 'odp') return 'presentacion'
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return 'planilla'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'imagen'
  if (['mp3', 'ogg', 'oga', 'm4a', 'wav'].includes(ext)) return 'audio'
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video'
  if (ext === 'html') return 'pagina'
  return 'documento'
}

/** La primera línea con algo (sin marcas de Markdown): lo que se ve en la tarjeta. */
export function primeraLinea(texto: string | null | undefined, largo = 160): string | null {
  const l = String(texto ?? '').split('\n').map((x) => x.replace(/^[#>\-*\d.\s⏰]+/, '').replace(/[*_`]/g, '').trim()).find((x) => x.length > 2)
  return l ? (l.length > largo ? `${l.slice(0, largo - 1)}…` : l) : null
}

/** El proyecto que nombra un texto (para filtrar por proyecto), o null. Nunca hace fallar el registro. */
async function entidadDe(db: Db, texto: string): Promise<number | null> {
  try { return (await import('./ayudantes.ts')).entidadEnTexto(db, texto) } catch { return null }
}

/** Registra algo generado (o lo actualiza si ya estaba con esa clave: un reenvío, un título mejor). Devuelve su id. */
export function registrarGenerado(db: Db, g: NuevoGenerado): number {
  db.prepare(`INSERT INTO generados (clave, tipo, titulo, nombre, mime, origen, origen_ref, origen_texto, adjunto, artefacto_id, pieza_id, texto, resumen, entidad_id, canal, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (clave) DO UPDATE SET titulo = excluded.titulo, canal = COALESCE(excluded.canal, generados.canal), resumen = COALESCE(excluded.resumen, generados.resumen),
      texto = COALESCE(excluded.texto, generados.texto), entidad_id = COALESCE(generados.entidad_id, excluded.entidad_id)`)
    .run(g.clave, g.tipo, g.titulo.slice(0, 200), g.nombre ?? null, g.mime ?? null, g.origen, g.origenRef ?? null, g.origenTexto?.slice(0, 500) ?? null,
      g.adjunto ?? null, g.artefactoId ?? null, g.piezaId ?? null, g.texto?.slice(0, 60_000) ?? null, (g.resumen ?? primeraLinea(g.texto))?.slice(0, 400) ?? null,
      g.entidadId ?? null, g.canal ?? null, g.creadoEn ?? Date.now())
  return (db.prepare('SELECT id FROM generados WHERE clave = ?').get(g.clave) as { id: number }).id
}

/** Lo mismo, buscando el proyecto en el título y el pedido (para lo que llega del chat o de un encargo). */
export async function registrarConProyecto(db: Db, g: NuevoGenerado): Promise<number | null> {
  try {
    const entidadId = g.entidadId ?? (await entidadDe(db, `${g.titulo} ${g.origenTexto ?? ''}`))
    return registrarGenerado(db, { ...g, entidadId })
  } catch (e) {
    console.error('  archivo:', e instanceof Error ? e.message : e)
    return null
  }
}

// ─── lo que vive en otro lado: se suma al listar, sin duplicar ─────────────

/** El archivo que representa una obra del Taller y su tipo en el Archivo. */
function obraComoGenerado(a: { tipo: string; archivos: string[]; meta: Record<string, any> }): { tipo: TipoGenerado; archivo: string | null } {
  const de = (re: RegExp) => a.archivos.find((n) => re.test(n)) ?? null
  const mp4 = de(/\.mp4$/i), mp3 = de(/\.(mp3|ogg|wav)$/i), img = de(/\.(png|jpe?g|webp)$/i), html = de(/^index\.html$/i)
  if (mp4) return { tipo: 'video', archivo: mp4 }
  if (mp3) return { tipo: 'audio', archivo: mp3 }
  if (a.tipo === 'juego' && html) return { tipo: 'juego', archivo: html }
  if (img) return { tipo: 'imagen', archivo: img }
  if (html) return { tipo: 'pagina', archivo: html }
  return { tipo: 'documento', archivo: a.archivos[0] ?? null }
}

/**
 * Suma lo que se generó en otro lado y todavía no está: las obras listas del Taller (su última versión cuenta como
 * una obra aparte de las anteriores, como en la Librería: cada versión es un archivo), los aportes de los ayudantes,
 * las guías de los cuadernos y el último informe de cada encargo (los de antes del Archivo; los nuevos se registran
 * al correr). Devuelve cuántos sumó.
 */
export function sumarLoDeOtrosLados(db: Db): number {
  let n = 0
  const ya = db.prepare('SELECT 1 FROM generados WHERE clave = ?')
  const tabla = <T>(sql: string, ...args: unknown[]): T[] => { try { return db.prepare(sql).all(...(args as any[])) as T[] } catch { return [] } }

  for (const a of tabla<any>(`SELECT id, tipo, titulo, pedido, archivos, meta, creado_en FROM artefactos WHERE estado = 'listo' AND id NOT IN (SELECT artefacto_id FROM generados WHERE artefacto_id IS NOT NULL)`)) {
    const archivos = json<string[]>(a.archivos, []), meta = json<Record<string, any>>(a.meta, {})
    const o = obraComoGenerado({ tipo: a.tipo, archivos, meta })
    registrarGenerado(db, {
      clave: `artefacto:${a.id}`, tipo: o.tipo, titulo: a.titulo, nombre: o.archivo, origen: meta.cuadernoId ? 'cuaderno' : 'taller', origenRef: meta.cuadernoId ? `cuaderno:${meta.cuadernoId}` : `artefacto:${a.id}`,
      origenTexto: a.pedido, artefactoId: a.id, resumen: meta.podcast ? `Podcast · ${Math.round((Number(meta.duracion) || 0) / 60)} min` : primeraLinea(a.pedido),
      entidadId: Number(meta.entidad) || null, canal: meta.entrega?.whatsapp ? 'WhatsApp' : null, creadoEn: a.creado_en,
    })
    n++
  }

  for (const p of tabla<any>(`SELECT c.id, c.titulo, c.contenido, c.meta, c.creado_en, m.titulo AS primaria, m.entidad_id FROM corpus c LEFT JOIN misiones m ON m.id = json_extract(c.meta, '$.primaria') WHERE json_extract(c.meta, '$.aporte') = 1 AND c.id NOT IN (SELECT pieza_id FROM generados WHERE pieza_id IS NOT NULL)`)) {
    const meta = json<Record<string, any>>(p.meta, {})
    registrarGenerado(db, {
      clave: `aporte:${p.id}`, tipo: 'aporte', titulo: p.titulo, origen: 'ayudante', origenRef: meta.primaria ? `mision:${meta.primaria}` : null,
      origenTexto: p.primaria ? `Para la primaria «${p.primaria}»${meta.agente ? `, de ${meta.agente}` : ''}` : meta.agente ?? null, piezaId: p.id, texto: p.contenido, entidadId: p.entidad_id ?? null, creadoEn: p.creado_en,
    })
    n++
  }

  for (const x of tabla<any>(`SELECT n.id, n.texto, n.creada_en, c.id AS cuaderno, c.titulo FROM cuaderno_notas n JOIN cuadernos c ON c.id = n.cuaderno_id WHERE n.tipo = 'guia'`)) {
    if (ya.get(`cuaderno:${x.id}`)) continue
    registrarGenerado(db, { clave: `cuaderno:${x.id}`, tipo: 'cuaderno', titulo: `Guía · ${x.titulo}`, origen: 'cuaderno', origenRef: `cuaderno:${x.cuaderno}`, origenTexto: `Del cuaderno «${x.titulo}»`, texto: x.texto, creadoEn: x.creada_en })
    n++
  }

  for (const p of tabla<any>(`SELECT id, titulo, pedido, ultimo, resultado FROM programados WHERE resultado IS NOT NULL AND ultimo IS NOT NULL`)) {
    if (ya.get(`programado:${p.id}:${p.ultimo}`)) continue
    registrarGenerado(db, { clave: `programado:${p.id}:${p.ultimo}`, tipo: 'informe', titulo: p.titulo, origen: 'programado', origenRef: `programado:${p.id}`, origenTexto: p.pedido, texto: p.resultado, creadoEn: p.ultimo })
    n++
  }
  return n
}

// ─── listar, ver, bajar, reenviar ───────────────────────────────────────────

const deFila = (db: Db, r: any): Generado => {
  let url: string | null = null, miniatura: string | null = null, drive: string | null = null
  if (r.adjunto) {
    url = `/adjuntos/${encodeURIComponent(r.adjunto)}`
    if (r.tipo === 'imagen') miniatura = `${url}?ancho=480`
    try {
      const d = db.prepare('SELECT a.link, c.link AS link_cola FROM adjuntos_drive a LEFT JOIN drive_cola c ON c.id = a.cola_id WHERE a.archivo = ?').get(r.adjunto) as { link: string | null; link_cola: string | null } | undefined
      drive = d?.link ?? d?.link_cola ?? null
    } catch { /* sin la tabla: nunca subió nada */ }
  } else if (r.artefacto_id && r.nombre) {
    url = `/taller/${r.artefacto_id}/${encodeURIComponent(r.nombre)}`
    if (r.tipo === 'imagen') miniatura = url
  }
  return {
    id: r.id, clave: r.clave, tipo: r.tipo, titulo: r.titulo, nombre: r.nombre, mime: r.mime, origen: r.origen, origenRef: r.origen_ref, origenTexto: r.origen_texto,
    adjunto: r.adjunto, artefactoId: r.artefacto_id, piezaId: r.pieza_id, resumen: r.resumen, entidadId: r.entidad_id, entidad: r.entidad ?? null, canal: r.canal,
    creadoEn: r.creado_en, url, miniatura, drive,
  }
}

export type FiltroArchivo = { q?: string | null; tipo?: string | null; origen?: string | null; entidad?: number | null; desde?: string | null; hasta?: string | null; limite?: number; saltar?: number }

/** Lo generado, lo más nuevo primero, con búsqueda por texto y filtros por tipo, origen, proyecto y fechas (AAAA-MM-DD). */
export function listarGenerados(db: Db, f: FiltroArchivo = {}) {
  sumarLoDeOtrosLados(db)
  const where: string[] = []
  const args: (string | number)[] = []
  const q = f.q?.trim()
  if (q) {
    for (const palabra of q.split(/\s+/).slice(0, 6)) {
      where.push(`(g.titulo LIKE ? OR g.nombre LIKE ? OR g.origen_texto LIKE ? OR g.resumen LIKE ? OR g.texto LIKE ? OR e.nombre LIKE ?)`)
      args.push(...Array(6).fill(`%${palabra}%`))
    }
  }
  const base = [...where]
  const baseArgs = [...args]
  if (f.tipo) where.push('g.tipo = ?'), args.push(f.tipo)
  if (f.origen) where.push('g.origen = ?'), args.push(f.origen)
  if (f.entidad) where.push('g.entidad_id = ?'), args.push(Number(f.entidad))
  const dia = (s: string | null | undefined, fin: boolean) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${fin ? '23:59:59.999' : '00:00:00'}`).getTime() : null)
  const desde = dia(f.desde, false), hasta = dia(f.hasta, true)
  if (desde != null) where.push('g.creado_en >= ?'), args.push(desde)
  if (hasta != null) where.push('g.creado_en <= ?'), args.push(hasta)
  const w = (xs: string[]) => (xs.length ? `WHERE ${xs.join(' AND ')}` : '')
  const desdeTabla = 'FROM generados g LEFT JOIN entidades e ON e.id = g.entidad_id'
  const limite = Math.min(Math.max(1, f.limite ?? 60), 200)
  const filas = db.prepare(`SELECT g.*, e.nombre AS entidad ${desdeTabla} ${w(where)} ORDER BY g.creado_en DESC, g.id DESC LIMIT ? OFFSET ?`).all(...args, limite, Math.max(0, f.saltar ?? 0)) as any[]
  const total = (db.prepare(`SELECT COUNT(*) AS n ${desdeTabla} ${w(where)}`).get(...args) as { n: number }).n
  // Los conteos para los filtros salen de la búsqueda (sin el filtro de tipo ni de proyecto): se ve cuánto hay de cada cosa.
  const tipos = Object.fromEntries((db.prepare(`SELECT g.tipo, COUNT(*) AS n ${desdeTabla} ${w(base)} GROUP BY g.tipo`).all(...baseArgs) as { tipo: string; n: number }[]).map((x) => [x.tipo, x.n]))
  const origenes = Object.fromEntries((db.prepare(`SELECT g.origen, COUNT(*) AS n ${desdeTabla} ${w(base)} GROUP BY g.origen`).all(...baseArgs) as { origen: string; n: number }[]).map((x) => [x.origen, x.n]))
  const proyectos = db.prepare(`SELECT e.id, e.nombre, COUNT(*) AS n ${desdeTabla} ${w([...base, 'e.id IS NOT NULL'])} GROUP BY e.id ORDER BY n DESC, e.nombre LIMIT 40`).all(...baseArgs) as { id: number; nombre: string; n: number }[]
  return { total, items: filas.map((r) => deFila(db, r)), tipos, origenes, proyectos }
}

/** Uno, con su texto entero (un informe, un aporte, una guía, el contenido de un PDF). */
export function leerGenerado(db: Db, id: number): (Generado & { texto: string | null }) | null {
  const r = db.prepare('SELECT g.*, e.nombre AS entidad FROM generados g LEFT JOIN entidades e ON e.id = g.entidad_id WHERE g.id = ?').get(id) as any
  return r ? { ...deFila(db, r), texto: r.texto ?? null } : null
}

/** Para bajar lo que es texto (un informe, un aporte, una guía): un .md con su título y de dónde salió. */
export function markdownDe(g: Generado & { texto: string | null }): { nombre: string; datos: Buffer } {
  const base = g.titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'generado'
  const cuando = new Date(g.creadoEn).toLocaleString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return { nombre: `${base}.md`, datos: Buffer.from(`# ${g.titulo}\n\n_${TIPOS_GENERADO[g.tipo] ?? g.tipo} · ${cuando}${g.origenTexto ? ` · ${g.origenTexto.replace(/\s+/g, ' ').slice(0, 200)}` : ''}_\n\n${g.texto ?? g.resumen ?? ''}\n`, 'utf8') }
}

/** Los bytes de un archivo generado: de acá, o de su Drive si acá ya no está. null si es un texto. */
export async function datosDe(db: Db, g: Generado): Promise<Buffer | null> {
  if (g.adjunto) {
    const { dirAdjuntos } = await import('./chat/adjuntos.ts')
    const local = path.join(dirAdjuntos(), path.basename(g.adjunto))
    if (fs.existsSync(local)) return fs.readFileSync(local)
    return (await import('./google/drive.ts')).medioDeAdjunto(db, g.adjunto).catch(() => null)
  }
  if (g.artefactoId && g.nombre) {
    const { carpeta } = await import('./taller.ts')
    const ruta = path.join(carpeta(g.artefactoId), path.basename(g.nombre))
    return fs.existsSync(ruta) ? fs.readFileSync(ruta) : null
  }
  return null
}

const MIME_DE: Record<string, string> = {
  pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', mp4: 'video/mp4', csv: 'text/csv', md: 'text/markdown', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/**
 * Lo vuelve a mandar a su WhatsApp: el archivo tal cual (un PDF, una presentación, una imagen, un audio), o el texto
 * de un informe, un aporte o una guía. Un juego o una página no se mandan: se abren desde el Archivo.
 */
export async function reenviarGenerado(db: Db, id: number): Promise<{ canal: string }> {
  const g = leerGenerado(db, id)
  if (!g) throw new Error(`No existe lo generado ${id}`)
  if (g.tipo === 'juego' || g.tipo === 'pagina') throw new Error('Un juego o una página no se manda: se abre desde el Archivo')
  const w = await import('./whatsapp.ts')
  const cerrado = 'No salió: la ventana de 24 horas de WhatsApp está cerrada (mandale cualquier cosa a Mastropiero y se abre) o no está vinculado.'
  const datos = await datosDe(db, g)
  if (datos) {
    const ext = path.extname(g.nombre ?? g.adjunto ?? '').slice(1).toLowerCase()
    const nombre = g.nombre && !/^\d+-/.test(g.nombre) ? g.nombre : `${g.titulo.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'archivo'}.${ext || 'bin'}`
    if (!(await w.archivoPorWhatsapp(db, datos, nombre, { mime: g.mime ?? MIME_DE[ext] ?? 'application/octet-stream', texto: `«${g.titulo}», del Archivo.` }))) throw new Error(cerrado)
  } else if (g.texto) {
    if (!(await w.decirPorWhatsapp(db, `${g.titulo}\n\n${g.texto}`))) throw new Error(cerrado)
  } else throw new Error('El archivo ya no está ni acá ni en su Drive')
  db.prepare('UPDATE generados SET canal = ? WHERE id = ?').run('WhatsApp', id)
  return { canal: 'WhatsApp' }
}
