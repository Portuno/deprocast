import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

process.env.MASTRO_TALLER = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-'))
const { abrir } = await import('../src/db.ts')
const { hayFfmpeg, carpeta, libreria } = await import('../src/taller.ts')
const es = await import('../src/estudio.ts')
const { qrMatriz } = await import('../src/qr.ts')

const conFfmpeg = hayFfmpeg()
/** Un video de prueba (barras de color y un tono), apaisado, de 4 segundos. */
function videoDePrueba(): string {
  const f = path.join(os.tmpdir(), `prueba-${Math.random().toString(36).slice(2)}.mp4`)
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f])
  return f
}

test('estudio: capas validadas y acotadas; el agente solo aplica operaciones válidas', () => {
  const c = es.normalizarCapa({ tipo: 'texto', x: 3, y: -1, w: 0.001, desde: 2, hasta: 99, estilo: { color: 'javascript:alert(1)', tam: 9, animacion: 'explotar' }, datos: { texto: 'Hola'.repeat(200) } }, 10)!
  assert.deepEqual([c.x, c.y, c.w, c.desde, c.hasta], [0.98, 0, 0.03, 2, 10])
  assert.deepEqual([c.estilo.color, c.estilo.tam, c.estilo.animacion], ['#ffffff', 0.2, 'aparecer'])
  assert.equal(c.datos.texto.length, 300)
  assert.equal(es.normalizarCapa({ tipo: 'virus' }, 10), null)

  const base = [es.capaNueva('titulo', 10, { id: 'tit1' }), es.capaNueva('chat', 10, { id: 'chat1' })]
  const r = es.aplicarOperaciones(base, [
    { op: 'agregar', capa: { tipo: 'cartel', datos: { modo: 'grabando' } } },
    { op: 'agregar', capa: { tipo: 'bomba' } },
    { op: 'cambiar', id: 'tit1', cambios: { datos: { titulo: 'Ana Prueba' }, estilo: { fondo: '#112233' } } },
    { op: 'quitar', id: 'chat1' },
    { op: 'quitar', id: 'no-existe' },
  ], 10)
  assert.equal(r.hechas, 3)
  assert.deepEqual(r.capas.map((x) => x.tipo), ['titulo', 'cartel'])
  assert.deepEqual([r.capas[0].datos.titulo, r.capas[0].datos.subtitulo, r.capas[0].estilo.fondo], ['Ana Prueba', 'Rol', '#112233'], 'cambiar conserva lo que no toca')
})

