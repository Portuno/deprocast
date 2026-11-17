import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { caducarOportunidades, guardarOportunidad, leerOportunidad, marcarOportunidad, marcarOportunidades } from '../src/radar.ts'

test('Fragua #304 · el radar vence solo lo que pasó su fecha (sin borrar), y se resuelve en bloque con motivo', () => {
  const db = abrir(':memory:')
  const T = new Date('2026-11-17T10:00:00').getTime()
  const o = (titulo: string, x: Record<string, unknown> = {}, creada = T) => guardarOportunidad(db, { titulo, url: `https://op.test/${titulo}`, ...x } as any, creada)!.id
  const cerro = o('Convocatoria cerrada', { cierre: '2026-11-10' })
  const abierta = o('Convocatoria abierta', { cierre: '2026-12-01' })
  const fue = o('Evento que ya fue', { donde: { lugar: null, online: 1, lat: null, lon: null, fecha: '2026-11-01', fechaFin: null } })
  const vieja = o('Tema viejo sin fecha', {}, T - 40 * 86_400_000)
  const nueva = o('Tema nuevo sin fecha', {}, T - 5 * 86_400_000)
  const hecha = o('Hecha', { cierre: '2026-11-01' })
  marcarOportunidad(db, hecha, 'hecha', T)
  db.prepare('UPDATE oportunidades SET actualizada_en = ? WHERE id = ?').run(T - 40 * 86_400_000, vieja)
  assert.equal(caducarOportunidades(db, T), 3)
  assert.equal(leerOportunidad(db, cerro)!.estado, 'vencida')
  assert.equal(leerOportunidad(db, cerro)!.motivo, 'cerró el 2026-11-10')
  assert.equal(leerOportunidad(db, fue)!.estado, 'vencida')
  assert.equal(leerOportunidad(db, vieja)!.motivo, '30 días sin tocarla')
  for (const id of [abierta, nueva]) assert.equal(leerOportunidad(db, id)!.estado, 'nueva')
  assert.equal(leerOportunidad(db, hecha)!.estado, 'hecha', 'lo hecho no vence')
  assert.equal(caducarOportunidades(db, T), 0, 'una vez')
  // Triaje en bloque: dos descartadas con el mismo motivo; una vencida se recupera.
  assert.equal(marcarOportunidades(db, [abierta, nueva, 9999], 'descartada', 'no es para este año', T), 2)
  assert.equal(leerOportunidad(db, nueva)!.motivo, 'no es para este año')
  marcarOportunidad(db, cerro, 'nueva', T)
  assert.equal(leerOportunidad(db, cerro)!.motivo, 'rescatada')
  assert.throws(() => marcarOportunidad(db, cerro, 'rara' as any), /Estado inválido/)
})

test('Fragua #304 · una vencida que él recupera no vuelve a vencer sola', () => {
  const db = abrir(':memory:')
  const T = new Date('2026-11-17T10:00:00').getTime()
  const id = guardarOportunidad(db, { titulo: 'Cerrada', url: 'https://op.test/x', cierre: '2026-11-10' } as any, new Date('2026-11-01T10:00:00').getTime())!.id
  assert.equal(caducarOportunidades(db, T), 1)
  marcarOportunidad(db, id, 'me_interesa', T + 1000)
  assert.equal(caducarOportunidades(db, T + 60_000), 0)
  assert.equal(leerOportunidad(db, id)!.estado, 'me_interesa')
})
