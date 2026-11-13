import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fechaLocal } from '../src/db.ts'
import { registrarSalud } from '../src/salud.ts'
import { crearQuantomo, leerQuantomo } from '../src/quantomos.ts'
import { _probarHipotesis, abrirPrueba, leerPrueba, medir, probar, probarPendientes, revisarPruebas, textoDeRevision, veredicto } from '../src/hipotesis.ts'

const DIA = 86_400_000
const T0 = new Date(2026, 9, 1, 12).getTime() // jue 1/10
const f = (i: number) => fechaLocal(T0 + i * DIA)

/** 21 días: los que duerme poco (≤ 6 h) casi nunca entrena; los demás, casi siempre. */
function sembrar(db: any, entrenaSiDuermePoco: (i: number) => boolean, entrenaSiDuermeBien: (i: number) => boolean) {
  for (let i = 0; i < 21; i++) {
    const poco = i % 2 === 0
    registrarSalud(db, { tipo: 'sueno', fecha: f(i), datos: { horas: poco ? 5 : 8 } })
    if (poco ? entrenaSiDuermePoco(i) : entrenaSiDuermeBien(i)) registrarSalud(db, { tipo: 'ejercicio', titulo: 'Correr', fecha: f(i), datos: { minutos: 30 } })
  }
}
const cond = { tipo: 'sueno_horas', op: '<=', valor: 6 }
const res = { tipo: 'ejercicio', valor: false }

test('la hipótesis a prueba: tres semanas comparando los días con la condición contra los demás; confirmada va a la memoria como hecho medido', async () => {
  const db = abrir(':memory:')
  sembrar(db, (i) => i === 0, () => true) // duerme poco: entrena 1 de 11; duerme bien: 10 de 10
  const q = crearQuantomo(db, { texto: 'Los días que duermo poco no entreno', titulo: 'Hipótesis (combo)', universo: 'hipotesis' }, T0)
  const p = abrirPrueba(db, { quantomoId: q, hipotesis: 'Los días que duermo poco no entreno', condicion: cond, resultado: res }, T0)!
  assert.equal(p.desde, f(0))
  assert.equal(p.hasta, f(20))
  assert.equal(abrirPrueba(db, { quantomoId: q, hipotesis: 'otra vez', condicion: cond, resultado: res }, T0), null, 'una prueba por hipótesis')
  assert.equal(abrirPrueba(db, { hipotesis: 'mal', condicion: { tipo: 'inventado' }, resultado: res }, T0), null, 'criterios que no existen no abren nada')

  // A la mitad: sigue corriendo, con lo medido hasta ayer.
  assert.deepEqual(await revisarPruebas(db, T0 + 10 * DIA), [])
  assert.equal(leerPrueba(db, p.id)!.estado, 'en_prueba')
  assert.equal(leerPrueba(db, p.id)!.tabla!.con.dias, 5)

  const r = await revisarPruebas(db, T0 + 21 * DIA)
  assert.equal(r[0].estado, 'confirmada')
  assert.match(r[0].texto, /Los días en que duerme como mucho 6 h, no entrena el 91 % \(10 de 11\); los demás días, el 0 % \(0 de 10\)\. Sus datos la sostienen\. Es una comparación de sus días, no un experimento/)
  const mem = db.prepare(`SELECT texto, tipo FROM memoria ORDER BY id DESC LIMIT 1`).get() as any
  assert.equal(mem.tipo, 'hecho')
  assert.match(mem.texto, /^Medido en sus días \(2026-10-01 → 2026-10-21\): Los días que duermo poco no entreno/)
  assert.match(textoDeRevision(r)!, /🔬 Hipótesis a prueba:\n✓ «Los días que duermo poco no entreno» — confirmada/)
})

