import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-youtube-'))
process.env.MASTRO_TAKEOUT = path.join(tmp, 'takeout')
process.env.NAN_API_KEY = 'test'
delete process.env.SUPADATA_API_KEY

const { abrir } = await import('../src/db.ts')
const { _probarLector, guardarLink } = await import('../src/lector/index.ts')
const yt = await import('../src/youtube.ts')
const nube = await import('../src/takeout/nube.ts')
const { clasificarYoutube, elegirPista, transcripcionDeXml } = await import('../src/lector/youtube.ts')

yt._probarYoutube({ esperar: async () => {} })

/** Espera a que la cola deje de trabajar (el obrero corre de fondo). */
async function hasta(cond: () => boolean, ms = 3000) {
  for (let t = 0; t < ms; t += 20) { if (cond()) return; await new Promise((ok) => setTimeout(ok, 20)) }
  throw new Error('no llegó')
}
const estado = (db: any, id: string) => (db.prepare('SELECT estado FROM youtube_cola WHERE id = ?').get(id) as any)?.estado

/** Una página de video con su reproductor (y, si se pide, una pista de subtítulos en json3). */
const pagina = (o: { titulo: string; descripcion?: string; pistas?: any[]; bloqueado?: boolean }) => `<script>var ytInitialPlayerResponse = ${JSON.stringify(o.bloqueado
  ? { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Confirmá que no sos un bot' } }
  : { videoDetails: { title: o.titulo, author: 'Un canal', channelId: 'UC123', shortDescription: o.descripcion ?? '' }, playabilityStatus: { status: 'OK' }, microformat: { playerMicroformatRenderer: { publishDate: '2026-05-04' } }, captions: { playerCaptionsTracklistRenderer: { captionTracks: o.pistas ?? [] } } })};</script>"INNERTUBE_API_KEY":"clave-x","VISITOR_DATA":"vis-1"`

test('YouTube: qué es video y qué es canal, la mejor pista y el XML con su minuto', () => {
  assert.deepEqual(clasificarYoutube('https://youtu.be/abcanalVid00123XYZ'), { tipo: 'video', id: 'abcanalVid00123XYZ' })
  assert.deepEqual(clasificarYoutube('https://www.youtube.com/@UnCanal/videos'), { tipo: 'canal', id: '@uncanal' })
  assert.deepEqual(clasificarYoutube('https://www.youtube.com/channel/UCabc-123'), { tipo: 'canal', id: 'channel/UCabc-123' })
  assert.equal(clasificarYoutube('https://example.com/watch?v=abc'), null)
  assert.equal(elegirPista([{ baseUrl: 'a', languageCode: 'en' }, { baseUrl: 'b', languageCode: 'es', kind: 'asr' }, { baseUrl: 'c', languageCode: 'es' }])?.baseUrl, 'c', 'español hecho a mano primero')
  assert.equal(transcripcionDeXml('<transcript><text start="1" dur="2">Hola &amp;amp; chau</text><text start="50.5" dur="2">Sigue &#39;acá&#39;</text></transcript>'), "[0:01] Hola & chau\n\n[0:50] Sigue 'acá'")
})

