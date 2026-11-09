import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { _probarObras, detectarObras, propuestasPendientes, resolverPropuestaObra } from '../src/obras-menciones.ts'
import { bandeja } from '../src/sombra.ts'

test('altas en la Librería desde lo que menciona (Fragua #181): propuesta para validar, estado según el verbo, y pregunta si es ambiguo', async () => {
  const db = abrir(':memory:')
  let llamadas = 0
  _probarObras(async () => {
    llamadas++
    return { obras: [
      { tipo: 'libro', titulo: 'Dune', autor: 'Frank Herbert', estado: 'quiero', ambigua: false },
      { tipo: 'serie', titulo: 'The Bear', autor: null, estado: 'terminado', ambigua: false },
      { tipo: 'pelicula', titulo: 'Solaris', autor: null, estado: 'quiero', ambigua: true, pregunta: '¿Solaris de Tarkovski (1972) o de Soderbergh (2002)?' },
    ] }
  })
  assert.deepEqual(await detectarObras(db, 'hoy fui al súper'), [], 'sin pinta de obra: ni se pregunta al modelo')
  assert.equal(llamadas, 0)
  const ps = await detectarObras(db, 'Quiero leer Dune de Herbert, terminé la serie The Bear y me recomendaron la película Solaris', 'charla:1')
  assert.deepEqual(ps.map((p) => [p.tipo, p.titulo, p.estado]), [['libro', 'Dune', 'quiero'], ['serie', 'The Bear', 'terminado']])
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM preguntas WHERE origen = 'libreria'`).get() as any).n, 1, 'lo ambiguo, como pregunta (no elige)')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM obras').get() as any).n, 0, 'no se agrega sola')
  const g = bandeja(db).grupos.find((x: any) => x.tipo === 'obra')!
  assert.equal(g.n, 2)
  assert.match(g.items.map((i: any) => `${i.texto} (${i.sub})`).join(' | '), /Dune · Frank Herbert \(libro · quiero\)/)
  assert.equal((await detectarObras(db, 'Quiero leer Dune, en serio')).length, 0, 'lo ya propuesto no se repite')
  await resolverPropuestaObra(db, ps[0].id, 'aceptar')
  await resolverPropuestaObra(db, ps[1].id, 'descartar')
  const obra = db.prepare('SELECT titulo, autor, estado FROM obras').get() as any
  assert.deepEqual({ ...obra }, { titulo: 'Dune', autor: 'Frank Herbert', estado: 'quiero' })
  assert.equal(propuestasPendientes(db).length, 0)
})
