import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { asegurarEntidad, conexionesDe } from '../src/entidades.ts'
import { ficharEmpresa, guardarEmpresa, leerEmpresa, puntajeDe } from '../src/empresas.ts'

test('la ficha de empresa (Fragua #164): datos fijos, puntaje ponderado que se recalcula, autopuntaje aparte y tres niveles de cribado', () => {
  const db = abrir(':memory:')
  const versa = asegurarEntidad(db, { tipo: 'proyecto', nombre: 'Versa' })
  let f = ficharEmpresa(db, 'Constructora del Turia', { razonSocial: 'Construcciones del Turia SL', cif: 'b-12 345 678', direccion: 'Carrer de Colón 1, València' })
  assert.equal(f.cif, 'B12345678')
  assert.equal(f.maps, 'https://www.google.com/maps/search/?api=1&query=Carrer%20de%20Col%C3%B3n%201%2C%20Val%C3%A8ncia')
  assert.equal(f.puntaje, null, 'sin criterios puntuados, no hay puntaje')
  f = guardarEmpresa(db, f.id, { criterio: { nombre: 'Solvencia', valor: 8, nota: 'Cuentas depositadas al día' } })
  f = guardarEmpresa(db, f.id, { criterio: { nombre: 'Reputación', valor: 5 } })
  assert.equal(f.puntaje, puntajeDe(f.criterios))
  assert.equal(f.puntaje, 7, '(8×2 + 5×1) / 3')
  f = guardarEmpresa(db, f.id, { autopuntaje: { valor: 9.5, fuente: 'su web' }, cribado: { personal: 'Le sirve a Versa para obra pública' }, sirveA: [versa] })
  assert.equal(f.autopuntaje!.valor, 9.5)
  assert.equal(f.puntaje, 7, 'el autopuntaje no toca el objetivo')
  assert.equal(f.cribado.personal, 'Le sirve a Versa para obra pública')
  assert.ok(conexionesDe(db, f.id).some((c: any) => c.otra === versa && c.relacion === 'le sirve a'))
  assert.equal(leerEmpresa(db, f.id).razonSocial, 'Construcciones del Turia SL', 'lo que no viene, queda')
  assert.throws(() => leerEmpresa(db, versa), /no es una empresa/)
})
