/**
 * Rutinas: lo que Mastropiero hace solo, a su hora. Corren mientras el servidor está prendido;
 * si al arrancar ya pasó la hora de una rutina de hoy, se pone al día. Una rutina corre una vez por día.
 * Todo lo que gastan cuenta para el tope diario de lo que corre solo (ajuste tokens_dia_max).
 */
import fs from 'node:fs'
import path from 'node:path'
import { ajuste, fechaLocal, type Db } from './db.ts'
import { aMin, asegurarJornada, fijarResumen, leerJornada, textoDeCierre } from './jornada.ts'
import { agendaDelDia } from './calendario.ts'
import { conversacionHoy, mensajeDeMastropiero } from './chat/index.ts'
import { ayudantesDe, pedirAportes, sumarAyudante } from './ayudantes.ts'
import { autocritica } from './autocritica.ts'
import { forjarPendientes } from './fragua.ts'
import { expandirTanda, paraExpandir } from './libreria.ts'
import { guionMatinal } from './matinal.ts'
import { sintetizar } from './taller.ts'
import { decir, mandarAudio, preguntarSueno, telegramActivo } from './telegram.ts'
import { listarAprendizajes } from './aprender.ts'
import { escribirCronica, sintesisSemanal } from './gnosis.ts'
import { calificarDia, predecirDia, textoDeCalificacion } from './gemelo.ts'
import { buscarOportunidades } from './radar.ts'
import { enEspera, reanudarIngesta } from './bus.ts'
import { tickUnico } from './mastropiero.ts'
import { cerrarTemporada } from './economia.ts'
import { brujulaDelDia, textoDeBrujula } from './brujula.ts'
import { recomendar } from './mentor.ts'
import { proponerPuentes } from './puentes.ts'
import { enFondo, topeAlcanzado } from './nan.ts'
import { anotarSideQuest, conAvance, listarMisiones, proponerPrimarias, reporteSemana, semanaDe, seguimientos, sideQuestsRelevantes } from './misiones.ts'

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
  /**
   * Temprano: cada primaria aceptada que no tiene ayudante recibe uno (ajuste ayudantes_auto), y cada ayudante deja su
   * aporte del día (si no lo dejó ya), dentro del tope.
   */
  async ayudantes(db, _fecha, ahora) {
    const nuevos: string[] = []
    if (ajuste(db, 'ayudantes_auto') !== '0') {
      for (const p of listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] })) {
        if (ayudantesDe(db, p.id).length) continue
        try { sumarAyudante(db, p.id, { ahora }); nuevos.push(p.titulo) } catch { /* una primaria que no admite ayudante: sigue */ }
      }
    }
    const sumados = nuevos.length ? `Le puse un ayudante a ${nuevos.length === 1 ? 'tu primaria' : `${nuevos.length} primarias`} que no tenía${nuevos.length === 1 ? '' : 'n'}: ${nuevos.join(' · ')}. ` : ''
    const r = await pedirAportes(db, { ahora, soloSinAporteHoy: true })
    if (!r.aportes.length) return r.frenado ? `${sumados}Tus ayudantes no trabajaron hoy: ${r.frenado}.` : sumados.trim() || null
    return `${sumados}Tus ayudantes te dejaron ${r.aportes.length} aporte${r.aportes.length > 1 ? 's' : ''}: ${r.aportes.map((a) => `${a.autor} para «${a.titulo.split(' · ').slice(1).join(' · ')}»`).join('; ')}. Los vas a ver en Misiones y entran como material en tu próxima run.${r.frenado ? ` (Me frené: ${r.frenado}.)` : ''}`
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
  /** Los lunes (en la nube): la Academia propone qué le conviene aprender para lo que viene; quedan en 📥 Para validar. */
  async academia(db, _fecha, ahora) {
    if (topeAlcanzado(db, ahora) || !(await import('./reproceso.ts')).enLaNube()) return null
    const ac = await import('./academia.ts')
    const xs = await ac.sugerirAprendizajes(db, { ahora })
    if (!xs.length) return null
    return `Para lo que viene, le conviene aprender: ${xs.map((d) => `**${d.tema}** (${ac.textoSugerencia(d)})`).join('; ')}. Están en 📥 Para validar: si acepta, armo el tutor y busco las primeras fuentes.`
  },
  /** Los domingos (en la nube): dónde no alcanza su información (sus metas y sus dominios contra el archivo), con una idea para cada hueco. */
  async huecos(db, _fecha, ahora) {
    if (topeAlcanzado(db, ahora) || !(await import('./reproceso.ts')).enLaNube()) return null
    const r = await (await import('./academia.ts')).reporteHuecos(db, ahora)
    return r?.texto ?? null
  },
  /** De madrugada: el grafo de su voz y el de todo el corpus, en el hilo aparte (solo CPU, sin tokens; si nada cambió, nada). */
  async grafo(db, _fecha, ahora) {
    const g = await import('./grafo/index.ts')
    for (const clave of ['voz', 'todo'] as const) {
      try { await g.recalcular(db, g.grafoPorClave(db, clave).id, { ahora }) } catch (e) { console.error(`  grafo ${clave}:`, e instanceof Error ? e.message : e) }
    }
    return null
  },
  /** Los domingos (en la nube): su feedback de la semana se vuelve lecciones que entran a los prompts. */
  async lecciones(db, _fecha, ahora) {
    if (topeAlcanzado(db, ahora) || !(await import('./reproceso.ts')).enLaNube()) return null
    const d = await import('./devoluciones.ts')
    const r = await d.destilarLecciones(db, ahora)
    const sups = Object.keys(r)
    if (!sups.length) return null
    return `Aprendí de tu feedback de la semana: ${sups.map((s) => `${d.SUPERFICIES[s].toLowerCase()} (${r[s]} lecciones)`).join(', ')}. Las ves y las corregís en La máquina → Revisión.`
  },
  /** De madrugada (en la nube): material nuevo para el dominio que hace más que no busca. Al corpus, sin aviso. */
  async fuentes(db, _fecha, ahora) {
    if (topeAlcanzado(db, ahora) || !(await import('./reproceso.ts')).enLaNube()) return null
    const ac = await import('./academia.ts')
    const d = ac.dominioParaFuentes(db, ahora)
    if (d) await ac.buscarFuentes(db, d.id, { ahora })
    return null
  },
  /** Lunes y jueves: el radar busca oportunidades para sus metas. */
  async radar(db, _fecha, ahora) {
    const r = await buscarOportunidades(db, { ahora })
    if (!r.nuevas.length) return r.aviso ? `El radar no pudo salir: ${r.aviso}` : null
    return `El radar encontró ${r.nuevas.length} oportunidad${r.nuevas.length > 1 ? 'es' : ''}: ${r.nuevas.slice(0, 5).map((o) => o.titulo).join(' · ')}. Están en Radar, con por qué te sirven; si una te interesa, te armo el borrador.`
  },
  /** El lunes: primarias sugeridas para la semana (si no las tiene ya), y una práctica para lo que quiere aprender y quedó quieto. */
  async semana(db, _fecha, ahora) {
    // Los dominios con meta: UNA side quest para la semana con las clases que pide el ritmo (vence el domingo).
    const { listarDominios } = await import('./academia.ts')
    const conMeta = new Set<number>()
    for (const d of listarDominios(db, ahora).filter((x) => x.estado === 'activo' && x.ritmo && (x.ritmo.estado === 'al_dia' || x.ritmo.estado === 'atrasado'))) {
      conMeta.add(d.id)
      const domingo = new Date(ahora + ((7 - new Date(ahora).getDay()) % 7) * 86_400_000)
      anotarSideQuest(db, { titulo: `${d.ritmo!.porSemana} clase${d.ritmo!.porSemana === 1 ? '' : 's'} de ${d.tema} esta semana`, detalle: d.ritmo!.texto, vence: fechaLocal(domingo.getTime()), sugerida: true, creadaPor: 'academia' }, ahora)
    }
    for (const a of listarAprendizajes(db, { estado: 'activo' }, ahora).filter((x) => !conMeta.has(x.id) && (x.diasSinPracticar == null || x.diasSinPracticar >= 7))) {
      anotarSideQuest(db, { titulo: `Practicar ${a.tema} (20 min)`, detalle: a.ultima ? `La última vez fue el ${a.ultima}.` : 'Todavía no hay práctica anotada.', sugerida: true, creadaPor: 'mastropiero' }, ahora)
    }
    const semana = semanaDe(ahora)
    if (listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana, estados: ['activa', 'sugerida'] }).length) return null
    const ps = await proponerPrimarias(db, semana, { ahora })
    if (!ps.length) return null
    return `Arranca la semana. Te propongo ${ps.length} primarias: ${ps.map((p) => p.titulo).join(' · ')}. Aceptalas, cambialas o descartalas en Misiones; son tuyas.`
  },
  /**
   * Con la ingesta en pausa: cada mañana despierta unas pocas piezas suyas (las más pesadas) y la liga las procesa,
   * de a poco y sin quemar tokens en masa. Con la ingesta andando, no hace nada.
   */
  async destilar(db, _fecha, ahora) {
    const n = Number(ajuste(db, 'destilar_por_dia') ?? 15)
    if (!n || !enEspera(db)) return null
    const despiertas = reanudarIngesta(db, { limite: n, soloPropias: true }, ahora)
    if (!despiertas) return null
    let ticks = 0
    const quedan = () => (db.prepare(`SELECT COUNT(*) AS n FROM tareas WHERE pipeline = 'ingesta' AND estado IN ('pendiente', 'asignada')`).get() as { n: number }).n
    while (quedan() && ticks < 3 * 4 && !topeAlcanzado(db)) {
      try { await tickUnico(db) } catch { break } // otro tick en curso: que siga él
      ticks++
    }
    return null // trabajo de fondo: no hace falta avisarle en Hoy (queda en la crónica de la liga)
  },
  /** Cada mañana: el tridente del día (no una lista de tareas). */
  async brujula(db, _fecha, ahora) {
    return textoDeBrujula(await brujulaDelDia(db, { ahora }))
  },
  /** Lunes: qué leer, ver o estudiar esta semana, de su Librería, para sus primarias. */
  async mentor(db, _fecha, ahora) {
    if (!(db.prepare('SELECT 1 FROM obras LIMIT 1').get())) return null
    const rs = await recomendar(db, ahora)
    if (!rs.length) return null
    return `🧭 El Mentor, para esta semana:\n${rs.map((r) => `• **${r.accion}** — ${r.porQue}`).join('\n')}\nEstán en Librería → Mentor: aceptá las que quieras y las anoto.`
  },
  /** Domingo: puentes con su gente (presentar a dos, retomar con alguien), si hay razones reales. */
  async puentes(db, _fecha, ahora) {
    let ps
    try { ps = await proponerPuentes(db, ahora) } catch { return null }
    if (!ps.length) return null
    return `🌉 Puentes para esta semana:\n${ps.map((p) => `• ${p.tipo === 'presentar' ? `Presentar a ${p.personas.map((x) => x.nombre).join(' y ')}` : `Retomar con ${p.personas[0]?.nombre}`}: ${p.motivo}`).join('\n')}\nEn Personas tenés el borrador de cada uno.`
  },
  /** Lunes temprano: cierra la temporada de la semana que terminó (la liga se arregla sola). Queda en la crónica. */
  async temporada(db, _fecha, ahora) {
    cerrarTemporada(db, semanaDe(ahora - 86_400_000), ahora)
    return null
  },
  /** De madrugada: lo que se rompió y lo que él se quejó se vuelve propuestas de arreglo para La Fragua. */
  async autocritica(db, _fecha, ahora) {
    if (topeAlcanzado(db, ahora)) return null
    const ps = await autocritica(db, ahora)
    return ps.length ? `Revisé lo que se rompió estos días y anoté ${ps.length} arreglo${ps.length > 1 ? 's' : ''} para La Fragua: ${ps.map((p) => p.titulo).join(' · ')}.` : null
  },
  /** De noche: La Fragua forja las propuestas abiertas (ajuste fragua_por_noche). A la mañana, él lee y aplica. */
  async fragua(db, _fecha, ahora) {
    const limite = Number(ajuste(db, 'fragua_por_noche') ?? 3)
    if (!limite || !fs.existsSync(path.join(process.cwd(), '.git'))) return null
    const r = await forjarPendientes(db, { limite, frenar: () => topeAlcanzado(db) })
    if (!r.forjas.length) return r.frenado ? `La Fragua no forjó esta noche: ${r.frenado}.` : null
    const listas = r.forjas.filter((f) => f.estado === 'lista')
    const resto = r.forjas.length - listas.length
    const titulo = (f: { pedido: string }) => f.pedido.split('\n')[0].slice(0, 80)
    return [
      `🔨 Esta noche La Fragua forjó ${r.forjas.length} propuesta${r.forjas.length > 1 ? 's' : ''}.`,
      listas.length ? `Listas para aplicar (compilan y pasan los tests): ${listas.map(titulo).join(' · ')}. Leelas en La Fragua y aplicá las que quieras.` : '',
      resto ? `${resto} no salió${resto > 1 ? 'eron' : ''}: quedan en La Fragua con el error.` : '',
      r.frenado ? `Me frené antes: ${r.frenado}.` : '',
    ].filter(Boolean).join(' ')
  },
  /** De noche: expande obras de su Librería (la fuente al corpus, un resumen), así a la mañana sabe más. */
  async lectura(db, _fecha, ahora) {
    const n = Number(ajuste(db, 'lectura_obras') ?? 10)
    if (!n || topeAlcanzado(db, ahora) || !paraExpandir(db, 1).length) return null
    let r
    try { r = await expandirTanda(db, n) } catch { return null } // ya estaba expandiendo: que siga eso
    return r.hechas ? `📚 Leí de noche ${r.hechas} obra${r.hechas > 1 ? 's' : ''} de tu Librería: ya están en el corpus, con su resumen.` : null
  },
  /** Temprano: el audio de la mañana por Telegram (y el texto en Hoy). */
  async matinal(db, fecha, ahora) {
    if (topeAlcanzado(db, ahora)) return null
    const guion = await guionMatinal(db, fecha, ahora)
    let enAudio = false
    if (telegramActivo()) {
      try { enAudio = await mandarAudio(await sintetizar(guion), 'La mañana', '🎧 La mañana. Contestame con una nota de voz.') } catch { /* sin voz: va el texto */ }
    }
    mensajeDeMastropiero(db, conversacionHoy(db).id, `🎧 **La mañana**${enAudio ? ' (te lo mandé en audio por Telegram)' : ''}\n\n${guion}`, { canales: !enAudio })
    await preguntarSueno(db, ahora).catch(() => {})
    return null
  },
  /** Antes de medianoche: lo vivido hoy (cuerpo, plata, aprendizaje, trabajo) entra al corpus como crónica propia. */
  async cronica(db, fecha, ahora) {
    escribirCronica(db, fecha, ahora)
    return null
  },
  /** El domingo: la semana destilada; los patrones quedan como quántomos para pesar y como recuerdos. */
  async gnosis(db, fecha, ahora) {
    if (topeAlcanzado(db, ahora)) return null
    const r = await sintesisSemanal(db, fecha, ahora)
    if (!r?.texto) return null
    return `🜂 **La semana destilada**\n\n${r.texto}${r.patrones ? `\n\nEncontré ${r.patrones} patrón${r.patrones > 1 ? 'es' : ''}: quedaron como quántomos para que los peses (Corpus → Quántomos).` : ''}${r.preguntas ? ` Y te dejé ${r.preguntas === 1 ? 'una pregunta' : `${r.preguntas} preguntas`}.` : ''}`
  },
  /** El domingo: la evidencia de la semana de cada identidad, contra su historia vieja (una pregunta cada una, sin modelo). */
  async evidencia(db, _fecha, ahora) {
    const n = (await import('./evidencia.ts')).preguntasDeEvidencia(db, ahora)
    return n ? `🗳 Te dejé ${n === 1 ? 'una pregunta' : `${n} preguntas`} sobre tu evidencia de la semana (/pregunta en Telegram, o en Hoy).` : null
  },
  /** El sábado (en la nube): tus 3 procesos más caros de la semana con su to-be; lo de construir va como propuesta. */
  async mis_procesos(db, _fecha, ahora) {
    if (topeAlcanzado(db, ahora) || !(await import('./reproceso.ts')).enLaNube()) return null
    const r = await (await import('./procesos.ts')).descubrirMisProcesos(db, ahora)
    return r.procesos ? `🔍 **El discovery de tu semana**: miré tus logs y encontré ${r.procesos === 1 ? 'un proceso' : `${r.procesos} procesos`} que te cuestan tiempo, con qué borrar, automatizar o dejar en vos (Discovery → Vos).${r.propuestas ? ` Dejé ${r.propuestas === 1 ? 'una propuesta' : `${r.propuestas} propuestas`} para La Fragua.` : ''}` : null
  },
  /** A la noche: lo que espera tu ok, lo que hice solo y, si algo acierta casi siempre, la oferta de hacerlo solo (con botones). */
  async bandeja(db, _fecha, ahora) {
    const a = (await import('./sombra.ts')).avisoBandeja(db, ahora)
    if (!a) return null
    if (telegramActivo()) await decir(a.texto, a.botones.length ? a.botones : undefined).catch(() => null)
    return a.texto
  },
  /** A la tarde, por Telegram y solo si llegó algo nuevo de verdad (3 o más desde la última jugada): La Mano. En Hoy ya está el chip. */
  async mano(db, _fecha, ahora) {
    const t = (await import('./mano.ts')).avisoMano(db, ahora)
    if (t && telegramActivo()) await decir(t).catch(() => null)
    return null
  },
  /** El domingo: tu vara contra la de cada modelo de tu consejo (una pregunta por modelo, sin modelo de lenguaje). */
  async modelos(db, _fecha, ahora) {
    const n = (await import('./modelos.ts')).preguntasDeCalibracion(db, ahora)
    return n ? `♛ Te dejé ${n === 1 ? 'una pregunta' : `${n} preguntas`} para calibrar tu vara con la de tus modelos.` : null
  },
  /** Una vez por mes (corre los domingos y se fija si pasaron 4 semanas): ¿tus creencias son tuyas o heredadas? */
  async creencias(db, _fecha, ahora) {
    if (topeAlcanzado(db, ahora)) return null
    const n = await (await import('./suenos.ts')).preguntarCreencias(db, ahora)
    return n ? `🜁 Este mes: ${n === 1 ? 'una creencia tuya' : `${n} creencias tuyas`} para mirar de dónde ${n === 1 ? 'viene' : 'vienen'} (te llegan como preguntas, de a una).` : null
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
      const mensaje = await enFondo(() => accion(db, hoy, ahora))
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
