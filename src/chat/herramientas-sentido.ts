/**
 * Las herramientas por sentido (plan v38, fase 1½): además de las palabras clave (gruposDelMensaje), el mensaje se
 * compara con la descripción de cada herramienta por su vector, y los grupos de las más cercanas viajan en el turno.
 * Así «¿me contestó Pedro?» trae el correo aunque no diga «mail». Los vectores de las herramientas se calculan una vez
 * (y cuando cambia una descripción) y quedan en la base; mientras no están, se sigue solo con las palabras.
 */
import crypto from 'node:crypto'
import type { Db } from '../db.ts'
import { GRUPOS, HERRAMIENTAS, NUCLEO } from './herramientas.ts'

const huella = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)
let enMemoria: Map<string, Float32Array> | null = null
let calculando: Promise<void> | null = null

/** De qué grupo es cada herramienta (las del núcleo no hace falta pedirlas). */
const GRUPO_DE = new Map<string, string>(Object.entries(GRUPOS).flatMap(([g, hs]) => hs.map((h) => [h, g] as [string, string])))

function cargar(db: Db): Map<string, Float32Array> {
  if (enMemoria) return enMemoria
  db.exec('CREATE TABLE IF NOT EXISTS vec_herramientas (nombre TEXT PRIMARY KEY, huella TEXT NOT NULL, vec BLOB NOT NULL)')
  const filas = db.prepare('SELECT nombre, huella, vec FROM vec_herramientas').all() as { nombre: string; huella: string; vec: Uint8Array }[]
  const vigentes = new Map(HERRAMIENTAS.map((h) => [h.nombre, huella(`${h.nombre}: ${h.descripcion}`)]))
  enMemoria = new Map(filas.filter((f) => vigentes.get(f.nombre) === f.huella).map((f) => [f.nombre, new Float32Array(f.vec.buffer.slice(f.vec.byteOffset, f.vec.byteOffset + f.vec.byteLength))]))
  return enMemoria
}

/** Calcula los vectores que faltan (de fondo, una vez). */
export function prepararVectores(db: Db): Promise<void> {
  if (calculando) return calculando
  calculando = (async () => {
    const ya = cargar(db)
    const faltan = HERRAMIENTAS.filter((h) => !ya.has(h.nombre) && GRUPO_DE.has(h.nombre))
    if (!faltan.length) return
    const { vectoresDeTextos, vecABlob } = await import('../semantica.ts')
    const vs = await vectoresDeTextos(db, faltan.map((h) => `${h.nombre.replace(/_/g, ' ')}: ${h.descripcion}`), 'herramientas')
    if (!vs) return
    const ins = db.prepare('INSERT OR REPLACE INTO vec_herramientas (nombre, huella, vec) VALUES (?, ?, ?)')
    faltan.forEach((h, i) => { const v = vs[i]; if (v) { ins.run(h.nombre, huella(`${h.nombre}: ${h.descripcion}`), vecABlob(v)); ya.set(h.nombre, v) } })
  })().finally(() => { calculando = null })
  return calculando
}

/**
 * Los grupos de las herramientas más cercanas a lo que escribió (las k primeras que pasen el umbral). Si los vectores
 * todavía no están, los pide de fondo y devuelve [] (este turno sigue con las palabras).
 */
export async function gruposPorSentido(db: Db, vec: Float32Array | null, o: { k?: number; umbral?: number } = {}): Promise<string[]> {
  if (!vec) return []
  const vs = cargar(db)
  if (vs.size < GRUPO_DE.size * 0.8) { void prepararVectores(db).catch(() => {}); if (!vs.size) return [] }
  const { parecidoA } = await import('../semantica.ts')
  const ranking = [...vs].filter(([n]) => !NUCLEO.includes(n)).map(([n, v]) => ({ n, sim: parecidoA(vec, v) })).sort((a, b) => b.sim - a.sim)
  const elegidas = ranking.filter((x) => x.sim >= (o.umbral ?? 0.35)).slice(0, o.k ?? 6)
  return [...new Set(elegidas.map((x) => GRUPO_DE.get(x.n)).filter((g): g is string => !!g))]
}

export function _olvidarVectoresHerramientas() { enMemoria = null }
