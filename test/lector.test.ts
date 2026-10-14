import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { leerHtml } from '../src/lector/html.ts'
import { _probarLector, cuadernoComoMd, esSitioConIndice, guardarLink, leer, normalizarUrl, piezaComoMd } from '../src/lector/index.ts'
import { rastrear, reglasRobots } from '../src/lector/rastreo.ts'
import { _probarTelegram, procesarActualizacion } from '../src/telegram.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarEscriba } from '../src/chat/index.ts'

_probarEscriba(async () => {})

const BLOG = `<!doctype html><html lang="es"><head><title>Cómo pesar quántomos &mdash; Blog</title>
<meta property="og:title" content="Cómo pesar quántomos"><meta name="description" content="Una guía corta.">
<meta property="article:published_time" content="2026-10-01T10:00:00Z">
<script type="application/ld+json">{"@type":"Article","headline":"Cómo pesar quántomos","author":{"name":"Ana Pérez"}}</script></head><body>
<header class="site-header"><nav><a href="/">Inicio</a><a href="/blog/">Blog</a></nav></header>
<div class="cookie-banner">Usamos cookies <button>Aceptar</button></div>
<div class="layout"><aside class="sidebar"><h3>Lo más leído</h3><ul><li><a href="/blog/otro">Otro post</a></li></ul></aside>
<article><h1>Cómo pesar quántomos</h1>
<p>Un <strong>quántomo</strong> es la unidad mínima de información, y pesarlo bien importa. Esta es una guía <em>corta</em>, con ejemplos.</p>
<h2>Los pasos</h2><ol><li>Leer la pieza entera.<ul><li>Sin apuro</li><li>Con <a href="/glosario#q">el glosario</a> a mano</li></ul></li><li>Pesar de 1 a 12.</li></ol>
<p><img src="/img/escala.png" alt="La escala de 1 a 12"><img src="/pixel.gif"></p>
<pre><code class="language-ts">const peso = 12
sellar(id, peso)</code></pre>
<table><thead><tr><th>Peso</th><th>Significa</th></tr></thead><tbody><tr><td>1</td><td>Ruido</td></tr><tr><td>12</td><td>Oro | puro</td></tr></tbody></table>
<blockquote><p>Lo que no se pesa, no se sabe.</p></blockquote><div class="share-buttons"><a href="https://twitter.com/share">Compartir</a></div>
</article></div><section id="comments"><h3>Comentarios</h3><p>Muy bueno!!!</p></section>
<footer>© 2026 Blog · <a href="/privacidad">Privacidad</a></footer><script>alert(1)</script></body></html>`

