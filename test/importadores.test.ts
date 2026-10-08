import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { listarPiezas } from '../src/corpus.ts'
import { ejecutar, subir } from '../src/cargas/index.ts'
import { listarEntidades } from '../src/entidades.ts'
import { leerCorreo, leerInstagram, leerWhatsApp } from '../src/cargas/mensajes.ts'

process.env.MASTRO_CARGAS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-imp-'))

const WA = `01/10/26, 09:15 - Ana: Buen día
01/10/26, 09:16 - Beto: Mirá esto https://www.instagram.com/reel/ABC123/ jajaja
seguí acá
01/10/26, 09:20 - Ana: <Multimedia omitido>
[02/10/2026, 18:01:22] Ana: otro día
[02/10/2026, 18:02:00] Beto: https://ejemplo.org/nota`

test('whatsapp: Android e iOS, líneas que siguen, sin multimedia; días, links y participantes', () => {
  const ls = leerWhatsApp(WA)
  assert.equal(ls.length, 4)
  assert.equal(ls[1].texto, 'Mirá esto https://www.instagram.com/reel/ABC123/ jajaja\nseguí acá')
  assert.equal(ls[2].fecha, '2026-10-02')

  const db = abrir(':memory:')
  const c = subir(db, 'Chat de WhatsApp con Grupo.txt', WA)
  assert.equal(c.importador, 'whatsapp')
  assert.deepEqual(c.analisis!.segmentos.map((s) => s.cantidad), [2, 2, 2])
  ejecutar(db, c.id, { pipeline: 'ninguna' })
  const ps = listarPiezas(db, { limite: 50 }).piezas
  assert.equal(ps.filter((p) => p.tipo === 'enlace').length, 2)
  const reel = ps.find((p) => p.url?.includes('/reel/'))!
  assert.match(reel.titulo, /^Reel de Beto/)
  assert.equal(reel.nivel, 'primaria')
  assert.equal(ps.find((p) => p.titulo === 'Chat de WhatsApp con Grupo · 2026-10-01')!.nivel, 'propia')
  assert.deepEqual(listarEntidades(db).map((e) => e.nombre).sort(), ['Ana', 'Beto'])

  ejecutar(db, subir(db, 'Chat de WhatsApp con Grupo.txt', WA).id, { pipeline: 'ninguna' })
  assert.equal(listarPiezas(db, { limite: 50 }).piezas.length, ps.length, 'recargar no duplica')
})

test('instagram: arregla el mojibake y los posts compartidos salen como links', () => {
  const mal = (s: string) => Buffer.from(s, 'utf8').toString('latin1')
  const j = {
    participants: [{ name: 'Ana' }, { name: 'Yo' }], title: mal('Ana Pérez'), thread_path: 'inbox/ana_1',
    messages: [
      { sender_name: 'Ana', timestamp_ms: new Date(2026, 9, 2, 10).getTime(), share: { link: 'https://www.instagram.com/reel/XYZ/' } },
      { sender_name: 'Yo', timestamp_ms: new Date(2026, 9, 1, 9).getTime(), content: mal('¿Qué tal?') },
    ],
  }
  const ls = leerInstagram(j)
  assert.equal(ls[0].texto, '¿Qué tal?', 'en orden cronológico y sin mojibake')
  const db = abrir(':memory:')
  const c = subir(db, 'message_1.json', JSON.stringify(j))
  assert.equal(c.importador, 'instagram')
  assert.equal(c.analisis!.titulo, 'Ana Pérez')
  ejecutar(db, c.id, { pipeline: 'ninguna' })
  assert.ok(listarPiezas(db, { limite: 20 }).piezas.some((p) => p.url === 'https://www.instagram.com/reel/XYZ/'))
})