test('estudio: subtítulos desde las palabras con tiempo; el ASS y el filtergraph', () => {
  const cues = es.cuesDePalabras([
    { start: 0, end: 0.4, word: 'Hola,' }, { start: 0.4, end: 0.8, word: 'esto' }, { start: 0.8, end: 1.2, word: 'es' }, { start: 1.2, end: 1.6, word: 'una' }, { start: 1.6, end: 2, word: 'prueba.' },
    { start: 3.5, end: 3.9, word: 'Después' }, { start: 3.9, end: 4.2, word: 'de' }, { start: 4.2, end: 4.6, word: 'una' }, { start: 4.6, end: 5, word: 'pausa' },
  ])
  assert.deepEqual(cues.map((q) => q.texto), ['Hola, esto es una prueba.', 'Después de una pausa'])
  assert.equal(cues[0].palabras!.length, 5)

  const p: any = { fuente: { artefacto: 1, archivo: 'fuente.mp4' }, duracion: 6, ancho: 640, alto: 360, formato: '9:16', encuadre: 'desenfoque', recorte: null, capas: [
    es.capaNueva('subtitulos', 6, { datos: { cues, preset: 'palabra' } }),
    es.capaNueva('titulo', 6, { desde: 1, hasta: 4, datos: { titulo: 'Ana {Prueba}', subtitulo: 'Guía' } }),
    es.capaNueva('chat', 6, { datos: { mensajes: [{ usuario: 'uno', texto: 'qué bueno' }, { usuario: 'dos', texto: 'genial' }] } }),
    es.capaNueva('color', 6, { desde: 2, hasta: 3, datos: { preset: 'noir' } }),
    es.capaNueva('qr', 6, { id: 'q1', datos: { destino: 'https://example.com' } }),
    es.capaNueva('progreso', 6),
  ] }
  const ass = es.armarAss(p)
  assert.match(ass, /PlayResX: 720\nPlayResY: 1280/)
  assert.equal((ass.match(/,Palabra,/g) ?? []).length, 9, 'palabra por palabra: un evento por palabra')
  assert.match(ass, /0:00:01\.00,0:00:04\.00,Base.*\\pos\(36,922\).*\{\\b1\}Ana Prueba\{\\b0\}\\N.*Guía/)
  assert.match(ass, /uno.*qué bueno\\N.*dos.*genial/)
  assert.equal(es.aAss('#ff8800'), '&H000088FF')
  assert.equal(es.aAss('rgba(0,0,0,0.5)'), '&H80000000')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rend-'))
  fs.writeFileSync(path.join(dir, 'qr-q1.png'), 'x')
  const args = es.armarRender(p, { fuente: 'fuente.mp4', dir, salida: 'video.mp4' })
  const fg = args[args.indexOf('-filter_complex') + 1]
  assert.match(fg, /boxblur.*overlay=\(W-w\)\/2:\(H-h\)\/2/, 'reencuadre con fondo desenfocado')
  assert.match(fg, /hue=s=0,eq=contrast=1\.30.*enable='between\(t,2\.00,3\.00\)'/, 'el color solo en su tramo')
  assert.match(fg, /\[1:v\]scale=\d+:-1.*overlay=\d+:\d+:shortest=1:enable=/, 'el QR como imagen superpuesta')
  assert.match(fg, /drawbox=.*w='720\*t\/6\.00'/, 'la barra crece con el tiempo')
  assert.match(fg, /subtitles=capas\.ass/)
})

test('estudio: QR legible por estructura (buscadores en tres esquinas)', () => {
  const m = qrMatriz('https://example.com')
  assert.equal(m.length, 25)
  for (const [x, y] of [[0, 0], [18, 0], [0, 18]]) assert.ok(m[y][x] && m[y + 6][x + 6] && !m[y + 1][x + 1] && m[y + 3][x + 3], `buscador en ${x},${y}`)
})

