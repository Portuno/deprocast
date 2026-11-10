import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fijarAjuste, ajuste, type Db } from '../src/db.ts'
import { _probarCommits, aplicarCommits, cerradasRecientes, reabrirPropuesta, referencias, revisarCommits } from '../src/fragua-commits.ts'
import { _probarVencimiento, leerVencimiento, type CommitRef } from '../src/fragua-nube.ts'
import { avisoQueToca, encolar, estadoToken, forjarCola, sacarDeCola } from '../src/fragua-token.ts'
import { anotarBloqueo, propuestaPorBloqueos } from '../src/autocritica.ts'
import { abiertaParecida, cubrirCon, gruposDePropuestas, sumarAPropuesta } from '../src/fragua-grupos.ts'
import { estadoReal } from '../src/fragua.ts'
import { armarHistorial } from '../src/chat/historial.ts'
import { crearConversacion, mensajes } from '../src/chat/index.ts'
import { anotarRegistro, leerBitacora, NOTA_MEZCLA } from '../src/bitacora-dev.ts'

const HORA = 3_600_000
const DIA = 24 * HORA
const propuesta = (db: Db, titulo: string, detalle = 'Detalle de la propuesta con texto suficiente.', o: { area?: string; prioridad?: string } = {}) =>
  Number(db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, creada_en) VALUES (?, ?, ?, ?, 'abierta', ?)`).run(titulo, detalle, o.area ?? 'motores', o.prioridad ?? 'media', Date.now()).lastInsertRowid)
const leer = (db: Db, id: number) => db.prepare('SELECT * FROM propuestas WHERE id = ?').get(id) as any
const commit = (sha: string, mensaje: string, fecha = '2026-11-10T10:00:00Z', autor = 'Portuno'): CommitRef => ({ sha, mensaje, fecha, autor, url: `https://github.com/x/y/commit/${sha}` })

// ─── #211: el commit que nombra «Fragua #N» la cierra ───────────────────

test('#211: las formas de nombrar una propuesta en un commit, con su intención', () => {
  const ids = (m: string) => referencias(m).map((r) => r.id)
  assert.deepEqual(ids('Fragua #204: armar un PDF'), [204])
  assert.deepEqual(ids('Fragua #190, #202, #200 y #201: sin tope'), [190, 202, 200, 201])
  assert.deepEqual(ids('arreglo fragua-203 y algo más'), [203])
  assert.deepEqual(ids('Fragua:203 listo'), [203])
  assert.deepEqual(ids('#205: separar voces'), [205], 'un título que arranca con #N')
  assert.deepEqual(ids('Forja #12: algo (Fragua #88)'), [88], 'el número de la forja no es una propuesta')
  assert.deepEqual(ids('Fragua #7 aplicada'), [], 'el merge de una forja no nombra una propuesta')
  assert.deepEqual(ids('Arreglo el PR #12 de otro'), [], 'un #N suelto en el medio no cuenta')
  assert.equal(referencias('Fragua #179 descartada a pedido suyo')[0].intencion, 'descartada')
  const p = referencias('Fragua #50 a medias: falta: el botón de la pantalla')[0]
  assert.equal(p.intencion, 'parcial')
  assert.match(p.falta!, /el botón de la pantalla/)
})

