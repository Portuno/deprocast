import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarEscriba, _probarModelo, crearConversacion, enviar, mensajes } from '../src/chat/index.ts'
import { ejecutarHerramienta, HERRAMIENTAS } from '../src/chat/herramientas.ts'
import { deshacerAcciones, ultimasDeshacibles } from '../src/chat/deshacer.ts'
import { listarSalud, registrarSalud } from '../src/salud.ts'

_probarEscriba(async () => {})

/** Un turno guionado: el modelo pide esas herramientas y después contesta «listo». */
function turno(llamadas: { nombre: string; argumentos: unknown }[]) {
  let n = 0
  _probarModelo(async () => {
    const ls = n++ === 0 ? llamadas : []
    return { texto: ls.length ? '' : 'listo', razonamiento: null, modelo: 'falso', tokens: 1, llamadas: ls.map((x, i) => ({ id: `c${i}`, nombre: x.nombre, argumentos: JSON.stringify(x.argumentos) })) }
  })
}

test('deshacer: lo que anotó en un turno (comida, gasto, misión, recuerdo) se vuelve atrás; el modelo no ve la inversa', async () => {
  const db = abrir(':memory:')
  const c = crearConversacion(db)
  turno([
    { nombre: 'registrar_salud', argumentos: { tipo: 'comida', titulo: 'Almuerzo: milanesa', kcal: 800 } },
    { nombre: 'registrar_movimiento', argumentos: { monto: -20, descripcion: 'súper' } },
    { nombre: 'crear_mision', argumentos: { nivel: 'secundaria', titulo: 'Llamar al banco' } },
    { nombre: 'recordar', argumentos: { texto: 'Prefiere trabajar de mañana temprano', tipo: 'preferencia' } },
  ])
  await enviar(db, c.id, 'almorcé milanesa, gasté 20 en el súper, anotame llamar al banco y acordate que prefiero la mañana')
  const herr = mensajes(db, c.id).filter((m) => m.rol === 'herramienta')
  assert.equal(herr.length, 4)
  assert.ok(herr.every((m) => m.deshacible), 'las cuatro tienen vuelta atrás')
  assert.ok(herr.every((m) => !m.texto!.includes('_deshacer')), 'la inversa no llega al modelo')

  const xs = ultimasDeshacibles(db, c.id)
  assert.equal(xs.length, 4)
  const r = deshacerAcciones(db, xs.map((x) => x.id))
  assert.equal(r.deshechas.length, 4)
  assert.equal(listarSalud(db).length, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM movimientos').get() as any).n, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM misiones').get() as any).n, 0)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM memoria WHERE estado = 'vigente'`).get() as any).n, 0)
  const ms = mensajes(db, c.id)
  assert.ok(ms.filter((m) => m.rol === 'herramienta').every((m) => m.deshecho && !m.deshacible))
  assert.match(ms.at(-1)!.texto!, /^↶ Deshecho: /)
  assert.equal(ultimasDeshacibles(db, c.id).length, 0, 'deshacer dos veces no hace nada')
})

test('deshacer: el sueño que se completó vuelve a como estaba; lo que no tiene vuelta no se deshace', async () => {
  const db = abrir(':memory:')
  const c = crearConversacion(db)
  const hoy = new Date().toISOString().slice(0, 10)
  registrarSalud(db, { tipo: 'sueno', fecha: hoy, datos: { horas: 7 } })
  turno([{ nombre: 'registrar_salud', argumentos: { tipo: 'sueno', fecha: hoy, calidad: 3 } }])
  await enviar(db, c.id, 'dormí muy bien')
  assert.equal(listarSalud(db, { tipo: 'sueno' })[0].datos.calidad, 3)
  turno([{ nombre: 'deshacer_ultima_accion', argumentos: {} }])
  await enviar(db, c.id, 'deshacé lo último')
  const s = listarSalud(db, { tipo: 'sueno' })
  assert.equal(s.length, 1, 'el registro de antes sigue')
  assert.deepEqual(s[0].datos, { horas: 7 })

  turno([{ nombre: 'ver_salud', argumentos: {} }])
  await enviar(db, c.id, '¿cómo vengo?')
  const lectura = mensajes(db, c.id).filter((m) => m.herramienta === 'ver_salud')[0]
  assert.equal(lectura.deshacible, false)
  assert.throws(() => deshacerAcciones(db, [lectura.id]), /no se puede deshacer/)
})

test('salud: ver_salud trae ids y el último registro; corregir y borrar (con confirmación)', async () => {
  const db = abrir(':memory:')
  const ctx = { db, conversacionId: null }
  const r = registrarSalud(db, { tipo: 'comida', titulo: 'Cena: pizza', datos: { kcal: 1200 } })
  const vista: any = (await ejecutarHerramienta(HERRAMIENTAS, 'ver_salud', JSON.stringify({ fecha: r.fecha }), ctx)).resultado
  assert.equal(vista.registros[0].id, r.id)
  assert.match(vista.ultimoRegistro, /Cena: pizza/)

  const c: any = (await ejecutarHerramienta(HERRAMIENTAS, 'corregir_registro_salud', JSON.stringify({ id: r.id, kcal: 900, titulo: 'Cena: media pizza' }), ctx)).resultado
  assert.deepEqual([c.corregido.titulo, c.corregido.datos.kcal, c.antes.datos.kcal], ['Cena: media pizza', 900, 1200])

  const sin: any = (await ejecutarHerramienta(HERRAMIENTAS, 'borrar_registro_salud', JSON.stringify({ id: r.id }), ctx)).resultado
  assert.equal(sin.requiere_confirmacion, true)
  assert.equal(listarSalud(db).length, 1)
  const b: any = (await ejecutarHerramienta(HERRAMIENTAS, 'borrar_registro_salud', JSON.stringify({ id: r.id, confirmado: true }), ctx)).resultado
  assert.equal(b.borrado.id, r.id)
  assert.equal(listarSalud(db).length, 0)
})
