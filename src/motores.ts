/**
 * Motores: lo que efectivamente corre detrás de una ficha.
 *   local          → sin modelo, determinístico (sirve para probar la liga y como piso honesto)
 *   nan            → NaN con cadenas de modelos por clase (nan.ts)
 *   llm            → cualquier otro endpoint compatible con OpenAI (Groq, Ollama, LM Studio…)
 *   funcion:<n>    → función registrada en la lista blanca (obligatorio para ejecutivos)
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { CLASES } from './clases.ts'
import type { Db } from './db.ts'
import type { Ficha } from './roster.ts'
import type { Tarea } from './bus.ts'
import type { Contexto, Lector } from './contexto.ts'
import type { Efectos } from './xp.ts'
import { asientos } from './auditor.ts'
import { palabras } from './texto.ts'
import { nanChat, nanEmbed } from './nan.ts'
import { NIVELES } from './corpus.ts'
import { candidatos } from './quantomos.ts'

export type Entrada = { db: Db; ficha: Ficha; tarea: Tarea; contexto: Contexto; lector: Lector; efectos: Efectos }
export type Salida = Record<string, unknown>
export type Motor = (e: Entrada) => Promise<Salida>

const funciones = new Map<string, Motor>()

export function registrarFuncion(nombre: string, fn: Motor) {
  funciones.set(nombre, fn)
}

export function motoresDisponibles(): string[] {
  return ['local', 'nan', 'llm', ...[...funciones.keys()].map((n) => `funcion:${n}`)]
}

export function resolverMotor(nombre: string): Motor {
  if (nombre === 'local') return local
  if (nombre === 'llm') return llm
  if (nombre === 'nan') return nan
  if (nombre.startsWith('funcion:')) {
    const fn = funciones.get(nombre.slice(8))
    if (!fn) throw new Error(`Función no registrada: ${nombre}`)
    return fn
  }
  throw new Error(`Motor desconocido: ${nombre}`)
}

/** El texto sobre el que trabaja la tarea: la pieza del corpus si hay, si no el payload. */
export function textoDe(c: Contexto): string {
  const p = c.tarea.payload
  return c.pieza?.contenido ?? (typeof p.texto === 'string' ? p.texto : typeof p.consulta === 'string' ? p.consulta : JSON.stringify(p))
}

// ─── local ──────────────────────────────────────────────────────────────

/** Hashing trick: embedding pobre pero real, 64 dimensiones, normalizado. */
export function embeddingLocal(texto: string, dims = 64): number[] {
  const v = new Array(dims).fill(0)
  for (const w of palabras(texto)) {
    const h = createHash('md5').update(w).digest()
    v[h[0] % dims] += h[1] % 2 ? 1 : -1
  }
  const norma = Math.hypot(...v) || 1
  return v.map((x) => Math.round((x / norma) * 1e4) / 1e4)
}

export function htmlATexto(html: string): { titulo: string; texto: string } {
  const titulo = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? ''
  const texto = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { titulo, texto }
}

