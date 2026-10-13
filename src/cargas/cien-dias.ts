/**
 * Importa un plan con fecha (los Cien Días, el artifact de Claude) a Deprocast: frentes, hábitos, el foco de cada semana,
 * los días ya registrados (verbos, hábitos, WOOP, peso, nota) y las tareas como side quests con fecha. Se puede volver
 * a correr: lo ya importado se actualiza (estado, fecha, texto), no se duplica.
 * Entra como un objeto { fronts, habits, tasks, days, weeks } (cada uno, id → datos), o una carpeta con una subcarpeta
 * por colección y un JSON por documento (como la deja la exportación de la base del artifact).
 */
import fs from 'node:fs'
import path from 'node:path'
import { type Db } from '../db.ts'
import { crearMision, actualizarMision, leerMision } from '../misiones.ts'
import { entidadEnTexto } from '../ayudantes.ts'
import { registrarSalud, listarSalud } from '../salud.ts'
import { crearAprendizaje } from '../aprender.ts'
import { leerDia } from '../cien.ts'

type Docs = Record<string, any>
export type Exportacion = { fronts?: Docs; habits?: Docs; tasks?: Docs; days?: Docs; weeks?: Docs }
export type PlanNuevo = { id: string; nombre: string; desde: string; hasta: string; semana0: string }

export function leerExportacion(dir: string): Exportacion {
  const out: Exportacion = {}
  for (const c of ['fronts', 'habits', 'tasks', 'days', 'weeks'] as const) {
    const d = path.join(dir, c)
    if (!fs.existsSync(d)) continue
    out[c] = Object.fromEntries(fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))]))
  }
  return out
}

const ESTADO: Record<string, 'hecha' | 'descartada' | 'activa'> = { hecha: 'hecha', descartada: 'descartada' }
const IDIOMAS: Record<string, string> = { FR: 'Francés', ZH: 'Chino mandarín', RU: 'Ruso', AR: 'Árabe', EN: 'Inglés', IT: 'Italiano', PT: 'Portugués', DE: 'Alemán', JA: 'Japonés' }

