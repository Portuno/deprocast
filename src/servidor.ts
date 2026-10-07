/**
 * La pantalla de juego. Servidor local sin dependencias: API JSON sobre la liga + estáticos de web/.
 * `npm run jugar` → http://127.0.0.1:7272
 * Todo vive en la base (data/mastro.db): cerrar el servidor no pierde nada.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { ATRIBUTO_MAX, ATRIBUTOS, CLASE_IDS, CLASES, PUNTOS_LIBRES } from './clases.ts'
import { abrir, ajuste, fechaLocal, fijarAjuste, type Db } from './db.ts'
import { armarJornada, leerJornada, marcarBloque, progreso, semana } from './jornada.ts'
import { aprender, archivar, corregir, estadoAprendizaje, fuentesParaAprender, memoriaVigente, recordar, revisar } from './memoria.ts'
import { actualizarRutina, correrRutinas, listarRutinas } from './rutinas.ts'
import { urlsCalendario } from './calendario.ts'
import { asientos, especializacion } from './auditor.ts'
import { leerTarea, publicar, tareas } from './bus.ts'
import { asegurarFuente, fuentes, leerPieza, listarPiezas, NIVELES, TIPOS } from './corpus.ts'
import { deshacer, descartar, ejecutar as ejecutarCarga, IMPORTADORES, leerCarga, listarCargas, reetiquetar, subir } from './cargas/index.ts'
import { contarEntidades, coocurrencias, entidadesPorId, leerEntidad, listarEntidades, resumenEntidades, TIPOS_ENTIDAD } from './entidades.ts'
import {
  archivarConversacion, conversacionHoy, crearConversacion, enviar, estadoEnVivo, estaPensando, leerConversacion, listarConversaciones, listarPropuestas, mensajes, resolverPropuesta,
} from './chat/index.ts'
import { celda, DOMINIOS } from './geometria72.ts'
import { crearProyecto, cronica, estadoLiga, ingerir, numeroDeTick, tickEnCurso, tickUnico } from './mastropiero.ts'
import { motoresDisponibles } from './motores.ts'
import { cadena, nanConfigurado, nanTranscribir, usoDelMes } from './nan.ts'
import {
  aceptarPropuesta, descartar as descartarQuantomo, leerQuantomo, linaje, listarQuantomos, pedirMejora, quantomosDePieza, resumenQuantomos, sellar,
} from './quantomos.ts'
import {
  alias, bautizar, cambiarEstado, DIAS_SIN_CORRER, forjar, lapidas, leer, listar, MOTOR_DEFECTO, nivel, retirar,
  PRUEBA_EXITOS, PRUEBA_FALLOS, RACHA_BANCA, type Ficha,
} from './roster.ts'
import { sembrarEjemplo } from './semilla.ts'
import { capa, CAPAS, NIVEL_BAUTISMO, NIVEL_MAX, umbral } from './xp.ts'

try {
  process.loadEnvFile()
} catch {
  // sin .env: valen las variables del entorno
}

// `--db ruta` para jugar otra partida sin tocar la principal.
const iDb = process.argv.indexOf('--db')
if (iDb > 0 && process.argv[iDb + 1]) process.env.MASTRO_DB = process.argv[iDb + 1]
// `--sin-rutinas` para levantar sin que Mastropiero haga cosas solo (pruebas, o hasta decidir).
if (process.argv.includes('--sin-rutinas')) process.env.MASTRO_SIN_RUTINAS = '1'

const WEB = path.resolve(import.meta.dirname, '..', 'web')
const PUERTO = Number(process.env.MASTRO_PUERTO ?? 7272)
const MAX_CARGA = 1024 * 1024 * 1024
const db = abrir()

function vista(db: Db, f: Ficha) {
  const n = nivel(f)
  const k = capa(n)
  return {
    ...f,
    nivel: n,
    xpPiso: umbral(n),
    xpTecho: n < NIVEL_MAX ? umbral(n + 1) : null,
    especializacion: especializacion(db, f.id),
    capa: k,
    celdaInfo: f.celda ? celda(f.celda) : null,
    puedeBautizar: !f.nombre && n >= NIVEL_BAUTISMO,
  }
}

function meta() {
  return {
    clases: CLASE_IDS.map((id) => {
      const c = CLASES[id]
      return { id, sigla: c.sigla, glifo: c.glifo, nombre: c.nombre, produce: c.produce, salida: c.salida, base: c.base, cadenaNan: cadena(id) }
    }),
    atributos: ATRIBUTOS,
    capas: CAPAS.map((k) => ({ ...k, xp: umbral(k.nivel) })),
    niveles: NIVELES,
    tipos: TIPOS,
    tiposEntidad: TIPOS_ENTIDAD,
    importadores: IMPORTADORES.map((i) => ({ id: i.id, nombre: i.nombre })),
    motores: motoresDisponibles(),
    motorDefecto: MOTOR_DEFECTO(),
    dominios72: DOMINIOS,
    reglas: { PUNTOS_LIBRES, ATRIBUTO_MAX, NIVEL_BAUTISMO, NIVEL_MAX, PRUEBA_EXITOS, PRUEBA_FALLOS, RACHA_BANCA, DIAS_SIN_CORRER },
  }
}

/** Lo que la pantalla refresca seguido. El corpus completo va paginado aparte. */
function estado() {
  return {
    liga: estadoLiga(db),
    roster: listar(db).map((f) => vista(db, f)),
    tareas: tareas(db, undefined, 120),
    fuentes: fuentes(db),
    quantomos: resumenQuantomos(db),
    entidades: resumenEntidades(db),
    cargas: listarCargas(db).slice(0, 20).map(({ analisis, ...c }) => ({ ...c, titulo: analisis?.titulo })),
    lapidas: lapidas(db),
    uso: usoDelMes(db),
    cronica: cronica(db),
    corriendo: tickEnCurso(),
    propuestasAbiertas: (db.prepare(`SELECT COUNT(*) AS n FROM propuestas WHERE estado = 'abierta'`).get() as { n: number }).n,
    hoy: {
      fecha: fechaLocal(), ...progreso(leerJornada(db, fechaLocal())), conversacion: conversacionHoy(db).id,
      // Lo último que Mastropiero dijo solo (rutinas): la pantalla avisa cuando aparece algo nuevo.
      aviso: db.prepare(`SELECT m.id, m.texto FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id WHERE c.modo = 'hoy' AND m.modelo = 'rutina' ORDER BY m.id DESC LIMIT 1`).get() ?? null,
    },
    aprendiendo: estadoAprendizaje(),
    memoriaSinRevisar: (db.prepare(`SELECT COUNT(*) AS n FROM memoria WHERE estado = 'vigente' AND revisada = 0`).get() as { n: number }).n,
    chatConModelo: nanConfigurado(),
    nTick: numeroDeTick(db),
  }
}

