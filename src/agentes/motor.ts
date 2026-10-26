/**
 * El motor agente (plan v26): un agente de la liga que piensa en bucle, con herramientas, como Mastropiero en el chat
 * pero con lo suyo. Hasta acá cada agente era una llamada que devolvía un JSON; ahora trabaja: busca, lee, anota, vuelve
 * a buscar, redacta y cierra. Sus atributos son las perillas (pasos, largo, memoria) y el tope diario de la liga lo
 * corta antes de cada paso. Todo lo que hace queda en el log del auditor y el gasto, a su nombre.
 *
 * Lo que ve: lectura de su archivo y del grafo para todos; la web para los que buscan; y las herramientas de su
 * misión. Nunca las acciones del operador (su plata, su salud, sus misiones, su calendario) ni nada destructivo.
 */
import type { Db } from '../db.ts'
import { llamarModelo } from '../modelo.ts'
import { cadena, topeAlcanzado } from '../nan.ts'
import { registrar } from '../auditor.ts'
import { nivel, type Ficha } from '../roster.ts'
import { capa, efectosAgente } from '../xp.ts'
import { ejecutarHerramienta, esquemas, HERRAMIENTAS, type Ctx, type Herramienta } from '../chat/herramientas.ts'
import { recortarYaLeido } from '../chat/index.ts'

/** Lo que lee cualquier agente: su archivo, sus entidades y el grafo. */
export const LECTURA_AGENTE = ['buscar_corpus', 'leer_pieza', 'ver_entidad', 'listar_entidades', 'listar_quantomos', 'ver_grafo', 'conectar_conceptos', 'preguntar_al_corpus']
/** La web, para las clases que salen a buscar. */
export const WEB_AGENTE = ['buscar_web', 'leer_pagina']
const CLASES_WEB = new Set(['buscador', 'crawler', 'gerente', 'generativo'])

/** Las herramientas de un agente: las del catálogo que le tocan (lista cerrada) más las de su misión. */
export function herramientasDeAgente(f: Pick<Ficha, 'clase'>, extra: Herramienta[] = []): Herramienta[] {
  const nombres = new Set([...LECTURA_AGENTE, ...(CLASES_WEB.has(f.clase) ? WEB_AGENTE : [])])
  return [...HERRAMIENTAS.filter((h) => nombres.has(h.nombre) && h.familia !== 'destructiva'), ...extra.filter((h) => h.familia !== 'destructiva')]
}

export type Paso = { herramienta: string; resumen: string; ok: boolean }
export type Resultado = { texto: string; pasos: Paso[]; cortado: null | 'tope' | 'pasos'; tokens: number }

/** Lo que está haciendo cada agente ahora (para la Sala). */
export type EnVivoAgente = { agenteId: string; misionId: number | null; paso: number; herramienta: string | null; desde: number }
const enVivo = new Map<string, EnVivoAgente>()
export const trabajandoAhora = (): EnVivoAgente[] => [...enVivo.values()]

const URL = /https?:\/\/[^\s"'<>\\)]+/g

/**
 * Una sesión de trabajo. Corta por pasos (su Temple), por el tope diario de la liga, o cuando una herramienta de su
 * misión la cierra (ctx.mision.fin). Las URLs que vuelven de lo que busca o lee quedan en ctx.mision.urlsVistas: es lo
 * único que puede guardar como pista (no inventa links).
 */
export async function trabajar(db: Db, f: Ficha, o: {
  sistema: string; mensajes: Record<string, unknown>[]; herramientas: Herramienta[]; pasos?: number; ctx?: Partial<Ctx>; ahora?: number
  alPaso?: (p: Paso) => void
}): Promise<Resultado> {
  const ef = efectosAgente(f.atributos)
  const max = o.pasos ?? ef.pasos
  const ctx: Ctx = { db, conversacionId: null, lecturaMax: capa(nivel(f)).lecturaMax, ...o.ctx }
  const conv = [...o.mensajes]
  const desde = conv.length
  const pasos: Paso[] = []
  let tokens = 0
  const clase = cadena(f.clase).length && f.clase !== 'vectorizador' ? f.clase : 'mastropiero'
  const vivo: EnVivoAgente = { agenteId: f.id, misionId: ctx.mision?.id ?? null, paso: 0, herramienta: null, desde: o.ahora ?? Date.now() }
  enVivo.set(f.id, vivo)
  try {
    for (let vuelta = 0; vuelta < max; vuelta++) {
      if (topeAlcanzado(db)) return { texto: '', pasos, cortado: 'tope', tokens }
      vivo.paso = vuelta + 1
      vivo.herramienta = null
      recortarYaLeido(conv, desde)
      const cierre = vuelta >= max - 2 ? [{ role: 'system', content: 'Te queda como mucho un paso: cerrá la sesión con lo que tenés.' }] : []
      const r = await llamarModelo({ db, clase, agenteId: f.id }, {
        mensajes: [{ role: 'system', content: o.sistema }, ...conv, ...cierre], herramientas: esquemas(o.herramientas), temperatura: ef.temperatura, maxTokens: ef.maxTokens,
      })
      tokens += r.tokens ?? 0
      const asistente: Record<string, unknown> = { role: 'assistant', content: r.texto }
      if (r.llamadas.length) asistente.tool_calls = r.llamadas.map((l) => ({ id: l.id, type: 'function', function: { name: l.nombre, arguments: l.argumentos } }))
      if (r.razonamiento) asistente.reasoning_content = r.razonamiento
      conv.push(asistente)
      if (!r.llamadas.length) return { texto: r.texto, pasos, cortado: null, tokens }
      for (const l of r.llamadas) {
        vivo.herramienta = l.nombre
        const x = await ejecutarHerramienta(o.herramientas, l.nombre, l.argumentos, ctx)
        const contenido = JSON.stringify(x.resultado ?? null)
        if (ctx.mision && (l.nombre === 'buscar_web' || l.nombre === 'leer_pagina')) for (const u of contenido.match(URL) ?? []) ctx.mision.urlsVistas.add(u.replace(/[.,;]+$/, ''))
        let args: unknown = null
        try { args = JSON.parse(l.argumentos || '{}') } catch { /* argumentos rotos: quedan como texto */ args = l.argumentos }
        registrar(db, { tareaId: null, agenteId: f.id, ok: x.ok, input: { herramienta: l.nombre, argumentos: args, mision: ctx.mision?.id ?? null }, decision: x.resumen, output: contenido.length > 2000 ? `${contenido.slice(0, 2000)}…` : x.resultado }, o.ahora ?? Date.now())
        const p = { herramienta: l.nombre, resumen: x.resumen, ok: x.ok }
        pasos.push(p)
        o.alPaso?.(p)
        conv.push({ role: 'tool', tool_call_id: l.id, content: contenido.length > 16000 ? `${contenido.slice(0, 16000)}…` : contenido })
      }
      if (ctx.mision?.fin) return { texto: r.texto, pasos, cortado: null, tokens }
    }
    return { texto: '', pasos, cortado: 'pasos', tokens }
  } finally {
    enVivo.delete(f.id)
  }
}
