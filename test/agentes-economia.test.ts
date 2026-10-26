import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
const { abrir } = await import('../src/db.ts')
const { forjar, leer } = await import('../src/roster.ts')
const { anotarDevolucion } = await import('../src/devoluciones.ts')
const { balance, cerrarTemporada } = await import('../src/economia.ts')
const { semanaDe } = await import('../src/misiones.ts')
const mi = await import('../src/agentes/misiones.ts')
const pi = await import('../src/agentes/pistas.ts')

const LUNES = new Date(2026, 9, 26, 10).getTime()
const SEM = semanaDe(LUNES)
const BRIEF = 'Productora audiovisual chica: fotos y video para eventos y marcas en Valencia.'

function pista(db: any, misionId: number, nombre: string, en: number, borrador: string | null = null) {
  const id = Number(db.prepare(`INSERT INTO oportunidades (titulo, url, tipo, estado, origen, creada_en, actualizada_en, agente_mision_id, etapa, contacto, borrador) VALUES (?, ?, 'contacto', 'nueva', 'agente', ?, ?, ?, ?, ?, ?)`)
    .run(nombre, `https://${nombre}.example/`, en, en, misionId, borrador ? 'borrador' : 'encontrada', JSON.stringify({ organizacion: nombre, canal: 'mail', url: null }), borrador).lastInsertRowid)
  return id
}

test('Paga por resultado: el agente de la misión cobra por pistas, borradores, respuestas y clientes; el que solo cumple el formato pierde y va a la banca', () => {
  const db = abrir(':memory:')
  const m = mi.crearMisionAgente(db, { titulo: 'Clientes', brief: BRIEF, criterio: { metrica: 'clientes', meta: 5 } }, LUNES - 86_400_000)
  db.prepare(`UPDATE agentes SET estado = 'activo' WHERE id = ?`).run(m.agenteId)
  const prolijo = forjar(db, { clase: 'extractor', motor: 'local', ahora: LUNES - 86_400_000 })
  db.prepare(`UPDATE agentes SET estado = 'activo' WHERE id = ?`).run(prolijo.id)
  // El prolijo: diez tareas de ingesta bien formadas y 20K tokens.
  for (let i = 0; i < 10; i++) db.prepare(`INSERT INTO tareas (tipo, clase, payload, estado, asignada_a, publicada_por, creada_en, actualizada_en) VALUES ('ingesta', 'extractor', '{}', 'hecha', ?, 'test', ?, ?)`).run(prolijo.id, LUNES, LUNES)
  db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'x', 'extractor', ?, 15000, 5000, 1, 200, ?)`).run(prolijo.id, LUNES)

  // El de la misión: tres pistas (una descartada), dos borradores (uno mandado, uno descartado), una respuesta y un cliente.
  const a = pista(db, m.id, 'luz', LUNES, 'Hola, les escribo para ofrecerles foto y video en sus eventos.')
  const b = pista(db, m.id, 'sombra', LUNES, 'Hola, les escribo para ofrecerles cobertura de eventos.')
  const c = pista(db, m.id, 'nada', LUNES)
  pi.marcarPista(db, c, 'descartada', { ahora: LUNES + 1000 })
  pi.resolverBorrador(db, a, 'enviar', { ahora: LUNES + 2000 })
  pi.resolverBorrador(db, b, 'descartar', { ahora: LUNES + 3000 })
  pi.marcarPista(db, a, 'respondio', { ahora: LUNES + 4000 })
  pi.marcarPista(db, a, 'cliente', { ahora: LUNES + 5000 })
  pi.marcarPista(db, a, 'respondio', { ahora: LUNES + 6000 }) // volver atrás y adelante no cobra dos veces
  pi.marcarPista(db, a, 'cliente', { ahora: LUNES + 7000 })
  anotarDevolucion(db, { superficie: 'agentes', ref: `pista:${a}`, valor: 1 }, LUNES + 8000)
  db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'x', 'buscador', ?, 40000, 10000, 1, 200, ?)`).run(m.agenteId, LUNES)

  const lineas = balance(db, SEM)
  const de = (id: string) => lineas.filter((l) => l.agente === id)
  const neto = (id: string) => de(id).reduce((s, l) => s + l.monto, 0)
  const motivos = de(m.agenteId).map((l) => l.motivo).join(' · ')
  for (const x of ['2 pista', '1 borrador mandado', '1 borrador descartado', '1 enviada', '1 respuesta', '1 cliente', '1 👍', '50K tokens']) assert.ok(motivos.includes(x), `${x} en «${motivos}»`)
  assert.equal(neto(m.agenteId), 2 * 2 + 5 - 2 + 3 + 10 + 100 + 3 - 50)
  assert.equal(neto(prolijo.id), 10 - 20, 'cumplir el formato ya no alcanza')

  cerrarTemporada(db, SEM, LUNES + 7 * 86_400_000)
  assert.equal(leer(db, prolijo.id)!.estado, 'banca')
  assert.equal(leer(db, m.agenteId)!.estado, 'activo')
})
