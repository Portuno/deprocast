/**
 * El hilo aparte del grafo (plan v25): acá corre todo lo pesado (leer el texto, la red, Brandes, Louvain, el dibujo),
 * así el servidor sigue respondiendo en milisegundos mientras se calcula. Si recibe la ruta de la base, abre su propia
 * conexión de solo lectura y junta los documentos él mismo (SQLite en WAL deja leer mientras el servidor escribe).
 */
import { parentPort } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { calcular, type Opciones } from './calcular.ts'
import type { Documento } from './construir.ts'
import { documentosDe, type Definicion } from './fuentes.ts'

type Pedido = { docs?: Documento[]; ruta?: string; definicion?: Definicion; opciones: Opciones & { dic?: any } }

parentPort!.on('message', (p: Pedido) => {
  try {
    const opciones = { ...p.opciones, dic: p.opciones.dic ? { stop: new Set<string>(p.opciones.dic.stop), alias: new Map<string, string>(p.opciones.dic.alias), proteger: new Set<string>(p.opciones.dic.proteger) } : undefined }
    let docs = p.docs ?? []
    if (!p.docs && p.ruta && p.definicion) {
      const db = new DatabaseSync(p.ruta, { readOnly: true })
      try { docs = documentosDe(db as any, p.definicion) } finally { db.close() }
    }
    parentPort!.postMessage({ ok: true, resultado: calcular(docs, opciones), documentos: docs.length, firma: firmaDe(docs) })
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})

/** Una huella barata de lo que entró: si no cambió, no hace falta recalcular. */
export function firmaDe(docs: Documento[]): string {
  let h = 2166136261
  for (const d of docs) { h ^= d.id; h = Math.imul(h, 16777619); h ^= d.texto.length; h = Math.imul(h, 16777619) }
  return `${docs.length}:${(h >>> 0).toString(36)}`
}
