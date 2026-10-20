import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
delete process.env.NAN_API_KEY

const { abrir } = await import('../src/db.ts')
const logs = await import('../src/discovery-logs.ts')
const dsc = await import('../src/discovery.ts')

const T = new Date(2026, 9, 20, 10).getTime()

/** Un log sintético de cuentas a pagar: 4 casos; el 3 con un retrabajo; traspasos entre Compras y Finanzas. */
const CSV = [
  'Case ID;Activity;Timestamp;Department',
  'F-1;Recibir factura;01/09/2026 09:00;Finanzas',
  'F-1;Pedir orden de compra;01/09/2026 10:00;Finanzas',
  'F-1;Aprobar;03/09/2026 10:00;Compras',
  'F-1;Pagar;04/09/2026 10:00;Finanzas',
  'F-2;Recibir factura;02/09/2026 09:00;Finanzas',
  'F-2;Pedir orden de compra;02/09/2026 09:30;Finanzas',
  'F-2;Aprobar;05/09/2026 09:30;Compras',
  'F-2;Pagar;06/09/2026 09:30;Finanzas',
  'F-3;Recibir factura;10/10/2026 09:00;Finanzas',
  'F-3;Pedir orden de compra;10/10/2026 09:20;Finanzas',
  'F-3;Pedir orden de compra;11/10/2026 09:20;Finanzas',
  'F-3;Aprobar;12/10/2026 09:20;Compras',
  'F-3;Pagar;13/10/2026 09:20;Finanzas',
  'F-4;Recibir factura;11/10/2026 08:00;Finanzas',
  'F-4;Pagar;11/10/2026 12:00;Finanzas',
  'mal;;sin fecha;',
].join('\n')

