/**
 * Lo local (plan v33, local-first): el chat de Hoy guardado en el teléfono (abre al instante, aunque no haya red) y las
 * colas de lo que todavía no salió (sale en la próxima sincronización). Mobile 1.0: lo que llega del servidor no pisa algo
 * más nuevo, cada envío lleva su clave (el servidor no duplica) y se guarda cuándo se sincronizó por última vez.
 */
import * as SQLite from 'expo-sqlite'
import type { MensajeRemoto, PaqueteHoy } from './api'
import { claveNueva, esMasNuevo } from './logica/sincro'

export type MensajeLocal = { id: string; rol: 'operador' | 'asistente'; texto: string; en: number; pendiente: boolean }
export type EstadoSincro = { sincronizadoEn: number | null; error: string | null; marca: string | null }

let db: SQLite.SQLiteDatabase | null = null
let abriendo: Promise<SQLite.SQLiteDatabase> | null = null
async function base(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db
  // Dos pantallas pidiendo la base a la vez abrían dos conexiones: se abre una sola.
  abriendo ??= (async () => {
    const d = await SQLite.openDatabaseAsync('deprocast.db')
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS mensajes (id INTEGER PRIMARY KEY, rol TEXT NOT NULL, texto TEXT NOT NULL, en INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cola (id INTEGER PRIMARY KEY AUTOINCREMENT, texto TEXT NOT NULL, en INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS estado (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS voz_cola (id INTEGER PRIMARY KEY AUTOINCREMENT, uri TEXT NOT NULL, meta TEXT NOT NULL);
    `)
    // Columnas nuevas (1.0) sobre una base que ya existía: si ya están, el ALTER falla y no pasa nada.
    for (const sql of ['ALTER TABLE cola ADD COLUMN clave TEXT', 'ALTER TABLE voz_cola ADD COLUMN intentos INTEGER NOT NULL DEFAULT 0']) {
      try { await d.execAsync(sql) } catch { /* ya estaba */ }
    }
    db = d
    return d
  })()
  return abriendo
}
export const baseLocal = base

async function leerEstado(clave: string): Promise<string | null> {
  return (await (await base()).getFirstAsync<{ valor: string }>('SELECT valor FROM estado WHERE clave = ?', clave))?.valor ?? null
}
async function fijarEstado(clave: string, valor: string | null) {
  const d = await base()
  if (valor == null) await d.runAsync('DELETE FROM estado WHERE clave = ?', clave)
  else await d.runAsync('INSERT OR REPLACE INTO estado (clave, valor) VALUES (?, ?)', clave, valor)
}
export const leerAjuste = leerEstado
export const fijarAjuste = fijarEstado

/** Lo que hay guardado: los mensajes del servidor y, al final, los que todavía están en la cola. */
export async function leerChat(): Promise<{ mensajes: MensajeLocal[]; paraValidar: number }> {
  const d = await base()
  const ms = await d.getAllAsync<MensajeRemoto>('SELECT id, rol, texto, en FROM mensajes ORDER BY id DESC LIMIT 60')
  const cola = await d.getAllAsync<{ id: number; texto: string; en: number }>('SELECT id, texto, en FROM cola ORDER BY id')
  return {
    mensajes: [...ms.reverse().map((m) => ({ id: `s${m.id}`, rol: m.rol, texto: m.texto, en: m.en, pendiente: false })), ...cola.map((c) => ({ id: `c${c.id}`, rol: 'operador' as const, texto: c.texto, en: c.en, pendiente: true }))],
    paraValidar: Number((await leerEstado('paraValidar')) ?? 0),
  }
}

/**
 * Guarda lo que trajo el servidor (el servidor manda), salvo que sea más viejo que lo que ya hay: una respuesta lenta que
 * llega tarde no pisa una más nueva. Devuelve si se guardó.
 */
export async function guardarPaquete(p: PaqueteHoy, ahora = Date.now()): Promise<boolean> {
  const actual = Number(await leerEstado('servidorEn')) || null
  if (!esMasNuevo(p.servidorEn, actual)) return false
  const d = await base()
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM mensajes')
    for (const m of p.mensajes) await d.runAsync('INSERT OR REPLACE INTO mensajes (id, rol, texto, en) VALUES (?, ?, ?, ?)', m.id, m.rol, m.texto, m.en)
    await d.runAsync(`INSERT OR REPLACE INTO estado (clave, valor) VALUES ('paraValidar', ?)`, String(p.paraValidar))
    if (p.servidorEn) await d.runAsync(`INSERT OR REPLACE INTO estado (clave, valor) VALUES ('servidorEn', ?)`, String(p.servidorEn))
    if (p.marca) await d.runAsync(`INSERT OR REPLACE INTO estado (clave, valor) VALUES ('marca', ?)`, p.marca)
    await d.runAsync(`INSERT OR REPLACE INTO estado (clave, valor) VALUES ('sincronizadoEn', ?)`, String(ahora))
  })
  return true
}

export async function estadoSincro(): Promise<EstadoSincro> {
  return { sincronizadoEn: Number(await leerEstado('sincronizadoEn')) || null, error: await leerEstado('errorSincro'), marca: await leerEstado('marca') }
}
export const anotarError = (e: string | null) => fijarEstado('errorSincro', e)

export async function encolar(texto: string) {
  await (await base()).runAsync('INSERT INTO cola (texto, en, clave) VALUES (?, ?, ?)', texto, Date.now(), claveNueva())
}
export async function cola(): Promise<{ id: number; texto: string; en: number; clave: string | null }[]> {
  return (await base()).getAllAsync<{ id: number; texto: string; en: number; clave: string | null }>('SELECT id, texto, en, clave FROM cola ORDER BY id')
}
export async function sacarDeCola(id: number) {
  await (await base()).runAsync('DELETE FROM cola WHERE id = ?', id)
}
/** Un tramo de voz que espera salir (el WAV, en el teléfono) hasta la próxima sincronización. */
export async function encolarVoz(uri: string, meta: unknown) {
  await (await base()).runAsync('INSERT INTO voz_cola (uri, meta) VALUES (?, ?)', uri, JSON.stringify(meta))
}
export async function colaVoz(): Promise<{ id: number; uri: string; meta: string; intentos: number }[]> {
  return (await base()).getAllAsync<{ id: number; uri: string; meta: string; intentos: number }>('SELECT id, uri, meta, intentos FROM voz_cola ORDER BY id LIMIT 20')
}
export async function sumarIntento(id: number) {
  await (await base()).runAsync('UPDATE voz_cola SET intentos = intentos + 1 WHERE id = ?', id)
}
export async function cuantoEnCola(): Promise<{ textos: number; voces: number }> {
  const d = await base()
  const n = async (sql: string) => (await d.getFirstAsync<{ n: number }>(sql))?.n ?? 0
  return { textos: await n('SELECT COUNT(*) AS n FROM cola'), voces: await n('SELECT COUNT(*) AS n FROM voz_cola') }
}
/** Todo lo que espera en las colas (para el rescate: se sube crudo antes de procesar). */
export async function colasCompletas(): Promise<{ textos: { id: number; texto: string; en: number }[]; voces: { id: number; uri: string; meta: string }[] }> {
  const d = await base()
  return { textos: await d.getAllAsync('SELECT id, texto, en FROM cola ORDER BY id'), voces: await d.getAllAsync('SELECT id, uri, meta FROM voz_cola ORDER BY id') }
}
export async function sacarVoz(id: number) {
  await (await base()).runAsync('DELETE FROM voz_cola WHERE id = ?', id)
}

/** Al desvincular: se borra todo lo local. */
export async function borrarTodo() {
  await (await base()).execAsync('DELETE FROM mensajes; DELETE FROM cola; DELETE FROM estado; DELETE FROM voz_cola;')
}