test('estudio: de un video a la exportación vertical, con transcripción, agente, deshacer, momentos, plantillas y Cuentas', { skip: !conFfmpeg && 'sin ffmpeg' }, async () => {
  const db = abrir(':memory:')
  const a = es.crearEstudio(db, { archivo: videoDePrueba(), titulo: 'Charla de prueba' })
  const { p } = es.proyectoDe(db, a.id)
  assert.deepEqual([p.formato, Math.round(p.duracion), p.ancho, p.alto], ['16:9', 4, 640, 360])
  assert.ok(fs.existsSync(path.join(carpeta(a.id), 'fuente.mp4')))

  es._probarEstudio({
    transcribir: async () => ({ texto: 'Hola a todos. Esto es Deprocast.', palabras: [{ start: 0.2, end: 0.6, word: 'Hola' }, { start: 0.6, end: 0.9, word: 'a' }, { start: 0.9, end: 1.4, word: 'todos.' }, { start: 2, end: 2.4, word: 'Esto' }, { start: 2.4, end: 2.6, word: 'es' }, { start: 2.6, end: 3.4, word: 'Deprocast.' }] }),
    agente: async (_db, _s, u) => {
      assert.match(u, /Lo que se dice: Hola a todos\./)
      return { mensaje: 'Le di aire de stream.', operaciones: [{ op: 'agregar', capa: { tipo: 'cartel', datos: { modo: 'vivo' } } }, { op: 'agregar', capa: { tipo: 'titulo', x: 0.05, y: 0.7, datos: { titulo: 'Jugador Prueba', subtitulo: 'Deprocast' } } }, { op: 'agregar', capa: { tipo: 'color', datos: { preset: 'cine' } } }] }
    },
    momentosIA: async () => ({ momentos: [{ titulo: 'El saludo', desde: 0, hasta: 3.5, por_que: 'Arranca con energía' }, { titulo: 'Muy corto', desde: 1, hasta: 1.5 }] }),
    redactar: async () => ({ texto: 'Mirá esto: Deprocast en acción.' }),
  })
  const sub = await es.transcribirEstudio(db, a.id)
  assert.equal(sub.datos.cues.length, 2)
  const r = await es.agenteDeCapas(db, a.id, 'que parezca un stream de cine')
  assert.deepEqual([r.hechas, r.mensaje], [3, 'Le di aire de stream.'])
  assert.equal(es.proyectoDe(db, a.id).p.capas.length, 4)
  es.deshacerEstudio(db, a.id)
  assert.equal(es.proyectoDe(db, a.id).p.capas.length, 1, 'deshacer vuelve a antes del agente')
  await es.agenteDeCapas(db, a.id, 'de nuevo')

  // Plantilla: se guarda (sin subtítulos), viaja como zip y se aplica a otro proyecto.
  const pl = es.guardarPlantilla(db, a.id, { nombre: 'Marca de prueba', marca: 'Dorado #c4a062 sobre negro' })
  assert.deepEqual(pl.capas.map((c) => c.tipo).sort(), ['cartel', 'color', 'titulo'])
  const zip = es.exportarPlantilla(db, pl.id)
  const otra = es.importarPlantilla(db, zip.zip)
  assert.equal(otra.capas.length, 3)
  assert.equal(otra.marca, 'Dorado #c4a062 sobre negro')

  // Vertical con fondo desenfocado y exportar.
  es.guardarEstudio(db, a.id, { formato: '9:16', encuadre: 'desenfoque' })
  const v = await es.exportarEstudio(db, a.id)
  assert.equal(v.estado, 'listo', v.progreso ?? '')
  assert.deepEqual([v.version, v.padreId], [2, a.id])
  const s = es.sondear(path.join(carpeta(v.id), 'video.mp4'))
  assert.deepEqual([s.ancho, s.alto, Math.round(s.duracion), s.audio], [720, 1280, 4, true])
  assert.ok(v.archivos.includes('miniatura.jpg'))
  assert.equal(libreria(db).find((o) => o.raiz === a.id)!.versiones.length, 2, 'la exportación es una versión de la obra')

  // Momentos: cada uno, un proyecto vertical recortado con sus subtítulos corridos.
  const ms = await es.momentosEstudio(db, a.id)
  assert.equal(ms.length, 1, 'el de menos de 3 segundos no va')
  const m = es.proyectoDe(db, ms[0].id).p
  assert.deepEqual([m.formato, m.recorte], ['9:16', { desde: 0, hasta: 3.5 }])
  assert.equal(m.capas.find((c) => c.tipo === 'subtitulos')!.datos.preset, 'palabra')

  // Cuentas: queda en borrador, con el video adjunto.
  const cuenta = Number(db.prepare(`INSERT INTO cuentas (red, usuario, modo, creada_en) VALUES ('linkedin', 'prueba', 'redacta', 1)`).run().lastInsertRowid)
  await assert.rejects(es.mandarACuentas(db, a.id, cuenta), /Primero exportá/)
  const pub = await es.mandarACuentas(db, v.id, cuenta)
  const fila = db.prepare('SELECT estado, adjunto, texto FROM publicaciones WHERE id = ?').get(pub.publicacion) as any
  assert.deepEqual([fila.estado, fila.adjunto, fila.texto], ['borrador', `/taller/${v.id}/video.mp4`, 'Mirá esto: Deprocast en acción.'])
})
