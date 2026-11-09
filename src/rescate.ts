/**
 * El rescate de salvables (plan v38, fase 6; Fragua #157). Cada dispositivo nuevo pasa primero por acá: manda el
 * inventario de lo que trae (audios, fotos, notas, contactos, mensajes sin enviar…), sube cada cosa cruda y recién
 * cuando TODO está a salvo se procesa. A salvo = una copia en el servidor y otra en su Drive (si está conectado).
 * Si el proceso falla o el aparato se pierde a mitad de camino, el material no se pierde.
 *
 * Mientras un dispositivo está en rescate, lo que manda por voz o por mensaje también se guarda primero y se procesa
 * al cerrar. La copia del servidor se borra cuando el ítem ya se procesó y su copia del Drive está subida; sin Drive,
 * queda (es la única).
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolverRuta, type Db } from './db.ts'
import type { Dispositivo } from './dispositivos.ts'

export const TIPOS = ['audio', 'foto', 'nota', 'contactos', 'mensaje', 'archivo'] as const
export type TipoItem = (typeof TIPOS)[number]
export type ItemInventario = { clave: string; tipo: string; nombre?: string; bytes?: number; fecha?: number; meta?: Record<string, unknown> }
type Item = { id: number; dispositivo_id: number; clave: string; tipo: TipoItem; nombre: string; bytes: number | null; fecha: number | null; meta: string | null; estado: 'falta' | 'a_salvo' | 'procesado' | 'error'; archivo: string | null; drive_cola_id: number | null; error: string | null }

const dir = (dispositivoId: number) => path.join(path.dirname(resolverRuta()), 'rescate', String(dispositivoId))
const MAX_BYTES = 50 * 1024 * 1024

/** Procesar un ítem ya a salvo (inyectable para las pruebas). */
let procesador = async (db: Db, d: Dispositivo, it: Item, datos: Buffer) => procesarItem(db, d, it, datos)
export function _probarRescate(f: typeof procesador) { procesador = f }

export const enRescate = (d: { estado?: string | null }) => d.estado === 'rescate'

/** El inventario: lo que trae el dispositivo. Devuelve lo que todavía falta subir. */
export function inventariar(db: Db, d: Dispositivo, items: ItemInventario[], ahora = Date.now()) {
  if (!Array.isArray(items)) throw new Error('Mandá la lista de lo que trae')
  const ins = db.prepare(`INSERT OR IGNORE INTO rescate_items (dispositivo_id, clave, tipo, nombre, bytes, fecha, meta, estado, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, 'falta', ?)`)
  for (const x of items.slice(0, 5000)) {
    const clave = String(x?.clave ?? '').trim().slice(0, 200)
    if (!clave) continue
    const tipo = (TIPOS as readonly string[]).includes(x.tipo) ? x.tipo : 'archivo'
    ins.run(d.id, clave, tipo, String(x.nombre ?? clave).slice(0, 200), x.bytes == null ? null : Number(x.bytes), x.fecha == null ? null : Number(x.fecha), x.meta ? JSON.stringify(x.meta).slice(0, 4000) : null, ahora)
  }
  return estadoRescate(db, d.id)
}

/** Sube un ítem crudo: queda en el servidor y va a la cola del Drive. */
export async function salvar(db: Db, d: Dispositivo, clave: string, datos: Buffer, ahora = Date.now()) {
  const it = db.prepare('SELECT * FROM rescate_items WHERE dispositivo_id = ? AND clave = ?').get(d.id, clave) as Item | undefined
  if (!it) throw new Error('Ese ítem no está en el inventario')
  if (it.estado !== 'falta') return { clave, estado: it.estado }
  if (!datos.length) throw new Error('El ítem vino vacío')
  if (datos.length > MAX_BYTES) throw new Error('Demasiado grande (50 MB como mucho por ítem)')
  fs.mkdirSync(dir(d.id), { recursive: true })
  const ext = path.extname(it.nombre).slice(1).replace(/[^\w]/g, '').slice(0, 8) || (it.tipo === 'audio' ? 'wav' : it.tipo === 'foto' ? 'jpg' : it.tipo === 'contactos' ? 'json' : 'txt')
  const archivo = path.join(dir(d.id), `${it.id}.${ext}`)
  fs.writeFileSync(archivo, datos)
  let drive: number | null = null
  try {
    const { alDrive } = await import('./google/drive.ts')
    drive = alDrive(db, { datos, nombre: it.nombre, tipo: it.tipo === 'audio' ? 'audio' : it.tipo === 'foto' ? 'imagen' : 'archivo', origen: `rescate ${d.nombre}`, descripcion: `Rescate de ${d.nombre}: ${it.tipo}` }, ahora)
  } catch { /* sin Drive: queda la copia del servidor */ }
  db.prepare(`UPDATE rescate_items SET estado = 'a_salvo', archivo = ?, drive_cola_id = ?, bytes = ?, salvado_en = ? WHERE id = ?`).run(archivo, drive, datos.length, ahora, it.id)
  return { clave, estado: 'a_salvo' as const }
}

