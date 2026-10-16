import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { insertar } from '../src/corpus.ts'
import { asegurarEntidad, anotarConexion, duplicadosProbables, leerEntidad } from '../src/entidades.ts'
import { guardarEventos } from '../src/linea.ts'
import { _probarAcepciones, acepciones, ejesDe, separarEntidad } from '../src/ejes.ts'

test('ejes: tiempo, gente, lugares, temas y proyectos de una entidad, sin tokens', () => {
  const db = abrir(':memory:')
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Prueba' })
  const beto = asegurarEntidad(db, { tipo: 'persona', nombre: 'Beto Prueba' })
  const lugar = asegurarEntidad(db, { tipo: 'lugar', nombre: 'Valencia', meta: { lat: 39.47, lon: -0.38 } })
  const proy = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Proyecto Prueba' })
  anotarConexion(db, { a: ana, b: beto, relacion: 'socios' })
  for (const [i, f] of ['2026-01-10', '2026-01-20', '2026-03-05'].entries()) {
    const p = insertar(db, { fuente: 'operador', titulo: `Pieza ${i}`, contenido: 'algo', nivel: 'propia', fecha: f, entidades: [ana, lugar, proy], origenId: `e:${i}` })!
    db.prepare('INSERT INTO temas_pulso (clave, tema, fecha, pieza_id, origen) VALUES (?, ?, ?, ?, ?)').run('piloto', 'piloto', f, p, 'operador')
    if (i === 0) guardarEventos(db, { id: p }, [{ titulo: 'Reunión', fecha: '2026-01-12', personas: ['Ana Prueba'] }], (n) => (n === 'Ana Prueba' ? { id: ana, tipo: 'persona' } : null))
  }
  const x = ejesDe(db, ana)
  assert.deepEqual(x.tiempo.porMes.map((m) => ({ ...m })), [{ mes: '2026-01', n: 2 }, { mes: '2026-03', n: 1 }])
  assert.deepEqual(x.tiempo.eventos.map((e) => e.titulo), ['Reunión'])
  assert.deepEqual(x.gente.relaciones.map((r) => [r.nombre, r.relacion]), [['Beto Prueba', 'socios']])
  assert.deepEqual(x.lugares.map((l) => [l.nombre, l.veces, l.lat]), [['Valencia', 3, 39.47]])
  assert.deepEqual(x.temas.map((t) => ({ ...t })), [{ tema: 'piloto', n: 3 }])
  assert.deepEqual(x.proyectos.map((p) => p.nombre), ['Proyecto Prueba'])
})

test('homónimos: el modelo propone acepciones con sus piezas; separar crea otra (aunque se llame igual) y mueve sus piezas', async () => {
  const db = abrir(':memory:')
  const id = asegurarEntidad(db, { tipo: 'persona', nombre: 'Persona Homónima' })
  const p1 = insertar(db, { fuente: 'operador', titulo: 'Historia', contenido: 'Persona Homónima fue un jurista de los años 80.', nivel: 'primaria', entidades: [id], origenId: 'h:1' })!
  const p2 = insertar(db, { fuente: 'operador', titulo: 'Prácticas', contenido: 'Entró a hacer prácticas en el estudio Persona Homónima.', nivel: 'propia', entidades: [id], origenId: 'h:2' })!
  let visto = ''
  _probarAcepciones(async (_db, u) => {
    visto = u
    return { acepciones: [{ nombre: 'Persona Homónima', tipo: 'persona', descripcion: 'El jurista', piezas: [p1] }, { nombre: 'Persona Homónima (el estudio)', tipo: 'agrupacion', descripcion: 'Un estudio jurídico con su nombre', piezas: [p2, 9999] }] }
  })
  const as = await acepciones(db, id)
  assert.match(visto, new RegExp(`\\[${p2}\\] «Prácticas»: .*estudio Persona Homónima`))
  assert.equal(as.length, 2)
  assert.deepEqual(as[1].piezas.map((p) => p.id), [p2], 'las piezas que no existen se descartan')

  const r = separarEntidad(db, id, { nombre: as[1].nombre, tipo: as[1].tipo, notas: as[1].descripcion, piezas: as[1].piezas.map((p) => p.id) })
  assert.equal(r.movidas, 1)
  assert.deepEqual(JSON.parse((db.prepare('SELECT entidades FROM corpus WHERE id = ?').get(p2) as any).entidades), [r.id])
  assert.deepEqual(JSON.parse((db.prepare('SELECT entidades FROM corpus WHERE id = ?').get(p1) as any).entidades), [id])
  assert.deepEqual([leerEntidad(db, r.id)!.tipo, leerEntidad(db, r.id)!.notas], ['agrupacion', 'Un estudio jurídico con su nombre'])
  assert.ok(!duplicadosProbables(db).some((g) => g.entidades.some((e) => e.id === r.id)), 'quedan como «no son lo mismo»')
  // Hasta con el mismo nombre exacto nace otra.
  const igual = separarEntidad(db, id, { nombre: 'Persona Homónima', piezas: [p1] })
  assert.notEqual(igual.id, id)
})
