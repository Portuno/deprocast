import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { asegurarFuente, insertar } from '../src/corpus.ts'
import * as t from '../src/transcripciones.ts'
import { _probarBajarDrive, enDrive, medioDeAdjunto, vincularAdjunto } from '../src/google/drive.ts'

process.env.MASTRO_ADJUNTOS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-transcripciones-'))

/** Una entrada en la cola de Drive (como la deja alDrive), con su archivo esperando subir. */
function enCola(db: ReturnType<typeof abrir>, datos: Buffer) {
  const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-cola-')), 'a.m4a')
  fs.writeFileSync(archivo, datos)
  return Number(db.prepare(`INSERT INTO drive_cola (archivo, nombre, mime, carpeta, descripcion, origen, creado) VALUES (?, 'a.m4a', 'audio/mp4', '["Audios"]', NULL, 'teléfono', ?)`).run(archivo, Date.now()).lastInsertRowid)
}

test('Lo que él manda vive en su Drive: un adjunto se lee de la cola mientras espera subir, y de Drive una vez subido', async () => {
  const db = abrir(':memory:')
  const cola = enCola(db, Buffer.from('audio en la cola'))
  vincularAdjunto(db, 'voz-1-abc.m4a', cola)
  assert.equal(String(await medioDeAdjunto(db, 'voz-1-abc.m4a')), 'audio en la cola')
  // Subió: la cola tiene su id de Drive; se baja de ahí.
  db.prepare(`UPDATE drive_cola SET hecho = 1, file_id = 'f123' WHERE id = ?`).run(cola)
  _probarBajarDrive(async (_db, id) => Buffer.from(`desde Drive ${id}`))
  assert.equal(String(await medioDeAdjunto(db, 'voz-1-abc.m4a')), 'desde Drive f123')
  assert.equal(await medioDeAdjunto(db, 'nunca-fue.jpg'), null)
  assert.deepEqual(enDrive(db, 'voz-1-abc.m4a'), { colaId: cola, fileId: null, link: null })
})

test('Fragua #306 · el audio no se guarda en Deprocast: queda atado a su Drive; versiones, lo dudoso marcado y una segunda pasada', async () => {
  const db = abrir(':memory:')
  _probarBajarDrive(async () => Buffer.from('audio desde Drive'))
  let escuchado = ''
  t._probarTranscripciones({ hayGemini: () => true, gemini: async (_db, audio) => { escuchado = String(audio); return 'Hablé con Urbina sobre el alba del proyecto.' } })
  asegurarFuente(db, { id: 'voz', nombre: 'Voz', nivel: 'propia' })
  const pieza = insertar(db, { fuente: 'voz', nivel: 'propia', titulo: 'Voz · caminando', contenido: 'Hablé con Urbi Alba sobre el proyecto.' })!
  const segs = [
    { inicio: 0, fin: 2, texto: 'Hablé con', confianza: 0.9, sinVoz: 0.01 },
    { inicio: 2, fin: 4, texto: 'Urbi Alba', confianza: 0.3, sinVoz: 0.1 },
    { inicio: 4, fin: 6, texto: 'sobre el proyecto.', confianza: 0.4, sinVoz: 0.05 },
  ]
  assert.equal(t.textoMarcado(segs), 'Hablé con [¿Urbi Alba?] [¿sobre el proyecto.?]')
  const cola = enCola(db, Buffer.from('audio'))
  db.prepare(`UPDATE drive_cola SET hecho = 1, file_id = 'f9' WHERE id = ?`).run(cola)
  const id = await t.archivarAudio(db, { colaId: cola, nombre: 'voz.m4a', refTipo: 'voz_segmento', refId: 1, piezaId: pieza, texto: 'Hablé con Urbi Alba sobre el proyecto.', segmentos: segs })
  const a = t.leerAudio(db, id)!
  assert.match(a.archivo, /^voz-\d+-[0-9a-f]+\.m4a$/)
  assert.equal(fs.existsSync(path.join(process.env.MASTRO_ADJUNTOS!, a.archivo)), false, 'el audio no se guarda acá')
  assert.ok(enDrive(db, a.archivo), 'queda atado a su copia de Drive')
  assert.equal(t.versiones(db, id)[0].dudosos, 2)
  // Más de un tercio dudoso: segunda pasada sola (con el audio bajado de Drive), como alternativa.
  const v2 = (await t.segundaPasadaSiHaceFalta(db, id))!
  assert.equal(escuchado, 'audio desde Drive')
  assert.equal(v2.motor, 'gemini')
  assert.equal(v2.vigente, false)
  assert.equal(await t.segundaPasadaSiHaceFalta(db, id), null, 'una sola vez')
  assert.equal((db.prepare('SELECT contenido FROM corpus WHERE id = ?').get(pieza) as any).contenido, 'Hablé con Urbi Alba sobre el proyecto.', 'la alternativa no pisa la pieza')
  t.elegirVersion(db, id, 2)
  assert.equal((db.prepare('SELECT contenido FROM corpus WHERE id = ?').get(pieza) as any).contenido, 'Hablé con Urbina sobre el alba del proyecto.')
  assert.deepEqual(t.versiones(db, id).map((v) => [v.version, v.vigente]), [[1, false], [2, true]])
  // Si el audio ya no está en Drive, se dice (no se rompe).
  _probarBajarDrive(async () => { throw new Error('404') })
  await assert.rejects(t.retranscribir(db, id, 'whisper'), /No encuentro el audio en tu Drive/)
})

test('Lo que ya subió a su Drive se borra de acá pasada una hora (antes, el turno y el historial lo leen del disco)', async () => {
  const { barrerAdjuntosSubidos } = await import('../src/google/drive.ts')
  const db = abrir(':memory:')
  const dir = process.env.MASTRO_ADJUNTOS!
  fs.writeFileSync(path.join(dir, 'foto-vieja.jpg'), 'x')
  fs.writeFileSync(path.join(dir, 'foto-nueva.jpg'), 'y')
  fs.writeFileSync(path.join(dir, 'foto-sin-drive.jpg'), 'z')
  const T = Date.now()
  vincularAdjunto(db, 'foto-vieja.jpg', 1)
  vincularAdjunto(db, 'foto-nueva.jpg', 2)
  db.prepare(`UPDATE adjuntos_drive SET file_id = 'a', subido = ? WHERE archivo = 'foto-vieja.jpg'`).run(T - 2 * 3_600_000)
  db.prepare(`UPDATE adjuntos_drive SET file_id = 'b', subido = ? WHERE archivo = 'foto-nueva.jpg'`).run(T - 60_000)
  assert.equal(await barrerAdjuntosSubidos(db, T), 1)
  assert.equal(fs.existsSync(path.join(dir, 'foto-vieja.jpg')), false)
  assert.equal(fs.existsSync(path.join(dir, 'foto-nueva.jpg')), true, 'subió hace un minuto: queda un rato')
  assert.equal(fs.existsSync(path.join(dir, 'foto-sin-drive.jpg')), true, 'lo que no fue a Drive no se toca')
})
