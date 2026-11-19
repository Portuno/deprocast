import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { HERRAMIENTAS, ejecutarHerramienta } from '../src/chat/herramientas.ts'

test('Fragua #315: ver_entidad con un id que no está no es un fallo; sugiere parecidas por nombre y encuentra por nombre', async () => {
  const db = abrir(':memory:')
  const doyou = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Doyou Studio' })
  asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Doyou Films' })
  const ver = async (a: Record<string, unknown>) => ejecutarHerramienta(HERRAMIENTAS, 'ver_entidad', JSON.stringify(a), { db, conversacionId: null })

  const sola = await ver({ id: 963 })
  assert.equal(sola.ok, true, 'un id que no está no se registra como error')
  assert.equal((sola.resultado as any).no_encontrada, true)
  assert.match((sola.resultado as any).aviso, /No existe la entidad 963.*No reintentes/)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM errores').get() as any).n, 0)

  const parecidas = await ver({ id: 963, nombre: 'Doyou' })
  assert.equal(parecidas.ok, true)
  assert.deepEqual((parecidas.resultado as any).sugerencias.map((x: any) => x.nombre).sort(), ['Doyou Films', 'Doyou Studio'])

  const porNombre = await ver({ nombre: 'doyou studio' })
  assert.equal((porNombre.resultado as any).id, doyou, 'el nombre exacto la trae entera')
  assert.equal(((await ver({ id: doyou })).resultado as any).nombre, 'Doyou Studio')
})
