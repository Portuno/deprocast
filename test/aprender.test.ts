import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { importarPlan } from '../src/cargas/cien-dias.ts'
import { cienParaPrompt, diaDelPlan, habitoEnSemana, intensidad, mapaDelPlan, marcarHabito, votar } from '../src/cien.ts'
import { _probarRepaso, listarAprendizajes, prepararRepaso, registrarPractica, aprenderParaPrompt } from '../src/aprender.ts'
import { responderPregunta, siguientePregunta, _probarEscribaPreguntas } from '../src/preguntas.ts'
import { _probarCaptura, clasificar, registrarCaptura } from '../src/captura.ts'
import { listarMisiones, leerMision } from '../src/misiones.ts'
import { listarSalud } from '../src/salud.ts'
import { _probarTelegram, procesarActualizacion, mandarVotoNoche } from '../src/telegram.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarEscriba } from '../src/chat/index.ts'

_probarEscriba(async () => {})
_probarEscribaPreguntas(async () => [])

const PLAN = { id: 'plan-prueba', nombre: 'Plan de prueba', desde: '2026-09-23', hasta: '2026-12-31', semana0: '2026-09-21' }
const EXPORT = {
  fronts: { f1: { name: 'La obra', short: 'Obra', win: 'Terminada y mostrada', order: 1 }, f2: { name: 'Cuerpo', short: 'Cuerpo', win: 'Entrenar 4 días', order: 2 } },
  habits: {
    entreno: { title: 'Entrenar', front: 'f2', perWeek: 4, days: [2, 3, 4, 5], order: 1 },
    gastos: { title: 'Anotar gastos del día', front: 'f1', perWeek: 7, days: [], order: 2 },
    idiomas: { title: 'Idiomas: FR · ZH (12 min c/u)', front: 'r', perWeek: 7, days: [], order: 3 },
    voto: { title: 'Voto de los seis verbos', front: 'r', perWeek: 7, days: [], order: 4 },
    woop: { title: 'WOOP caminando (5 min)', front: 'r', perWeek: 7, days: [], order: 5 },
  },
  weeks: { w03: { focus: 'Cerrar el primer acto.' } },
  days: { '2026-10-04': { peso: 90, nota: 'Arranque', verbs: { trabajo: true } } },
  tasks: {
    t1: { title: 'Fijar fecha de la muestra', front: 'f1', date: '2026-10-14', kind: 'hito', required: true, status: 'pendiente', dateStatus: 'sugerida', note: 'Reservar el lugar.' },
    t2: { title: 'Inventario de lo que falta', front: 'f1', date: '2026-10-01', kind: 'tarea', required: true, status: 'hecha', dateStatus: 'sugerida' },
    t3: { title: 'Pedir cita para los análisis', front: 'f2', date: '2026-10-05', kind: 'tarea', required: true, status: 'pendiente', dateStatus: 'sugerida' },
    t4: { title: 'Algo descartado', front: 'f2', date: '2026-10-06', kind: 'tarea', required: false, status: 'descartada' },
  },
}

test('cien días: el plan se importa (frentes, hábitos, semanas, días, tareas como side quests) y se puede reimportar sin duplicar', () => {
  const db = abrir(':memory:')
  const T = new Date(2026, 9, 14, 9).getTime()
  const n = importarPlan(db, PLAN, EXPORT, T)
  assert.deepEqual([n.frentes, n.habitos, n.semanas, n.dias, n.tareasNuevas, n.pesos, n.aprendizajes], [2, 5, 1, 1, 4, 1, 2])
  assert.deepEqual(listarAprendizajes(db).map((a) => a.tema), ['Francés', 'Chino mandarín'], 'lo que ya practica como hábito queda como algo que aprende')
  assert.equal(listarSalud(db, { tipo: 'medida' })[0].datos.peso, 90, 'el peso va también a Salud')

  const d = diaDelPlan(db, '2026-10-14')!
  assert.deepEqual([d.n, d.total, d.semana, d.foco], [22, 100, 3, 'Cerrar el primer acto.'])
  assert.deepEqual(d.tareas.map((t) => [t.titulo, t.hito, t.obligatoria, t.categoria]), [['Fijar fecha de la muestra', true, true, 'Obra']])
  assert.deepEqual(d.habitos.filter((h) => h.toca).map((h) => h.id), ['entreno', 'gastos', 'idiomas', 'voto', 'woop'], 'el miércoles toca entrenar')
  const terciarias = listarMisiones(db, { nivel: 'terciaria' })
  assert.equal(terciarias.find((m) => m.titulo === 'Inventario de lo que falta')?.estado, 'hecha')
  assert.equal(terciarias.find((m) => m.titulo === 'Algo descartado')?.estado, 'descartada')

  // Reimportar: actualiza, no duplica, y lo que él cerró acá no se reabre.
  const cita = terciarias.find((m) => m.titulo === 'Pedir cita para los análisis')!
  db.prepare(`UPDATE misiones SET estado = 'hecha' WHERE id = ?`).run(cita.id)
  const otra = importarPlan(db, PLAN, { ...EXPORT, tasks: { ...EXPORT.tasks, t1: { ...EXPORT.tasks.t1, date: '2026-10-16' } } }, T)
  assert.deepEqual([otra.tareasNuevas, otra.tareasActualizadas], [0, 4])
  assert.equal(listarMisiones(db, { nivel: 'terciaria' }).length, 4)
  assert.equal(leerMision(db, cita.id)!.estado, 'hecha')
  assert.equal(diaDelPlan(db, '2026-10-16')!.tareas[0].titulo, 'Fijar fecha de la muestra')
  assert.ok(diaDelPlan(db, '2026-10-14')!.dia.verbos.trabajo === undefined, 'otro día, nada votado')
})

