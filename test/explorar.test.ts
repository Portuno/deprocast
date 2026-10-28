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

test('Reddit: el feed Atom (post y comentarios) sin la firma «submitted by»; un subreddit por RSS; el límite pasa a Exa', async () => {
  const { entradasAtom } = await import('../src/explorar/reddit.ts')
  const atom = `<feed><entry><author><name>/u/autora</name></author><content type="html">&lt;div&gt;&lt;p&gt;El cuerpo del post&lt;/p&gt;&lt;/div&gt; submitted by &lt;a&gt; /u/autora &lt;/a&gt; [link] [comments]</content><link href="https://www.reddit.com/r/prueba/comments/abc/hola/"/><updated>2026-10-01T10:00:00+00:00</updated><title>Hola &amp; chau</title></entry>
    <entry><author><name>/u/otro</name></author><content type="html">&lt;p&gt;Un comentario&lt;/p&gt;</content><link href="https://www.reddit.com/r/prueba/comments/abc/hola/xyz/"/><updated>2026-10-01T11:00:00+00:00</updated><title>/u/otro on Hola</title></entry></feed>`
  const es = entradasAtom(atom)
  assert.deepEqual(es.map((e) => [e.titulo, e.autor]), [['Hola & chau', 'u/autora'], ['/u/otro on Hola', 'u/otro']])
  const db = abrir(':memory:')
  const { _reiniciarTurnos } = await import('../src/explorar/red.ts')
  _reiniciarTurnos()
  redFalsa([
    [/reddit\.com\/r\/prueba\/comments\/abc\/hola\/\.rss/, () => new Response(atom, { headers: { 'content-type': 'application/atom+xml' } })],
    [/reddit\.com\/r\/prueba\/top\.rss/, () => new Response(atom)],
    [/reddit\.com\/search\.rss/, () => new Response('', { status: 429 })],
    [/mcp\.exa\.ai/, () => sse('Title: Otro post\nURL: https://www.reddit.com/r/prueba/comments/def/otro/\nHighlights:\nTexto')],
  ])
  const hilo = await ex.leerLink(db, 'https://www.reddit.com/r/prueba/comments/abc/hola/', { ahora: T })
  assert.equal(hilo.via, 'RSS de Reddit')
  assert.match(hilo.markdown, /El cuerpo del post/)
  assert.doesNotMatch(hilo.markdown, /submitted by/)
  assert.match(hilo.markdown, /\*\*u\/otro\*\*: Un comentario/)
  const sub = await ex.listar(db, 'reddit', 'subreddit', 'r/prueba/top', { ahora: T })
  assert.equal(sub.items[0].datos?.subreddit, 'prueba')
  await assert.rejects(ex.listar(db, 'reddit', 'subreddit', 'no vale!', { ahora: T }), (e: any) => e.codigo === 'ENTRADA_MALA')
  const b = await ex.buscar(db, 'reddit', 'algo', { ahora: T })
  assert.equal(b.via, 'Exa', 'Exa va primero (trae el cuerpo del post)')
})

test('YouTube: los videos de una búsqueda de InnerTube, anidados a cualquier profundidad', async () => {
  const { videosDeBusqueda } = await import('../src/explorar/youtube.ts')
  const j = { contents: { a: { b: [{ itemSectionRenderer: { contents: [
    { videoRenderer: { videoId: 'abcdefghijk', title: { runs: [{ text: 'Un video' }] }, ownerText: { runs: [{ text: 'Un canal' }] }, viewCountText: { simpleText: '1.234 vistas' }, lengthText: { simpleText: '10:01' } } },
    { channelRenderer: { channelId: 'UCx' } },
  ] } }] } } }
  const vs = videosDeBusqueda(j)
  assert.deepEqual(vs.map((v) => [v.titulo, v.url, v.autor, v.datos?.vistas]), [['Un video', 'https://www.youtube.com/watch?v=abcdefghijk', 'Un canal', '1.234 vistas']])
})

test('GitHub: rutas de repo e issue; buscar repos; leer un repo con README; el 403 de límite es LIMITE con la hora', async () => {
  const { rutaGithub } = await import('../src/explorar/github.ts')
  assert.deepEqual(rutaGithub('https://github.com/a/b'), { dueno: 'a', repo: 'b', numero: undefined })
  assert.deepEqual(rutaGithub('https://github.com/a/b.git'), { dueno: 'a', repo: 'b', numero: undefined })
  assert.equal(rutaGithub('https://github.com/a/b/pull/12')!.numero, 12)
  assert.equal(rutaGithub('https://github.com/a/b/blob/main/x.md'), null, 'un archivo lo lee la web')
  const db = abrir(':memory:')
  redFalsa([
    [/api\.github\.com\/search\/repositories/, () => Response.json({ items: [{ full_name: 'a/b', html_url: 'https://github.com/a/b', description: 'Un repo', stargazers_count: 7, owner: { login: 'a' } }] })],
    [/api\.github\.com\/repos\/a\/b\/readme/, () => new Response('# Hola\n\nEl README.')],
    [/api\.github\.com\/repos\/a\/b$/, () => Response.json({ full_name: 'a/b', description: 'Un repo', stargazers_count: 7, forks_count: 1, language: 'TypeScript', pushed_at: '2026-10-01T00:00:00Z', owner: { login: 'a' } })],
    [/api\.github\.com\/users\/limitado/, () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(T / 1000) + 600) } })],
  ])
  const b = await ex.buscar(db, 'github', 'algo', { ahora: T })
  assert.deepEqual([b.items[0].titulo, b.items[0].datos?.estrellas], ['a/b', 7])
  const r = await ex.leerLink(db, 'https://github.com/a/b', { ahora: T })
  assert.match(r.markdown, /★ 7 · 1 forks · TypeScript/)
  assert.match(r.markdown, /## README\n\n# Hola/)
  await assert.rejects(ex.listar(db, 'github', 'repos', 'limitado', { ahora: T }), (e: any) => e.codigo === 'LIMITE' && /60 pedidos/.test(e.message))
})

