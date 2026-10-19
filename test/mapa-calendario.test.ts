import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
delete process.env.GCAL_ICS_URLS

const { abrir } = await import('../src/db.ts')
const { insertar } = await import('../src/corpus.ts')
const { anotarSideQuest } = await import('../src/misiones.ts')
const { fijarHorario } = await import('../src/horario.ts')
const g = await import('../src/google-calendario.ts')
const agenda = await import('../src/agenda.ts')
const mapa = await import('../src/mapa.ts')
const radar = await import('../src/radar.ts')
const { agendaDelDia } = await import('../src/calendario.ts')
const { _probarModelo } = await import('../src/modelo.ts')

// Una cuenta de servicio de prueba (clave RSA generada acá) y un Google Calendar falso en memoria.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const conectar = () => {
  process.env.GOOGLE_CUENTA_SERVICIO = Buffer.from(JSON.stringify({ client_email: 'deprocast@proyecto.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) })).toString('base64')
  process.env.GOOGLE_CALENDARIO_ID = 'alguien@gmail.com'
}
const desconectar = () => { delete process.env.GOOGLE_CUENTA_SERVICIO; delete process.env.GOOGLE_CALENDARIO_ID }

type Ev = Record<string, any>
function googleFalso() {
  const eventos = new Map<string, Ev>()
  const pedidos: { metodo: string; url: string; cuerpo: any }[] = []
  let tokens = 0
  let n = 0
  g._probarGoogle(async (url, init) => {
    const metodo = init?.method ?? 'GET'
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      tokens++
      const jwt = new URLSearchParams(String(init?.body)).get('assertion')!
      const [cab, cuerpo, firma] = jwt.split('.')
      assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${cab}.${cuerpo}`), publicKey, Buffer.from(firma, 'base64url')), 'el JWT va firmado con la clave de la cuenta')
      return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 })
    }
    assert.equal((init?.headers as any).authorization, 'Bearer tok-1')
    const cuerpo = init?.body ? JSON.parse(String(init.body)) : null
    pedidos.push({ metodo, url, cuerpo })
    const m = /\/calendars\/([^/]+)\/events(?:\/([^?]+))?/.exec(url)!
    assert.equal(decodeURIComponent(m[1]), 'alguien@gmail.com')
    const id = m[2] ? decodeURIComponent(m[2]) : null
    if (metodo === 'GET' && !id) {
      // Como Google: solo lo que empieza dentro del rango.
      const q = new URL(url).searchParams
      const [desde, hasta] = [Date.parse(q.get('timeMin')!), Date.parse(q.get('timeMax')!)]
      const inicio = (e: Ev) => (e.start?.date ? new Date(`${e.start.date}T00:00:00`).getTime() : Date.parse(e.start?.dateTime))
      return new Response(JSON.stringify({ items: [...eventos.values()].filter((e) => inicio(e) >= desde && inicio(e) < hasta) }), { status: 200 })
    }
    if (metodo === 'GET') return eventos.has(id!) ? new Response(JSON.stringify(eventos.get(id!)), { status: 200 }) : new Response('{}', { status: 404 })
    if (metodo === 'POST') { const e = { id: `ev${++n}`, ...cuerpo }; eventos.set(e.id, e); return new Response(JSON.stringify(e), { status: 200 }) }
    if (metodo === 'PATCH') { if (!eventos.has(id!)) return new Response(JSON.stringify({ error: { message: 'Not Found' } }), { status: 404 }); const e = { ...eventos.get(id!), ...cuerpo }; eventos.set(id!, e); return new Response(JSON.stringify(e), { status: 200 }) }
    if (metodo === 'DELETE') { eventos.delete(id!); return new Response(null, { status: 204 }) }
    return new Response('{}', { status: 400 })
  })
  return { eventos, pedidos, tokens: () => tokens }
}

test('Google Calendar: cuenta de servicio (JWT firmado, un token para todo), y crear, listar, editar y borrar arman bien el pedido', async () => {
  conectar()
  const G = googleFalso()
  try {
    assert.ok(g.googleConectado())
    assert.equal(g.mailDeLaCuenta(), 'deprocast@proyecto.iam.gserviceaccount.com')
    const a = await g.crearGoogle({ titulo: 'Reunión', fecha: '2026-11-03', hora: '10:30', duracionMin: 90, lugar: 'Valencia' })
    assert.deepEqual(G.pedidos[0].cuerpo.start, { dateTime: '2026-11-03T10:30:00', timeZone: 'Europe/Madrid' })
    assert.deepEqual(G.pedidos[0].cuerpo.end, { dateTime: '2026-11-03T12:00:00', timeZone: 'Europe/Madrid' })
    const b = await g.crearGoogle({ titulo: 'Feria', fecha: '2026-11-05' })
    assert.deepEqual([G.pedidos[1].cuerpo.start, G.pedidos[1].cuerpo.end], [{ date: '2026-11-05' }, { date: '2026-11-06' }], 'sin hora: todo el día')
    G.eventos.get(a.id)!.start = { dateTime: '2026-11-03T10:30:00+01:00' }
    G.eventos.get(a.id)!.end = { dateTime: '2026-11-03T12:00:00+01:00' }
    const lista = await g.listarGoogle('2026-11-01', '2026-11-30')
    assert.match(G.pedidos[2].url, /singleEvents=true/)
    assert.deepEqual(lista.map((e) => [e.titulo, e.todoElDia]), [['Reunión', false], ['Feria', true]])
    assert.equal(new Date(lista[0].inicio).toTimeString().slice(0, 5), '10:30')
    await g.editarGoogle(a.id, { hora: '11:00' })
    assert.deepEqual(G.pedidos.at(-1)!.cuerpo.start, { dateTime: '2026-11-03T11:00:00', timeZone: 'Europe/Madrid' }, 'cambiar la hora conserva el día y la duración')
    assert.deepEqual(G.pedidos.at(-1)!.cuerpo.end, { dateTime: '2026-11-03T12:30:00', timeZone: 'Europe/Madrid' })
    await g.borrarGoogle(b.id)
    assert.ok(!G.eventos.has(b.id))
    assert.equal(G.tokens(), 1, 'el token se pide una vez y se reutiliza')
  } finally { desconectar() }
})

test('Calendario: junta las capas en el rango, lleva lo de Deprocast a Google sin duplicar, y la agenda del día sale de Google', async () => {
  const db = abrir(':memory:')
  const pieza = insertar(db, { fuente: 'operador', titulo: 'Nota', nivel: 'propia', origenId: 'n:1', contenido: 'algo' })!
  db.prepare(`INSERT INTO eventos (pieza_id, titulo, fecha, precision, hora, tipo, lugar, estado, huella, creado_en) VALUES (?, 'Charla en el barrio', '2026-11-04', 'dia', '19:00', 'futuro', 'Valencia', 'visto', 'h1', 1)`).run(pieza)
  const op = radar.guardarOportunidad(db, { titulo: 'Festival de cortos', url: 'https://festival.test', tipo: 'evento', cierre: '2026-11-02', donde: radar.lugarYFecha({ lugar: 'Valencia', fecha: '2026-11-06', lat: 39.47, lon: -0.38 }) })!
  const sq = anotarSideQuest(db, { titulo: 'Mandar la postulación', vence: '2026-11-03' })
  fijarHorario(db, [{ dias: [1, 2, 3, 4, 5], desde: '08:30', hasta: '17:30', que: 'Trabajo' }])

  const sinGoogle = await agenda.itemsDelCalendario(db, '2026-11-02', '2026-11-08')
  const capas = (c: string) => sinGoogle.items.filter((x) => x.capa === c)
  assert.deepEqual(capas('linea').map((x) => [x.titulo, x.fecha, x.hora]), [['Charla en el barrio', '2026-11-04', '19:00']])
  assert.deepEqual(capas('radar').map((x) => [x.titulo, x.fecha]).sort(), [['Cierra: Festival de cortos', '2026-11-02'], ['Festival de cortos', '2026-11-06']])
  assert.deepEqual(capas('mision').map((x) => x.titulo), ['Mandar la postulación'])
  assert.equal(capas('horario').length, 5, 'lunes a viernes, de fondo')
  assert.equal(sinGoogle.estado.conectado, false)
  assert.deepEqual((await agenda.itemsDelCalendario(db, '2026-11-02', '2026-11-08', new Set(['radar']))).items.every((x) => x.capa === 'radar'), true, 'respeta las capas')
  await assert.rejects(agenda.llevarAGoogle(db, 'oportunidad', op.id), /no está conectado/)

  conectar()
  const G = googleFalso()
  try {
    const e1 = await agenda.llevarAGoogle(db, 'oportunidad', op.id)
    assert.equal(G.eventos.get(e1.id)!.extendedProperties.private.deprocast, `oportunidad:${op.id}`)
    assert.equal(radar.leerOportunidad(db, op.id)!.estado, 'me_interesa', 'agendarla es que le interesa')
    assert.ok(radar.leerOportunidad(db, op.id)!.enCalendario)
    const e2 = await agenda.llevarAGoogle(db, 'oportunidad', op.id, { fecha: '2026-11-07' })
    assert.equal(e2.id, e1.id, 'no duplica: la edita')
    assert.equal(G.eventos.size, 1)
    assert.deepEqual(G.eventos.get(e1.id)!.start, { date: '2026-11-07' })
    await agenda.llevarAGoogle(db, 'mision', sq.id)
    await agenda.crearEvento({ titulo: 'Dentista', fecha: '2026-11-05', hora: '09:00' })
    G.eventos.forEach((e) => { if (e.start.dateTime && !/[+-]\d\d:\d\d$/.test(e.start.dateTime)) { e.start.dateTime += '+01:00'; e.end.dateTime += '+01:00' } })
    const con = await agenda.itemsDelCalendario(db, '2026-11-02', '2026-11-08')
    assert.deepEqual(con.items.filter((x) => x.capa === 'google').map((x) => x.titulo), ['Dentista'], 'lo llevado aparece como lo que es, no repetido')
    assert.ok(con.items.find((x) => x.id === `oportunidad:${op.id}`)!.google)
    const { eventos } = await agendaDelDia('2026-11-05')
    assert.deepEqual(eventos.map((e) => e.titulo), ['Dentista'], 'la agenda del día (Hoy, brújula) sale de Google')
    assert.equal(await agenda.quitarDeGoogle(db, 'mision', sq.id), true)
    assert.equal(G.eventos.size, 2)
  } finally { desconectar() }
})

test('Mapa: lugares, Línea y Radar con posición; lo que no tiene se busca una vez (con caché) y aparece; el Radar guarda dónde y cuándo', async () => {
  const db = abrir(':memory:')
  const buscados: string[] = []
  mapa._probarMapa({ esperar: async () => {}, buscar: async (t) => { buscados.push(t); return /valencia/i.test(t) ? { lat: 39.47, lon: -0.376, nombre: 'València, España' } : null } })
  db.prepare(`INSERT INTO entidades (tipo, nombre, meta, creada_en) VALUES ('lugar', 'Ruzafa', '{"lat":39.462,"lon":-0.373,"aprox":1}', 1)`).run()
  const pieza = insertar(db, { fuente: 'operador', titulo: 'Nota', nivel: 'propia', origenId: 'n:2', contenido: 'algo' })!
  db.prepare(`INSERT INTO eventos (pieza_id, titulo, fecha, precision, tipo, lugar, estado, huella, creado_en) VALUES (?, 'Concierto', '2026-11-04', 'dia', 'futuro', 'Valencia', 'visto', 'h2', 1)`).run(pieza)
  radar.guardarOportunidad(db, { titulo: 'Taller online', url: 'https://taller.test', tipo: 'evento', donde: radar.lugarYFecha({ online: true, lugar: 'online', fecha: '2026-11-10' }) })
  radar.guardarOportunidad(db, { titulo: 'Beca en Madrid', url: 'https://beca.test', tipo: 'beca', donde: radar.lugarYFecha({ lugar: 'Madrid', lat: 40.42, lon: -3.7 }) })

  const a = await mapa.puntosDelMapa(db)
  assert.deepEqual(a.puntos.map((p) => p.titulo).sort(), ['Beca en Madrid', 'Ruzafa'], 'el online no va al mapa; el evento todavía no tiene posición')
  assert.equal(a.sinUbicar, 1)
  await mapa.ubicar(db, 'Valencia')
  const b = await mapa.puntosDelMapa(db)
  assert.ok(b.puntos.some((p) => p.titulo === 'Concierto' && p.capa === 'linea'), 'buscado de fondo, aparece')
  await mapa.puntosDelMapa(db)
  assert.deepEqual(buscados, ['Valencia'], 'se busca una sola vez')
  assert.equal(mapa.enCache(db, 'Lugar que no existe'), undefined)
  await mapa.ubicar(db, 'Lugar que no existe')
  assert.equal(mapa.enCache(db, 'Lugar que no existe'), null, 'lo que no se encontró también queda anotado')

  // Las oportunidades de antes del mapa: dónde y cuándo, de a 20, y el lugar sin coordenadas se busca.
  db.prepare(`INSERT INTO oportunidades (titulo, url, tipo, descripcion, estado, origen, creada_en, actualizada_en) VALUES ('Feria en Valencia', 'https://feria.test', 'evento', 'Del 20 al 22 de noviembre', 'nueva', 'radar', 1, 1)`).run()
  const vieja = (db.prepare(`SELECT id FROM oportunidades WHERE url = 'https://feria.test'`).get() as any).id
  _probarModelo(async () => ({ texto: JSON.stringify({ oportunidades: [{ id: vieja, lugar: 'Valencia', online: false, lat: null, lon: null, fecha: '2026-11-20', fecha_fin: '2026-11-22' }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }))
  const r = await radar.ubicarOportunidades(db)
  assert.deepEqual(r, { ubicadas: 1, quedan: 0 })
  const o = radar.leerOportunidad(db, vieja)!
  assert.deepEqual([o.lugar, o.fecha, o.fechaFin, o.lat], ['Valencia', '2026-11-20', '2026-11-22', 39.47])
  assert.deepEqual(radar.lugarYFecha({ lugar: 'Online', fecha: 'el viernes', lat: 999 }), { lugar: null, online: 1, lat: null, lon: null, fecha: null, fechaFin: null }, 'lo que no tiene forma no entra')
})