/** Algo que el dispositivo mandó mientras está en rescate (una voz, un mensaje): entra al inventario ya a salvo. */
export async function guardarDuranteRescate(db: Db, d: Dispositivo, tipo: 'audio' | 'mensaje', nombre: string, datos: Buffer, meta: Record<string, unknown>, ahora = Date.now()) {
  const clave = `${tipo}:${ahora}:${Math.random().toString(36).slice(2, 8)}`
  inventariar(db, d, [{ clave, tipo, nombre, bytes: datos.length, fecha: ahora, meta }], ahora)
  return salvar(db, d, clave, datos, ahora)
}

export function estadoRescate(db: Db, dispositivoId: number) {
  const filas = db.prepare('SELECT clave, tipo, estado, error FROM rescate_items WHERE dispositivo_id = ?').all(dispositivoId) as { clave: string; tipo: string; estado: string; error: string | null }[]
  const cuenta = (e: string) => filas.filter((f) => f.estado === e).length
  const porTipo: Record<string, number> = {}
  for (const f of filas) porTipo[f.tipo] = (porTipo[f.tipo] ?? 0) + 1
  return { total: filas.length, faltan: filas.filter((f) => f.estado === 'falta').map((f) => f.clave), aSalvo: cuenta('a_salvo'), procesados: cuenta('procesado'), errores: filas.filter((f) => f.estado === 'error').map((f) => ({ clave: f.clave, tipo: f.tipo, error: f.error })), porTipo }
}

/** Cierra el rescate: si todo está a salvo, el dispositivo pasa a activo y se procesa lo rescatado (en el fondo). */
export function cerrarRescate(db: Db, d: Dispositivo, ahora = Date.now()) {
  const e = estadoRescate(db, d.id)
  if (e.faltan.length) throw new Error(`Faltan ${e.faltan.length} por subir: hasta que no esté todo a salvo no se procesa nada`)
  db.prepare(`UPDATE dispositivos SET estado = 'activo', rescate_fin = ? WHERE id = ?`).run(ahora, d.id)
  const trabajo = procesarPendientes(db, d, ahora)
  return { ...e, estado: 'activo' as const, trabajo }
}

/** Procesa lo que está a salvo y todavía no se procesó (también sirve para reintentar los que fallaron). */
export async function procesarPendientes(db: Db, d: Dispositivo, ahora = Date.now(), reintentar = false) {
  const items = db.prepare(`SELECT * FROM rescate_items WHERE dispositivo_id = ? AND (estado = 'a_salvo'${reintentar ? " OR estado = 'error'" : ''}) ORDER BY COALESCE(fecha, creado_en), id`).all(d.id) as Item[]
  let ok = 0, mal = 0
  for (const it of items) {
    try {
      const datos = it.archivo && fs.existsSync(it.archivo) ? fs.readFileSync(it.archivo) : null
      if (!datos) throw new Error('La copia del servidor no está')
      await procesador(db, d, it, datos)
      db.prepare(`UPDATE rescate_items SET estado = 'procesado', error = NULL, procesado_en = ? WHERE id = ?`).run(ahora, it.id)
      ok++
    } catch (e) {
      db.prepare(`UPDATE rescate_items SET estado = 'error', error = ? WHERE id = ?`).run((e instanceof Error ? e.message : String(e)).slice(0, 300), it.id)
      mal++
    }
  }
  limpiar(db)
  return { procesados: ok, errores: mal }
}

