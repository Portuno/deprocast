/**
 * Quiero aprender: los temas o habilidades que quiere aprender (además de lo que tiene que hacer), lo que practica de
 * cada uno, sus recursos (la Librería y el corpus) y el repaso espaciado: después de practicar, una o dos preguntas que
 * vuelven a los 1, 3, 7 y 16 días (por Telegram o en Hoy). Lo usan el chat, el Mentor, las runs y la rutina del lunes.
 */
import { fechaLocal, type Db } from './db.ts'
import { buscar } from './corpus.ts'
import { pedirJson } from './modelo.ts'

export type Aprendizaje = { id: number; tema: string; porQue: string | null; nivelActual: string | null; nivelObjetivo: string | null; estado: 'activo' | 'pausado' | 'logrado'; frenteId: string | null; creadoEn: number }
export type Practica = { id: number; aprendizajeId: number; fecha: string; minutos: number | null; que: string | null; notas: string | null; fuente: string }

const deFila = (r: any): Aprendizaje => ({ id: r.id, tema: r.tema, porQue: r.por_que, nivelActual: r.nivel_actual, nivelObjetivo: r.nivel_objetivo, estado: r.estado, frenteId: r.frente_id, creadoEn: r.creado_en })
const dePractica = (r: any): Practica => ({ id: r.id, aprendizajeId: r.aprendizaje_id, fecha: r.fecha, minutos: r.minutos, que: r.que, notas: r.notas, fuente: r.fuente })
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()

