/**
 * Cuadernos: como NotebookLM, pero sobre su corpus. Un cuaderno junta fuentes (piezas del corpus, un texto pegado o
 * una página web) y responde SOLO con ellas, citando de dónde sale cada cosa. Además arma una guía (resumen, ideas
 * clave, preguntas) y una charla en audio entre dos voces para escucharla caminando.
 */
import { type Db } from './db.ts'
import { insertar, leerPieza, type Pieza } from './corpus.ts'
import { llamarModelo, pedirJson } from './modelo.ts'
import { leerPagina } from './web.ts'
import { crearConversacion, type Artefacto } from './taller.ts'

export type Cuaderno = { id: number; titulo: string; descripcion: string | null; creadoEn: number; fuentes: { id: number; titulo: string; nivel: string; largo: number }[] }
export type Nota = { id: number; tipo: 'respuesta' | 'guia' | 'audio'; pregunta: string | null; texto: string; citas: Cita[]; artefactoId: number | null; creadaEn: number }
export type Cita = { n: number; piezaId: number; titulo: string; extracto: string }

const deNota = (r: any): Nota => ({ id: r.id, tipo: r.tipo, pregunta: r.pregunta, texto: r.texto, citas: r.citas ? JSON.parse(r.citas) : [], artefactoId: r.artefacto_id, creadaEn: r.creada_en })

export function crearCuaderno(db: Db, titulo: string, descripcion: string | null = null, ahora = Date.now()): Cuaderno {
  const t = titulo.trim()
  if (!t) throw new Error('El cuaderno necesita un nombre')
  const r = db.prepare('INSERT INTO cuadernos (titulo, descripcion, creado_en) VALUES (?, ?, ?)').run(t.slice(0, 120), descripcion, ahora)
  return leerCuaderno(db, Number(r.lastInsertRowid))!
}

export function leerCuaderno(db: Db, id: number): Cuaderno | null {
  const c = db.prepare('SELECT * FROM cuadernos WHERE id = ?').get(id) as any
  if (!c) return null
  const fuentes = (db.prepare(`SELECT p.id, p.titulo, p.nivel, length(p.contenido) AS largo FROM cuaderno_fuentes f JOIN corpus p ON p.id = f.pieza_id WHERE f.cuaderno_id = ? ORDER BY f.rowid`).all(id) as any[])
  return { id: c.id, titulo: c.titulo, descripcion: c.descripcion, creadoEn: c.creado_en, fuentes }
}

export function listarCuadernos(db: Db): (Cuaderno & { notas: number })[] {
  return (db.prepare('SELECT id FROM cuadernos ORDER BY id DESC').all() as any[]).map((r) => ({
    ...leerCuaderno(db, r.id)!, notas: (db.prepare('SELECT COUNT(*) AS n FROM cuaderno_notas WHERE cuaderno_id = ?').get(r.id) as any).n,
  }))
}

export function borrarCuaderno(db: Db, id: number) {
  db.prepare('DELETE FROM cuaderno_notas WHERE cuaderno_id = ?').run(id)
  db.prepare('DELETE FROM cuaderno_fuentes WHERE cuaderno_id = ?').run(id)
  db.prepare('DELETE FROM cuadernos WHERE id = ?').run(id)
}

/** Suma fuentes: ids de piezas, un texto pegado (entra al corpus como tuyo) o una URL (se lee y entra como primaria). */
export async function sumarFuentes(db: Db, id: number, f: { piezas?: number[]; texto?: { titulo?: string; contenido: string }; url?: string }): Promise<Cuaderno> {
  if (!leerCuaderno(db, id)) throw new Error(`No existe el cuaderno ${id}`)
  const ids: number[] = [...(f.piezas ?? [])]
  if (f.texto?.contenido?.trim()) {
    // Directo al corpus, ya disponible: no dispara la pipeline de la liga.
    const p = insertar(db, { fuente: 'operador', nivel: 'propia', estado: 'disponible', titulo: f.texto.titulo?.trim() || `Nota para el cuaderno ${id}`, contenido: f.texto.contenido.trim(), etiquetas: ['cuaderno'] })
    if (p) ids.push(p)
  }
  if (f.url?.trim()) {
    const url = f.url.trim()
    const ya = db.prepare('SELECT id FROM corpus WHERE url = ? LIMIT 1').get(url) as any
    if (ya) ids.push(ya.id)
    else {
      const pag = await leerPagina(url, 40_000)
      if (!pag?.texto?.trim()) throw new Error(`No pude leer ${url}`)
      const p = insertar(db, { fuente: 'operador', nivel: 'primaria', estado: 'disponible', titulo: pag.titulo || url, contenido: pag.texto, url, etiquetas: ['cuaderno'] })
      if (p) ids.push(p)
    }
  }
  const ins = db.prepare('INSERT OR IGNORE INTO cuaderno_fuentes (cuaderno_id, pieza_id) VALUES (?, ?)')
  for (const p of ids) if (leerPieza(db, p)) ins.run(id, p)
  return leerCuaderno(db, id)!
}