/** Qué se hace con cada tipo, ya a salvo. */
async function procesarItem(db: Db, d: Dispositivo, it: Item, datos: Buffer) {
  const meta = (() => { try { return JSON.parse(it.meta ?? '{}') } catch { return {} } })()
  if (it.tipo === 'audio') {
    // La voz va por el camino de siempre (dictado → chat, pasivo → nota), con el dispositivo ya activo.
    const { recibirVoz } = await import('./dispositivos.ts')
    await recibirVoz(db, d, datos, it.nombre, { modo: meta.modo === 'dictado' || meta.modo === 'conversacion' ? meta.modo : 'pasivo', inicio: meta.inicio ?? it.fecha ?? undefined, fin: meta.fin, caminando: !!meta.caminando })
  } else if (it.tipo === 'mensaje') {
    const { conversacionHoy, enviar } = await import('./chat/index.ts')
    await enviar(db, conversacionHoy(db).id, datos.toString('utf8'))
  } else if (it.tipo === 'nota') {
    const { ingerir } = await import('./mastropiero.ts')
    ingerir(db, { fuente: 'operador', titulo: `Nota de ${d.nombre}${it.nombre && it.nombre !== it.clave ? ` · ${it.nombre}` : ''}`, contenido: datos.toString('utf8'), origenId: `rescate:${d.id}:${it.clave}`, meta: { rescate: { dispositivo: d.nombre } } })
  } else if (it.tipo === 'contactos') {
    // Cada contacto que no estaba, como persona (con su teléfono o mail en la ficha). Los que ya estaban no se tocan.
    const { asegurarEntidad } = await import('./entidades.ts')
    const lista = JSON.parse(datos.toString('utf8')) as { nombre?: string; telefonos?: string[]; mails?: string[] }[]
    for (const c of Array.isArray(lista) ? lista.slice(0, 5000) : []) {
      const nombre = String(c?.nombre ?? '').trim()
      if (nombre.length < 2) continue
      asegurarEntidad(db, { tipo: 'persona', nombre, meta: { telefonos: c.telefonos?.slice(0, 5), mails: c.mails?.slice(0, 5), origen: `contactos de ${d.nombre}` } })
    }
  }
  // Fotos y archivos: rescatarlos ES el proceso (quedan en el Drive); no se mandan al modelo de a cientos.
}

/** Borra la copia del servidor de lo ya procesado cuya copia del Drive se subió. */
export function limpiar(db: Db) {
  const listos = db.prepare(`SELECT r.id, r.archivo FROM rescate_items r JOIN drive_cola c ON c.id = r.drive_cola_id WHERE r.estado = 'procesado' AND c.hecho = 1 AND r.archivo IS NOT NULL`).all() as { id: number; archivo: string }[]
  for (const r of listos) {
    try { fs.rmSync(r.archivo, { force: true }) } catch { /* se intenta la próxima */ continue }
    db.prepare('UPDATE rescate_items SET archivo = NULL WHERE id = ?').run(r.id)
  }
  return listos.length
}

/** Lo que aporta cada dispositivo (para la lista): de lo que de verdad mandó. */
export function aportes(db: Db, dispositivoId: number): string[] {
  const hay = (sql: string) => !!db.prepare(sql).get(dispositivoId)
  return [
    hay(`SELECT 1 FROM voz_segmentos WHERE dispositivo_id = ? AND modo = 'dictado' LIMIT 1`) ? 'dictado' : null,
    hay(`SELECT 1 FROM voz_segmentos WHERE dispositivo_id = ? AND modo = 'pasivo' LIMIT 1`) ? 'notas de voz' : null,
    hay(`SELECT 1 FROM voz_segmentos WHERE dispositivo_id = ? AND modo = 'conversacion' LIMIT 1`) ? 'conversaciones' : null,
    hay('SELECT 1 FROM capas_minuto WHERE dispositivo_id = ? LIMIT 1') ? 'capas del día' : null,
    hay('SELECT 1 FROM capas_minuto WHERE dispositivo_id = ? AND pasos > 0 LIMIT 1') ? 'pasos' : null,
    hay('SELECT 1 FROM capas_minuto WHERE dispositivo_id = ? AND lat IS NOT NULL LIMIT 1') ? 'ubicación' : null,
    ...(db.prepare('SELECT DISTINCT tipo FROM rescate_items WHERE dispositivo_id = ?').all(dispositivoId) as { tipo: string }[]).map((r) => `rescate: ${r.tipo}`),
  ].filter((x): x is string => !!x)
}
