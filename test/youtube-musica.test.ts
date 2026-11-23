import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { after, before, test } from 'node:test'
import { abrir, fijarAjuste } from '../src/db.ts'
import { ejecutar, subir } from '../src/cargas/index.ts'
import { HERRAMIENTAS } from '../src/chat/herramientas.ts'
import { gustoMusical } from '../src/musica.ts'
import { _probarYoutubeMusica } from '../src/youtube-musica.ts'

/** Un zip mínimo (sin comprimir), como el de Google Takeout. */
function zip(archivos: Record<string, string>): Buffer {
  const locales: Buffer[] = []
  const centrales: Buffer[] = []
  let offset = 0
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const datos = Buffer.from(contenido, 'utf8')
    const n = Buffer.from(nombre, 'utf8')
    const crc = zlib.crc32(datos)
    const loc = Buffer.alloc(30)
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0, 8); loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(datos.length, 18); loc.writeUInt32LE(datos.length, 22); loc.writeUInt16LE(n.length, 26)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(datos.length, 20); cen.writeUInt32LE(datos.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42)
    locales.push(loc, n, datos)
    centrales.push(cen, n)
    offset += 30 + n.length + datos.length
  }
  const central = Buffer.concat(centrales)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(archivos).length, 8); fin.writeUInt16LE(Object.keys(archivos).length, 10); fin.writeUInt32LE(central.length, 12); fin.writeUInt32LE(offset, 16)
  return Buffer.concat([...locales, central, fin])
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ytm-'))
const antes = process.env.MASTRO_CARGAS
before(() => { process.env.MASTRO_CARGAS = tmp })
after(() => { process.env.MASTRO_CARGAS = antes; fs.rmSync(tmp, { recursive: true, force: true }) })

const vista = (titulo: string, canal: string | null, time: string, o: { header?: string; url?: string } = {}) => ({
  header: o.header ?? 'YouTube Music', title: titulo, titleUrl: o.url ?? `https://music.youtube.com/watch?v=${Buffer.from(titulo).toString('hex').slice(0, 11)}`,
  ...(canal ? { subtitles: [{ name: canal, url: 'https://www.youtube.com/channel/x' }] } : {}), time, products: ['YouTube'],
})
const historial = [
  vista('Has visto Nocturno', 'Trío Tres - Topic', '2026-10-05T23:30:00.000Z'),
  vista('Has visto Nocturno', 'Trío Tres - Topic', '2026-10-06T23:40:00.000Z'),
  vista('Watched Balada', 'Solista Dos', '2026-10-07T09:00:00.000Z', { url: 'https://music.youtube.com/watch?v=bal4d4xxxxx' }),
  vista('Has visto Tema A', 'Banda Uno - Topic', '2026-11-02T08:10:00.000Z', { header: 'YouTube', url: 'https://www.youtube.com/watch?v=temaAxxxxxx' }), // un tema por YouTube común
  vista('Has visto Cómo arreglar una bici', 'Canal de bicis', '2026-11-02T10:00:00.000Z', { header: 'YouTube', url: 'https://www.youtube.com/watch?v=bicixxxxxxx' }), // no es música
  vista('Has visto https://www.youtube.com/watch?v=borrado', null, '2026-11-03T10:00:00.000Z'), // video borrado, sin canal
]

