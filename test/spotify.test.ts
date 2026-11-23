import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { after, before, test } from 'node:test'
import { abrir } from '../src/db.ts'
import { deshacer, ejecutar, leerCarga, subir } from '../src/cargas/index.ts'
import { HERRAMIENTAS } from '../src/chat/herramientas.ts'
import { gustoMusical } from '../src/musica.ts'

/** Un zip mínimo (sin comprimir), como el de «Descargá tus datos». */
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-'))
const antes = process.env.MASTRO_CARGAS
before(() => { process.env.MASTRO_CARGAS = tmp })
after(() => { process.env.MASTRO_CARGAS = antes; fs.rmSync(tmp, { recursive: true, force: true }) })

const MIN = 60_000
// El export de la cuenta (endTime) y el extendido (ts) tienen formas distintas.
const cuenta = [
  { endTime: '2026-09-03 08:10', artistName: 'Banda Uno', trackName: 'Tema A', msPlayed: 4 * MIN },
  { endTime: '2026-09-03 08:14', artistName: 'Banda Uno', trackName: 'Tema B', msPlayed: 3 * MIN },
  { endTime: '2026-09-20 22:00', artistName: 'Solista Dos', trackName: 'Balada', msPlayed: 5 * MIN },
  { endTime: '2026-09-20 22:01', artistName: 'Solista Dos', trackName: 'Salteado', msPlayed: 10_000 },
]
const extendido = [
  { ts: '2026-10-05T23:30:00Z', ms_played: 6 * MIN, master_metadata_track_name: 'Nocturno', master_metadata_album_artist_name: 'Trío Tres', master_metadata_album_album_name: 'Noches' },
  { ts: '2026-10-06T23:40:00Z', ms_played: 6 * MIN, master_metadata_track_name: 'Nocturno', master_metadata_album_artist_name: 'Trío Tres', master_metadata_album_album_name: 'Noches' },
  { ts: '2026-10-07T09:00:00Z', ms_played: 20 * MIN, master_metadata_track_name: null, episode_name: 'Un podcast', episode_show_name: 'Show' },
  // La misma escucha que ya vino en el de la cuenta: no se repite.
  { ts: '2026-09-03T08:10:41Z', ms_played: 4 * MIN, master_metadata_track_name: 'Tema A', master_metadata_album_artist_name: 'Banda Uno' },
]
const listas = { playlists: [{ name: 'Para correr', lastModifiedDate: '2026-08-01', items: [{ track: { trackName: 'Tema A', artistName: 'Banda Uno' } }, { track: { trackName: 'Nocturno', artistName: 'Trío Tres' } }] }] }
const biblioteca = { tracks: [{ artist: 'Banda Uno', album: 'Primero', track: 'Tema B' }], artists: [{ name: 'Solista Dos' }] }

test('Fragua #325: el zip de Spotify entra como escuchas sin repetir, una pieza por mes, listas, biblioteca y el gusto por uso', () => {
  const db = abrir(':memory:')
  const c = subir(db, 'my_spotify_data.zip', zip({
    'Spotify Account Data/StreamingHistory_music_0.json': JSON.stringify(cuenta),
    'Spotify Extended Streaming History/Streaming_History_Audio_2026.json': JSON.stringify(extendido),
    'Spotify Account Data/Playlist1.json': JSON.stringify(listas),
    'Spotify Account Data/YourLibrary.json': JSON.stringify(biblioteca),
    'Spotify Account Data/Userdata.json': JSON.stringify({ username: 'x' }),
  }))
  assert.equal(c.importador, 'spotify')
  assert.deepEqual(c.analisis!.segmentos.map((s) => s.id), ['meses', 'gusto', 'listas', 'biblioteca'])
  assert.match(c.analisis!.descripcion, /^7 escuchas en 2 meses, 1 listas, 1 temas guardados/)
  ejecutar(db, c.id, { pipeline: 'ninguna' })

  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM escuchas').get() as any).n, 6, 'sin podcasts y sin la escucha repetida')
  const piezas = db.prepare(`SELECT titulo, tipo, fecha, nivel, contenido FROM corpus WHERE fuente = 'spotify' ORDER BY titulo`).all() as any[]
  assert.deepEqual(piezas.map((p) => p.titulo), ['Biblioteca de Spotify', 'Escuchas · 2026-09', 'Escuchas · 2026-10', 'Gusto musical (por uso)', 'Lista de Spotify · Para correr'])
  assert.ok(piezas.every((p) => p.nivel === 'propia'))
  const sep = piezas.find((p) => p.titulo === 'Escuchas · 2026-09')
  assert.equal(sep.fecha, '2026-09-01')
  assert.match(sep.contenido, /0,2 h de música en 2 días, 3 reproducciones, 2 artistas/)
  assert.match(sep.contenido, /1\. Banda Uno · 0,1 h · 2 veces/)
  assert.equal(piezas.find((p) => p.titulo.startsWith('Lista'))!.tipo, 'lista')

  const g = gustoMusical(db) as any
  assert.equal(g.artistas[0].nombre, 'Trío Tres')
  assert.deepEqual(g.por_franja.find((f: any) => f.franja === 'noche').artistas, ['Trío Tres', 'Solista Dos'])
  assert.equal((gustoMusical(db, { artista: 'banda uno' }) as any).temas.length, 2)

  // Una carga nueva con más escuchas del mismo mes corrige la pieza (no la duplica).
  const c2 = subir(db, 'StreamingHistory_music_1.json', JSON.stringify([{ endTime: '2026-10-30 23:50', artistName: 'Trío Tres', trackName: 'Alba', msPlayed: 7 * MIN }]))
  assert.equal(c2.importador, 'spotify')
  ejecutar(db, c2.id, { pipeline: 'ninguna' })
  const oct = db.prepare(`SELECT contenido, meta FROM corpus WHERE origen_id = 'spotify:mes:2026-10'`).all() as any[]
  assert.equal(oct.length, 1)
  assert.match(oct[0].contenido, /Alba — Trío Tres/)
  assert.match(oct[0].meta, /Nuevas escuchas de Spotify/)

  // Deshacer la segunda carga se lleva sus escuchas.
  deshacer(db, c2.id)
  assert.equal(leerCarga(db, c2.id)!.estado, 'deshecha')
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM escuchas WHERE tema = 'Alba'`).get() as any).n, 0)
})

test('Fragua #325: los agentes y el chat leen el gusto con gusto_musical; sin escuchas dice cómo conseguirlas', async () => {
  const db = abrir(':memory:')
  const h = HERRAMIENTAS.find((x) => x.nombre === 'gusto_musical')!
  const vacio = await h.ejecutar({}, { db } as any) as any
  assert.equal(vacio.sin_datos, true)
  assert.match(vacio.como, /spotify\.com\/account\/privacy/)
  const { herramientasPara, gruposDelMensaje } = await import('../src/chat/herramientas.ts')
  assert.ok(herramientasPara('agente').some((x) => x.nombre === 'gusto_musical'))
  assert.ok(gruposDelMensaje('qué música escucho cuando trabajo?').includes('musica'))
})
