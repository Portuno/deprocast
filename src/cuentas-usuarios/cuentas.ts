/**
 * Las cuentas de los usuarios (plan v33, paso 5). Cada persona (o agente) tiene su propio Deprocast: su base, su
 * memoria, sus agentes, en `usuarios/<id>/`. Esta base (`cuentas.db`, aparte de la del dueño) guarda solo quién es
 * quién: el email, la contraseña (scrypt, nunca en claro), las sesiones (solo su huella) y las invitaciones.
 *
 * El alta es por invitación: el dueño genera un link de un solo uso y quien lo abre crea su cuenta. El dueño
 * (el primogénito) sigue entrando con su clave de siempre y no figura acá.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'

const scrypt = promisify(crypto.scrypt) as (clave: string, sal: Buffer, largo: number) => Promise<Buffer>

export type Cuentas = DatabaseSync
export type Usuario = { id: number; email: string; nombre: string; estado: 'activo' | 'suspendido'; creado: number; ultimo: number | null; topeDia: number }

export const CLAVE_MIN = 10
export const TOPE_DIA_DEFECTO = 300_000
const DIA = 86_400_000
const SESION_DIAS = 90

export function abrirCuentas(ruta: string): Cuentas {
  fs.mkdirSync(path.dirname(ruta), { recursive: true })
  const db = new DatabaseSync(ruta)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      nombre TEXT NOT NULL,
      clave TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'activo',
      tope_dia INTEGER NOT NULL DEFAULT ${TOPE_DIA_DEFECTO},
      creado INTEGER NOT NULL,
      ultimo INTEGER
    );
    CREATE TABLE IF NOT EXISTS sesiones (
      huella TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      creada INTEGER NOT NULL,
      vence INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invitaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      huella TEXT NOT NULL UNIQUE,
      email TEXT,
      nota TEXT,
      creada INTEGER NOT NULL,
      vence INTEGER NOT NULL,
      usada INTEGER,
      usuario_id INTEGER
    );
  `)
  return db
}

const huella = (s: string) => crypto.createHash('sha256').update(`deprocast:${s}`).digest('hex')
const azar = (n = 24) => crypto.randomBytes(n).toString('base64url')
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/

type Fila = { id: number; email: string; nombre: string; clave: string; estado: string; tope_dia: number; creado: number; ultimo: number | null }
const usuarioDe = (f: Fila): Usuario => ({ id: f.id, email: f.email, nombre: f.nombre, estado: f.estado === 'suspendido' ? 'suspendido' : 'activo', creado: f.creado, ultimo: f.ultimo, topeDia: f.tope_dia })

// ─── contraseñas ───────────────────────────────────────────────────────

export async function hashClave(clave: string): Promise<string> {
  const sal = crypto.randomBytes(16)
  const h = await scrypt(clave, sal, 64)
  return `s1$${sal.toString('base64')}$${h.toString('base64')}`
}

export async function claveCorrecta(clave: string, guardada: string): Promise<boolean> {
  const [v, sal, h] = guardada.split('$')
  if (v !== 's1' || !sal || !h) return false
  const esperado = Buffer.from(h, 'base64')
  const dado = await scrypt(clave, Buffer.from(sal, 'base64'), esperado.length)
  return crypto.timingSafeEqual(dado, esperado)
}

// Para que «no existe ese email» tarde lo mismo que «clave incorrecta».
let hashDeMentira: Promise<string> | null = null

// ─── invitaciones ──────────────────────────────────────────────────────

/** Un link de alta, de un solo uso. Si lleva email, solo sirve para ese email. */
export function crearInvitacion(db: Cuentas, o: { email?: string | null; nota?: string | null; dias?: number } = {}, ahora = Date.now()) {
  const email = o.email?.trim() || null
  if (email && !EMAIL.test(email)) throw new Error('Ese email no parece válido.')
  const codigo = azar(18)
  const vence = ahora + (o.dias ?? 7) * DIA
  const r = db.prepare(`INSERT INTO invitaciones (huella, email, nota, creada, vence) VALUES (?, ?, ?, ?, ?)`).run(huella(codigo), email, o.nota?.trim() || null, ahora, vence)
  return { id: Number(r.lastInsertRowid), codigo, email, vence }
}

