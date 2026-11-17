import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import * as m from '../src/mercados.ts'

test('Fragua #263 · cuotas: probabilidad, margen por casa, consenso sin margen, quién paga más y el desvío; mercados separados', () => {
  const db = abrir(':memory:')
  const T = new Date('2026-11-17T09:00:00').getTime()
  assert.equal(Math.round(m.implicita(1.10) * 1000) / 10, 90.9)
  assert.deepEqual(m.retorno(10_000, 1.16), { devuelve: 11_600, gana: 1_600 })
  const a = m.asegurarMercado(db, { evento: 'Elección X', nombre: 'Candidata A presidenta' }, T)
  const b = m.asegurarMercado(db, { evento: 'Elección X', nombre: 'Partido P más votado' }, T)
  assert.equal(m.asegurarMercado(db, { evento: 'Elección X', nombre: 'candidata a presidenta' }).id, a.id, 'el mismo mercado, sin duplicar')
  // Ayer: dos casas. Hoy: se movieron y aparece una tercera que se aparta.
  m.anotarCuotas(db, { mercado: a.id, casa: 'Casa Uno', cuotas: [{ resultado: 'sí', cuota: 1.20 }, { resultado: 'no', cuota: 4.0 }] }, T - 86_400_000)
  m.anotarCuotas(db, { mercado: a.id, casa: 'Casa Dos', cuotas: [{ resultado: 'si', cuota: 1.25 }, { resultado: 'no', cuota: 3.6 }] }, T - 86_400_000)
  m.anotarCuotas(db, { mercado: a.id, casa: 'Casa Uno', cuotas: [{ resultado: 'sí', cuota: 1.20 }, { resultado: 'no', cuota: 4.2 }] }, T)
  m.anotarCuotas(db, { mercado: a.id, casa: 'Casa Tres', cuotas: [{ resultado: 'sí', cuota: 1.60 }] }, T)
  m.anotarCuotas(db, { mercado: b.id, casa: 'Casa Uno', cuotas: [{ resultado: 'sí', cuota: 1.05 }, { resultado: 'no', cuota: 9 }] }, T)
  assert.throws(() => m.anotarCuotas(db, { mercado: a.id, casa: 'Casa Uno', cuotas: [{ resultado: 'quizás', cuota: 2 }] }), /no es un resultado/)
  assert.throws(() => m.anotarCuotas(db, { mercado: a.id, casa: 'Casa Uno', cuotas: [{ resultado: 'sí', cuota: 0.9 }] }), /Cuota inválida/)

  const r = m.analizarMercado(db, a.id, { ahora: T, desde: T - 3_600_000 })
  const uno = r.casas.find((c) => c.casa === 'Casa Uno')!
  // 1/1,20 + 1/4,2 = 0,833 + 0,238 = 1,071 → margen 7,1 %
  assert.equal(uno.margen, 7.1)
  assert.equal(r.casas.find((c) => c.casa === 'Casa Tres')!.margen, null, 'solo publicó el sí: sin margen')
  const si = r.resultados.find((x) => x.resultado === 'sí')!
  assert.deepEqual(si.mejor && { casa: si.mejor.casa, cuota: si.mejor.cuota }, { casa: 'Casa Tres', cuota: 1.6 })
  // Casa Tres da 62,5 % contra la mediana (74,2 %): se avisa; las otras dos no.
  assert.deepEqual(si.avisos.map((d) => d.casa), ['Casa Tres'])
  assert.ok(si.avisos[0].desvio! < -10)
  assert.ok(si.mejor!.valorEsperado! > 0, 'pagar 1,60 algo que el resto da al ~75 % tiene valor esperado positivo')
  assert.ok(si.movimiento != null, 'se ve cuánto se movió el consenso')
  // El otro mercado no se mezcla.
  assert.equal(m.analizarMercado(db, b.id, { ahora: T }).casas.length, 1)
  const informe = m.informeMercados(db, 'Elección X', T)
  assert.match(informe, /\*\*Candidata A presidenta\*\*/)
  assert.match(informe, /⚠ Casa Tres en «sí»: 62,5 %/)
  assert.match(informe, /Información, no consejo/)
  assert.equal(m.alertasMercados(db, T).length, 1)
})

test('Fragua #263 · encuestas: promedio de las últimas cinco con su dispersión; la misma no se repite; importar de una tabla pública', async () => {
  const db = abrir(':memory:')
  const xs = [['A', '2026-11-01', 34, 30], ['B', '2026-11-03', 36, 29], ['C', '2026-11-05', 33, 31], ['D', '2026-11-08', 35, 28], ['E', '2026-11-10', 37, 30], ['F', '2026-10-01', 20, 40]] as const
  const r = m.anotarEncuestas(db, 'Elección X', xs.map(([e, f, p, q]) => ({ encuestadora: e, campoHasta: f, muestra: '1.200', cifras: { P: p, Q: q } })))
  assert.deepEqual(r, { nuevas: 6, actualizadas: 0 })
  assert.deepEqual(m.anotarEncuestas(db, 'Elección X', [{ encuestadora: 'A', campoHasta: '2026-11-01', cifras: { P: 34.5, Q: 30 } }]), { nuevas: 0, actualizadas: 1 })
  const p = m.promedioEncuestas(db, 'Elección X')
  assert.equal(p.ultimas.length, 5, 'la vieja de octubre queda fuera del promedio')
  assert.deepEqual(p.promedio[0], { opcion: 'P', promedio: 35.1, desvio: 1.4, min: 33, max: 37, encuestas: 5 })
  m._probarExtraer(async () => [{ encuestadora: 'G', campoDesde: '2026-11-12', campoHasta: '2026-11-14', muestra: 900, cifras: { P: 36, Q: 29 } }])
  assert.deepEqual(await m.importarEncuestas(db, 'Elección X', 'https://es.wikipedia.org/wiki/Prueba'), { leidas: 1, nuevas: 1, actualizadas: 0 })
})
