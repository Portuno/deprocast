/**
 * La posición en las IAs (Fragua #293): si la pelea se dirime en lo que responde un asistente, hay que medirlo. Por
 * proyecto, él carga las preguntas que haría un cliente («¿qué productoras audiovisuales recomendás en …?») y cada
 * semana se le hacen a tres o cuatro modelos, igual para todos y sin contexto previo (sin sistema, sin su memoria: como
 * un desconocido). Se guarda la respuesta cruda y se marca si lo nombra (por su nombre o sus alias), en qué puesto de la
 * lista y con qué frase. Con eso queda una serie: se ve si la hoja citable (#292) mueve la aguja en vez de suponerlo.
 *
 * Nada de esto viene cargado: el sistema sale en blanco y las preguntas son suyas. Una pregunta por modelo y por semana
 * (correrlo dos veces la misma semana no gasta de nuevo). Pocos miles de tokens por semana.
 */
import { ajuste, json, type Db } from './db.ts'
import { semanaDe } from './misiones.ts'

/** Los modelos a los que se les pregunta (los cuatro de NaN que contestan texto); se cambian con el ajuste posicion_modelos. */
export const MODELOS_POSICION = ['deepseek-v4-flash', 'mimo-v2.6-flash', 'qwen3.8-flash', 'glm5.3-flash']

export type Pregunta = { id: number; entidadId: number; pregunta: string; activa: boolean; creadaEn: number }
export type Respuesta = { id: number; preguntaId: number; entidadId: number; semana: string; modelo: string; texto: string; aparece: boolean; puesto: number | null; fragmento: string | null; en: number }

const deRespuesta = (r: any): Respuesta => ({ id: r.id, preguntaId: r.pregunta_id, entidadId: r.entidad_id, semana: r.semana, modelo: r.modelo, texto: r.texto, aparece: !!r.aparece, puesto: r.puesto, fragmento: r.fragmento, en: r.en })

/** Para las pruebas: cómo se le pregunta a un modelo (por defecto, NaN con solo la pregunta). */
let preguntar = async (db: Db, modelo: string, pregunta: string): Promise<{ texto: string; tokens: number | null }> => {
  const { nanChat } = await import('./nan.ts')
  const r = await nanChat({ db, clase: 'mastropiero', agenteId: 'posicion', modelos: [modelo] }, { mensajes: [{ role: 'user', content: pregunta }], temperatura: 0.7, maxTokens: 1200, json: false })
  return { texto: r.texto, tokens: null }
}
export function _probarPosicion(f: typeof preguntar) { preguntar = f }

// ─── preguntas ─────────────────────────────────────────────────────────────

export function listarPreguntas(db: Db, entidadId?: number | null, o: { todas?: boolean } = {}): Pregunta[] {
  const where = [o.todas ? '1 = 1' : 'activa = 1', ...(entidadId ? ['entidad_id = ?'] : [])]
  return (db.prepare(`SELECT * FROM posicion_preguntas WHERE ${where.join(' AND ')} ORDER BY id`).all(...(entidadId ? [entidadId] : [])) as any[])
    .map((r) => ({ id: r.id, entidadId: r.entidad_id, pregunta: r.pregunta, activa: !!r.activa, creadaEn: r.creada_en }))
}

/** La entidad por id o por nombre (exacto o alias primero; si no, la que más piezas tiene). */
export function resolverEntidad(db: Db, ref: number | string): { id: number; nombre: string; alias: string[] } {
  const fila = (r: any) => (r ? { id: r.id as number, nombre: r.nombre as string, alias: json<string[]>(r.alias, []) } : null)
  if (typeof ref === 'number' || /^\d+$/.test(String(ref).trim())) {
    const e = fila(db.prepare('SELECT id, nombre, alias FROM entidades WHERE id = ?').get(Number(ref)))
    if (!e) throw new Error(`No existe la entidad ${ref}`)
    return e
  }
  const q = String(ref).trim()
  if (!q) throw new Error('Falta el proyecto')
  const exacta = fila(db.prepare(`SELECT id, nombre, alias FROM entidades WHERE nombre = ? COLLATE NOCASE OR EXISTS (SELECT 1 FROM json_each(COALESCE(alias, '[]')) WHERE value = ? COLLATE NOCASE) LIMIT 1`).get(q, q))
  if (exacta) return exacta
  const parecida = fila(db.prepare(`SELECT e.id, e.nombre, e.alias FROM entidades e WHERE e.nombre LIKE ? ORDER BY (SELECT COUNT(*) FROM corpus_entidades ce WHERE ce.entidad_id = e.id) DESC LIMIT 1`).get(`%${q}%`))
  if (!parecida) throw new Error(`No encuentro «${q}» entre tus proyectos y entidades`)
  return parecida
}

