/**
 * Altas en la Librería desde lo que menciona (Fragua #181, que junta #98 y #113): cuando en una charla, una nota o un
 * audio nombra una obra («quiero leer Dune», «terminé The Bear», «este repo está bueno»), queda como propuesta en «Para
 * validar» con su tipo, el autor si lo dijo y el estado que sale del verbo. No se agrega sola. Si el título es ambiguo
 * (dos obras con ese nombre, o no se sabe cuál), en vez de elegir se le pregunta.
 */
import type { Db } from './db.ts'

/** Solo se mira (y se gasta) si el texto suena a una obra. */
export const PARECE_OBRA = /\b(quiero (leer|ver|jugar|mirar)|tengo que (leer|ver)|estoy (leyendo|viendo|jugando)|termin[eé] (de (leer|ver)|el libro|la (serie|peli|pel[ií]cula)|el juego)|me (recomendaron|pasaron)|(el|un|este) (libro|paper|repo|repositorio|ensayo)|(la|una|esta) (peli|pel[ií]cula|serie|novela)|(el|un|este) (juego|videojuego|documental)|abandon[eé] (el libro|la serie)|github\.com\/)/i

export type Propuesta = { id: number; tipo: string; titulo: string; autor: string | null; estado: string; texto: string; fuente: string | null; creada: number }

let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> =>
  (await (await import('./modelo.ts')).pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'libreria' }, sistema, usuario, { temperatura: 0.1, maxTokens: 900 })).datos
export function _probarObras(f: typeof modelo) { modelo = f }

const SISTEMA = `Detectás obras que él menciona en lo que dice: libros, películas, series, videojuegos, papers y repositorios. Solo las que nombra con título (no «un libro de historia»).
Para cada una: tipo (libro | pelicula | serie | videojuego | paper | repositorio), el título tal cual, el autor/director/owner SOLO si lo dijo, y el estado según el verbo: quiero (quiere leer/ver, se la recomendaron), en_curso (está leyendo/viendo), terminado (terminó), abandonado (la dejó).
Si el título es ambiguo (hay varias obras conocidas con ese nombre y no se sabe cuál, o no queda claro si es libro o película), marcá "ambigua": true y escribí la pregunta corta para aclararlo.
Forma: {"obras": [{"tipo": "...", "titulo": "...", "autor": null, "estado": "...", "ambigua": false, "pregunta": null}]}`

const TIPOS = ['libro', 'pelicula', 'serie', 'videojuego', 'paper', 'repositorio']
const ESTADOS = ['quiero', 'en_curso', 'terminado', 'abandonado']
const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** Mira un texto suyo y deja las propuestas (y las preguntas de lo ambiguo). Devuelve las propuestas nuevas. */
export async function detectarObras(db: Db, texto: string, fuente: string | null = null, ahora = Date.now()): Promise<Propuesta[]> {
  if (!PARECE_OBRA.test(texto)) return []
  const d = await modelo(db, SISTEMA, texto.slice(0, 4000))
  const nuevas: number[] = []
  for (const o of Array.isArray(d?.obras) ? d.obras : []) {
    const titulo = String(o?.titulo ?? '').trim().slice(0, 300)
    const tipo = TIPOS.includes(String(o?.tipo)) ? String(o.tipo) : null
    if (!titulo || !tipo) continue
    if (o?.ambigua) {
      const pregunta = String(o?.pregunta ?? '').trim() || `¿Cuál «${titulo}»: la de quién?`
      try { (await import('./preguntas.ts')).encolarPregunta(db, { texto: pregunta, porQue: `Mencionaste «${titulo}» y quiero sumarlo bien a tu Librería`, origen: 'libreria', tema: 'libreria' }, ahora) } catch { /* ya estaba */ }
      continue
    }
    // Ni lo que ya está en la Librería ni lo que ya se le propuso.
    const n = normal(titulo)
    if ((db.prepare('SELECT titulo FROM obras WHERE tipo = ?').all(tipo) as { titulo: string }[]).some((x) => normal(x.titulo) === n)) continue
    if ((db.prepare(`SELECT titulo FROM obras_propuestas WHERE tipo = ? AND estado = 'pendiente'`).all(tipo) as { titulo: string }[]).some((x) => normal(x.titulo) === n)) continue
    const r = db.prepare(`INSERT INTO obras_propuestas (tipo, titulo, autor, estado_obra, texto, fuente, estado, creada) VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?)`)
      .run(tipo, titulo, o?.autor ? String(o.autor).trim().slice(0, 200) : null, ESTADOS.includes(String(o?.estado)) ? String(o.estado) : 'quiero', texto.slice(0, 600), fuente, ahora)
    nuevas.push(Number(r.lastInsertRowid))
  }
  return nuevas.map((id) => leer(db, id)!)
}

function leer(db: Db, id: number): Propuesta | null {
  const r = db.prepare('SELECT * FROM obras_propuestas WHERE id = ?').get(id) as any
  return r ? { id: r.id, tipo: r.tipo, titulo: r.titulo, autor: r.autor, estado: r.estado_obra, texto: r.texto, fuente: r.fuente, creada: r.creada } : null
}

export const propuestasPendientes = (db: Db, limite = 12) =>
  (db.prepare(`SELECT id FROM obras_propuestas WHERE estado = 'pendiente' ORDER BY id DESC LIMIT ?`).all(limite) as { id: number }[]).map((r) => leer(db, r.id)!)
export const cuantasPendientes = (db: Db) => (db.prepare(`SELECT COUNT(*) AS n FROM obras_propuestas WHERE estado = 'pendiente'`).get() as { n: number }).n

/** Aceptar la suma a la Librería (como suya, con el estado del verbo); descartar la deja de lado. */
export async function resolverPropuestaObra(db: Db, id: number, accion: 'aceptar' | 'descartar', ahora = Date.now()) {
  const p = leer(db, id)
  if (!p) throw new Error(`No existe la propuesta ${id}`)
  db.prepare(`UPDATE obras_propuestas SET estado = ? WHERE id = ?`).run(accion === 'aceptar' ? 'aceptada' : 'descartada', id)
  if (accion === 'descartar') return { ok: true }
  return (await import('./libreria.ts')).agregarObra(db, { tipo: p.tipo, titulo: p.titulo, autor: p.autor, estado: p.estado, notas: `Lo mencionaste: «${p.texto.slice(0, 200)}»`, origen: 'operador' }, ahora)
}
