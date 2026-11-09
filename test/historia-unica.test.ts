import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { abrir } from '../src/db.ts'
import { asegurarFuente, buscar, corregirPieza, insertar, leerPieza, listarPiezas, retirarPieza } from '../src/corpus.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { _probarHistoria, historiaDe } from '../src/takeout/nube.ts'

describe('una historia por proyecto y piezas que se retiran o corrigen (plan v34, #48)', () => {
  it('retirar: deja de aparecer, con su rastro; corregir: mismo id, el texto nuevo y la versión anterior guardada', () => {
    const db = abrir(':memory:')
    asegurarFuente(db, { id: 'pruebas', nombre: 'Pruebas', nivel: 'propia' })
    const a = insertar(db, { fuente: 'pruebas', titulo: 'El nombre del juego', contenido: 'El nombre con el que quiere salir es Corrupto Police.' })!
    const b = insertar(db, { fuente: 'pruebas', titulo: 'Otra cosa', contenido: 'Algo sobre el juego y su nombre.' })!
    assert.equal(buscar(db, 'nombre juego', 10).length, 2)
    retirarPieza(db, a, 'Contradice su corrección: el nombre es Corruptopolis', 'operador')
    assert.deepEqual(buscar(db, 'nombre juego', 10).map((p) => p.id), [b], 'lo retirado no sale en la búsqueda')
    assert.ok(!listarPiezas(db, { q: 'nombre' }).piezas.some((p) => p.id === a), 'ni en el listado')
    assert.equal(listarPiezas(db, { estado: 'retirada' }).piezas[0].id, a, 'salvo que se pidan las retiradas')
    const meta = leerPieza(db, a)!.meta as any
    assert.equal(meta.retirada.motivo, 'Contradice su corrección: el nombre es Corruptopolis')

    const c = corregirPieza(db, b, 'Algo sobre el juego: se llama Corruptopolis.', 'el nombre correcto')
    assert.equal(c.id, b)
    assert.match(c.contenido, /Corruptopolis/)
    assert.equal((c.meta as any).versiones[0].antes, 'Algo sobre el juego y su nombre.')
  })

  it('la historia de un proyecto es una sola: se actualiza la que había y se retiran las de otros lotes o nombres viejos', async () => {
    const db = abrir(':memory:')
    const ent = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Corruptopolis', alias: ['Corrupto Police'] })
    asegurarFuente(db, { id: 'takeout-historia', nombre: 'Historia de proyectos', nivel: 'investigacion' })
    const vieja1 = insertar(db, { fuente: 'takeout-historia', titulo: 'Historia de Corruptopolis', contenido: 'v1', origenId: `takeout:historia:lote-a:${ent}` })!
    const vieja2 = insertar(db, { fuente: 'takeout-historia', titulo: 'Historia de Corrupto Police', contenido: 'con el nombre viejo', origenId: 'takeout:historia:lote-a:corrupto-police' })!
    const prompts: string[] = []
    _probarHistoria(async (_db, sistema, usuario) => {
      prompts.push(sistema + usuario)
      return { eras: [{ desde: '2025-01', hasta: '2025-06', nombre: 'Arranque', como_era: 'Un juego de mesa.' }], hoy: 'Sale como Corruptopolis.', cambios: null, ideas_para_revisar: [], pregunta: '¿Cuándo lo probás?' }
    })
    const x = { nombre: 'Corruptopolis', entidad: ent, menciones: [{ fecha: '2025-02-01', titulo: 'charla', estado: 'idea', ideas: [], decisiones: [], pieza: vieja1 }] }
    await historiaDe(db, 'lote-b', x, false, Date.now())
    const vivas = db.prepare(`SELECT id, origen_id, contenido FROM corpus WHERE fuente = 'takeout-historia' AND estado != 'retirada'`).all() as { id: number; origen_id: string; contenido: string }[]
    assert.equal(vivas.length, 1, 'una sola historia viva')
    assert.equal(vivas[0].id, vieja1, 'se actualizó la que había (mismo id)')
    assert.equal(vivas[0].origen_id, `historia:e:${ent}`)
    assert.match(vivas[0].contenido, /Sale como Corruptopolis/)
    assert.equal(leerPieza(db, vieja2)!.estado, 'retirada', 'la del nombre viejo se retiró')
    assert.match(prompts[0], /correcciones y lo que te dijo hace poco MANDAN/)
    await historiaDe(db, 'lote-c', x, false, Date.now())
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE fuente = 'takeout-historia' AND estado != 'retirada'`).get() as { n: number }).n, 1, 'otro lote: sigue siendo una')

    // Fragua #174: si la historia se retiró, rehacerla no choca con su clave (la retirada la conserva).
    retirarPieza(db, vieja1, 'Mal generada', 'operador')
    await historiaDe(db, 'lote-d', x, false, Date.now())
    const nueva = db.prepare(`SELECT id, origen_id FROM corpus WHERE fuente = 'takeout-historia' AND estado != 'retirada'`).all() as { id: number; origen_id: string }[]
    assert.equal(nueva.length, 1)
    assert.equal(nueva[0].origen_id, `historia:e:${ent}`)
    assert.notEqual(nueva[0].id, vieja1, 'una pieza nueva; la retirada queda como estaba')
    await historiaDe(db, 'lote-e', x, false, Date.now())
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE fuente = 'takeout-historia' AND estado != 'retirada'`).get() as { n: number }).n, 1, 'reprocesar dos veces: una sola')
  })
})
