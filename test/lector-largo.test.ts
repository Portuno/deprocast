import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.TZ = 'Europe/Madrid'
process.env.NAN_API_KEY = 'test'

const { abrir } = await import('../src/db.ts')
const { _probarLector, guardarLink, leer, tramo } = await import('../src/lector/index.ts')
const { HERRAMIENTAS, ejecutarHerramienta } = await import('../src/chat/herramientas.ts')
const { _probarModelo } = await import('../src/modelo.ts')
const { _probarEscriba, conversacionHoy, enviar } = await import('../src/chat/index.ts')

_probarEscriba(async () => {})
_probarModelo(async () => ({ texto: 'Listo.', llamadas: [], razonamiento: null, modelo: 'falso', tokens: 1 }) as any)

/** Un documento largo: 300 párrafos numerados (unos 40.000 caracteres). */
const largo = Array.from({ length: 300 }, (_, i) => `Párrafo ${i + 1}: ${'texto de relleno '.repeat(7)}fin ${i + 1}.`).join('\n')

function red(rutas: Record<string, { cuerpo: string; tipo?: string; status?: number }>) {
  _probarLector(async (url) => {
    const r = rutas[url]
    if (!r) return new Response('no', { status: 404 })
    return new Response(r.cuerpo, { status: r.status ?? 200, headers: { 'content-type': r.tipo ?? 'text/html; charset=utf-8' } })
  })
}

test('Los tramos cubren todo el texto, sin huecos ni repetidos, y cortan en un fin de línea', () => {
  let desde: number | null = 0
  let junto = ''
  let vueltas = 0
  while (desde != null) {
    const t = tramo(largo, desde)
    assert.ok(t.texto.length <= 10_000)
    if (t.sigue != null) assert.equal(largo[t.hasta], '\n', 'corta entre líneas')
    junto += t.texto
    desde = t.sigue
    vueltas++
  }
  assert.equal(junto.replace(/\n/g, ''), largo.replace(/\n/g, ''))
  assert.ok(vueltas >= 4)
})

test('Un Google Doc compartido se lee entero (su exportación), y uno privado avisa cómo compartirlo', async () => {
  const id = '1VwaqGLZJlHwJ6yUngFZN9kSCaKq2KdOsn_hqPVrVhgU'
  red({ [`https://docs.google.com/document/d/${id}/export?format=md`]: { cuerpo: `# Plan de la Build Night\n\n${largo}`, tipo: 'text/markdown' } })
  const l = await leer(`https://docs.google.com/document/d/${id}/edit?tab=t.0`)
  assert.equal(l.fuente, 'google')
  assert.equal(l.titulo, 'Plan de la Build Night')
  assert.ok(l.markdown.endsWith('fin 300.'), 'llega hasta el final')
  red({ [`https://docs.google.com/document/d/${id}/export?format=md`]: { cuerpo: '<html>Iniciar sesión</html>' }, [`https://docs.google.com/document/d/${id}/export?format=txt`]: { cuerpo: '<html>Iniciar sesión</html>' } })
  const p = await leer(`https://docs.google.com/document/d/${id}/edit`)
  assert.equal(p.markdown, '')
  assert.match(p.aviso!, /privado: compartilo como «Cualquier persona con el enlace puede ver»/)
})

test('leer_pagina lee lo guardado en el corpus de a tramos, hasta el final', async () => {
  const db = abrir(':memory:')
  red({ 'https://ejemplo.org/doc': { cuerpo: largo, tipo: 'text/plain' } })
  const g = await guardarLink(db, 'https://ejemplo.org/doc')
  const ctx = { db, conversacionId: null }
  let desde: number | null = 0
  const tramos: any[] = []
  while (desde != null) {
    const r = (await ejecutarHerramienta(HERRAMIENTAS, 'leer_pagina', JSON.stringify({ url: 'https://ejemplo.org/doc', desde }), ctx)).resultado as any
    assert.equal(r.pieza, g.piezaId, 'lee lo guardado, sin volver a bajarlo')
    tramos.push(r)
    desde = r.sigue
  }
  assert.ok(tramos.length >= 4)
  assert.match(tramos.at(-1).texto, /fin 300\.$/)
  const pieza = (await ejecutarHerramienta(HERRAMIENTAS, 'leer_pieza', JSON.stringify({ id: g.piezaId, desde: tramos[1].desde }), ctx)).resultado as any
  assert.equal(pieza.texto, tramos[1].texto, 'leer_pieza también va por tramos')
})

test('Varios links en un mensaje: todos se guardan enteros y cada uno deja su línea en la charla', async () => {
  const db = abrir(':memory:')
  const cid = conversacionHoy(db).id
  const rutas: Record<string, { cuerpo: string; tipo: string }> = {}
  for (let i = 1; i <= 6; i++) rutas[`https://ejemplo.org/nota-${i}`] = { cuerpo: `# Nota ${i}\n\n${largo}`, tipo: 'text/markdown' }
  red(rutas)
  await enviar(db, cid, `te paso todo esto:\n${Object.keys(rutas).join('\n')}`)
  for (let i = 0; i < 100; i++) {
    if ((db.prepare(`SELECT COUNT(*) AS n FROM mensajes WHERE conversacion_id = ? AND rol = 'evento' AND texto LIKE '🔗%'`).get(cid) as any).n >= 6) break
    await new Promise((r) => setTimeout(r, 20))
  }
  const lineas = (db.prepare(`SELECT texto FROM mensajes WHERE conversacion_id = ? AND rol = 'evento' AND texto LIKE '🔗%' ORDER BY id`).all(cid) as any[]).map((m) => m.texto)
  assert.equal(lineas.length, 6, 'más de tres links por mensaje')
  assert.match(lineas[0], /^🔗 Guardé «Nota 1» entero en el corpus: [\d.]+ palabras \(#\d+\)/)
  const piezas = db.prepare(`SELECT contenido FROM corpus WHERE origen_id LIKE 'url:%'`).all() as any[]
  assert.equal(piezas.length, 6)
  assert.ok(piezas.every((p) => p.contenido.endsWith('fin 300.')), 'enteros, sin cortar')
})