test('Minería de procesos sin modelo: variantes, pasos reales, esperas, retrabajos, traspasos y volumen', () => {
  const { columnas, filas } = logs.leerCsv('a,b\n"x, con coma","y ""citado"""\n')
  assert.deepEqual(columnas, ['a', 'b'])
  assert.deepEqual(filas[0], ['x, con coma', 'y "citado"'])
  assert.deepEqual(logs.adivinarMapeo(['Case ID', 'Activity', 'Timestamp', 'Department']), { caso: 'Case ID', actividad: 'Activity', fecha: 'Timestamp', area: 'Department' })
  assert.throws(() => logs.adivinarMapeo(['x', 'y']), /No reconozco/)
  assert.equal(logs.leerFecha('01/09/2026 09:00'), new Date(2026, 8, 1, 9, 0).getTime())
  assert.equal(logs.leerFecha('2026-09-01 09:00'), new Date(2026, 8, 1, 9, 0).getTime())

  const a = logs.analizarLog(CSV)
  assert.equal(a.casos, 4)
  assert.equal(a.eventos, 15)
  assert.equal(a.descartados, 1)
  assert.deepEqual(a.volumenMes, [{ mes: '2026-09', casos: 2 }, { mes: '2026-10', casos: 2 }])
  assert.equal(a.actividadesDistintas, 4)
  assert.deepEqual(a.variantes[0], { pasos: ['Recibir factura', 'Pedir orden de compra', 'Aprobar', 'Pagar'], casos: 2, pct: 50 })
  assert.equal(a.pasosVarianteComun, 4)
  assert.deepEqual(a.retrabajos, [{ actividad: 'Pedir orden de compra', casos: 1, pct: 25 }])
  const fc = a.traspasos.find((t) => t.de === 'Finanzas' && t.a === 'Compras')!
  assert.equal(fc.veces, 3)
  assert.equal(fc.espera.mediana, 2880, 'la orden de compra espera 2 días por Compras')
  const pedir = a.actividades.find((x) => x.nombre === 'Pedir orden de compra')!
  assert.equal(pedir.area, 'Finanzas')
  assert.equal(pedir.casos, 3)
  assert.match(logs.logComoTexto(a, 'AP'), /Finanzas → Compras \(3 · 2 días/)
  assert.throws(() => logs.analizarLog('Case;Activity;Timestamp\n'), /vacío/)
})

test('Encargo: cliente como entidad, áreas puntuadas, entrevistas (audio que no queda), documentos, log y champions', async () => {
  const db = abrir(':memory:')
  dsc._probarDiscovery({ transcribir: async () => 'Cuando la factura llega sin orden de compra la mandamos por mail a Compras y esperamos.' })
  const e = dsc.crearEncargo(db, { cliente: 'Distribuidora Ejemplo', notas: 'Copilot hace un año, se estancó' }, T)
  assert.equal(e.cliente, 'Distribuidora Ejemplo')
  assert.equal((db.prepare('SELECT tipo FROM entidades WHERE id = ?').get(e.clienteId) as any).tipo, 'agrupacion')
  assert.ok(db.prepare(`SELECT 1 FROM conexiones WHERE a = ? AND b = ?`).get(e.proyectoId, e.clienteId))

  dsc.guardarArea(db, e.id, { nombre: 'Finanzas', volumenMes: 1200, costoMes: 90000, alcance: 4 }, T)
  dsc.guardarArea(db, e.id, { nombre: 'Ventas', volumenMes: 600, costoMes: 120000, alcance: 3 }, T)
  dsc.guardarArea(db, e.id, { nombre: 'Legal', volumenMes: 40, costoMes: 30000, alcance: 1 }, T)
  const areas = dsc.areasDe(db, e.id)
  assert.deepEqual(areas.map((a) => a.nombre), ['Finanzas', 'Ventas', 'Legal'])
  assert.equal(areas[0].puntaje, Math.round(100 * (0.4 * 1 + 0.4 * (90000 / 120000) + 0.2 * 1)))
  dsc.guardarArea(db, e.id, { nombre: 'Legal', volumenMes: 50, costoMes: 30000, alcance: 1 }, T)
  assert.equal(dsc.areasDe(db, e.id).length, 3, 'la misma área se actualiza')

  await assert.rejects(dsc.agregarEntrevista(db, e.id, { texto: 'corto' }, T), /vacía/)
  const ent = await dsc.agregarEntrevista(db, e.id, { quien: 'Ana', rol: 'Analista de AP', area: 'Finanzas', audio: Buffer.from('m4a') }, T)
  assert.ok(ent.palabras > 10)
  const doc = await dsc.agregarDocumento(db, e.id, 'procedimiento.txt', Buffer.from('1. Recibir la factura. 2. Aprobar. 3. Pagar. Procedimiento oficial de cuentas a pagar.'), 'Finanzas', T)
  assert.ok(doc.piezaId)
  const l = dsc.subirLog(db, e.id, 'ap.csv', CSV, { area: 'Finanzas' }, T)
  assert.equal(l.analisis.casos, 4)
  dsc.sumarPersona(db, e.id, { nombre: 'Marta Controller', rol: 'sponsor' }, T)
  const champs = dsc.sumarPersona(db, e.id, { nombre: 'Lucas', rol: 'champion' }, T) as any[]
  assert.deepEqual(champs.map((c) => c.rol).sort(), ['champion', 'sponsor'])

  const f = dsc.fichaEncargo(db, e.id)
  assert.equal(f.entrevistas.length, 1)
  assert.equal(f.entrevistas[0].meta.rol, 'Analista de AP')
  assert.equal(f.documentos.length, 1)
  assert.equal(f.logs.length, 1)
  const [lista] = dsc.listarEncargos(db)
  assert.deepEqual([lista.entrevistas, lista.logs], [1, 1])
  assert.throws(() => dsc.editarEncargo(db, e.id, { estado: 'cualquiera' }), /El estado es/)
  assert.equal(dsc.editarEncargo(db, e.id, { estado: 'diseño', departamento: 'Finanzas' }).departamento, 'Finanzas')
})

test('Guía, as-is (lo no documentado), to-be (borrar / código / agente / persona), KPIs y la hoja de valor', async () => {
  const db = abrir(':memory:')
  const pedidos: { sistema: string; usuario: string }[] = []
  dsc._probarDiscovery({
    modelo: async (_db, sistema, usuario) => {
      pedidos.push({ sistema, usuario })
      if (sistema.includes('guía de entrevista')) return { volumen_y_costo: ['¿Cuántas facturas por mes?'], excepciones: ['¿Qué pasa si no hay orden de compra?'], lo_que_el_log_contradice: ['El log dice 2 días de espera en Compras: ¿por qué?'] }
      if (sistema.includes('AS-IS')) return { nombre: 'Cuentas a pagar', documentados: 3, hallazgos: ['Sin orden de compra, va por mail'], pasos: [
        { paso: 'Recibir factura', area: 'Finanzas', sistema: 'ERP', quien: 'Analista', minutos: 5, frecuencia: '1200/mes', fuente: 'log', en_la_doc: true },
        { paso: 'Pedir orden de compra por mail', area: 'Finanzas', sistema: 'Mail', quien: 'Analista', minutos: 15, excepciones: 'Facturas intercompany sin OC', fuente: 'entrevista', en_la_doc: false },
        { paso: 'Aprobar', area: 'Compras', sistema: 'ERP', quien: 'Comprador', minutos: 10, fuente: 'log', en_la_doc: true },
        { paso: 'Pagar', area: 'Finanzas', sistema: 'Banco', quien: 'Tesorería', minutos: 4, fuente: 'documento', en_la_doc: true },
      ] }
      if (sistema.includes('TO-BE')) return { pasos: [{ n: 1, destino: 'agente', por_que: 'Formatos nuevos de factura', regla: 'Leer y codificar' }, { n: 2, destino: 'borrar', por_que: 'Exigir OC en intercompany' }, { n: 3, destino: 'codigo', por_que: 'Regla de montos' }, { n: 4, destino: 'persona', por_que: 'La auditoría pide una persona' }] }
      if (sistema.includes('KPIs')) return { kpis: [{ categoria: 'tiempo_costo', nombre: 'Costo por factura', linea_base: '31', objetivo: '8', unidad: '€', medido_en: 'ERP + nómina' }, { categoria: 'riesgo', nombre: 'Excepciones por mes', linea_base: '700', objetivo: '50', unidad: null, medido_en: 'ERP' }, { nombre: '' }] }
      return {}
    },
  })
  const e = dsc.crearEncargo(db, { cliente: 'Distribuidora Ejemplo' }, T)
  await assert.rejects(dsc.armarAsis(db, e.id, 'Finanzas', T), /al menos un log o una entrevista/)
  dsc.subirLog(db, e.id, 'ap.csv', CSV, { area: 'Finanzas' }, T)

  const g = await dsc.guiaDeEntrevista(db, e.id, 'Finanzas', T)
  assert.match(pedidos[0].usuario, /Finanzas → Compras/, 'la guía conoce lo que dice el log')
  assert.match(g.md, /## Lo que el log contradice\n- El log dice 2 días/)
  await dsc.guiaDeEntrevista(db, e.id, 'Finanzas', T)
  assert.equal(dsc.fichaEncargo(db, e.id).guias.length, 1, 'rehacer la guía de un área la reemplaza')

  const { proceso, hallazgos } = await dsc.armarAsis(db, e.id, 'Finanzas', T)
  assert.equal(proceso.pasosAsis!.length, 4)
  assert.equal(proceso.documentados, 3)
  assert.equal(proceso.resumen!.fueraDeLaDoc, 1)
  assert.match(proceso.resumen!.texto, /4 pasos reales, 1 fuera de la documentación/)
  assert.deepEqual(hallazgos, ['Sin orden de compra, va por mail'])
  assert.equal((await dsc.armarAsis(db, e.id, 'Finanzas', T)).proceso.id, proceso.id, 'rehacer el as-is del área lo reemplaza')

  const p = await dsc.armarTobe(db, proceso.id, T)
  assert.equal(p.resumen!.texto, 'De 4 pasos: 1 se borra, 1 pasa a código, 1 a un agente y 1 queda en una persona.')
  assert.equal(p.resumen!.minutosAntes, 34)
  assert.equal(p.resumen!.minutosDespues, 4)
  const p2 = dsc.editarPaso(db, proceso.id, 3, { destino: 'agente' }, T)
  assert.equal(p2.resumen!.agente, 2)
  assert.throws(() => dsc.editarPaso(db, proceso.id, 3, { destino: 'magia' }), /El destino es/)

  const conKpis = await dsc.proponerKpis(db, proceso.id, T)
  assert.equal(conKpis.kpis.length, 2, 'los KPIs sin nombre no entran')
  dsc.guardarKpis(db, proceso.id, [...conKpis.kpis, { categoria: 'ingresos', nombre: 'Ahorro neto de tokens', objetivo: '20000', unidad: '€/mes' }], T)
  const hoja = dsc.hojaDeValor(db, e.id)
  assert.match(hoja, /^# Transformación con IA · Distribuidora Ejemplo/)
  assert.match(hoja, /La documentación describía 3; en la realidad son 4\./)
  assert.match(hoja, /\| Tiempo y costo \| Costo por factura \| 31 € \| 8 € \|/)
  assert.match(hoja, /\| Ingresos \(netos de tokens\) \| Ahorro neto de tokens \| a medir \| 20000 €\/mes \|/)
  assert.match(hoja, /2\. Pedir orden de compra por mail → \*\*se borra\*\* \(Exigir OC en intercompany\)/)
  assert.match(hoja, /## Cómo llegamos/)
})

test('Sombra del cliente: acierto por regla, qué puede tomar el agente (≥ 99 % con 50 casos) y la curva por semana', () => {
  const db = abrir(':memory:')
  const e = dsc.crearEncargo(db, { cliente: 'Otro Cliente' }, T)
  assert.throws(() => dsc.cargarSombra(db, e.id, 'a,b\n1,2'), /regla, propuesta/)
  const filas = ['regla,propuesta,real,fecha']
  for (let i = 0; i < 60; i++) filas.push(`Codificar cuenta,6000,6000,2026-10-0${1 + (i % 2) * 7}`)
  for (let i = 0; i < 20; i++) filas.push(`Aprobar monto,aprobar,${i < 15 ? 'aprobar' : 'rechazar'},2026-10-08`)
  const r = dsc.cargarSombra(db, e.id, filas.join('\n'), null, T)
  assert.equal(r.cargados, 80)
  const cod = r.reglas.find((x) => x.regla === 'Codificar cuenta')!
  assert.deepEqual([cod.casos, cod.acierto, cod.lista], [60, 100, true])
  const apr = r.reglas.find((x) => x.regla === 'Aprobar monto')!
  assert.deepEqual([apr.acierto, apr.lista], [75, false])
  assert.equal(r.puedeTomar, 75)
  assert.equal(r.semanas.length, 2)
})
