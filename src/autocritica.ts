/**
 * La autocrítica: Mastropiero mira lo que se rompió (errores del servidor, rutas que no existen, rutinas y forjas que
 * fallaron, tandas que no se procesaron) y lo que el operador se quejó, y lo convierte en propuestas de mejora para
 * La Fragua. Así el sistema se arregla de noche y él solo aprueba. No toca código: solo propone.
 */
import { type Db } from './db.ts'
import { pedirJson } from './modelo.ts'

const DIA = 86_400_000

/** Anota un error (uno por texto y día: si se repite, suma veces). */
export function registrarError(db: Db, origen: string, texto: string, ahora = Date.now()) {
  const t = texto.replace(/\s+/g, ' ').trim().slice(0, 600)
  if (!t) return
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

/** Lo que el operador dijo que anda mal (en el chat, últimos días). */
const QUEJA = /no anda|no funciona|no me deja|no carga|no aparece|no responde|se rompi|se cuelga|se tild|anda mal|me tira|error|falla|bug|molesta|tarda (mucho|una banda)|lent[oa]|ruta desconocida/i

export function materialDeAutocritica(db: Db, ahora = Date.now(), dias = 2): string {
  const desde = ahora - dias * DIA
  const errores = db.prepare('SELECT origen, texto, veces FROM errores WHERE ultima >= ? ORDER BY veces DESC, ultima DESC LIMIT 25').all(desde) as { origen: string; texto: string; veces: number }[]
  const quejas = (db.prepare(`SELECT m.texto FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id WHERE m.rol = 'operador' AND c.con = 'mastropiero' AND m.en >= ? ORDER BY m.id DESC LIMIT 200`).all(desde) as { texto: string }[])
    .map((m) => m.texto).filter((t) => QUEJA.test(t)).slice(0, 12)
  const rutinas = (db.prepare(`SELECT texto FROM mensajes WHERE rol = 'asistente' AND modelo = 'rutina' AND texto LIKE 'No pude %' AND en >= ? ORDER BY id DESC LIMIT 10`).all(desde) as { texto: string }[]).map((m) => m.texto)
  const forjas = db.prepare(`SELECT id, pedido, estado, salida FROM fragua WHERE estado IN ('fallo', 'rota') AND creada_en >= ? ORDER BY id DESC LIMIT 5`).all(desde) as { id: number; pedido: string; estado: string; salida: string | null }[]
  const tandas = (db.prepare(`SELECT archivo, error FROM tandas WHERE estado = 'fallo' AND creada_en >= ? ORDER BY id DESC LIMIT 8`).all(desde) as { archivo: string; error: string | null }[])
  return [
    errores.length ? `ERRORES DEL SERVIDOR:\n${errores.map((e) => `- [${e.origen}${e.veces > 1 ? ` ×${e.veces}` : ''}] ${e.texto}`).join('\n')}` : '',
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
    const prioridad = ['alta', 'media', 'baja'].includes(p?.prioridad) ? p.prioridad : 'media'
    const r = alta.run(titulo, detalle, String(p?.area ?? 'otro').slice(0, 30), prioridad, ahora)
    creadas.push({ id: Number(r.lastInsertRowid), titulo })
  }
  return creadas
}
