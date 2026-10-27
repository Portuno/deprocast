import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
const { abrir } = await import('../src/db.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const inf = await import('../src/informe.ts')
const { correrRutinas } = await import('../src/rutinas.ts')
const { insertar } = await import('../src/corpus.ts')
const mcp = await import('../src/mcp.ts')
const apps = await import('../src/apps.ts')

// Domingo 1/11/2026: la semana va del lunes 26/10 al domingo 1/11.
const DOMINGO = (h: number, m = 0) => new Date(2026, 10, 1, h, m).getTime()
const MARTES = new Date(2026, 9, 27, 10).getTime()
let pedidos = 0
_probarModelo(async () => { pedidos++; return { texto: JSON.stringify({ apertura: 'Una semana de archivo más que de acción, señor.' }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 5 } })

function sembrar() {
  const db = abrir(':memory:')
  insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Una nota', contenido: 'Algo que pensó el martes.', estado: 'disponible' }, MARTES)
  insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Otra nota', contenido: 'Algo más.', estado: 'disponible' }, MARTES)
  insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Vieja', contenido: 'De otro mes.', estado: 'disponible' }, new Date(2026, 8, 1).getTime())
  const mov = db.prepare('INSERT INTO movimientos (fecha, monto, moneda, categoria, descripcion, origen, huella, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  mov.run('2026-10-27', 1200, 'EUR', 'ingresos', 'Un cobro', 'manual', 'a', MARTES)
  mov.run('2026-10-28', -80, 'EUR', 'comida', 'El súper', 'manual', 'b', MARTES)
  mov.run('2026-09-10', -500, 'EUR', 'alquiler', 'Fuera del rango', 'manual', 'c', MARTES)
  return db
}

test('Las secciones de un período: solo las que tuvieron movimiento, cada una con su vista, y el rango manda', async () => {
  const db = sembrar()
  const s = await inf.seccionesDe(db, '2026-10-26', '2026-11-01', { ahora: DOMINGO(22) })
  const claves = s.map((x) => x.clave)
  assert.ok(claves.includes('archivo') && claves.includes('plata'))
  assert.ok(!claves.includes('agentes') && !claves.includes('cuerpo'), 'lo vacío no va')
  assert.match(s.find((x) => x.clave === 'archivo')!.lineas[0], /^2 piezas nuevas/)
  const plata = s.find((x) => x.clave === 'plata')!
  assert.equal(plata.vista, 'jugador')
  assert.match(plata.lineas[0], /1\.200 €.*80 €/)
  assert.doesNotMatch(plata.lineas.join(' '), /alquiler/, 'lo de fuera del rango no entra')
  const septiembre = await inf.seccionesDe(db, '2026-09-01', '2026-09-30', { ahora: DOMINGO(22) })
  assert.match(septiembre.find((x) => x.clave === 'plata')!.lineas.join(' '), /alquiler 500 €/)
  await assert.rejects(inf.seccionesDe(db, '2026-11-01', '2026-10-01'), /antes/)
  await assert.rejects(inf.seccionesDe(db, '2025-01-01', '2026-11-01'), /366 días/)
  await assert.rejects(inf.seccionesDe(db, '1/11', '2026-11-01'), /AAAA-MM-DD/)
})

test('Entre fechas: se guarda como reporte y pieza; con modelo, la apertura de Mastropiero', async () => {
  const db = sembrar()
  const sin = await inf.armarInforme(db, { desde: '2026-10-26', hasta: '2026-10-31', ahora: DOMINGO(12) })
  assert.equal(sin.apertura, null)
  assert.equal(pedidos, 0, 'sin modelo no se llama a nadie')
  assert.match(sin.texto, /^# Informe del 2026-10-26 al 2026-10-31/)
  assert.ok(sin.piezaId)
  const con = await inf.armarInforme(db, { desde: '2026-10-26', hasta: '2026-10-31', conModelo: true, ahora: DOMINGO(12) })
  assert.match(con.apertura!, /señor/)
  assert.deepEqual(inf.listarInformes(db).map((i) => i.id), [con.id, sin.id])
  assert.equal(inf.leerInforme(db, con.id)!.secciones.length, con.secciones.length)
})

test('El domingo: los avisos de las rutinas van al informe (no sueltos a Hoy), el informe los junta y los marca; con el informe apagado vuelven a Hoy', async () => {
  const db = sembrar()
  const hoy = () => (db.prepare(`SELECT COUNT(*) AS n FROM mensajes WHERE rol = 'asistente'`).get() as { n: number }).n
  const antes = hoy()
  await correrRutinas(db, DOMINGO(21, 35), { gnosis: async () => '🜂 La semana destilada: tres patrones.' })
  assert.equal(hoy(), antes, 'no llegó a Hoy')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM informe_avisos WHERE informe_id IS NULL').get() as { n: number }).n, 1)

  const semanal = await inf.informeSemanal(db, { ahora: DOMINGO(21, 50) })
  assert.equal(semanal!.tipo, 'semanal')
  assert.equal(semanal!.desde, '2026-10-26')
  assert.match(semanal!.secciones.find((x) => x.clave === 'rutinas')!.lineas[0], /tres patrones/)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM informe_avisos WHERE informe_id IS NULL').get() as { n: number }).n, 0, 'quedaron marcados')

  // Ya salió hoy: lo que llegue después va a Hoy.
  db.prepare(`UPDATE rutinas SET ultima_fecha = '2026-11-01' WHERE id = 'informe_semanal'`).run()
  db.prepare(`UPDATE rutinas SET ultima_fecha = NULL WHERE id = 'lecciones'`).run()
  await correrRutinas(db, DOMINGO(22), { lecciones: async () => 'Aprendí de tu feedback.' })
  assert.equal(hoy(), antes + 1)

  // Apagado el informe: como era antes.
  db.prepare(`UPDATE rutinas SET activa = 0, ultima_fecha = NULL WHERE id = 'informe_semanal'`).run()
  assert.equal(inf.vaAlInforme(db, 'gnosis', '2026-11-08'), false)
  db.prepare(`UPDATE rutinas SET activa = 1 WHERE id = 'informe_semanal'`).run()
  assert.equal(inf.vaAlInforme(db, 'gnosis', '2026-11-08'), true)
  assert.equal(inf.vaAlInforme(db, 'jornada', '2026-11-08'), false, 'solo las del domingo')
  assert.ok(!db.prepare(`SELECT 1 FROM rutinas WHERE id IN ('reporte_semanal', 'misiones_semana', 'grafo_semana')`).get(), 'las tres que reemplaza ya no están')
})

test('Por MCP: ver_informe arma cualquier período sin guardarlo', async () => {
  const db = sembrar()
  const { app } = apps.crearApp(db, 'Claude', ['leer'])
  const r: any = await mcp.atenderMcp(db, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ver_informe', arguments: { desde: '2026-10-26', hasta: '2026-11-01' } } }, app, DOMINGO(22))
  assert.match(r.result.content[0].text, /Su archivo/)
  assert.equal(inf.listarInformes(db).length, 0, 'leer no guarda nada')
})
