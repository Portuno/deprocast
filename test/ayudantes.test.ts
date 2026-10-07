import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCalendario } from '../src/calendario.ts'
import { insertar } from '../src/corpus.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { leer } from '../src/roster.ts'
import { _probarEscriba } from '../src/chat/index.ts'
import { marcarJugador } from '../src/personajes.ts'
import { actualizarMision, asignarMision, crearMision, leerMision, prepararRun, principalDe } from '../src/misiones.ts'
import { aportes, ayudantesDe, pedirAportes, quitarAyudante, sumarAyudante } from '../src/ayudantes.ts'

delete process.env.NAN_API_KEY // los ayudantes de los tests usan el motor local
process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarEscriba(async () => {})
_probarCalendario(async () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR')

const T = new Date(2026, 9, 7, 9).getTime()

function primaria(db: ReturnType<typeof abrir>, titulo = 'Escribir el guion del corto') {
  return crearMision(db, { nivel: 'primaria', titulo, detalle: 'Primer acto', estado: 'activa' }, { ahora: T })
}

test('ayudantes: nacen con su misión, trabajan entre runs y dejan aportes en el corpus', async () => {
  const db = abrir(':memory:')
  const p = primaria(db)
  const a = sumarAyudante(db, p.id, { clase: 'generativo', ahora: T })
  assert.equal(a.agente!.motor, 'local')
  assert.match(principalDe(db, `agente:${a.agente!.id}`)!.titulo, /Ayudar a que «Escribir el guion del corto» avance/)
  assert.equal(leerMision(db, a.mision.id)!.padreId, p.id)
  assert.equal(ayudantesDe(db, p.id).length, 1)
  assert.throws(() => sumarAyudante(db, p.id, { clase: 'auditor' }), /ayudantes son/)

  const r = await pedirAportes(db, { ahora: T })
  assert.equal(r.aportes.length, 1)
  assert.equal(r.frenado, null)
  assert.match(r.aportes[0].titulo, /Aporte de GEN-0001 · Escribir el guion/)
  assert.equal(leer(db, a.agente!.id)!.exitos, 1, 'gana XP como en el bus')
  // Una vez por día con soloSinAporteHoy (la rutina de la mañana).
  assert.equal((await pedirAportes(db, { ahora: T + 1000, soloSinAporteHoy: true })).aportes.length, 0)

  // El buscador lee también lo crudo (con la ingesta en pausa es casi todo el corpus).
  const pieza = insertar(db, { fuente: 'operador', titulo: 'Notas del guion del corto', contenido: 'El primer acto arranca en la terraza.' })
  sumarAyudante(db, p.id, { clase: 'buscador', ahora: T })
  const r2 = await pedirAportes(db, { primariaId: p.id, ahora: T + 2000 })
  const delBuscador = r2.aportes.find((x) => x.autor?.startsWith('BUS'))
  assert.ok(delBuscador, `el buscador aportó (fallas: ${r2.fallas.join(' / ')})`)
  assert.match(delBuscador!.contenido, new RegExp(`\\[#${pieza}\\]`))

  // La próxima run recibe los aportes como material.
  const vistos: string[] = []
  _probarModelo(async (_l, o) => {
    vistos.push(String(o.mensajes.at(-1)!.content))
    return { texto: JSON.stringify({ resumen: 'ok', misiones: [{ titulo: 'Usar el aporte', minutos: 12 }] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }
  })
  await prepararRun(db, {}, { ahora: T + 3000 })
  assert.match(vistos.at(-1)!, /Lo que le dejaron sus ayudantes[\s\S]*GEN-0001/)

  // Cerrar la primaria cierra a sus ayudantes; sacar uno lo descarta.
  quitarAyudante(db, ayudantesDe(db, p.id)[1].mision.id)
  actualizarMision(db, p.id, { estado: 'hecha' })
  assert.equal(leerMision(db, a.mision.id)!.estado, 'hecha')
  assert.equal(aportes(db, { primariaId: p.id }).length, 3, 'uno del primer pedido, dos del segundo (generativo y buscador)')
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE fuente = 'agentes'`).get()!.n, 3, 'sin duplicados de la liga')
})

test('ayudantes: el tope diario de la liga los frena sin que fallen', async () => {
  const db = abrir(':memory:')
  const p = primaria(db)
  const a = sumarAyudante(db, p.id, { clase: 'generativo', ahora: T })
  db.prepare(`UPDATE ajustes SET valor = '10' WHERE clave = 'tokens_dia_max'`).run()
  db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'x', 'extractor', 'EXT', 50, 0, 1, 200, ?)`).run(T)
  const r = await pedirAportes(db, { ahora: T + 1000 })
  assert.equal(r.aportes.length, 0)
  assert.match(r.frenado ?? '', /tope/)
  assert.equal(leer(db, a.agente!.id)!.fallos, 0)
  assert.throws(() => sumarAyudante(db, crearMision(db, { nivel: 'primaria', titulo: 'Sugerida', estado: 'sugerida' }).id), /activa/)
})

test('un alias mal puesto del jugador no le asigna a él lo que es de otra persona', () => {
  const db = abrir(':memory:')
  const yo = asegurarEntidad(db, { tipo: 'persona', nombre: 'Juan Prueba', alias: ['Amparo', 'Juancho'] })
  marcarJugador(db, yo)
  const otra = asegurarEntidad(db, { tipo: 'persona', nombre: 'Amparo Gómez' })
  assert.equal(asignarMision(db, { a: 'Amparo', titulo: 'Mandar el contrato' }).personaje, `entidad:${otra}`)
  assert.equal(asignarMision(db, { a: 'Juan Prueba', titulo: 'Algo mío' }).personaje, 'jugador')
})

test('entidades: corregir el nombre deja el viejo como alias; fusionar duplicadas no pierde nada', async () => {
  const { editarEntidad, fusionarEntidades, leerEntidad } = await import('../src/entidades.ts')
  const db = abrir(':memory:')
  const yo = asegurarEntidad(db, { tipo: 'persona', nombre: 'Juan P.', alias: ['Juancho'] })
  const e = editarEntidad(db, yo, { nombre: 'Juan Pablo Prueba' })
  assert.deepEqual(e.alias.sort(), ['Juan P.', 'Juancho'])
  const persona = asegurarEntidad(db, { tipo: 'persona', nombre: 'Red Valencia' })
  const proyecto = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Red Valencia', alias: ['Directorio'], notas: 'Un directorio' })
  const grupo = asegurarEntidad(db, { tipo: 'agrupacion', nombre: 'Red Valencia' })
  const pieza = insertar(db, { fuente: 'operador', titulo: 'x', contenido: 'y', entidades: [persona, proyecto] })!
  const m = crearMision(db, { nivel: 'primaria', titulo: 'Avanzar', entidadId: persona, estado: 'activa' })
  const f = fusionarEntidades(db, grupo, [persona, proyecto])
  assert.equal(f.tipo, 'agrupacion')
  assert.ok(f.alias.includes('Directorio'))
  assert.equal(f.notas, 'Un directorio')
  assert.equal(leerEntidad(db, persona), null)
  assert.deepEqual(JSON.parse((db.prepare('SELECT entidades FROM corpus WHERE id = ?').get(pieza) as any).entidades), [grupo])
  assert.equal(leerMision(db, m.id)!.entidadId, grupo)
})

test('una run para mañana: arranca al inicio de la jornada y no pisa la propuesta de hoy', async () => {
  const db = abrir(':memory:')
  _probarModelo(async () => ({ texto: JSON.stringify({ resumen: 'ok', misiones: Array.from({ length: 30 }, (_, i) => ({ titulo: `T${i}`, minutos: 12 })) }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }))
  const hoy = await prepararRun(db, { inicio: '15:00', fin: '17:30' }, { ahora: new Date(2026, 9, 7, 14, 50).getTime() })
  assert.equal(hoy.misiones.length, 12)
  const manana = await prepararRun(db, { fecha: '2026-10-08', fin: '14:00' }, { ahora: new Date(2026, 9, 7, 14, 55).getTime() })
  assert.deepEqual([manana.run.fecha, manana.run.inicio, manana.run.fin, manana.misiones.length], ['2026-10-08', '09:00', '14:00', 25])
  assert.equal(db.prepare(`SELECT estado FROM runs WHERE id = ?`).get(hoy.run.id)!.estado, 'propuesta')
  await assert.rejects(prepararRun(db, { fecha: '2026-10-06' }, { ahora: new Date(2026, 9, 7, 15).getTime() }), /ya pasó/)
})
