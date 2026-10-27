/**
 * Qué texto entra a cada grafo (plan v25). Tres capas:
 * - voz (la primordial): sus piezas propias y los quántomos sellados; él va en el centro.
 * - todo: el corpus entero, con una muestra pareja (por un orden pseudoaleatorio fijo) hasta un tope de caracteres.
 * - propio: lo que él arma sumando fuentes: entidades (con todo lo suyo), conversaciones, dominios de la Academia,
 *   cuadernos, una época, piezas sueltas, un texto pegado o un tema del Observatorio (el grafo de un debate).
 * Se lee con una conexión aparte (en el hilo del grafo): solo SELECT.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { Documento } from './construir.ts'

export type Fuente =
  | { tipo: 'entidad'; id: number } | { tipo: 'conversacion'; id: number } | { tipo: 'dominio'; id: number } | { tipo: 'cuaderno'; id: number }
  | { tipo: 'piezas'; ids: number[] } | { tipo: 'texto'; texto: string; titulo?: string } | { tipo: 'epoca'; desde: string; hasta: string }
  | { tipo: 'observatorio'; id: number }
export type Definicion = { tipo: 'voz' | 'todo' | 'propio'; fuentes?: Fuente[]; desde?: string | null; hasta?: string | null; topeCaracteres?: number }

/** El tope de texto por grafo (medido: unos segundos de cálculo en el hilo aparte, sin trabar nada). */
export const TOPE_CARACTERES = 3_000_000

type Fila = { id: number; titulo: string | null; contenido: string; fecha: string | null }
const PIEZA = 'SELECT id, titulo, contenido, fecha FROM corpus'
const doc = (r: Fila, tipo: Documento['tipo'] = 'pieza'): Documento => ({ id: r.id, texto: `${r.titulo ?? ''}\n\n${r.contenido ?? ''}`, fecha: r.fecha, tipo })
/** Quántomos: su id va en negativo (para no chocar con las piezas). */
const quantomo = (r: { id: number; titulo: string | null; texto: string; creado_en: number }): Documento => ({ id: -r.id, texto: `${r.titulo ?? ''}\n\n${r.texto}`, fecha: new Date(r.creado_en).toISOString().slice(0, 10), tipo: 'quantomo' })

/** Hasta el tope: lo que entra, en el orden dado. */
function hastaTope(docs: Documento[], tope: number): Documento[] {
  const out: Documento[] = []
  let total = 0
  for (const d of docs) { if (total + d.texto.length > tope && out.length) break; out.push(d); total += d.texto.length }
  return out
}

const rango = (f: { desde?: string | null; hasta?: string | null }) => [f.desde ? `AND COALESCE(fecha, '') >= '${f.desde.replace(/'/g, '')}'` : '', f.hasta ? `AND COALESCE(fecha, '9') <= '${f.hasta.replace(/'/g, '')}~'` : ''].join(' ')

