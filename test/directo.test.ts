import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { listarPiezas } from '../src/corpus.ts'
import { listarMisiones, anotarSideQuest } from '../src/misiones.ts'
import { conexionesDe, listarEntidades } from '../src/entidades.ts'
import { memoriaVigente } from '../src/memoria.ts'
import {
  _probarDirecto, avisoDeCierre, cerrarDirecto, directoParaPrompt, esRuido, iniciarDirecto, latidoDirecto, metricas, momentos, propuestasPendientes, registrarAudio, registrarCuadro, resolverPropuestas, sesionActiva,
} from '../src/directo.ts'

const T = new Date(2026, 9, 7, 10).getTime()
const min = (n: number) => T + n * 60_000
const img = Buffer.from('cuadro')
const audio = Buffer.alloc(5000, 1)

test('Directo: anota lo que ve (estirando lo que no cambia), transcribe voz y medio, y filtra el ruido', async () => {
  const db = abrir(':memory:')
  const vistas = [
    { app: 'VS Code', actividad: 'programando', tema: 'Deprocast', detalle: 'misiones.ts', nota: '' },
    { app: 'VS Code', actividad: 'programando', tema: 'Deprocast', detalle: 'misiones.ts', nota: 'arregló un test' },
    { app: 'YouTube', actividad: 'mirando video', tema: 'diseño de juegos', detalle: 'Cómo diseñar juegos de mesa', nota: '' },
  ]
  const oidos = ['Tengo que llamar a Ana mañana por el presupuesto.', 'El buen diseño empieza por la mecánica central.', 'Subtítulos realizados por la comunidad de Amara.org']
  _probarDirecto({ vision: async () => vistas.shift(), transcribir: async () => oidos.shift() ?? '' })
  const s = iniciarDirecto(db, ['pantalla', 'voz', 'medio'], T)
  assert.equal(iniciarDirecto(db, [], T + 1).id, s.id, 'uno solo a la vez')
  await registrarCuadro(db, s.id, img, 'image/jpeg', min(0))
  await registrarCuadro(db, s.id, img, 'image/jpeg', min(5))
  await registrarAudio(db, s.id, audio, 'voz', 'voz.webm', { desde: min(11), ahora: min(12) })
  await registrarCuadro(db, s.id, img, 'image/jpeg', min(20))
  await registrarAudio(db, s.id, audio, 'medio', 'medio.webm', { desde: min(21), ahora: min(22) })
  assert.equal(await registrarAudio(db, s.id, audio, 'voz', 'voz.webm', { ahora: min(23) }), null, 'la alucinación de Whisper no entra')
  assert.equal(await registrarAudio(db, s.id, Buffer.alloc(100), 'voz', 'voz.webm', { ahora: min(23) }), null, 'un tramo vacío no se transcribe')

  const ms = momentos(db, s.id)
  assert.deepEqual(ms.map((m) => m.tipo), ['pantalla', 'voz', 'pantalla', 'medio'])
  assert.equal(ms[0].hasta, min(5), 'el mismo archivo estira el momento')
  assert.equal(ms[0].nota, 'arregló un test')
  assert.equal(ms[3].detalle, 'Cómo diseñar juegos de mesa', 'lo que escucha se ata a lo que se ve')
  const met = metricas(ms)
  assert.equal(met.minutosPorActividad.programando, 20)
  assert.equal(met.consumido[0].titulo, 'Cómo diseñar juegos de mesa')
  assert.match(directoParaPrompt(db), /YouTube · mirando video · Cómo diseñar juegos de mesa[\s\S]*llamar a Ana/)

  const quest = anotarSideQuest(db, { titulo: 'Revisar el mail de Namecheap' }, T)
  _probarModelo(async () => ({
    texto: JSON.stringify({
      texto: 'Programaste 20 minutos y después miraste un video sobre diseño de juegos.', ideas: ['El diseño empieza por la mecánica central'],
      tareas: ['Llamar a Ana por el presupuesto'], cumplidas: [quest.id],
      entidades: [{ nombre: 'Ana', tipo: 'persona', nota: 'el presupuesto', alias: [] }, { nombre: 'Instagram', tipo: 'concepto', nota: 'el feed' }],
      conexiones: [{ de: 'Ana', con: 'Pedro', relacion: 'le pasa el presupuesto', tipoDe: 'persona', tipoCon: 'persona' }],
      consumido: [{ titulo: 'Cómo diseñar juegos de mesa', tipo: 'Video', resumen: 'Mecánicas primero', relacion: 'Corruptopolis' }], bandas: [],
    }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1,
  }))
  const c = await cerrarDirecto(db, s.id, { ahora: min(30), escriba: false })
  assert.equal(c.estado, 'cerrada')
  assert.match(c.informe!, /Programaste 20 minutos/)
  assert.doesNotMatch(c.informe!, /Llamar a Ana/, 'el resumen no repite la bandeja')
  const piezas = () => listarPiezas(db, { limite: 20 }).piezas
  assert.ok(piezas().some((p) => p.nivel === 'propia' && p.etiquetas.includes('voz') && /llamar a Ana/.test(p.contenido)), 'su voz entra como propia')
  assert.equal(piezas().some((p) => p.fuente === 'directo' || p.etiquetas.includes('informe')), false, 'la sugerencia no entra al corpus')
  assert.equal(listarMisiones(db, { nivel: 'terciaria' }).some((m) => /Ana/.test(m.titulo)), false, 'la tarea nueva espera')
  assert.equal(listarMisiones(db, { nivel: 'terciaria' }).find((m) => m.id === quest.id)?.estado, 'activa')
  const props = (c.resumen as { propuestas: { id: string; tipo: string; titulo: string; estado: string }[] }).propuestas
  assert.equal(props.find((p) => p.tipo === 'tarea')?.titulo, 'Llamar a Ana por el presupuesto')
  assert.equal(props.some((p) => p.titulo === 'Instagram'), false, 'una app genérica no se propone')
  assert.match(avisoDeCierre(c), /No las metí al corpus/)
  assert.equal(propuestasPendientes(db), props.filter((p) => p.estado === 'pendiente').length)

  const idDe = (tipo: string) => props.find((p) => p.tipo === tipo)!.id
  resolverPropuestas(db, s.id, [idDe('medio')], 'rechazar')
  assert.equal(piezas().some((p) => p.fuente === 'directo'), false)
  const r = resolverPropuestas(db, s.id, [idDe('tarea'), idDe('entidad'), idDe('conexion'), idDe('cumplida'), idDe('idea')], 'aceptar')
  assert.equal(r.propuestas.length, 5)
  assert.equal(listarMisiones(db, { nivel: 'terciaria' }).find((m) => /Ana/.test(m.titulo))?.estado, 'activa')
  assert.equal(listarMisiones(db, { nivel: 'terciaria' }).find((m) => m.id === quest.id)?.estado, 'hecha')
  const ana = listarEntidades(db, { q: 'Ana' }).find((e) => e.nombre === 'Ana')
  assert.equal(ana?.tipo, 'persona')
  assert.ok(conexionesDe(db, ana!.id).some((x) => x.nombre === 'Pedro' && /presupuesto/.test(x.relacion ?? '')))
  assert.ok(memoriaVigente(db).some((m) => /mecánica central/.test(m.texto) && m.revisada))
  assert.equal(piezas().some((p) => p.fuente === 'directo'), false, 'lo rechazado no entra')
  assert.equal(propuestasPendientes(db), 0)
  await assert.rejects(registrarCuadro(db, s.id, img), /ya se cerró/)
  assert.equal(directoParaPrompt(db), '')
})

test('Directo: si la pestaña se cerró sin apagarlo, a los 10 minutos se cierra solo', async () => {
  const db = abrir(':memory:')
  const s = iniciarDirecto(db, ['voz'], T)
  assert.equal(await latidoDirecto(db, min(5)), null)
  const c = await latidoDirecto(db, min(11))
  assert.equal(c?.id, s.id)
  assert.equal(sesionActiva(db), null)
  assert.ok(esRuido('¡Gracias por ver el video!'))
  assert.ok(!esRuido('Hoy avancé con el reglamento'))
})
