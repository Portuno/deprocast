/**
 * El discovery aplicado a vos (procesos con ámbito «yo»): una vez por semana, en la nube, Mastropiero mira tus logs —las
 * bandas de tus runs (planeadas contra hechas, por categoría), lo que vio el Directo (minutos por app y actividad), las
 * herramientas que usás y las side quests que se repiten— y saca tus 3 procesos recurrentes más caros en minutos por
 * semana, cada uno con su to-be: borrar, código (va como propuesta para La Fragua), agente o rutina (propuesta), o vos.
 * El KPI es el de siempre: minutos por semana antes y después.
 * Y lo de los clientes que sigue en el tiempo: el tablero de minutos ahorrados de sus champions.
 */
import { fechaLocal, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { procesosDe, type PasoAsis, type PasoTobe } from './discovery.ts'

const DIA = 86_400_000
let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'procesos' }, sistema, usuario, { temperatura: 0.2, maxTokens: 4000, largo: true })).datos
export function _probarProcesos(f: typeof modelo) {
  modelo = f
}

/** Lo que dicen tus logs de la última semana (o de n días), en texto: el material del discovery de vos. */
export function tusLogs(db: Db, ahora = Date.now(), dias = 7): string {
  const desde = ahora - dias * DIA
  const bandas = db.prepare(`SELECT COALESCE(categoria, 'sin categoría') AS categoria, COUNT(*) AS n, SUM(estado = 'hecha') AS hechas, SUM(estado = 'no') AS no, SUM(COALESCE(minutos, 0)) AS minutos
    FROM misiones WHERE personaje = 'jugador' AND nivel = 'secundaria' AND creada_en >= ? GROUP BY 1 ORDER BY minutos DESC LIMIT 12`).all(desde) as any[]
  const titulos = db.prepare(`SELECT titulo, COUNT(*) AS n FROM misiones WHERE personaje = 'jugador' AND nivel = 'secundaria' AND creada_en >= ? GROUP BY lower(titulo) HAVING n >= 2 ORDER BY n DESC LIMIT 10`).all(ahora - 28 * DIA) as any[]
  const directo = db.prepare(`SELECT COALESCE(app, '?') AS app, COALESCE(actividad, '?') AS actividad, ROUND(SUM(MAX(hasta - desde, 60000)) / 60000.0) AS minutos, COUNT(*) AS momentos
    FROM directo_momentos WHERE tipo = 'pantalla' AND desde >= ? GROUP BY 1, 2 ORDER BY minutos DESC LIMIT 15`).all(desde) as any[]
  const herramientas = db.prepare(`SELECT nombre, COUNT(*) AS n FROM uso WHERE tipo IN ('herramienta', 'telegram') AND en >= ? GROUP BY nombre ORDER BY n DESC LIMIT 12`).all(desde) as any[]
  const sq = db.prepare(`SELECT titulo, estado FROM misiones WHERE personaje = 'jugador' AND nivel = 'terciaria' AND creada_en >= ? ORDER BY creada_en DESC LIMIT 20`).all(ahora - 28 * DIA) as any[]
  return [
    bandas.length ? `Bandas de la semana por categoría (cantidad · hechas · no · minutos planeados):\n${bandas.map((b) => `- ${b.categoria}: ${b.n} · ${b.hechas} · ${b.no} · ${b.minutos} min`).join('\n')}` : '',
    titulos.length ? `Bandas que se repiten (últimas 4 semanas):\n${titulos.map((t) => `- «${t.titulo}» ×${t.n}`).join('\n')}` : '',
    directo.length ? `Lo que vio el Directo (app · actividad · minutos):\n${directo.map((d) => `- ${d.app} · ${d.actividad} · ${d.minutos} min`).join('\n')}` : '',
    herramientas.length ? `Lo que le pide a Mastropiero (herramientas y comandos, veces):\n${herramientas.map((h) => `- ${h.nombre} ×${h.n}`).join('\n')}` : '',
    sq.length ? `Side quests recientes:\n${sq.map((s) => `- ${s.titulo} [${s.estado}]`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

const SISTEMA = `Hacés el discovery del trabajo del jugador con sus propios logs de la semana (no con lo que dice que hace). Encontrá sus 3 procesos recurrentes que más minutos por semana le cuestan (algo que hace seguido y tiene pasos: «responder mails de clientes», «armar el presupuesto», «publicar en redes», «preparar el taller»).
Para cada uno:
- "nombre", "minutos_semana" (estimado desde los logs), "evidencia" (qué en los logs lo muestra, una frase).
- "pasos": el as-is, 3 a 8 pasos: {"paso", "sistema" (app o herramienta, o null), "minutos" (por vez, estimado)}.
- "tobe": por paso, en el mismo orden: {"destino": "borrar" | "codigo" | "agente" | "persona", "por_que": una frase, "como": si es código o agente, qué habría que construir (una rutina de Deprocast, un ayudante, una integración), o null}. Borrá primero: no automatices lo que no hace falta.
- "minutos_despues": cuánto quedaría por semana.
No inventes procesos sin base en los logs. Si hay poco material, menos procesos. Forma: {"procesos": [...]}`

/** El discovery semanal de vos: tus 3 procesos más caros con su to-be; lo de código o agente queda como propuesta para La Fragua. */
export async function descubrirMisProcesos(db: Db, ahora = Date.now()): Promise<{ procesos: number; propuestas: number }> {
  const material = tusLogs(db, ahora)
  if (material.length < 80) return { procesos: 0, propuestas: 0 }
  const d = await modelo(db, SISTEMA, `Semana que termina el ${fechaLocal(ahora)}.\n\n${material}`)
  let procesos = 0
  let propuestas = 0
  const alta = db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, origen, creada_en) VALUES (?, ?, 'procesos', 'media', 'abierta', 'procesos', ?)`)
  for (const p of (Array.isArray(d?.procesos) ? d.procesos : []).slice(0, 3)) {
    const nombre = String(p?.nombre ?? '').trim().slice(0, 120)
    const pasosIn = Array.isArray(p?.pasos) ? p.pasos.slice(0, 8) : []
    if (!nombre || !pasosIn.length) continue
    const pasos: PasoAsis[] = pasosIn.map((x: any, i: number) => ({ n: i + 1, paso: String(x?.paso ?? '').slice(0, 160), area: null, sistema: x?.sistema ? String(x.sistema).slice(0, 60) : null, quien: 'vos', minutos: Number.isFinite(Number(x?.minutos)) ? Number(x.minutos) : null, frecuencia: null, excepciones: null, fuente: 'log', en_la_doc: true }))
    const tobeIn = Array.isArray(p?.tobe) ? p.tobe : []
    const tobe: PasoTobe[] = pasos.map((x, i) => ({ n: x.n, destino: ['borrar', 'codigo', 'agente', 'persona'].includes(tobeIn[i]?.destino) ? tobeIn[i].destino : 'persona', por_que: String(tobeIn[i]?.por_que ?? '').slice(0, 240), regla: tobeIn[i]?.como ? String(tobeIn[i].como).slice(0, 300) : null }))
    const antes = Number(p?.minutos_semana) || null
    const despues = Number.isFinite(Number(p?.minutos_despues)) ? Number(p.minutos_despues) : null
    const kpis = [{ categoria: 'tiempo_costo', nombre: 'Minutos por semana', linea_base: antes != null ? String(antes) : null, objetivo: despues != null ? String(despues) : null, unidad: 'min', medido_en: String(p?.evidencia ?? 'tus logs').slice(0, 160) }]
    const ya = db.prepare(`SELECT id FROM procesos WHERE ambito = 'yo' AND lower(nombre) = lower(?)`).get(nombre) as { id: number } | undefined
    let id: number
    if (ya) {
      db.prepare('UPDATE procesos SET pasos_asis = ?, pasos_tobe = ?, kpis = ?, actualizado_en = ? WHERE id = ?').run(JSON.stringify(pasos), JSON.stringify(tobe), JSON.stringify(kpis), ahora, ya.id)
      id = ya.id
    } else id = Number(db.prepare(`INSERT INTO procesos (ambito, nombre, pasos_asis, pasos_tobe, kpis, creado_en, actualizado_en) VALUES ('yo', ?, ?, ?, ?, ?, ?)`).run(nombre, JSON.stringify(pasos), JSON.stringify(tobe), JSON.stringify(kpis), ahora, ahora).lastInsertRowid)
    procesos++
    // Lo que pide construir algo: una propuesta (La Fragua la toma), sin repetir las abiertas.
    for (const t of tobe.filter((x) => (x.destino === 'codigo' || x.destino === 'agente') && x.regla)) {
      const paso = pasos.find((x) => x.n === t.n)!
      const titulo = `${t.destino === 'codigo' ? 'Automatizar' : 'Un agente para'}: ${paso.paso}`.slice(0, 160)
      if (db.prepare(`SELECT 1 FROM propuestas WHERE titulo = ? AND (estado = 'abierta' OR creada_en > ?)`).get(titulo, ahora - 28 * DIA)) continue
      alta.run(titulo, `De tu proceso «${nombre}» (≈ ${antes ?? '?'} min por semana; paso ${paso.n}: ${paso.paso}, ~${paso.minutos ?? '?'} min por vez).\n\nQué construir: ${t.regla}\nPor qué: ${t.por_que}\n\n(Proceso #${id}: el discovery de tu semana.)`, ahora)
      propuestas++
    }
  }
  return { procesos, propuestas }
}

