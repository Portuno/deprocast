import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
const { abrir } = await import('../src/db.ts')
const ob = await import('../src/observatorio.ts')
const gr = await import('../src/grafo/index.ts')

const T = new Date(2026, 10, 1, 10).getTime()
const H = 3_600_000
const consultas: string[] = []
const leidas: string[] = []
const usuarios: string[] = []
let fuerte = false

ob._probarObservatorio({
  buscador: async (_db, q) => {
    consultas.push(q)
    const k = consultas.length
    if (q.startsWith('site:x.com')) return [{ titulo: 'Un tuit', url: `https://x.com/alguien/status/${k}`, extracto: 'Que lo entrevisten de una vez, sin preguntas pactadas', proveedor: 't' }]
    if (q.startsWith('site:reddit.com')) return [{ titulo: 'Hilo en r/spain', url: `https://www.reddit.com/r/spain/comments/${k}`, extracto: 'Debate sobre por qué no lo invitan', proveedor: 't' }]
    if (q.startsWith('site:youtube.com')) return [{ titulo: 'Clip del programa', url: `https://www.youtube.com/watch?v=v${k}`, extracto: 'Comentarios pidiendo la entrevista', proveedor: 't' }]
    if (q.endsWith('noticias')) return [{ titulo: 'Nota en un diario', url: `https://diario.example/nota-${k}`, extracto: 'El programa responde a las críticas', proveedor: 't' }]
    return [{ titulo: 'Hilo en un foro', url: `https://foro.example/hilo-${k}`, extracto: 'Los foreros comentan la ausencia', proveedor: 't' }]
  },
  lector: async (url) => { leidas.push(url); return { titulo: 'Página', texto: `Texto leído de ${url}: la entrevista que falta, las preguntas pactadas y la audiencia que la pide.` } },
  modelo: async (_db, _s, usuario) => {
    usuarios.push(usuario)
    const urlX = /https:\/\/x\.com\/\S+/.exec(usuario)?.[0]
    const urlR = /https:\/\/www\.reddit\.com\/\S+/.exec(usuario)?.[0]
    return {
      plataformas: [
        { plataforma: 'x', narrativas: [{ frase: 'Piden la entrevista sin preguntas pactadas', peso: 4, ejemplos: [urlX, 'https://inventado.example/x'] }], tono: 'reclamo' },
        { plataforma: 'inventada', narrativas: [{ frase: 'no existe', peso: 5, ejemplos: [] }] },
      ],
      saltos: [{ idea: 'Las preguntas pactadas', de: 'x', a: 'reddit', evidencia: [urlX, urlR] }, { idea: 'consigo misma', de: 'x', a: 'x', evidencia: [] }],
      nuevo: ['Aparece el reclamo por las preguntas pactadas'], resumen: 'En X piden la entrevista; en Reddit lo debaten.', fuerte,
    }
  },
})

test('Una ronda: una búsqueda por plataforma (con site:), lee solo lo que se deja leer, guarda links que volvieron y resume sin inventar', async () => {
  const db = abrir(':memory:')
  const t = ob.seguirTema(db, { nombre: 'La entrevista que falta', consultas: ['programa entrevista invitado', 'segunda búsqueda'] }, T)
  assert.deepEqual(t.plataformas, ['x', 'reddit', 'youtube', 'noticias', 'foros'])
  const r = await ob.ronda(db, t.id, T)
  assert.equal(r.busquedas, 5)
  assert.deepEqual(consultas.slice(-5), ['site:x.com programa entrevista invitado', 'site:reddit.com programa entrevista invitado', 'site:youtube.com programa entrevista invitado', 'programa entrevista invitado noticias', 'programa entrevista invitado foro OR meneame OR forocoches'])
  assert.equal(r.nuevos, 5)
  assert.ok(leidas.every((u) => !/x\.com|youtube\.com/.test(u)) && leidas.length === 3, 'X y YouTube no se leen; hasta tres páginas')
  const res = r.resumen!
  assert.deepEqual(res.plataformas.map((p) => p.plataforma), ['x'], 'una plataforma inventada no entra')
  assert.ok(res.plataformas[0].narrativas[0].ejemplos.every((u) => u.startsWith('https://x.com/')), 'ni links que no devolvió el buscador')
  assert.deepEqual(res.saltos.map((s) => [s.de, s.a]), [['x', 'reddit']])
  // La segunda ronda: la otra consulta, sin repetir items, contra la anterior.
  const r2 = await ob.ronda(db, t.id, T + H)
  assert.match(consultas.at(-1)!, /segunda búsqueda/)
  assert.match(usuarios.at(-1)!, /Ronda anterior: En X piden/)
  assert.equal(ob.itemsDe(db, t.id).length, 10)
  assert.equal(r2.nuevos, 5)
})

