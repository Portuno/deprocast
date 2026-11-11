import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'

process.env.NAN_API_KEY = ''
const { _probarModelo } = await import('../src/modelo.ts')
const { _probarEscriba, _probarReintento, conversacionHoy, enviar, mensajes } = await import('../src/chat/index.ts')
_probarEscriba(async () => [])
_probarReintento(async () => {})

test('#237: un turno que se cortó por largo se reintenta una vez, por partes, y contesta ESE pedido', async () => {
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  const sistemas: string[] = []
  let n = 0
  _probarModelo(async (_l: any, o: any) => {
    n++
    sistemas.push(o.mensajes.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n'))
    if (n === 1) throw new Error('Ningún modelo pudo contestar. deepseek-v4-flash: el servidor falló (504: tiempo agotado)')
    return { texto: 'Listo: tanda 1 de 12 en el documento. Faltan 11.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  await enviar(db, cid, 'Armame el bestiario de los 72 arquetipos en tandas de 6, todo en un Word de Drive')
  const ms = mensajes(db, cid)
  assert.ok(ms.some((m) => m.rol === 'error'), 'el error queda a la vista')
  assert.ok(ms.some((m) => m.rol === 'evento' && /lo reintento por partes/.test(m.texto ?? '')))
  assert.equal(ms.at(-1)!.texto, 'Listo: tanda 1 de 12 en el documento. Faltan 11.')
  assert.match(sistemas[1], /se cortó por largo[\s\S]*por partes/)
  assert.equal(n, 2, 'una sola vez')
})

test('#237: un error que no es de tiempo (un bug) no se reintenta solo', async () => {
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  let n = 0
  _probarModelo(async () => { n++; throw new Error("Cannot read properties of undefined (reading 'trim')") })
  await enviar(db, cid, 'Hacé algo')
  assert.equal(n, 1)
})

test('#238: el registro de turnos (acierto, desvío, error) por día, y «error» en el chat marca la respuesta anterior con su causa', async () => {
  const { registroTurnos } = await import('../src/registro-turnos.ts')
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  _probarModelo(async () => ({ texto: 'Las primarias de la semana son…', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }))
  await enviar(db, cid, 'contame el bestiario')
  const r = await enviar(db, cid, 'error: contestó otro tema')
  assert.match((r as any).rapida, /Anotado: la respuesta anterior fue un error \(«contestó otro tema»\)/)
  _probarModelo(async () => { throw new Error('Ningún modelo pudo contestar. deepseek: 504 tiempo agotado') })
  await enviar(db, cid, 'y ahora esto otro')
  const t = registroTurnos(db, 14)
  assert.ok(t.total >= 2)
  assert.equal(t.ultimos.find((x) => x.resultado === 'desvio')?.causa, 'contestó otro tema')
  assert.ok(t.ultimos.some((x) => x.resultado === 'error'))
  assert.equal(t.porDia.at(-1)!.desvios, 1)
  assert.ok(t.causas.some((c) => c.tipo === 'desvio' && /otro tema/.test(c.causa)))
})

test('#238: el reintento que salió bien no hereda el error del intento cortado', async () => {
  const { turnos } = await import('../src/registro-turnos.ts')
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  let n = 0
  _probarModelo(async () => { if (++n === 1) throw new Error('Ningún modelo pudo contestar: tiempo agotado'); return { texto: 'Hecho por partes.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 } })
  await enviar(db, cid, 'algo largo')
  const ts = turnos(db, 14)
  assert.equal(ts.length, 2)
  assert.deepEqual(ts.map((t) => t.resultado).sort(), ['error', null])
})
