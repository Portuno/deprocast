import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.MASTRO_CARGAS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-ocr-'))

const { abrir } = await import('../src/db.ts')
const { subir, ejecutar } = await import('../src/cargas/index.ts')
const { _probarOcr, ocrPendientes, paginasDePdf, textoInsuficiente } = await import('../src/ocr-pdf.ts')
const { pdfDesdeMarkdown } = await import('../src/pdf.ts')

/** Un PDF escaneado: dos páginas, ninguna con texto (solo la imagen, que acá ni está). */
const ESCANEO = Buffer.from('%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n2 0 obj<</Type /Pages /Kids [3 0 R 4 0 R] /Count 2>>endobj\n3 0 obj<</Type /Page /Parent 2 0 R>>endobj\n4 0 obj<</Type /Page /Parent 2 0 R>>endobj\n%%EOF', 'latin1')

const esperar = async (f: () => boolean) => { for (let i = 0; i < 50 && !f(); i++) await new Promise((ok) => setTimeout(ok, 20)) }

test('Fragua #326: un PDF escaneado entra y se lee con OCR por página, con lo ilegible marcado', async () => {
  const db = abrir(':memory:')
  assert.equal(paginasDePdf(ESCANEO), 2)
  assert.equal(textoInsuficiente('', 2), true)
  const carga = subir(db, 'cuaderno escaneado.pdf', ESCANEO)
  assert.deepEqual(carga.analisis!.segmentos.map((s) => s.id), ['ocr'])
  assert.match(carga.analisis!.avisos[0], /casi no trae texto \(0 caracteres en 2 páginas\).*OCR por página/)

  const leidos: string[] = []
  _probarOcr(async (_db, pdf, nombre) => {
    leidos.push(`${nombre}:${pdf.length}`)
    return [{ n: 1, texto: 'Lista de tareas: llamar a la imprenta', tipo: 'manuscrito', legible: 'sí' }, { n: 2, texto: '', tipo: 'impreso', legible: 'no' }]
  })
  ejecutar(db, carga.id, {})
  const pieza = () => db.prepare(`SELECT id, contenido, meta FROM corpus WHERE carga_id = ?`).get(carga.id) as { id: number; contenido: string; meta: string }
  await esperar(() => JSON.parse(pieza().meta).ocr === 'hecho')
  await ocrPendientes(db) // nada más pendiente
  const p = pieza()
  const meta = JSON.parse(p.meta)
  assert.equal(meta.ocr, 'hecho')
  assert.deepEqual(meta.ocrIlegibles, [2])
  assert.match(p.contenido, /^> Leído con OCR\. Ilegible: página 2\./)
  assert.match(p.contenido, /## Página 1 \(manuscrito\)\n\nLista de tareas: llamar a la imprenta/)
  assert.match(p.contenido, /## Página 2 \(ilegible\)\n\n\[ilegible\]/)
  assert.deepEqual(leidos, [`cuaderno escaneado.pdf:${ESCANEO.length}`], 'una sola lectura')
})

test('Fragua #326: sin con qué leerlo (o si falla tres veces) se dice en la pieza; un PDF con texto no pasa por OCR', async () => {
  const db = abrir(':memory:')
  _probarOcr(async () => { throw new Error('No hay con qué leerlo: falta GEMINI_API_KEY') })
  const carga = subir(db, 'escaneo2.pdf', ESCANEO)
  ejecutar(db, carga.id, {})
  const pieza = () => db.prepare(`SELECT contenido, meta FROM corpus WHERE carga_id = ?`).get(carga.id) as { contenido: string; meta: string }
  await esperar(() => JSON.parse(pieza().meta).ocr === 'fallo')
  assert.equal(JSON.parse(pieza().meta).ocr, 'fallo')
  assert.match(pieza().contenido, /^> ⚠ No se pudo leer con OCR: No hay con qué leerlo: falta GEMINI_API_KEY/)

  const conTexto = subir(db, 'informe.pdf', pdfDesdeMarkdown('# Informe\n\n' + 'Un párrafo con texto de verdad, escrito en el PDF. '.repeat(20)))
  assert.deepEqual(conTexto.analisis!.segmentos.map((s) => s.id), ['documento'])
  assert.deepEqual(conTexto.analisis!.avisos, [])
})