// ─── rutas ──────────────────────────────────────────────────────────────

type Q = URLSearchParams
type Ruta = (cuerpo: any, params: string[], q: Q) => unknown | Promise<unknown>
const num = (v: string | null) => (v ? Number(v) : undefined)
const id = (s: string) => Number(s)

const rutas: [string, RegExp, Ruta][] = [
  ['GET', /^\/api\/meta$/, () => meta()],
  ['GET', /^\/api\/estado$/, () => estado()],

  // Liga
  ['GET', /^\/api\/agentes\/([^/]+)$/, (_, [a]) => {
    const f = leer(db, decodeURIComponent(a))
    if (!f) throw new Error(`No existe ${a}`)
    return {
      ficha: vista(db, f),
      log: asientos(db, { agenteId: f.id, limite: 40 }),
      tareas: db.prepare('SELECT id, tipo, estado, error, actualizada_en FROM tareas WHERE asignada_a = ? ORDER BY id DESC LIMIT 20').all(f.id),
    }
  }],
  ['GET', /^\/api\/tareas\/(\d+)$/, (_, [t]) => leerTarea(db, id(t))],
  ['POST', /^\/api\/forja$/, (b) => vista(db, forjar(db, {
    clase: b.clase, motor: b.motor || undefined, instrucciones: b.instrucciones, reparto: b.reparto,
    proyectoId: b.proyectoId || null, celda: b.celda ? Number(b.celda) : null,
  }))],
  ['POST', /^\/api\/agentes\/([^/]+)\/bautizar$/, (b, [a]) => (bautizar(db, decodeURIComponent(a), String(b.nombre ?? '')), vista(db, leer(db, decodeURIComponent(a))!))],
  ['POST', /^\/api\/agentes\/([^/]+)\/estado$/, (b, [a]) => (cambiarEstado(db, decodeURIComponent(a), b.estado), vista(db, leer(db, decodeURIComponent(a))!))],
  ['POST', /^\/api\/proyectos$/, (b) => {
    const r = crearProyecto(db, String(b.nombre ?? ''))
    return { id: r.id, gerente: vista(db, r.gerente) }
  }],
  ['POST', /^\/api\/tareas$/, (b) => {
    const payload: Record<string, unknown> = { texto: String(b.texto ?? '') }
    if (b.url) payload.url = String(b.url)
    if (b.agenteId) payload.agenteId = String(b.agenteId)
    return publicar(db, {
      clase: b.clase, payload, publicadaPor: 'operador', proyectoId: b.proyectoId || null, dominio: b.dominio || null,
      corpusId: b.corpusId ? Number(b.corpusId) : null,
    })
  }],
  ['POST', /^\/api\/ejemplo$/, () => {
    if (listar(db).length || estadoLiga(db).proyectos.length) throw new Error('La liga ya tiene partida: el ejemplo es para arrancar de cero')
    return sembrarEjemplo(db)
  }],
  ['POST', /^\/api\/tick$/, async () => ({ eventos: await tickUnico(db), tick: numeroDeTick(db) })],
  ['POST', /^\/api\/agentes\/([^/]+)\/retirar$/, (b, [a]) => {
    const f = leer(db, decodeURIComponent(a))
    if (!f) throw new Error(`No existe ${a}`)
    retirar(db, f.id, String(b.causa || 'retirado por el operador'))
    return { retirado: alias(f) }
  }],

  // Chat
  ['GET', /^\/api\/chat$/, () => listarConversaciones(db).map((c) => {
    const f = c.con === 'mastropiero' ? null : leer(db, c.con)
    return { ...c, agente: f ? { id: f.id, nombre: f.nombre, clase: f.clase } : null, vivo: c.con === 'mastropiero' || !!f, pensando: estaPensando(c.id) }
  })],
  ['POST', /^\/api\/chat$/, (b) => crearConversacion(db, b.con || 'mastropiero', b.modo === 'diario' ? 'diario' : 'chat')],
  ['GET', /^\/api\/chat\/(\d+)$/, (_, [c], q) => {
    const conversacion = leerConversacion(db, id(c))
    if (!conversacion) throw new Error(`No existe la conversación ${c}`)
    return { conversacion, mensajes: mensajes(db, conversacion.id, num(q.get('desde')) ?? 0), pensando: estaPensando(conversacion.id), vivo: estadoEnVivo(conversacion.id) }
  }],
  ['POST', /^\/api\/chat\/(\d+)\/mensajes$/, (b, [c]) => {
    const cid = id(c)
    if (estaPensando(cid)) throw new Error('Esperá: todavía está contestando')
    if (!String(b.texto ?? '').trim()) throw new Error('Mensaje vacío')
    // El turno corre en segundo plano; la pantalla sigue el avance leyendo los mensajes.
    void enviar(db, cid, String(b.texto))
    return { ok: true }
  }],
  ['POST', /^\/api\/chat\/(\d+)\/archivar$/, (_, [c]) => (archivarConversacion(db, id(c)), { ok: true })],
  ['GET', /^\/api\/hoy$/, () => {
    const fecha = fechaLocal()
    const jornada = leerJornada(db, fecha)
    return {
      fecha, jornada, progreso: progreso(jornada), semana: semana(db, fecha), conversacion: conversacionHoy(db).id,
      rutinas: listarRutinas(db), calendarios: urlsCalendario().length,
      ajustes: { jornada_inicio: ajuste(db, 'jornada_inicio'), jornada_fin: ajuste(db, 'jornada_fin'), bloques_minutos: ajuste(db, 'bloques_minutos') },
    }
  }],
  ['POST', /^\/api\/jornada\/armar$/, async (b) => armarJornada(db, b.fecha || fechaLocal(), { desde: b.desde || undefined })],
  ['POST', /^\/api\/jornada\/(\d{4}-\d{2}-\d{2})\/bloques\/([^/]+)$/, (b, [f, bl]) => marcarBloque(db, f, decodeURIComponent(bl), b.estado)],
  ['POST', /^\/api\/ajustes$/, (b) => {
    for (const k of ['jornada_inicio', 'jornada_fin', 'bloques_minutos']) if (typeof b[k] === 'string' && b[k].trim()) fijarAjuste(db, k, b[k].trim())
    return { ok: true }
  }],
  ['POST', /^\/api\/rutinas\/([a-z]+)$/, (b, [r]) => (actualizarRutina(db, r, { hora: b.hora, dias: b.dias, activa: b.activa }), listarRutinas(db))],
  ['GET', /^\/api\/memoria$/, (_, __, q) => memoriaVigente(db, { tipo: q.get('tipo') || undefined, horizonte: q.get('horizonte') || undefined })],
  ['POST', /^\/api\/memoria$/, (b) => recordar(db, { texto: String(b.texto ?? ''), tipo: b.tipo, horizonte: b.horizonte || null, creadaPor: 'operador', revisada: true })],
  ['POST', /^\/api\/memoria\/(\d+)$/, (b, [m]) => corregir(db, id(m), { texto: b.texto, tipo: b.tipo, horizonte: b.horizonte }, 'operador')],
  ['POST', /^\/api\/memoria\/aprender$/, (b) => {
    const limite = Math.max(5, Math.min(Number(b.limite) || 40, 200))
    if (estadoAprendizaje() && !estadoAprendizaje()!.terminado) throw new Error('Ya estoy aprendiendo de lo cargado')
    const total = fuentesParaAprender(db, limite).length
    void aprender(db, limite).catch((e) => console.error('  aprender:', e))
    return { total }
  }],
  ['POST', /^\/api\/memoria\/(\d+)\/revisar$/, (_, [m]) => (revisar(db, id(m)), { ok: true })],
  ['POST', /^\/api\/memoria\/(\d+)\/archivar$/, (_, [m]) => (archivar(db, id(m)), { ok: true })],
  ['GET', /^\/api\/propuestas$/, () => listarPropuestas(db)],
  ['POST', /^\/api\/propuestas\/(\d+)$/, (b, [p]) => (resolverPropuesta(db, id(p), b.estado), { ok: true })],

  // Corpus
  ['GET', /^\/api\/fuentes$/, () => fuentes(db)],
  ['POST', /^\/api\/fuentes$/, (b) => asegurarFuente(db, { nombre: String(b.nombre ?? ''), nivel: b.nivel, descripcion: b.descripcion || null, padreId: b.padreId || null })],
  ['GET', /^\/api\/corpus$/, (_, __, q) => listarPiezas(db, {
    fuente: q.get('fuente') || undefined, nivel: q.get('nivel') || undefined, tipo: q.get('tipo') || undefined,
    estado: q.get('estado') || undefined, q: q.get('q') || undefined, cargaId: num(q.get('carga')), desde: num(q.get('desde')), limite: num(q.get('limite')),
  })],
  ['GET', /^\/api\/corpus\/(\d+)$/, (_, [p]) => {
    const pieza = leerPieza(db, id(p))
    if (!pieza) throw new Error(`No existe la pieza ${p}`)
    return { pieza, quantomos: quantomosDePieza(db, pieza.id), entidades: entidadesPorId(db, pieza.entidades) }
  }],
  ['POST', /^\/api\/ingerir$/, (b) => ingerir(db, {
    fuente: b.fuente || 'operador', nivel: b.nivel || undefined, tipo: b.tipo || undefined,
    titulo: String(b.titulo || String(b.contenido ?? '').slice(0, 60)), contenido: String(b.contenido ?? ''),
    autor: b.autor || null, fecha: b.fecha || null, url: b.url || null, proyectoId: b.proyectoId || null, dominio: b.dominio || null,
  })],
  ['GET', /^\/api\/entidades$/, (_, __, q) => {
    const f = { tipo: q.get('tipo') || undefined, q: q.get('q') || undefined }
    return { total: contarEntidades(db, f), entidades: listarEntidades(db, { ...f, limite: num(q.get('limite')), desde: num(q.get('desde')) }) }
  }],
  ['GET', /^\/api\/entidades\/(\d+)$/, (_, [e], q) => {
    const entidad = leerEntidad(db, id(e))
    if (!entidad) throw new Error(`No existe la entidad ${e}`)
    return { entidad, coocurrencias: coocurrencias(db, entidad.id, 16), ...listarPiezas(db, { entidad: entidad.id, limite: 30, desde: num(q.get('desde')) }) }
  }],

  // Cargas
  ['GET', /^\/api\/cargas$/, () => listarCargas(db)],
  ['GET', /^\/api\/cargas\/(\d+)$/, (_, [c]) => leerCarga(db, id(c))],
  ['POST', /^\/api\/cargas\/(\d+)\/ejecutar$/, (b, [c]) => ejecutarCarga(db, id(c), {
    segmentos: Array.isArray(b.segmentos) ? b.segmentos : undefined, fuenteId: b.fuenteId || undefined,
    pipeline: b.pipeline, nivel: b.nivel || undefined, umbralPeso: b.umbralPeso ? Number(b.umbralPeso) : undefined,
  })],
  ['POST', /^\/api\/cargas\/(\d+)\/deshacer$/, (_, [c]) => deshacer(db, id(c))],
  ['POST', /^\/api\/cargas\/(\d+)\/reetiquetar$/, (_, [c]) => reetiquetar(db, id(c))],
  ['POST', /^\/api\/cargas\/(\d+)\/descartar$/, (_, [c]) => (descartar(db, id(c)), { ok: true })],

  // Quántomos
  ['GET', /^\/api\/quantomos$/, (_, __, q) => listarQuantomos(db, {
    etapa: q.get('etapa') || undefined, q: q.get('q') || undefined, pesoMin: num(q.get('pesoMin')), desde: num(q.get('desde')), limite: num(q.get('limite')),
  })],
  ['GET', /^\/api\/quantomos\/(\d+)$/, (_, [k]) => {
    const quantomo = leerQuantomo(db, id(k))
    if (!quantomo) throw new Error(`No existe el quántomo ${k}`)
    return { quantomo, linaje: linaje(db, quantomo.id), pieza: quantomo.piezaId ? leerPieza(db, quantomo.piezaId) : null }
  }],
  ['POST', /^\/api\/quantomos\/(\d+)\/sellar$/, (b, [k]) => (sellar(db, id(k), Number(b.peso)), leerQuantomo(db, id(k)))],
  ['POST', /^\/api\/quantomos\/(\d+)\/aceptar$/, (b, [k]) => (aceptarPropuesta(db, id(k), b.peso ? Number(b.peso) : null), leerQuantomo(db, id(k)))],
  ['POST', /^\/api\/quantomos\/(\d+)\/descartar$/, (_, [k]) => (descartarQuantomo(db, id(k)), leerQuantomo(db, id(k)))],
  ['POST', /^\/api\/quantomos\/(\d+)\/mejora$/, (b, [k]) => pedirMejora(db, id(k), String(b.instruccion ?? ''))],
]

