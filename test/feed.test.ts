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
