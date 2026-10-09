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
import { leerJornada, progreso, semana } from './jornada.ts'
import {
  actualizarMision, anotarSideQuest, arrancarRun, asignarMision, borrarPlantilla, cerrarRun, conAvance, crearMision, descartarRun, enCurso, guardarPlantilla,
  latidoRuns, leerRun, listarMisiones, listarPlantillas, listarReportes, listarRuns, marcarSecundaria, misionesDeRun, principalDe, procesarJugador,
  proponerPrimarias, rehacerRun, reporteSemana, runActual, semanaDe, semanaVecina, seguimientos, prepararRun, diasDeSemana, asegurarPrincipal, pasoDeRun,
} from './misiones.ts'
import { catalogo } from './menciones.ts'
import { pensar } from './alertas.ts'
import { autorizado, cookieDeEntrada, expuesto, host, leerFormulario, PAGINA_ENTRAR, validarAcceso } from './acceso.ts'
import { CONECTORES, guardarCuenta, listarCuentas, listarPublicaciones, MODOS, publicarPendientes, redactarPublicaciones, resolverPublicacion } from './cuentas.ts'
import { decir as decirPorTelegram, escucharTelegram, estadoTelegram, latidoTelegram, telegramConfigurado } from './telegram.ts'
import { artefactoAlCorpus, carpeta as carpetaTaller, crearImagen, crearJuego, crearPersonaje, crearVideo, crearVoz, dirTaller, hayFfmpeg, iterarArtefacto, listarArtefactos, VOCES } from './taller.ts'
import { guardarRelacion, personas } from './personas.ts'
import { cambiarEntrada, disparadorDe, escribir, leerBitacora } from './bitacora.ts'
import { cribar, deshacerUltima, marcador, siguiente } from './criba.ts'
import { tabla as tablaEconomia, TARIFAS } from './economia.ts'
import { exportarEstado, importarEstado } from './exportacion.ts'
import { encolar as encolarTanda, listarTandas, procesarTandas, reintentar as reintentarTanda, retomarTandas } from './tandas.ts'
import { brujulaDelDia, leerBrujula } from './brujula.ts'
import { perfilDeRendimiento, textoDeRendimiento } from './rendimiento.ts'
import { listarRecomendaciones, recomendar, resolverRecomendacion } from './mentor.ts'
import { listarPuentes, proponerPuentes, resolverPuente } from './puentes.ts'
import { aCsv, agregarObra, conteos as conteosLibreria, editarObra, listarObras, poblando, poblarLibreria } from './libreria.ts'
import { aplicarForja, descartarForja, forjarMejora, leerForja, listarForjas } from './fragua.ts'
import { borrarCuaderno, charla, componentesDeEntidad, crearCuaderno, guia, haciendo, leerCuaderno, listarCuadernos, notas, preguntar, quitarFuente, sumarFuentes } from './cuadernos.ts'
import { buscarHibrido, estadoVectores, nivelesDe, vectorizarPendientes } from './semantica.ts'
import { editarMovimiento, importarCSV, listarMovimientos, registrarMovimiento, resumenMes } from './finanzas.ts'
import { buscarOportunidades, listarOportunidades, marcarOportunidad, redactarOportunidad } from './radar.ts'
import { cuotas, hayBuscadorWeb } from './web.ts'
import { anotarPrediccion, calificarAMano, calificarDia, curva, paraElJugador, predecirDia, prediccionesDe, sumarPredicciones, textoDeCalificacion } from './gemelo.ts'
import { cerrarDirecto, iniciarDirecto, latidoDirecto, leerSesion, listarSesiones, momentos as momentosDirecto, registrarAudio, registrarCuadro, sesionActiva } from './directo.ts'
import { encolarPregunta, generandoPreguntas, generarPreguntas, listarPreguntas, reponerPreguntas, responderPregunta, siguientePregunta } from './preguntas.ts'
import { aportes, ayudantesDe, pedirAportes, quitarAyudante, sumarAyudante } from './ayudantes.ts'
import { agregarItem, editarItem, escribirHistoria, inventarioDe, inventarioDerivado, leerHistoria, marcarJugador, personaje, resolverHistoria, TIPOS_INVENTARIO } from './personajes.ts'
import { aprender, archivar, corregir, estadoAprendizaje, fuentesParaAprender, memoriaVigente, recordar, revisar } from './memoria.ts'
import { actualizarRutina, correrRutinas, listarRutinas } from './rutinas.ts'
import { urlsCalendario } from './calendario.ts'
import { asientos, especializacion } from './auditor.ts'
import { enEspera, leerTarea, pausarIngesta, publicar, reanudarIngesta, tareas } from './bus.ts'
import { asegurarFuente, fuentes, leerPieza, listarPiezas, NIVELES, TIPOS } from './corpus.ts'
import { deshacer, descartar, ejecutar as ejecutarCarga, IMPORTADORES, leerCarga, listarCargas, reetiquetar, subir } from './cargas/index.ts'
import { contarEntidades, coocurrencias, duplicadosProbables, editarEntidad, entidadesPorId, fusionarEntidades, noSonLoMismo, quitarAliasCruzados, leerEntidad, listarEntidades, resumenEntidades, TIPOS_ENTIDAD } from './entidades.ts'
import {
  alDecirSolo, archivarConversacion, conversacionHoy, crearConversacion, enviar, estadoEnVivo, estaPensando, leerConversacion, listarConversaciones, listarPropuestas, mensajeDeMastropiero, mensajes, resolverPropuesta,
} from './chat/index.ts'
import { celda, DOMINIOS } from './geometria72.ts'
import { crearProyecto, cronica, estadoLiga, ingerir, numeroDeTick, tickEnCurso, tickUnico } from './mastropiero.ts'
import { motoresDisponibles } from './motores.ts'
import { cadena, nanConfigurado, nanTranscribir, tokensHoy, topeAlcanzado, topeDiario, usoDelMes } from './nan.ts'
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
// `--puerto n` para levantar otra al lado (pruebas sobre una copia).
const iPuerto = process.argv.indexOf('--puerto')
if (iPuerto > 0 && process.argv[iPuerto + 1]) process.env.MASTRO_PUERTO = process.argv[iPuerto + 1]
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
    gasto: { ...tokensHoy(db), tope: topeDiario(db) },
    enEspera: enEspera(db),
    cronica: cronica(db),
    corriendo: tickEnCurso(),
    propuestasAbiertas: (db.prepare(`SELECT COUNT(*) AS n FROM propuestas WHERE estado = 'abierta'`).get() as { n: number }).n,
    hoy: {
      fecha: fechaLocal(), ...progreso(db, fechaLocal()), conversacion: conversacionHoy(db).id,
      pregunta: siguientePregunta(db)?.id ?? null,
      directo: (() => { const s = sesionActiva(db); return s ? { id: s.id, inicio: s.inicio, momentos: (db.prepare('SELECT COUNT(*) AS n FROM directo_momentos WHERE sesion_id = ?').get(s.id) as { n: number }).n } : null })(),
      run: (() => { const r = runActual(db); return r ? { id: r.id, estado: r.estado, marcadas: misionesDeRun(db, r.id).filter((m) => m.estado !== 'activa').length } : null })(),
      // Lo último que Mastropiero dijo solo (rutinas): la pantalla avisa cuando aparece algo nuevo.
      aviso: db.prepare(`SELECT m.id, m.texto FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id WHERE c.modo = 'hoy' AND m.modelo = 'rutina' ORDER BY m.id DESC LIMIT 1`).get() ?? null,
    },
    aprendiendo: estadoAprendizaje(),
    memoriaSinRevisar: (db.prepare(`SELECT COUNT(*) AS n FROM memoria WHERE estado = 'vigente' AND revisada = 0`).get() as { n: number }).n,
    chatConModelo: nanConfigurado(),
    nTick: numeroDeTick(db),
  }
}

