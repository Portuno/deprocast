/**
 * NaN como motor de la liga. Misma política que la 0.7.1 (nanPolicy.ts / nan.md):
 * cadenas de modelos, 402 → siguiente, 429 espera, 401 corta, 5xx reintenta dos veces,
 * DeepSeek con max_tokens ≥ 16384 y la palabra JSON, se lee `message.content` y nunca `reasoning_content`.
 * La API key no se loguea.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ClaseId } from './clases.ts'
import type { Db } from './db.ts'

/**
 * Lo que corre solo (las rutinas, la Fragua de noche) marca sus llamadas: cuentan para el tope diario igual que la
 * liga. Lo que él pide en el momento no se marca y no se frena.
 */
const deFondo = new AsyncLocalStorage<true>()
export const enFondo = <T>(f: () => Promise<T>): Promise<T> => deFondo.run(true, f)
const fondo = () => (deFondo.getStore() ? 1 : 0)

export const NAN_BASE_DEFECTO = 'https://api.nan.builders/v1'

export const M = {
  deepseek: 'deepseek-v4-flash', //  1M ctx · visión · herramientas probadas: el del chat
  mimo: 'mimo-v2.6-flash', //        1M ctx · el más barato y casi no gasta razonando: lo de fondo
  pro: 'deepseek-v4-pro', //         el razonador: lo poco y que importa (autocrítica, Fragua, runs)
  glm: 'glm5.3-flash', //            razona; entrada barata pero sin caché y lento (8 s con herramientas)
  qwen: 'qwen3.8-flash', //          visión; razona mucho (~300 tokens por respuesta corta)
  embed: 'qwen3-embedding',
} as const

/**
 * Lo que cuesta cada modelo en créditos de NaN por millón de tokens (nov 2026): la entrada, la entrada que ya estaba en
 * caché (mucho más barata: reusar el mismo comienzo del prompt estira los créditos) y la salida (el razonamiento cuenta
 * como salida). Medido el 10/11: MiMo y DeepSeek Flash cachean el prefijo repetido; GLM, Hy4 y DeepSeek Pro no.
 */
export const PRECIOS: Record<string, { entrada: number; cache: number; salida: number }> = {
  [M.deepseek]: { entrada: 10.5, cache: 0.21, salida: 42 },
  [M.mimo]: { entrada: 7, cache: 0.14, salida: 14 },
  [M.pro]: { entrada: 66, cache: 2.2, salida: 198 },
  [M.glm]: { entrada: 5.25, cache: 9.1, salida: 17.5 },
  [M.qwen]: { entrada: 7.5, cache: 0.8, salida: 23.5 },
  'hy4': { entrada: 41.7, cache: 2.1, salida: 125.05 },
  'glm5.3': { entrada: 49, cache: 9.1, salida: 154 },
  'kimi-k3.1-pro': { entrada: 100, cache: 10, salida: 500 },
  'qwen3.8-max': { entrada: 100, cache: 12.5, salida: 300 },
}
/** Los créditos de una llamada. */
export function creditosDe(modelo: string, entrada: number, cacheados: number, salida: number): number | null {
  const p = PRECIOS[modelo]
  if (!p) return null
  const c = Math.min(cacheados, entrada)
  return ((entrada - c) * p.entrada + c * p.cache + salida * p.salida) / 1_000_000
}

/**
 * Ruteo (nov 2026, con los créditos de NaN y medido el 10/11). Criterio:
 * - Lo que él ve y le habla (el chat, Telegram, el Directo, la mañana) va a DeepSeek Flash: herramientas probadas,
 *   2–4 s, y cachea el prompt largo del chat (el turno siguiente paga 0,21 en vez de 10,5 por millón).
 * - Lo de fondo (destilar, el escriba, el reproceso, el takeout, YouTube, el Taller…) va a MiMo: la mitad de entrada,
 *   un tercio de salida, cachea igual y casi no razona. DeepSeek Flash detrás.
 * - Lo poco y que importa (la autocrítica, La Fragua, las primarias y las runs, las lecciones, el informe) va a
 *   DeepSeek Pro, el razonador barato de los grandes; Flash detrás.
 * - Lo que juzga (gerente, auditor) pasa de GLM a DeepSeek Flash: GLM tardaba 8 s con herramientas y no cachea.
 * - Ejecutivo y crawler no usan modelo; el vectorizador, sus embeddings.
 * Se pisa con NAN_CADENA_<CLASE>=modelo1,modelo2 (también NAN_CADENA_MASTROPIERO, _FONDO y _PROFUNDO).
 */
