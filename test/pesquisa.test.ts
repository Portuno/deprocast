import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
delete process.env.NAN_API_KEY

const { abrir, fijarAjuste } = await import('../src/db.ts')
const { asegurarFuente, insertar } = await import('../src/corpus.ts')
const { crearQuantomo, leerQuantomo, sellar } = await import('../src/quantomos.ts')
const { _probarEmbed } = await import('../src/semantica.ts')
const { _probarModelos, sumarModelo } = await import('../src/modelos.ts')
const { _esperarFondo, _probarMano, ascension, fijarDial, jugar, modoDeMano, robar, robarMano } = await import('../src/mano.ts')
const { abrirPesquisa, cerrarPesquisa, elegirSiguiente, leerPesquisa, opcionesDePesquisa, pesquisaAbierta } = await import('../src/pesquisa.ts')

const T = new Date(2026, 9, 20, 10).getTime()
const DIA = 86_400_000

function vec(...xs: number[]) {
  const v = new Float32Array(xs)
  const n = Math.hypot(...xs) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return Buffer.from(v.buffer)
}

/** Una base con dos fuentes y un ayudante para crear afirmaciones (con vector, y selladas si se pide). */
function base() {
  const db = abrir(':memory:')
  asegurarFuente(db, { id: 'notas', nombre: 'Notas', nivel: 'propia', descripcion: 'Notas sueltas' })
  asegurarFuente(db, { id: 'podcast', nombre: 'Podcasts', nivel: 'primaria', descripcion: 'Lo que escucha' })
  let n = 0
  const q = (texto: string, fuente: string, v: Buffer | null, o: { peso?: number; novedad?: string; novedadDe?: number } = {}) => {
    const p = insertar(db, { fuente, titulo: `Pieza ${++n}`, contenido: texto, origenId: `p:${n}` }, T - 300 * DIA)!
    const id = crearQuantomo(db, { texto, piezaId: p }, T - 200 * DIA)!
    if (v) db.prepare(`INSERT INTO vec_items (tipo, id, modelo, vec, en) VALUES ('quantomo', ?, 'juguete', ?, 0)`).run(id, v)
    if (o.novedad) db.prepare('UPDATE quantomos SET novedad = ?, novedad_de = ? WHERE id = ?').run(o.novedad, o.novedadDe ?? null, id)
    if (o.peso) sellar(db, id, o.peso, T - 100 * DIA)
    return id
  }
  const bucle = (texto: string) => Number(db.prepare(`INSERT INTO bucles (texto, clave, veces, primera, ultima, estado, creado_en) VALUES (?, ?, 3, '2026-09-01', '2026-10-10', 'abierto', 1)`).run(texto, texto.toLowerCase()).lastInsertRowid)
  return { db, q, bucle }
}

test('Pesquisa: una a la vez, con pregunta; de un bucle toma su texto; hasta 3 jokers del consejo', () => {
  const { db, bucle } = base()
  assert.throws(() => abrirPesquisa(db, { pregunta: '' }, T), /cuál es la pregunta/i)
  const b = bucle('¿Me conviene cobrar la entrada al juego?')
  const p = abrirPesquisa(db, { origen: 'bucle', origenId: b }, T)
  assert.equal(p.pregunta, '¿Me conviene cobrar la entrada al juego?')
  assert.equal(pesquisaAbierta(db)?.id, p.id)
  assert.throws(() => abrirPesquisa(db, { pregunta: 'Otra cosa' }, T), /Ya tenés una Pesquisa abierta/)
  const { db: db2 } = base()
  const ms = ['Ana', 'Beto', 'Ceci'].map((nombre) => sumarModelo(db2, { nombre }, T).id)
  assert.throws(() => abrirPesquisa(db2, { pregunta: 'Algo para pensar', jokers: [...ms, 9999] }, T), /Hasta 3 jokers/)
  assert.throws(() => abrirPesquisa(db2, { pregunta: 'Algo para pensar', jokers: [9999] }, T), /consejo de modelos/)
  assert.deepEqual(abrirPesquisa(db2, { pregunta: 'Algo para pensar', jokers: ms }, T).jokers.map((j) => j.nombre), ['Ana', 'Beto', 'Ceci'])
  assert.equal(opcionesDePesquisa(db2, T).jokers.length, 3)
})

