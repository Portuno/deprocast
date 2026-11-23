import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { anotarConexion, asegurarEntidad } from '../src/entidades.ts'
import { insertar, leerPieza } from '../src/corpus.ts'
import { guardarEmpresa } from '../src/empresas.ts'
import { _probarModelo } from '../src/modelo.ts'
import { HERRAMIENTAS, ejecutarHerramienta } from '../src/chat/herramientas.ts'
import { _probarFichasWeb, alCorpus, anotarCliente, anotarCuentas, anotarPersona, fichaDe, guardarDatos, historiaDe, investigarFicha, solvenciaDe } from '../src/fichas.ts'

const T = new Date(2026, 10, 19, 10).getTime()
const DIA = 86_400_000

test('Fragua #302: un molde para empresa, proyecto y lugar, con la historia de cada dato y de dónde salió', async () => {
  const db = abrir(':memory:')
  const emp = asegurarEntidad(db, { tipo: 'empresa', nombre: 'Talleres Norte' })
  const proy = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Huerta de balcón' })
  const lugar = asegurarEntidad(db, { tipo: 'lugar', nombre: 'Café del puerto' })
  const persona = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Pérez' })

  await guardarDatos(db, lugar, { horario: 'L–V 8 a 20', direccion: 'Calle Mar 1', inventado: 'x' }, { ahora: T })
  assert.deepEqual(fichaDe(db, lugar).campos.filter((c) => c.valor).map((c) => [c.k, c.valor]), [['direccion', 'Calle Mar 1'], ['horario', 'L–V 8 a 20']])
  await guardarDatos(db, lugar, { horario: 'L–S 8 a 22' }, { fuente: 'chat', ahora: T + DIA })
  assert.deepEqual(historiaDe(db, lugar).map((h) => [h.campo, h.antes, h.despues, h.fuente]), [['horario', 'L–V 8 a 20', 'L–S 8 a 22', 'chat'], ['direccion', null, 'Calle Mar 1', 'a mano'], ['horario', null, 'L–V 8 a 20', 'a mano']])
  await guardarDatos(db, proy, { queHace: 'Cultiva en balcones', estado: 'activo' }, { ahora: T })
  assert.equal(fichaDe(db, proy).entidad.tipo, 'proyecto')
  await assert.rejects(guardarDatos(db, persona, { web: 'x' }), /no tienen ficha/)

  // La empresa: los campos de la #164 (por guardarEmpresa, con su puntaje) y los nuevos, todo con historia.
  await guardarDatos(db, emp, { cif: 'b-12345678', actividad: 'Carpintería metálica' }, { fuente: 'https://ejemplo.test/registro', ahora: T })
  guardarEmpresa(db, emp, { criterio: { nombre: 'Reputación', valor: 7 } }, T + 1)
  const h = historiaDe(db, emp).map((x) => [x.campo, x.despues, x.fuente])
  assert.ok(h.some(([c, d, f]) => c === 'cif' && d === 'B12345678' && f === 'https://ejemplo.test/registro'), JSON.stringify(h))
  assert.ok(h.some(([c, d]) => c === 'actividad' && d === 'Carpintería metálica'))
  assert.ok(h.some(([c, d]) => c === 'criterio · Reputación' && d === '7'))
  assert.ok(h.some(([c, d]) => c === 'puntaje' && d === '7'))
})

