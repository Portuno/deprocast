import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { _probarAdjuntos, comoTexto, conImagenes, guardarImagen } from '../src/chat/adjuntos.ts'
import { armarHistorial } from '../src/chat/historial.ts'
import { _probarEscriba, crearConversacion, mensajes } from '../src/chat/index.ts'

process.env.MASTRO_ADJUNTOS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-adj-'))
_probarEscriba(async () => {})

test('adjuntos: la imagen se guarda y se describe; el turno la ve, los siguientes y la memoria solo su descripción', async () => {
  const db = abrir(':memory:')
  _probarAdjuntos(async () => 'Una captura | con [corchetes] de una planilla\ncon dos columnas.')
  const r = await guardarImagen(db, 'captura.png', Buffer.from('png-falso'))
  assert.match(r.url, /^\/adjuntos\/\d+-[0-9a-f]{10}\.png$/)
  assert.ok(fs.existsSync(path.join(process.env.MASTRO_ADJUNTOS!, path.basename(r.url))))
  assert.equal(r.marca, `[imagen:${r.url}|Una captura con corchetes de una planilla con dos columnas.]`, 'la descripción no rompe la marca')

  const texto = `¿Qué ves acá?\n${r.marca}`
  assert.equal(comoTexto(texto), '¿Qué ves acá?\n(imagen adjunta: Una captura con corchetes de una planilla con dos columnas.)')
  const partes = conImagenes(texto) as any[]
  assert.equal(partes[0].text, '¿Qué ves acá?\n(imagen adjunta: la ves abajo)')
  assert.match(partes[1].image_url.url, /^data:image\/png;base64,/)

  // En la conversación: solo el último mensaje del operador lleva la imagen de verdad.
  const c = crearConversacion(db)
  const ins = db.prepare('INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, ?, ?, ?)')
  ins.run(c.id, 'operador', `mirá esta\n${r.marca}`, 1)
  ins.run(c.id, 'asistente', 'La vi.', 2)
  ins.run(c.id, 'operador', `y esta otra\n${r.marca}`, 3)
  const h = await armarHistorial(db, mensajes(db, c.id), { cid: c.id, verImagenes: true })
  assert.equal(typeof h[0].content, 'string')
  assert.match(String(h[0].content), /\(imagen adjunta: Una captura/)
  assert.ok(Array.isArray(h.at(-1)!.content), 'el mensaje recién mandado va con la imagen')
  await assert.rejects(guardarImagen(db, 'vacia.png', Buffer.alloc(0)), /vacía/)
})