// ─── personajes ─────────────────────────────────────────────────────────

function nombreDe(clave: string) {
  try {
    return personaje(db, clave).nombre
  } catch {
    return clave
  }
}

/** La ficha completa de un personaje para la pantalla. */
function fichaDe(clave: string) {
  const p = personaje(db, clave)
  asegurarPrincipal(db, p.clave)
  const misiones = listarMisiones(db, { personaje: p.clave, limite: 200 }).filter((m) => m.estado !== 'descartada' && (m.nivel !== 'secundaria' || m.estado === 'activa'))
  return {
    personaje: p, historia: leerHistoria(db, p.clave), inventario: inventarioDe(db, p.clave, { conSugeridos: true }), derivado: inventarioDerivado(db, p.clave),
    tiposInventario: TIPOS_INVENTARIO, principal: principalDe(db, p.clave),
    misiones: conAvance(db, misiones.filter((m) => m.nivel !== 'principal' || m.estado === 'sugerida')).slice(0, 60),
    encargos: p.tipo === 'agente' ? db.prepare('SELECT id, tipo, estado, payload, actualizada_en FROM tareas WHERE asignada_a = ? ORDER BY id DESC LIMIT 15').all(p.clave.slice(7)) : [],
    asignadasPorEl: listarMisiones(db, { asignadaPor: p.clave, excluirPersonaje: p.clave, abiertas: true, limite: 20 }).map((m) => ({ ...m, quien: nombreDe(m.personaje) })),
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
    proyectoId: b.proyectoId || null, celda: b.celda ? Number(b.celda) : null, misionPrincipal: b.misionPrincipal || null,
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
  ['POST', /^\/api\/ingesta\/pausar$/, () => ({ enEspera: pausarIngesta(db) })],
  ['POST', /^\/api\/ingesta\/reanudar$/, (b) => ({ reanudados: reanudarIngesta(db, { limite: Math.min(Number(b.limite) || 20, 2000), soloPropias: !!b.soloPropias }), enEspera: enEspera(db) })],
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
    const run = runActual(db)
    const vivo = enCurso(db)
    return {
      fecha, jornada: leerJornada(db, fecha), progreso: progreso(db, fecha), semana: semana(db, fecha), conversacion: conversacionHoy(db).id,
      rutinas: listarRutinas(db), calendarios: urlsCalendario().length, plantillas: listarPlantillas(db),
      run: run ? { ...run, misiones: misionesDeRun(db, run.id) } : null,
      actual: vivo?.actual?.id ?? null,
      primarias: conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(), estados: ['activa', 'hecha', 'parcial', 'sugerida'] })),
      principal: principalDe(db, 'jugador'),
      terciarias: listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria', abiertas: true }),
      seguimientos: seguimientos(db).map((m) => ({ ...m, quien: nombreDe(m.personaje) })),
      reporte: listarReportes(db, { limite: 1 })[0] ?? null,
      aportes: aportes(db, { desde: Date.now() - 2 * 86_400_000, limite: 4 }),
      proximas: listarRuns(db, { desde: fechaLocal(Date.now() + 86_400_000), estados: ['propuesta'] }).map((r) => ({ ...r, misiones: misionesDeRun(db, r.id) })),
      brujula: leerBrujula(db, fecha),
      ajustes: { primarias_semana: ajuste(db, 'primarias_semana'), tokens_dia_max: ajuste(db, 'tokens_dia_max'), pensar_cada_horas: ajuste(db, 'pensar_cada_horas'), meta_ingresos_mes: ajuste(db, 'meta_ingresos_mes') },
    }
  }],
  ['POST', /^\/api\/ajustes$/, (b) => {
    for (const k of ['primarias_semana', 'tokens_dia_max', 'pensar_cada_horas']) if (b[k] != null && String(b[k]).trim()) fijarAjuste(db, k, String(b[k]).trim())
    if (b.meta_ingresos_mes != null) fijarAjuste(db, 'meta_ingresos_mes', String(b.meta_ingresos_mes).trim())
    return { ok: true }
  }],

  // Runs
  ['GET', /^\/api\/runs$/, (_, __, q) => listarRuns(db, { desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined, limite: num(q.get('limite')) })],
  ['GET', /^\/api\/runs\/(\d+)$/, (_, [r]) => {
    const run = leerRun(db, id(r))
    if (!run) throw new Error(`No existe la run ${r}`)
    return { ...run, misiones: misionesDeRun(db, run.id), reportes: listarReportes(db, { runId: run.id }) }
  }],
  ['GET', /^\/api\/runs\/preparando$/, () => pasoDeRun()],
  ['POST', /^\/api\/runs\/preparar$/, async (b) => prepararRun(db, b.pedido ?? b)],
  ['POST', /^\/api\/runs\/(\d+)\/rehacer$/, async (b, [r]) => rehacerRun(db, id(r), String(b.cambio ?? '') || null)],
  ['POST', /^\/api\/runs\/(\d+)\/arrancar$/, (_, [r]) => arrancarRun(db, id(r))],
  ['POST', /^\/api\/runs\/(\d+)\/cerrar$/, async (_, [r]) => cerrarRun(db, id(r))],
  ['POST', /^\/api\/runs\/(\d+)\/descartar$/, (_, [r]) => (descartarRun(db, id(r)), { ok: true })],
  ['GET', /^\/api\/plantillas$/, () => listarPlantillas(db)],
  ['POST', /^\/api\/plantillas$/, (b) => guardarPlantilla(db, String(b.nombre ?? ''), b.pedido ?? {})],
  ['POST', /^\/api\/plantillas\/(\d+)\/borrar$/, (_, [p]) => (borrarPlantilla(db, id(p)), { ok: true })],

  // Misiones
  ['GET', /^\/api\/misiones$/, (_, __, q) => {
    const semana = q.get('semana') || semanaDe()
    const { desde, hasta } = diasDeSemana(semana)
    return {
      semana, desde, hasta, anterior: semanaVecina(semana, -1), siguiente: semanaVecina(semana, 1),
      principal: principalDe(db, 'jugador'),
      candidatas: listarMisiones(db, { personaje: 'jugador', nivel: 'principal', estados: ['sugerida'] }),
      primarias: conAvance(db, listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana }).filter((m) => m.estado !== 'descartada')).map((m) => ({
        ...m, ayudantes: ayudantesDe(db, m.id).map((x) => ({ mision: x.mision.id, agente: x.agente && { id: x.agente.id, nombre: x.agente.nombre, clase: x.agente.clase }, ultimoAporte: x.ultimoAporte?.en ?? null })),
        aportes: aportes(db, { primariaId: m.id, limite: 3 }),
      })),
      terciarias: listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria', abiertas: true }),
      terciariasHechas: listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria', estados: ['hecha'], limite: 10 }),
      deOtros: listarMisiones(db, { asignadaPor: 'jugador', excluirPersonaje: 'jugador', abiertas: true }).map((m) => ({ ...m, quien: nombreDe(m.personaje) })),
      runs: listarRuns(db, { desde, hasta, estados: ['en_curso', 'cerrada'] }).map((r) => ({ ...r, misiones: misionesDeRun(db, r.id) })),
      reportes: listarReportes(db, { limite: 20 }).filter((r) => r.tipo !== 'hora'),
    }
  }],
  ['POST', /^\/api\/misiones$/, (b) => {
    if (b.nivel === 'terciaria') return anotarSideQuest(db, { titulo: String(b.titulo ?? ''), detalle: b.detalle || null, disparador: b.disparador ?? null, vence: b.vence || null, personaje: b.personaje || 'jugador' })
    if (b.asignarA) return asignarMision(db, { a: String(b.asignarA), titulo: String(b.titulo ?? ''), detalle: b.detalle || null, vence: b.vence || null })
    return crearMision(db, {
      personaje: b.personaje || 'jugador', nivel: b.nivel, titulo: String(b.titulo ?? ''), detalle: b.detalle || null, categoria: b.categoria || null,
      entidadId: b.entidadId ? Number(b.entidadId) : null, padreId: b.padreId ? Number(b.padreId) : null, semana: b.semana || null, vence: b.vence || null,
    }, { por: 'operador' })
  }],
  ['POST', /^\/api\/misiones\/primarias$/, async (b) => proponerPrimarias(db, b.semana || semanaDe(), { texto: b.texto || undefined })],
  ['POST', /^\/api\/misiones\/(\d+)$/, (b, [m]) => actualizarMision(db, id(m), b, { por: 'operador' })],
  ['POST', /^\/api\/misiones\/(\d+)\/ayudantes$/, (b, [m]) => {
    const r = sumarAyudante(db, id(m), { clase: b.clase || undefined, agenteId: b.agenteId || undefined })
    return { mision: r.mision.id, agente: r.agente?.id }
  }],
  ['POST', /^\/api\/ayudantes\/(\d+)\/quitar$/, (_, [m]) => (quitarAyudante(db, id(m)), { ok: true })],
  ['POST', /^\/api\/aportes$/, async (b) => pedirAportes(db, { primariaId: b.primariaId ? Number(b.primariaId) : undefined })],
  ['POST', /^\/api\/misiones\/(\d+)\/marcar$/, (b, [m]) => marcarSecundaria(db, id(m), b.estado, b.nota ?? null)],
  ['GET', /^\/api\/reportes$/, (_, __, q) => listarReportes(db, { tipo: q.get('tipo') || undefined, limite: num(q.get('limite')) })],
  ['POST', /^\/api\/reportes\/semana$/, async (b) => reporteSemana(db, b.semana || semanaDe())],

  // Personajes
  ['GET', /^\/api\/personajes\/([^/]+)$/, (_, [k]) => fichaDe(decodeURIComponent(k))],
  ['POST', /^\/api\/personajes\/([^/]+)\/historia$/, (b, [k]) => (escribirHistoria(db, decodeURIComponent(k), { texto: b.texto, elementos: b.elementos }), fichaDe(decodeURIComponent(k)))],
  ['POST', /^\/api\/personajes\/([^/]+)\/historia\/(aceptar|descartar)$/, (_, [k, a]) => (resolverHistoria(db, decodeURIComponent(k), a === 'aceptar'), fichaDe(decodeURIComponent(k)))],
  ['POST', /^\/api\/personajes\/([^/]+)\/inventario$/, (b, [k]) => (agregarItem(db, decodeURIComponent(k), b, { fuente: 'operador' }), fichaDe(decodeURIComponent(k)))],
  ['POST', /^\/api\/personajes\/([^/]+)\/principal$/, (b, [k]) => {
    const clave = decodeURIComponent(k)
    if (b.id) actualizarMision(db, Number(b.id), { estado: 'activa' }, { por: 'operador' })
    else crearMision(db, { personaje: clave, nivel: 'principal', titulo: String(b.titulo ?? ''), detalle: b.detalle || null }, { por: 'operador' })
    return fichaDe(clave)
  }],
  ['GET', /^\/api\/preguntas\/siguiente$/, () => {
    reponerPreguntas(db)
    return { pregunta: siguientePregunta(db), generando: generandoPreguntas(), respondidas: listarPreguntas(db, { estado: 'respondida', limite: 500 }).length }
  }],
  ['GET', /^\/api\/preguntas$/, () => listarPreguntas(db, { limite: 100 })],
  ['POST', /^\/api\/preguntas\/generar$/, async () => generarPreguntas(db)],
  ['POST', /^\/api\/preguntas$/, (b) => encolarPregunta(db, { texto: String(b.texto ?? ''), porQue: b.porQue, opciones: b.opciones, tipo: b.tipo, origen: 'operador' })],
  // La respuesta se guarda ya; el escriba la procesa en segundo plano.
  ['POST', /^\/api\/preguntas\/(\d+)$/, (b, [p]) => {
    void responderPregunta(db, id(p), b.respuesta ?? null).catch((e) => console.error('  pregunta:', e))
    reponerPreguntas(db)
    return { ok: true, siguiente: siguientePregunta(db) }
  }],
  ['GET', /^\/api\/directo$/, () => {
    const activa = sesionActiva(db)
    return {
      activa: activa ? { ...activa, momentos: momentosDirecto(db, activa.id).slice(-80) } : null,
      sesiones: listarSesiones(db, 20).filter((s) => s.estado === 'cerrada'),
    }
  }],
  ['GET', /^\/api\/directo\/(\d+)$/, (_, [s]) => ({ ...leerSesion(db, id(s)), momentos: momentosDirecto(db, id(s)) })],
  ['POST', /^\/api\/directo\/iniciar$/, (b) => iniciarDirecto(db, Array.isArray(b.fuentes) ? b.fuentes : [])],
  ['POST', /^\/api\/directo\/(\d+)\/cerrar$/, async (_, [s]) => {
    await colasDirecto.get(id(s)) // lo último que mandó el navegador entra al informe
    const r = await cerrarDirecto(db, id(s))
    if (r.informe) mensajeDeMastropiero(db, conversacionHoy(db).id, `Cerré el Directo. ${r.informe}`)
    return r
  }],
  ['GET', /^\/api\/cuentas$/, () => ({ cuentas: listarCuentas(db), publicaciones: listarPublicaciones(db, { limite: 200 }), modos: MODOS, conectores: CONECTORES, telegram: telegramConfigurado() })],
  ['POST', /^\/api\/cuentas$/, (b) => guardarCuenta(db, { id: b.id ? Number(b.id) : undefined, red: b.red, usuario: b.usuario, modo: b.modo, conector: b.conector, reglas: b.reglas, activa: b.activa })],
  ['POST', /^\/api\/cuentas\/(\d+)\/redactar$/, async (b, [c]) => redactarPublicaciones(db, id(c), { n: Number(b.n) || 3, tema: b.tema || null })],
  ['POST', /^\/api\/publicaciones\/(\d+)$/, (b, [p]) => resolverPublicacion(db, id(p), { accion: b.accion, texto: b.texto, cuando: b.cuando ? Number(b.cuando) : null, url: b.url || null })],
  ['GET', /^\/api\/taller$/, () => ({ artefactos: listarArtefactos(db, { limite: 80 }), voces: VOCES, ffmpeg: hayFfmpeg() })],
  // Crear corre en segundo plano (un video tarda minutos): la pantalla ve el avance en la lista.
  ['POST', /^\/api\/taller$/, (b) => {
    const pedido = String(b.pedido ?? '').trim()
    if (!pedido) throw new Error('Decime qué querés crear')
    const crear = { juego: () => crearJuego(db, pedido), imagen: () => crearImagen(db, pedido, { modelo: b.modelo || undefined }), voz: () => crearVoz(db, pedido, { voz: b.voz || undefined }),
      personaje: () => crearPersonaje(db, pedido), video: () => crearVideo(db, pedido, { personajeId: b.personajeId ? Number(b.personajeId) : null, voz: b.voz || undefined }) }[b.tipo as string]
    if (!crear) throw new Error('Tipo inválido')
    void crear().catch((e) => console.error('  taller:', e))
    return { ok: true }
  }],
  ['POST', /^\/api\/taller\/(\d+)\/iterar$/, (b, [a]) => { void iterarArtefacto(db, id(a), String(b.cambio ?? '')).catch((e) => console.error('  taller:', e)); return { ok: true } }],
  ['POST', /^\/api\/taller\/(\d+)\/corpus$/, (_, [a]) => ({ pieza: artefactoAlCorpus(db, id(a)) })],
  // Tandas (notas de voz y páginas de cuadernos): la subida va cruda, más abajo
  ['GET', /^\/api\/tandas$/, () => listarTandas(db)],
  ['POST', /^\/api\/tandas\/(\d+)\/reintentar$/, (_, [t]) => { reintentarTanda(db, id(t)); void procesarTandas(db); return { ok: true } }],

  // Brújula del día y cómo rinde
  ['GET', /^\/api\/brujula$/, () => leerBrujula(db)],
  ['POST', /^\/api\/brujula$/, async () => brujulaDelDia(db, { forzar: true })],
  ['GET', /^\/api\/rendimiento$/, () => { const p = perfilDeRendimiento(db); return { ...p, texto: textoDeRendimiento(p) } }],

  // Mentor y Puentes
  ['GET', /^\/api\/mentor$/, () => listarRecomendaciones(db)],
  ['POST', /^\/api\/mentor$/, async () => recomendar(db)],
  ['POST', /^\/api\/mentor\/(\d+)$/, (b, [r]) => resolverRecomendacion(db, id(r), !!b.aceptar) ?? { descartada: true }],
  ['GET', /^\/api\/puentes$/, () => listarPuentes(db)],
  ['POST', /^\/api\/puentes$/, async () => proponerPuentes(db)],
  ['POST', /^\/api\/puentes\/(\d+)$/, (b, [p]) => resolverPuente(db, id(p), b.estado === 'hecho' ? 'hecho' : 'descartado')],

  // Librería
  ['GET', /^\/api\/libreria$/, (_, __, q) => ({ obras: listarObras(db, { tipo: q.get('tipo') || null, q: q.get('q') || null, estado: q.get('estado') || null }), conteos: conteosLibreria(db), poblando: poblando.activo ? poblando.paso : null })],
  ['POST', /^\/api\/libreria$/, (b) => agregarObra(db, { ...b, origen: 'operador' })],
  ['POST', /^\/api\/libreria\/poblar$/, () => {
    void poblarLibreria(db).then((r) => mensajeDeMastropiero(db, conversacionHoy(db).id, `Poblé la Librería: ${r.porUrl + r.nuevas} obras nuevas (${r.porUrl} repos y papers por su link, ${r.nuevas} leyendo ${r.leidas} piezas). Están marcadas para que las revises.`))
      .catch((e) => console.error('  libreria:', e instanceof Error ? e.message : e))
    return { empezada: true }
  }],
  ['POST', /^\/api\/libreria\/(\d+)$/, (b, [o]) => editarObra(db, id(o), b) ?? { borrada: true }],

  // Telegram: estado del canal y un mensaje de prueba
  ['GET', /^\/api\/telegram$/, () => ({ ...estadoTelegram(), voz: ajuste(db, 'telegram_voz'), bandas: ajuste(db, 'telegram_bandas') })],
  ['POST', /^\/api\/telegram\/probar$/, async () => {
    if (!telegramConfigurado()) throw new Error('Falta TELEGRAM_BOT_TOKEN en .env (y reiniciar)')
    const id = await decirPorTelegram('Prueba desde Mastropiero ✓ Escribime /ayuda para ver lo que sé hacer.')
    if (!id) throw new Error('No salió: falta TELEGRAM_CHAT_ID en .env (escribile al bot y te dice cuál es)')
    return { ok: true }
  }],
  ['POST', /^\/api\/telegram$/, (b) => {
    if (b.voz != null && ['0', '1', 'siempre'].includes(String(b.voz))) fijarAjuste(db, 'telegram_voz', String(b.voz))
    if (b.bandas != null) fijarAjuste(db, 'telegram_bandas', b.bandas ? '1' : '0')
    return { ok: true }
  }],

  // La Fragua (forjar corre en segundo plano; aplicar es solo desde acá, con su ok)
  ['GET', /^\/api\/fragua$/, () => ({ forjas: listarForjas(db).map(({ diff: _, ...f }) => f), propuestas: db.prepare(`SELECT id, titulo, detalle, area, prioridad, estado FROM propuestas WHERE estado = 'abierta' ORDER BY id DESC`).all() })],
  ['GET', /^\/api\/fragua\/(\d+)$/, (_, [f]) => leerForja(db, id(f)) ?? (() => { throw new Error(`No existe la forja ${f}`) })()],
  ['POST', /^\/api\/fragua$/, (b) => {
    void forjarMejora(db, { propuestaId: b.propuestaId ? Number(b.propuestaId) : null, pedido: b.pedido || null }).then((f) => {
      const que = f.estado === 'lista' ? 'pasó el typecheck y los tests: está en La Fragua para que la leas y la apliques' : f.estado === 'rota' ? 'quedó hecha pero no pasa los tests' : `no salió (${(f.salida ?? '').slice(0, 160)})`
      mensajeDeMastropiero(db, conversacionHoy(db).id, `La forja #${f.id} ${que}.`)
    }).catch((e) => console.error('  fragua:', e instanceof Error ? e.message : e))
    return { empezada: true }
  }],
  ['POST', /^\/api\/fragua\/(\d+)\/aplicar$/, (_, [f]) => aplicarForja(db, id(f))],
  ['POST', /^\/api\/fragua\/(\d+)\/descartar$/, (_, [f]) => descartarForja(db, id(f))],

  // Economía de agentes
  ['GET', /^\/api\/economia$/, (_, __, q) => ({ semana: q.get('semana') || semanaDe(), tarifas: TARIFAS, tabla: tablaEconomia(db, q.get('semana') || semanaDe()), historia: db.prepare('SELECT semana, COUNT(*) AS agentes, ROUND(SUM(neto), 1) AS neto FROM temporadas GROUP BY semana ORDER BY semana DESC LIMIT 8').all() })],

  // Cuadernos
  ['GET', /^\/api\/cuadernos$/, () => listarCuadernos(db)],
  ['POST', /^\/api\/cuadernos$/, (b) => crearCuaderno(db, String(b.titulo ?? ''), b.descripcion || null)],
  ['GET', /^\/api\/cuadernos\/(\d+)$/, (_, [c]) => {
    const cu = leerCuaderno(db, id(c))
    if (!cu) throw new Error(`No existe el cuaderno ${c}`)
    return { ...cu, notas: notas(db, cu.id), haciendo: haciendo.get(cu.id) ?? null }
  }],
  ['POST', /^\/api\/cuadernos\/(\d+)\/fuentes$/, async (b, [c]) => sumarFuentes(db, id(c), b)],
  ['POST', /^\/api\/cuadernos\/(\d+)\/quitar$/, (b, [c]) => (quitarFuente(db, id(c), Number(b.pieza)), { ok: true })],
  ['POST', /^\/api\/cuadernos\/(\d+)\/preguntar$/, async (b, [c]) => preguntar(db, id(c), String(b.pregunta ?? ''))],
  ['POST', /^\/api\/cuadernos\/(\d+)\/guia$/, async (_, [c]) => guia(db, id(c))],
  ['POST', /^\/api\/cuadernos\/(\d+)\/charla$/, (_, [c]) => {
    const n = id(c)
    if (haciendo.has(n)) throw new Error('Ya estoy armando una charla para este cuaderno')
    void charla(db, n).catch((e) => mensajeDeMastropiero(db, conversacionHoy(db).id, `No pude armar la charla del cuaderno: ${e instanceof Error ? e.message : e}`))
    return { empezada: true }
  }],
  ['POST', /^\/api\/cuadernos\/(\d+)\/borrar$/, (_, [c]) => (borrarCuaderno(db, id(c)), { ok: true })],

  // Criba lúdica
  ['GET', /^\/api\/criba$/, (_, __, q) => ({ pieza: siguiente(db, { nivel: q.get('nivel') || null, saltear: (q.get('saltear') ?? '').split(',').filter(Boolean).map(Number) }), marcador: marcador(db) })],
  ['POST', /^\/api\/criba\/deshacer$/, () => deshacerUltima(db)],
  ['POST', /^\/api\/criba\/(\d+)$/, (b, [p]) => cribar(db, id(p), Number(b.peso))],

  // Bitácora íntima (la clave viaja en el cuerpo, se usa y se olvida)
  ['GET', /^\/api\/bitacora$/, () => ({ disparador: disparadorDe(), entradas: leerBitacora(db) })],
  ['POST', /^\/api\/bitacora$/, (b) => escribir(db, b)],
  ['POST', /^\/api\/bitacora\/abrir$/, (b) => ({ disparador: disparadorDe(), entradas: leerBitacora(db, { clave: String(b.clave ?? '') || null }) })],
  ['POST', /^\/api\/bitacora\/(\d+)$/, (b, [e]) => (cambiarEntrada(db, id(e), b), { ok: true })],

  // Búsqueda híbrida (palabras + significado)
  ['GET', /^\/api\/buscar$/, async (_, __, q) => ({ piezas: await buscarHibrido(db, q.get('q') ?? '', num(q.get('limite')) ?? 20, nivelesDe(q.get('nivel'))), vectores: estadoVectores(db) })],
  ['GET', /^\/api\/vectores$/, () => estadoVectores(db)],
  ['POST', /^\/api\/vectores$/, async (b) => vectorizarPendientes(db, { limite: Math.min(Number(b.limite) || 64, 512) })],

  // Personas
  ['GET', /^\/api\/personas$/, (_, __, q) => personas(db, { q: q.get('q') || undefined })],
  ['POST', /^\/api\/personas\/(\d+)$/, (b, [p]) => guardarRelacion(db, id(p), b)],

  // Finanzas
  ['GET', /^\/api\/finanzas$/, (_, __, q) => {
    const mes = q.get('mes') || fechaLocal().slice(0, 7)
    return { resumen: resumenMes(db, mes), movimientos: listarMovimientos(db, { mes }) }
  }],
  ['POST', /^\/api\/finanzas$/, (b) => registrarMovimiento(db, b) ?? { repetido: true }],
  ['POST', /^\/api\/finanzas\/(\d+)$/, (b, [m]) => (editarMovimiento(db, id(m), b), { ok: true })],

  ['GET', /^\/api\/radar$/, () => ({
    oportunidades: listarOportunidades(db, { estados: ['nueva', 'me_interesa', 'hecha'], limite: 200 }), cuotas: cuotas(db), conBuscador: hayBuscadorWeb(),
    primarias: listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(), estados: ['activa'] }).map((m) => ({ id: m.id, titulo: m.titulo })),
  })],
  ['POST', /^\/api\/radar\/buscar$/, async (b) => buscarOportunidades(db, { misionId: b.misionId ? Number(b.misionId) : null, texto: b.texto || null })],
  ['POST', /^\/api\/radar\/(\d+)$/, (b, [o]) => marcarOportunidad(db, id(o), b.estado)],
  ['POST', /^\/api\/radar\/(\d+)\/borrador$/, async (b, [o]) => redactarOportunidad(db, id(o), b.pedido || null)],
  ['GET', /^\/api\/gemelo$/, (_, __, q) => {
    const fecha = q.get('fecha') || fechaLocal()
    return { fecha, predicciones: prediccionesDe(db, fecha), curva: curva(db, fecha, 21), ayer: prediccionesDe(db, fechaLocal(Date.now() - 86_400_000)), pendientes: paraElJugador(db) }
  }],
  ['POST', /^\/api\/gemelo\/predecir$/, async (b) => predecirDia(db, b.fecha || fechaLocal())],
  ['POST', /^\/api\/gemelo\/sumar$/, async (b) => sumarPredicciones(db, b.fecha || fechaLocal(), b.pista || null)],
  ['POST', /^\/api\/gemelo\/nueva$/, (b) => anotarPrediccion(db, b.fecha || fechaLocal(), String(b.texto ?? ''), b.probabilidad)],
  ['POST', /^\/api\/gemelo\/calificar$/, async (b) => {
    const r = await calificarDia(db, b.fecha || fechaLocal())
    return { ...r, texto: textoDeCalificacion(r) }
  }],
  ['POST', /^\/api\/gemelo\/(\d+)$/, (b, [p]) => {
    const paso = b.paso === true || b.paso === 1 ? true : b.paso === false || b.paso === 0 ? false : null
    return calificarAMano(db, id(p), paso, typeof b.nota === 'string' ? b.nota : null)
  }],
  ['GET', /^\/api\/menciones$/, () => catalogo(db).map((m) => ({ k: m.clave, n: m.nombre, t: m.tipo, a: m.alias.slice(0, 8), p: m.piezas }))],
  ['POST', /^\/api\/entidades\/(\d+)$/, (b, [e]) => editarEntidad(db, id(e), { nombre: b.nombre, tipo: b.tipo, notas: b.notas, alias: Array.isArray(b.alias) ? b.alias : undefined, sumarAlias: b.sumarAlias })],
  ['POST', /^\/api\/entidades\/(\d+)\/fusionar$/, (b, [e]) => fusionarEntidades(db, id(e), (b.absorbe ?? []).map(Number))],
  ['POST', /^\/api\/entidades\/(\d+)\/soy-yo$/, (_, [e]) => marcarJugador(db, id(e))],
  ['POST', /^\/api\/inventario\/(\d+)$/, (b, [i]) => editarItem(db, id(i), b)],
  ['POST', /^\/api\/jugador\/procesar$/, async () => procesarJugador(db)],
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
  ['GET', /^\/api\/duplicados$/, () => duplicadosProbables(db)],
  ['POST', /^\/api\/duplicados\/alias$/, (b) => ({ quitados: quitarAliasCruzados(db, (b.ids ?? []).map(Number)) })],
  ['POST', /^\/api\/duplicados\/no$/, (b) => (noSonLoMismo(db, (b.ids ?? []).map(Number)), { ok: true })],
  ['GET', /^\/api\/entidades\/(\d+)\/componentes$/, (_, [e]) => componentesDeEntidad(db, id(e))],
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
  '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.json': 'application/json; charset=utf-8', '.webm': 'audio/webm',
}

