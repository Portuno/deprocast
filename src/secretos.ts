/**
 * Secretos guardados en la base (Fragua #224): los tokens de las cuentas de redes no quedan en texto plano. Se cifran
 * con AES-256-GCM y una clave del servidor: MASTRO_CLAVE_TOKENS si está en el entorno; si no, un archivo con 32 bytes
 * al azar junto a la base (data/clave-tokens, fuera de git y fuera de las exportaciones). Una exportación lleva los
 * tokens cifrados, sin la clave: en otra compu hay que volver a cargarlos (a propósito).
 * Lo que sale de la base hacia la pantalla nunca es el token: a lo sumo, sus últimos cuatro caracteres.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { resolverRuta } from './db.ts'

let enMemoria: Buffer | null = null

function rutaClave(): string | null {
  const db = resolverRuta()
  return db === ':memory:' ? null : path.join(path.dirname(db), 'clave-tokens')
}

/** La clave del servidor (32 bytes). Se crea una vez, si no hay. */
function clave(): Buffer {
  const env = (process.env.MASTRO_CLAVE_TOKENS ?? '').trim()
  if (env) return crypto.createHash('sha256').update(env).digest()
  const ruta = rutaClave()
  if (!ruta) return (enMemoria ??= crypto.randomBytes(32)) // la base de las pruebas: una clave por proceso
  const ya = leidas.get(ruta)
  if (ya) return ya
  if (fs.existsSync(ruta)) {
    const hex = fs.readFileSync(ruta, 'utf8').trim()
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`La clave de los tokens (${ruta}) está dañada: borrala y volvé a cargar los tokens`)
    leidas.set(ruta, Buffer.from(hex, 'hex'))
    return leidas.get(ruta)!
  }
  fs.mkdirSync(path.dirname(ruta), { recursive: true })
  const nueva = crypto.randomBytes(32)
  fs.writeFileSync(ruta, nueva.toString('hex'), { mode: 0o600 })
  leidas.set(ruta, nueva)
  return nueva
}
const leidas = new Map<string, Buffer>()

export function sellar(datos: Record<string, string>): string {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', clave(), iv)
  const ct = Buffer.concat([c.update(JSON.stringify(datos), 'utf8'), c.final()])
  return `s1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`
}

/** Abre lo sellado. null si no se puede (otra clave: vino de otra compu, o la clave se borró). */
export function abrirSello(sobre: string | null | undefined): Record<string, string> | null {
  if (!sobre?.startsWith('s1:')) return null
  try {
    const b = Buffer.from(sobre.slice(3), 'base64')
    const d = crypto.createDecipheriv('aes-256-gcm', clave(), b.subarray(0, 12))
    d.setAuthTag(b.subarray(12, 28))
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'))
  } catch { return null }
}

/** Lo que se puede mostrar de un secreto: los últimos 4 caracteres de su valor más largo. */
export function pista(datos: Record<string, string> | null): string | null {
  if (!datos) return null
  const largo = Object.values(datos).filter(Boolean).sort((a, b) => b.length - a.length)[0]
  return largo ? `…${largo.slice(-4)}` : null
}

