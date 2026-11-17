import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import * as e from '../src/extracciones.ts'

test('Fragua #264 · un cliente de extracción: ficha, plan, correos del día (sin mandarlos), seguimiento desde Gmail y aviso a los 10 días', async () => {
  const db = abrir(':memory:')
  const T = new Date('2026-11-17T08:30:00').getTime()
  const pedidos: string[] = []
  e._probarExtracciones(async (_db, sistema, usuario) => {
    pedidos.push(usuario)
    return /plan de extracción/.test(sistema)
      ? { plan: '## Origen → destino\nAzure Blob → S3 con rclone.', paraTecnico: 'Necesitamos un SAS de lectura.', paraQuienPaga: 'Se resuelve en días hábiles, en un rango de costo.' }
      : { asunto: 'Sus datos de Azure', cuerpo: 'Hola, ¿hablamos el jueves?', pedido: 'Una llamada el jueves' }
  })
  const x = await e.crearExtraccion(db, 'Cliente Prueba SA', { origen: 'Azure Blob', destino: 'S3', dolor: 'se le vence el contrato', decide: 'la directora', email: 'it@cliente.test' }, T)
  assert.equal(x.estado, 'prospecto')
  assert.ok(x.entidadId, 'el cliente queda como empresa en el grafo')
  assert.equal((await e.crearExtraccion(db, 'cliente prueba sa', { firma: 'el gerente' }, T)).id, x.id, 'el mismo cliente, completado')
  assert.equal(e.leerExtraccion(db, x.id)!.ficha.firma, 'el gerente')
  assert.throws(() => e.actualizarExtraccion(db, x.id, { estado: 'rara' }), /Estado inválido/)

  db.prepare(`INSERT INTO ajustes (clave, valor) VALUES ('extracciones_ejecuta', 'Ejecutor Prueba')`).run()
  const p = await e.armarPlan(db, x.id, T)
  assert.equal(p.estado, 'plan')
  assert.match(p.plan!, /rclone/)
  assert.match(pedidos[0], /"ejecuta":"Ejecutor Prueba"/, 'quién ejecuta sale del ajuste si la ficha no lo dice')

  // Los correos del día: primer correo (manda el plan). Sin Gmail conectado, queda acá para copiar.
  const lista = (await e.correosDelDia(db, T))!
  assert.match(lista, /Cliente Prueba SA\*\* \(mandar el plan y pedir una llamada\): «Sus datos de Azure»/)
  const [c] = e.correosDe(db, x.id)
  assert.equal(c.estado, 'borrador')
  assert.equal(c.para, 'it@cliente.test')
  assert.equal(await e.correosDelDia(db, T + 3_600_000), null, 'ya tiene uno esperando: no se repite')

  // Él lo manda desde su Gmail; el cliente no contesta: a los 3 días, seguimiento; a los 10, aviso.
  db.prepare(`INSERT INTO correos (id, hilo, de, para, asunto, fecha, etiquetas, extracto, cuerpo, leido, suyo, ruido) VALUES ('m1', 'h1', 'yo@prueba.test', 'it@cliente.test', 'Sus datos de Azure', ?, '[]', '', '', 1, 1, 0)`).run(T + 600_000)
  assert.deepEqual(e.seguirEnGmail(db), { mandados: 1, respondidos: 0 })
  assert.equal(e.diasSinRespuesta(db, x.id, T + 4 * 86_400_000), 3)
  assert.match(e.quienesHoy(db, T + 4 * 86_400_000)[0].proposito, /seguimiento: hace 3 días/)
  assert.equal(e.alertasExtracciones(db, T + 11 * 86_400_000).length, 1)
  // Contesta: deja de avisar.
  db.prepare(`INSERT INTO correos (id, hilo, de, para, asunto, fecha, etiquetas, extracto, cuerpo, leido, suyo, ruido) VALUES ('m2', 'h1', 'Directora <dir@cliente.test>', 'yo@prueba.test', 'Re: Sus datos', ?, '[]', '', '', 0, 0, 0)`).run(T + 5 * 86_400_000)
  assert.deepEqual(e.seguirEnGmail(db), { mandados: 0, respondidos: 1 })
  assert.equal(e.diasSinRespuesta(db, x.id, T + 11 * 86_400_000), null)
  assert.equal(e.alertasExtracciones(db, T + 11 * 86_400_000).length, 0)
})
