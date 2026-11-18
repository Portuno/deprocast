import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import * as m from '../src/meditacion.ts'
import { ejecutarHerramienta, HERRAMIENTAS, gruposDelMensaje } from '../src/chat/herramientas.ts'

test('meditación · los de base son válidos y duran lo que dicen', () => {
  assert.ok(m.BASE.length >= 5)
  for (const b of m.BASE) {
    assert.ok(b.id.startsWith('base:'))
    assert.ok(m.duracion(b) > 0, b.nombre)
  }
  const caja = m.BASE.find((b) => b.id === 'base:caja')!
  assert.equal(m.duracion(caja), 10 * 16)
  const solo = m.BASE.find((b) => b.id === 'base:binaural')!
  assert.equal(solo.fases.length, 0)
  assert.equal(m.duracion(solo), 20 * 60)
  assert.equal(solo.binaural.sigueRespiracion, false, 'sin respiración no hay nada que seguir')
  assert.equal(m.BASE.find((b) => b.id === 'base:suspiro')!.binaural.activo, false)
})

test('meditación · normalizar acota todo: fases, segundos, largo, pulso, portadora y volúmenes', () => {
  const n = m.normalizar({ nombre: 'Prueba', fases: [{ tipo: 'Inhalar', seg: 90 }, { tipo: 'exhalar', seg: 0 }], ciclos: 5, minutos: 3, binaural: { pulso: 100, portadora: 5, volumen: 3, ruido: 'violeta', pulsoFinal: '' } })
  assert.deepEqual(n.fases, [{ tipo: 'inhalar', seg: 30 }, { tipo: 'exhalar', seg: 1 }])
  assert.equal(n.ciclos, 5)
  assert.equal(n.minutos, null, 'manda uno solo')
  assert.equal(n.binaural.pulso, 45)
  assert.equal(n.binaural.portadora, 40)
  assert.equal(n.binaural.volumen, 1)
  assert.equal(n.binaural.ruido, 'ninguno')
  assert.equal(n.binaural.pulsoFinal, null)
  assert.equal(m.normalizar({ nombre: 'Sin largo', fases: [{ tipo: 'inhalar', seg: 4 }] }).ciclos, 10, 'sin largo: 10 ciclos')
  assert.equal(m.normalizar({ nombre: 'Solo sonido', fases: [] }).minutos, 15)
  assert.throws(() => m.normalizar({ nombre: 'x' }), /necesita un nombre/)
  assert.throws(() => m.normalizar({ nombre: 'Rara', fases: [{ tipo: 'toser', seg: 2 }] }), /Fase desconocida/)
  assert.throws(() => m.normalizar({ nombre: 'Sin aire', fases: [{ tipo: 'exhalar', seg: 4 }] }), /sin inhalar/)
  assert.throws(() => m.normalizar({ nombre: 'Nada', fases: [], binaural: { activo: false } }), /no queda nada/)
})

test('meditación · guardar, ajustar y borrar los suyos; las sesiones y cómo viene el mes', () => {
  const db = abrir(':memory:')
  const e = m.guardar(db, { nombre: 'Para el domingo', intencion: 'Soltar la semana', fases: [{ tipo: 'inhalar', seg: 4 }, { tipo: 'exhalar', seg: 8 }], minutos: 6, binaural: { pulso: 6, pulsoFinal: 3, ruido: 'marron' } })
  assert.equal(e.origen, 'propia')
  assert.equal(m.duracion(e), 360)
  assert.equal(e.binaural.pulsoFinal, 3)
  const ajustado = m.guardar(db, { ...e, nombre: 'Para el domingo a la noche' })
  assert.equal(ajustado.id, e.id)
  assert.equal(m.listar(db).length, 1)
  // Editar uno de base deja una copia suya (los de base no se tocan).
  const copia = m.guardar(db, { ...m.BASE[0], nombre: 'Caja (mía)' })
  assert.notEqual(copia.id, m.BASE[0].id)
  assert.equal(m.listar(db).length, 2)

  const ahora = new Date(2026, 10, 18, 22).getTime()
  assert.deepEqual(m.registrarSesion(db, { ejercicio: e.id, segundos: 4 }, ahora), { anotada: false }, 'menos de 10 s no cuenta')
  assert.equal(m.registrarSesion(db, { ejercicio: e.id, segundos: 360, completa: true, animo: 'mejor' }, ahora).anotada, true)
  m.registrarSesion(db, { ejercicio: 'base:caja', segundos: 90, animo: 'raro' }, ahora + 86_400_000)
  assert.throws(() => m.registrarSesion(db, { ejercicio: 'base:inventado', segundos: 60 }), /No encuentro/)
  const r = m.resumen(db, ahora + 86_400_000)
  assert.deepEqual(r.mes, { dias: 2, minutos: 8, sesiones: 2, animos: { mejor: 1 } })
  assert.equal(r.ultimas[0].nombre, 'Respiración en caja')
  assert.equal(m.leer(db, e.id)!.usos, 1)
  assert.equal(m.leer(db, 'base:caja')!.usos, 1)

  m.borrar(db, e.id)
  assert.equal(m.leer(db, e.id), null)
  assert.throws(() => m.borrar(db, 'base:caja'), /no se borran/)
  assert.equal(m.resumen(db, ahora).total.sesiones, 2, 'las sesiones quedan')
})

test('meditación · a medida: el modelo lo diseña, se acota y queda suyo; también desde el chat', async () => {
  const db = abrir(':memory:')
  let pedido = ''
  m._probarMeditacion(async (_db, p) => {
    pedido = p
    return { nombre: 'Dormir en diez', intencion: 'Entrar en el sueño', descripcion: 'Exhalá largo.', fases: [{ tipo: 'inhalar', seg: 4 }, { tipo: 'retener', seg: 60 }, { tipo: 'exhalar', seg: 8 }], ciclos: null, minutos: 10, binaural: { activo: true, portadora: 150, pulso: 6, pulsoFinal: 2.5, volumen: 0.3, ruido: 'marron', volumenRuido: 0.2, sigueRespiracion: true } }
  })
  const e = await m.aMedida(db, 'algo para dormirme en 10 minutos')
  assert.equal(pedido, 'algo para dormirme en 10 minutos')
  assert.equal(e.origen, 'a_medida')
  assert.equal(e.pedido, 'algo para dormirme en 10 minutos')
  assert.equal(e.fases[1].seg, 30, 'la retención, acotada')
  assert.equal(e.minutos, 10)
  await assert.rejects(m.aMedida(db, 'x'), /para qué lo querés/)

  // Desde el chat: la herramienta está en el grupo de vida y lo nombra el mensaje.
  assert.ok(gruposDelMensaje('quiero un ejercicio de respiración para la ansiedad').includes('vida'))
  const r: any = await ejecutarHerramienta(HERRAMIENTAS, 'crear_meditacion', JSON.stringify({ pedido: 'foco para escribir 25 minutos, solo sonido' }), { db } as any)
  assert.equal(r.resultado.nombre, 'Dormir en diez')
  assert.match(r.resumen, /diseñó «Dormir en diez» en Meditación/)
  const v: any = await ejecutarHerramienta(HERRAMIENTAS, 'ver_meditacion', '{}', { db } as any)
  assert.equal(v.resultado.suyos.length, 2)
  assert.ok(v.resultado.base.length >= 5)
})
