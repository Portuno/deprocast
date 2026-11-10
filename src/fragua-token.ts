/**
 * El token de GitHub de la Fragua vence (Fragua #215). Se crea a 90 días y, si vence sin aviso, el síntoma es un error
 * de permisos a mitad de una forja. Entonces:
 * - la fecha sale de GitHub mismo (cada respuesta trae el vencimiento) o de GITHUB_FRAGUA_TOKEN_VENCE (AAAA-MM-DD);
 * - avisa siete días antes, otra vez a las 48 y a las 24 horas, y cuando venció, con la fecha y cómo renovarlo;
 * - la pantalla lo dice al lado de «Forjar» antes de intentar;
 * - con el token vencido, lo que se manda a forjar queda en cola y se forja solo cuando el token vuelve (o se saca).
 */
import { ajuste, fijarAjuste, type Db } from './db.ts'
import { githubDisponible, tocarGithub, vencimientoVisto } from './fragua-nube.ts'

const HORA = 3_600_000

export const PASOS_RENOVAR = 'Para renovarlo: 1) en github.com, Settings → Developer settings → Personal access tokens → Fine-grained tokens; 2) abrí el de la Fragua y tocá «Regenerate token» (90 días, el mismo repo y los mismos permisos: Contents y Pull requests, lectura y escritura); 3) copiá el token nuevo; 4) en NaN, en las variables del servicio, reemplazá GITHUB_FRAGUA_TOKEN: con el próximo commit lo toma.'

const fecha = (ms: number) => new Date(ms).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', year: 'numeric' })
const fechaHora = (ms: number) => `${fecha(ms)} a las ${new Date(ms).toTimeString().slice(0, 5)}`

/** Cuándo vence: lo último que dijo GitHub (guardado), o la variable si GitHub no lo manda. */
export function venceDe(db: Db): number | null {
  const v = vencimientoVisto().vence
  if (v) return v
  const g = Number(ajuste(db, 'fragua_token_vence') || 0)
  if (g) return g
  const env = process.env.GITHUB_FRAGUA_TOKEN_VENCE?.trim()
  const ms = env && /^\d{4}-\d{2}-\d{2}/.test(env) ? Date.parse(env.length === 10 ? `${env}T00:00:00` : env) : NaN
  return Number.isFinite(ms) ? ms : null
}

export function estadoToken(db: Db, ahora = Date.now()) {
  const hay = githubDisponible()
  const vence = hay ? venceDe(db) : null
  const marcado = vencimientoVisto().vencido ?? ajuste(db, 'fragua_token_vencido') === '1'
  const vencido = hay && (marcado || (!!vence && vence <= ahora))
  const horas = vence ? Math.floor((vence - ahora) / HORA) : null
  const aviso = !hay ? null
    : vencido ? `El token de GitHub de la Fragua venció${vence ? ` el ${fecha(vence)}` : ''}: lo que mandes a forjar queda en cola y sale solo cuando lo renueves.`
    : horas != null && horas <= 7 * 24 ? `El token vence el ${fecha(vence!)}${horas < 48 ? ` (en ${horas} h)` : ''}: renovalo y vuelvo a poder forjar sin cortes.`
    : null
  const enCola = (db.prepare('SELECT COUNT(*) AS n FROM propuestas WHERE en_cola IS NOT NULL AND estado = \'abierta\'').get() as { n: number }).n
  return { hay, vence, horas, vencido, aviso, enCola, pasos: aviso ? PASOS_RENOVAR : null }
}

/** El aviso que toca ahora (uno por umbral y por vencimiento: con un token nuevo vuelven a empezar). */
export function avisoQueToca(db: Db, ahora = Date.now()): string | null {
  const e = estadoToken(db, ahora)
  if (!e.hay || (!e.vence && !e.vencido)) return null
  const clave = String(e.vence ?? 'sin-fecha')
  const dados = (() => { try { return JSON.parse(ajuste(db, 'fragua_token_avisos') || '{}') as { vence?: string; ks?: string[] } } catch { return {} } })()
  const ks = dados.vence === clave ? dados.ks ?? [] : []
  const umbral = e.vencido ? 'vencido' : e.horas! <= 24 ? '24h' : e.horas! <= 48 ? '48h' : e.horas! <= 7 * 24 ? '7d' : null
  if (!umbral || ks.includes(umbral)) return null
  // Los umbrales más largos quedan dados (si se salteó uno, no llega un aviso viejo después del nuevo).
  const orden = ['7d', '48h', '24h', 'vencido']
  fijarAjuste(db, 'fragua_token_avisos', JSON.stringify({ vence: clave, ks: orden.slice(0, orden.indexOf(umbral) + 1) }))
  if (umbral === 'vencido') return `⚠️ Venció el token de GitHub de la Fragua${e.vence ? ` (el ${fechaHora(e.vence)})` : ''}: no puedo abrir pull requests. Lo que mandes a forjar queda en cola y se forja solo cuando vuelva. ${PASOS_RENOVAR}`
  return `⚠️ El token de GitHub de la Fragua vence el ${fechaHora(e.vence!)} (faltan ${e.horas! >= 48 ? `${Math.round(e.horas! / 24)} días` : `${e.horas} horas`}). ${PASOS_RENOVAR}`
}

/** Mira el token en GitHub (vale o no, y su fecha), guarda lo visto y avisa si toca. */
export async function revisarToken(db: Db, ahora = Date.now(), avisar: (t: string) => void = () => {}) {
  if (!githubDisponible()) return estadoToken(db, ahora)
  const r = await tocarGithub()
  const v = vencimientoVisto()
  if (v.vence) fijarAjuste(db, 'fragua_token_vence', String(v.vence))
  if (r.ok) fijarAjuste(db, 'fragua_token_vencido', '0')
  else if (r.status === 401) fijarAjuste(db, 'fragua_token_vencido', '1')
  const aviso = avisoQueToca(db, ahora)
  if (aviso) avisar(aviso)
  return estadoToken(db, ahora)
}

/** Con el token caído, la propuesta no se pierde: espera en cola. */
export function encolar(db: Db, propuestaId: number, ahora = Date.now()) {
  db.prepare('UPDATE propuestas SET en_cola = ? WHERE id = ?').run(ahora, propuestaId)
}
export function sacarDeCola(db: Db, propuestaId: number) {
  db.prepare('UPDATE propuestas SET en_cola = NULL WHERE id = ?').run(propuestaId)
}

/** Si el token volvió y no hay nada forjándose, forja la primera de la cola (una por vuelta). */
export async function forjarCola(db: Db, forjar: (propuestaId: number) => Promise<unknown>, ahora = Date.now()): Promise<number | null> {
  const e = estadoToken(db, ahora)
  if (!e.hay || e.vencido) return null
  if (db.prepare(`SELECT 1 FROM fragua WHERE estado = 'haciendo'`).get()) return null
  const p = db.prepare(`SELECT id FROM propuestas WHERE en_cola IS NOT NULL AND estado = 'abierta' ORDER BY en_cola LIMIT 1`).get() as { id: number } | undefined
  if (!p) return null
  sacarDeCola(db, p.id)
  await forjar(p.id)
  return p.id
}
