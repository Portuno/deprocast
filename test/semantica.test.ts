import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { _probarEmbed, buscarHibrido, estadoVectores, vectorizarPendientes } from '../src/semantica.ts'

// Un «modelo» de juguete: tres ejes de sentido; sinónimos caen en el mismo eje.
const EJES = [/plata|dinero|euros|sueldo/, /perro|mascota|gato/, /viaje|vuelo|valencia/]
const vec = (t: string) => EJES.map((r) => (r.test(t.toLowerCase()) ? 1 : 0.01))

test('semántica: vectoriza de a tandas (propio primero) y la híbrida encuentra lo que dice lo mismo con otras palabras', async () => {
  const db = abrir(':memory:')
  const llamadas: number[] = []
  _probarEmbed(async (_db, textos) => { llamadas.push(textos.length); return { vectores: textos.map(vec), modelo: 'juguete' } })
  const sueldo = insertar(db, { fuente: 'operador', titulo: 'Fin de mes', contenido: 'No me alcanza el sueldo este mes', nivel: 'propia', origenId: 's:1' })!
  const gato = insertar(db, { fuente: 'operador', titulo: 'Michi', contenido: 'El gato rompió todo', nivel: 'propia', origenId: 's:2' })!
  const plata = insertar(db, { fuente: 'operador', titulo: 'Gastos', contenido: 'Anoté la plata del súper', nivel: 'primaria', origenId: 's:3' })!
  for (let i = 0; i < 20; i++) insertar(db, { fuente: 'operador', titulo: `Relleno ${i}`, contenido: 'nada que ver', nivel: 'primaria', origenId: `s:r${i}` })

  assert.deepEqual(estadoVectores(db), { total: 23, hechos: 0, faltan: 23 })
  const r = await vectorizarPendientes(db, { limite: 20 })
  assert.deepEqual(r, { hechos: 20, faltan: 3 })
  assert.deepEqual(llamadas, [16, 4], 'tandas de 16')
  assert.ok(db.prepare('SELECT 1 FROM vectores WHERE pieza_id = ?').get(sueldo), 'lo propio va primero')
  await vectorizarPendientes(db)

  // «dinero» no aparece en ninguna pieza: por palabras no hay nada; por sentido, las dos de plata.
  const ps = await buscarHibrido(db, 'dinero', 5)
  assert.deepEqual(ps.slice(0, 2).map((p) => p.id).sort(), [sueldo, plata].sort())
  assert.ok(!ps.slice(0, 2).some((p) => p.id === gato))
  assert.equal(ps[0].por, 'sentido')

  // «plata» está por palabras y por sentido: esa pieza suma las dos listas y queda arriba.
  const ps2 = await buscarHibrido(db, 'plata', 3)
  assert.equal(ps2[0].id, plata)
  assert.equal(ps2[0].por, 'palabras+sentido')

  // Filtro por nivel.
  assert.deepEqual((await buscarHibrido(db, 'dinero', 5, ['propia'])).map((p) => p.id).slice(0, 1), [sueldo])

  // Sin modelo, la búsqueda de siempre.
  _probarEmbed(async () => { throw new Error('sin red') })
  assert.deepEqual((await buscarHibrido(db, 'súper', 3)).map((p) => p.id), [plata])
  _probarEmbed(null)
})
