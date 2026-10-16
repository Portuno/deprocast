import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fijarAjuste } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { asegurarEntidad, conexionesDe, leerEntidad } from '../src/entidades.ts'
import { marcarJugador } from '../src/personajes.ts'
import { recordar, memoriaParaPrompt, deduplicarMemoria, memoriaVigente } from '../src/memoria.ts'
import { _probarEmbed, _probarReordenar, archivoRelevante, buscarHibrido, cuantizar, partirEnPasajes, pasajesDe, vectorDe, vectorizarItems } from '../src/semantica.ts'
import { _probarTakeout } from '../src/takeout/nube.ts'
import { _probarCronica, cronicaDelMes, lineaTemporal, resolverEvento } from '../src/linea.ts'
import { controlarReproceso, encolarReproceso, estadoReproceso, trabajarReproceso } from '../src/reproceso.ts'
import { tokensHoy, tokensReproceso } from '../src/nan.ts'
import { grafoPersonas } from '../src/personas.ts'
import { _probarEscriba, promptMastropiero } from '../src/chat/index.ts'

process.env.NAN_API_KEY = 'test'
_probarEscriba(async () => {})

// Un «modelo» de juguete: cuatro ejes de sentido; los sinónimos caen en el mismo eje.
const EJES = [/plata|dinero|euros|sueldo/, /perro|mascota|gato/, /viaje|vuelo|valencia/, /novela|escribir|capítulo/]
const vec = (t: string) => EJES.map((r) => (r.test(t.toLowerCase()) ? 1 : 0.01))
const juguete = () => _probarEmbed(async (_db, textos) => ({ vectores: textos.map(vec), modelo: 'juguete' }))

test('pasajes: una charla larga se encuentra por lo que dice en el medio, con el fragmento', async () => {
  juguete()
  const db = abrir(':memory:')
  const relleno = 'Hablamos de cosas del trabajo y de la semana sin nada en particular. '.repeat(60)
  const larga = insertar(db, { fuente: 'operador', titulo: 'Charla larga', nivel: 'propia', origenId: 'r:1', contenido: `${relleno}\n\nY ahí le conté que adoptamos un perro de la protectora.\n\n${relleno}` })!
  insertar(db, { fuente: 'operador', titulo: 'Otra', nivel: 'propia', origenId: 'r:2', contenido: 'Sobre el sueldo de este mes.' })
  const tramos = partirEnPasajes(db.prepare('SELECT contenido FROM corpus WHERE id = ?').get(larga)!.contenido as string)
  assert.ok(tramos.length >= 4 && tramos.every((t) => t.hasta - t.desde <= 1500), `${tramos.length} tramos`)
  assert.ok(tramos.every((t, i) => i === 0 || t.desde < tramos[i - 1].hasta), 'se solapan')
  const n = await pasajesDe(db, [larga, larga + 1])
  assert.ok(n >= 5)
  const ps = await buscarHibrido(db, 'mascota', 3)
  assert.equal(ps[0].id, larga)
  assert.match(ps[0].fragmento!, /adoptamos un perro/)
  // Rehacer los pasajes de una pieza no los duplica.
  const antes = (db.prepare('SELECT COUNT(*) AS n FROM pasajes').get() as any).n
  await pasajesDe(db, [larga])
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pasajes').get() as any).n, antes)
})

test('índice int8: ordena igual que con los vectores enteros', () => {
  let semilla = 7
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1
  const al = (_k: number) => Float32Array.from({ length: 64 }, azar)
  const q = al(0.7)
  const vs = Array.from({ length: 30 }, (_, k) => al(k / 10))
  const exacto = vs.map((v, i) => ({ i, s: v.reduce((a, x, j) => a + x * q[j], 0) })).sort((a, b) => b.s - a.s).map((x) => x.i)
  const aprox = vs.map((v, i) => { const { q: c, esc } = cuantizar(v); return { i, s: c.reduce((a, x, j) => a + x * q[j], 0) * esc } }).sort((a, b) => b.s - a.s).map((x) => x.i)
  assert.deepEqual(aprox.slice(0, 5), exacto.slice(0, 5))
})

