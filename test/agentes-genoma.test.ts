import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
const { abrir } = await import('../src/db.ts')
const { leer } = await import('../src/roster.ts')
const mi = await import('../src/agentes/misiones.ts')
const ge = await import('../src/agentes/genoma.ts')

const DIA = 86_400_000
const T = new Date(2026, 10, 2, 7, 30).getTime() // lunes: cierra la temporada anterior
const BRIEF = 'Productora audiovisual chica: fotos y video para eventos y marcas en Valencia.'
const pedidos: string[] = []
ge._probarGenoma({
  nube: async () => true,
  modelo: async (_db, sistema, usuario) => {
    pedidos.push(usuario)
    return /criador/.test(sistema)
      ? { estrategia: ['Probar con bodas en vez de eventos corporativos', 'Mensajes cortos'], mutacion: 'Apunta a bodas en vez de eventos corporativos' }
      : { estrategia: ['Las productoras chicas responden más que las agencias', 'Borradores de menos de 80 palabras'], por_que: 'dos respuestas de productoras, cero de agencias' }
  },
})

function temporada(db: any, semana: string, agente: string, neto: number) {
  db.prepare('INSERT OR REPLACE INTO temporadas (semana, agente_id, neto, estado_al_cierre, en) VALUES (?, ?, ?, ?, ?)').run(semana, agente, neto, 'activo', T)
}

test('La estrategia: el agente la escribe desde su diario y sus resultados, entra a su prompt; si él lo fija, no se toca', async () => {
  const db = abrir(':memory:')
  const m = mi.crearMisionAgente(db, { titulo: 'Clientes', brief: BRIEF }, T - 10 * DIA)
  assert.equal(await ge.escribirEstrategia(db, m.id, T), null, 'sin diario no hay nada que aprender')
  mi.anotarDiario(db, m, 'hallazgo', 'Dos productoras chicas contestaron; las agencias no.', null, T - DIA)
  const e = await ge.escribirEstrategia(db, m.id, T)
  assert.match(e!, /productoras chicas responden/)
  assert.match(pedidos.at(-1)!, /Tu diario:[\s\S]*Dos productoras chicas/)
  const f = leer(db, m.agenteId)!
  assert.match(mi.promptMision(db, f, mi.leerMisionAgente(db, m.id)!, T), /## Tu estrategia[\s\S]*Borradores de menos de 80 palabras/)
  ge.fijarGenoma(db, f.id, true)
  db.prepare('UPDATE agentes SET estrategia = ? WHERE id = ?').run('- la mía', f.id)
  assert.equal(await ge.escribirEstrategia(db, m.id, T), null)
  assert.equal(leer(db, f.id)!.estrategia, '- la mía')
})

test('La evolución: el mejor de una misión tiene un rival con una variación; a la semana, la temporada decide y el ganador se queda con las pistas', async () => {
  const db = abrir(':memory:')
  const m = mi.crearMisionAgente(db, { titulo: 'Clientes', brief: BRIEF, criterio: { metrica: 'clientes', meta: 3 } }, T - 10 * DIA)
  db.prepare(`UPDATE agentes SET estado = 'activo' WHERE id = ?`).run(m.agenteId)
  temporada(db, '2026-W44', m.agenteId, 30)

  const r1 = await ge.evolucionar(db, '2026-W44', T)
  assert.match(r1!, /tiene un rival en «Clientes»/)
  const rival = mi.listarMisionesAgente(db).find((x) => x.madreId === m.id)!
  const hijo = leer(db, rival.agenteId)!
  assert.deepEqual([hijo.padre, hijo.mutacion], [m.agenteId, 'Apunta a bodas en vez de eventos corporativos'])
  assert.match(hijo.estrategia!, /bodas/)
  assert.match(mi.promptMision(db, hijo, rival, T), /## Tu variación[\s\S]*compiten por la misma meta/)
  assert.equal(await ge.evolucionar(db, '2026-W44', T), null, 'un rival por misión')

  // Las pistas de la madre (una viva y una descartada) y la temporada siguiente: gana el rival.
  const ins = db.prepare(`INSERT INTO oportunidades (titulo, url, tipo, estado, origen, creada_en, actualizada_en, agente_mision_id, etapa, contacto) VALUES (?, ?, 'contacto', 'nueva', 'agente', ?, ?, ?, ?, '{}')`)
  ins.run('Viva', 'https://viva.example/', T, T, m.id, 'respondio')
  ins.run('Muerta', 'https://muerta.example/', T, T, m.id, 'descartada')
  temporada(db, '2026-W45', m.agenteId, 5)
  temporada(db, '2026-W45', hijo.id, 40)
  const r2 = await ge.evolucionar(db, '2026-W45', T + 7 * DIA)
  assert.match(r2!, new RegExp(`${hijo.id} le ganó a ${m.agenteId} en «Clientes» \\(se queda con 1 pista suya\\)`))
  assert.equal(mi.leerMisionAgente(db, m.id)!.estado, 'abandonada')
  assert.equal(leer(db, m.agenteId)!.estado, 'banca')
  assert.equal(mi.leerMisionAgente(db, rival.id)!.madreId, null, 'el ganador queda como la misión')
  assert.equal((db.prepare(`SELECT agente_mision_id AS m FROM oportunidades WHERE titulo = 'Viva'`).get() as any).m, rival.id)
  assert.equal((db.prepare(`SELECT agente_mision_id AS m FROM oportunidades WHERE titulo = 'Muerta'`).get() as any).m, m.id)
})

test('Sin nube no nacen rivales (gasta tokens), pero las rivalidades se resuelven igual; un genoma fijado no tiene rival', async () => {
  const db = abrir(':memory:')
  ge._probarGenoma({ nube: async () => false })
  const m = mi.crearMisionAgente(db, { titulo: 'A', brief: BRIEF }, T - 10 * DIA)
  db.prepare(`UPDATE agentes SET estado = 'activo' WHERE id = ?`).run(m.agenteId)
  temporada(db, '2026-W44', m.agenteId, 30)
  assert.equal(await ge.evolucionar(db, '2026-W44', T), null)
  ge._probarGenoma({ nube: async () => true })
  ge.fijarGenoma(db, m.agenteId, true)
  assert.equal(await ge.evolucionar(db, '2026-W44', T), null)
})