test('Fragua #302: órganos (quién firma), cuentas con la solvencia que sale de ellas, clientes y cruces con sus proyectos', async () => {
  const db = abrir(':memory:')
  const emp = asegurarEntidad(db, { tipo: 'empresa', nombre: 'Talleres Norte' })
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Pérez' })
  const rival = asegurarEntidad(db, { tipo: 'empresa', nombre: 'Rival SA' })
  const suyo = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Huerta de balcón' })
  anotarConexion(db, { a: rival, b: suyo, relacion: 'compite con' })

  anotarPersona(db, emp, { nombre: 'Ana Pérez', rol: 'Administradora única', fuente: 'https://ejemplo.test/borme', fecha: '2025-03-01' }, T)
  anotarPersona(db, emp, { nombre: 'Luis Gómez', rol: 'Director comercial', fuente: 'https://ejemplo.test/web' }, T)
  anotarPersona(db, emp, { nombre: 'Luis Gómez', rol: 'Director comercial', vigente: false, fuente: 'https://ejemplo.test/borme2' }, T + DIA)
  const f0 = fichaDe(db, emp)
  assert.deepEqual(f0.personas.map((p) => [p.nombre, p.firma, p.vigente, p.personaId]), [['Ana Pérez', true, true, ana], ['Luis Gómez', false, false, null]])
  assert.ok(historiaDe(db, emp).some((x) => x.campo === 'persona:Luis Gómez' && x.antes === 'Director comercial' && x.despues === null), 'el cese queda en la historia')

  assert.equal(solvenciaDe([]), null)
  anotarCuentas(db, emp, { ejercicio: 2024, ingresos: 1_200_000, resultado: 80_000, patrimonio: 600_000, activo: 1_000_000, empleados: 14, depositadas: '2025-07-20', fuente: 'https://ejemplo.test/cuentas' }, T)
  anotarCuentas(db, emp, { ejercicio: 2031, ingresos: 1 }, T)
  const s = solvenciaDe(fichaDe(db, emp).cuentas)!
  assert.equal(s.valor, 9, 'patrimonio 60 % del activo (+3) y ganó (+1)')
  assert.match(s.nota, /cuentas 2024 \(depositadas el 2025-07-20\): patrimonio 60 % del activo, ganó 80\.000 €/)
  assert.equal(fichaDe(db, emp).cuentas.length, 1, 'un ejercicio del futuro no entra')
  assert.equal(solvenciaDe([{ ejercicio: 2024, ingresos: null, resultado: -5, patrimonio: -10, activo: 100, empleados: null, depositadas: null, fuente: null }])!.valor, 1, 'patrimonio negativo')

  anotarCliente(db, emp, { nombre: 'Rival SA', fuente: 'https://ejemplo.test/casos' }, T)
  anotarCliente(db, emp, { nombre: 'Huerta de balcón', fuente: 'https://ejemplo.test/casos' }, T)
  anotarCliente(db, emp, { nombre: 'Talleres Norte' }, T)
  const f = fichaDe(db, emp)
  assert.deepEqual(f.clientes.map((c) => c.nombre), ['Huerta de balcón', 'Rival SA'], 'ella misma no es su cliente')
  assert.deepEqual(f.cruces.map((c) => [c.cliente, c.proyecto, c.alerta]), [['Rival SA', 'Huerta de balcón', true], ['Huerta de balcón', 'Huerta de balcón', false]])
  assert.match(f.cruces[0].como, /compite con/)
})

