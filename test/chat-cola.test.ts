import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'

const { abrir } = await import('../src/db.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const { _probarEscriba, conversacionHoy, enviar, estaPensando } = await import('../src/chat/index.ts')

_probarEscriba(async () => {})
const contenidos = (ms: any[]) => ms.map((m) => `${m.role}: ${String(m.content ?? '')}`)

test('Escribir mientras trabaja: el mensaje entra a la próxima vuelta del mismo turno y contesta todo junto', async () => {
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  const llamadas: any[][] = []
  _probarModelo(async (_l: any, o: any) => {
    llamadas.push(o.mensajes)
    if (llamadas.length === 1) {
      // Mientras busca algo, le escribe de nuevo (no se frena ni tira error).
      await enviar(db, cid, 'y de paso fijate lo de mañana')
      return { texto: '', llamadas: [{ id: 'h1', nombre: 'ver_uso', argumentos: '{}' }], razonamiento: null, modelo: 'falso', tokens: 1 } as any
    }
    return { texto: 'Hoy tenés esto, y mañana aquello.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 } as any
  })
  await enviar(db, cid, '¿qué tengo hoy?')
  assert.equal(llamadas.length, 2, 'una sola respuesta: lo nuevo entró al turno en curso')
  const segunda = contenidos(llamadas[1])
  assert.ok(segunda.some((x) => /^system: Mientras trabajabas, te escribió otro mensaje/.test(x)))
  assert.ok(segunda.includes('user: y de paso fijate lo de mañana'))
  const ms = db.prepare(`SELECT rol, texto FROM mensajes WHERE conversacion_id = ? AND rol IN ('operador', 'asistente') AND texto != '' ORDER BY id`).all(cid) as any[]
  assert.deepEqual(ms.map((m) => m.rol), ['operador', 'operador', 'asistente'], 'los dos suyos quedaron guardados en el acto')
  assert.equal(estaPensando(cid), false)
})

test('Escribir mientras ya contesta: al terminar, otra respuesta para todo lo que llegó después (no una por mensaje)', async () => {
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  const llamadas: any[][] = []
  _probarModelo(async (_l: any, o: any) => {
    llamadas.push(o.mensajes)
    if (llamadas.length === 1) {
      await enviar(db, cid, 'ah, y otra cosa')
      await enviar(db, cid, 'y una más')
      return { texto: 'Primera respuesta.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 } as any
    }
    return { texto: 'Las dos cosas juntas.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 } as any
  })
  await enviar(db, cid, 'primero esto')
  assert.equal(llamadas.length, 2, 'cinco mensajes no son cinco respuestas: los dos de después van en una')
  const ultimos = contenidos(llamadas[1]).filter((x) => x.startsWith('user:')).slice(-2)
  assert.deepEqual(ultimos, ['user: ah, y otra cosa', 'user: y una más'])
  const asist = db.prepare(`SELECT texto FROM mensajes WHERE conversacion_id = ? AND rol = 'asistente' ORDER BY id`).all(cid) as any[]
  assert.deepEqual(asist.map((m) => m.texto), ['Primera respuesta.', 'Las dos cosas juntas.'])
  assert.equal(estaPensando(cid), false)
})
