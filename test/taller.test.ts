import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarTaller, artefactoAlCorpus, carpeta, crearImagen, crearJuego, crearPersonaje, crearVideo, crearVoz, iterarArtefacto, listarArtefactos } from '../src/taller.ts'

process.env.MASTRO_TALLER = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-'))
process.env.MASTRO_SIN_FFMPEG = '1'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
_probarTaller({ imagen: async () => PNG, voz: async (t) => Buffer.from(`mp3:${t}`) })

test('Taller: juego con versiones, imagen, voz, personaje y video (sin ffmpeg: presentación)', async () => {
  const db = abrir(':memory:')
  const vistos: string[] = []
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    vistos.push(String(o.mensajes.at(-1)!.content))
    if (s.includes('programador del Taller')) return { texto: '```html\n<!doctype html><html><head><title>Dragones</title></head><body>v</body></html>\n```', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    if (s.includes('diseñás un personaje')) return { texto: JSON.stringify({ nombre: 'Rufo', descripcion: 'Un dragón lector.', personalidad: ['curioso'], apariencia_prompt: 'small red dragon', frase: 'Che, ¿leíste esto?', voz: 'em_santa' }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    if (s.includes('guionista del Taller')) return { texto: JSON.stringify({ titulo: 'Rufo lee', estilo: 'flat', escenas: [{ narracion: 'Rufo abre el libro.', imagen: 'dragon opens book' }, { narracion: 'Y se duerme.', imagen: 'dragon sleeps' }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    return { texto: 'ok', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  const j = await crearJuego(db, 'un juego de dragones')
  assert.equal(j.estado, 'listo')
  assert.equal(j.titulo, 'Dragones')
  assert.match(fs.readFileSync(path.join(carpeta(j.id), 'index.html'), 'utf8'), /^<!doctype html>/)
  const j2 = await iterarArtefacto(db, j.id, 'que haya niveles')
  assert.deepEqual([j2.version, j2.padreId], [2, j.id])
  assert.match(vistos.at(-1)!, /Este es el juego actual[\s\S]*que haya niveles/)

  const img = await crearImagen(db, 'un dragón rojo')
  assert.deepEqual(img.archivos, ['imagen.png'])
  const v = await crearVoz(db, 'Hola', { voz: 'ef_dora' })
  assert.equal(fs.readFileSync(path.join(carpeta(v.id), 'voz.mp3'), 'utf8'), 'mp3:Hola')

  const pj = await crearPersonaje(db, 'un dragón que lee')
  assert.equal(pj.titulo, 'Rufo')
  assert.equal(pj.meta.ficha.voz, 'em_santa')
  const vid = await crearVideo(db, 'Rufo leyendo', { personajeId: pj.id })
  assert.equal(vid.estado, 'listo', vid.progreso ?? '')
  assert.ok(vid.archivos.includes('presentacion.html') && vid.archivos.includes('escena-2.mp3') && !vid.archivos.includes('video.mp4'))
  assert.match(vistos.at(-1)!, /Personaje: Rufo/)

  assert.ok(artefactoAlCorpus(db, pj.id))
  assert.equal(listarArtefactos(db).length, 6)
})

test('Taller: si algo falla, queda en fallo con el motivo', async () => {
  const db = abrir(':memory:')
  _probarTaller({ imagen: async () => { throw new Error('NaN caído') } })
  const a = await crearImagen(db, 'algo')
  assert.equal(a.estado, 'fallo')
  assert.match(a.progreso!, /NaN caído/)
  _probarTaller({ imagen: async () => PNG })
})
