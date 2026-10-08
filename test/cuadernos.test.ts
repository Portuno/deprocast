import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarTaller } from '../src/taller.ts'
import { charla, crearCuaderno, fragmentosPara, guia, leerCuaderno, notas, preguntar, quitarFuente, sumarFuentes } from '../src/cuadernos.ts'

process.env.MASTRO_TALLER = fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-cuad-'))

test('cuadernos: fuentes, fragmentos relevantes, respuesta con citas reales, guía y charla de dos voces', async () => {
  const db = abrir(':memory:')
  const a = insertar(db, { fuente: 'operador', titulo: 'Sobre abejas', contenido: 'Las abejas polinizan flores. '.repeat(10) + 'La reina pone huevos.', nivel: 'primaria', origenId: 'q:a' })!
  const b = insertar(db, { fuente: 'operador', titulo: 'Sobre trenes', contenido: 'Los trenes de vapor usaban carbón.', nivel: 'primaria', origenId: 'q:b' })!
  const c = crearCuaderno(db, 'Bichos')
  assert.throws(() => crearCuaderno(db, '  '), /nombre/)
  await assert.rejects(preguntar(db, c.id, '¿Qué hace la reina?'), /no tiene fuentes/)

  await sumarFuentes(db, c.id, { piezas: [a, b, a, 999], texto: { titulo: 'Mi nota', contenido: 'Vi un enjambre en el parque.' } })
  const cu = leerCuaderno(db, c.id)!
  assert.deepEqual(cu.fuentes.map((f) => f.titulo), ['Sobre abejas', 'Sobre trenes', 'Mi nota'])
  assert.equal(fragmentosPara(db, c.id, 'reina huevos', 1)[0].pieza.id, a, 'el fragmento que habla de eso primero')

  let vio = ''
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    vio = String(o.mensajes.at(-1)!.content)
    const texto = s.includes('guion de una charla') ? JSON.stringify({ titulo: 'x', turnos: [{ quien: 'A', texto: '¿Sabías de las abejas?' }, { quien: 'B', texto: 'Polinizan.' }] })
      : s.includes('guía de un cuaderno') ? JSON.stringify({ resumen: 'Abejas y trenes.', ideas: ['Las abejas polinizan [1]'], preguntas: ['¿Y la reina?'] })
      : 'La reina pone huevos [1]. Inventado [9].'
    return { texto, llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  const n = await preguntar(db, c.id, '¿Qué hace la reina?')
  assert.match(vio, /PREGUNTA: ¿Qué hace la reina\?/)
  assert.match(vio, /\[1\] \(Sobre abejas\)/)
  assert.deepEqual(n.citas.map((x) => [x.n, x.piezaId]), [[1, a]], 'solo citas que existen')

  const g = await guia(db, c.id)
  assert.match(g.texto, /\*\*Resumen\.\*\* Abejas y trenes\./)
  assert.match(g.texto, /- ¿Y la reina\?/)

  const voces: string[] = []
  _probarTaller({ voz: async (t, v) => { voces.push(v); return Buffer.from(`[${t}]`) } })
  const { nota, artefacto } = await charla(db, c.id)
  assert.deepEqual(voces, ['ef_dora', 'em_alex'])
  assert.equal(artefacto.estado, 'listo')
  assert.equal(fs.readFileSync(path.join(process.env.MASTRO_TALLER!, String(artefacto.id), 'charla.mp3'), 'utf8'), '[¿Sabías de las abejas?][Polinizan.]')
  assert.equal(nota.artefactoId, artefacto.id)
  assert.deepEqual(notas(db, c.id).map((x) => x.tipo), ['respuesta', 'guia', 'audio'])

  quitarFuente(db, c.id, b)
  assert.equal(leerCuaderno(db, c.id)!.fuentes.length, 2)
})