test('#211: un commit cierra la propuesta con link, fecha y autor; a medias queda abierta; gana el último; reabrir la deja abierta', async () => {
  const db = abrir(':memory:')
  const a = propuesta(db, 'Armar PDF')
  const b = propuesta(db, 'Separar voces')
  const c = propuesta(db, 'Cerrada a mano')
  db.prepare(`UPDATE propuestas SET estado = 'aceptada', cerrada_por = 'mano', resuelta_en = 1 WHERE id = ?`).run(c)
  const r = aplicarCommits(db, [
    commit('aaa1111', `Fragua #${a}: armar un PDF desde el chat`, '2026-11-10T10:00:00Z'),
    commit('bbb2222', `Fragua #${b} a medias: falta: lo de Telegram`, '2026-11-10T11:00:00Z'),
    commit('ccc3333', `Fragua #${c}: algo`, '2026-11-10T12:00:00Z'),
  ])
  assert.deepEqual(r.cerradas, [a])
  assert.deepEqual(r.parciales, [b])
  const pa = leer(db, a)
  assert.equal(pa.estado, 'aceptada')
  assert.equal(pa.cerrada_por, 'commit')
  const cierre = JSON.parse(pa.cierre)
  assert.equal(cierre.sha, 'aaa1111')
  assert.equal(cierre.autor, 'Portuno')
  assert.match(cierre.url, /commit\/aaa1111$/)
  assert.equal(leer(db, b).estado, 'abierta')
  assert.match(leer(db, b).nota, /falta lo de Telegram/)
  assert.equal(leer(db, c).cerrada_por, 'mano', 'la cerrada a mano no cambia, solo suma historial')
  assert.equal(JSON.parse(leer(db, c).cierres).length, 1)
  // Dos commits la nombran: gana el último y queda el historial.
  aplicarCommits(db, [commit('ddd4444', `Fragua #${a}: retoque`, '2026-11-10T13:00:00Z')])
  assert.equal(JSON.parse(leer(db, a).cierre).sha, 'ddd4444')
  assert.equal(JSON.parse(leer(db, a).cierres).length, 2)
  // Visible como cerrada por commit, y reabrible: ese commit no vuelve a cerrarla.
  assert.equal(cerradasRecientes(db).find((x) => x.id === a)?.cerradaPor, 'commit')
  reabrirPropuesta(db, a)
  assert.equal(leer(db, a).estado, 'abierta')
  aplicarCommits(db, [commit('ddd4444', `Fragua #${a}: retoque`, '2026-11-10T13:00:00Z')])
  assert.equal(leer(db, a).estado, 'abierta', 'el commit deshecho no la vuelve a cerrar')
})

test('#211: revisarCommits lee desde la última vez y no cuenta los commits de la Fragua misma', async () => {
  const db = abrir(':memory:')
  const a = propuesta(db, 'Una')
  const vistos: string[] = []
  _probarCommits(async (desde) => {
    vistos.push(desde)
    return [commit('eee5555', `Fragua #${a}: listo`, '2026-11-09T10:00:00Z'), commit('fff6666', `Forja #3: algo (Fragua #${a})\n\nForjado y probado por La Fragua de Deprocast`, '2026-11-09T11:00:00Z')]
  })
  const r = await revisarCommits(db, Date.parse('2026-11-10T00:00:00Z'))
  assert.equal(r.leidos, 2)
  assert.deepEqual(r.cerradas, [a])
  assert.equal(JSON.parse(leer(db, a).cierre).sha, 'eee5555')
  assert.match(vistos[0], /^2026-10-20/, 'la primera vez, tres semanas para atrás')
  assert.match(ajuste(db, 'fragua_commits_desde')!, /^2026-11-09T10:59/)
})

// ─── #215: el token avisa antes de vencer; vencido, la propuesta espera en cola ─

test('#215: el vencimiento sale de GitHub y avisa a los 7 días, a las 48 h, a las 24 h y vencido, una vez cada uno', () => {
  process.env.MASTRO_REPO = 'x/y'
  process.env.GITHUB_FRAGUA_TOKEN = 'token-de-prueba'
  try {
    assert.equal(leerVencimiento('2027-02-08 12:00:00 -0300'), Date.parse('2027-02-08T12:00:00-03:00'))
    assert.equal(leerVencimiento('2027-02-08 15:00:00 UTC'), Date.parse('2027-02-08T15:00:00Z'))
    const db = abrir(':memory:')
    const vence = Date.parse('2027-02-08T12:00:00-03:00')
    _probarVencimiento({ vence, vencido: false })
    assert.equal(avisoQueToca(db, vence - 10 * DIA), null, 'a diez días, nada')
    const seis = avisoQueToca(db, vence - 6 * DIA)!
    assert.match(seis, /vence el 8\/2\/2027/)
    assert.match(seis, /Regenerate token/)
    assert.match(seis, /GITHUB_FRAGUA_TOKEN/)
    assert.equal(avisoQueToca(db, vence - 5 * DIA), null, 'el de 7 días no se repite')
    assert.match(estadoToken(db, vence - 6 * DIA).aviso!, /token vence el 8\/2\/2027/i, 'la pantalla lo dice antes de forjar')
    assert.match(avisoQueToca(db, vence - 40 * HORA)!, /faltan 40 horas/)
    assert.match(avisoQueToca(db, vence - 20 * HORA)!, /faltan 20 horas/)
    assert.equal(avisoQueToca(db, vence - 19 * HORA), null)
    assert.match(avisoQueToca(db, vence + HORA)!, /Venció el token/)
    // Un token nuevo (otra fecha): los avisos vuelven a empezar.
    _probarVencimiento({ vence: vence + 90 * DIA, vencido: false })
    assert.equal(avisoQueToca(db, vence + HORA), null)
    assert.match(avisoQueToca(db, vence + 85 * DIA)!, /vence el/)
  } finally {
    delete process.env.MASTRO_REPO
    delete process.env.GITHUB_FRAGUA_TOKEN
    _probarVencimiento({ vence: null, vencido: null })
  }
})