test('Pesquisa: la mano trae lo que tiene que ver con la pregunta (por sentido o, sin vectores, por palabras) y de las fuentes elegidas', async () => {
  const { db, q } = base()
  const precio = q('El precio de la entrada filtra a los jugadores', 'notas', vec(1, 0, 0))
  const precio2 = q('Cobrar poco igual filtra', 'podcast', vec(0.9, 0.1, 0))
  const lejos = q('Dormir bien ayuda al foco', 'notas', vec(0, 0, 1))
  abrirPesquisa(db, { pregunta: '¿Cuánto cobrar la entrada del juego?', fuentes: ['notas'] }, T)
  // Sin vectores: por palabras («entrada»), solo de Notas; lo que falta se completa con la mano de siempre.
  const sinVec = await robarMano(db, { n: 2, ahora: T })
  assert.equal(sinVec[0].id, precio)
  assert.equal(sinVec.length, 2)
  // Con vectores: por sentido, solo de las fuentes elegidas.
  _probarEmbed(async (_db, textos) => ({ vectores: textos.map((t) => (/cobrar|precio|entrada/i.test(t) ? [1, 0.05, 0] : [0, 0, 1])), modelo: 'juguete' }))
  _probarMano({ nube: () => true })
  try {
    const conVec = await robarMano(db, { n: 3, ahora: T })
    assert.equal(conVec[0].id, precio)
    assert.ok(conVec[0].relevancia! > 0.9)
    assert.notEqual(conVec[1]?.relevancia && conVec[1].id, precio2, 'de Podcasts no: eligió solo Notas')
    assert.ok(conVec.some((c) => c.id === lejos), 'lo que falta se completa igual')
  } finally { _probarEmbed(null); _probarMano({ nube: () => false }) }
})

test('Pesquisa: las jugadas quedan en ella; cerrar sin combo deja lo que faltó como pregunta y tres para elegir la próxima', async () => {
  const { db, q, bucle } = base()
  const b = bucle('¿Me conviene cobrar la entrada al juego?')
  const otro = bucle('Ordenar el placard')
  const p = abrirPesquisa(db, { origen: 'bucle', origenId: b, fuentes: ['notas'] }, T)
  const a = q('El precio filtra', 'notas', vec(1, 0, 0))
  await jugar(db, a, { gesto: 'peso', peso: 7 }, T)
  assert.equal(leerPesquisa(db, p.id)?.pesadas, 1)
  await assert.rejects(cerrarPesquisa(db, p.id, { decision: 'tal vez' }, T), /La decisión es ya, agendar, soltar/)
  const c = await cerrarPesquisa(db, p.id, { decision: 'soltar' }, T)
  assert.equal(c.estado, 'cerrada')
  assert.equal(c.sintesis?.hipotesis, null)
  assert.match(c.sintesis!.falto!.texto, /qué dato o qué experiencia te faltó/)
  assert.equal((db.prepare('SELECT origen FROM preguntas WHERE id = ?').get(c.sintesis!.falto!.preguntaId) as any).origen, 'pesquisa')
  assert.equal((db.prepare('SELECT estado FROM bucles WHERE id = ?').get(b) as any).estado, 'soltado', 'la decisión cierra el bucle')
  assert.match(c.sintesis!.nota!, /nube/)
  assert.ok(c.siguiente!.length >= 2 && c.siguiente!.length <= 3)
  assert.ok(c.siguiente!.some((o) => o.origen === 'bucle' && o.id === otro))
  assert.ok(!c.siguiente!.some((o) => o.origen === 'bucle' && o.id === b), 'no vuelve a ofrecer el que cerró')
  await assert.rejects(cerrarPesquisa(db, p.id, {}, T), /ya está cerrada/)
  assert.equal(elegirSiguiente(db, p.id, 'saltar', T), null)
  const nueva = elegirSiguiente(db, p.id, c.siguiente!.findIndex((o) => o.id === otro), T)!
  assert.equal(nueva.pregunta, 'Ordenar el placard')
  assert.deepEqual(nueva.fuentes, ['notas'], 'reinicio con ventaja: la misma build')
})