test('Fragua #302: su gente en la empresa, con la última vez que se juntaron; y la ficha como pieza viva del corpus', async () => {
  const db = abrir(':memory:')
  const emp = asegurarEntidad(db, { tipo: 'empresa', nombre: 'Talleres Norte' })
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Pérez' })
  db.prepare(`INSERT INTO relaciones (entidad_id, vinculo, ultimo_contacto, actualizado_en) VALUES (?, 'conocida', '2026-11-10', ?)`).run(ana, T)
  insertar(db, { fuente: 'operador', titulo: 'Reunión con Ana', contenido: 'Hablamos del presupuesto de Talleres Norte.', nivel: 'propia', fecha: '2026-11-12', entidades: [emp, ana], origenId: 'p:1' })
  insertar(db, { fuente: 'operador', titulo: 'Llamada vieja', contenido: 'Ana, de Talleres Norte.', nivel: 'propia', fecha: '2026-09-01', entidades: [emp, ana], origenId: 'p:2' })
  const v = fichaDe(db, emp).vinculos
  assert.deepEqual(v.map((x) => [x.nombre, x.suGente, x.ultimoContacto, x.ultimaPieza?.titulo, x.piezas]), [['Ana Pérez', true, '2026-11-10', 'Reunión con Ana', 2]])

  assert.equal(await alCorpus(db, emp, T), null, 'sin datos todavía no es una ficha')
  await guardarDatos(db, emp, { web: 'talleresnorte.test' }, { ahora: T })
  const id = (await alCorpus(db, emp, T))!
  assert.ok(id)
  assert.match(leerPieza(db, id)!.contenido, /# Talleres Norte[\s\S]*\*\*Web:\*\* talleresnorte\.test[\s\S]*## Su gente acá\n- Ana Pérez · última vez juntos: 2026-11-12/)
  anotarCliente(db, emp, { nombre: 'Huerta Sur', fuente: 'chat' }, T)
  assert.equal(await alCorpus(db, emp, T + DIA), id, 'se reescribe la misma pieza')
  assert.match(leerPieza(db, id)!.contenido, /## Clientes\n- Huerta Sur/)
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE fuente = 'fichas'`).get()!.n, 1)
})

test('Fragua #302: investigar llena lo vacío con fuente, descarta lo que no la trae, no pisa lo suyo y calcula la solvencia', async () => {
  const db = abrir(':memory:')
  const emp = asegurarEntidad(db, { tipo: 'empresa', nombre: 'Talleres Norte' })
  await guardarDatos(db, emp, { web: 'https://talleresnorte.test', direccion: 'Calle Uno 1' }, { ahora: T })
  const consultas: string[] = []
  _probarFichasWeb({
    buscar: async (_db, q) => { consultas.push(q); return q.includes('BORME') ? [{ titulo: 'BORME · Talleres Norte SL', url: 'https://borme.test/1', extracto: 'Nombramientos. Adm. Único: Pérez Ana. 01/03/2025', proveedor: 'x' }] : [] },
    leer: async (url) => (url === 'https://talleresnorte.test' ? { titulo: 'Talleres Norte', texto: 'Somos carpintería metálica. [Clientes](/clientes)' } : url === 'https://talleresnorte.test/clientes' ? { titulo: 'Clientes', texto: 'Trabajamos para Ayuntamiento de Ejemplo.' } : null),
  })
  _probarModelo(async () => ({
    texto: JSON.stringify({
      datos: { actividad: { valor: 'Carpintería metálica', fuente: 'https://talleresnorte.test' }, direccion: { valor: 'Calle Dos 2', fuente: 'https://borme.test/1' }, cif: { valor: 'B99999999', fuente: 'https://inventada.test' } },
      personas: [{ nombre: 'Ana Pérez', rol: 'Administradora única', fecha: '2025-03-01', vigente: true, fuente: 'https://borme.test/1' }, { nombre: 'Juan Sinfuente', rol: 'Director', fuente: '' }],
      cuentas: [{ ejercicio: 2024, patrimonio: 200_000, activo: 1_000_000, resultado: -10_000, fuente: 'https://borme.test/1' }],
      clientes: [{ nombre: 'Ayuntamiento de Ejemplo', fuente: 'https://talleresnorte.test/clientes' }],
    }), llamadas: [], razonamiento: null, modelo: 'm', tokens: 10,
  }))
  const r = await investigarFicha(db, emp, { ahora: T })
  assert.ok(consultas.some((q) => /"Talleres Norte" administrador BORME/.test(q)))
  assert.deepEqual(r.llenados, ['actividad'])
  assert.deepEqual(r.discrepancias.map((d) => [d.campo, d.tenias, d.dice]), [['direccion', 'Calle Uno 1', 'Calle Dos 2']], 'lo suyo no se pisa')
  assert.equal(r.descartados, 2, 'el CIF de una fuente que no se leyó y la persona sin fuente')
  assert.deepEqual([r.personas, r.cuentas, r.clientes], [1, 1, 1])
  const f = fichaDe(db, emp)
  assert.equal(f.campos.find((c) => c.k === 'cif')!.valor, null)
  assert.equal(f.campos.find((c) => c.k === 'direccion')!.valor, 'Calle Uno 1')
  assert.ok(historiaDe(db, emp).some((h) => h.campo === 'actividad' && h.fuente === 'https://talleresnorte.test'))
  assert.equal(f.solvencia!.valor, 4, 'patrimonio 20 % del activo (0) y perdió (−1)')
  const crit = (await ejecutarHerramienta(HERRAMIENTAS, 'ficha_empresa', JSON.stringify({ nombre: String(emp) }), { db, conversacionId: null })).resultado as any
  assert.equal(crit.criterios.find((c: any) => c.nombre === 'Solvencia').valor, 4, 'la solvencia del puntaje sale de las cuentas')
  assert.ok(f.piezaId, 'la ficha investigada queda en el corpus')
})

test('Fragua #335: una persona no tiene ficha, pero ver_ficha, editar_ficha e investigar_ficha contestan sin error y el corpus no se queja', async () => {
  const db = abrir(':memory:')
  const { HERRAMIENTAS } = await import('../src/chat/herramientas.ts')
  const { asegurarEntidad } = await import('../src/entidades.ts')
  const { alCorpus } = await import('../src/fichas.ts')
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Pérez' })
  const errores: unknown[] = []
  const antes = console.error
  console.error = (...x: unknown[]) => { errores.push(x) }
  try {
    for (const nombre of ['ver_ficha', 'editar_ficha', 'investigar_ficha']) {
      const r = await HERRAMIENTAS.find((h) => h.nombre === nombre)!.ejecutar({ entidad: 'Ana Pérez', datos: { web: 'https://ejemplo.org' } }, { db } as any) as any
      assert.equal(r.sin_ficha, true, nombre)
      assert.equal(r.error, undefined, `${nombre}: no es un fallo`)
      assert.match(r.aviso, /es una persona.*editar_persona/)
    }
    assert.equal(await alCorpus(db, ana), null)
  } finally { console.error = antes }
  assert.deepEqual(errores, [], 'el puente ficha → corpus no registra error')
})
