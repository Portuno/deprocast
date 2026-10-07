import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCalendario } from '../src/calendario.ts'
import { _probarEscriba, promptMastropiero } from '../src/chat/index.ts'
import { marcarJugador } from '../src/personajes.ts'
import { forjar } from '../src/roster.ts'
import { asignarMision, crearMision, prepararRun } from '../src/misiones.ts'
import { menciones, sinArrobas } from '../src/menciones.ts'

process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarEscriba(async () => {})
_probarCalendario(async () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR')

test('@menciones: el nombre (o alias) más largo gana, sin tildes ni mayúsculas; un mail no es mención', () => {
  const db = abrir(':memory:')
  const red = asegurarEntidad(db, { tipo: 'agrupacion', nombre: 'Red Valencia', alias: ['La Red'] })
  const corto = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Red' })
  const libro = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Corrupción Total' })
  const f = forjar(db, { clase: 'generativo', motor: 'local' })
  const ms = menciones(db, `Hoy tema @corrupcion total y @red valencia, con @Red y @${f.id}. Escribime a ana@red.com`)
  assert.deepEqual(ms.map((m) => m.clave), [`entidad:${libro}`, `entidad:${red}`, `entidad:${corto}`, `agente:${f.id}`])
  assert.equal(ms[1].texto, '@red valencia')
  assert.equal(menciones(db, 'Hablé con @la red').map((m) => m.entidadId)[0], red)
  assert.equal(sinArrobas('Avanzar @Red Valencia ya', menciones(db, 'Avanzar @Red Valencia ya')), 'Avanzar Red Valencia ya')
  assert.deepEqual(menciones(db, 'sin arroba'), [])
})

test('@menciones en acción: el chat sabe de quién hablás, la misión se vincula y la run lo incluye', async () => {
  const db = abrir(':memory:')
  const yo = asegurarEntidad(db, { tipo: 'persona', nombre: 'Juan Prueba' })
  marcarJugador(db, yo)
  const proy = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Corrupción Total', notas: 'Un juego de mesa sobre política.' })
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Gómez' })

  assert.match(promptMastropiero(db, 'Hoy tema @Corrupción Total'), /Te nombró con @[\s\S]*Corrupción Total \(proyecto, entidad \d+\)[\s\S]*juego de mesa/)
  assert.doesNotMatch(promptMastropiero(db, 'Hoy tema corrupción'), /Te nombró con @/)

  const m = crearMision(db, { nivel: 'primaria', titulo: 'Cerrar el reglamento de @Corrupción Total', estado: 'activa' })
  assert.equal(m.titulo, 'Cerrar el reglamento de Corrupción Total')
  assert.equal(m.entidadId, proy)
  assert.equal(asignarMision(db, { a: '@Ana Gómez', titulo: 'Mandar el arte' }).personaje, `entidad:${ana}`)

  const vistos: string[] = []
  _probarModelo(async (_l, o) => {
    vistos.push(String(o.mensajes.at(-1)!.content))
    return { texto: JSON.stringify({ resumen: 'ok', misiones: [{ titulo: 'Algo', minutos: 12 }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  const { run } = await prepararRun(db, { plantilla: 'Mañana oficina' }, { ahora: new Date(2026, 9, 7, 9).getTime() })
  assert.equal(run.pedido.incluir.length, 0)
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    vistos.push(String(o.mensajes.at(-1)!.content))
    return { texto: JSON.stringify(s.includes('interpretás') ? {} : { resumen: 'ok', misiones: [{ titulo: 'Algo', minutos: 12 }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  const con = await prepararRun(db, { texto: 'una hora con @Corrupción Total' }, { ahora: new Date(2026, 9, 7, 10).getTime() })
  assert.deepEqual(con.run.pedido.incluir.map((e) => e.id), [proy])
  assert.match(vistos.at(-1)!, /• Corrupción Total \(proyecto\)/)
})

test('duplicados: mismo nombre o alias cruzado; «no son lo mismo» y sacar alias mal puestos', async () => {
  const { duplicadosProbables, noSonLoMismo, quitarAliasCruzados } = await import('../src/entidades.ts')
  const db = abrir(':memory:')
  const v1 = asegurarEntidad(db, { tipo: 'lugar', nombre: 'Valencia', alias: ['València'] })
  const v2 = asegurarEntidad(db, { tipo: 'lugar', nombre: 'València' })
  const camila = asegurarEntidad(db, { tipo: 'persona', nombre: 'Camila', alias: ['España'] })
  const espana = asegurarEntidad(db, { tipo: 'lugar', nombre: 'España' })
  const gs = duplicadosProbables(db)
  assert.equal(gs.length, 2)
  assert.deepEqual(gs.find((g) => g.entidades.some((e) => e.id === v1))!.entidades.map((e) => e.id).sort(), [v1, v2].sort())
  assert.equal(quitarAliasCruzados(db, [camila, espana]), 1)
  noSonLoMismo(db, [v1, v2])
  assert.equal(duplicadosProbables(db).length, 0)
})
