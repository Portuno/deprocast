import { test } from 'node:test'
import assert from 'node:assert/strict'

const tx = await import('../src/grafo/texto.ts')
const { construirRed } = await import('../src/grafo/construir.ts')
const md = await import('../src/grafo/medidas.ts')
const { acomodar } = await import('../src/grafo/layout.ts')
const { calcular, huecosEstructurales } = await import('../src/grafo/calcular.ts')

test('Las raíces (Snowball castellano): las flexiones son el mismo nodo', () => {
  const pares: [string, string][] = [['barcos', 'barc'], ['barco', 'barc'], ['corriendo', 'corr'], ['nacionalidad', 'nacional'], ['resistencias', 'resistent'], ['eléctrico', 'electr'], ['proyectos', 'proyect'], ['aprendiendo', 'aprend'], ['comprándolas', 'compr'], ['quántomos', 'quantom']]
  for (const [w, r] of pares) assert.equal(tx.raiz(w), r, w)
})

test('Los lemas: sin palabras-puente ni formato; lo protegido entra entero; los alias se unifican solo si él los declara', () => {
  const dic = tx.diccionarioVacio()
  const formas = new Map<string, Map<string, number>>()
  assert.deepEqual(tx.lemas('Speaker 1: el barco y los barcos del Náutico, parece que no', dic, formas), ['barc', 'barc', 'nautic'])
  assert.equal(tx.formaDe(formas, 'barc'), 'barco')
  dic.alias.set('nautico', 'club náutico')
  dic.proteger.add('criba')
  dic.stop.add('barco')
  assert.deepEqual(tx.lemas('La criba del Náutico; el barco', dic), ['criba', 'club náutico'], 'criba no se corta; Náutico → su alias; barco frenado')
  dic.proteger.add('parte')
  assert.deepEqual(tx.lemas('una parte', dic), ['parte'], 'lo protegido gana a la lista de genéricas')
  assert.match(tx.limpiar('ver https://x.org y [#12] **ojo** 2026'), /^ver\s+y\s+ojo\s+$/)
})

test('La red: 3 a distancia 1, 2 a distancia 2, 1 a distancia 3; no cruza párrafos; las repetidas suman', () => {
  const r = construirRed([{ id: 1, texto: 'alfa beta gama delta\n\nalfa beta' }], { maxNodos: 10 })
  const peso = (a: string, b: string) => {
    const ia = r.nodos.findIndex((n) => n.forma === a), ib = r.nodos.findIndex((n) => n.forma === b)
    return r.aristas.find(([x, y]) => (x === ia && y === ib) || (x === ib && y === ia))?.[2] ?? 0
  }
  assert.equal(peso('alfa', 'beta'), 6, '3 + 3 (dos veces seguidos)')
  assert.equal(peso('alfa', 'gama'), 2)
  assert.equal(peso('alfa', 'delta'), 1)
  assert.equal(peso('beta', 'delta'), 2)
  const conPuente = construirRed([{ id: 1, texto: 'alfa beta\n\ngama delta' }], { puenteParrafos: true })
  const sinPuente = construirRed([{ id: 1, texto: 'alfa beta\n\ngama delta' }])
  assert.equal(sinPuente.aristas.length, 2)
  assert.equal(conPuente.aristas.length, 3, 'el último de un párrafo con el primero del siguiente')
})

/** Dos grupos de 4 bien unidos por dentro y un solo puente débil entre ellos (3 ↔ 4). */
const dosGrupos: [number, number, number][] = [[0, 1, 3], [0, 2, 3], [0, 3, 3], [1, 2, 3], [1, 3, 3], [2, 3, 3], [4, 5, 3], [4, 6, 3], [4, 7, 3], [5, 6, 3], [5, 7, 3], [6, 7, 3], [3, 4, 1]]

test('Las medidas: intermediación de Brandes, comunidades de Louvain con su modularidad, componentes y entropía', () => {
  // Un camino a-b-c: b está en el único camino entre a y c.
  const camino = md.adyacencia(3, [[0, 1, 1], [1, 2, 1]])
  assert.deepEqual(md.intermediacion(3, camino), [0, 1, 0])
  const g = md.adyacencia(8, dosGrupos)
  const btw = md.intermediacion(8, g)
  assert.ok(btw[3] > btw[0] && btw[4] > btw[7], 'los extremos del puente son las bisagras')
  // Pesos: costo = 1/peso. Un rodeo fuerte gana a un atajo débil.
  const rodeo = md.intermediacion(4, md.adyacencia(4, [[0, 3, 1], [0, 1, 10], [1, 2, 10], [2, 3, 10]]))
  assert.ok(rodeo[1] > 0 && rodeo[2] > 0, 'el camino de 0 a 3 va por 1 y 2 (más co-ocurrencia = más cerca)')

  const { comunidad, modularidad } = md.comunidades(8, dosGrupos)
  assert.equal(new Set(comunidad.slice(0, 4)).size, 1)
  assert.equal(new Set(comunidad.slice(4)).size, 1)
  assert.notEqual(comunidad[0], comunidad[4])
  assert.ok(Math.abs(modularidad - md.modularidad(8, dosGrupos, [0, 0, 0, 0, 1, 1, 1, 1])) < 1e-9)
  assert.ok(modularidad > 0.4, `M = ${modularidad}`)

  assert.deepEqual(md.componentes(5, md.adyacencia(5, [[0, 1, 1], [1, 2, 1], [3, 4, 1]])), [0, 0, 0, 1, 1])
  assert.equal(md.entropia([0, 0, 0, 0]), 0, 'toda la influencia en un grupo')
  assert.equal(md.entropia([0, 1, 0, 1]), 1, 'repartida parejo')
  assert.equal(md.estadoDiscurso({ M: 0.1, C1: 0.9, C2: 1, E: 0.2 }), 'sesgado')
  assert.equal(md.estadoDiscurso({ M: 0.5, C1: 0.3, C2: 0.95, E: 0.8 }), 'diversificado')
  assert.equal(md.estadoDiscurso({ M: 0.5, C1: 0.6, C2: 0.95, E: 0.8 }), 'enfocado')
  assert.equal(md.estadoDiscurso({ M: 0.7, C1: 0.2, C2: 0.5, E: 0.9 }), 'disperso')
})

