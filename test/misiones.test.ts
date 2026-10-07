import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCalendario } from '../src/calendario.ts'
import { escribaDeMemoria, recordar } from '../src/memoria.ts'
import { asegurarEntidad, listarEntidades } from '../src/entidades.ts'
import { listarPiezas } from '../src/corpus.ts'
import { crearProyecto } from '../src/mastropiero.ts'
import { forjar, retirar } from '../src/roster.ts'
import { _probarEscriba, promptMastropiero } from '../src/chat/index.ts'
import { agregarItem, escribirHistoria, inventarioDe, leerHistoria, resolverHistoria, resolverPersonaje } from '../src/personajes.ts'
import {
  actualizarMision, anotarSideQuest, arrancarRun, asignarMision, avanceDe, crearMision, fijarPrincipal, latidoRuns, listarMisiones, listarReportes,
  marcarSecundaria, metricasSemana, misionesDeRun, prepararRun, principalDe, programar, proponerPrimarias, rehacerRun, semanaDe, seguimientos, sideQuestsRelevantes,
} from '../src/misiones.ts'

process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarEscriba(async () => {})
const ICS = (cuerpo: string) => `BEGIN:VCALENDAR\r\n${cuerpo}\r\nEND:VCALENDAR`
_probarCalendario(async () => ICS(''))

