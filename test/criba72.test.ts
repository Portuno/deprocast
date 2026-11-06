import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import * as c from '../src/criba72.ts'

/** Una criba de juguete con la forma de verdad: 6 ejes × 6 pares, polos en lugares lejanos. */
function juguete(id = 'prueba') {
  const pares = Array.from({ length: 36 }, (_, i) => ({ eje: Math.floor(i / 6), tension: `T${i}`, a: `Frase A número ${i}`, b: `Frase B número ${i}` }))
  const m = c.mezclar(pares, 7)
  return { id, titulo: 'Las 72 de prueba', grupo: 'adentro', ilumina: 'algo', consigna: 'Votá por instinto.', a1: 'Nada', a6: 'Mucho', ejes: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'], ...m }
}

test('Criba del 72: la mezcla deja los polos lejos y la forma se valida', () => {
  const j = juguete()
  assert.equal(c.validar(j), null)
  assert.equal(j.items.length, 72)
  for (const [, , a, b] of j.pares) assert.ok(Math.abs(a - b) >= 8, 'los dos polos de un par, lejos')
  assert.match(c.validar({ ...j, items: j.items.slice(1) })!, /72 frases/)
  assert.match(c.validar({ ...j, pares: j.pares.map((p, i) => (i === 1 ? [p[0], p[1], j.pares[0][2], p[3]] : p)) as any })!, /dos pares/)
  assert.match(c.validar({ ...j, a6: '' })!, /anclas/)
})

test('Criba del 72: importar, votar, métricas como el artefacto, cerrar y reiniciar', () => {
  const db = abrir(':memory:')
  const r = c.importarCribas(db, [juguete(), { titulo: 'rota' }])
  assert.equal(r.nuevas, 1)
  assert.equal(r.errores.length, 1)
  assert.equal(c.importarCribas(db, { cribas: [juguete()] }).actualizadas, 1, 'la misma clave se actualiza')
  const [lista] = c.listarCribas(db)
  assert.equal(lista.votadas, 0)

  const cr = c.leerCriba(db, lista.id)!
  let s = c.empezar(db, cr.id, 'Mi jefe')
  assert.equal(s.enMente, 'Mi jefe')
  assert.equal(c.empezar(db, cr.id).id, s.id, 'sigue la misma sesión')
  // Par 0: partido (6 vs 1); par 1: tensión viva (5 y 6); par 2: zona fría (2 y 3); el resto 4 y 4 (templado).
  const [p0, p1, p2] = cr.pares
  const votos = new Map<number, number>([[p0[2], 6], [p0[3], 1], [p1[2], 5], [p1[3], 6], [p2[2], 2], [p2[3], 3]])
  for (let n = 1; n <= 72; n++) s = c.votar(db, s.id, n, votos.get(n) ?? 4, { duda: n === 3 })
  assert.equal(s.estado, 'cerrada')
  assert.ok(s.fin)
  const m = c.metricas(cr, s)
  assert.equal(m.votadas, 72)
  assert.deepEqual([m.pares[0].clase, m.pares[0].delta, m.pares[0].carga], ['partido', 5, 7])
  assert.equal(m.pares[1].clase, 'tension')
  assert.equal(m.pares[2].clase, 'fria')
  assert.equal(m.pares[3].clase, 'templado')
  assert.deepEqual(m.dudas, [3])
  assert.equal(m.ejes[0].partido, 1)

  // Borrar un voto reabre la sesión.
  s = c.votar(db, s.id, 10, null)
  assert.equal(s.estado, 'abierta')
  assert.throws(() => c.votar(db, s.id, 10, 7), /1 a 6/)

  const x = c.exportarSesion(cr, s)
  assert.equal(x.votos.length, 72)
  assert.equal(x.criba.escala.ancla_6, 'Mucho')
  assert.ok(x.votos.every((v) => v.par && (v.polo === 'A' || v.polo === 'B')))
  assert.match(c.exportarTexto(cr, s), /## Protocolo[\s\S]*No diagnostiques[\s\S]*## Pares/)
  assert.doesNotMatch(c.exportarTexto(cr, s, false), /##/)

  c.reiniciar(db, cr.id)
  assert.equal(c.sesionVigente(db, cr.id), null)
  assert.equal(c.empezar(db, cr.id).enMente, null, 'empieza de cero')
})

test('Criba del 72: Mastropiero la arma (mezclada y validada) y la lee con el protocolo; lo aprendido queda para revisar', async () => {
  const db = abrir(':memory:')
  let pedido = ''
  c._probarCriba72(async (_db, sistema, usuario) => {
    if (sistema.includes('Armás una CRIBA')) {
      pedido = usuario
      return { titulo: 'Las 72 decisiones', ilumina: 'Cómo decidís', consigna: 'Votá rápido.', ancla_1: 'Jamás', ancla_6: 'Siempre', ejes: ['a', 'b', 'c', 'd', 'e', 'f'], pares: Array.from({ length: 37 }, (_, i) => ({ eje: i % 6, tension: `T${i}`, a: `Decido así ${i}`, b: `Decido asá ${i}` })) }
    }
    return { lectura: 'Mi lectura es que…', aprendizajes: ['En la criba votó 6 a «Decido así 0»'], pregunta: '¿Qué te frena?', siguiente: { tema: 'El freno', para: 'ver qué frena' } }
  })
  const cr = await c.armarCriba(db, { tema: 'Cómo decido', ancla6: 'Siempre yo' })
  assert.match(pedido, /Tema: Cómo decido/)
  assert.equal(cr.origen, 'mastropiero')
  assert.equal(cr.a6, 'Siempre yo', 'el ancla que pidió manda')
  assert.equal(c.validar(cr), null)
  for (const [, , a, b] of cr.pares) assert.ok(Math.abs(a - b) >= 8)

  await assert.rejects(c.leerConMastropiero(db, cr.id), /votaste/)
  const s = c.empezar(db, cr.id)
  for (let n = 1; n <= 40; n++) c.votar(db, s.id, n, (n % 6) + 1)
  const l = await c.leerConMastropiero(db, cr.id)
  assert.match(l.lectura, /Para vos:\*\* ¿Qué te frena\?/)
  assert.deepEqual(c.sesionVigente(db, cr.id)!.siguiente, { tema: 'El freno', para: 'ver qué frena' })
  const mem = db.prepare(`SELECT * FROM memoria WHERE creada_por = 'criba72'`).all() as any[]
  assert.equal(mem.length, 1)
  assert.equal(mem[0].revisada, 0)
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM preguntas WHERE origen = 'criba72'`).get() as any).n, 1)

  // Profundizar: la nueva conoce a su madre.
  const hija = await c.armarCriba(db, { tema: 'El freno', padreId: cr.id })
  assert.equal(hija.padreId, cr.id)
  assert.match(pedido, /PROFUNDIZAR la criba «Las 72 decisiones»/)
  assert.match(pedido, /Mi lectura es/)

  // Si sale incompleta, no se guarda.
  c._probarCriba72(async () => ({ titulo: 'x', ejes: [], pares: [] }))
  await assert.rejects(c.armarCriba(db, { tema: 'algo' }), /no salió completa/)
})

test('Criba del 72: trabajo de fondo', async () => {
  const k = c.deFondo('t1', async () => 42)
  await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual([c.trabajo(k)?.estado, c.trabajo(k)?.resultado], ['listo', 42])
  c.deFondo('t2', async () => { throw new Error('mal') })
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(c.trabajo('t2')?.error, 'mal')
})
