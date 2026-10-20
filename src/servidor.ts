/**
 * La pantalla de juego. Servidor local sin dependencias: API JSON sobre la liga + estáticos de web/.
 * `npm run jugar` → http://127.0.0.1:7272
 * Todo vive en la base (data/mastro.db): cerrar el servidor no pierde nada.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ATRIBUTO_MAX, ATRIBUTOS, CLASE_IDS, CLASES, PUNTOS_LIBRES } from './clases.ts'
import { abrir, ajuste, fechaLocal, fijarAjuste, resolverRuta, type Db } from './db.ts'
import { leerJornada, progreso, semana } from './jornada.ts'
import {
  actualizarMision, ajustarMinutos, anotarSideQuest, arrancarRun, asignarMision, borrarPlantilla, cerrarRun, comentarRun, conAvance, crearMision, descartarRun, enCurso, guardarPlantilla,
  latidoRuns, leerRun, listarMisiones, listarPlantillas, listarReportes, listarRuns, marcarSecundaria, misionesDeRun, opinarArmado, pasarASiguiente, principalDe, procesarJugador,
  proponerPrimarias, rehacerRun, reporteSemana, runActual, semanaDe, semanaVecina, seguimientos, prepararRun, diasDeSemana, asegurarPrincipal, pasoDeRun,
} from './misiones.ts'
import { catalogo } from './menciones.ts'
import { pensar } from './alertas.ts'
import { autorizado, cookieDeEntrada, enVercel, expuesto, host, leerFormulario, PAGINA_ENTRAR, validarAcceso } from './acceso.ts'
import { alGuardar, bajarNube, esperarSubida, subirAhora } from './nube.ts'
import { CONECTORES, guardarCuenta, leerAgente, listarCuentas, listarPublicaciones, MODOS, publicarPendientes, redactarPublicaciones, resolverPublicacion } from './cuentas.ts'
import { decir as decirPorTelegram, escucharTelegram, estadoTelegram, latidoTelegram, telegramActivo, telegramConfigurado } from './telegram.ts'
import { borrarSalud, editarSalud, fijarMetasSalud, registrarSalud, resumenDia, resumenSemana } from './salud.ts'
import { clasificar, registrarCaptura } from './captura.ts'
import { diaDelPlan, guardarNota, guardarWoop, mapaDelPlan, marcarHabito, marcarTarea, votar } from './cien.ts'
import { crearAprendizaje, editarAprendizaje, leerAprendizaje, listarAprendizajes, practicasDe, prepararRepaso, recursosDe, registrarPractica } from './aprender.ts'
import { guardarFoto } from './chat/adjuntos.ts'
import { aplicarBaseEntrante, recibirArchivo, recibirBase } from './mudanza.ts'
import { artefactoAlCorpus, ASPECTOS, borrarArtefacto, carpeta as carpetaTaller, crearCharla, crearImagen, crearJuego, crearPersonaje, crearVideo, crearVoz, dirTaller, ESTILOS, hayFfmpeg, iterarArtefacto, libreria, listarArtefactos, sugerenciasTaller, VOCES } from './taller.ts'
import { conMatriz, desvincularDeProyecto, grafoPersonas, guardarRelacion, nuevaPersona, personas, vincularAProyecto } from './personas.ts'
import { bandeja } from './sombra.ts'
import { medirPedido, reiniciarVelocidad, velocidad } from './rendimiento-servidor.ts'
import { comprimirJson, indexConVersiones, miniaturaDe, servirArchivo, servirEstatico, versionDe } from './estatico.ts'
import { controlarReproceso, enLaNube, estadoReproceso, trabajarReproceso } from './reproceso.ts'
import { lineaTemporal, resolverEvento } from './linea.ts'
import * as estudio from './estudio.ts'
import { qrPng } from './qr.ts'
import { procesarAnotaciones } from './anotaciones.ts'
import { acepciones, ejesDe, separarEntidad } from './ejes.ts'
import { guardarYo, leerYo } from './yo.ts'
import { cambiarEntrada, disparadorDe, escribir, leerBitacora } from './bitacora.ts'
import { anotar as anotarEnCriba, anotarSolo, cribar, deshacerUltima, marcador, siguiente } from './criba.ts'
import { tabla as tablaEconomia, TARIFAS } from './economia.ts'
import { exportarEstado, importarEstado, importarEstadoArchivo } from './exportacion.ts'
import { aplicarZona, recibirZona } from './zona.ts'
import { anotarUso } from './uso.ts'
import { armarSandbox, espacioDeProyecto } from './proyectos.ts'
import { bloquesDelDia, fijarHorario, horarioComoTexto, horarioDeTexto, leerHorario } from './horario.ts'
import { cerrarLote, estadoTakeout, faltan, huellaValida, ingerirPaquete, loteValido, paqueteListo, recibirMedio, recibirParte, reintentarTakeout, resolverNombre, retomarTakeout, trabajarTakeout } from './takeout/nube.ts'
import { dirAdjuntos, guardarImagen } from './chat/adjuntos.ts'
import { encolar as encolarTanda, listarTandas, procesarTandas, reintentar as reintentarTanda, retomarTandas } from './tandas.ts'
import { brujulaDelDia, leerBrujula } from './brujula.ts'
import { perfilDeRendimiento, textoDeRendimiento } from './rendimiento.ts'
import { listarRecomendaciones, recomendar, resolverRecomendacion } from './mentor.ts'
import { listarPuentes, proponerPuentes, resolverPuente } from './puentes.ts'
import { aCsv, agregarObra, avisoLibreria, conteos as conteosLibreria, cuadernoDeObra, editarObra, expandiendo, expandirObra, expandirTanda, listarObras, panorama, poblando, poblarLibreria } from './libreria.ts'
import { esErrorDeCodigo, registrarError } from './autocritica.ts'
import { aplicarForja, descartarForja, forjarMejora, leerForja, listarForjas, pasoDeForja, ramaActual, retomarFragua } from './fragua.ts'
import { borrarCuaderno, charla, componentesDeEntidad, crearCuaderno, guia, haciendo, leerCuaderno, listarCuadernos, notas, preguntar, quitarFuente, sumarFuentes } from './cuadernos.ts'
import { buscarHibrido, estadoVectores, nivelesDe, vectorizarPendientes } from './semantica.ts'
import { editarMovimiento, importarCSV, listarMovimientos, registrarMovimiento, resolverSugerido, resumenMes, resumenPorProyecto, ritmoMeta, sugeridos } from './finanzas.ts'
import { buscarOportunidades, listarOportunidades, marcarOportunidad, redactarOportunidad } from './radar.ts'
import { cuotas, hayBuscadorWeb } from './web.ts'
import { anotarPrediccion, calificarAMano, calificarDia, curva, paraElJugador, predecirDia, prediccionesDe, sumarPredicciones, textoDeCalificacion } from './gemelo.ts'
import { cerrarDirecto, iniciarDirecto, latidoDirecto, tramoDirecto, tramosDe, leerSesion, listarSesiones, momentos as momentosDirecto, registrarAudio, registrarCuadro, sesionActiva, rehacerInforme, resolverPropuestas, propuestasPendientes } from './directo.ts'
import { encolarPregunta, generandoPreguntas, generarPreguntas, listarPreguntas, reponerPreguntas, responderPregunta, siguientePregunta } from './preguntas.ts'
import { aportes, ayudantesDe, pedirAportes, quitarAyudante, sumarAyudante } from './ayudantes.ts'
import { agregarItem, editarItem, escribirHistoria, inventarioDe, inventarioDerivado, leerHistoria, marcarJugador, personaje, resolverHistoria, TIPOS_INVENTARIO } from './personajes.ts'
import { aprender, archivar, corregir, estadoAprendizaje, fuentesParaAprender, memoriaVigente, recordar, revisar } from './memoria.ts'
import { actualizarRutina, correrRutinas, listarRutinas } from './rutinas.ts'
import { agendaDelDia, urlsCalendario } from './calendario.ts'
import { asientos, especializacion } from './auditor.ts'
import { enEspera, leerTarea, pausarIngesta, publicar, reanudarIngesta, tareas } from './bus.ts'
import { asegurarFuente, fuentes, leerPieza, listarPiezas, NIVELES, TIPOS } from './corpus.ts'
import { deshacer, descartar, ejecutar as ejecutarCarga, IMPORTADORES, leerCarga, listarCargas, reetiquetar, subir } from './cargas/index.ts'
import { conexionesDe, contarEntidades, coocurrencias, duplicadosProbables, editarEntidad, entidadesPorId, fusionarEntidades, noSonLoMismo, quitarAliasCruzados, leerEntidad, listarEntidades, resumenEntidades, TIPOS_ENTIDAD } from './entidades.ts'
import {
  alDecirSolo, ultimosMensajes, archivarConversacion, registrarEvento, conversacionHoy, crearConversacion, enviar, estadoEnVivo, estaPensando, leerConversacion, listarConversaciones, listarPropuestas, mensajeDeMastropiero, mensajes, resolverPropuesta,
} from './chat/index.ts'
import { deshacerAcciones } from './chat/deshacer.ts'
import { celda, DOMINIOS } from './geometria72.ts'
import { crearProyecto, cronica, estadoLiga, ingerir, numeroDeTick, tickEnCurso, tickUnico } from './mastropiero.ts'
import { motoresDisponibles } from './motores.ts'
import { cadena, nanConfigurado, nanTranscribir, tokensHoy, topeAlcanzado, topeDiario, usoDelMes } from './nan.ts'
import {
  aceptarPropuesta, descartar as descartarQuantomo, descartarLote, gruposProto, leerQuantomo, linaje, listarQuantomos, pedirLote, pedirMejora, quantomosDePieza, resumenQuantomos, sellar, sellarLote,
} from './quantomos.ts'
import { nuevasParaJugar } from './mano.ts'
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
// `--sin-telegram` para una copia de prueba: lee el mismo .env, y si escucha el mismo bot las dos instancias contestan todo dos veces.
if (process.argv.includes('--sin-telegram')) process.env.MASTRO_TELEGRAM = '0'

if (enVercel()) await bajarNube()

function dirWeb(): string {
  const candidatos = [path.resolve(import.meta.dirname, '..', 'web'), path.resolve(process.cwd(), 'web')]
  return candidatos.find((d) => fs.existsSync(path.join(d, 'index.html'))) ?? candidatos[0]
}
const WEB = dirWeb()
/** La versión de la pantalla: una huella de sus archivos (cambia con cada cambio, no con cada reinicio). */
const ARRANCO = new Date().toISOString()
const VERSION_WEB = (() => {
  const h = crypto.createHash('sha1')
  const recorrer = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); if (e.isDirectory()) recorrer(f); else h.update(e.name).update(fs.readFileSync(f)) } }
  try { recorrer(WEB) } catch { h.update(String(Date.now())) }
  return h.digest('hex').slice(0, 10)
})()
const PUERTO = Number(process.env.MASTRO_PUERTO ?? 7272)
const MAX_CARGA = 1024 * 1024 * 1024
// Si llegó una base por mudanza (la compu se mudó a la nube), se pone en su lugar antes de abrirla.
const mudanza = aplicarBaseEntrante()
if (mudanza) console.log(`  ⇣ Arranco con la base que llegó por mudanza${mudanza.anterior ? ` (la anterior quedó en ${mudanza.anterior})` : ''}`)
const db = abrir()
// La hora del operador, no la del servidor (la nube corre en UTC): antes de que nada formatee una hora.
const zona = aplicarZona(db)
alGuardar(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* todavía no */ } })

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
      directo: (() => { const s = sesionActiva(db); return s ? { id: s.id, inicio: s.inicio, tramos: tramosDe(s).length, momentos: (db.prepare('SELECT COUNT(*) AS n FROM directo_momentos WHERE sesion_id = ?').get(s.id) as { n: number }).n } : null })(),
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

