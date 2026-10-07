/**
 * NaN como motor de la liga. Misma política que la 0.7.1 (nanPolicy.ts / nan.md):
 * cadenas de modelos, 402 → siguiente, 429 espera, 401 corta, 5xx reintenta dos veces,
 * DeepSeek con max_tokens ≥ 16384 y la palabra JSON, se lee `message.content` y nunca `reasoning_content`.
 * La API key no se loguea.
 */
import type { ClaseId } from './clases.ts'
import type { Db } from './db.ts'

export const NAN_BASE_DEFECTO = 'https://api.nan.builders/v1'

export const M = {
  deepseek: 'deepseek-v4-flash', // 284B MoE · 1M ctx · visión — el cupo más grande
  glm: 'glm5.3-flash', //           razonamiento · 1M ctx
  qwen: 'qwen3.8-flash', //         6B activos · 262K ctx · visión — rápido, cupo chico
  embed: 'qwen3-embedding',
} as const

/** Cupo mensual de tokens según el panel de NaN (oct 2026). Se resetea el 1 de cada mes. */
export const CUPOS: Record<string, number> = {
  [M.deepseek]: 3_000_000_000,
  [M.glm]: 2_000_000_000,
  [M.qwen]: 500_000_000,
}

/**
 * Ruteo por clase. Criterio:
 * - Lo que juzga (gerente, auditor) va primero a GLM, que razona.
 * - Lo largo o con fuentes (generativo, extractor, buscador) va a DeepSeek: 1M de contexto y el cupo mayor.
 * - Lo corto y masivo (clasificador) va a Qwen, el más liviano.
 * - Ejecutivo y crawler no usan modelo: uno corre funciones de lista blanca, el otro trae con fetch.
 * - Mastropiero (el chat con herramientas) va a DeepSeek: probado con tool calling en 3–4 s; Qwen y GLM detrás.
 * Se pisa con NAN_CADENA_<CLASE>=modelo1,modelo2 (y NAN_CADENA_MASTROPIERO).
 */
const CADENAS: Record<ClaseId | 'mastropiero', string[]> = {
  mastropiero: [M.deepseek, M.qwen, M.glm],
  generativo: [M.deepseek, M.glm],
  gerente: [M.glm, M.deepseek],
  auditor: [M.glm, M.deepseek],
  extractor: [M.deepseek, M.qwen],
  buscador: [M.deepseek, M.qwen],
  clasificador: [M.qwen, M.deepseek],
  crawler: [],
  vectorizador: [M.embed],
  ejecutivo: [],
}

/** Modelos que obedecen reasoning_effort (igual que la 0.7.1). */
const OBEDECEN_ESFUERZO = new Set<string>([M.glm, 'gemma4', 'qwen3.6'])
/** Presupuesto extra para modelos que piensan antes de escribir: sin esto GLM gasta todo en razonar y devuelve content vacío. */
export const PRESUPUESTO_RAZONAMIENTO = 4096
function piensa(modelo: string) {
  return modelo === M.glm || (modelo !== '' && modelo === env('NAN_MIMO_ID'))
}

function env(nombre: string, def = ''): string {
  return (process.env[nombre] ?? def).replace(/^["']|["']$/g, '').trim()
}

export function assertPermitido(id: string) {
  if (id === 'glm5.3' || id === 'glm5.2' || id.endsWith('-fallback')) throw new Error(`modelo NaN prohibido: ${id}`)
}

/** MiMo entra como último recurso de las cadenas de chat cuando NAN_MIMO_ID tiene el id exacto (ver `mastro nan modelos`). */
export function cadena(clase: ClaseId | 'mastropiero'): string[] {
  const propia = env(`NAN_CADENA_${clase.toUpperCase()}`)
  const base = propia ? propia.split(',').map((s) => s.trim()).filter(Boolean) : [...(CADENAS[clase] ?? CADENAS.mastropiero)]
  const mimo = env('NAN_MIMO_ID')
  if (mimo && !propia && clase !== 'vectorizador' && base.length) base.push(mimo)
  for (const id of base) assertPermitido(id)
  return base
}

export function cupoDe(modelo: string): number | null {
  if (CUPOS[modelo]) return CUPOS[modelo]
  return modelo === env('NAN_MIMO_ID') && modelo ? 1_000_000_000 : null
}

// ─── transporte (inyectable para tests) ─────────────────────────────────

type Respuesta = { status: number; body: string; json?: any }
let transporte = async (url: string, init: RequestInit): Promise<Respuesta> => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) })
  const body = await res.text()
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    json = undefined
  }
  return { status: res.status, body, json }
}
let dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function _probar(t: typeof transporte, d: typeof dormir = async () => {}) {
  transporte = t
  dormir = d
}