test('#215: con el token vencido la propuesta queda en cola, y se forja sola cuando vuelve (o se saca)', async () => {
  process.env.MASTRO_REPO = 'x/y'
  process.env.GITHUB_FRAGUA_TOKEN = 'token-de-prueba'
  try {
    const db = abrir(':memory:')
    const a = propuesta(db, 'En cola')
    const b = propuesta(db, 'Otra en cola')
    _probarVencimiento({ vence: Date.now() - DIA, vencido: true })
    encolar(db, a)
    encolar(db, b, Date.now() + 1)
    assert.equal(estadoToken(db).enCola, 2)
    const forjadas: number[] = []
    assert.equal(await forjarCola(db, async (id) => { forjadas.push(id) }), null, 'vencido: no forja')
    sacarDeCola(db, b)
    _probarVencimiento({ vence: Date.now() + 90 * DIA, vencido: false })
    assert.equal(await forjarCola(db, async (id) => { forjadas.push(id) }), a)
    assert.deepEqual(forjadas, [a])
    assert.equal(leer(db, a).en_cola, null)
    assert.equal(estadoToken(db).enCola, 0)
  } finally {
    delete process.env.MASTRO_REPO
    delete process.env.GITHUB_FRAGUA_TOKEN
    _probarVencimiento({ vence: null, vencido: null })
  }
})

// ─── #212: los bloqueos arman su propuesta ──────────────────────────────

