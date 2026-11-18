import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir, fijarAjuste } from '../src/db.ts'
import { _probarTaller, crearSegun, entregarArtefacto } from '../src/taller.ts'
import * as wa from '../src/whatsapp.ts'

process.env.MASTRO_TALLER = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-entrega-'))

test('Taller · la entrega de cualquier obra: la imagen va como imagen, la ventana cerrada queda dicha, y se manda de nuevo', async () => {
  const db = abrir(':memory:')
  _probarTaller({ imagen: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) })
  const a = await crearSegun(db, { tipo: 'imagen', pedido: 'un faro al atardecer' })
  assert.equal(a.estado, 'listo', String(a.progreso))

  // Sin WhatsApp vinculado ni Drive: no sale, y dice por qué.
  const sin = await entregarArtefacto(db, a.id)
  assert.equal(sin.whatsapp, false)
  assert.equal(sin.drive, false)
  assert.ok(sin.errores!.some((e) => /WhatsApp: la ventana de 24 horas está cerrada/.test(e)))
  assert.ok(sin.errores!.some((e) => /Drive: Google no está conectado/.test(e)))

  // Con la ventana abierta: la imagen va como imagen (se ve ahí mismo), con su título.
  wa.configurarWhatsapp(db, { numeroId: '123456789', token: 'EAA'.padEnd(40, 'x'), secreto: 'a'.repeat(32) })
  fijarAjuste(db, 'whatsapp_wa_id', '5491100000000')
  fijarAjuste(db, 'whatsapp_ultimo_entrante', String(Date.now() - 60_000))
  const mandados: any[] = []
  wa._probarWhatsapp((async (u: string, init: RequestInit = {}) => {
    if (String(u).endsWith('/media')) return new Response(JSON.stringify({ id: 'm1' }))
    if (String(u).endsWith('/messages')) { mandados.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ messages: [{ id: 'w' }] })) }
    return new Response('{}', { status: 404 })
  }) as typeof fetch)
  const con = await entregarArtefacto(db, a.id, { drive: false })
  assert.equal(con.whatsapp, true)
  assert.equal(mandados[0].type, 'text')
  assert.match(mandados[0].text.body, /del Taller/)
  assert.equal(mandados[1].type, 'image')
  assert.deepEqual(mandados[1].image, { id: 'm1' })

  // Un juego no tiene archivo para mandar.
  await assert.rejects(entregarArtefacto(db, 999_999), /no está lista/)
})
