import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'

const { abrir } = await import('../src/db.ts')
const ac = await import('../src/academia.ts')
const { leerMision } = await import('../src/misiones.ts')

const T = new Date(2026, 9, 26, 10).getTime()
const pedidos: { sistema: string; usuario: string }[] = []
let nube = false
ac._probarAcademia({
  nube: () => nube,
  alPedirVisual: () => {},
  modelo: async (_db, sistema, usuario) => {
    pedidos.push({ sistema, usuario })
    if (/mapa de conceptos/.test(sistema)) return { conceptos: [{ nombre: 'A', nivel: 4 }, { nombre: 'B', nivel: 4 }] }
    if (/UN proyecto práctico/.test(sistema)) return /No le gustó/.test(usuario)
      ? { titulo: 'Medir un divisor de tensión', objetivo: 'Ver la ley de Ohm', pasos: ['Armar', 'Medir'], entregable: 'Foto y números', criterio: 'Las tensiones suman la de la fuente' }
      : { titulo: 'Armar un LED con resistencia', objetivo: 'Limitar la corriente', pasos: ['Calcular R', 'Armar', 'Medir'], entregable: 'La corriente medida', criterio: 'Entre 10 y 20 mA' }
    if (/entrega de un proyecto/.test(sistema)) { const ok = /15 mA/.test(usuario); return { aprobado: ok, devolucion: ok ? 'Bien medido.' : 'Falta la medición.' } }
    return { tema: 'A', explicacion: 'E', ejemplos: [], ideas: [], tarjetas: [], visual: null, preguntas: [{ pregunta: 'Q', clave: 'k' }] }
  },
})

test('El proyecto del nivel: se propone a la mitad, aceptarlo es una primaria, la entrega se corrige y desde el nivel 4 habilita el examen', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electrónica' }, T)
  db.prepare('UPDATE aprendizajes SET tutor_nivel = 4 WHERE id = ?').run(d.id)
  await ac.armarMapa(db, d.id, T)
  db.prepare(`UPDATE conceptos SET dominio = 0.9 WHERE aprendizaje_id = ?`).run(d.id)
  assert.equal(ac.examenHabilitado(db, d.id), false, 'nivel 4 con todo sabido, pero sin proyecto: no hay examen')
  await assert.rejects(ac.abrirSesionTutor(db, d.id, { examen: true, ahora: T }), /pide el proyecto del nivel aprobado/)

  // Al cerrar una clase (en la nube), si va por la mitad del nivel, se propone solo.
  nube = true
  db.prepare(`UPDATE conceptos SET dominio = 0.2 WHERE nombre = 'B'`).run()
  const s = await ac.abrirSesionTutor(db, d.id, { ahora: T })
  ac.cerrarSesionTutor(db, s.id, T)
  for (let i = 0; i < 50 && !ac.proyectoDe(db, d.id, 4); i++) await new Promise((r) => setTimeout(r, 5))
  nube = false
  let p = ac.proyectoDe(db, d.id, 4)!
  assert.deepEqual([p.titulo, p.estado, p.pasos.length], ['Armar un LED con resistencia', 'propuesto', 3])
  assert.match(pedidos.find((x) => /UN proyecto práctico/.test(x.sistema))!.usuario, /Lo que ya sabe: A/)

  // Pedir otro: el anterior queda descartado y el nuevo sabe que ese no gustó.
  p = await ac.proponerProyecto(db, d.id, T)
  assert.equal(p.titulo, 'Medir un divisor de tensión')
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM tutor_proyectos WHERE estado = 'descartado'`).get() as any).n, 1)

  p = await ac.aceptarProyecto(db, p.id, T)
  const m = leerMision(db, p.misionId!)!
  assert.deepEqual([m.nivel, m.estado, m.titulo], ['primaria', 'activa', 'Proyecto de Electrónica: Medir un divisor de tensión'])
  assert.match(m.detalle ?? '', /Está bien si: Las tensiones suman/)
  await assert.rejects(ac.proponerProyecto(db, d.id, T), /ya está en marcha/)

  const mal = await ac.entregarProyecto(db, p.id, { texto: 'Lo armé y anduvo' }, T)
  assert.deepEqual([mal.aprobado, mal.estado], [false, 'rehacer'])
  db.prepare(`UPDATE conceptos SET dominio = 0.9 WHERE aprendizaje_id = ?`).run(d.id) // terminó el nivel
  const bien = await ac.entregarProyecto(db, p.id, { texto: 'Lo armé: 4,5 V y 4,5 V, la corriente 15 mA', url: 'https://ej.org/foto' }, T)
  assert.deepEqual([bien.aprobado, bien.estado, bien.examen], [true, 'aprobado', true])
  assert.equal(leerMision(db, p.misionId!)!.estado, 'hecha')
  const pieza = db.prepare('SELECT nivel, contenido FROM corpus WHERE id = ?').get(bien.piezaId) as any
  assert.equal(pieza.nivel, 'propia', 'la entrega es suya: evidencia de lo que hizo')
  assert.match(pieza.contenido, /## Devolución del tutor \(aprobado\)\nBien medido\./)
  await assert.rejects(ac.entregarProyecto(db, p.id, { texto: 'otra vez lo mismo' }, T), /no está para entregar/)
})

test('Antes del nivel 4 el proyecto es opcional: el examen no lo pide', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electrónica' }, T)
  await ac.armarMapa(db, d.id, T)
  db.prepare('UPDATE aprendizajes SET tutor_nivel = 3 WHERE id = ?').run(d.id)
  db.prepare(`UPDATE conceptos SET nivel = 3, dominio = 0.9 WHERE aprendizaje_id = ?`).run(d.id)
  assert.equal(ac.examenHabilitado(db, d.id), true)
})
