import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
const { abrir } = await import('../src/db.ts')
const ex = await import('../src/explorar/index.ts')
const { parsearExa, leerJina, vistaPrevia } = await import('../src/explorar/web.ts')
const { ErrorExplorar } = await import('../src/explorar/tipos.ts')

const T = new Date(2026, 10, 3, 10).getTime()
type Ruta = (url: string, init?: RequestInit) => Response | Promise<Response>
/** Una red falsa: la primera ruta cuyo patrón coincide con la URL responde. */
function redFalsa(rutas: [RegExp, Ruta][]) {
  const pedidos: string[] = []
  ex._probarExplorar(async (url, init) => {
    pedidos.push(url)
    for (const [re, f] of rutas) if (re.test(url)) return f(url, init)
    return new Response('no', { status: 404 })
  })
  return pedidos
}
const sse = (texto: string) => new Response(`event: message\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text: texto }] }, jsonrpc: '2.0', id: 1 })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })

test('Exa: los bloques de resultados (título, URL, fecha, autor y el texto)', () => {
  const items = parsearExa('Title: Uno\nURL: https://www.reddit.com/r/a/comments/1/uno/\nPublished: 2026-04-19T09:00:25.000Z\nAuthor: u/alguien\nHighlights:\n# Uno\n\nEl cuerpo del post.\n\n---\n\nTitle: Dos\nURL: https://ejemplo.com/dos\nHighlights:\nOtro texto')
  assert.equal(items.length, 2)
  assert.deepEqual([items[0].titulo, items[0].autor, items[0].fecha?.slice(0, 10)], ['Uno', 'u/alguien', '2026-04-19'])
  assert.match(items[0].texto!, /El cuerpo del post/)
  assert.doesNotMatch(items[0].texto!, /---/)
})

test('Jina: lee; si el sitio lo bloquea es BLOQUEADO; si es mucho pedir, LIMITE', async () => {
  const ok = async () => new Response('Title: Hola\n\nURL Source: https://x.ejemplo.com\n\nMarkdown Content:\n' + 'palabra '.repeat(40))
  assert.equal((await leerJina(ok as any, 'https://x.ejemplo.com')).titulo, 'Hola')
  const bloqueo = async () => new Response('AbuseAlleviationError: Anonymous access to domain www.linkedin.com blocked until Wed Oct 28 2026 13:57:15 GMT+0000 (UTC)', { status: 451 })
  await assert.rejects(leerJina(bloqueo as any, 'https://www.linkedin.com/x'), (e: any) => e.codigo === 'BLOQUEADO' && /hasta Wed Oct 28/.test(e.message))
  await assert.rejects(leerJina((async () => new Response('', { status: 429 })) as any, 'https://x.ejemplo.com'), (e: any) => e.codigo === 'LIMITE')
})

test('Vista previa pública: og:title, og:description e imagen, con entidades HTML', () => {
  const v = vistaPrevia('<html><head><meta property="og:title" content="NASA (&#064;nasa) &#x2022; Instagram" /><meta property="og:description" content="104M Followers &amp; más" /><meta property="og:image" content="https://cdn.ejemplo.com/a.jpg"></head></html>')
  assert.deepEqual(v, { titulo: 'NASA (@nasa) • Instagram', descripcion: '104M Followers & más', imagen: 'https://cdn.ejemplo.com/a.jpg', tipo: null })
})

test('La cadena: si el primero está bloqueado va el siguiente; caché de 30 min; salud con pausa; lo que no existe corta', async () => {
  const db = abrir(':memory:')
  const pedidos = redFalsa([
    [/^https:\/\/raro\.ejemplo\.com/, () => new Response('<html><div id="root"></div></html>', { headers: { 'content-type': 'text/html' } })],
    [/^https:\/\/r\.jina\.ai\/https:\/\/raro/, () => new Response('Just a moment... cf-chl', { status: 403 })],
    [/mcp\.exa\.ai/, () => sse('# La página rara\nURL: https://raro.ejemplo.com/\n\n' + 'Texto que trajo Exa. '.repeat(10))],
  ])
  const { _probarLector } = await import('../src/lector/index.ts')
  _probarLector(async (url) => { pedidos.push(url); return new Response('<html><body><div id="root"></div></body></html>', { headers: { 'content-type': 'text/html' } }) })
  const l = await ex.leerLink(db, 'https://raro.ejemplo.com/', { ahora: T })
  assert.equal(l.via, 'Exa')
  assert.equal(l.titulo, 'La página rara')
  const salud = ex.estadoCanales(db, T).find((c) => c.id === 'web')!
  assert.deepEqual(salud.leer.map((b) => b.estado), ['fallo', 'en_pausa', 'ok'], 'el lector falló, Jina quedó en pausa (bloqueado), Exa anduvo')
  const antes = pedidos.length
  assert.equal((await ex.leerLink(db, 'https://raro.ejemplo.com/', { ahora: T + 60_000 })).via, 'Exa')
  assert.equal(pedidos.length, antes, 'de la caché: nadie pidió nada')
  // Lo que no existe corta la cadena (no se le pregunta a Exa).
  _probarLector(async () => new Response('no', { status: 404 }))
  await assert.rejects(ex.leerLink(db, 'https://otro.ejemplo.com/nada', { ahora: T }), (e: any) => e.codigo === 'NO_ENCONTRADO')
  await assert.rejects(ex.buscar(db, 'myspace', 'algo'), /No conozco/)
  await assert.rejects(ex.leerLink(db, 'ftp://x'), (e: any) => e instanceof ErrorExplorar && e.codigo === 'ENTRADA_MALA')
})
