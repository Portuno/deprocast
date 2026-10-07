import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCalendario } from '../src/calendario.ts'
import { crearMision } from '../src/misiones.ts'
import { _probarWeb, buscarWeb, cuotas } from '../src/web.ts'
import { buscarOportunidades, listarOportunidades, oportunidadesQueCierran, redactarOportunidad } from '../src/radar.ts'
import { pedirAportes, sumarAyudante } from '../src/ayudantes.ts'
import { alertasPendientes } from '../src/alertas.ts'

delete process.env.NAN_API_KEY
process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarCalendario(async () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR')
const T = new Date(2026, 9, 7, 10).getTime()

/** Una web falsa: Tavily devuelve resultados; las páginas, texto. */
function webFalsa(llamadas: string[] = []) {
  _probarWeb(async (url) => {
    llamadas.push(String(url))
    if (String(url).includes('tavily')) return new Response(JSON.stringify({ results: [
      { title: 'r/juegosdemesa', url: 'https://reddit.com/r/juegosdemesa', content: 'Comunidad de juegos de mesa en español' },
      { title: 'Festival de juegos Valencia', url: 'https://festival.example/valencia', content: 'Convocatoria abierta hasta el 9 de octubre' },
    ] }), { status: 200 })
    return new Response('<html><title>Página</title><body>Contenido de la página</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
  })
}

function modelo() {
  const vistos: string[] = []
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    vistos.push(String(o.mensajes.at(-1)!.content))
    const datos = s.includes('Pensás búsquedas') ? { consultas: ['juegos de mesa politicos comunidad', 'festival juegos valencia'] }
      : s.includes('sacá las oportunidades') ? { oportunidades: [
        { titulo: 'r/juegosdemesa', url: 'https://reddit.com/r/juegosdemesa', tipo: 'comunidad', descripcion: 'Subreddit en español', por_que: 'Ahí está su público', cierre: null },
        { titulo: 'Festival de juegos', url: 'https://festival.example/valencia', tipo: 'convocatoria', descripcion: 'Festival', por_que: 'Puede presentar el juego', cierre: '2026-10-09' },
        { titulo: 'Inventada', url: 'https://inventada.example', tipo: 'comunidad', descripcion: 'x', por_que: 'x' },
      ] }
      : s.includes('redactás al jugador') ? { borrador: 'Hola, soy creador de un juego…', donde: 'r/juegosdemesa', consejo: 'Leé las reglas del sub' }
      : null
    return { texto: datos ? JSON.stringify(datos) : 'ok', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  return vistos
}

test('web: rota por los que tienen clave y cuenta la cuota; sin clave, Wikipedia', async () => {
  const db = abrir(':memory:')
  const llamadas: string[] = []
  webFalsa(llamadas)
  process.env.TAVILY_API_KEY = 'falsa'
  const rs = await buscarWeb(db, 'algo', { ahora: T })
  assert.equal(rs[0].proveedor, 'tavily')
  assert.equal(cuotas(db, T).find((c) => c.id === 'tavily')!.usadas, 1)
  delete process.env.TAVILY_API_KEY
  _probarWeb(async (url) => {
    llamadas.push(String(url))
    return new Response(JSON.stringify({ query: { search: [{ title: 'Juego de mesa', snippet: 'Un <b>juego</b> de mesa…' }] } }), { status: 200 })
  })
  const w = await buscarWeb(db, 'juego de mesa', { ahora: T })
  assert.equal(w[0].proveedor, 'wikipedia')
  assert.equal(w[0].extracto, 'Un juego de mesa…')
})

test('radar: busca, lee, deja solo oportunidades reales (sin URLs inventadas), redacta en su voz y alerta lo que cierra', async () => {
  const db = abrir(':memory:')
  webFalsa()
  process.env.TAVILY_API_KEY = 'falsa'
  const vistos = modelo()
  const m = crearMision(db, { nivel: 'primaria', titulo: 'Conseguir jugadores para el juego', estado: 'activa' }, { ahora: T })
  const r = await buscarOportunidades(db, { misionId: m.id, ahora: T })
  assert.deepEqual(r.nuevas.map((o) => o.titulo), ['r/juegosdemesa', 'Festival de juegos'])
  assert.equal(r.nuevas[0].misionId, m.id)
  assert.match(vistos.find((v) => v.includes('Páginas leídas'))!, /Contenido de la página/)
  assert.equal((await buscarOportunidades(db, { misionId: m.id, ahora: T })).nuevas.length, 0, 'no repite')

  const conBorrador = await redactarOportunidad(db, r.nuevas[0].id, null, T)
  assert.match(conBorrador.borrador!, /Hola, soy creador[\s\S]*Dónde: r\/juegosdemesa/)
  assert.equal(conBorrador.estado, 'me_interesa')

  assert.equal(oportunidadesQueCierran(db, T).length, 1)
  assert.ok(alertasPendientes(db, T).some((a) => /Festival de juegos» cierra el 2026-10-09/.test(a.texto)))
  delete process.env.TAVILY_API_KEY
})

test('ayudante explorador: sale a la web por su primaria y el aporte trae los lugares encontrados', async () => {
  const db = abrir(':memory:')
  webFalsa()
  process.env.TAVILY_API_KEY = 'falsa'
  modelo()
  const m = crearMision(db, { nivel: 'primaria', titulo: 'Conseguir jugadores para el juego', estado: 'activa' }, { ahora: T })
  const a = sumarAyudante(db, m.id, { clase: 'explorador', ahora: T })
  assert.equal(a.agente!.clase, 'generativo')
  assert.match(a.agente!.instrucciones, /explorador web/)
  const r = await pedirAportes(db, { ahora: T })
  assert.equal(r.aportes.length, 1)
  assert.match(r.aportes[0].contenido, /r\/juegosdemesa/, 'el motor local devuelve el pedido: el pedido trae los lugares')
  assert.equal(listarOportunidades(db, { misionId: m.id }).length, 2)
  delete process.env.TAVILY_API_KEY
})
