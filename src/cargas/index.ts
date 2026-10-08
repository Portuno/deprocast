/**
 * Cargas: la boca del omnívoro para archivos. Subir → analizar (segmentos) → ejecutar lo elegido.
 * Cada carga queda registrada con su archivo y lo que dejó; se puede deshacer entera.
 */
import fs from 'node:fs'
import path from 'node:path'
import { json, type Db } from '../db.ts'
import { asegurarFuente, esNivel, insertar, leerFuente, PIPELINE_INGESTA } from '../corpus.ts'
import { crearQuantomo } from '../quantomos.ts'
import { asegurarEntidad } from '../entidades.ts'
import { publicar } from '../bus.ts'
import type { Analisis, Contexto, Datos, Importador, Opciones } from './tipos.ts'
import { deprocastQuantomos, deprocastRespaldo } from './deprocast.ts'
import { deprocastFicha } from './deprocast-ficha.ts'
import { csv } from './csv.ts'
import { texto } from './texto.ts'
import { claude, correo, gemini, instagram, whatsapp } from './mensajes.ts'

/** En orden: los formatos reconocibles antes que el texto genérico. */
export const IMPORTADORES: Importador[] = [deprocastRespaldo, deprocastQuantomos, deprocastFicha, whatsapp, instagram, claude, gemini, correo, csv, texto]

export function dirCargas(): string {
  return path.resolve(process.env.MASTRO_CARGAS ?? path.join(process.cwd(), 'data', 'cargas'))
}

