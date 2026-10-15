import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, migrar } from '../src/db.ts'
import { asegurarEntidad, fusionarEntidades, leerEntidad } from '../src/entidades.ts'
import { insertar } from '../src/corpus.ts'
import { marcarJugador } from '../src/personajes.ts'
import { guardarRelacion, leerPersona, nuevaPersona, personas, personasDeProyecto, personasParaPrompt, vincularAProyecto } from '../src/personas.ts'
import { guardarYo, leerYo, yoParaPrompt } from '../src/yo.ts'
import { _probarEscriba, promptMastropiero } from '../src/chat/index.ts'
import { HERRAMIENTAS } from '../src/chat/herramientas.ts'

_probarEscriba(async () => [])
const T = new Date(2026, 9, 20, 10).getTime()

test('personas v2: la cercanía vieja pasa a nivel; agrupaciones son jurídicas; dos números 1–12; filtros y orden', () => {
  const db = abrir(':memory:')
  const cami = asegurarEntidad(db, { tipo: 'persona', nombre: 'Camila' })
  const pela = asegurarEntidad(db, { tipo: 'persona', nombre: 'El Pela' })
  const varona = asegurarEntidad(db, { tipo: 'agrupacion', nombre: 'Varona' })
  asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Versa Producciones' })
  // Una base de antes: cercanía 4 sin nivel.
  db.prepare(`INSERT INTO relaciones (entidad_id, cercania, actualizado_en) VALUES (?, 4, 1)`).run(pela)
  db.prepare(`DELETE FROM ajustes WHERE clave = 'personas_v2'`).run()
  migrar(db)
  assert.equal(leerPersona(db, pela)!.nivel, 10, 'cercanía 4 → nivel 10')

  assert.equal(leerPersona(db, varona)!.clase, 'juridica', 'una agrupación es una persona jurídica')
  guardarRelacion(db, cami, { vinculo: 'pareja', nivel: 12, importancia: 12 }, T)
  guardarRelacion(db, varona, { nivel: 12, importancia: 9 }, T)
  assert.throws(() => guardarRelacion(db, cami, { clase: 'robot' }), /Clase desconocida/)
  assert.equal(guardarRelacion(db, cami, { nivel: 40 }, T).nivel, 12, 'se acota a 12')

  assert.deepEqual(personas(db, { clase: 'juridica' }).map((p) => p.nombre), ['Varona'])
  assert.deepEqual(personas(db, { orden: 'importancia' }).slice(0, 2).map((p) => p.nombre), ['Camila', 'Varona'])
  const sin = personas(db).find((p) => p.nombre === 'El Pela')!
  assert.equal(sin.importancia, null)

  const nadie = nuevaPersona(db, { nombre: 'Productora que quiero conocer', clase: 'juridica', importancia: 8, notas: 'hacen documentales' })
  assert.deepEqual([nadie.clase, nadie.estado, nadie.importancia, nadie.tipo], ['juridica', 'por_conocer', 8, 'agrupacion'])
  assert.deepEqual(personas(db, { estado: 'por_conocer' }).map((p) => p.id), [nadie.id])
})