const local: Motor = async ({ db, ficha, contexto, lector, efectos }) => {
  const texto = textoDe(contexto)
  const p = contexto.tarea.payload
  switch (ficha.clase) {
    case 'generativo':
      return { texto: `${ficha.instrucciones}\n\n— sobre: ${texto.slice(0, efectos.maxTokens * 4)}` }
    case 'gerente':
      return { decision: `sin modelo: dejo "${texto.slice(0, 80)}" para el reparto heurístico` }
    case 'buscador': {
      const hits = lector.buscar(texto)
      return {
        respuesta: hits.map((h) => `[${h.id}] (${NIVELES[h.nivel].nombre}) ${h.titulo}: ${h.contenido.slice(0, 160)}`).join('\n'),
        citas: hits.map((h) => h.id),
      }
    }
    case 'crawler': {
      const url = typeof p.url === 'string' ? p.url : null
      if (!url) return { items: [] }
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Mastropiero/1.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`)
      const { titulo, texto: cuerpo } = htmlATexto(await res.text())
      return { items: [{ titulo: titulo || url, contenido: cuerpo.slice(0, 20_000), url }] }
    }
    case 'vectorizador':
      return { embedding: embeddingLocal(texto) }
    case 'clasificador': {
      const frec = new Map<string, number>()
      for (const w of palabras(texto)) if (w.length >= 5) frec.set(w, (frec.get(w) ?? 0) + 1)
      const top = [...frec].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([w]) => w)
      if (contexto.tarea.dominio) top.unshift(contexto.tarea.dominio)
      return { etiquetas: [...new Set(top)] }
    }
    case 'extractor':
      return {
        datos: {
          primeraLinea: texto.split('\n')[0].slice(0, 140),
          palabras: palabras(texto).length,
          caracteres: texto.length,
          urls: texto.match(/https?:\/\/\S+/g) ?? [],
          menciones: texto.match(/@[\p{L}\d_]+/gu) ?? [],
          fechas: texto.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g) ?? [],
        },
        // Sin modelo no hay destilado: propone las oraciones con más sustancia como proto-quántomos.
        quantomos: candidatos(texto),
      }
    case 'auditor': {
      const objetivo = typeof p.agenteId === 'string' ? p.agenteId : undefined
      const log = asientos(db, { agenteId: objetivo, limite: 30 }).filter((a) => a.tareaId != null)
      const fallas = log.filter((a) => !a.ok)
      const tasa = log.length ? fallas.length / log.length : 0
      return {
        veredicto: tasa > 0.5 ? 'alerta' : 'ok',
        hallazgos: [
          `${log.length} corridas revisadas${objetivo ? ` de ${objetivo}` : ''}, ${fallas.length} fallidas (${Math.round(tasa * 100)}%)`,
          ...fallas.slice(0, 3).map((f) => `tarea ${f.tareaId}: ${f.decision ?? 'sin detalle'}`),
        ],
      }
    }
    case 'ejecutivo':
      throw new Error('Un ejecutivo no corre en motor local')
  }
}

// ─── modelos: prompt común ──────────────────────────────────────────────

function mensajes({ ficha, contexto, lector, efectos }: Entrada) {
  const clase = CLASES[ficha.clase]
  const fuentes = ficha.clase === 'buscador'
    ? lector.buscar(textoDe(contexto)).map((p) => ({
      id: p.id, nivel: NIVELES[p.nivel].nombre, fuente: p.fuente, titulo: p.titulo, autor: p.autor ?? undefined, contenido: p.contenido.slice(0, 1200),
    }))
    : undefined
  const sistema = [
    `Sos ${ficha.nombre ?? ficha.id}, agente ${clase.nombre} de la liga de Mastropiero (Deprocast 1.0).`,
    ficha.instrucciones,
    `Respondé SOLO un objeto JSON con esta forma: ${clase.salida}.`,
    efectos.iniciativa > 0
      ? `Si hace falta trabajo de otra clase, podés agregar "nuevasTareas": [{"clase": string, "texto": string, "dominio"?: string}] (máximo ${efectos.iniciativa}).`
      : '',
    ficha.clase === 'buscador' ? 'Citá por id solo fuentes provistas. Si no hay fuente, citas vacías.' : '',
  ].filter(Boolean).join('\n')
  return [
    { role: 'system', content: sistema },
    { role: 'user', content: JSON.stringify({ ...contexto, fuentes }) },
  ]
}

function objetoJson(contenido: string): Salida {
  const json = contenido.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('El modelo no devolvió JSON')
  return JSON.parse(json)
}

// ─── llm (compatible OpenAI) ────────────────────────────────────────────

function cfgLlm() {
  const base = (process.env.MASTRO_LLM_BASE_URL ?? '').replace(/\/+$/, '')
  if (!base) throw new Error('Falta MASTRO_LLM_BASE_URL para el motor llm')
  return {
    base,
    key: process.env.MASTRO_LLM_KEY ?? '',
    modelo: process.env.MASTRO_LLM_MODEL ?? '',
    embed: process.env.MASTRO_EMBED_MODEL ?? '',
  }
}

async function post(url: string, key: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/** Un modelo no navega: el crawler siempre trae la página con fetch local. */
const llm: Motor = async (e) => {
  if (e.ficha.clase === 'crawler') return local(e)
  const cfg = cfgLlm()
  if (e.ficha.clase === 'vectorizador') {
    const r = await post(`${cfg.base}/embeddings`, cfg.key, { model: cfg.embed || cfg.modelo, input: textoDe(e.contexto) })
    return { embedding: r.data?.[0]?.embedding ?? [] }
  }
  const r = await post(`${cfg.base}/chat/completions`, cfg.key, {
    model: cfg.modelo,
    temperature: e.efectos.temperatura,
    max_tokens: e.efectos.maxTokens,
    response_format: { type: 'json_object' },
    messages: mensajes(e),
  })
  return objetoJson(r.choices?.[0]?.message?.content ?? '')
}

// ─── nan (cadenas por clase, ver nan.ts) ────────────────────────────────

const nan: Motor = async (e) => {
  if (e.ficha.clase === 'crawler') return local(e)
  const l = { db: e.db, clase: e.ficha.clase, agenteId: e.ficha.id }
  if (e.ficha.clase === 'vectorizador') return { embedding: (await nanEmbed(l, textoDe(e.contexto))).embedding }
  const { texto } = await nanChat(l, { mensajes: mensajes(e), temperatura: e.efectos.temperatura, maxTokens: e.efectos.maxTokens, json: true })
  return objetoJson(texto)
}

// ─── funciones de fábrica ───────────────────────────────────────────────

/** Ejecutivo de ejemplo: deja una línea en la bitácora del operador. Efecto real, inofensivo. */
registrarFuncion('bitacora', async ({ ficha, contexto }) => {
  const ruta = path.resolve(process.env.MASTRO_BITACORA ?? path.join(process.cwd(), 'data', 'bitacora.md'))
  fs.mkdirSync(path.dirname(ruta), { recursive: true })
  const linea = `- ${new Date().toISOString()} · ${ficha.nombre ?? ficha.id} · ${textoDe(contexto).replace(/\s+/g, ' ').slice(0, 300)}\n`
  fs.appendFileSync(ruta, linea)
  return { efecto: `bitácora += ${linea.length} bytes`, ok: true }
})
