import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
const { abrir } = await import('../src/db.ts')
const seg = await import('../src/segmento.ts')
const { insertar } = await import('../src/corpus.ts')
const { anotarConexion } = await import('../src/entidades.ts')

const T = new Date(2026, 10, 3, 10).getTime()

function sembrar() {
  const db = abrir(':memory:')
  const ent = (tipo: string, nombre: string, notas: string | null = null) => Number(db.prepare('INSERT INTO entidades (tipo, nombre, notas, creada_en) VALUES (?, ?, ?, ?)').run(tipo, nombre, notas, T).lastInsertRowid)
  const proyecto = ent('proyecto', 'Proyecto Ejemplo', 'un proyecto de prueba')
  const ana = ent('persona', 'Ana Prueba')
  const beto = ent('persona', 'Beto Prueba')
  const ajena = ent('persona', 'Otra Persona')
  const concepto = ent('concepto', 'Retórica')
  db.prepare('INSERT INTO persona_proyecto (persona_id, proyecto_id, rol, importancia, desde) VALUES (?, ?, ?, ?, ?)').run(ana, proyecto, 'diseño', 3, T)
  anotarConexion(db, { a: ana, b: beto, relacion: 'trabajan juntos' }, T)
  anotarConexion(db, { a: beto, b: ajena, relacion: 'se conocen' }, T)
  db.prepare('INSERT INTO relaciones (entidad_id, vinculo, cercania, actualizado_en) VALUES (?, ?, ?, ?)').run(ana, 'colega', 8, T)
  const p1 = insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Notas del proyecto', contenido: 'Ana y la retórica del proyecto.', estado: 'disponible', entidades: [proyecto, ana, concepto] } as any, T)!
  const p2 = insertar(db, { fuente: 'operador', nivel: 'propia', titulo: 'Otra cosa', contenido: 'Nada que ver.', estado: 'disponible', entidades: [ajena] } as any, T)!
  const q = (pieza: number, texto: string, etapa: string) => db.prepare('INSERT INTO quantomos (pieza_id, texto, etapa, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?)').run(pieza, texto, etapa, T, T)
  q(p1, 'El proyecto vive de la retórica', 'sellado')
  q(p1, 'Una idea a medio hacer', 'proto')
  q(p1, 'Una vieja', 'superado')
  q(p2, 'De otra persona', 'sellado')
  return { db, proyecto, ana, beto, ajena, concepto, p1, p2 }
}

test('Elegir y ver vinculaciones: conexiones, equipo y lo que aparece junto en los textos (sin las ya elegidas)', () => {
  const { db, proyecto, ana, beto, concepto } = sembrar()
  assert.deepEqual(seg.buscarEntidades(db, { q: 'prueba', tipo: 'persona' }).map((e) => e.nombre).sort(), ['Ana Prueba', 'Beto Prueba'])
  const v = seg.vecindario(db, [proyecto])
  assert.equal(v.elegidas[0].quantomos, 2, 'cuenta los vivos (no superados)')
  const ana1 = v.vinculos.find((x) => x.id === ana && x.por === 'equipo')!
  assert.match(ana1.detalle, /diseño · en el equipo de Proyecto Ejemplo/)
  assert.ok(v.vinculos.some((x) => x.id === concepto && x.por === 'textos' && /1 pieza con Proyecto Ejemplo/.test(x.detalle)))
  const v2 = seg.vecindario(db, [proyecto, ana])
  assert.ok(!v2.vinculos.some((x) => x.id === ana), 'una elegida no aparece como vínculo')
  assert.ok(v2.vinculos.some((x) => x.id === beto && x.por === 'conexion' && /trabajan juntos con Ana Prueba/.test(x.detalle)))
})

test('Exportar a medida: solo las elegidas, sus relaciones (entre ellas o hacia afuera), quántomos por etapa y piezas', () => {
  const { db, proyecto, ana, beto, ajena, p1 } = sembrar()
  const r = seg.exportarSegmento(db, { entidades: [proyecto, ana, beto], relaciones: 'entre', quantomos: ['sellado'], piezas: 'referencias', relacionPersonal: true }, T)
  assert.equal(r.formato, 'deprocast-segmento')
  assert.deepEqual(r.entidades.map((e: any) => e.nombre).sort(), ['Ana Prueba', 'Beto Prueba', 'Proyecto Ejemplo'])
  assert.deepEqual(r.relaciones.map((x: any) => x.tipo).sort(), ['conexion', 'equipo'], 'Beto–Otra queda afuera: es hacia afuera')
  assert.equal((r.entidades.find((e: any) => e.id === ana) as any).relacion_personal.vinculo, 'colega')
  assert.deepEqual(r.quantomos.map((q: any) => q.texto), ['El proyecto vive de la retórica'], 'solo sellados, solo de sus piezas')
  assert.deepEqual(r.quantomos[0].entidades.sort(), [proyecto, ana].sort())
  assert.equal(r.piezas.length, 1)
  assert.equal(r.piezas[0].id, p1)
  assert.equal(r.piezas[0].contenido, undefined, 'referencias: sin texto')
  assert.ok(!JSON.stringify(r).includes('De otra persona'), 'nada de lo que no se eligió')

  const afuera = seg.exportarSegmento(db, { entidades: [beto], relaciones: 'afuera', quantomos: [], piezas: 'no', notas: false }, T)
  assert.equal(afuera.relaciones.length, 2)
  assert.deepEqual(afuera.entidades_afuera!.map((e: any) => e.id).sort(), [ana, ajena].sort(), 'la otra punta viaja como referencia')
  assert.deepEqual(afuera.quantomos, [])
  assert.equal(afuera.entidades[0].notas, undefined)

  const completas = seg.exportarSegmento(db, { entidades: [proyecto], piezas: 'completas', coocurrencias: true }, T)
  assert.match(completas.piezas[0].contenido, /retórica del proyecto/)
  assert.throws(() => seg.exportarSegmento(db, { entidades: [] }), /al menos una/)
})

test('Previa y esquemas guardados: se ve cuánto pesa, se guarda con nombre, se reusa y se borra', () => {
  const { db, proyecto, ana } = sembrar()
  const p = seg.previa(db, { entidades: [proyecto, ana], quantomos: ['sellado', 'proto'] })
  assert.equal(p.entidades, 2)
  assert.equal(p.quantomos, 2)
  assert.ok(p.bytes > 100)
  assert.throws(() => seg.guardarEsquema(db, { entidades: [proyecto] }), /nombre/)
  const g = seg.guardarEsquema(db, { nombre: 'El proyecto y su gente', entidades: [proyecto, ana], relaciones: 'afuera' }, T)
  assert.equal(g.esquema.relaciones, 'afuera')
  seg.guardarEsquema(db, { nombre: 'El proyecto y su gente', entidades: [proyecto], relaciones: 'entre' }, T + 1000)
  assert.equal(seg.listarEsquemas(db).length, 1, 'mismo nombre: se actualiza')
  assert.deepEqual(seg.listarEsquemas(db)[0].esquema.entidades, [proyecto])
  seg.borrarEsquema(db, g.id)
  assert.equal(seg.listarEsquemas(db).length, 0)
})