/** La invitación de ese código, si sigue valiendo. */
export function verInvitacion(db: Cuentas, codigo: string, ahora = Date.now()): { id: number; email: string | null } | null {
  if (!codigo || codigo.length > 64) return null
  const f = db.prepare(`SELECT id, email FROM invitaciones WHERE huella = ? AND usada IS NULL AND vence > ?`).get(huella(codigo), ahora) as { id: number; email: string | null } | undefined
  return f ?? null
}

export function listarInvitaciones(db: Cuentas, ahora = Date.now()) {
  return db.prepare(`SELECT id, email, nota, creada, vence FROM invitaciones WHERE usada IS NULL AND vence > ? ORDER BY creada DESC`).all(ahora) as { id: number; email: string | null; nota: string | null; creada: number; vence: number }[]
}

export function anularInvitacion(db: Cuentas, id: number) {
  db.prepare(`DELETE FROM invitaciones WHERE id = ? AND usada IS NULL`).run(id)
}

// ─── alta, entrada y sesiones ──────────────────────────────────────────

export async function alta(db: Cuentas, d: { codigo: string; email: string; nombre: string; clave: string }, ahora = Date.now()): Promise<Usuario> {
  const inv = verInvitacion(db, d.codigo, ahora)
  if (!inv) throw new Error('La invitación no existe, ya se usó o venció. Pedile otra a quien te invitó.')
  const email = d.email.trim()
  const nombre = d.nombre.trim().slice(0, 80)
  if (!EMAIL.test(email)) throw new Error('Ese email no parece válido.')
  if (inv.email && inv.email.toLowerCase() !== email.toLowerCase()) throw new Error(`Esta invitación es para ${inv.email}.`)
  if (!nombre) throw new Error('Falta tu nombre.')
  if (d.clave.length < CLAVE_MIN) throw new Error(`La contraseña tiene que tener ${CLAVE_MIN} caracteres o más.`)
  if (db.prepare(`SELECT 1 FROM usuarios WHERE email = ?`).get(email)) throw new Error('Ya hay una cuenta con ese email.')
  const clave = await hashClave(d.clave)
  db.exec('BEGIN')
  try {
    // De nuevo adentro de la transacción: dos altas con el mismo link a la vez, solo una gana.
    const usada = db.prepare(`UPDATE invitaciones SET usada = ? WHERE id = ? AND usada IS NULL`).run(ahora, inv.id)
    if (!usada.changes) throw new Error('La invitación ya se usó.')
    const r = db.prepare(`INSERT INTO usuarios (email, nombre, clave, creado) VALUES (?, ?, ?, ?)`).run(email, nombre, clave, ahora)
    db.prepare(`UPDATE invitaciones SET usuario_id = ? WHERE id = ?`).run(Number(r.lastInsertRowid), inv.id)
    db.exec('COMMIT')
    return usuario(db, Number(r.lastInsertRowid))!
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** El usuario de ese email y contraseña (activo), o null. Tarda lo mismo exista o no el email. */
export async function entrar(db: Cuentas, email: string, clave: string): Promise<Usuario | null> {
  const f = db.prepare(`SELECT * FROM usuarios WHERE email = ?`).get(email.trim()) as Fila | undefined
  if (!f) {
    hashDeMentira ??= hashClave(azar())
    await claveCorrecta(clave, await hashDeMentira)
    return null
  }
  if (!(await claveCorrecta(clave, f.clave)) || f.estado !== 'activo') return null
  return usuarioDe(f)
}

export function crearSesion(db: Cuentas, usuarioId: number, ahora = Date.now()): string {
  const token = azar(32)
  db.prepare(`DELETE FROM sesiones WHERE vence <= ?`).run(ahora)
  db.prepare(`INSERT INTO sesiones (huella, usuario_id, creada, vence) VALUES (?, ?, ?, ?)`).run(huella(token), usuarioId, ahora, ahora + SESION_DIAS * DIA)
  db.prepare(`UPDATE usuarios SET ultimo = ? WHERE id = ?`).run(ahora, usuarioId)
  return token
}

/** El usuario de esa sesión, si sigue valiendo y la cuenta está activa. */
export function sesionDe(db: Cuentas, token: string | undefined, ahora = Date.now()): Usuario | null {
  if (!token || token.length > 128) return null
  const f = db.prepare(`SELECT u.* FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.huella = ? AND s.vence > ? AND u.estado = 'activo'`).get(huella(token), ahora) as Fila | undefined
  if (!f) return null
  // «Visto por última vez»: como mucho una escritura cada 10 minutos.
  if (!f.ultimo || ahora - f.ultimo > 600_000) db.prepare(`UPDATE usuarios SET ultimo = ? WHERE id = ?`).run(ahora, f.id)
  return usuarioDe(f)
}

export function cerrarSesion(db: Cuentas, token: string | undefined) {
  if (token) db.prepare(`DELETE FROM sesiones WHERE huella = ?`).run(huella(token))
}

export function cerrarSesiones(db: Cuentas, usuarioId: number) {
  db.prepare(`DELETE FROM sesiones WHERE usuario_id = ?`).run(usuarioId)
}

// ─── administración ────────────────────────────────────────────────────

export function usuario(db: Cuentas, id: number): Usuario | null {
  const f = db.prepare(`SELECT * FROM usuarios WHERE id = ?`).get(id) as Fila | undefined
  return f ? usuarioDe(f) : null
}

export function listarUsuarios(db: Cuentas): Usuario[] {
  return (db.prepare(`SELECT * FROM usuarios ORDER BY id`).all() as Fila[]).map(usuarioDe)
}

/** Suspender cierra todas sus sesiones; reactivar no las devuelve (vuelve a entrar). */
export function cambiarEstado(db: Cuentas, id: number, estado: 'activo' | 'suspendido') {
  db.prepare(`UPDATE usuarios SET estado = ? WHERE id = ?`).run(estado, id)
  if (estado === 'suspendido') cerrarSesiones(db, id)
}

export function fijarTope(db: Cuentas, id: number, tokens: number) {
  db.prepare(`UPDATE usuarios SET tope_dia = ? WHERE id = ?`).run(Math.max(0, Math.round(tokens) || 0), id)
}

export async function cambiarClave(db: Cuentas, id: number, actual: string, nueva: string) {
  const f = db.prepare(`SELECT clave FROM usuarios WHERE id = ?`).get(id) as { clave: string } | undefined
  if (!f || !(await claveCorrecta(actual, f.clave))) throw new Error('La contraseña actual no es esa.')
  if (nueva.length < CLAVE_MIN) throw new Error(`La contraseña nueva tiene que tener ${CLAVE_MIN} caracteres o más.`)
  db.prepare(`UPDATE usuarios SET clave = ? WHERE id = ?`).run(await hashClave(nueva), id)
  cerrarSesiones(db, id)
}

/** Borra la cuenta (y sus sesiones). Su carpeta la borra quien llama, con el proceso ya parado. */
export function borrarUsuario(db: Cuentas, id: number) {
  db.prepare(`DELETE FROM usuarios WHERE id = ?`).run(id)
}

// ─── límite de intentos ────────────────────────────────────────────────

/** Como mucho `max` intentos por clave (IP, o IP + email) cada `ventanaMs`. Devuelve false si se pasó. */
export function crearLimitador(max = 10, ventanaMs = 15 * 60_000) {
  const vistos = new Map<string, number[]>()
  return (clave: string, ahora = Date.now()): boolean => {
    const xs = (vistos.get(clave) ?? []).filter((t) => ahora - t < ventanaMs)
    if (xs.length >= max) { vistos.set(clave, xs); return false }
    xs.push(ahora)
    vistos.set(clave, xs)
    if (vistos.size > 5000) for (const [k, v] of vistos) if (!v.some((t) => ahora - t < ventanaMs)) vistos.delete(k)
    return true
  }
}