export function documentosDe(db: DatabaseSync, d: Definicion): Documento[] {
  const tope = d.topeCaracteres ?? TOPE_CARACTERES
  const todas = (sql: string, ...a: any[]) => db.prepare(sql).all(...a) as any[]
  if (d.tipo === 'voz') {
    // Lo suyo (no lo que escribe la Academia por él) y lo que selló; lo más nuevo primero.
    const piezas = todas(`${PIEZA} WHERE nivel = 'propia' AND fuente NOT IN ('academia') ${rango(d)} ORDER BY COALESCE(fecha, '') DESC, id DESC`).map((r) => doc(r))
    const qs = todas(`SELECT id, titulo, texto, creado_en FROM quantomos WHERE etapa = 'sellado' ORDER BY id DESC`).map(quantomo)
    return hastaTope([...qs, ...piezas], tope)
  }
  if (d.tipo === 'todo') {
    // Una muestra pareja de todo: un orden pseudoaleatorio fijo (el mismo corpus da la misma muestra).
    const piezas = todas(`${PIEZA} WHERE LENGTH(contenido) >= 80 ${rango(d)} ORDER BY (id * 2654435761) % 1000003`).map((r) => doc(r))
    const qs = todas(`SELECT id, titulo, texto, creado_en FROM quantomos WHERE etapa = 'sellado' ORDER BY id DESC LIMIT 2000`).map(quantomo)
    return hastaTope([...qs, ...piezas], tope)
  }
  const out = new Map<string, Documento>()
  const sumar = (x: Documento) => out.set(`${x.tipo}:${x.id}`, x)
  for (const f of d.fuentes ?? []) {
    if (f.tipo === 'entidad') {
      for (const r of todas(`SELECT c.id, c.titulo, c.contenido, c.fecha FROM corpus c JOIN corpus_entidades e ON e.pieza_id = c.id WHERE e.entidad_id = ? ${rango(d).replace(/fecha/g, 'c.fecha')} ORDER BY c.id DESC LIMIT 3000`, f.id)) sumar(doc(r))
      for (const r of todas(`SELECT q.id, q.titulo, q.texto, q.creado_en FROM quantomos q JOIN corpus_entidades e ON e.pieza_id = q.pieza_id WHERE e.entidad_id = ? AND q.etapa IN ('sellado', 'proto') LIMIT 2000`, f.id)) sumar(quantomo(r))
      const e = db.prepare('SELECT nombre, notas FROM entidades WHERE id = ?').get(f.id) as { nombre: string; notas: string | null } | undefined
      if (e?.notas) sumar({ id: -1_000_000 - f.id, texto: `${e.nombre}\n\n${e.notas}`, tipo: 'texto' })
    } else if (f.tipo === 'conversacion') {
      const ms = todas(`SELECT id, texto, en FROM mensajes WHERE conversacion_id = ? AND rol IN ('operador', 'asistente') AND texto IS NOT NULL ORDER BY id`, f.id)
      for (const m of ms) sumar({ id: m.id, texto: m.texto, fecha: new Date(m.en).toISOString().slice(0, 10), tipo: 'mensaje' })
    } else if (f.tipo === 'dominio') {
      for (const r of todas(`SELECT c.id, c.titulo, c.contenido, c.fecha FROM corpus c JOIN dominio_fuentes f ON f.pieza_id = c.id WHERE f.aprendizaje_id = ? AND COALESCE(f.util, 0) != -1`, f.id)) sumar(doc(r))
      for (const r of todas(`${PIEZA} WHERE json_extract(meta, '$.dominio') = ? AND fuente IN ('academia', 'material')`, f.id)) sumar(doc(r))
    } else if (f.tipo === 'cuaderno') {
      for (const r of todas(`SELECT c.id, c.titulo, c.contenido, c.fecha FROM corpus c JOIN cuaderno_fuentes f ON f.pieza_id = c.id WHERE f.cuaderno_id = ?`, f.id)) sumar(doc(r))
      for (const n of todas(`SELECT id, pregunta, texto, creada_en FROM cuaderno_notas WHERE cuaderno_id = ?`, f.id)) sumar({ id: -2_000_000 - n.id, texto: `${n.pregunta ?? ''}\n\n${n.texto}`, tipo: 'texto' })
    } else if (f.tipo === 'piezas') {
      const ids = f.ids.filter(Number.isFinite).slice(0, 2000)
      if (ids.length) for (const r of todas(`${PIEZA} WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)) sumar(doc(r))
    } else if (f.tipo === 'epoca') {
      for (const r of todas(`${PIEZA} WHERE nivel = 'propia' ${rango(f)} ORDER BY fecha`)) sumar(doc(r))
    } else if (f.tipo === 'observatorio') {
      // El grafo de un debate (plan v27): lo que el Observatorio encontró de ese tema, en todas las plataformas.
      for (const r of todas(`SELECT id, titulo, extracto, texto, en FROM observatorio_items WHERE tema_id = ? ORDER BY id DESC LIMIT 3000`, f.id)) {
        sumar({ id: -4_000_000 - r.id, texto: `${r.titulo}\n\n${r.texto ?? r.extracto ?? ''}`, fecha: new Date(r.en).toISOString().slice(0, 10), tipo: 'texto' })
      }
    } else if (f.tipo === 'texto' && f.texto?.trim()) {
      sumar({ id: -3_000_000 - out.size, texto: `${f.titulo ?? ''}\n\n${f.texto}`, tipo: 'texto' })
    }
  }
  return hastaTope([...out.values()], tope)
}
