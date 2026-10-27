/**
 * Apps conectadas: otras apps suyas (Morpheon, la de sueños, y las que vengan) le hablan a Deprocast con un token.
 * - El token se ve UNA vez, al crearla; acá queda su hash (SHA-256) y el prefijo para reconocerlo. Se compara en tiempo
 *   constante y se puede revocar. Cada app tiene permisos por tipo (suenos, eventos, y leer: la puerta MCP).
 * - Las rutas de apps (/api/apps/…) van con «Authorization: Bearer <token>», sin la cookie de la pantalla: nada más.
 */
import crypto from 'node:crypto'
import { json, type Db } from './db.ts'
import { asegurarFuente, insertar } from './corpus.ts'

export const PERMISOS = ['suenos', 'eventos', 'leer'] as const
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

/** Un evento genérico de una app (para las que vengan): entra al corpus como suyo, con la app de etiqueta. */
export function recibirEvento(db: Db, app: App, e: { tipo?: string; titulo?: string; texto?: string; fecha?: string; datos?: unknown }, ahora = Date.now()): { piezaId: number } {
  const texto = String(e.texto ?? '').trim()
  const datos = e.datos && typeof e.datos === 'object' ? JSON.stringify(e.datos).slice(0, 4000) : ''
  if (!texto && !datos) throw new Error('El evento necesita texto o datos')
  const fuente = { id: `app-${app.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`, nombre: `App · ${app.nombre}`, nivel: 'propia' as const, descripcion: `Lo que manda ${app.nombre} (app conectada).` }
  asegurarFuente(db, fuente)
  const tipo = String(e.tipo ?? 'evento').slice(0, 40)
  const fecha = e.fecha && /^\d{4}-\d{2}-\d{2}/.test(e.fecha) ? e.fecha.slice(0, 10) : undefined
  const id = insertar(db, {
    fuente: fuente.id, nivel: 'propia', titulo: `${app.nombre} · ${String(e.titulo ?? tipo).slice(0, 120)}`, contenido: [texto, datos ? `Datos: ${datos}` : ''].filter(Boolean).join('\n\n'),
    fecha, etiquetas: [app.nombre, tipo], estado: 'disponible', origenId: `app:${app.id}:${ahora}:${crypto.randomBytes(3).toString('hex')}`, meta: { app: app.nombre, tipo },
  }, ahora)!
  return { piezaId: id }
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
