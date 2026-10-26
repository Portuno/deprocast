/**
 * La cola del hilo del grafo (plan v25): un cálculo a la vez, cada uno en un worker propio que se cierra al terminar
 * (la memoria del cálculo no queda en el servidor). Si algo tarda de más, se corta.
 */
import { Worker } from 'node:worker_threads'
import type { Resultado, Opciones } from './calcular.ts'
import type { Documento } from './construir.ts'
import type { Definicion } from './fuentes.ts'
import type { Diccionario } from './texto.ts'

export type Pedido = { docs?: Documento[]; ruta?: string; definicion?: Definicion; opciones?: Opciones }
export type Respuesta = { resultado: Resultado; documentos: number; firma: string }

const MAX_MS = 5 * 60_000
let cola: Promise<unknown> = Promise.resolve()
let enCurso = 0

/** Para mandar al worker: los Set y Map del diccionario como listas. */
const plano = (d?: Diccionario) => (d ? { stop: [...d.stop], alias: [...d.alias], proteger: [...d.proteger] } : undefined)

function correr(p: Pedido): Promise<Respuesta> {
  return new Promise((ok, mal) => {
    const w = new Worker(new URL('./trabajador.ts', import.meta.url))
    const corte = setTimeout(() => { w.terminate(); mal(new Error('El grafo tardó demasiado: probá con menos texto')) }, MAX_MS)
    w.once('message', (r: any) => { clearTimeout(corte); w.terminate(); r.ok ? ok({ resultado: r.resultado, documentos: r.documentos, firma: r.firma }) : mal(new Error(r.error)) })
    w.once('error', (e) => { clearTimeout(corte); w.terminate(); mal(e) })
    w.postMessage({ ...p, opciones: { ...(p.opciones ?? {}), dic: plano(p.opciones?.dic) } })
  })
}

/** Encola un cálculo en el hilo aparte: de a uno, en orden. */
export function calcularEnHilo(p: Pedido): Promise<Respuesta> {
  enCurso++
  const r = cola.then(() => correr(p))
  cola = r.catch(() => {}).finally(() => { enCurso-- })
  return r
}
export const calculando = () => enCurso