const CADENAS: Record<ClaseId | 'mastropiero' | 'fondo' | 'profundo' | 'codigo', string[]> = {
  mastropiero: [M.deepseek, M.mimo, M.qwen],
  fondo: [M.mimo, M.deepseek],
  profundo: [M.pro, M.deepseek],
  // El código (la Fragua), a DeepSeek Flash: en el banco de pruebas (nov 2026) Pro se cortó por largo tres veces seguidas
  // (2 cr. cada una, sin entregar nada) y Flash pasó los 10 casos por 0,3; MiMo, que también los pasó, de respaldo.
  codigo: [M.deepseek, M.mimo],
  // Redacción y clasificación, a DeepSeek Flash (banco de pruebas, nov 2026): MiMo se salteaba reglas de desempate (90 %)
  // y escribía sin voseo ni lo pedido (75 %); Flash, 100 % en las dos. Cuesta unas cinco veces más por pedido.
  generativo: [M.deepseek, M.mimo],
  gerente: [M.deepseek, M.glm],
  auditor: [M.deepseek, M.glm],
  extractor: [M.mimo, M.deepseek],
  buscador: [M.mimo, M.deepseek],
  clasificador: [M.deepseek, M.mimo],
  crawler: [],
  vectorizador: [M.embed],
  ejecutivo: [],
}
/** Lo que él ve en el momento: calidad y velocidad primero (la cadena de Mastropiero). */
const INTERACTIVOS = new Set(['mastropiero', 'chat', 'telegram', 'directo', 'matinal', 'brujula', 'mapamundi', 'academia', 'pensar', 'captura', 'correcciones'])
/** Lo poco y que importa: el razonador. */
/** Los que escriben código. */
const CODIGO = new Set(['fragua'])
const PROFUNDOS = new Set(['autocritica', 'primarias', 'run', 'run-pedido', 'lecciones', 'reporte', 'evolucion', 'procesos'])
/**
 * La cadena de una llamada: la que trae (un turno breve elige la suya), la de su uso (profundo, interactivo o de
 * fondo) para lo que corre como Mastropiero, o la de su clase (los agentes de la liga).
 */
export function cadenaPara(l: { clase: ClaseId | 'mastropiero'; agenteId?: string | null; modelos?: string[] }): string[] {
  if (l.modelos?.length) return l.modelos
  if (l.clase === 'mastropiero' && l.agenteId) {
    if (CODIGO.has(l.agenteId)) return cadena('codigo')
    if (PROFUNDOS.has(l.agenteId)) return cadena('profundo')
    if (!INTERACTIVOS.has(l.agenteId)) return cadena('fondo')
  }
  return cadena(l.clase)
}

/** Modelos que obedecen reasoning_effort (igual que la 0.7.1). */
const OBEDECEN_ESFUERZO = new Set<string>([M.glm, 'gemma4', 'qwen3.6'])
/** Presupuesto extra para modelos que piensan antes de escribir: sin esto gastan todo en razonar y devuelven content vacío. Solo se paga lo que usan. */
export const PRESUPUESTO_RAZONAMIENTO = 4096
function piensa(modelo: string) {
  return modelo === M.glm || modelo === M.mimo || modelo === M.qwen || modelo === M.pro || modelo === 'hy4' || (modelo !== '' && modelo === env('NAN_MIMO_ID'))
}