/** Lo que el Estudio hace de fondo por proyecto (transcribir): la pantalla lo pregunta. */
const tareasEstudio = new Map<number, { activa: boolean; que: string; error: string | null }>()

/** «Procesarme» corre de fondo: acá queda cómo va (la pantalla lo pregunta). */
const procesando: { activo: boolean; resultado: Awaited<ReturnType<typeof procesarJugador>> | null; error: string | null } = { activo: false, resultado: null, error: null }

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
  ['GET', /^\/api\/proyectos\/espacio\/(\d+)$/, (_, [e]) => espacioDeProyecto(db, id(e))],
  ['POST', /^\/api\/proyectos\/sandbox\/(\d+)$/, async (_, [e]) => armarSandbox(db, id(e))],
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
    // Con «desde»: solo lo nuevo (mientras piensa). Sin «desde»: los últimos 200 (o los anteriores a «antes»), con hayMas.
    const desde = num(q.get('desde'))
    const pagina = desde != null ? { mensajes: mensajes(db, conversacion.id, desde), hayMas: undefined } : ultimosMensajes(db, conversacion.id, Math.min(500, num(q.get('ultimos')) ?? 200), num(q.get('antes')))
    return { conversacion, ...pagina, pensando: estaPensando(conversacion.id), vivo: estadoEnVivo(conversacion.id) }
  }],
  ['POST', /^\/api\/chat\/(\d+)\/mensajes$/, (b, [c]) => {
    const cid = id(c)
    if (estaPensando(cid)) throw new Error('Esperá: todavía está contestando')
    if (!String(b.texto ?? '').trim()) throw new Error('Mensaje vacío')
    // El turno corre en segundo plano; la pantalla sigue el avance leyendo los mensajes.
    void enviar(db, cid, String(b.texto), { hud: typeof b.hud === 'string' ? b.hud : null })
    return { ok: true }
  }],
  ['POST', /^\/api\/chat\/(\d+)\/archivar$/, (_, [c]) => (archivarConversacion(db, id(c)), { ok: true })],
  // Deshacer lo que escribió Mastropiero en un turno (la comida, el gasto, la misión…): borra lo creado.
  ['POST', /^\/api\/chat\/(\d+)\/deshacer$/, (b, [c]) => {
    if (estaPensando(id(c))) throw new Error('Esperá: todavía está contestando')
    return deshacerAcciones(db, (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isFinite))
  }],
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
      paraDecidir: bandeja(db).total,
      tarjetasHoy: (db.prepare(`SELECT COUNT(*) AS n FROM tarjetas WHERE estado = 'activa' AND proxima <= ?`).get(fecha) as { n: number }).n,
      manoNuevas: nuevasParaJugar(db),
      ajustes: { primarias_semana: ajuste(db, 'primarias_semana'), tokens_dia_max: ajuste(db, 'tokens_dia_max'), pensar_cada_horas: ajuste(db, 'pensar_cada_horas'), meta_ingresos_mes: ajuste(db, 'meta_ingresos_mes'), directo_auto: ajuste(db, 'directo_auto'), fragua_por_noche: ajuste(db, 'fragua_por_noche'), ciclo_bandas: ajuste(db, 'ciclo_bandas'), horario_fijo: horarioComoTexto(leerHorario(db)) },
    }
  }],
  // El HUD de Hoy: lo de cada modo que no viene en /api/hoy, y las líneas de registro de lo que se hace desde ahí
  ['GET', /^\/api\/hoy\/hud$/, async () => {
    const fecha = fechaLocal()
    const ahora = new Date()
    const hhmm = ahora.toTimeString().slice(0, 5)
    const { eventos } = await agendaDelDia(fecha).catch(() => ({ eventos: [] as { titulo: string; inicio: number; fin: number; todoElDia: boolean }[] }))
    const plan = diaDelPlan(db, fecha)
    const enPlan = plan && fecha >= plan.plan.desde && fecha <= plan.plan.hasta
    const salud = resumenDia(db, fecha)
    return {
      agenda: eventos.map((e) => ({ titulo: e.titulo, inicio: e.inicio, fin: e.fin, todoElDia: e.todoElDia })),
      fijo: bloquesDelDia(db, fecha),
      bucles: (await import('./bucles.ts')).listarBucles(db, { limite: 3 }).filter((b) => b.veces >= 2 || b.dias >= 14),
      foco: await (async () => { const f = await import('./foco.ts'); return { hoy: f.focoDelDia(db, fecha), meta: f.metaDeBloque(db) } })(),
      rutinas: listarRutinas(db).filter((r) => r.activa && r.dias.includes(String(ahora.getDay())) && r.hora > hhmm).map((r) => ({ nombre: r.nombre, hora: r.hora })).slice(0, 4),
      salud: { kcal: salud.kcal, proteina: salud.proteina, comidas: salud.comidas, ejercicio: salud.ejercicio, sueno: salud.sueno, peso: salud.peso, metas: salud.metas, entrenosSemana: resumenSemana(db, fecha).entrenos },
      plan: enPlan ? { habitos: plan.habitos.filter((h) => h.toca), verbos: plan.dia.verbos, tareas: plan.tareas.map((t) => ({ id: t.id, titulo: t.titulo, estado: t.estado, hito: t.hito, obligatoria: t.obligatoria })) } : null,
      plata: { resumen: resumenMes(db), ritmo: ritmoMeta(db) },
      teConozco: curva(db, fecha, 21).total,
      gasto: { ...tokensHoy(db), tope: topeDiario(db) },
      pregunta: siguientePregunta(db)?.texto ?? null,
      directo: propuestasPendientes(db),
    }
  }],
  ['POST', /^\/api\/hoy\/evento$/, (b) => (registrarEvento(db, conversacionHoy(db).id, String(b.texto ?? '')), { ok: true })],
  ['POST', /^\/api\/zona$/, (b) => recibirZona(db, b.zona)],
  ['POST', /^\/api\/uso$/, (b) => (anotarUso(db, 'vista', String(b.vista ?? '')), { ok: true })],
  ['POST', /^\/api\/ajustes$/, (b) => {
    if (b.ciclo_bandas != null) {
      const c = String(b.ciclo_bandas).trim()
      if (!/^(0|\d{2,3}\s*\/\s*\d{1,2})$/.test(c)) throw new Error('El ciclo va como «90/20» (minutos de foco / de descanso), o 0 para no usar ciclos')
      fijarAjuste(db, 'ciclo_bandas', c.replace(/\s+/g, ''))
    }
    if (b.apps_estimulo != null) fijarAjuste(db, 'apps_estimulo', String(b.apps_estimulo).slice(0, 500))
    for (const k of ['primarias_semana', 'tokens_dia_max', 'pensar_cada_horas', 'directo_auto', 'fragua_por_noche']) if (b[k] != null && String(b[k]).trim()) fijarAjuste(db, k, String(b[k]).trim())
    if (b.meta_ingresos_mes != null) fijarAjuste(db, 'meta_ingresos_mes', String(b.meta_ingresos_mes).trim())
    if (b.horario_fijo != null) fijarHorario(db, String(b.horario_fijo).trim() ? horarioDeTexto(String(b.horario_fijo)) : [])
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
  ['POST', /^\/api\/runs\/(\d+)\/comentario$/, (b, [r]) => comentarRun(db, id(r), b.comentario ?? null)],
  ['POST', /^\/api\/runs\/(\d+)\/minutos$/, (b, [r]) => ajustarMinutos(db, id(r), Number(b.mision), Number(b.minutos))],
  ['POST', /^\/api\/runs\/(\d+)\/pasar$/, (_, [r]) => pasarASiguiente(db, id(r))],
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
  ['POST', /^\/api\/misiones\/(\d+)\/armado$/, (b, [m]) => opinarArmado(db, id(m), b.armado ?? null, 'porQue' in b ? b.porQue : undefined)],
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
  ['POST', /^\/api\/directo\/(\d+)\/informe$/, async (_, [s]) => rehacerInforme(db, id(s))],
  ['POST', /^\/api\/directo\/(\d+)\/propuesta$/, (b, [s]) => resolverPropuestas(db, id(s), Array.isArray(b.ids) ? b.ids.map(String) : [], b.accion, Date.now(), { cambios: b.cambios && typeof b.cambios === 'object' ? b.cambios : undefined })],
  ['POST', /^\/api\/directo\/(\d+)\/cerrar$/, async (_, [s]) => {
    await colasDirecto.get(id(s)) // lo último que mandó el navegador entra al informe
    const r = await cerrarDirecto(db, id(s))
    if (r.informe) mensajeDeMastropiero(db, conversacionHoy(db).id, `Cerré el Directo. ${r.informe}`)
    return r
  }],
  ['GET', /^\/api\/cuentas$/, () => ({ cuentas: listarCuentas(db), publicaciones: listarPublicaciones(db, { limite: 200 }), modos: MODOS, conectores: CONECTORES, telegram: telegramConfigurado() })],
  ['POST', /^\/api\/cuentas$/, (b) => guardarCuenta(db, { id: b.id ? Number(b.id) : undefined, red: b.red, usuario: b.usuario, modo: b.modo, conector: b.conector, reglas: b.reglas, activa: b.activa })],
  ['GET', /^\/api\/cuentas\/(\d+)$/, (_, [c]) => {
    const a = leerAgente(db, id(c))
    if (!a) throw new Error(`No existe la cuenta ${c}`)
    return a
  }],
  ['POST', /^\/api\/cuentas\/(\d+)\/redactar$/, async (b, [c]) => redactarPublicaciones(db, id(c), { n: Number(b.n) || 3, tema: b.tema || null })],
  ['POST', /^\/api\/publicaciones\/(\d+)$/, (b, [p]) => resolverPublicacion(db, id(p), { accion: b.accion, texto: b.texto, cuando: b.cuando ? Number(b.cuando) : null, url: b.url || null })],
  ['GET', /^\/api\/taller$/, (_, __, q) => {
    const obras = libreria(db, { tipo: q.get('tipo') || undefined, q: q.get('q') || undefined })
    const cuenta: Record<string, number> = {}
    for (const o of libreria(db)) cuenta[o.ultima.tipo] = (cuenta[o.ultima.tipo] ?? 0) + 1
    return { obras, haciendo: listarArtefactos(db, { limite: 40 }).filter((a) => a.estado === 'haciendo'), cuenta, voces: VOCES, estilos: Object.fromEntries(Object.entries(ESTILOS).map(([k, v]) => [k, v.nombre])), aspectos: Object.fromEntries(Object.entries(ASPECTOS).map(([k, v]) => [k, v.nombre])), ffmpeg: hayFfmpeg(), artefactos: listarArtefactos(db, { limite: 80 }) }
  }],
  ['GET', /^\/api\/taller\/sugerencias$/, async (_, __, q) => ({ sugerencias: await sugerenciasTaller(db, q.get('tipo') || 'imagen') })],
  ['POST', /^\/api\/taller\/(\d+)\/borrar$/, (_, [a]) => (borrarArtefacto(db, id(a)), { ok: true })],
  // Crear corre en segundo plano (un video tarda minutos): la pantalla ve el avance en la lista.
  ['POST', /^\/api\/taller$/, (b) => {
    const pedido = String(b.pedido ?? '').trim()
    if (!pedido && !(b.tipo === 'personaje' && b.entidadId)) throw new Error('Decime qué querés crear')
    const n = (v: unknown) => (v == null || v === '' ? null : Number(v))
    const crear = {
      juego: () => crearJuego(db, pedido, { personajeId: n(b.personajeId), entidadId: n(b.entidadId) }),
      imagen: () => crearImagen(db, pedido, { modelo: b.modelo || undefined, aspecto: b.aspecto || undefined, estilo: b.estilo || null, variantes: n(b.variantes) ?? 1 }),
      voz: () => (b.modo === 'charla' ? crearCharla(db, pedido, { voces: Array.isArray(b.voces) ? b.voces : undefined }) : crearVoz(db, pedido, { voz: b.voz || undefined })),
      personaje: () => crearPersonaje(db, pedido, { entidadId: n(b.entidadId) }),
      video: () => crearVideo(db, pedido, { personajeId: n(b.personajeId), voz: b.voz || undefined, formato: b.formato || undefined, escenas: n(b.escenas) ?? undefined, movimiento: b.movimiento !== false }),
    }[b.tipo as string]
    if (!crear) throw new Error('Tipo inválido')
    void crear().catch((e) => console.error('  taller:', e))
    return { ok: true }
  }],
  // La matriz de un término (sus ejes) y los homónimos.
  ['GET', /^\/api\/entidades\/(\d+)\/ejes$/, (_, [e]) => ejesDe(db, id(e))],
  ['POST', /^\/api\/entidades\/(\d+)\/acepciones$/, async (_, [e]) => ({ acepciones: await acepciones(db, id(e)) })],
  ['POST', /^\/api\/entidades\/(\d+)\/separar$/, (b, [e]) => separarEntidad(db, id(e), { nombre: String(b.nombre ?? ''), tipo: b.tipo, notas: b.notas ?? null, piezas: (Array.isArray(b.piezas) ? b.piezas : []).map(Number) })],
  // Anotaciones: un bloque de notas suyas se procesa de una (pieza, memoria, propuestas «diseño», entidades, quántomos).
  ['POST', /^\/api\/anotaciones$/, async (b) => procesarAnotaciones(db, String(b.texto ?? ''), { fecha: b.fecha || null })],
  // El Estudio: posproducción de un video (las subidas crudas van más abajo).
  ['GET', /^\/api\/estudio$/, () => ({
    proyectos: libreria(db, { tipo: 'estudio' }),
    videos: listarArtefactos(db, { tipo: 'video', limite: 40 }).filter((a) => a.estado === 'listo' && a.archivos.includes('video.mp4')),
    imagenes: listarArtefactos(db, { tipo: 'imagen', limite: 40 }).filter((a) => a.estado === 'listo'),
    plantillas: estudio.plantillas(db),
    cuentas: listarCuentas(db).filter((c) => c.modo !== 'lectura').map((c) => ({ id: c.id, red: c.red, usuario: c.usuario })),
    ffmpeg: hayFfmpeg(),
  })],
  ['GET', /^\/api\/estudio\/(\d+)$/, (_, [e]) => {
    const { a, p } = estudio.proyectoDe(db, id(e))
    const obra = libreria(db, { tipo: 'estudio' }).find((o) => o.versiones.some((v) => v.id === a.id))
    const versiones = (obra?.versiones ?? []).map((v) => listarArtefactos(db, { tipo: 'estudio', limite: 200 }).find((x) => x.id === v.id)).filter(Boolean)
    return { artefacto: a, proyecto: { ...p, deshacer: undefined, puedeDeshacer: !!p.deshacer?.length }, fuente: `/taller/${p.fuente.artefacto}/${p.fuente.archivo}`, versiones, tarea: tareasEstudio.get(a.id) ?? null }
  }],
  ['POST', /^\/api\/estudio\/nuevo$/, (b) => estudio.crearEstudio(db, { desdeArtefacto: Number(b.desdeArtefacto) })],
  ['POST', /^\/api\/estudio\/(\d+)$/, (b, [e]) => ({ ...estudio.guardarEstudio(db, id(e), b), deshacer: undefined })],
  ['POST', /^\/api\/estudio\/(\d+)\/deshacer$/, (_, [e]) => ({ ...estudio.deshacerEstudio(db, id(e)), deshacer: undefined })],
  ['POST', /^\/api\/estudio\/(\d+)\/agente$/, async (b, [e]) => { const r = await estudio.agenteDeCapas(db, id(e), String(b.pedido ?? '')); return { mensaje: r.mensaje, hechas: r.hechas } }],
  ['POST', /^\/api\/estudio\/(\d+)\/transcribir$/, (_, [e]) => {
    const n = id(e)
    if (tareasEstudio.get(n)?.activa) throw new Error('Ya estoy transcribiendo este video')
    tareasEstudio.set(n, { activa: true, que: 'transcribiendo', error: null })
    void estudio.transcribirEstudio(db, n).then(() => tareasEstudio.set(n, { activa: false, que: 'transcribiendo', error: null }))
      .catch((x) => tareasEstudio.set(n, { activa: false, que: 'transcribiendo', error: x instanceof Error ? x.message : String(x) }))
    return { empezado: true }
  }],
  ['POST', /^\/api\/estudio\/(\d+)\/exportar$/, (_, [e]) => { void estudio.exportarEstudio(db, id(e)).catch((x) => console.error('  estudio:', x)); return { empezado: true } }],
  ['POST', /^\/api\/estudio\/(\d+)\/momentos$/, async (_, [e]) => ({ momentos: await estudio.momentosEstudio(db, id(e)) })],
  ['POST', /^\/api\/estudio\/(\d+)\/plantilla$/, (b, [e]) => estudio.guardarPlantilla(db, id(e), { nombre: String(b.nombre ?? ''), marca: b.marca ?? null, entidadId: b.entidadId ? Number(b.entidadId) : null })],
  ['POST', /^\/api\/estudio\/(\d+)\/plantilla\/(\d+)$/, (_, [e, pl]) => ({ ...estudio.aplicarPlantilla(db, id(e), id(pl)), deshacer: undefined })],
  ['POST', /^\/api\/estudio\/(\d+)\/publicar$/, async (b, [e]) => estudio.mandarACuentas(db, id(e), Number(b.cuentaId))],
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
  ['GET', /^\/api\/libreria$/, (_, __, q) => ({
    obras: listarObras(db, { tipo: q.get('tipo') || null, q: q.get('q') || null, estado: q.get('estado') || null }), conteos: conteosLibreria(db), panorama: panorama(db),
    poblando: poblando.activo ? poblando.paso : null, expandiendo: expandiendo.activo ? { ...expandiendo } : null,
  })],
  ['POST', /^\/api\/libreria\/expandir$/, (b) => {
    void expandirTanda(db, Math.min(Number(b.limite) || 20, 100)).then((r) => mensajeDeMastropiero(db, conversacionHoy(db).id, `Expandí tu Librería: ${r.hechas} obras con su fuente en el corpus${r.sinFuente ? ` (${r.sinFuente} sin fuente encontrada)` : ''}.`))
      .catch((e) => console.error('  libreria:', e instanceof Error ? e.message : e))
    return { empezada: true }
  }],
  ['POST', /^\/api\/libreria\/(\d+)\/expandir$/, async (_, [o]) => expandirObra(db, id(o))],
  ['POST', /^\/api\/libreria\/(\d+)\/cuaderno$/, async (_, [o]) => cuadernoDeObra(db, id(o))],
  ['POST', /^\/api\/libreria$/, (b) => agregarObra(db, { ...b, origen: 'operador' })],
  ['POST', /^\/api\/libreria\/poblar$/, () => {
    // Solo avisa si entró algo, con los títulos (antes avisaba «0 obras nuevas» y se contradecía).
    void poblarLibreria(db).then((r) => { const t = avisoLibreria(r); if (t) mensajeDeMastropiero(db, conversacionHoy(db).id, t) })
      .catch((e) => console.error('  libreria:', e instanceof Error ? e.message : e))
    return { empezada: true }
  }],
  ['POST', /^\/api\/libreria\/(\d+)$/, (b, [o]) => editarObra(db, id(o), b) ?? { borrada: true }],

  // Telegram: estado del canal y un mensaje de prueba
  // Salud: el día, la semana, los registros y las metas
  ['GET', /^\/api\/salud$/, (_, __, q) => {
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(q.get('fecha') ?? '') ? q.get('fecha')! : fechaLocal()
    return { dia: resumenDia(db, fecha), semana: resumenSemana(db, fecha) }
  }],
  ['POST', /^\/api\/salud$/, (b) => registrarSalud(db, { ...b, fuente: 'pantalla' })],
  ['POST', /^\/api\/salud\/metas$/, (b) => fijarMetasSalud(db, b)],
  ['POST', /^\/api\/salud\/(\d+)$/, (b, [r]) => (b.borrar ? (borrarSalud(db, id(r)), { ok: true }) : editarSalud(db, id(r), b))],
  // Los Cien Días: el día (verbos, hábitos, WOOP, tareas), el mapa y lo que se marca
  ['GET', /^\/api\/cien$/, (_, __, q) => {
    const d = diaDelPlan(db, /^\d{4}-\d{2}-\d{2}$/.test(q.get('fecha') ?? '') ? q.get('fecha')! : fechaLocal())
    return d ? { ...d, mapa: mapaDelPlan(db, d.plan) } : { plan: null }
  }],
  ['POST', /^\/api\/cien\/voto$/, (b) => votar(db, String(b.fecha), String(b.verbo), typeof b.valor === 'boolean' ? b.valor : undefined)],
  ['POST', /^\/api\/cien\/habito$/, (b) => marcarHabito(db, String(b.fecha), String(b.id), typeof b.valor === 'boolean' ? b.valor : undefined)],
  ['POST', /^\/api\/cien\/woop$/, (b) => guardarWoop(db, String(b.fecha), b)],
  ['POST', /^\/api\/cien\/nota$/, (b) => guardarNota(db, String(b.fecha), { nota: b.nota, peso: b.peso === '' ? null : b.peso })],
  ['POST', /^\/api\/cien\/tarea\/(\d+)$/, (b, [m]) => marcarTarea(db, id(m), !!b.hecha)],
  // Quiero aprender: temas, prácticas, recursos y el repaso espaciado
  ['GET', /^\/api\/aprender$/, () => ({
    aprendizajes: listarAprendizajes(db),
    repaso: (db.prepare(`SELECT id, texto, por_que, tema, vuelve_en, repaso FROM preguntas WHERE origen = 'repaso' AND estado = 'pendiente' ORDER BY vuelve_en`).all() as any[])
      .map((p) => ({ id: p.id, texto: p.texto, porQue: p.por_que, tema: p.tema, vuelveEn: p.vuelve_en, vuelta: p.repaso, toca: p.vuelve_en <= Date.now() })),
  })],
  ['POST', /^\/api\/aprender$/, async (b) => {
    const a = crearAprendizaje(db, { tema: b.tema, porQue: b.porQue, nivelActual: b.nivelActual, nivelObjetivo: b.nivelObjetivo })
    const ev = await import('./evidencia.ts')
    const previos = await ev.buscarPrevios(db, 'aprendizaje', a.id, `${a.tema}. ${a.porQue ?? ''}`).catch(() => [])
    return { ...a, previos, yaEmpezaste: ev.textoYaEmpezaste(previos) }
  }],
  // El libro de evidencia: quién quiere ser y los hechos que lo votan; y el foco (del Directo).
  ['GET', /^\/api\/identidades$/, async () => ({ identidades: (await import('./evidencia.ts')).libroDeEvidencia(db), opciones: {
    primarias: listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', estados: ['activa'], limite: 30 }).map((m) => ({ id: m.id, titulo: m.titulo })),
    habitos: db.prepare('SELECT id, titulo FROM habitos WHERE activo = 1 ORDER BY orden').all(),
    aprendizajes: db.prepare(`SELECT id, tema FROM aprendizajes WHERE estado = 'activo' ORDER BY id`).all(),
  } })],
  ['POST', /^\/api\/identidades$/, async (b) => (await import('./evidencia.ts')).crearIdentidad(db, { frase: b.frase, historiaVieja: b.historiaVieja ?? null, ataduras: b.ataduras ?? {} })],
  ['POST', /^\/api\/identidades\/(\d+)$/, async (b, [i]) => (await import('./evidencia.ts')).editarIdentidad(db, id(i), b)],
  ['POST', /^\/api\/identidades\/(\d+)\/evidencia$/, async (b, [i]) => { (await import('./evidencia.ts')).anotarEvidencia(db, id(i), b.texto, b.fecha ?? null); return { ok: true } }],
  // Discovery para clientes: encargos, áreas, entrevistas, logs, as-is, to-be, hoja de valor y sombra.
  ['GET', /^\/api\/encargos$/, async () => ({ encargos: (await import('./discovery.ts')).listarEncargos(db) })],
  ['POST', /^\/api\/encargos$/, async (b) => (await import('./discovery.ts')).crearEncargo(db, { cliente: b.cliente, nombre: b.nombre ?? null, departamento: b.departamento ?? null, notas: b.notas ?? null })],
  ['GET', /^\/api\/encargos\/(\d+)$/, async (_, [e]) => ({ ...(await import('./discovery.ts')).fichaEncargo(db, id(e)), enLaNube: enLaNube() })],
  ['POST', /^\/api\/encargos\/(\d+)$/, async (b, [e]) => (await import('./discovery.ts')).editarEncargo(db, id(e), b)],
  ['POST', /^\/api\/encargos\/(\d+)\/areas$/, async (b, [e]) => (await import('./discovery.ts')).guardarArea(db, id(e), b)],
  ['POST', /^\/api\/encargos\/(\d+)\/entrevistas$/, async (b, [e]) => (await import('./discovery.ts')).agregarEntrevista(db, id(e), { quien: b.quien ?? null, rol: b.rol ?? null, area: b.area ?? null, texto: b.texto ?? null })],
  ['POST', /^\/api\/encargos\/(\d+)\/personas$/, async (b, [e]) => ({ champions: (await import('./discovery.ts')).sumarPersona(db, id(e), b) })],
  ['POST', /^\/api\/encargos\/(\d+)\/guia$/, async (b, [e]) => { soloNube('La guía'); return (await import('./discovery.ts')).guiaDeEntrevista(db, id(e), String(b.area ?? '')) }],
  ['POST', /^\/api\/encargos\/(\d+)\/asis$/, async (b, [e]) => { soloNube('El as-is'); return (await import('./discovery.ts')).armarAsis(db, id(e), String(b.area ?? '')) }],
  ['GET', /^\/api\/encargos\/(\d+)\/valor$/, async (_, [e]) => ({ md: (await import('./discovery.ts')).hojaDeValor(db, id(e)) })],
  ['GET', /^\/api\/procesos\/yo$/, async () => ({ procesos: (await import('./procesos.ts')).misProcesos(db), enLaNube: enLaNube() })],
  ['POST', /^\/api\/procesos\/yo\/descubrir$/, async () => { soloNube('El discovery de tu semana'); return (await import('./procesos.ts')).descubrirMisProcesos(db) }],
  ['POST', /^\/api\/encargos\/(\d+)\/ahorros$/, async (b, [e]) => ({ tablero: (await import('./procesos.ts')).anotarAhorro(db, id(e), { personaId: Number(b.personaId), minutos: Number(b.minutos), que: b.que ?? null, semana: b.semana ?? null }) })],
  ['POST', /^\/api\/procesos\/(\d+)\/tobe$/, async (_, [p]) => { soloNube('El to-be'); return (await import('./discovery.ts')).armarTobe(db, id(p)) }],
  ['POST', /^\/api\/procesos\/(\d+)\/paso\/(\d+)$/, async (b, [p, n]) => (await import('./discovery.ts')).editarPaso(db, id(p), Number(n), b)],
  ['POST', /^\/api\/procesos\/(\d+)\/kpis$/, async (b, [p]) => (await import('./discovery.ts')).guardarKpis(db, id(p), b.kpis)],
  ['POST', /^\/api\/procesos\/(\d+)\/kpis\/proponer$/, async (_, [p]) => { soloNube('Los KPIs'); return (await import('./discovery.ts')).proponerKpis(db, id(p)) }],
  // El modo sombra: la bandeja de lo que espera tu ok, deshacer lo que hizo solo, y cuánto acierta cada cosa.
  ['GET', /^\/api\/bandeja$/, async () => (await import('./sombra.ts')).bandeja(db)],
  ['POST', /^\/api\/bandeja\/(\w+)\/(\d+)$/, async (b, [t, i]) => { (await import('./sombra.ts')).resolverBandeja(db, t, id(i), b.accion); return { ok: true } }],
  ['POST', /^\/api\/decisiones\/(\d+)\/deshacer$/, async (_, [d]) => (await import('./sombra.ts')).deshacerDecision(db, id(d))],
  ['GET', /^\/api\/sombra$/, async () => ({ tipos: (await import('./decisiones.ts')).estadoSombra(db) })],
  ['POST', /^\/api\/sombra$/, async (b) => { (await import('./decisiones.ts')).fijarModo(db, String(b.tipo ?? ''), b.modo); return { ok: true } }],
  // Velocidad: cuánto tarda cada ruta y cuánto se traba el servidor (para medir antes y después de optimizar).
  ['GET', /^\/api\/velocidad$/, () => velocidad()],
  ['POST', /^\/api\/velocidad\/reiniciar$/, () => { reiniciarVelocidad(); return velocidad() }],
  // Sueños, consejo de modelos y apps conectadas.
  ['GET', /^\/api\/suenos$/, async () => (await import('./suenos.ts')).vistaSuenos(db)],
  ['POST', /^\/api\/suenos$/, async (b) => {
    const sn = await import('./suenos.ts')
    const s = await sn.registrarSueno(db, { texto: b.texto, fecha: b.fecha ?? null, despertar: b.despertar ?? null, lucido: b.lucido ?? null, emociones: b.emociones ?? null, nota: b.nota ?? null, origen: 'manual' })
    if (enLaNube()) void sn.destilarSueno(db, s.id).catch(() => {})
    return s
  }],
  ['POST', /^\/api\/suenos\/(\d+)\/destilar$/, async (_, [s]) => {
    if (!enLaNube()) throw new Error('Los sueños se leen en la nube (gastan tokens de NaN)')
    return (await import('./suenos.ts')).destilarSueno(db, id(s))
  }],
  ['GET', /^\/api\/modelos$/, async () => {
    const m = await import('./modelos.ts')
    return { modelos: m.listarModelos(db), enLaNube: enLaNube() }
  }],
  ['POST', /^\/api\/modelos$/, async (b) => (await import('./modelos.ts')).sumarModelo(db, { entidadId: b.entidadId ? Number(b.entidadId) : null, nombre: b.nombre ?? null })],
  ['POST', /^\/api\/modelos\/(\d+)\/quitar$/, async (_, [m]) => { (await import('./modelos.ts')).quitarModelo(db, id(m)); return { ok: true } }],
  ['POST', /^\/api\/modelos\/(\d+)\/manual$/, async (_, [m]) => {
    if (!enLaNube()) throw new Error('El manual se arma en la nube (gasta tokens de NaN): pedilo desde tu Deprocast en la nube.')
    return (await import('./modelos.ts')).armarManual(db, id(m))
  }],
  ['POST', /^\/api\/modelos\/(\d+)\/que-haria$/, async (b, [m]) => (await import('./modelos.ts')).queHaria(db, id(m), String(b.situacion ?? ''))],
  ['POST', /^\/api\/modelos\/(\d+)\/hablar$/, async (_, [m]) => {
    const md = (await import('./modelos.ts')).leerModelo(db, id(m))
    if (!md) throw new Error('Ese modelo no está en tu consejo')
    const ya = db.prepare(`SELECT id FROM conversaciones WHERE con = ? AND archivada = 0 ORDER BY actualizada_en DESC LIMIT 1`).get(`modelo:${md.id}`) as { id: number } | undefined
    if (ya) return { id: ya.id }
    const c = crearConversacion(db, `modelo:${md.id}`)
    db.prepare('UPDATE conversaciones SET titulo = ? WHERE id = ?').run(`Con ${md.nombre}`, c.id)
    return { id: c.id }
  }],
  ['GET', /^\/api\/apps-conectadas$/, async () => { const a = await import('./apps.ts'); return { apps: a.listarApps(db), permisos: a.PERMISOS } }],
  ['POST', /^\/api\/apps-conectadas$/, async (b) => (await import('./apps.ts')).crearApp(db, String(b.nombre ?? ''), Array.isArray(b.permisos) ? b.permisos : ['suenos'])],
  ['POST', /^\/api\/apps-conectadas\/(\d+)\/revocar$/, async (_, [a]) => { (await import('./apps.ts')).revocarApp(db, id(a)); return { ok: true } }],
  ['GET', /^\/api\/foco$/, async (_, __, q) => (await import('./foco.ts')).tendenciaFoco(db, Math.min(60, Number(q.get('dias')) || 14))],
  ['GET', /^\/api\/aprender\/(\d+)$/, (_, [a]) => {
    const x = leerAprendizaje(db, id(a))
    if (!x) throw new Error(`No existe el aprendizaje ${a}`)
    return { aprendizaje: x, practicas: practicasDe(db, x.id), recursos: recursosDe(db, x.tema) }
  }],
  ['POST', /^\/api\/aprender\/(\d+)$/, (b, [a]) => editarAprendizaje(db, id(a), b) ?? { ok: true }],
  ['POST', /^\/api\/aprender\/(\d+)\/practica$/, (b, [a]) => {
    const r = registrarPractica(db, { aprendizajeId: id(a), minutos: b.minutos, que: b.que, notas: b.notas, fecha: b.fecha, fuente: 'pantalla' })
    void prepararRepaso(db, r.aprendizaje, r.practica).catch(() => {})
    return r
  }],
  ['POST', /^\/api\/repaso\/(\d+)$/, async (b, [p]) => responderPregunta(db, id(p), b.respuesta ?? null)],
  // YouTube: la cola (videos y canales), importar varios, y lo que lee la compu (la nube no puede leer YouTube).
  ['GET', /^\/api\/youtube$/, async () => (await import('./youtube.ts')).estadoYoutube(db)],
  ['POST', /^\/api\/youtube\/importar$/, async (b) => (await import('./youtube.ts')).importarYoutube(db, String(b.texto ?? ''), { max: Number(b.max) || null })],
  ['GET', /^\/api\/youtube\/compu$/, async () => ({ items: (await import('./youtube.ts')).paraLaCompu(db) })],
  ['POST', /^\/api\/youtube\/leido$/, async (b) => (await import('./youtube.ts')).recibirDeLaCompu(db, b)],
  ['POST', /^\/api\/youtube\/reintentar$/, async () => {
    const y = await import('./youtube.ts')
    const n = Number(db.prepare(`UPDATE youtube_cola SET estado = 'pendiente', intentos = 0, motivo = NULL WHERE estado IN ('fallo', 'sin_subtitulos')`).run().changes) + Number(y.reintentarConServicio(db))
    void y.trabajarYoutube(db).catch(() => {})
    return { reintentados: n }
  }],
  // Un link: se lee y se guarda en Markdown; si es un sitio con índice (o se pide), se rastrea y arma un cuaderno
  ['POST', /^\/api\/links$/, async (b) => {
    const { procesarLink } = await import('./lector/index.ts')
    const r = await procesarLink(db, String(b.url ?? ''), {
      nota: b.nota ?? null, rastrear: typeof b.rastrear === 'boolean' ? b.rastrear : undefined,
      alTerminar: (x) => mensajeDeMastropiero(db, conversacionHoy(db).id, `🕸 Rastreé ${x.paginas} página${x.paginas === 1 ? '' : 's'} de «${x.titulo}»: están juntas en un cuaderno (Cuadernos).`),
    })
    return { pieza: r.piezaId, nueva: r.nueva, titulo: r.lectura?.titulo ?? null, palabras: r.lectura?.palabras ?? null, aviso: r.lectura?.aviso ?? null, rastreando: r.rastreando }
  }],
  // Captura con palabras («almorcé milanesa con ensalada», «gasté 12 en el súper»): se clasifica y se registra
  ['POST', /^\/api\/captura$/, async (b) => {
    const c = await clasificar(db, { texto: String(b.texto ?? '') })
    return { captura: c, registrado: c.tipo !== 'otro' && c.confianza >= 0.5 ? registrarCaptura(db, c, { fuente: 'pantalla' }) : null }
  }],
  // Mudanza: lo que la nube tiene (para que la compu vea que llegó todo)
  ['GET', /^\/api\/mudanza$/, () => ({
    conteos: Object.fromEntries(['corpus', 'memoria', 'entidades', 'misiones', 'mensajes', 'movimientos', 'salud', 'obras', 'cargas'].map((t) => {
      try { return [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n] } catch { return [t, 0] }
    })),
  })],
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
  ['GET', /^\/api\/fragua$/, () => ({ rama: ramaActual(), forjas: listarForjas(db).map(({ diff: _, ...f }) => ({ ...f, paso: pasoDeForja.get(f.id) ?? null })), propuestas: db.prepare(`SELECT id, titulo, detalle, area, prioridad, estado FROM propuestas WHERE estado = 'abierta' ORDER BY id DESC`).all() })],
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
  ['GET', /^\/api\/criba$/, (_, __, q) => ({ pieza: siguiente(db, { nivel: q.get('nivel') || null, orden: q.get('orden') || null, saltear: (q.get('saltear') ?? '').split(',').filter(Boolean).map(Number) }), marcador: marcador(db) })],
  // La nota sale con la puntuación (o al saltear): se guarda de fondo y el sistema decide si es algo para hacer.
  ['POST', /^\/api\/criba\/(\d+)\/nota$/, (b, [p]) => {
    if (b.hacer != null) return anotarEnCriba(db, id(p), String(b.texto ?? ''), { hacer: !!b.hacer })
    void anotarSolo(db, id(p), String(b.texto ?? '')).catch((e) => console.error('  criba nota:', e instanceof Error ? e.message : e))
    return { ok: true }
  }],
  ['POST', /^\/api\/criba\/deshacer$/, () => deshacerUltima(db)],
  ['POST', /^\/api\/criba\/(\d+)$/, (b, [p]) => {
    const m = cribar(db, id(p), Number(b.peso))
    if (String(b.nota ?? '').trim()) void anotarSolo(db, id(p), String(b.nota)).catch((e) => console.error('  criba nota:', e instanceof Error ? e.message : e))
    return m
  }],

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
  ['GET', /^\/api\/personas$/, (_, __, q) => conMatriz(db, personas(db, { q: q.get('q') || undefined, clase: q.get('clase') || undefined, estado: q.get('estado') || undefined, orden: q.get('orden') || undefined }))],
  ['POST', /^\/api\/personas\/nueva$/, (b) => nuevaPersona(db, b)],
  ['GET', /^\/api\/personas\/grafo$/, () => grafoPersonas(db)],
  // El reproceso (corre en la nube) y la línea temporal que arma.
  // El estado del Procesar hace ~20 conteos sobre tablas grandes y la pantalla lo pide cada 8 s: se reusa 15 s.
  ['GET', /^\/api\/reproceso$/, () => {
    if (!reprocesoReciente || Date.now() - reprocesoReciente.en > 15_000) reprocesoReciente = { en: Date.now(), valor: estadoReproceso(db) }
    return reprocesoReciente.valor
  }],
  ['POST', /^\/api\/reproceso$/, (b) => { reprocesoReciente = null; return controlarReproceso(db, String(b.accion ?? '')) }],
  ['GET', /^\/api\/linea$/, (_, __, q) => lineaTemporal(db, { desde: q.get('desde') || undefined, hasta: q.get('hasta') || undefined, entidad: num(q.get('entidad')) ?? undefined, tema: q.get('tema') || undefined, tipo: q.get('tipo') || undefined })],
  ['POST', /^\/api\/linea\/(\d+)$/, (b, [e]) => resolverEvento(db, id(e), b.accion === 'agendar' ? 'agendar' : 'descartar') ?? { ok: true }],
  ['POST', /^\/api\/personas\/(\d+)$/, (b, [p]) => guardarRelacion(db, id(p), b)],
  ['POST', /^\/api\/personas\/(\d+)\/proyectos$/, (b, [p]) => (b.quitar ? desvincularDeProyecto(db, id(p), Number(b.proyecto)) : vincularAProyecto(db, id(p), Number(b.proyecto), { rol: b.rol ?? null, importancia: b.importancia ?? null }))],
  ['GET', /^\/api\/yo$/, () => leerYo(db)],
  ['POST', /^\/api\/yo$/, (b) => guardarYo(db, { nombre: b.nombre, alias: Array.isArray(b.alias) ? b.alias : undefined, perfil: b.perfil })],

  // Finanzas
  ['GET', /^\/api\/finanzas$/, (_, __, q) => {
    const mes = q.get('mes') || fechaLocal().slice(0, 7)
    return { resumen: resumenMes(db, mes), movimientos: listarMovimientos(db, { mes }), porProyecto: resumenPorProyecto(db, mes), ritmo: mes === fechaLocal().slice(0, 7) ? ritmoMeta(db) : null, sugeridos: sugeridos(db) }
  }],
  ['POST', /^\/api\/finanzas$/, (b) => registrarMovimiento(db, b) ?? { repetido: true }],
  ['POST', /^\/api\/finanzas\/(\d+)$/, (b, [m]) => (editarMovimiento(db, id(m), b), { ok: true })],
  ['POST', /^\/api\/finanzas\/sugeridos\/(\d+)$/, (b, [m]) => resolverSugerido(db, id(m), b.accion === 'aceptar' ? 'aceptar' : 'descartar', { monto: b.monto != null ? Number(b.monto) : undefined, descripcion: b.descripcion }) ?? { descartado: true }],

  ['GET', /^\/api\/radar$/, () => ({
    oportunidades: listarOportunidades(db, { estados: ['nueva', 'me_interesa', 'hecha', 'descartada'], limite: 300 }), cuotas: cuotas(db), conBuscador: hayBuscadorWeb(),
    sinUbicar: (db.prepare(`SELECT COUNT(*) AS n FROM oportunidades WHERE ubicada IS NULL AND estado != 'descartada'`).get() as { n: number }).n,
    primarias: listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(), estados: ['activa'] }).map((m) => ({ id: m.id, titulo: m.titulo })),
  })],
  ['POST', /^\/api\/radar\/buscar$/, async (b) => {
    const r = await buscarOportunidades(db, { misionId: b.misionId ? Number(b.misionId) : null, texto: b.texto || null })
    // Las de antes del mapa se ubican de fondo (dónde y cuándo).
    void import('./radar.ts').then((x) => x.ubicarOportunidades(db, { max: 60 })).catch(() => {})
    return r
  }],
  ['POST', /^\/api\/radar\/ubicar$/, async () => (await import('./radar.ts')).ubicarOportunidades(db)],
  // El calendario: su Google (ida y vuelta) y lo que Deprocast sabe con fecha, por capas.
  ['GET', /^\/api\/calendario$/, async (_, __, q) => {
    const hoy = fechaLocal()
    const capas = q.get('capas') ? new Set(String(q.get('capas')).split(',')) : undefined
    return (await import('./agenda.ts')).itemsDelCalendario(db, q.get('desde') || hoy, q.get('hasta') || q.get('desde') || hoy, capas)
  }],
  ['GET', /^\/api\/calendario\/estado$/, async () => (await import('./agenda.ts')).estadoCalendario()],
  ['POST', /^\/api\/calendario$/, async (b) => (await import('./agenda.ts')).crearEvento({ titulo: String(b.titulo ?? ''), fecha: String(b.fecha ?? ''), hora: b.hora || null, duracionMin: Number(b.duracionMin) || null, lugar: b.lugar || null, descripcion: b.descripcion || null })],
  ['POST', /^\/api\/calendario\/llevar$/, async (b) => (await import('./agenda.ts')).llevarAGoogle(db, String(b.origen ?? ''), Number(b.id), { ...(b.fecha ? { fecha: String(b.fecha) } : {}), ...(b.hora !== undefined ? { hora: b.hora || null } : {}) })],
  ['POST', /^\/api\/calendario\/quitar$/, async (b) => ({ quitado: await (await import('./agenda.ts')).quitarDeGoogle(db, String(b.origen ?? ''), Number(b.id)) })],
  ['POST', /^\/api\/calendario\/evento\/([\w-]+)$/, async (b, [g]) => (await import('./agenda.ts')).editarEvento(g, {
    ...(b.titulo != null ? { titulo: String(b.titulo) } : {}), ...(b.fecha ? { fecha: String(b.fecha) } : {}), ...(b.hora !== undefined ? { hora: b.hora || null } : {}),
    ...(b.duracionMin != null ? { duracionMin: Number(b.duracionMin) || null } : {}), ...(b.lugar !== undefined ? { lugar: b.lugar || null } : {}), ...(b.descripcion !== undefined ? { descripcion: b.descripcion || null } : {}),
  })],
  ['POST', /^\/api\/calendario\/evento\/([\w-]+)\/borrar$/, async (_, [g]) => { await (await import('./agenda.ts')).borrarEvento(db, g); return { borrado: g } }],
  // El mapa: lugares, Línea, Radar, misiones y su calendario, por capas.
  ['GET', /^\/api\/mapa$/, async (_, __, q) => (await import('./mapa.ts')).puntosDelMapa(db, q.get('capas') ? new Set(String(q.get('capas')).split(',')) : undefined)],
  ['GET', /^\/api\/mapa\/buscar$/, async (_, __, q) => ({ lugar: await (await import('./mapa.ts')).ubicar(db, String(q.get('q') ?? '').slice(0, 200)) })],
  // Idiomas (la pista de aprendizaje) y las tarjetas de recuerdo activo.
  ['GET', /^\/api\/idiomas$/, async () => { const m = await import('./idiomas.ts'); return { idiomas: m.listarIdiomas(db), disponibles: m.IDIOMAS, niveles: m.NIVELES, abierta: m.practicaAbierta(db)?.aprendizajeId ?? null } }],
  ['POST', /^\/api\/idiomas$/, async (b) => (await import('./idiomas.ts')).crearIdioma(db, b)],
  ['POST', /^\/api\/idiomas\/(\d+)$/, async (b, [i]) => (await import('./idiomas.ts')).editarIdioma(db, id(i), b)],
  ['POST', /^\/api\/idiomas\/(\d+)\/abrir$/, async (_, [i]) => (await import('./idiomas.ts')).abrirPractica(db, id(i))],
  ['POST', /^\/api\/idiomas\/(\d+)\/responder$/, async (b, [i]) => (await import('./idiomas.ts')).responderPractica(db, id(i), { texto: String(b.texto ?? '') })],
  ['POST', /^\/api\/idiomas\/(\d+)\/cerrar$/, async (_, [i]) => { (await import('./idiomas.ts')).cerrarPractica(db, id(i)); return { ok: true } }],
  ['POST', /^\/api\/idiomas\/voz$/, async (b) => ({ url: await (await import('./idiomas.ts')).audioDeFrase(String(b.texto ?? ''), String(b.codigo ?? ''), dirAdjuntos()) })],
  // Lo que sigue volviendo (bucles abiertos) y lo que se aprende de lo consumido.
  ['GET', /^\/api\/bucles$/, async (_, __, q) => { const m = await import('./bucles.ts'); return { bucles: m.listarBucles(db, { limite: Number(q.get('limite')) || 7, estado: q.get('estado') || 'abierto' }), resumen: m.resumenBucles(db) } }],
  ['POST', /^\/api\/bucles\/(\d+)$/, async (b, [i]) => (await import('./bucles.ts')).cerrarBucle(db, id(i), String(b.final ?? ''), { fecha: b.fecha ?? null, hora: b.hora ?? null, motivo: b.motivo ?? null })],
  ['GET', /^\/api\/piezas\/(\d+)\/recordar$/, async (_, [p]) => (await import('./consumido.ts')).recordarPieza(db, id(p))],
  ['POST', /^\/api\/piezas\/(\d+)\/tarjetas$/, async (_, [p]) => {
    if (!(await import('./reproceso.ts')).enLaNube()) throw new Error('Las tarjetas se arman en la nube (gastan tokens de NaN): pedilas desde tu Deprocast en la nube.')
    const c = await import('./consumido.ts')
    const x = db.prepare('SELECT c.id, c.titulo, c.contenido, c.url, d.salida FROM corpus c LEFT JOIN takeout_destilado d ON d.pieza_id = c.id WHERE c.id = ?').get(id(p)) as any
    if (!x) throw new Error(`No existe la pieza ${p}`)
    return { nuevas: await c.tarjetasDePieza(db, { ...x, salida: x.salida ?? '{}' }), ...c.recordarPieza(db, id(p)) }
  }],
  ['GET', /^\/api\/tarjetas$/, async (_, __, q) => { const t = await import('./tarjetas.ts'); return { resumen: t.resumenTarjetas(db), paraHoy: t.paraRepasar(db, { mazo: q.get('mazo') || null, limite: Number(q.get('limite')) || 50 }) } }],
  ['POST', /^\/api\/tarjetas$/, async (b) => (await import('./tarjetas.ts')).crearTarjeta(db, { mazo: String(b.mazo || 'general'), frente: b.frente, dorso: b.dorso, contexto: b.contexto ?? null })],
  ['POST', /^\/api\/tarjetas\/(\d+)$/, async (b, [t]) => { const m = await import('./tarjetas.ts'); if (b.calidad === 'suspender') { m.suspenderTarjeta(db, id(t)); return { ok: true } } return m.responderTarjeta(db, id(t), b.calidad) }],
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
  ['POST', /^\/api\/entidades\/(\d+)$/, (b, [e]) => editarEntidad(db, id(e), { nombre: b.nombre, tipo: b.tipo, notas: b.notas, alias: Array.isArray(b.alias) ? b.alias : undefined, sumarAlias: b.sumarAlias, quitarAlias: Array.isArray(b.quitarAlias) ? b.quitarAlias : undefined })],
  ['POST', /^\/api\/entidades\/(\d+)\/fusionar$/, (b, [e]) => fusionarEntidades(db, id(e), (b.absorbe ?? []).map(Number))],
  ['POST', /^\/api\/entidades\/(\d+)\/soy-yo$/, (_, [e]) => marcarJugador(db, id(e))],
  ['POST', /^\/api\/inventario\/(\d+)$/, (b, [i]) => editarItem(db, id(i), b)],
  // Procesarte tarda más de lo que espera Cloudflare (100 s): corre de fondo y la pantalla pregunta cómo va.
  ['POST', /^\/api\/jugador\/procesar$/, () => {
    if (procesando.activo) return { empezado: false, activo: true }
    Object.assign(procesando, { activo: true, resultado: null, error: null })
    void procesarJugador(db)
      .then((r) => {
        procesando.resultado = r
        mensajeDeMastropiero(db, conversacionHoy(db).id, `Te procesé: ${r.historia ? 'una historia sugerida, ' : ''}${r.inventario} ítems de inventario, ${r.principales} candidatas a principal y ${r.primarias} primarias. Todo queda como sugerencia en Jugador y Misiones.`)
      })
      .catch((e) => { procesando.error = e instanceof Error ? e.message : String(e) })
      .finally(() => { procesando.activo = false })
    return { empezado: true, activo: true }
  }],
  ['GET', /^\/api\/jugador\/procesar$/, () => procesando],
  ['POST', /^\/api\/rutinas\/([a-z_]+)$/, (b, [r]) => (actualizarRutina(db, r, { hora: b.hora, dias: b.dias, activa: b.activa }), listarRutinas(db))],
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
    return { entidad, coocurrencias: coocurrencias(db, entidad.id, 16), conexiones: conexionesDe(db, entidad.id), ...listarPiezas(db, { entidad: entidad.id, limite: 30, desde: num(q.get('desde')) }) }
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
    novedad: q.get('novedad') || undefined,
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
  ['GET', /^\/api\/quantomos\/grupos$/, () => gruposProto(db)],
  // La Mano: robar cinco cartas sin pesar y jugarlas de a una (la respuesta vuelve enseguida, sin modelo).
  ['GET', /^\/api\/mano$/, async (_, __, q) => {
    const m = await import('./mano.ts')
    return { mazo: m.composicion(db), cartas: m.robar(db, { saltear: (q.get('saltear') ?? '').split(',').filter(Boolean).map(Number) }), sorpresas: m.sorpresasPendientes(db) }
  }],
  ['GET', /^\/api\/mano\/sorpresas$/, async () => ({ sorpresas: (await import('./mano.ts')).sorpresasPendientes(db) })],
  ['POST', /^\/api\/mano\/choque$/, async (b) => (await import('./mano.ts')).marcarChoque(db, Number(b.nueva), Number(b.vieja))],
  ['POST', /^\/api\/mano\/sorpresas\/(\d+)$/, async (b, [k]) => (await import('./mano.ts')).responderSorpresa(db, id(k), String(b.respuesta ?? ''), b.porque ?? null)],
  ['POST', /^\/api\/mano\/(\d+)$/, async (b, [k]) => (await import('./mano.ts')).jugar(db, id(k), { gesto: b.gesto, peso: b.peso == null ? null : Number(b.peso), porque: b.porque ?? null })],
  ['POST', /^\/api\/mano\/deshacer$/, async () => (await import('./mano.ts')).deshacerJugada(db) ?? { quantomoId: null }],
  ['POST', /^\/api\/quantomos\/lote$/, (b) => pedirLote(db, Array.isArray(b.ids) ? b.ids.map(Number) : [])],
  ['POST', /^\/api\/quantomos\/lote\/sellar$/, (b) => sellarLote(db, Array.isArray(b.ids) ? b.ids.map(Number) : [], Number(b.peso))],
  ['POST', /^\/api\/quantomos\/lote\/descartar$/, (b) => descartarLote(db, Array.isArray(b.ids) ? b.ids.map(Number) : [], String(b.motivo ?? ''))],
]

