import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { asegurarFuente, insertar } from '../src/corpus.ts'
import * as h from '../src/hojas-citables.ts'

test('Fragua #292 · la hoja citable sale solo de lo que se sabe: lo inventado (links, hechos, precios) se descarta; versionada y sin rehacer si nada cambió', async () => {
  const db = abrir(':memory:')
  const p = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Productora Prueba', meta: { web: 'https://productora.test', ciudad: 'Valencia', puntaje: 9 } })
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana Prueba' })
  db.prepare('INSERT INTO persona_proyecto (persona_id, proyecto_id, rol, desde) VALUES (?, ?, ?, ?)').run(ana, p, 'directora', 1)
  asegurarFuente(db, { id: 'notas', nombre: 'Notas', nivel: 'propia' })
  const pz = insertar(db, { fuente: 'notas', nivel: 'propia', titulo: 'Entrega del spot', contenido: 'Entregamos el spot de la bodega. Tarifa: 1200 € por spot. Ver https://productora.test/trabajos', fecha: '2026-10-02', entidades: [p] })!
  let llamadas = 0
  h._probarHojas(async () => {
    llamadas++
    return {
      resumen: 'Productora Prueba es una productora audiovisual de Valencia que hace spots publicitarios y documentales para marcas y bodegas.',
      queHace: 'Produce spots y documentales.',
      servicios: [{ nombre: 'Spot publicitario', precio: '1200 €' }, { nombre: 'Documental', precio: '9000 €' }],
      links: [{ nombre: 'Web', url: 'https://productora.test' }, { nombre: 'Trabajos', url: 'https://productora.test/trabajos' }, { nombre: 'Instagram', url: 'https://instagram.com/inventado' }],
      equipo: [{ nombre: 'Ana Prueba', rol: 'directora' }, { nombre: 'Juan Inventado', rol: 'productor' }],
      hechos: [{ fecha: '2026-10-02', hecho: 'Entregó el spot de una bodega.', pieza: pz }, { fecha: '2025-01-01', hecho: 'Ganó un premio.', pieza: 99999 }],
    }
  })
  const r = await h.hojaCitable(db, p)
  assert.equal(r.version, 1)
  assert.equal(r.nueva, true)
  assert.match(r.markdown, /^# Productora Prueba\n\n> Productora Prueba es una productora audiovisual de Valencia/)
  assert.match(r.markdown, /- Spot publicitario — 1200 €/)
  assert.match(r.markdown, /- Documental\n/, 'un precio que no está en los datos no entra')
  assert.match(r.markdown, /\[Trabajos\]\(https:\/\/productora\.test\/trabajos\)/)
  assert.doesNotMatch(r.markdown, /instagram\.com\/inventado/, 'un link inventado no entra')
  assert.doesNotMatch(r.markdown, /Juan Inventado/)
  assert.match(r.markdown, /\*\*2026-10-02\*\* · Entregó el spot de una bodega\./)
  assert.doesNotMatch(r.markdown, /premio/, 'un hecho sin pieza real no entra')
  assert.doesNotMatch(JSON.stringify(h.datosParaHoja(db, p).entidad.ficha), /puntaje/, 'lo interno de la ficha no sale')
  // En el corpus, versionada.
  assert.equal((db.prepare(`SELECT titulo FROM corpus WHERE fuente = 'hojas'`).get() as any).titulo, 'Hoja citable · Productora Prueba · v1')
  // Sin cambios, no se rehace (ni se llama al modelo).
  assert.equal((await h.hojaCitable(db, p)).nueva, false)
  assert.equal(llamadas, 1)
  // Con material nuevo, v2 (y la noche la rehace sola).
  insertar(db, { fuente: 'notas', nivel: 'propia', titulo: 'Documental', contenido: 'Arrancamos el documental.', fecha: '2026-11-10', entidades: [p] })
  insertar(db, { fuente: 'notas', nivel: 'propia', titulo: 'Rodaje', contenido: 'Rodaje en Xàtiva.', fecha: '2026-11-12', entidades: [p] })
  assert.equal(await h.rehacerHojas(db), 1)
  assert.equal(h.leerHoja(db, p)!.version, 2)
  // Sin nada que decir, no la inventa.
  const vacio = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Nada Todavía' })
  await assert.rejects(h.hojaCitable(db, vacio), /Todavía no sé casi nada/)
})