export function leerAprendizaje(db: Db, id: number): Aprendizaje | null {
  const r = db.prepare('SELECT * FROM aprendizajes WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

/** El tema por nombre (sin tildes ni mayúsculas; «francés» = «Frances»; «inglés» encuentra «Inglés técnico» si es el único). */
export function aprendizajePorTema(db: Db, tema: string): Aprendizaje | null {
  const t = norm(tema)
  if (!t) return null
  const todos = (db.prepare('SELECT * FROM aprendizajes').all() as any[]).map(deFila)
  return todos.find((a) => norm(a.tema) === t) ?? (() => { const xs = todos.filter((a) => norm(a.tema).includes(t) || t.includes(norm(a.tema))); return xs.length === 1 ? xs[0] : null })()
}

export function crearAprendizaje(db: Db, a: { tema: string; porQue?: string | null; nivelActual?: string | null; nivelObjetivo?: string | null; frenteId?: string | null }, ahora = Date.now()): Aprendizaje & { nuevo: boolean } {
  const tema = String(a.tema ?? '').trim().slice(0, 120)
  if (tema.length < 2) throw new Error('¿Qué querés aprender?')
  const ya = aprendizajePorTema(db, tema)
  if (ya && norm(ya.tema) === norm(tema)) return { ...ya, nuevo: false }
  const r = db.prepare('INSERT INTO aprendizajes (tema, por_que, nivel_actual, nivel_objetivo, frente_id, creado_en) VALUES (?, ?, ?, ?, ?, ?)')
    .run(tema, a.porQue?.trim() || null, a.nivelActual?.trim() || null, a.nivelObjetivo?.trim() || null, a.frenteId ?? null, ahora)
  return { ...leerAprendizaje(db, Number(r.lastInsertRowid))!, nuevo: true }
}

export function editarAprendizaje(db: Db, id: number, c: { porQue?: string; nivelActual?: string; nivelObjetivo?: string; estado?: string; borrar?: boolean }): Aprendizaje | null {
  if (!leerAprendizaje(db, id)) throw new Error(`No existe el aprendizaje ${id}`)
  if (c.borrar) {
    db.prepare('DELETE FROM practicas WHERE aprendizaje_id = ?').run(id)
    db.prepare('DELETE FROM aprendizajes WHERE id = ?').run(id)
    return null
  }
  const set = (col: string, v: unknown) => v !== undefined && db.prepare(`UPDATE aprendizajes SET ${col} = ? WHERE id = ?`).run(typeof v === 'string' ? v.trim() || null : v as any, id)
  set('por_que', c.porQue)
  set('nivel_actual', c.nivelActual)
  set('nivel_objetivo', c.nivelObjetivo)
  if (c.estado && ['activo', 'pausado', 'logrado'].includes(c.estado)) set('estado', c.estado)
  return leerAprendizaje(db, id)
}

/** Lo que practicó. Si el tema no existe todavía, se crea (lo está aprendiendo). */
export function registrarPractica(db: Db, p: { aprendizajeId?: number | null; tema?: string | null; fecha?: string | null; minutos?: number | null; que?: string | null; notas?: string | null; fuente?: string }, ahora = Date.now()): { practica: Practica; aprendizaje: Aprendizaje } {
  const a = p.aprendizajeId ? leerAprendizaje(db, p.aprendizajeId) : p.tema ? (aprendizajePorTema(db, p.tema) ?? crearAprendizaje(db, { tema: p.tema }, ahora)) : null
  if (!a) throw new Error('¿De qué tema fue la práctica?')
  const fecha = p.fecha && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) ? p.fecha : fechaLocal(ahora)
  const min = Number(p.minutos)
  const r = db.prepare('INSERT INTO practicas (aprendizaje_id, fecha, minutos, que, notas, fuente, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(a.id, fecha, Number.isFinite(min) && min > 0 ? Math.round(min) : null, p.que?.trim().slice(0, 400) || null, p.notas?.trim().slice(0, 2000) || null, p.fuente ?? 'manual', ahora)
  if (a.estado === 'pausado') db.prepare(`UPDATE aprendizajes SET estado = 'activo' WHERE id = ?`).run(a.id)
  return { practica: dePractica(db.prepare('SELECT * FROM practicas WHERE id = ?').get(Number(r.lastInsertRowid))), aprendizaje: leerAprendizaje(db, a.id)! }
}

export function practicasDe(db: Db, id: number, limite = 30): Practica[] {
  return db.prepare('SELECT * FROM practicas WHERE aprendizaje_id = ? ORDER BY fecha DESC, id DESC LIMIT ?').all(id, limite).map(dePractica)
}

/** Cada tema con sus números: minutos totales y de la semana, días practicados, racha (días seguidos hasta hoy o ayer) y la última vez. */
export function listarAprendizajes(db: Db, f: { estado?: string } = {}, ahora = Date.now()) {
  const hoy = fechaLocal(ahora)
  const hace = (n: number) => fechaLocal(ahora - n * 86_400_000)
  const filas = (f.estado ? db.prepare('SELECT * FROM aprendizajes WHERE estado = ? ORDER BY creado_en').all(f.estado) : db.prepare(`SELECT * FROM aprendizajes ORDER BY CASE estado WHEN 'activo' THEN 0 WHEN 'pausado' THEN 1 ELSE 2 END, creado_en`).all()).map(deFila)
  return filas.map((a) => {
    const ps = practicasDe(db, a.id, 400)
    const dias = new Set(ps.map((p) => p.fecha))
    let racha = 0
    for (let i = dias.has(hoy) ? 0 : 1; dias.has(hace(i)); i++) racha++
    const ultima = ps[0]?.fecha ?? null
    return {
      ...a, practicas: ps.length, minutos: ps.reduce((s, p) => s + (p.minutos ?? 0), 0), minutosSemana: ps.filter((p) => p.fecha >= hace(6)).reduce((s, p) => s + (p.minutos ?? 0), 0),
      dias: dias.size, racha, ultima, diasSinPracticar: ultima ? Math.round((Date.parse(`${hoy}T12:00:00`) - Date.parse(`${ultima}T12:00:00`)) / 86_400_000) : null,
    }
  })
}

/** Recursos para un tema: obras de su Librería que hablan de eso y piezas del corpus. */
export function recursosDe(db: Db, tema: string) {
  const palabras = norm(tema).split(' ').filter((w) => w.length >= 4)
  const obras = (db.prepare('SELECT id, tipo, titulo, autor, estado, resumen, etiquetas, notas FROM obras').all() as any[])
    .filter((o) => { const t = norm(`${o.titulo} ${o.etiquetas ?? ''} ${o.notas ?? ''} ${o.resumen ?? ''}`); return palabras.length && palabras.some((w) => t.includes(w)) })
    .slice(0, 8).map((o) => ({ id: o.id, tipo: o.tipo, titulo: o.titulo, autor: o.autor, estado: o.estado }))
  let piezas: { id: number; titulo: string; nivel: string }[] = []
  try { piezas = buscar(db, tema, 6).map((p) => ({ id: p.id, titulo: p.titulo, nivel: p.nivel })) } catch { /* consulta rara para FTS */ }
  return { obras, piezas }
}

/** Para Mastropiero: lo que quiere aprender y cómo viene cada cosa. */
export function aprenderParaPrompt(db: Db, ahora = Date.now()): string {
  const xs = listarAprendizajes(db, { estado: 'activo' }, ahora)
  if (!xs.length) return ''
  return `Quiere aprender: ${xs.map((a) => `${a.tema}${a.nivelObjetivo ? ` (objetivo: ${a.nivelObjetivo})` : ''} — ${a.practicas ? `${a.minutosSemana} min esta semana, racha ${a.racha}, última vez ${a.ultima}` : 'todavía sin práctica anotada'}`).join('; ')}.`
}

// ─── repaso espaciado ───────────────────────────────────────────────────

/** Días hasta cada vuelta del repaso. */
export const INTERVALOS = [1, 3, 7, 16]

const SISTEMA_REPASO = `Armás preguntas de repaso (recuperación activa) sobre lo que el jugador acaba de practicar o estudiar.
- 1 o 2 preguntas cortas, concretas, que se respondan de memoria en una o dos frases (o con una palabra si es vocabulario).
- Sobre lo que dice que hizo; si es un idioma, preguntá por lo que practicó (una palabra, una conjugación, un sonido).
- Castellano rioplatense, con voseo. Sin la respuesta.
Forma: {"preguntas": [string]}`

let modeloRepaso = async (db: Db, usuario: string) => (await pedirJson<{ preguntas?: string[] }>({ db, clase: 'mastropiero', agenteId: 'repaso' }, SISTEMA_REPASO, usuario, { temperatura: 0.4, maxTokens: 600 })).datos
export function _probarRepaso(f: typeof modeloRepaso) {
  modeloRepaso = f
}

/** Después de una práctica: preguntas de repaso que vuelven a los 1, 3, 7 y 16 días. */
export async function prepararRepaso(db: Db, a: Aprendizaje, p: Practica, ahora = Date.now()): Promise<number[]> {
  if (!p.que && !p.notas) return []
  const datos = await modeloRepaso(db, `Tema: ${a.tema}${a.nivelActual ? ` (nivel: ${a.nivelActual})` : ''}\nLo que practicó: ${p.que ?? ''}${p.notas ? `\nNotas: ${p.notas}` : ''}`)
  const ids: number[] = []
  const alta = db.prepare(`INSERT INTO preguntas (texto, por_que, tipo, tema, estado, origen, creada_en, vuelve_en, repaso) VALUES (?, ?, 'abierta', ?, 'pendiente', 'repaso', ?, ?, 0)`)
  for (const t of (Array.isArray(datos?.preguntas) ? datos.preguntas : []).slice(0, (p.minutos ?? 0) >= 30 ? 2 : 1)) {
    const texto = String(t).trim().slice(0, 300)
    if (texto.length < 6 || db.prepare(`SELECT 1 FROM preguntas WHERE origen = 'repaso' AND texto = ?`).get(texto)) continue
    ids.push(Number(alta.run(texto, `Repaso de ${a.tema}`, `aprender:${a.id}`, ahora, ahora + INTERVALOS[0] * 86_400_000).lastInsertRowid))
  }
  return ids
}
