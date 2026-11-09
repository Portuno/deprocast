import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { _probarEmbed, vectorDe } from '../src/semantica.ts'
import { _olvidarVectoresHerramientas, gruposPorSentido, prepararVectores } from '../src/chat/herramientas-sentido.ts'
import { HERRAMIENTAS } from '../src/chat/herramientas.ts'
import { anotarSugeridas, sugeridasParaPrompt } from '../src/chat/sugeridas.ts'
import { conversacionHoy } from '../src/chat/index.ts'

/** Un «embedding» de juguete: una dimensión por tema (correo, plata, salud…), por palabras. */
const TEMAS = [/mail|correo|contest|bandeja/i, /gasto|plata|finanz|cobr/i, /salud|dorm|comí|peso/i, /pregunta/i, /criba|frase/i]
const vecDe = (t: string) => { const v = new Array(1024).fill(0.001); TEMAS.forEach((re, i) => { if (re.test(t)) v[i] = 1 }); return v }

test('las herramientas por sentido (plan v38): el mensaje trae el grupo de lo que significa, aunque no diga la palabra clave', async () => {
  const db = abrir(':memory:')
  _probarEmbed(async (_db, textos) => ({ vectores: textos.map(vecDe), modelo: 'juguete' }))
  _olvidarVectoresHerramientas()
  assert.deepEqual(await gruposPorSentido(db, null), [], 'sin vector, nada')
  await prepararVectores(db)
  const n = (db.prepare('SELECT COUNT(*) AS n FROM vec_herramientas').get() as { n: number }).n
  assert.ok(n > 100, `los vectores de las herramientas quedan guardados (${n})`)
  const g = await gruposPorSentido(db, await vectorDe(db, '¿me contestó el contador lo de la bandeja?'))
  assert.ok(g.includes('correo'), `«contestó… bandeja» trae el correo: ${g.join(', ')}`)
  _probarEmbed(null)
})

test('lo que faltaba en el chat (plan v38): marcar un mail atendido, borrar un programado, responder una pregunta, votar la criba', async () => {
  const db = abrir(':memory:')
  const h = (n: string) => HERRAMIENTAS.find((x) => x.nombre === n)!
  db.prepare(`INSERT INTO correos (id, hilo, de, para, asunto, fecha, etiquetas, extracto, cuerpo, leido, suyo, ruido) VALUES ('m1', 'h1', 'Pedro Gómez <pedro@x.com>', 'yo', 'La factura de octubre', 1, '[]', '', '', 0, 0, 0)`).run()
  const r = await h('marcar_correo_atendido').ejecutar({ de: 'pedro' }, { db } as any) as any
  assert.equal(r.asunto, 'La factura de octubre')
  assert.equal((db.prepare('SELECT atendido FROM correos WHERE id = ?').get('m1') as any).atendido, 1)
  const { crearProgramado } = await import('../src/programados.ts')
  const p = crearProgramado(db, { pedido: 'Resumime los mails', cuando: 'todos los días a las 8' })
  await h('borrar_programado').ejecutar({ id: p.id }, { db } as any)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM programados').get() as any).n, 0)
  const { encolarPregunta } = await import('../src/preguntas.ts')
  encolarPregunta(db, { texto: '¿Cuántas horas dormís en promedio?' })
  const q = await h('responder_pregunta').ejecutar({ respuesta: 'Unas siete' }, { db } as any) as any
  assert.equal(q.respondida, true)
  for (const n of ['marcar_correo_atendido', 'borrar_programado', 'responder_pregunta', 'votar_criba']) assert.equal(h(n).familia, 'accion')
})

test('«ya está» también para lo que no es misión (plan v38): el prompt sabe qué mail, qué encargo o qué propuesta nombró', () => {
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  db.prepare(`INSERT INTO correos (id, hilo, de, para, asunto, fecha, etiquetas, extracto, cuerpo, leido, suyo, ruido) VALUES ('m9', 'h9', 'Ana', 'yo', 'Presupuesto de la obra', 1, '[]', '', '', 0, 0, 0)`).run()
  db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, creada_en) VALUES ('Feed aparte con tope', 'x', 'pantalla', 'media', 'abierta', 0)`).run()
  anotarSugeridas(db, cid, 'Te queda contestar el presupuesto de la obra y decidir el feed aparte con tope.')
  const p = sugeridasParaPrompt(db, cid)
  assert.match(p, /correo m9: «Presupuesto de la obra» \(si dice que ya contestó.*marcar_correo_atendido\)/)
  assert.match(p, /propuesta \d+: «Feed aparte con tope» \(.*resolver_propuestas\)/)
})
