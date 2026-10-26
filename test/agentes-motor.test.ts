import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { abrir } = await import('../src/db.ts')
const { forjar } = await import('../src/roster.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const { asientos } = await import('../src/auditor.ts')
const mo = await import('../src/agentes/motor.ts')

const base = () => abrir(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentes-m-')), 'a.db'))

test('Herramientas de un agente: lectura y grafo para todos, la web para los que buscan, nunca acciones del operador ni destructivas', () => {
  const bus = mo.herramientasDeAgente({ clase: 'buscador' }).map((h) => h.nombre)
  assert.ok(bus.includes('buscar_web') && bus.includes('ver_grafo') && bus.includes('buscar_corpus'))
  assert.ok(!mo.herramientasDeAgente({ clase: 'clasificador' }).some((h) => h.nombre === 'buscar_web'))
  for (const c of ['buscador', 'generativo', 'clasificador', 'gerente'] as const) {
    for (const h of mo.herramientasDeAgente({ clase: c })) assert.notEqual(h.familia, 'destructiva', h.nombre)
    assert.ok(!mo.herramientasDeAgente({ clase: c }).some((h) => /registrar_|crear_mision|fijar_|borrar_|fusionar/.test(h.nombre)))
  }
})

test('Una sesión en bucle: usa herramientas, guarda lo que vio en la web, queda en el auditor y corta al cerrar o por el tope', async () => {
  const db = base()
  const f = forjar(db, { clase: 'buscador', motor: 'local' } as any)
  const guion = [
    [{ id: 'a', nombre: 'buscar_corpus', argumentos: '{"consulta":"versa"}' }],
    [{ id: 'b', nombre: 'cerrar', argumentos: '{}' }],
    [],
  ]
  let i = 0
  _probarModelo(async () => ({ texto: 'listo', llamadas: guion[i++] ?? [], razonamiento: null, modelo: 'falso', tokens: 10 }))
  const cerrar = { nombre: 'cerrar', descripcion: 'cierra', parametros: { type: 'object', properties: {} }, familia: 'accion' as const, ejecutar: (_: any, ctx: any) => { ctx.mision.fin = true; return { ok: true } } }
  const mision = { id: 1, agenteId: f.id, urlsVistas: new Set<string>() }
  const r = await mo.trabajar(db, f, { sistema: 's', mensajes: [{ role: 'user', content: 'trabajá' }], herramientas: mo.herramientasDeAgente(f, [cerrar]), ctx: { mision } })
  assert.deepEqual(r.pasos.map((p) => p.herramienta), ['buscar_corpus', 'cerrar'])
  assert.equal(r.cortado, null)
  assert.equal(asientos(db, { agenteId: f.id }).length, 2)
  assert.equal(mo.trabajandoAhora().length, 0)

  db.prepare(`INSERT OR REPLACE INTO ajustes (clave, valor) VALUES ('tokens_dia_max', '1')`).run()
  db.prepare(`INSERT INTO llamadas (agente_id, clase, motor, modelo, tokens_in, tokens_out, en) VALUES (?, 'buscador', 'nan', 'x', 5, 5, ?)`).run(f.id, Date.now())
  const t = await mo.trabajar(db, f, { sistema: 's', mensajes: [], herramientas: mo.herramientasDeAgente(f) })
  assert.equal(t.cortado, 'tope')
})