/** Solo la propia pantalla puede hablarle a la API: ni otros sitios (CSRF) ni los iframes aislados del Taller (origen «null»). */
function origenPermitido(req: http.IncomingMessage): boolean {
  const o = req.headers.origin
  if (!o) return true // navegación directa, curl, la CLI
  const extra = (process.env.MASTRO_ORIGENES ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  // La misma pantalla (sea por localhost, por la IP de Tailscale o por el nombre que tenga): mismo host que el pedido.
  try { if (new URL(o).host === req.headers.host) return true } catch { /* origen raro */ }
  return o === `http://127.0.0.1:${PUERTO}` || o === `http://localhost:${PUERTO}` || extra.includes(o)
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
  // Expuesto a la red: primero la clave (salvo desde esta misma compu).
  if (url.pathname === '/entrar') {
    if (req.method === 'POST') {
      const f = leerFormulario(await leerCrudo(req, 64 * 1024), String(req.headers['content-type'] ?? ''))
      const cookie = cookieDeEntrada(f.clave ?? '')
      if (!cookie) return void res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' }).end(PAGINA_ENTRAR(true))
      return void res.writeHead(303, { 'set-cookie': cookie, location: '/' }).end()
    }
    return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGINA_ENTRAR())
  }
  if (!autorizado(req) && !['/manifest.webmanifest', '/icono.svg'].includes(url.pathname)) {
    if (url.pathname.startsWith('/api/')) return void res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'Falta la clave' }))
    return void res.writeHead(303, { location: '/entrar' }).end()
  }
  // Compartir desde el celular (la app instalada): un link, un reel o un texto llega a Mastropiero.
  if (url.pathname === '/compartir' && req.method === 'POST') {
    const f = leerFormulario(await leerCrudo(req, 2 * 1024 * 1024), String(req.headers['content-type'] ?? ''))
    const compartido = [f.title, f.text, f.url].filter((x) => x?.trim()).join('\n').trim()
    if (compartido) {
      const link = /https?:\/\/\S+/.exec(compartido)?.[0] ?? null
      ingerir(db, { fuente: 'operador', titulo: `Compartido · ${(f.title || link || compartido).slice(0, 80)}`, contenido: compartido, url: link, dominio: 'compartido' })
      const c = conversacionHoy(db)
      if (!estaPensando(c.id)) void enviar(db, c.id, `Te compartí esto desde el celular:\n${compartido}`)
    }
    return void res.writeHead(303, { location: '/?compartido=1' }).end()
  }
  if (url.pathname.startsWith('/api/') && !origenPermitido(req)) {
    return void res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'Origen no permitido' }))
  }
  // Lo que crea el Taller: siempre aislado (un juego escrito por el modelo no puede tocar la app ni la API).
  if (url.pathname.startsWith('/taller/')) {
    const archivo = path.join(dirTaller(), path.normalize(decodeURIComponent(url.pathname.slice('/taller/'.length))))
    if (!archivo.startsWith(dirTaller()) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) return void res.writeHead(404).end('No encontrado')
    res.writeHead(200, { 'content-type': TIPOS_MIME[path.extname(archivo).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-security-policy': 'sandbox allow-scripts allow-pointer-lock', 'x-content-type-options': 'nosniff' })
    return void fs.createReadStream(archivo).pipe(res)
  }
  // La Librería en CSV.
  if (req.method === 'GET' && url.pathname === '/api/libreria.csv') {
    const tipo = url.searchParams.get('tipo') || null
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="libreria${tipo ? `-${tipo}` : ''}.csv"` })
    return void res.end('\uFEFF' + aCsv(listarObras(db, { tipo })))
  }
  // Exportación de estado: se arma en data/exportaciones/ y se baja tal cual (puede pesar decenas de MB).
  if (req.method === 'GET' && url.pathname === '/api/exportar') {
    try {
      const r = exportarEstado(db, { archivos: url.searchParams.get('archivos') !== '0' })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(r.bytes), 'content-disposition': `attachment; filename="${path.basename(r.ruta)}"`, 'cache-control': 'no-store' })
      return void fs.createReadStream(r.ruta).pipe(res)
    } catch (e) {
      return void res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
    }
  }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('content-type', 'application/json; charset=utf-8')
    try {
      // Una nota de voz o una página de cuaderno (cruda, de a un archivo; el navegador manda varias seguidas).
      if (req.method === 'POST' && url.pathname === '/api/tandas') {
        const q = url.searchParams
        const r = encolarTanda(db, { tipo: (q.get('tipo') as any) || undefined, nombre: q.get('nombre') || 'archivo', datos: await leerCrudo(req, 300 * 1024 * 1024), fecha: q.get('fecha') || null, cuaderno: q.get('cuaderno') || null, hoja: q.get('hoja') ? Number(q.get('hoja')) : null })
        void procesarTandas(db).catch((e) => console.error('  tandas:', e instanceof Error ? e.message : e))
        return void res.end(JSON.stringify(r))
      }
      // Importar un estado exportado (crudo). Reemplaza esta base: con datos, pide forzar y respalda antes.
      if (req.method === 'POST' && url.pathname === '/api/importar-estado') {
        const texto = (await leerCrudo(req, MAX_CARGA)).toString('utf8')
        const r = importarEstado(db, texto, { forzar: url.searchParams.get('forzar') === '1' })
        return void res.end(JSON.stringify(r))
      }
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
      const crudo = req.method === 'POST' ? /^\/api\/directo\/(\d+)\/(cuadro|audio)$/.exec(url.pathname) : null
      if (crudo) {
        const sesion = Number(crudo[1])
        const cuerpo = await leerCrudo(req, 25 * 1024 * 1024)
        const desde = Number(url.searchParams.get('desde')) || undefined
        encolarDirecto(sesion, () => crudo[2] === 'cuadro'
          ? registrarCuadro(db, sesion, cuerpo, String(req.headers['content-type'] || 'image/jpeg'))
          : registrarAudio(db, sesion, cuerpo, url.searchParams.get('tipo') === 'medio' ? 'medio' : 'voz', url.searchParams.get('nombre') || 'tramo.webm', { desde }))
        return void res.end(JSON.stringify({ ok: true }))
      }
      // El extracto del banco, crudo.
      if (req.method === 'POST' && url.pathname === '/api/finanzas/csv') {
        const crudo = await leerCrudo(req, 10 * 1024 * 1024)
        const utf = crudo.toString('utf8')
        const texto = utf.includes('\uFFFD') ? crudo.toString('latin1') : utf // los bancos españoles suelen exportar en Latin-1
        return void res.end(JSON.stringify(importarCSV(db, texto, { cuenta: url.searchParams.get('cuenta') || null })))
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

// El Directo: lo que llega se procesa en orden por sesión (visión y Whisper tardan), sin frenar al navegador.
const colasDirecto = new Map<number, Promise<unknown>>()
function encolarDirecto(sesion: number, f: () => Promise<unknown>) {
  const previa = colasDirecto.get(sesion) ?? Promise.resolve()
  const sigue = previa.then(f).catch((e) => console.error('  directo:', e instanceof Error ? e.message : e))
  colasDirecto.set(sesion, sigue)
}
setInterval(async () => {
  try {
    const s = await latidoDirecto(db)
    if (s?.informe) mensajeDeMastropiero(db, conversacionHoy(db).id, `El Directo se cortó (la pestaña se cerró), así que lo cerré yo. ${s.informe}`)
  } catch (e) { console.error('  directo:', e instanceof Error ? e.message : e) }
}, 60_000).unref()

// Mastropiero proactivo: alertas y una reflexión cada tantas horas (con las rutinas; nunca en una reunión).
let pensando = false
async function latidoPensar() {
  if (pensando || process.env.MASTRO_SIN_RUTINAS) return
  pensando = true
  try {
    for (const t of await pensar(db)) mensajeDeMastropiero(db, conversacionHoy(db).id, t)
  } catch (e) {
    console.error('  pensar:', e instanceof Error ? e.message : e)
  } finally {
    pensando = false
  }
}
setInterval(latidoPensar, 15 * 60_000).unref()
setTimeout(latidoPensar, 60_000).unref()

// Vectores: de a tandas, lo que falta (lo propio primero). Barato, pero respeta el tope diario si lo hay.
let vectorizando = false
setInterval(async () => {
  if (vectorizando || process.env.MASTRO_SIN_RUTINAS || topeAlcanzado(db) || ajuste(db, 'vectorizar_auto') === '0') return
  vectorizando = true
  try { await vectorizarPendientes(db, { limite: 48 }) } catch (e) { console.error('  vectores:', e instanceof Error ? e.message : e) } finally { vectorizando = false }
}, 10 * 60_000).unref()

// Las cuentas: lo aprobado se publica en su horario (solo con conector; «redacta» solo lo que él aprobó).
setInterval(async () => {
  try {
    for (const p of await publicarPendientes(db)) if (p.estado === 'fallo') mensajeDeMastropiero(db, conversacionHoy(db).id, `No pude publicar: ${p.error}`)
  } catch (e) { console.error('  cuentas:', e instanceof Error ? e.message : e) }
}, 5 * 60_000).unref()

// Telegram: si hay bot, escucha; y lo que Mastropiero dice solo también sale por ahí.
if (telegramConfigurado()) {
  escucharTelegram(db)
  retomarTandas(db)
  void procesarTandas(db).catch(() => {})
  setInterval(() => void latidoTelegram(db).catch(() => {}), 60_000).unref()
  alDecirSolo((texto) => void decirPorTelegram(texto).catch(() => {}))
}

// Las runs las arranca él: su latido (reporte por hora, cierre de la run vencida) corre aunque las rutinas estén apagadas.
let enRuns = false
async function latidoDeRuns() {
  if (enRuns) return
  enRuns = true
  try {
    for (const texto of await latidoRuns(db)) mensajeDeMastropiero(db, conversacionHoy(db).id, texto)
  } catch (e) {
    console.error('  ⏱ runs:', e instanceof Error ? e.message : e)
  } finally {
    enRuns = false
  }
}
setInterval(latidoDeRuns, 60_000).unref()
setTimeout(latido, 3_000).unref()

const problemaDeAcceso = validarAcceso()
if (problemaDeAcceso) {
  console.error(`\n  ✗ ${problemaDeAcceso}\n`)
  process.exit(1)
}
servidor.listen(PUERTO, host(), () => {
  console.log(`\n  ☿ Mastropiero en http://${host() === '0.0.0.0' ? '127.0.0.1' : host()}:${PUERTO}${expuesto() ? '   (expuesto a la red: pide clave)' : ''}   (base: ${process.env.MASTRO_DB ?? 'data/mastro.db'} · motor de reclutas: ${MOTOR_DEFECTO()})\n`)
})
