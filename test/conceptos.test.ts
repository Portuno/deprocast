import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'

const { abrir } = await import('../src/db.ts')
const co = await import('../src/conceptos.ts')
const ac = await import('../src/academia.ts')
const hu = await import('../src/huecos.ts')

const T = new Date(2026, 9, 23, 10).getTime() // jueves
const DIA = 86_400_000

const pedidos: { sistema: string; usuario: string }[] = []
let correctas = new Set<string>()
ac._probarAcademia({
  nube: () => false,
  alPedirVisual: () => {},
  modelo: async (_db, sistema, usuario) => {
    pedidos.push({ sistema, usuario })
    if (/mapa de conceptos/.test(sistema)) return { conceptos: [
      { nombre: 'Carga', nivel: 1 }, { nombre: 'Corriente', nivel: 1, requisitos: ['Carga'] }, { nombre: 'Voltaje', nivel: 1, requisitos: ['Carga'] },
      { nombre: 'Ley de Ohm', nivel: 2, requisitos: ['Corriente', 'Voltaje'] }, { nombre: 'Potencia', nivel: 2, requisitos: ['Ley de Ohm', 'Inventado'] }, { nombre: 'Circular', nivel: 1, requisitos: ['Ley de Ohm'] },
    ] }
    if (/diagnóstico de ubicación/.test(sistema)) return { preguntas: [6, 5, 4, 3, 2, 1].map((n) => ({ nivel: n, pregunta: `P${n}`, clave: 'k' })) }
    if (/Corregís UNA respuesta/.test(sistema)) return { correcto: [...correctas].some((c) => usuario.includes(`Respuesta del alumno: ${c}`)), devolucion: 'D' }
    if (/búsquedas web/.test(sistema)) return { consultas: [] }
    const tema = /Tema de la clase: (.+)/.exec(usuario)?.[1] ?? '?'
    const repaso = /Repaso intercalado[^:]*: (.+)/.exec(usuario)?.[1]?.split(' · ').map((x) => x.replace(/ \(de .+\)$/, '')) ?? []
    return { tema, explicacion: 'E', ejemplos: [], ideas: [], tarjetas: [], visual: null, preguntas: [{ pregunta: 'Q1', clave: 'k' }, ...repaso.map((r) => ({ pregunta: `Repaso de ${r}`, clave: 'k', repaso: r }))] }
  },
})

test('El mapa: conserva lo que sabe al rearmarse, resuelve requisitos por nombre (solo de su nivel o de antes) y migra el temario viejo', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electricidad' }, T)
  let cs = await ac.armarMapa(db, d.id, T)
  const porNombre = (n: string) => cs.find((c) => c.nombre === n)!
  assert.equal(cs.length, 6)
  assert.deepEqual(porNombre('Ley de Ohm').requisitos.sort(), [porNombre('Corriente').id, porNombre('Voltaje').id].sort())
  assert.deepEqual(porNombre('Potencia').requisitos, [porNombre('Ley de Ohm').id], 'un requisito que no existe se ignora')
  assert.deepEqual(porNombre('Circular').requisitos, [], 'un requisito de un nivel más alto no vale (no se podría empezar nunca)')

  co.anotarRespuesta(db, porNombre('Carga').id, true, T)
  cs = co.guardarMapa(db, d.id, [{ nombre: 'carga', nivel: 1 }, { nombre: 'Corriente', nivel: 1, requisitos: ['Carga'] }], T)
  assert.deepEqual(cs.map((c) => c.nombre), ['carga', 'Corriente'], 'lo no tocado que ya no está se va; el nombre se actualiza')
  assert.ok(cs[0].dominio > 0.3, 'lo que sabía de «Carga» se conserva')

  // El temario del v23 pasa solo, sin modelo.
  const viejo = ac.sumarDominio(db, { tema: 'Química' }, T)
  db.prepare('UPDATE aprendizajes SET temario = ?, tema_idx = 1 WHERE id = ?').run(JSON.stringify({ 1: ['Átomos', 'Moléculas', 'Enlaces'] }), viejo.id)
  const n = pedidos.length
  const s = await ac.abrirSesionTutor(db, viejo.id, { ahora: T })
  assert.equal(pedidos.filter((p, i) => i >= n && /mapa de conceptos/.test(p.sistema)).length, 0)
  assert.equal(s.tema, 'Moléculas', 'sigue por donde iba: «Átomos» ya lo había visto')
  assert.equal(co.conceptosDe(db, viejo.id)[0].dominio, co.SABIDO)
})

