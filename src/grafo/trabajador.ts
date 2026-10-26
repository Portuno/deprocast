/**
 * El hilo aparte del grafo (plan v25): acá corre todo lo pesado (leer el texto, la red, Brandes, Louvain, el dibujo),
 * así el servidor sigue respondiendo en milisegundos mientras se calcula. Si recibe la ruta de la base, abre su propia
 * conexión de solo lectura y junta los documentos él mismo (SQLite en WAL deja leer mientras el servidor escribe).
 */
import { parentPort } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { calcular, medirRed, type Opciones } from './calcular.ts'
import type { Documento, Red } from './construir.ts'
import { documentosDe, type Definicion } from './fuentes.ts'

type Pedido = { docs?: Documento[]; red?: Pick<Red, 'nodos' | 'aristas' | 'documentos' | 'lemas' | 'automaticas'>; ruta?: string; definicion?: Definicion; opciones: Opciones & { dic?: any } }

parentPort!.on('message', (p: Pedido) => {
  try {
    const opciones = { ...p.opciones, dic: p.opciones.dic ? { stop: new Set<string>(p.opciones.dic.stop), alias: new Map<string, string>(p.opciones.dic.alias), proteger: new Set<string>(p.opciones.dic.proteger) } : undefined }
    // Una red ya armada (quitar lo obvio): solo medir y dibujar.
    if (p.red) return void parentPort!.postMessage({ ok: true, resultado: medirRed(p.red, opciones), documentos: p.red.documentos, firma: '' })
    let docs = p.docs ?? []
    if (!p.docs && p.ruta && p.definicion) {
      const db = new DatabaseSync(p.ruta, { readOnly: true })
      try { docs = documentosDe(db as any, p.definicion) } finally { db.close() }
    }
    parentPort!.postMessage({ ok: true, resultado: calcular(docs, opciones), documentos: docs.length, firma: firmaDe(docs, p.opciones.dic) })
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})

/** Una huella barata de lo que entró (los textos y su diccionario): si no cambió, no hace falta recalcular. */
export function firmaDe(docs: Documento[], dic?: unknown): string {
  let h = 2166136261
  for (const d of docs) { h ^= d.id; h = Math.imul(h, 16777619); h ^= d.texto.length; h = Math.imul(h, 16777619) }
  const t = dic && Object.values(dic as Record<string, unknown[]>).some((x) => x?.length) ? JSON.stringify(dic) : '' // sin diccionario, la huella de siempre
  let hd = 2166136261
  for (let i = 0; i < t.length; i++) { hd ^= t.charCodeAt(i); hd = Math.imul(hd, 16777619) }
  return `${docs.length}:${(h >>> 0).toString(36)}${t ? `:${(hd >>> 0).toString(36)}` : ''}`
}
