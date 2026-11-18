import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { autenticarApp, cargarDeApp, cargarVarias, crearApp, desdeDeLaApp, mensajeDeApp, PERMISOS, respuestaDesde } from '../src/apps.ts'
import { leerPieza } from '../src/corpus.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { _probarEscriba, _probarModelo } from '../src/chat/index.ts'

_probarEscriba(async () => {})

test('apps · cargar: un documento al corpus, atado a su proyecto, sin duplicar; una versión nueva corrige', () => {
  const db = abrir(':memory:')
  assert.ok(PERMISOS.includes('cargar') && PERMISOS.includes('mensaje'))
  const proyecto = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Huerta Comunitaria' })
  const { app, token } = crearApp(db, 'Agente de prueba', ['cargar'])
  assert.equal(autenticarApp(db, `Bearer ${token}`, 'cargar').app?.id, app.id)
  assert.equal(autenticarApp(db, `Bearer ${token}`, 'mensaje').motivo, 'sin_permiso', 'sin «mensaje» no le habla a Mastropiero')

  const carga = { id: 'doc-1', titulo: 'Proveedores de semillas', contenido: 'Tres proveedores comparados.', resumen: 'El más barato no es el mejor.', proyecto: 'huerta comunitaria', nivel: 'investigacion', fuentes: ['https://ejemplo.org/semillas'], fecha: '2026-11-18', tipo: 'Investigacion' }
  const a = cargarDeApp(db, app, carga)
  assert.equal(a.estado, 'nueva')
  assert.deepEqual(a.proyecto, { id: proyecto, nombre: 'Huerta Comunitaria' })
  const p = leerPieza(db, a.piezaId)!
  assert.equal(p.nivel, 'investigacion')
  assert.equal(p.fuente, 'app-agente-de-prueba')
  assert.equal(p.estado, 'crudo', 'la liga lo procesa')
  assert.equal(p.url, 'https://ejemplo.org/semillas')
  assert.equal(p.fecha, '2026-11-18')
  assert.deepEqual(p.entidades, [proyecto])
  assert.match(p.contenido, /^> El más barato no es el mejor\.\n\nTres proveedores comparados\.\n\nFuentes:\n- https:\/\/ejemplo\.org\/semillas$/)
  assert.ok(db.prepare('SELECT 1 FROM corpus_entidades WHERE pieza_id = ? AND entidad_id = ?').get(a.piezaId, proyecto), 'aparece en la ficha del proyecto')

  // Reenviada igual: no se duplica. Con texto nuevo: corrige la misma pieza y guarda la versión anterior.
  assert.equal(cargarDeApp(db, app, carga).estado, 'igual')
  const b = cargarDeApp(db, app, { ...carga, contenido: 'Cuatro proveedores comparados.' })
  assert.equal(b.estado, 'corregida')
  assert.equal(b.piezaId, a.piezaId)
  const pb = leerPieza(db, a.piezaId)!
  assert.match(pb.contenido, /Cuatro proveedores/)
  assert.match(JSON.stringify((pb.meta as any).versiones), /Tres proveedores/)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE fuente = 'app-agente-de-prueba'`).get() as any).n, 1)

  // Sin id: el mismo texto no entra dos veces. Sin nivel: generada. Un proyecto que no existe: entra igual, con aviso.
  const c1 = cargarDeApp(db, app, { titulo: 'Idea suelta', contenido: 'Riego por goteo con botellas.', proyecto: 'Proyecto Inexistente Total', fecha: 'mañana' })
  assert.equal(leerPieza(db, c1.piezaId)!.nivel, 'generada')
  assert.equal(c1.proyecto, null)
  assert.ok(c1.avisos.some((x) => /No existe «Proyecto Inexistente Total»/.test(x)))
  assert.ok(c1.avisos.some((x) => /no es AAAA-MM-DD/.test(x)))
  assert.equal(cargarDeApp(db, app, { titulo: 'Idea suelta', contenido: 'Riego por goteo con botellas.' }).estado, 'igual')

  // Mal escrito: se reconoce con aviso.
  const d = cargarDeApp(db, app, { titulo: 'Notas', contenido: 'x', proyecto: 'Huerta Comunitria' })
  assert.equal(d.proyecto?.id, proyecto)
  assert.ok(d.avisos.some((x) => /se tomó como «Huerta Comunitaria»/.test(x)))

  // Lo que está mal se dice claro; en lote, una mala no frena a las demás.
  assert.throws(() => cargarDeApp(db, app, { titulo: 'x', contenido: 'y' }), /Falta el título/)
  assert.throws(() => cargarDeApp(db, app, { titulo: 'Vacía', contenido: '  ' }), /no tiene contenido/)
  assert.throws(() => cargarDeApp(db, app, { titulo: 'Rara', contenido: 'z', nivel: 'secreto' }), /Nivel desconocido/)
  const lote = cargarVarias(db, app, { items: [{ titulo: 'Uno', contenido: 'a' }, { titulo: '', contenido: 'b' }, { titulo: 'Tres', contenido: 'c', nivel: 'fuente' }] }) as any
  assert.equal(lote.resultados.length, 3)
  assert.equal(lote.resultados[0].estado, 'nueva')
  assert.match(lote.resultados[1].error, /Falta el título/)
  assert.equal(leerPieza(db, lote.resultados[2].piezaId)!.nivel, 'primaria')
  assert.throws(() => cargarVarias(db, app, { items: Array.from({ length: 51 }, () => ({})) }), /Hasta 50/)
})

test('apps · mensaje: le habla a Mastropiero y vuelve lo que contestó y lo que hizo; ocupado, repetido y pensando', async () => {
  const db = abrir(':memory:')
  const { app } = crearApp(db, 'Agente de prueba', ['mensaje'])
  let n = 0
  let canal = ''
  _probarModelo(async (_l: any, o: any) => {
    canal ||= JSON.stringify(o)
    const llamadas = n++ === 0 ? [{ id: 'c0', nombre: 'crear_mision', argumentos: JSON.stringify({ nivel: 'secundaria', titulo: 'Llamar a Ana' }) }] : []
    return { texto: llamadas.length ? '' : 'Listo: creé la misión «Llamar a Ana».', razonamiento: null, modelo: 'falso', tokens: 1, llamadas }
  })
  const r = await mensajeDeApp(db, app, { texto: 'Creá una misión: llamar a Ana', id: 'm1' }) as any
  assert.equal(r.estado, 'listo')
  assert.equal(r.respuesta, 'Listo: creé la misión «Llamar a Ana».')
  assert.equal(r.hechas.length, 1)
  assert.match(r.hechas[0], /Llamar a Ana/)
  assert.equal(r.pensando, false)
  assert.match(canal, /llega por la API, de la app «Agente de prueba»/, 'Mastropiero sabe quién le habla')
  assert.ok(db.prepare(`SELECT 1 FROM misiones WHERE titulo = 'Llamar a Ana'`).get())
  assert.equal((await mensajeDeApp(db, app, { texto: 'Creá una misión: llamar a Ana', id: 'm1' })).estado, 'repetido', 'el reintento con el mismo id no se manda dos veces')
  await assert.rejects(mensajeDeApp(db, app, { texto: '  ' }), /Falta «texto»/)

  // Si tarda más que la espera: «pensando», y con «desde» se pide lo que contestó después.
  let soltar!: () => void
  const espera = new Promise<void>((ok) => (soltar = ok))
  _probarModelo(async () => { await espera; return { texto: 'Tardé, pero acá está.', razonamiento: null, modelo: 'falso', tokens: 1, llamadas: [] } })
  const lento = await mensajeDeApp(db, app, { texto: '¿Qué tengo hoy?' }, { esperaMs: 30 }) as any
  assert.equal(lento.estado, 'pensando')
  assert.ok(desdeDeLaApp(app, lento.desde), 'ese «desde» se lo di a esta app')
  assert.ok(!desdeDeLaApp(app, lento.desde + 1000) && !desdeDeLaApp({ ...app, id: app.id + 1 }, lento.desde), 'otro número u otra app: no')
  assert.equal((await mensajeDeApp(db, app, { texto: 'otra cosa' })).estado, 'ocupado', 'un turno a la vez')
  soltar()
  for (let i = 0; i < 100 && (await respuestaDesde(db, lento.desde)).pensando; i++) await new Promise((ok) => setTimeout(ok, 10))
  const despues = await respuestaDesde(db, lento.desde)
  assert.equal(despues.pensando, false)
  assert.equal(despues.respuesta, 'Tardé, pero acá está.')
})
