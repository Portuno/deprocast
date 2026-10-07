/**
 * Lo que Mastropiero sabe del operador: hechos, metas, preferencias, sueños y visión, con fecha.
 * Nace de lo que el operador dice (nunca de terceros). Nada se pisa: corregir crea una versión nueva.
 */
import { fechaLocal, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { agregarItem } from './personajes.ts'
import { anotarSideQuest } from './misiones.ts'

export const TIPOS_MEMORIA = ['hecho', 'meta', 'preferencia', 'sueño', 'vision', 'correccion'] as const
export type TipoMemoria = (typeof TIPOS_MEMORIA)[number]
export const HORIZONTES = ['castillo', 'campamento', 'trinchera'] as const
export type Horizonte = (typeof HORIZONTES)[number]

export type Recuerdo = {
  id: number
  texto: string
  tipo: TipoMemoria
  horizonte: Horizonte | null
  fecha: string
  origen: number | null
  estado: 'vigente' | 'corregida' | 'archivada'
  revisada: boolean
  reemplaza: number | null
  piezaId: number | null
  creadaPor: string
  creadaEn: number
}

const deFila = (r: any): Recuerdo => ({
  id: r.id, texto: r.texto, tipo: r.tipo, horizonte: r.horizonte, fecha: r.fecha, origen: r.origen, estado: r.estado,
  revisada: r.revisada === 1, reemplaza: r.reemplaza, piezaId: r.pieza_id ?? null, creadaPor: r.creada_por, creadaEn: r.creada_en,
})

const esTipo = (t: unknown): t is TipoMemoria => TIPOS_MEMORIA.includes(t as TipoMemoria)
const esHorizonte = (h: unknown): h is Horizonte => HORIZONTES.includes(h as Horizonte)

function normal(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function leerRecuerdo(db: Db, id: number): Recuerdo | null {
  const r = db.prepare('SELECT * FROM memoria WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

/** Alta. Si ya hay uno vigente que dice lo mismo, devuelve ese. */
export function recordar(
  db: Db,
  r: { texto: string; tipo?: string; horizonte?: string | null; origen?: number | null; piezaId?: number | null; creadaPor?: string; revisada?: boolean; fecha?: string; reemplaza?: number | null },
  ahora = Date.now(),
): Recuerdo {
  const texto = r.texto.trim().replace(/\s+/g, ' ')
  if (!texto) throw new Error('Un recuerdo vacío no se guarda')
  const tipo = esTipo(r.tipo) ? r.tipo : 'hecho'
  const horizonte = esHorizonte(r.horizonte) ? r.horizonte : null
  const n = normal(texto)
  const igual = (db.prepare(`SELECT * FROM memoria WHERE estado = 'vigente'`).all() as any[]).find((x) => {
    const m = normal(x.texto)
    return m === n || (m.length > 24 && n.includes(m)) || (n.length > 24 && m.includes(n))
  })
  if (igual) return deFila(igual)
  const res = db.prepare(
    `INSERT INTO memoria (texto, tipo, horizonte, fecha, origen, pieza_id, estado, revisada, reemplaza, creada_por, creada_en) VALUES (?, ?, ?, ?, ?, ?, 'vigente', ?, ?, ?, ?)`,
  ).run(texto, tipo, horizonte, r.fecha ?? fechaLocal(ahora), r.origen ?? null, r.piezaId ?? null, r.revisada ? 1 : 0, r.reemplaza ?? null, r.creadaPor ?? 'operador', ahora)
  return leerRecuerdo(db, Number(res.lastInsertRowid))!
}

/** Corregir no borra: la versión vieja queda como corregida y la nueva la reemplaza. */
export function corregir(db: Db, id: number, cambios: { texto?: string; tipo?: string; horizonte?: string | null }, por = 'operador', ahora = Date.now()): Recuerdo {
  const viejo = leerRecuerdo(db, id)
  if (!viejo || viejo.estado !== 'vigente') throw new Error(`No hay un recuerdo vigente #${id}`)
  const soloOrden = cambios.texto == null || cambios.texto.trim() === viejo.texto
  if (soloOrden) {
    // Cambiar tipo u horizonte no es corregir el contenido: se actualiza en el lugar.
    db.prepare('UPDATE memoria SET tipo = ?, horizonte = ?, revisada = 1 WHERE id = ?')
      .run(esTipo(cambios.tipo) ? cambios.tipo : viejo.tipo, cambios.horizonte === undefined ? viejo.horizonte : esHorizonte(cambios.horizonte) ? cambios.horizonte : null, id)
    return leerRecuerdo(db, id)!
  }
  db.prepare(`UPDATE memoria SET estado = 'corregida' WHERE id = ?`).run(id)
  const nuevo = db.prepare(
    `INSERT INTO memoria (texto, tipo, horizonte, fecha, origen, estado, revisada, reemplaza, creada_por, creada_en) VALUES (?, ?, ?, ?, ?, 'vigente', 1, ?, ?, ?)`,
  ).run(cambios.texto!.trim(), esTipo(cambios.tipo) ? cambios.tipo : viejo.tipo, cambios.horizonte === undefined ? viejo.horizonte : esHorizonte(cambios.horizonte) ? cambios.horizonte : null,
    fechaLocal(ahora), viejo.origen, id, por, ahora)
  return leerRecuerdo(db, Number(nuevo.lastInsertRowid))!
}

export function archivar(db: Db, id: number) {
  db.prepare(`UPDATE memoria SET estado = 'archivada' WHERE id = ?`).run(id)
}

export function revisar(db: Db, id: number) {
  db.prepare('UPDATE memoria SET revisada = 1 WHERE id = ?').run(id)
}

export function memoriaVigente(db: Db, f: { tipo?: string; horizonte?: string; limite?: number } = {}): Recuerdo[] {
  const where = [`estado = 'vigente'`]
  const args: (string | number)[] = []
  if (f.tipo) where.push('tipo = ?'), args.push(f.tipo)
  if (f.horizonte) where.push('horizonte = ?'), args.push(f.horizonte)
  return db.prepare(`SELECT * FROM memoria WHERE ${where.join(' AND ')} ORDER BY fecha DESC, id DESC LIMIT ?`).all(...args, f.limite ?? 500).map(deFila)
}

/** La memoria como texto para un prompt: metas y preferencias primero, lo más nuevo arriba. */
export function memoriaParaPrompt(db: Db, max = 60): string {
  const orden: Record<string, number> = { vision: 0, meta: 1, preferencia: 2, sueño: 3, correccion: 4, hecho: 5 }
  const rs = memoriaVigente(db).sort((a, b) => (orden[a.tipo] - orden[b.tipo]) || b.fecha.localeCompare(a.fecha)).slice(0, max)
  return rs.map((r) => `- (${r.fecha}) [${r.tipo}${r.horizonte ? ` · ${r.horizonte}` : ''}] ${r.texto}`).join('\n')
}

// ─── el escriba ─────────────────────────────────────────────────────────

const ESCRIBA = `Sos el escriba de memoria de Mastropiero. Leés UN mensaje del operador y anotás solo lo que vale recordar de él a largo plazo:
metas, preferencias (cómo le gusta trabajar, hablar, organizarse), hechos de su vida (personas, lugares, proyectos, decisiones), sueños, visión, y correcciones que hace.
Reglas:
- Solo lo que dice el operador sobre sí o su mundo. Nada que venga de terceros citados, de otras IAs ni de lo que vos suponés.
- Nada pasajero (saludos, pedidos puntuales de una tarea, preguntas sueltas, estados de ánimo de un momento).
- Cada recuerdo, una oración corta en tercera persona («Quiere…», «Prefiere…», «Trabaja en…»).
- tipo: hecho | meta | preferencia | sueño | vision | correccion. horizonte (opcional, solo para metas/visión/sueños): castillo (años, estrategia), campamento (semanas o meses), trinchera (días).
- Entre 0 y 3 recuerdos. Si no hay nada que valga, devolvé la lista vacía.
- inventario (0 a 2, opcional): cosas que dice que TIENE. tipo: capital (plata, bienes), conexion (una persona o grupo con nombre), presencia (un sitio, red o canal suyo), conocimiento, herramienta, acceso, recurso. Con «valor» y «unidad» si hay número.
- side_quests (0 a 2, opcional): encargos chicos que surgen sobre la marcha y dependen de estar en un lugar o haciendo algo («cuando pase por…», «si salgo a caminar…, comprarle X a Y»). «disparador»: {lugar, zona, actividad, cuando}, solo lo que se sabe.
Forma: {"recuerdos": [{"texto": string, "tipo": string, "horizonte": string | null}], "inventario": [{"tipo": string, "nombre": string, "detalle": string, "valor": number | null, "unidad": string | null, "url": string | null}], "side_quests": [{"titulo": string, "detalle": string, "disparador": {"lugar": string | null, "zona": string | null, "actividad": string | null, "cuando": string | null}}]}`

export type FuenteDeMemoria = { texto: string; origen: number | null; pieza: number | null; grabacion: boolean }

/** Lo suyo que ya está cargado: charlas con Mastropiero y piezas propias (de las más pesadas a las más nuevas). */
export function fuentesParaAprender(db: Db, limite: number): FuenteDeMemoria[] {
  const chats = db.prepare(
    `SELECT m.texto, m.conversacion_id AS origen FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
     WHERE m.rol = 'operador' AND c.con = 'mastropiero' AND length(m.texto) > 40 ORDER BY m.id DESC LIMIT ?`,
  ).all(Math.ceil(limite / 3)) as { texto: string; origen: number }[]
  const propias = db.prepare(
    `SELECT id, contenido AS texto FROM corpus WHERE nivel = 'propia' AND tipo = 'materia' AND length(contenido) > 200
     ORDER BY COALESCE(peso, 0) DESC, COALESCE(fecha, '') DESC LIMIT ?`,
  ).all(limite - chats.length) as { id: number; texto: string }[]
  return [
    ...chats.map((c) => ({ texto: c.texto, origen: c.origen, pieza: null, grabacion: false })),
    // Una transcripción o un chat con otros no es toda su voz: el escriba la lee con otro cuidado.
    ...propias.map((p) => ({ texto: p.texto, origen: null, pieza: p.id, grabacion: /\[Speaker \d+\]|^\[\d{4}-\d{2}-\d{2}T/m.test(p.texto) })),
  ]
}

export type Aprendizaje = { hechos: number; total: number; nuevos: number; terminado: boolean }
let aprendiendo: Aprendizaje | null = null
export const estadoAprendizaje = () => aprendiendo

/** Pasa el escriba por lo ya cargado, de a una (DeepSeek: rápido y con el cupo más grande). Corre en segundo plano; el avance se consulta aparte. */
export async function aprender(db: Db, limite = 40): Promise<Aprendizaje> {
  if (aprendiendo && !aprendiendo.terminado) throw new Error('Ya estoy aprendiendo de lo cargado')
  const fuentes = fuentesParaAprender(db, limite)
  const estado: Aprendizaje = { hechos: 0, total: fuentes.length, nuevos: 0, terminado: false }
  aprendiendo = estado
  // De a cuatro en paralelo: dentro del límite de la key (5 a la vez, 50 por minuto).
  const cola = [...fuentes]
  const obrero = async () => {
    for (let f = cola.shift(); f; f = cola.shift()) {
      // Primero esperar, después sumar: `x += await …` lee x antes del await y pierde lo que sumaron los otros.
      const nuevos = (await escribaDeMemoria(db, f.texto, f.origen, { pieza: f.pieza, grabacion: f.grabacion })).length
      estado.nuevos += nuevos
      estado.hechos++
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, cola.length) }, obrero))
  estado.terminado = true
  return estado
}

const GRABACION = `Grabación transcripta del operador (un audio suyo o un chat). OJO: puede haber OTRAS personas hablando (marcadas [Speaker N] o con su nombre) y errores de transcripción.
Anotá solo lo que es claramente él hablando de sí, de lo que quiere o de cómo trabaja. Lo que dicen otros, lo que se discute en una reunión ajena o lo que no sabés quién dijo: NO lo anotes. Ante la duda, lista vacía. Si un nombre parece mal transcripto, no lo copies.
Texto:`

/** Lee un mensaje del operador y guarda lo que vale recordar. Nunca rompe la conversación si falla. */
export async function escribaDeMemoria(
  db: Db, texto: string, origen: number | null, o: { pieza?: number | null; grabacion?: boolean } = {},
): Promise<Recuerdo[]> {
  if (texto.trim().length < 12) return []
  const conocidos = memoriaParaPrompt(db, 40)
  try {
    const { datos } = await pedirJson<{ recuerdos?: { texto: string; tipo: string; horizonte?: string | null }[]; inventario?: any[]; side_quests?: any[] }>(
      { db, clase: 'mastropiero', agenteId: 'escriba' },
      ESCRIBA,
      `${conocidos ? `Lo que ya sabés (no lo repitas):\n${conocidos}\n\n` : ''}${o.grabacion ? GRABACION : 'Mensaje del operador:'}\n${texto.slice(0, 6000)}`,
      { temperatura: 0.2, maxTokens: 1200 },
    )
    const nuevos: Recuerdo[] = []
    for (const r of (datos.recuerdos ?? []).slice(0, 3)) {
      if (typeof r?.texto !== 'string' || !r.texto.trim()) continue
      const antes = (db.prepare('SELECT MAX(id) AS n FROM memoria').get() as { n: number | null }).n ?? 0
      const x = recordar(db, { texto: r.texto, tipo: r.tipo, horizonte: r.horizonte ?? null, origen, piezaId: o.pieza ?? null, creadaPor: 'escriba' })
      if (x.id > antes) nuevos.push(x)
    }
    // Lo que dice que tiene y los encargos de pasada entran como sugerencia: él los acepta en su ficha y en Misiones.
    for (const i of (datos.inventario ?? []).slice(0, 2)) {
      if (typeof i?.nombre !== 'string' || !i.nombre.trim()) continue
      try { agregarItem(db, 'jugador', i, { fuente: 'escriba', sugerido: true }) } catch { /* un ítem raro no frena nada */ }
    }
    for (const q of (o.grabacion ? [] : datos.side_quests ?? []).slice(0, 2)) {
      if (typeof q?.titulo !== 'string' || !q.titulo.trim()) continue
      try { anotarSideQuest(db, { titulo: q.titulo, detalle: q.detalle ?? null, disparador: q.disparador ?? null, sugerida: true, creadaPor: 'escriba' }) } catch { /* idem */ }
    }
    return nuevos
  } catch {
    return []
  }
}
