import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { crearConversacion } from '../src/chat/index.ts'
import { HERRAMIENTAS, NUCLEO, ejecutarHerramienta } from '../src/chat/herramientas.ts'
import { adjuntosDe, buscarEnHilo } from '../src/chat/hilo.ts'

test('#271: el chat recupera lo de unos turnos antes del hilo (la foto del cartel de la parcela), aunque ya no esté en el historial', async () => {
  const db = abrir(':memory:')
  const c = crearConversacion(db)
  const ins = db.prepare('INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, ?, ?, ?)')
  const t0 = Date.UTC(2026, 10, 13, 12)
  ins.run(c.id, 'operador', '(Te mandé una foto por Telegram, ya leída entera y guardada en su corpus [#41]. Lo que dice:\nCartel: SE VENDE parcela 12, 800 m², tel. de la inmobiliaria)\nmirá este cartel', t0)
  ins.run(c.id, 'asistente', 'Es un cartel de venta de la parcela 12, de 800 m².', t0 + 1000)
  ins.run(c.id, 'operador', `¿y esto?\n[imagen:/adjuntos/1-abc.jpg|Una tier list con cinco niveles. (lectura entera: pieza #42)]`, t0 + 2000)
  for (let i = 0; i < 40; i++) ins.run(c.id, i % 2 ? 'asistente' : 'operador', `charla de relleno ${i}`, t0 + 3000 + i)
  ins.run(c.id, 'herramienta', 'parcela (salida de herramienta: no cuenta)', t0 + 9000)

  // Por palabras, sin tildes: encuentra la foto y la respuesta.
  const r = buscarEnHilo(db, c.id, { consulta: 'Parcela cartel' })
  assert.equal(r.total, 2)
  assert.deepEqual(r.mensajes.map((m) => m.quien), ['Mastropiero', 'operador'], 'del más nuevo al más viejo')
  assert.deepEqual(r.mensajes[1].adjuntos, [{ tipo: 'imagen', url: '', descripcion: 'Cartel: SE VENDE parcela 12, 800 m², tel. de la inmobiliaria', pieza: 41 }])
  assert.match(r.mensajes[1].cuando, /^2026-11-13 \d\d:\d\d$/)

  // Solo los adjuntos: las dos imágenes, con su pieza.
  const adj = buscarEnHilo(db, c.id, { adjuntos: true })
  assert.deepEqual(adj.mensajes.map((m) => m.adjuntos[0].pieza), [42, 41])
  assert.equal(adj.mensajes[0].texto, '¿y esto?\n(imagen adjunta)')

  // Si ninguno tiene todas las palabras, los que tienen más.
  assert.equal(buscarEnHilo(db, c.id, { consulta: 'parcela inexistentepalabra' }).mensajes.length, 2)
  // Sin consulta: los últimos, y se pagina hacia atrás.
  const ult = buscarEnHilo(db, c.id, { limite: 5 })
  assert.equal(ult.mensajes[0].texto, 'charla de relleno 39')
  assert.equal(buscarEnHilo(db, c.id, { limite: 5, antesDe: ult.mensajes.at(-1)!.id }).mensajes[0].texto, 'charla de relleno 34')

  // La herramienta, siempre a mano.
  assert.ok(NUCLEO.includes('buscar_en_hilo'))
  const h = await ejecutarHerramienta(HERRAMIENTAS, 'buscar_en_hilo', JSON.stringify({ consulta: 'parcela', quien: 'operador' }), { db, conversacionId: c.id })
  assert.equal((h.resultado as any).mensajes[0].adjuntos[0].pieza, 41)
  const nada = await ejecutarHerramienta(HERRAMIENTAS, 'buscar_en_hilo', JSON.stringify({ consulta: 'zzzz' }), { db, conversacionId: c.id })
  assert.match((nada.resultado as any).nota, /No hay nada así/)

  assert.deepEqual(adjuntosDe('[archivo:/adjuntos/2-x.pdf|informe.pdf|300 palabras]'), [{ tipo: 'archivo', url: '/adjuntos/2-x.pdf', descripcion: 'informe.pdf (300 palabras)', pieza: null }])
})
