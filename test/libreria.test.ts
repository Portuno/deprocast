import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { _probarModelo } from '../src/modelo.ts'
import { aCsv, agregarObra, avisoLibreria, conteos, editarObra, listarObras, poblarLibreria } from '../src/libreria.ts'

test('librería: sumar sin duplicar, editar marca revisada, CSV', () => {
  const db = abrir(':memory:')
  const a = agregarObra(db, { tipo: 'libro', titulo: 'El nombre de la rosa', autor: 'Umberto Eco', anio: '1980' })
  assert.equal(a.nueva, true)
  assert.equal(a.obra.estado, 'quiero')
  assert.equal(a.obra.revisada, true, 'lo que carga él ya está revisado')
  assert.equal(agregarObra(db, { tipo: 'libro', titulo: 'nombre de la Rosa' }).nueva, false, 'mismo título, sin artículo ni mayúsculas')
  assert.throws(() => agregarObra(db, { tipo: 'disco', titulo: 'x' }), /Tipo desconocido/)
  const m = agregarObra(db, { tipo: 'serie', titulo: 'Dark', origen: 'mastropiero' }).obra
  assert.equal(m.revisada, false)
  assert.equal(m.estado, 'referencia')
  assert.deepEqual(conteos(db).serie, { total: 1, sinRevisar: 1 })
  const e = editarObra(db, m.id, { estado: 'terminado', valoracion: 15, etiquetas: 'tiempo, alemana' })!
  assert.deepEqual([e.estado, e.valoracion, e.etiquetas, e.revisada], ['terminado', 12, ['tiempo', 'alemana'], true])
  assert.match(aCsv(listarObras(db)), /^tipo,titulo,autor.*\nserie,Dark,,,terminado,12,,tiempo \| alemana,,mastropiero/s)
  editarObra(db, m.id, { borrar: true })
  assert.equal(listarObras(db, { tipo: 'serie' }).length, 0)
})