export function quitarFuente(db: Db, id: number, piezaId: number) {
  db.prepare('DELETE FROM cuaderno_fuentes WHERE cuaderno_id = ? AND pieza_id = ?').run(id, piezaId)
}

export function notas(db: Db, id: number): Nota[] {
  return db.prepare('SELECT * FROM cuaderno_notas WHERE cuaderno_id = ? ORDER BY id').all(id).map(deNota)
}

// ─── fragmentos ─────────────────────────────────────────────────────────

type Fragmento = { pieza: Pieza; texto: string; orden: number }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const palabras = (s: string) => norm(s).match(/[a-z0-9ñ]{3,}/g) ?? []

/** Parte las fuentes en tramos de ~1500 caracteres y elige los que más tienen que ver con la pregunta. */
export function fragmentosPara(db: Db, id: number, pregunta: string | null, max = 14): Fragmento[] {
  const c = leerCuaderno(db, id)
  if (!c?.fuentes.length) throw new Error('El cuaderno no tiene fuentes todavía')
  const todos: Fragmento[] = []
  for (const f of c.fuentes) {
    const p = leerPieza(db, f.id)!
    const t = `${p.titulo}\n${p.contenido}`
    for (let i = 0, k = 0; i < t.length; i += 1400, k++) todos.push({ pieza: p, texto: t.slice(i, i + 1500), orden: k })
  }
  if (!pregunta) {
    // Para la guía: el principio de cada fuente y, si sobra lugar, lo que sigue, repartido parejo.
    return todos.sort((a, b) => a.orden - b.orden).slice(0, max)
  }
  const q = new Set(palabras(pregunta))
  const df = new Map<string, number>()
  for (const fr of todos) for (const w of new Set(palabras(fr.texto))) df.set(w, (df.get(w) ?? 0) + 1)
  const puntaje = (fr: Fragmento) => palabras(fr.texto).reduce((s, w) => s + (q.has(w) ? Math.log(1 + todos.length / (df.get(w) ?? 1)) : 0), 0) - fr.orden * 0.01
  return todos.map((fr) => ({ fr, s: puntaje(fr) })).sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.fr)
}

function bloque(frs: Fragmento[]): { texto: string; citas: Cita[] } {
  const citas = frs.map((f, i) => ({ n: i + 1, piezaId: f.pieza.id, titulo: f.pieza.titulo, extracto: f.texto.slice(0, 280) }))
  return { texto: frs.map((f, i) => `[${i + 1}] (${f.pieza.titulo})\n${f.texto}`).join('\n\n---\n\n'), citas }
}

