/**
 * Doctor: revisa que esta compu tenga todo para que Mastropiero ande. Cada chequeo dice ok, aviso o falla,
 * y qué hacer. Pensado para la mudanza a otra compu, pero sirve siempre.
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { abrir, resolverRuta } from './db.ts'
import { nanModelos } from './nan.ts'
import { urlsCalendario } from './calendario.ts'

export type Chequeo = { nombre: string; estado: 'ok' | 'aviso' | 'falla'; detalle: string }

function puertoLibre(puerto: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = net.createServer()
    s.once('error', () => ok(false))
    s.once('listening', () => s.close(() => ok(true)))
    s.listen(puerto, '127.0.0.1')
  })
}

export async function chequear(o: { conRed?: boolean; raiz?: string } = {}): Promise<Chequeo[]> {
  const raiz = o.raiz ?? process.cwd()
  const out: Chequeo[] = []
  const add = (nombre: string, estado: Chequeo['estado'], detalle: string) => out.push({ nombre, estado, detalle })

  const mayor = Number(process.versions.node.split('.')[0])
  add('Node', mayor >= 24 ? 'ok' : 'falla', mayor >= 24 ? `v${process.versions.node}` : `v${process.versions.node}: hace falta Node 24 o más (nodejs.org)`)

  try {
    const d = new DatabaseSync(':memory:')
    d.exec(`CREATE VIRTUAL TABLE t USING fts5(x, tokenize='unicode61 remove_diacritics 2')`)
    d.close()
    add('SQLite con búsqueda (FTS5)', 'ok', 'node:sqlite listo')
  } catch (e) {
    add('SQLite con búsqueda (FTS5)', 'falla', `node:sqlite sin FTS5: ${e instanceof Error ? e.message : e}`)
  }

  const env = path.join(raiz, '.env')
  if (!fs.existsSync(env)) add('.env', 'falla', 'No hay .env: copiá el de la otra compu (o .env.example) y completá NAN_API_KEY')
  else add('.env', 'ok', 'encontrado')
  add('NAN_API_KEY', process.env.NAN_API_KEY ? 'ok' : 'falla', process.env.NAN_API_KEY ? 'configurada' : 'Falta en .env: sin ella Mastropiero no piensa')

  if (o.conRed !== false && process.env.NAN_API_KEY) {
    try {
      const ms = await nanModelos()
      add('NaN responde', 'ok', `${ms.length} modelos disponibles`)
    } catch (e) {
      add('NaN responde', 'falla', `No contesta: ${e instanceof Error ? e.message : e}`)
    }
  }

  const ruta = resolverRuta()
  try {
    fs.mkdirSync(path.dirname(ruta), { recursive: true })
    const prueba = path.join(path.dirname(ruta), `.doctor-${process.pid}`)
    fs.writeFileSync(prueba, 'ok')
    fs.rmSync(prueba)
    add('Carpeta de datos', 'ok', path.dirname(ruta))
  } catch (e) {
    add('Carpeta de datos', 'falla', `No puedo escribir en ${path.dirname(ruta)}: ${e instanceof Error ? e.message : e}`)
  }

  if (fs.existsSync(ruta)) {
    try {
      const db = abrir(ruta)
      const n = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
      add('Base', 'ok', `${n('corpus').toLocaleString('es-AR')} piezas · ${n('agentes')} agentes · ${n('memoria')} recuerdos · ${n('conversaciones')} conversaciones`)
      const rotas = (db.prepare('SELECT ruta FROM cargas WHERE ruta IS NOT NULL').all() as { ruta: string }[]).filter((c) => !fs.existsSync(c.ruta)).length
      if (rotas) add('Archivos de cargas', 'aviso', `${rotas} carga(s) apuntan a archivos que no están acá (solo importa para recalcular etiquetas)`)
      db.close()
    } catch (e) {
      add('Base', 'falla', `No abre: ${e instanceof Error ? e.message : e}`)
    }
  } else add('Base', 'aviso', `Todavía no hay base en ${ruta}: arranca en blanco, o restaurá un respaldo`)

  const libre = await puertoLibre(Number(process.env.MASTRO_PUERTO ?? 7272))
  add('Puerto', libre ? 'ok' : 'aviso', libre ? `${process.env.MASTRO_PUERTO ?? 7272} libre` : `${process.env.MASTRO_PUERTO ?? 7272} ocupado: ¿ya está corriendo Mastropiero?`)

  add('Calendario', urlsCalendario().length ? 'ok' : 'aviso', urlsCalendario().length ? `${urlsCalendario().length} calendario(s)` : 'Sin GCAL_ICS_URLS: la jornada no ve tu agenda')

  const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  add('ffmpeg', ff.status === 0 ? 'ok' : 'aviso', ff.status === 0 ? (ff.stdout.split('\n')[0] ?? 'instalado') : 'No está: el Taller no puede montar videos (winget install ffmpeg)')

  return out
}

/** Para la consola. */
export function informe(cs: Chequeo[]): string {
  const icono = { ok: '✓', aviso: '!', falla: '✗' }
  const lineas = cs.map((c) => `  ${icono[c.estado]} ${c.nombre.padEnd(28)} ${c.detalle}`)
  const fallas = cs.filter((c) => c.estado === 'falla').length
  return [...lineas, '', fallas ? `  ${fallas} cosa(s) para arreglar antes de jugar.` : '  Todo listo: npm run jugar'].join('\n')
}
