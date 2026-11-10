import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-pdf-'))
process.env.MASTRO_ADJUNTOS = tmp
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const { pdfDesdeMarkdown, bloquesDe } = await import('../src/pdf.ts')
const { textoDeDocumento } = await import('../src/takeout/nube.ts')
const { HERRAMIENTAS, GRUPOS, gruposDelMensaje } = await import('../src/chat/herramientas.ts')
const { conCanal } = await import('../src/telegram.ts')

test('PDF desde Markdown (Fragua #204): estructura válida, tildes, varias páginas y se lee de vuelta', () => {
  assert.deepEqual(bloquesDe('# T\n\n## S\n- a **b**\n1. c\n> d\n---\nUn párrafo\nque sigue').map((b) => [b.tipo, b.texto]), [
    ['titulo', 'T'], ['h2', 'S'], ['item', 'a b'], ['item', 'c'], ['cita', 'd'], ['separador', ''], ['parrafo', 'Un párrafo que sigue'],
  ])
  const pdf = pdfDesdeMarkdown(`## Ideas\n\nAcción, niño, ¿qué tal? ¡Bien!\n\n${'Relleno para que haga falta otra página. '.repeat(400)}`, { titulo: 'Ideas de la semana', pie: 'Deprocast · hoy' })
  const s = pdf.toString('latin1')
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'))
  // La tabla de referencias apunta a cada objeto.
  const xref = Number(/startxref\n(\d+)/.exec(s)![1])
  const offs = s.slice(xref).split('\n').filter((l) => / 00000 n $/.test(l)).map((l) => Number(l.slice(0, 10)))
  assert.ok(offs.every((o, i) => s.slice(o).startsWith(`${i + 1} 0 obj`)))
  assert.ok((s.match(/\/Type \/Page\b/g) ?? []).length >= 2, 'parte en páginas')
  assert.match(textoDeDocumento(pdf, 'pdf'), /Ideas de la semana[\s\S]*Acción, niño, ¿qué tal\? ¡Bien!/)
  assert.match(s, /\(1 de \d+\)/, 'el pie con el número de página')
})

test('armar_pdf: por WhatsApp sale como documento; desde la pantalla queda como archivo con su marca', async () => {
  const h = HERRAMIENTAS.find((x) => x.nombre === 'armar_pdf')!
  assert.ok(GRUPOS.crear.includes('armar_pdf') && gruposDelMensaje('armame un PDF con las ideas de la semana').includes('crear'))
  const mandados: { nombre: string; bytes: number }[] = []
  const canal = { nombre: 'WhatsApp', decir: async () => null, bajar: async () => ({ datos: Buffer.alloc(0), nombre: '' }), archivo: async (datos: Buffer, nombre: string) => { mandados.push({ nombre, bytes: datos.length }) } }
  const r = await conCanal(canal as any, async () => h.ejecutar({ titulo: 'Ideas de la semana', contenido: '- Una\n- Dos' }, {} as any)) as any
  assert.equal(r.enviado, 'WhatsApp')
  assert.deepEqual(mandados.map((m) => m.nombre), ['Ideas-de-la-semana.pdf'])
  const p = await h.ejecutar({ titulo: 'Informe', contenido: 'Texto' }, {} as any) as any
  assert.equal(p.enviado, null)
  const [, url] = /\[archivo:(\/adjuntos\/[^|]+)\|Informe\.pdf\|1 página\]/.exec(p.marca)!
  assert.ok(fs.existsSync(path.join(tmp, url.replace('/adjuntos/', ''))))
})
