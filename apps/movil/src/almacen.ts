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
      CREATE TABLE IF NOT EXISTS tramos_en_curso (id TEXT PRIMARY KEY, uri TEXT NOT NULL, inicio INTEGER NOT NULL, meta TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS capas_cola (minuto INTEGER PRIMARY KEY, datos TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS archivos_cola (id TEXT PRIMARY KEY, uri TEXT NOT NULL, nombre TEXT NOT NULL, tipo TEXT NOT NULL, nota TEXT, en INTEGER, lat REAL, lon REAL, intentos INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE TABLE IF NOT EXISTS pasos_dia (fecha TEXT PRIMARY KEY, pasos INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS pasos_hora (hora TEXT PRIMARY KEY, pasos INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS audios (id TEXT PRIMARY KEY, uri TEXT NOT NULL, inicio INTEGER NOT NULL, fin INTEGER, modo TEXT NOT NULL, texto TEXT, destino TEXT, hablante TEXT, bytes INTEGER NOT NULL DEFAULT 0, lat REAL, lon REAL);
      CREATE INDEX IF NOT EXISTS audios_inicio ON audios (inicio);
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
    if (p.actividad) await d.runAsync(`INSERT OR REPLACE INTO estado (clave, valor) VALUES ('actividad', ?)`, JSON.stringify(p.actividad))
    if (p.uso !== undefined) await d.runAsync(`INSERT OR REPLACE INTO estado (clave, valor) VALUES ('uso', ?)`, JSON.stringify(p.uso))
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

// ─── los tramos y las capas en disco (Mobile 1.0, bloque 2) ─────────────

/** Un tramo que empieza a grabarse queda anotado: si la app se corta, al abrir se recupera. */
export async function anotarTramo(id: string, uri: string, inicio: number, meta: unknown) {
  await (await base()).runAsync('INSERT OR REPLACE INTO tramos_en_curso (id, uri, inicio, meta) VALUES (?, ?, ?, ?)', id, uri, inicio, JSON.stringify(meta))
}
/** El tramo terminó: sale de «en curso» y, si vale, entra a la cola (en la misma transacción: nunca queda en ninguna). */
export async function cerrarTramoEnDisco(id: string, encolarCon: { uri: string; meta: unknown } | null) {
  const d = await base()
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM tramos_en_curso WHERE id = ?', id)
    if (encolarCon) await d.runAsync('INSERT INTO voz_cola (uri, meta) VALUES (?, ?)', encolarCon.uri, JSON.stringify(encolarCon.meta))
  })
}
export async function tramosEnCurso(): Promise<{ id: string; uri: string; inicio: number; meta: string }[]> {
  return (await base()).getAllAsync('SELECT id, uri, inicio, meta FROM tramos_en_curso')
}
export async function urisEnCola(): Promise<Set<string>> {
  return new Set((await (await base()).getAllAsync<{ uri: string }>('SELECT uri FROM voz_cola')).map((r) => r.uri))
}

/** Los minutos de tu día en capas esperan acá (no en memoria: un cierre de la app los perdía), hasta 12 horas. */
export async function guardarMinuto(minuto: number, datos: unknown) {
  const d = await base()
  await d.runAsync('INSERT OR REPLACE INTO capas_cola (minuto, datos) VALUES (?, ?)', minuto, JSON.stringify(datos))
  await d.runAsync('DELETE FROM capas_cola WHERE minuto < ?', Date.now() - 12 * 3_600_000)
}
export async function minutosEnCola(max = 240): Promise<{ minuto: number; datos: string }[]> {
  return (await base()).getAllAsync('SELECT minuto, datos FROM capas_cola ORDER BY minuto LIMIT ?', max)
}
export async function sacarMinutos(minutos: number[]) {
  const d = await base()
  await d.withTransactionAsync(async () => { for (const m of minutos) await d.runAsync('DELETE FROM capas_cola WHERE minuto = ?', m) })
}

/** Al desvincular: se borra todo lo local. */
export async function borrarTodo() {
  await (await base()).execAsync('DELETE FROM mensajes; DELETE FROM cola; DELETE FROM estado; DELETE FROM voz_cola; DELETE FROM tramos_en_curso; DELETE FROM capas_cola; DELETE FROM pasos_dia; DELETE FROM pasos_hora; DELETE FROM audios;')
}

// ─── Mobile 1.2: la actividad, la cola de archivos y los pasos ──────────

/** El uso del teléfono que trajo el último paquete de Hoy (o null). */
export async function leerUso(): Promise<import('./api').UsoHoy | null> {
  try { return JSON.parse((await leerEstado('uso')) ?? 'null') } catch { return null }
}
/** La actividad que trajo el último paquete de Hoy (o null). */
export async function leerActividad(): Promise<import('./api').Actividad | null> {
  try { return JSON.parse((await leerEstado('actividad')) ?? 'null') } catch { return null }
}

export type ArchivoEnCola = { id: string; uri: string; nombre: string; tipo: string; nota: string | null; en: number | null; lat: number | null; lon: number | null; intentos: number; error: string | null }
export async function encolarArchivo(a: Omit<ArchivoEnCola, 'intentos' | 'error'>) {
  await (await base()).runAsync('INSERT OR IGNORE INTO archivos_cola (id, uri, nombre, tipo, nota, en, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', a.id, a.uri, a.nombre, a.tipo, a.nota, a.en, a.lat, a.lon)
}
export const archivosEnCola = async (): Promise<ArchivoEnCola[]> => (await base()).getAllAsync<ArchivoEnCola>('SELECT * FROM archivos_cola ORDER BY en')
export async function sacarArchivo(id: string) { await (await base()).runAsync('DELETE FROM archivos_cola WHERE id = ?', id) }
export async function fallaArchivo(id: string, error: string) { await (await base()).runAsync('UPDATE archivos_cola SET intentos = intentos + 1, error = ? WHERE id = ?', error.slice(0, 200), id) }

/** Suma pasos al día (el contador del teléfono da deltas). */
export async function sumarPasos(fecha: string, n: number) {
  if (!(n > 0)) return
  await (await base()).runAsync('INSERT INTO pasos_dia (fecha, pasos) VALUES (?, ?) ON CONFLICT (fecha) DO UPDATE SET pasos = pasos + excluded.pasos', fecha, Math.round(n))
}
/** Suma lo que contó el contador del teléfono, por hora (Mobile 1.3): cada hora y su día. */
export async function sumarPasosPorHora(reparto: { hora: string; pasos: number }[]) {
  if (!reparto.length) return
  const d = await base()
  await d.withTransactionAsync(async () => {
    for (const r of reparto) {
      if (!(r.pasos > 0)) continue
      await d.runAsync('INSERT INTO pasos_hora (hora, pasos) VALUES (?, ?) ON CONFLICT (hora) DO UPDATE SET pasos = pasos + excluded.pasos', r.hora, Math.round(r.pasos))
      await d.runAsync('INSERT INTO pasos_dia (fecha, pasos) VALUES (?, ?) ON CONFLICT (fecha) DO UPDATE SET pasos = pasos + excluded.pasos', r.hora.slice(0, 10), Math.round(r.pasos))
    }
  })
}
/** Las horas con pasos desde una hora ('AAAA-MM-DDTHH'), para mandarlas (el sueño estimado). */
export const pasosHoraDesde = async (desde: string) => (await base()).getAllAsync<{ hora: string; pasos: number }>('SELECT hora, pasos FROM pasos_hora WHERE hora >= ? ORDER BY hora', desde)
export const pasosPorHora = async (fecha: string) => (await base()).getAllAsync<{ hora: string; pasos: number }>('SELECT hora, pasos FROM pasos_hora WHERE hora LIKE ?', fecha + '%')
export const pasosDe = async (fecha: string) => ((await (await base()).getFirstAsync<{ pasos: number }>('SELECT pasos FROM pasos_dia WHERE fecha = ?', fecha))?.pasos ?? 0)
export const pasosRecientes = async (dias = 3) => (await base()).getAllAsync<{ fecha: string; pasos: number }>('SELECT fecha, pasos FROM pasos_dia ORDER BY fecha DESC LIMIT ?', dias)
/** Las horas con pasos entre dos fechas ('AAAA-MM-DD', las dos incluidas): para ubicar los pasos en el mapa. */
export const pasosHoraEntre = async (desde: string, hasta: string) => (await base()).getAllAsync<{ hora: string; pasos: number }>('SELECT hora, pasos FROM pasos_hora WHERE hora >= ? AND hora <= ? ORDER BY hora', `${desde}T00`, `${hasta}T23`)

// ─── Mobile 2.0: los audios quedan en el teléfono ───────────────────────
export type AudioGuardado = { id: string; uri: string; inicio: number; fin: number | null; modo: string; texto: string | null; destino: string | null; hablante: string | null; bytes: number; lat: number | null; lon: number | null }
export async function anotarAudio(a: AudioGuardado) {
  await (await base()).runAsync('INSERT OR REPLACE INTO audios (id, uri, inicio, fin, modo, texto, destino, hablante, bytes, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', a.id, a.uri, a.inicio, a.fin, a.modo, a.texto, a.destino, a.hablante, a.bytes, a.lat, a.lon)
}
export const leerAudios = async (o: { desde?: number; limite?: number } = {}) => (await base()).getAllAsync<AudioGuardado>('SELECT * FROM audios WHERE inicio >= ? ORDER BY inicio DESC LIMIT ?', o.desde ?? 0, o.limite ?? 200)
export const audiosAntesDe = async (t: number) => (await base()).getAllAsync<AudioGuardado>('SELECT * FROM audios WHERE inicio < ?', t)
export async function olvidarAudio(id: string) { await (await base()).runAsync('DELETE FROM audios WHERE id = ?', id) }
export async function resumenAudios(): Promise<{ n: number; bytes: number; desde: number | null }> {
  const r = await (await base()).getFirstAsync<{ n: number; bytes: number | null; desde: number | null }>('SELECT COUNT(*) AS n, SUM(bytes) AS bytes, MIN(inicio) AS desde FROM audios')
  return { n: r?.n ?? 0, bytes: r?.bytes ?? 0, desde: r?.desde ?? null }
}