test('recuerdos por sentido: la memoria del prompt trae lo que tiene que ver aunque no comparta palabras; repetidos con otras palabras se juntan', async () => {
  juguete()
  const db = abrir(':memory:')
  const perro = recordar(db, { texto: 'Tiene un gato que se llama Michi', tipo: 'hecho' })
  for (let i = 0; i < 40; i++) recordar(db, { texto: `Dato suelto número ${i} sobre otra cosa distinta`, tipo: 'hecho' })
  await vectorizarItems(db)
  const q = await vectorDe(db, '¿qué hago con mi mascota cuando viajo?')
  const mem = memoriaParaPrompt(db, 6, '¿qué hago con mi mascota cuando viajo?', q)
  assert.match(mem, /Michi/)
  assert.doesNotMatch(memoriaParaPrompt(db, 6, '¿qué hago con mi mascota cuando viajo?'), /Michi/, 'sin vectores no lo encontraba')
  // Dos que dicen lo mismo con otras palabras (y sin números distintos) se juntan.
  recordar(db, { texto: 'Su mascota es una gata llamada Michi', tipo: 'hecho' })
  await vectorizarItems(db)
  const antes = memoriaVigente(db).length
  deduplicarMemoria(db)
  assert.equal(memoriaVigente(db).length, antes - 1)
  assert.ok(memoriaVigente(db).some((r) => r.id === perro.id) || memoriaVigente(db).some((r) => /gata/.test(r.texto)))
})

