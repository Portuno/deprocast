/**
 * Rutinas: lo que Mastropiero hace solo, a su hora. Corren mientras el servidor está prendido;
 * si al arrancar ya pasó la hora de una rutina de hoy, se pone al día. Una rutina corre una vez por día.
 */
import { fechaLocal, type Db } from './db.ts'
import { aHora, aMin, armarJornada, leerJornada, textoDeCierre } from './jornada.ts'
import { conversacionHoy, mensajeDeMastropiero } from './chat/index.ts'

export type Rutina = { id: string; nombre: string; hora: string; dias: string; accion: string; activa: boolean; ultimaFecha: string | null }

const deFila = (r: any): Rutina => ({ id: r.id, nombre: r.nombre, hora: r.hora, dias: r.dias, accion: r.accion, activa: r.activa === 1, ultimaFecha: r.ultima_fecha })

export function listarRutinas(db: Db): Rutina[] {
  return db.prepare('SELECT * FROM rutinas ORDER BY hora').all().map(deFila)
}

export function actualizarRutina(db: Db, id: string, c: { hora?: string; dias?: string; activa?: boolean }) {
  const r = listarRutinas(db).find((x) => x.id === id)
  if (!r) throw new Error(`No existe la rutina ${id}`)
  const hora = c.hora ?? r.hora
  if (!Number.isFinite(aMin(hora))) throw new Error('Hora inválida (HH:MM)')
  const dias = c.dias ?? r.dias
  if (!/^[0-6]*$/.test(dias)) throw new Error('Días inválidos (0 = domingo … 6 = sábado)')
  db.prepare('UPDATE rutinas SET hora = ?, dias = ?, activa = ? WHERE id = ?').run(hora, dias, (c.activa ?? r.activa) ? 1 : 0, id)
}

/** Las que tocan ahora: activas, de hoy, con la hora pasada y todavía no corridas hoy. */
export function pendientes(db: Db, ahora: number): Rutina[] {
  const d = new Date(ahora)
  const hoy = fechaLocal(ahora)
  const minuto = d.getHours() * 60 + d.getMinutes()
  return listarRutinas(db).filter((r) => r.activa && r.dias.includes(String(d.getDay())) && aMin(r.hora) <= minuto && r.ultimaFecha !== hoy)
}

type Acciones = Record<string, (db: Db, fecha: string, ahora: number) => Promise<string | null>>

/** Lo que hace cada rutina. Devuelve el mensaje que Mastropiero deja en «Hoy» (o null si no hay nada que decir). */
export const ACCIONES: Acciones = {
  async jornada(db, fecha, ahora) {
    if (leerJornada(db, fecha)) return null
    // Si se pone al día tarde (la compu estaba apagada), arma desde ahora: no tiene sentido llenar horas que ya pasaron.
    const d = new Date(ahora)
    const desde = aHora(Math.min(23 * 60 + 55, Math.ceil((d.getHours() * 60 + d.getMinutes()) / 5) * 5))
    const { jornada, avisos } = await armarJornada(db, fecha, { desde, ahora })
    const n = jornada.bloques.filter((b) => b.estado !== 'fijo').length
    return [`Buen día. Te armé la jornada: ${n} bloques.`, jornada.resumen, avisos.length ? `(${avisos.join(' ')})` : '', 'Si algo no te cierra, decímelo y la rehago.'].filter(Boolean).join(' ')
  },
  async cierre(db, fecha) {
    const j = leerJornada(db, fecha)
    if (!j || j.cierre) return null
    return textoDeCierre(db, fecha)
  },
}

/** Corre lo que toca. Cada rutina se marca antes de correr: si falla no se repite en loop, y el error queda dicho en «Hoy». */
export async function correrRutinas(db: Db, ahora = Date.now(), acciones: Acciones = ACCIONES): Promise<{ id: string; ok: boolean; mensaje: string | null }[]> {
  const hoy = fechaLocal(ahora)
  const salida: { id: string; ok: boolean; mensaje: string | null }[] = []
  for (const r of pendientes(db, ahora)) {
    db.prepare('UPDATE rutinas SET ultima_fecha = ? WHERE id = ?').run(hoy, r.id)
    const accion = acciones[r.accion]
    if (!accion) continue
    try {
      const mensaje = await accion(db, hoy, ahora)
      if (mensaje) mensajeDeMastropiero(db, conversacionHoy(db).id, mensaje)
      salida.push({ id: r.id, ok: true, mensaje })
    } catch (e) {
      const mensaje = `No pude ${r.nombre.toLowerCase()}: ${e instanceof Error ? e.message : e}`
      mensajeDeMastropiero(db, conversacionHoy(db).id, mensaje)
      salida.push({ id: r.id, ok: false, mensaje })
    }
  }
  return salida
}
