import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
const { abrir } = await import('../src/db.ts')
const { asegurarFuente, insertar } = await import('../src/corpus.ts')
const gr = await import('../src/grafo/index.ts')

const T = new Date(2026, 9, 26, 10).getTime()
const ELECTRICO = 'El circuito tiene resistencia, corriente y voltaje. La resistencia frena la corriente del circuito.'
const COCINA = 'La receta de pan lleva harina, levadura y horno. El horno cocina la harina de la receta.'

/** Una base en archivo (el hilo aparte la lee con su propia conexión), con texto suyo, quántomos y material ajeno. */
function base() {
  const db = abrir(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grafo-')), 'g.db'))
  asegurarFuente(db, { id: 'operador', nombre: 'Él', nivel: 'propia' })
  asegurarFuente(db, { id: 'web', nombre: 'Web', nivel: 'primaria' })
  for (let i = 0; i < 6; i++) insertar(db, { fuente: 'operador', nivel: 'propia', titulo: `Nota ${i}`, contenido: ELECTRICO, origenId: `p${i}`, fecha: '2026-10-0' + (i + 1) }, T)
  for (let i = 0; i < 6; i++) insertar(db, { fuente: 'web', nivel: 'primaria', titulo: `Receta ${i}`, contenido: COCINA, origenId: `w${i}` }, T)
  for (let i = 0; i < 3; i++) db.prepare(`INSERT INTO quantomos (texto, etapa, creado_en, actualizado_en) VALUES (?, 'sellado', ?, ?)`).run('El voltaje empuja la corriente por el circuito.', T, T)
  return db
}
const formas = (f: any) => new Set(f.nodos.map((n: any) => n.forma))

test('Las capas: «Tu voz» (lo suyo y lo sellado, con Vos en el centro) y «Todo»; sin cambios no hay foto nueva', async () => {
  const db = base()
  const [voz, todo] = gr.listarGrafos(db)
  assert.deepEqual([voz.nombre, todo.nombre], ['Tu voz', 'Todo'])
  const f = (await gr.recalcular(db, voz.id, { ahora: T }))!
  assert.ok(formas(f).has('corriente') && !formas(f).has('harina'), 'en tu voz no entra lo ajeno')
  assert.deepEqual(f.nodos.filter((n) => n.vos).map((n) => [n.x, n.y]), [[0, 0]], 'Vos en el centro')
  assert.equal(f.documentos, 9, '6 piezas suyas + 3 quántomos sellados')
  const otra = await gr.recalcular(db, voz.id, { ahora: T + 1 })
  assert.equal(otra!.id, f.id, 'el mismo texto: la misma foto')
  const forzada = await gr.recalcular(db, voz.id, { forzar: true, ahora: T + 2 })
  assert.notEqual(forzada!.id, f.id)
  assert.equal(gr.historia(db, voz.id).length, 2)

  const ft = (await gr.recalcular(db, todo.id, { ahora: T }))!
  assert.ok(formas(ft).has('corriente') && formas(ft).has('harina'), 'en todo entra todo')
  assert.ok(!ft.nodos.some((n) => n.vos))
  assert.ok(ft.huecos.length >= 1 && ft.metricas.comunidades >= 2)
})

test('Los grafos que él arma: por entidad, por conversación, por texto; editar y borrar (las capas no se borran)', async () => {
  const db = base()
  const ent = Number(db.prepare(`INSERT INTO entidades (nombre, tipo, creada_en) VALUES ('Panadería', 'proyecto', ?)`).run(T).lastInsertRowid)
  for (const { id } of db.prepare(`SELECT id FROM corpus WHERE titulo LIKE 'Receta%'`).all() as { id: number }[]) db.prepare('INSERT INTO corpus_entidades (pieza_id, entidad_id) VALUES (?, ?)').run(id, ent)
  const cid = Number(db.prepare(`INSERT INTO conversaciones (con, creada_en, actualizada_en) VALUES ('mastropiero', ?, ?)`).run(T, T).lastInsertRowid)
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'operador', ?, ?)`).run(cid, 'Quiero un dron con cámara térmica y batería de litio para mapear el campo con el dron', T)
  assert.throws(() => gr.crearGrafo(db, { nombre: 'Vacío', fuentes: [] }), /al menos una fuente/)
  const g = gr.crearGrafo(db, { nombre: 'Panadería y drones', fuentes: [{ tipo: 'entidad', id: ent }, { tipo: 'conversacion', id: cid }, { tipo: 'texto', texto: 'La levadura fermenta la masa del pan.' }, { tipo: 'nada' }] }, T)
  assert.equal(g.fuentes.length, 3, 'lo que no es una fuente se ignora')
  const f = (await gr.recalcular(db, g.id))!
  assert.ok(formas(f).has('harina') && formas(f).has('dron') && !formas(f).has('voltaje'))
  assert.equal(gr.editarGrafo(db, g.id, { nombre: 'Panes' })!.nombre, 'Panes')
  assert.throws(() => gr.editarGrafo(db, gr.grafoPorClave(db, 'voz').id, { borrar: true }), /no se borran/)
  gr.editarGrafo(db, g.id, { borrar: true })
  assert.equal(gr.leerGrafo(db, g.id), null)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM grafo_fotos WHERE grafo_id = ?').get(g.id) as any).n, 0)
})

test('El diccionario: frenar, proteger y alias cambian lo que se ve; y analizar un texto suelto', async () => {
  const db = base()
  const voz = gr.grafoPorClave(db, 'voz')
  gr.editarDiccionario(db, { forma: 'Voltaje', tipo: 'stop' })
  gr.editarDiccionario(db, { forma: 'circuito', tipo: 'alias', destino: 'Red eléctrica' })
  assert.throws(() => gr.editarDiccionario(db, { forma: 'x' }), /Qué palabra/)
  assert.throws(() => gr.editarDiccionario(db, { forma: 'algo', tipo: 'alias' }), /a qué se unifica/)
  const f = (await gr.recalcular(db, voz.id, { forzar: true }))!
  assert.ok(!formas(f).has('voltaje'), 'frenada')
  assert.ok(formas(f).has('red eléctrica') && !formas(f).has('circuito'), 'unificada en su alias')
  assert.equal(gr.editarDiccionario(db, { forma: 'voltaje', tipo: null }).length, 1, 'sacarla del diccionario')
  const r = await gr.analizarTexto(db, `${ELECTRICO}\n\n${COCINA}\n\n${ELECTRICO}`)
  assert.ok(r.nodos.length > 4 && !r.nodos.some((n) => n.vos))
  await assert.rejects(gr.analizarTexto(db, 'corto'), /más largo/)
})

test('Leer el grafo: los pasajes donde aparecen juntos, quitar lo obvio, el diff entre fotos y el grafo de algo', async () => {
  const db = base()
  const le = await import('../src/grafo/leer.ts')
  const voz = gr.grafoPorClave(db, 'voz')
  const f = (await gr.recalcular(db, voz.id, { ahora: T }))!
  const nodo = (forma: string) => f.nodos.find((n) => n.forma === forma)!
  assert.equal(le.prefijo('resistent', 'resistencia'), 'resisten', 'lo común entre la raíz y la forma')
  const frs = le.fragmentos(db, voz.id, f.id, nodo('resistencia'), nodo('corriente'))
  assert.ok(frs.length >= 1)
  assert.match(frs[0].texto, /«resistencia» frena la «corriente»/)
  assert.ok(frs.every((x) => x.pieza != null), 'piezas suyas, con su id para abrirlas')
  const solos = le.fragmentos(db, voz.id, f.id, nodo('voltaje'))
  assert.ok(solos.some((x) => x.quantomo != null), 'también los quántomos sellados')
  assert.equal(le.fragmentos(db, voz.id, f.id, { lema: 'harin', forma: 'harina' }).length, 0, 'lo que no entra a este grafo no aparece')

  const sin = await le.sinLoObvio(db, f.id, 2)
  assert.equal(sin.quitados.length, 2)
  assert.ok(sin.nodos.every((n) => !sin.quitados.includes(n.forma)))
  assert.equal(sin.metricas.n, f.metricas.n - 2)

  insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Drones', contenido: 'El dron vuela con hélices y batería; la batería del dron dura poco y la hélice se rompe.', origenId: 'pd' }, T)
  const f2 = (await gr.recalcular(db, voz.id, { ahora: T + 1 }))!
  const d = le.diffFotos(f, f2)
  assert.ok(d.nuevos.includes('dron') || d.nacieron.some((c) => c.top.includes('dron')), 'lo nuevo aparece en el diff')
  assert.ok(d.metricas.n.ahora > d.metricas.n.antes)

  const ent = Number(db.prepare(`INSERT INTO entidades (nombre, tipo, creada_en) VALUES ('Electricidad', 'concepto', ?)`).run(T).lastInsertRowid)
  const g1 = le.grafoDe(db, { tipo: 'entidad', id: ent }, 'Electricidad')
  const g2 = le.grafoDe(db, { tipo: 'entidad', id: ent }, 'Otro nombre')
  assert.equal(g1.id, g2.id, 'el grafo de algo se reusa')
})