test('YouTube: un video del chat entra a la cola, se lee, se completa, se destila (qué plantea, el título, fuentes, protoquántomos) y lo que recomienda se explora', async () => {
  const db = abrir(':memory:')
  _probarLector(async (url) => {
    if (url.includes('/oembed')) return new Response(JSON.stringify({ title: 'Cómo arrancar un piloto', author_name: 'Un canal' }), { status: 200 })
    if (url.includes('watch?v=vidUno00001')) return new Response(pagina({ titulo: 'Cómo arrancar un piloto', descripcion: 'Capítulos:\n0:00 Intro\nFuentes: https://ejemplo.org/paper-pilotos y el siguiente video https://youtu.be/recUno00001 · apoyame en https://patreon.com/uncanal', pistas: [{ baseUrl: 'https://yt.test/subs?v=1', languageCode: 'es', kind: 'asr' }] }), { status: 200 })
    if (url.includes('watch?v=recUno00001')) return new Response(pagina({ titulo: 'Recomendado' }), { status: 200 })
    if (url.includes('/youtubei/v1/player')) return new Response('{}', { status: 200 })
    if (url.startsWith('https://yt.test/subs')) return new Response(JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: 'Hola, hoy arrancamos.' }] }, { tStartMs: 70_000, segs: [{ utf8: 'Después la gente.' }] }] }), { status: 200 })
    if (url.startsWith('https://ejemplo.org/paper-pilotos')) return new Response(`<html><head><title>Paper sobre pilotos</title></head><body><article><h1>Paper sobre pilotos</h1><p>${'Los pilotos urbanos funcionan mejor cuando empiezan por un barrio chico y suman vecinos de a poco. '.repeat(12)}</p></article></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } })
    return new Response('', { status: 404 })
  })
  const vistos: { sistema: string; usuario: string }[] = []
  nube._probarTakeout({ destilar: async (_db, sistema, usuario) => { vistos.push({ sistema, usuario }); return { tesis: 'Empezar chico.', titulo_vs_contenido: 'Cumple lo que promete.', fuentes: [{ nombre: 'Paper sobre pilotos', link: 'https://ejemplo.org/paper-pilotos' }], resumen: 'Cuenta cómo arrancar.', valor: 2, temas: ['pilotos'], proyectos: [], personas: [], ideas: [{ texto: 'Arrancar por un barrio', proyecto: null }], decisiones: [], abierto: [], sobre_el: [] } } })
  nube._probarHistoria(async () => ({ eras: [], hoy: null, cambios: null, ideas_para_revisar: [], pregunta: '' }))
  const g = await guardarLink(db, 'https://youtu.be/vidUno00001')
  assert.match(g.lectura!.aviso!, /La transcripción está en camino/)
  await hasta(() => estado(db, 'vidUno00001') === 'listo' && estado(db, 'recUno00001') === 'compu')
  const p = db.prepare('SELECT * FROM corpus WHERE id = ?').get(g.piezaId) as any
  assert.equal(p.estado, 'disponible')
  assert.equal(p.fecha, '2026-05-04')
  assert.equal(p.fuente, 'youtube-un-canal')
  assert.match(p.contenido, /## Descripción[\s\S]*## Transcripción \(subtítulos automáticos\) · es\n\n\[0:00\] Hola, hoy arrancamos\.\n\n\[1:10\] Después la gente\./)
  assert.doesNotMatch(p.etiquetas, /sin-transcripcion/)
  // Lo que recomienda: el paper se lee (y se destila), el video va a la cola (un nivel), el patreon no.
  const paper = db.prepare(`SELECT * FROM corpus WHERE url LIKE 'https://ejemplo.org/paper-pilotos%'`).get() as any
  assert.ok(paper, 'el link de la descripción se leyó')
  assert.match(paper.meta, /"recomendadoPor":"Cómo arrancar un piloto"/)
  assert.equal((db.prepare(`SELECT de FROM youtube_cola WHERE id = 'recUno00001'`).get() as any).de, 'video:vidUno00001')
  assert.ok(!db.prepare(`SELECT 1 FROM corpus WHERE url LIKE '%patreon%'`).get())
  const cola = db.prepare(`SELECT pieza_id, lote FROM takeout_destilado`).all() as any[]
  assert.deepEqual(new Set(cola.map((c) => c.pieza_id)), new Set([g.piezaId, paper.id]))
  assert.match(cola[0].lote, /^youtube-\d{8}$/)

  // El destilado de un video pide qué plantea, si el título cumple y las fuentes; las ideas quedan como protoquántomos.
  await hasta(() => !db.prepare(`SELECT 1 FROM takeout_destilado WHERE estado IN ('pendiente', 'procesando')`).get() && !nube.takeoutTrabajando())
  await nube.trabajarTakeout(db)
  const delVideo = vistos.find((v) => /Cómo arrancar un piloto/.test(v.usuario) && /un video de YouTube del canal «Un canal», publicado el 2026-05-04/.test(v.usuario))!
  assert.ok(delVideo, 'se destila situado: un video, de qué canal y cuándo')
  assert.match(delVideo.sistema, /videos de YouTube que eligió para investigar[\s\S]*"tesis"[\s\S]*"titulo_vs_contenido"[\s\S]*"fuentes"/)
  assert.ok(vistos.some((v) => /una fuente que recomendó un video de YouTube/.test(v.usuario)), 'el paper también se destila')
  const dest = db.prepare(`SELECT contenido FROM corpus WHERE titulo = 'Destilado · Cómo arrancar un piloto'`).get() as any
  assert.match(dest.contenido, /### Qué plantea\nEmpezar chico\.[\s\S]*### El título\nCumple lo que promete\.[\s\S]*### Fuentes que recomienda\n- Paper sobre pilotos \(https:\/\/ejemplo\.org\/paper-pilotos\)/)
  assert.ok(db.prepare(`SELECT 1 FROM quantomos WHERE texto = 'Arrancar por un barrio'`).get(), 'protoquántomo')
})

test('YouTube: si la nube está bloqueada espera a la compu; la compu lo lee y lo sube; pedirlo de nuevo reintenta', async () => {
  const db = abrir(':memory:')
  _probarLector(async (url) => {
    if (url.includes('/oembed')) return new Response(JSON.stringify({ title: 'Un video', author_name: 'Un canal' }), { status: 200 })
    if (url.includes('/watch') || url.includes('/youtubei/v1/player')) return new Response(pagina({ titulo: 'Un video', bloqueado: true }), { status: 200 })
    return new Response('', { status: 404 })
  })
  const g = await guardarLink(db, 'https://www.youtube.com/watch?v=bloqUno0001')
  await hasta(() => estado(db, 'bloqUno0001') === 'compu')
  assert.match((db.prepare(`SELECT motivo FROM youtube_cola WHERE id = 'bloqUno0001'`).get() as any).motivo, /desde la nube: YouTube no dejó leer el video desde acá \(Confirmá que no sos un bot\)/)
  assert.equal((db.prepare('SELECT estado FROM corpus WHERE id = ?').get(g.piezaId) as any).estado, 'pendiente')
  assert.equal(yt.estadoYoutube(db).cuenta.compu, 1)

  // La compu pregunta, lee (desde casa sí anda) y sube.
  const items = yt.paraLaCompu(db)
  assert.deepEqual(items.map((i) => i.id), ['bloqUno0001'])
  assert.ok(yt.estadoYoutube(db).compu.activa)
  await yt.recibirDeLaCompu(db, { id: 'bloqUno0001', video: { titulo: 'Un video', canal: 'Un canal', descripcion: 'La descripción', transcripcion: '[0:00] Lo que dice el video.', idioma: 'es' } })
  assert.equal(estado(db, 'bloqUno0001'), 'listo')
  assert.match((db.prepare('SELECT contenido FROM corpus WHERE id = ?').get(g.piezaId) as any).contenido, /La descripción[\s\S]*\[0:00\] Lo que dice el video\./)

  // Un video sin subtítulos (según la compu) queda así; pedirlo de nuevo lo vuelve a la cola.
  await guardarLink(db, 'https://www.youtube.com/watch?v=mudoUno0001')
  await hasta(() => estado(db, 'mudoUno0001') === 'compu')
  await yt.recibirDeLaCompu(db, { id: 'mudoUno0001', video: { titulo: 'Mudo', descripcion: '', transcripcion: null, motivo: 'el video no tiene subtítulos' } })
  assert.equal(estado(db, 'mudoUno0001'), 'sin_subtitulos')
  await guardarLink(db, 'https://www.youtube.com/watch?v=mudoUno0001')
  assert.notEqual(estado(db, 'mudoUno0001'), 'sin_subtitulos', 'pedido de nuevo, vuelve a probar')
})

test('YouTube: un canal entero por el servicio de transcripciones (con trabajo asincrónico), y sin cupo espera a la compu', async () => {
  const db = abrir(':memory:')
  process.env.SUPADATA_API_KEY = 'clave-de-prueba'
  _probarLector(async (url) => {
    if (url.includes('/oembed')) return new Response(JSON.stringify({ title: 'Video del canal', author_name: 'Canal Grande' }), { status: 200 })
    if (url.includes('/watch') || url.includes('/youtubei/v1/player')) return new Response(pagina({ titulo: 'x', bloqueado: true }), { status: 200 })
    return new Response('', { status: 404 })
  })
  const pedidos: string[] = []
  let sinCupo = false
  yt._probarYoutube({
    servicio: async (url, init) => {
      pedidos.push(url)
      assert.equal((init?.headers as any)['x-api-key'], 'clave-de-prueba')
      if (sinCupo) return new Response(JSON.stringify({ error: 'limit-exceeded', message: 'Sin cupo' }), { status: 429 })
      if (url.includes('/youtube/channel/videos')) return new Response(JSON.stringify({ videoIds: ['canalVid001', 'canalVid002', 'canalVid003'], shortIds: [], liveIds: [] }), { status: 200 })
      if (url.includes('/youtube/video?id=')) return new Response(JSON.stringify({ id: 'c', title: `Video ${/id=(\w+)/.exec(url)![1]}`, description: 'Desc', channel: { id: 'UCg', name: 'Canal Grande' }, uploadDate: '2026-01-02T00:00:00Z' }), { status: 200 })
      if (url.includes('/transcript?url=')) return /canalVid001/.test(url) ? new Response(JSON.stringify({ jobId: 'job-1' }), { status: 202 }) : new Response(JSON.stringify({ content: [{ text: 'Directo del servicio.', offset: 0, duration: 1000 }], lang: 'es' }), { status: 200 })
      if (url.endsWith('/transcript/job-1')) return new Response(JSON.stringify({ status: 'completed', content: [{ text: 'Vino por trabajo.', offset: 61_000, duration: 1000 }], lang: 'es' }), { status: 200 })
      return new Response('{}', { status: 404 })
    },
  })
  try {
    const r = await yt.importarYoutube(db, 'https://www.youtube.com/@CanalGrande', { max: 2 })
    assert.equal(r.canales, 1)
    await hasta(() => estado(db, 'canalVid001') === 'listo' && estado(db, 'canalVid002') === 'listo')
    assert.equal(estado(db, 'canalVid003'), undefined, 'respeta el máximo por canal')
    assert.ok(pedidos.some((u) => /channel\/videos\?id=https%3A%2F%2Fwww\.youtube\.com%2F%40canalgrande&limit=2&type=video/.test(u)))
    assert.ok(pedidos.some((u) => /mode=native/.test(u)), 'solo subtítulos reales (no los genera con IA)')
    const canalVid001 = db.prepare(`SELECT c.* FROM corpus c JOIN youtube_cola y ON y.pieza_id = c.id WHERE y.id = 'canalVid001'`).get() as any
    assert.match(canalVid001.contenido, /\[1:01\] Vino por trabajo\./)
    assert.equal(canalVid001.fecha, '2026-01-02')
    assert.match((db.prepare(`SELECT contenido FROM corpus WHERE origen_id = 'url:https://youtube.com/@canalgrande'`).get() as any).contenido, /Se pidieron 2 videos/)

    // Sin cupo: se deja descansar y lo que llega espera a la compu.
    sinCupo = true
    await yt.importarYoutube(db, 'https://youtu.be/otroUno0001')
    await hasta(() => estado(db, 'otroUno0001') === 'compu')
    const s = yt.estadoYoutube(db)
    assert.equal(s.servicio.disponible, false)
    assert.match(String(s.servicio.motivo), /429/)
  } finally {
    delete process.env.SUPADATA_API_KEY
  }
})