function env(nombre: string, def = ''): string {
  return (process.env[nombre] ?? def).replace(/^["']|["']$/g, '').trim()
}

export function assertPermitido(id: string) {
  if (id === 'glm5.3' || id === 'glm5.2' || id.endsWith('-fallback')) throw new Error(`modelo NaN prohibido: ${id}`)
}

/** NAN_MIMO_ID (de antes, cuando MiMo no estaba en el catálogo) se suma al final si no está ya. */
export function cadena(clase: ClaseId | 'mastropiero' | 'fondo' | 'profundo' | 'codigo'): string[] {
  const propia = env(`NAN_CADENA_${clase.toUpperCase()}`)
  const base = propia ? propia.split(',').map((s) => s.trim()).filter(Boolean) : [...(CADENAS[clase] ?? CADENAS.mastropiero)]
  const mimo = env('NAN_MIMO_ID')
  if (mimo && !propia && clase !== 'vectorizador' && base.length && !base.includes(mimo)) base.push(mimo)
  for (const id of base) assertPermitido(id)
  return base
}

/** Los cupos mensuales de tokens ya no existen (NaN cobra créditos por token): queda por compatibilidad. */
export function cupoDe(_modelo: string): number | null {
  return null
}

// ─── transporte (inyectable para tests) ─────────────────────────────────

type Respuesta = { status: number; body: string; json?: any }
/** Un corte de red (sin conexión, DNS, reset) no es un error del modelo: vuelve como 599 y se reintenta con espera. */
export const SIN_RED = 599
/**
 * Cuánto se espera una respuesta del modelo (plan v38, fase 1; Fragua #105 y #124): lo que pide él, 3 minutos; lo que
 * corre de fondo (misiones, reproceso, rutinas), 5. NAN_TIEMPO_MS y NAN_TIEMPO_FONDO_MS para cambiarlo.
 */
export const tiempoDeEspera = () => Math.max(5_000, Number(fondo() ? env('NAN_TIEMPO_FONDO_MS', '300000') : env('NAN_TIEMPO_MS', '180000')) || 180_000)
export const transporteReal = async (url: string, init: RequestInit): Promise<Respuesta> => {
  let res: Response
  let body: string
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(tiempoDeEspera()) })
    // El cuerpo también, adentro: NaN a veces manda los encabezados y tarda en mandar la respuesta; si el tiempo se
    // agota leyéndola, es un 504 (se pasa al siguiente modelo), no un error crudo que mata la misión o la rutina.
    body = await res.text()
  } catch (e) {
    const causa = e instanceof Error ? `${e.message}${(e as any).cause?.code ? ` (${(e as any).cause.code})` : ''}` : String(e)
    if (e instanceof Error && e.name === 'TimeoutError') return { status: 504, body: `tiempo agotado: ${causa}`, json: undefined }
    return { status: SIN_RED, body: `sin conexión: ${causa}`, json: undefined }
  }
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    json = undefined
  }
  return { status: res.status, body, json }
}
let transporte = transporteReal
let dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Cuántos pedidos van a NaN a la vez. La key admite 7 en paralelo (max_parallel_requests): con todos los carriles, el
 * chat y Whisper juntos se pasaba y NaN cortaba con 429. Tope 6 (NAN_PARALELO para cambiarlo); el resto hace fila.
 */
let enVuelo = 0
const fila: (() => void)[] = []
const topeParalelo = () => Math.max(1, Math.floor(Number(env('NAN_PARALELO', '6'))) || 6)
async function tomarLugar() {
  while (enVuelo >= topeParalelo()) await new Promise<void>((ok) => fila.push(ok))
  enVuelo++
}
function soltarLugar() {
  enVuelo--
  fila.shift()?.()
}
/** Para los tests: cuántos hay en vuelo ahora. */
export const _enVuelo = () => enVuelo

export function _probar(t: typeof transporte, d: typeof dormir = async () => {}) {
  transporte = t
  dormir = d
}

/**
 * Tope duro (plan v33, paso 5): en el Deprocast de un usuario, todo pedido al modelo pasa por acá, también lo que pide
 * él (el tope de siempre solo frena lo que corre solo). Si devuelve un motivo, el pedido no sale.
 */