const TIPOS_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.webp': 'image/webp',
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

type Importacion = { estado: 'importando' | 'listo' | 'error'; leidos: number; total: number; resultado?: { tablas: number; filas: number; archivos: number; respaldo: string | null }; error?: string }
/** Las importaciones grandes en curso o recién terminadas (la página pregunta por su id). */
const importaciones = new Map<string, Importacion>()

function leerCrudo(req: http.IncomingMessage, max: number): Promise<Buffer> {
  if (enVercel()) max = Math.min(max, 4 * 1024 * 1024)
  return new Promise((ok, mal) => {
    let largo = 0
    const partes: Buffer[] = []
    req.on('data', (c: Buffer) => {
      largo += c.length
      if (largo > max) {
        mal(new Error(enVercel()
          ? 'Demasiado grande: en Vercel un pedido no puede pasar de 4 MB'
          : `Demasiado grande (máximo ${Math.round(max / 1024 / 1024)} MB)`))
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

/** Lo que gasta tokens se pide desde la nube. */
function soloNube(que: string) {
  if (!enLaNube()) throw new Error(`${que}: lo arma Mastropiero en la nube (gasta tokens de NaN). Pedilo desde tu Deprocast en la nube.`)
}

/**
 * Las apps conectadas (Morpheon y las que vengan): con su token (Authorization: Bearer), sin la clave de la pantalla.
 * Solo estas rutas: GET /api/apps/yo, POST /api/apps/suenos (JSON, multipart con «audio», o el audio crudo) y POST
 * /api/apps/eventos. Sin token o revocado: 401; sin el permiso: 403.
 */
async function atenderApp(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const responder = (codigo: number, cuerpo: unknown) => void res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(cuerpo))
  const apps = await import('./apps.ts')
  const ruta = url.pathname.slice('/api/apps/'.length)
  if (!['yo', 'suenos', 'eventos'].includes(ruta)) return responder(404, { error: 'Ruta desconocida' })
  const permiso = ruta === 'yo' ? undefined : (ruta as 'suenos' | 'eventos')
  const { app, motivo } = apps.autenticarApp(db, req.headers.authorization, permiso)
  if (!app) return responder(motivo === 'sin_permiso' ? 403 : 401, { error: motivo === 'sin_permiso' ? `Esta app no tiene permiso para ${permiso}` : 'Falta el token o no es válido (Authorization: Bearer dpc_…)' })
  try {
    if (ruta === 'yo') return req.method === 'GET' ? responder(200, { app: app.nombre, permisos: app.permisos }) : responder(405, { error: 'Usá GET' })
    if (req.method !== 'POST') return responder(405, { error: 'Usá POST' })
    const tipo = String(req.headers['content-type'] ?? '')
    const crudo = await leerCrudo(req, 30 * 1024 * 1024)
    let campos: Record<string, any> = {}
    let audio: { nombre: string; datos: Buffer } | null = null
    if (/multipart\/form-data/i.test(tipo)) {
      const m = apps.leerMultipart(crudo, tipo)
      campos = m.campos
      const a = m.archivos.audio ?? Object.values(m.archivos)[0]
      if (a) audio = { nombre: a.nombre, datos: a.datos }
    } else if (/^audio\//i.test(tipo)) {
      campos = Object.fromEntries(url.searchParams)
      audio = { nombre: url.searchParams.get('nombre') || `sueno.${tipo.split('/')[1]?.split(';')[0] || 'm4a'}`, datos: crudo }
    } else {
      try { campos = crudo.length ? JSON.parse(crudo.toString('utf8')) : {} } catch { return responder(400, { error: 'JSON inválido' }) }
    }
    if (ruta === 'suenos') {
      const sn = await import('./suenos.ts')
      const v = (x: unknown) => (x == null || x === '' ? null : x === true || x === 'true' || x === '1' || x === 1)
      const s = await sn.registrarSueno(db, {
        texto: campos.texto ?? null, audio: audio?.datos ?? null, nombreAudio: audio?.nombre, fecha: campos.fecha ?? null, despertar: campos.despertar ?? null,
        duracionMin: campos.duracion_min ?? campos.duracion ?? null, lucido: v(campos.lucido), emociones: campos.emociones ?? null, nota: campos.nota ?? null, origen: `app:${app.nombre}`,
      })
      if (enLaNube()) void sn.destilarSueno(db, s.id).catch((e) => console.error('  sueño:', e instanceof Error ? e.message : e))
      return responder(201, { id: s.id, fecha: s.fecha, texto: s.texto, estado: s.estado })
    }
    return responder(201, apps.recibirEvento(db, app, campos))
  } catch (e) {
    return responder(400, { error: e instanceof Error ? e.message : String(e) })
  }
}

let reprocesoReciente: { en: number; valor: ReturnType<typeof estadoReproceso> } | null = null

const servidor = http.createServer(async (req, res) => {
  medirPedido(req, res, (ruta, ms) => { try { registrarError(db, 'lento', `${ruta} tardó ${Math.round(ms)} ms`) } catch { /* medir no rompe nada */ } })
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (enVercel() && url.pathname === '/api/latido' && req.method === 'GET') {
    const secreto = process.env.CRON_SECRET?.trim() ?? ''
    const auth = String(req.headers.authorization ?? '')
    const esperado = `Bearer ${secreto}`
    const ok = secreto.length > 0 && auth.length === esperado.length && crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(esperado))
    if (!ok) return void res.writeHead(401).end('no')
    try {
      await latido()
      await latidoDeRuns()
      await latidoPensar()
      await subirAhora()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: true }))
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
    }
    return
  }
  if (enVercel()) latidoSiToca()
  if (enVercel() && req.method && !['GET', 'HEAD'].includes(req.method)) esperarSubida(res)
  // Las apps conectadas entran con su token, no con la clave.
  if (url.pathname.startsWith('/api/apps/')) return atenderApp(req, res, url)
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
  // Qué versión de la pantalla sirve (pública: para saber si un deploy llegó, sin datos de nadie).
  if (url.pathname === '/version') return void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ web: VERSION_WEB, commit: process.env.MASTRO_COMMIT ?? null, arranco: ARRANCO }))
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
  // Imágenes adjuntas en el chat.
  if (url.pathname.startsWith('/adjuntos/')) {
    const archivo = path.join(dirAdjuntos(), path.basename(decodeURIComponent(url.pathname)))
    if (!fs.existsSync(archivo)) return void res.writeHead(404).end('No encontrado')
    const ext = path.extname(archivo).toLowerCase()
    // Imágenes y PDF se ven en el navegador (aislados); lo demás se baja. Nunca corre nada en la página.
    const tipo = TIPOS_MIME[ext] ?? ({ '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8' } as Record<string, string>)[ext] ?? 'application/octet-stream'
    const ver = /^image\/(jpeg|png|webp)$/.test(tipo) || ext === '.pdf' || tipo.startsWith('text/plain')
    // Una foto en una lista va como miniatura (?ancho=480): se genera una vez y queda guardada al lado.
    const ancho = Number(url.searchParams.get('ancho'))
    if (ancho && /^image\/(jpeg|png|webp)$/.test(tipo)) {
      const mini = await miniaturaDe(archivo, ancho)
      if (mini) return void servirArchivo(req, res, mini, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' })
    }
    // Con ETag y Range: un audio o un video se puede adelantar, y lo que ya bajó no se vuelve a bajar.
    return void servirArchivo(req, res, archivo, { 'content-type': ext === '.json' ? 'text/plain; charset=utf-8' : tipo, 'cache-control': 'private, max-age=31536000', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'content-disposition': `${ver ? 'inline' : 'attachment'}; filename="${path.basename(archivo).replace(/^\d+-[0-9a-f]+\./, 'adjunto.')}"` })
  }
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
    comprimirJson(req, res)
    try {
      // Una imagen para el chat (cruda): se guarda, se describe y vuelve la marca para el mensaje.
      // Una pieza o un cuaderno como archivo .md (para bajar)
      const md = /^\/api\/(corpus|cuadernos)\/(\d+)\.md$/.exec(url.pathname)
      if (req.method === 'GET' && md) {
        const { cuadernoComoMd, piezaComoMd } = await import('./lector/index.ts')
        const a = md[1] === 'corpus' ? piezaComoMd(db, Number(md[2])) : cuadernoComoMd(db, Number(md[2]))
        return void res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${a.nombre}"`, 'cache-control': 'no-store' }).end(a.texto)
      }
      // Mudanza a esta instancia: los archivos de a uno y la base al final (después se reinicia para abrirla).
      if (req.method === 'POST' && url.pathname === '/api/mudanza/archivo') {
        return void res.end(JSON.stringify(recibirArchivo(url.searchParams.get('ruta') ?? '', await leerCrudo(req, MAX_CARGA))))
      }
      if (req.method === 'POST' && url.pathname === '/api/mudanza/base') {
        const r = recibirBase(await leerCrudo(req, MAX_CARGA))
        res.end(JSON.stringify({ ...r, reinicio: true }))
        console.log('  ⇣ Llegó una base por mudanza: reinicio para abrirla')
        setTimeout(() => process.exit(0), 500) // el contenedor (o quien lo levante) lo vuelve a arrancar
        return
      }
      // Una foto para registrar (una comida, un ticket, la balanza): cruda, con su explicación en ?texto=
      if (req.method === 'POST' && url.pathname === '/api/captura/foto') {
        const foto = guardarFoto(url.searchParams.get('nombre') || 'foto.jpg', await leerCrudo(req, 30 * 1024 * 1024))
        const c = await clasificar(db, { imagen: { datos: foto.datos, mime: foto.mime }, texto: url.searchParams.get('texto') || '' })
        const registrado = c.tipo !== 'otro' && c.confianza >= 0.5 ? registrarCaptura(db, c, { foto: foto.url, fuente: 'pantalla' }) : null
        return void res.end(JSON.stringify({ captura: c, registrado, foto: foto.url }))
      }
      if (req.method === 'POST' && url.pathname === '/api/chat/archivo') {
        const { guardarArchivo } = await import('./chat/adjuntos.ts')
        return void res.end(JSON.stringify(await guardarArchivo(url.searchParams.get('nombre') || 'archivo', await leerCrudo(req, 31 * 1024 * 1024))))
      }
      if (req.method === 'POST' && url.pathname === '/api/chat/imagen') {
        const r = await guardarImagen(db, url.searchParams.get('nombre') || 'imagen', await leerCrudo(req, 30 * 1024 * 1024))
        return void res.end(JSON.stringify(r))
      }
      // Una nota de voz o una página de cuaderno (cruda, de a un archivo; el navegador manda varias seguidas).
      if (req.method === 'POST' && url.pathname === '/api/tandas') {
        const q = url.searchParams
        const r = encolarTanda(db, { tipo: (q.get('tipo') as any) || undefined, nombre: q.get('nombre') || 'archivo', datos: await leerCrudo(req, 300 * 1024 * 1024), fecha: q.get('fecha') || null, cuaderno: q.get('cuaderno') || null, hoja: q.get('hoja') ? Number(q.get('hoja')) : null })
        void procesarTandas(db).catch((e) => console.error('  tandas:', e instanceof Error ? e.message : e))
        return void res.end(JSON.stringify(r))
      }
      // El Estudio: un video propio (por pedazos de hasta 32 MB, como el Takeout), una imagen para una capa, una plantilla.
      const est = /^\/api\/estudio\/(subir\/parte|subir\/fin|(\d+)\/imagen|plantillas\/importar)$/.exec(url.pathname)
      if (est && req.method === 'POST') {
        const q = url.searchParams
        const sesion = q.get('sesion') ?? ''
        if (est[1].startsWith('subir') && !/^[\w-]{8,40}$/.test(sesion)) throw new Error('Sesión de subida inválida')
        const ruta = path.join(dirTaller(), 'subidas', `${sesion}.mp4`)
        if (est[1] === 'subir/parte') {
          fs.mkdirSync(path.dirname(ruta), { recursive: true })
          const desde = Number(q.get('desde') ?? 0)
          if (desde > 0 && (!fs.existsSync(ruta) || fs.statSync(ruta).size < desde)) throw new Error('Falta un pedazo anterior')
          const fd = fs.openSync(ruta, desde === 0 ? 'w' : 'r+')
          const datos = await leerCrudo(req, 32 * 1024 * 1024)
          try { fs.writeSync(fd, datos, 0, datos.length, desde) } finally { fs.closeSync(fd) }
          return void res.end(JSON.stringify({ bytes: fs.statSync(ruta).size }))
        }
        if (est[1] === 'subir/fin') {
          if (!fs.existsSync(ruta) || fs.statSync(ruta).size !== Number(q.get('total'))) throw new Error('El video no llegó entero: volvé a subirlo')
          return void res.end(JSON.stringify(estudio.crearEstudio(db, { archivo: ruta, titulo: (q.get('nombre') || 'Video').replace(/\.[\w]+$/, '') })))
        }
        if (est[1] === 'plantillas/importar') return void res.end(JSON.stringify(estudio.importarPlantilla(db, await leerCrudo(req, 60 * 1024 * 1024))))
        return void res.end(JSON.stringify({ archivo: estudio.subirImagenEstudio(db, Number(est[2]), q.get('nombre') || 'imagen', await leerCrudo(req, 20 * 1024 * 1024)) }))
      }
      const plz = /^\/api\/estudio\/plantillas\/(\d+)\.zip$/.exec(url.pathname)
      if (plz && req.method === 'GET') {
        const z = estudio.exportarPlantilla(db, Number(plz[1]))
        return void res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${z.nombre}"` }).end(z.zip)
      }
      if (req.method === 'GET' && url.pathname === '/api/estudio/qr') {
        return void res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' }).end(qrPng(String(url.searchParams.get('d') ?? '').slice(0, 300) || 'https://', 6))
      }
      // Google Takeout: la compu sube el paquete (texto) y los medios ya achicados; la nube hace todo lo pesado de fondo.
      const tko = /^\/api\/takeout(?:\/(paquete\/parte|paquete\/fin|faltan|medio|cerrar|reintentar|nombre))?$/.exec(url.pathname)
      if (tko) {
        const q = url.searchParams
        const loteQ = q.get('lote') ?? ''
        const que = tko[1] ?? ''
        if (!que && req.method === 'GET') return void res.end(JSON.stringify(estadoTakeout(db)))
        if (req.method !== 'POST') throw new Error('Método no permitido')
        if (['paquete/parte', 'paquete/fin', 'medio', 'cerrar'].includes(que) && !loteValido(loteQ)) throw new Error('Lote inválido')
        if (que === 'paquete/parte') return void res.end(JSON.stringify({ ok: true, bytes: recibirParte(loteQ, Number(q.get('desde') ?? 0), await leerCrudo(req, 32 * 1024 * 1024)) }))
        if (que === 'paquete/fin') {
          paqueteListo(db, loteQ, Number(q.get('total') ?? 0))
          void ingerirPaquete(db, loteQ).then(() => trabajarTakeout(db)).catch((e) => console.error('  takeout ingesta:', e instanceof Error ? e.message : e))
          return void res.end(JSON.stringify({ ok: true }))
        }
        if (que === 'faltan') {
          const b = JSON.parse((await leerCrudo(req, 4 * 1024 * 1024)).toString('utf8') || '{}')
          return void res.end(JSON.stringify({ faltan: faltan(db, (Array.isArray(b.huellas) ? b.huellas : []).filter((h: unknown) => typeof h === 'string' && huellaValida(h))) }))
        }
        if (que === 'medio') {
          const h = q.get('huella') ?? ''
          if (!huellaValida(h)) throw new Error('Huella inválida')
          const r = recibirMedio(db, loteQ, h, q.get('ext') ?? '', await leerCrudo(req, 64 * 1024 * 1024))
          void trabajarTakeout(db).catch(() => {})
          return void res.end(JSON.stringify(r))
        }
        if (que === 'cerrar') {
          cerrarLote(db, loteQ)
          void trabajarTakeout(db).catch(() => {})
          return void res.end(JSON.stringify({ ok: true }))
        }
        if (que === 'reintentar') {
          const r = reintentarTakeout(db)
          void trabajarTakeout(db).catch(() => {})
          return void res.end(JSON.stringify(r))
        }
        if (que === 'nombre') {
          const b = JSON.parse((await leerCrudo(req, 64 * 1024)).toString('utf8') || '{}')
          return void res.end(JSON.stringify(resolverNombre(db, String(b.clave ?? ''), b.accion === 'descartar' ? 'descartar' : 'aceptar', { entidadId: b.entidadId ? Number(b.entidadId) : null, tipo: b.tipo, nombre: typeof b.nombre === 'string' ? b.nombre : undefined })))
        }
      }
      // Importar un estado grande desde la página: llega en pedazos al disco (ningún pedido pasa de 32 MB) y después se
      // importa de fondo leyéndolo de a líneas, sin cargarlo entero en memoria. La página pregunta cómo va.
      const imp = /^\/api\/importar-estado\/(parte|fin|estado)$/.exec(url.pathname)
      if (imp) {
        const idImp = url.searchParams.get('id') ?? ''
        if (!/^[\w-]{8,64}$/.test(idImp)) throw new Error('Falta el id de la importación')
        const ruta = path.join(path.dirname(resolverRuta()), 'importaciones', `${idImp}.json`)
        if (imp[1] === 'parte' && req.method === 'POST') {
          const desde = Number(url.searchParams.get('desde') ?? 0)
          const datos = await leerCrudo(req, 32 * 1024 * 1024)
          fs.mkdirSync(path.dirname(ruta), { recursive: true })
          if (desde > 0 && (!fs.existsSync(ruta) || fs.statSync(ruta).size < desde)) throw new Error('Falta un pedazo anterior: volvé a empezar')
          const fd = fs.openSync(ruta, desde === 0 ? 'w' : 'r+')
          try { fs.writeSync(fd, datos, 0, datos.length, desde) } finally { fs.closeSync(fd) }
          return void res.end(JSON.stringify({ ok: true, bytes: fs.statSync(ruta).size }))
        }
        if (imp[1] === 'fin' && req.method === 'POST') {
          if (importaciones.has(idImp)) return void res.end(JSON.stringify({ ok: true })) // un reintento: ya arrancó
          if (!fs.existsSync(ruta)) throw new Error('No llegó el archivo')
          const total = Number(url.searchParams.get('total') ?? 0)
          if (total && fs.statSync(ruta).size !== total) throw new Error(`Llegaron ${fs.statSync(ruta).size} de ${total} bytes: volvé a subirlo`)
          if ([...importaciones.values()].some((x) => x.estado === 'importando')) throw new Error('Ya hay una importación en curso')
          const estado: Importacion = { estado: 'importando', leidos: 0, total: fs.statSync(ruta).size }
          importaciones.set(idImp, estado)
          void importarEstadoArchivo(db, ruta, { forzar: url.searchParams.get('forzar') === '1', alAvanzar: (l) => { estado.leidos = l } })
            .then((r) => { estado.estado = 'listo'; estado.resultado = { tablas: r.tablas, filas: r.filas, archivos: r.archivos, respaldo: r.respaldo } })
            .catch((e) => { estado.estado = 'error'; estado.error = e instanceof Error ? e.message : String(e) })
            .finally(() => fs.rmSync(ruta, { force: true }))
          return void res.end(JSON.stringify({ ok: true }))
        }
        if (imp[1] === 'estado') {
          const e = importaciones.get(idImp)
          if (!e) throw new Error('No conozco esa importación')
          return void res.end(JSON.stringify(e))
        }
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
      // Discovery: lo que llega crudo (el audio de una entrevista, un documento, el CSV de un log o de casos en sombra).
      const crudoEncargo = req.method === 'POST' ? /^\/api\/encargos\/(\d+)\/(entrevista-audio|documento|log|sombra)$/.exec(url.pathname) : null
      if (crudoEncargo) {
        const dsc = await import('./discovery.ts')
        const eid = Number(crudoEncargo[1])
        const q = url.searchParams
        const datos = await leerCrudo(req, 40 * 1024 * 1024)
        const r = crudoEncargo[2] === 'entrevista-audio' ? await dsc.agregarEntrevista(db, eid, { quien: q.get('quien'), rol: q.get('rol'), area: q.get('area'), audio: datos, nombreAudio: q.get('nombre') || 'entrevista.m4a' })
          : crudoEncargo[2] === 'documento' ? await dsc.agregarDocumento(db, eid, q.get('nombre') || 'documento.pdf', datos, q.get('area'))
          : crudoEncargo[2] === 'log' ? dsc.subirLog(db, eid, q.get('nombre') || 'log.csv', datos.toString('utf8'), { area: q.get('area'), mapeo: q.get('mapeo') ? JSON.parse(q.get('mapeo')!) : null })
          : await (async () => {
            // La sombra en vivo: las reglas que recién quedan listas, y si ya toma la mitad, el encargo pasa a vivo (aviso en Hoy).
            const antes = new Set(dsc.sombraDe(db, eid).reglas.filter((x) => x.lista).map((x) => x.regla))
            const s = dsc.cargarSombra(db, eid, datos.toString('utf8'), q.get('proceso') ? Number(q.get('proceso')) : null)
            const v = (await import('./procesos.ts')).revisarSombra(db, eid, antes, s)
            if (v.aviso) mensajeDeMastropiero(db, conversacionHoy(db).id, v.aviso)
            return { ...s, nuevasListas: v.nuevas.map((x) => x.regla), paso: v.paso }
          })()
        return void res.end(JSON.stringify(r))
      }
      // La respuesta de una práctica de idioma, grabada: se transcribe en ese idioma y vuelve la devolución.
      const audioIdioma = req.method === 'POST' ? /^\/api\/idiomas\/(\d+)\/audio$/.exec(url.pathname) : null
      if (audioIdioma) {
        const audio = await leerCrudo(req, 25 * 1024 * 1024)
        return void res.end(JSON.stringify(await (await import('./idiomas.ts')).responderPractica(db, Number(audioIdioma[1]), { audio, nombreAudio: url.searchParams.get('nombre') || 'respuesta.webm', segundos: Number(url.searchParams.get('segundos')) || null })))
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
      if (!r) {
        registrarError(db, 'ruta', `${req.method} ${url.pathname.replace(/\/\d+(?=\/|$)/g, '/:id')}: Ruta desconocida`)
        return void res.writeHead(404).end(JSON.stringify({ error: 'Ruta desconocida' }))
      }
      const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : {}
      const params = url.pathname.match(r[1])!.slice(1)
      res.end(JSON.stringify((await r[2](cuerpo, params, url.searchParams)) ?? null))
    } catch (e) {
      if (esErrorDeCodigo(e)) registrarError(db, 'ruta', `${req.method} ${url.pathname.replace(/\/\d+(?=\/|$)/g, '/:id')}: ${e instanceof Error ? e.message : String(e)}`)
      if (!res.headersSent) res.writeHead(400)
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
    }
    return
  }
  const archivo = path.join(WEB, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname))
  if (!archivo.startsWith(WEB) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    return void res.writeHead(404).end('No encontrado')
  }
  // La página pide cada script y la hoja de estilos con el hash de su contenido (?v=…): eso se guarda un año (inmutable)
  // y un deploy cambia la URL de lo que cambió. El index.html se revalida siempre (ETag), y todo viaja comprimido.
  if (path.basename(archivo) === 'index.html') return void servirEstatico(req, res, archivo, 'text/html; charset=utf-8', { contenido: indexConVersiones(WEB) })
  const v = url.searchParams.get('v')
  let inmutable = false
  if (v) { try { inmutable = v === versionDe(archivo) } catch { /* sin versión */ } }
  servirEstatico(req, res, archivo, TIPOS_MIME[path.extname(archivo)] ?? 'application/octet-stream', { inmutable })
})

