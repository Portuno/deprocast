import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abrir } from '../src/db.ts'
import { M } from '../src/nan.ts'

process.env.NAN_API_KEY = ''
const { _probarModelo } = await import('../src/modelo.ts')
const { _probarEscriba, conversacionHoy, enviar, tipoDeTurno } = await import('../src/chat/index.ts')
const { velocidadChat } = await import('../src/perfil.ts')
_probarEscriba(async () => [])

describe('la velocidad del chat (plan v34, #129)', () => {
  it('el tipo de turno sale de la forma del mensaje', () => {
    for (const t of ['hola', '¡Hola Mastropiero!', 'gracias', 'buenas noches', '¿estás?', '¿qué hora es?', 'ok', 'joya']) assert.equal(tipoDeTurno(t), 'breve', t)
    for (const t of ['dale', 'sí, hacelo', 'el primero', 'no, mejor no', 'de una, mandale']) assert.equal(tipoDeTurno(t), 'confirmacion', t)
    for (const t of ['hola, ¿qué tengo hoy?', 'contame de mis proyectos', 'gracias por lo de ayer, ¿y lo del presupuesto?', 'mirá esto https://x.com', '¿qué día es el cumple de Ana?']) assert.equal(tipoDeTurno(t), 'completo', t)
  })

  it('un saludo: el modelo rápido, sin herramientas, con lo mínimo; queda medido', async () => {
    const db = abrir(':memory:')
    const cid = conversacionHoy(db).id
    const vistos: any[] = []
    _probarModelo(async (l: any, o: any) => {
      vistos.push({ modelos: l.modelos, herramientas: o.herramientas.length, sistema: o.mensajes[0].content as string })
      return { texto: 'Acá estoy, señor.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    })
    await enviar(db, cid, '¿estás?')
    assert.equal(vistos.length, 1)
    assert.deepEqual(vistos[0].modelos, [M.qwen, M.deepseek])
    assert.equal(vistos[0].herramientas, 0)
    assert.match(vistos[0].sistema, /mensaje breve/)
    assert.doesNotMatch(vistos[0].sistema, /Cómo trabajás/, 'sin el expediente entero')

    vistos.length = 0
    await enviar(db, cid, 'contame qué tengo pendiente esta semana con el proyecto del barrio')
    assert.equal(vistos[0].modelos, undefined, 'lo demás, con la cadena de siempre')
    assert.ok(vistos[0].herramientas > 10)
    assert.match(vistos[0].sistema, /Cómo trabajás/)

    const v = velocidadChat(db)
    assert.deepEqual(v.map((x) => x.tipo).sort(), ['breve', 'completo'])
    const breve = v.find((x) => x.tipo === 'breve')!
    assert.equal(breve.turnos, 1)
    assert.equal(breve.vueltas, 1)
    assert.ok('prompt' in breve.etapas_ms && 'primera' in breve.etapas_ms)
  })

  it('un «dale» trae las herramientas de lo que se venía hablando', async () => {
    const db = abrir(':memory:')
    const cid = conversacionHoy(db).id
    const nombres: string[][] = []
    _probarModelo(async (_l: any, o: any) => {
      nombres.push(o.herramientas.map((h: any) => h.function?.name ?? h.name))
      return { texto: 'Listo.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    })
    await enviar(db, cid, '¿me dejás un borrador para contestarle a Ana por mail?')
    await enviar(db, cid, 'dale')
    assert.ok(nombres[1].includes('borrador_mail'), 'el grupo de correo sigue a mano para hacer lo confirmado')
  })
})