test('#212: más de tres bloqueos en una hora arman una sola propuesta con el paso y los tiempos; la hora siguiente suma y dice si mejoró', () => {
  const db = abrir(':memory:')
  const t = Date.parse('2026-11-10T10:00:00Z')
  for (let i = 0; i < 3; i++) anotarBloqueo(db, 2500, ['liga:correr'], t - i * 60_000)
  assert.equal(propuestaPorBloqueos(db, t), null, 'tres no alcanzan')
  anotarBloqueo(db, 4800, ['liga:correr', 'GET /api/hoy'], t - 5 * 60_000)
  anotarBloqueo(db, 1500, ['otro'], t - 6 * 60_000) // menos de dos segundos: no cuenta
  anotarBloqueo(db, 120_000, ['dormido'], t - 7 * 60_000) // más de un minuto: el contenedor dormido
  const r = propuestaPorBloqueos(db, t)!
  assert.ok(r.nueva)
  const p = leer(db, r.id)
  assert.match(p.titulo, /liga:correr/)
  assert.match(p.detalle, /4 bloqueos, el peor de 4800 ms/)
  assert.match(p.detalle, /liga:correr ×4 \(peor 4800 ms\)/)
  assert.equal(p.origen, 'bloqueos')
  assert.equal(p.prioridad, 'alta')
  // Otra hora, el mismo paso: suma a la misma, con la tendencia.
  for (let i = 0; i < 5; i++) anotarBloqueo(db, 9000, ['liga:correr'], t + HORA - i * 60_000)
  const r2 = propuestaPorBloqueos(db, t + HORA)!
  assert.equal(r2.id, r.id)
  assert.equal(r2.nueva, false)
  assert.match(leer(db, r.id).detalle, /OTRA HORA CON BLOQUEOS.*empeoró/s)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM propuestas WHERE origen = 'bloqueos'`).get() as { n: number }).n, 1)
})

// ─── #208: por causa raíz ──────────────────────────────────────────────

test('#208: las de la misma causa se agrupan con nombre, una nueva se suma a la que ya estaba, y un grupo se cubre de una', () => {
  const db = abrir(':memory:')
  const a1 = propuesta(db, 'El reproceso se corta cuando él cierra la pestaña', 'El AbortSignal del request se hereda al trabajo de fondo y lo mata.', { prioridad: 'alta' })
  const a2 = propuesta(db, 'Las cargas largas mueren a mitad', 'Cuando se corta el pedido, abort del fetch heredado cancela la ingesta.')
  const n1 = propuesta(db, '/api/personas tarda', 'Hace una consulta por cada fila de personas (N+1).')
  const n2 = propuesta(db, '/api/entidades tarda', 'Patrón N + 1 en node:sqlite: una consulta por fila.')
  const suelta = propuesta(db, 'Botón de tema oscuro', 'Que la pantalla tenga un botón para cambiar de tema.', { area: 'pantalla' })
  const grupos = gruposDePropuestas(db)
  assert.equal(grupos.length, 2)
  const abort = grupos.find((g) => g.causa === 'abort')!
  assert.deepEqual(abort.ids, [a1, a2])
  assert.equal(abort.principal, a1, 'la de prioridad alta encabeza')
  assert.match(abort.nombre, /corte del pedido/)
  assert.deepEqual(grupos.find((g) => g.causa === 'n+1')!.ids, [n1, n2])
  assert.ok(!grupos.some((g) => g.ids.includes(suelta)))
  // Una nueva con la misma causa: avisa cuál ya está (y se suma ahí en vez de abrir otra).
  const ya = abiertaParecida(db, 'Otra consulta N+1 en /api/hoy', 'una consulta por fila otra vez')!
  assert.ok([n1, n2].includes(ya.id))
  sumarAPropuesta(db, ya.id, 'Otra consulta N+1 en /api/hoy', 'una consulta por fila otra vez')
  assert.match(leer(db, ya.id).detalle, /SUMADO EL .* \(misma causa\)/)
  assert.equal(abiertaParecida(db, 'Que el mapamundi tenga hexágonos de colores', 'Color por disputa ganada.'), null)
  // Cerrar las otras como cubiertas por la principal, con el rastro.
  assert.deepEqual(cubrirCon(db, a1, [a1, a2]).cubiertas, [a2])
  assert.equal(leer(db, a2).cubierta_por, a1)
  assert.equal(leer(db, a2).cerrada_por, 'grupo')
  assert.equal(leer(db, a1).estado, 'abierta', 'la principal sigue: se cierra con su forja')
})

test('#208: una propuesta que habla de muchas causas a la vez no junta a todas', () => {
  const db = abrir(':memory:')
  propuesta(db, 'Agrupar por causa raíz', 'Ej.: el abort heredado, el N+1 de node:sqlite, el event loop clavado por trabajo síncrono.')
  propuesta(db, 'Las cargas mueren', 'abort heredado del request')
  propuesta(db, '/api/x lenta', 'N+1: una consulta por fila')
  assert.equal(gruposDePropuestas(db).length, 0)
})

// ─── #209: el estado real de cada forja ─────────────────────────────────

test('#209: estado real: en rama con o sin tests, aplicada en la nube y corriendo, y marcada si lleva una semana sin aplicar', () => {
  const base = { modo: 'pr' as const, rama: 'fragua/9', prNumero: 9, prUrl: 'https://github.com/x/y/pull/9', mergeSha: null, vigilada: false, resueltaEn: null, archivos: ['src/a.ts', 'test/a.test.ts'] }
  const ahora = Date.parse('2026-11-10T12:00:00Z')
  const lista = estadoReal({ ...base, estado: 'lista', creadaEn: ahora - 2 * DIA }, ahora)!
  assert.equal(lista.clave, 'en_rama')
  assert.equal(lista.pruebas, true)
  assert.match(lista.texto, /pull request #9, pasa typecheck y tests/)
  assert.equal(lista.viejo, false)
  assert.equal(estadoReal({ ...base, estado: 'lista', creadaEn: ahora - 8 * DIA }, ahora)!.viejo, true)
  assert.equal(estadoReal({ ...base, estado: 'rota', creadaEn: ahora }, ahora)!.pruebas, false)
  assert.match(estadoReal({ ...base, estado: 'aplicada', mergeSha: 'abc1234567', vigilada: true, creadaEn: ahora }, ahora)!.texto, /aplicada en la nube \(abc1234\), corriendo/)
  assert.match(estadoReal({ ...base, estado: 'aplicada', mergeSha: 'abc1234567', creadaEn: ahora }, ahora)!.texto, /esperando que la nube la tome/)
  assert.equal(estadoReal({ ...base, estado: 'descartada', creadaEn: ahora }, ahora)!.clave, 'descartada')
})

// ─── #214: cada cosa con su fecha absoluta ──────────────────────────────

test('#214: en un turno de martes, lo del lunes llega con su fecha y aparte; si todo es de hoy, no se agrega nada', async () => {
  const db = abrir(':memory:')
  const c = crearConversacion(db)
  const martes = new Date(2026, 10, 10, 9, 0).getTime()
  const lunes = new Date(2026, 10, 9, 20, 47).getTime()
  const ins = db.prepare('INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, ?, ?, ?)')
  ins.run(c.id, 'operador', 'Mañana tengo la reunión de las 15', lunes)
  ins.run(c.id, 'asistente', 'Anotado.', lunes + 1000)
  ins.run(c.id, 'operador', '¿Qué tengo hoy?', martes)
  const h = await armarHistorial(db, mensajes(db, c.id), { ahora: martes + 60_000 })
  const textos = h.map((m) => `${m.role}: ${m.content}`)
  assert.match(textos[0], /^system: — Mensajes del lun 9\/11 \(2026-11-09\): día anterior, no es de hoy/)
  assert.match(textos[1], /^user: \[2026-11-09 20:47 · día anterior\] Mañana tengo la reunión de las 15/)
  assert.match(textos[3], /^system: — Desde acá, mensajes de hoy \(mar 10\/11, 2026-11-10\)/)
  assert.equal(textos[4], 'user: ¿Qué tengo hoy?', 'lo de hoy va sin marca')
  const soloHoy = await armarHistorial(db, mensajes(db, c.id).filter((m) => m.en >= martes), { ahora: martes + 60_000 })
  assert.ok(!soloHoy.some((m) => m.role === 'system'))
})

// ─── #210: la bitácora de desarrollo ────────────────────────────────────

test('#210: lo pegado de Claude Code queda en la bitácora, atado a Deprocast, buscable y fuera de la cadena de la liga', async () => {
  const db = abrir(':memory:')
  const proyecto = Number(db.prepare(`INSERT INTO entidades (tipo, nombre, creada_en) VALUES ('proyecto', 'Deprocast', ?)`).run(Date.now()).lastInsertRowid)
  const t = Date.parse('2026-11-10T12:00:00Z')
  const id = (await anotarRegistro(db, ['Listo: commit a7838e7, Fragua #204 marcala como hecha. npm test pasa.'], 'WhatsApp', t))!
  const p = db.prepare('SELECT estado, entidades, meta FROM corpus WHERE id = ?').get(id) as { estado: string; entidades: string; meta: string }
  assert.equal(p.estado, 'disponible', 'no entra a la cadena (nadie la destila en tareas ni misiones)')
  assert.deepEqual(JSON.parse(p.entidades), [proyecto])
  assert.equal(JSON.parse(p.meta).registro, 1)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM tareas`).get() as { n: number }).n, 0)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM propuestas`).get() as { n: number }).n, 0)
  const b = leerBitacora(db, { buscar: '#204' }, t)
  assert.equal(b.length, 1)
  assert.match(b[0].bloques[0], /a7838e7/)
  assert.match(NOTA_MEZCLA, /no las ejecutes salvo que él las diga/)
})

test('fijarAjuste sigue andando (sanidad de la base de estos tests)', () => {
  const db = abrir(':memory:')
  fijarAjuste(db, 'x', '1')
  assert.equal(ajuste(db, 'x'), '1')
})
