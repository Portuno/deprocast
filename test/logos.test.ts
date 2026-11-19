import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarFuente, insertar } from '../src/corpus.ts'
import { _probarModelo } from '../src/modelo.ts'
import { forjar, leer } from '../src/roster.ts'
import { purgar } from '../src/mastropiero.ts'
import { AVISO_SIN_FUENTE, editarLogos, forjarLogos, listarLogos, preguntarALogos, sumarALogos } from '../src/logos.ts'

const DIA = 86_400_000

/** El modelo de prueba: guarda lo que le pasaron y contesta lo que le digan. */
function modelo(respuesta: Record<string, unknown>) {
  const vistos: { sistema: string; usuario: string }[] = []
  _probarModelo(async (_l, o) => {
    vistos.push({ sistema: String((o.mensajes[0] as any).content), usuario: String((o.mensajes[1] as any).content) })
    return { texto: JSON.stringify(respuesta), llamadas: [], razonamiento: null, modelo: 'm', tokens: 10 }
  })
  return vistos
}

test('Fragua #235: Los Logos es una familia: nombre común sin esperar el bautismo, plantilla por rubro, un rubro un Logos', () => {
  const db = abrir(':memory:')
  const l = forjarLogos(db, { rubro: 'laboral' })
  assert.equal(l.agente.nombre, 'Los Logos · Laboral')
  assert.equal(l.agente.clase, 'generativo')
  assert.equal(l.rubro, 'Laboral')
  assert.match(l.sabe!, /convenios colectivos/)
  assert.deepEqual(l.deriva, ['Fiscal', 'Mercantil'])
  assert.match(leer(db, l.agenteId)!.instrucciones, /profesional de Laboral.*Fiscal, Mercantil/)
  assert.throws(() => forjarLogos(db, { rubro: 'Laboral' }), /Ya hay un Logos de Laboral/)
  assert.throws(() => forjarLogos(db, { rubro: 'Ambiental', fuentes: ['no-existe'] }), /No existe la fuente «no-existe»/)
  const otro = forjarLogos(db, { rubro: 'urbanismo', sabe: 'Licencias de obra y planeamiento', noSabe: 'Impuestos', deriva: ['Fiscal'] })
  assert.equal(otro.agente.nombre, 'Los Logos · Urbanismo')
  assert.deepEqual(listarLogos(db).map((x) => [x.nombre, x.conFuente]), [['Los Logos · Laboral', false], ['Los Logos · Urbanismo', false]])
})

test('Fragua #235: sin fuente cargada, el Logos lo declara antes de contestar (lo pone el código, no el modelo)', async () => {
  const db = abrir(':memory:')
  forjarLogos(db, { rubro: 'Fiscal' })
  const vistos = modelo({ respuesta: 'El IVA general es del 21 % [#99].', fuera_de_rubro: false })
  const r = await preguntarALogos(db, 'fiscal', '¿Qué IVA lleva una factura de servicios?')
  assert.equal(r.sinFuente, true)
  assert.ok(r.respuesta.startsWith(AVISO_SIN_FUENTE('Fiscal')), r.respuesta)
  assert.doesNotMatch(r.respuesta, /\[#99\]/, 'una cita que no viene de sus pasajes se borra')
  assert.deepEqual(r.citas, [])
  assert.match(vistos[0].sistema, /No tenés fuente cargada/)
})

test('Fragua #235: con fuente, contesta solo desde sus piezas y cita; lo que no es suyo lo deriva', async () => {
  const db = abrir(':memory:')
  asegurarFuente(db, { id: 'convenios', nombre: 'Convenios', nivel: 'primaria' })
  asegurarFuente(db, { id: 'otra', nombre: 'Otra', nivel: 'primaria' })
  const suya = insertar(db, { fuente: 'convenios', titulo: 'Convenio de oficinas · vacaciones', contenido: 'Las vacaciones anuales son de treinta días naturales por año trabajado.', nivel: 'primaria', origenId: 'c:1' })!
  const ajena = insertar(db, { fuente: 'otra', titulo: 'Blog · vacaciones', contenido: 'Las vacaciones anuales son de cuarenta días.', nivel: 'primaria', origenId: 'c:2' })!
  const l = forjarLogos(db, { rubro: 'Laboral', fuentes: ['convenios'] })
  assert.deepEqual(listarLogos(db)[0].fuentesEstado.map((x) => [x.vinculo.id, x.piezas]), [['convenios', 1]])

  const vistos = modelo({ respuesta: `Son treinta días naturales [#${suya}] y además dos de libre disposición [#${ajena}].`, fuera_de_rubro: false })
  const r = await preguntarALogos(db, 'Los Logos · Laboral', '¿Cuántos días de vacaciones anuales corresponden?')
  assert.equal(r.sinFuente, false)
  assert.match(vistos[0].usuario, new RegExp(`\\[#${suya}\\] Convenio de oficinas`))
  assert.doesNotMatch(vistos[0].usuario, /cuarenta/, 'la pieza de otra fuente no le llega')
  assert.deepEqual(r.citas, [suya], 'la cita de otra fuente se borra')
  assert.ok(!r.respuesta.startsWith('⚠'))
  assert.ok(leer(db, l.agenteId)!.ultimaCorrida, 'la consulta cuenta como corrida')

  modelo({ respuesta: 'Eso es de sociedades: no es mío.', fuera_de_rubro: true, deriva_a: 'Los Logos · Mercantil' })
  const fuera = await preguntarALogos(db, 'laboral', '¿Cómo convoco una junta de socios?')
  assert.deepEqual([fuera.fueraDeRubro, fuera.derivaA], [true, 'Los Logos · Mercantil'])

  modelo({ respuesta: 'No hay nada sobre horas extra.', fuera_de_rubro: false })
  const sinCita = await preguntarALogos(db, 'laboral', '¿Cómo se pagan las horas extra?')
  assert.match(sinCita.respuesta, /No encontré esto en tus fuentes de Laboral/)

  editarLogos(db, 'laboral', { fuentes: [] })
  assert.equal(listarLogos(db)[0].conFuente, false)
})

test('Fragua #235: un agente que ya existe entra con su nombre propio; los de la familia no se purgan por no correr', () => {
  const db = abrir(':memory:')
  const viejo = forjar(db, { clase: 'buscador', ahora: Date.now() - 30 * DIA })
  db.prepare('UPDATE agentes SET nombre = ? WHERE id = ?').run('El Observador', viejo.id)
  const l = sumarALogos(db, 'El Observador', { rubro: 'Lo vivo y el cielo', sabe: 'Plantas, animales y el cielo nocturno' })
  assert.equal(l.agente.nombre, 'El Observador')
  assert.equal(l.nombrePropio, true)
  assert.throws(() => sumarALogos(db, viejo.id, { rubro: 'Otro' }), /ya es de una familia/)
  // Otro buscador activo, así no es el último de su clase; días de liga sin correr.
  forjar(db, { clase: 'buscador' })
  for (let d = 1; d <= 10; d++) db.prepare(`INSERT INTO cronica (tick, tipo, texto, en) VALUES (?, 'tick', 'x', ?)`).run(d, Date.now() - d * DIA)
  purgar(db, Date.now())
  assert.ok(leer(db, viejo.id), 'sigue: se consulta a pedido')
})