test('librería: se puebla desde el corpus (repos y papers por URL, el resto con el modelo) y no relee', async () => {
  const db = abrir(':memory:')
  const lib = asegurarEntidad(db, { tipo: 'dominio', nombre: 'Libroteca (libros, películas, series, etc)', origenId: 't:lib' })
  insertar(db, { fuente: 'operador', titulo: 'Repo útil', contenido: 'x', url: 'https://github.com/dueno/proyecto', origenId: 'l:1' })
  insertar(db, { fuente: 'operador', titulo: 'Hallazgo · Atención es todo', contenido: 'x', url: 'https://arxiv.org/abs/1706.03762', origenId: 'l:2' })
  const p = insertar(db, { fuente: 'operador', titulo: 'Audio', contenido: 'Terminé de leer Dune de Frank Herbert, y quiero ver la serie Severance.', nivel: 'propia', entidades: [lib], origenId: 'l:3' })!
  let llamadas = 0
  _probarModelo(async () => {
    llamadas++
    return { texto: JSON.stringify({ obras: [{ tipo: 'libro', titulo: 'Dune', autor: 'Frank Herbert', texto: 1 }, { tipo: 'serie', titulo: 'Severance', texto: 1 }, { tipo: 'disco', titulo: 'no vale', texto: 1 }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  const r = await poblarLibreria(db)
  assert.deepEqual({ ...r, titulos: [...r.titulos].sort() }, { porUrl: 2, leidas: 1, nuevas: 2, titulos: ['Atención es todo', 'Dune', 'Severance', 'dueno/proyecto'] })
  assert.match(avisoLibreria(r)!, /^Sumé 4 obras a la Librería: .*«Dune»/)
  const repo = listarObras(db, { tipo: 'repositorio' })[0]
  assert.deepEqual([repo.titulo, repo.autor, repo.url], ['dueno/proyecto', 'dueno', 'https://github.com/dueno/proyecto'])
  assert.equal(listarObras(db, { tipo: 'paper' })[0].titulo, 'Atención es todo')
  const dune = listarObras(db, { tipo: 'libro' })[0]
  assert.deepEqual([dune.titulo, dune.autor, dune.piezas, dune.revisada], ['Dune', 'Frank Herbert', [p], false])
  const r2 = await poblarLibreria(db)
  assert.deepEqual(r2, { porUrl: 0, leidas: 0, nuevas: 0, titulos: [] })
  assert.equal(avisoLibreria(r2), null, 'sin obras nuevas no hay aviso')
  assert.equal(llamadas, 1, 'lo leído no se vuelve a leer')
})

test('librería: expandir trae la fuente al corpus (README del repo, o la página que encuentra), con resumen; si no es la obra, no guarda', async () => {
  const { _probarExpansion, expandirObra, cuadernoDeObra, panorama, paraExpandir } = await import('../src/libreria.ts')
  const { leerPieza } = await import('../src/corpus.ts')
  const { leerCuaderno } = await import('../src/cuadernos.ts')
  const db = abrir(':memory:')
  const repo = agregarObra(db, { tipo: 'repositorio', titulo: 'dueno/proyecto', url: 'https://github.com/dueno/proyecto', estado: 'en_curso' }).obra
  const libro = agregarObra(db, { tipo: 'libro', titulo: 'Dune', autor: 'Frank Herbert', estado: 'quiero' }).obra
  const nada = agregarObra(db, { tipo: 'pelicula', titulo: 'Película inexistente', estado: 'quiero' }).obra
  agregarObra(db, { tipo: 'serie', titulo: 'Referencia sin valorar', origen: 'mastropiero' })
  const orden = paraExpandir(db).map((o) => o.titulo)
  assert.equal(orden[0], 'dueno/proyecto', 'en curso primero')
  assert.deepEqual(orden.slice(1).sort(), ['Dune', 'Película inexistente'], 'lo no revisado ni valorado, no')
  const pedidas: string[] = []
  _probarExpansion({
    bajar: async (url) => { pedidas.push(url); return url.includes('raw.githubusercontent.com/dueno/proyecto/HEAD/README.md') ? { titulo: 'x', texto: '# Proyecto\nUn motor de prueba.' } : url.includes('wiki/Dune') ? { titulo: 'Dune', texto: 'Dune es una novela de Frank Herbert. '.repeat(20) } : url.includes('wiki/Otra') ? { titulo: 'Otra', texto: 'Algo que no es. '.repeat(40) } : null },
    buscar: async (_db, q) => (q.startsWith('Dune') ? [{ titulo: 'Dune', url: 'https://es.wikipedia.org/wiki/Dune', extracto: '', proveedor: 'wikipedia' }] : q.startsWith('Película') ? [{ titulo: 'Otra', url: 'https://es.wikipedia.org/wiki/Otra', extracto: '', proveedor: 'wikipedia' }] : []),
  })
  _probarModelo(async (_l, o) => {
    const u = String(o.mensajes[1].content)
    const datos = u.includes('Película inexistente') ? { es_la_obra: false } : { es_la_obra: true, resumen: u.includes('Dune') ? 'Novela de ciencia ficción en un planeta desierto.' : 'Un motor de prueba.' }
    return { texto: JSON.stringify(datos), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }
  })
  const r1 = await expandirObra(db, repo.id)
  assert.ok(pedidas[0].endsWith('/HEAD/README.md'))
  const p1 = leerPieza(db, r1.piezaId!)!
  assert.equal(p1.nivel, 'primaria')
  assert.match(p1.contenido, /^Un motor de prueba\.\n\n# Proyecto/)
  assert.deepEqual(r1.obra.piezas, [r1.piezaId])
  const r2 = await expandirObra(db, libro.id)
  assert.equal(r2.obra.resumen, 'Novela de ciencia ficción en un planeta desierto.')
  assert.equal(r2.obra.url, 'https://es.wikipedia.org/wiki/Dune')
  const r3 = await expandirObra(db, nada.id)
  assert.equal(r3.piezaId, null)
  assert.match(r3.aviso!, /habla de otra cosa/)
  assert.equal(r3.obra.expansion, 'fuente dudosa')
  assert.deepEqual([panorama(db).enCorpus, panorama(db).porExpandir], [2, 0])
  const c = await cuadernoDeObra(db, libro.id)
  assert.deepEqual(leerCuaderno(db, c.id)!.fuentes.map((f) => f.id), [r2.piezaId])
  await assert.rejects(cuadernoDeObra(db, nada.id), /expandila primero/)
})