test('personas v2: en sus proyectos con rol e importancia; Mastropiero sabe quién es quién', () => {
  const db = abrir(':memory:')
  const cami = asegurarEntidad(db, { tipo: 'persona', nombre: 'Camila' })
  const versa = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Versa Producciones' })
  const ecdc = asegurarEntidad(db, { tipo: 'agrupacion', nombre: 'ECDC' })
  guardarRelacion(db, cami, { vinculo: 'pareja', nivel: 12, importancia: 12 }, T)
  vincularAProyecto(db, cami, versa, { rol: 'socia', importancia: 11 })
  vincularAProyecto(db, cami, ecdc, { rol: 'compañera' })
  vincularAProyecto(db, cami, versa, { importancia: 12 }) // repetir actualiza (el rol queda)
  assert.deepEqual(leerPersona(db, cami)!.proyectos.map((x) => [x.nombre, x.rol, x.importancia]), [['Versa Producciones', 'socia', 12], ['ECDC', 'compañera', null]])
  assert.deepEqual(personasDeProyecto(db, versa).map((x) => [x.persona, x.rol]), [['Camila', 'socia']])
  assert.deepEqual(personas(db, { proyecto: ecdc }).map((p) => p.nombre), ['Camila'])
  assert.throws(() => vincularAProyecto(db, versa, cami), /no es una persona/)
  assert.match(personasParaPrompt(db, T), /Camila \(pareja, nivel 12, importancia 12\) — en Versa Producciones \(socia\), ECDC \(compañera\)/)
  assert.match(promptMastropiero(db, ''), /Camila \(pareja, nivel 12/)
})

test('el yo: su perfil entero, primero en el prompt; si no hay jugador, se crea con el nombre', () => {
  const db = abrir(':memory:')
  assert.equal(leerYo(db).entidad, null)
  assert.throws(() => guardarYo(db, { perfil: { vive: 'Valencia' } }), /cómo te llamás/)
  const largo = 'Trabajo de lunes a viernes en una agencia y de noche armo mis proyectos. '.repeat(10)
  const y = guardarYo(db, { nombre: 'Jugador Prueba', alias: ['Jota'], perfil: { vive: 'Valencia', trabajo: 'Agencia Varona', saber: largo } })
  assert.equal(y.entidad!.nombre, 'Jugador Prueba')
  assert.deepEqual(y.entidad!.alias, ['Jota'])
  assert.equal(y.perfil.vive, 'Valencia')
  const p = yoParaPrompt(db)
  assert.ok(p.includes(largo.trim()), 'entero, sin recortes')
  assert.ok(promptMastropiero(db, '').indexOf('Quién es (su perfil') < promptMastropiero(db, '').indexOf('Tu memoria de él') || !promptMastropiero(db, '').includes('Tu memoria de él'))
  guardarYo(db, { perfil: { vive: '' } })
  assert.equal(leerYo(db).perfil.vive, undefined, 'vacío lo borra')
  assert.equal(leerYo(db).perfil.trabajo, 'Agencia Varona', 'lo que no viene, queda')
  for (const n of ['editar_yo', 'nueva_persona', 'ver_persona', 'no_son_lo_mismo']) assert.ok(HERRAMIENTAS.some((h) => h.nombre === n), n)
})

test('unir: todo lo de las dos queda en una (relación, proyectos, plata, oportunidades, takeout, meta) y el yo no se pierde', () => {
  const db = abrir(':memory:')
  const a = asegurarEntidad(db, { tipo: 'persona', nombre: 'Camila Pérez' })
  const b = asegurarEntidad(db, { tipo: 'persona', nombre: 'Cami' })
  const versa = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Versa' })
  guardarRelacion(db, a, { vinculo: 'pareja', nivel: 10, notas: 'la conocí en Valencia' }, T)
  guardarRelacion(db, b, { nivel: 12, importancia: 12, notas: 'ama el cine' }, T)
  vincularAProyecto(db, b, versa, { rol: 'socia' })
  insertar(db, { fuente: 'operador', titulo: 'x', contenido: 'y', entidades: [b], origenId: 'p:1' })
  db.prepare(`INSERT INTO movimientos (fecha, monto, moneda, categoria, descripcion, origen, huella, entidad_id, creado_en) VALUES ('2026-10-01', -20, 'EUR', 'ocio', 'cine', 'manual', 'h1', ?, 1)`).run(b)
  db.prepare(`INSERT INTO takeout_nombres (clave, nombre, tipo, veces, estado, entidad_id, creada_en) VALUES ('cami', 'Cami', 'persona', 3, 'aceptada', ?, 1)`).run(b)
  db.prepare(`UPDATE entidades SET meta = '{"cumple":"03-12"}' WHERE id = ?`).run(b)

  fusionarEntidades(db, a, [b])
  const p = leerPersona(db, a)!
  assert.deepEqual([p.vinculo, p.nivel, p.importancia], ['pareja', 12, 12], 'lo más alto de cada número, lo que había de cada lado')
  assert.match(p.notas!, /la conocí en Valencia[\s\S]*ama el cine/)
  assert.deepEqual(p.proyectos.map((x) => [x.nombre, x.rol]), [['Versa', 'socia']])
  assert.equal(p.menciones, 1)
  assert.ok(p.alias.includes('Cami'))
  assert.equal((db.prepare('SELECT entidad_id FROM movimientos').get() as any).entidad_id, a)
  assert.equal((db.prepare('SELECT entidad_id FROM takeout_nombres').get() as any).entidad_id, a)
  assert.equal(leerEntidad(db, a)!.meta?.cumple, '03-12')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM relaciones').get() as any).n, 1)

  // Si la absorbida era él, la que queda pasa a ser él.
  const yo = asegurarEntidad(db, { tipo: 'persona', nombre: 'Jugador' })
  const yo2 = asegurarEntidad(db, { tipo: 'persona', nombre: 'Jugador Completo' })
  marcarJugador(db, yo)
  fusionarEntidades(db, yo2, [yo])
  assert.ok(leerEntidad(db, yo2)!.meta?.operador)
})
