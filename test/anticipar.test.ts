import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { _probarCalendario } from '../src/calendario.ts'
import { perfilDeRendimiento, textoDeRendimiento } from '../src/rendimiento.ts'
import { brujulaDelDia, leerBrujula, reunirDatos } from '../src/brujula.ts'
import { agregarObra, leerObra } from '../src/libreria.ts'
import { listarRecomendaciones, recomendar, resolverRecomendacion } from '../src/mentor.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { guardarRelacion, personas } from '../src/personas.ts'
import { insertar } from '../src/corpus.ts'
import { listarPuentes, proponerPuentes, resolverPuente } from '../src/puentes.ts'
import { listarMisiones } from '../src/misiones.ts'
import { siguientePregunta } from '../src/preguntas.ts'

process.env.GCAL_ICS_URLS = 'https://calendario.falso/ics'
_probarCalendario(async () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR')
const T = new Date(2026, 9, 8, 8).getTime()

function run(db: any, fecha: string, bandas: [string, number, string][]) {
  const r = db.prepare(`INSERT INTO runs (fecha, inicio, fin, estado, pedido, creada_en) VALUES (?, '09:00', '18:00', 'cerrada', '{}', ?)`).run(fecha, T - 86_400_000)
  for (const [inicio, minutos, estado] of bandas) {
    db.prepare(`INSERT INTO misiones (personaje, asignada_por, nivel, titulo, estado, run_id, inicio, minutos, creada_por, creada_en) VALUES ('jugador', 'jugador', 'secundaria', 'banda', ?, ?, ?, ?, 'test', ?)`)
      .run(estado, r.lastInsertRowid, inicio, minutos, T - 86_400_000)
  }
}

test('rendimiento: franjas, largos y días con sus tasas; sin datos no opina', () => {
  const db = abrir(':memory:')
  assert.equal(textoDeRendimiento(perfilDeRendimiento(db, T)), '')
  run(db, '2026-10-07', [['09:00', 12, 'hecha'], ['09:15', 12, 'hecha'], ['10:00', 25, 'hecha'], ['14:00', 50, 'no'], ['14:50', 50, 'no'], ['15:40', 50, 'parcial']])
  const p = perfilDeRendimiento(db, T)
  assert.equal(p.bandas, 6)
  assert.deepEqual(p.porFranja.map((g) => [g.clave, g.n, g.tasa]), [['09–11', 3, 1], ['13–15', 2, 0], ['15–17', 1, 0.5]])
  assert.equal(p.mejorFranja, '09–11')
  assert.equal(p.mejorLargo, '31–60 min', 'el único largo con 3 bandas o más')
  assert.deepEqual(p.porLargo.map((g) => g.clave), ['hasta 15 min', '16–30 min', '31–60 min'])
  const t = textoDeRendimiento(p)
  assert.match(t, /termina el 58 %/)
  assert.match(t, /Por franja horaria: 09–11 100 % \(3\)\./)
  assert.match(t, /31–60 min 17 % \(3\)/)
})

test('brújula: junta lo que hay, guarda el tridente del día y si sabe poco deja una pregunta', async () => {
  const db = abrir(':memory:')
  const d = await reunirDatos(db, T)
  assert.ok(d.poco)
  let pedido = ''
  _probarModelo(async (_l, o) => { pedido = String(o.mensajes[1].content); return { texto: JSON.stringify({ cuerpo: 'Caminá 10 minutos antes de las 9.', mente: 'La escena 7.', alma: 'Hoy es para terminar algo.', foco: 'Terminar la escena 7.', pregunta: '¿A qué hora te despertaste?' }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 } })
  const b = await brujulaDelDia(db, { ahora: T })
  assert.match(pedido, /Ayer no hubo run\./)
  assert.equal(b.foco, 'Terminar la escena 7.')
  assert.equal(leerBrujula(db, '2026-10-08')!.alma, 'Hoy es para terminar algo.')
  assert.equal(siguientePregunta(db)?.texto, '¿A qué hora te despertaste?')
  _probarModelo(async () => { throw new Error('no debería volver a llamar') })
  assert.equal((await brujulaDelDia(db, { ahora: T })).foco, 'Terminar la escena 7.', 'una por día, salvo forzar')
})

test('mentor: recomienda de su Librería, conectado a lo que empuja; aceptar anota la side quest y pone la obra en curso', async () => {
  const db = abrir(':memory:')
  await assert.rejects(recomendar(db, T), /Librería está vacía/)
  const dune = agregarObra(db, { tipo: 'libro', titulo: 'Dune', autor: 'Frank Herbert', estado: 'quiero' }).obra
  agregarObra(db, { tipo: 'serie', titulo: 'Severance', estado: 'quiero' })
  _probarModelo(async (_l, o) => ({ texto: JSON.stringify({ recomendaciones: [{ obra: Number(/(\d+)\. \[libro\] Dune/.exec(String(o.mensajes[1].content))![1]), por_que: 'Para tu guion de ciencia ficción.', accion: 'Leer los dos primeros capítulos de Dune', como: 'banda', minutos: 25 }, { obra: 9, por_que: 'x', accion: 'y', como: 'banda' }] }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }))
  const rs = await recomendar(db, T)
  assert.equal(rs.length, 1, 'solo obras de la lista')
  assert.equal(rs[0].titulo, 'Dune')
  const sq = resolverRecomendacion(db, rs[0].id, true, T)!
  assert.equal(sq.titulo, 'Leer los dos primeros capítulos de Dune')
  assert.match(sq.detalle!, /Para la próxima run \(25 min\)/)
  assert.equal(leerObra(db, dune.id)!.estado, 'en_curso')
  assert.equal(listarRecomendaciones(db).length, 0)
  assert.equal(listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria' }).length, 1)
})

test('puentes: presentar a dos y retomar con una, con motivo; hecho cuenta como contacto; no se repiten', async () => {
  const db = abrir(':memory:')
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Prueba', origenId: 'p:a' })
  const beto = asegurarEntidad(db, { tipo: 'persona', nombre: 'Beto Prueba', origenId: 'p:b' })
  const cami = asegurarEntidad(db, { tipo: 'persona', nombre: 'Cami Prueba', origenId: 'p:c' })
  const proy = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Proyecto Juego', origenId: 'p:p' })
  insertar(db, { fuente: 'operador', titulo: 'x', contenido: 'x', entidades: [ana, proy], origenId: 'p:1' })
  guardarRelacion(db, ana, { vinculo: 'trabajo', notas: 'programa juegos' }, T)
  guardarRelacion(db, beto, { vinculo: 'amistad', notas: 'ilustrador' }, T)
  guardarRelacion(db, cami, { vinculo: 'familia', proxima: 'devolverle el libro', contacto: '2026-08-01' }, T)
  let vio = ''
  const orden = () => personas(db, { limite: 200 }, T).filter((p) => p.vinculo).map((p) => p.id)
  _probarModelo(async (_l, o) => {
    vio = String(o.mensajes[1].content)
    const n = (id: number) => orden().indexOf(id) + 1
    return { texto: JSON.stringify({ puentes: [
      { tipo: 'presentar', personas: [n(ana), n(beto)], motivo: 'Ana programa juegos y Beto ilustra.', mensaje: 'Ana, te presento a Beto…' },
      { tipo: 'retomar', personas: [n(cami)], motivo: 'Le debés el libro.', mensaje: 'Cami, ¿cuándo te devuelvo el libro?' },
      { tipo: 'presentar', personas: [n(ana)], motivo: 'mal formado' },
    ] }), llamadas: [], razonamiento: null, modelo: 'f', tokens: 1 }
  })
  const ps = await proponerPuentes(db, T)
  assert.match(vio, /Ana Prueba \(trabajo\) — programa juegos · aparece con: Proyecto Juego/)
  assert.match(vio, /Cami Prueba \(familia\).*pendiente: devolverle el libro/)
  assert.deepEqual(ps.map((p) => [p.tipo, p.personas.map((x) => x.nombre).join(' y ')]).sort(), [['presentar', 'Ana Prueba y Beto Prueba'], ['retomar', 'Cami Prueba']])
  assert.equal((await proponerPuentes(db, T)).length, 2, 'no repite lo pendiente')
  const retomar = ps.find((p) => p.tipo === 'retomar')!
  resolverPuente(db, retomar.id, 'hecho', T)
  assert.equal(personas(db, { id: cami }, T)[0].ultimoContacto, '2026-10-08')
  assert.equal(listarPuentes(db).length, 1)
})
