/**
 * npm run medir: la línea de base de la velocidad, con una base sintética del tamaño de la nube (genérica: nada personal).
 * 1. Si no existe, arma data/medir.db: 30.000 piezas con entidades, 40.000 pasajes con vector, 25.000 destilados,
 *    15.000 quántomos con vector, 600 recuerdos, 1.800 misiones, 20.000 mensajes en Hoy, 30.000 llamadas, 5.000 momentos
 *    del Directo y 3.000 líneas de crónica. (--rehacer la vuelve a armar.)
 * 2. Levanta el servidor sobre esa base (sin rutinas ni Telegram), pide las rutas calientes varias veces como la pantalla
 *    (con Accept-Encoding) y mide el tiempo, los bytes que viajan y cuánto se trabó el event loop.
 * Imprime una tabla para comparar antes y después de cada optimización.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'

const RAIZ = path.resolve(import.meta.dirname, '..')
const BASE = path.join(RAIZ, 'data', 'medir.db')
const PUERTO = 7474
const VECES = 7

async function armarBase() {
  for (const f of [BASE, `${BASE}-wal`, `${BASE}-shm`]) fs.rmSync(f, { force: true })
  process.env.MASTRO_DB = BASE
  const { abrir } = await import('../src/db.ts')
  const { conversacionHoy } = await import('../src/chat/index.ts')
  const db = abrir(BASE)
  const ahora = Date.now()
  const DIA = 86_400_000
  const azar = (n: number) => Math.floor(Math.random() * n)
  const vec = (dims = 512) => { const f = new Float32Array(dims); let s = 0; for (let i = 0; i < dims; i++) { f[i] = Math.random() - 0.5; s += f[i] * f[i] } s = Math.sqrt(s); for (let i = 0; i < dims; i++) f[i] /= s; return Buffer.from(f.buffer) }
  const texto = (n: number) => Array.from({ length: n }, () => ['proyecto', 'cliente', 'reunión', 'idea', 'juego', 'taller', 'factura', 'agente', 'mapa', 'texto'][azar(10)]).join(' ')
  const lote = (f: () => void) => { db.exec('BEGIN'); try { f(); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e } }
  const fecha = (d: number) => new Date(ahora - d * DIA).toISOString().slice(0, 10)

  console.log('Armando la base sintética (una vez)…')
  const ents: number[] = []
  lote(() => {
    const e = db.prepare(`INSERT INTO entidades (tipo, nombre, creada_en) VALUES (?, ?, ?)`)
    db.prepare(`INSERT INTO entidades (tipo, nombre, meta, creada_en) VALUES ('persona', 'Jugador Ejemplo', '{"operador":1}', ?)`).run(ahora)
    for (let i = 0; i < 2000; i++) ents.push(Number(e.run(i % 3 ? 'persona' : 'proyecto', `Entidad ${i}`, ahora).lastInsertRowid))
  })
  const piezas: number[] = []
  lote(() => {
    const c = db.prepare(`INSERT INTO corpus (fuente, nivel, titulo, contenido, estado, fecha, origen_id, entidades, meta, creado_en) VALUES ('operador', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (let i = 0; i < 30000; i++) {
      const es = Array.from({ length: azar(4) }, () => ents[azar(ents.length)])
      const meta = i % 50 === 0 ? JSON.stringify({ aporte: 1, primaria: 1 + azar(8) }) : '{}'
      piezas.push(Number(c.run(['propia', 'primaria', 'investigacion'][i % 3], `Pieza ${i} · ${texto(4)}`, texto(250), ['disponible', 'crudo', 'clasificado'][i % 3], fecha(azar(400)), `sint:${i}`, JSON.stringify(es), meta, ahora - azar(400) * DIA).lastInsertRowid))
    }
  })
  lote(() => {
    const p = db.prepare(`INSERT INTO pasajes (pieza_id, orden, desde, hasta, modelo, vec, en) VALUES (?, ?, 0, 1500, 'sint', ?, ?)`)
    for (let i = 0; i < 40000; i++) p.run(piezas[i % piezas.length], Math.floor(i / piezas.length), vec(), ahora)
    const d = db.prepare(`INSERT INTO takeout_destilado (pieza_id, lote, prioridad, estado, salida, hecho_en) VALUES (?, 'reproceso', 1, ?, ?, ?)`)
    for (let i = 0; i < 25000; i++) d.run(piezas[i], i % 10 ? 'hecho' : 'pendiente', JSON.stringify({ valor: i % 4, resumen: texto(200), abierto: i % 7 ? [] : [texto(6)], temas: [texto(1)] }), ahora - i * 1000)
  })
  lote(() => {
    const q = db.prepare(`INSERT INTO quantomos (texto, etapa, origen_id, novedad, creado_en, actualizado_en) VALUES (?, ?, ?, 'nueva', ?, ?)`)
    const v = db.prepare(`INSERT INTO vec_items (tipo, id, modelo, vec, en) VALUES (?, ?, 'sint', ?, ?)`)
    for (let i = 0; i < 15000; i++) v.run('quantomo', Number(q.run(texto(12), i % 5 ? 'proto' : 'sellado', `q:${i}`, ahora, ahora).lastInsertRowid), vec(), ahora)
    const m = db.prepare(`INSERT INTO memoria (texto, tipo, fecha, estado, revisada, creada_por, creada_en) VALUES (?, 'hecho', ?, 'vigente', ?, 'escriba', ?)`)
    for (let i = 0; i < 600; i++) v.run('memoria', Number(m.run(texto(10), fecha(azar(100)), i % 3 ? 1 : 0, ahora).lastInsertRowid), vec(), ahora)
  })
  lote(() => {
    const semana = (() => { const d = new Date(ahora); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dia = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dia); const a = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - a.getTime()) / DIA + 1) / 7)).padStart(2, '0')}` })()
    const m = db.prepare(`INSERT INTO misiones (personaje, asignada_por, nivel, padre_id, titulo, categoria, entidad_id, estado, semana, minutos, creada_por, creada_en, cerrada_en) VALUES ('jugador', 'operador', ?, ?, ?, ?, ?, ?, ?, ?, 'operador', ?, ?)`)
    const prims: number[] = []
    for (let i = 0; i < 8; i++) prims.push(Number(m.run('primaria', null, `Primaria ${i}`, 'trabajo', ents[i * 3], 'activa', semana, null, ahora - DIA, null).lastInsertRowid))
    for (let i = 0; i < 1500; i++) m.run('secundaria', prims[i % 8], `Banda ${i}`, ['trabajo', 'escritura', 'comunicacion'][i % 3], null, ['hecha', 'parcial', 'no', 'activa'][i % 4], null, 25, ahora - azar(60) * DIA, ahora - azar(60) * DIA)
    for (let i = 0; i < 300; i++) m.run('terciaria', null, `Side quest ${i}`, null, null, i % 2 ? 'activa' : 'hecha', null, null, ahora - azar(60) * DIA, null)
  })
  const hoy = conversacionHoy(db).id
  lote(() => {
    const m = db.prepare(`INSERT INTO mensajes (conversacion_id, rol, texto, en) VALUES (?, ?, ?, ?)`)
    for (let i = 0; i < 20000; i++) m.run(hoy, i % 2 ? 'asistente' : 'operador', texto(60), ahora - (20000 - i) * 60_000)
    const l = db.prepare(`INSERT INTO llamadas (motor, modelo, clase, agente_id, tokens_in, tokens_out, latencia_ms, status, en) VALUES ('nan', 'sint', 'mastropiero', ?, 2000, 400, 900, 200, ?)`)
    for (let i = 0; i < 30000; i++) l.run(i % 4 ? 'chat' : 'reproceso-vec', ahora - azar(60) * DIA)
    const c = db.prepare(`INSERT INTO cronica (tick, tipo, texto, en) VALUES (?, 'corre', ?, ?)`)
    for (let i = 0; i < 3000; i++) c.run(i, texto(15), ahora - (3000 - i) * 600_000)
    db.prepare(`INSERT INTO directo_sesiones (inicio, fin, estado) VALUES (?, ?, 'cerrada')`).run(ahora - 14 * DIA, ahora - DIA)
    const d = db.prepare(`INSERT INTO directo_momentos (sesion_id, tipo, desde, hasta, app, actividad, tema) VALUES (1, 'pantalla', ?, ?, ?, 'trabajar', ?)`)
    for (let i = 0; i < 5000; i++) { const t = ahora - azar(14 * 24) * 3_600_000; d.run(t, t + azar(20) * 60_000, ['VS Code', 'Chrome', 'Instagram'][i % 3], `tema ${i % 30}`) }
  })
  db.close()
  console.log(`Lista: ${(fs.statSync(BASE).size / 1024 / 1024).toFixed(0)} MB`)
}

/** Un pedido crudo: el tiempo hasta el último byte y los bytes que viajaron (comprimidos, si el servidor comprime). */
const TOPE_MS = 90_000
function pedir(ruta: string, headers: Record<string, string> = {}): Promise<{ ms: number; bytes: number; status: number; etag?: string; inmutable?: boolean }> {
  return new Promise((ok, mal) => {
    const t0 = performance.now()
    const r = http.get({ host: '127.0.0.1', port: PUERTO, path: ruta, headers: { 'accept-encoding': 'br, gzip', ...headers }, timeout: TOPE_MS }, (res) => {
      let bytes = 0
      res.on('data', (c) => (bytes += c.length))
      res.on('end', () => ok({ ms: performance.now() - t0, bytes, status: res.statusCode ?? 0, etag: res.headers.etag as string | undefined, inmutable: /immutable/.test(String(res.headers['cache-control'] ?? '')) }))
    })
    r.on('timeout', () => { r.destroy(); ok({ ms: TOPE_MS, bytes: 0, status: 0 }) })
    r.on('error', mal)
  })
}
const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function main() {
  if (process.argv.includes('--rehacer') || !fs.existsSync(BASE)) await armarBase()
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/servidor.ts', '--db', BASE, '--puerto', String(PUERTO), '--sin-rutinas', '--sin-telegram'], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MASTRO_REPROCESO_LOCAL: '', NAN_API_KEY: '', GOOGLE_CUENTA_SERVICIO: '', GCAL_ICS_URLS: '' } })
  let log = ''
  srv.stdout.on('data', (d) => (log += d))
  srv.stderr.on('data', (d) => (log += d))
  try {
    for (let i = 0; ; i++) {
      try { await pedir('/version'); break } catch { if (i > 100) throw new Error(`El servidor no arrancó:\n${log}`); await new Promise((r) => setTimeout(r, 200)) }
    }
    await pedir('/api/velocidad/reiniciar')
    const rutas = ['/api/estado', '/api/hoy', '/api/hoy/hud', '/api/chat/1', '/api/reproceso', '/api/takeout', '/api/misiones', '/api/bandeja', '/api/personas', '/api/yo', '/api/preguntas/siguiente', '/api/entidades', '/api/memoria', '/api/encargos', '/api/mano', '/api/academia', '/api/taller', '/api/fragua', '/api/revision', '/api/grafos', '/api/agentes/misiones']
    const ancho = [34, 6, 9, 9, 9]
    const linea = (xs: string[]) => xs.map((x, i) => (i ? x.padStart(ancho[i]) : x.padEnd(ancho[i]))).join(' ')
    console.log(`\n${linea(['ruta', 'status', 'ms (med)', 'ms (máx)', 'KB'])}\n${'-'.repeat(70)}`)
    for (const r of rutas) {
      const xs: { ms: number; bytes: number; status: number }[] = [await pedir(r)]
      // Lo que tarda más de 2 s se mide una sola vez (si no, la medición misma traba todo).
      if (xs[0].ms < 2000) for (let i = 1; i < VECES; i++) xs.push(await pedir(r))
      console.log(linea([r, xs[0].status ? String(xs[0].status) : 'tope', mediana(xs.map((x) => x.ms)).toFixed(1), Math.max(...xs.map((x) => x.ms)).toFixed(1), (xs[0].bytes / 1024).toFixed(1)]))
      if (!xs[0].status) { console.log(`  (más de ${TOPE_MS / 1000} s: el servidor quedó trabado, corto acá)`); return }
    }
    // Jugar una carta de La Mano (POST): lo que tarda en volver con lo que conecta; después se deshace.
    const mano = JSON.parse(await new Promise<string>((ok) => http.get({ host: '127.0.0.1', port: PUERTO, path: '/api/mano' }, (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => ok(s)) })))
    const enviar = (ruta: string, cuerpo: unknown) => new Promise<{ ms: number; json: any }>((ok, mal) => {
      const t0 = performance.now()
      const r = http.request({ host: '127.0.0.1', port: PUERTO, path: ruta, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => ok({ ms: performance.now() - t0, json: JSON.parse(s || '{}') })) })
      r.on('error', mal)
      r.end(JSON.stringify(cuerpo))
    })
    const tiempos: number[] = []
    for (const c of mano.cartas.slice(0, VECES)) {
      const j = await enviar(`/api/mano/${c.id}`, { gesto: 'peso', peso: 7 })
      tiempos.push(j.ms)
      await enviar('/api/mano/deshacer', {})
    }
    if (tiempos.length) console.log(linea(['POST /api/mano/:id (jugar)', '200', mediana(tiempos).toFixed(1), Math.max(...tiempos).toFixed(1), '']))
    // La primera carga de la pantalla: index.html y todo lo que pide (JS y CSS), como viaja.
    const html = await new Promise<string>((ok) => http.get({ host: '127.0.0.1', port: PUERTO, path: '/' }, (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => ok(s)) }))
    const assets = [...html.matchAll(/(?:src|href)="(\/(?:js\/[^"]+|estilo\.css[^"]*))"/g)].map((m) => m[1])
    let total = (await pedir('/')).bytes
    let segunda = 0
    for (const a of assets) {
      const r = await pedir(a)
      total += r.bytes
      // La segunda carga: lo que se vuelve a bajar (con caché del navegador, lo inmutable no se pide; con ETag, 304).
      if (r.inmutable) continue
      if (r.etag) segunda += (await pedir(a, { 'if-none-match': r.etag })).bytes
      else segunda += r.bytes
    }
    const v = JSON.parse(await new Promise<string>((ok) => http.get({ host: '127.0.0.1', port: PUERTO, path: '/api/velocidad' }, (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => ok(s)) })))
    console.log(`\nPrimera carga: ${assets.length + 1} archivos, ${(total / 1024).toFixed(0)} KB · segunda: ${(segunda / 1024).toFixed(0)} KB`)
    console.log(`Event loop: p99 ${v.bucle.p99} ms · bloqueo más largo ${v.bucle.max} ms`)
  } finally {
    srv.kill()
  }
}

await main()