test('Fragua #336: el Takeout de YouTube y YouTube Music entra como escuchas (estimadas), por mes, con listas, biblioteca y gusto', () => {
  const db = abrir(':memory:')
  const c = subir(db, 'takeout-20261123.zip', zip({
    'Takeout/YouTube y YouTube Music/historial/historial-de-reproducciones.json': JSON.stringify(historial),
    'Takeout/YouTube y YouTube Music/música (biblioteca y subidas)/music library songs.csv': 'Video ID,Song Title,Album Title,Artist Names\nabc,Nocturno,Noches,Trío Tres\ndef,Tema B,Primero,Banda Uno\n',
    'Takeout/YouTube y YouTube Music/playlists/Para correr-videos.csv': 'Video ID,Playlist Video Creation Timestamp\ntemaAxxxxxx,2026-08-01T00:00:00+00:00\ndesconocido,2026-08-02T00:00:00+00:00\n',
  }))
  assert.equal(c.importador, 'youtube-musica')
  assert.match(c.analisis!.descripcion, /^4 escuchas en 2 meses, 1 listas, 2 temas en la biblioteca/)
  assert.ok(c.analisis!.avisos.some((a) => /estimadas/.test(a)))
  ejecutar(db, c.id, { pipeline: 'ninguna' })

  const filas = db.prepare('SELECT artista, tema, fuente FROM escuchas ORDER BY en').all() as any[]
  assert.deepEqual(filas.map((f) => `${f.artista}|${f.tema}|${f.fuente}`), ['Trío Tres|Nocturno|youtube', 'Trío Tres|Nocturno|youtube', 'Solista Dos|Balada|youtube', 'Banda Uno|Tema A|youtube'])
  const piezas = db.prepare(`SELECT titulo, contenido FROM corpus WHERE fuente = 'youtube-musica' ORDER BY titulo`).all() as any[]
  assert.deepEqual(piezas.map((p) => p.titulo), ['Biblioteca de YouTube Music', 'Escuchas en YouTube Music · 2026-10', 'Escuchas en YouTube Music · 2026-11', 'Gusto musical (por uso)', 'Lista de YouTube · Para correr'])
  assert.match(piezas[1].contenido, /unas 0,2 h \(estimadas\) de música en 3 días, 3 reproducciones, 2 artistas[\s\S]*1\. Trío Tres · 2 veces/)
  assert.match(piezas[4].contenido, /_2 temas \(1 sin nombre en el export\)\._\n\n1\. Tema A — Banda Uno/)
  const g = gustoMusical(db) as any
  assert.equal(g.artistas[0].nombre, 'Trío Tres')
  assert.deepEqual(g.fuentes, ['youtube'])
  assert.match(g.aviso, /estimadas/)
})

test('Fragua #336: traer_musica_youtube trae listas y «me gusta» de la cuenta; sin el permiso dice cómo darlo', async () => {
  const db = abrir(':memory:')
  const traer = HERRAMIENTAS.find((h) => h.nombre === 'traer_musica_youtube')!
  const sin = await traer.ejecutar({}, { db } as any) as any
  assert.equal(sin.sin_permiso, true)
  assert.match(sin.aviso, /volver a conectar Google/)

  fijarAjuste(db, 'google_refresh', 'x')
  const { ALCANCES } = await import('../src/google/oauth.ts')
  fijarAjuste(db, 'google_alcances', ALCANCES.map((a) => a.replace('https://www.googleapis.com/auth/', '')).join(' '))
  _probarYoutubeMusica(async (_db, url) => {
    if (url.includes('/playlists?')) return { items: [{ id: 'PL1', snippet: { title: 'Para entrenar' } }] } as any
    if (url.includes('/playlistItems?')) return url.includes('pageToken') ? { items: [{ snippet: { title: 'Deleted video' } }] } as any : { items: [{ snippet: { title: 'Nocturno', videoOwnerChannelTitle: 'Trío Tres - Topic' } }], nextPageToken: 'p2' } as any
    if (url.includes('myRating=like')) return { items: [{ snippet: { title: 'Balada', channelTitle: 'Solista Dos', categoryId: '10' } }, { snippet: { title: 'Un tutorial', channelTitle: 'Alguien', categoryId: '27' } }] } as any
    throw new Error(url)
  })
  const r = await traer.ejecutar({}, { db } as any) as any
  assert.deepEqual(r, { listas: 1, temas: 1, meGusta: 1, nuevas: 2, cambiadas: 0 })
  const lista = db.prepare(`SELECT contenido FROM corpus WHERE origen_id = 'youtube-musica:lista:PL1'`).get() as any
  assert.equal(lista.contenido, '# Para entrenar\n_1 temas._\n\n1. Nocturno — Trío Tres')
  assert.match((db.prepare(`SELECT contenido FROM corpus WHERE origen_id = 'youtube-musica:me-gusta'`).get() as any).contenido, /- Balada — Solista Dos$/)
  assert.deepEqual(await traer.ejecutar({}, { db } as any), { listas: 1, temas: 1, meGusta: 1, nuevas: 0, cambiadas: 0 }, 'traerlas de nuevo sin cambios no duplica')
})
