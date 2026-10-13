import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarEscriba, _probarModelo, crearConversacion, enviar, mensajes } from '../src/chat/index.ts'
import { _probarResumen, armarHistorial, pesoTotal, stub, TOPE_BLANDO, TOPE_DURO } from '../src/chat/historial.ts'

_probarEscriba(async () => {})

/** Una conversación guardada: n turnos del operador, cada uno con una herramienta que devuelve `tam` caracteres. */
function conversacion(n: number, tam: number) {
  const db = abrir(':memory:')
  const c = crearConversacion(db)
  const ins = db.prepare('INSERT INTO mensajes (conversacion_id, rol, texto, llamadas, llamada_id, herramienta, razonamiento, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  for (let i = 0; i < n; i++) {
    ins.run(c.id, 'operador', `pregunta ${i}`, null, null, null, null, i)
    ins.run(c.id, 'asistente', '', JSON.stringify([{ id: `t${i}`, nombre: 'buscar_corpus', argumentos: '{}' }]), null, null, `pensé ${i}`, i)
    ins.run(c.id, 'herramienta', 'x'.repeat(tam), null, `t${i}`, 'buscar_corpus', null, i)
    ins.run(c.id, 'asistente', `respuesta ${i}`, null, null, null, null, i)
  }
  return { db, cid: c.id }
}

test('historial: lo viejo y pesado se elide con un stub; el diálogo queda; la ventana reciente va entera', async () => {
  const { db, cid } = conversacion(30, 5000)
  _probarResumen(async () => { throw new Error('no debería resumir') })
  const h = await armarHistorial(db, mensajes(db, cid), { cid })
  const tools = h.filter((m) => m.role === 'tool')
  assert.equal(tools.length, 30, 'no se tiran turnos (antes se cortaba en 40 mensajes)')
  assert.equal(tools[0].content, stub(5000))
  assert.equal(tools.at(-2)!.content, 'x'.repeat(5000), 'los dos últimos turnos del operador, verbatim')
  assert.equal(tools.at(-1)!.content, 'x'.repeat(5000))
  assert.equal(tools.at(-3)!.content, stub(5000))
  assert.equal(h[0].content, 'pregunta 0', 'el primer mensaje del operador sigue ahí')
  assert.equal(h.filter((m) => m.role === 'user').length, 30)
  assert.ok(pesoTotal(h) < TOPE_BLANDO)
  // El razonamiento solo viaja del turno en curso (después del último mensaje del operador).
  assert.equal(h.filter((m) => m.reasoning_content).length, 1)
  assert.equal(h.filter((m) => m.reasoning_content)[0].reasoning_content, 'pensé 29')
})

test('historial: pasado el tope blando, resume lo viejo en un bloque (sin escribirlo en la conversación) y lo recuerda', async () => {
  const { db, cid } = conversacion(10, 300)
  // Diálogo largo: cada respuesta de 6000 caracteres, que no se elide (es diálogo, no herramienta).
  db.prepare(`UPDATE mensajes SET texto = ? WHERE rol = 'asistente' AND texto LIKE 'respuesta%'`).run('r'.repeat(6000))
  let llamadas = 0
  let vio = ''
  _probarResumen(async (_db, previo, texto) => { llamadas++; vio = texto; return `${previo ? 'Antes: sí\n' : ''}Objetivo: probar\nHecho: varias preguntas` })
  const antes = mensajes(db, cid).length
  const h = await armarHistorial(db, mensajes(db, cid), { cid })
  assert.equal(llamadas, 1)
  assert.match(vio, /^OPERADOR: pregunta 0/)
  assert.equal(h[0].role, 'system')
  assert.match(String(h[0].content), /Objetivo: probar/)
  assert.ok(pesoTotal(h) <= TOPE_BLANDO, `${pesoTotal(h)}`)
  assert.equal(h.at(-1)!.content, 'r'.repeat(6000), 'la ventana reciente no se toca')
  assert.equal(mensajes(db, cid).length, antes, 'el resumen no es un mensaje de la conversación')
  // El turno siguiente reusa el resumen guardado: no vuelve a llamar.
  const h2 = await armarHistorial(db, mensajes(db, cid), { cid })
  assert.equal(llamadas, 1)
  assert.deepEqual(h2, h)
})

test('historial: si el resumen falla o no alcanza, el tope duro descarta lo más viejo sin tocar lo reciente; el diario no se resume', async () => {
  const { db, cid } = conversacion(12, 300)
  db.prepare(`UPDATE mensajes SET texto = ? WHERE rol = 'operador'`).run('o'.repeat(9000))
  _probarResumen(async () => { throw new Error('modelo caído') })
  const h = await armarHistorial(db, mensajes(db, cid), { cid })
  assert.ok(pesoTotal(h) <= TOPE_DURO, `${pesoTotal(h)}`)
  assert.equal(h.filter((m) => m.role === 'user').at(-1)!.content, 'o'.repeat(9000))
  assert.ok(!h.some((m) => m.role === 'system'))
  let resumio = false
  _probarResumen(async () => { resumio = true; return 'x' })
  await armarHistorial(db, mensajes(db, cid), { cid: null, resumirViejo: false })
  assert.equal(resumio, false, 'el diario solo elide')
})

test('historial: una llamada sin respuesta (turno cortado) no rompe la API', async () => {
  const { db, cid } = conversacion(2, 100)
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, llamadas, en) VALUES (?, 'asistente', '', ?, 9)`).run(cid, JSON.stringify([{ id: 'colgada', nombre: 'x', argumentos: '{}' }]))
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, llamada_id, herramienta, en) VALUES (?, 'herramienta', 'huérfana', 'nadie', 'x', 9)`).run(cid)
  const h = await armarHistorial(db, mensajes(db, cid), { cid })
  const pedidos = new Set(h.flatMap((m) => (Array.isArray(m.tool_calls) ? m.tool_calls.map((t: any) => t.id) : [])))
  const respuestas = h.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)
  assert.deepEqual([...pedidos].sort(), [...respuestas].sort(), 'cada pedido con su respuesta, y ninguna huérfana')
})

test('chat: con muchos turnos el modelo sigue viendo la primera pregunta del operador', async () => {
  const { db, cid } = conversacion(25, 3000)
  let visto: any[] = []
  _probarModelo(async (_l, o) => { visto = o.mensajes; return { texto: 'ok', llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 } })
  await enviar(db, cid, 'última')
  assert.equal(visto.find((m) => m.role === 'user')?.content, 'pregunta 0')
  assert.equal(visto.at(-1).content, 'última')
})