test('La clase elige sola (la frontera), intercala repaso de otros dominios y cada respuesta mueve lo que sabe de su concepto', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electricidad' }, T)
  await ac.armarMapa(db, d.id, T)
  const c = (n: string) => co.conceptosDe(db, d.id).find((x) => x.nombre === n)!
  assert.equal(co.frontera(db, d.id, 1, T)!.nombre, 'Carga')
  // Otro dominio con algo para repasar hoy.
  const otro = ac.sumarDominio(db, { tema: 'Historia' }, T)
  co.guardarMapa(db, otro.id, [{ nombre: 'Revolución de Mayo', nivel: 1 }], T)
  const rm = co.conceptosDe(db, otro.id)[0]
  co.anotarRespuesta(db, rm.id, true, T - 10 * DIA)
  co.programarRepaso(db, rm.id, T - 10 * DIA)

  const s = await ac.abrirSesionTutor(db, d.id, { ahora: T })
  assert.equal(s.tema, 'Carga')
  assert.equal(s.conceptoId, c('Carga').id)
  assert.match(pedidos.at(-1)!.usuario, /Repaso intercalado.*Revolución de Mayo \(de Historia\)/)
  assert.deepEqual(s.paquete.preguntas.map((q) => q.conceptoId), [c('Carga').id, rm.id], 'cada pregunta sabe de qué concepto es')

  correctas = new Set(['sé'])
  await ac.responderTutor(db, s.id, 0, 'sé', T)
  await ac.responderTutor(db, s.id, 0, 'no', T)
  assert.equal(c('Carga').intentos, 1, 'el reintento no cuenta')
  assert.ok(c('Carga').dominio > 0.3)
  await ac.responderTutor(db, s.id, 1, 'no', T)
  assert.ok(co.leerConcepto(db, rm.id)!.dominio < 0.35, 'un error en el repaso baja lo de Historia')
  ac.cerrarSesionTutor(db, s.id, T + 60_000)
  assert.ok(c('Carga').venceEn! > T, 'vuelve a repaso más adelante')

  // Con «Carga» sabida, la frontera avanza a lo que ya tiene sus requisitos.
  db.prepare('UPDATE conceptos SET dominio = 0.9 WHERE id = ?').run(c('Carga').id)
  assert.equal(co.frontera(db, d.id, 1, T)!.nombre, 'Corriente')
  // Todo el nivel sabido: el examen se habilita aunque no haya dos clases seguidas.
  db.prepare('UPDATE conceptos SET dominio = 0.9, vence_en = ? WHERE aprendizaje_id = ? AND nivel = 1').run(T + 9 * DIA, d.id)
  assert.equal(ac.examenHabilitado(db, d.id), true)
})

test('El diagnóstico ubica: el nivel de la última bien antes del segundo error, y lo de abajo queda sabido a medias', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electricidad' }, T)
  await ac.armarMapa(db, d.id, T)
  const s = await ac.abrirSesionTutor(db, d.id, { diagnostico: true, ahora: T })
  assert.equal(s.tipo, 'diagnostico')
  assert.deepEqual(s.paquete.preguntas.map((q) => q.nivel), [1, 2, 3, 4, 5, 6], 'de la más fácil a la más difícil')
  correctas = new Set(['bien'])
  for (const [i, r] of ['bien', 'bien', 'no sé', 'bien', 'no sé', 'bien'].entries()) await ac.responderTutor(db, s.id, i, r, T)
  const c = ac.cerrarSesionTutor(db, s.id, T) as any
  assert.deepEqual([c.diagnostico, c.nivel], [true, 4], 'falla el 3, acierta el 4, falla el 5: corta ahí, en el 4')
  const dd = ac.leerDominio(db, d.id)!
  assert.equal(dd.tutorNivel, 4)
  assert.ok(dd.diagnosticoEn)
  assert.ok(co.conceptosDe(db, d.id).filter((x) => x.nivel <= 3).every((x) => x.dominio >= 0.6))
  assert.equal(c.piezaId, null, 'el diagnóstico no deja clase en el corpus')
})

test('El mapa sigue el índice de su material (un libro guía el plan de estudio)', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Matemática' }, T)
  await ac.sumarMaterial(db, d.id, { titulo: 'Libro de álgebra', texto: '# Capítulo 1: Números\nTexto…\n## 1.1 Naturales y enteros\nMás texto que no es título.\nCapítulo 2 Ecuaciones\n2.1 Ecuaciones lineales\n' + 'relleno '.repeat(20) }, T)
  const indice = ac.indiceDeMaterial(db, d.id)
  assert.match(indice, /De «Libro de álgebra»:\n- Capítulo 1: Números\n- 1\.1 Naturales y enteros\n- Capítulo 2 Ecuaciones\n- 2\.1 Ecuaciones lineales/)
  assert.doesNotMatch(indice, /Más texto/)
  await ac.armarMapa(db, d.id, T)
  assert.match(pedidos.at(-1)!.usuario, /El índice de su material \(seguilo\):\nDe «Libro de álgebra»/)
})