test('cien días: votar, hábitos por semana, intensidad, mapa y prompt', () => {
  const db = abrir(':memory:')
  importarPlan(db, PLAN, EXPORT)
  votar(db, '2026-10-14', 'trabajo')
  votar(db, '2026-10-14', 'entreno')
  votar(db, '2026-10-14', 'entreno') // se da vuelta
  marcarHabito(db, '2026-10-13', 'entreno', true)
  marcarHabito(db, '2026-10-14', 'entreno', true)
  marcarHabito(db, '2026-10-14', 'gastos', true)
  assert.throws(() => votar(db, '2026-10-14', 'dormir'), /seis verbos/)
  const d = diaDelPlan(db, '2026-10-14')!
  assert.deepEqual(d.dia.verbos, { trabajo: true, entreno: false })
  assert.ok(d.dia.habitos.voto, 'votar marca el hábito del voto')
  assert.equal(habitoEnSemana(db, 'entreno', '2026-10-14'), 2)
  assert.equal(intensidad(d.dia), 2, '1 verbo + 3 hábitos = 4 → 2')
  const mapa = mapaDelPlan(db, d.plan)
  assert.equal(mapa.length, 100)
  assert.equal(mapa.find((c) => c.fecha === '2026-10-14')!.intensidad, 2)
  assert.ok(mapa.find((c) => c.fecha === '2026-10-14')!.hito)
  assert.match(cienParaPrompt(db, new Date(2026, 9, 14, 9).getTime()), /día 22 de 100 \(semana 3, foco: Cerrar el primer acto\.\)[\s\S]*Obligatorias atrasadas: Pedir cita para los análisis \(vencía lun 5\/10/)
})

test('aprender: práctica, racha y repaso espaciado (1, 3, 7, 16 días; salteado vuelve mañana)', async () => {
  const db = abrir(':memory:')
  const T = new Date(2026, 9, 14, 9).getTime()
  const dia = 86_400_000
  registrarPractica(db, { tema: 'Francés', minutos: 15, que: 'pronunciación', fecha: '2026-10-12' }, T)
  registrarPractica(db, { tema: 'francés', minutos: 20, que: 'pasado compuesto', fecha: '2026-10-13' }, T)
  const { practica, aprendizaje } = registrarPractica(db, { tema: 'FRANCES', minutos: 30, que: 'verbos en pasado' }, T)
  const [fr] = listarAprendizajes(db, {}, T)
  assert.deepEqual([fr.tema, fr.practicas, fr.minutos, fr.racha], ['Francés', 3, 65, 3], 'el mismo tema aunque cambie la forma de escribirlo')
  assert.match(aprenderParaPrompt(db, T), /Francés — 65 min esta semana, racha 3/)

  _probarRepaso(async () => ({ preguntas: ['¿Cómo se dice «fui» en francés?', '¿Qué auxiliar lleva «aller» en pasado compuesto?', 'una tercera que sobra'] }))
  const ids = await prepararRepaso(db, aprendizaje, practica, T)
  assert.equal(ids.length, 2, '30 minutos o más: dos preguntas')
  assert.equal(siguientePregunta(db, T), null, 'hoy no: vuelve mañana')
  const p = siguientePregunta(db, T + dia)!
  assert.equal(p.texto, '¿Cómo se dice «fui» en francés?')
  await responderPregunta(db, p.id, 'je suis allé', T + dia)
  const vuelta = db.prepare('SELECT estado, vuelve_en, repaso FROM preguntas WHERE id = ?').get(p.id) as any
  assert.deepEqual([vuelta.estado, vuelta.repaso, (vuelta.vuelve_en - (T + dia)) / dia], ['pendiente', 1, 3])
  const q = siguientePregunta(db, T + dia)!
  await responderPregunta(db, q.id, null, T + dia)
  const salteada = db.prepare('SELECT repaso, vuelve_en FROM preguntas WHERE id = ?').get(q.id) as any
  assert.deepEqual([salteada.repaso, (salteada.vuelve_en - (T + dia)) / dia], [0, 1], 'salteada: mañana otra vez')
  for (const n of [2, 3, 4]) await responderPregunta(db, p.id, 'ok', T + 10 * dia * n)
  assert.equal((db.prepare('SELECT estado FROM preguntas WHERE id = ?').get(p.id) as any).estado, 'respondida', 'después de la última vuelta, se termina')
})

test('captura: el WOOP dictado, lo que estudió y el ejercicio que marca el hábito', async () => {
  const db = abrir(':memory:')
  importarPlan(db, PLAN, EXPORT)
  const T = new Date(2026, 9, 14, 9).getTime()
  _probarRepaso(async () => ({ preguntas: [] }))
  const respuestas: Record<string, any> = {
    woop: { tipo: 'woop', confianza: 0.9, titulo: 'WOOP', datos: { w: 'Mandar la propuesta', ob: 'Me pongo a pulir', p: 'Si pulo, mando lo que hay' } },
    estudie: { tipo: 'aprendizaje', confianza: 0.9, titulo: 'Francés', datos: { tema: 'Francés', minutos: 12, que: 'los números' } },
    gym: { tipo: 'ejercicio', confianza: 0.95, titulo: 'Gym: piernas', datos: { minutos: 50 } },
  }
  _probarCaptura(async (_db, o) => respuestas[Object.keys(respuestas).find((k) => o.texto.includes(k))!])
  const w = registrarCaptura(db, await clasificar(db, { texto: 'mi woop' }), { ahora: T })!
  assert.match(w.resumen, /WOOP de hoy guardado: «Mandar la propuesta»\. Falta: resultado\./)
  assert.equal(diaDelPlan(db, '2026-10-14')!.dia.woop?.p, 'Si pulo, mando lo que hay')
  assert.ok(diaDelPlan(db, '2026-10-14')!.dia.habitos.woop, 'hacer el WOOP marca su hábito')
  const e = registrarCaptura(db, await clasificar(db, { texto: 'estudie' }), { ahora: T })!
  assert.match(e.resumen, /📚 Francés: 12 min · los números/)
  const g = registrarCaptura(db, await clasificar(db, { texto: 'gym' }), { ahora: T })!
  assert.match(g.resumen, /Marqué «Entrenar»/)
  const d = diaDelPlan(db, '2026-10-14')!
  assert.ok(d.dia.habitos.entreno && d.dia.verbos.entreno, 'el gym marca el hábito y el verbo')
})

test('telegram: el voto de la noche con botones que se prenden y se apagan', async () => {
  const db = abrir(':memory:')
  importarPlan(db, PLAN, EXPORT)
  const enviados: any[] = []
  let n = 100
  _probarTelegram({ pedir: async (metodo, cuerpo) => { const id = ++n; if (/^(sendMessage|editMessageText)$/.test(metodo)) enviados.push({ metodo, id, ...cuerpo }); return { ok: true, result: { message_id: id } } } })
  _probarModelo(async () => ({ texto: 'ok', llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }))
  process.env.TELEGRAM_BOT_TOKEN = 'falso'
  process.env.TELEGRAM_CHAT_ID = '42'
  await mandarVotoNoche(db, '2026-10-14')
  const tarjeta = enviados.at(-1)
  assert.match(tarjeta.text, /Día 22 de 100/)
  const botones = tarjeta.reply_markup.inline_keyboard
  assert.equal(botones[0][0].callback_data, 'v:2026-10-14:estudio')
  assert.ok(botones.some((f: any[]) => f[0].callback_data === 'g:2026-10-14:entreno'))
  await procesarActualizacion(db, { callback_query: { id: 'q', data: 'v:2026-10-14:construyo', message: { chat: { id: 42 }, message_id: tarjeta.id } } })
  await procesarActualizacion(db, { callback_query: { id: 'q', data: 'g:2026-10-14:entreno', message: { chat: { id: 42 }, message_id: tarjeta.id } } })
  const editada = enviados.at(-1)
  assert.equal(editada.metodo, 'editMessageText')
  assert.ok(editada.reply_markup.inline_keyboard[1].some((b: any) => b.text === '✓ Construyo'))
  await procesarActualizacion(db, { callback_query: { id: 'q', data: 'l:2026-10-14', message: { chat: { id: 42 }, message_id: tarjeta.id } } })
  assert.match(enviados.at(-1).text, /Votaste Construyo\. Intensidad del día: ●●○○/)
})