let topeDuro: () => string | null = () => null
export function fijarTopeDuro(f: () => string | null) { topeDuro = f }
function chequearTopeDuro() {
  const m = topeDuro()
  if (m) throw new Error(m)
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
  chequearTopeDuro()
  await turno()
  await tomarLugar()
  try {
    return await transporte(`${base()}${ruta}`, {
      method: metodo,
      headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } finally {
    soltarLugar()
  }
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
  // Sin red: el siguiente modelo tampoco llegaría; mejor esperar un poco (2, 5 y 10 s) y volver a probar.
  if (r.status === SIN_RED) return n.server >= 3 ? { accion: 'cortar', motivo: `Sin conexión con NaN (${r.body.replace(/^sin conexión: /, '')}). Revisá internet y probá de nuevo.` } : { accion: 'reintentar', esperaMs: [2000, 5000, 10_000][n.server] }
  // Un modelo que se quedó sin contestar el tiempo entero no va a contestar más rápido la segunda vez: al siguiente.
  if (r.status === 504 && /^tiempo agotado/.test(r.body)) return { accion: 'siguiente' }
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

/** modelos: una cadena propia para esta llamada (un turno breve del chat va primero al modelo rápido). */
type Llamada = { db: Db; clase: ClaseId | 'mastropiero'; agenteId: string; modelos?: string[] }
export type { Llamada }

function anotar(l: Llamada, modelo: string, r: Respuesta, ms: number) {
  const u = r.json?.usage
  const entrada = u?.prompt_tokens ?? u?.total_tokens ?? null
  const cache = u?.prompt_tokens_details?.cached_tokens ?? u?.prompt_cache_hit_tokens ?? null
  const salida = u?.completion_tokens ?? null
  l.db.prepare(
    `INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en, fondo, tokens_cache, creditos) VALUES ('nan', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(modelo, l.clase, l.agenteId, entrada, salida, ms, r.status, Date.now(), fondo(), cache, entrada != null ? creditosDe(modelo, entrada, cache ?? 0, salida ?? 0) : null)
}

async function recorrer(l: Llamada, modelos: string[], llamar: (modelo: string, razonarPoco: boolean) => Promise<Respuesta>) {
  if (!modelos.length) throw new Error(`La clase ${l.clase} no tiene cadena NaN`)
  const motivos: string[] = []
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
      if (d.accion === 'siguiente') {
        motivos.push(`${modelo}: ${motivoDe(r)}`)
        void import('./fallos.ts').then((f) => f.registrarFallo(l.db, { origen: 'modelo', mensaje: `${modelo}: ${motivoDe(r)}`, donde: modelo, salida: r.body.slice(0, 300), recuperado: true }, Date.now())).catch(() => {})
        break
      }
      if (d.razonarPoco) (n.trunc++, (razonarPoco = true))
      else if (r.status === 429) n.rate++
      else n.server++
      if (d.esperaMs) await dormir(d.esperaMs)
    }
  }
  throw new Error(`Ningún modelo pudo contestar. ${motivos.join(' · ')}`)
}

/** Por qué no sirvió una respuesta, en palabras: lo que va al error cuando se prueban todos. */
export function motivoDe(r: Respuesta): string {
  if (truncada(r)) return 'se cortó por largo'
  const dicho = String(r.json?.error?.message ?? r.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const que = r.status === 402 ? 'sin saldo' : r.status === 429 ? 'demasiados pedidos' : r.status === SIN_RED ? 'sin conexión' : r.status >= 500 ? 'el servidor falló' : r.status === 400 ? 'pedido rechazado' : `respondió ${r.status}`
  return `${que} (${r.status}${dicho ? `: ${dicho}` : ''})`
}

export async function nanChat(
  l: Llamada,
  o: { mensajes: { role: string; content: string }[]; temperatura: number; maxTokens: number; json: boolean },
): Promise<{ texto: string; modelo: string }> {
  const { modelo, r } = await recorrer(l, cadenaPara(l), (m, razonarPoco) => pedir('POST', '/chat/completions', cuerpoChat(m, { ...o, razonarPoco })))
  const contenido = r.json?.choices?.[0]?.message?.content
  return { texto: typeof contenido === 'string' ? contenido.trim() : '', modelo }
}

export type LlamadaHerramienta = { id: string; nombre: string; argumentos: string }

/** Chat con herramientas (tool calling estilo OpenAI). Devuelve texto y/o pedidos de herramienta. */
export async function nanChatHerramientas(
  l: Llamada,
  o: { mensajes: Record<string, unknown>[]; herramientas: unknown[]; temperatura: number; maxTokens: number; razonarPoco?: boolean; json?: boolean },
): Promise<{ texto: string; llamadas: LlamadaHerramienta[]; razonamiento: string | null; modelo: string; tokens: number }> {
  const { modelo, r } = await recorrer(l, cadenaPara(l), (m, razonarPoco) =>
    pedir('POST', '/chat/completions', cuerpoChat(m, { ...o, json: !!o.json && !o.herramientas.length, razonarPoco: o.razonarPoco || razonarPoco })))
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
  o: { mensajes: Record<string, unknown>[]; herramientas: unknown[]; temperatura: number; maxTokens: number; razonarPoco?: boolean; json?: boolean },
  alTexto: (parcial: string) => void,
): ReturnType<typeof nanChatHerramientas> {
  const modelo = (cadenaPara(l))[0]
  const t0 = Date.now()
  // Se corta por silencio (90 s sin un byte), no por duración: una respuesta larga (un juego de 20K tokens) que
  // sigue llegando no se corta. Tope total de 15 minutos.
  const control = new AbortController()
  let silencio: ReturnType<typeof setTimeout> | undefined
  const vigilar = () => { clearTimeout(silencio); silencio = setTimeout(() => control.abort(new Error('stream en silencio')), 90_000) }
  const tope = setTimeout(() => control.abort(new Error('stream demasiado largo')), 15 * 60_000)
  let conLugar = false
  try {
    await turno()
    await tomarLugar()
    conLugar = true
    const cuerpo = { ...cuerpoChat(modelo, { ...o, json: !!o.json && !o.herramientas.length }), stream: true, stream_options: { include_usage: true } }
    vigilar()
    const res = await fetch(`${base()}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: control.signal,
    })
    if (res.status !== 200 || !res.body) throw new Error(`stream ${res.status}`)
    const acc = acumuladorSSE()
    const lector = res.body.getReader()
    const dec = new TextDecoder()
    for (;;) {
      const { done, value } = await lector.read()
      vigilar()
      if (done) break
      if (acc.empujar(dec.decode(value, { stream: true }))) alTexto(acc.estado.texto)
    }
    const e = acc.estado
    l.db.prepare(
      `INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en, fondo) VALUES ('nan', ?, ?, ?, ?, NULL, ?, 200, ?, ?)`,
    ).run(modelo, l.clase, l.agenteId, e.tokens || null, Date.now() - t0, Date.now(), fondo())
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
  } finally {
    if (conLugar) soltarLugar()
    clearTimeout(silencio)
    clearTimeout(tope)
  }
}

/** Audio → texto con el Whisper de NaN (en castellano). Un 5xx se reintenta una vez. */
export async function nanTranscribir(db: Db, audio: Buffer, nombre: string, idioma = 'es'): Promise<string> {
  return (await nanTranscribirDetallado(db, audio, nombre, { palabras: false, idioma })).texto
}

/** Whisper con el tiempo de cada palabra (para saber quién habló cuándo). Sin palabras si el servicio no las da. 429 y 5xx esperan y reintentan (hasta 3 veces). */
export async function nanTranscribirDetallado(db: Db, audio: Buffer, nombre: string, o: { palabras?: boolean; idioma?: string } = {}): Promise<{ texto: string; palabras: { start: number; end: number; word: string }[] }> {
  const tipo = /\.(mp3)$/i.test(nombre) ? 'audio/mpeg' : /\.(wav)$/i.test(nombre) ? 'audio/wav' : /\.(ogg|opus)$/i.test(nombre) ? 'audio/ogg' : /\.webm$/i.test(nombre) ? 'audio/webm' : 'audio/mp4'
  const ESPERAS = [2000, 5000, 10_000]
  for (let intento = 0; intento <= ESPERAS.length; intento++) {
    await turno()
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type: tipo }), nombre)
    form.append('model', 'whisper')
    if (o.idioma !== 'auto') form.append('language', o.idioma || 'es') // 'auto': que Whisper detecte (un video en valenciano, en inglés…)
    if (o.palabras !== false) {
      form.append('response_format', 'verbose_json')
      form.append('timestamp_granularities[]', 'word')
    }
    const t0 = Date.now()
    let res: Response
    let cuerpo: string
    chequearTopeDuro()
    await tomarLugar()
    try {
      res = await fetch(`${base()}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key()}` }, body: form, signal: AbortSignal.timeout(300_000) })
      cuerpo = await res.text()
    } catch (e) {
      if (intento === ESPERAS.length) throw new Error(`Sin conexión con Whisper: ${e instanceof Error ? e.message : e}`)
      await dormir(ESPERAS[intento])
      continue
    } finally {
      soltarLugar()
    }
    db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'whisper', 'diario', 'mastropiero', NULL, NULL, ?, ?, ?)`)
      .run(Date.now() - t0, res.status, Date.now())
    if (res.ok) {
      let texto = cuerpo
      let palabras: { start: number; end: number; word: string }[] = []
      try {
        const j = JSON.parse(cuerpo)
        texto = j.text ?? cuerpo
        if (Array.isArray(j.words)) palabras = j.words.filter((w: any) => Number.isFinite(w?.start) && Number.isFinite(w?.end) && typeof w?.word === 'string')
      } catch { /* algunas respuestas vienen en texto plano */ }
      return { texto: String(texto).trim(), palabras }
    }
    if ((res.status !== 429 && res.status < 500) || intento === ESPERAS.length) throw new Error(`Whisper ${res.status}: ${cuerpo.slice(0, 160)}`)
    const dice = Number(res.headers.get('retry-after'))
    await dormir(Number.isFinite(dice) && dice > 0 ? Math.min(60_000, dice * 1000) : ESPERAS[intento])
  }
  throw new Error('Whisper no respondió')
}

/** Ver una imagen: la cadena de los que tienen visión (DeepSeek primero: el más rápido; Qwen de respaldo). */
export async function nanVision(
  l: { db: Db; clase: ClaseId | 'mastropiero'; agenteId: string },
  o: { sistema: string; texto: string; imagen: string; maxTokens?: number },
): Promise<{ texto: string; modelo: string; tokens: number }> {
  const { modelo, r } = await recorrer(l, [M.deepseek, M.qwen], (m) => pedir('POST', '/chat/completions', {
    model: m, temperature: 0.2, max_tokens: m === M.deepseek ? Math.max(o.maxTokens ?? 800, 4096) : (o.maxTokens ?? 800) + PRESUPUESTO_RAZONAMIENTO,
    messages: [
      { role: 'system', content: o.sistema },
      { role: 'user', content: [{ type: 'text', text: o.texto }, { type: 'image_url', image_url: { url: o.imagen } }] },
    ],
  }))
  const c = r.json?.choices?.[0]?.message?.content
  return { texto: typeof c === 'string' ? c.trim() : '', modelo, tokens: (r.json?.usage?.prompt_tokens ?? 0) + (r.json?.usage?.completion_tokens ?? 0) }
}

export function nanConfigurado(): boolean {
  return !!env('NAN_API_KEY')
}

export async function nanEmbed(l: Llamada, texto: string): Promise<{ embedding: number[]; modelo: string }> {
  const { modelo, r } = await recorrer(l, cadena('vectorizador'), (m) => pedir('POST', '/embeddings', { model: m, input: texto }))
  return { embedding: r.json?.data?.[0]?.embedding ?? [], modelo }
}

/** Varios textos en una llamada (la API acepta una lista). */
export async function nanEmbedLote(l: Llamada, textos: string[]): Promise<{ embeddings: number[][]; modelo: string }> {
  const { modelo, r } = await recorrer(l, cadena('vectorizador'), (m) => pedir('POST', '/embeddings', { model: m, input: textos }))
  const datos = [...(r.json?.data ?? [])].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
  return { embeddings: datos.map((d: any) => d.embedding ?? []), modelo }
}

export async function nanModelos(): Promise<string[]> {
  const r = await pedir('GET', '/models')
  if (r.status !== 200) throw new Error(`NaN /models ${r.status}: ${r.body.slice(0, 200)}`)
  return (r.json?.data ?? []).map((m: { id: string }) => m.id).sort()
}

/** Tokens del mes en curso por modelo, contra el cupo. Cuenta solo lo que pasó por esta liga. */
/**
 * Tokens gastados hoy: los de la liga (agentes), los de Mastropiero (lo que pide el operador y sus rutinas) y, de esos,
 * los de fondo (las rutinas, que corren solas).
 */
export function tokensHoy(db: Db, ahora = Date.now()): { liga: number; mastropiero: number; fondo: number; total: number } {
  const d = new Date(ahora)
  const desde = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const filas = db.prepare(
    // El reproceso tiene su propio presupuesto: no le come el tope a la liga.
    `SELECT clase = 'mastropiero' AS suyo, COALESCE(fondo, 0) AS solo, COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0) AS t FROM llamadas WHERE en >= ? AND agente_id NOT LIKE 'reproceso%' GROUP BY 1, 2`,
  ).all(desde) as { suyo: number; solo: number; t: number }[]
  const suma = (f: (x: { suyo: number; solo: number }) => boolean) => filas.filter(f).reduce((s, x) => s + x.t, 0)
  const liga = suma((x) => !x.suyo)
  const mastropiero = suma((x) => !!x.suyo)
  return { liga, mastropiero, fondo: suma((x) => !!x.suyo && !!x.solo), total: liga + mastropiero }
}

/** El tope diario de lo que corre solo, la liga y las rutinas (ajuste `tokens_dia_max`; 0 = sin tope). Lo que el operador pide a Mastropiero no se frena. */
export function topeDiario(db: Db): number {
  const v = (db.prepare(`SELECT valor FROM ajustes WHERE clave = 'tokens_dia_max'`).get() as { valor: string } | undefined)?.valor
  return Math.max(0, Number(v ?? 0) || 0)
}

/** Si lo que corre solo (liga + rutinas) ya gastó su tope de hoy, el motivo; si no, null. */
export function topeAlcanzado(db: Db, ahora = Date.now()): string | null {
  const tope = topeDiario(db)
  if (!tope) return null
  const { liga, fondo } = tokensHoy(db, ahora)
  const solo = liga + fondo
  return solo >= tope ? `lo que corre solo gastó ${solo.toLocaleString('es-AR')} tokens hoy, el tope es ${tope.toLocaleString('es-AR')}` : null
}

/** Lo que gastó el reproceso hoy (y en total). */
export function tokensReproceso(db: Db, ahora = Date.now()): { hoy: number; total: number } {
  const d = new Date(ahora)
  const desde = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const r = db.prepare(`SELECT COALESCE(SUM(CASE WHEN en >= ? THEN COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0) END), 0) AS hoy, COALESCE(SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)), 0) AS total FROM llamadas WHERE agente_id LIKE 'reproceso%'`).get(desde) as { hoy: number; total: number }
  return { hoy: r.hoy, total: r.total }
}

export function usoDelMes(db: Db, ahora = Date.now()) {
  const d = new Date(ahora)
  const desde = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const filas = db
    .prepare(
      `SELECT modelo, COUNT(*) AS llamadas, COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0) AS tokens,
              SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 0 ELSE 1 END) AS errores
              , COALESCE(SUM(tokens_cache), 0) AS cacheados, ROUND(COALESCE(SUM(creditos), 0), 2) AS creditos
       FROM llamadas WHERE motor = 'nan' AND en >= ? GROUP BY modelo ORDER BY creditos DESC, tokens DESC`,
    )
    .all(desde) as { modelo: string; llamadas: number; tokens: number; errores: number; cacheados: number; creditos: number }[]
  return filas.map((f) => ({ ...f, cupo: cupoDe(f.modelo) }))
}

/** En qué se van los créditos del mes: por uso (el agente o la tarea que llamó), con cuánto salió de la caché. */
export function creditosPorUso(db: Db, ahora = Date.now(), limite = 8, porTokens = false) {
  const d = new Date(ahora)
  const desde = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  return db.prepare(`SELECT COALESCE(agente_id, clase) AS uso, COUNT(*) AS llamadas, ROUND(COALESCE(SUM(creditos), 0), 2) AS creditos,
      COALESCE(SUM(tokens_in), 0) AS entrada, COALESCE(SUM(tokens_cache), 0) AS cacheados
    FROM llamadas WHERE motor = 'nan' AND en >= ? GROUP BY COALESCE(agente_id, clase) ORDER BY ${porTokens ? 'entrada DESC' : 'creditos DESC, entrada DESC'} LIMIT ?`).all(desde, limite) as { uso: string; llamadas: number; creditos: number; entrada: number; cacheados: number }[]
}
