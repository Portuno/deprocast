import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarFuente, insertar, retirarPieza } from '../src/corpus.ts'
import { crearQuantomo, leerQuantomo } from '../src/quantomos.ts'
import { grafoPorClave } from '../src/grafo/index.ts'
import { bandeja, resolverBandeja } from '../src/sombra.ts'
import { ACCIONES } from '../src/rutinas.ts'
import { ORGANOS } from '../src/esqueleto.ts'
import { _probarSonador, leerSueno, listarSuenos, proponerFusiones, proponerPoda, proponerPuentes, sonar } from '../src/sonador.ts'

const DIA = 86_400_000
const AHORA = Date.UTC(2026, 10, 17, 3, 50)

function escenario() {
  const db = abrir(':memory:')
  asegurarFuente(db, { id: 'voz', nombre: 'Notas de voz', nivel: 'propia' })
  const p = (titulo: string, contenido: string) => insertar(db, { fuente: 'voz', nivel: 'propia', titulo, contenido })!
  return { db, p }
}

test('El Soñador · poda: solo los proto sin pieza viva, viejos y sin peso; aceptar los descarta (no los borra)', async () => {
  const { db, p } = escenario()
  const viva = p('Audio · taller', 'El taller de IA para abogados.')
  const muerta = p('Audio · viejo', 'Algo que después retiré.')
  retirarPieza(db, muerta, 'era ruido')
  const viejo = AHORA - 40 * DIA
  const sinPieza = crearQuantomo(db, { texto: 'Una idea suelta sin pieza.' }, viejo)!
  const deRetirada = crearQuantomo(db, { texto: 'Algo de la pieza retirada.', piezaId: muerta }, viejo)!
  const deViva = crearQuantomo(db, { texto: 'El taller sigue.', piezaId: viva }, viejo)!
  const reciente = crearQuantomo(db, { texto: 'Reciente sin pieza.' }, AHORA - 2 * DIA)!
  const conPeso = crearQuantomo(db, { texto: 'Pesado sin pieza.', peso: 8 }, viejo)!

  const ids = proponerPoda(db, AHORA)
  assert.equal(ids.length, 1)
  const s = leerSueno(db, ids[0])!
  assert.deepEqual(s.quantomos.sort(), [sinPieza, deRetirada].sort())
  assert.ok(![deViva, reciente, conPeso].some((x) => s.quantomos.includes(x)))
  assert.equal(proponerPoda(db, AHORA).length, 0, 'la misma poda no se repite')

  // En la bandeja; aceptar la descarta con su rastro (la fila queda).
  const g = bandeja(db, AHORA).grupos.find((x) => x.tipo === 'sueno')!
  assert.match(g.items[0].texto, /^✂ Podar: 2 proto sin una pieza viva/)
  await resolverBandeja(db, 'sueno', s.id, 'aceptar', AHORA)
  assert.equal(leerQuantomo(db, sinPieza)!.etapa, 'descartado')
  assert.match(leerQuantomo(db, sinPieza)!.procedencia ?? '', /poda del Soñador/)
  assert.equal(leerQuantomo(db, deViva)!.etapa, 'proto')
})

test('El Soñador · consolidación: los repetidos se juntan en un proto nuevo con sus evidencias; nunca sella', async () => {
  const { db, p } = escenario()
  const a = p('Audio · lunes', 'Quiero un taller de IA para abogados.')
  const b = p('Audio · jueves', 'Lo del taller para abogados, de nuevo.')
  const raiz = crearQuantomo(db, { texto: 'Armar un taller de IA para abogados.', piezaId: a }, AHORA)!
  const rep = crearQuantomo(db, { texto: 'Hacer el taller de IA para abogados.', piezaId: b }, AHORA)!
  db.prepare(`UPDATE quantomos SET novedad = 'repetida', novedad_de = ? WHERE id = ?`).run(raiz, rep)
  const vistos: string[] = []
  _probarSonador(async (_db, _s, u) => { vistos.push(u); return 'Armar un taller de IA para abogados (lo dijo dos veces).' })
  const [id] = await proponerFusiones(db, AHORA)
  assert.match(vistos[0], new RegExp(`\\[${raiz}\\] Armar.*\\n- \\[${rep}\\] Hacer`))
  const s = leerSueno(db, id)!
  assert.deepEqual(s.evidencias.map((e) => e.piezaId), [a, b])
  await resolverBandeja(db, 'sueno', id, 'aceptar', AHORA)
  const nuevo = db.prepare(`SELECT * FROM quantomos WHERE origen_id = ?`).get(`sonador:${id}`) as any
  assert.equal(nuevo.etapa, 'proto', 'nunca sella')
  assert.equal(nuevo.peso, null)
  assert.match(nuevo.procedencia, new RegExp(`fusión de #${raiz}, #${rep} · evidencias #${a}, #${b}`))
  assert.equal(leerQuantomo(db, rep)!.etapa, 'superado')
  assert.equal(leerQuantomo(db, rep)!.padreId, nuevo.id)
})

