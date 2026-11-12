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

test('YouTube por Gemini, un webinar de una hora: va de a tramos de 20 min (el cupo por minuto), aguanta un 503 y un 429 por minuto, y corre los minutos si vienen del tramo', async () => {
  const antes = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'clave-de-prueba'
  try {
    const db = abrir(':memory:')
    const pedidos: { modelo: string; desde: number; hasta: number }[] = []
    const esperas: number[] = []
    const ok = (texto: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] }, finishReason: 'STOP' }] }))
    const llamadas: Record<number, number> = {}
    yt._probarYoutube({
      esperar: async (ms) => { esperas.push(ms) },
      web: async () => new Response('', { status: 429 }),
      servicio: async () => new Response('', { status: 404 }),
      gemini: async (url, init) => {
        const b = JSON.parse(String(init!.body))
        const vm = b.contents[0].parts[0].video_metadata
        const desde = parseInt(vm.start_offset ?? '0'), hasta = parseInt(vm.end_offset)
        pedidos.push({ modelo: /models\/([^:]+)/.exec(url)![1], desde, hasta })
        const n = (llamadas[desde] = (llamadas[desde] ?? 0) + 1)
        if (desde === 0) return n === 1 ? new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), { status: 503 })
          : ok('TITULO: Gestión de concesiones\nCANAL: Un canal\nIDIOMA: es\n[00:00] Bienvenidos al webinar.\n[19:30] Primer bloque.')
        if (desde === 1200) return n === 1 ? new Response(JSON.stringify({ error: { message: 'You exceeded your current quota', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }] } }), { status: 429 })
          : ok('[00:10] Segundo bloque, contado desde el tramo.\n[19:40] Fin del segundo.')
        return ok('[40:00] Tercer bloque.\n[55:50] Gracias por venir.\nEN PANTALLA\n[41:00] Concesiones 2026')
      },
    })
    await yt.encolarYoutube(db, 'https://www.youtube.com/watch?v=iaoX9Nc6JC4')
    await yt.trabajarYoutube(db)
    assert.equal((db.prepare('SELECT estado FROM youtube_cola WHERE id = ?').get('iaoX9Nc6JC4') as any).estado, 'listo')
    assert.deepEqual(pedidos.map((p) => [p.desde, p.hasta]), [[0, 1200], [0, 1200], [1200, 2400], [1200, 2400], [2400, 3600]], 'tres tramos, cada uno repetido una vez si falló')
    assert.ok(esperas.includes(9000), `el 429 por minuto espera lo que dice Google (+2 s): ${esperas}`)
    const p = db.prepare(`SELECT contenido FROM corpus WHERE contenido LIKE '%Bienvenidos%'`).get() as any
    assert.match(p.contenido, /\[00:00\] Bienvenidos[\s\S]*\[19:30\][\s\S]*\[20:10\] Segundo bloque[\s\S]*\[39:40\][\s\S]*\[55:50\] Gracias[\s\S]*\[41:00\] Concesiones 2026/)
    assert.equal(yt.geminiDisponible(db), true, 'nada de eso frena a Gemini')
  } finally {
    if (antes == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = antes
  }
})

test('YouTube por Gemini sin cupo del día (o Google saturado): prueba otro modelo; si tampoco, el video espera en la nube (no en la compu) y vuelve solo', async () => {
  const antes = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'clave-de-prueba'
  try {
    const db = abrir(':memory:')
    const modelos: string[] = []
    let sinCupo = true
    const avisos: string[] = []
    yt._probarRetomar(async (_db, t) => { avisos.push(t); return 'ok' })
    yt._probarYoutube({
      esperar: async () => {},
      web: async () => new Response('', { status: 429 }),
      servicio: async () => new Response('', { status: 404 }),
      gemini: async (url) => {
        modelos.push(/models\/([^:]+)/.exec(url)![1])
        if (sinCupo) return new Response(JSON.stringify({ error: { message: 'You exceeded your current quota', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }), { status: 429 })
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'TITULO: Puertos\nCANAL: X\nIDIOMA: en\n[00:00] How ports work.\n[05:40] The end.' }] }, finishReason: 'STOP' }] }))
      },
    })
    await yt.encolarYoutube(db, 'https://www.youtube.com/watch?v=K5AEqj2YmYw')
    await yt.trabajarYoutube(db)
    assert.deepEqual(modelos, ['gemini-2.5-flash', 'gemini-2.5-flash-lite'], 'el del día no se repite: prueba el otro modelo (cada uno tiene su cupo)')
    const f = db.prepare('SELECT estado, intentos, motivo FROM youtube_cola WHERE id = ?').get('K5AEqj2YmYw') as any
    assert.equal(f.estado, 'gemini')
    assert.equal(f.intentos, 0, 'esperar cupo no gasta intentos')
    assert.match(f.motivo, /espera cupo de Gemini \(vuelvo a probar a las/)
    assert.equal(yt.estadoYoutube(db).cuenta.gemini, 1)
    assert.equal(yt.estadoYoutube(db).gemini.hasta, yt.reinicioDiario())
    assert.equal(yt.reintentarConServicio(db), 0, 'mientras no hay cupo, ni lo intenta')

    // Volvió el cupo (pasó el reinicio): la vuelta de cada 15 minutos lo levanta y se lee.
    sinCupo = false
    db.prepare(`UPDATE ajustes SET valor = '0' WHERE clave = 'youtube_gemini_hasta'`).run()
    assert.equal(yt.reintentarConServicio(db), 1)
    await yt.trabajarYoutube(db)
    assert.equal((db.prepare('SELECT estado FROM youtube_cola WHERE id = ?').get('K5AEqj2YmYw') as any).estado, 'listo')
    assert.ok(!avisos.some((a) => /compu|npm run/.test(a)))

    // Google saturado de punta a punta: dos reintentos, el otro modelo, y espera media hora en la nube.
    const db2 = abrir(':memory:')
    let n503 = 0
    yt._probarYoutube({ gemini: async () => { n503++; return new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand. Please try again later.' } }), { status: 503 }) } })
    await yt.encolarYoutube(db2, 'https://www.youtube.com/watch?v=m3wNTex84R8')
    await yt.trabajarYoutube(db2)
    assert.equal(n503, 4, 'tres con el de siempre y uno con el otro modelo')
    assert.equal((db2.prepare('SELECT estado FROM youtube_cola WHERE id = ?').get('m3wNTex84R8') as any).estado, 'gemini')
    assert.equal(yt.correrMinutos(['[00:10] a'], 1200)[0], '[20:10] a')
    assert.equal(yt.correrMinutos(['[20:10] a'], 1200)[0], '[20:10] a', 'si ya vienen del video, no se tocan')
  } finally {
    if (antes == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = antes
  }
})