test('Pesquisa en la nube: el combo dentro de ella arma la hipótesis; los jokers opinan; con A3, el abogado del diablo', async () => {
  const { db, q } = base()
  const joker = sumarModelo(db, { nombre: 'Elinor' }, T).id
  db.prepare(`UPDATE entidades SET meta = json_set(meta, '$.manual', json(?)) WHERE id = ?`).run(JSON.stringify({ resumen: 'Comunes', principios: [], estandares: [], como_decide: [], lo_que_evita: [], frases: [], preguntas: [] }), joker)
  _probarModelos({ modelo: async () => ({ haria: 'Reglas locales hechas por la comunidad', por_que: 'Lo vi funcionar', primer_paso: 'Preguntar', no_haria: 'Imponer', confianza: 'alta' }) })
  _probarMano({
    nube: () => true,
    modelo: async (_db, sistema) => sistema.includes('abogado del diablo') ? { contra: 'Puede que solo filtre a los que tienen plata.' }
      : sistema.includes('hipótesis') ? { hipotesis: 'Cobrar la entrada hace que la comunidad se cuide sola', predice: 'menos moderación', refutaria: 'más reportes' } : { relaciones: [] },
  })
  // A3 a mano: tres Pesquisas cerradas, diez sorpresas respondidas sin casualidad y tres combos que valieron.
  for (let i = 0; i < 3; i++) db.prepare(`INSERT INTO pesquisas (pregunta, estado, creada_en) VALUES ('vieja', 'cerrada', 1)`).run()
  for (let i = 0; i < 10; i++) db.prepare(`INSERT INTO mano_eventos (tipo, quantomo_id, ids, estado, creado_en) VALUES (?, 1, '[]', 'real', 1)`).run(i < 3 ? 'combo' : 'puente')
  assert.equal(ascension(db).nivel, 3)
  try {
    const p = abrirPesquisa(db, { pregunta: '¿Cobrar la entrada?', jokers: [joker] }, T)
    const ids = [q('El precio filtra', 'notas', vec(1, 0.3, 0)), q('Pagar hace cuidar', 'podcast', vec(0.95, 0.35, 0)), q('Lo gratis se tira', 'notas', vec(0.9, 0.4, 0))]
    // Fuera de la ventana de 2 horas, pero en la misma Pesquisa: el combo cuenta.
    for (const [i, id] of ids.entries()) await jugar(db, id, { gesto: 'peso', peso: 7 }, T + i * 3 * 3_600_000)
    await _esperarFondo()
    const c = await cerrarPesquisa(db, p.id, {}, T + 10 * 3_600_000)
    assert.match(c.sintesis!.hipotesis!.texto, /^Cobrar la entrada/)
    assert.equal(c.sintesis!.falto, null)
    assert.deepEqual(c.sintesis!.jokers.map((j) => j.modelo), ['Elinor'])
    assert.match(c.sintesis!.contra!, /filtre a los que tienen plata/)
    assert.match(c.siguiente![0].texto, /^¿Es cierto que cobrar la entrada/)
    assert.equal(leerQuantomo(db, c.sintesis!.hipotesis!.id!)?.etapa, 'proto')
  } finally { _probarMano({ nube: () => false }) }
})

test('El dial y el flujo: suave trae lo familiar primero; auto lee las últimas 10 (descartes → suave, todo alto → pelea)', () => {
  const { db, q } = base()
  const nueva = q('Algo que no se parece a nada', 'notas', null, { novedad: 'nueva' })
  const variacion = q('Una variación de algo', 'notas', null, { novedad: 'variacion' })
  assert.equal(robar(db, { ahora: T })[0].id, nueva)
  assert.equal(fijarDial(db, 'suave').modo, 'suave')
  assert.equal(robar(db, { ahora: T })[0].id, variacion, 'suave: lo familiar primero')
  assert.throws(() => fijarDial(db, 'turbo'), /El dial es auto, suave, pelea/)
  fijarDial(db, 'auto')
  assert.equal(modoDeMano(db).modo, 'normal')
  const ins = db.prepare(`INSERT INTO mano_jugadas (quantomo_id, gesto, peso, en) VALUES (1, ?, ?, 1)`)
  for (let i = 0; i < 7; i++) ins.run('descartar', null)
  assert.equal(modoDeMano(db).modo, 'suave')
  for (let i = 0; i < 10; i++) ins.run('peso', 9)
  assert.equal(modoDeMano(db).modo, 'pelea')
  assert.match(modoDeMano(db).porque, /subo la distancia/)
})

test('Ascensiones: se ganan con lo hecho; A1 mete una carta que puede chocar con lo que creés; A2 roba de afuera en pelea', () => {
  const { db, q } = base()
  const creia = q('Hay que hacer todo solo', 'notas', null, { peso: 10 })
  for (let i = 0; i < 6; i++) q(`Nueva ${i}`, 'notas', null, { novedad: 'nueva' })
  const desafio = q('Delegar me dio tiempo', 'notas', null, { novedad: 'variacion', novedadDe: creia })
  const afuera = q('Algo de un podcast', 'podcast', null, { novedad: 'variacion' })
  assert.equal(ascension(db).nivel, 0)
  assert.match(ascension(db).proximo!, /A1: cerrá 3 Pesquisas más/)
  assert.ok(!robar(db, { ahora: T }).some((c) => c.desafio))
  for (let i = 0; i < 3; i++) db.prepare(`INSERT INTO pesquisas (pregunta, estado, creada_en) VALUES ('vieja', 'cerrada', 1)`).run()
  assert.equal(ascension(db).nivel, 1)
  const mano = robar(db, { ahora: T })
  assert.equal(mano.length, 5)
  assert.equal(mano.at(-1)!.id, desafio)
  assert.equal(mano.at(-1)!.desafio, true)
  for (let i = 0; i < 10; i++) db.prepare(`INSERT INTO mano_eventos (tipo, quantomo_id, ids, estado, creado_en) VALUES ('puente', 1, '[]', ?, 1)`).run(i < 6 ? 'casualidad' : 'real')
  assert.equal(ascension(db).nivel, 1, 'más de la mitad casualidad: todavía no')
  db.exec(`UPDATE mano_eventos SET estado = 'real'`)
  assert.equal(ascension(db).nivel, 2)
  fijarAjuste(db, 'mano_dial', 'pelea')
  assert.equal(robar(db, { ahora: T })[0].id, afuera, 'en pelea con A2, lo de afuera primero')
})
