import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { armarPresentacion, _probarPresentacion } from '../src/presentacion.ts'

// Un PNG de 1×1 (para la imagen pintada).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

test('Fragua #310 · una presentación .pptx de verdad: portada, slides con puntos e imagen, una sección y las notas del orador', async () => {
  const db = abrir(':memory:')
  let pedidos = 0
  _probarPresentacion(async () => { pedidos++; return PNG })
  const r = await armarPresentacion(db, {
    titulo: 'La Trovada de Prueba', subtitulo: 'Clase 1', autor: 'Autor de Prueba', paleta: 'tierra', generarImagenes: true,
    slides: [
      { titulo: 'Por qué estamos acá', puntos: ['Primer punto', 'Segundo punto'], notas: 'Arrancar con una pregunta al público.', imagen: { prompt: 'una plaza de pueblo al atardecer' } },
      { titulo: 'Parte dos', tipo: 'seccion' },
      { titulo: 'Una frase', tipo: 'cita', puntos: ['Lo que no se mide no se mejora'] },
      { titulo: 'Sin imagen', puntos: ['Solo texto'], imagen: { adjunto: 'no-existe.jpg' } },
    ],
  })
  assert.equal(r.slides, 5, 'portada + 4')
  assert.equal(r.imagenes, 1)
  assert.equal(pedidos, 1)
  assert.deepEqual(r.avisos, ['Slide 4: no encontré la imagen'])
  // Es un zip con la estructura de PowerPoint (sin comprimir: se lee el XML adentro).
  assert.equal(r.datos.subarray(0, 2).toString(), 'PK')
  const s = r.datos.toString('utf8')
  for (const parte of ['ppt/presentation.xml', 'ppt/slides/slide5.xml', 'ppt/notesSlides/', 'ppt/media/']) assert.ok(s.includes(parte), parte)
  assert.ok(s.includes('Arrancar con una pregunta al público.'), 'la nota del orador va en su campo')
  assert.ok(s.includes('La Trovada de Prueba'))
  await assert.rejects(armarPresentacion(db, { titulo: 'x', slides: [] }), /Falta el guion/)
})
