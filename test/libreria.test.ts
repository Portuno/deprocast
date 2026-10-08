import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { _probarModelo } from '../src/modelo.ts'
import { aCsv, agregarObra, conteos, editarObra, listarObras, poblarLibreria } from '../src/libreria.ts'

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
  assert.deepEqual(r, { porUrl: 2, leidas: 1, nuevas: 2 })
  const repo = listarObras(db, { tipo: 'repositorio' })[0]
  assert.deepEqual([repo.titulo, repo.autor, repo.url], ['dueno/proyecto', 'dueno', 'https://github.com/dueno/proyecto'])
  assert.equal(listarObras(db, { tipo: 'paper' })[0].titulo, 'Atención es todo')
  const dune = listarObras(db, { tipo: 'libro' })[0]
  assert.deepEqual([dune.titulo, dune.autor, dune.piezas, dune.revisada], ['Dune', 'Frank Herbert', [p], false])
  const r2 = await poblarLibreria(db)
  assert.deepEqual(r2, { porUrl: 0, leidas: 0, nuevas: 0 })
  assert.equal(llamadas, 1, 'lo leído no se vuelve a leer')
})
