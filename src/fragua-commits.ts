/**
 * La propuesta se cierra sola cuando un commit la nombra (Fragua #211). Cada tanto se leen los commits nuevos de main
 * (y los pull requests mergeados) —de GitHub en la nube, de git en su compu— y cada «Fragua #N» (también «fragua-N»,
 * «Fragua:N», listas como «Fragua #190, #202 y #201», o un título que empieza con «#N») cierra la propuesta N:
 * - con el link al commit, la fecha y quién lo firmó, marcada «cerrada por commit» (distinta de cerrada a mano);
 * - si el commit dice que la toca a medias («a medias», «parcial», «parte 1», «falta: …»), queda abierta con una nota;
 * - si dice «descartada», queda descartada;
 * - si dos commits la nombran, gana el último y queda el historial;
 * - si él la reabre, ese commit no vuelve a cerrarla.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ajuste, fijarAjuste, type Db } from './db.ts'
import { commitsDesde, githubDisponible, prsMergeadosDesde, type CommitRef } from './fragua-nube.ts'

const DIA = 86_400_000

export type Intencion = 'hecha' | 'parcial' | 'descartada'
export type Referencia = { id: number; intencion: Intencion; falta: string | null }
export type Cierre = { sha: string; url: string | null; autor: string; fecha: string; titulo: string; intencion: Intencion; pr?: number | null }

const LISTA = /\bfragua\s*[:#-]?\s*#?\s*(\d{1,5})((?:\s*(?:,|\by\b|\be\b|&|\/|\band\b)\s*#?\s*\d{1,5}\b)*)/gi
const PARCIAL = /a medias|parcial|\bparte\s+\d|primera parte|sin terminar|\bwip\b|\bfalta[n]?\s*:/i

/** Qué propuestas nombra un mensaje de commit, y con qué intención. */
export function referencias(mensaje: string): Referencia[] {
  const out = new Map<number, Referencia>()
  const lineas = mensaje.split('\n')
  for (const linea of lineas) {
    for (const m of linea.matchAll(LISTA)) {
      const resto = linea.slice((m.index ?? 0) + m[0].length)
      if (/^\s*aplicada\b/i.test(resto)) continue // «Fragua #N aplicada»: el merge de una forja, N es la forja
      const ids = [m[1], ...[...(m[2] ?? '').matchAll(/\d{1,5}/g)].map((x) => x[0])].map(Number)
      const clausula = linea.slice(m.index ?? 0)
      const intencion: Intencion = /descartad/i.test(clausula) ? 'descartada' : PARCIAL.test(clausula) ? 'parcial' : 'hecha'
      const falta = intencion === 'parcial' ? (/\bfalta[n]?\s*:?\s*(.+)$/i.exec(clausula)?.[1]?.trim().slice(0, 300) ?? null) : null
      for (const id of ids) if (!out.has(id)) out.set(id, { id, intencion, falta })
    }
  }
  // Un título que arranca con «#N: …» también la nombra.
  const t = /^#(\d{1,5})\b/.exec(lineas[0]?.trim() ?? '')
  if (t && !out.has(Number(t[1]))) out.set(Number(t[1]), { id: Number(t[1]), intencion: PARCIAL.test(lineas[0]) ? 'parcial' : /descartad/i.test(lineas[0]) ? 'descartada' : 'hecha', falta: null })
  return [...out.values()]
}

/** Los commits que hizo la Fragua misma (su número es el de la forja, no el de una propuesta). */
function esDeForja(db: Db, c: CommitRef): boolean {
  if (/Forjado y probado por La Fragua/.test(c.mensaje)) return true
  return !!db.prepare('SELECT 1 FROM fragua WHERE merge_sha = ?').get(c.sha)
}

const json = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) as T : d } catch { return d } }

