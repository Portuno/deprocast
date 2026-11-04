/**
 * Lo local (plan v33, local-first): el chat de Hoy guardado en el teléfono (abre al instante, aunque no haya red) y la
 * cola de lo que escribiste sin conexión (sale en la próxima sincronización). Solo texto: nunca audio.
 */
import * as SQLite from 'expo-sqlite'
import type { MensajeRemoto, PaqueteHoy } from './api'

export type MensajeLocal = { id: string; rol: 'operador' | 'asistente'; texto: string; en: number; pendiente: boolean }

let db: SQLite.SQLiteDatabase | null = null
async function base(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db
  db = await SQLite.openDatabaseAsync('deprocast.db')
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS mensajes (id INTEGER PRIMARY KEY, rol TEXT NOT NULL, texto TEXT NOT NULL, en INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cola (id INTEGER PRIMARY KEY AUTOINCREMENT, texto TEXT NOT NULL, en INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS estado (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
  `)
  return db
}

/** Lo que hay guardado: los mensajes del servidor y, al final, los que todavía están en la cola. */
export async function leerChat(): Promise<{ mensajes: MensajeLocal[]; paraValidar: number }> {
  const d = await base()
  const ms = await d.getAllAsync<MensajeRemoto>('SELECT id, rol, texto, en FROM mensajes ORDER BY id DESC LIMIT 60')
  const cola = await d.getAllAsync<{ id: number; texto: string; en: number }>('SELECT id, texto, en FROM cola ORDER BY id')
  const pv = await d.getFirstAsync<{ valor: string }>(`SELECT valor FROM estado WHERE clave = 'paraValidar'`)
  return {
    mensajes: [...ms.reverse().map((m) => ({ id: `s${m.id}`, rol: m.rol, texto: m.texto, en: m.en, pendiente: false })), ...cola.map((c) => ({ id: `c${c.id}`, rol: 'operador' as const, texto: c.texto, en: c.en, pendiente: true }))],
    paraValidar: Number(pv?.valor ?? 0),
  }
}

/** Guarda lo que trajo el servidor (reemplaza lo de antes: el servidor manda). */
export async function guardarPaquete(p: PaqueteHoy) {
  const d = await base()
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM mensajes')
    for (const m of p.mensajes) await d.runAsync('INSERT OR REPLACE INTO mensajes (id, rol, texto, en) VALUES (?, ?, ?, ?)', m.id, m.rol, m.texto, m.en)
    await d.runAsync(`INSERT OR REPLACE INTO estado (clave, valor) VALUES ('paraValidar', ?)`, String(p.paraValidar))
  })
}

export async function encolar(texto: string) {
  await (await base()).runAsync('INSERT INTO cola (texto, en) VALUES (?, ?)', texto, Date.now())
}
export async function cola(): Promise<{ id: number; texto: string }[]> {
  return (await base()).getAllAsync<{ id: number; texto: string }>('SELECT id, texto FROM cola ORDER BY id')
}
export async function sacarDeCola(id: number) {
  await (await base()).runAsync('DELETE FROM cola WHERE id = ?', id)
}
/** Al desvincular: se borra todo lo local. */
export async function borrarTodo() {
  await (await base()).execAsync('DELETE FROM mensajes; DELETE FROM cola; DELETE FROM estado;')
}
