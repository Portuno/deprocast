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

/** Un JPEG mínimo con el segmento EXIF de una orientación (big o little endian). */
function exif(orientacion: number, le = false): Buffer {
  const u16 = (n: number) => { const b = Buffer.alloc(2); le ? b.writeUInt16LE(n) : b.writeUInt16BE(n); return b }
  const u32 = (n: number) => { const b = Buffer.alloc(4); le ? b.writeUInt32LE(n) : b.writeUInt32BE(n); return b }
  const tiff = Buffer.concat([Buffer.from(le ? 'II' : 'MM'), u16(42), u32(8), u16(1), u16(0x0112), u16(3), u32(1), u16(orientacion), u16(0), u32(0)])
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const largo = Buffer.alloc(2)
  largo.writeUInt16BE(app1.length + 2)
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), largo, app1])
}

test('adjuntos: la orientación del celular (EXIF) se lee y se endereza', async () => {
  const { orientacionExif, filtroDeOrientacion } = await import('../src/tandas.ts')
  assert.equal(orientacionExif(Buffer.concat([exif(6), Buffer.from([0xff, 0xda])])), 6)
  assert.equal(orientacionExif(Buffer.concat([exif(8, true), Buffer.from([0xff, 0xda])])), 8, 'también little endian')
  assert.equal(orientacionExif(Buffer.from('png-falso')), 1)
  assert.equal(filtroDeOrientacion(6), 'transpose=1')
  assert.equal(filtroDeOrientacion(1), null)

  // Con ffmpeg: una foto de 40×20 marcada «girada 90°» sale de 20×40.
  const { spawnSync } = await import('node:child_process')
  if (spawnSync('ffmpeg', ['-version']).status !== 0) return
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-exif-'))
  const crudo = path.join(dir, 'a.jpg')
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=40x20', '-frames:v', '1', crudo])
  const jpg = fs.readFileSync(crudo)
  const conExif = Buffer.concat([exif(6).subarray(0, exif(6).length), jpg.subarray(2)])
  const { guardarFoto } = await import('../src/chat/adjuntos.ts')
  const r = guardarFoto('foto.jpg', conExif)
  const tam = (b: Buffer) => { for (let i = 2; i < b.length - 8; i++) if (b[i] === 0xff && (b[i + 1] === 0xc0 || b[i + 1] === 0xc2)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; return null }
  assert.deepEqual(tam(r.datos), [20, 40], 'ancho y alto, ya derecha')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('adjuntos: un archivo (PDF, Word, texto) se guarda con su texto; el turno lo lee entero y los siguientes, su comienzo', async () => {
  const { guardarArchivo } = await import('../src/chat/adjuntos.ts')
  const texto = `Presupuesto del piloto.\n${'Línea de gasto con su monto y su porqué. '.repeat(40)}Total final: 1200.`
  const r = await guardarArchivo('presupuesto [v2].txt', Buffer.from(texto))
  assert.match(r.url, /^\/adjuntos\/\d+-[0-9a-f]{10}\.txt$/)
  assert.equal(r.nombre, 'presupuesto  v2 .txt', 'el nombre no rompe la marca')
  assert.equal(r.marca, `[archivo:${r.url}|${r.nombre}|${r.palabras} palabras]`)
  const mensaje = `Revisame esto\n${r.marca}`
  assert.match(comoTexto(mensaje), /\(archivo adjunto «presupuesto {2}v2 \.txt», \d+ palabras; empieza: «Presupuesto del piloto\./)
  assert.doesNotMatch(comoTexto(mensaje), /Total final/, 'en los turnos siguientes, solo el comienzo')
  const turno = conImagenes(mensaje) as string
  assert.match(turno, /--- Archivo adjunto «presupuesto {2}v2 \.txt» \(\d+ palabras\) ---\nPresupuesto del piloto\.[\s\S]*Total final: 1200\.\n--- fin del archivo ---/, 'en su turno, entero')
  await assert.rejects(guardarArchivo('programa.exe', Buffer.from('MZ')), /lee PDF, Word, Excel, PowerPoint y texto/)
  await assert.rejects(guardarArchivo('pagina.html', Buffer.from('<script>alert(1)</script>')), /lee PDF/, 'nada que pueda correr en la página')
})