test('claude y gemini: conversaciones e historial de pedidos', () => {
  const db = abrir(':memory:')
  const cl = subir(db, 'conversations.json', JSON.stringify([{ uuid: 'u1', name: 'Plan', created_at: '2026-10-01T10:00:00Z', chat_messages: [{ sender: 'human', text: '¿Cómo arranco?' }, { sender: 'assistant', text: 'Por lo chico.' }] }]))
  assert.equal(cl.importador, 'claude')
  ejecutar(db, cl.id, { pipeline: 'ninguna' })
  const ge = subir(db, 'MyActivity.json', JSON.stringify([
    { header: 'Gemini Apps', title: 'Prompted cómo hacer pan', time: '2026-10-01T09:00:00Z' },
    { header: 'Gemini Apps', title: 'Prompted receta de pizza', time: '2026-10-01T08:00:00Z' },
  ]))
  assert.equal(ge.importador, 'gemini')
  ejecutar(db, ge.id, { pipeline: 'ninguna' })
  const ps = listarPiezas(db, { limite: 20 }).piezas
  assert.match(ps.find((p) => p.titulo === 'Claude · Plan')!.contenido, /YO: ¿Cómo arranco\?\n\nCLAUDE: Por lo chico\./)
  assert.equal(ps.find((p) => p.titulo === 'Gemini · 2026-10-01')!.contenido, '[08:00] receta de pizza\n[09:00] cómo hacer pan')
})

test('correo: mbox con enviados y recibidos, cabeceras codificadas y quoted-printable', () => {
  const mbox = `From 1@x Thu Oct 01 10:00:00 +0000 2026
X-Gmail-Labels: Recibidos,Importante
From: Ana <ana@ejemplo.org>
To: yo@ejemplo.org
Subject: =?UTF-8?B?UmV1bmnDs24=?=
Date: Thu, 01 Oct 2026 10:00:00 +0000
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: quoted-printable

Nos vemos ma=C3=B1ana.
> cita vieja

From 2@x Thu Oct 01 11:00:00 +0000 2026
X-Gmail-Labels: Enviados
From: Yo <yo@ejemplo.org>
To: ana@ejemplo.org
Subject: Re: Reunión
Date: Thu, 01 Oct 2026 11:00:00 +0000

Dale, ahí estoy.
`
  const ms = leerCorreo(mbox)
  assert.equal(ms.length, 2)
  assert.equal(ms[0].asunto, 'Reunión')
  assert.equal(ms[0].cuerpo, 'Nos vemos mañana.')
  assert.deepEqual(ms.map((m) => m.enviado), [false, true])
  const db = abrir(':memory:')
  const c = subir(db, 'Correo.mbox', mbox)
  assert.equal(c.importador, 'correo')
  ejecutar(db, c.id, { pipeline: 'ninguna' })
  const ps = listarPiezas(db, { limite: 10 }).piezas
  assert.equal(ps.find((p) => p.contenido === 'Dale, ahí estoy.')!.nivel, 'propia')
  assert.equal(ps.find((p) => p.contenido === 'Nos vemos mañana.')!.nivel, 'primaria')
})

test('respaldo 0.7: el predictor de energía entra opcional, un día por pieza, con frentes nombrados y resultado', async () => {
  const db = abrir(':memory:')
  const respaldo = {
    format: 'deprocast-backup', version: 3, include_media: false, run: {},
    tables: {
      projects: [{ id: 'pr1', title: 'Telar' }], persons: [{ id: 'pe1', name: 'Ada', status: 'active' }],
      energia_predictions: [
        { id: 'e1', day_key: '2026-09-15', front_kind: 'project', front_id: 'pr1', predicted_kind: 'captura_audio', confidence: 0.57, status: 'resolved', created_at: '2026-09-15T10:00:00Z' },
        { id: 'e2', day_key: '2026-09-15', front_kind: 'person', front_id: 'pe1', predicted_kind: 'dialogo', confidence: 0.3, status: 'expired', created_at: '2026-09-15T09:00:00Z' },
      ],
      energia_resolutions: [{ prediction_id: 'e1', outcome: 'match' }],
    },
  }
  const c = subir(db, 'respaldo.json', JSON.stringify(respaldo))
  const seg = c.analisis!.segmentos.find((s) => s.id === 'energia')!
  assert.equal(seg.porDefecto, false)
  assert.equal(seg.cantidad, 1)
  ejecutar(db, c.id, { segmentos: ['energia'], pipeline: 'ninguna' })
  const p = listarPiezas(db, { limite: 5 }).piezas.find((x) => x.titulo === 'Predictor de energía · 2026-09-15')!
  assert.equal(p.nivel, 'generada')
  assert.equal(p.contenido, '2 predicciones; de las medidas, 1 de 1 acertaron.\n- 09:00 · dialogo en «Ada» (30%) → expired\n- 10:00 · captura_audio en «Telar» (57%) → acertó')
})
