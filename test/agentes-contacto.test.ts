import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir, fijarAjuste } from '../src/db.ts'
import { anotarContexto, contextoPrevio, crearSecuencia, puedeRedactar } from '../src/agentes/contacto.ts'
import { leerPista, marcarPista } from '../src/agentes/pistas.ts'

const T = new Date(2026, 10, 9, 10).getTime()
function pista(db: any, org: string) {
  const id = Number(db.prepare(`INSERT INTO oportunidades (titulo, url, tipo, estado, origen, creada_en, actualizada_en, agente_mision_id, etapa, contacto) VALUES (?, ?, 'contacto', 'nueva', 'agente', ?, ?, 1, 'encontrada', ?)`).run(org, `https://${org.toLowerCase().replace(/\s+/g, '')}.example`, T, T, JSON.stringify({ organizacion: org, canal: 'mail', url: null })).lastInsertRowid)
  return leerPista(db, id)!
}

test('contacto con criterio (plan v38, fase 4): señal real, contexto previo, tope semanal y tres toques que se cortan si responde', () => {
  const db = abrir(':memory:')
  const vistas = new Set(['https://estudio.example/blog/premio'])
  const p = pista(db, 'Estudio Norte')
  // #171: sin señal, o con un link que no leyó en esta sesión, no hay mensaje.
  assert.match(puedeRedactar(db, p, null, vistas, T)!, /sin personalización falsa/)
  assert.match(puedeRedactar(db, p, { texto: 'Ganaron un premio', url: 'https://otro.example' }, vistas, T)!, /no salió de tus búsquedas/)
  // #173: sin contexto con él, queda en «Calentar primero».
  const senal = { texto: 'Ganaron el premio de diseño 2026', url: 'https://estudio.example/blog/premio' }
  assert.match(puedeRedactar(db, p, senal, vistas, T)!, /Calentar primero/)
  assert.equal(leerPista(db, p.id)!.etapa, 'calentar')
  assert.equal(contextoPrevio(db, p), null)
  anotarContexto(db, p.id, 'Nos conocimos en el evento de octubre')
  assert.equal(leerPista(db, p.id)!.etapa, 'encontrada', 'con contexto, sale de calentar')
  assert.equal(puedeRedactar(db, p, senal, vistas, T), null)
  // Tope semanal: sin volumen sin criterio.
  fijarAjuste(db, 'pistas_tope_semana', '1')
  db.prepare('UPDATE oportunidades SET borrador_en = ? WHERE id = ?').run(T - 3600_000, p.id)
  assert.match(puedeRedactar(db, pista(db, 'Otra'), senal, vistas, T)!, /tope es 1/)

  // #172: al mandarlo, dos seguimientos con fecha; si responde, se cortan y queda sugerido agendar la llamada.
  db.prepare(`UPDATE oportunidades SET etapa = 'borrador', borrador = 'Hola, vi lo del premio…' WHERE id = ?`).run(p.id)
  const toques = crearSecuencia(db, leerPista(db, p.id)!, T)
  assert.deepEqual(toques.map((x) => [x.n, x.fecha]), [[2, '2026-11-12'], [3, '2026-11-16']])
  marcarPista(db, p.id, 'respondio', { ahora: T + 86_400_000 })
  const ms = db.prepare(`SELECT titulo, estado FROM misiones WHERE categoria = 'seguimiento' ORDER BY id`).all() as any[]
  assert.deepEqual(ms.map((x) => x.estado), ['descartada', 'descartada', 'sugerida'])
  assert.equal(ms[2].titulo, 'Agendar la llamada con Estudio Norte')
})
