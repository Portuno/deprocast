/**
 * npm run medir: la velocidad a la escala de la nube, con una base sintética (genérica: nada personal). Falla (código 1)
 * si algo traba el servidor más de 200 ms o si una ruta tarda más del doble que su línea de base (Fragua #213).
 * 1. Si no existe (o cambió su versión), arma data/medir.db: 30.000 piezas con entidades, 40.000 pasajes con vector,
 *    25.000 destilados, 15.000 quántomos con vector, 6.000 recuerdos con vector, 20.000 tareas de la liga, 1.800
 *    misiones, 20.000 mensajes en Hoy, 30.000 llamadas, 5.000 momentos del Directo y 3.000 líneas de crónica. Y lo del
 *    reproceso a la escala de la nube: 150.000 pasajes, 3.000 piezas grandes (30 KB) sin pasajes, destilados con su JSON
 *    entero (proyectos, ideas, lo abierto), 14.000 bucles con vector y lo ya visto marcado (el «no hay nada que hacer»).
 *    (--rehacer la vuelve a armar.)
 * 2. Los pasos de fondo que trabaron la nube, corridos acá sobre una copia con un vigía cada 10 ms: la deduplicación de
 *    recuerdos, el índice de pasajes (en frío, y después de borrar y reinsertar pasajes), el estado de la liga, lo lento,
 *    los créditos, los bloqueos → propuesta. MEDIR_TRABA=<parte del nombre de un paso> le mete un bucle síncrono de un
 *    segundo a ese paso (para probar que falla y lo nombra).
 * 3. Levanta el servidor sobre la base (sin rutinas ni Telegram, vigía a 200 ms), pasa una vez por cada ruta en frío y
 *    después las mide varias veces como la pantalla: tiempo, bytes y bloqueos (con lo que estaba corriendo).
 * 4. Compara con la línea de base (data/medir-base.json; --fijar-base la rehace) y deja la corrida con su fecha y su
 *    commit en data/medir-historial.jsonl, con lo que cambió desde la anterior.
 * Corre solo antes de cada push a main (.githooks/pre-push; MEDIR_SALTEAR=1 lo saltea).
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

const RAIZ = path.resolve(import.meta.dirname, '..')
const BASE = path.join(RAIZ, 'data', 'medir.db')
const COPIA = path.join(RAIZ, 'data', 'medir-pasos.db')
const LINEA_BASE = path.join(RAIZ, 'data', 'medir-base.json')
const HISTORIAL = path.join(RAIZ, 'data', 'medir-historial.jsonl')
const PUERTO = 7474
const VECES = 7
/** Cambia cuando la base sintética suma algo: se rearma sola. */
const VERSION_BASE = '3'
/** Más que esto seguido sin ceder el event loop es una traba. */
const TRABA_MS = 200

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
    for (let i = 0; i < 25000; i++) d.run(piezas[i], i % 10 ? 'hecho' : 'pendiente', JSON.stringify({ valor: i % 4, resumen: texto(200), tesis: texto(30), abierto: i % 7 ? [] : [texto(6)], temas: [texto(1), texto(1)], ideas: [{ texto: texto(20) }, { texto: texto(20) }], decisiones: [texto(12)], personas: [{ nombre: `Entidad ${i % 2000}`, rol: 'amigo' }], proyectos: [{ nombre: `Entidad ${(i % 600) * 3}`, estado_entonces: texto(15), ideas: [texto(10)] }], fecha: fecha(i % 400), titulo: `Pieza ${i}` }), ahora - i * 1000)
  })
  lote(() => {
    const q = db.prepare(`INSERT INTO quantomos (texto, etapa, origen_id, novedad, creado_en, actualizado_en) VALUES (?, ?, ?, 'nueva', ?, ?)`)
    const v = db.prepare(`INSERT INTO vec_items (tipo, id, modelo, vec, en) VALUES (?, ?, 'sint', ?, ?)`)
    for (let i = 0; i < 15000; i++) v.run('quantomo', Number(q.run(texto(12), i % 5 ? 'proto' : 'sellado', `q:${i}`, ahora, ahora).lastInsertRowid), vec(), ahora)
    const m = db.prepare(`INSERT INTO memoria (texto, tipo, fecha, estado, revisada, creada_por, creada_en) VALUES (?, 'hecho', ?, 'vigente', ?, 'escriba', ?)`)
    for (let i = 0; i < 6000; i++) v.run('memoria', Number(m.run(texto(10), fecha(azar(100)), i % 3 ? 1 : 0, ahora).lastInsertRowid), vec(), ahora)
  })
  lote(() => {
    // Lo del reproceso, a la escala de la nube: los pasajes hasta 150.000, piezas grandes sin pasajes, los bucles con
    // vector y lo ya visto marcado (lo que corre en cada vuelta aunque no haya nada nuevo).
    const p = db.prepare(`INSERT INTO pasajes (pieza_id, orden, desde, hasta, modelo, vec, en) VALUES (?, ?, 0, 1500, 'sint', ?, ?)`)
    for (let i = 0; i < 110000; i++) p.run(piezas[i % piezas.length], 2 + Math.floor(i / piezas.length), vec(), ahora)
    const c = db.prepare(`INSERT INTO corpus (fuente, nivel, titulo, contenido, estado, fecha, origen_id, entidades, meta, creado_en) VALUES ('operador', 'primaria', ?, ?, 'disponible', ?, ?, '[]', '{}', ?)`)
    for (let i = 0; i < 3000; i++) c.run(`Grande ${i}`, texto(4500), fecha(azar(400)), `grande:${i}`, ahora)
    const b = db.prepare(`INSERT INTO bucles (texto, clave, veces, primera, ultima, fuentes, vec, creado_en) VALUES (?, ?, 1, ?, ?, '[]', ?, ?)`)
    for (let i = 0; i < 14000; i++) b.run(texto(8), `bucle ${i}`, fecha(azar(300)), fecha(azar(30)), vec(), ahora)
    db.exec(`INSERT OR IGNORE INTO bucles_vistos (origen, bucle_id, en) SELECT 'abierto:' || pieza_id || ':0', NULL, ${ahora} FROM takeout_destilado WHERE estado = 'hecho'`)
    // Lo que miró (videos): con tarjetas ya hechas, como en la nube.
    db.exec(`UPDATE corpus SET fuente = 'youtube' WHERE id IN (SELECT pieza_id FROM takeout_destilado WHERE pieza_id % 9 = 0)`)
    db.exec(`INSERT OR IGNORE INTO tarjetas_piezas (pieza_id, tarjetas, en) SELECT pieza_id, 3, ${ahora} FROM takeout_destilado WHERE pieza_id % 9 = 0`)
  })
  lote(() => {
    // Las tareas de la liga (el bus): la mayoría hechas, algunas pendientes y fallidas, como en la nube.
    const t = db.prepare(`INSERT INTO tareas (tipo, clase, payload, estado, publicada_por, creada_en, actualizada_en) VALUES (?, ?, ?, ?, 'sint', ?, ?)`)
    for (let i = 0; i < 20000; i++) t.run(['clasificar', 'extraer', 'vectorizar', 'buscar'][i % 4], ['clasificador', 'extractor', 'vectorizador', 'buscador'][i % 4], JSON.stringify({ pieza: piezas[i % piezas.length] }), i % 10 === 0 ? 'pendiente' : i % 23 === 0 ? 'fallida' : 'hecha', ahora - (i % 30) * DIA, ahora - (i % 30) * DIA)
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
  db.prepare(`INSERT OR REPLACE INTO ajustes (clave, valor) VALUES ('medir_base_version', ?)`).run(VERSION_BASE)
  db.close()
  console.log(`Lista: ${(fs.statSync(BASE).size / 1024 / 1024).toFixed(0)} MB`)
}

async function versionDeBase(): Promise<string | null> {
  if (!fs.existsSync(BASE)) return null
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(BASE, { readOnly: true })
  try { return (db.prepare(`SELECT valor FROM ajustes WHERE clave = 'medir_base_version'`).get() as { valor: string } | undefined)?.valor ?? null } catch { return null } finally { db.close() }
}

type Paso = { paso: string; ms: number; traba: number }

/** Lee un archivo entero (a la memoria del sistema), para que la medición no sea la del disco frío de esta compu. */
function leerEntera(archivo: string) {
  const fd = fs.openSync(archivo, 'r')
  const buf = Buffer.alloc(8 * 1024 * 1024)
  while (fs.readSync(fd, buf, 0, buf.length, null) > 0) { /* leer */ }
  fs.closeSync(fd)
}

/**
 * Los pasos de fondo, en este proceso y sobre una copia: un vigía cada 10 ms mide el tramo más largo sin ceder.
 */
async function medirPasos(): Promise<Paso[]> {
  for (const f of [COPIA, `${COPIA}-wal`, `${COPIA}-shm`]) fs.rmSync(f, { force: true })
  fs.copyFileSync(BASE, COPIA)
  const { abrir } = await import('../src/db.ts')
  const db = abrir(COPIA)
  // Después de copiar 1 GB, leerla una vez de punta a punta: así lo que se mide es el trabajo de cada paso y no la copia
  // (el disco todavía escribiendo, el antivirus revisando el archivo nuevo). Leer 300 MB de vectores sigue costando lo
  // mismo desde la memoria del sistema: lo que lee de más, se ve igual.
  leerEntera(COPIA)
  await new Promise((ok) => setTimeout(ok, 500))
  const sem = await import('../src/semantica.ts')
  // Sin NaN: un vector al azar por consulta (lo que se mide es el índice, no el modelo).
  sem._probarEmbed(async (_db, textos) => ({ vectores: textos.map(() => Array.from({ length: 1024 }, () => Math.random() - 0.5)), modelo: 'sint' }))
  const { deduplicarMemoria } = await import('../src/memoria.ts')
  const { estadoLiga } = await import('../src/mastropiero.ts')
  const { lento, propuestaPorBloqueos, anotarBloqueo } = await import('../src/autocritica.ts')
  const { creditosPorUso } = await import('../src/nan.ts')
  const traba = process.env.MEDIR_TRABA?.trim().toLowerCase()
  const pasos: Paso[] = []
  const medir = async (paso: string, f: () => unknown) => {
    let ultimo = performance.now()
    let peor = 0
    const vigia = setInterval(() => { const t = performance.now(); peor = Math.max(peor, t - ultimo - 10); ultimo = t }, 10)
    await new Promise((ok) => setTimeout(ok, 20))
    ultimo = performance.now()
    const t0 = performance.now()
    await f()
    if (traba && paso.toLowerCase().includes(traba)) { const fin = performance.now() + 1000; while (performance.now() < fin) { /* a propósito */ } }
    await new Promise((ok) => setTimeout(ok, 20)) // que el vigía vea lo último
    clearInterval(vigia)
    pasos.push({ paso, ms: performance.now() - t0, traba: Math.max(0, peor) })
  }
  const recuerdos = (db.prepare(`SELECT COUNT(*) AS n FROM memoria WHERE estado = 'vigente'`).get() as { n: number }).n
  await medir(`memoria: deduplicar (${recuerdos} recuerdos)`, () => deduplicarMemoria(db, 0.75, 0.93, { forzar: true }))
  await medir('pasajes: índice en frío y una búsqueda', () => sem.cercanas(db, 'una consulta cualquiera', 10))
  // Lo que pasa cuando una pieza cambia: se borran sus pasajes y entran otros (el índice se pone al día sin recargar).
  const ids = (db.prepare('SELECT id, pieza_id, vec FROM pasajes ORDER BY random() LIMIT 3000').all() as { id: number; pieza_id: number; vec: Uint8Array }[])
  db.exec('BEGIN')
  const borrar = db.prepare('DELETE FROM pasajes WHERE id = ?')
  const meter = db.prepare(`INSERT INTO pasajes (pieza_id, orden, desde, hasta, modelo, vec, en) VALUES (?, 99, 0, 1500, 'sint', ?, ?)`)
  for (const r of ids) { borrar.run(r.id); meter.run(r.pieza_id, r.vec, Date.now()) }
  db.exec('COMMIT')
  await medir('pasajes: índice tras borrar y reinsertar 3000', () => sem.cercanas(db, 'otra consulta', 10))
  await medir('liga: estado (tareas, agentes, corpus)', () => estadoLiga(db))
  const { personas } = await import('../src/personas.ts')
  await medir('personas: la lista (la piden Personas y las preguntas)', () => personas(db, { limite: 40 }))
  await medir('autocrítica: lo lento', () => lento(db))
  await medir('créditos: por uso del mes', () => creditosPorUso(db, Date.now(), 1000))
  for (let i = 0; i < 6; i++) anotarBloqueo(db, 2500, ['paso sint'], Date.now() - i * 60_000)
  await medir('bloqueos → propuesta', () => propuestaPorBloqueos(db))

  // El reproceso (lo que trababa la nube cada pocos segundos): cada paso de una vuelta, también cuando no hay nada.
  const rep = await import('../src/reproceso.ts')
  const nube = await import('../src/takeout/nube.ts')
  const { juntarBucles } = await import('../src/bucles.ts')
  const { tarjetasDeLoConsumido } = await import('../src/consumido.ts')
  const { marcarNovedad } = await import('../src/quantomos.ts')
  nube._probarTakeout({ destilar: async () => ({ valor: 2, resumen: 'Un resumen sintético.', tesis: 'Una tesis.', temas: ['proyecto', 'taller'], ideas: [{ texto: 'una idea sintética para probar' }], decisiones: ['seguir'], abierto: ['algo que quedó abierto para probar'], personas: [{ nombre: 'Entidad 1', rol: 'amigo' }], proyectos: [{ nombre: 'Entidad 3', estado_entonces: 'arrancando', ideas: ['probar'] }], lugares: [], eventos: [], relaciones: [], sobre_el: [] }) })
  nube._probarHistoria(async () => ({ eras: [{ desde: '2026-01', hasta: '2026-06', nombre: 'Arranque', como_era: 'Sintético.' }], hoy: null, cambios: null, ideas_para_revisar: [], pregunta: '¿En qué está hoy?' }))
  await medir('reproceso: al empezar (pasajes huérfanos)', () => rep.alEmpezarReproceso(db))
  await medir('reproceso: encolar lo que falta destilar', () => rep.encolarDeAPoco(db))
  await medir('reproceso: bucles (sin nada nuevo)', () => juntarBucles(db, { limite: 40 }))
  await medir('reproceso: tarjetas (sin nada nuevo)', () => tarjetasDeLoConsumido(db))
  await medir('reproceso: lo importado pendiente', () => nube.importadoPendiente(db))
  await medir('reproceso: piezas sin pasajes', () => rep.sinPasajes(db, 8))
  const ocho = await rep.sinPasajes(db, 8)
  await medir('reproceso: pasajes de 8 piezas grandes', () => sem.pasajesDe(db, ocho))
  await medir('reproceso: el próximo destilado', () => rep.siguienteDestilado(db))
  const sig = rep.siguienteDestilado(db)
  if (sig) await medir('reproceso: destilar una unidad (sin modelo)', () => nube.destilarUnidad(db, sig, Date.now()))
  await medir('reproceso: recuerdos y quántomos (novedad)', () => marcarNovedad(db))
  const proyectos = await nube.proyectosConHistoria(db, nube.REPROCESO)
  await medir('reproceso: proyectos con historia', () => nube.proyectosConHistoria(db, nube.REPROCESO))
  if (proyectos[0]) await medir('reproceso: historia de un proyecto (sin modelo)', () => nube.historiaDe(db, nube.REPROCESO, proyectos[0], false, Date.now()))
  await medir('reproceso: estado (la pantalla)', async () => { await rep.contarDeAPoco(db, 0); rep.estadoReproceso(db) })
  db.close()
  for (const f of [COPIA, `${COPIA}-wal`, `${COPIA}-shm`]) fs.rmSync(f, { force: true })
  return pasos
}

const commitActual = () => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }

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
  if (process.argv.includes('--rehacer') || (await versionDeBase()) !== VERSION_BASE) await armarBase()
  const fallas: string[] = []

  // 1. Los pasos de fondo.
  console.log('\nPasos de fondo (vigía cada 10 ms)')
  const pasos = await medirPasos()
  for (const p of pasos) {
    console.log(`  ${p.paso.padEnd(48)} ${p.ms.toFixed(0).padStart(7)} ms   traba máx ${p.traba.toFixed(0).padStart(5)} ms${p.traba > TRABA_MS ? '  ✖' : ''}`)
    if (p.traba > TRABA_MS) fallas.push(`el paso «${p.paso}» trabó el event loop ${p.traba.toFixed(0)} ms seguidos (tope ${TRABA_MS})`)
  }

  // 2. El servidor (sobre la base, leída entera antes por lo mismo: copiar 1 GB la sacó de la memoria del sistema).
  leerEntera(BASE)
  const srv = spawn(process.execPath, [...(process.env.MEDIR_GC ? ['--trace-gc'] : []), ...(process.env.MEDIR_PERFIL ? ['--cpu-prof', `--cpu-prof-dir=${process.env.MEDIR_PERFIL}`] : []), '--disable-warning=ExperimentalWarning', 'src/servidor.ts', '--db', BASE, '--puerto', String(PUERTO), '--sin-rutinas', '--sin-telegram'], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MASTRO_REPROCESO_LOCAL: '', NAN_API_KEY: '', GOOGLE_CUENTA_SERVICIO: '', GCAL_ICS_URLS: '', MASTRO_BLOQUEO_MS: String(TRABA_MS) } })
  let log = ''
  srv.stdout.on('data', (d) => (log += d))
  srv.stderr.on('data', (d) => (log += d))
  const rutasMed: Record<string, number> = {}
  const leerJson = (ruta: string) => new Promise<any>((ok) => http.get({ host: '127.0.0.1', port: PUERTO, path: ruta }, (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => { try { ok(JSON.parse(s || '{}')) } catch { ok({}) } }) }))
  try {
    for (let i = 0; ; i++) {
      try { await pedir('/version'); break } catch { if (i > 100) throw new Error(`El servidor no arrancó:\n${log}`); await new Promise((r) => setTimeout(r, 200)) }
    }
    const rutas = ['/api/estado', '/api/hoy', '/api/hoy/hud', '/api/chat/1', '/api/reproceso', '/api/takeout', '/api/misiones', '/api/bandeja', '/api/personas', '/api/yo', '/api/preguntas/siguiente', '/api/entidades', '/api/memoria', '/api/encargos', '/api/mano', '/api/academia', '/api/taller', '/api/fragua', '/api/revision', '/api/grafos', '/api/agentes/misiones']
    const enviar = (ruta: string, cuerpo: unknown) => new Promise<{ ms: number; json: any }>((ok, mal) => {
      const t0 = performance.now()
      const r = http.request({ host: '127.0.0.1', port: PUERTO, path: ruta, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => ok({ ms: performance.now() - t0, json: JSON.parse(s || '{}') })) })
      r.on('error', mal)
      r.end(JSON.stringify(cuerpo))
    })
    // Una pasada en frío (compilar, calentar cachés): lo que traba acá se cuenta aparte, no hace fallar.
    for (const r of rutas) await pedir(r)
    const carta = (await leerJson('/api/mano')).cartas?.[0]
    if (carta) { await enviar(`/api/mano/${carta.id}`, { gesto: 'peso', peso: 7 }); await enviar('/api/mano/deshacer', {}) }
    // La pantalla también se sirve en frío una vez (comprimir index y scripts la primera vez es trabajo de una sola vez).
    const html0 = await new Promise<string>((ok) => http.get({ host: '127.0.0.1', port: PUERTO, path: '/', headers: { 'accept-encoding': 'identity' } }, (r) => { let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => ok(s)) }))
    await pedir('/')
    for (const a of [...html0.matchAll(/(?:src|href)="(\/(?:js\/[^"]+|estilo\.css[^"]*))"/g)].map((m) => m[1])) await pedir(a)
    await new Promise((r) => setTimeout(r, 700))
    const enFrio = ((await leerJson('/version?todos')).bloqueos ?? []) as { en: string; ms: number; durante: string[] }[]
    const desde = Date.now()
    await pedir('/api/velocidad/reiniciar')
    const ancho = [34, 6, 9, 9, 9]
    const linea = (xs: string[]) => xs.map((x, i) => (i ? x.padStart(ancho[i]) : x.padEnd(ancho[i]))).join(' ')
    console.log(`\n${linea(['ruta', 'status', 'ms (med)', 'ms (máx)', 'KB'])}\n${'-'.repeat(70)}`)
    for (const r of rutas) {
      const xs: { ms: number; bytes: number; status: number }[] = [await pedir(r)]
      // Lo que tarda más de 2 s se mide una sola vez (si no, la medición misma traba todo).
      if (xs[0].ms < 2000) for (let i = 1; i < VECES; i++) xs.push(await pedir(r))
      rutasMed[r] = mediana(xs.map((x) => x.ms))
      console.log(linea([r, xs[0].status ? String(xs[0].status) : 'tope', rutasMed[r].toFixed(1), Math.max(...xs.map((x) => x.ms)).toFixed(1), (xs[0].bytes / 1024).toFixed(1)]))
      if (!xs[0].status) { fallas.push(`${r} no contestó en ${TOPE_MS / 1000} s: el servidor quedó trabado`); break }
    }
    // Jugar una carta de La Mano (POST): lo que tarda en volver con lo que conecta; después se deshace.
    const mano = await leerJson('/api/mano')
    const tiempos: number[] = []
    for (const c of (mano.cartas ?? []).slice(0, VECES)) {
      const j = await enviar(`/api/mano/${c.id}`, { gesto: 'peso', peso: 7 })
      tiempos.push(j.ms)
      await enviar('/api/mano/deshacer', {})
    }
    if (tiempos.length) { rutasMed['POST /api/mano/:id'] = mediana(tiempos); console.log(linea(['POST /api/mano/:id (jugar)', '200', mediana(tiempos).toFixed(1), Math.max(...tiempos).toFixed(1), ''])) }
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
    const v = await leerJson('/api/velocidad')
    console.log(`\nPrimera carga: ${assets.length + 1} archivos, ${(total / 1024).toFixed(0)} KB · segunda: ${(segunda / 1024).toFixed(0)} KB`)
    console.log(`Event loop: p99 ${v.bucle?.p99} ms · bloqueo más largo ${v.bucle?.max} ms`)
    await new Promise((r) => setTimeout(r, 700))
    const bloqueos = (((await leerJson('/version?todos')).bloqueos ?? []) as { en: string; ms: number; durante: string[] }[]).filter((b) => Date.parse(b.en) >= desde)
    const frios = enFrio.filter((b) => Date.parse(b.en) < desde)
    if (frios.length) console.log(`En frío (no cuenta): ${frios.map((b) => `${b.ms} ms durante ${b.durante.join(', ') || '?'}`).join(' · ')}`)
    for (const b of bloqueos) fallas.push(`el servidor se trabó ${b.ms} ms durante ${b.durante.join(', ') || 'algo sin nombre'}`)
  } finally {
    srv.kill()
    if (process.env.MEDIR_GC) console.log(log.split('\n').filter((l) => /Mark-Compact|Scavenge/.test(l) && Number(/([\d.]+) \/ [\d.]+ ms/.exec(l)?.[1] ?? 0) > 50).join('\n'))
  }

  // 3. Contra la línea de base: más del doble (y al menos 50 ms más: lo de pocos ms es ruido) es una falla.
  // La línea de base es de una versión de la base sintética: si la base cambió (creció), se rehace.
  const guardada: Record<string, number> & { _version?: string } = (() => { try { return JSON.parse(fs.readFileSync(LINEA_BASE, 'utf8')) } catch { return {} } })()
  const otraBase = guardada._version !== VERSION_BASE
  const { _version: _, ...base } = otraBase ? ({} as typeof guardada) : guardada
  const fijar = process.argv.includes('--fijar-base') || otraBase
  for (const [r, ms] of Object.entries(rutasMed)) {
    const b = base[r]
    if (b != null && !fijar && ms > 2 * b && ms - b > 50) fallas.push(`${r} tardó ${ms.toFixed(0)} ms: más del doble de su línea de base (${b.toFixed(0)} ms)`)
  }
  if (fijar || !Object.keys(base).length || Object.keys(rutasMed).some((r) => base[r] == null)) {
    const nueva = fijar ? rutasMed : { ...rutasMed, ...base }
    fs.writeFileSync(LINEA_BASE, JSON.stringify({ _version: VERSION_BASE, ...nueva }, null, 2))
    console.log(otraBase ? '\nLínea de base nueva (cambió la base sintética).' : fijar ? '\nLínea de base fijada con esta corrida.' : '\nLínea de base: sumé las rutas que no tenía.')
  }

  // 4. El historial: con fecha y commit, y lo que cambió desde la corrida anterior.
  const corrida = { fecha: new Date().toISOString(), commit: commitActual(), rutas: rutasMed, pasos: Object.fromEntries(pasos.map((p) => [p.paso, { ms: Math.round(p.ms), traba: Math.round(p.traba) }])), fallas }
  const previa = (() => { try { const ls = fs.readFileSync(HISTORIAL, 'utf8').trim().split('\n'); return JSON.parse(ls.at(-1)!) as typeof corrida } catch { return null } })()
  fs.appendFileSync(HISTORIAL, `${JSON.stringify(corrida)}\n`)
  if (previa) {
    const cambios = [
      ...Object.entries(rutasMed).filter(([r, ms]) => previa.rutas[r] != null && Math.abs(ms - previa.rutas[r]) > Math.max(5, previa.rutas[r] * 0.3)).map(([r, ms]) => `${r} ${previa.rutas[r].toFixed(0)} → ${ms.toFixed(0)} ms`),
      ...pasos.filter((p) => previa.pasos[p.paso] && Math.abs(p.traba - previa.pasos[p.paso].traba) > 30).map((p) => `${p.paso}: traba ${previa.pasos[p.paso].traba} → ${p.traba.toFixed(0)} ms`),
    ]
    console.log(`\nDesde la corrida anterior (${previa.fecha.slice(0, 16).replace('T', ' ')}${previa.commit ? `, ${previa.commit}` : ''} → ${corrida.commit ?? 'sin commit'}): ${cambios.length ? `\n  ${cambios.join('\n  ')}` : 'nada cambió de forma notable.'}`)
  }

  if (fallas.length) {
    console.error(`\n✖ medir falló:\n  - ${fallas.join('\n  - ')}`)
    process.exitCode = 1
  } else console.log('\n✔ Nada traba más de 200 ms y ninguna ruta pasó el doble de su línea de base.')
}

await main()