// Las rutinas: cada minuto se fija si toca algo (y al arrancar se pone al día).
let enRutinas = false
async function latido() {
  if (enRutinas || process.env.MASTRO_SIN_RUTINAS) return
  enRutinas = true
  try {
    // Lo nuevo (primarias, aprendizajes, metas) busca lo que ya había hecho hacia eso. En la nube (o sin NaN: por palabras).
    if (enLaNube() || !nanConfigurado()) await (await import('./evidencia.ts')).buscarPreviosPendientes(db).catch((e) => console.error('  previos:', e instanceof Error ? e.message : e))
    for (const r of await correrRutinas(db)) console.log(`  ⏰ rutina ${r.id}: ${r.ok ? 'hecha' : 'falló'}${r.mensaje ? ` — ${r.mensaje.slice(0, 80)}` : ''}`)
  } catch (e) {
    console.error('  ⏰ rutinas:', e instanceof Error ? e.message : e)
  } finally {
    enRutinas = false
  }
}
setInterval(latido, 60_000).unref()

// En Vercel el proceso se duerme entre pedidos: con la pantalla abierta, esto pone al día las rutinas.
let ultimoLatido = 0
function latidoSiToca() {
  const ahora = Date.now()
  if (ahora - ultimoLatido < 30_000) return
  ultimoLatido = ahora
  void latido()
  void latidoDeRuns()
}

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
    if (s?.informe) mensajeDeMastropiero(db, conversacionHoy(db).id, `El Directo se cortó (no me llegó nada en 10 minutos: se cerró la pestaña o se apagó el servidor), así que lo cerré yo. ${s.informe}`)
    else void tramoDirecto(db).catch((e) => console.error('  directo:', e instanceof Error ? e.message : e))
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

