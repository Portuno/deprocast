import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { construirRed } from '../src/grafo/construir.ts'
import { calcularSentido } from '../src/grafo/sentido.ts'

test('#229: la red guarda en qué piezas aparece cada concepto (para su vector de sentido)', () => {
  const r = construirRed([
    { id: 11, texto: 'El plan de igualdad de la empresa y su auditoría.', tipo: 'pieza' },
    { id: 12, texto: 'La auditoría retributiva del plan.', tipo: 'pieza' },
    { id: -5, texto: 'Un quántomo sobre el plan.', tipo: 'quantomo' },
  ], { maxNodos: 50 })
  const plan = r.nodos.findIndex((n) => n.forma === 'plan')
  assert.deepEqual(r.ejemplos![plan].sort(), [11, 12], 'solo piezas del corpus (el quántomo no tiene pasajes)')
})

test('#229: dos conceptos que dicen lo mismo sin aparecer juntos quedan unidos por sentido; lo que ya está unido en el texto, no', async () => {
  const db = abrir(':memory:')
  const vec = (xs: number[]) => Buffer.from(new Float32Array(xs).buffer)
  const pasaje = (pieza: number, v: number[]) => db.prepare(`INSERT INTO pasajes (pieza_id, orden, desde, hasta, modelo, vec, en) VALUES (?, 0, 0, 10, 'x', ?, 1)`).run(pieza, vec(v))
  // Cuatro temas: camiones y BBVA hablan de lo mismo (la flota y su financiación) aunque nunca se nombran juntos.
  pasaje(1, [1, 0, 0, 0]); pasaje(6, [0.97, 0.03, 0, 0]); pasaje(2, [0.95, 0.05, 0, 0]); pasaje(7, [0.98, 0, 0.02, 0])
  pasaje(3, [0, 1, 0, 0]); pasaje(8, [0, 0.97, 0.03, 0]); pasaje(4, [0, 0, 1, 0]); pasaje(9, [0, 0.03, 0.97, 0]); pasaje(5, [0, 0, 0, 1]); pasaje(10, [0.02, 0, 0, 0.98])
  const n = (i: number, forma: string, com: number) => ({ i, lema: forma, forma, frec: 3, docs: 1, btw: 1 - i / 10, com, grado: 2, x: 0, y: 0 })
  const foto = {
    id: 1,
    nodos: [n(0, 'camiones', 0), n(1, 'ruta', 0), n(2, 'carga', 0), n(3, 'bbva', 1), n(4, 'banco', 1), n(5, 'cuota', 1), n(6, 'perro', 2), n(7, 'gato', 2), n(8, 'mascota', 2)],
    aristas: [[0, 1, 3], [1, 2, 3], [0, 2, 2], [3, 4, 3], [4, 5, 3], [3, 5, 2], [6, 7, 3], [7, 8, 3], [6, 8, 2]] as [number, number, number][],
    comunidades: [{ id: 0, tam: 3, top: ['camiones', 'ruta', 'carga'], peso: 1 }, { id: 1, tam: 3, top: ['bbva', 'banco', 'cuota'], peso: 1 }, { id: 2, tam: 3, top: ['perro', 'gato', 'mascota'], peso: 1 }],
    // Cada concepto con dos piezas; camiones y bbva no comparten ninguna (nunca se nombran juntos).
    ejemplos: [[1, 6], [3, 8], [3, 8], [2, 7], [4, 9], [4, 9], [5, 10], [5, 10], [5, 10]],
  }
  const s = await calcularSentido(db, foto as any)
  assert.ok(s.aristas.some(([a, b]) => (a === 0 && b === 3) || (a === 3 && b === 0)), `camiones ≈ bbva: ${JSON.stringify(s.aristas)}`)
  assert.ok(!s.aristas.some(([a, b]) => (a === 6 && b === 7) || (a === 7 && b === 6)), 'perro y gato ya están unidos en el texto')
  assert.equal(s.conceptos, 9)
  const viejo = await calcularSentido(db, { ...foto, ejemplos: undefined } as any)
  assert.match(viejo.aviso!, /recalculá el grafo/)
})

test('los logs, trazas, JSON, configuración, comandos y código pegados no entran al grafo; la prosa (y las citas) sí', async () => {
  const { esRenglonTecnico, lemas, limpiar, diccionarioVacio } = await import('../src/grafo/texto.ts')
  for (const l of ['2026-11-10 14:32:11 INFO [server] request source=node', '    at Object.<anonymous> (file:///C:/x/y.js:12:3)', '[ERROR] protonfixes: khr fixme invalid', '{"request": "source", "node": 3}', 'PROTON_LOG=1', '$ npm run dev', 'const getUserName = (x) => x.user_name ?? null;']) assert.equal(esRenglonTecnico(l), true, l)
  for (const l of ['Hoy estuve pensando en el plan de igualdad.', '> Una cita mía sobre el barrio.', '## Un título', 'Hablé con Camila (la de la obra) sobre los 2.400 euros.']) assert.equal(esRenglonTecnico(l), false, l)
  const ls = lemas(limpiar('El plan de igualdad.\n[ERROR] protonfixes: khr fixme\nUsé getUserName y user_name en la auditoría.'), diccionarioVacio())
  assert.ok(!ls.some((l) => /proton|khr|fixme|getus|user/.test(l)), ls.join(' '))
  assert.ok(ls.some((l) => l.startsWith('audit')) && ls.some((l) => l.startsWith('iguald')))
})

test('lo de máquina pegado en un solo renglón (logs, errores en inglés, volcados clave=valor, rótulos) tampoco entra; la prosa del mismo renglón sí', async () => {
  const { lemas, limpiar, diccionarioVacio, esInglesTecnico } = await import('../src/grafo/texto.ts')
  const pegado = '¿Cómo puedo entrenar una inteligencia propia? Te paso lo que me tira la consola INFO: Running proton using runtime steamrt INFO: steamrt is up to date gamemodeauto: dlopen failed - cannot open shared object file: No such file or directory. ' +
    'Después probé con el cuaderno [notebook/info] dd4bf0df slot 0 Enviando hoja a visión. PAGE slot=0 n=0 pos=Tapa status=Procesada --- TITLE: Cuaderno Rojo LABEL: Tapa. Lutris cannot ship with every component in its runtime, so you should install Wine.'
  const ls = lemas(limpiar(pegado), diccionarioVacio())
  assert.ok(!ls.some((l) => /^(runn|steamrt|gamemod|dlopen|fail|cannot|shar|direct|slot|envi|statu|titl|label|lutr|component|runtim|ship)/.test(l)), ls.join(' '))
  assert.ok(['entren', 'intelig', 'consol', 'cuadern', 'roj', 'tap'].every((x) => ls.some((l) => l.startsWith(x))), ls.join(' '))
  // Una frase en castellano con una palabra técnica en inglés no es «inglés».
  assert.equal(esInglesTecnico('El toolchain de Rust ya trae el linker y lo estaba tapando en el PATH.'), false)
  assert.equal(esInglesTecnico('No es lo que dije: la reunión es el jueves.'), false)
  assert.equal(esInglesTecnico('ld: cannot find crtend.o: No such file or directory error: could not compile'), true)
})