const TIPOS_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
}

function leerCrudo(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((ok, mal) => {
    let largo = 0
    const partes: Buffer[] = []
    req.on('data', (c: Buffer) => {
      largo += c.length
      if (largo > max) {
        mal(new Error(`Demasiado grande (máximo ${Math.round(max / 1024 / 1024)} MB)`))
        req.destroy()
      } else partes.push(c)
    })
    req.on('end', () => ok(Buffer.concat(partes)))
    req.on('error', mal)
  })
}

async function leerCuerpo(req: http.IncomingMessage): Promise<any> {
  const txt = (await leerCrudo(req, 16 * 1024 * 1024)).toString('utf8')
  try {
    return txt ? JSON.parse(txt) : {}
  } catch {
    throw new Error('JSON inválido')
  }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('content-type', 'application/json; charset=utf-8')
    try {
      // Un audio para el diario: se transcribe y entra como mensaje del operador.
      if (req.method === 'POST' && url.pathname === '/api/diario/audio') {
        const cid = Number(url.searchParams.get('conversacion'))
        const audio = await leerCrudo(req, 50 * 1024 * 1024)
        const texto = await nanTranscribir(db, audio, url.searchParams.get('nombre') || 'audio.m4a')
        if (!texto) throw new Error('El audio no tenía voz que transcribir')
        if (estaPensando(cid)) throw new Error('Esperá: todavía está contestando')
        void enviar(db, cid, texto)
        return void res.end(JSON.stringify({ texto }))
      }
      // La subida de una carga viaja cruda (el archivo tal cual), no como JSON.
      if (req.method === 'POST' && url.pathname === '/api/cargas') {
        const nombre = url.searchParams.get('nombre') || 'carga'
        const carga = subir(db, nombre, await leerCrudo(req, MAX_CARGA))
        return void res.end(JSON.stringify(carga))
      }
      const r = rutas.find(([m, re]) => m === req.method && re.test(url.pathname))
      if (!r) return void res.writeHead(404).end(JSON.stringify({ error: 'Ruta desconocida' }))
      const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : {}
      const params = url.pathname.match(r[1])!.slice(1)
      res.end(JSON.stringify((await r[2](cuerpo, params, url.searchParams)) ?? null))
    } catch (e) {
      if (!res.headersSent) res.writeHead(400)
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
    }
    return
  }
  const archivo = path.join(WEB, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname))
  if (!archivo.startsWith(WEB) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    return void res.writeHead(404).end('No encontrado')
  }
  res.writeHead(200, { 'content-type': TIPOS_MIME[path.extname(archivo)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  fs.createReadStream(archivo).pipe(res)
})

// Las rutinas: cada minuto se fija si toca algo (y al arrancar se pone al día).
let enRutinas = false
async function latido() {
  if (enRutinas || process.env.MASTRO_SIN_RUTINAS) return
  enRutinas = true
  try {
    for (const r of await correrRutinas(db)) console.log(`  ⏰ rutina ${r.id}: ${r.ok ? 'hecha' : 'falló'}${r.mensaje ? ` — ${r.mensaje.slice(0, 80)}` : ''}`)
  } catch (e) {
    console.error('  ⏰ rutinas:', e instanceof Error ? e.message : e)
  } finally {
    enRutinas = false
  }
}
setInterval(latido, 60_000).unref()
setTimeout(latido, 3_000).unref()

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(`\n  ☿ Mastropiero en http://127.0.0.1:${PUERTO}   (base: ${process.env.MASTRO_DB ?? 'data/mastro.db'} · motor de reclutas: ${MOTOR_DEFECTO()})\n`)
})
