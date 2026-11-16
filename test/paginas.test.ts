import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { crearAprendizaje } from '../src/aprender.ts'
import { asegurarFuente, insertar } from '../src/corpus.ts'
import { HERRAMIENTAS, NUCLEO, ejecutarHerramienta, gruposDelMensaje } from '../src/chat/herramientas.ts'
import { ACCIONES } from '../src/rutinas.ts'
import {
  _probarPaginas, construirPagina, construirPendientes, datosDe, escribirSeccion, instruirPagina, leerPagina, listarArquetipos,
  listarPaginasDominio, nombrarPagina, paginasParaConstruir, resolverPagina,
} from '../src/paginas.ts'
import { _probarCompras, anotarCompras, claveDe, importarDelHilo, listarCompras, marcarCompras } from '../src/compras.ts'
import { cuadernosHuion, hojasDelCuaderno } from '../src/tandas.ts'
import { menuGeneral } from '../src/menu.ts'

const AHORA = Date.UTC(2026, 10, 16, 12)

test('páginas propias: un arquetipo se construye con sus datos, respeta lo suyo y sus instrucciones, y el nombre lo pone él', async () => {
  const db = abrir(':memory:')
  const pedidos: string[] = []
  let responder: (u: string) => any = () => ({ descripcion: 'Donde entra lo escrito a mano.', secciones: [{ id: 'organos', titulo: 'Qué trabaja acá', cuerpo: '- El Cuaderno' }, { id: 'pendientes', titulo: 'Pendientes', cuerpo: '- Qué agentes faltan (pendiente)' }], aplicadas: [], notas: '' })
  _probarPaginas(async (_db, _tipo, usuario) => { pedidos.push(usuario); return responder(usuario) })

  // La celda 1 (Captura · Entra · Cuerpo) tiene un órgano del sistema: El Cuaderno.
  const datos: any = await datosDe(db, 'arquetipo', '1', AHORA)
  assert.equal(datos.celda.dominio, 'Captura')
  assert.ok(datos.organos.some((o: any) => o.nombre === 'El Cuaderno'))
  await assert.rejects(datosDe(db, 'arquetipo', '73'), /del 1 al 72/)

  const p = await construirPagina(db, 'arquetipo', '1', AHORA)
  assert.deepEqual(p.secciones.map((s) => s.id), ['organos', 'pendientes'])
  assert.equal(p.nombre, null, 'el constructor no le pone nombre')
  assert.match(pedidos[0], /Todavía no tiene nombre/)
  assert.match(pedidos[0], /El Cuaderno/, 'construye con los datos reales')

  // El nombre lo pone él; se encuentra por nombre (sin artículo, sin tildes) y no se repite entre celdas.
  nombrarPagina(db, 'arquetipo', '1', 'El Escribano')
  assert.equal(resolverPagina(db, 'arquetipo', 'escribano'), '1')
  assert.equal(resolverPagina(db, 'arquetipo', 'El Escribano'), '1')
  assert.equal(resolverPagina(db, 'arquetipo', '12'), '12')
  assert.throws(() => nombrarPagina(db, 'arquetipo', '2', 'el escribano'), /ya es el nombre del arquetipo 1/)

  // Una sección escrita a mano queda suya: el constructor no la pisa ni la pierde.
  escribirSeccion(db, 'arquetipo', '1', { titulo: 'Proveedores', cuerpo: 'Papelera del barrio' }, AHORA)
  responder = () => ({ descripcion: 'x', secciones: [{ id: 'organos', titulo: 'Qué trabaja acá', cuerpo: '- El Cuaderno, más' }], aplicadas: [0], notas: '' })
  const r = await instruirPagina(db, 'arquetipo', '1', 'que muestre primero lo que trabaja', AHORA + 1000)
  assert.match(pedidos.at(-1)!, /Su nombre \(lo puso él\): El Escribano/)
  assert.match(pedidos.at(-1)!, /Instrucciones nuevas \(aplicalas\):\n0\. que muestre primero/)
  assert.deepEqual(r.secciones.map((s) => [s.id, s.origen]), [['organos', 'auto'], ['proveedores', 'operador']], 'la suya vuelve aunque el modelo se la olvide')
  assert.equal(r.instrucciones[0].aplicada, true)

  // Una instrucción que no se pudo aplicar queda pendiente, con el porqué.
  responder = () => ({ descripcion: 'x', secciones: [{ id: 'organos', titulo: 'Qué trabaja acá', cuerpo: '- El Cuaderno' }], aplicadas: [], notas: 'No hay datos de proveedores reales.' })
  const r2 = await instruirPagina(db, 'arquetipo', '1', 'sumale los precios de los proveedores', AHORA + 2000)
  assert.deepEqual(r2.instrucciones.map((x) => x.aplicada), [true, false])
  assert.equal(r2.instrucciones[1].nota, 'No hay datos de proveedores reales.')
  assert.match(pedidos.at(-1)!, /Instrucciones ya aplicadas \(siguen valiendo\):\n- que muestre primero/)

  // Los 72, con su nombre.
  const l = await listarArquetipos(db, AHORA)
  assert.equal(l.arquetipos.length, 72)
  assert.equal(l.arquetipos[0].nombre, 'El Escribano')
  assert.equal(l.arquetipos[71].dominio, 'Vitalidad')
})