// El reproceso: si él lo prendió, sigue solo (en la nube) con lo que falte y con lo nuevo que entra.
if (enLaNube() && !enVercel()) {
  const reprocesar = () => { if (ajuste(db, 'reproceso_activo') === '1') void trabajarReproceso(db).catch((e) => console.error('  reproceso:', e instanceof Error ? e.message : e)) }
  setTimeout(reprocesar, 90_000).unref()
  setInterval(reprocesar, 10 * 60_000).unref()
}

// Las cuentas: lo aprobado se publica en su horario (solo con conector; «redacta» solo lo que él aprobó).
setInterval(async () => {
  try {
    for (const p of await publicarPendientes(db)) if (p.estado === 'fallo') mensajeDeMastropiero(db, conversacionHoy(db).id, `No pude publicar: ${p.error}`)
  } catch (e) { console.error('  cuentas:', e instanceof Error ? e.message : e) }
}, 5 * 60_000).unref()

// Telegram: si hay bot, escucha; y lo que Mastropiero dice solo también sale por ahí.
// En Vercel no hay proceso siempre prendido: el long polling pelearía con el de la compu y se cortaría.
// Lo que se rompe queda anotado (además de en la consola): la rutina «autocritica» lo convierte en propuestas de arreglo.
if (!enVercel()) {
  const consola = console.error.bind(console)
  console.error = (...xs: unknown[]) => {
    consola(...xs)
    registrarError(db, 'servidor', xs.map((x) => (x instanceof Error ? x.message : String(x))).join(' '))
  }
}