export function importarPlan(db: Db, plan: PlanNuevo, e: Exportacion, ahora = Date.now()) {
  const n = { frentes: 0, habitos: 0, semanas: 0, dias: 0, tareasNuevas: 0, tareasActualizadas: 0, pesos: 0, aprendizajes: 0 }
  db.exec('BEGIN')
  try {
    db.prepare(`INSERT INTO planes (id, nombre, desde, hasta, semana0, creado_en) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, desde = excluded.desde, hasta = excluded.hasta, semana0 = excluded.semana0`).run(plan.id, plan.nombre, plan.desde, plan.hasta, plan.semana0, ahora)
    const frente = db.prepare(`INSERT INTO frentes (id, plan_id, nombre, corto, ganar, principio, orden) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, corto = excluded.corto, ganar = excluded.ganar, principio = excluded.principio, orden = excluded.orden`)
    const cortos = new Map<string, string>([['r', 'Ritual']])
    for (const [id, f] of Object.entries(e.fronts ?? {})) {
      frente.run(id, plan.id, String(f.name ?? id), f.short ?? null, f.win ?? null, f.principle ?? null, Number(f.order) || 0)
      cortos.set(id, String(f.short ?? f.name ?? id))
      n.frentes++
    }
    const habito = db.prepare(`INSERT INTO habitos (id, plan_id, titulo, frente_id, por_semana, dias, orden) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET titulo = excluded.titulo, frente_id = excluded.frente_id, por_semana = excluded.por_semana, dias = excluded.dias, orden = excluded.orden`)
    for (const [id, h] of Object.entries(e.habits ?? {})) {
      habito.run(id, plan.id, String(h.title ?? id), h.front ?? null, Math.max(1, Number(h.perWeek) || 7), JSON.stringify(Array.isArray(h.days) ? h.days.map(Number) : []), Number(h.order) || 0)
      n.habitos++
      // Lo que quiere aprender y ya practica como hábito: «Idiomas: FR · ZH…», «Tests del teórico».
      const idiomas = /idiomas?\s*:\s*([A-Z ·,/]+)/i.exec(String(h.title))
      for (const cod of idiomas ? idiomas[1].split(/[\s·,/]+/).filter(Boolean) : []) {
        if (IDIOMAS[cod.toUpperCase()] && crearAprendizaje(db, { tema: IDIOMAS[cod.toUpperCase()], porQue: `Hábito del plan: ${h.title}`, frenteId: h.front ?? null }, ahora).nuevo) n.aprendizajes++
      }
      if (/te[oó]rico/i.test(String(h.title)) && crearAprendizaje(db, { tema: 'Teórico de conducir', porQue: `Hábito del plan: ${h.title}`, frenteId: h.front ?? null }, ahora).nuevo) n.aprendizajes++
    }
    const semana = db.prepare(`INSERT INTO plan_semanas (plan_id, n, foco) VALUES (?, ?, ?) ON CONFLICT(plan_id, n) DO UPDATE SET foco = excluded.foco`)
    for (const [id, w] of Object.entries(e.weeks ?? {})) {
      const k = Number(/\d+/.exec(id)?.[0])
      if (Number.isFinite(k) && w.focus) { semana.run(plan.id, k, String(w.focus)); n.semanas++ }
    }
    const dia = db.prepare(`INSERT INTO plan_dias (fecha, verbos, habitos, woop, peso, nota, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fecha) DO UPDATE SET verbos = excluded.verbos, habitos = excluded.habitos, woop = excluded.woop, peso = excluded.peso, nota = excluded.nota, actualizado_en = excluded.actualizado_en`)
    for (const [fecha, d] of Object.entries(e.days ?? {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue
      const ya = leerDia(db, fecha) // lo que ya se votó acá manda sobre lo viejo
      const woop = d.woop && Object.values(d.woop).some(Boolean) ? d.woop : ya.woop
      dia.run(fecha, JSON.stringify({ ...(d.verbs ?? {}), ...ya.verbos }), JSON.stringify({ ...(d.habits ?? {}), ...ya.habitos }), woop ? JSON.stringify(woop) : null, d.peso ?? ya.peso ?? null, ya.nota ?? d.nota ?? null, ahora)
      n.dias++
      if (typeof d.peso === 'number' && !listarSalud(db, { fecha, tipo: 'medida' }).length) {
        registrarSalud(db, { tipo: 'medida', titulo: 'Peso', fecha, datos: { peso: d.peso }, fuente: 'cien-dias' }, ahora)
        n.pesos++
      }
    }
    const ya = db.prepare('SELECT mision_id FROM plan_tareas WHERE origen = ?')
    const alta = db.prepare(`INSERT INTO plan_tareas (origen, plan_id, mision_id, frente_id, obligatoria, hito) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(origen) DO UPDATE SET frente_id = excluded.frente_id, obligatoria = excluded.obligatoria, hito = excluded.hito`)
    for (const [id, t] of Object.entries(e.tasks ?? {})) {
      const titulo = String(t.title ?? '').trim()
      if (!titulo) continue
      const estado = ESTADO[t.status] ?? 'activa'
      const vence = /^\d{4}-\d{2}-\d{2}$/.test(t.date ?? '') ? t.date : null
      const detalle = [t.note, t.dateStatus === 'confirmada' || t.dateStatus === 'fija' ? `Fecha ${t.dateStatus}.` : vence ? 'Fecha sugerida.' : ''].filter(Boolean).join(' ').slice(0, 2000) || null
      const previa = (ya.get(`${plan.id}:${id}`) as { mision_id: number } | undefined)?.mision_id
      let misionId: number
      if (previa && leerMision(db, previa)) {
        const m = leerMision(db, previa)!
        // Lo que él ya cerró acá no se reabre desde el plan viejo.
        const nuevoEstado = m.estado === 'hecha' || m.estado === 'descartada' ? m.estado : estado
        actualizarMision(db, previa, { titulo, detalle, vence, estado: nuevoEstado }, { por: 'operador', ahora })
        misionId = previa
        n.tareasActualizadas++
      } else {
        misionId = crearMision(db, {
          nivel: 'terciaria', titulo, detalle, vence, estado, categoria: cortos.get(t.front) ?? null, entidadId: entidadEnTexto(db, titulo), creadaPor: 'cien-dias',
        }, { por: 'operador', ahora }).id
        n.tareasNuevas++
      }
      alta.run(`${plan.id}:${id}`, plan.id, misionId, t.front ?? null, t.required ? 1 : 0, t.kind === 'hito' ? 1 : 0)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return n
}