test('páginas propias: un dominio junta Academia, material y su fuente; la rutina rehace solo lo que cambió', async () => {
  const db = abrir(':memory:')
  _probarPaginas(async () => ({ descripcion: 'Energía', secciones: [{ id: 'resumen', titulo: 'Resumen', cuerpo: 'Nivel 1' }], aplicadas: [] }))
  const a = crearAprendizaje(db, { tema: 'Energía y almacenamiento' }, AHORA)
  const f = asegurarFuente(db, { nombre: 'Energía y almacenamiento', nivel: 'primaria' })
  insertar(db, { fuente: (f as any).id ?? f, titulo: 'Baterías de sodio', contenido: 'texto', nivel: 'primaria' }, AHORA)
  const d: any = await datosDe(db, 'dominio', String(a.id), AHORA)
  assert.equal(d.dominio.tema, 'Energía y almacenamiento')
  assert.equal(d.fuente.piezas, 1)
  assert.equal(d.fuente.ultimas[0].titulo, 'Baterías de sodio')
  assert.equal(resolverPagina(db, 'dominio', 'energia'), String(a.id))

  // Nunca construida → toca; un arquetipo vacío no (no hay mundo), uno con órgano sí.
  const antes = await paginasParaConstruir(db, AHORA, 100)
  assert.ok(antes.some((x) => x.tipo === 'dominio' && x.clave === String(a.id)))
  assert.ok(antes.some((x) => x.tipo === 'arquetipo' && x.clave === '1'), 'la celda del Cuaderno tiene mundo')
  assert.ok(!antes.some((x) => x.tipo === 'arquetipo' && x.clave === '72'), 'una celda vacía no se construye')
  const r = await construirPendientes(db, AHORA, 100)
  assert.equal(r.fallas.length, 0)
  assert.ok(leerPagina(db, 'dominio', String(a.id)).construidaEn)
  // Recién construidas y sin cambios: no toca de nuevo. Con una instrucción pendiente, sí.
  assert.equal((await paginasParaConstruir(db, AHORA + 60_000, 100)).length, 0)
  assert.ok(listarPaginasDominio(db)[0].construida)
  assert.equal(typeof ACCIONES.paginas, 'function', 'la rutina existe')
  assert.ok(db.prepare(`SELECT 1 FROM rutinas WHERE id = 'paginas'`).get())
})

