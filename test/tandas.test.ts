import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { leerPieza } from '../src/corpus.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { marcarJugador } from '../src/personajes.ts'
import { _probarModelo } from '../src/modelo.ts'
import { nombresDelOperador, soloSuVoz } from '../src/memoria.ts'
import { _probarTandas, encolar, fechaDeNombre, leerTanda, listarTandas, procesarTandas, separarVoces } from '../src/tandas.ts'
import { agruparFrases, frases } from '../src/voces.ts'

process.env.MASTRO_TANDAS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-tandas-'))

test('tandas: la fecha sale del nombre del archivo', () => {
  assert.deepEqual(fechaDeNombre('2026-09-30 06.21.00.m4a'), { fecha: '2026-09-30', hora: '06:21' })
  assert.deepEqual(fechaDeNombre('AUD-20260930-WA0001.opus'), { fecha: '2026-09-30', hora: null })
  assert.deepEqual(fechaDeNombre('20260930_062100.m4a'), { fecha: '2026-09-30', hora: '06:21' })
  assert.deepEqual(fechaDeNombre('Grabación 30-09-2026.m4a'), { fecha: '2026-09-30', hora: null })
  assert.deepEqual(fechaDeNombre('Nota de voz 3.9.26.m4a'), { fecha: '2026-09-03', hora: null })
  assert.equal(fechaDeNombre('mi audio.m4a'), null)
})

/** Palabras falsas de Whisper: cada frase, una palabra por token, 0,3 s cada una. */
function palabrasDe(frases: string[]) {
  const out: { start: number; end: number; word: string }[] = []
  let t = 0
  for (const f of frases) for (const w of f.split(' ')) { out.push({ start: t, end: t + 0.25, word: ` ${w}` }); t += 0.3 }
  return out
}

