import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.YOUTUBE_API_KEY = 'clave-de-prueba'
const { abrir } = await import('../src/db.ts')
const k = await import('../src/youtube-canal.ts')
const yt = await import('../src/youtube.ts')
const { HERRAMIENTAS, GRUPOS } = await import('../src/chat/herramientas.ts')

const T = new Date('2026-11-09T10:00:00').getTime()
const v = (id: string, titulo: string, min: number, vistas: number, subs = false, fecha = '2025-01-01') => ({ id, titulo, fecha, segundos: min * 60, vistas, subtitulos: subs, descripcion: `Sobre ${titulo}` })

test('el censo agrupa por series y formatos, marca los refritos y separa «Clase 12» de «Clase 13»', () => {
  assert.equal(k.segundosIso('PT1H2M3S'), 3723)
  assert.equal(k.segundosIso('PT45S'), 45)
  assert.equal(k.serieDe('Alemán desde cero | Clase 3: los artículos'), 'Alemán desde cero')
  assert.equal(k.serieDe('Podcast Ep. 12 con Ana'), 'Podcast')
  const { grupos, refritos } = k.agrupar([
    v('a1', 'Alemán desde cero | Clase 1', 20, 1000), v('a2', 'Alemán desde cero | Clase 2', 22, 900), v('a3', 'Alemán desde cero | Clase 3', 21, 800),
    v('s1', 'Un truco rápido', 0.5, 5000), v('l1', 'La charla larga sobre el método completo de estudio', 90, 300),
    v('l2', 'La charla larga sobre el método completo de estudio', 90, 50, false, '2026-01-01'), // resubido
  ])
  assert.deepEqual(refritos, [{ id: 'l2', de: 'l1' }])
  assert.deepEqual(grupos.map((g) => [g.nombre, g.ids.length]), [['Sueltos · shorts', 1], ['Alemán desde cero', 3], ['Sueltos · largos (más de 40 min)', 1]])
  assert.equal(grupos[1].horas, 1.1)
})

test('el plan por defecto: chico, entero; grande, entero hasta el umbral y el resto por título (y los shorts nunca enteros)', () => {
  const g = (clave: string, horas: number) => ({ clave, nombre: clave, tipo: 'serie' as const, ids: [], horas, vistas: 0, conSubtitulos: 0 })
  assert.deepEqual(k.planPorDefecto([g('a', 2), g('b', 3), g('formato:shorts', 0.2)]), { a: 'entero', b: 'entero', 'formato:shorts': 'resumen' })
  assert.deepEqual(k.planPorDefecto([g('a', 20), g('b', 25), g('c', 8)]), { a: 'entero', b: 'resumen', c: 'entero' })
})

