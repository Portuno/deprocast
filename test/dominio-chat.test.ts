import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { HERRAMIENTAS } from '../src/chat/herramientas.ts'

const h = (n: string) => HERRAMIENTAS.find((x) => x.nombre === n)!

test('#269: «creame el dominio X» crea el dominio de la Academia, su entidad y su fuente del corpus de una vez; crear_aprendizaje acepta el tema con otros nombres', async () => {
  const db = abrir(':memory:')
  const r = await h('crear_dominio').ejecutar({ nombre: 'Energía y almacenamiento', descripcion: 'Para entender las plantas y los nudos' }, { db } as any) as any
  assert.equal(r.dominio, 'Energía y almacenamiento')
  assert.ok(db.prepare(`SELECT 1 FROM aprendizajes WHERE tema = 'Energía y almacenamiento'`).get(), 'en la Academia')
  assert.ok(db.prepare(`SELECT 1 FROM fuentes WHERE nombre = 'Energía y almacenamiento'`).get(), 'como fuente del corpus')
  assert.ok(db.prepare(`SELECT 1 FROM entidades WHERE nombre = 'Energía y almacenamiento' AND tipo = 'dominio'`).get(), 'en el grafo')
  // Con otros nombres de parámetro (como lo mandó el modelo el 13/11): igual anda.
  for (const a of [{ titulo: 'Electricidad', descripcion: 'x' }, { que: 'SQL' }, { dominio: 'Derecho laboral' }]) {
    const x = await h('crear_aprendizaje').ejecutar(a, { db } as any) as any
    assert.ok(x.id && !x.error, JSON.stringify(x))
  }
  assert.match((await h('crear_aprendizaje').ejecutar({}, { db } as any) as any).error, /Falta el parámetro «tema»/, 'si falta, dice qué falta')
})
