import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'

const yt = await import('../src/youtube.ts')

test('YouTube desde el servidor con Gemini: la nube bloqueada no frena; sin cupo, sigue el siguiente camino y dice qué falta', async () => {
  const antes = { g: process.env.GEMINI_API_KEY, s: process.env.SUPADATA_API_KEY }
  delete process.env.SUPADATA_API_KEY
  try {
    const db = abrir(':memory:')
    const pedidos: any[] = []
    let responder: (n: number) => Response = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ titulo: 'Harvard’s Immortality Timeline', canal: 'Technomics', idioma: 'en', transcripcion: [{ t: '00:00', texto: 'After 2030, biology breaks.' }, { t: '00:45', texto: 'Entrevistador: ¿qué cambia?' }], en_pantalla: [{ t: '03:10', texto: 'Longevity escape velocity' }] }) }] } }] }))
    yt._probarYoutube({
      esperar: async () => {},
      // La nube, bloqueada (YouTube la marca como bot): ni la página ni los subtítulos.
      web: async () => new Response('', { status: 429 }),
      servicio: async () => new Response('', { status: 404 }),
      gemini: async (url, init) => { pedidos.push({ url, cuerpo: JSON.parse(String(init!.body)), clave: (init!.headers as any)['x-goog-api-key'] }); return responder(pedidos.length) },
    })

    // Sin ninguna vía: el aviso dice qué falta (y ya no manda a la compu).
    delete process.env.GEMINI_API_KEY
    assert.match(yt.avisoDeCola(db, 'video', 'pendiente'), /Falta GEMINI_API_KEY en las variables de NaN/)

    process.env.GEMINI_API_KEY = 'clave-de-prueba'
    const retomados: string[] = []
    yt._probarRetomar(async (_db, t) => { retomados.push(t); return 'ok' })
    assert.match(yt.avisoDeCola(db, 'video', 'pendiente'), /la lee Gemini, del lado de Google, en el servidor/)
    const v = await yt.encolarYoutube(db, 'https://www.youtube.com/watch?v=s71oPRnE-nw')
    await yt.trabajarYoutube(db)
    const fila = db.prepare('SELECT estado, pieza_id FROM youtube_cola WHERE id = ?').get('s71oPRnE-nw') as any
    assert.equal(fila.estado, 'listo')
    const p = db.prepare('SELECT contenido FROM corpus WHERE id = ?').get(v!.piezaId) as any
    assert.match(p.contenido, /\[00:00\] After 2030, biology breaks\.[\s\S]*\[00:45\] Entrevistador: ¿qué cambia\?[\s\S]*Lo que se ve en pantalla[\s\S]*\[03:10\] Longevity escape velocity/)
    assert.equal(pedidos[0].clave, 'clave-de-prueba')
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(retomados.length, 1, 'el video que él mandó: retoma lo que le pidió')
    assert.match(retomados[0], /ya llegó la transcripción del video «Harvard’s Immortality Timeline» \[#\d+\][\s\S]*solo proponé/)
    assert.equal(pedidos[0].cuerpo.contents[0].parts[0].file_data.file_uri, 'https://www.youtube.com/watch?v=s71oPRnE-nw', 'Google lee el video por su link')

    // Sin cupo: descansa unas horas, el video queda esperando y no se vuelve a pedir enseguida.
    responder = () => new Response(JSON.stringify({ error: { message: 'Resource has been exhausted (e.g. check quota).' } }), { status: 429 })
    await yt.encolarYoutube(db, 'https://www.youtube.com/watch?v=aaaaaaaaaaa')
    await yt.trabajarYoutube(db)
    assert.notEqual((db.prepare('SELECT estado FROM youtube_cola WHERE id = ?').get('aaaaaaaaaaa') as any).estado, 'listo')
    assert.equal(yt.geminiDisponible(db), false)
    assert.match(yt.estadoYoutube(db).gemini.motivo!, /exhausted/)
  } finally {
    if (antes.g == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = antes.g
    if (antes.s != null) process.env.SUPADATA_API_KEY = antes.s
  }
})