export function agregarPregunta(db: Db, entidad: number | string, pregunta: string, ahora = Date.now()): Pregunta {
  const e = resolverEntidad(db, entidad)
  const p = pregunta.replace(/\s+/g, ' ').trim()
  if (p.length < 10) throw new Error('La pregunta es muy corta: escribila como la haría un cliente')
  const ya = db.prepare('SELECT id FROM posicion_preguntas WHERE entidad_id = ? AND pregunta = ? COLLATE NOCASE').get(e.id, p) as { id: number } | undefined
  if (ya) { db.prepare('UPDATE posicion_preguntas SET activa = 1 WHERE id = ?').run(ya.id); return listarPreguntas(db, e.id).find((x) => x.id === ya.id)! }
  const r = db.prepare('INSERT INTO posicion_preguntas (entidad_id, pregunta, creada_en) VALUES (?, ?, ?)').run(e.id, p.slice(0, 400), ahora)
  return listarPreguntas(db, e.id).find((x) => x.id === Number(r.lastInsertRowid))!
}

/** Deja de preguntarla (lo medido queda en la serie). */
export function quitarPregunta(db: Db, id: number) {
  if (!db.prepare('UPDATE posicion_preguntas SET activa = 0 WHERE id = ?').run(id).changes) throw new Error(`No existe la pregunta ${id}`)
  return { id, activa: false }
}

