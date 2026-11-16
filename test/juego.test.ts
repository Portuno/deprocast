import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { crearAprendizaje } from '../src/aprender.ts'
import { esJugada, instruccionDelJuego } from '../src/chat/juego.ts'

test('#288: un pedido con consecuencia lleva el tablero del juego antes del borrador; lo demás, no', () => {
  for (const t of [
    'contestale a Harshni que el pago es el viernes',
    '¿qué le digo al cliente que pide descuento?',
    'armame el mail con el presupuesto para Raph',
    'me ofrecieron 800 por el proyecto, ¿negocio?',
    '¿cuánto le cobro por la extracción de datos?',
  ]) assert.equal(esJugada(t), true, t)
  for (const t of [
    'contame qué hice ayer',
    'escribile un poema a la lluvia',
    'anotame comprar leche',
    'qué fecha es hoy',
  ]) assert.equal(esJugada(t), false, t)

  const db = abrir(':memory:')
  const sin = instruccionDelJuego(db)
  assert.match(sin, /Jugadores.*Información.*una sola vez o se repite.*2 o 3 respuestas.*Recomiendo/s)
  assert.doesNotMatch(sin, /Academia/)
  crearAprendizaje(db, { tema: 'Game Theory' })
  assert.match(instruccionDelJuego(db), /su dominio «Game Theory» de la Academia/)
})
