import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
const { abrir } = await import('../src/db.ts')
const { asegurarFuente, insertar } = await import('../src/corpus.ts')
const { asegurarEntidad, duplicadosProbables } = await import('../src/entidades.ts')
const gr = await import('../src/grafo/index.ts')
const sa = await import('../src/grafo/salud.ts')

const T = new Date(2026, 9, 18, 10).getTime()
const DIA = 86_400_000
// Dos grafías de lo mismo, en los mismos contextos: «voltaje» y «voltage».
const ELECTRICO = (v: string) => `El circuito tiene resistencia, corriente y ${v}. La resistencia frena la corriente del circuito. El ${v} empuja la corriente.`
const COCINA = 'La receta de pan lleva harina, levadura y horno. El horno cocina la harina de la receta. La levadura levanta la masa.'
const JARDIN = 'El jardín pide riego, semillas y abono. Las semillas brotan con riego. El abono alimenta las semillas del jardín.'

function base() {
  const db = abrir(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grafo-s-')), 'g.db'))
  asegurarFuente(db, { id: 'operador', nombre: 'Él', nivel: 'propia' })
  for (let i = 0; i < 6; i++) insertar(db, { fuente: 'operador', nivel: 'propia', titulo: `Circuitos ${i}`, contenido: ELECTRICO(i % 2 ? 'voltaje' : 'voltage'), origenId: `e${i}` }, T)
  for (let i = 0; i < 6; i++) insertar(db, { fuente: 'operador', nivel: 'propia', titulo: `Panes ${i}`, contenido: COCINA, origenId: `c${i}` }, T)
  return db
}

test('La salud: la semana queda en la historia; lo que cambió (nace un grupo) y el aviso del domingo; calibrar con 4 semanas', async () => {
  const db = base()
  const voz = gr.grafoPorClave(db, 'voz')
  await gr.recalcular(db, voz.id, { ahora: T })
  assert.equal(sa.semanas(db, voz.id).length, 1)
  assert.equal(sa.avisoSemanal(db, T), null, 'sin contra qué comparar, nada')
  for (let i = 0; i < 6; i++) insertar(db, { fuente: 'operador', nivel: 'propia', titulo: `Jardín ${i}`, contenido: JARDIN, origenId: `j${i}` }, T + 7 * DIA)
  await gr.recalcular(db, voz.id, { ahora: T + 7 * DIA })
  const s = sa.saludDe(db, voz.id)
  assert.equal(s.semanas.length, 2)
  assert.ok(s.cambios!.nacieron.some((t) => t.some((x) => /semillas|riego|jardín/.test(x))), 'nació el grupo del jardín')
  assert.equal(s.calibracion, null, 'a calibrar: menos de 4 semanas')
  assert.match(sa.avisoSemanal(db, T + 7 * DIA)!, /Tu grafo esta semana[\s\S]*naci/)

  const sem = (n: number, M: number, btw: number, grupo: number) => ({ semana: `2026-W${n}`, metricas: { M, C1: 0.3, C2: 0.9, E: 0.8, estado: 'diversificado' } as any, bisagras: [{ lema: 'mied', forma: 'miedo', btw, grupo }], grupos: [], en: 0 })
  const c = sa.calibracion([sem(4, 0.5, 0, 0), sem(3, 0.4, 0, 0), sem(2, 0.6, 0, 0), sem(1, 0.5, 0, 0)])!
  assert.deepEqual([c.M.min, c.M.max, c.habitual], [0.4, 0.6, 'diversificado'])
  assert.deepEqual(sa.bucles([sem(2, 0.5, 0.3, 10), sem(1, 0.5, 0.1, 10)]).map((b) => b.forma), ['miedo'], 'conecta más y su grupo no crece')
  assert.deepEqual(sa.bucles([sem(2, 0.5, 0.3, 20), sem(1, 0.5, 0.1, 10)]), [], 'si su grupo creció, no es bucle')
})

test('Alias: palabras y entidades que se usan igual y se escriben parecido; unificar las junta en la foto siguiente', async () => {
  assert.ok(sa.escrituraCompatible('voltaje', 'voltage'))
  assert.ok(sa.escrituraCompatible('depro', 'deprocast'))
  assert.ok(!sa.escrituraCompatible('casa', 'cosa'))
  assert.ok(!sa.escrituraCompatible('harina', 'horno'))
  assert.ok(!sa.escrituraCompatible('mundo', 'fondo') && !sa.escrituraCompatible('lindo', 'viendo'))
  assert.ok(sa.escrituraCompatible('servicios', 'services') && sa.escrituraCompatible('línea', 'líneas'))

  const db = base()
  const voz = gr.grafoPorClave(db, 'voz')
  const f = (await gr.recalcular(db, voz.id, { ahora: T }))!
  const al = sa.aliasSugeridos(db, f)
  assert.ok(al.some((x) => [x.a, x.b].sort().join() === 'voltage,voltaje'), JSON.stringify(al))

  const a = asegurarEntidad(db, { tipo: 'concepto', nombre: 'Voltaje' }, T), b = asegurarEntidad(db, { tipo: 'concepto', nombre: 'Voltage' }, T)
  asegurarEntidad(db, { tipo: 'concepto', nombre: 'Harina' }, T)
  const pares = sa.paresPorGrafo(db)
  assert.deepEqual(pares.map(([x, y]) => [x, y].sort().join()), [[a, b].sort().join()])
  const g = duplicadosProbables(db, 40, pares).find((x) => x.entidades.some((e) => e.id === a))!
  assert.match(g.motivo, /se usan igual en su grafo/)

  const x = al.find((y) => [y.a, y.b].includes('voltage'))!
  gr.editarDiccionario(db, { forma: x.a, tipo: 'alias', destino: x.b })
  const f2 = (await gr.recalcular(db, voz.id, { ahora: T + 1 }))!
  const formas = f2.nodos.map((n) => n.forma)
  assert.ok(formas.includes(x.b) && !formas.includes(x.a), 'una sola palabra')
})
