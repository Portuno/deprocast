import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'
process.env.MASTRO_TALLER = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-'))

const { abrir, fijarAjuste } = await import('../src/db.ts')
const { leerArtefacto, valorarArtefacto } = await import('../src/taller.ts')
const cola = await import('../src/taller-cola.ts')

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))
let activos = 0
let maximo = 0
const orden: string[] = []
cola._probarCola(async (db, t) => {
  activos++
  maximo = Math.max(maximo, activos)
  orden.push(t.titulo)
  await dormir(15)
  activos--
  if (t.artefactoId) db.prepare(`UPDATE artefactos SET estado = 'listo', archivos = '["index.html"]' WHERE id = ?`).run(t.artefactoId)
  return t.artefactoId ? leerArtefacto(db, t.artefactoId) : null
})
async function hastaQueTermine(db: any) {
  for (let i = 0; i < 300; i++) {
    if (!(db.prepare(`SELECT COUNT(*) AS n FROM taller_cola WHERE estado IN ('en_cola', 'haciendo')`).get() as any).n) return
    await dormir(5)
  }
  throw new Error('la cola no terminó')
}

test('La cola corre de a uno (o dos con el ajuste), lo de más prioridad primero, y deja el registro', async () => {
  const db = abrir(':memory:')
  activos = 0; maximo = 0; orden.length = 0
  fijarAjuste(db, 'taller_paralelo', '1')
  cola.encolarTaller(db, { tipo: 'crear', args: { tipo: 'imagen', pedido: 'a' }, titulo: 'primero', prioridad: 5 })
  cola.encolarTaller(db, { tipo: 'crear', args: { tipo: 'imagen', pedido: 'b' }, titulo: 'normal', prioridad: 5 })
  cola.encolarTaller(db, { tipo: 'crear', args: { tipo: 'imagen', pedido: 'c' }, titulo: 'urgente', prioridad: 9 })
  assert.equal(cola.estadoCola(db).haciendo.length, 1)
  assert.equal(cola.estadoCola(db).enEspera.length, 2)
  await hastaQueTermine(db)
  assert.equal(maximo, 1, 'nunca más de uno a la vez')
  assert.deepEqual(orden, ['primero', 'urgente', 'normal'], 'el urgente se adelanta al que esperaba')
  const u = cola.estadoCola(db).ultimos[0]
  assert.equal(u.estado, 'listo')
  assert.ok(u.ms != null && u.empezado && u.terminado, 'cuándo empezó, terminó y cuánto tardó')

  maximo = 0
  fijarAjuste(db, 'taller_paralelo', '7')
  for (const t of ['x', 'y', 'z']) cola.encolarTaller(db, { tipo: 'crear', args: {}, titulo: t })
  await hastaQueTermine(db)
  assert.equal(maximo, 2, 'como mucho dos, aunque el ajuste pida más')
})

test('Los visuales del tutor: caché por concepto, nivel y dominio (prefiere el sellado), y solo texto si no se puede', async () => {
  const db = abrir(':memory:')
  fijarAjuste(db, 'taller_paralelo', '1')
  const v = { clase: 'diagrama', pedido: 'Un circuito con pila y lámpara', concepto: 'Ley de Ohm', nivel: 2, dominio: 'Electricidad', dominioId: 1, origen: 'tutor:1' }
  const a = cola.pedirVisual(db, v)
  assert.ok(a.artefactoId && !a.desdeCache && !a.degradado)
  assert.equal(cola.pedirVisual(db, v).artefactoId, a.artefactoId, 'si ya se está haciendo, se espera ese')
  await hastaQueTermine(db)
  const b = cola.pedirVisual(db, { ...v, concepto: 'ley de ohm' })
  assert.deepEqual([b.artefactoId, b.desdeCache], [a.artefactoId, true], 'el mismo concepto (sin importar mayúsculas) sale de la caché')
  assert.notEqual(cola.pedirVisual(db, { ...v, nivel: 3 }).artefactoId, a.artefactoId, 'a otro nivel, otro visual')
  await hastaQueTermine(db)

  // Dos versiones listas del mismo concepto: la caché prefiere la sellada (★ 4 o 5).
  const otro = db.prepare(`INSERT INTO artefactos (tipo, titulo, pedido, version, archivos, meta, estado, creado_en) VALUES ('visual', 'Ley de Ohm', 'x', 2, '[]', ?, 'listo', 1)`).run(JSON.stringify({ clave: cola.claveVisual(v) }))
  assert.equal(cola.pedirVisual(db, v).artefactoId, Number(otro.lastInsertRowid), 'sin sellar: el más nuevo')
  valorarArtefacto(db, a.artefactoId!, 5, 'clarísimo')
  assert.equal(cola.pedirVisual(db, v).artefactoId, a.artefactoId, 'el sellado manda')

  // La cola llena: la sesión sigue solo con texto.
  for (let i = 0; i < cola.MAX_EN_ESPERA; i++) db.prepare(`INSERT INTO taller_cola (tipo, args, titulo, estado, encolado_en) VALUES ('crear', '{}', 'espera', 'en_cola', ?)`).run(Date.now() + 1e9)
  assert.equal(cola.pedirVisual(db, { ...v, concepto: 'Potencia' }).degradado, 'la cola del Taller está llena')
  db.prepare(`DELETE FROM taller_cola WHERE titulo = 'espera'`).run()

  // El tope de tokens de hoy: también.
  fijarAjuste(db, 'tokens_dia_max', '10')
  db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, en) VALUES ('nan', 'x', 'gerente', 'g', 50, 50, ?)`).run(Date.now())
  assert.equal(cola.pedirVisual(db, { ...v, concepto: 'Resistencia' }).degradado, 'se llegó al tope de tokens de hoy')
})

test('Al reiniciar: lo que se estaba haciendo vuelve a la cola; lo del Taller que se cortó sin cola queda marcado', async () => {
  const db = abrir(':memory:')
  fijarAjuste(db, 'taller_paralelo', '1')
  const art = db.prepare(`INSERT INTO artefactos (tipo, titulo, pedido, version, archivos, meta, estado, creado_en) VALUES ('visual', 'V', 'p', 1, '[]', '{}', 'haciendo', 1)`).run()
  db.prepare(`INSERT INTO taller_cola (tipo, args, titulo, artefacto_id, estado, encolado_en, empezado_en) VALUES ('visual', '{}', 'a medias', ?, 'haciendo', 1, 2)`).run(Number(art.lastInsertRowid))
  const viejo = db.prepare(`INSERT INTO artefactos (tipo, titulo, pedido, version, archivos, meta, estado, creado_en) VALUES ('juego', 'J', 'p', 1, '[]', '{}', 'haciendo', 1)`).run()
  assert.equal(cola.retomarTaller(db), 1)
  assert.match(leerArtefacto(db, Number(viejo.lastInsertRowid))!.progreso!, /Se cortó/)
  await hastaQueTermine(db)
  assert.equal(leerArtefacto(db, Number(art.lastInsertRowid))!.estado, 'listo', 'el que volvió a la cola se terminó')
})