function leerDatos(nombre: string, ruta: string): Datos {
  const t = fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '')
  let j: unknown
  if (/\.json$/i.test(nombre) || /^\s*[{[]/.test(t.slice(0, 64))) {
    try {
      j = JSON.parse(t)
    } catch {
      j = undefined
    }
  }
  return { nombre, texto: t, json: j }
}

function importadorDe(d: Datos): Importador {
  const imp = IMPORTADORES.find((i) => i.detectar(d))
  if (!imp) throw new Error(`No sé leer "${d.nombre}". Formatos: respaldo y fichas de Deprocast, chats de WhatsApp e Instagram, Claude, Gemini, correo (.mbox/.eml), CSV, texto y Markdown.`)
  return imp
}

export type Carga = {
  id: number
  importador: string
  archivo: string
  bytes: number | null
  fuenteId: string | null
  analisis: Analisis | null
  resumen: Resumen | null
  estado: 'analizada' | 'hecha' | 'deshecha'
  creadaEn: number
  hechaEn: number | null
}

export type Resumen = {
  piezas: number
  repetidas: number
  quantomos: number
  entidades: number
  tareas: number
  porSegmento: Record<string, number>
  pipeline: Opciones['pipeline']
  segundos: number
}

function deFila(r: any): Carga {
  return {
    id: r.id, importador: r.importador, archivo: r.archivo, bytes: r.bytes, fuenteId: r.fuente_id,
    analisis: json(r.analisis, null), resumen: json(r.resumen, null), estado: r.estado, creadaEn: r.creada_en, hechaEn: r.hecha_en,
  }
}

export function leerCarga(db: Db, id: number): Carga | null {
  const r = db.prepare('SELECT * FROM cargas WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

export function listarCargas(db: Db): Carga[] {
  return db.prepare('SELECT * FROM cargas ORDER BY id DESC LIMIT 100').all().map(deFila)
}

/** Guarda el archivo, detecta el formato y lo segmenta. Todavía no entra nada al corpus. */
export function subir(db: Db, nombre: string, contenido: Buffer | string, ahora = Date.now()): Carga {
  const limpio = path.basename(nombre).replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]+/g, '_') || 'carga'
  fs.mkdirSync(dirCargas(), { recursive: true })
  const ruta = path.join(dirCargas(), `${ahora}-${limpio}`)
  fs.writeFileSync(ruta, contenido)
  try {
    const d = leerDatos(limpio, ruta)
    const imp = importadorDe(d)
    const analisis = imp.analizar(d)
    const r = db.prepare(
      `INSERT INTO cargas (importador, archivo, ruta, bytes, analisis, estado, creada_en) VALUES (?, ?, ?, ?, ?, 'analizada', ?)`,
    ).run(imp.id, limpio, ruta, fs.statSync(ruta).size, JSON.stringify(analisis), ahora)
    return leerCarga(db, Number(r.lastInsertRowid))!
  } catch (e) {
    fs.rmSync(ruta, { force: true })
    throw e
  }
}

export function ejecutar(db: Db, cargaId: number, o: Partial<Opciones>, ahora = Date.now()): Carga {
  const carga = leerCarga(db, cargaId)
  if (!carga || !carga.analisis) throw new Error(`No existe la carga ${cargaId}`)
  if (carga.estado !== 'analizada') throw new Error(`La carga ${cargaId} ya está ${carga.estado}`)
  const imp = IMPORTADORES.find((i) => i.id === carga.importador)!
  const a = carga.analisis
  const opciones: Opciones = {
    segmentos: o.segmentos ?? a.segmentos.filter((s) => s.porDefecto).map((s) => s.id),
    fuenteId: o.fuenteId || a.fuente.id,
    pipeline: o.pipeline ?? 'ninguna',
    nivel: o.nivel && esNivel(o.nivel) ? o.nivel : undefined,
    umbralPeso: o.umbralPeso ?? a.umbralPeso,
  }
  if (!opciones.fuenteId) throw new Error('Elegí una fuente para la carga')
  if (!leerFuente(db, opciones.fuenteId)) {
    if (opciones.fuenteId !== a.fuente.id) throw new Error(`No existe la fuente ${opciones.fuenteId}`)
    asegurarFuente(db, { id: a.fuente.id, nombre: a.fuente.nombre, nivel: a.fuente.nivel, padreId: a.fuente.padreId, descripcion: a.fuente.descripcion }, ahora)
  }
  const elegidos = new Set(opciones.segmentos)
  const nivelDeSegmento = new Map(a.segmentos.filter((s) => s.nivel).map((s) => [s.id, s.nivel!]))
  const r: Resumen = { piezas: 0, repetidas: 0, quantomos: 0, entidades: 0, tareas: 0, porSegmento: {}, pipeline: opciones.pipeline, segundos: 0 }
  const suma = (seg: string) => (r.porSegmento[seg] = (r.porSegmento[seg] ?? 0) + 1)
  const t0 = Date.now()

  const ctx: Contexto = {
    db, cargaId, ahora, fuenteId: opciones.fuenteId, opciones,
    quiere: (s) => elegidos.has(s),
    pieza(seg, p) {
      // Lo estructurado entra disponible; con pipeline, entra donde la pipeline lo tome. Los enlaces esperan a un crawler.
      const pendiente = p.estado === 'pendiente'
      const estado = pendiente ? 'pendiente' : opciones.pipeline === 'completa' ? 'crudo' : opciones.pipeline === 'vectorizar' ? 'clasificado' : 'disponible'
      // Nivel: el explícito, si no el del segmento, si no el de la fuente.
      const nivel = p.nivel ?? nivelDeSegmento.get(seg) ?? undefined
      const id = insertar(db, { ...p, fuente: p.fuente ?? opciones.fuenteId, nivel, estado, cargaId }, ahora)
      if (id == null) {
        r.repetidas++
        return null
      }
      r.piezas++
      suma(seg)
      if (!pendiente && opciones.pipeline !== 'ninguna') {
        const etapa = opciones.pipeline === 'completa' ? 0 : PIPELINE_INGESTA.length - 1
        publicar(db, {
          clase: PIPELINE_INGESTA[etapa].clase, tipo: 'ingesta', payload: { titulo: p.titulo, carga: cargaId },
          publicadaPor: 'mastropiero', pipeline: 'ingesta', etapa, corpusId: id,
        }, ahora)
        r.tareas++
      }
      return id
    },
    quantomo(seg, q) {
      const id = crearQuantomo(db, { ...q, cargaId }, ahora)
      if (id == null) r.repetidas++
      else (r.quantomos++, suma(seg))
      return id
    },
    entidad(seg, e) {
      const antes = (db.prepare('SELECT id FROM entidades WHERE origen_id = ?').get(e.origenId) as { id: number } | undefined)?.id
      const id = asegurarEntidad(db, { ...e, cargaId }, ahora)
      if (antes == null) (r.entidades++, suma(seg))
      return id
    },
  }

  const { ruta } = db.prepare('SELECT ruta FROM cargas WHERE id = ?').get(cargaId) as { ruta: string }
  if (!ruta || !fs.existsSync(ruta)) throw new Error('El archivo de esta carga ya no está en data/cargas: subilo de nuevo')
  const d = leerDatos(carga.archivo, ruta)
  db.exec('BEGIN')
  try {
    imp.ejecutar(d, ctx)
    r.segundos = Math.round((Date.now() - t0) / 100) / 10
    db.prepare(`UPDATE cargas SET estado = 'hecha', fuente_id = ?, resumen = ?, hecha_en = ? WHERE id = ?`).run(opciones.fuenteId, JSON.stringify(r), ahora, cargaId)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return leerCarga(db, cargaId)!
}

/** Saca del corpus todo lo que entró con esta carga (piezas, quántomos, entidades y sus tareas pendientes). */
export function deshacer(db: Db, cargaId: number): Carga {
  const carga = leerCarga(db, cargaId)
  if (!carga) throw new Error(`No existe la carga ${cargaId}`)
  if (carga.estado !== 'hecha') throw new Error(`Solo se deshace una carga hecha (esta está ${carga.estado})`)
  db.exec('BEGIN')
  try {
    db.prepare(`DELETE FROM tareas WHERE corpus_id IN (SELECT id FROM corpus WHERE carga_id = ?) AND estado IN ('pendiente', 'asignada')`).run(cargaId)
    db.prepare(`UPDATE tareas SET corpus_id = NULL WHERE corpus_id IN (SELECT id FROM corpus WHERE carga_id = ?)`).run(cargaId)
    db.prepare('DELETE FROM quantomos WHERE carga_id = ?').run(cargaId)
    db.prepare('UPDATE quantomos SET pieza_id = NULL WHERE pieza_id IN (SELECT id FROM corpus WHERE carga_id = ?)').run(cargaId)
    db.prepare('DELETE FROM corpus WHERE carga_id = ?').run(cargaId)
    db.prepare('DELETE FROM entidades WHERE carga_id = ?').run(cargaId)
    db.prepare(`UPDATE cargas SET estado = 'deshecha' WHERE id = ?`).run(cargaId)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return leerCarga(db, cargaId)!
}

/**
 * Vuelve a calcular entidades y etiquetas de las piezas de una carga hecha, con la lógica actual del importador.
 * No crea ni borra piezas ni quántomos: sirve para corregir etiquetado (por ejemplo, tras arreglar un importador).
 */
export function reetiquetar(db: Db, cargaId: number, ahora = Date.now()): { piezas: number; cambiadas: number } {
  const carga = leerCarga(db, cargaId)
  if (!carga || carga.estado !== 'hecha') throw new Error(`La carga ${cargaId} no está hecha`)
  const imp = IMPORTADORES.find((i) => i.id === carga.importador)!
  const { ruta } = db.prepare('SELECT ruta FROM cargas WHERE id = ?').get(cargaId) as { ruta: string }
  if (!ruta || !fs.existsSync(ruta)) throw new Error('El archivo de esta carga ya no está en data/cargas')
  const segmentos = Object.keys(carga.resumen?.porSegmento ?? {})
  const r = { piezas: 0, cambiadas: 0 }
  const ctx: Contexto = {
    db, cargaId, ahora, fuenteId: carga.fuenteId ?? '',
    opciones: { segmentos, fuenteId: carga.fuenteId ?? '', pipeline: 'ninguna', umbralPeso: carga.analisis?.umbralPeso },
    quiere: (s) => s === 'entidades' || segmentos.includes(s),
    pieza(_, p) {
      if (!p.origenId) return null
      const actual = db.prepare('SELECT id, entidades, etiquetas FROM corpus WHERE origen_id = ? AND carga_id = ?').get(p.origenId, cargaId) as any
      if (!actual) return null
      r.piezas++
      const entidades = p.entidades?.length ? JSON.stringify(p.entidades) : null
      const etiquetas = p.etiquetas?.length ? JSON.stringify(p.etiquetas) : null
      if (entidades !== actual.entidades || etiquetas !== actual.etiquetas) {
        db.prepare('UPDATE corpus SET entidades = ?, etiquetas = ? WHERE id = ?').run(entidades, etiquetas, actual.id)
        r.cambiadas++
      }
      return actual.id
    },
    quantomo: () => null,
    entidad: (_, e) => asegurarEntidad(db, { ...e, cargaId }, ahora),
  }
  db.exec('BEGIN')
  try {
    imp.ejecutar(leerDatos(carga.archivo, ruta), ctx)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return r
}

/** Una carga analizada que no se ejecutó se puede descartar: se borra su archivo. */
export function descartar(db: Db, cargaId: number) {
  const r = db.prepare(`SELECT ruta, estado FROM cargas WHERE id = ?`).get(cargaId) as { ruta: string; estado: string } | undefined
  if (!r) return
  if (r.estado !== 'analizada') throw new Error('Solo se descarta una carga sin ejecutar')
  if (r.ruta) fs.rmSync(r.ruta, { force: true })
  db.prepare('DELETE FROM cargas WHERE id = ?').run(cargaId)
}
