/**
 * Apps conectadas: otras apps suyas (Morpheon, la de sueños, y las que vengan) le hablan a Deprocast con un token.
 * - El token se ve UNA vez, al crearla; acá queda su hash (SHA-256) y el prefijo para reconocerlo. Se compara en tiempo
 *   constante y se puede revocar. Cada app tiene permisos por tipo: suenos, eventos, leer (la puerta MCP), cargar
 *   (documentos y notas al corpus) y mensaje (hablarle a Mastropiero). Con cargar y mensaje, un agente de afuera (un
 *   bot que usa su propia cuenta de Deprocast, por ejemplo) maneja su información adentro.
 * - Las rutas de apps (/api/apps/…) van con «Authorization: Bearer <token>», sin la cookie de la pantalla: nada más.
 */
import crypto from 'node:crypto'
import { json, type Db } from './db.ts'
import { asegurarFuente, corregirPieza, insertar, piezaPorOrigen, type Nivel } from './corpus.ts'
import { buscadorCacheado } from './entidades.ts'

export const PERMISOS = ['suenos', 'eventos', 'leer', 'cargar', 'mensaje'] as const
export type Permiso = (typeof PERMISOS)[number]
export type App = { id: number; nombre: string; prefijo: string; permisos: Permiso[]; creadaEn: number; ultimaVez: number | null; usos: number; revocadaEn: number | null }

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex')
const deFila = (r: any): App => ({ id: r.id, nombre: r.nombre, prefijo: r.prefijo, permisos: json<Permiso[]>(r.permisos, []) ?? [], creadaEn: r.creada_en, ultimaVez: r.ultima_vez, usos: r.usos, revocadaEn: r.revocada_en })

export function listarApps(db: Db): App[] {
  return (db.prepare('SELECT * FROM apps_conectadas ORDER BY revocada_en IS NOT NULL, id DESC').all() as any[]).map(deFila)
}

/** Da de alta una app. El token vuelve solo esta vez: no se guarda. */
export function crearApp(db: Db, nombre: string, permisos: string[] = ['suenos'], ahora = Date.now()): { app: App; token: string } {
  const n = String(nombre ?? '').trim().slice(0, 60)
  if (n.length < 2) throw new Error('¿Cómo se llama la app?')
  const ps = [...new Set(permisos.filter((p): p is Permiso => (PERMISOS as readonly string[]).includes(p)))]
  if (!ps.length) throw new Error(`Permisos posibles: ${PERMISOS.join(', ')}`)
  const token = `dpc_${crypto.randomBytes(32).toString('base64url')}`
  const id = Number(db.prepare('INSERT INTO apps_conectadas (nombre, prefijo, token_hash, permisos, creada_en) VALUES (?, ?, ?, ?, ?)')
    .run(n, token.slice(0, 10), hash(token), JSON.stringify(ps), ahora).lastInsertRowid)
  return { app: deFila(db.prepare('SELECT * FROM apps_conectadas WHERE id = ?').get(id)), token }
}

export function revocarApp(db: Db, id: number, ahora = Date.now()) {
  if (!db.prepare('UPDATE apps_conectadas SET revocada_en = ? WHERE id = ? AND revocada_en IS NULL').run(ahora, id).changes) throw new Error('Esa app no existe o ya estaba revocada')
}

/**
 * La app del pedido («Authorization: Bearer dpc_…»), si el token es válido, no está revocado y tiene el permiso.
 * null si no (el servidor contesta 401 o 403).
 */
export function autenticarApp(db: Db, autorizacion: string | undefined, permiso?: Permiso, ahora = Date.now()): { app: App | null; motivo: 'sin_token' | 'invalido' | 'sin_permiso' | null } {
  const m = /^Bearer\s+(dpc_[A-Za-z0-9_-]{20,100})\s*$/.exec(String(autorizacion ?? ''))
  if (!m) return { app: null, motivo: 'sin_token' }
  const token = m[1]
  const h = Buffer.from(hash(token), 'hex')
  const filas = db.prepare('SELECT * FROM apps_conectadas WHERE prefijo = ? AND revocada_en IS NULL').all(token.slice(0, 10)) as any[]
  const fila = filas.find((f) => { const b = Buffer.from(String(f.token_hash), 'hex'); return b.length === h.length && crypto.timingSafeEqual(b, h) })
  if (!fila) return { app: null, motivo: 'invalido' }
  const app = deFila(fila)
  if (permiso && !app.permisos.includes(permiso)) return { app: null, motivo: 'sin_permiso' }
  db.prepare('UPDATE apps_conectadas SET ultima_vez = ?, usos = usos + 1 WHERE id = ?').run(ahora, app.id)
  return { app, motivo: null }
}

