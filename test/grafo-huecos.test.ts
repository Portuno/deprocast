import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
const { abrir } = await import('../src/db.ts')
const { asegurarFuente, insertar } = await import('../src/corpus.ts')
const gr = await import('../src/grafo/index.ts')
const hu = await import('../src/grafo/huecos.ts')

const T = new Date(2026, 9, 26, 10).getTime()
const ELECTRICO = 'El circuito tiene resistencia, corriente y voltaje. La resistencia frena la corriente del circuito. El voltaje empuja la corriente.'
const COCINA = 'La receta de pan lleva harina, levadura y horno. El horno cocina la harina de la receta. La levadura levanta la masa.'

function base() {
  const db = abrir(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grafo-h-')), 'g.db'))
  asegurarFuente(db, { id: 'operador', nombre: 'Él', nivel: 'propia' })
  for (let i = 0; i < 6; i++) insertar(db, { fuente: 'operador', nivel: 'propia', titulo: `Circuitos ${i}`, contenido: ELECTRICO, origenId: `e${i}` }, T)
  for (let i = 0; i < 6; i++) insertar(db, { fuente: 'operador', nivel: 'propia', titulo: `Panes ${i}`, contenido: COCINA, origenId: `c${i}` }, T)
  return db
}

const pedidos: string[] = []
hu._probarHuecosGrafo({
  modelo: async (_db, _s, usuario) => { pedidos.push(usuario); return { pregunta: '¿Qué tiene en común fermentar una masa con cargar una batería?', por_que: 'Los dos guardan energía.', puentes: ['energía', 'tiempo'], toca_proyectos: true, consultas: ['fermentación y energía'] } },
  buscador: async () => [{ titulo: 'Energía en la cocina', url: 'https://ej.org/energia' }],
  guardador: async () => ({ piezaId: 1, nueva: true, lectura: null }),
})

test('Los huecos de una foto se siguen: pregunta (con pasajes de los dos lados), respuesta a La Mano, agente, La Fragua y descartar', async () => {
  const db = base()
  const voz = gr.grafoPorClave(db, 'voz')
  await gr.recalcular(db, voz.id, { ahora: T })
  const hs = hu.huecosDe(db, voz.id)
  assert.ok(hs.length >= 1, 'el hueco entre circuitos y panes entró a seguimiento')
  const h = hs.find((x) => [...x.terminosA, ...x.terminosB].some((t) => /corriente|resistencia|circuito/.test(t)) && [...x.terminosA, ...x.terminosB].some((t) => /harina|horno|receta/.test(t)))!
  assert.ok(h, 'es el de electricidad ↔ cocina')
  assert.equal(h.estado, 'abierto')

  const p = await hu.preguntarHueco(db, h.id)
  assert.match(p.pregunta!, /fermentar una masa/)
  assert.match(pedidos.at(-1)!, /Grupo A: [\s\S]*- [\s\S]*Grupo B: /, 'con pasajes de cada lado')
  assert.equal((await hu.preguntarHueco(db, h.id)).pregunta, p.pregunta, 'no se vuelve a pedir')
  assert.equal(pedidos.length, 1)

  assert.throws(() => hu.responderHueco(db, h.id, 'corto'), /un poco más/)
  const r = hu.responderHueco(db, h.id, 'Las dos cosas acumulan energía que después se libera: la levadura con gas, la pila con carga.', T)
  assert.equal(r.estado, 'en_curso')
  const pieza = db.prepare('SELECT nivel, fuente, contenido FROM corpus WHERE id = ?').get(r.piezaId) as any
  assert.deepEqual([pieza.nivel, pieza.fuente], ['propia', 'grafo'])
  assert.match(pieza.contenido, /^> ¿Qué tiene en común fermentar/)
  assert.equal((db.prepare('SELECT etapa FROM quantomos WHERE id = ?').get(r.quantomo) as any).etapa, 'proto', 'La Mano lo pesa')

  const inv = await hu.investigarHueco(db, h.id, T)
  assert.deepEqual(inv.guardadas, ['https://ej.org/energia'])
  assert.deepEqual(hu.leerHueco(db, h.id)!.agente!.urls, ['https://ej.org/energia'])
  const f1 = hu.aLaFragua(db, h.id, T)
  assert.equal(hu.aLaFragua(db, h.id, T).propuestaId, f1.propuestaId, 'una sola propuesta por hueco')
  assert.equal((db.prepare('SELECT origen FROM propuestas WHERE id = ?').get(f1.propuestaId) as any).origen, 'grafo')
  assert.match(hu.huecosParaPrompt(db), /fermentar una masa/)
  hu.descartarHueco(db, h.id)
  assert.ok(!hu.huecosDe(db, voz.id).some((x) => x.id === h.id))
})

test('Re-tejer: cuando escribe algo que une los dos grupos, la foto siguiente ve el hueco cerrado', async () => {
  const db = base()
  const voz = gr.grafoPorClave(db, 'voz')
  await gr.recalcular(db, voz.id, { ahora: T })
  const h = hu.huecosDe(db, voz.id)[0]
  assert.equal(h.historia.length, 1, 'la primera foto ya deja su puente')
  for (let i = 0; i < 8; i++) insertar(db, { fuente: 'operador', nivel: 'propia', titulo: `Puente ${i}`, contenido: 'La corriente del horno y la resistencia del horno cocinan la harina; el voltaje del horno calienta la receta.', origenId: `p${i}` }, T)
  await gr.recalcular(db, voz.id, { ahora: T + 1 })
  const despues = hu.leerHueco(db, h.id)!
  assert.equal(despues.historia.length, 2)
  assert.equal(despues.estado, 'cerrado')
})

test('el ciclo del hueco (Fragua #197): el Grafeador propone su próximo trabajo; la respuesta deja su propuesta en La Fragua con la pieza citada, y el delta desde la respuesta', async () => {
  const db = base()
  const voz = gr.grafoPorClave(db, 'voz')
  await gr.recalcular(db, voz.id, { ahora: T })
  let pidioFuncionalidad = 0
  hu._probarHuecosGrafo({
    modelo: async (_db, sistema, usuario) => {
      if (/FUNCIONALIDAD/.test(sistema)) { pidioFuncionalidad++; return /pila/.test(usuario) ? { funcionalidad: { titulo: 'Avisar cuando dos grupos del grafo se tocan', detalle: 'Que el chat avise cuando una idea nueva une dos grupos. Hecho: llega el aviso.', area: 'chat' } } : { funcionalidad: null } }
      return { pregunta: '¿Qué tiene en común fermentar una masa con cargar una batería?', por_que: 'Energía.', puentes: ['energía guardada'], toca_proyectos: false, consultas: [] }
    },
  })
  const h = hu.huecosDe(db, voz.id)[0]
  assert.equal(hu.proximoTrabajo(db, voz.id).accion, 'preguntar')
  await hu.preguntarHueco(db, h.id)
  assert.equal(hu.proximoTrabajo(db, voz.id).accion, 'responder')
  const r = hu.responderHueco(db, h.id, 'Las dos cosas acumulan energía: la levadura con gas, la pila con carga. Me gustaría que me avise cuando pase algo así.', T + 1)
  const g = hu.proximoTrabajo(db, voz.id)
  assert.deepEqual([g.accion, g.hueco], ['derivar', h.id])
  const d = await hu.derivarDeRespuesta(db, h.id, T + 2)
  const p = db.prepare('SELECT titulo, detalle, area, origen FROM propuestas WHERE id = ?').get(d.propuestaId) as any
  assert.equal(p.titulo, 'Avisar cuando dos grupos del grafo se tocan')
  assert.ok(p.detalle.includes(`Sale de su respuesta [#${r.piezaId}] al hueco del grafo`), p.detalle)
  assert.deepEqual([p.area, p.origen], ['chat', 'grafo'])
  assert.equal((await hu.derivarDeRespuesta(db, h.id)).propuestaId, d.propuestaId, 'una sola por hueco')
  assert.equal(pidioFuncionalidad, 1)
  // El ciclo siguiente: lo que escribió une los grupos y el delta se ve desde la respuesta.
  assert.equal(hu.proximoTrabajo(db, voz.id).accion, 'mirar')
  for (let i = 0; i < 8; i++) insertar(db, { fuente: 'operador', nivel: 'propia', titulo: `Puente ${i}`, contenido: 'La corriente del horno y la resistencia del horno cocinan la harina; el voltaje del horno levanta la levadura.', origenId: `p${i}` }, T + 10)
  await gr.recalcular(db, voz.id, { ahora: T + 20 })
  const delta = hu.deltaDe(db, hu.leerHueco(db, h.id)!)
  assert.ok(delta.desdeRespuesta != null && delta.hoy != null && delta.hoy > delta.desdeRespuesta, `el puente creció desde la respuesta: ${JSON.stringify(delta)}`)
})

test('el ciclo del hueco: una respuesta que no pide nada del sistema no arma propuesta', async () => {
  const db = base()
  const voz = gr.grafoPorClave(db, 'voz')
  await gr.recalcular(db, voz.id, { ahora: T })
  const h = hu.huecosDe(db, voz.id)[0]
  await hu.preguntarHueco(db, h.id)
  hu.responderHueco(db, h.id, 'Es que los dos me gustan los domingos: cocinar y arreglar cosas de la casa.', T + 1)
  assert.equal((await hu.derivarDeRespuesta(db, h.id)).propuestaId, null)
  assert.equal(hu.leerHueco(db, h.id)!.propuestaId, null)
})
