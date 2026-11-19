import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { conversacionHoy } from '../src/chat/index.ts'
import { anotarSugeridas, resolverRapido } from '../src/chat/sugeridas.ts'
import { bandeja, cerrarContestados } from '../src/google/correo.ts'
import { leerMail, verMails } from '../src/google/gmail.ts'

const T = Date.now() - 3_600_000
const mail = (db: any, id: string, hilo: string, de: string, asunto: string, fecha: number, suyo: 0 | 1, cuerpo = '') =>
  db.prepare(`INSERT INTO correos (id, hilo, de, para, asunto, fecha, etiquetas, extracto, cuerpo, leido, suyo, ruido, triaje) VALUES (?, ?, ?, 'x', ?, ?, 'INBOX', '', ?, 1, ?, 0, ?)`)
    .run(id, hilo, de, asunto, fecha, cuerpo, suyo, suyo ? null : JSON.stringify({ pide_respuesta: true, urgencia: 'alta', resumen: 'r', accion: 'responder' }))

test('Fragua #316/#317: un hilo que él ya contestó no queda para contestar, y leer_mail trae el hilo entero con lo suyo', async () => {
  const db = abrir(':memory:')
  mail(db, 'eva', 'h-abc', 'Eva Genovés <eva@cines.es>', 'Consulta para estreno privado - 12 de diciembre', T, 0, 'Son 500 + IVA. Aforos 69, 77, 98, 108. Hace falta DCP.')
  mail(db, 'yo', 'h-abc', 'yo', 'Re: Consulta para estreno privado - 12 de diciembre', T + 17 * 60_000, 1, 'vale perfect muchas gracias')
  mail(db, 'otro', 'h-otro', 'Pedro', 'La factura', T, 0)

  assert.equal(cerrarContestados(db), 1)
  const b = await bandeja(db, { filtro: 'responder' })
  assert.deepEqual(b.correos.map((c) => c.id), ['otro'], 'lo contestado sale de «para contestar»')
  assert.equal(b.cuantos.responder, 1)

  const v = verMails(db, { dias: 2 })
  assert.match((v.correos.find((c) => c.id === 'eva') as any).ya_contestado.dijo, /vale perfect/)
  assert.equal((v.correos.find((c) => c.id === 'otro') as any).ya_contestado, undefined)
  const l: any = await leerMail(db, 'eva')
  assert.deepEqual(l.hilo.map((x: any) => x.de), ['Eva Genovés <eva@cines.es>', 'él'])
  assert.match(l.ya_contestado.dijo, /muchas gracias/)
})

test('Fragua #317: «ya les contesté» sobre un mail que le nombró cierra ese mail en el acto (y no una misión que también nombró)', () => {
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  mail(db, 'eva', 'h-abc', 'Eva', 'Consulta para estreno privado', T, 0)
  anotarSugeridas(db, cid, 'Para esta noche: contestá la consulta para estreno privado.')
  const r = resolverRapido(db, cid, 'ya les contesté')
  assert.match(r ?? '', /Consulta para estreno privado.*No te lo vuelvo a proponer/)
  assert.equal((db.prepare('SELECT atendido FROM correos WHERE id = ?').get('eva') as any).atendido, 1)
  assert.equal(resolverRapido(db, cid, 'ya les contesté'), null, 'ya no queda nada nombrado por cerrar')
})