test('refutada (no hay diferencia) descarta la hipótesis; sin días de un lado, sin datos; una diferencia chica se estira una vez', async () => {
  const db = abrir(':memory:')
  sembrar(db, (i) => i % 4 === 0, (i) => i % 4 === 1) // entrena más o menos igual con o sin sueño corto
  const q = crearQuantomo(db, { texto: 'Duermo poco y no entreno', titulo: 'Hipótesis (combo)', universo: 'hipotesis' }, T0)
  abrirPrueba(db, { quantomoId: q, hipotesis: 'Duermo poco y no entreno', condicion: cond, resultado: res }, T0)
  const r = await revisarPruebas(db, T0 + 21 * DIA)
  assert.equal(r[0].estado, 'refutada')
  assert.equal(leerQuantomo(db, q!)!.etapa, 'descartado')

  // Sin días de un lado.
  const v = veredicto({ condicion: cond as any, resultado: res as any, estirada: false }, { con: { dias: 2, paso: 2 }, sin: { dias: 15, paso: 1 }, sinDato: 4 })
  assert.equal(v.estado, 'sin_datos')
  assert.match(v.texto, /faltaron días en que duerme como mucho 6 h \(hubo 2\), y 4 días no tenían con qué medirlo/)
  // Dudosa: se estira 14 días una vez.
  assert.equal(veredicto({ condicion: cond as any, resultado: res as any, estirada: false }, { con: { dias: 10, paso: 6 }, sin: { dias: 10, paso: 4 }, sinDato: 0 }).estado, 'dudosa')
})

test('un día sin el dato (no anotó el sueño) no cuenta para ningún lado; una hipótesis vieja se traduce a criterios con el modelo, y la que no se puede medir no se reintenta', async () => {
  const db = abrir(':memory:')
  registrarSalud(db, { tipo: 'ejercicio', titulo: 'Correr', fecha: f(0), datos: { minutos: 30 } })
  const p = abrirPrueba(db, { hipotesis: 'x', condicion: cond, resultado: res }, T0)!
  assert.deepEqual(medir(db, p, f(0)), { con: { dias: 0, paso: 0 }, sin: { dias: 0, paso: 0 }, sinDato: 1 })

  const pedidos: string[] = []
  _probarHipotesis(async (_db, _s, u) => { pedidos.push(u); return /lluvia/.test(u) ? { condicion: null, resultado: null, porque: 'No hay datos del clima' } : { condicion: cond, resultado: res } })
  const r = await probar(db, { texto: 'Cuando duermo poco no entreno', predice: 'menos entrenos' }, T0)
  assert.ok(r.prueba)
  assert.match(pedidos[0], /Predice: menos entrenos/)
  crearQuantomo(db, { texto: 'Los días de lluvia escribo más', titulo: 'Hipótesis (combo)', universo: 'hipotesis' }, T0)
  crearQuantomo(db, { texto: 'Cuando entreno duermo más', titulo: 'Hipótesis (combo)', universo: 'hipotesis' }, T0)
  assert.equal(await probarPendientes(db, 5, T0), 1)
  assert.equal(await probarPendientes(db, 5, T0), 0, 'la de la lluvia quedó marcada como no medible')
  assert.equal(pedidos.length, 3)
})

test('una hipótesis que nace de un combo de La Mano sale con su prueba abierta (y el texto del combo dice qué se mide y hasta cuándo)', async () => {
  const { _probarMano, armarHipotesis, leerSorpresa } = await import('../src/mano.ts')
  const db = abrir(':memory:')
  const a = crearQuantomo(db, { texto: 'Cuando duermo cinco horas no salgo a correr', titulo: 'a' }, T0)
  const b = crearQuantomo(db, { texto: 'Los lunes sin entrenar rindo menos', titulo: 'b' }, T0)
  const ev = Number(db.prepare(`INSERT INTO mano_eventos (tipo, quantomo_id, ids, estado, creado_en) VALUES ('combo', ?, ?, 'pendiente', ?)`).run(a, JSON.stringify([a, b]), T0).lastInsertRowid)
  let vio = ''
  _probarMano({ modelo: async (_db, s) => { vio = s; return { hipotesis: 'Los días que duermo poco no entreno', predice: 'menos entrenos', refutaria: 'entrenar igual', condicion: cond, resultado: res } } })
  await armarHipotesis(db, ev, T0)
  assert.match(vio, /"condicion" y "resultado"[\s\S]*sueno_horas/)
  const s = leerSorpresa(db, ev)!
  assert.match(s.texto!, /A prueba hasta el 21\/10: los días en que duerme como mucho 6 h, ¿no entrena más que los demás\?/)
  const p = db.prepare('SELECT * FROM hipotesis_pruebas WHERE quantomo_id = ?').get(s.hipotesisId) as any
  assert.equal(p.estado, 'en_prueba')
})
