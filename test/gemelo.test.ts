import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCalendario } from '../src/calendario.ts'
import { crearConversacion } from '../src/chat/index.ts'
import { actualizarMision, arrancarRun, crearMision, marcarSecundaria, misionesDeRun, prepararRun } from '../src/misiones.ts'
import { anotarPrediccion, brier, calificarAMano, calificarDia, conocimiento, curva, paraElJugador, predecirDia, prediccionesDe, sumarPredicciones } from '../src/gemelo.ts'

process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarCalendario(async () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR')
const T = new Date(2026, 9, 7, 8, 20).getTime()

test('Brier y «te conozco»: 0 es perfecto, 0,25 es una moneda', () => {
  assert.equal(brier([{ probabilidad: 1, resultado: 1 }, { probabilidad: 0, resultado: 0 }]), 0)
  assert.equal(brier([{ probabilidad: 0.5, resultado: 1 }]), 0.25)
  assert.equal(conocimiento(0), 100)
  assert.equal(conocimiento(0.25), 0)
  assert.equal(conocimiento(0.4), 0, 'peor que una moneda no da negativo')
  assert.equal(brier([{ probabilidad: 0.7, resultado: null }]), null)
})

test('el gemelo predice (sellado), se califica solo con datos y con evidencia, y lo dudoso queda para él', async () => {
  const db = abrir(':memory:')
  const p = crearMision(db, { nivel: 'primaria', titulo: 'Escribir el reglamento', estado: 'activa' }, { ahora: T })
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    if (s.includes('SUMÁS')) return { texto: JSON.stringify({ predicciones: [
      { texto: 'Va a escribirle a Federico', probabilidad: 0.4, tipo: 'charla', criterio: null },
      { texto: 'Va a hacer al menos 2 bandas', probabilidad: 0.5, tipo: 'bandas', criterio: null },
    ] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    if (s.includes('gemelo predictivo')) return { texto: JSON.stringify({ predicciones: [
      { texto: 'Va a hacer al menos 2 bandas', probabilidad: 0.8, tipo: 'bandas', criterio: { tipo: 'bandas_hechas', op: '>=', valor: 2 } },
      { texto: 'Va a mover el reglamento', probabilidad: 0.6, tipo: 'primaria', criterio: { tipo: 'primaria_avanza', primaria: 'Escribir el reglamento' } },
      { texto: 'Te va a hablar de Ana', probabilidad: 0.3, tipo: 'charla', criterio: { tipo: 'habla_de', texto: 'Ana' } },
      { texto: 'Va a prender el Directo', probabilidad: 0.2, tipo: 'directo', criterio: { tipo: 'directo_prendido', valor: true } },
      { texto: 'Va a terminar el día cansado', probabilidad: 0.7, tipo: 'energia', criterio: null },
      { texto: 'Va a soñar con dragones', probabilidad: 1.4, tipo: 'otro', criterio: { tipo: 'inventado' } },
    ] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    if (s.includes('calificás tus predicciones')) {
      const ids = [...String(o.mensajes.at(-1)!.content).matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
      return { texto: JSON.stringify({ calificaciones: [{ id: ids[0], resultado: 1, nota: 'dijo que estaba muerto' }, { id: ids[1], resultado: null, nota: 'no hay evidencia' }], aprendizajes: ['Suele terminar los días cansado'] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
    }
    return { texto: JSON.stringify({ resumen: 'ok', misiones: [{ titulo: 'A', minutos: 12, primaria: 1 }, { titulo: 'B', minutos: 12, primaria: 1 }, { titulo: 'C', minutos: 12 }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  const ps = await predecirDia(db, '2026-10-07', T)
  assert.equal(ps.length, 6)
  assert.equal(ps[5].probabilidad, 0.97, 'la probabilidad se acota')
  assert.equal(ps[5].criterio, null, 'un criterio inventado no vale')
  assert.equal((await predecirDia(db, '2026-10-07', T)).length, 6, 'no repite')

  // El día: una run con 2 bandas hechas del reglamento; habla de Ana; sin Directo.
  const { run } = await prepararRun(db, {}, { ahora: new Date(2026, 9, 7, 9).getTime() })
  arrancarRun(db, run.id, new Date(2026, 9, 7, 9).getTime())
  const bs = misionesDeRun(db, run.id)
  marcarSecundaria(db, bs[0].id, 'hecha')
  marcarSecundaria(db, bs[1].id, 'hecha')
  const c = crearConversacion(db, 'mastropiero', 'chat', T)
  db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, 'operador', 'hablé con Ana del arte', ?)`).run(c.id, new Date(2026, 9, 7, 12).getTime())
  actualizarMision(db, p.id, { progreso: 20 })

  const r = await calificarDia(db, '2026-10-07', { ahora: new Date(2026, 9, 7, 23, 40).getTime() })
  const por = Object.fromEntries(r.predicciones.map((x) => [x.texto, x]))
  assert.equal(por['Va a hacer al menos 2 bandas'].resultado, 1)
  assert.equal(por['Va a mover el reglamento'].resultado, 1)
  assert.equal(por['Te va a hablar de Ana'].resultado, 1)
  assert.equal(por['Va a prender el Directo'].resultado, 0)
  assert.equal(por['Va a terminar el día cansado'].calificadaPor, 'mastropiero')
  assert.equal(por['Va a soñar con dragones'].estado, 'para_el_jugador')
  assert.equal(paraElJugador(db, 14, '2026-10-07').some((x) => x.id === por['Va a soñar con dragones'].id), true)
  calificarAMano(db, por['Va a soñar con dragones'].id, false)
  assert.equal(prediccionesDe(db, '2026-10-07').filter((x) => x.resultado == null).length, 0)
  const cv = curva(db, '2026-10-07', 3)
  assert.equal(cv.calificadas, 6)
  assert.equal(cv.total, 0, 'el 97% a los dragones lo hunde: peor que una moneda')
  assert.ok(Math.abs(cv.puntos.at(-1)!.brier! - 0.2935) < 0.001)
  assert.ok(db.prepare(`SELECT 1 FROM memoria WHERE texto LIKE 'Suele terminar%'`).get(), 'lo aprendido va a la memoria')

  const sumadas = await sumarPredicciones(db, '2026-10-07', 'hoy escribe', T)
  assert.equal(sumadas.length, 7, 'suma la nueva y no repite la de las bandas')
  assert.ok(sumadas.some((x) => x.texto === 'Va a escribirle a Federico'))
  const mia = anotarPrediccion(db, '2026-10-07', 'Va a mandar el presupuesto', 0.66, T)
  assert.equal(mia.tipo, 'jugador')
  assert.equal(mia.probabilidad, 0.66)
  const conNota = calificarAMano(db, mia.id, null, 'Lo mandó a la tarde, con un anexo')
  assert.equal(conNota.resultado, null)
  assert.equal(conNota.estado, 'abierta')
  assert.match(conNota.nota ?? '', /anexo/)
  assert.ok(db.prepare(`SELECT 1 FROM memoria WHERE texto LIKE '%anexo%'`).get(), 'la info entra a la memoria')
  assert.equal(calificarAMano(db, mia.id, true).resultado, 1)
})