test('reproceso: destila lo que no vino del Takeout (entidades, lugares, eventos con fecha resuelta, relaciones) y respeta la pausa y la nube; sin tope diario', async () => {
  juguete()
  const db = abrir(':memory:')
  const yo = asegurarEntidad(db, { tipo: 'persona', nombre: 'Jugador Prueba' })
  marcarJugador(db, yo)
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Prueba' })
  const valencia = asegurarEntidad(db, { tipo: 'lugar', nombre: 'Valencia' })
  const proy = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Proyecto Prueba' })
  const nota = insertar(db, { fuente: 'operador', titulo: 'Nota del domingo', nivel: 'propia', fecha: '2026-10-04', origenId: 'r:n', contenido: `Hablé con Ana sobre el Proyecto Prueba. El viernes nos juntamos en Valencia para cerrar el piloto. ${'Más detalle de la charla. '.repeat(20)}` })!
  insertar(db, { fuente: 'operador', titulo: 'Corta', nivel: 'propia', origenId: 'r:c', contenido: 'muy corta' })
  insertar(db, { fuente: 'operador', titulo: 'Ya del Takeout', nivel: 'propia', origenId: 'takeout:algo', contenido: 'x'.repeat(500) })
  const vistos: string[] = []
  _probarTakeout({
    destilar: async (_db, sistema, usuario) => {
      vistos.push(sistema + usuario)
      return {
        resumen: 'Se juntó con Ana por el piloto.', valor: 2, temas: ['piloto documental'], decisiones: ['cerrar el piloto'], abierto: [], sobre_el: ['Quiere producir documentales'],
        proyectos: [{ nombre: 'Proyecto Prueba', estado_entonces: 'cerrando el piloto', ideas: [] }], personas: [{ nombre: 'Ana Prueba', rol: 'socia' }],
        ideas: [{ texto: 'Grabar el piloto en una semana', proyecto: 'Proyecto Prueba' }],
        lugares: [{ nombre: 'Valencia', tipo: 'ciudad', lat: 39.47, lon: -0.376 }, { nombre: 'Lisboa', tipo: 'ciudad', lat: 38.72, lon: -9.14 }],
        eventos: [{ titulo: 'Reunión con Ana para cerrar el piloto', fecha: '2026-10-09', tipo: 'futuro', lugar: 'Valencia', personas: ['Ana Prueba'], confianza: 0.9 }, { titulo: 'sin fecha', fecha: null }],
        relaciones: [{ de: 'yo', con: 'Ana Prueba', tipo: 'socios', detalle: 'el piloto', evidencia: 'nos juntamos para cerrar el piloto' }],
      }
    },
  })

  assert.equal(encolarReproceso(db), 1, 'solo la que tiene texto y no vino del Takeout')
  assert.equal(encolarReproceso(db), 0, 'no se repite')

  // En la compu no corre (gasta tokens).
  delete process.env.MASTRO_REPROCESO_LOCAL
  assert.throws(() => controlarReproceso(db, 'empezar'), /corre en la nube/)
  process.env.MASTRO_REPROCESO_LOCAL = '1'

  // En pausa no hace nada.
  await trabajarReproceso(db)
  assert.equal(estadoReproceso(db).destilado.hechos, 0)

  fijarAjuste(db, 'reproceso_activo', '1')
  await trabajarReproceso(db)
  const e = estadoReproceso(db)
  assert.equal(e.destilado.hechos, 1)
  assert.equal(e.pasajes.piezas, e.pasajes.total, 'todas con pasajes')
  assert.match(vistos[0], /archivo personal del jugador/)
  assert.match(vistos[0], /fecha 2026-10-04/)

  const p = db.prepare('SELECT entidades FROM corpus WHERE id = ?').get(nota) as any
  assert.deepEqual(JSON.parse(p.entidades).sort(), [ana, valencia, proy].sort())
  assert.ok(db.prepare(`SELECT 1 FROM corpus WHERE origen_id = ?`).get(`takeout:destilado:${nota}`), 'la pieza del destilado')
  assert.deepEqual([leerEntidad(db, valencia)!.meta?.lat, leerEntidad(db, valencia)!.meta?.lon], [39.47, -0.376])
  assert.ok(db.prepare(`SELECT 1 FROM takeout_nombres WHERE nombre = 'Lisboa' AND tipo = 'lugar'`).get(), 'un lugar nuevo queda propuesto')
  const l = lineaTemporal(db, { entidad: ana }, new Date(2026, 9, 5).getTime())
  assert.deepEqual(l.eventos.map((x) => [x.titulo, x.fecha, x.tipo, x.lugar]), [['Reunión con Ana para cerrar el piloto', '2026-10-09', 'futuro', 'Valencia']])
  assert.equal(l.futuros.length, 1)
  assert.deepEqual(conexionesDe(db, yo).map((c) => [c.nombre, c.relacion]), [['Ana Prueba', 'socios']])
  const g = grafoPersonas(db)
  assert.ok(g.aristas.some((x) => x.tipo === 'socios'))

  // Agendar un evento futuro lo vuelve side quest con fecha.
  const sq = resolverEvento(db, l.futuros[0].id, 'agendar') as any
  assert.equal(sq.vence, '2026-10-09')

  // Sin tope diario: aunque haya gastado mucho hoy, sigue; y lo suyo no le come el tope a la liga.
  insertar(db, { fuente: 'operador', titulo: 'Nueva', nivel: 'propia', origenId: 'r:nueva', contenido: 'y'.repeat(600) })
  db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'm', 'extractor', 'reproceso', 90000000, 0, 1, 200, ?)`).run(Date.now())
  await trabajarReproceso(db)
  assert.equal(estadoReproceso(db).destilado.hechos, 2, 'destiló la nueva igual')
  assert.equal(tokensHoy(db).liga, 0)
  assert.ok(tokensReproceso(db).hoy >= 90_000_000)
  delete process.env.MASTRO_REPROCESO_LOCAL
})

test('la crónica del mes: con lo destilado y los eventos; se rehace cuando hay material nuevo', async () => {
  const db = abrir(':memory:')
  for (let i = 1; i <= 3; i++) {
    const id = insertar(db, { fuente: 'operador', titulo: `Día ${i}`, nivel: 'propia', fecha: `2026-03-0${i}`, origenId: `m:${i}`, contenido: 'algo' })!
    db.prepare(`INSERT INTO takeout_destilado (pieza_id, lote, estado, salida, hecho_en) VALUES (?, 'reproceso', 'hecho', ?, 1)`).run(id, JSON.stringify({ resumen: `Pasó lo del día ${i}`, decisiones: [], abierto: [] }))
  }
  let visto = ''
  _probarCronica(async (_db, _s, u) => { visto = u; return { titulo: 'El mes del arranque', cronica: 'Arrancó todo.', giros: ['Dejó el trabajo'], abierto: [] } })
  const id = await cronicaDelMes(db, '2026-03')
  assert.match(visto, /Pasó lo del día 2/)
  const c = db.prepare('SELECT titulo, contenido FROM corpus WHERE id = ?').get(id) as any
  assert.match(c.titulo, /Mes · 2026-03 · El mes del arranque/)
  assert.match(c.contenido, /Dejó el trabajo/)
  assert.equal(await cronicaDelMes(db, '2026-03'), id, 'la misma pieza, actualizada')
})

test('el chat trae solo lo relevante de su archivo, con ids para citar (y un modelo chico elige si hay de más)', async () => {
  juguete()
  const db = abrir(':memory:')
  const ids = Array.from({ length: 9 }, (_, i) => insertar(db, { fuente: 'operador', titulo: `Viaje ${i}`, nivel: 'propia', origenId: `v:${i}`, contenido: `Notas del viaje a Valencia, parte ${i}.` })!)
  await pasajesDe(db, ids)
  let pidio = 0
  _probarReordenar(async (_db, _m, cs) => { pidio = cs.length; return [cs[3].clave, cs[0].clave] })
  const a = await archivoRelevante(db, '¿cuándo sale el vuelo?')
  assert.ok(pidio > 6)
  assert.equal(a.texto.split('\n').filter((l) => l.startsWith('- [#')).length, 2)
  assert.match(a.texto, /^Lo que su archivo dice de esto/)
  assert.match(promptMastropiero(db, '¿cuándo sale el vuelo?', null, null, a), /Lo que su archivo dice de esto[\s\S]*\[#\d+\] «Viaje/)
  assert.equal((await archivoRelevante(db, 'hola')).texto, '', 'un saludo no busca nada')
})

test('procesar no espera a lo importado: lo ayuda a destilar (si sus medios ya están) y sigue con los pasajes', async () => {
  juguete()
  const db = abrir(':memory:')
  db.prepare(`INSERT INTO takeout_lotes (id, estado, creado_en) VALUES ('chatgpt-prueba', 'procesando', 1)`).run()
  const chat = insertar(db, { fuente: 'operador', titulo: 'ChatGPT · Una charla', nivel: 'investigacion', fecha: '2025-03-01', origenId: 'takeout:chatgpt:x1', contenido: 'Charla larga sobre el proyecto. '.repeat(30), meta: { chat: 'x1', ia: 'ChatGPT', origen: 'chatgpt' } })!
  db.prepare(`INSERT INTO takeout_destilado (pieza_id, lote, prioridad, estado) VALUES (?, 'chatgpt-prueba', 0, 'pendiente')`).run(chat)
  let sistema = ''
  _probarTakeout({ destilar: async (_db, s) => { sistema = s; return { resumen: 'Habló del proyecto.', valor: 1, temas: [], proyectos: [], personas: [], ideas: [], decisiones: [], abierto: [], sobre_el: [] } } })
  process.env.MASTRO_REPROCESO_LOCAL = '1'
  fijarAjuste(db, 'reproceso_activo', '1')
  await trabajarReproceso(db)
  assert.equal((db.prepare('SELECT estado FROM takeout_destilado WHERE pieza_id = ?').get(chat) as any).estado, 'hecho')
  assert.match(sistema, /ChatGPT, la primera IA que usó/, 'se destila con el prompt de su lote')
  assert.ok(db.prepare('SELECT 1 FROM pasajes WHERE pieza_id = ?').get(chat), 'y tiene sus pasajes')
  assert.deepEqual(estadoReproceso(db).importado, { destilado: 0, hechos: 1, medios: 0 })
  delete process.env.MASTRO_REPROCESO_LOCAL
})
