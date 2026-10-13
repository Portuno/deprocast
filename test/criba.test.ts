import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { buscar, insertar } from '../src/corpus.ts'
import { cribar, deshacerUltima, marcador, siguiente } from '../src/criba.ts'
import { crearQuantomo, descartarLote, gruposProto, leerQuantomo, sellarLote } from '../src/quantomos.ts'

const dia = (d: number) => new Date(2026, 9, d, 12).getTime()

test('criba: links y lo propio primero, nunca lo generado; peso, descarte, deshacer y racha', () => {
  const db = abrir(':memory:')
  const gen = insertar(db, { fuente: 'operador', titulo: 'Informe de agente sobre café', contenido: 'café', nivel: 'generada', origenId: 'c:g' })!
  const prim = insertar(db, { fuente: 'operador', titulo: 'Libro sobre café', contenido: 'café de especialidad', nivel: 'primaria', origenId: 'c:p' })!
  const propia = insertar(db, { fuente: 'operador', titulo: 'Mi nota de café', contenido: 'el café de la esquina', nivel: 'propia', origenId: 'c:n' })!
  const link = insertar(db, { fuente: 'operador', tipo: 'enlace', titulo: 'Reel de café', contenido: 'https://x/reel', nivel: 'primaria', origenId: 'c:l' })!

  assert.equal(siguiente(db)!.id, link)
  assert.equal(siguiente(db, { saltear: [link] })!.id, propia)
  assert.equal(siguiente(db, { nivel: 'primaria', saltear: [link] })!.id, prim)
  assert.throws(() => cribar(db, link, 13), /1 a 12/)

  cribar(db, link, 0, dia(5))
  cribar(db, propia, 12, dia(6))
  let m = cribar(db, prim, 3, dia(7))
  assert.deepEqual(m, { hoy: 1, racha: 3, cribadas: 3, faltan: 0, descartadas: 1 })
  assert.equal(siguiente(db), null, 'lo generado no se criba')
  assert.equal(marcador(db, dia(8)).racha, 3, 'hoy todavía no: la racha sigue viva')
  assert.equal(marcador(db, dia(9)).racha, 0, 'un día sin cribar la corta')

  // El peso ordena la búsqueda: descartado al fondo, lo pesado arriba; lo generado sigue último.
  const orden = buscar(db, 'café', 10).map((p) => p.id)
  assert.equal(orden[0], propia)
  assert.deepEqual(orden.slice(-2), [link, gen])

  const d = deshacerUltima(db, dia(7))
  assert.equal(d.pieza!.id, prim)
  assert.equal(d.pieza!.peso, null)
  assert.equal(d.marcador.hoy, 0)
})

test('sellado por lotes', () => {
  const db = abrir(':memory:')
  // Crear 12 proto quántomos: 7 en un grupo (universo 'café', pieza null), 5 en otro (universo 'huerta', pieza null)
  const ids1: number[] = []
  const ids2: number[] = []
  for (let i = 0; i < 7; i++) {
    const id = crearQuantomo(db, { texto: `Quántomo de café número ${i}`, universo: 'café' })
    if (id) ids1.push(id)
  }
  for (let i = 0; i < 5; i++) {
    const id = crearQuantomo(db, { texto: `Quántomo de huerta número ${i}`, universo: 'huerta' })
    if (id) ids2.push(id)
  }
  assert.equal(ids1.length, 7)
  assert.equal(ids2.length, 5)

  // Grupos: dos grupos, ordenados por cantidad descendente
  const grupos = gruposProto(db)
  assert.equal(grupos.length, 2)
  assert.equal(grupos[0].universo, 'café')
  assert.equal(grupos[0].n, 7)
  assert.equal(grupos[1].universo, 'huerta')
  assert.equal(grupos[1].n, 5)

  // Sellar el primer lote con peso 8
  const r = sellarLote(db, ids1, 8)
  assert.equal(r.sellados, 7)
  for (const id of ids1) {
    const q = leerQuantomo(db, id)!
    assert.equal(q.etapa, 'sellado')
    assert.equal(q.peso, 8)
  }

  // El segundo lote sigue en proto
  const grupos2 = gruposProto(db)
  assert.equal(grupos2.length, 1)
  assert.equal(grupos2[0].universo, 'huerta')
  assert.equal(grupos2[0].n, 5)

  // Descartar el segundo lote con motivo
  const r2 = descartarLote(db, ids2, 'sin sustancia')
  assert.equal(r2.descartados, 5)
  for (const id of ids2) {
    const q = leerQuantomo(db, id)!
    assert.equal(q.etapa, 'descartado')
    assert.ok(q.procedencia!.includes('sin sustancia'))
  }

  // No quedan proto
  assert.equal(gruposProto(db).length, 0)

  // Sellar un lote vacío lanza error
  assert.throws(() => sellarLote(db, [], 5), /Lote vacío/)
  // Sellar con peso inválido lanza error
  assert.throws(() => sellarLote(db, [ids1[0]], 13), /1 a 12/)
})
