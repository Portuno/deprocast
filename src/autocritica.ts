/**
 * La autocrítica: Mastropiero mira lo que se rompió (errores del servidor, rutas que no existen, rutinas y forjas que
 * fallaron, tandas que no se procesaron) y lo que el operador se quejó, y lo convierte en propuestas de mejora para
 * La Fragua. Así el sistema se arregla de noche y él solo aprueba. No toca código: solo propone.
 */
import { ajuste as ajusteDe, fijarAjuste as fijarAjusteDe, type Db } from './db.ts'
import { registrarFallo } from './fallos.ts'
import { abiertaParecida, sumarAPropuesta } from './fragua-grupos.ts'
import { pedirJson } from './modelo.ts'

const DIA = 86_400_000

/** Anota un error (uno por texto y día: si se repite, suma veces). */
export function registrarError(db: Db, origen: string, texto: string, ahora = Date.now()) {
  const t = texto.replace(/\s+/g, ' ').trim().slice(0, 600)
  if (!t) return
  // Lo que no es «lento» va como fallo estructurado: con código, causa, acción y huella (Fragua #191).
  if (origen !== 'lento') {
    registrarFallo(db, { origen, mensaje: t }, ahora)
    try { db.prepare('DELETE FROM errores WHERE ultima < ?').run(ahora - 30 * DIA) } catch { /* nada */ }
    return
  }
  try {
    const ya = db.prepare('SELECT id FROM errores WHERE origen = ? AND texto = ? AND ultima > ?').get(origen, t, ahora - DIA) as { id: number } | undefined
    if (ya) db.prepare('UPDATE errores SET veces = veces + 1, ultima = ? WHERE id = ?').run(ahora, ya.id)
    else db.prepare('INSERT INTO errores (origen, texto, primera, ultima) VALUES (?, ?, ?, ?)').run(origen, t, ahora, ahora)
    db.prepare('DELETE FROM errores WHERE ultima < ?').run(ahora - 30 * DIA)
  } catch { /* anotar un error nunca rompe nada */ }
}

/** Un error de una ruta que vale anotar: la que no existe, o uno de programación (no «Acción inválida» y similares). */
export function esErrorDeCodigo(e: unknown): boolean {
  if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError) return true
  const m = e instanceof Error ? e.message : String(e)
  return /cannot read|undefined|is not a function|is not defined|SQLITE|no such (table|column)|ruta desconocida/i.test(m)
}

/**
 * Lo lento y lo que se rompe (plan v38, fase 1): las rutas que tardaron más de un segundo, agrupadas (cuántas veces,
 * la mediana y el peor), y los demás errores de los últimos días con sus veces. Para decidir con datos qué arreglar.
 */
export function lento(db: Db, ahora = Date.now(), dias = 7) {
  const desde = ahora - dias * DIA
  const filas = db.prepare('SELECT origen, texto, veces, ultima FROM errores WHERE ultima >= ? ORDER BY ultima DESC').all(desde) as { origen: string; texto: string; veces: number; ultima: number }[]
  const rutas = new Map<string, number[]>()
  for (const f of filas.filter((x) => x.origen === 'lento')) {
    const m = /^(.+?) tardó (\d+) ms$/.exec(f.texto) // rutas («GET /api/x tardó…») y pasos («paso liga:x tardó…»)
    if (!m) continue
    const ms = rutas.get(m[1]) ?? []
    for (let i = 0; i < f.veces; i++) ms.push(Number(m[2]))
    rutas.set(m[1], ms)
  }
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  // Los bloqueos del event loop: cuántas veces apareció cada tarea en marcha mientras todo estaba frenado.
  const bloqueos = filas.filter((x) => x.origen === 'lento' && x.texto.startsWith('bloqueo de ')).map((x) => ({ ms: Number(/bloqueo de (\d+)/.exec(x.texto)?.[1] ?? 0), durante: (/\((.*)\)$/.exec(x.texto)?.[1] ?? '').split(', ').filter(Boolean), veces: x.veces }))
  const porTarea = new Map<string, number>()
  for (const b of bloqueos.filter((x) => x.ms < 60_000)) for (const t of b.durante) porTarea.set(t, (porTarea.get(t) ?? 0) + b.veces)
  return {
    dias,
    rutas: [...rutas].map(([ruta, ms]) => ({ ruta, veces: ms.length, mediana: med(ms), peor: Math.max(...ms) })).sort((a, b) => b.veces * b.mediana - a.veces * a.mediana),
    errores: filas.filter((x) => x.origen !== 'lento').map((x) => ({ origen: x.origen, texto: x.texto, veces: x.veces, ultima: x.ultima })).slice(0, 80),
    // Más de un minuto es el contenedor dormido, no un bloqueo.
    bloqueos: { veces: bloqueos.filter((x) => x.ms < 60_000).reduce((s, x) => s + x.veces, 0), peor: Math.max(0, ...bloqueos.filter((x) => x.ms < 60_000).map((x) => x.ms)), porTarea: [...porTarea].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tarea, veces]) => ({ tarea, veces })) },
  }
}

