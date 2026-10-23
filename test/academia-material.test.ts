import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'

const { abrir } = await import('../src/db.ts')
const { asegurarFuente, insertar } = await import('../src/corpus.ts')
const sem = await import('../src/semantica.ts')
const ac = await import('../src/academia.ts')

const T = new Date(2026, 9, 23, 10).getTime()

/** El vectorizador falso: cada eje es un tema (electricidad, cosmos, cocina); el sentido sale de las palabras que aparecen. */
const EJES = [/ohm|resisten|corriente|circuito|voltaje|electric/gi, /cosmo|galaxia|universo|estrella/gi, /cocina|receta|horno/gi]
sem._probarEmbed(async (_db, textos) => ({
  modelo: 'falso',
  vectores: textos.map((t) => { const v = new Array(1024).fill(0.001); EJES.forEach((re, i) => { v[i] = (t.match(re) ?? []).length + 0.01 }); return v }),
}))

const pedidos: string[] = []
ac._probarAcademia({
  nube: () => false,
  alPedirVisual: () => {},
  modelo: async (_db, sistema, usuario) => {
    pedidos.push(usuario)
    if (/temario/.test(sistema)) return { temario: ['Ley de Ohm'] }
    return { tema: 'Ley de Ohm', explicacion: 'V = I·R [#1].', ejemplos: [], ideas: [], tarjetas: [], preguntas: [{ pregunta: '¿?', clave: 'k' }], visual: null }
  },
})

function pieza(db: any, titulo: string, contenido: string, nivel = 'primaria') {
  asegurarFuente(db, { id: 'web', nombre: 'Web', nivel: 'primaria' })
  return insertar(db, { fuente: 'web', nivel, titulo, contenido, estado: 'disponible', origenId: `t:${titulo}` }, T)!
}

test('El material se ata al dominio (link, texto, obra), no se duplica, y 👍/👎 o quitar cambian lo que usa el tutor', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electricidad' }, T)
  const apuntes = 'Apuntes de la ley de Ohm: la corriente que pasa por una resistencia es proporcional al voltaje. '.repeat(3)
  let m = await ac.sumarMaterial(db, d.id, { texto: apuntes, titulo: 'Mis apuntes de Ohm' }, T)
  assert.equal(m.length, 1)
  assert.deepEqual([m[0].origen, m[0].titulo], ['operador', 'Mis apuntes de Ohm'])
  const p = db.prepare('SELECT nivel, fuente, meta FROM corpus WHERE id = ?').get(m[0].piezaId) as any
  assert.deepEqual([p.nivel, p.fuente, JSON.parse(p.meta).dominio], ['primaria', 'material', d.id], 'material: no es su voz')
  m = await ac.sumarMaterial(db, d.id, { texto: apuntes }, T)
  assert.equal(m.length, 1, 'el mismo texto no entra dos veces')
  await assert.rejects(ac.sumarMaterial(db, d.id, { texto: 'corto' }, T), /un poco más de texto/)

  const obra = Number(db.prepare(`INSERT INTO obras (tipo, titulo, origen, huella, piezas, creada_en, editada_en) VALUES ('libro', 'Electrónica práctica', 'operador', 'h1', ?, ?, ?)`).run(JSON.stringify([m[0].piezaId]), T, T).lastInsertRowid)
  const libroSinPiezas = Number(db.prepare(`INSERT INTO obras (tipo, titulo, origen, huella, creada_en, editada_en) VALUES ('libro', 'El arte de la electrónica', 'operador', 'h2', ?, ?)`).run(T, T).lastInsertRowid)
  await ac.sumarMaterial(db, d.id, { obraId: obra }, T)
  m = await ac.sumarMaterial(db, d.id, { obraId: libroSinPiezas }, T)
  assert.deepEqual(m.map((x) => x.titulo).sort(), ['El arte de la electrónica', 'Mis apuntes de Ohm'], 'la obra con piezas ata sus piezas (sin duplicar); la que no, queda como obra')

  const ohm = m.find((x) => x.piezaId)!
  m = ac.marcarMaterial(db, d.id, ohm.id, { util: -1 })
  assert.equal(m.at(-1)!.util, -1, 'lo que no sirve va al final')
  assert.equal((await ac.materialParaClase(db, ac.leerDominio(db, d.id)!, 'Ley de Ohm')).ids.length, 0, 'y el tutor no lo usa')
  ac.marcarMaterial(db, d.id, ohm.id, { util: 0 })
  assert.deepEqual((await ac.materialParaClase(db, ac.leerDominio(db, d.id)!, 'Ley de Ohm')).ids, [ohm.piezaId], 'recién sumado, sin vectores: igual lo usa')
  m = ac.marcarMaterial(db, d.id, ohm.id, { quitar: true })
  assert.equal(m.length, 1)
  assert.ok(db.prepare('SELECT 1 FROM corpus WHERE id = ?').get(ohm.piezaId), 'quitarlo del dominio no lo borra del corpus')
})

