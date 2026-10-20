/**
 * Criba lúdica: pesar el corpus como un juego. Una pieza por vez (primero links compartidos y lo propio sin peso),
 * él le pone un peso de 1 a 12 o la descarta, con una tecla. Cuenta las de hoy y los días del mes que cribó. El peso
 * ordena todo lo demás: lo pesado sube en las búsquedas y en lo que leen los ayudantes; lo descartado no estorba.
 */
import { fechaLocal, json, type Db } from './db.ts'
import { insertar, leerPieza, tituloLimpio, type Pieza } from './corpus.ts'
import { menciones, sinArrobas } from './menciones.ts'
import { crearMision } from './misiones.ts'
import { pedirJson } from './modelo.ts'

/** En qué orden salen: lo de siempre (links y lo suyo primero), por fecha, por número o al azar. */
export const ORDENES: Record<string, string> = {
  auto: `tipo = 'enlace' DESC, nivel = 'propia' DESC, (abs(random()) % 100)`,
  fecha_desc: `COALESCE(fecha, '0000') DESC, id DESC`,
  fecha_asc: `COALESCE(fecha, '9999') ASC, id ASC`,
  id_desc: 'id DESC',
  id_asc: 'id ASC',
  azar: 'random()',
}

/** Peso 0 = descartada (queda, pero al fondo). */
export function siguiente(db: Db, f: { nivel?: string | null; saltear?: number[]; orden?: string | null } = {}): (Pieza & { tituloOriginal: string; notas: Nota[] }) | null {
  const saltear = (f.saltear ?? []).filter(Number.isFinite)
  const r = db.prepare(`SELECT id FROM corpus WHERE peso IS NULL AND nivel != 'generada' ${f.nivel ? 'AND nivel = ?' : ''}
      ${saltear.length ? `AND id NOT IN (${saltear.map(() => '?').join(',')})` : ''}
    ORDER BY ${ORDENES[f.orden ?? ''] ?? ORDENES.auto} LIMIT 1`).get(...(f.nivel ? [f.nivel] : []), ...saltear) as any
  return r ? paraCriba(db, leerPieza(db, r.id)!) : null
}

/** Cómo se ve en la criba: el título sin las etiquetas de origen («Lo que le dije a Gemini · …») y sus notas. */
export function paraCriba(db: Db, p: Pieza) {
  return { ...p, titulo: tituloLimpio(p.titulo), tituloOriginal: p.titulo, notas: notasDe(db, p.id) }
}

// ─── anotar mientras se criba ───────────────────────────────────────────

export type Nota = { id: number; texto: string; hacer: boolean; misionId: number | null; en: number }

/** Las notas que dejó sobre una pieza. */
export function notasDe(db: Db, piezaId: number): Nota[] {
  return (db.prepare(`SELECT id, contenido, meta, creado_en FROM corpus WHERE fuente = 'operador' AND json_extract(meta, '$.de') = ? ORDER BY id`).all(piezaId) as any[])
    .map((r) => { const m = json<any>(r.meta, {}); return { id: r.id, texto: String(m.texto ?? r.contenido), hacer: !!m.hacer, misionId: m.mision ?? null, en: r.creado_en } })
}

/**
 * Una nota sobre la pieza que está pesando: entra al corpus como suya, con la pieza citada (título, fecha, extracto) y
 * las entidades que nombró con @ (que además quedan enlazadas a la pieza). Si es «para hacer», también es una side quest
 * que lleva la referencia.
 */
export function anotar(db: Db, piezaId: number, texto: string, o: { hacer?: boolean; tarea?: string | null } = {}, ahora = Date.now()) {
  const p = leerPieza(db, piezaId)
  if (!p) throw new Error(`No existe la pieza ${piezaId}`)
  const t = texto.trim()
  if (!t) throw new Error('La nota está vacía')
  const ms = menciones(db, t)
  const nombradas = ms.map((m) => m.entidadId).filter((x): x is number => x != null)
  if (nombradas.length) db.prepare('UPDATE corpus SET entidades = ? WHERE id = ?').run(JSON.stringify([...new Set([...(p.entidades ?? []), ...nombradas])]), p.id)
  const titulo = tituloLimpio(p.titulo)
  const extracto = p.contenido.replace(/\s+/g, ' ').trim().slice(0, 400)
  const primeraLinea = sinArrobas(t.split('\n')[0], ms)
  let mision: number | null = null
  if (o.hacer) {
    mision = crearMision(db, {
      nivel: 'terciaria', titulo: (o.tarea?.trim() || primeraLinea).slice(0, 140), estado: 'activa', creadaPor: 'operador',
      detalle: `${t}\n\nSale de la criba: «${titulo}» [#${p.id}]${p.fecha ? ` (${String(p.fecha).slice(0, 10)})` : ''}.`,
      entidadId: nombradas[0] ?? null,
    }, { ahora }).id
  }
  const id = insertar(db, {
    fuente: 'operador', nivel: 'propia', estado: 'disponible', fecha: fechaLocal(ahora), etiquetas: ['nota', 'criba', ...(o.hacer ? ['para-hacer'] : [])],
    titulo: `${o.hacer ? 'Para hacer' : 'Nota'} · ${primeraLinea.slice(0, 80)}`,
    contenido: `${t}\n\n— Sobre «${titulo}» [#${p.id}]${p.fecha ? `, del ${String(p.fecha).slice(0, 10)}` : ''} (${p.nivel}):\n> ${extracto}${p.contenido.length > 400 ? '…' : ''}`,
    entidades: [...new Set([...nombradas, ...(p.entidades ?? [])])],
    meta: { de: p.id, texto: t, hacer: !!o.hacer, mision },
  }, ahora)!
  return { nota: id, mision, entidades: ms.map((m) => m.nombre), notas: notasDe(db, p.id) }
}

