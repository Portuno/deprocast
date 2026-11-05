import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { listarPiezas } from '../src/corpus.ts'

const yt = await import('../src/youtube.ts')
// Sin red: el oEmbed «falla» y la pieza nace con el id como título.
yt._probarYoutube({ esperar: async () => {}, web: async () => new Response('', { status: 404 }), servicio: async () => new Response('', { status: 404 }) })

test('YouTube por dominio (plan v34, #46): el canal lleva su bloque, sus videos lo heredan y el corpus se consulta por él; el canal en espera se ve', async () => {
  const db = abrir(':memory:')
  const c = await yt.encolarYoutube(db, 'https://www.youtube.com/@CanalDeIdiomas', { dominio: 'Idiomas', max: 3 })
  assert.equal(c?.tipo, 'canal')
  let e = yt.estadoYoutube(db)
  assert.equal(e.listaCanales[0].estado, 'pendiente', 'en espera: la nube no lista canales')
  assert.equal(e.listaCanales[0].dominio, 'idiomas')
  assert.deepEqual(e.dominios, ['idiomas'])

  await yt.completarCanal(db, `canal:${c!.id}`, { titulo: 'Canal de Idiomas', videos: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'] })
  e = yt.estadoYoutube(db)
  assert.equal(e.listaCanales[0].videos, 3, 'hasta los pedidos')
  assert.equal(e.listaCanales[0].leidos, 0)
  await yt.completarVideo(db, 'aaaaaaaaaaa', { titulo: 'Cómo aprender alemán', canal: 'Canal de Idiomas', canalId: 'x', fecha: '2026-11-01', descripcion: '', transcripcion: 'Hoy vemos los verbos en alemán.', idioma: 'es', automatica: false, motivo: null, rastro: [] } as any)
  assert.equal(yt.estadoYoutube(db).listaCanales[0].leidos, 1)

  const r = listarPiezas(db, { q: 'alemán', dominio: 'idiomas' })
  assert.equal(r.piezas.length, 1)
  assert.ok(r.piezas[0].etiquetas.includes('idiomas'))
  assert.equal(listarPiezas(db, { q: 'alemán', dominio: 'negocio' }).piezas.length, 0)

  // Un video suelto que después se pide con dominio, lo suma.
  const v = await yt.encolarYoutube(db, 'https://www.youtube.com/watch?v=eeeeeeeeeee')
  await yt.encolarYoutube(db, 'https://www.youtube.com/watch?v=eeeeeeeeeee', { dominio: 'negocio' })
  assert.ok(listarPiezas(db, { dominio: 'negocio' }).piezas.some((p) => p.id === v!.piezaId))
})
