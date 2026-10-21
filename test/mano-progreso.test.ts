import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

process.env.TZ = 'Europe/Madrid'
delete process.env.NAN_API_KEY

const { abrir, fijarAjuste } = await import('../src/db.ts')
const { asegurarFuente, insertar } = await import('../src/corpus.ts')
const { crearQuantomo, sellar } = await import('../src/quantomos.ts')
const { responderTarjeta } = await import('../src/tarjetas.ts')
const { listarRutinas } = await import('../src/rutinas.ts')
const { ascension, avisoMano, calibracion, deshacerJugada, jugar, retencion } = await import('../src/mano.ts')
const { honestidad, progresoDeMano, territorio } = await import('../src/progreso-mano.ts')

const T = new Date(2026, 9, 20, 10).getTime()
const DIA = 86_400_000

function vec(...xs: number[]) {
  const v = new Float32Array(xs)
  const n = Math.hypot(...xs) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return Buffer.from(v.buffer)
}

function base() {
  const db = abrir(':memory:')
  asegurarFuente(db, { id: 'notas', nombre: 'Notas', nivel: 'propia', descripcion: 'Notas sueltas' })
  asegurarFuente(db, { id: 'podcast', nombre: 'Podcasts', nivel: 'primaria', descripcion: 'Lo que escucha' })
  let n = 0
  const q = (texto: string, fuente: string, v: Buffer | null, o: { peso?: number; novedad?: string; creado?: number } = {}) => {
    const p = insertar(db, { fuente, titulo: `Pieza ${++n}`, contenido: texto, origenId: `p:${n}` }, T - 300 * DIA)!
    const id = crearQuantomo(db, { texto, piezaId: p }, o.creado ?? T - 200 * DIA)!
    if (v) db.prepare(`INSERT INTO vec_items (tipo, id, modelo, vec, en) VALUES ('quantomo', ?, 'juguete', ?, 0)`).run(id, v)
    if (o.novedad) db.prepare('UPDATE quantomos SET novedad = ? WHERE id = ?').run(o.novedad, id)
    if (o.peso) sellar(db, id, o.peso, T - 100 * DIA)
    return id
  }
  return { db, q }
}

test('Calibración: predecir antes de ver se califica con lo que encontró (Brier → «acertás X %»)', async () => {
  const { db, q } = base()
  q('Los precios bajos atraen jugadores', 'notas', vec(1, 0, 0), { peso: 9 })
  const conecta = q('Bajar el precio trae gente', 'podcast', vec(0.95, 0.1, 0))
  const suelta = q('Dormir bien ayuda', 'notas', vec(0, 0, 1))
  assert.equal(calibracion(db).predicciones, 0)
  const a = await jugar(db, conecta, { gesto: 'peso', peso: 6, prediccion: 0.9 }, T)
  assert.deepEqual(a.prediccion, { probabilidad: 0.9, conecto: true })
  const b = await jugar(db, suelta, { gesto: 'choca', prediccion: 0.1 }, T)
  assert.deepEqual(b.prediccion, { probabilidad: 0.1, conecto: false })
  assert.deepEqual(calibracion(db), { predicciones: 2, brier: 0.01, conocimiento: 96 })
  await assert.rejects(jugar(db, suelta, { gesto: 'peso', peso: 3, prediccion: 2 }, T), /probabilidad entre 0 y 1/)
  deshacerJugada(db, T)
  assert.equal(calibracion(db).predicciones, 1, 'lo deshecho no cuenta')
})

test('Retención: lo pesado 9 o más queda como tarjeta (el principio a la vista); deshacer la saca; recordar suma', async () => {
  const { db, q } = base()
  const alta = q('Cobrar la entrada hace que la comunidad se cuide sola', 'notas', null)
  const baja = q('Algo que pesó poco', 'notas', null)
  const j = await jugar(db, alta, { gesto: 'peso', peso: 10 }, T)
  assert.ok(j.tarjetaId)
  const t = db.prepare('SELECT * FROM tarjetas WHERE id = ?').get(j.tarjetaId) as any
  assert.equal(t.mazo, 'mano')
  assert.match(t.frente, /^«Cobrar la entrada hace que la …»\n¿Cómo seguía\? \(lo pesaste 10\)/)
  assert.equal(t.dorso, 'Cobrar la entrada hace que la comunidad se cuide sola')
  assert.equal((await jugar(db, baja, { gesto: 'peso', peso: 8 }, T)).tarjetaId, null)
  deshacerJugada(db, T)
  deshacerJugada(db, T)
  assert.equal(retencion(db).tarjetas, 0, 'la tarjeta sin repasar se va con la jugada')
  const k = (await jugar(db, alta, { gesto: 'peso', peso: 11 }, T)).tarjetaId!
  assert.deepEqual(retencion(db), { tarjetas: 1, repasadas: 0, porcentaje: null })
  responderTarjeta(db, k, 'bien', T)
  assert.deepEqual(retencion(db), { tarjetas: 1, repasadas: 1, porcentaje: 100 })
})

