import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'

const { abrir } = await import('../src/db.ts')
const { buscarMisiones, crearMision } = await import('../src/misiones.ts')

test('La paleta busca misiones por todas sus palabras, sin importar tildes, y deja afuera las descartadas', () => {
  const db = abrir(':memory:')
  crearMision(db, { titulo: 'Llamar a Pablo por el presupuesto', nivel: 'secundaria' })
  crearMision(db, { titulo: 'Revisar el informe trimestral', detalle: 'Con números de la campaña', nivel: 'secundaria' })
  const vieja = crearMision(db, { titulo: 'Llamar al banco', nivel: 'secundaria' })
  db.prepare(`UPDATE misiones SET estado = 'descartada' WHERE id = ?`).run(vieja.id)
  assert.deepEqual(buscarMisiones(db, 'llamar').map((m) => m.titulo), ['Llamar a Pablo por el presupuesto'])
  assert.deepEqual(buscarMisiones(db, 'NUMEROS campana').map((m) => m.titulo), ['Revisar el informe trimestral'], 'en el detalle y sin tildes')
  assert.deepEqual(buscarMisiones(db, 'x'), [], 'una letra sola no busca')
})

test('Cada acción de la paleta llama a algo que existe en la pantalla', () => {
  const dir = path.resolve(import.meta.dirname, '..', 'web', 'js')
  const todo = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
  const paleta = fs.readFileSync(path.join(dir, '15-paleta.js'), 'utf8')
  const llamadas = new Set([...paleta.matchAll(/\b(modal[A-Z]\w*|accionHud|detenerDirecto|pedirConsejo|alternarCharlaEnVivo|cerrarDiaHablando|preguntarAMastropiero|mostrarAtajos|irAEspacio|cargarScript)\(/g)].map((m) => m[1]))
  assert.ok(llamadas.size >= 15, `encontré ${llamadas.size}`)
  for (const f of llamadas) assert.match(todo, new RegExp(`(?:function\\s+${f}\\b|const\\s+${f}\\s*=)`), `${f} no está definida en web/js`)
})