test('El latido: la cadencia, el modo en vivo (cada 15 minutos) y solo lo fuerte va a Hoy', async () => {
  const db = abrir(':memory:')
  const t = ob.seguirTema(db, { nombre: 'Tema', cadaHoras: 12 }, T)
  fuerte = false
  assert.deepEqual(await ob.latidoObservatorio(db, T), [], 'primera ronda, sin nada fuerte')
  assert.equal(ob.rondasDe(db, t.id).length, 1)
  await ob.latidoObservatorio(db, T + 2 * H)
  assert.equal(ob.rondasDe(db, t.id).length, 1, 'no le toca todavía')
  fuerte = true
  const avisos = await ob.latidoObservatorio(db, T + 13 * H)
  assert.equal(ob.rondasDe(db, t.id).length, 2)
  assert.match(avisos[0], /Tema.*En X piden.*Salta de X a Reddit/)
  // En vivo: cada 15 minutos, y cada ronda avisa.
  fuerte = false
  ob.editarTema(db, t.id, { intensivoHasta: T + 20 * H }, T + 13 * H)
  assert.equal(ob.leToca(db, ob.leerTema(db, t.id)!, T + 13 * H + 10 * 60_000), false)
  const vivo = await ob.latidoObservatorio(db, T + 13 * H + 16 * 60_000)
  assert.match(vivo[0], /\(en vivo\)/)
  // El tope del día: no corre.
  db.prepare(`INSERT OR REPLACE INTO ajustes (clave, valor) VALUES ('tokens_dia_max', '1')`).run()
  db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'x', 'generativo', 'GEN-0001', 10, 10, 1, 200, ?)`).run(T + 30 * H)
  const n = ob.rondasDe(db, t.id).length
  await ob.latidoObservatorio(db, T + 30 * H)
  assert.equal(ob.rondasDe(db, t.id).length, n)
})

test('Sin cuota en los buscadores, la ronda avisa en el tema; el grafo del debate se arma con lo encontrado; ver_observatorio', async () => {
  const db = abrir(':memory:')
  const t = ob.seguirTema(db, { nombre: 'Debate', plataformas: ['noticias', 'foros'] }, T)
  await ob.ronda(db, t.id, T)
  const g = gr.crearGrafo(db, { nombre: 'El debate', fuentes: [{ tipo: 'observatorio', id: t.id }] }, T)
  const f = await gr.recalcular(db, g.id, { ahora: T })
  assert.ok(f && f.nodos.some((n) => /entrevista|pactadas|audiencia/.test(n.forma)), 'el grafo lee lo encontrado')
  const v = ob.verObservatorio(db, 'debat') as any[]
  assert.equal(v[0].tema, 'Debate')
  assert.match(v[0].nota, /indexan los buscadores/)
  ob._probarObservatorio({ buscador: async () => { throw new Error('No pude buscar en la web: Tavily 432') } })
  await assert.rejects(ob.ronda(db, t.id, T + H), /No pude buscar/)
  assert.match(ob.leerTema(db, t.id)!.aviso!, /Tavily 432/)
})
