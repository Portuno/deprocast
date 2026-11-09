import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { asegurarEntidad, leerEntidad } from '../src/entidades.ts'
import { moverPropuesta, resolverEncargoSugerido, sugerirEncargo } from '../src/delegar.ts'
import { bandeja } from '../src/sombra.ts'

test('Para delegar (plan v38): lo que automatiza su trabajo es un encargo sugerido; lo que no es de Deprocast sale de La Fragua', async () => {
  const db = abrir(':memory:')
  const e = (await sugerirEncargo(db, { titulo: 'Leer la bandeja', pedido: 'Mirá mis mails y decime cuáles responder hoy.', cuando: 'de lunes a viernes a las 8', origen: 'proceso:1' }))!
  assert.equal(e.cuando, 'de lunes a viernes a las 8')
  assert.equal(await sugerirEncargo(db, { titulo: 'leer la bandeja', pedido: 'x', origen: 'proceso:1' }), null, 'no se repite')
  assert.equal((await sugerirEncargo(db, { titulo: 'Otro', pedido: 'y', cuando: 'cuando pinte', origen: 'x' }))!.cuando, 'todos los lunes a las 9', 'un cuándo que no se entiende: el de siempre')
  const g = bandeja(db).grupos.find((x: any) => x.tipo === 'delegar')!
  assert.equal(g.n, 2)
  const p = await resolverEncargoSugerido(db, e.id, 'aceptar') as any
  assert.equal(p.titulo, 'Leer la bandeja')
  assert.ok((db.prepare('SELECT COUNT(*) AS n FROM programados').get() as any).n === 1, 'aceptar crea el encargo programado')

  const nueva = (t: string) => Number(db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, origen, creada_en) VALUES (?, ?, 'otro', 'media', 'abierta', 'anotaciones', 0)`).run(t, 'Algo concreto.\n\nEs diseño (salió de tus anotaciones): no se construye ni se ejecuta nada hasta que lo apruebes.').lastInsertRowid)
  const a = nueva('Perfil como landing')
  assert.match((await moverPropuesta(db, a, 'encargo')).destino, /encargo sugerido #\d+/)
  assert.equal((db.prepare('SELECT estado FROM propuestas WHERE id = ?').get(a) as any).estado, 'movida')
  await assert.rejects(moverPropuesta(db, a, 'idea'), /ya no está abierta/)
  const b = nueva('Vías de comunicación por algoritmo')
  assert.match((await moverPropuesta(db, b, 'idea')).destino, /la idea #\d+/)
  assert.equal((db.prepare(`SELECT titulo FROM misiones WHERE categoria = 'idea'`).get() as any).titulo, 'Idea: Vías de comunicación por algoritmo')
  const proy = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Corruptopolis' })
  const c = nueva('Capa histórica')
  await moverPropuesta(db, c, 'proyecto', { proyecto: 'corruptopolis' })
  assert.match(leerEntidad(db, proy)!.notas!, /💡 Capa histórica: Algo concreto\.$/)
})