test('La meta hacia atrás: clases por semana hasta la fecha, al día o atrasado, y aceptar una sugerencia con fecha la fija', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electricidad' }, T)
  await ac.armarMapa(db, d.id, T)
  assert.equal(co.ritmoDe(db, ac.leerDominio(db, d.id)!, T), null)
  const fecha = new Date(T + 20 * DIA).toISOString().slice(0, 10)
  co.fijarMeta(db, ac.leerDominio(db, d.id)!, { fecha, nivel: 2 }, T)
  let r = co.ritmoDe(db, ac.leerDominio(db, d.id)!, T)!
  // Pendientes: los 6 conceptos de los niveles 1 y 2, más el examen para pasar al 2. Tres semanas.
  assert.deepEqual([r.pendientes, r.semanas, r.porSemana, r.inicial, r.estado], [7, 3, 3, 3, 'al_dia'])
  assert.match(r.texto, /Nivel 2 para el .*: 3 clases por semana · faltan 3 esta semana/)
  // Pasan dos semanas sin clases: hace falta más por semana que al principio.
  r = co.ritmoDe(db, ac.leerDominio(db, d.id)!, T + 15 * DIA)!
  assert.equal(r.estado, 'atrasado')
  assert.match(r.texto, /arrancaste con 3: vas atrasado/)
  assert.throws(() => co.fijarMeta(db, ac.leerDominio(db, d.id)!, { fecha: '2020-01-01' }, T), /ya pasó/)
  assert.match(ac.academiaParaPrompt(db), /meta: Nivel 2 para el/)

  db.prepare(`INSERT INTO aprendizajes (tema, estado, sugerencia, creado_en) VALUES ('Drones', 'sugerido', ?, ?)`).run(JSON.stringify({ porQue: 'evento', fecha }), T)
  const sug = ac.sugeridosDe(db)[0]
  await ac.aceptarSugerencia(db, sug.id, T)
  const dr = db.prepare('SELECT meta_fecha, meta_nivel FROM aprendizajes WHERE id = ?').get(sug.id) as any
  assert.deepEqual([dr.meta_fecha, dr.meta_nivel], [fecha, 2], 'el evento de la sugerencia queda como meta')
})

test('Los huecos: conceptos sin material (y la búsqueda va por ellos), lo que falla seguido, lo que frena, y las metas sin archivo', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electricidad' }, T)
  await ac.armarMapa(db, d.id, T)
  hu._probarHuecos(async (_db, texto) => (/voltaje|ley de ohm|drones/i.test(texto) ? 0.3 : 0.8))
  const c = (n: string) => co.conceptosDe(db, d.id).find((x) => x.nombre === n)!
  co.anotarRespuesta(db, c('Carga').id, false, T)
  co.anotarRespuesta(db, c('Carga').id, false, T)
  const r = await hu.huecosDeDominio(db, ac.leerDominio(db, d.id)!, T)
  assert.deepEqual(r.sinMaterial.map((x) => x.nombre).sort(), ['Ley de Ohm', 'Voltaje'])
  assert.deepEqual(r.flojos.map((x) => x.nombre), ['Carga'])
  assert.deepEqual(r.bloqueantes.map((b) => [b.concepto.nombre, b.frena.sort()]), [['Carga', ['Corriente', 'Voltaje']]])

  ac._probarFuentes({ buscador: async () => [], guardador: async () => ({ piezaId: 1, nueva: false, lectura: null }) })
  const f = await ac.buscarFuentes(db, d.id, { ahora: T })
  assert.equal(f.concepto, 'Voltaje', 'la búsqueda va por el concepto sin material de su nivel')
  assert.match(pedidos.at(-1)!.usuario, /Concepto puntual que le falta \(buscá material sobre ESTO\): Voltaje/)

  const { recordar } = await import('../src/memoria.ts')
  recordar(db, { texto: 'Quiere armar drones para el evento de defensa', tipo: 'meta', horizonte: 'trinchera' }, T)
  recordar(db, { texto: 'Quiere entender bien la electricidad', tipo: 'meta' }, T)
  const m = await hu.huecosDeMetas(db, T)
  assert.deepEqual(m!.map((x) => x.texto), ['Quiere armar drones para el evento de defensa'])
  assert.match(hu.huecosParaPrompt(m), /\[meta\] Quiere armar drones/)
  hu._probarHuecos(async () => null)
  assert.equal(await hu.huecosDeMetas(db, T), null, 'sin vectores no se puede medir: null, no «nada»')
})