const guardar = (db: Db, id: number, n: { tipo: Nota['tipo']; pregunta?: string | null; texto: string; citas?: Cita[]; artefactoId?: number | null }, ahora = Date.now()): Nota => {
  const r = db.prepare('INSERT INTO cuaderno_notas (cuaderno_id, tipo, pregunta, texto, citas, artefacto_id, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, n.tipo, n.pregunta ?? null, n.texto, JSON.stringify(n.citas ?? []), n.artefactoId ?? null, ahora)
  return deNota(db.prepare('SELECT * FROM cuaderno_notas WHERE id = ?').get(Number(r.lastInsertRowid)))
}

const SISTEMA_PREGUNTA = `Respondés preguntas usando SOLO los fragmentos numerados que te paso (las fuentes de un cuaderno). Reglas:
- Cada afirmación lleva la cita del fragmento de donde sale, así: [2] o [1][4].
- Si los fragmentos no alcanzan para responder, decilo claro y decí qué faltaría; no completes con lo que sabés vos.
- Castellano rioplatense, directo, sin relleno. Podés usar listas cortas.`

export async function preguntar(db: Db, id: number, pregunta: string, ahora = Date.now()): Promise<Nota> {
  const q = pregunta.trim()
  if (!q) throw new Error('¿Qué querés preguntarle?')
  const { texto, citas } = bloque(fragmentosPara(db, id, q))
  const r = await llamarModelo({ db, clase: 'mastropiero', agenteId: 'cuaderno' }, {
    mensajes: [{ role: 'system', content: SISTEMA_PREGUNTA }, { role: 'user', content: `FRAGMENTOS:\n\n${texto}\n\nPREGUNTA: ${q}` }],
    herramientas: [], temperatura: 0.2, maxTokens: 2500,
  })
  const usadas = new Set([...r.texto.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
  return guardar(db, id, { tipo: 'respuesta', pregunta: q, texto: r.texto, citas: citas.filter((c) => usadas.has(c.n)) }, ahora)
}

const SISTEMA_GUIA = `Armás la guía de un cuaderno a partir de sus fuentes (fragmentos numerados). Forma:
{"resumen": string (un párrafo), "ideas": [string (cada una con su cita [n])], "preguntas": [string (preguntas que valdría la pena hacerle al cuaderno)]}
Solo lo que está en las fuentes.`

export async function guia(db: Db, id: number, ahora = Date.now()): Promise<Nota> {
  const { texto, citas } = bloque(fragmentosPara(db, id, null, 16))
  const { datos: g } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'cuaderno' }, SISTEMA_GUIA, texto, { temperatura: 0.3, maxTokens: 3000 })
  const md = [`**Resumen.** ${g.resumen ?? ''}`, (g.ideas ?? []).length ? `**Ideas clave**\n${(g.ideas as string[]).map((x) => `- ${x}`).join('\n')}` : '', (g.preguntas ?? []).length ? `**Para preguntarle**\n${(g.preguntas as string[]).map((x) => `- ${x}`).join('\n')}` : ''].filter(Boolean).join('\n\n')
  const usadas = new Set([...md.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
  return guardar(db, id, { tipo: 'guia', texto: md, citas: citas.filter((c) => usadas.has(c.n)) }, ahora)
}

const SISTEMA_CHARLA = `Escribís el guion de una charla de audio de 4 a 6 minutos entre dos conductores (A: Dora, B: Alex) que repasan las fuentes de un cuaderno para alguien que la escucha caminando.
Forma: {"titulo": string, "turnos": [{"quien": "A" | "B", "texto": string}]}
- Conversación natural en castellano rioplatense: se preguntan, se contradicen un poco, traen ejemplos de las fuentes. Nada de «como dice el fragmento 3».
- Entre 14 y 24 turnos, cada uno de 1 a 4 oraciones. Arranca enganchando y cierra con una idea para llevarse.
- Solo lo que está en las fuentes.`

/** Lo que se está haciendo en segundo plano, por cuaderno (la charla tarda minutos). */
export const haciendo = new Map<number, string>()

/** La charla en audio: guion con el modelo, voces con kokoro, queda en el Taller y como nota del cuaderno. */
export async function charla(db: Db, id: number, ahora = Date.now()): Promise<{ nota: Nota; artefacto: Artefacto }> {
  const c = leerCuaderno(db, id)!
  haciendo.set(id, 'escribiendo el guion de la charla')
  try { return await charlaAdentro(db, id, c, ahora) } finally { haciendo.delete(id) }
}

async function charlaAdentro(db: Db, id: number, c: Cuaderno, ahora: number): Promise<{ nota: Nota; artefacto: Artefacto }> {
  const { texto } = bloque(fragmentosPara(db, id, null, 16))
  const { datos: g } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'cuaderno' }, SISTEMA_CHARLA, texto, { temperatura: 0.7, maxTokens: 5000 })
  const turnos = (Array.isArray(g.turnos) ? g.turnos : []).filter((t: any) => t?.texto?.trim()).map((t: any) => ({ voz: t.quien === 'A' ? 'ef_dora' : 'em_alex', texto: String(t.texto).trim() }))
  if (turnos.length < 2) throw new Error('El guion de la charla salió vacío')
  haciendo.set(id, `grabando ${turnos.length} turnos`)
  const artefacto = await crearConversacion(db, `Charla · ${c.titulo}`, turnos, { meta: { cuadernoId: id }, ahora })
  const guion = turnos.map((t: { voz: string; texto: string }) => `**${t.voz === 'ef_dora' ? 'Dora' : 'Alex'}:** ${t.texto}`).join('\n\n')
  if (artefacto.estado === 'fallo') throw new Error(`No pude grabar la charla: ${artefacto.progreso}`)
  const nota = guardar(db, id, { tipo: 'audio', texto: guion, artefactoId: artefacto.id }, ahora)
  return { nota, artefacto }
}