test('X: los hilos públicos de Exa se vuelven el tweet original; un tweet se lee por oEmbed; un perfil no se lee sin cuenta', async () => {
  const db = abrir(':memory:')
  redFalsa([
    [/mcp\.exa\.ai/, () => sse('Title: Thread by @alguien\nURL: https://threadreaderapp.com/thread/1957885810075922627.html\nHighlights:\nEl hilo\n\n---\n\nTitle: Otra cosa\nURL: https://ejemplo.com/x\nHighlights:\nNada')],
    [/publish\.twitter\.com\/oembed/, () => Response.json({ author_name: 'Alguien', author_url: 'https://x.com/alguien', html: '<blockquote><p>Un tweet de prueba con algo de texto</p>&mdash; Alguien</blockquote>' })],
  ])
  const b = await ex.buscar(db, 'twitter', 'algo', { ahora: T })
  assert.deepEqual(b.items.map((x) => x.url), ['https://x.com/i/status/1957885810075922627'])
  assert.match(b.aviso!, /Sin cuenta/)
  const t = await ex.leerLink(db, 'https://x.com/alguien/status/123', { ahora: T })
  assert.equal(t.via, 'oEmbed de X')
  assert.match(t.markdown, /Un tweet de prueba/)
  const estado = ex.estadoCanales(db, T)
  assert.deepEqual(estado.map((c) => c.id), ['web', 'reddit', 'youtube', 'github', 'x', 'linkedin', 'instagram', 'facebook'])
  assert.ok(estado.find((c) => c.id === 'instagram')!.noPuede!.includes('pide cuenta'))
})

test('Quién explora: los agentes buscadores tienen buscar_en y explorar; el MCP también (todo de lectura); el chat ve el grupo web', async () => {
  const { herramientasDeAgente, WEB_AGENTE } = await import('../src/agentes/motor.ts')
  const nombres = herramientasDeAgente({ clase: 'buscador' } as any).map((h) => h.nombre)
  for (const n of ['buscar_en', 'explorar', 'leer_pagina']) assert.ok(nombres.includes(n), n)
  assert.ok(!herramientasDeAgente({ clase: 'vectorizador' } as any).some((h) => WEB_AGENTE.includes(h.nombre)), 'los que no salen a la web, no')
  const mcp = await import('../src/mcp.ts')
  const deMcp = mcp.herramientasMcp()
  for (const n of ['buscar_en', 'explorar', 'leer_pagina']) assert.ok(deMcp.some((h) => h.nombre === n), n)
  assert.ok(deMcp.every((h) => h.familia === 'lectura'))
  const { gruposDelMensaje } = await import('../src/chat/herramientas.ts')
  assert.ok(gruposDelMensaje('fijate qué dicen en reddit de esto').includes('web'))
})

test('Las herramientas: buscar_en devuelve links reales; explorar lista; un error vuelve como error, no rompe', async () => {
  const db = abrir(':memory:')
  redFalsa([[/api\.github\.com\/search\/repositories/, () => Response.json({ items: [{ full_name: 'a/b', html_url: 'https://github.com/a/b', stargazers_count: 3, owner: { login: 'a' } }] })]])
  const { HERRAMIENTAS, ejecutarHerramienta } = await import('../src/chat/herramientas.ts')
  const r: any = await ejecutarHerramienta(HERRAMIENTAS, 'buscar_en', JSON.stringify({ plataforma: 'github', consulta: 'algo' }), { db, conversacionId: null })
  assert.equal(r.resultado.resultados[0].url, 'https://github.com/a/b')
  assert.equal(r.resultado.resultados[0].estrellas, 3)
  const mal: any = await ejecutarHerramienta(HERRAMIENTAS, 'explorar', JSON.stringify({ plataforma: 'github', que: 'nada', id: 'x' }), { db, conversacionId: null })
  assert.match(mal.resultado.error, /no lista «nada»/)
})

test('El Observatorio: lo de una plataforma con canal va por explorar (con sus datos); noticias y foros, por los buscadores', async () => {
  const db = abrir(':memory:')
  redFalsa([[/api\.github\.com\/search\/repositories/, () => Response.json({ items: [{ full_name: 'a/b', html_url: 'https://github.com/a/b', description: 'Un repo', stargazers_count: 42, owner: { login: 'a' } }] })]])
  const ob = await import('../src/observatorio.ts')
  assert.equal(ob.consultaPara('github', 'algo'), 'site:github.com algo')
  assert.equal(ob.consultaPara('noticias', 'algo'), 'algo noticias')
  const t = ob.seguirTema(db, { nombre: 'Un tema', consultas: ['algo'] })
  assert.deepEqual(t.plataformas, ['x', 'reddit', 'youtube', 'noticias', 'foros'], 'las nuevas se eligen a mano')
})
