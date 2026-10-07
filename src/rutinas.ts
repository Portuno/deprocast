/**
 * Rutinas: lo que Mastropiero hace solo, a su hora. Corren mientras el servidor está prendido;
 * si al arrancar ya pasó la hora de una rutina de hoy, se pone al día. Una rutina corre una vez por día.
 */
import { fechaLocal, type Db } from './db.ts'
import { aMin, asegurarJornada, fijarResumen, leerJornada, textoDeCierre } from './jornada.ts'
import { agendaDelDia } from './calendario.ts'
import { conversacionHoy, mensajeDeMastropiero } from './chat/index.ts'
import { pedirAportes } from './ayudantes.ts'
import { calificarDia, predecirDia, textoDeCalificacion } from './gemelo.ts'
import { buscarOportunidades } from './radar.ts'
import { conAvance, listarMisiones, proponerPrimarias, reporteSemana, semanaDe, seguimientos, sideQuestsRelevantes } from './misiones.ts'

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
  /** El saludo: sin modelo. Su semana, lo que otros le deben, side quests que tocan por su agenda, y la invitación a una run. */
  async jornada(db, fecha, ahora) {
    if (leerJornada(db, fecha)?.resumen) return null
    asegurarJornada(db, fecha, ahora)
    const { eventos } = await agendaDelDia(fecha).catch(() => ({ eventos: [] as { titulo: string; lugar: string | null; todoElDia: boolean }[] }))
    const primarias = conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa', 'sugerida'] }))
    const aceptadas = primarias.filter((p) => p.estado === 'activa')
    const tocan = sideQuestsRelevantes(db, eventos.map((e) => `${e.titulo} ${e.lugar ?? ''}`).join(' '))
    const deben = seguimientos(db, ahora)
    const partes = [
      new Date(ahora).getHours() < 13 ? 'Buen día.' : new Date(ahora).getHours() < 20 ? 'Buenas tardes.' : 'Buenas noches.',
      eventos.length ? `Hoy tenés ${eventos.length === 1 ? 'una cosa' : `${eventos.length} cosas`} en la agenda.` : '',
      aceptadas.length ? `Tus primarias de la semana: ${aceptadas.map((p) => `${p.titulo} (${p.avance.progreso}%)`).join(', ')}.`
        : primarias.length ? 'Te dejé primarias sugeridas para la semana: aceptalas o cambialas en Misiones.' : 'No tenés primarias esta semana; si querés te las propongo.',
      tocan.length ? `Por donde andás hoy podés cumplir una side quest: ${tocan.map((m) => m.titulo).join(', ')}.` : '',
      deben.length ? `Te deben respuesta: ${deben.map((m) => m.titulo).join(', ')}.` : '',
      'Cuando quieras arrancamos una run: decime cuánto tiempo tenés y cómo estás.',
    ].filter(Boolean)
    fijarResumen(db, fecha, partes.slice(1, -1).join(' ') || 'Día sin nada agendado.', ahora)
    return partes.join(' ')
  },
  async cierre(db, fecha, ahora) {
    const j = leerJornada(db, fecha)
    const huboRun = !!db.prepare(`SELECT 1 FROM runs WHERE fecha = ? AND estado IN ('en_curso', 'cerrada')`).get(fecha)
    if ((!j && !huboRun) || j?.cierre) return null
    return textoDeCierre(db, fecha, ahora)
  },
  /** Temprano: cada ayudante deja su aporte del día (si no lo dejó ya), dentro del tope de la liga. */
  async ayudantes(db, _fecha, ahora) {
    const r = await pedirAportes(db, { ahora, soloSinAporteHoy: true })
    if (!r.aportes.length) return r.frenado ? `Tus ayudantes no trabajaron hoy: ${r.frenado}.` : null
    return `Tus ayudantes te dejaron ${r.aportes.length} aporte${r.aportes.length > 1 ? 's' : ''}: ${r.aportes.map((a) => `${a.autor} para «${a.titulo.split(' · ').slice(1).join(' · ')}»`).join('; ')}. Los vas a ver en Misiones y entran como material en tu próxima run.${r.frenado ? ` (Me frené: ${r.frenado}.)` : ''}`
  },
  /** A la mañana, el gemelo predice el día (sellado: no se le cuenta, para no condicionarlo). */
  async prediccion(db, fecha, ahora) {
    await predecirDia(db, fecha, ahora)
    return null
  },
  /** A la noche, el gemelo se califica y cuenta cómo le fue. */
  async calificacion(db, fecha, ahora) {
    const r = await calificarDia(db, fecha, { ahora })
    return r.predicciones.length ? textoDeCalificacion(r) : null
  },
  /** Lunes y jueves: el radar busca oportunidades para sus metas. */
  async radar(db, _fecha, ahora) {
    const r = await buscarOportunidades(db, { ahora })
    if (!r.nuevas.length) return r.aviso ? `El radar no pudo salir: ${r.aviso}` : null
    return `El radar encontró ${r.nuevas.length} oportunidad${r.nuevas.length > 1 ? 'es' : ''}: ${r.nuevas.slice(0, 5).map((o) => o.titulo).join(' · ')}. Están en Radar, con por qué te sirven; si una te interesa, te armo el borrador.`
  },
  /** El lunes: primarias sugeridas para la semana (si no las tiene ya). */
  async semana(db, _fecha, ahora) {
    const semana = semanaDe(ahora)
    if (listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana, estados: ['activa', 'sugerida'] }).length) return null
    const ps = await proponerPrimarias(db, semana, { ahora })
    if (!ps.length) return null
    return `Arranca la semana. Te propongo ${ps.length} primarias: ${ps.map((p) => p.titulo).join(' · ')}. Aceptalas, cambialas o descartalas en Misiones; son tuyas.`
  },
  /** El domingo a la noche: el reporte de la semana que termina. */
  async reporte_semanal(db, _fecha, ahora) {
    const semana = semanaDe(ahora)
    const hubo = db.prepare(`SELECT 1 FROM misiones WHERE semana = ? OR run_id IN (SELECT id FROM runs WHERE estado IN ('en_curso', 'cerrada') AND creada_en > ?) LIMIT 1`).get(semana, ahora - 7 * 86_400_000)
    if (!hubo) return null
    const r = await reporteSemana(db, semana, { ahora })
    return `Reporte de la semana ${semana}.\n\n${r.texto}`
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
