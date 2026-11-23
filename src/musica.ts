/**
 * La música que lo acompaña (Fragua #325): las escuchas de Spotify (del export «Descargá tus datos», el de la cuenta o
 * el historial extendido) quedan una por fila, sin repetir aunque se suba dos veces o se crucen los dos exports. De ahí
 * sale el gusto musical declarado por uso: los artistas y temas que más escucha, lo de los últimos meses, lo que sube y
 * qué suena en cada franja del día. Lo leen los agentes y las runs con gusto_musical; al corpus va por mes, con fecha.
 */
import type { Db } from './db.ts'

const ESQUEMA = `CREATE TABLE IF NOT EXISTS escuchas (
  en TEXT NOT NULL,          -- 'YYYY-MM-DD HH:MM' (UTC, cuando terminó de sonar)
  artista TEXT NOT NULL,
  tema TEXT NOT NULL,
  album TEXT,
  ms INTEGER NOT NULL,       -- cuánto sonó
  carga_id INTEGER,
  PRIMARY KEY (en, artista, tema)
);
CREATE INDEX IF NOT EXISTS escuchas_artista ON escuchas(artista, en);
CREATE INDEX IF NOT EXISTS escuchas_carga ON escuchas(carga_id);`

const listas = new WeakSet<Db>()
export function asegurarEscuchas(db: Db): void {
  if (listas.has(db)) return
  db.exec(ESQUEMA)
  listas.add(db)
}

/** Menos de 30 segundos no cuenta como reproducción (el mismo umbral que usa Spotify); el tiempo sí suma. */
export const MS_REPRODUCCION = 30_000

export type Escucha = { en: string; artista: string; tema: string; album: string | null; ms: number }

/** Una fila del historial, venga del export de la cuenta o del extendido. Los podcasts y lo vacío quedan afuera. */
export function escuchaDe(x: any): Escucha | null {
  if (!x || typeof x !== 'object') return null
  const artista = String(x.master_metadata_album_artist_name ?? x.artistName ?? '').trim()
  const tema = String(x.master_metadata_track_name ?? x.trackName ?? '').trim()
  const cuando = String(x.ts ?? x.endTime ?? '').trim()
  const ms = Number(x.ms_played ?? x.msPlayed ?? 0)
  if (!artista || !tema || !/^\d{4}-\d{2}-\d{2}/.test(cuando) || !(ms >= 0)) return null
  if (artista === 'Unknown Artist' && tema === 'Unknown Track') return null
  return { en: `${cuando.slice(0, 10)} ${cuando.slice(11, 16) || '00:00'}`, artista, tema, album: x.master_metadata_album_album_name ? String(x.master_metadata_album_album_name) : null, ms: Math.round(ms) }
}

export const esHistorial = (j: unknown): boolean => Array.isArray(j) && j.length > 0 && j.slice(0, 20).some((x) => escuchaDe(x) !== null)

/** Guarda las escuchas sin repetir. Devuelve cuántas son nuevas y qué meses tocaron. */
export function guardarEscuchas(db: Db, xs: Escucha[], cargaId: number | null = null): { nuevas: number; meses: string[] } {
  asegurarEscuchas(db)
  const ins = db.prepare('INSERT OR IGNORE INTO escuchas (en, artista, tema, album, ms, carga_id) VALUES (?, ?, ?, ?, ?, ?)')
  let nuevas = 0
  const meses = new Set<string>()
  for (const e of xs) {
    if (Number(ins.run(e.en, e.artista, e.tema, e.album, e.ms, cargaId).changes) > 0) { nuevas++; meses.add(e.en.slice(0, 7)) }
  }
  return { nuevas, meses: [...meses].sort() }
}

const horas = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10
const h = (ms: number) => `${String(horas(ms)).replace('.', ',')} h`

type Fila = { nombre: string; horas: number; veces: number }
function top(db: Db, col: 'artista' | 'tema', desde: string, hasta: string, n: number): Fila[] {
  const sel = col === 'tema' ? `tema || ' — ' || artista` : 'artista'
  return (db.prepare(`SELECT ${sel} AS nombre, SUM(ms) AS ms, SUM(ms >= ${MS_REPRODUCCION}) AS veces FROM escuchas WHERE en >= ? AND en < ? GROUP BY ${col === 'tema' ? 'tema, artista' : 'artista'} ORDER BY ms DESC LIMIT ?`).all(desde, hasta, n) as any[])
    .map((r) => ({ nombre: r.nombre, horas: horas(r.ms), veces: r.veces }))
}

const FRANJAS = [['madrugada', 0, 6], ['mañana', 6, 12], ['tarde', 12, 19], ['noche', 19, 24]] as const

/** Un mes de escuchas, en texto: para la pieza del corpus. */
export function resumenDelMes(db: Db, mes: string): string | null {
  asegurarEscuchas(db)
  const desde = `${mes}-01`, hasta = `${mes}-32`
  const t = db.prepare(`SELECT SUM(ms) AS ms, SUM(ms >= ${MS_REPRODUCCION}) AS veces, COUNT(DISTINCT artista) AS artistas, COUNT(DISTINCT en || tema) AS n FROM escuchas WHERE en >= ? AND en < ?`).get(desde, hasta) as any
  if (!t?.n) return null
  const dias = (db.prepare(`SELECT COUNT(DISTINCT substr(en, 1, 10)) AS d FROM escuchas WHERE en >= ? AND en < ?`).get(desde, hasta) as any).d
  return [
    `# Escuchas de ${mes}`,
    `${h(t.ms)} de música en ${dias} días, ${t.veces} reproducciones, ${t.artistas} artistas.`,
    '', '## Artistas', ...top(db, 'artista', desde, hasta, 10).map((r, i) => `${i + 1}. ${r.nombre} · ${h(r.horas * 3_600_000)} · ${r.veces} veces`),
    '', '## Temas', ...top(db, 'tema', desde, hasta, 10).map((r, i) => `${i + 1}. ${r.nombre} · ${r.veces} veces`),
  ].join('\n')
}