/** Tus procesos (ámbito «yo»), con su resumen y su KPI. */
export function misProcesos(db: Db) {
  return procesosDe(db, 'yo')
}

// ─── champions del cliente ──────────────────────────────────────────────

/** Lo que un champion dice que ahorró con IA esta semana (minutos, no tokens). */
export function anotarAhorro(db: Db, encargoId: number, x: { personaId: number; minutos: number; que?: string | null; semana?: string | null }, ahora = Date.now()) {
  const minutos = Math.round(Number(x.minutos))
  if (!Number.isFinite(minutos) || minutos <= 0) throw new Error('¿Cuántos minutos ahorró?')
  const proyecto = (db.prepare('SELECT proyecto_id FROM encargos_ia WHERE id = ?').get(encargoId) as { proyecto_id: number } | undefined)?.proyecto_id
  if (!proyecto) throw new Error(`No existe el encargo ${encargoId}`)
  if (!db.prepare(`SELECT 1 FROM persona_proyecto WHERE persona_id = ? AND proyecto_id = ?`).get(x.personaId, proyecto)) throw new Error('Esa persona no está en el encargo')
  const semana = x.semana && /^\d{4}-\d{2}-\d{2}$/.test(x.semana) ? x.semana : fechaLocal(ahora)
  db.prepare('INSERT INTO champion_ahorros (encargo_id, persona_id, fecha, minutos, que, en) VALUES (?, ?, ?, ?, ?, ?)').run(encargoId, x.personaId, semana, minutos, x.que?.trim().slice(0, 300) || null, ahora)
  return tableroChampions(db, encargoId, ahora)
}

