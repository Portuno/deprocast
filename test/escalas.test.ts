import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarFuente, insertar } from '../src/corpus.ts'
import { HERRAMIENTAS, ejecutarHerramienta } from '../src/chat/herramientas.ts'
import { ACCIONES } from '../src/rutinas.ts'
import { _probarEscalas, armarHaciaArriba, escalasDe, leerEscala, pasadaNocturna, periodo, piezasDelDia, verEscala } from '../src/escalas.ts'

test('#286: el calendario de las escalas (semana ISO, mes, trimestre, cuatrimestre, semestre, año, lustro)', () => {
  assert.deepEqual(periodo('semana', '2026-11-15'), { clave: '2026-W46', desde: '2026-11-09', hasta: '2026-11-15' })
  assert.deepEqual(periodo('semana', '2027-01-01'), { clave: '2026-W53', desde: '2026-12-28', hasta: '2027-01-03' }, 'la semana del cambio de año es del año de su jueves')
  assert.deepEqual(periodo('mes', '2026-02-10'), { clave: '2026-02', desde: '2026-02-01', hasta: '2026-02-28' })
  assert.deepEqual(periodo('trimestre', '2026-11-15'), { clave: '2026-T4', desde: '2026-10-01', hasta: '2026-12-31' })
  assert.deepEqual(periodo('cuatrimestre', '2026-11-15'), { clave: '2026-C3', desde: '2026-09-01', hasta: '2026-12-31' })
  assert.deepEqual(periodo('semestre', '2026-03-01'), { clave: '2026-S1', desde: '2026-01-01', hasta: '2026-06-30' })
  assert.deepEqual(periodo('lustro', '2026-11-15'), { clave: '2025-2029', desde: '2025-01-01', hasta: '2029-12-31' })
  assert.equal(escalasDe('2026-11-15').length, 8)
})

test('#286: un audio del 15/11 cae en su día; el día se arma desde sus piezas y cada escala desde la de abajo', async () => {
  const db = abrir(':memory:')
  asegurarFuente(db, { id: 'voz', nombre: 'Notas de voz', nivel: 'propia' })
  asegurarFuente(db, { id: 'web', nombre: 'Web', nivel: 'primaria' })
  insertar(db, { fuente: 'voz', nivel: 'propia', titulo: 'Audio · caminata', contenido: 'Pensé en el taller de IA para abogados.', fecha: '2026-11-15' })
  insertar(db, { fuente: 'voz', nivel: 'propia', titulo: 'Audio · noche', contenido: 'Mañana llamo a la imprenta.', fecha: '2026-11-15T22:10:00' })
  insertar(db, { fuente: 'web', nivel: 'primaria', titulo: 'Un artículo', contenido: 'No es suyo.', fecha: '2026-11-15' })
  insertar(db, { fuente: 'voz', nivel: 'propia', titulo: 'Audio · lunes', contenido: 'Arranqué la semana.', fecha: '2026-11-09' })
  assert.deepEqual(piezasDelDia(db, '2026-11-15').map((p) => p.titulo), ['Audio · caminata', 'Audio · noche'], 'solo lo suyo, por su fecha')

  const pedidos: { sistema: string; usuario: string }[] = []
  _probarEscalas(async (_db, sistema, usuario) => { pedidos.push({ sistema, usuario }); return `resumen ${pedidos.length}` })
  const hechas = await armarHaciaArriba(db, '2026-11-15', Date.UTC(2026, 10, 16))
  assert.deepEqual(hechas, ['dia 2026-11-15', 'semana 2026-W46', 'mes 2026-11', 'trimestre 2026-T4', 'cuatrimestre 2026-C3', 'semestre 2026-S2', 'año 2026', 'lustro 2025-2029'])
  assert.match(pedidos[0].usuario, /Pensé en el taller de IA/)
  assert.doesNotMatch(pedidos[0].usuario, /No es suyo/)
  assert.match(pedidos[1].usuario, /## 2026-11-15\nresumen 1/, 'la semana se arma desde el resumen del día, no desde el chat')
  assert.equal(leerEscala(db, 'dia', '2026-11-15')!.piezas, 2)

  // Sin cambios abajo, no se rehace nada; con una pieza nueva en el día, se rehace el día y todo lo de arriba.
  assert.deepEqual(await armarHaciaArriba(db, '2026-11-15'), [])
  insertar(db, { fuente: 'voz', nivel: 'propia', titulo: 'Audio · tarde', contenido: 'Una idea más.', fecha: '2026-11-15' })
  assert.equal((await armarHaciaArriba(db, '2026-11-15')).length, 8)

  // La pasada de la noche también rellena el pasado (el lunes 9, que tiene piezas y no tenía resumen).
  const r = await pasadaNocturna(db, Date.UTC(2026, 10, 16, 4), { pasado: 5 })
  assert.equal(r.fallas.length, 0)
  assert.ok(leerEscala(db, 'dia', '2026-11-09'), 'el día viejo quedó armado')
  const v = verEscala(db, 'semana', '2026-11-12')
  assert.equal(v.clave, '2026-W46')
  assert.equal(v.partes.length, 7)
  assert.ok(v.partes.find((p) => p.clave === '2026-11-15')!.texto)
  assert.equal(typeof ACCIONES.escalas, 'function')

  const h = await ejecutarHerramienta(HERRAMIENTAS, 'ver_escala', JSON.stringify({ escala: 'mes', fecha: '2026-11-20' }), { db, conversacionId: null })
  assert.equal((h.resultado as any).clave, '2026-11')
  assert.ok((h.resultado as any).texto)
})