const restarDias = (fecha: string, d: number) => new Date(Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10)

/** El gusto musical declarado por uso. Las ventanas se cuentan desde la última escucha (el export puede ser viejo). */
export function gustoMusical(db: Db, o: { artista?: string } = {}) {
  asegurarEscuchas(db)
  const r = db.prepare('SELECT MIN(en) AS desde, MAX(en) AS hasta, SUM(ms) AS ms, COUNT(*) AS n FROM escuchas').get() as any
  if (!r?.n) return null
  const fin = `${r.hasta.slice(0, 10)}~`, hace90 = restarDias(r.hasta, 90), hace180 = restarDias(r.hasta, 180)
  if (o.artista) {
    const a = db.prepare(`SELECT artista, SUM(ms) AS ms, SUM(ms >= ${MS_REPRODUCCION}) AS veces, MIN(en) AS primera, MAX(en) AS ultima FROM escuchas WHERE artista = ? COLLATE NOCASE GROUP BY artista`).get(o.artista) as any
    if (!a) return { artista: o.artista, escuchas: 0 }
    const temas = (db.prepare(`SELECT tema, SUM(ms) AS ms, SUM(ms >= ${MS_REPRODUCCION}) AS veces FROM escuchas WHERE artista = ? GROUP BY tema ORDER BY ms DESC LIMIT 10`).all(a.artista) as any[]).map((t) => ({ tema: t.tema, veces: t.veces, horas: horas(t.ms) }))
    return { artista: a.artista, horas: horas(a.ms), veces: a.veces, primera: a.primera, ultima: a.ultima, temas }
  }
  const recientes = top(db, 'artista', hace90, fin, 30)
  const antes = new Map(top(db, 'artista', hace180, hace90, 200).map((x) => [x.nombre, x.horas]))
  const suben = recientes.filter((x) => x.horas >= 1 && x.horas >= 2 * (antes.get(x.nombre) ?? 0)).slice(0, 8).map((x) => ({ artista: x.nombre, horas: x.horas, antes: antes.get(x.nombre) ?? 0 }))
  const porFranja = FRANJAS.map(([nombre, a, b]) => {
    const f = db.prepare(`SELECT artista, SUM(ms) AS ms FROM escuchas WHERE en >= ? AND CAST(substr(en, 12, 2) AS INTEGER) >= ? AND CAST(substr(en, 12, 2) AS INTEGER) < ? GROUP BY artista ORDER BY ms DESC LIMIT 3`).all(hace180, a, b) as any[]
    return { franja: nombre, horas_utc: `${a}–${b}`, artistas: f.map((x) => x.artista) }
  }).filter((f) => f.artistas.length)
  const meses = (db.prepare(`SELECT substr(en, 1, 7) AS mes, SUM(ms) AS ms FROM escuchas GROUP BY mes ORDER BY mes DESC LIMIT 12`).all() as any[]).reverse().map((m) => ({ mes: m.mes, horas: horas(m.ms) }))
  return {
    desde: r.desde.slice(0, 10), hasta: r.hasta.slice(0, 10), horas: horas(r.ms), escuchas: r.n,
    artistas: top(db, 'artista', '0000', fin, 15),
    temas: top(db, 'tema', '0000', fin, 15),
    ultimos_90_dias: recientes.slice(0, 10),
    suben,
    por_franja: porFranja,
    horas_por_mes: meses,
  }
}

/** El gusto, en texto: la pieza «Gusto musical» del corpus (se rehace en cada carga). */
export function gustoEnTexto(db: Db): string | null {
  const g = gustoMusical(db) as ReturnType<typeof gustoMusical> & { artistas?: Fila[] }
  if (!g || !('artistas' in g) || !g.artistas) return null
  const x = g as any
  return [
    '# Gusto musical (por uso)',
    `Declarado por lo que escucha, no por lo que dice: ${h(x.horas * 3_600_000)} de música entre ${x.desde} y ${x.hasta}.`,
    '', '## Los que más escucha', ...x.artistas.map((r: Fila, i: number) => `${i + 1}. ${r.nombre} · ${h(r.horas * 3_600_000)}`),
    '', '## Últimos 90 días del historial', ...x.ultimos_90_dias.map((r: Fila, i: number) => `${i + 1}. ${r.nombre} · ${h(r.horas * 3_600_000)}`),
    ...(x.suben.length ? ['', '## Lo que sube', ...x.suben.map((s: any) => `- ${s.artista}: ${String(s.horas).replace('.', ',')} h (antes ${String(s.antes).replace('.', ',')} h)`)] : []),
    '', '## Temas', ...x.temas.map((r: Fila, i: number) => `${i + 1}. ${r.nombre} · ${r.veces} veces`),
    ...(x.por_franja.length ? ['', '## Qué suena según la hora (UTC)', ...x.por_franja.map((f: any) => `- ${f.franja}: ${f.artistas.join(', ')}`)] : []),
  ].join('\n')
}

/** Deshacer una carga: sus escuchas se van con ella. */
export function borrarEscuchasDeCarga(db: Db, cargaId: number): number {
  try { return Number(db.prepare('DELETE FROM escuchas WHERE carga_id = ?').run(cargaId).changes) } catch { return 0 }
}