test('compras: se anotan sin duplicar, se tachan por nombre y se recuperan las listas que ya mandó', async () => {
  const db = abrir(':memory:')
  assert.equal(claveDe('Los Huevos'), claveDe('huevo'))
  const a = anotarCompras(db, [{ item: 'Leche', cantidad: '2' }, { item: '- Los huevos' }, { item: '' }], { ahora: AHORA })
  assert.deepEqual(a.nuevos.map((x) => x.item), ['Leche', 'Los huevos'])
  const b = anotarCompras(db, [{ item: 'huevo', nota: 'de campo' }, { item: 'pilas AA' }], { ahora: AHORA })
  assert.deepEqual(b.yaEstaban.map((x) => [x.item, x.nota]), [['Los huevos', 'de campo']])
  assert.deepEqual(marcarCompras(db, ['leche'], 'comprado', AHORA).map((x) => x.estado), ['comprado'])
  assert.deepEqual(listarCompras(db).map((x) => x.item), ['Los huevos', 'pilas AA'])
  // Comprada la leche, otra «leche» vuelve a la lista como nueva.
  assert.equal(anotarCompras(db, [{ item: 'leche' }]).nuevos.length, 1)

  // Las que mandó antes, desde el hilo (una vez por mensaje).
  const c = db.prepare(`INSERT INTO conversaciones (con, titulo, creada_en, actualizada_en) VALUES ('mastropiero', 'Hoy', ?, ?)`).run(AHORA, AHORA).lastInsertRowid
  const ins = db.prepare('INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, ?, ?, ?)')
  ins.run(c, 'operador', 'para el súper: yerba, tomates y queso', AHORA - 86_400_000)
  ins.run(c, 'operador', 'hoy estuve pensando en el proyecto', AHORA - 80_000_000)
  const leidos: string[] = []
  _probarCompras(async (_db, t) => { leidos.push(t); return [{ item: 'yerba' }, { item: 'tomates' }, { item: 'queso' }] })
  const r = await importarDelHilo(db, { ahora: AHORA })
  assert.deepEqual(r, { revisados: 1, mensajes: 1, nuevos: 3 })
  assert.equal(leidos.length, 1, 'solo los mensajes que parecen de compras')
  assert.equal((await importarDelHilo(db, { ahora: AHORA })).revisados, 0, 'un mensaje ya importado no se relee')

  // Desde el chat: siempre a mano y anunciada por el mensaje.
  assert.ok(NUCLEO.includes('anotar_compras'))
  assert.ok(gruposDelMensaje('qué tengo en la lista de compras').includes('vida'))
  const h = await ejecutarHerramienta(HERRAMIENTAS, 'anotar_compras', JSON.stringify({ items: [{ item: 'café' }] }), { db, conversacionId: null })
  assert.deepEqual((h.resultado as any).anotados, ['café'])
  assert.equal(menuGeneral(db).cuentas.compras, listarCompras(db).length)
})

test('herramientas de páginas: nombrar un arquetipo y verlo por su nombre', async () => {
  const db = abrir(':memory:')
  const n = await ejecutarHerramienta(HERRAMIENTAS, 'nombrar_arquetipo', JSON.stringify({ celda: 12, nombre: 'El Modista' }), { db, conversacionId: null })
  assert.equal((n.resultado as any).link, '#arquetipo/12')
  const v = await ejecutarHerramienta(HERRAMIENTAS, 'ver_pagina', JSON.stringify({ tipo: 'arquetipo', cual: 'el modista' }), { db, conversacionId: null })
  assert.equal((v.resultado as any).clave, '12')
  assert.equal((v.resultado as any).nombre, 'El Modista')
  const no = await ejecutarHerramienta(HERRAMIENTAS, 'ver_pagina', JSON.stringify({ tipo: 'arquetipo', cual: 'el comprador' }), { db, conversacionId: null })
  assert.match((no.resultado as any).error, /No encontré/)
})

test('a mano: los cuadernos de la tableta y sus hojas en orden, con lo que se leyó', () => {
  const db = abrir(':memory:')
  asegurarFuente(db, { id: 'cuadernos-mano', nombre: 'Cuadernos', nivel: 'propia' })
  const pieza = insertar(db, { fuente: 'cuadernos-mano', titulo: 'Rojo · hoja 1 · Ideas', contenido: 'Ideas para el taller', nivel: 'propia' }, AHORA)
  const ins = db.prepare(`INSERT INTO tandas (tipo, archivo, ruta, bytes, huella, fecha, cuaderno, hoja, estado, pieza_id, creada_en) VALUES ('pagina', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
  ins.run('b.jpg', '/no/existe/b.jpg', 'h2', '2026-11-15', 'Rojo', 2, 'pendiente', null, AHORA)
  ins.run('a.jpg', '/no/existe/a.jpg', 'h1', '2026-11-14', 'Rojo', 1, 'hecha', pieza, AHORA - 1000)
  ins.run('c.jpg', '/no/existe/c.jpg', 'h3', null, null, null, 'fallo', null, AHORA - 5000)
  const cs = cuadernosHuion(db)
  assert.deepEqual(cs.map((c) => [c.nombre, c.hojas, c.leidas]), [['Rojo', 2, 1], ['Sin cuaderno', 1, 0]])
  const hs = hojasDelCuaderno(db, 'Rojo')
  assert.deepEqual(hs.map((h) => h.hoja), [1, 2])
  assert.equal(hs[0].contenido, 'Ideas para el taller')
  assert.equal(hojasDelCuaderno(db, 'Sin cuaderno')[0].estado, 'fallo')
  assert.equal(menuGeneral(db).cuentas.cuadernosHuion, 2)
})