/** El tablero: minutos ahorrados por persona en las últimas 4 semanas (y en total), con lo último que contó. */
export function tableroChampions(db: Db, encargoId: number, ahora = Date.now()) {
  const desde = fechaLocal(ahora - 28 * DIA)
  return (db.prepare(`SELECT e.id, e.nombre, SUM(CASE WHEN a.fecha >= ? THEN a.minutos ELSE 0 END) AS minutos4, SUM(a.minutos) AS total,
      (SELECT que FROM champion_ahorros b WHERE b.encargo_id = a.encargo_id AND b.persona_id = a.persona_id AND b.que IS NOT NULL ORDER BY b.id DESC LIMIT 1) AS ultimo
    FROM champion_ahorros a JOIN entidades e ON e.id = a.persona_id WHERE a.encargo_id = ? GROUP BY a.persona_id ORDER BY minutos4 DESC, total DESC`).all(desde, encargoId) as any[])
    .map((r) => ({ id: r.id as number, nombre: r.nombre as string, minutos4: r.minutos4 as number, total: r.total as number, ultimo: r.ultimo as string | null }))
}

// ─── la sombra del cliente en vivo ──────────────────────────────────────

/**
 * Después de cargar casos en sombra: las reglas que recién pasaron a «actúa sola» y, si el agente ya puede tomar la mitad
 * de los casos, el encargo pasa de sombra a vivo (lo del artículo: desde la semana 3, ~50 % de los casos).
 */
export function revisarSombra(db: Db, encargoId: number, listasAntes: Set<string>, sombra: { reglas: { regla: string; lista: boolean; casos: number; acierto: number }[]; puedeTomar: number }, ahora = Date.now()) {
  const nuevas = sombra.reglas.filter((r) => r.lista && !listasAntes.has(r.regla))
  const e = db.prepare('SELECT estado, nombre FROM encargos_ia WHERE id = ?').get(encargoId) as { estado: string; nombre: string }
  let paso: string | null = null
  if (e.estado === 'sombra' && sombra.puedeTomar >= 50) {
    db.prepare(`UPDATE encargos_ia SET estado = 'vivo', actualizado_en = ? WHERE id = ?`).run(ahora, encargoId)
    paso = 'vivo'
  }
  return { nuevas, paso, aviso: nuevas.length || paso ? [nuevas.length ? `🟢 En «${e.nombre}», ${nuevas.length === 1 ? 'una regla ya puede' : `${nuevas.length} reglas ya pueden`} actuar sola (≥ 99 %): ${nuevas.map((r) => `${r.regla} (${r.acierto} % en ${r.casos} casos)`).join(', ')}.` : '', paso ? `El agente ya puede tomar el ${sombra.puedeTomar} % de los casos: el encargo pasó de sombra a vivo. La persona queda con las excepciones.` : ''].filter(Boolean).join(' ') : null }
}

