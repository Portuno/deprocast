/**
 * La hora del operador. El servidor de la nube corre en UTC: sin esto, todo lo que muestra horas (la agenda, el «ahora»
 * del chat, las comidas, las runs) y las rutinas (la matinal, el voto) quedan corridos. La zona sale, en orden, de
 * MASTRO_ZONA, del ajuste «zona» (lo manda su navegador la primera vez) o de Europa/Madrid. Node la toma en caliente.
 */
import { ajuste, fijarAjuste, type Db } from './db.ts'

export const zonaValida = (z: unknown): z is string => {
  if (typeof z !== 'string' || !z.trim()) return false
  try {
    new Intl.DateTimeFormat('es', { timeZone: z.trim() })
    return true
  } catch {
    return false
  }
}

export const zonaActual = () => process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone

/** Fija la zona del proceso al arrancar. */
export function aplicarZona(db: Db): string {
  const z = [process.env.MASTRO_ZONA, ajuste(db, 'zona'), 'Europe/Madrid'].find(zonaValida)!.trim()
  process.env.TZ = z
  return z
}

/** La zona que manda su navegador: si cambió (viajó, otro dispositivo), se guarda y rige desde ya. */
export function recibirZona(db: Db, z: unknown): { zona: string; cambio: boolean } {
  if (!zonaValida(z)) throw new Error('Zona horaria desconocida')
  if (process.env.MASTRO_ZONA && zonaValida(process.env.MASTRO_ZONA)) return { zona: zonaActual(), cambio: false } // la fija la variable del servicio
  const cambio = ajuste(db, 'zona') !== z.trim() || process.env.TZ !== z.trim()
  if (cambio) {
    fijarAjuste(db, 'zona', z.trim())
    process.env.TZ = z.trim()
  }
  return { zona: z.trim(), cambio }
}

/** «jueves 15 de octubre de 2026, 07:44 (Europe/Madrid)»: lo que el chat sabe del ahora. */
export function ahoraEnPalabras(ahora = Date.now()): string {
  const t = new Date(ahora).toLocaleString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  return `${t} (${zonaActual()})`
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** «jue 9/10»: una fecha con su día de la semana (para que «el viernes» no se lea como el de esta semana). */
export function diaSemana(fecha: string | null | undefined): string {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return fecha ?? ''
  const d = new Date(`${fecha.slice(0, 10)}T12:00:00`)
  return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`
}

/** Los días alrededor de hoy, con su nombre: el chat resuelve «mañana», «el viernes» o «el martes pasado» contra esto. */
export function calendarioCorto(ahora = Date.now()): string {
  const iso = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const marca = (k: number) => (k === -1 ? ' (ayer)' : k === 0 ? ' (HOY)' : k === 1 ? ' (mañana)' : '')
  return Array.from({ length: 11 }, (_, i) => i - 3).map((k) => `${diaSemana(iso(ahora + k * 86_400_000))}${marca(k)}`).join(' · ')
}