test('Por sentido, no por palabra: el tutor lee su material y lo relacionado del archivo, y cita de dónde sale', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electricidad (prueba)' }, T)
  const cosmo = pieza(db, 'Pruebas cosmológicas', 'Las pruebas del universo en expansión: galaxias que se alejan, cada estrella corrida al rojo. '.repeat(4))
  const circuito = pieza(db, 'Un circuito en casa', 'El circuito de la lámpara: la corriente atraviesa la resistencia del filamento y el voltaje cae. '.repeat(4))
  const receta = pieza(db, 'Receta de pan', 'La receta de pan al horno, cocina de domingo. '.repeat(6))
  const [mio] = await ac.sumarMaterial(db, d.id, { texto: 'Capítulo 1. La ley de Ohm: voltaje, corriente y resistencia en un circuito. '.repeat(4), titulo: 'Libro: capítulo 1' }, T)

  // Sin vectores: lo relacionado solo si nombra el tema entero («prueba» no cuenta).
  let r = await ac.recursosDominio(db, ac.leerDominio(db, d.id)!)
  assert.ok(!r.piezas.some((p) => p.id === cosmo), '«Pruebas cosmológicas» no es de electricidad')

  // Con vectores (lo hace el Reproceso en la nube): por sentido.
  await sem.pasajesDe(db, [cosmo, circuito, receta, mio.piezaId!], T)
  r = await ac.recursosDominio(db, ac.leerDominio(db, d.id)!)
  assert.ok(r.piezas.some((p) => p.id === circuito && p.por.includes('sentido')), 'encuentra el circuito aunque no diga «electricidad»')
  assert.ok(!r.piezas.some((p) => p.id === cosmo || p.id === receta))
  assert.ok(!r.piezas.some((p) => p.id === mio.piezaId), 'lo atado va en «material», no repetido')

  const mat = await ac.materialParaClase(db, ac.leerDominio(db, d.id)!, 'Ley de Ohm')
  assert.equal(mat.ids[0], mio.piezaId, 'primero su material')
  assert.ok(mat.ids.includes(circuito) && !mat.ids.includes(cosmo))
  assert.match(mat.texto, new RegExp(`\\[#${mio.piezaId}\\] Libro: capítulo 1 \\(su material\\)`))

  const s = await ac.abrirSesionTutor(db, d.id, { ahora: T })
  assert.match(pedidos.at(-1)!, /Material \(basate en esto; citá \[#id\] donde lo uses\):\n\[#\d+\] Libro: capítulo 1/)
  assert.match(pedidos.at(-1)!, /El material que sumó para esto: Libro: capítulo 1/)
  assert.deepEqual(s.paquete.fuentes, mat.ids)
})

test('Lo que encuentra la búsqueda de fuentes también queda atado al dominio', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Drones' }, T)
  const a = pieza(db, 'Cómo vuela un cuadricóptero', 'x'.repeat(500))
  const b = pieza(db, 'Hélices y motores', 'y'.repeat(500))
  ac._probarFuentes({
    buscador: async () => [{ titulo: 'A', url: 'https://ej.org/a' }, { titulo: 'B', url: 'https://ej.org/b' }],
    guardador: async (_db, url) => ({ piezaId: url.endsWith('a') ? a : b, nueva: url.endsWith('a'), lectura: null }),
  })
  ac._probarAcademia({ modelo: async () => ({ consultas: ['drones intro'] }) })
  const r = await ac.buscarFuentes(db, d.id, { ahora: T })
  assert.equal(r.nuevas.length, 1)
  assert.deepEqual(ac.materialDe(db, d.id).map((m) => [m.piezaId, m.origen]).sort(), [[a, 'busqueda'], [b, 'busqueda']], 'la que ya estaba en el corpus también sirve para el dominio')
})
