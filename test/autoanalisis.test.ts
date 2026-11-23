import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrir } from '../src/db.ts'
import { _probarGrupos, BLOQUES, correrAutoanalisis, corridas } from '../src/autoanalisis.ts'
import { ACCIONES } from '../src/rutinas.ts'

const DIA = 86_400_000
const T1 = new Date(2026, 10, 15, 22).getTime()
const T2 = T1 + 7 * DIA
const f = (t: number) => new Date(t).toISOString().slice(0, 10)

test('Fragua #322: los mismos bloques en el mismo orden, cada número contra la anterior y la línea base; lo que falta dice «sin dato»', async () => {
  const db = abrir(':memory:')
  _probarGrupos({ correo: ['ver_mails'], salud: ['registrar_salud'] })
  const sueno = (t: number, h: number) => db.prepare(`INSERT INTO salud (fecha, tipo, titulo, datos, creado_en) VALUES (?, 'sueno', 'Dormí', ?, ?)`).run(f(t), JSON.stringify({ horas: h }), t)
  const herramienta = (t: number, h: string) => db.prepare(`INSERT INTO mensajes (conversacion_id, rol, herramienta, texto, en) VALUES (1, 'herramienta', ?, '{}', ?)`).run(h, t)
  const { crearConversacion } = await import('../src/chat/index.ts')
  crearConversacion(db, 'mastropiero', 'chat', T1 - 30 * DIA)

  // Semana 1: duerme 8 h; usa dos herramientas.
  sueno(T1 - DIA, 8); sueno(T1 - 2 * DIA, 8)
  herramienta(T1 - DIA, 'ver_mails'); herramienta(T1 - DIA, 'buscar_corpus')
  const a = await correrAutoanalisis(db, { ahora: T1 })
  assert.equal(a.version, 1)
  assert.equal(a.metricas['cuerpo.sueno'], 8)
  assert.equal(a.metricas['cuerpo.pantalla'], null, 'sin uso del teléfono: sin dato, no cero')
  assert.match(a.markdown, /^# Autoanálisis · 2026-11-15 · v1\n_Del .* Es la primera: queda como línea base\._/)
  assert.match(a.markdown, /\| Sueño promedio \| 8 h \| — \| — \|/)
  assert.match(a.markdown, /\| Pantalla del teléfono por día \| sin dato \|/)
  assert.match(a.markdown, /\*\*Grupos de herramientas que no se tocaron:\*\* salud/)

  // Semana 2: duerme menos y no usa herramientas.
  sueno(T2 - DIA, 5); sueno(T2 - 2 * DIA, 6)
  const b = await correrAutoanalisis(db, { ahora: T2 })
  assert.equal(b.version, 2)
  assert.match(b.markdown, /Comparado con la v1 \(2026-11-15\) \(que también es la línea base\)/)
  assert.match(b.markdown, /\| Sueño promedio \| 5,5 h \| −2,5 \| −2,5 \|/)
  assert.match(b.markdown, /## 9\. Tres cosas que conviene cambiar\n\n1\. \*\*.*\*\* bajó de .* a .* \(−/)
  assert.match(b.markdown, /Sueño promedio\*\* bajó de 8 h a 5,5 h \(−2,5\)/)

  // El orden de los bloques es fijo; la versión queda en el corpus, citable.
  const titulos = [...b.markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1])
  assert.deepEqual(titulos, [...BLOQUES.map((x) => x.titulo), '9. Tres cosas que conviene cambiar'])
  assert.equal(corridas(db).length, 2)
  assert.ok(b.piezaId)
  assert.equal((db.prepare('SELECT titulo FROM corpus WHERE id = ?').get(b.piezaId) as any).titulo, `Autoanálisis · ${f(T2)} · v2`)

  // La rutina del domingo corre la tercera y la resume con sus números.
  const msg = await ACCIONES.autoanalisis(db, f(T2 + 7 * DIA), T2 + 7 * DIA)
  assert.match(msg!, /📊 \*\*Autoanálisis de la semana \(v3\)\*\*/)
})