type Visto = { agente: string; sistema: string; usuario: string }
/** Modelo falso que contesta según quién pregunta. */
function modelo(r: { pedido?: unknown; run?: unknown | (() => unknown); primarias?: unknown; reporte?: unknown; escriba?: unknown; procesar?: unknown; chat?: string }) {
  const vistos: Visto[] = []
  _probarModelo(async (l, o) => {
    const sistema = String(o.mensajes[0].content)
    const usuario = String(o.mensajes.at(-1)!.content)
    vistos.push({ agente: String(l.agenteId), sistema, usuario })
    const datos = sistema.includes('interpretás el pedido de una run') ? r.pedido
      : sistema.includes('armás una run') ? (typeof r.run === 'function' ? (r.run as () => unknown)() : r.run)
      : sistema.includes('proponés las misiones primarias') ? r.primarias
      : sistema.includes('escribís el reporte') ? r.reporte
      : sistema.includes('escriba de memoria') ? r.escriba
      : sistema.includes('procesás al jugador') ? r.procesar
      : null
    return { texto: datos ? JSON.stringify(datos) : r.chat ?? 'ok', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  return vistos
}

const bandas = (n: number, minutos = 12, extra: Record<string, unknown> = {}) => ({
  resumen: 'Una mañana para avanzar.',
  misiones: Array.from({ length: n }, (_, i) => ({ titulo: `Tarea ${i + 1}`, detalle: `Primer paso de la tarea ${i + 1}`, minutos, primaria: null, categoria: 'escritura', ...extra })),
})
const a = (h: number, m = 0) => new Date(2026, 9, 7, h, m).getTime() // miércoles 7/10/2026

test('misión principal: una por personaje; la de un agente no cambia y la del jugador solo la fija él', () => {
  const db = abrir(':memory:')
  const f = forjar(db, { clase: 'generativo', motor: 'local' })
  const p = principalDe(db, `agente:${f.id}`)!
  assert.match(p.titulo, /^Producir /)
  assert.throws(() => actualizarMision(db, p.id, { titulo: 'Otra cosa' }), /no cambia/)
  assert.throws(() => fijarPrincipal(db, `agente:${f.id}`, { titulo: 'Otra' }), /no cambia/)
  const g = forjar(db, { clase: 'generativo', motor: 'local', misionPrincipal: 'Escribir guiones cortos' })
  assert.equal(principalDe(db, `agente:${g.id}`)!.titulo, 'Escribir guiones cortos')

  const sugerida = fijarPrincipal(db, 'jugador', { titulo: 'Publicar el libro' }, { por: 'mastropiero' })
  assert.equal(sugerida.estado, 'sugerida')
  assert.equal(principalDe(db, 'jugador'), null)
  const fijada = fijarPrincipal(db, 'jugador', { titulo: 'Vivir de lo que escribo' }, { por: 'operador' })
  assert.equal(principalDe(db, 'jugador')!.id, fijada.id)
  assert.throws(() => actualizarMision(db, fijada.id, { titulo: 'X' }, { por: 'mastropiero' }), /solo la cambia él/)
  // Aceptar la sugerida reemplaza a la vigente.
  actualizarMision(db, sugerida.id, { estado: 'activa' }, { por: 'operador' })
  assert.equal(principalDe(db, 'jugador')!.titulo, 'Publicar el libro')
  assert.equal(listarMisiones(db, { personaje: 'jugador', nivel: 'principal', estados: ['activa'] }).length, 1)

  // Al retirarse, lo abierto muere con el agente.
  crearMision(db, { personaje: `agente:${f.id}`, nivel: 'primaria', titulo: 'Algo pendiente' })
  retirar(db, f.id, 'prueba')
  assert.equal(listarMisiones(db, { personaje: `agente:${f.id}`, nivel: 'primaria' })[0].estado, 'descartada')
})

test('historia e inventario: sugerencias que se aceptan, sin duplicar ítems', () => {
  const db = abrir(':memory:')
  escribirHistoria(db, 'jugador', { texto: 'Venís de una familia de músicos.', elementos: ['oído'] }, { sugerida: true })
  assert.equal(leerHistoria(db, 'jugador').texto, null)
  resolverHistoria(db, 'jugador', true)
  assert.equal(leerHistoria(db, 'jugador').texto, 'Venís de una familia de músicos.')
  agregarItem(db, 'jugador', { tipo: 'presencia', nombre: 'Blog personal', url: 'https://ejemplo.org' })
  agregarItem(db, 'jugador', { tipo: 'presencia', nombre: 'blog personal', detalle: 'actualizado' })
  agregarItem(db, 'jugador', { tipo: 'capital', nombre: 'Ahorros', valor: 1200, unidad: '€' }, { sugerido: true })
  assert.equal(inventarioDe(db, 'jugador').length, 1)
  assert.equal(inventarioDe(db, 'jugador', { conSugeridos: true }).length, 2)
  assert.equal(inventarioDe(db, 'jugador')[0].detalle, 'actualizado')
  const e = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Gómez' })
  assert.equal(resolverPersonaje(db, 'ana gomez'), `entidad:${e}`)
  assert.equal(resolverPersonaje(db, 'yo'), 'jugador')
  assert.throws(() => resolverPersonaje(db, 'Nadie Conocido'), /No encuentro/)
})

test('run «Mañana oficina»: 15 bandas de 12 minutos en 3 horas; con la agenda en el medio, menos y sin pisarla', async () => {
  const db = abrir(':memory:')
  modelo({ run: bandas(20) })
  const { run, misiones } = await prepararRun(db, {}, { ahora: a(9) })
  assert.equal(run.estado, 'propuesta')
  assert.equal(run.pedido.plantillaNombre, 'Mañana oficina')
  assert.equal(misiones.length, 15)
  assert.deepEqual([misiones[0].inicio, misiones.at(-1)!.fin], ['09:00', '12:00'])
  assert.ok(misiones.every((m) => m.minutos === 12 && m.detalle))

  _probarCalendario(async () => ICS('BEGIN:VEVENT\r\nDTSTART:20261007T100000\r\nDTEND:20261007T103000\r\nSUMMARY:Reunión\r\nEND:VEVENT'))
  const con = await prepararRun(db, {}, { ahora: a(9) })
  _probarCalendario(async () => ICS(''))
  const ini = con.run.fijos[0]
  assert.ok(ini, 'la reunión cae adentro')
  assert.ok(con.misiones.length < 15)
  assert.ok(con.misiones.every((m) => m.fin! <= ini.inicio || m.inicio! >= ini.fin), 'ninguna pisa la reunión')
  assert.equal(misionesDeRun(db, run.id).length, 0, 'la propuesta anterior queda descartada')
})

test('run a pedido: lo dicho en palabras pisa la plantilla, crea entidades y excluye lo que no quiere', async () => {
  const db = abrir(':memory:')
  const vistos = modelo({
    pedido: { duracion: 120, banda: [25], excluir: 'mails', energia: 'cansado', dinero: 20, incluir: [{ nombre: 'Proyecto Faro', tipo: 'proyecto' }] },
    run: { resumen: 'Corta y liviana.', misiones: [
      { titulo: 'Responder mails pendientes', minutos: 25 }, { titulo: 'Bocetar la tapa', minutos: 30 }, { titulo: 'Comprar materiales', minutos: 25, gasto: 15 },
      { titulo: 'Comprar más materiales', minutos: 25, gasto: 15 }, { titulo: 'Ordenar notas', minutos: 25 }, { titulo: 'Leer referencias', minutos: 25 }, { titulo: 'Sobra', minutos: 25 },
    ] },
  })
  const { run, misiones } = await prepararRun(db, { texto: 'Tengo dos horas, cansado, bandas de 25, nada de mails, 20 euros, meté el Proyecto Faro' }, { ahora: a(15) })
  assert.equal(run.pedido.duracion, 120)
  assert.equal(run.pedido.cantidad, 4)
  assert.deepEqual(misiones.map((m) => m.titulo), ['Bocetar la tapa', 'Comprar materiales', 'Ordenar notas', 'Leer referencias'])
  assert.ok(misiones.every((m) => m.minutos === 25))
  assert.equal(run.fin, '17:00')
  assert.ok(listarEntidades(db, { q: 'Proyecto Faro' }).length === 1, 'la entidad se creó al vuelo')
  const pedidoRun = vistos.find((v) => v.agente === 'run')!
  assert.match(pedidoRun.usuario, /No quiere: mails/)
  assert.match(pedidoRun.usuario, /Proyecto Faro/)
  assert.match(pedidoRun.usuario, /Plata disponible para gastar: 20/)
})

test('rehacer: si el modelo falla la run queda como estaba; si acorta, la cantidad sale de la nueva duración', async () => {
  const db = abrir(':memory:')
  modelo({ pedido: { duracion: 90, banda: [15] }, run: bandas(10, 15) })
  const { run } = await prepararRun(db, { texto: 'hora y media en bandas de 15' }, { ahora: a(9) })
  assert.equal(misionesDeRun(db, run.id).length, 6)
  modelo({ pedido: { duracion: 45 }, run: () => { throw new Error('NaN caído') } })
  await assert.rejects(rehacerRun(db, run.id, 'más corta', { ahora: a(9) }), /NaN caído/)
  assert.equal(misionesDeRun(db, run.id).length, 6, 'nada se borró')
  modelo({ pedido: { duracion: 45 }, run: bandas(10, 15, { titulo: 'Corta' }) })
  const re = await rehacerRun(db, run.id, 'más corta: 45 minutos', { ahora: a(9) })
  assert.equal(re.misiones.length, 3)
  assert.equal(re.run.fin, '09:45')
})

test('pedirJson: un JSON roto tiene un segundo intento', async () => {
  const { pedirJson } = await import('../src/modelo.ts')
  const db = abrir(':memory:')
  let n = 0
  _probarModelo(async () => ({ texto: n++ ? '```json\n{"ok": true}\n```' : 'Acá va: {"ok": tru', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }))
  const { datos } = await pedirJson<{ ok: boolean }>({ db, clase: 'mastropiero', agenteId: 'x' }, 'sistema', 'usuario')
  assert.deepEqual(datos, { ok: true })
  assert.equal(n, 2)
})

test('programar: bandas variables y libres, ventana y tope de plata', () => {
  const ps = [{ minutos: 40 }, { minutos: 7 }, { minutos: 200 }, { minutos: 20, gasto: 50 }].map((x, i) => ({ titulo: `T${i}`, detalle: null, primaria: null, categoria: null, con: null, gasto: null, ...x }))
  const fijo = programar(ps, { desde: 600, hasta: 720, banda: [12, 25, 50], cantidad: null, ocupado: [], dinero: 10, excluir: null })
  // 200 se ajusta a la banda más cercana (50); la que cuesta 50 no entra con 10 de tope.
  assert.deepEqual(fijo.map((m) => [m.inicio, m.minutos]), [['10:00', 50], ['10:50', 12], ['11:02', 50]])
  const libre = programar(ps, { desde: 600, hasta: 900, banda: null, cantidad: null, ocupado: [[640, 660]], dinero: null, excluir: null })
  assert.deepEqual(libre.map((m) => [m.inicio, m.fin]), [['10:00', '10:40'], ['11:00', '11:07'], ['11:07', '13:07']])
})

test('agentes en la run: el que conoce el proyecto incluido aporta, y queda registrado', async () => {
  const db = abrir(':memory:')
  crearProyecto(db, 'Faro')
  asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Faro' })
  const f = forjar(db, { clase: 'generativo', motor: 'local', proyectoId: 'faro', instrucciones: 'Conozco el proyecto Faro.' })
  db.prepare(`UPDATE agentes SET estado = 'activo' WHERE id = ?`).run(f.id)
  const vistos = modelo({ run: bandas(15) })
  const { run } = await prepararRun(db, { incluir: ['Faro'] }, { ahora: a(9) })
  assert.equal(run.agentes.length, 1)
  assert.equal(run.agentes[0].id, f.id)
  assert.ok(run.agentes[0].ok)
  assert.match(vistos.find((v) => v.agente === 'run')!.usuario, /Lo que propone .* \(agente que la conoce\)/)
  const t = db.prepare(`SELECT estado, tipo FROM tareas WHERE asignada_a = ?`).get(f.id) as { estado: string; tipo: string }
  assert.deepEqual({ ...t }, { estado: 'hecha', tipo: 'preparar-run' })
})

test('primarias, progreso, rehacer y reportes: de la banda a la semana', async () => {
  const db = abrir(':memory:')
  recordar(db, { texto: 'Quiere terminar su novela este año', tipo: 'meta' })
  const semana = semanaDe(a(9))
  modelo({ primarias: { primarias: [{ titulo: 'Escribir la novela', detalle: 'Dos capítulos', categoria: 'escritura', entidad: null, por_que: 'es su meta' }, { titulo: 'Ordenar finanzas', detalle: 'Presupuesto', categoria: 'vida' }] } })
  const ps = await proponerPrimarias(db, semana, { ahora: a(9) })
  assert.deepEqual(ps.map((p) => p.estado), ['sugerida', 'sugerida'])
  for (const p of ps) actualizarMision(db, p.id, { estado: 'activa' })

  modelo({ run: bandas(15, 12, { primaria: 1 }), reporte: { texto: 'Salió bien la primera hora.', ajustes: ['Bandas de 25 para escribir'] } })
  const { run } = await prepararRun(db, {}, { ahora: a(9) })
  const ms = misionesDeRun(db, run.id)
  assert.ok(ms.every((m) => m.padreId === ps[0].id), 'empujan la primera primaria')

  // Rehacer conserva lo fijado.
  actualizarMision(db, ms[2].id, { fijada: true })
  modelo({ run: bandas(15, 12, { titulo: 'Nueva', primaria: 1 }), reporte: { texto: 'Salió bien la primera hora.', ajustes: ['Bandas de 25 para escribir'] } })
  const re = await rehacerRun(db, run.id, null, { ahora: a(9) })
  assert.ok(re.misiones.some((m) => m.id === ms[2].id))
  assert.equal(re.misiones.length, 15)

  arrancarRun(db, run.id, a(9))
  const bs = misionesDeRun(db, run.id)
  marcarSecundaria(db, bs[0].id, 'hecha', 'salió fácil')
  marcarSecundaria(db, bs[1].id, 'parcial', 'me trabé con el final')
  marcarSecundaria(db, bs[3].id, 'no')
  const av = avanceDe(db, ps[0].id)
  assert.deepEqual(av.bandas, { hechas: 1, parciales: 1, no: 1, total: 15 })
  assert.equal(av.minutos, 18)

  // Reporte por hora: una vez por hora; la run vencida se cierra sola.
  assert.equal((await latidoRuns(db, a(9, 59))).length, 0)
  const h1 = await latidoRuns(db, a(10, 1))
  assert.equal(h1.length, 1)
  assert.match(h1[0], /Primera hora.*1 hecha.*1 a medias.*1 que no salió/)
  assert.equal((await latidoRuns(db, a(10, 30))).length, 0)
  assert.match((await latidoRuns(db, a(11, 1)))[0], /Hora 2/)
  const fin = await latidoRuns(db, a(12, 16))
  assert.equal(fin.length, 2)
  assert.match(fin[1], /Salió bien la primera hora[\s\S]*Bandas de 25/)
  assert.equal(listarReportes(db, { tipo: 'hora' }).length, 3)
  const piezas = listarPiezas(db, { nivel: 'generada' }).piezas
  assert.ok(piezas.some((p) => p.etiquetas.includes('reporte')))

  const met = metricasSemana(db, semana)
  assert.equal(met.runs, 1)
  assert.equal(met.secundarias.hechas, 1)
  assert.equal(met.primarias[0].bandas, 1)

  // La próxima run se calibra con lo que contó.
  const vistos = modelo({ run: bandas(15) })
  await prepararRun(db, {}, { ahora: a(15) })
  assert.match(vistos.find((v) => v.agente === 'run')!.usuario, /me trabé con el final/)
  assert.match(vistos.find((v) => v.agente === 'run')!.usuario, /Bandas de 25 para escribir/)
})

test('side quests y misiones para otros: el disparador las trae y lo vencido se sigue', async () => {
  const db = abrir(':memory:')
  anotarSideQuest(db, { titulo: 'Comprar un regalo para Ana', disparador: { zona: 'el centro', actividad: 'caminar' } })
  anotarSideQuest(db, { titulo: 'comprar un regalo para ana', sugerida: true })
  assert.equal(listarMisiones(db, { nivel: 'terciaria' }).length, 1, 'no se duplica')
  assert.equal(sideQuestsRelevantes(db, 'Salgo a caminar un rato').length, 1)
  assert.equal(sideQuestsRelevantes(db, 'Me quedo en casa leyendo').length, 0)
  const prompt = promptMastropiero(db, 'Ahora salgo a caminar por el centro')
  assert.match(prompt, /⚑ .*Comprar un regalo para Ana/)

  const m = asignarMision(db, { a: 'Rafa Pérez', titulo: 'Mandar el presupuesto', vence: '2026-10-06' })
  assert.match(m.personaje, /^entidad:\d+$/)
  assert.equal(seguimientos(db, a(9)).length, 1)
  assert.match(promptMastropiero(db), /Seguimientos vencidos.*Rafa Pérez: Mandar el presupuesto/)
})

test('el escriba anota lo que tiene y los encargos de pasada como sugerencias', async () => {
  const db = abrir(':memory:')
  modelo({ escriba: {
    recuerdos: [{ texto: 'Tiene un canal de video', tipo: 'hecho' }],
    inventario: [{ tipo: 'presencia', nombre: 'Canal de video', detalle: '2.000 suscriptores', valor: 2000, unidad: 'suscriptores' }],
    side_quests: [{ titulo: 'Devolver el libro a la biblioteca', disparador: { lugar: 'biblioteca', zona: null, actividad: null, cuando: null } }],
  } })
  await escribaDeMemoria(db, 'Tengo un canal de video con 2000 suscriptores y cuando pase por la biblioteca devuelvo el libro', null)
  const inv = inventarioDe(db, 'jugador', { conSugeridos: true })
  assert.deepEqual(inv.map((i) => [i.nombre, i.estado, i.valor]), [['Canal de video', 'sugerido', 2000]])
  assert.equal(listarMisiones(db, { nivel: 'terciaria' })[0].estado, 'activa', 'las side quests de lo que cuenta quedan activas')
})

test('migración: las jornadas viejas en bloques pasan a una run con sus misiones', () => {
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mastro-mig-')), 'vieja.db')
  const db = abrir(ruta)
  db.prepare(`INSERT INTO jornadas (fecha, estado, bloques, creada_en, actualizada_en) VALUES ('2026-10-05', 'cerrada', ?, 0, 0)`).run(JSON.stringify([
    { id: 'b540', inicio: '09:00', fin: '09:12', minutos: 12, titulo: 'Hecho', por_que: null, proyecto: null, estado: 'hecho' },
    { id: 'e600', inicio: '10:00', fin: '11:00', minutos: 60, titulo: 'Agenda', por_que: null, proyecto: null, estado: 'fijo' },
    { id: 'b700', inicio: '11:40', fin: '11:52', minutos: 12, titulo: 'Saltado', por_que: null, proyecto: null, estado: 'saltado' },
  ]))
  db.close()
  const otra = abrir(ruta)
  const ms = listarMisiones(otra, { nivel: 'secundaria' })
  assert.deepEqual(ms.map((m) => [m.titulo, m.estado]), [['Hecho', 'hecha'], ['Saltado', 'no']])
  assert.equal((otra.prepare(`SELECT bloques FROM jornadas`).get() as { bloques: string }).bloques, '[]')
  otra.close()
  const tercera = abrir(ruta)
  assert.equal(listarMisiones(tercera, { nivel: 'secundaria' }).length, 2, 'no se migra dos veces')
  tercera.close()
})

test('personas por apodo: «Rafa» encuentra a la única que encaja; con dos candidatas no adivina', async () => {
  const { personaPorNombre } = await import('../src/personajes.ts')
  const db = abrir(':memory:')
  const rafael = asegurarEntidad(db, { tipo: 'persona', nombre: 'Rafael Gómez' })
  assert.equal(personaPorNombre(db, 'Rafa'), rafael)
  assert.match(asignarMision(db, { a: 'Rafa', titulo: 'Mandar algo' }).personaje, new RegExp(`entidad:${rafael}$`))
  asegurarEntidad(db, { tipo: 'persona', nombre: 'Rafaela Ruiz' })
  assert.equal(personaPorNombre(db, 'Rafa'), null)
})

test('el jugador también es una entidad: una sola ficha, y «Soy yo» une lo anotado', async () => {
  const { marcarJugador, personaje: pj } = await import('../src/personajes.ts')
  const db = abrir(':memory:')
  const yo = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Prueba' })
  crearMision(db, { personaje: `entidad:${yo}`, nivel: 'primaria', titulo: 'Algo que le anoté a la entidad' })
  agregarItem(db, `entidad:${yo}`, { tipo: 'conocimiento', nombre: 'Guion' })
  assert.equal(pj(db, 'jugador').entidadId, null)
  marcarJugador(db, yo)
  assert.equal(pj(db, `entidad:${yo}`).clave, 'jugador', 'su entidad es el jugador')
  assert.equal(pj(db, 'jugador').nombre, 'Ana Prueba')
  assert.equal(resolverPersonaje(db, 'Ana Prueba'), 'jugador')
  assert.equal(listarMisiones(db, { personaje: 'jugador', nivel: 'primaria' }).length, 1)
  assert.equal(inventarioDe(db, 'jugador').length, 1)
  const otra = asegurarEntidad(db, { tipo: 'persona', nombre: 'Otra Persona' })
  marcarJugador(db, otra)
  assert.equal(pj(db, `entidad:${yo}`).clave, `entidad:${yo}`, 'solo una persona es el jugador')
})
