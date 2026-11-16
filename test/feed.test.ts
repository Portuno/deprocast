import assert from 'node:assert/strict'
import { test } from 'node:test'
import { abrir } from '../src/db.ts'
import { _probarFeed, feedDe, fijarTope, interpretarFuente, recolectar, sumarFuente, votarItem } from '../src/feed.ts'

test('el feed con tope (plan v38, fase 5): fuentes que elige, X entra al corpus, tope por día, y aprende qué fuente importa', async () => {
  const db = abrir(':memory:')
  assert.deepEqual(interpretarFuente('@paulg'), { plataforma: 'x', ref: 'paulg', nombre: '@paulg' })
  assert.deepEqual(interpretarFuente('https://www.reddit.com/r/typescript/'), { plataforma: 'reddit', ref: 'typescript', nombre: 'r/typescript' })
  assert.equal(interpretarFuente('https://www.youtube.com/@veritasium').plataforma, 'youtube')
  assert.throws(() => interpretarFuente('cualquier cosa'), /No reconozco/)
  const x = sumarFuente(db, '@paulg')
  const r1 = sumarFuente(db, 'r/typescript')
  const r2 = sumarFuente(db, 'r/memes')
  _probarFeed(async (_db, f) => {
    if (f.plataforma === 'x') return [{ url: 'https://x.com/paulg/status/1', titulo: 'Write simply.', texto: 'Write simply.' }]
    return Array.from({ length: 8 }, (_, i) => ({ url: `https://reddit.com/r/${f.ref}/${i}`, titulo: `${f.ref} ${i}` }))
  })
  const r = await recolectar(db)
  assert.equal(r.nuevos, 17)
  assert.equal((await recolectar(db)).nuevos, 0, 'sin duplicados')
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE fuente = 'x'`).get() as any).n, 1, 'lo de X entra al corpus (el pozo)')

  fijarTope(db, 'reddit', 3)
  let reddit = feedDe(db).find((d) => d.plataforma === 'reddit')!
  assert.equal(reddit.items.length, 3, 'el tope del día')
  // Marca: lo de r/typescript importa, lo de r/memes no.
  for (const it of db.prepare(`SELECT id, url FROM feed_items WHERE plataforma = 'reddit' AND url LIKE '%/typescript/%' LIMIT 2`).all() as any[]) await votarItem(db, it.id, 1)
  const meme = db.prepare(`SELECT id FROM feed_items WHERE url LIKE '%/memes/%' LIMIT 1`).get() as any
  await votarItem(db, meme.id, 0)
  reddit = feedDe(db).find((d) => d.plataforma === 'reddit')!
  assert.equal(reddit.terminado, true, 'tres vistos: se terminó por hoy')
  assert.equal(reddit.items.filter((i) => i.voto == null).length, 0)
  const sug = (fid: number) => (db.prepare('SELECT MAX(sugerido) AS s FROM feed_items WHERE fuente_id = ? AND voto IS NULL').get(fid) as any).s
  assert.ok(sug(r1.id) > sug(r2.id), 'lo de la fuente que importa sube')
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE fuente = 'reddit'`).get() as any).n, 2, 'lo de Reddit que importa entra al corpus')
  assert.equal(x.plataforma, 'x')
})

test('#253: cada post se puntúa del 1 al 6 con categoría y razón; ranking de cuentas por semana y sugerencia de silenciar', async () => {
  const { leerPuntaje, puntuarItem, rankingCuentas, siguientePendiente, sugerido } = await import('../src/feed.ts')
  const db = abrir(':memory:')
  const buena = sumarFuente(db, '@buena')
  const mala = sumarFuente(db, '@mala')
  _probarFeed(async (_db, f) => Array.from({ length: 6 }, (_, i) => ({ url: `https://x.com/${f.ref}/status/${i}`, titulo: `${f.ref} ${i}`, texto: `${f.ref} ${i}` })))
  await recolectar(db)
  const items = (f: number) => (db.prepare('SELECT id FROM feed_items WHERE fuente_id = ? ORDER BY id').all(f) as { id: number }[]).map((r) => r.id)
  const semana = 7 * 86_400_000
  const ahora = Date.now()
  // La buena: 6 y 5 esta semana, 3 la anterior. La mala: siempre 1 o 2.
  await puntuarItem(db, items(buena.id)[0], 6, { categoria: 'ia', razon: 'muy claro' }, ahora)
  await puntuarItem(db, items(buena.id)[1], 5, {}, ahora)
  await puntuarItem(db, items(buena.id)[2], 3, {}, ahora - semana - 1000)
  for (const [i, id] of items(mala.id).slice(0, 5).entries()) await puntuarItem(db, id, i % 2 ? 2 : 1, {}, ahora)
  const it = db.prepare('SELECT voto, puntaje, categoria, razon FROM feed_items WHERE id = ?').get(items(buena.id)[0]) as any
  assert.deepEqual({ ...it }, { voto: 1, puntaje: 6, categoria: 'ia', razon: 'muy claro' }, 'del 4 al 6 importa')
  assert.equal((db.prepare('SELECT voto FROM feed_items WHERE id = ?').get(items(mala.id)[0]) as any).voto, 0)
  await assert.rejects(puntuarItem(db, items(buena.id)[3], 7), /del 1 al 6/)

  const r = rankingCuentas(db, ahora)
  assert.deepEqual(r.map((x) => [x.cuenta, x.votos]), [['@buena', 3], ['@mala', 5]])
  assert.equal(r[0].estaSemana, 5.5)
  assert.equal(r[0].semanaPasada, 3)
  assert.equal(r[1].silenciar, true, 'cae siempre abajo con 5 votos o más')
  assert.equal(r[0].silenciar, false)
  assert.ok(sugerido(db, buena.id) > sugerido(db, mala.id), 'lo que viene se ordena por cuánto le importa')
  assert.equal(siguientePendiente(db)!.fuenteId, buena.id, 'lo próximo para puntuar es lo más probable de importarle')

  // Desde el teléfono: «5», «2 #ruido», «6 - muy bueno»; un texto cualquiera no es un puntaje.
  assert.deepEqual(leerPuntaje('5'), { puntaje: 5, categoria: null, razon: null })
  assert.deepEqual(leerPuntaje('2 #ruido repetido'), { puntaje: 2, categoria: 'ruido', razon: 'repetido' })
  assert.deepEqual(leerPuntaje('6 - muy bueno'), { puntaje: 6, categoria: null, razon: 'muy bueno' })
  assert.equal(leerPuntaje('hola'), null)
  assert.equal(leerPuntaje('12 cosas'), null)
})
