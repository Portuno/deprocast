import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
const { abrir } = await import('../src/db.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const mi = await import('../src/agentes/misiones.ts')

const T = new Date(2026, 10, 1, 20).getTime() // un domingo
const BRIEF = 'Productora audiovisual chica: fotos y video para eventos y marcas en Valencia.'

test('Hablarle a un agente: contesta desde su misión, sin trabajarla; lo que se dijo queda en su diario', async () => {
  const db = abrir(':memory:')
  const m = mi.crearMisionAgente(db, { titulo: 'Clientes', brief: BRIEF }, T)
  let sistema = '', herramientas: string[] = []
  _probarModelo(async (_l, o) => {
    sistema = String((o.mensajes[0] as any).content)
    herramientas = (o.herramientas as any[]).map((h) => h.function.name)
    return { texto: 'Elegí productoras chicas porque tercerizan más.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 5 }
  })
  const r = await mi.hablarConMision(db, m.id, '¿Por qué elegiste esas?', T)
  assert.match(r, /tercerizan/)
  assert.match(sistema, /El operador te habla[\s\S]*no trabajás la misión/)
  assert.ok(!herramientas.some((h) => ['guardar_pista', 'redactar_borrador', 'cerrar_sesion', 'rehacer_plan'].includes(h)), 'en la charla no trabaja')
  const d = mi.diarioDe(db, m.id).map((x) => `${x.tipo}: ${x.texto}`)
  assert.ok(d.some((x) => /^instruccion: ¿Por qué elegiste esas\?/.test(x)))
  assert.ok(d.some((x) => /^reflexion: Le contesté: Elegí productoras/.test(x)))
})

test('El informe del domingo: cada misión con movimiento, con sesiones, pistas, borradores y progreso; nada si no hubo', async () => {
  const db = abrir(':memory:')
  assert.equal(await mi.informeSemanal(db, T), null)
  const m = mi.crearMisionAgente(db, { titulo: 'Tres clientes', brief: BRIEF, criterio: { metrica: 'clientes', meta: 3 } }, T - 86_400_000)
  mi.anotarDiario(db, m, 'sesion', 'Sesión 1: 5 pasos', null, T - 3600_000)
  db.prepare(`INSERT INTO oportunidades (titulo, url, tipo, estado, origen, creada_en, actualizada_en, agente_mision_id, etapa, contacto, borrador) VALUES ('Luz', 'https://luz.example/', 'contacto', 'me_interesa', 'agente', ?, ?, ?, 'borrador', '{"organizacion":"Luz","canal":"mail","url":null}', 'Hola…')`).run(T - 3600_000, T - 3600_000, m.id)
  const t = (await mi.informeSemanal(db, T))!
  assert.match(t, /Tus agentes esta semana[\s\S]*\*\*Tres clientes\*\*.*1 sesión, 1 pista nueva, 1 borrador esperándote en 📥 · 0 de 3 \(3 clientes\)/)
})
