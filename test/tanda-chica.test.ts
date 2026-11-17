import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { motivoDeRuido } from '../src/voz-ruido.ts'
import { materialDeAutocritica, _probarArranque } from '../src/autocritica.ts'
import { aplicarCommits } from '../src/fragua-commits.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Los audios que archiva recibirVoz (Fragua #306) van a una carpeta temporal, no a la de verdad.
process.env.MASTRO_ADJUNTOS ??= fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-voz-'))

test('Fragua #305 · la escucha no anota lo que el transcriptor inventa sobre el silencio ni la palabra suelta repetida', () => {
  assert.equal(motivoDeRuido('Gracias.', []), 'alucinacion')
  assert.equal(motivoDeRuido('Subtítulos realizados por la comunidad de Amara.org', []), 'alucinacion')
  assert.equal(motivoDeRuido('¡Suscríbete!', []), 'alucinacion')
  assert.equal(motivoDeRuido('Gracias por traerme el café, después lo vemos', []), null, 'adentro de una frase real, pasa')
  assert.equal(motivoDeRuido('Dale.', ['dale', 'Dale.']), 'repetida', 'tercera vez igual en 10 minutos')
  assert.equal(motivoDeRuido('Dale.', ['dale']), null, 'dos veces todavía es habla')
  assert.equal(motivoDeRuido('Mañana a las nueve llamo al banco', ['Mañana a las nueve llamo al banco', 'Mañana a las nueve llamo al banco']), null, 'una frase larga repetida no es ruido de una palabra')
})

test('Fragua #305 · recibirVoz: un «Gracias.» suelto no deja turno ni nota, y queda contado como ruido', async () => {
  const d = await import('../src/dispositivos.ts')
  const db = abrir(':memory:')
  d._probarDispositivos({ transcribir: async () => 'Gracias.' })
  const disp = { id: 1, nombre: 'Teléfono', estado: 'activo' } as any
  const r = await d.recibirVoz(db, disp, Buffer.alloc(100, 1), 'voz.wav', { modo: 'pasivo', inicio: Date.now(), fin: Date.now(), caminando: false } as any)
  assert.deepEqual(r, { texto: '', destino: 'nada' })
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM voz_segmentos WHERE destino = 'ruido'`).get() as any).n, 1)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM corpus`).get() as any).n, 0)
})

test('Fragua #308 · la lentitud de antes del último arranque (otro código) no llega a la autocrítica', () => {
  const db = abrir(':memory:')
  const T = new Date('2026-11-17T12:00:00').getTime()
  _probarArranque(T - 3_600_000)
  db.prepare(`INSERT INTO errores (origen, texto, veces, primera, ultima) VALUES ('lento', 'paso reproceso:destilado tardó 13842 ms', 3, ?, ?)`).run(T - 5 * 3_600_000, T - 4 * 3_600_000)
  db.prepare(`INSERT INTO errores (origen, texto, veces, primera, ultima) VALUES ('lento', 'GET /api/x tardó 2500 ms', 2, ?, ?)`).run(T - 600_000, T - 300_000)
  const m = materialDeAutocritica(db, T)
  assert.doesNotMatch(m, /destilado/, 'de antes del arranque: no cuenta')
  assert.match(m, /GET \/api\/x tardó 2500 ms/, 'de ahora: cuenta')
})

test('Fragua #307 · un commit que no nombra la propuesta pero se le parece la deja «por confirmar», sin cerrarla', () => {
  const db = abrir(':memory:')
  const id = Number(db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, creada_en) VALUES ('Compartir desde cualquier aplicación hacia Deprocast con vista previa', 'x', 'pantalla', 'alta', 'abierta', 1)`).run().lastInsertRowid)
  const otra = Number(db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, creada_en) VALUES ('Mapa por capas con encuadre propio', 'x', 'pantalla', 'baja', 'abierta', 1)`).run().lastInsertRowid)
  const r = aplicarCommits(db, [{ sha: 'abc1234def', mensaje: 'Mobile 1.3: Compartir desde cualquier aplicación, con vista previa y nota', fecha: '2026-11-16T10:00:00Z', autor: 'Portuno', url: null }])
  assert.deepEqual(r.posibles, [id])
  const p = db.prepare('SELECT estado, nota FROM propuestas WHERE id = ?').get(id) as any
  assert.equal(p.estado, 'abierta', 'no se cierra sola')
  assert.match(p.nota, /^Puede que la haya resuelto abc1234/)
  assert.equal((db.prepare('SELECT nota FROM propuestas WHERE id = ?').get(otra) as any).nota, null)
})

test('Fragua #303 · el chat no espera el archivo para lo del presente; lo espera más cuando se le pide memoria', async () => {
  const { necesidadDeArchivo } = await import('../src/chat/index.ts')
  assert.equal(necesidadDeArchivo('¿Qué tengo hoy?'), 'no')
  assert.equal(necesidadDeArchivo('recordame a las 18 que llame al banco'), 'no')
  assert.equal(necesidadDeArchivo('¿cuántos pasos llevo?'), 'no')
  assert.equal(necesidadDeArchivo('reservame en un restaurante para el sábado'), 'no')
  assert.equal(necesidadDeArchivo('¿te acordás lo que hablamos del documental?'), 'larga')
  assert.equal(necesidadDeArchivo('¿qué sé de la productora?'), 'larga')
  assert.equal(necesidadDeArchivo('¿Qué tengo hoy con lo que hablamos ayer?'), 'larga', 'pedir memoria manda')
  assert.equal(necesidadDeArchivo('Pensemos una estrategia para el lanzamiento'), 'corta')
})
