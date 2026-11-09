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
  assert.match(m.interactive.body.text, /^\*#1 · 10:00–10:25 · Escribir el mail a Ana\*\n_Después: 10:30 Revisar el contrato_/)
  assert.deepEqual(m.interactive.action.buttons.map((b: any) => b.reply.id.replace(/^m:\d+:/, '')), ['hecha', 'parcial', 'no'])
  assert.equal(await avisarBandas(db, T + 60_000), 0, 'ya enviada: no se repite')
  assert.equal(await avisarBandas(db, T + 29 * 60_000), 1, 'la #2, un minuto antes de las 10:30')
  assert.match(mandados.at(-1).interactive.body.text, /^\*#2 · 10:30–11:00/)
})