// ─── detectar ──────────────────────────────────────────────────────────────

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Un renglón que abre un ítem de lista: «1.», «2)», «-», «•», «### 3.» o un nombre en negrita al principio. */
const ITEM = /^\s*(?:#{1,4}\s*)?(?:\d{1,2}[.)]\s|[-*•·]\s|\*\*[^*]{2,}\*\*)/

/**
 * ¿Lo nombra? Por su nombre o un alias, como palabra (no «Versalles» por «Versa»). El puesto: el número de ítem de la
 * lista que armó el modelo donde aparece por primera vez (null si lo nombra fuera de una lista). La frase: ese renglón.
 */
export function detectar(texto: string, nombres: string[]): { aparece: boolean; puesto: number | null; fragmento: string | null } {
  const res = [...new Set(nombres.map((n) => normal(n.trim())).filter((n) => n.length >= 3))].map((n) => new RegExp(`(^|[^a-z0-9ñ])${escapar(n)}($|[^a-z0-9ñ])`))
  if (!res.length) return { aparece: false, puesto: null, fragmento: null }
  const nombra = (l: string) => res.some((re) => re.test(normal(l)))
  const lineas = String(texto ?? '').split('\n')
  let item = 0, enItem = 0
  for (const l of lineas) {
    if (ITEM.test(l)) { item++; enItem = item } else if (!l.trim()) enItem = 0
    if (nombra(l)) {
      const fragmento = l.replace(/^\s*(?:#{1,4}\s*)?(?:\d{1,2}[.)]|[-*•·])?\s*/, '').replace(/\*\*/g, '').trim().slice(0, 280) || null
      return { aparece: true, puesto: enItem || null, fragmento }
    }
  }
  return { aparece: false, puesto: null, fragmento: null }
}

// ─── medir ─────────────────────────────────────────────────────────────────

export function modelosPosicion(db: Db): string[] {
  const a = ajuste(db, 'posicion_modelos')
  const xs = a ? a.split(',').map((x) => x.trim()).filter(Boolean) : []
  return xs.length ? xs.slice(0, 6) : MODELOS_POSICION
}

/**
 * Le hace cada pregunta activa a cada modelo, una vez por semana (lo ya medido esta semana no se repite). De a una
 * pregunta, los modelos a la vez. Lo que un modelo no contesta queda en `fallas` y se intenta la próxima vez.
 */
export async function medirPosicion(db: Db, o: { entidadId?: number | null; ahora?: number } = {}): Promise<{ semana: string; nuevas: number; fallas: string[] }> {
  const ahora = o.ahora ?? Date.now()
  const semana = semanaDe(ahora)
  const modelos = modelosPosicion(db)
  const ya = db.prepare('SELECT 1 FROM posicion_respuestas WHERE pregunta_id = ? AND modelo = ? AND semana = ?')
  const guardar = db.prepare(`INSERT OR IGNORE INTO posicion_respuestas (pregunta_id, entidad_id, semana, modelo, texto, aparece, puesto, fragmento, tokens, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const nombresDe = new Map<number, string[]>()
  let nuevas = 0
  const fallas: string[] = []
  for (const p of listarPreguntas(db, o.entidadId)) {
    if (!nombresDe.has(p.entidadId)) { try { const e = resolverEntidad(db, p.entidadId); nombresDe.set(p.entidadId, [e.nombre, ...e.alias]) } catch { continue } }
    const faltan = modelos.filter((m) => !ya.get(p.id, m, semana))
    await Promise.all(faltan.map(async (m) => {
      try {
        const r = await preguntar(db, m, p.pregunta)
        if (!r.texto.trim()) throw new Error('respuesta vacía')
        const d = detectar(r.texto, nombresDe.get(p.entidadId)!)
        guardar.run(p.id, p.entidadId, semana, m, r.texto.slice(0, 12_000), d.aparece ? 1 : 0, d.puesto, d.fragmento, r.tokens, ahora)
        nuevas++
      } catch (e) { fallas.push(`${m}: ${e instanceof Error ? e.message.slice(0, 160) : e}`) }
    }))
  }
  return { semana, nuevas, fallas }
}

// ─── el tablero ────────────────────────────────────────────────────────────

export type SemanaPosicion = { semana: string; respuestas: number; apariciones: number; porcentaje: number; mejorPuesto: number | null; hoja: boolean }

/** Lo de una entidad: sus preguntas, la serie por semana y lo último de cada pregunta en cada modelo (con el texto crudo). */
export function tablero(db: Db, entidad: number | string) {
  const e = resolverEntidad(db, entidad)
  const preguntas = listarPreguntas(db, e.id, { todas: true }).filter((p) => p.activa || db.prepare('SELECT 1 FROM posicion_respuestas WHERE pregunta_id = ? LIMIT 1').get(p.id))
  // Cuándo cambió su hoja citable: la marca en la serie (lo que se quiere ver es si la mueve).
  const hojas = new Set((db.prepare(`SELECT c.creado_en FROM corpus c JOIN corpus_entidades ce ON ce.pieza_id = c.id WHERE c.fuente = 'hojas' AND ce.entidad_id = ?`).all(e.id) as { creado_en: number }[]).map((h) => semanaDe(h.creado_en)))
  const serie: SemanaPosicion[] = (db.prepare(`SELECT semana, COUNT(*) AS n, SUM(aparece) AS si, MIN(puesto) AS mejor FROM posicion_respuestas WHERE entidad_id = ? GROUP BY semana ORDER BY semana`).all(e.id) as any[])
    .map((r) => ({ semana: r.semana, respuestas: r.n, apariciones: r.si ?? 0, porcentaje: r.n ? Math.round((100 * (r.si ?? 0)) / r.n) : 0, mejorPuesto: r.mejor ?? null, hoja: hojas.has(r.semana) }))
  for (const s of hojas) if (!serie.some((x) => x.semana === s) && serie.length && s > serie[0].semana) serie.push({ semana: s, respuestas: 0, apariciones: 0, porcentaje: 0, mejorPuesto: null, hoja: true })
  serie.sort((a, b) => a.semana.localeCompare(b.semana))
  const ultimas = (db.prepare(`SELECT r.* FROM posicion_respuestas r WHERE r.entidad_id = ? AND r.semana = (SELECT MAX(semana) FROM posicion_respuestas x WHERE x.pregunta_id = r.pregunta_id) ORDER BY r.pregunta_id, r.modelo`).all(e.id) as any[]).map(deRespuesta)
  return {
    entidad: e, modelos: modelosPosicion(db), serie,
    preguntas: preguntas.map((p) => ({ ...p, ultimas: ultimas.filter((r) => r.preguntaId === p.id) })),
  }
}

/** Las entidades que tienen preguntas (o medidas), con su último porcentaje: la portada del tablero. */
export function tableros(db: Db) {
  const ids = (db.prepare(`SELECT DISTINCT entidad_id AS id FROM posicion_preguntas WHERE activa = 1 UNION SELECT DISTINCT entidad_id FROM posicion_respuestas`).all() as { id: number }[]).map((x) => x.id)
  return ids.flatMap((id) => {
    try {
      const t = tablero(db, id)
      const medidas = t.serie.filter((s) => s.respuestas)
      return [{ entidad: t.entidad, preguntas: t.preguntas.filter((p) => p.activa).length, ultima: medidas.at(-1) ?? null, anterior: medidas.at(-2) ?? null }]
    } catch { return [] }
  })
}

/** El parte de la semana, en palabras (lo que deja la rutina en Hoy). null si no hay nada medido. */
export function parteSemanal(db: Db): string | null {
  const ts = tableros(db).filter((t) => t.ultima)
  if (!ts.length) return null
  const linea = (t: (typeof ts)[number]) => {
    const u = t.ultima!
    const antes = t.anterior ? ` (la anterior, ${t.anterior.apariciones} de ${t.anterior.respuestas})` : ''
    return `- **${t.entidad.nombre}**: lo nombran en ${u.apariciones} de ${u.respuestas} respuestas (${u.porcentaje} %)${u.mejorPuesto ? `, mejor puesto ${u.mejorPuesto}` : ''}${antes}${u.hoja ? ' · esta semana cambió su hoja citable' : ''}.`
  }
  return `🔭 **Tu posición en las IAs**\n\nLe hice tus preguntas a ${modelosPosicion(db).length} modelos, sin contexto, como un desconocido.\n${ts.map(linea).join('\n')}\n\nLas respuestas crudas están en Afuera → Posición en IAs.`
}