test('Los huecos: el par de grupos densos que no se tocan va primero, con sus términos y sus bisagras', () => {
  // Tres grupos: A y B con un puente; C suelto de A y apenas tocando a B.
  const lados: [number, number, number][] = [...dosGrupos, [8, 9, 3], [8, 10, 3], [8, 11, 3], [9, 10, 3], [9, 11, 3], [10, 11, 3], [7, 8, 1]]
  const comunidad = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]
  const formas = 'a0 a1 a2 a3 b0 b1 b2 b3 c0 c1 c2 c3'.split(' ')
  const coms = [0, 1, 2].map((id) => ({ id, tam: 4, top: formas.filter((_, i) => comunidad[i] === id), peso: 1 }))
  const hs = huecosEstructurales(12, lados, comunidad, new Array(12).fill(0), formas, coms)
  assert.deepEqual([hs[0].a, hs[0].b, hs[0].puente], [0, 2, 0], 'A y C no tienen ninguna arista')
  assert.deepEqual(hs.find((h) => h.a === 0 && h.b === 1)!.bisagras.sort(), ['a3', 'b0'])
})

test('El dibujo: determinista con semilla, en [-1, 1] y con lo fijo en el centro', () => {
  const g = md.adyacencia(8, dosGrupos)
  const a = acomodar(8, g, { semilla: 5, iteraciones: 150 })
  assert.deepEqual(a, acomodar(8, g, { semilla: 5, iteraciones: 150 }))
  assert.ok(a.flat().every((v) => v >= -1 && v <= 1))
  const lejos = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1])
  assert.ok(lejos(a[0], a[1]) < lejos(a[0], a[6]), 'lo conectado queda más cerca que lo de otro grupo')
  const c = acomodar(8, g, { fijo: 3, semilla: 5, iteraciones: 100 })
  assert.deepEqual(c[3], [0, 0])
})

test('Un cálculo completo: «Vos» en el centro, comunidades legibles y las previas mantienen el dibujo', () => {
  const docs = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: i + 1, texto: 'el circuito tiene resistencia, corriente y voltaje; la resistencia frena la corriente del circuito' })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: i + 20, texto: 'la receta de pan lleva harina, levadura y horno; el horno cocina la harina de la receta' })),
  ]
  const r = calcular(docs, { vos: true, semilla: 3 })
  const vos = r.nodos.find((n) => n.vos)!
  assert.deepEqual([vos.x, vos.y, vos.forma], [0, 0, 'Vos'])
  assert.ok(r.metricas.comunidades >= 2)
  const com = (f: string) => r.nodos.find((n) => n.forma === f)!.com
  assert.equal(com('corriente'), com('resistencia'))
  assert.notEqual(com('corriente'), com('harina'))
  assert.ok(r.huecos.length >= 1)
  const previas = Object.fromEntries(r.nodos.filter((n) => !n.vos).map((n) => [n.lema, [n.x, n.y] as [number, number]]))
  const r2 = calcular(docs, { vos: true, semilla: 9, previas })
  const corr = (x: typeof r) => x.nodos.find((n) => n.forma === 'corriente')!
  assert.ok(Math.hypot(corr(r).x - corr(r2).x, corr(r).y - corr(r2).y) < 0.5, 'arranca de donde estaba: no salta')
})

test('El hilo aparte: el mismo resultado, y el servidor sigue respondiendo mientras calcula', async () => {
  const { calcularEnHilo } = await import('../src/grafo/hilo.ts')
  const docs = Array.from({ length: 900 }, (_, i) => ({ id: i + 1, texto: Array.from({ length: 120 }, (_, k) => `palabra${(i * 7 + k * 13) % 1500}ado`).join(' ') }))
  // Lo que tarda en el hilo principal (ahí sí traba todo)...
  const t0 = Date.now()
  const local = calcular(docs, { semilla: 1 })
  const enPrincipal = Date.now() - t0
  // ...contra el hueco más largo del reloj mientras calcula el hilo aparte (bajo carga, sin contar ticks).
  let ultimo = Date.now(), peorHueco = 0
  const reloj = setInterval(() => { const ahora = Date.now(); peorHueco = Math.max(peorHueco, ahora - ultimo); ultimo = ahora }, 5)
  const r = await calcularEnHilo({ docs, opciones: { semilla: 1 } })
  clearInterval(reloj)
  assert.equal(r.documentos, docs.length)
  assert.equal(r.resultado.metricas.n, local.metricas.n)
  assert.ok(peorHueco < Math.max(60, enPrincipal * 0.6), `el reloj no se frenó: su peor hueco fue ${peorHueco} ms; en el hilo principal el cálculo tarda ${enPrincipal} ms`)
  await assert.rejects(calcularEnHilo({ ruta: 'no/existe.db', definicion: { tipo: 'voz' } }))
})