// ─── ¿es algo para hacer? ───────────────────────────────────────────────

/** Sin modelo: lo que suena a pendiente («tengo que», «llamar a», «mandarle», «acordate de»…). */
export const pareceTarea = (t: string) =>
  /(?<![a-záéíóúñ])(tengo que|hay que|tendr[ií]a que|deber[ií]a|acord[aá]te|pendiente|to ?do|hacer|llamar|escribir(le)?|mandar(le)?|enviar|comprar|pedir(le)?|preguntar(le)?|agendar|armar|revisar|probar|contactar|buscar|subir|publicar|terminar|preparar|pagar|reservar|leer|ver si|averiguar)(?![a-záéíóúñ])/i.test(t)

const SISTEMA_TAREA = `Te paso una nota que el operador escribió sobre una pieza de su archivo. Decidí si es algo para HACER (una tarea, un pendiente, una acción concreta que tiene que hacer él) o solo un comentario, una idea o una reflexión.
Si es para hacer, «tarea» es la acción corta en infinitivo, como un título de tarea («Llamar a Ana por el contacto de la productora»), sin @. Si no, null.
Forma: {"hacer": boolean, "tarea": string | null}`

let clasificarNota = async (db: Db, texto: string): Promise<{ hacer: boolean; tarea: string | null }> => {
  const d = (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'criba' }, SISTEMA_TAREA, texto.slice(0, 2000), { temperatura: 0, maxTokens: 300 })).datos
  return { hacer: !!d?.hacer, tarea: typeof d?.tarea === 'string' && d.tarea.trim() ? d.tarea.trim() : null }
}
export function _probarNotas(f: typeof clasificarNota) {
  clasificarNota = f
}

/** La nota que escribió mientras puntuaba: el sistema decide solo si es para hacer (y le pone el título a la tarea). */
export async function anotarSolo(db: Db, piezaId: number, texto: string, ahora = Date.now()) {
  const t = texto.trim()
  if (!t) return null
  const d = await clasificarNota(db, t).catch(() => ({ hacer: pareceTarea(t), tarea: null }))
  return anotar(db, piezaId, t, { hacer: d.hacer, tarea: d.tarea }, ahora)
}

export function cribar(db: Db, id: number, peso: number, ahora = Date.now()) {
  const p = Math.round(Number(peso))
  if (!Number.isFinite(p) || p < 0 || p > 12) throw new Error('El peso va de 1 a 12 (0 = descartar)')
  if (!leerPieza(db, id)) throw new Error(`No existe la pieza ${id}`)
  db.prepare('UPDATE corpus SET peso = ? WHERE id = ?').run(p, id)
  db.prepare('INSERT INTO criba (pieza_id, peso, fecha, en) VALUES (?, ?, ?, ?)').run(id, p, fechaLocal(ahora), ahora)
  return marcador(db, ahora)
}

/** Deshace la última (por si se equivocó de tecla). */
export function deshacerUltima(db: Db, ahora = Date.now()) {
  const u = db.prepare('SELECT id, pieza_id FROM criba ORDER BY id DESC LIMIT 1').get() as any
  if (!u) return { pieza: null, marcador: marcador(db, ahora) }
  db.prepare('DELETE FROM criba WHERE id = ?').run(u.id)
  const previo = db.prepare('SELECT peso FROM criba WHERE pieza_id = ? ORDER BY id DESC LIMIT 1').get(u.pieza_id) as any
  db.prepare('UPDATE corpus SET peso = ? WHERE id = ?').run(previo?.peso ?? null, u.pieza_id)
  const p = leerPieza(db, u.pieza_id)
  return { pieza: p ? paraCriba(db, p) : null, marcador: marcador(db, ahora) }
}

export function marcador(db: Db, ahora = Date.now()) {
  const hoy = fechaLocal(ahora)
  // Días de este mes con al menos una, y el último: un conteo que no se borra. Nada de rachas que se pierden por un día
  // malo (eso empuja a pesar cualquier cosa para no cortarla, y esos pesos ordenan todo lo demás).
  const n = (sql: string, ...a: any[]) => (db.prepare(sql).get(...a) as any).n as number
  return {
    hoy: n('SELECT COUNT(*) AS n FROM criba WHERE fecha = ?', hoy),
    diasMes: n('SELECT COUNT(DISTINCT fecha) AS n FROM criba WHERE fecha >= ? AND fecha <= ?', `${hoy.slice(0, 7)}-01`, hoy),
    ultimo: (db.prepare('SELECT MAX(fecha) AS f FROM criba').get() as { f: string | null }).f,
    cribadas: n('SELECT COUNT(*) AS n FROM corpus WHERE peso IS NOT NULL'),
    faltan: n(`SELECT COUNT(*) AS n FROM corpus WHERE peso IS NULL AND nivel != 'generada'`),
    descartadas: n('SELECT COUNT(*) AS n FROM corpus WHERE peso = 0'),
  }
}
