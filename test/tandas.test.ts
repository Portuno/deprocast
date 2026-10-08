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

process.env.MASTRO_TANDAS = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-tandas-'))

test('tandas: la fecha sale del nombre del archivo', () => {
  assert.deepEqual(fechaDeNombre('2026-09-30 06.21.00.m4a'), { fecha: '2026-09-30', hora: '06:21' })
  assert.deepEqual(fechaDeNombre('AUD-20260930-WA0001.opus'), { fecha: '2026-09-30', hora: null })
  assert.deepEqual(fechaDeNombre('20260930_062100.m4a'), { fecha: '2026-09-30', hora: '06:21' })
  assert.deepEqual(fechaDeNombre('Grabación 30-09-2026.m4a'), { fecha: '2026-09-30', hora: null })
  assert.deepEqual(fechaDeNombre('Nota de voz 3.9.26.m4a'), { fecha: '2026-09-03', hora: null })
  assert.equal(fechaDeNombre('mi audio.m4a'), null)
})

test('tandas: audios en cola, sin duplicar; con varias voces el escriba aprende solo de él', async () => {
  const db = abrir(':memory:')
  marcarJugador(db, asegurarEntidad(db, { tipo: 'persona', nombre: 'Jugador Prueba', origenId: 't:yo' }))
  const largo = 'Yo creo que el proyecto tiene que salir este mes, voy a terminar la escena siete mañana temprano. '.repeat(3)
  const ajeno = 'Y yo te digo que no, que mi viaje a Roma es lo primero y que vendí el auto. '.repeat(3)
  _probarTandas({ transcribir: async () => `${largo} ${ajeno}` })
  _probarModelo(async () => ({
    texto: JSON.stringify({ titulo: 'Charla del proyecto', voces: 2, operador: 'A', nombres: { B: 'Ana' }, turnos: [{ voz: 'A', texto: largo }, { voz: 'B', texto: ajeno }] }),
    llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1,
  }))
  const aprendido: string[] = []
  _probarTandas({ escriba: async (_db, t) => { aprendido.push(t); return [] } })

  const a = encolar(db, { nombre: 'AUD-20260930-WA0001.opus', datos: Buffer.from('audio-1') })
  assert.equal(a.tanda.tipo, 'audio')
  assert.equal(a.tanda.fecha, '2026-09-30')
  assert.equal(encolar(db, { nombre: 'copia.opus', datos: Buffer.from('audio-1') }).repetida, true)
  assert.throws(() => encolar(db, { nombre: 'planilla.xlsx', datos: Buffer.from('x') }), /No sé qué hacer/)

  assert.equal(await procesarTandas(db), 1)
  const t = leerTanda(db, a.tanda.id)!
  assert.equal(t.estado, 'hecha')
  const p = leerPieza(db, t.piezaId!)!
  assert.equal(p.nivel, 'propia')
  assert.equal(p.fecha, '2026-09-30')
  assert.match(p.titulo, /^Audio · 2026-09-30 · Charla del proyecto/)
  assert.match(p.contenido, /^\[Jugador Prueba\] Yo creo/)
  assert.match(p.contenido, /\n\[Ana\] Y yo te digo/)
  assert.ok(p.etiquetas.includes('varias-voces'))
  assert.equal(aprendido.length, 1)
  assert.ok(aprendido[0].includes('escena siete') && !aprendido[0].includes('Roma'), 'lo de Ana no se aprende como suyo')
})

test('tandas: si no se sabe cuál voz es él, no aprende; si el modelo resume en vez de copiar, se queda con todo', async () => {
  const db = abrir(':memory:')
  const texto = 'Una charla larga entre varias personas sobre cosas de la oficina y otros temas variados. '.repeat(8)
  _probarModelo(async () => ({ texto: JSON.stringify({ voces: 2, operador: null, turnos: [{ voz: 'A', texto: texto.slice(0, 300) }, { voz: 'B', texto: texto.slice(300) }] }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }))
  const v = await separarVoces(db, texto, 'Jugador')
  assert.equal(v.operador, null)
  const aprendido: string[] = []
  _probarTandas({ transcribir: async () => texto, escriba: async (_db, t) => { aprendido.push(t); return [] } })
  encolar(db, { nombre: 'reunion.m4a', datos: Buffer.from('audio-2') })
  await procesarTandas(db)
  assert.equal(aprendido.length, 0, 'de una grabación ajena no aprende nada')

  _probarModelo(async () => ({ texto: JSON.stringify({ voces: 1, operador: 'A', turnos: [{ voz: 'A', texto: 'resumen corto' }] }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }))
  const r = await separarVoces(db, texto, 'Jugador')
  assert.equal(r.turnos[0].texto, texto, 'no se pierde texto')
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