/** Aplica los commits (del más viejo al más nuevo: gana el último). Devuelve qué cambió. */
export function aplicarCommits(db: Db, commits: CommitRef[]) {
  const r = { cerradas: [] as number[], parciales: [] as number[], descartadas: [] as number[] }
  const orden = [...commits].sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha))
  for (const c of orden) {
    if (esDeForja(db, c)) continue
    for (const ref of referencias(c.mensaje)) {
      const p = db.prepare('SELECT id, estado, cerrada_por, cierres, deshechos FROM propuestas WHERE id = ?').get(ref.id) as { id: number; estado: string; cerrada_por: string | null; cierres: string | null; deshechos: string | null } | undefined
      if (!p) continue
      if (json<string[]>(p.deshechos, []).includes(c.sha)) continue
      const cierres = json<Cierre[]>(p.cierres, [])
      if (cierres.some((x) => x.sha === c.sha)) continue // ya visto
      const reg: Cierre = { sha: c.sha, url: c.url, autor: c.autor, fecha: c.fecha, titulo: c.mensaje.split('\n')[0].slice(0, 200), intencion: ref.intencion, pr: c.pr ?? null }
      cierres.push(reg)
      const en = Date.parse(c.fecha) || Date.now()
      if (ref.intencion === 'parcial') {
        const nota = `A medias en ${c.sha.slice(0, 7)} (${c.fecha.slice(0, 10)}): ${ref.falta ? `falta ${ref.falta}` : reg.titulo}`
        db.prepare('UPDATE propuestas SET nota = ?, cierres = ? WHERE id = ?').run(nota, JSON.stringify(cierres), p.id)
        r.parciales.push(p.id)
      } else if (p.estado === 'abierta' || p.cerrada_por === 'commit') {
        db.prepare(`UPDATE propuestas SET estado = ?, resuelta_en = ?, cerrada_por = 'commit', cierre = ?, cierres = ?, nota = NULL, en_cola = NULL WHERE id = ?`)
          .run(ref.intencion === 'descartada' ? 'descartada' : 'aceptada', en, JSON.stringify(reg), JSON.stringify(cierres), p.id)
        ;(ref.intencion === 'descartada' ? r.descartadas : r.cerradas).push(p.id)
      } else {
        // Cerrada a mano (o por su forja): el commit queda en el historial, no le cambia el estado.
        db.prepare('UPDATE propuestas SET cierres = ? WHERE id = ?').run(JSON.stringify(cierres), p.id)
      }
    }
  }
  return r
}

/** Los commits de su compu (cuando no hay GitHub): git log de la rama actual. */
function gitLog(desde: string, repo = process.cwd()): CommitRef[] {
  if (!fs.existsSync(path.join(repo, '.git'))) return []
  const salida = execFileSync('git', ['log', `--since=${desde}`, '--format=%H%x1f%an%x1f%cI%x1f%B%x1e', '-n', '500'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  const repoGh = process.env.MASTRO_REPO?.trim()
  return salida.split('\x1e').map((b) => b.trim()).filter(Boolean).map((b) => {
    const [sha, autor, fecha, mensaje] = b.split('\x1f')
    return { sha, autor, fecha, mensaje: mensaje ?? '', url: repoGh ? `https://github.com/${repoGh}/commit/${sha}` : null }
  })
}

let traer = async (desde: string): Promise<CommitRef[]> => {
  if (githubDisponible()) {
    const [cs, prs] = await Promise.all([commitsDesde(desde), prsMergeadosDesde(desde).catch(() => [] as CommitRef[])])
    return [...cs, ...prs]
  }
  return gitLog(desde)
}
export function _probarCommits(f: typeof traer) { traer = f }

/** Lee los commits nuevos y cierra lo que nombran. La primera vez mira tres semanas para atrás. */
export async function revisarCommits(db: Db, ahora = Date.now()) {
  const desde = ajuste(db, 'fragua_commits_desde') || new Date(ahora - 21 * DIA).toISOString()
  const commits = await traer(desde)
  const r = aplicarCommits(db, commits)
  const ultima = Math.max(0, ...commits.map((c) => Date.parse(c.fecha) || 0))
  // Un minuto de solapamiento: lo ya visto no se repite (se reconoce por el sha).
  if (ultima) fijarAjuste(db, 'fragua_commits_desde', new Date(ultima - 60_000).toISOString())
  return { ...r, leidos: commits.length }
}

/** Él la reabre (el commit no era el que correspondía): vuelve a abierta y ese commit no la cierra más. */
export function reabrirPropuesta(db: Db, id: number) {
  const p = db.prepare('SELECT cierre, deshechos FROM propuestas WHERE id = ?').get(id) as { cierre: string | null; deshechos: string | null } | undefined
  if (!p) throw new Error(`No existe la propuesta ${id}`)
  const sha = json<Cierre | null>(p.cierre, null)?.sha
  const deshechos = json<string[]>(p.deshechos, [])
  if (sha && !deshechos.includes(sha)) deshechos.push(sha)
  db.prepare(`UPDATE propuestas SET estado = 'abierta', resuelta_en = NULL, cerrada_por = NULL, cierre = NULL, cubierta_por = NULL, deshechos = ? WHERE id = ?`).run(JSON.stringify(deshechos), id)
  return { ok: true }
}

/** Las cerradas hace poco, con cómo se cerraron (para la pantalla: deshacer lo que cerró un commit). */
export function cerradasRecientes(db: Db, ahora = Date.now(), dias = 14) {
  return (db.prepare(`SELECT id, titulo, area, estado, cerrada_por, cierre, cubierta_por, resuelta_en FROM propuestas WHERE estado != 'abierta' AND resuelta_en >= ? ORDER BY resuelta_en DESC LIMIT 40`).all(ahora - dias * DIA) as any[])
    .map((p) => ({ id: p.id, titulo: p.titulo, area: p.area, estado: p.estado, cerradaPor: p.cerrada_por ?? 'mano', cierre: json<Cierre | null>(p.cierre, null), cubiertaPor: p.cubierta_por ?? null, resueltaEn: p.resuelta_en }))
}