test('tandas: audios en cola, sin duplicar; con varias voces el escriba aprende solo de él (y nunca de lo dudoso)', async () => {
  const db = abrir(':memory:')
  marcarJugador(db, asegurarEntidad(db, { tipo: 'persona', nombre: 'Jugador Prueba', origenId: 't:yo' }))
  const frases = [
    'Yo creo que el proyecto tiene que salir este mes.',
    'Voy a terminar la escena siete mañana temprano.',
    'Y yo te digo que mi viaje a Roma es lo primero.',
    'Vendí el auto la semana pasada.',
    'No sé si esto lo dijo alguien más.',
  ]
  _probarTandas({ transcribir: async () => ({ texto: frases.join(' '), palabras: palabrasDe(frases) }) })
  let vio = ''
  _probarModelo(async (_l, o) => {
    vio = String(o.mensajes[1].content)
    return { texto: JSON.stringify({ titulo: 'Charla del proyecto', voces: 2, operador: 'A', nombres: { B: 'Ana' }, frases: ['A', 'A', 'B', 'B', '?'] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  const aprendido: string[] = []
  _probarTandas({ escriba: async (_db, t) => { aprendido.push(t); return [] } })

  const a = encolar(db, { nombre: 'AUD-20260930-WA0001.opus', datos: Buffer.from('audio-1') })
  assert.equal(a.tanda.tipo, 'audio')
  assert.equal(a.tanda.fecha, '2026-09-30')
  assert.equal(encolar(db, { nombre: 'copia.opus', datos: Buffer.from('audio-1') }).repetida, true)
  assert.throws(() => encolar(db, { nombre: 'planilla.xlsx', datos: Buffer.from('x') }), /No sé qué hacer/)

  assert.equal(await procesarTandas(db), 1)
  assert.match(vio, /\[1\] Yo creo que el proyecto/, 'el modelo ve las frases numeradas')
  assert.match(vio, /\[5\] No sé si esto/)
  const t = leerTanda(db, a.tanda.id)!
  assert.equal(t.estado, 'hecha', t.error ?? '')
  const p = leerPieza(db, t.piezaId!)!
  assert.equal(p.nivel, 'propia')
  assert.equal(p.fecha, '2026-09-30')
  assert.match(p.titulo, /^Audio · 2026-09-30 · Charla del proyecto/)
  assert.equal(p.contenido, '[Jugador Prueba] Yo creo que el proyecto tiene que salir este mes. Voy a terminar la escena siete mañana temprano.\n[Ana] Y yo te digo que mi viaje a Roma es lo primero. Vendí el auto la semana pasada.\n[¿?] No sé si esto lo dijo alguien más.')
  assert.ok(p.etiquetas.includes('varias-voces'))
  assert.deepEqual(aprendido, ['Yo creo que el proyecto tiene que salir este mes. Voy a terminar la escena siete mañana temprano.'], 'ni lo de Ana ni lo dudoso')
})

test('tandas: si no se sabe cuál es él, no aprende; si el modelo no da una voz por frase, una sola voz; una nota corta no gasta modelo', async () => {
  const db = abrir(':memory:')
  const frases = Array.from({ length: 8 }, (_, i) => `Esta es la frase número ${i} de una charla larga entre varias personas.`)
  const palabras = palabrasDe(frases)
  _probarModelo(async () => ({ texto: JSON.stringify({ voces: 2, operador: null, frases: frases.map((_, i) => (i % 2 ? 'B' : 'A')) }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }))
  const v = await separarVoces(db, frases.join(' '), 'Jugador', { palabras })
  assert.equal(v.operador, null)
  assert.equal(v.turnos.length, 8)
  const aprendido: string[] = []
  _probarTandas({ transcribir: async () => ({ texto: frases.join(' '), palabras }), escriba: async (_db, t) => { aprendido.push(t); return [] } })
  encolar(db, { nombre: 'reunion.m4a', datos: Buffer.from('audio-2') })
  await procesarTandas(db)
  assert.equal(aprendido.length, 0, 'de una grabación donde no se sabe cuál es él no aprende nada')

  _probarModelo(async () => ({ texto: JSON.stringify({ voces: 2, operador: 'A', frases: ['A', 'B'] }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }))
  const r = await separarVoces(db, frases.join(' '), 'Jugador', { palabras })
  assert.deepEqual([r.voces, r.turnos.length, r.turnos[0].texto], [1, 1, frases.join(' ')], 'no se pierde texto')

  _probarModelo(async () => { throw new Error('no debería llamar') })
  const corta = await separarVoces(db, 'Hola, me acordé de algo.', 'Jugador', { palabras: palabrasDe(['Hola, me acordé de algo.']) })
  assert.equal(corta.voces, 1)
})

test('voces: frases por puntuación o pausa; dos voces solo con tonos bien separados', () => {
  const ps = [
    { start: 0, end: 0.3, word: ' Hola,' }, { start: 0.3, end: 0.6, word: ' qué' }, { start: 0.6, end: 0.9, word: ' tal?' },
    { start: 1.0, end: 1.3, word: ' Bien' }, { start: 2.0, end: 2.3, word: ' después' }, { start: 2.3, end: 2.6, word: ' sigo.' },
  ]
  assert.deepEqual(frases(ps).map((f) => f.texto), ['Hola, qué tal?', 'Bien', 'después sigo.'], 'la pausa de 0,7 s también corta')
  const fs3 = Array.from({ length: 6 }, (_, i) => ({ desde: i * 2, hasta: i * 2 + 1.5, texto: `f${i}`, palabras: 4 }))
  const r = (tono: number) => ({ tono, timbre: Array(12).fill(0), sonoros: 10 })
  const graveAguda = agruparFrases(fs3, [12, 12.5, 20, 19.5, 12.2, 20.3].map(r))
  assert.equal(graveAguda.dos, true)
  assert.deepEqual(graveAguda.etiquetas.map((e) => (e === graveAguda.etiquetas[0] ? 'x' : 'y')).join(''), 'xxyyxy')
  assert.equal(agruparFrases(fs3, [13, 15, 17, 14, 16, 13.5].map(r)).dos, false, 'la entonación de una persona no son dos voces')
  assert.equal(agruparFrases(fs3, [12, 12, 12, 12, 12, 20].map(r)).dos, true)
  assert.equal(agruparFrases(fs3.slice(0, 2), [12, 20].map(r)).dos, false, 'con muy pocas frases no opina')
})

test('tandas: páginas de cuaderno con hoja automática y visión', async () => {
  const db = abrir(':memory:')
  const vistos: string[] = []
  _probarTandas({
    leerPagina: async (_db, _img, mime, _s, texto) => { vistos.push(`${mime} ${texto}`); return '```json\n{"titulo":"Para gobernar","transcripcion":"1. Ganar\\n2. Gobernar → sostener","dibujos":"Un triángulo con tres vértices","fecha_en_pagina":null,"legible":0.9}\n```' },
    escriba: async () => [],
  })
  encolar(db, { tipo: 'pagina', nombre: 'IMG_0001.jpg', datos: Buffer.from('jpg-1'), cuaderno: 'El Castillo', hoja: 72 })
  const b = encolar(db, { tipo: 'pagina', nombre: 'IMG_0002.jpg', datos: Buffer.from('jpg-2'), cuaderno: 'El Castillo' })
  assert.equal(b.tanda.hoja, 73, 'sigue donde quedó')
  assert.equal(await procesarTandas(db), 2)
  assert.match(vistos[0], /^image\/jpeg Página 72 del cuaderno «El Castillo»/)
  const p = leerPieza(db, leerTanda(db, b.tanda.id)!.piezaId!)!
  assert.equal(p.titulo, 'El Castillo · hoja 73 · Para gobernar')
  assert.equal(p.contenido, '1. Ganar\n2. Gobernar → sostener\n\n[Dibujos y esquemas] Un triángulo con tres vértices')
  assert.deepEqual(listarTandas(db).cuadernos, [{ nombre: 'El Castillo', ultimaHoja: 73 }])
})

test('voces en chats: aprender toma solo sus líneas', () => {
  const db = abrir(':memory:')
  marcarJugador(db, asegurarEntidad(db, { tipo: 'persona', nombre: 'Lali Prueba', alias: ['Lali'], origenId: 't:yo2' }))
  assert.deepEqual(nombresDelOperador(db).sort(), ['Lali', 'Lali Prueba'])
  const chat = '[09:15] Ana: me compré una casa\n[09:16] Lali: yo arranco el curso el lunes\n[09:17] Ana: genial\n[09:18] Lali Prueba: y termino el guion'
  assert.equal(soloSuVoz(chat, nombresDelOperador(db)), 'yo arranco el curso el lunes\ny termino el guion')
  assert.equal(soloSuVoz('[Lali Prueba] pienso esto\n[Voz B] y yo lo otro', ['Lali Prueba']), 'pienso esto')
  assert.equal(soloSuVoz('[09:15] Ana: hola\n[09:16] Beto: chau', ['Lali']), '', 'un chat donde él no habla: nada')
  assert.equal(soloSuVoz('Una nota normal sin marcas.\nOtra línea.', ['Lali']), null, 'no es un chat')
})