// Lo que el servidor dejó a medias al apagarse (tandas en proceso, una forja) se retoma o se marca, con o sin bot.
if (!enVercel()) {
  retomarTandas(db)
  retomarFragua(db)
  void procesarTandas(db).catch(() => {})
  // El Takeout sigue donde quedó: un paquete sin leer se lee, y la cola de medios y destilado sigue.
  const sinLeer = retomarTakeout(db)
  void Promise.all(sinLeer.map((l) => ingerirPaquete(db, l).catch((e) => console.error('  takeout ingesta:', e instanceof Error ? e.message : e))))
    .then(() => trabajarTakeout(db)).catch(() => {})
  // YouTube: lo que quedó en cola sigue; cada 15 minutos, lo que espera a la compu vuelve a probar con el servicio (si volvió el cupo).
  void import('./youtube.ts').then((y) => {
    void y.trabajarYoutube(db).catch(() => {})
    setInterval(() => { if (y.reintentarConServicio(db)) void y.trabajarYoutube(db).catch(() => {}) }, 15 * 60_000).unref()
  })
}
if (telegramActivo() && !enVercel()) {
  escucharTelegram(db)
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
if (!enVercel()) {
  if (problemaDeAcceso) {
    console.error(`\n  ✗ ${problemaDeAcceso}\n`)
    process.exit(1)
  }
  servidor.listen(PUERTO, host(), () => {
    console.log(`\n  ☿ Mastropiero en http://${host() === '0.0.0.0' ? '127.0.0.1' : host()}:${PUERTO}${expuesto() ? '   (expuesto a la red: pide clave)' : ''}   (base: ${process.env.MASTRO_DB ?? 'data/mastro.db'} · motor de reclutas: ${MOTOR_DEFECTO()})\n`)
  })
}

export { servidor }