test('Ascensión 4: treinta predicciones con calibración de 50 % o más (después de A3)', () => {
  const { db } = base()
  for (let i = 0; i < 3; i++) db.prepare(`INSERT INTO pesquisas (pregunta, estado, creada_en) VALUES ('vieja', 'cerrada', 1)`).run()
  for (let i = 0; i < 10; i++) db.prepare(`INSERT INTO mano_eventos (tipo, quantomo_id, ids, estado, creado_en) VALUES (?, 1, '[]', 'real', 1)`).run(i < 3 ? 'combo' : 'puente')
  assert.equal(ascension(db).nivel, 3)
  assert.match(ascension(db).proximo!, /A4: 30 predicciones más/)
  const ins = db.prepare(`INSERT INTO mano_jugadas (quantomo_id, gesto, peso, prediccion, resultado, en) VALUES (1, 'peso', 5, ?, ?, 1)`)
  for (let i = 0; i < 30; i++) ins.run(0.5, i % 2)
  assert.equal(ascension(db).nivel, 3, 'tirar una moneda no alcanza')
  db.exec('DELETE FROM mano_jugadas')
  for (let i = 0; i < 30; i++) ins.run(i % 2 ? 0.9 : 0.1, i % 2)
  const a = ascension(db)
  assert.equal(a.nivel, 4)
  assert.equal(a.choquesLejos, true)
  assert.equal(a.proximo, null)
})

test('El aviso de La Mano: solo con 3 o más novedades reales desde la última jugada, se puede apagar, y es una rutina diaria', () => {
  const { db, q } = base()
  q('Una', 'notas', null, { novedad: 'nueva', creado: T - DIA })
  q('Dos', 'notas', null, { novedad: 'nueva', creado: T - DIA })
  assert.equal(avisoMano(db, T), null, 'dos no alcanzan')
  q('Tres', 'notas', null, { novedad: 'nueva', creado: T - DIA })
  q('Vieja', 'notas', null, { novedad: 'nueva', creado: T - 30 * DIA })
  assert.match(avisoMano(db, T)!, /Llegaron 3 afirmaciones/, 'la de hace un mes no cuenta')
  fijarAjuste(db, 'mano_aviso', '0')
  assert.equal(avisoMano(db, T), null)
  assert.deepEqual(listarRutinas(db).filter((r) => r.id === 'mano').map((r) => [r.hora, r.dias]), [['19:00', '0123456']])
})

test('Territorio y honestidad: por fuente lo sellado, la niebla y las fronteras movidas; por tipo, qué valió y qué no', async () => {
  const { db, q } = base()
  q('Sellada de notas', 'notas', null, { peso: 7 })
  q('Sin pesar de notas', 'notas', null)
  q('Sin pesar de podcast', 'podcast', null)
  const nueva = q('Nueva que choca', 'podcast', null)
  const vieja = q('Vieja creencia', 'notas', null, { peso: 10 })
  db.prepare(`INSERT INTO mano_eventos (tipo, quantomo_id, otro_id, ids, estado, creado_en) VALUES ('contradiccion', ?, ?, '[]', 'actualizo', 1), ('puente', 1, 2, '[]', 'casualidad', 1), ('puente', 1, 3, '[]', 'pendiente', 1)`).run(nueva, vieja)
  const t = territorio(db)
  assert.deepEqual({ ...t.find((x) => x.fuente === 'notas') }, { fuente: 'notas', nombre: 'Notas', selladas: 2, sinPesar: 1, fronteras: 0, niebla: 33 })
  assert.deepEqual({ ...t.find((x) => x.fuente === 'podcast') }, { fuente: 'podcast', nombre: 'Podcasts', selladas: 0, sinPesar: 2, fronteras: 1, niebla: 100 })
  const h = honestidad(db)
  assert.deepEqual({ ...h.porTipo.find((x) => x.tipo === 'puente') }, { tipo: 'puente', mostradas: 2, valieron: 0, no_valieron: 1, pendientes: 1 })
  assert.equal(h.umbralPuente, 0.8)
  assert.deepEqual(Object.keys(progresoDeMano(db)), ['calibracion', 'retencion', 'ascension', 'territorio', 'honestidad'])
})

test('Guardia: ninguna pantalla del operador muestra XP, puntos ni rachas (la XP es solo de los agentes)', () => {
  for (const f of ['30-hoy.js', '31-hud.js', '47-bandeja.js', '48-mano.js', '52-criba.js', '59-aprender.js', '59-idiomas.js', '43-evidencia.js']) {
    const s = fs.readFileSync(new URL(`../web/js/${f}`, import.meta.url), 'utf8')
    // Lo que se vería en pantalla: «120 XP», una llamita, «5 días de racha», «+10 puntos».
    assert.doesNotMatch(s, /\bXP\b|🔥|días? de racha|\+\d+ ?(pts|puntos)/i, `${f} muestra un contador de volumen`)
  }
})