/** La fuente del corpus de una app (una por app: «App · Nombre»). */
function fuenteDeApp(db: Db, app: App) {
  const fuente = { id: `app-${app.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`, nombre: `App · ${app.nombre}`, nivel: 'propia' as const, descripcion: `Lo que manda ${app.nombre} (app conectada).` }
  asegurarFuente(db, fuente)
  return fuente
}

/** Un evento genérico de una app (para las que vengan): entra al corpus como suyo, con la app de etiqueta. */
export function recibirEvento(db: Db, app: App, e: { tipo?: string; titulo?: string; texto?: string; fecha?: string; datos?: unknown }, ahora = Date.now()): { piezaId: number } {
  const texto = String(e.texto ?? '').trim()
  const datos = e.datos && typeof e.datos === 'object' ? JSON.stringify(e.datos).slice(0, 4000) : ''
  if (!texto && !datos) throw new Error('El evento necesita texto o datos')
  const fuente = fuenteDeApp(db, app)
  const tipo = String(e.tipo ?? 'evento').slice(0, 40)
  const fecha = e.fecha && /^\d{4}-\d{2}-\d{2}/.test(e.fecha) ? e.fecha.slice(0, 10) : undefined
  const id = insertar(db, {
    fuente: fuente.id, nivel: 'propia', titulo: `${app.nombre} · ${String(e.titulo ?? tipo).slice(0, 120)}`, contenido: [texto, datos ? `Datos: ${datos}` : ''].filter(Boolean).join('\n\n'),
    fecha, etiquetas: [app.nombre, tipo], estado: 'disponible', origenId: `app:${app.id}:${ahora}:${crypto.randomBytes(3).toString('hex')}`, meta: { app: app.nombre, tipo },
  }, ahora)!
  return { piezaId: id }
}

// ─── cargar: documentos y notas de un agente de afuera ─────────────────

/** Cómo puede nombrar el nivel una app (los del corpus y los de todos los días). Sin nivel: «generada». */
const NIVEL_DE: Record<string, Nivel> = {
  propia: 'propia', mia: 'propia', primaria: 'primaria', fuente: 'primaria', investigacion: 'investigacion', generada: 'generada', generado: 'generada',
}
export const MAX_CARGAS = 50
export type Carga = { id?: unknown; titulo?: unknown; contenido?: unknown; resumen?: unknown; proyecto?: unknown; tipo?: unknown; nivel?: unknown; fuentes?: unknown; fecha?: unknown; etiquetas?: unknown; url?: unknown }
export type Cargado = { piezaId: number; estado: 'nueva' | 'corregida' | 'igual'; proyecto: { id: number; nombre: string } | null; avisos: string[] }

/**
 * Un documento o una nota de una app al corpus. Entra crudo (la liga lo procesa: entidades, etiquetas, vectores) y
 * atado al proyecto si se nombra uno que existe (aunque venga mal escrito). Con «id», la misma carga reenviada no se
 * duplica: si cambió el texto, corrige la pieza (guarda la versión anterior); sin «id», el mismo texto no entra dos veces.
 */
