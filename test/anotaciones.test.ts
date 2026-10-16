import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { _probarAnotaciones, procesarAnotaciones } from '../src/anotaciones.ts'

test('anotaciones: pieza suya, memoria (confirmado revisado, inferido no), propuestas «diseño» con restricciones, entidades y quántomos', async () => {
  const db = abrir(':memory:')
  const proy = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Proyecto Prueba' })
  let visto = ''
  _probarAnotaciones(async (_db, u) => {
    visto = u
    return {
      resumen: 'Ideas para el filtro de cuentas y la meta del cuatrimestre',
      recuerdos: [
        { texto: 'Su norte del cuatrimestre es juntar capital para invertir', tipo: 'meta', horizonte: 'campamento', confirmado: true },
        { texto: 'Aplica la misma criba hacia afuera', tipo: 'hecho', confirmado: false },
      ],
      propuestas: [
        { titulo: 'Filtro de cuentas por puntaje 1–12', detalle: 'Puntuar cuentas en tres redes y silenciar las de puntaje bajo.', area: 'otro', restricciones: ['No hay permiso para silenciar cuentas automáticamente'], sensible: true },
        { titulo: 'Capturar contexto de pantalla', detalle: 'Capturas periódicas.', area: 'chat', restricciones: [], sensible: false },
      ],
      entidades: [{ nombre: 'Proyecto Prueba', tipo: 'proyecto', nota: 'el proyecto madre' }, { nombre: 'Filtro Nuevo', tipo: 'proyecto', nota: 'frente del Proyecto Prueba' }],
      ideas: [{ texto: 'Puntuar cuentas como se puntúan las ideas', proyecto: 'Proyecto Prueba' }],
    }
  })
  const texto = '* [Confirmado] El norte del cuatrimestre: juntar capital.\n* [Inferido] Es la misma criba hacia afuera.\n* Importante: es diseño, no hay permiso para silenciar cuentas.'
  const r = await procesarAnotaciones(db, texto, { fecha: '2026-10-15' })
  assert.match(visto, /Fecha de las anotaciones: 2026-10-15[\s\S]*\[Confirmado\]/)

  const p = db.prepare('SELECT * FROM corpus WHERE id = ?').get(r.pieza) as any
  assert.deepEqual([p.nivel, p.fecha, p.contenido], ['propia', '2026-10-15', texto])
  assert.deepEqual(JSON.parse(p.entidades), [proy])

  assert.deepEqual(r.recuerdos.map((x) => x.revisado), [true, false])
  const meta = db.prepare(`SELECT tipo, horizonte, revisada FROM memoria WHERE texto LIKE 'Su norte%'`).get() as any
  assert.deepEqual([meta.tipo, meta.horizonte, meta.revisada], ['meta', 'campamento', 1])

  assert.equal(r.propuestas.length, 2)
  const filtro = db.prepare('SELECT * FROM propuestas WHERE id = ?').get(r.propuestas[0].id) as any
  assert.deepEqual([filtro.estado, filtro.origen], ['abierta', 'anotaciones'])
  assert.match(filtro.detalle, /Es diseño[\s\S]*No hay permiso para silenciar cuentas automáticamente[\s\S]*necesita tu ok explícito/)
  assert.ok(r.propuestas[0].sensible)

  assert.deepEqual(r.enlazadas.map((e) => e.nombre), ['Proyecto Prueba'])
  assert.deepEqual(r.nuevas.map((e) => e.nombre), ['Filtro Nuevo'])
  assert.equal((db.prepare(`SELECT estado FROM takeout_nombres WHERE nombre = 'Filtro Nuevo'`).get() as any).estado, 'propuesta', 'lo nuevo espera su ok')
  assert.equal(r.quantomos, 1)

  // Repetir las mismas notas no duplica propuestas abiertas ni la pieza.
  const r2 = await procesarAnotaciones(db, texto, { fecha: '2026-10-15' })
  assert.equal(r2.pieza, r.pieza)
  assert.equal(r2.propuestas.length, 0)
  await assert.rejects(procesarAnotaciones(db, 'corto'), /Pegá/)
})
