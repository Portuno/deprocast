import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abrir } from '../src/db.ts'

process.env.NAN_API_KEY = ''
const { _probarModelo } = await import('../src/modelo.ts')
const { _probarEscriba, conversacionHoy, mensajes } = await import('../src/chat/index.ts')
const p = await import('../src/programados.ts')
_probarEscriba(async () => [])

describe('encargos programados (plan v35, fase 7)', () => {
  it('el cuándo en castellano', () => {
    const casos: [string, string][] = [
      ['todos los días a las 8', 'todos los días a las 08:00'],
      ['los lunes y jueves 9:30', 'los lunes y jueves a las 09:30'],
      ['de lunes a viernes a las 8:30', 'de lunes a viernes a las 08:30'],
      ['cada 6 horas', 'cada 6 horas'],
      ['el 1 de cada mes a las 10', 'el 1 de cada mes a las 10:00'],
      ['todas las noches', 'todos los días a las 21:00'],
      ['los viernes a las 6 de la tarde', 'los viernes a las 18:00'],
      ['los domingos 20 hs', 'los domingos a las 20:00'],
    ]
    for (const [t, d] of casos) assert.equal(p.describirCuando(p.interpretarCuando(t)), d, t)
    assert.throws(() => p.interpretarCuando('cuando pinte'), /No entendí cuándo/)
    assert.throws(() => p.interpretarCuando('el 31 de cada mes'), /entre 1 y 28/)
  })

  it('la próxima vez', () => {
    const mie = new Date(2026, 10, 4, 10, 0).getTime() // miércoles 4/11, 10:00
    const ver = (t: string) => new Date(p.proximoDe(p.interpretarCuando(t), mie)).toString().slice(0, 21)
    assert.equal(ver('todos los días a las 8'), new Date(2026, 10, 5, 8, 0).toString().slice(0, 21), 'las 8 de hoy ya pasaron: mañana')
    assert.equal(ver('todos los días a las 18'), new Date(2026, 10, 4, 18, 0).toString().slice(0, 21), 'hoy más tarde')
    assert.equal(ver('los lunes a las 9'), new Date(2026, 10, 9, 9, 0).toString().slice(0, 21))
    assert.equal(ver('el 1 de cada mes a las 10'), new Date(2026, 11, 1, 10, 0).toString().slice(0, 21))
    assert.equal(p.proximoDe(p.interpretarCuando('cada 6 horas'), mie), mie + 6 * 3_600_000)
  })

  it('corre solo: hace el pedido con Mastropiero, guarda el informe, lo deja en Hoy y agenda el próximo', async () => {
    const db = abrir(':memory:')
    const T = new Date(2026, 10, 4, 8, 0).getTime()
    const pedidos: string[] = []
    _probarModelo(async (_l: any, o: any) => {
      pedidos.push(String(o.mensajes.at(-1).content))
      return { texto: 'Esta semana salieron tres cosas sobre el tema: …', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    })
    const e = p.crearProgramado(db, { pedido: 'Revisá qué salió esta semana sobre el tema y resumímelo', cuando: 'todos los días a las 9', titulo: 'Resumen del tema' }, T)
    assert.equal(e.proximo, new Date(2026, 10, 4, 9, 0).getTime())
    assert.equal(await p.latidoProgramados(db, T + 30 * 60_000), 0, 'todavía no toca')
    assert.equal(await p.latidoProgramados(db, T + 61 * 60_000), 1)
    const x = p.leerProgramado(db, e.id)!
    assert.match(x.resultado ?? '', /tres cosas/)
    assert.equal(x.proximo, new Date(2026, 10, 5, 9, 0).getTime(), 'el próximo, mañana')
    assert.match(pedidos[0], /Revisá qué salió/)
    const hoy = mensajes(db, conversacionHoy(db).id).filter((m) => m.rol === 'asistente').map((m) => m.texto).join('\n')
    assert.match(hoy, /⏰ Resumen del tema/)
    const conv = db.prepare('SELECT archivada, titulo FROM conversaciones WHERE id = ?').get(x.conversacionId) as { archivada: number; titulo: string }
    assert.equal(conv.archivada, 1, 'su conversación propia, archivada')
    const memoria = db.prepare(`SELECT COUNT(*) AS n FROM memoria`).get() as { n: number } | undefined
    assert.equal(memoria?.n ?? 0, 0, 'el pedido del encargo no va a la memoria')

    // En pausa no corre; reanudado, vuelve a tener próximo.
    p.cambiarProgramado(db, e.id, { activo: false })
    assert.equal(p.leerProgramado(db, e.id)!.proximo, null)
    assert.equal(await p.latidoProgramados(db, T + 2 * 86_400_000), 0)
    p.cambiarProgramado(db, e.id, { activo: true }, T + 2 * 86_400_000)
    assert.ok(p.leerProgramado(db, e.id)!.proximo! > T + 2 * 86_400_000)
  })
})
