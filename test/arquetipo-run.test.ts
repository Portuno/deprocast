import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { fijarFicha } from '../src/arquetipos.ts'
import { anotar, cargarBandas, fijarRun, marcarBanda, runDeArquetipo } from '../src/arquetipo-run.ts'
import { HERRAMIENTAS } from '../src/chat/herramientas.ts'

const T = new Date(2026, 10, 13, 10).getTime()
const DIA = 86_400_000

test('Fragua #330: un arquetipo tiene su run: canal, corte con umbral, bandas de 12 minutos que se marcan y su bitácora', () => {
  const db = abrir(':memory:')
  fijarFicha(db, 17, { oficio: 'Modista', elemento: 'materia' }, T)

  const vacia = runDeArquetipo(db, 17, T)
  assert.equal(vacia.canal, 'interno')
  assert.equal(vacia.corte, null)
  assert.deepEqual(vacia.bandas, [])

  fijarRun(db, 17, { canal: 'cuenta:@modista', corte: '2026-11-20', umbral: '3 sesiones con resultado' }, T)
  cargarBandas(db, 17, [{ titulo: 'Probar tres ruedos con la tela nueva' }, { titulo: 'Escribir la ficha del patrón', minutos: 24 }, { titulo: '  ' }], { origen: 'PDF del 13/11', ahora: T })
  let r = runDeArquetipo(db, 17, T + DIA)
  assert.equal(r.ficha.oficio, 'Modista')
  assert.equal(r.canal, 'cuenta:@modista')
  assert.equal(r.diasAlCorte, 6)
  assert.deepEqual(r.bandas.map((b) => [b.titulo, b.minutos, b.estado, b.origen]), [['Probar tres ruedos con la tela nueva', 12, 'pendiente', 'PDF del 13/11'], ['Escribir la ficha del patrón', 24, 'pendiente', 'PDF del 13/11']])

  marcarBanda(db, r.bandas[0].id, 'hecha', 'Dos ruedos salieron; el tercero pide otra aguja', T + DIA)
  marcarBanda(db, r.bandas[1].id, 'parcial', null, T + 2 * DIA)
  anotar(db, 17, 'Conviene una banda solo para probar agujas', T + 2 * DIA + 1)
  r = runDeArquetipo(db, 17, T + 8 * DIA)
  assert.equal(r.sesiones, 2)
  assert.equal(r.minutos, 12 + 12)
  assert.equal(r.pendientes, 0)
  assert.equal(r.vencida, true, 'pasado el corte se ve vencida')
  assert.deepEqual(r.bitacora.map((x) => x.texto), [
    'Conviene una banda solo para probar agujas',
    'corrió a medias «Escribir la ficha del patrón» (24 min)',
    'corrió «Probar tres ruedos con la tela nueva» (12 min): Dos ruedos salieron; el tercero pide otra aguja',
  ])
  assert.throws(() => marcarBanda(db, r.bandas[0].id, 'urgente'), /Estado de banda/)
  assert.throws(() => fijarRun(db, 17, { canal: 'twitter' }), /interno.*cuenta/)
  assert.throws(() => runDeArquetipo(db, 99), /del 1 al 72/)
  // Las bandas del arquetipo no son las de la run del jugador.
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM misiones`).get() as any).n, 0)
})

test('Fragua #330: desde el chat, por nombre u oficio: cargar bandas, verlas y marcarlas', async () => {
  const db = abrir(':memory:')
  fijarFicha(db, 17, { oficio: 'Modista' }, T)
  const h = (n: string) => HERRAMIENTAS.find((x) => x.nombre === n)!
  const c = await h('cargar_bandas_arquetipo').ejecutar({ arquetipo: 'el Modista', bandas: [{ titulo: 'Coser una muestra' }], origen: 'chat' }, { db } as any) as any
  assert.equal(c.bandas.length, 1)
  const v = await h('ver_run_arquetipo').ejecutar({ arquetipo: '17' }, { db } as any) as any
  assert.equal(v.bandas[0].titulo, 'Coser una muestra')
  const m = await h('marcar_banda_arquetipo').ejecutar({ banda: v.bandas[0].id, estado: 'hecha', resultado: 'Salió' }, { db } as any) as any
  assert.equal(m.sesiones, 1)
  const f = await h('fijar_run_arquetipo').ejecutar({ arquetipo: 'Modista', corte: '2026-11-30', nota: 'Arrancó' }, { db } as any) as any
  assert.equal(f.corte, '2026-11-30')
  assert.equal(f.bitacora[0].texto, 'Arrancó')
  assert.equal((await h('ver_run_arquetipo').ejecutar({ arquetipo: 'el Sastre' }, { db } as any) as any).no_encontrado, true)
})
