import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
const { abrir } = await import('../src/db.ts')
const { asegurarFuente, insertar } = await import('../src/corpus.ts')
const { crearQuantomo } = await import('../src/quantomos.ts')
const { robar } = await import('../src/mano.ts')
const { crearAprendizaje } = await import('../src/aprender.ts')
const gr = await import('../src/grafo/index.ts')
const mp = await import('../src/grafo/mapa.ts')
const { HERRAMIENTAS, GRUPOS, gruposDelMensaje } = await import('../src/chat/herramientas.ts')

const T = new Date(2026, 9, 26, 10).getTime()
const ELECTRICO = 'El circuito tiene resistencia, corriente y voltaje. La resistencia frena la corriente del circuito. El voltaje empuja la corriente.'
const COCINA = 'La receta de pan lleva harina, levadura y horno. El horno cocina la harina de la receta. La levadura levanta la masa.'

async function base() {
  const db = abrir(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grafo-m-')), 'g.db'))
  asegurarFuente(db, { id: 'operador', nombre: 'Él', nivel: 'propia' })
  for (let i = 0; i < 6; i++) insertar(db, { fuente: 'operador', nivel: 'propia', titulo: `Circuitos ${i}`, contenido: ELECTRICO, origenId: `e${i}` }, T)
  for (let i = 0; i < 6; i++) insertar(db, { fuente: 'operador', nivel: 'propia', titulo: `Panes ${i}`, contenido: COCINA, origenId: `c${i}` }, T)
  await gr.recalcular(db, gr.grafoPorClave(db, 'voz').id, { ahora: T })
  return db
}

const pedidos: string[] = []
mp._probarMapa({
  modelo: async (_db, _s, usuario) => {
    pedidos.push(usuario)
    const n = (usuario.match(/^Grupo \d+:/gm) ?? []).length
    return { zonas: Array.from({ length: n }, (_, k) => ({ n: k + 1, titulo: /circuito|corriente|resistencia/.test(usuario.split(/^Grupo \d+:/m)[k + 1]) ? 'Electricidad' : 'Panadería', resumen: 'De qué va esta zona.' })) }
  },
})

test('ver_grafo, conectar_conceptos y preguntar_al_corpus: zonas con resumen cacheado, camino con pasajes y preguntas globales ancladas', async () => {
  const db = await base()
  const v = await mp.verGrafo(db) as any
  assert.equal(v.grafo, 'Tu voz')
  assert.ok(v.zonas.length >= 2 && v.zonas.every((z: any) => !z.titulo), 'todavía sin resumen')
  assert.ok(v.huecos.length >= 1, 'el hueco electricidad ↔ cocina')

  const mismo = await mp.conectarConceptos(db, 'corriente', 'voltaje') as any
  assert.equal(mismo.mismo_grupo, true)
  assert.ok(mismo.juntos.length >= 1 && mismo.juntos[0].pieza, 'con pasajes y su pieza')
  const lejos = await mp.conectarConceptos(db, 'corriente', 'harina') as any
  assert.equal(lejos.camino, null)
  assert.match(lejos.lectura, /hueco/)
  assert.ok((await mp.conectarConceptos(db, 'corriente', 'teleférico') as any).error)

  const r = await mp.preguntarAlCorpus(db, '¿Qué digo de la harina y el horno?') as any
  assert.equal(pedidos.length, 1, 'los resúmenes que faltaban, en una sola llamada')
  assert.match(pedidos[0], /Grupo 1: [\s\S]*- /, 'con pasajes de cada grupo')
  assert.equal(r.zonas[0].titulo, 'Panadería', 'primero la zona que toca la pregunta')
  assert.ok(r.zonas[0].toca_la_pregunta.includes('harina'))
  assert.ok(r.zonas[0].pasajes.length >= 1)
  await mp.preguntarAlCorpus(db, '¿Cuáles son mis temas?')
  assert.equal(pedidos.length, 1, 'cacheado: la comunidad no cambió')
  assert.ok((await mp.verGrafo(db) as any).zonas.every((z: any) => z.titulo))

  // Viajan con el grupo «grafo», que el mensaje ya anuncia.
  for (const h of ['ver_grafo', 'conectar_conceptos', 'preguntar_al_corpus']) assert.ok(HERRAMIENTAS.some((x) => x.nombre === h) && GRUPOS.grafo.includes(h))
  assert.ok(gruposDelMensaje('¿cuáles son mis temas?').includes('grafo'))
})

test('En tu grafo (La Mano): nuevo, refuerza, cierra un hueco; y la frontera de un dominio usa los huecos del grafo de su material', async () => {
  const db = await base()
  assert.equal(mp.enTuGrafo(db, 'La resistencia frena la corriente del circuito')!.tipo, 'refuerza')
  assert.equal(mp.enTuGrafo(db, 'Mañana viajo a Japón con amigos queridos')!.tipo, 'nuevo')
  const c = mp.enTuGrafo(db, 'La corriente del horno y la resistencia cocinan la harina de la receta')!
  assert.equal(c.tipo, 'cierra')
  assert.ok(c.hueco)

  const q = crearQuantomo(db, { texto: 'El voltaje empuja la corriente por la resistencia', etapa: 'proto' }, T)
  const carta = robar(db, { ahora: T }).find((x) => x.id === q)!
  assert.equal(carta.grafo?.tipo, 'refuerza', 'la carta trae lo que hace en su grafo')

  const a = crearAprendizaje(db, { tema: 'Física y cocina' }, T)
  assert.equal(mp.mapaDelDominio(db, a.id), null, 'sin grafo del material todavía')
  asegurarFuente(db, { id: 'material', nombre: 'Material', nivel: 'primaria' })
  for (let i = 0; i < 5; i++) insertar(db, { fuente: 'material', nivel: 'primaria', titulo: `Apunte ${i}`, contenido: i % 2 ? ELECTRICO : COCINA, origenId: `m${i}`, meta: { dominio: a.id } }, T)
  const txt = await mp.fronteraDelDominio(db, a)
  assert.match(txt, /Huecos del grafo de su material[\s\S]*↔/)
  assert.ok(mp.mapaDelDominio(db, a.id)!.huecos.length >= 1)
})
