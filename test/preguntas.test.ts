import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fechaLocal } from '../src/db.ts'
import { _probarModelo } from '../src/modelo.ts'
import { asegurarEntidad } from '../src/entidades.ts'
import { registrarMovimiento } from '../src/finanzas.ts'
import { recordar } from '../src/memoria.ts'
import { guardarRelacion } from '../src/personas.ts'
import { _probarEscribaPreguntas, encolarPregunta, generarPreguntas, listarPreguntas, responderPregunta, siguientePregunta } from '../src/preguntas.ts'

test('Mastropiero pregunta: genera sin repetir, una por vez, y la respuesta va al escriba', async () => {
  const db = abrir(':memory:')
  recordar(db, { texto: 'Quiere llegar a 12.000 € por mes', tipo: 'meta' })
  const vistos: string[] = []
  _probarModelo(async (_l, o) => {
    vistos.push(String(o.mensajes.at(-1)!.content))
    return {
      texto: JSON.stringify({ preguntas: [
        { texto: '¿Cuánto entra hoy por mes?', por_que: 'Para medir la distancia a la meta', tipo: 'numero', tema: 'numeros' },
        { texto: '¿Quién es Ana para vos?', por_que: 'Aparece mucho', tipo: 'opciones', opciones: ['Socia', 'Amiga', 'Familia'], tema: 'gente' },
        { texto: '¿Cuánto entra hoy por mes?', tipo: 'numero' },
      ] }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1,
    }
  })
  const ps = await generarPreguntas(db, 5)
  assert.equal(listarPreguntas(db, { estado: 'pendiente' }).length, 2, 'la repetida no entra dos veces')
  assert.match(vistos[0], /12\.000/)
  assert.equal(ps[1].tipo, 'opciones')
  assert.equal(siguientePregunta(db)!.texto, '¿Cuánto entra hoy por mes?')

  const escuchado: string[] = []
  _probarEscribaPreguntas(async (_db, t) => { escuchado.push(t); return [] })
  await responderPregunta(db, ps[0].id, '2.500 €')
  assert.match(escuchado[0], /le preguntó: «¿Cuánto entra hoy por mes\?»\. Él respondió: 2\.500 €/)
  await responderPregunta(db, ps[1].id, null)
  assert.equal(listarPreguntas(db, { estado: 'salteada' }).length, 1)
  assert.equal(siguientePregunta(db), null)

  // Lo ya preguntado viaja al modelo para no repetir.
  await generarPreguntas(db, 5)
  assert.match(vistos.at(-1)!, /Ya le preguntaste[\s\S]*2\.500 €/)
  assert.equal(encolarPregunta(db, { texto: '   ' }), null)
  assert.equal(encolarPregunta(db, { texto: '¿Cuánto ganás por mes?' })?.id, ps[0].id, 'la misma pregunta con otras palabras no se encola de nuevo')
})

test('desglosa lo que ya sabe y no pregunta un dato que ya está', async () => {
  const db = abrir(':memory:')
  const ana = asegurarEntidad(db, { tipo: 'persona', nombre: 'Ana', notas: 'Socia del estudio' })
  guardarRelacion(db, ana, { vinculo: 'trabajo', notas: 'Socia del estudio' })
  registrarMovimiento(db, { monto: 2500, descripcion: 'Factura', fecha: `${fechaLocal().slice(0, 7)}-01` })
  recordar(db, { texto: 'Quiere llegar a 12.000 € por mes', tipo: 'meta' })
  _probarModelo(async (_l, o) => {
    const u = String(o.mensajes.at(-1)!.content)
    assert.match(u, /Ana \(trabajo\)/)
    assert.match(u, /entraron 2500/)
    assert.match(u, /desglosalo/)
    return {
      texto: JSON.stringify({
        desglose: [{ texto: 'Ana es su socia en el estudio', tipo: 'hecho' }],
        preguntas: [
          { texto: '¿Cuánto te entra por mes?', tipo: 'numero', tema: 'numeros' },
          { texto: '¿Quién es Ana para vos?', tipo: 'abierta', tema: 'gente' },
          { texto: '¿Cuál es tu meta de ingresos?', tipo: 'numero', tema: 'numeros' },
          { texto: '¿A qué hora se te apaga la cabeza?', tipo: 'abierta', tema: 'ritmo' },
        ],
      }), llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1,
    }
  })
  const ps = await generarPreguntas(db, 5)
  assert.ok(db.prepare(`SELECT 1 FROM memoria WHERE texto LIKE 'Ana es su socia%'`).get(), 'el desglose entra a la memoria')
  assert.deepEqual(ps.map((p) => p.texto), ['¿A qué hora se te apaga la cabeza?'])
})
