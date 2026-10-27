/**
 * La puerta MCP (plan v29): sus herramientas (Claude Code, Claude Desktop, otras apps suyas) usan Deprocast como cerebro.
 * - POST /mcp, JSON-RPC 2.0 sobre HTTP sin streaming (cada pedido vuelve como un JSON), sin dependencias: initialize,
 *   notifications/initialized, ping, tools/list y tools/call. Acepta lotes.
 * - Entra con el token de una app conectada que tenga el permiso «leer» (Authorization: Bearer dpc_…).
 * - De solo lectura: expone una lista cerrada de herramientas de lectura del chat. Nada que escriba, publique, borre,
 *   mueva plata ni toque salud. Cada llamada queda registrada y hay un tope por minuto.
 */
import type { Db } from './db.ts'
import type { App } from './apps.ts'
import { HERRAMIENTAS, ejecutarHerramienta, type Herramienta } from './chat/herramientas.ts'

/** Lo único que ve un cliente MCP. Todas son de familia «lectura» (un test lo vigila). */
export const HERRAMIENTAS_MCP = [
  'buscar_corpus', 'leer_pieza', 'ver_entidad', 'ver_grafo', 'conectar_conceptos', 'preguntar_al_corpus',
  'ver_observatorio', 'ver_misiones_agentes', 'ver_dia', 'ver_informe',
]
export const VERSIONES = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
export const TOPE_POR_MINUTO = 60

type Pedido = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any }
type Respuesta = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } }

const ventana = new Map<number, number[]>()

export function herramientasMcp(): Herramienta[] {
  return HERRAMIENTAS_MCP.map((n) => HERRAMIENTAS.find((h) => h.nombre === n)).filter((h): h is Herramienta => !!h && h.familia === 'lectura')
}

/** Lo que entra por POST /mcp ya parseado. null = nada que contestar (solo notificaciones): el servidor responde 202. */
export async function atenderMcp(db: Db, cuerpo: unknown, app: App, ahora = Date.now()): Promise<Respuesta | Respuesta[] | null> {
  if (Array.isArray(cuerpo)) {
    if (!cuerpo.length) return error(null, -32600, 'Lote vacío')
    const rs = (await Promise.all(cuerpo.map((p) => uno(db, p, app, ahora)))).filter((r): r is Respuesta => !!r)
    return rs.length ? rs : null
  }
  return uno(db, cuerpo, app, ahora)
}

async function uno(db: Db, p: unknown, app: App, ahora: number): Promise<Respuesta | null> {
  if (!p || typeof p !== 'object') return error(null, -32600, 'Pedido inválido')
  const { id = null, method, params } = p as Pedido
  const notificacion = !('id' in (p as object))
  if (typeof method !== 'string') return error(id, -32600, 'Falta el método')
  if (notificacion) return null
  switch (method) {
    case 'initialize': {
      const pedida = String(params?.protocolVersion ?? '')
      return ok(id, {
        protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'deprocast', title: 'Deprocast', version: '1.0.0' },
        instructions: 'Deprocast de solo lectura: su archivo (corpus), sus personas y su grafo de ideas, el Observatorio, las misiones de sus agentes, su día y sus informes (ver_informe con desde y hasta arma cualquier período). Citá las piezas con [#id].',
      })
    }
    case 'ping': return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: herramientasMcp().map((h) => ({ name: h.nombre, description: h.descripcion, inputSchema: h.parametros, annotations: { readOnlyHint: true, openWorldHint: false } })) })
    case 'tools/call': {
      const nombre = String(params?.name ?? '')
      const h = herramientasMcp().find((x) => x.nombre === nombre)
      if (!h) return error(id, -32602, `No existe la herramienta ${nombre || '(sin nombre)'}`)
      if (!dentroDelTope(app.id, ahora)) return ok(id, texto(`Muchas llamadas: el tope es ${TOPE_POR_MINUTO} por minuto.`, true))
      const t0 = performance.now()
      const r = await ejecutarHerramienta([h], nombre, JSON.stringify(params?.arguments ?? {}), { db, conversacionId: null })
      registrar(db, app.id, nombre, r.ok, performance.now() - t0, ahora)
      return ok(id, texto(typeof r.resultado === 'string' ? r.resultado : JSON.stringify(r.resultado, null, 1), !r.ok))
    }
    default: return error(id, -32601, `Método desconocido: ${method}`)
  }
}

function dentroDelTope(app: number, ahora: number): boolean {
  const ts = (ventana.get(app) ?? []).filter((t) => ahora - t < 60_000)
  if (ts.length >= TOPE_POR_MINUTO) return (ventana.set(app, ts), false)
  ts.push(ahora)
  ventana.set(app, ts)
  return true
}

function registrar(db: Db, app: number, herramienta: string, bien: boolean, ms: number, ahora: number) {
  db.prepare('INSERT INTO mcp_llamadas (app_id, herramienta, ok, ms, en) VALUES (?, ?, ?, ?, ?)').run(app, herramienta, bien ? 1 : 0, Math.round(ms), ahora)
}

/** Las últimas llamadas (para la pantalla de apps conectadas). */
export function llamadasMcp(db: Db, limite = 20): { app: string; herramienta: string; ok: boolean; ms: number; en: number }[] {
  return (db.prepare('SELECT a.nombre AS app, l.herramienta, l.ok, l.ms, l.en FROM mcp_llamadas l JOIN apps_conectadas a ON a.id = l.app_id ORDER BY l.id DESC LIMIT ?').all(limite) as any[])
    .map((r) => ({ app: r.app, herramienta: r.herramienta, ok: !!r.ok, ms: r.ms, en: r.en }))
}

const texto = (t: string, esError = false) => ({ content: [{ type: 'text', text: t }], isError: esError })
const ok = (id: Pedido['id'], result: unknown): Respuesta => ({ jsonrpc: '2.0', id: id ?? null, result })
const error = (id: Pedido['id'], code: number, message: string): Respuesta => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