/** Lo que el operador dijo que anda mal (en el chat, últimos días). */
const QUEJA = /no anda|no funciona|no me deja|no carga|no aparece|no responde|se rompi|se cuelga|se tild|anda mal|me tira|error|falla|bug|molesta|tarda (mucho|una banda)|lent[oa]|ruta desconocida/i

export function materialDeAutocritica(db: Db, ahora = Date.now(), dias = 2): string {
  const desde = ahora - dias * DIA
  const errores = db.prepare(`SELECT origen, texto, veces, codigo, accion FROM errores WHERE ultima >= ? AND COALESCE(ajeno, 0) = 0 AND COALESCE(recuperado, 0) = 0 ORDER BY veces DESC, ultima DESC LIMIT 25`).all(desde) as { origen: string; texto: string; veces: number; codigo: string | null; accion: string | null }[]
  const quejas = (db.prepare(`SELECT m.texto FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id WHERE m.rol = 'operador' AND c.con = 'mastropiero' AND m.en >= ? ORDER BY m.id DESC LIMIT 200`).all(desde) as { texto: string }[])
    .map((m) => m.texto).filter((t) => QUEJA.test(t)).slice(0, 12)
  const rutinas = (db.prepare(`SELECT texto FROM mensajes WHERE rol = 'asistente' AND modelo = 'rutina' AND (texto LIKE 'No pude %' OR texto LIKE 'Falló «%') AND en >= ? ORDER BY id DESC LIMIT 10`).all(desde) as { texto: string }[]).map((m) => m.texto)
  const forjas = db.prepare(`SELECT id, pedido, estado, salida FROM fragua WHERE estado IN ('fallo', 'rota') AND creada_en >= ? ORDER BY id DESC LIMIT 5`).all(desde) as { id: number; pedido: string; estado: string; salida: string | null }[]
  const tandas = (db.prepare(`SELECT archivo, error FROM tandas WHERE estado = 'fallo' AND creada_en >= ? ORDER BY id DESC LIMIT 8`).all(desde) as { archivo: string; error: string | null }[])
  return [
    errores.length ? `ERRORES DEL SERVIDOR:\n${errores.map((e) => `- [${e.origen}${e.codigo && e.codigo !== 'desconocido' ? ` · ${e.codigo}` : ''}${e.veces > 1 ? ` ×${e.veces}` : ''}] ${e.texto}${e.accion && e.codigo !== 'desconocido' ? ` → ${e.accion}` : ''}`).join('\n')}` : '',
    quejas.length ? `LO QUE EL OPERADOR SE QUEJÓ:\n${quejas.map((q) => `- «${q.slice(0, 400)}»`).join('\n')}` : '',
    rutinas.length ? `RUTINAS QUE FALLARON:\n${rutinas.map((r) => `- ${r.slice(0, 300)}`).join('\n')}` : '',
    forjas.length ? `FORJAS QUE NO SALIERON:\n${forjas.map((f) => `- #${f.id} (${f.estado}) ${f.pedido.split('\n')[0].slice(0, 120)}: ${(f.salida ?? '').slice(-400)}`).join('\n')}` : '',
    tandas.length ? `TANDAS QUE FALLARON:\n${tandas.map((t) => `- ${t.archivo}: ${t.error ?? '?'}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

const SISTEMA = `Sos Mastropiero y revisás tus propios problemas: lo que se rompió en el código de la plataforma (Node 24, TypeScript, node:sqlite; pantalla en web/js) y lo que el operador se quejó.
Proponé arreglos de código concretos, para que La Fragua los haga: hasta 3, solo donde la evidencia muestra un problema real y repetido o que le molestó a él. Si no hay nada que valga, devolvé [].
- titulo: corto, qué se arregla.
- detalle: qué pasa (con la evidencia: el error tal cual, la queja), dónde creés que está (archivo o función si se deduce) y qué cambiar. Concreto y chico: que se pueda hacer tocando pocos archivos, con su test.
- area: liga | forja | corpus | quantomos | entidades | chat | pantalla | motores | otro.
- prioridad: alta (se rompe algo que usa) | media | baja.
- No repitas propuestas que ya existen (te paso la lista). Un corte de internet o de NaN no es un bug: no lo propongas salvo que el código lo maneje mal.
Forma: {"propuestas": [{"titulo": string, "detalle": string, "area": string, "prioridad": string}]}`

let modelo = async (db: Db, usuario: string) => (await pedirJson<{ propuestas?: any[] }>({ db, clase: 'mastropiero', agenteId: 'autocritica' }, SISTEMA, usuario, { temperatura: 0.2, maxTokens: 3000 })).datos
export function _probarAutocritica(f: typeof modelo) {
  modelo = f
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, ' ').trim()

/** Revisa los últimos días y deja propuestas nuevas (abiertas, origen «autocritica»). Devuelve las que creó. */
export async function autocritica(db: Db, ahora = Date.now()): Promise<{ id: number; titulo: string }[]> {
  const material = materialDeAutocritica(db, ahora)
  if (!material) return []
  const existentes = db.prepare(`SELECT titulo FROM propuestas WHERE estado = 'abierta' OR creada_en >= ?`).all(ahora - 14 * DIA) as { titulo: string }[]
  const datos = await modelo(db, `${material}\n\nPROPUESTAS QUE YA EXISTEN (no las repitas):\n${existentes.map((p) => `- ${p.titulo}`).join('\n') || '- ninguna'}`)
  const vistas = new Set(existentes.map((p) => norm(p.titulo)))
  const alta = db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, origen, creada_en) VALUES (?, ?, ?, ?, 'abierta', 'autocritica', ?)`)
  const creadas: { id: number; titulo: string }[] = []
  for (const p of (Array.isArray(datos?.propuestas) ? datos.propuestas : []).slice(0, 3)) {
    const titulo = String(p?.titulo ?? '').trim().slice(0, 160)
    const detalle = String(p?.detalle ?? '').trim().slice(0, 3000)
    if (titulo.length < 4 || detalle.length < 20 || vistas.has(norm(titulo))) continue
    vistas.add(norm(titulo))
    // Fragua #208: con la misma causa que una abierta, se suma a esa.
    const ya = abiertaParecida(db, titulo, detalle, p?.area)
    if (ya) { sumarAPropuesta(db, ya.id, titulo, detalle, ahora); continue }
    const prioridad = ['alta', 'media', 'baja'].includes(p?.prioridad) ? p.prioridad : 'media'
    const r = alta.run(titulo, detalle, String(p?.area ?? 'otro').slice(0, 30), prioridad, ahora)
    creadas.push({ id: Number(r.lastInsertRowid), titulo })
  }
  return creadas
}

/** Mide un paso (de la liga, del reproceso…): si tarda más de un segundo, queda anotado como «lento» con su nombre. */
/** Los pasos medidos que están corriendo ahora (el vigía de bloqueos los nombra: así se sabe cuál trabó). */
export const pasosEnMarcha = new Map<string, number>()
export async function medirPaso<T>(db: Db, nombre: string, f: () => T | Promise<T>): Promise<T> {
  const t0 = performance.now()
  pasosEnMarcha.set(nombre, (pasosEnMarcha.get(nombre) ?? 0) + 1)
  try { return await f() } finally {
    const n = (pasosEnMarcha.get(nombre) ?? 1) - 1
    if (n > 0) pasosEnMarcha.set(nombre, n)
    else pasosEnMarcha.delete(nombre)
    const ms = performance.now() - t0
    if (ms > 1000) registrarError(db, 'lento', `paso ${nombre} tardó ${Math.round(ms)} ms`)
  }
}

// ─── los bloqueos, solos a la Fragua (Fragua #212) ──────────────────────

/** Anota un bloqueo del servidor (lo llama el vigía). Se guardan dos semanas. */
export function anotarBloqueo(db: Db, ms: number, durante: string[], ahora = Date.now()) {
  try {
    db.prepare('INSERT INTO bloqueos (en, ms, durante) VALUES (?, ?, ?)').run(ahora, Math.round(ms), JSON.stringify(durante))
    db.prepare('DELETE FROM bloqueos WHERE en < ?').run(ahora - 14 * DIA)
  } catch { /* medir no rompe nada */ }
}

type Hora = { fecha: string; bloqueos: number; peor: number; pasos: { paso: string; veces: number; peor: number }[] }
const SEMANA = 7 * DIA

/**
 * Cada hora: si hubo más de tres bloqueos de más de dos segundos (y menos de un minuto: más es el contenedor dormido),
 * arma una propuesta con los pasos que estaban corriendo, cuántas veces cada uno y el peor tiempo. El mismo paso en la
 * misma semana suma a la propuesta que ya existe (y dice si mejoró, empeoró o sigue igual), en vez de abrir otra.
 */
export function propuestaPorBloqueos(db: Db, ahora = Date.now()): { id: number; nueva: boolean } | null {
  const desde = Math.max(ahora - 3_600_000, Number(ajusteDe(db, 'bloqueos_revisado_hasta') || 0))
  const filas = (db.prepare('SELECT en, ms, durante FROM bloqueos WHERE en > ? AND en <= ? AND ms > 2000 AND ms < 60000').all(desde, ahora) as { en: number; ms: number; durante: string }[])
  if (filas.length <= 3) return null
  fijarAjusteDe(db, 'bloqueos_revisado_hasta', String(ahora))
  const pasos = new Map<string, { veces: number; peor: number }>()
  for (const f of filas) for (const p of (JSON.parse(f.durante) as string[]).length ? JSON.parse(f.durante) as string[] : ['nada anotado']) {
    const x = pasos.get(p) ?? { veces: 0, peor: 0 }
    pasos.set(p, { veces: x.veces + 1, peor: Math.max(x.peor, f.ms) })
  }
  const lista = [...pasos].map(([paso, x]) => ({ paso, ...x })).sort((a, b) => b.veces - a.veces || b.peor - a.peor)
  const hora: Hora = { fecha: new Date(ahora).toISOString(), bloqueos: filas.length, peor: Math.max(...filas.map((f) => f.ms)), pasos: lista.slice(0, 8) }
  const principal = lista[0].paso
  const clave = `bloqueo:${principal}`
  const previa = db.prepare(`SELECT id, estado, creada_en, evidencia FROM propuestas WHERE clave = ? ORDER BY id DESC LIMIT 1`).get(clave) as { id: number; estado: string; creada_en: number; evidencia: string | null } | undefined
  const historia = previa ? (JSON.parse(previa.evidencia ?? '[]') as Hora[]) : []
  const antes = historia.at(-1)
  const tendencia = !antes ? null
    : hora.peor > antes.peor * 1.25 || hora.bloqueos > antes.bloqueos * 1.25 ? 'empeoró'
    : hora.peor < antes.peor * 0.8 && hora.bloqueos <= antes.bloqueos ? 'mejoró' : 'sigue igual'
  const evidencia = (h: Hora) => `${h.fecha.slice(0, 16).replace('T', ' ')} UTC: ${h.bloqueos} bloqueos, el peor de ${h.peor} ms. Pasos en marcha: ${h.pasos.map((p) => `${p.paso} ×${p.veces} (peor ${p.peor} ms)`).join(' · ')}`
  if (previa && previa.creada_en >= ahora - SEMANA) {
    historia.push(hora)
    const cambio = `\n\nOTRA HORA CON BLOQUEOS — ${evidencia(hora)}.${antes ? ` Desde la vez anterior (${antes.bloqueos} bloqueos, peor ${antes.peor} ms): ${tendencia}.` : ''}`
    // Si se había cerrado y vuelve a pasar en la misma semana, se reabre.
    db.prepare(`UPDATE propuestas SET detalle = detalle || ?, evidencia = ?, estado = 'abierta', resuelta_en = NULL, cerrada_por = NULL WHERE id = ?`).run(cambio, JSON.stringify(historia.slice(-24)), previa.id)
    return { id: previa.id, nueva: false }
  }
  const detalle = `El vigía del servidor vio ${hora.bloqueos} bloqueos de más de dos segundos en una hora: todo Deprocast frenado mientras corría esto.
EVIDENCIA — ${evidencia(hora)}.${antes ? `\nLa semana anterior (${antes.fecha.slice(0, 10)}): ${antes.bloqueos} bloqueos, peor ${antes.peor} ms → ${tendencia}.` : ''}
QUÉ CAMBIAR: encontrar en «${principal}» el trabajo síncrono largo (un bucle sobre miles de filas, un cálculo O(n²), una lectura entera) y partirlo en tramos que cedan el event loop (await cada pocos miles), o hacerlo incremental. Criterio de hecho: con el volumen de la nube, ese paso no traba más de 200 ms seguidos.`
  const r = db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, origen, clave, evidencia, creada_en) VALUES (?, ?, 'motores', 'alta', 'abierta', 'bloqueos', ?, ?, ?)`)
    .run(`Bloqueos del servidor durante «${principal.slice(0, 80)}»`, detalle, clave, JSON.stringify([...historia.slice(-23), hora]), ahora)
  return { id: Number(r.lastInsertRowid), nueva: true }
}
