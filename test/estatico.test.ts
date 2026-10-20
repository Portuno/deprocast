import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const { servirEstatico, servirArchivo, comprimirJson, indexConVersiones, versionDe } = await import('../src/estatico.ts')
const { abrir } = await import('../src/db.ts')
const { ultimosMensajes } = await import('../src/chat/index.ts')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-estatico-'))
fs.mkdirSync(path.join(dir, 'js'))
const js = path.join(dir, 'js', 'a.js')
fs.writeFileSync(js, `// un script\n${'console.log("hola mundo");\n'.repeat(200)}`)
fs.writeFileSync(path.join(dir, 'index.html'), '<script defer src="/js/a.js"></script><link href="/estilo.css">')
fs.writeFileSync(path.join(dir, 'estilo.css'), 'body{color:red}')
const audio = path.join(dir, 'audio.mp3')
fs.writeFileSync(audio, Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)))

/** Un servidor mínimo con las mismas piezas que servidor.ts. */
function levantar(): Promise<{ url: string; cerrar: () => void }> {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    if (u.pathname === '/js/a.js') return servirEstatico(req, res, js, 'text/javascript', { inmutable: u.searchParams.get('v') === versionDe(js) })
    if (u.pathname === '/') return servirEstatico(req, res, path.join(dir, 'index.html'), 'text/html', { contenido: indexConVersiones(dir) })
    if (u.pathname === '/audio') return servirArchivo(req, res, audio, { 'content-type': 'audio/mpeg' })
    res.setHeader('content-type', 'application/json; charset=utf-8')
    comprimirJson(req, res)
    res.end(JSON.stringify(u.pathname === '/api/grande' ? { xs: Array.from({ length: 500 }, (_, i) => ({ i, texto: 'algo que se repite' })) } : { ok: true }))
  })
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(srv.address() as any).port}`, cerrar: () => srv.close() })))
}
function pedir(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; cuerpo: Buffer }> {
  return new Promise((ok, mal) => http.get(url, { headers }, (r) => { const xs: Buffer[] = []; r.on('data', (c) => xs.push(c)); r.on('end', () => ok({ status: r.statusCode!, headers: r.headers, cuerpo: Buffer.concat(xs) })) }).on('error', mal))
}

test('Estático: el index apunta a cada archivo con su hash; con ?v= correcto, caché inmutable; comprimido; ETag → 304', async () => {
  const s = await levantar()
  try {
    const idx = await pedir(`${s.url}/`)
    const v = versionDe(js)
    assert.match(idx.cuerpo.toString(), new RegExp(`src="/js/a.js\\?v=${v}"`))
    assert.equal(idx.headers['cache-control'], 'no-cache', 'el index se revalida siempre')
    assert.equal((await pedir(`${s.url}/`, { 'if-none-match': idx.headers.etag! })).status, 304)

    const conV = await pedir(`${s.url}/js/a.js?v=${v}`, { 'accept-encoding': 'gzip, br' })
    assert.equal(conV.headers['cache-control'], 'public, max-age=31536000, immutable')
    assert.equal(conV.headers['content-encoding'], 'br')
    assert.ok(conV.cuerpo.length < fs.statSync(js).size / 5, 'brotli lo achica mucho')
    assert.equal(zlib.brotliDecompressSync(conV.cuerpo).toString(), fs.readFileSync(js, 'utf8'))
    const gz = await pedir(`${s.url}/js/a.js?v=viejo`, { 'accept-encoding': 'gzip' })
    assert.equal(gz.headers['cache-control'], 'no-cache', 'una versión que no coincide no se guarda para siempre')
    assert.equal(zlib.gunzipSync(gz.cuerpo).toString(), fs.readFileSync(js, 'utf8'))
    assert.equal((await pedir(`${s.url}/js/a.js`, { 'if-none-match': conV.headers.etag! })).status, 304)

    // Cambia el archivo → cambia el hash (en la compu se edita en vivo).
    fs.appendFileSync(js, '// cambio\n')
    assert.notEqual(versionDe(js), v)
  } finally { s.cerrar() }
})

test('Adjuntos: Range (206) para adelantar audio o video, 416 fuera de rango, ETag → 304', async () => {
  const s = await levantar()
  try {
    const todo = await pedir(`${s.url}/audio`)
    assert.equal(todo.status, 200)
    assert.equal(todo.headers['accept-ranges'], 'bytes')
    assert.equal(Number(todo.headers['content-length']), 1000)
    const parte = await pedir(`${s.url}/audio`, { range: 'bytes=100-199' })
    assert.equal(parte.status, 206)
    assert.equal(parte.headers['content-range'], 'bytes 100-199/1000')
    assert.deepEqual([...parte.cuerpo.subarray(0, 3)], [100, 101, 102])
    assert.equal(parte.cuerpo.length, 100)
    const cola = await pedir(`${s.url}/audio`, { range: 'bytes=-10' })
    assert.equal(cola.headers['content-range'], 'bytes 990-999/1000')
    assert.equal((await pedir(`${s.url}/audio`, { range: 'bytes=5000-' })).status, 416)
    assert.equal((await pedir(`${s.url}/audio`, { 'if-none-match': todo.headers.etag! })).status, 304)
  } finally { s.cerrar() }
})

test('JSON: ETag y 304 en los GET; gzip si pesa más de 2 KB', async () => {
  const s = await levantar()
  try {
    const a = await pedir(`${s.url}/api/chico`)
    assert.ok(a.headers.etag)
    assert.equal(a.headers['content-encoding'], undefined, 'lo chico no se comprime')
    assert.equal((await pedir(`${s.url}/api/chico`, { 'if-none-match': a.headers.etag! })).status, 304)
    const g = await pedir(`${s.url}/api/grande`, { 'accept-encoding': 'gzip' })
    assert.equal(g.headers['content-encoding'], 'gzip')
    assert.equal(JSON.parse(zlib.gunzipSync(g.cuerpo).toString()).xs.length, 500)
  } finally { s.cerrar() }
})

test('Chat: los últimos 200 (empezando en un mensaje suyo), los anteriores por páginas y lo nuevo con «desde»', () => {
  const db = abrir(':memory:')
  const c = Number(db.prepare(`INSERT INTO conversaciones (con, creada_en, actualizada_en) VALUES ('mastropiero', 1, 1)`).run().lastInsertRowid)
  const ins = db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, ?, ?, 1)`)
  for (let i = 0; i < 450; i++) ins.run(c, ['operador', 'asistente', 'herramienta'][i % 3], `m${i}`)
  const p1 = ultimosMensajes(db, c, 200)
  assert.equal(p1.hayMas, true)
  assert.equal(p1.mensajes[0].rol, 'operador', 'no corta un turno por la mitad')
  assert.ok(p1.mensajes.length <= 200 && p1.mensajes.length >= 198)
  assert.equal(p1.mensajes.at(-1)!.texto, 'm449')
  const p2 = ultimosMensajes(db, c, 200, p1.mensajes[0].id)
  assert.equal(p2.mensajes.at(-1)!.id, p1.mensajes[0].id - 1)
  const p3 = ultimosMensajes(db, c, 200, p2.mensajes[0].id)
  assert.equal(p3.hayMas, false)
  assert.equal(p3.mensajes[0].texto, 'm0')
  assert.equal(new Set([...p1.mensajes, ...p2.mensajes, ...p3.mensajes].map((m) => m.id)).size, 450, 'sin huecos ni repetidos')
})
