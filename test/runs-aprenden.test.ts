import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCalendario } from '../src/calendario.ts'
import { _probarEscriba } from '../src/chat/index.ts'
import { aprenderPesos, fijarPeso, listar, pesos } from '../src/criterios.ts'
import { arrancarRun, marcarSecundaria, misionesDeRun, prepararRun } from '../src/misiones.ts'

process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarEscriba(async () => {})
_probarCalendario(async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR')

test('los criterios con nombre y peso (Fragua #156): suman 100, mover uno reparte el resto, y aprenden de lo que termina', () => {
  const db = abrir(':memory:')
  const p = pesos(db)
  assert.equal(Object.values(p).reduce((s, x) => s + x, 0), 100)
  const l = fijarPeso(db, 'urgencia', 40)
  assert.equal(l.find((c) => c.clave === 'urgencia')!.peso, 40)
  assert.equal(l.reduce((s, c) => s + c.peso, 0), 100, 'los demás se reparten el resto')
  assert.throws(() => fijarPeso(db, 'caprichos', 10), /desconocido/)
  // Lo que empuja «ganas» nunca se termina; lo de «impacto», siempre.
  const ins = db.prepare(`INSERT INTO misiones (personaje, asignada_por, nivel, titulo, estado, progreso, orden, creada_por, creada_en, criterio) VALUES ('jugador', 'mastropiero', 'secundaria', ?, ?, 0, 0, 'mastropiero', ?, ?)`)
  const T = Date.now()
  for (let i = 0; i < 5; i++) { ins.run(`g${i}`, 'no', T, 'ganas'); ins.run(`i${i}`, 'hecha', T, 'impacto') }
  const antes = pesos(db)
  const notas = aprenderPesos(db, T)
  const despues = pesos(db)
  assert.ok(despues.ganas < antes.ganas, 'El Entusiasta baja')
  assert.ok(despues.impacto > antes.impacto, 'El Ambicioso sube')
  assert.ok(notas.some((n) => /El Ambicioso subió de \d+ % a \d+ %: lo que empuja lo terminás 10 de cada 10 veces/.test(n)), notas.join(' | '))
  assert.deepEqual(aprenderPesos(db, T + 86_400_000), [], 'una vez por semana')
  assert.equal(listar(db).find((c) => c.clave === 'ganas')!.cumple, 0)
})

test('la corrida encadenada (Fragua #155): la run anterior se cierra y lo que quedó entra primero; cada banda dice su criterio', async () => {
  const db = abrir(':memory:')
  const usuarios: string[] = []
  let n = 0
  _probarModelo(async (_l, o) => {
    const s = String(o.mensajes[0].content)
    usuarios.push(String(o.mensajes[1]?.content ?? ''))
    if (s.includes('armás una run')) {
      n++
      return { texto: JSON.stringify({ resumen: 'Vamos.', misiones: [{ titulo: n === 1 ? 'Escribir el mail a Ana' : 'Terminar el mail a Ana', detalle: 'x', minutos: 25, primaria: null, categoria: 'comunicacion', criterio: 'urgencia' }, { titulo: n === 1 ? 'Revisar la escena 7' : 'Leer el contrato', detalle: 'x', minutos: 25, primaria: null, categoria: 'escritura', criterio: 'ganas' }] }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }
    }
    return { texto: '{}', llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }
  })
  const ayer = new Date(2026, 10, 8, 10, 0).getTime()
  const r1 = await prepararRun(db, { inicio: '10:00', fin: '11:00' }, { ahora: ayer })
  const ms1 = misionesDeRun(db, r1.run.id)
  assert.deepEqual(ms1.map((m: any) => (db.prepare('SELECT criterio FROM misiones WHERE id = ?').get(m.id) as any).criterio), ['urgencia', 'ganas'], 'cada banda guarda el criterio que la empujó')
  assert.match(usuarios.find((u) => u.includes('Los criterios con que elegís'))!, /La Urgente \(urgencia: lo que vence pronto o tiene fecha\) · \d+ %/)
  arrancarRun(db, r1.run.id, ayer)
  marcarSecundaria(db, ms1[1].id, 'hecha', null, ayer + 30 * 60_000)
  marcarSecundaria(db, ms1[0].id, 'no', 'No me dio el tiempo', ayer + 40 * 60_000)

  const hoy = new Date(2026, 10, 9, 9, 0).getTime()
  const r2 = await prepararRun(db, { inicio: '09:30', fin: '10:30' }, { ahora: hoy })
  assert.equal((db.prepare('SELECT estado FROM runs WHERE id = ?').get(r1.run.id) as any).estado, 'cerrada', 'la de ayer se cerró sola')
  assert.equal((db.prepare('SELECT viene_de FROM runs WHERE id = ?').get(r2.run.id) as any).viene_de, r1.run.id)
  assert.ok(r2.avisos.some((a) => /Viene de la run del 2026-11-08: 1 pendiente para retomar/.test(a)), r2.avisos.join(' | '))
  const pedido = usuarios.filter((u) => u.includes('Los criterios con que elegís')).at(-1)!
  assert.match(pedido, /Lo que quedó de la run anterior \(2026-11-08, 1 de 2 hechas\):\n- Escribir el mail a Ana \[no se hizo\] — dijo: No me dio el tiempo/)
})
