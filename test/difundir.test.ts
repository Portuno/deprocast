import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
const { abrir } = await import('../src/db.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const cu = await import('../src/cuentas.ts')
const { bandeja, resolverBandeja } = await import('../src/sombra.ts')

const T = new Date(2026, 10, 2, 9).getTime()
const pedidos: string[] = []
_probarModelo(async (_l, o) => {
  const u = String((o.mensajes as any[]).at(-1).content)
  pedidos.push(u)
  const red = /Cuenta: (\w+)/.exec(u)?.[1] ?? '?'
  return { texto: JSON.stringify({ publicaciones: [{ texto: `Versión para ${red}: la idea, contada a su manera.`, tipo: 'post' }, { texto: 'otra que sobra', tipo: 'post' }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 5 }
})

test('Una idea, todas tus redes: una versión por cuenta (no las de lectura), en borrador aunque la cuenta sea libre, agrupadas; en 📥 se aprueban', async () => {
  const db = abrir(':memory:')
  const x = cu.guardarCuenta(db, { red: 'twitter', usuario: '@ejemplo', modo: 'redacta' })
  const li = cu.guardarCuenta(db, { red: 'linkedin', usuario: 'ejemplo', modo: 'libre', reglas: { horas: [10] } })
  cu.guardarCuenta(db, { red: 'instagram', usuario: '@lectura', modo: 'lectura' })
  await assert.rejects(cu.difundirIdea(db, 'corta', { ahora: T }), /un poco más/)

  const r = await cu.difundirIdea(db, 'Las entrevistas sin preguntas pactadas dicen más del invitado que cualquier discurso.', { ahora: T })
  assert.deepEqual(r.publicaciones.map((p) => p.cuentaId).sort(), [x.id, li.id].sort(), 'una por cuenta, sin la de lectura')
  assert.ok(r.publicaciones.every((p) => p.estado === 'borrador'), 'en borrador aunque LinkedIn sea libre')
  assert.ok(r.publicaciones.every((p) => p.origen === `idea:${r.idea}`))
  assert.match(pedidos.at(-1)!, /Adaptá ESTA idea suya[\s\S]*preguntas pactadas[\s\S]*Cuántas: 1/)

  const g = bandeja(db, T).grupos.find((x) => x.tipo === 'publicacion')!
  assert.equal(g.n, 2)
  assert.match(String(g.items[0].texto), /una idea/)
  await resolverBandeja(db, 'publicacion', r.publicaciones[0].id, 'aceptar', T)
  const p = cu.listarPublicaciones(db).find((x) => x.id === r.publicaciones[0].id)!
  assert.equal(p.estado, 'aprobada')
  assert.ok(p.programadaPara && p.programadaPara > T, 'programada en el horario de la cuenta')
  assert.equal((db.prepare(`SELECT accion FROM decisiones WHERE tipo = 'publicacion'`).get() as any).accion, 'aceptada')
  await resolverBandeja(db, 'publicacion', r.publicaciones[1].id, 'descartar', T)
  assert.equal(cu.listarPublicaciones(db).find((x) => x.id === r.publicaciones[1].id)!.estado, 'descartada')
})

test('Sin cuentas donde publicar, avisa', async () => {
  const db = abrir(':memory:')
  cu.guardarCuenta(db, { red: 'twitter', usuario: '@solo', modo: 'lectura' })
  await assert.rejects(cu.difundirIdea(db, 'Una idea suficientemente larga para adaptar.', { ahora: T }), /No hay cuentas tuyas/)
})
