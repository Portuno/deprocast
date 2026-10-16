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

  db.prepare(`UPDATE ajustes SET valor = '0' WHERE clave = 'directo_auto'`).run() // acá todo espera su ok
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
  assert.match(avisoDeCierre(c), /esperan tu ok.$/)
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

test('Directo: si al cerrar falla el informe (sin red), los momentos quedan y el informe se rehace', async () => {
  const { rehacerInforme, informeFallido } = await import('../src/directo.ts')
  const db = abrir(':memory:')
  _probarDirecto({ vision: async () => ({ app: 'VS Code', actividad: 'programando', tema: 'Deprocast', detalle: 'fragua.ts', nota: '' }), transcribir: async () => '' })
  const s = iniciarDirecto(db, ['pantalla'], T)
  await registrarCuadro(db, s.id, img, 'image/jpeg', min(0))
  await registrarCuadro(db, s.id, img, 'image/jpeg', min(10))
  const antes = momentos(db, s.id).length
  _probarModelo(async () => { throw new Error('fetch failed') })
  const c = await cerrarDirecto(db, s.id, { ahora: min(15), escriba: false })
  assert.ok(informeFallido(c))
  await assert.rejects(rehacerInforme(db, s.id), /Tampoco esta vez: fetch failed/)
  _probarModelo(async () => ({ texto: JSON.stringify({ texto: 'Estuviste 15 minutos en la Fragua.', ideas: [], tareas: [], cumplidas: [], entidades: [], conexiones: [], consumido: [], bandas: [] }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }))
  const r = await rehacerInforme(db, s.id)
  assert.equal(r.informe, 'Estuviste 15 minutos en la Fragua.')
  assert.equal(momentos(db, s.id).length, antes, 'los momentos no se tocan')
})

test('Directo por tramos: cada hora su informe y sus propuestas (aceptables sin apagarlo); al cerrar, se integra sin repetir', async () => {
  const { tramoDirecto, tramosDe, propuestasDe } = await import('../src/directo.ts')
  const db = abrir(':memory:')
  _probarDirecto({ vision: async () => ({ app: 'VS Code', actividad: 'programando', tema: 'Deprocast', detalle: 'directo.ts', nota: '' }), transcribir: async () => '' })
  const s = iniciarDirecto(db, ['pantalla'], T)
  await registrarCuadro(db, s.id, img, 'image/jpeg', min(0))
  await registrarCuadro(db, s.id, img, 'image/jpeg', min(50))
  const pedidos: string[] = []
  const responde = (r: Record<string, unknown>) => _probarModelo(async (...a: any[]) => {
    pedidos.push(JSON.stringify(a.slice(1)))
    return { texto: JSON.stringify({ ideas: [], tareas: [], cumplidas: [], entidades: [], conexiones: [], consumido: [], bandas: [], ...r }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }
  })
  responde({ texto: 'La primera hora fue toda del Directo.', tareas: ['Llamar a Ana'] })
  assert.equal(await tramoDirecto(db, min(30)), null, 'antes de la hora no se escribe nada')
  const t1 = await tramoDirecto(db, min(61))
  assert.equal(t1?.texto, 'La primera hora fue toda del Directo.')
  assert.equal(await tramoDirecto(db, min(62)), null, 'la hora siguiente empieza donde terminó esta')
  const viva = sesionActiva(db)!
  const [ana] = propuestasDe(viva)
  assert.equal(ana.id, 't1p1')
  resolverPropuestas(db, s.id, [ana.id], 'aceptar', min(63))
  assert.ok(listarMisiones(db, { nivel: 'terciaria' }).some((m) => m.titulo === 'Llamar a Ana'), 'se acepta sin apagar el Directo')

  await registrarCuadro(db, s.id, img, 'image/jpeg', min(80))
  responde({ texto: 'Hora y media: arrancó con el Directo y siguió con lo mismo.', tareas: ['Llamar a Ana', 'Probar el informe por tramos'] })
  const c = await cerrarDirecto(db, s.id, { ahora: min(95), escriba: false })
  assert.match(pedidos.at(-1)!, /Lo que ya anotaste por tramos[\s\S]*La primera hora fue toda del Directo/, 'el cierre lee lo anotado')
  assert.match(pedidos.at(-1)!, /Ya propusiste \(no lo repitas\): Llamar a Ana/)
  assert.equal(c.informe, 'Hora y media: arrancó con el Directo y siguió con lo mismo.')
  assert.equal(tramosDe(c).length, 1)
  const ps = propuestasDe(c)
  assert.deepEqual(ps.map((p) => [p.id, p.titulo, p.estado]), [['t1p1', 'Llamar a Ana', 'aceptada'], ['p1', 'Probar el informe por tramos', 'pendiente']], 'no repite y no pisa lo aceptado')
  assert.equal(c.estado, 'cerrada')
})

test('entidades que ya existen: mal escritas, con apodo o incompletas se reconocen; el nombre se corrige antes de anotar', async () => {
  const { buscadorDeEntidades, asegurarEntidad, leerEntidad } = await import('../src/entidades.ts')
  const db = abrir(':memory:')
  const antoine = asegurarEntidad(db, { tipo: 'persona', nombre: 'Antoine Louboub' })
  const rafa = asegurarEntidad(db, { tipo: 'persona', nombre: 'Rafa' })
  const barrio = asegurarEntidad(db, { tipo: 'lugar', nombre: 'Barrio de Ruzafa', alias: ['Russafa'] })
  asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Prueba' })
  asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Torres' })
  const b = buscadorDeEntidades(db)
  assert.deepEqual([b.parecida('Antoine Liboub')?.id, b.parecida('Antoine Liboub')?.por], [antoine, 'parecido'])
  assert.deepEqual([b.parecida('Rafa el chino')?.id, b.parecida('Rafa el chino')?.por], [rafa, 'contiene'])
  assert.equal(b.parecida('Ruzafa')?.id, barrio)
  assert.equal(b.parecida('Russafa')?.por, 'alias')
  assert.equal(b.parecida('Ana'), null, 'con dos candidatas no adivina')
  assert.equal(b.parecida('Calle Cuba 24'), null)
  assert.match(b.relevantes('hoy hablé con Rafa por el coworking').join('\n'), /^Rafa \(persona\)/, 'lo que aparece en lo dicho va primero')

  // En el Directo: lo idéntico no se propone; lo parecido llega con «¿es X?»; aceptar «es esa» suma el alias.
  _probarDirecto({ vision: async () => ({ app: 'Notas', actividad: 'escribiendo', tema: 'coworking', detalle: '', nota: '' }), transcribir: async () => '' })
  const s = iniciarDirecto(db, ['pantalla'], T)
  await registrarCuadro(db, s.id, img, 'image/jpeg', min(0))
  _probarModelo(async () => ({ texto: JSON.stringify({ texto: 'Armaste el evento.', ideas: [], tareas: [], cumplidas: [], bandas: [], conexiones: [], consumido: [], entidades: [
    { nombre: 'Antoine Liboub', tipo: 'persona', nota: 'contacto del evento', alias: [] },
    { nombre: 'Rafa', tipo: 'persona', nota: 'ya está', alias: [] },
    { nombre: 'Terra Weekend', tipo: 'proyecto', nota: 'el evento', alias: [] },
    { nombre: 'Calle Cuva 24', tipo: 'lugar', nota: 'la dirección', alias: [] },
  ] }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }))
  const c = await cerrarDirecto(db, s.id, { ahora: min(10), escriba: false })
  const ps = (c.resumen as any).propuestas.filter((p: any) => p.tipo === 'entidad')
  assert.deepEqual(ps.map((p: any) => p.titulo), ['Antoine Liboub', 'Terra Weekend', 'Calle Cuva 24'], 'la idéntica no se propone')
  assert.equal(ps[0].parecida.id, antoine)
  resolverPropuestas(db, s.id, [ps[0].id], 'aceptar', min(11), { cambios: { [ps[0].id]: { vincular: antoine } } })
  assert.ok(leerEntidad(db, antoine)!.alias.includes('Antoine Liboub'), '«es esa»: el nombre que se oyó queda como alias')
  assert.equal(leerEntidad(db, antoine)!.notas, 'contacto del evento')
  resolverPropuestas(db, s.id, [ps[2].id], 'aceptar', min(11), { cambios: { [ps[2].id]: { titulo: 'Calle Cuba 24', tipoEntidad: 'lugar', vincular: null } } })
  assert.ok(listarEntidades(db, { q: 'Calle Cuba 24' }).some((e) => e.nombre === 'Calle Cuba 24'), 'se anota con el nombre corregido')
  assert.ok(!listarEntidades(db, { q: 'Cuva' }).length)
})