test('El Soñador · puentes: con una cita real de cada lado, o se descarta solo; aprende de lo que él descarta', async () => {
  const { db, p } = escenario()
  const a1 = p('Audio · abogados', 'El derecho laboral y los convenios colectivos me interesan para el taller.')
  const b1 = p('Audio · drones', 'Los drones agrícolas miden el riego con sensores.')
  const g = grafoPorClave(db, 'voz')
  const hueco = (firma: string, ta: string[], tb: string[]) => db.prepare(`INSERT INTO grafo_huecos (grafo_id, firma, terminos_a, terminos_b, bisagras, puntaje, puente, estado, creado_en, actualizado_en) VALUES (?, ?, ?, ?, '[]', 1, 0.1, 'abierto', ?, ?)`).run(g.id, firma, JSON.stringify(ta), JSON.stringify(tb), AHORA, AHORA)
  hueco('h1', ['derecho', 'convenios', 'laboral'], ['drones', 'riego', 'sensores'])

  // Sin citar los dos lados: se descarta solo, no llega a la bandeja.
  _probarSonador(async () => `Los convenios podrían regular los drones [#${a1}].`)
  let r = await proponerPuentes(db, AHORA)
  assert.deepEqual(r, { propuestos: [], descartadosSolos: 1 })
  _probarSonador(async () => 'SIN PUENTE')
  assert.equal((await proponerPuentes(db, AHORA)).descartadosSolos, 1)

  // Con una de cada lado: propuesta con sus evidencias y sus lados.
  _probarSonador(async () => `Los convenios del campo [#${a1}] podrían fijar quién responde por los datos de riego que miden los drones [#${b1}].`)
  r = await proponerPuentes(db, AHORA)
  assert.equal(r.propuestos.length, 1)
  const s = leerSueno(db, r.propuestos[0])!
  assert.deepEqual(s.evidencias.map((e) => [e.piezaId, e.lado]), [[a1, 'A'], [b1, 'B']])

  // Él lo descarta: un hueco parecido (las mismas zonas) no vuelve a tener puente.
  await resolverBandeja(db, 'sueno', s.id, 'descartar', AHORA)
  hueco('h2', ['derecho', 'convenios', 'contratos'], ['drones', 'riego', 'agua'])
  assert.equal((await proponerPuentes(db, AHORA)).propuestos.length, 0, 'aprendió que ese puente no le sirve')
  assert.equal(listarSuenos(db, 'descartada').length, 1)
})

test('El Soñador · la noche: corre como rutina y es un órgano de la Matriz (Memoria · Procesa · Mente)', async () => {
  const { db } = escenario()
  _probarSonador(async () => 'SIN PUENTE')
  assert.deepEqual(await sonar(db, AHORA), { poda: 0, fusiones: 0, puentes: 0, descartadosSolos: 0 })
  assert.equal(await ACCIONES.sonador(db, '2026-11-17', AHORA), null, 'sin nada que proponer no deja mensaje')
  assert.ok(db.prepare(`SELECT 1 FROM rutinas WHERE id = 'sonador'`).get())
  const o = ORGANOS.find((x) => x.id === 'sonador')!
  assert.equal(o.celda, 3 * 9 + 4 + 1)
})