export function cargarDeApp(db: Db, app: App, c: Carga, ahora = Date.now()): Cargado {
  const titulo = String(c.titulo ?? '').trim().slice(0, 200)
  const contenido = String(c.contenido ?? '').trim()
  if (titulo.length < 2) throw new Error('Falta el título')
  if (!contenido) throw new Error(`«${titulo}» no tiene contenido`)
  if (contenido.length > 200_000) throw new Error(`«${titulo}» es demasiado largo (más de 200.000 caracteres): partilo`)
  const clave = String(c.nivel ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const nivel = clave ? NIVEL_DE[clave] : 'generada'
  if (!nivel) throw new Error(`Nivel desconocido «${c.nivel}»: va fuente, investigacion o generado`)
  const avisos: string[] = []
  const lista = (v: unknown, max: number, largo: number) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x ?? '').trim().slice(0, largo)).filter(Boolean).slice(0, max)
  const fuentes = lista(c.fuentes, 30, 500)
  const etiquetas = lista(c.etiquetas, 10, 40)
  const tipo = String(c.tipo ?? 'nota').trim().toLowerCase().slice(0, 30) || 'nota'
  let fecha: string | undefined
  if (c.fecha) { if (/^\d{4}-\d{2}-\d{2}/.test(String(c.fecha))) fecha = String(c.fecha).slice(0, 10); else avisos.push(`La fecha «${c.fecha}» no es AAAA-MM-DD: quedó sin fecha`) }
  let proyecto: Cargado['proyecto'] = null
  if (c.proyecto && String(c.proyecto).trim()) {
    const nombre = String(c.proyecto).trim().slice(0, 120)
    const p = buscadorCacheado(db).parecida(nombre)
    if (p) {
      proyecto = { id: p.id, nombre: p.nombre }
      if (p.por !== 'igual') avisos.push(`«${nombre}» se tomó como «${p.nombre}»`)
    } else avisos.push(`No existe «${nombre}»: quedó sin proyecto (pedile a Mastropiero que lo cree)`)
  }
  const resumen = String(c.resumen ?? '').trim().slice(0, 1000)
  const texto = [resumen ? `> ${resumen.replace(/\n/g, '\n> ')}` : '', contenido, fuentes.length ? `Fuentes:\n${fuentes.map((f) => `- ${f}`).join('\n')}` : ''].filter(Boolean).join('\n\n')
  const url = String(c.url ?? '').trim() || fuentes.find((f) => /^https?:\/\//i.test(f)) || null
  const origenId = c.id != null && String(c.id).trim() ? `app:${app.id}:id:${String(c.id).trim().slice(0, 120)}` : `app:${app.id}:${hash(`${titulo}\n${texto}`).slice(0, 24)}`
  const meta = { app: app.nombre, tipo, ...(resumen ? { resumen } : {}), ...(fuentes.length ? { fuentes } : {}) }
  const ya = piezaPorOrigen(db, origenId)
  if (ya) {
    if (ya.contenido.trim() === texto && ya.titulo === titulo) return { piezaId: ya.id, estado: 'igual', proyecto, avisos }
    if (ya.contenido.trim() !== texto) corregirPieza(db, ya.id, texto, `${app.nombre} mandó una versión nueva`, `app:${app.nombre}`, ahora)
    db.prepare(`UPDATE corpus SET titulo = ?, fecha = COALESCE(?, fecha), url = COALESCE(?, url), entidades = COALESCE(?, entidades), meta = json_patch(COALESCE(meta, '{}'), ?) WHERE id = ?`)
      .run(titulo, fecha ?? null, url, proyecto ? JSON.stringify([proyecto.id]) : null, JSON.stringify(meta), ya.id)
    return { piezaId: ya.id, estado: 'corregida', proyecto, avisos }
  }
  const fuente = fuenteDeApp(db, app)
  const id = insertar(db, {
    fuente: fuente.id, nivel, titulo, contenido: texto, fecha, url, autor: app.nombre, etiquetas: [...new Set([app.nombre, tipo, ...etiquetas])],
    entidades: proyecto ? [proyecto.id] : undefined, estado: 'crudo', origenId, meta,
  }, ahora)
  if (!id) throw new Error(`No se pudo guardar «${titulo}»`)
  return { piezaId: id, estado: 'nueva', proyecto, avisos }
}

/** Una o varias cargas (hasta MAX_CARGAS): cada una con su resultado o su error, sin que una mala frene a las demás. */
export function cargarVarias(db: Db, app: App, cuerpo: unknown, ahora = Date.now()): { resultados: (Cargado | { error: string })[] } | Cargado {
  const b = cuerpo as any
  const items = Array.isArray(b) ? b : Array.isArray(b?.items) ? b.items : null
  if (!items) return cargarDeApp(db, app, b ?? {}, ahora)
  if (!items.length) throw new Error('No mandaste nada para cargar')
  if (items.length > MAX_CARGAS) throw new Error(`Hasta ${MAX_CARGAS} por pedido (mandaste ${items.length})`)
  return { resultados: items.map((x: Carga) => { try { return cargarDeApp(db, app, x ?? {}, ahora) } catch (e) { return { error: e instanceof Error ? e.message : String(e) } } }) }
}

// ─── mensaje: hablarle a Mastropiero ────────────────────────────────────

/** Cuánto espera la respuesta antes de contestar «pensando» (y que la app la pida después con «desde»). */
export const ESPERA_MENSAJE_MS = 90_000
const recientes = new Map<string, number>()
/** Los «desde» que se le dieron a cada app (una hora): con eso, y con nada más, puede pedir lo que contestó después. */
const desdesDados = new Map<string, number>()
export function desdeDeLaApp(app: App, desde: number, ahora = Date.now()): boolean {
  for (const [k, t] of desdesDados) if (ahora - t > 3_600_000) desdesDados.delete(k)
  return desdesDados.has(`${app.id}:${desde}`)
}

