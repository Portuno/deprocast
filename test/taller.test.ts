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

test('Taller: imagen con aspecto, estilo y variantes; la librería agrupa versiones; borrar; personaje desde alguien de su mundo; charla; sugerencias', async () => {
  const { libreria, borrarArtefacto, crearCharla, sugerenciasTaller } = await import('../src/taller.ts')
  const { asegurarEntidad } = await import('../src/entidades.ts')
  const { insertar } = await import('../src/corpus.ts')
  const db = abrir(':memory:')
  const pedidos: string[] = []
  _probarTaller({ imagen: async (p, o) => { pedidos.push(`${o.tamano}|${p}`); return PNG }, voz: async (t) => Buffer.from(`mp3:${t}`) })
  const vistos: string[] = []
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    const u = String(o.mensajes.at(-1)!.content)
    vistos.push(u)
    if (s.includes('diseñás un personaje')) return { texto: JSON.stringify({ nombre: 'Ana de cuento', descripcion: 'Guía de barrio.', personalidad: ['curiosa'], apariencia_prompt: 'woman guide', frase: 'Vamos por acá', voz: 'ef_dora' }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    if (s.includes('charla corta entre dos voces')) return { texto: JSON.stringify({ titulo: 'Sobre mapas', turnos: [{ quien: 'A', texto: 'Hablemos de mapas.' }, { quien: 'B', texto: 'Dale.' }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    if (s.includes('Proponés 3 cosas')) return { texto: JSON.stringify({ sugerencias: [{ titulo: 'Afiche', pedido: 'Un afiche del Proyecto Prueba' }, { titulo: 'x', pedido: 'y' }, { titulo: 'z', pedido: 'w' }, { titulo: 'de más', pedido: 'no' }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    return { texto: '{}', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })

  const img = await crearImagen(db, 'un faro', { aspecto: '9:16', estilo: 'acuarela', variantes: 3 })
  assert.deepEqual(img.archivos, ['imagen-1.png', 'imagen-2.png', 'imagen-3.png'])
  assert.ok(pedidos.every((p) => p.startsWith('768x1344|') && /watercolor/.test(p)))
  const v2 = await iterarArtefacto(db, img.id, 'de noche')
  assert.deepEqual([v2.version, v2.meta.aspecto, v2.meta.estilo], [2, '9:16', 'acuarela'], 'la versión nueva conserva aspecto y estilo')
  assert.match(v2.meta.prompt, /un faro\. Cambio: de noche/)
  _probarTaller({ imagen: async (_p, o) => { if (o.tamano !== '1024x1024') throw new Error('tamaño no soportado'); return PNG } })
  assert.equal((await crearImagen(db, 'otro', { aspecto: '16:9' })).estado, 'listo', 'si no acepta el tamaño, sale cuadrada')
  _probarTaller({ imagen: async () => PNG })

  const ob = libreria(db)
  assert.equal(ob.length, 2, 'una obra por cadena de versiones')
  const faro = ob.find((o) => o.raiz === img.id)!
  assert.deepEqual([faro.ultima.id, faro.versiones.map((v) => v.version)], [v2.id, [2, 1]])
  assert.equal(libreria(db, { q: 'otro' }).length, 1)

  borrarArtefacto(db, img.id)
  const tras = libreria(db).find((o) => o.ultima.id === v2.id)!
  assert.equal(tras.versiones.length, 1, 'la que salía de la borrada queda como obra propia')
  assert.ok(!fs.existsSync(carpeta(img.id)))

  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Prueba', notas: 'guía de recorridos por el barrio' })
  insertar(db, { fuente: 'operador', titulo: 'Paseo', contenido: 'Ana nos llevó por la ribera.', nivel: 'propia', entidades: [ana], origenId: 't:pa' })
  const pj = await crearPersonaje(db, '', { entidadId: ana })
  assert.equal(pj.estado, 'listo')
  assert.match(vistos.at(-1)!, /Un personaje basado en Ana Prueba[\s\S]*guía de recorridos[\s\S]*Ana nos llevó por la ribera/)

  const ch = await crearCharla(db, 'mapas de ciudad')
  assert.deepEqual([ch.tipo, ch.titulo, ch.archivos], ['voz', 'Sobre mapas', ['charla.mp3']])
  assert.deepEqual(ch.meta.guion.map((t: any) => t.voz), ['em_alex', 'ef_dora'])

  const sug = await sugerenciasTaller(db, 'imagen')
  assert.equal(sug.length, 3)
  assert.equal(sug[0].pedido, 'Un afiche del Proyecto Prueba')
})
