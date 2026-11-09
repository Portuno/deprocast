import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { abrir } from '../src/db.ts'
import { _probarPrensa, criterio, diarioDe, procesarPrensa, votarNota } from '../src/prensa.ts'
import { _probarVideo, encolarVideo, listarVideos, trabajarVideos } from '../src/video.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'video-'))
const antes = process.env.MASTRO_DB
before(() => { process.env.MASTRO_DB = path.join(tmp, 'x.db') })
after(() => { process.env.MASTRO_DB = antes; fs.rmSync(tmp, { recursive: true, force: true }) })

const NOTAS = { notas: [
  { titular: "L'Ajuntament aprova el pressupost", original: "L'Ajuntament de València aprova el pressupost de 2027.", idioma: 'valenciano', traduccion: 'El Ayuntamiento de València aprueba el presupuesto de 2027.', tema: 'política', territorio: 'València' },
  { titular: 'El València guanya', original: 'El València guanya 2-0.', idioma: 'valenciano', traduccion: 'El València gana 2-0.', tema: 'deportes', territorio: 'València' },
  { titular: 'Nova línia de metro a Sagunt', original: 'Nova línia de metro fins a Sagunt.', idioma: 'valenciano', traduccion: 'Nueva línea de metro hasta Sagunto.', tema: 'urbanismo y vivienda', territorio: 'Sagunt' },
] }

test('el diario propio (Fragua #166): notas traducidas con el original, por tema; lo descartado fuera de la vista y el criterio se aprende', async () => {
  const db = abrir(':memory:')
  _probarPrensa(async () => NOTAS)
  const ns = await procesarPrensa(db, 'texto de la página', { fecha: '2026-11-09' })
  assert.equal(ns.length, 3)
  assert.equal(ns[0].traduccion, 'El Ayuntamiento de València aprueba el presupuesto de 2027.')
  assert.ok(ns[0].piezaId, 'cada nota entra al corpus')
  assert.equal((await procesarPrensa(db, 'la misma página otra vez', { fecha: '2026-11-09' })).length, 0, 'la misma nota dos veces: una')
  votarNota(db, ns[0].id, 1)
  votarNota(db, ns[1].id, 0)
  const d = diarioDe(db, '2026-11-09')
  assert.deepEqual(d.temas.map((t) => t.tema), ['política', 'urbanismo y vivienda'], 'lo descartado no está en la vista')
  assert.equal(d.descartadas.length, 1)
  const c = criterio(db)
  assert.equal(c.temas.find((x) => x.k === 'política')!.tasa, 2 / 3)
  assert.equal(c.temas.find((x) => x.k === 'deportes')!.tasa, 1 / 3)
  // Lo nuevo del mismo tema hereda el criterio aprendido.
  _probarPrensa(async () => ({ notas: [{ titular: 'Les Corts debaten', original: 'Les Corts debaten la llei.', idioma: 'valenciano', traduccion: 'Las Cortes debaten la ley.', tema: 'política', territorio: null }, { titular: 'Derbi', original: 'Derbi.', idioma: 'valenciano', traduccion: 'Derbi.', tema: 'deportes', territorio: null }] }))
  const [pol, dep] = await procesarPrensa(db, 'otro día', { fecha: '2026-11-10' })
  assert.ok(pol.sugerido! > dep.sugerido!, 'la de política, más probable que la de deportes')
})

test('el video como fuente (Fragua #165): en orden, lo dicho y lo que se ve; en bloques al corpus, o al diario si son páginas', async () => {
  const db = abrir(':memory:')
  const orden: string[] = []
  _probarVideo({
    sondear: async () => ({ duracion: 60, ancho: 1280, alto: 720, audio: true }),
    extraerAudio: async (_r, destino) => { fs.writeFileSync(destino, 'mp3'); return true },
    transcribir: async () => 'Hoy hablamos de la mudanza a enero.',
    cuadros: async (_r, carpeta) => ['c001.jpg', 'c002.jpg', 'c003.jpg'].map((f) => { fs.writeFileSync(path.join(carpeta, f), 'x'); return path.join(carpeta, f) }),
    leerCuadro: async (_db, _img, prensa) => (prensa ? "L'Ajuntament aprova el pressupost" : 'PLAN DE MUDANZA · ENERO'),
    segmentar: async (_db, texto) => { orden.push(texto); return { titulo: 'La mudanza', bloques: [{ titulo: 'Fechas', texto: 'Mudanza en enero.' }, { titulo: 'Costos', texto: 'Cuánto sale.' }] } },
  })
  _probarPrensa(async () => NOTAS)
  const avisos: string[] = []
  const a = encolarVideo(db, Buffer.from('video 1'), 'mudanza.mp4', { aviso: (t) => avisos.push(t) })
  const b = encolarVideo(db, Buffer.from('video 2'), 'paginas.mp4', { nota: 'el diario de hoy', aviso: (t) => avisos.push(t) })
  assert.equal(b.item.modo, 'prensa', 'con «diario» en la nota, va al diario')
  assert.equal(b.antes, 1, 'uno antes en la cola')
  await trabajarVideos(db)
  assert.match(orden[0], /## Lo que se dice\nHoy hablamos de la mudanza[\s\S]*## Lo que se ve en pantalla\n\[00:10\] PLAN DE MUDANZA · ENERO$/, 'los tres cuadros iguales cuentan una vez')
  const vs = listarVideos(db)
  assert.deepEqual(vs.map((v) => [v.nombre, v.estado]), [['paginas.mp4', 'hecho'], ['mudanza.mp4', 'hecho']])
  assert.equal(vs[1].piezas.length, 2, 'dos bloques, dos piezas')
  assert.equal(vs[0].notas, 3)
  assert.match(avisos[0], /🎬 Listo «mudanza\.mp4»: 2 bloques al corpus/)
  assert.match(avisos[1], /🗞 Listo «paginas\.mp4»: 3 notas al diario/)
  assert.equal(a.item.id < b.item.id, true)
})
