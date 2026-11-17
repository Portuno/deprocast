import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { asegurarFuente, insertar } from '../src/corpus.ts'
import * as t from '../src/transcripciones.ts'

process.env.MASTRO_ADJUNTOS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-transcripciones-'))

test('Fragua #306 · el audio queda, las transcripciones son versiones, lo dudoso se marca y una dudosa pasa sola por otro motor', async () => {
  const db = abrir(':memory:')
  t._probarTranscripciones({ ffmpeg: async () => false, hayGemini: () => true, gemini: async () => 'Hablé con Urbina sobre el alba del proyecto.', whisper: async () => ({ texto: 'otra', segmentos: [] }) })
  asegurarFuente(db, { id: 'voz', nombre: 'Voz', nivel: 'propia' })
  const pieza = insertar(db, { fuente: 'voz', nivel: 'propia', titulo: 'Voz · caminando', contenido: 'Hablé con Urbi Alba sobre el proyecto.' })!
  const segs = [
    { inicio: 0, fin: 2, texto: 'Hablé con', confianza: 0.9, sinVoz: 0.01 },
    { inicio: 2, fin: 4, texto: 'Urbi Alba', confianza: 0.3, sinVoz: 0.1 },
    { inicio: 4, fin: 6, texto: 'sobre el proyecto.', confianza: 0.4, sinVoz: 0.05 },
  ]
  assert.equal(t.textoMarcado(segs), 'Hablé con [¿Urbi Alba?] [¿sobre el proyecto.?]')
  const id = await t.archivarAudio(db, { datos: Buffer.from('audio crudo'), nombre: 'voz.m4a', refTipo: 'voz_segmento', refId: 1, piezaId: pieza, texto: 'Hablé con Urbi Alba sobre el proyecto.', segmentos: segs })
  const a = t.leerAudio(db, id)!
  assert.match(a.archivo, /^voz-\d+-[0-9a-f]+\.m4a$/, 'sin ffmpeg, el audio tal cual')
  assert.ok(fs.existsSync(await t.rutaDelAudio(a)), 'el audio queda guardado')
  assert.equal(t.versiones(db, id)[0].dudosos, 2)
  // Más de un tercio dudoso: segunda pasada sola, como alternativa (no vigente).
  const v2 = (await t.segundaPasadaSiHaceFalta(db, id))!
  assert.equal(v2.motor, 'gemini')
  assert.equal(v2.vigente, false)
  assert.equal(await t.segundaPasadaSiHaceFalta(db, id), null, 'una sola vez')
  assert.equal((db.prepare('SELECT contenido FROM corpus WHERE id = ?').get(pieza) as any).contenido, 'Hablé con Urbi Alba sobre el proyecto.', 'la alternativa no pisa la pieza')
  // Él elige la de Gemini: la nota de voz pasa a decir eso, y la primera sigue estando.
  t.elegirVersion(db, id, 2)
  assert.equal((db.prepare('SELECT contenido FROM corpus WHERE id = ?').get(pieza) as any).contenido, 'Hablé con Urbina sobre el alba del proyecto.')
  assert.deepEqual(t.versiones(db, id).map((v) => [v.version, v.vigente]), [[1, false], [2, true]])
  assert.equal(t.audioDe(db, { piezaId: pieza })!.id, id)
  assert.throws(() => t.elegirVersion(db, id, 9), /no tiene versión 9/)
})
