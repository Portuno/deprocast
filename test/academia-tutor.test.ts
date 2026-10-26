import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'

const { abrir } = await import('../src/db.ts')
const co = await import('../src/conceptos.ts')
const ac = await import('../src/academia.ts')

const T = new Date(2026, 9, 26, 10).getTime()
const pedidos: { sistema: string; usuario: string }[] = []
const dichos: string[] = []
ac._probarAcademia({
  nube: () => false,
  alPedirVisual: () => {},
  hablar: async (_db, texto) => { dichos.push(texto); return `/adjuntos/tts-${dichos.length}.mp3` },
  transcribir: async (_db, audio) => audio.toString('utf8').replace(/^x+/, ''),
  modelo: async (_db, sistema, usuario) => {
    pedidos.push({ sistema, usuario })
    if (/mapa de conceptos/.test(sistema)) return { conceptos: [{ nombre: 'Carga', nivel: 1 }, { nombre: 'Corriente', nivel: 1, requisitos: ['Carga'] }] }
    if (/Corregís UNA respuesta/.test(sistema)) {
      const bien = /Respuesta del alumno: .*bien/.test(usuario)
      const intento = Number(/Intento: (\d)/.exec(usuario)![1])
      return { correcto: bien, devolucion: bien ? 'Bien.' : intento === 1 ? '¿Qué pasa si no hay cargas que se muevan?' : 'Es carga en movimiento.', concepto_flojo: bien ? null : 'Carga' }
    }
    if (/no entendí/.test(sistema)) return { texto: 'Pensalo como agua en una manguera.' }
    return { tema: 'Corriente', explicacion: '# Corriente\n\nLa corriente es carga que se mueve. Se mide en amperes [#3].\n\nUn ejemplo: una linterna.', ejemplos: [], ideas: [], tarjetas: [], visual: null, preguntas: [{ pregunta: '¿Qué es la corriente?', clave: 'carga en movimiento' }] }
  },
})

async function clase(db: any) {
  const d = ac.sumarDominio(db, { tema: 'Electricidad' }, T)
  await ac.armarMapa(db, d.id, T)
  db.prepare(`UPDATE conceptos SET dominio = 0.9 WHERE nombre = 'Carga'`).run()
  return { d, s: await ac.abrirSesionTutor(db, d.id, { ahora: T }) }
}

test('Socrático: el primer error recibe una pista (sin la respuesta), el segundo la explicación; en el examen no hay pistas', async () => {
  const db = abrir(':memory:')
  const { s } = await clase(db)
  assert.equal(s.tema, 'Corriente')
  const a = await ac.responderTutor(db, s.id, 0, 'no sé', T)
  assert.deepEqual([a.correcto, a.pista, a.intento], [false, true, 1])
  assert.match(pedidos.at(-1)!.usuario, /Intento: 1\n/)
  assert.match(pedidos.at(-1)!.sistema, /PRIMER intento: NO des la respuesta/)
  const b = await ac.responderTutor(db, s.id, 0, 'tampoco', T)
  assert.deepEqual([b.pista, b.intento, b.devolucion], [false, 2, 'Es carga en movimiento.'])
  const c = co.conceptoPorNombre(db, s.aprendizajeId, 'Corriente')!
  assert.equal(c.intentos, 1, 'solo el primer intento mueve el dominio')
  assert.ok(co.conceptoPorNombre(db, s.aprendizajeId, 'Carga')!.dominio < 0.9, 'el requisito flojo baja un poco (vuelve antes)')
  const ok = await ac.responderTutor(db, s.id, 0, 'está bien: carga que se mueve', T)
  assert.equal(ok.correcto, true)
  assert.equal(ac.turnosDe(db, s.id).length, 3)
})

test('«No entendí»: otra explicación más simple que queda en la sesión, baja el dominio y no cuenta como respuesta', async () => {
  const db = abrir(':memory:')
  const { d, s } = await clase(db)
  const antes = co.conceptoPorNombre(db, d.id, 'Corriente')!.dominio
  db.prepare(`UPDATE conceptos SET dominio = 0.5 WHERE nombre = 'Corriente'`).run()
  const a = await ac.aclarar(db, s.id, -1, T)
  assert.equal(a.texto, 'Pensalo como agua en una manguera.')
  assert.match(pedidos.at(-1)!.usuario, /Explicá al nivel 1 \(Niño de 10\)[\s\S]*No entendió la explicación/)
  await ac.aclarar(db, s.id, 0, T)
  assert.match(pedidos.at(-1)!.usuario, /No entendió esta pregunta: ¿Qué es la corriente\?/)
  await ac.aclarar(db, s.id, -1, T)
  assert.match(pedidos.at(-1)!.usuario, /Ya le dijiste \(probá otra cosa\): Pensalo como agua/, 'la segunda vez prueba otra cosa')
  assert.equal(ac.aclaracionesDe(db, s.id).length, 3)
  assert.equal(ac.turnosDe(db, s.id).length, 0, 'las aclaraciones no son respuestas')
  assert.ok(co.conceptoPorNombre(db, d.id, 'Corriente')!.dominio < 0.5 && antes === 0)
  await ac.responderTutor(db, s.id, 0, 'bien', T)
  const c = ac.cerrarSesionTutor(db, s.id, T + 60_000)
  assert.equal(c.puntaje, 1)
  assert.match((db.prepare('SELECT contenido FROM corpus WHERE id = ?').get(c.piezaId) as any).contenido, /## Lo que no entendí y cómo me lo explicó\n- Pensalo como agua/)
})

test('La voz: la explicación en tramos sin markdown ni citas, la pregunta, y responder hablando', async () => {
  const db = abrir(':memory:')
  const { s } = await clase(db)
  dichos.length = 0
  const urls = await ac.audiosDe(db, s.id, { parte: 'explicacion' })
  assert.equal(urls.length, dichos.length)
  assert.ok(dichos.join(' ').includes('La corriente es carga que se mueve. Se mide en amperes.'))
  assert.ok(!dichos.some((x) => /#|\[#/.test(x)), 'sin «#» ni citas')
  assert.ok(dichos.every((x) => x.length <= 500))
  assert.deepEqual(ac.tramosParaDecir('Uno. '.repeat(300)).every((x) => x.length <= 500), true)
  await ac.audiosDe(db, s.id, { parte: 'pregunta', i: 0 })
  assert.equal(dichos.at(-1), '¿Qué es la corriente?')

  const r = await ac.responderTutorAudio(db, s.id, 0, Buffer.from('x'.repeat(2000) + 'está bien, es carga'), 'r.webm', T)
  assert.deepEqual([r.transcripcion, r.correcto], ['está bien, es carga', true])
  await assert.rejects(ac.responderTutorAudio(db, s.id, 0, Buffer.from('x'), 'r.webm', T), /vacío/)
})