test('un canal entero (Fragua #187): censo por la API de datos, informe en el corpus, nada entra sin el ok; con el ok, a la cola por tandas y a ritmo', async () => {
  const db = abrir(':memory:')
  const pedidos: string[] = []
  k._probarCanal({
    pedir: async (url) => {
      pedidos.push(url)
      const j = (x: unknown) => new Response(JSON.stringify(x), { status: 200 })
      if (url.includes('/channels?')) return j({ items: [{ snippet: { title: 'Canal de Alemán' }, contentDetails: { relatedPlaylists: { uploads: 'UUabc' } } }] })
      if (url.includes('/playlistItems?')) return url.includes('pageToken=p2') ? j({ items: [{ contentDetails: { videoId: 'vid00000003' } }] }) : j({ items: [{ contentDetails: { videoId: 'vid00000001' } }, { contentDetails: { videoId: 'vid00000002' } }], nextPageToken: 'p2' })
      if (url.includes('/videos?')) return j({ items: [
        { id: 'vid00000001', snippet: { title: 'Alemán | Clase 1', publishedAt: '2025-02-01T00:00:00Z', description: 'Los artículos' }, contentDetails: { duration: 'PT20M', caption: 'false' }, statistics: { viewCount: '900' } },
        { id: 'vid00000002', snippet: { title: 'Alemán | Clase 2', publishedAt: '2025-02-08T00:00:00Z', description: 'Los verbos' }, contentDetails: { duration: 'PT25M', caption: 'true' }, statistics: { viewCount: '400' } },
        { id: 'vid00000003', snippet: { title: 'Alemán | Clase 3', publishedAt: '2025-02-15T00:00:00Z', description: '' }, contentDetails: { duration: 'PT30S', caption: 'false' }, statistics: { viewCount: '50' } },
      ] })
      return new Response('{}', { status: 404 })
    },
    escribir: async (_db, _s, usuario) => { assert.match(usuario, /Canal de Alemán\. 3 videos/); return { resumen: 'Un curso de alemán en clases.', conviene: 'Es chico: entero.', plan: { 'serie:aleman': 'entero', inventado: 'entero' } } },
  })
  const avisos: string[] = []
  yt._probarRetomar(async (_db, t) => { avisos.push(t); return '' })
  yt._probarYoutube({ web: async () => new Response('', { status: 404 }), esperar: async () => {} })
  await yt.encolarYoutube(db, 'https://www.youtube.com/@CanalAleman', {}, T)
  await yt.trabajarYoutube(db)
  assert.ok(pedidos[0].includes('forHandle=%40canalaleman') && pedidos[0].includes('key=clave-de-prueba'))
  const c = k.leerCenso(db, 'canal:@canalaleman')!
  assert.equal(c.videos.length, 3)
  assert.equal(c.grupos.length, 1)
  assert.equal(c.plan['serie:aleman'], 'entero')
  assert.equal(c.costo.videosEntero, 3)
  assert.equal((db.prepare(`SELECT estado FROM youtube_cola WHERE id = 'canal:@canalaleman'`).get() as any).estado, 'censo')
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM youtube_cola WHERE tipo = 'video'`).get() as any).n, 0, 'sin su ok, ningún video')
  assert.match((db.prepare(`SELECT contenido FROM corpus WHERE titulo = 'Canal de YouTube · Canal de Alemán'`).get() as any).contenido, /# Censo del canal · Canal de Alemán[\s\S]*Un curso de alemán[\s\S]*Costo del plan/)
  assert.match(avisos[0], /censo del canal «Canal de Alemán»/)
  assert.equal(yt.estadoYoutube(db).listaCanales[0].censo!.videos, 3)

  // Con su ok (y un cambio): lo entero a la cola, con subtítulos primero; lo resumido, a una pieza.
  await assert.rejects(k.aprobarCenso(db, 'canal:@canalaleman', { 'no existe': 'entero' }), /No hay un grupo/)
  yt._probarYoutube({ web: async () => new Response('', { status: 404 }) })
  const ok = await k.aprobarCenso(db, 'canal:@canalaleman', {}, T)
  assert.deepEqual([ok.enteros, ok.resumidos], [3, 0])
  const orden = (db.prepare(`SELECT id FROM youtube_cola WHERE de = 'canal:@canalaleman' ORDER BY creado_en`).all() as { id: string }[]).map((r) => r.id)
  assert.deepEqual(orden, ['vid00000002', 'vid00000001', 'vid00000003'], 'los que tienen subtítulos primero, después por vistas')
  await assert.rejects(k.aprobarCenso(db, 'canal:@canalaleman'), /Ya está corriendo/)

  // El ritmo: con 12 leídos en la última hora, lo del canal espera (lo mandado a mano, no).
  db.prepare(`UPDATE ajustes SET valor = '2' WHERE clave = 'youtube_ritmo_canal'`).run()
  db.prepare(`INSERT OR REPLACE INTO ajustes (clave, valor) VALUES ('youtube_ritmo_canal', '2')`).run()
  db.prepare(`UPDATE youtube_cola SET leido_en = ? WHERE id IN ('vid00000002', 'vid00000001')`).run(Date.now())
  assert.equal(k.dentroDelRitmo(db), false)
  // Terminar: cuando no queda nada suyo por leer.
  db.prepare(`UPDATE youtube_cola SET estado = 'listo' WHERE de = 'canal:@canalaleman'`).run()
  assert.equal(k.quizasTermino(db, 'canal:@canalaleman'), true)
  assert.equal(k.leerCenso(db, 'canal:@canalaleman')!.estado, 'terminado')
  assert.ok(HERRAMIENTAS.some((h) => h.nombre === 'aprobar_censo_canal') && GRUPOS.web.includes('ver_censo_canal'))
})

test('un canal grande: lo que va por título y descripción queda en una pieza barata y buscable', async () => {
  const db = abrir(':memory:')
  const videos = Array.from({ length: 40 }, (_, i) => v(`big${String(i).padStart(8, '0')}`, `Tema suelto número ${i} sobre algo distinto`, 60, 1000 - i))
  k._probarCanal({ escribir: async () => ({}) })
  db.prepare(`INSERT INTO youtube_cola (id, tipo, url, estado, creado_en) VALUES ('canal:@grande', 'canal', 'https://www.youtube.com/@grande', 'censo', 1)`).run()
  const c = await k.censar(db, 'canal:@grande', { videos, titulo: 'Canal Grande' }, T)
  assert.equal(Math.round(c.horas), 40)
  assert.equal(c.plan['formato:largos (más de 40 min)'], 'resumen', '40 h pasa del umbral y es un solo grupo: por título')
  assert.match(c.informe.conviene, /40 horas/)
  const r = await k.aprobarCenso(db, 'canal:@grande', {}, T)
  assert.deepEqual([r.enteros, r.resumidos], [0, 40])
  const p = db.prepare(`SELECT titulo, contenido FROM corpus WHERE titulo LIKE 'Canal Grande · por título%'`).get() as any
  assert.match(p.contenido, /## Tema suelto número 0[\s\S]*60 min · 1\.000 vistas/)
  assert.equal(k.leerCenso(db, 'canal:@grande')!.estado, 'terminado')
})
