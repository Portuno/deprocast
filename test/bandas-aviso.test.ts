import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir, fechaLocal } from '../src/db.ts'
import { crearMision } from '../src/misiones.ts'
import { _probarWhatsapp, configurarWhatsapp } from '../src/whatsapp.ts'
import { avisarBandas } from '../src/telegram.ts'

test('cada banda de la run, sola y un minuto antes, numerada, con botones y una sola vez (Fragua #182)', async () => {
  const db = abrir(':memory:')
  configurarWhatsapp(db, { numeroId: '123456789', token: 'EAA'.padEnd(40, 'x'), secreto: 'a'.repeat(32) })
  const hoy = new Date(); hoy.setHours(10, 0, 0, 0)
  const T = hoy.getTime()
  db.prepare(`INSERT OR REPLACE INTO ajustes (clave, valor) VALUES ('whatsapp_wa_id', '34600'), ('whatsapp_ultimo_entrante', ?)`).run(String(T - 60_000))
  const mandados: any[] = []
  _probarWhatsapp((async (_u: string, init: RequestInit = {}) => { mandados.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ messages: [{ id: 'x' }] })) }) as typeof fetch)
  const run = Number(db.prepare(`INSERT INTO runs (fecha, inicio, fin, estado, pedido, creada_en) VALUES (?, '10:00', '11:00', 'en_curso', '{}', ?)`).run(fechaLocal(T), T).lastInsertRowid)
  crearMision(db, { nivel: 'secundaria', titulo: 'Escribir el mail a Ana', runId: run, inicio: '10:00', fin: '10:25', estado: 'activa' })
  crearMision(db, { nivel: 'secundaria', titulo: 'Revisar el contrato', runId: run, inicio: '10:30', fin: '11:00', estado: 'activa' })

  assert.equal(await avisarBandas(db, T - 5 * 60_000), 0, 'faltan 5 minutos: todavía no')
  assert.equal(await avisarBandas(db, T - 60_000), 1, 'un minuto antes: sale')
  const m = mandados.at(-1)
  assert.equal(m.type, 'interactive')
  assert.equal(m.interactive.body.text, '*#1 · 10:00–10:25 · Escribir el mail a Ana*', 'nunca por adelantado: ni el título de la que sigue (Fragua #290)')
  assert.deepEqual(m.interactive.action.buttons.map((b: any) => b.reply.id.replace(/^m:\d+:/, '')), ['hecha', 'parcial', 'no'])
  assert.equal(await avisarBandas(db, T + 60_000), 0, 'ya enviada: no se repite')
  assert.equal(await avisarBandas(db, T + 29 * 60_000), 1, 'la #2, un minuto antes de las 10:30')
  assert.match(mandados.at(-1).interactive.body.text, /^\*#2 · 10:30–11:00/)
})

test('Fragua #290 · la run propuesta arranca sola un minuto antes; si llegó tarde pregunta una vez; de a una; en el chat, solo la que ya tocó', async () => {
  const { arranqueDeRun, bandaPedida, leerRun } = await import('../src/misiones.ts')
  const { proximosAvisos, _probarAvisos } = await import('../src/avisos-movil.ts')
  _probarAvisos(async () => [])
  const db = abrir(':memory:')
  const hoy = new Date(); hoy.setHours(9, 0, 0, 0)
  const T = hoy.getTime()
  const m = (min: number) => T + min * 60_000
  const nuevaRun = () => {
    const id = Number(db.prepare(`INSERT INTO runs (fecha, inicio, fin, estado, pedido, creada_en) VALUES (?, '09:00', '09:36', 'propuesta', '{}', ?)`).run(fechaLocal(T), T - 3_600_000).lastInsertRowid)
    for (const [i, h] of ['09:00', '09:12', '09:24'].entries()) crearMision(db, { nivel: 'secundaria', titulo: `Banda ${i + 1}`, detalle: `Hacer la ${i + 1}`, runId: id, inicio: h, fin: ['09:12', '09:24', '09:36'][i], estado: 'activa' })
    return id
  }
  const a = nuevaRun()
  // En el teléfono: las tres bandas programadas un minuto antes (la run arranca sola).
  const av = await proximosAvisos(db, m(-30))
  assert.deepEqual(av.avisos.filter((x) => x.clave.startsWith('ev:banda:')).map((x) => [x.titulo, x.en]), [['⏱ #1 · 09:00–09:12 · Banda 1', m(-1)], ['⏱ #2 · 09:12–09:24 · Banda 2', m(11)], ['⏱ #3 · 09:24–09:36 · Banda 3', m(23)]])
  assert.equal(arranqueDeRun(db, m(-5)), null, 'faltan 5 minutos: nada')
  // En el chat, antes de su hora: no.
  assert.ok('aunNo' in bandaPedida(db, '09:12', m(-5)))
  const r = arranqueDeRun(db, m(-1))!
  assert.equal(r.tipo, 'arranco')
  assert.equal(leerRun(db, a)!.estado, 'en_curso')
  assert.equal(leerRun(db, a)!.inicio, '09:00', 'arranca con sus horas, sin correrlas')
  assert.equal(arranqueDeRun(db, m(0)), null, 'una sola vez')
  // De a una: la #1 no salió (sin canales) y ya toca la #2 → la #1 queda salteada, no se manda en bloque.
  assert.equal(await avisarBandas(db, m(11)), 0)
  const avisadas = db.prepare('SELECT titulo FROM misiones WHERE run_id = ? AND avisada_en IS NOT NULL ORDER BY id').all(a).map((x: any) => x.titulo)
  assert.deepEqual(avisadas, ['Banda 1'])
  // En el chat: la de ahora sí, una sola; la de las 9:24 todavía no.
  const ahora = bandaPedida(db, null, m(13)) as any
  assert.equal(ahora.banda.titulo, 'Banda 2')
  assert.equal(ahora.numero, 2)
  assert.match((bandaPedida(db, '9:24', m(13)) as any).aunNo, /sale sola a las 09:23/)
  db.prepare(`UPDATE runs SET estado = 'cerrada' WHERE id = ?`).run(a)

  // Otra run, propuesta para las 9:00, que recién se mira a las 9:30: no arranca ni entrega; pregunta una vez.
  const b = nuevaRun()
  const t = arranqueDeRun(db, m(30))!
  assert.equal(t.tipo, 'tarde')
  assert.equal(t.pasadas, 2)
  assert.match(t.texto, /no arrancó y ya pasaron 2 bandas\. No te las mando de golpe/)
  assert.equal(leerRun(db, b)!.estado, 'propuesta')
  assert.equal(arranqueDeRun(db, m(31)), null, 'pregunta una sola vez')
})
