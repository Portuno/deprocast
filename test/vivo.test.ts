import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'

const { abrir, fijarAjuste } = await import('../src/db.ts')
const { iniciarDirecto } = await import('../src/directo.ts')
const { estadoVivo, vivoParaPrompt } = await import('../src/vivo.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const { _probarEscriba, conversacionHoy, estaPensando } = await import('../src/chat/index.ts')
const { PEDIDO_CONSEJO, pedirConsejo, reglasDeConsejo } = await import('../src/copiloto.ts')
const sombra = await import('../src/sombra.ts')

_probarEscriba(async () => {})
const sistemas: string[] = []
_probarModelo(async (_l: any, o: any) => { sistemas.push(String(o.mensajes[0].content)); return { texto: 'Lleva 25 minutos en Instagram. [[seguir]]\nPasá a la siguiente banda\n[[/seguir]]', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 } as any })

const T = new Date(2026, 9, 21, 15, 0).getTime()
const MIN = 60_000

function sembrar() {
  const db = abrir(':memory:')
  fijarAjuste(db, 'apps_estimulo', 'instagram')
  const s = iniciarDirecto(db, ['pantalla', 'voz'], T - 40 * MIN)
  const m = db.prepare(`INSERT INTO directo_momentos (sesion_id, tipo, desde, hasta, app, actividad, tema, texto) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  m.run(s.id, 'pantalla', T - 40 * MIN, T - 30 * MIN, 'VS Code', 'programando', 'Deprocast', null)
  m.run(s.id, 'pantalla', T - 29 * MIN, T - 20 * MIN, 'Instagram', 'navegando', 'reels', null)
  m.run(s.id, 'pantalla', T - 19 * MIN, T - 1 * MIN, 'Instagram', 'navegando', 'reels', null)
  m.run(s.id, 'voz', T - 5 * MIN, T - 4 * MIN, null, null, null, 'tengo que llamar a Pablo')
  const prop = { id: 'p1', tipo: 'tarea', estado: 'pendiente', titulo: 'Llamar a Pablo', detalle: null, misionId: null, tipoEntidad: null, tipoCon: null, alias: [], de: null, con: null, oido: 'tengo que llamar a Pablo' }
  db.prepare('UPDATE directo_sesiones SET resumen = ? WHERE id = ?').run(JSON.stringify({ propuestas: [prop] }), s.id)
  return { db, s }
}

test('En vivo: qué está haciendo, cuánto lleva en lo mismo, el estímulo, los momentos y lo que espera su ok', () => {
  const { db, s } = sembrar()
  const v = estadoVivo(db, T)!
  assert.equal(v.sesion.id, s.id)
  assert.deepEqual([v.actual!.app, v.actual!.tema], ['Instagram', 'reels'])
  assert.equal(v.bloque, 29, 'los dos momentos seguidos de Instagram son un solo bloque, hasta ahora')
  assert.equal(v.enEstimulo, true)
  assert.equal(v.estimuloHoy, 27, '9 + 18 minutos de Instagram')
  assert.equal(v.momentos.length, 4)
  assert.equal(v.pendientes, 1)
  assert.equal(v.banda, null, 'sin run')
  const p = vivoParaPrompt(db, T)
  assert.match(p, /Ahora: Instagram · navegando · reels, hace 29 min seguidos \(su meta de bloque es \d+ min\); es una app de alto estímulo/)
  assert.match(p, /dijo: «tengo que llamar a Pablo»/)
  assert.match(p, /Esperan su ok 1 cosas/)
  assert.equal(estadoVivo(abrir(':memory:'), T), null, 'sin Directo, nada')
})

test('El consejo, solo cuando lo pide: entra como su pedido (💡), con el contexto en vivo y acciones rápidas', async () => {
  const { db } = sembrar()
  const cid = conversacionHoy(db).id
  assert.match(reglasDeConsejo(db, T), /UNA sola cosa/)
  assert.match(reglasDeConsejo(abrir(':memory:')), /El Directo está apagado/)
  sistemas.length = 0
  pedirConsejo(db, cid)
  for (let i = 0; i < 200 && estaPensando(cid); i++) await new Promise((r) => setTimeout(r, 10))
  const ms = db.prepare('SELECT rol, texto, via FROM mensajes WHERE conversacion_id = ? ORDER BY id').all(cid) as any[]
  assert.deepEqual({ ...ms[0] }, { rol: 'operador', texto: PEDIDO_CONSEJO, via: 'copiloto' })
  assert.match(sistemas[0], /te pidió un consejo para ESTE momento/)
  assert.match(sistemas[0], /En vivo \(el Directo está prendido/, 've lo que está haciendo')
  assert.match(ms.at(-1).texto, /\[\[seguir\]\]/)
})

test('Para validar: lo del Directo en curso se resuelve en la misma bandeja, de a una o en lote', async () => {
  const { db, s } = sembrar()
  const b = sombra.bandeja(db, T)
  const g = b.grupos.find((x) => x.tipo === 'directo')!
  assert.equal(g.n, 1, 'también lo del Directo que sigue prendido')
  assert.equal(b.grupos[0].tipo, 'directo', 'con el Directo prendido, lo suyo va primero')
  assert.deepEqual(g.items[0], { id: `${s.id}:p1`, texto: 'Tarea: Llamar a Pablo', sub: 'tengo que llamar a Pablo' })
  await sombra.resolverBandeja(db, 'directo', `${s.id}:p1`, 'aceptar', T)
  assert.ok(db.prepare(`SELECT 1 FROM misiones WHERE titulo = 'Llamar a Pablo'`).get())
  assert.equal(sombra.bandeja(db, T).grupos.find((x) => x.tipo === 'directo'), undefined)
  // Las propuestas de La Fragua también se resuelven acá.
  const pid = Number(db.prepare(`INSERT INTO propuestas (titulo, detalle, estado, creada_en) VALUES ('Atajo para dictar', 'Mantener Alt', 'abierta', 1)`).run().lastInsertRowid)
  assert.equal(sombra.bandeja(db, T).grupos.find((x) => x.tipo === 'propuesta')!.items[0].texto, 'Atajo para dictar')
  await sombra.resolverBandeja(db, 'propuesta', pid, 'aceptar', T)
  assert.equal((db.prepare('SELECT prioridad FROM propuestas WHERE id = ?').get(pid) as any).prioridad, 'alta', 'aceptar es marcarla para construir')
  assert.equal(sombra.bandeja(db, T).grupos.find((x) => x.tipo === 'propuesta'), undefined, 'decidida, ya no se pregunta')
})
