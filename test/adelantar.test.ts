import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
const { abrir } = await import('../src/db.ts')
const ac = await import('../src/academia.ts')
const { adelantar } = await import('../src/adelantar.ts')

const T = new Date(2026, 9, 27, 6, 30).getTime()
const pedidos: string[] = []
const voces: string[] = []
ac._probarAcademia({
  nube: () => true,
  alPedirVisual: () => {},
  hablar: async (_db, t) => { voces.push(t); return `/adjuntos/tts-${voces.length}.mp3` },
  modelo: async (_db, sistema, usuario) => {
    pedidos.push(sistema)
    if (/diagnóstico de ubicación/.test(sistema)) return { preguntas: Array.from({ length: 6 }, (_, i) => ({ nivel: i + 1, pregunta: `¿Nivel ${i + 1}?`, clave: 'k' })) }
    if (/mapa de conceptos/.test(sistema)) return { conceptos: [{ nombre: 'Qué es la corriente', nivel: 1 }, { nombre: 'Ley de Ohm', nivel: 1, requisitos: ['Qué es la corriente'] }] }
    const tema = /Tema de la clase: (.+)/.exec(usuario)?.[1] ?? '?'
    return { tema, explicacion: `Explicación de ${tema}.`, ejemplos: [], ideas: [], preguntas: [{ pregunta: '¿Qué es?', clave: 'k' }], tarjetas: [], visual: null }
  },
})

test('Adelantar: la próxima clase (con su voz) y la ubicación de un dominio nuevo quedan listas; lo listo no se rehace', async () => {
  const db = abrir(':memory:')
  const d = ac.sumarDominio(db, { tema: 'Electricidad', porQue: 'Para un proyecto' }, T)
  const r = await adelantar(db, T)
  assert.deepEqual(r.hechos, ['la ubicación de Electricidad', 'la próxima clase de Electricidad'])
  assert.ok((db.prepare(`SELECT 1 FROM tutor_sesiones WHERE aprendizaje_id = ? AND tipo = 'clase' AND estado = 'lista'`).get(d.id)), 'la clase quedó lista')
  assert.ok(voces.some((v) => /Explicación de/.test(v)), 'con la voz de su explicación ya generada')
  const n = pedidos.length
  const r2 = await adelantar(db, T + 1000)
  assert.deepEqual(r2.hechos, [])
  assert.equal(pedidos.length, n, 'lo que ya estaba listo no vuelve a pedirse')

  // Al abrirla, abre la que estaba lista: sin esperar al modelo.
  const s = await ac.abrirSesionTutor(db, d.id, { ahora: T + 2000 })
  assert.equal(pedidos.length, n)
  assert.equal(s.estado, 'en_curso')
})

test('Adelantar respeta el tope del día: no pide nada', async () => {
  const db = abrir(':memory:')
  ac.sumarDominio(db, { tema: 'Cocina' }, T)
  db.prepare(`INSERT OR REPLACE INTO ajustes (clave, valor) VALUES ('tokens_dia_max', '1')`).run()
  db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'x', 'generativo', 'GEN-0001', 10, 10, 1, 200, ?)`).run(Date.now())
  const n = pedidos.length
  const r = await adelantar(db, T)
  assert.deepEqual(r.hechos, [])
  assert.ok(r.frenado)
  assert.equal(pedidos.length, n)
})
