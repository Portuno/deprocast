import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
const { abrir } = await import('../src/db.ts')
const apps = await import('../src/apps.ts')
const mcp = await import('../src/mcp.ts')
const { HERRAMIENTAS } = await import('../src/chat/herramientas.ts')
const { insertar } = await import('../src/corpus.ts')

const T = new Date(2026, 10, 2, 9).getTime()

test('La lista cerrada: todas existen y todas son de lectura (nada de acción, destructivo, plata, salud ni publicar)', () => {
  for (const n of mcp.HERRAMIENTAS_MCP) {
    const h = HERRAMIENTAS.find((x) => x.nombre === n)
    assert.ok(h, `${n} existe en el chat`)
    assert.equal(h!.familia, 'lectura', `${n} es de lectura`)
    assert.doesNotMatch(n, /finanz|plata|salud|comida|publica|cuenta|difundir|borrar/)
  }
  assert.equal(mcp.herramientasMcp().length, mcp.HERRAMIENTAS_MCP.length)
})

test('MCP: initialize, tools/list, tools/call, notificaciones, errores, lotes, tope y registro', async () => {
  const db = abrir(':memory:')
  const { app, token } = apps.crearApp(db, 'Claude Code', ['leer'], T)
  assert.equal(apps.autenticarApp(db, `Bearer ${token}`, 'leer').app!.id, app.id)
  const morpheon = apps.crearApp(db, 'Morpheon', ['suenos'], T)
  assert.equal(apps.autenticarApp(db, `Bearer ${morpheon.token}`, 'leer').motivo, 'sin_permiso', 'sin «leer» no entra por MCP')

  const ini: any = await mcp.atenderMcp(db, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }, app, T)
  assert.equal(ini.result.protocolVersion, '2025-06-18')
  assert.equal(ini.result.serverInfo.name, 'deprocast')
  assert.ok(ini.result.capabilities.tools)
  const rara: any = await mcp.atenderMcp(db, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, app, T)
  assert.equal(rara.result.protocolVersion, mcp.VERSIONES[0], 'una versión que no conoce: la suya')
  assert.equal(await mcp.atenderMcp(db, { jsonrpc: '2.0', method: 'notifications/initialized' }, app, T), null, 'las notificaciones no se contestan')

  const lista: any = await mcp.atenderMcp(db, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, app, T)
  assert.deepEqual(lista.result.tools.map((t: any) => t.name), mcp.HERRAMIENTAS_MCP)
  assert.equal(lista.result.tools[0].inputSchema.type, 'object')
  assert.ok(lista.result.tools.every((t: any) => t.annotations.readOnlyHint))

  insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Una nota sobre la retórica', contenido: 'La retórica de la corrupción se aprende escuchando.', estado: 'disponible' }, T)
  const busca: any = await mcp.atenderMcp(db, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'buscar_corpus', arguments: { consulta: 'retórica' } } }, app, T)
  assert.equal(busca.result.isError, false)
  assert.match(busca.result.content[0].text, /retórica/)

  const accion: any = await mcp.atenderMcp(db, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'recordar', arguments: { texto: 'x' } } }, app, T)
  assert.equal(accion.error.code, -32602, 'una herramienta de acción no existe por acá')
  const metodo: any = await mcp.atenderMcp(db, { jsonrpc: '2.0', id: 6, method: 'resources/list' }, app, T)
  assert.equal(metodo.error.code, -32601)

  const lote: any = await mcp.atenderMcp(db, [{ jsonrpc: '2.0', id: 7, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 8, method: 'tools/list' }], app, T)
  assert.deepEqual(lote.map((r: any) => r.id), [7, 8])

  const filas = db.prepare('SELECT herramienta, ok FROM mcp_llamadas').all() as any[]
  assert.deepEqual(filas.map((f) => f.herramienta), ['buscar_corpus'], 'queda registrada cada llamada')
  assert.equal(mcp.llamadasMcp(db)[0].app, 'Claude Code')

  let ultima: any
  for (let i = 0; i < mcp.TOPE_POR_MINUTO + 1; i++) ultima = await mcp.atenderMcp(db, { jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name: 'ver_grafo', arguments: {} } }, app, T + 1000)
  assert.equal(ultima.result.isError, true)
  assert.match(ultima.result.content[0].text, /tope/)
  const despues: any = await mcp.atenderMcp(db, { jsonrpc: '2.0', id: 999, method: 'tools/call', params: { name: 'ver_grafo', arguments: {} } }, app, T + 120_000)
  assert.doesNotMatch(despues.result.content[0].text, /tope/, 'al minuto se libera')

  apps.revocarApp(db, app.id, T)
  assert.equal(apps.autenticarApp(db, `Bearer ${token}`, 'leer').motivo, 'invalido', 'revocado no entra')
})