/** Lo que dijo e hizo Mastropiero en la charla después del mensaje «desde». */
export async function respuestaDesde(db: Db, desde: number) {
  const ch = await import('./chat/index.ts')
  const { esAccion } = await import('./telegram.ts')
  const c = ch.conversacionHoy(db)
  const nuevos = ch.mensajes(db, c.id, desde)
  const error = nuevos.find((m) => m.rol === 'error')
  return {
    pensando: ch.estaPensando(c.id),
    respuesta: nuevos.filter((m) => m.rol === 'asistente' && m.texto).map((m) => m.texto).join('\n\n'),
    hechas: [...new Set(nuevos.filter((m) => m.rol === 'herramienta' && m.resumen && esAccion(m.herramienta)).map((m) => m.resumen!))],
    error: error?.texto ?? null,
    ultimo: nuevos.at(-1)?.id ?? desde,
  }
}

/**
 * Un mensaje de una app a Mastropiero, en la charla del día, como si lo escribiera el dueño de la cuenta (para un bot
 * que tiene su propio Deprocast, lo es). Espera la respuesta hasta ESPERA_MENSAJE_MS; si tarda más, vuelve «pensando»
 * con «desde» para pedirla después. Si ya está contestando otro turno, «ocupado». Con «id», un reintento no se manda dos veces.
 */
export async function mensajeDeApp(db: Db, app: App, b: { texto?: unknown; id?: unknown }, o: { esperaMs?: number; ahora?: number } = {}) {
  const texto = String(b.texto ?? '').trim()
  if (!texto) throw new Error('¿Qué le digo? Falta «texto»')
  if (texto.length > 20_000) throw new Error('El mensaje es demasiado largo (más de 20.000 caracteres): mandalo como carga')
  const ahora = o.ahora ?? Date.now()
  for (const [k, t] of recientes) if (ahora - t > 600_000) recientes.delete(k)
  const clave = b.id != null && String(b.id).trim() ? `${app.id}:${String(b.id).trim()}` : null
  if (clave && recientes.has(clave)) return { estado: 'repetido' as const }
  const ch = await import('./chat/index.ts')
  const c = ch.conversacionHoy(db)
  if (ch.estaPensando(c.id)) return { estado: 'ocupado' as const }
  if (clave) recientes.set(clave, ahora)
  const desde = ch.mensajes(db, c.id).at(-1)?.id ?? 0
  desdesDados.set(`${app.id}:${desde}`, ahora)
  const estilo = `Este mensaje llega por la API, de la app «${app.nombre}» (un agente que usa esta cuenta), no por la pantalla. Contestá en texto llano y corto: qué hiciste, con los ids de lo que creaste o cambiaste; si falta un dato, pedilo en una línea.`
  const turno = ch.enviar(db, c.id, texto, { canal: estilo })
  turno.catch(() => {})
  let rapida: string | undefined
  const listo = await Promise.race([turno.then((r) => { rapida = r?.rapida; return true }, () => true), new Promise<boolean>((ok) => setTimeout(ok, o.esperaMs ?? ESPERA_MENSAJE_MS, false))])
  const r = await respuestaDesde(db, desde)
  if (!listo) return { estado: 'pensando' as const, desde, ...r }
  return { estado: 'listo' as const, desde, ...r, respuesta: rapida || r.respuesta }
}

/** Un pedido multipart/form-data, sin dependencias: los campos de texto y los archivos. */
export function leerMultipart(cuerpo: Buffer, tipo: string): { campos: Record<string, string>; archivos: Record<string, { nombre: string; tipo: string; datos: Buffer }> } {
  const b = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(tipo)
  if (!b) throw new Error('multipart sin boundary')
  const limite = Buffer.from(`--${(b[1] ?? b[2]).trim()}`)
  const campos: Record<string, string> = {}
  const archivos: Record<string, { nombre: string; tipo: string; datos: Buffer }> = {}
  let i = cuerpo.indexOf(limite)
  while (i !== -1) {
    const desde = i + limite.length
    if (cuerpo.slice(desde, desde + 2).toString() === '--') break
    const fin = cuerpo.indexOf(limite, desde)
    if (fin === -1) break
    const parte = cuerpo.slice(desde + 2, fin - 2) // sin el \r\n del principio y del final
    const corte = parte.indexOf('\r\n\r\n')
    if (corte !== -1) {
      const cab = parte.slice(0, corte).toString('utf8')
      const datos = parte.slice(corte + 4)
      const nombre = /name="([^"]*)"/i.exec(cab)?.[1]
      const archivo = /filename="([^"]*)"/i.exec(cab)?.[1]
      if (nombre != null) {
        if (archivo != null) archivos[nombre] = { nombre: archivo || 'archivo', tipo: /content-type:\s*([^\r\n]+)/i.exec(cab)?.[1]?.trim() ?? 'application/octet-stream', datos }
        else campos[nombre] = datos.toString('utf8')
      }
    }
    i = fin
  }
  return { campos, archivos }
}