/** Limitador de la key: 50 pedidos por minuto. */
const ventana: number[] = []
async function turno() {
  for (;;) {
    const ahora = Date.now()
    while (ventana.length && ventana[0] < ahora - 60_000) ventana.shift()
    if (ventana.length < 50) return void ventana.push(ahora)
    await dormir(ventana[0] + 60_000 - ahora)
  }
}

function base() {
  return (env('NAN_BASE_URL', NAN_BASE_DEFECTO) || NAN_BASE_DEFECTO).replace(/\/+$/, '')
}

function key() {
  const k = env('NAN_API_KEY')
  if (!k) throw new Error('Falta NAN_API_KEY en .env')
  return k
}

async function pedir(metodo: 'GET' | 'POST', ruta: string, body?: unknown): Promise<Respuesta> {
  await turno()
  return transporte(`${base()}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// ─── política ───────────────────────────────────────────────────────────

function truncada(r: Respuesta): boolean {
  if (/nan_truncation/i.test(r.body)) return true
  // Cortado por largo es truncado aunque NaN no lo marque: sin texto (se fue en razonamiento) o con el JSON a medias.
  return r.json?.choices?.[0]?.finish_reason === 'length'
}

type Decision = { accion: 'reintentar'; esperaMs: number; razonarPoco?: boolean } | { accion: 'siguiente' } | { accion: 'cortar'; motivo: string }

export function decidir(r: Respuesta, modelo: string, n: { server: number; rate: number; trunc: number }): Decision {
  if (truncada(r)) {
    return n.trunc < 1 && OBEDECEN_ESFUERZO.has(modelo) ? { accion: 'reintentar', esperaMs: 0, razonarPoco: true } : { accion: 'siguiente' }
  }
  if (r.status === 400 && /json_schema|response_format/i.test(r.body)) return { accion: 'siguiente' }
  if (r.status === 401) return { accion: 'cortar', motivo: 'NaN 401: revisá NAN_API_KEY' }
  if (r.status === 402) return { accion: 'siguiente' }
  if (r.status === 429) return n.rate >= 4 ? { accion: 'siguiente' } : { accion: 'reintentar', esperaMs: Math.min(30_000, 400 * 2 ** n.rate) }
  if (r.status >= 500) return n.server >= 2 ? { accion: 'siguiente' } : { accion: 'reintentar', esperaMs: Math.min(30_000, 400 * 2 ** n.server) }
  if (r.status === 400) return { accion: 'cortar', motivo: `NaN 400: ${r.body.slice(0, 200)}` }
  return { accion: 'siguiente' }
}

export function cuerpoChat(modelo: string, o: { mensajes: Record<string, unknown>[]; temperatura: number; maxTokens: number; json: boolean; razonarPoco?: boolean; herramientas?: unknown[] }) {
  const mensajes = [...o.mensajes]
  if (o.json && modelo === M.deepseek && !/\bJSON\b/.test(JSON.stringify(mensajes))) {
    mensajes.push({ role: 'system', content: 'Respond with JSON only.' })
  }
  const body: Record<string, unknown> = {
    model: modelo,
    messages: mensajes,
    temperature: o.temperatura,
    max_tokens: modelo === M.deepseek ? Math.max(o.maxTokens, 16384) : o.maxTokens + (piensa(modelo) ? PRESUPUESTO_RAZONAMIENTO : 0),
  }
  if (o.json) body.response_format = { type: 'json_object' }
  if (o.razonarPoco) body.reasoning_effort = 'low'
  if (o.herramientas?.length) (body.tools = o.herramientas), (body.tool_choice = 'auto')
  return body
}

type Llamada = { db: Db; clase: ClaseId | 'mastropiero'; agenteId: string }

function anotar(l: Llamada, modelo: string, r: Respuesta, ms: number) {
  const u = r.json?.usage
  l.db.prepare(
    `INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(modelo, l.clase, l.agenteId, u?.prompt_tokens ?? u?.total_tokens ?? null, u?.completion_tokens ?? null, ms, r.status, Date.now())
}

async function recorrer(l: Llamada, modelos: string[], llamar: (modelo: string, razonarPoco: boolean) => Promise<Respuesta>) {
  if (!modelos.length) throw new Error(`La clase ${l.clase} no tiene cadena NaN`)
  for (const modelo of modelos) {
    const n = { server: 0, rate: 0, trunc: 0 }
    let razonarPoco = false
    for (;;) {
      const t0 = Date.now()
      const r = await llamar(modelo, razonarPoco)
      anotar(l, modelo, r, Date.now() - t0)
      if (r.status >= 200 && r.status < 300 && !truncada(r)) return { modelo, r }
      const d = decidir(r, modelo, n)
      if (d.accion === 'cortar') throw new Error(d.motivo)
      if (d.accion === 'siguiente') break
      if (d.razonarPoco) (n.trunc++, (razonarPoco = true))
      else if (r.status === 429) n.rate++
      else n.server++
      if (d.esperaMs) await dormir(d.esperaMs)
    }
  }
  throw new Error(`Cadena NaN agotada (${modelos.join(' → ')})`)
}

export async function nanChat(
  l: Llamada,
  o: { mensajes: { role: string; content: string }[]; temperatura: number; maxTokens: number; json: boolean },
): Promise<{ texto: string; modelo: string }> {
  const { modelo, r } = await recorrer(l, cadena(l.clase), (m, razonarPoco) => pedir('POST', '/chat/completions', cuerpoChat(m, { ...o, razonarPoco })))
  const contenido = r.json?.choices?.[0]?.message?.content
  return { texto: typeof contenido === 'string' ? contenido.trim() : '', modelo }
}

export type LlamadaHerramienta = { id: string; nombre: string; argumentos: string }

/** Chat con herramientas (tool calling estilo OpenAI). Devuelve texto y/o pedidos de herramienta. */
export async function nanChatHerramientas(
  l: Llamada,
  o: { mensajes: Record<string, unknown>[]; herramientas: unknown[]; temperatura: number; maxTokens: number },
): Promise<{ texto: string; llamadas: LlamadaHerramienta[]; razonamiento: string | null; modelo: string; tokens: number }> {
  const { modelo, r } = await recorrer(l, cadena(l.clase), (m, razonarPoco) =>
    pedir('POST', '/chat/completions', cuerpoChat(m, { ...o, json: false, razonarPoco })))
  const msg = r.json?.choices?.[0]?.message ?? {}
  return {
    texto: typeof msg.content === 'string' ? msg.content.trim() : '',
    llamadas: (msg.tool_calls ?? []).map((c: any, i: number) => ({ id: c.id || `llamada-${i}`, nombre: c.function?.name ?? '', argumentos: c.function?.arguments ?? '{}' })),
    razonamiento: typeof msg.reasoning_content === 'string' ? msg.reasoning_content : null,
    modelo,
    tokens: (r.json?.usage?.prompt_tokens ?? 0) + (r.json?.usage?.completion_tokens ?? 0),
  }
}

/** Acumulador de un stream SSE de chat: junta texto, razonamiento y pedidos de herramienta (que llegan en pedazos). */
export function acumuladorSSE() {
  const estado = { texto: '', razonamiento: '', fin: '', tokens: 0, llamadas: [] as { id: string; nombre: string; argumentos: string }[] }
  let resto = ''
  return {
    estado,
    /** Procesa un pedazo crudo del stream; devuelve true si sumó texto visible. */
    empujar(pedazo: string): boolean {
      resto += pedazo
      const lineas = resto.split('\n')
      resto = lineas.pop() ?? ''
      let sumo = false
      for (const l of lineas) {
        if (!l.startsWith('data: ') || l === 'data: [DONE]') continue
        let j: any
        try {
          j = JSON.parse(l.slice(6))
        } catch {
          continue
        }
        const c = j.choices?.[0]
        const d = c?.delta ?? {}
        if (typeof d.content === 'string' && d.content) (estado.texto += d.content), (sumo = true)
        if (typeof d.reasoning_content === 'string') estado.razonamiento += d.reasoning_content
        for (const tc of d.tool_calls ?? []) {
          const i = tc.index ?? estado.llamadas.length
          estado.llamadas[i] ??= { id: '', nombre: '', argumentos: '' }
          if (tc.id) estado.llamadas[i].id = tc.id
          if (tc.function?.name) estado.llamadas[i].nombre += tc.function.name
          if (tc.function?.arguments) estado.llamadas[i].argumentos += tc.function.arguments
        }
        if (c?.finish_reason) estado.fin = c.finish_reason
        if (j.usage) estado.tokens = (j.usage.prompt_tokens ?? 0) + (j.usage.completion_tokens ?? 0)
      }
      return sumo
    },
  }
}

/**
 * Igual que nanChatHerramientas pero en streaming: `alTexto` recibe el texto parcial a medida que llega.
 * Solo prueba el primer modelo de la cadena; ante cualquier problema (status, corte, red) cae al camino sin streaming,
 * que tiene toda la política de reintentos.
 */
export async function nanChatHerramientasStream(
  l: Llamada,
  o: { mensajes: Record<string, unknown>[]; herramientas: unknown[]; temperatura: number; maxTokens: number },
  alTexto: (parcial: string) => void,
): ReturnType<typeof nanChatHerramientas> {
  const modelo = cadena(l.clase)[0]
  const t0 = Date.now()
  try {
    await turno()
    const cuerpo = { ...cuerpoChat(modelo, { ...o, json: false }), stream: true, stream_options: { include_usage: true } }
    const res = await fetch(`${base()}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(180_000),
    })
    if (res.status !== 200 || !res.body) throw new Error(`stream ${res.status}`)
    const acc = acumuladorSSE()
    const lector = res.body.getReader()
    const dec = new TextDecoder()
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      if (acc.empujar(dec.decode(value, { stream: true }))) alTexto(acc.estado.texto)
    }
    const e = acc.estado
    l.db.prepare(
      `INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', ?, ?, ?, ?, NULL, ?, 200, ?)`,
    ).run(modelo, l.clase, l.agenteId, e.tokens || null, Date.now() - t0, Date.now())
    if (e.fin === 'length' || (!e.texto.trim() && !e.llamadas.length)) throw new Error('stream cortado')
    return {
      texto: e.texto.trim(),
      llamadas: e.llamadas.filter((x) => x.nombre).map((x, i) => ({ id: x.id || `llamada-${i}`, nombre: x.nombre, argumentos: x.argumentos || '{}' })),
      razonamiento: e.razonamiento || null,
      modelo,
      tokens: e.tokens,
    }
  } catch {
    alTexto('')
    return nanChatHerramientas(l, o)
  }
}

/** Audio → texto con el Whisper de NaN (en castellano). Un 5xx se reintenta una vez. */
export async function nanTranscribir(db: Db, audio: Buffer, nombre: string): Promise<string> {
  const tipo = /\.(mp3)$/i.test(nombre) ? 'audio/mpeg' : /\.(wav)$/i.test(nombre) ? 'audio/wav' : /\.(ogg|opus)$/i.test(nombre) ? 'audio/ogg' : /\.webm$/i.test(nombre) ? 'audio/webm' : 'audio/mp4'
  for (let intento = 0; intento < 2; intento++) {
    await turno()
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type: tipo }), nombre)
    form.append('model', 'whisper')
    form.append('language', 'es')
    const t0 = Date.now()
    const res = await fetch(`${base()}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key()}` }, body: form, signal: AbortSignal.timeout(300_000) })
    const cuerpo = await res.text()
    db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'whisper', 'diario', 'mastropiero', NULL, NULL, ?, ?, ?)`)
      .run(Date.now() - t0, res.status, Date.now())
    if (res.ok) {
      let texto = cuerpo
      try {
        texto = JSON.parse(cuerpo).text ?? cuerpo
      } catch { /* algunas respuestas vienen en texto plano */ }
      return String(texto).trim()
    }
    if (res.status < 500 || intento === 1) throw new Error(`Whisper ${res.status}: ${cuerpo.slice(0, 160)}`)
  }
  throw new Error('Whisper no respondió')
}

export function nanConfigurado(): boolean {
  return !!env('NAN_API_KEY')
}

export async function nanEmbed(l: Llamada, texto: string): Promise<{ embedding: number[]; modelo: string }> {
  const { modelo, r } = await recorrer(l, cadena('vectorizador'), (m) => pedir('POST', '/embeddings', { model: m, input: texto }))
  return { embedding: r.json?.data?.[0]?.embedding ?? [], modelo }
}

export async function nanModelos(): Promise<string[]> {
  const r = await pedir('GET', '/models')
  if (r.status !== 200) throw new Error(`NaN /models ${r.status}: ${r.body.slice(0, 200)}`)
  return (r.json?.data ?? []).map((m: { id: string }) => m.id).sort()
}

/** Tokens del mes en curso por modelo, contra el cupo. Cuenta solo lo que pasó por esta liga. */
/** Tokens gastados hoy: los de la liga (agentes) y los de Mastropiero (lo que pide el operador). */
export function tokensHoy(db: Db, ahora = Date.now()): { liga: number; mastropiero: number; total: number } {
  const d = new Date(ahora)
  const desde = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const filas = db.prepare(
    `SELECT clase = 'mastropiero' AS suyo, COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0) AS t FROM llamadas WHERE en >= ? GROUP BY 1`,
  ).all(desde) as { suyo: number; t: number }[]
  const liga = filas.find((f) => !f.suyo)?.t ?? 0
  const mastropiero = filas.find((f) => f.suyo)?.t ?? 0
  return { liga, mastropiero, total: liga + mastropiero }
}

/** El tope diario de la liga (ajuste `tokens_dia_max`; 0 = sin tope). Lo que el operador pide a Mastropiero no se frena. */
export function topeDiario(db: Db): number {
  const v = (db.prepare(`SELECT valor FROM ajustes WHERE clave = 'tokens_dia_max'`).get() as { valor: string } | undefined)?.valor
  return Math.max(0, Number(v ?? 0) || 0)
}

/** Si la liga ya gastó su tope de hoy, el motivo; si no, null. */
export function topeAlcanzado(db: Db, ahora = Date.now()): string | null {
  const tope = topeDiario(db)
  if (!tope) return null
  const { liga } = tokensHoy(db, ahora)
  return liga >= tope ? `gastó ${liga.toLocaleString('es-AR')} tokens hoy, el tope es ${tope.toLocaleString('es-AR')}` : null
}

export function usoDelMes(db: Db, ahora = Date.now()) {
  const d = new Date(ahora)
  const desde = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const filas = db
    .prepare(
      `SELECT modelo, COUNT(*) AS llamadas, COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0) AS tokens,
              SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 0 ELSE 1 END) AS errores
       FROM llamadas WHERE motor = 'nan' AND en >= ? GROUP BY modelo ORDER BY tokens DESC`,
    )
    .all(desde) as { modelo: string; llamadas: number; tokens: number; errores: number }[]
  return filas.map((f) => ({ ...f, cupo: cupoDe(f.modelo) }))
}