test('lector: del HTML de un blog queda solo el artículo, en Markdown, con sus metadatos', () => {
  const r = leerHtml(BLOG, 'https://blog.ejemplo.com/blog/pesar')
  assert.equal(r.titulo, 'Cómo pesar quántomos')
  assert.deepEqual(r.meta, { descripcion: 'Una guía corta.', autor: 'Ana Pérez', fecha: '2026-10-01T10:00:00Z', idioma: 'es' })
  for (const fuera of ['Inicio', 'cookies', 'Lo más leído', 'Compartir', 'Muy bueno', 'Privacidad', 'alert(']) assert.ok(!r.markdown.includes(fuera), `sin «${fuera}»`)
  assert.match(r.markdown, /^# Cómo pesar quántomos\n\nUn \*\*quántomo\*\* es la unidad mínima de información, y pesarlo bien importa\. Esta es una guía \*corta\*, con ejemplos\./)
  assert.match(r.markdown, /## Los pasos\n\n1\. Leer la pieza entera\.\n[\s\S]*   - Sin apuro\n   - Con \[el glosario\]\(https:\/\/blog\.ejemplo\.com\/glosario#q\) a mano\n2\. Pesar de 1 a 12\./)
  assert.match(r.markdown, /!\[La escala de 1 a 12\]\(https:\/\/blog\.ejemplo\.com\/img\/escala\.png\)/)
  assert.ok(!r.markdown.includes('pixel.gif'), 'una imagen sin alt no suma')
  assert.match(r.markdown, /```ts\nconst peso = 12\nsellar\(id, peso\)\n```/)
  assert.match(r.markdown, /\| Peso \| Significa \|\n\| --- \| --- \|\n\| 1 \| Ruido \|\n\| 12 \| Oro \\\| puro \|/)
  assert.match(r.markdown, /> Lo que no se pesa, no se sabe\./)
  assert.ok(r.links.some((l) => l.url === 'https://blog.ejemplo.com/blog/otro' && l.interno))
})

/** Un «internet» de mentira: ruta → respuesta. */
function red(rutas: Record<string, { cuerpo: string; tipo?: string; status?: number }>) {
  const pedidos: string[] = []
  _probarLector(async (url) => {
    pedidos.push(url)
    const r = rutas[url]
    if (!r) return new Response('no', { status: 404 })
    return new Response(r.cuerpo, { status: r.status ?? 200, headers: { 'content-type': r.tipo ?? 'text/html; charset=utf-8' } })
  })
  return pedidos
}

test('lector: fuentes especiales (GitHub, Reddit, Wikipedia) y avisos honestos', async () => {
  red({
    'https://raw.githubusercontent.com/unclecode/crawl4ai/HEAD/README.md': { cuerpo: '# Crawl4AI\n\nCrawler para LLMs.', tipo: 'text/plain' },
    'https://www.reddit.com/r/argentina/comments/abc/hola.json?limit=20&sort=top': { tipo: 'application/json', cuerpo: JSON.stringify([
      { data: { children: [{ data: { title: 'Hola Reddit', subreddit: 'argentina', author: 'yo', score: 10, selftext: 'El cuerpo del post.', created_utc: 1790000000 } }] } },
      { data: { children: [{ data: { author: 'otro', score: 5, body: 'Un comentario' } }, { data: { author: 'AutoModerator', body: 'bot' } }] } },
    ]) },
    'https://es.wikipedia.org/api/rest_v1/page/html/Cuarzo': { cuerpo: '<html><body><section><p>El cuarzo es un mineral compuesto de sílice, muy común en la corteza terrestre y en muchas rocas.</p></section><h2>Referencias</h2><ul><li>Una</li></ul></body></html>' },
    'https://app.ejemplo.com/': { cuerpo: '<html><body><div id="root"></div><script src="/app.js"></script></body></html>' },
  })
  const gh = await leer('https://github.com/unclecode/crawl4ai')
  assert.deepEqual([gh.fuente, gh.titulo, gh.markdown], ['github', 'unclecode/crawl4ai', '# Crawl4AI\n\nCrawler para LLMs.'])
  const rd = await leer('https://www.reddit.com/r/argentina/comments/abc/hola/')
  assert.equal(rd.fuente, 'reddit')
  assert.match(rd.markdown, /# Hola Reddit[\s\S]*El cuerpo del post\.[\s\S]*## Comentarios principales\n\n- \*\*u\/otro\*\* \(5\): Un comentario/)
  assert.ok(!rd.markdown.includes('AutoModerator'))
  const wk = await leer('https://es.wikipedia.org/wiki/Cuarzo')
  assert.match(wk.markdown, /^# Cuarzo\n\nEl cuarzo es un mineral/)
  assert.ok(!wk.markdown.includes('Referencias'), 'sin la cola de referencias')
  const spa = await leer('https://app.ejemplo.com/')
  assert.match(spa.aviso ?? '', /se arma con JavaScript/)
  const ig = await leer('https://www.instagram.com/p/xyz/')
  assert.match(ig.aviso ?? '', /sin cuenta/)
  assert.match((await leer('https://no.existe.ejemplo/')).aviso ?? '', /404/)
  assert.equal(normalizarUrl('https://www.ejemplo.com/a/?utm_source=x&id=2#parte'), 'https://ejemplo.com/a/?id=2')
})

test('lector: guardar un link (una sola vez) y bajarlo en .md', async () => {
  const db = abrir(':memory:')
  red({ 'https://blog.ejemplo.com/blog/pesar?utm_source=tg': { cuerpo: BLOG } })
  const a = await guardarLink(db, 'https://blog.ejemplo.com/blog/pesar?utm_source=tg', { nota: 'para el capítulo III' })
  const b = await guardarLink(db, 'https://www.blog.ejemplo.com/blog/pesar/')
  assert.ok(a.nueva && !b.nueva)
  assert.equal(a.piezaId, b.piezaId, 'el mismo link no se guarda dos veces')
  const md = piezaComoMd(db, a.piezaId)
  assert.equal(md.nombre, 'Como-pesar-quantomos.md')
  assert.match(md.texto, /^---\ntitulo: "Cómo pesar quántomos"\nurl: "https:\/\/blog\.ejemplo\.com\/blog\/pesar\?utm_source=tg"\nautor: "Ana Pérez"\nfecha: "2026-10-01"\nfuente: "web"\npieza: \d+\n---\n\n> Nota: para el capítulo III\n\n# Cómo pesar quántomos/)
})

test('lector: rastrear un sitio de documentación (mismo tramo, robots.txt, tope, sin repetir) y armar el cuaderno', async () => {
  const db = abrir(':memory:')
  const pagina = (n: number) => `<html><head><title>Doc ${n}</title></head><body><nav><a href="/docs/1">1</a><a href="/blog/x">blog</a></nav><main><h1>Doc ${n}</h1><p>${'Contenido de la página de documentación número '.repeat(3)}${n}.</p>
    <ul>${Array.from({ length: 30 }, (_, k) => `<li><a href="/docs/${k + 1}">Parte ${k + 1}</a></li>`).join('')}<li><a href="/docs/privado/secreto">Privado</a></li><li><a href="https://otro.com/docs/1">Afuera</a></li></ul></main></body></html>`
  const rutas: Record<string, { cuerpo: string; tipo?: string }> = { 'https://docs.ejemplo.com/robots.txt': { cuerpo: 'User-agent: *\nDisallow: /docs/privado\n', tipo: 'text/plain' } }
  for (let n = 1; n <= 30; n++) rutas[`https://docs.ejemplo.com/docs/${n}`] = { cuerpo: pagina(n) }
  rutas['https://docs.ejemplo.com/docs/privado/secreto'] = { cuerpo: pagina(999) }
  const pedidos = red(rutas)
  const inicio = await leer('https://docs.ejemplo.com/docs/1')
  assert.ok(esSitioConIndice(inicio))
  const r = await rastrear(db, 'https://docs.ejemplo.com/docs/1', { max: 20, esperaMs: 0, inicio })
  assert.equal(r.paginas, 20)
  assert.equal(new Set(r.piezas).size, 20, 'sin repetir')
  assert.ok(!pedidos.some((u) => u.includes('/privado/') || u.includes('otro.com') || u.includes('/blog/')), 'respeta robots.txt, el origen y el tramo')
  assert.deepEqual(reglasRobots('User-agent: Googlebot\nDisallow: /a\n\nUser-agent: *\nDisallow: /b\nDisallow:\n'), ['/b'])
  const md = cuadernoComoMd(db, r.cuadernoId)
  assert.match(md.texto, /^# docs\.ejemplo\.com · \/docs\/\n\nRastreado desde https:\/\/docs\.ejemplo\.com\/docs\/1: 20 páginas\./)
  assert.equal(md.texto.split('\n---\n').length, 20)
})

test('telegram: un link se lee y se guarda; 📄 MD manda el archivo; 🗑 no lo guarda', async () => {
  const db = abrir(':memory:')
  red({ 'https://blog.ejemplo.com/blog/pesar': { cuerpo: BLOG } })
  const enviados: any[] = []
  const archivos: any[] = []
  let n = 100
  _probarTelegram({
    pedir: async (metodo, cuerpo) => { const id = ++n; if (/^(sendMessage|editMessageText)$/.test(metodo)) enviados.push({ metodo, id, ...cuerpo }); return { ok: true, result: { message_id: id } } },
    mandarArchivo: async (metodo, campos, campo, datos, nombre) => { archivos.push({ metodo, campo, nombre, texto: datos.toString('utf8') }); return { ok: true } },
  })
  _probarModelo(async () => ({ texto: 'Buenísimo, lo leo.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }))
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '42'
  await procesarActualizacion(db, { message: { chat: { id: 42 }, message_id: 1, text: 'mirá esto https://blog.ejemplo.com/blog/pesar' } })
  const aviso = enviados.find((e) => /Guardé/.test(e.text))
  assert.match(aviso.text, /📄 Guardé «Cómo pesar quántomos» \(\d+ palabras\)\.\n<i>Una guía corta\.<\/i>/)
  const [md, no] = aviso.reply_markup.inline_keyboard[0]
  assert.equal(md.text, '📄 MD')
  await procesarActualizacion(db, { callback_query: { id: 'q', data: md.callback_data, message: { chat: { id: 42 }, message_id: aviso.id } } })
  assert.equal(archivos.at(-1).metodo, 'sendDocument')
  assert.equal(archivos.at(-1).nombre, 'Como-pesar-quantomos.md')
  assert.match(archivos.at(-1).texto, /> Nota: mirá esto\n\n# Cómo pesar quántomos/)
  const id = Number(no.callback_data.split(':')[2])
  await procesarActualizacion(db, { callback_query: { id: 'q', data: no.callback_data, message: { chat: { id: 42 }, message_id: aviso.id } } })
  assert.equal(db.prepare('SELECT 1 FROM corpus WHERE id = ?').get(id), undefined, '🗑 lo borra')
})
