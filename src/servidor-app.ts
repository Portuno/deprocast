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
import { migrarCien } from './migrar-cien.ts'
import { leerJornada, progreso, semana } from './jornada.ts'
import {
  actualizarMision, ajustarMinutos, anotarSideQuest, arrancarRun, asignarMision, borrarPlantilla, cerrarRun, comentarRun, conAvance, crearMision, descartarRun, enCurso, guardarPlantilla,
  latidoRuns, leerRun, listarMisiones, listarPlantillas, listarReportes, listarRuns, marcarSecundaria, misionesDeRun, opinarArmado, pasarASiguiente, principalDe, procesarJugador,
  proponerPrimarias, rehacerRun, reporteSemana, runActual, semanaDe, semanaVecina, seguimientos, prepararRun, diasDeSemana, asegurarPrincipal, pasoDeRun,
} from './misiones.ts'
import { catalogo } from './menciones.ts'
import { pensar } from './alertas.ts'
import { autorizado, cookieDeEntrada, detrasDeProxy, enUsuario, enVercel, expuesto, host, leerFormulario, PAGINA_ENTRAR, validarAcceso } from './acceso.ts'
import { crearPuerta } from './cuentas-usuarios/index.ts'
import { hayHub } from './cuentas-usuarios/procesos.ts'
import { alGuardar, bajarNube, esperarSubida, subirAhora } from './nube.ts'
import { CONECTORES, guardarCuenta, leerAgente, listarCuentas, listarPublicaciones, MODOS, publicarPendientes, redactarPublicaciones, resolverPublicacion } from './cuentas.ts'
import { decir as decirPorTelegram, escucharTelegram, estadoTelegram, latidoTelegram, telegramActivo, telegramConfigurado } from './telegram.ts'
import { borrarSalud, editarSalud, fijarMetasSalud, registrarSalud, resumenDia, resumenSemana } from './salud.ts'
import { clasificar, registrarCaptura } from './captura.ts'
import { crearAprendizaje, editarAprendizaje, leerAprendizaje, listarAprendizajes, practicasDe, prepararRepaso, recursosDe, registrarPractica } from './aprender.ts'
import { guardarFoto } from './chat/adjuntos.ts'
import { aplicarBaseEntrante, recibirArchivo, recibirBase } from './mudanza.ts'
import { artefactoAlCorpus, ASPECTOS, borrarArtefacto, carpeta as carpetaTaller, dirTaller, ESTILOS, hayFfmpeg, leerArtefacto, libreria, listarArtefactos, sugerenciasTaller, valorarArtefacto, VOCES } from './taller.ts'
import { estadoCola, retomarTaller } from './taller-cola.ts'
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
import { RESULTADOS, tabla as tablaEconomia, TARIFAS } from './economia.ts'
import { exportarEstado, importarEstado, importarEstadoArchivo } from './exportacion.ts'
import { aplicarZona, recibirZona } from './zona.ts'
import { anotarUso, verUso } from './uso.ts'
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
import { anotarBloqueo, esErrorDeCodigo, pasosEnMarcha, registrarError } from './autocritica.ts'
import { aplicarForja, descartarForja, estadoReal, forjarMejora, leerForja, listarForjas, pasoDeForja, porQueNoSePuedeForjar, ramaActual, retomarFragua, type Forja } from './fragua.ts'
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
import { enEspera, leerTarea, pausarIngesta, publicar, reanudarIngesta, tareas, tareasLivianas } from './bus.ts'
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
import { cadena, fijarTopeDuro, nanConfigurado, nanTranscribir, tokensHoy, topeAlcanzado, topeDiario, usoDelMes } from './nan.ts'
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
// Su Google Calendar por su propia conexión de Google (si la hay), antes que por la cuenta de servicio.
void import('./google-calendario.ts').then((g) => g.usarConexionGoogle(db))
/**
 * Arranque sin corte (plan v33, paso 6). En la nube, cada versión nueva arranca «en espera» al lado de la que está
 * atendiendo: contesta pedidos, pero no corre nada de fondo (rutinas, liga, Telegram, retomar lo que quedó a medias,
 * publicar), así no se pisa con la vieja que todavía trabaja. El arranque (arranque-nube.ts) le pasa el tráfico cuando ya
 * está caliente, apaga la vieja y recién ahí le manda «activar».
 */
const arrancaEnEspera = process.env.MASTRO_EN_ESPERA === '1' && typeof process.send === 'function'
let fondoActivo = !arrancaEnEspera
const alActivar: (() => void)[] = []
function deFondo(f: () => void) {
  if (fondoActivo) f()
  else alActivar.push(f)
}
if (arrancaEnEspera) {
  process.on('message', (m) => {
    if (m !== 'activar' || fondoActivo) return
    fondoActivo = true
    console.log('  ☿ activo: arranca lo de fondo')
    for (const f of alActivar.splice(0)) { try { f() } catch (e) { console.error('  activar:', e instanceof Error ? e.message : e) } }
  })
  process.channel?.unref()
}
let caliente = false

/**
 * Bloqueos (paso 6): cada medio segundo se fija cuánto se atrasó el reloj. Si algo frenó todo más de un segundo, queda
 * anotado con lo que estaba en marcha en ese rato (tareas de fondo y pedidos). /version muestra los últimos (solo
 * nombres de tareas y rutas, nada de datos) para poder verlo desde afuera.
 */
const enMarcha: { nombre: string; desde: number; hasta: number | null }[] = []
function marcar(nombre: string): () => void {
  const m = { nombre, desde: Date.now(), hasta: null as number | null }
  enMarcha.push(m)
  return () => { m.hasta = Date.now() }
}
const bloqueos: { en: string; ms: number; cpu: number; durante: string[] }[] = []
// npm run medir (Fragua #213) lo baja a 200 ms para fallar con lo que en la nube ya molesta.
const UMBRAL_BLOQUEO = Number(process.env.MASTRO_BLOQUEO_MS) || 1000
// El tic, a un cuarto del umbral (como mucho medio segundo): con un tic más largo que la traba, la traba no se ve.
const TIC_VIGIA = Math.min(500, Math.max(20, Math.round(UMBRAL_BLOQUEO / 4)))
let tic = performance.now()
// Cuánta CPU usó el proceso en el hueco: una traba nuestra la consume; si casi no usó, al proceso lo frenaron de afuera
// (el contenedor sin CPU, la compu ocupada con otra cosa). Va con cada bloqueo para no confundir una cosa con la otra.
let cpuTic = process.cpuUsage()
setInterval(() => {
  const ahora = performance.now()
  const atraso = ahora - tic - TIC_VIGIA
  tic = ahora
  const c = process.cpuUsage(cpuTic)
  cpuTic = process.cpuUsage()
  const t = Date.now()
  if (atraso > UMBRAL_BLOQUEO) {
    const durante = [...new Set([...enMarcha.filter((m) => m.desde <= t && (m.hasta === null || m.hasta >= t - atraso - TIC_VIGIA - 100)).map((m) => m.nombre), ...pasosEnMarcha.keys()])]
    bloqueos.push({ en: new Date(t).toISOString(), ms: Math.round(atraso), cpu: Math.round((c.user + c.system) / 1000), durante })
    if (bloqueos.length > 15) bloqueos.shift()
    try { registrarError(db, 'lento', `bloqueo de ${Math.round(atraso)} ms (${durante.join(', ') || 'nada anotado'})`) } catch { /* medir no rompe nada */ }
    anotarBloqueo(db, atraso, durante, t) // Fragua #212: la autocrítica los junta por hora
  }
  for (let i = enMarcha.length - 1; i >= 0; i--) if (enMarcha[i].hasta !== null && t - enMarcha[i].hasta! > 10_000) enMarcha.splice(i, 1)
}, TIC_VIGIA).unref()
// La hora del operador, no la del servidor (la nube corre en UTC): antes de que nada formatee una hora.
const zona = aplicarZona(db)
// Adiós a los Cien Días (plan v23): una sola vez, su conocimiento al corpus, respaldo y fuera sus tablas.
try {
  const m = migrarCien(db, { respaldos: path.join(path.dirname(resolverRuta()), 'respaldos') })
  if (m) console.log(`  ✦ Los Cien Días pasaron al corpus: ${m.piezas} piezas, ${m.dominios} dominios; respaldo en ${m.respaldo}`)
} catch (e) { console.error('  migración de los Cien Días:', e instanceof Error ? e.message : e) }
// Pedido suyo (9/11/2026): la facturación de Versa (Fragua #179) no se va a usar. Una sola vez, solo esa.
try {
  if (db.prepare(`SELECT 1 FROM propuestas WHERE id = 179 AND titulo LIKE 'Facturación de Versa%' AND estado = 'abierta'`).get()) {
    void import('./chat/index.ts').then((c) => c.resolverPropuesta(db, 179, 'descartada')).catch(() => {})
  }
} catch { /* sin la tabla */ }
// Plan v38 (9/11/2026), una sola vez: lo de La Fragua que no era de Deprocast, a donde va (#170 → encargo, #158 → idea).
if (ajuste(db, 'migracion_v38_fragua') !== '1') {
  fijarAjuste(db, 'migracion_v38_fragua', '1')
  void import('./delegar.ts').then(async (d) => {
    const abierta = (n: number, t: string) => db.prepare(`SELECT 1 FROM propuestas WHERE id = ? AND titulo LIKE ? AND estado = 'abierta'`).get(n, `${t}%`)
    if (abierta(170, 'Perfil como landing')) await d.moverPropuesta(db, 170, 'encargo')
    if (abierta(158, 'Nuevas vías de comunicación')) await d.moverPropuesta(db, 158, 'idea')
  }).catch((e) => console.error('  migración v38:', e instanceof Error ? e.message : e))
}
// Fragua #258 (12/11/2026), una sola vez: las propuestas a las seis categorías fijas, con registro de la anterior.
if (ajuste(db, 'migracion_fragua_areas6') !== '1') {
  fijarAjuste(db, 'migracion_fragua_areas6', '1')
  void import('./fragua-areas.ts').then((a) => { const r = a.reagrupar(db); if (r.cambiadas) console.log(`  ⚒ La Fragua: ${r.cambiadas} propuestas pasaron a las seis categorías`) })
    .catch((e) => console.error('  migración de categorías:', e instanceof Error ? e.message : e))
}
// La cola del Taller: lo que quedó a medias por un reinicio vuelve a la cola y sigue.
deFondo(() => { try { const n = retomarTaller(db); if (n) console.log(`  ✎ El Taller retoma ${n} trabajo${n === 1 ? '' : 's'}`) } catch (e) { console.error('  taller:', e instanceof Error ? e.message : e) } })
alGuardar(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* todavía no */ } })

// Usuarios (plan v33, paso 5). En el proceso del dueño, la puerta: las sesiones de los usuarios van a su propio Deprocast.
// En el Deprocast de un usuario: el tope duro de tokens por día (cuenta todo) y, si el hub se cae, se apaga con él.
const puerta = enUsuario() || enVercel() ? null : crearPuerta({ datos: process.env.MASTRO_CUENTAS_DIR ?? path.dirname(resolverRuta()), activo: () => fondoActivo, entornoExtra: () => entornoGoogleParaUsuarios() })
// Recién activado en un relevo, los usuarios ya corren: se adoptan enseguida. En un arranque de cero, después de que el dueño contesta.
/** El cliente de Google del dueño (el que pegó en su perfil) también les sirve a los usuarios para conectar el suyo. */
function entornoGoogleParaUsuarios(): Record<string, string> {
  const id = ajuste(db, 'google_cliente_id')
  const secreto = ajuste(db, 'google_cliente_secreto')
  return id && secreto ? { GOOGLE_OAUTH_ID: id, GOOGLE_OAUTH_SECRETO: secreto } : {}
}
if (puerta) deFondo(() => setTimeout(() => puerta.prenderTodos(), arrancaEnEspera ? 0 : 20_000).unref())
// Con el supervisor, apagarse es un relevo: los usuarios siguen corriendo y el servidor nuevo los adopta. Sin él (la
// compu), apagarse es apagar todo.
if (puerta) for (const s of ['SIGTERM', 'SIGINT'] as const) process.once(s, () => {
  if (process.env.MASTRO_SUPERVISADO) { puerta.hub.dejar(); process.exit(0) }
  void puerta.hub.pararTodos().finally(() => process.exit(0))
})
if (enUsuario()) {
  const tope = Number(process.env.MASTRO_TOPE_DIA) || 0
  if (tope) fijarTopeDuro(() => { const t = tokensHoy(db).total; return t >= tope ? `Llegaste al tope de hoy (${tope.toLocaleString('es-AR')} tokens). Mañana sigue; si necesitás más, pedíselo a quien te invitó.` : null })
  // Se apaga solo si no queda ningún hub vivo (en un relevo, el registro pasa del hub viejo al nuevo).
  const registro = process.env.MASTRO_HUB_REGISTRO
  const padre = process.ppid
  let sinHub = 0
  setInterval(() => {
    let hay: boolean
    if (registro) hay = hayHub(registro)
    else try { process.kill(padre, 0); hay = true } catch { hay = false }
    sinHub = hay ? 0 : sinHub + 1
    if (sinHub >= 3) process.exit(0)
  }, 10_000).unref()
  // Su consola, con su número adelante (va directo a la del sistema).
  for (const k of ['log', 'error', 'warn'] as const) {
    const f = console[k].bind(console)
    console[k] = (...xs: unknown[]) => f(`  [u${process.env.MASTRO_USUARIO}]`, ...xs)
  }
  for (const s of [process.stdout, process.stderr]) s.on('error', () => { /* sin consola: sigue igual */ })
}

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

/**
 * Lo que el estado trae y no necesita precisión de segundos (recuentos, el uso del mes, las fuentes): se guarda un rato
 * corto. Cualquier cambio que él hace (un POST) lo borra, así lo suyo se ve en el acto; lo que cambia solo (la liga, las
 * rutinas) se ve al vencer.
 */
const cortas = new Map<string, { en: number; v: unknown }>()
function corta<T>(clave: string, ms: number, f: () => T): T {
  const ya = cortas.get(clave)
  if (ya && Date.now() - ya.en < ms) return ya.v as T
  const v = f()
  cortas.set(clave, { en: Date.now(), v })
  return v
}

/** Lo que la pantalla refresca seguido. El corpus completo va paginado aparte. */
function estado() {
  return {
    liga: corta('liga', 15_000, () => estadoLiga(db)),
    roster: corta('roster', 10_000, () => listar(db).map((f) => vista(db, f))),
    // Livianas: el tablero muestra una línea de cada una (el detalle se pide aparte). Con el payload entero (el texto de
    // cada pieza en ingesta) el estado pesaba 1,4 MB y viajaba cada 7 segundos.
    tareas: tareasLivianas(db, 120),
    fuentes: corta('fuentes', 30_000, () => fuentes(db)),
    quantomos: corta('quantomos', 15_000, () => resumenQuantomos(db)),
    entidades: corta('entidades', 30_000, () => resumenEntidades(db)),
    cargas: listarCargas(db).slice(0, 20).map(({ analisis, ...c }) => ({ ...c, titulo: analisis?.titulo })),
    lapidas: corta('lapidas', 60_000, () => lapidas(db)),
    uso: corta('uso', 60_000, () => usoDelMes(db)),
    gasto: { ...tokensHoy(db), tope: topeDiario(db) },
    enEspera: enEspera(db),
    cronica: cronica(db),
    corriendo: tickEnCurso(),
    propuestasAbiertas: (db.prepare(`SELECT COUNT(*) AS n FROM propuestas WHERE estado = 'abierta'`).get() as { n: number }).n,
    // El número de 📥 arriba: lo que espera su ok, desde cualquier pantalla.
    // Armar la bandeja entera para el número de arriba es caro (miles de pendientes): una vez cada 20 s alcanza.
    paraValidar: corta('para-validar', 20_000, () => bandeja(db).total),
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
    ligaAuto: corta('liga-auto', 5_000, () => { const p = ajuste(db, 'liga_auto') !== '0'; return { prendido: p, nube: enLaNube() } }),
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
  // Lo que quedó corriendo de fondo (un pedido largo): cómo va y, al terminar, su resultado.
  ['GET', /^\/api\/trabajos\/([\w]+)$/, async (_, [x]) => (await import('./trabajos.ts')).estadoTrabajo(x)],
  ['GET', /^\/api\/meta$/, () => meta()],
  // El esqueleto: la Matriz 72 con los órganos del sistema, los propuestos y su actividad (las cartas vienen del roster).
  ['GET', /^\/api\/esqueleto$/, async () => (await import('./esqueleto.ts')).verEsqueleto(db)],
  ['GET', /^\/api\/estado$/, () => estado()],

  // Liga
  // (misiones, pistas y sala son del plan v26: no son ids de agentes)
  ['GET', /^\/api\/agentes\/(?!misiones$|pistas$|sala$)([^/]+)$/, (_, [a]) => {
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
  ['POST', /^\/api\/agentes\/([^/]+)\/bautizar$/, async (b, [a]) => { const r = (await import('./bautizo.ts')).bautizarConCriterio(db, decodeURIComponent(a), String(b.nombre ?? '')); return { ...vista(db, leer(db, decodeURIComponent(a))!), porQue: r.porQue } }],
  // El bautizo con criterio (Fragua #175): candidatos con puntaje y motivo, y el criterio con que se compararon.
  ['POST', /^\/api\/agentes\/([^/]+)\/nombres$/, async (_, [a]) => (await import('./bautizo.ts')).proponerNombres(db, decodeURIComponent(a))],
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
  // Explorar internet (plan v31): los canales con su salud, y probar buscar, leer o listar desde la pantalla.
  ['GET', /^\/api\/explorar\/canales$/, async () => (await import('./explorar/index.ts')).estadoCanales(db)],
  ['POST', /^\/api\/explorar\/(buscar|leer|listar)$/, async (b, [accion]) => {
    const ex = await import('./explorar/index.ts')
    try {
      if (accion === 'buscar') return await ex.buscar(db, String(b.plataforma ?? 'web'), String(b.consulta ?? ''), { n: Number(b.n) || 8 })
      if (accion === 'listar') return await ex.listar(db, String(b.plataforma ?? ''), String(b.que ?? ''), String(b.id ?? ''), { n: Number(b.n) || 10 })
      return await ex.leerLink(db, String(b.url ?? ''))
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), codigo: e instanceof ex.ErrorExplorar ? e.codigo : 'ROTO' }
    }
  }],
  // Exportación a medida: elegir entidades, ver sus vínculos, armar el esquema, ver cuánto pesa y bajarlo.
  ['GET', /^\/api\/segmento\/entidades$/, async (_, __, q) => (await import('./segmento.ts')).buscarEntidades(db, { q: q.get('q') ?? '', tipo: q.get('tipo') || undefined })],
  ['POST', /^\/api\/segmento\/vecindario$/, async (b) => (await import('./segmento.ts')).vecindario(db, Array.isArray(b.ids) ? b.ids : [])],
  ['POST', /^\/api\/segmento\/previa$/, async (b) => (await import('./segmento.ts')).previa(db, b.esquema ?? {})],
  ['POST', /^\/api\/segmento\/exportar$/, async (b) => {
    const s = await import('./segmento.ts')
    if (b.esquemaId) s.usarEsquema(db, Number(b.esquemaId))
    const r = s.exportarSegmento(db, b.esquema ?? {})
    // En Markdown o texto plano (para leer); sin formato, el JSON de siempre.
    return b.formato === 'md' || b.formato === 'txt' ? { formato: b.formato, resumen: r.resumen, texto: s.segmentoComoTexto(r, b.formato) } : r
  }],
  ['GET', /^\/api\/segmento\/esquemas$/, async () => (await import('./segmento.ts')).listarEsquemas(db)],
  ['POST', /^\/api\/segmento\/esquemas$/, async (b) => (await import('./segmento.ts')).guardarEsquema(db, b.esquema ?? {})],
  ['POST', /^\/api\/segmento\/esquemas\/(\d+)\/borrar$/, async (_, [e]) => { (await import('./segmento.ts')).borrarEsquema(db, id(e)); return { ok: true } }],
  // La liga en vivo (plan v30): Auto en el servidor, los de la casa y por qué no avanza.
  ['GET', /^\/api\/liga\/vivo$/, async () => (await import('./casa.ts')).ligaEnVivo(db, enLaNube())],
  ['POST', /^\/api\/liga\/auto$/, async (b) => { const c = await import('./casa.ts'); c.fijarAuto(db, b.prendido !== false); return { prendido: c.autoPrendido(db), freno: c.frenoDeAuto(db, enLaNube()) } }],
  ['POST', /^\/api\/liga\/casa\/(0?[123])$/, async (_, [n]) => {
    const c = await import('./casa.ts')
    const cual = n.padStart(2, '0')
    if (cual === '01') return { hechos: c.despachar(db, { drenar: enLaNube() }) }
    if (cual === '02') return { forjados: c.asegurarClases(db).map((f) => f.id) }
    return { hallazgos: c.metaanalizar(db, Date.now(), { forzar: true }) }
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
    // Con «desde»: solo lo nuevo (mientras piensa). Sin «desde»: los últimos 200 (o los anteriores a «antes»), con hayMas.
    const desde = num(q.get('desde'))
    const pagina = desde != null ? { mensajes: mensajes(db, conversacion.id, desde), hayMas: undefined } : ultimosMensajes(db, conversacion.id, Math.min(500, num(q.get('ultimos')) ?? 200), num(q.get('antes')))
    return { conversacion, ...pagina, pensando: estaPensando(conversacion.id), vivo: estadoEnVivo(conversacion.id) }
  }],
  ['POST', /^\/api\/chat\/(\d+)\/mensajes$/, (b, [c]) => {
    const cid = id(c)
    if (!String(b.texto ?? '').trim()) throw new Error('Mensaje vacío')
    // El turno corre en segundo plano; la pantalla sigue el avance leyendo los mensajes. Si ya está contestando, no se
    // frena: el mensaje entra a ese turno o al que sigue (ver enviar en chat/index.ts).
    void enviar(db, cid, String(b.texto), { hud: typeof b.hud === 'string' ? b.hud : null })
    return { ok: true }
  }],
  // 💡 Un consejo para este momento (solo cuando lo pide): entra como su pedido y contesta con lo que ve en vivo.
  ['POST', /^\/api\/chat\/(\d+)\/consejo$/, async (b, [c]) => {
    ;(await import('./copiloto.ts')).pedirConsejo(db, id(c), { hud: typeof b.hud === 'string' ? b.hud : null })
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
      ajustes: { primarias_semana: ajuste(db, 'primarias_semana'), tokens_dia_max: ajuste(db, 'tokens_dia_max'), pensar_cada_horas: ajuste(db, 'pensar_cada_horas'), meta_ingresos_mes: ajuste(db, 'meta_ingresos_mes'), directo_auto: ajuste(db, 'directo_auto'), fragua_por_noche: ajuste(db, 'fragua_por_noche'), ciclo_bandas: ajuste(db, 'ciclo_bandas'), horario_fijo: horarioComoTexto(leerHorario(db)), directo_tramo_min: ajuste(db, 'directo_tramo_min'), directo_privado: ajuste(db, 'directo_privado') },
    }
  }],
  // El HUD de Hoy: lo de cada modo que no viene en /api/hoy, y las líneas de registro de lo que se hace desde ahí
  // Hoy como tablero (plan v29): lo preparado, lo que espera y lo que corre. Liviano, sin modelo.
  ['GET', /^\/api\/hoy\/tablero$/, async () => corta('hoy-tablero', 15_000, async () => (await import('./tablero.ts')).tablero(db))],
  ['GET', /^\/api\/hoy\/hud$/, async () => {
    const fecha = fechaLocal()
    const ahora = new Date()
    const hhmm = ahora.toTimeString().slice(0, 5)
    const { eventos } = await agendaDelDia(fecha).catch(() => ({ eventos: [] as { titulo: string; inicio: number; fin: number; todoElDia: boolean }[] }))
    const salud = resumenDia(db, fecha)
    return {
      agenda: eventos.map((e) => ({ titulo: e.titulo, inicio: e.inicio, fin: e.fin, todoElDia: e.todoElDia })),
      fijo: bloquesDelDia(db, fecha),
      bucles: (await import('./bucles.ts')).listarBucles(db, { limite: 3 }).filter((b) => b.veces >= 2 || b.dias >= 14),
      foco: await (async () => { const f = await import('./foco.ts'); return { hoy: f.focoDelDia(db, fecha), meta: f.metaDeBloque(db) } })(),
      rutinas: listarRutinas(db).filter((r) => r.activa && r.dias.includes(String(ahora.getDay())) && r.hora > hhmm).map((r) => ({ nombre: r.nombre, hora: r.hora })).slice(0, 4),
      salud: { kcal: salud.kcal, proteina: salud.proteina, comidas: salud.comidas, ejercicio: salud.ejercicio, sueno: salud.sueno, peso: salud.peso, metas: salud.metas, entrenosSemana: resumenSemana(db, fecha).entrenos },
      plata: { resumen: resumenMes(db), ritmo: ritmoMeta(db) },
      teConozco: curva(db, fecha, 21).total,
      gasto: { ...tokensHoy(db), tope: topeDiario(db) },
      pregunta: siguientePregunta(db)?.texto ?? null,
      directo: propuestasPendientes(db),
    }
  }],
  // La voz de Mastropiero: una frase en audio (con caché) y las voces que hay.
  ['POST', /^\/api\/voz\/decir$/, async (b) => ({ url: await (await import('./voz.ts')).decir(db, String(b.texto ?? ''), dirAdjuntos()) })],
  ['GET', /^\/api\/voz$/, async () => { const v = await import('./voz.ts'); return { voces: v.VOCES_MASTROPIERO, voz: v.vozDeMastropiero(db) } }],
  ['POST', /^\/api\/hoy\/evento$/, (b) => (registrarEvento(db, conversacionHoy(db).id, String(b.texto ?? '')), { ok: true })],
  ['POST', /^\/api\/zona$/, (b) => recibirZona(db, b.zona)],
  ['POST', /^\/api\/uso$/, (b) => (anotarUso(db, 'vista', String(b.vista ?? '')), { ok: true })],
  // Cuántas veces abrió cada vista en 30 días: la pantalla ordena las pestañas de cada espacio por su uso real.
  ['GET', /^\/api\/uso\/vistas$/, () => Object.fromEntries(verUso(db, 30).vistas.map((v) => [v.nombre, v.veces]))],
  ['POST', /^\/api\/ajustes$/, (b) => {
    if (b.ciclo_bandas != null) {
      const c = String(b.ciclo_bandas).trim()
      if (!/^(0|\d{2,3}\s*\/\s*\d{1,2})$/.test(c)) throw new Error('El ciclo va como «90/20» (minutos de foco / de descanso), o 0 para no usar ciclos')
      fijarAjuste(db, 'ciclo_bandas', c.replace(/\s+/g, ''))
    }
    if (b.apps_estimulo != null) fijarAjuste(db, 'apps_estimulo', String(b.apps_estimulo).slice(0, 500))
    for (const k of ['primarias_semana', 'tokens_dia_max', 'pensar_cada_horas', 'directo_auto', 'fragua_por_noche', 'voz_mastropiero', 'directo_tramo_min']) if (b[k] != null && String(b[k]).trim()) fijarAjuste(db, k, String(b[k]).trim())
    if (b.directo_privado != null) fijarAjuste(db, 'directo_privado', String(b.directo_privado).slice(0, 1000))
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
  // Una idea, todas sus redes (plan v27): una pieza por cuenta, en borrador y agrupadas.
  ['POST', /^\/api\/cuentas\/idea$/, async (b) => { soloNube('Una idea en todas tus redes'); return (await import('./cuentas.ts')).difundirIdea(db, String(b.texto ?? ''), { cuentas: Array.isArray(b.cuentas) ? b.cuentas.map(Number) : undefined }) }],
  ['POST', /^\/api\/publicaciones\/(\d+)$/, (b, [p]) => resolverPublicacion(db, id(p), { accion: b.accion, texto: b.texto, cuando: b.cuando ? Number(b.cuando) : null, url: b.url || null })],
  ['GET', /^\/api\/taller$/, (_, __, q) => {
    const obras = libreria(db, { tipo: q.get('tipo') || undefined, q: q.get('q') || undefined })
    const cuenta: Record<string, number> = {}
    for (const o of libreria(db)) cuenta[o.ultima.tipo] = (cuenta[o.ultima.tipo] ?? 0) + 1
    const cola = estadoCola(db)
    const esperan = new Set(cola.enEspera.map((t) => t.artefacto))
    return { obras, haciendo: listarArtefactos(db, { limite: 40 }).filter((a) => a.estado === 'haciendo' && !esperan.has(a.id)), cola, cuenta, voces: VOCES, estilos: Object.fromEntries(Object.entries(ESTILOS).map(([k, v]) => [k, v.nombre])), aspectos: Object.fromEntries(Object.entries(ASPECTOS).map(([k, v]) => [k, v.nombre])), ffmpeg: hayFfmpeg(), artefactos: listarArtefactos(db, { limite: 80 }) }
  }],
  ['GET', /^\/api\/taller\/sugerencias$/, async (_, __, q) => ({ sugerencias: await sugerenciasTaller(db, q.get('tipo') || 'imagen') })],
  ['POST', /^\/api\/taller\/(\d+)\/borrar$/, (_, [a]) => (borrarArtefacto(db, id(a)), { ok: true })],
  // Crear pasa por la cola del Taller (de a uno, de fondo): la pantalla ve el avance y lo que espera.
  ['POST', /^\/api\/taller$/, async (b) => {
    const pedido = String(b.pedido ?? '').trim()
    if (!pedido && !(b.tipo === 'personaje' && b.entidadId)) throw new Error('Decime qué querés crear')
    if (!['juego', 'imagen', 'voz', 'personaje', 'video', 'visual'].includes(b.tipo)) throw new Error('Tipo inválido')
    if (b.tipo === 'visual') {
      // Un visual a mano también pasa por la caché: si ese concepto ya está dibujado, se reusa.
      const r = (await import('./taller-cola.ts')).pedirVisual(db, { clase: String(b.clase || 'diagrama'), pedido, concepto: String(b.concepto || pedido).slice(0, 120), origen: 'pantalla', prioridad: 8 })
      if (r.degradado) throw new Error(`Ahora no se puede: ${r.degradado}`)
      return { ok: true, artefacto: r.artefactoId, desdeCache: r.desdeCache }
    }
    const t = (await import('./taller-cola.ts')).encolarTaller(db, { tipo: 'crear', args: b, titulo: pedido || 'Personaje', prioridad: 8, origen: 'pantalla' })
    return { ok: true, trabajo: t.id }
  }],
  ['GET', /^\/api\/taller\/cola$/, async () => (await import('./taller-cola.ts')).estadoCola(db)],
  ['POST', /^\/api\/taller\/(\d+)\/valorar$/, (b, [a]) => valorarArtefacto(db, id(a), Number(b.estrellas), b.nota ?? null)],
  // La matriz de un término (sus ejes) y los homónimos.
  ['GET', /^\/api\/entidades\/(\d+)\/ejes$/, (_, [e]) => ejesDe(db, id(e))],
  // La ubicación en vivo (Fragua #195): solo si la prendió.
  ['GET', /^\/api\/ubicacion$/, async () => { const u = await import('./ubicacion.ts'); return { prendida: u.ubicacionPrendida(db), actual: u.ubicacionActual(db) } }],
  ['POST', /^\/api\/ubicacion$/, async (b) => (await import('./ubicacion.ts')).recibirUbicacion(db, { lat: Number(b.lat), lon: Number(b.lon), precision: b.precision == null ? null : Number(b.precision), fuente: 'compu' })],
  ['POST', /^\/api\/ubicacion\/prender$/, async (b) => (await import('./ubicacion.ts')).prenderUbicacion(db, !!b.prendida)],
  // Lo lento y lo que se rompe (plan v38, fase 1): para decidir con datos.
  ['GET', /^\/api\/benchmark$/, async () => (await import('./benchmark.ts')).verBanco(db)],
  ['POST', /^\/api\/benchmark$/, async (b) => { soloNube('El banco de pruebas'); const r = await (await import('./benchmark.ts')).correrBanco(db, { pruebas: Array.isArray(b.pruebas) ? b.pruebas : [] }); return { texto: r.texto } }],
  ['GET', /^\/api\/revision\/turnos$/, async (_, __, q) => (await import('./registro-turnos.ts')).registroTurnos(db, Math.min(90, Number(q.get('dias')) || 14))],
  ['GET', /^\/api\/errores$/, async (_, __, q) => (await import('./fallos.ts')).erroresRecientes(db, Math.min(24 * 30, Number(q.get('horas')) || 24))],
  ['GET', /^\/api\/errores\/md$/, async (_, __, q) => ({ markdown: (await import('./fallos.ts')).erroresEnMarkdown(db, Math.min(24 * 30, Number(q.get('horas')) || 24)) })],
  ['POST', /^\/api\/errores\/([\w-]+)\/fragua$/, async (_, [h]) => (await import('./fallos.ts')).errorALaFragua(db, h)],
  ['GET', /^\/api\/lento$/, async (_, __, q) => (await import('./autocritica.ts')).lento(db, Date.now(), Math.min(30, Number(q.get('dias')) || 7))],
  // El censo de un canal de YouTube (Fragua #187): verlo y aprobarlo (con cambios al plan).
  ['GET', /^\/api\/youtube\/censo$/, async (_, __, q) => (await import('./youtube-canal.ts')).leerCenso(db, String(q.get('canal') ?? ''))],
  ['POST', /^\/api\/youtube\/censo\/aprobar$/, async (b) => (await import('./youtube-canal.ts')).aprobarCenso(db, String(b.canal ?? ''), b.cambios ?? {})],
  // Mapamundi (plan v38, fase 7).
  ['GET', /^\/api\/mapamundi$/, async () => (await import('./mapamundi.ts')).estado(db)],
  ['POST', /^\/api\/mapamundi\/piloto$/, async () => (await import('./mapamundi.ts')).cargarPiloto(db)],
  ['POST', /^\/api\/mapamundi\/empezar$/, async (b) => {
    const lugar = await (await import('./mapa.ts')).ubicar(db, String(b.lugar ?? '').slice(0, 200))
    if (!lugar) throw new Error('No encontré ese lugar en el mapa')
    return (await import('./mapamundi.ts')).empezarEn(db, { lat: lugar.lat, lon: lugar.lon, nombre: String(b.lugar).trim() })
  }],
  ['POST', /^\/api\/mapamundi\/poblar$/, async (b) => (await import('./mapamundi.ts')).poblar(db, String(b.clave ?? ''))],
  ['POST', /^\/api\/mapamundi\/lente$/, async (b) => (await import('./mapamundi.ts')).fijarLente(db, String(b.lente ?? ''))],
  ['POST', /^\/api\/mapamundi\/disputas\/(\d+)\/jugar$/, async (b, [n]) => (await import('./mapamundi.ts')).jugar(db, id(n), { via: b.via === 'discurso' ? 'discurso' : 'fuerza', texto: b.texto == null ? undefined : String(b.texto) })],
  // Su feed con tope (plan v38, fase 5).
  ['GET', /^\/api\/feed$/, async () => { const f = await import('./feed.ts'); return { dias: f.feedDe(db), fuentes: f.fuentes(db), topes: f.topes(db) } }],
  ['POST', /^\/api\/feed\/fuentes$/, async (b) => (await import('./feed.ts')).sumarFuente(db, String(b.texto ?? ''))],
  ['POST', /^\/api\/feed\/fuentes\/(\d+)\/quitar$/, async (_, [n]) => (await import('./feed.ts')).quitarFuente(db, id(n))],
  ['POST', /^\/api\/feed\/tope$/, async (b) => (await import('./feed.ts')).fijarTope(db, b.plataforma, Number(b.n))],
  ['POST', /^\/api\/feed\/recolectar$/, async () => (await import('./feed.ts')).recolectar(db)],
  ['POST', /^\/api\/feed\/(\d+)\/voto$/, async (b, [n]) => (await import('./feed.ts')).votarItem(db, id(n), b.voto === 1 || b.voto === true ? 1 : 0)],
  // Las cápsulas de 40 s (Fragua #163).
  ['GET', /^\/api\/capsulas$/, async () => (await import('./capsulas.ts')).listarCapsulas(db)],
  ['POST', /^\/api\/capsulas\/(\d+)\/borrar$/, async (b, [n]) => (await import('./capsulas.ts')).borrarCapsula(db, id(n), b.motivo ?? null)],
  // Contacto con criterio (plan v38, fase 4): él anota el contexto previo de una pista.
  ['POST', /^\/api\/pistas\/(\d+)\/contexto$/, async (b, [n]) => (await import('./agentes/contacto.ts')).anotarContexto(db, id(n), String(b.texto ?? ''))],
  // Los criterios con que se arman las runs (Fragua #156).
  ['GET', /^\/api\/criterios$/, async () => (await import('./criterios.ts')).listar(db)],
  ['POST', /^\/api\/criterios$/, async (b) => (await import('./criterios.ts')).fijarPeso(db, String(b.clave ?? ''), Number(b.peso))],
  // La Fragua es para Deprocast (plan v38): lo que no, se mueve.
  ['POST', /^\/api\/propuestas\/(\d+)\/mover$/, async (b, [n]) => (await import('./delegar.ts')).moverPropuesta(db, id(n), b.a === 'idea' ? 'idea' : b.a === 'proyecto' ? 'proyecto' : 'encargo', { proyecto: b.proyecto })],
  // El video como fuente (#165) y el diario propio (#166).
  ['GET', /^\/api\/videos$/, async () => (await import('./video.ts')).listarVideos(db)],
  ['GET', /^\/api\/prensa$/, async (_, __, q) => (await import('./prensa.ts')).diarioDe(db, q.get('fecha'))],
  ['POST', /^\/api\/prensa$/, async (b) => (await import('./prensa.ts')).procesarPrensa(db, String(b.texto ?? ''), { fecha: b.fecha, origen: 'pegado' })],
  ['POST', /^\/api\/prensa\/(\d+)\/voto$/, async (b, [n]) => (await import('./prensa.ts')).votarNota(db, id(n), b.voto === 1 || b.voto === true ? 1 : b.voto === 0 || b.voto === false ? 0 : null)],
  // La ficha de empresa (Fragua #164).
  ['GET', /^\/api\/entidades\/(\d+)\/empresa$/, async (_, [e]) => (await import('./empresas.ts')).leerEmpresa(db, id(e))],
  ['POST', /^\/api\/entidades\/(\d+)\/empresa$/, async (b, [e]) => (await import('./empresas.ts')).guardarEmpresa(db, id(e), b)],
  ['POST', /^\/api\/empresas$/, async (b) => (await import('./empresas.ts')).ficharEmpresa(db, String(b.nombre ?? ''), b.datos ?? {})],
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
  ['POST', /^\/api\/taller\/(\d+)\/iterar$/, async (b, [a]) => {
    const x = leerArtefacto(db, id(a))
    if (!x) throw new Error(`No existe el artefacto ${a}`)
    const t = (await import('./taller-cola.ts')).encolarTaller(db, { tipo: 'iterar', args: { id: x.id, cambio: String(b.cambio ?? '') }, titulo: `${x.titulo} (mejora)`, prioridad: 8, origen: 'pantalla' })
    return { ok: true, trabajo: t.id }
  }],
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
  ['POST', /^\/api\/bandeja\/(\w+)\/(\d+)$/, async (b, [t, i]) => { await (await import('./sombra.ts')).resolverBandeja(db, t, id(i), b.accion); return { ok: true } }],
  // Varias de una («aceptar todas las tareas», «todo»): cada una por su camino; lo que falle se informa sin frenar el resto.
  ['POST', /^\/api\/bandeja\/lote$/, async (b) => (await import('./sombra.ts')).resolverLote(db, Array.isArray(b.items) ? b.items : [])],
  // El Directo en vivo, para Hoy: qué está haciendo, el bloque, la run, los últimos momentos y lo pendiente.
  ['GET', /^\/api\/directo\/vivo$/, async () => ({ vivo: (await import('./vivo.ts')).estadoVivo(db), bloque: (await import('./bloques.ts')).bloqueParaVivo(db) })],
  // El cierre del día hablado: Mastropiero abre con lo del día (en Hoy) y la pantalla prende la charla en vivo.
  ['POST', /^\/api\/hoy\/cierre$/, async () => {
    const texto = (await import('./jornada.ts')).textoDeCierre(db, fechaLocal())
    mensajeDeMastropiero(db, conversacionHoy(db).id, texto)
    return { texto }
  }],
  // Los bloques guiados: arrancarlo (sin largo, su meta) y cortarlo antes (la tarjeta va al chat de Hoy).
  ['POST', /^\/api\/bloque$/, async (b) => (await import('./bloques.ts')).arrancarBloque(db, { minutos: b.minutos != null ? Number(b.minutos) : null, tema: b.tema ? String(b.tema) : null })],
  ['POST', /^\/api\/bloque\/terminar$/, async () => {
    const r = (await import('./bloques.ts')).terminarBloque(db)
    if (r) mensajeDeMastropiero(db, conversacionHoy(db).id, r.tarjeta)
    return { ok: !!r }
  }],
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
  // Los dispositivos, desde la pantalla (con la clave): el código para vincular, la lista y revocar.
  ['GET', /^\/api\/dispositivos$/, async () => {
    const d = await import('./dispositivos.ts')
    const rs = await import('./rescate.ts')
    return { dispositivos: d.listarDispositivos(db).map((x) => ({ ...x, aporta: rs.aportes(db, x.id), rescate: rs.estadoRescate(db, x.id) })) }
  }],
  ['POST', /^\/api\/dispositivos\/(\d+)\/rescate\/(cerrar|reintentar)$/, async (_, [x, que]) => {
    const disp = (await import('./dispositivos.ts')).listarDispositivos(db).find((y) => y.id === id(x))
    if (!disp || disp.revocadoEn) throw new Error('Ese dispositivo no existe o está revocado')
    const rs = await import('./rescate.ts')
    if (que === 'cerrar') { const r = rs.cerrarRescate(db, disp); void r.trabajo.catch(() => {}); return { ...r, trabajo: undefined } }
    return rs.procesarPendientes(db, disp, Date.now(), true)
  }],
  // Tu día en capas (plan v38, fase 6).
  ['GET', /^\/api\/capas$/, async (_, __, q) => (await import('./capas.ts')).diaEnCapas(db, /^\d{4}-\d{2}-\d{2}$/.test(String(q.get('fecha'))) ? String(q.get('fecha')) : undefined)],
  ['POST', /^\/api\/dispositivos\/codigo$/, async () => (await import('./dispositivos.ts')).crearCodigo(db)],
  ['POST', /^\/api\/dispositivos\/(\d+)\/revocar$/, async (_, [x]) => { (await import('./dispositivos.ts')).revocarDispositivo(db, id(x)); return { ok: true } }],
  // Google (plan v35): el estado de la conexión y de Gmail, sincronizar ya y desconectar.
  ['GET', /^\/api\/google$/, async () => ({ ...(await import('./google/oauth.ts')).estadoGoogle(db), gmail: (await import('./google/gmail.ts')).estadoGmail(db) })],
  // El correo en la web (plan v35): la bandeja ordenada, el hilo, una respuesta propuesta y el borrador en Gmail.
  ['GET', /^\/api\/correo$/, async (_, __, q) => (await import('./google/correo.ts')).bandeja(db, { filtro: (q.get('filtro') || 'responder') as 'responder', q: q.get('q') || undefined, dias: Number(q.get('dias')) || undefined })],
  ['POST', /^\/api\/correo\/triar$/, async () => ({ triados: await (await import('./google/correo.ts')).triarCorreos(db) })],
  ['GET', /^\/api\/correo\/([\w-]+)$/, async (_, [m]) => (await import('./google/correo.ts')).hiloDe(db, m) ?? (async () => { const g = await import('./google/gmail.ts'); await g.leerMail(db, m); return (await import('./google/correo.ts')).hiloDe(db, m) })()],
  ['POST', /^\/api\/correo\/([\w-]+)\/proponer$/, async (b, [m]) => (await import('./google/correo.ts')).proponerRespuesta(db, m, b.indicacion ? String(b.indicacion) : null)],
  ['POST', /^\/api\/correo\/([\w-]+)\/borrador$/, async (b, [m]) => (await import('./google/correo.ts')).guardarBorrador(db, m, String(b.texto ?? ''))],
  ['POST', /^\/api\/correo\/([\w-]+)\/atendido$/, async (b, [m]) => (await import('./google/correo.ts')).marcarAtendido(db, m, b.atendido !== false)],
  // Encargos programados (plan v35, fase 7).
  ['GET', /^\/api\/programados$/, async () => (await import('./programados.ts')).listarProgramados(db)],
  ['POST', /^\/api\/programados$/, async (b) => (await import('./programados.ts')).crearProgramado(db, { titulo: b.titulo, pedido: String(b.pedido ?? ''), cuando: String(b.cuando ?? ''), drive: !!b.drive })],
  ['POST', /^\/api\/programados\/interpretar$/, async (b) => { const p = await import('./programados.ts'); const c = p.interpretarCuando(String(b.cuando ?? '')); return { cuando: p.describirCuando(c), proximo: p.proximoDe(c, Date.now()) } }],
  ['POST', /^\/api\/programados\/(\d+)$/, async (b, [x]) => (await import('./programados.ts')).cambiarProgramado(db, id(x), { titulo: b.titulo, pedido: b.pedido, cuando: b.cuando, drive: b.drive, activo: b.activo })],
  ['POST', /^\/api\/programados\/(\d+)\/correr$/, async (_, [x]) => {
    const p = await import('./programados.ts')
    // De fondo: un informe puede tardar minutos (la pantalla pregunta después).
    void p.correrProgramado(db, id(x)).catch((e) => console.error('  programado:', e instanceof Error ? e.message : e))
    return { empezado: true }
  }],
  ['POST', /^\/api\/programados\/(\d+)\/borrar$/, async (_, [x]) => (await import('./programados.ts')).borrarProgramado(db, id(x))],
  // La Criba del 72 (plan v36): el formato que reemplaza a La Mano.
  ['GET', /^\/api\/criba72$/, async () => (await import('./criba72.ts')).listarCribas(db)],
  ['POST', /^\/api\/criba72\/importar$/, async (b) => (await import('./criba72.ts')).importarCribas(db, b.cribas ?? b)],
  ['POST', /^\/api\/criba72\/armar$/, async (b) => {
    const c = await import('./criba72.ts')
    if (!String(b.tema ?? '').trim()) throw new Error('¿Sobre qué? Falta el tema de la criba.')
    return { trabajo: c.deFondo(`armar-${Date.now()}`, () => c.armarCriba(db, { tema: String(b.tema), para: b.para, grupo: b.grupo, ancla1: b.ancla1, ancla6: b.ancla6, enMente: b.enMente, padreId: b.padreId ? Number(b.padreId) : null })) }
  }],
  ['GET', /^\/api\/criba72\/trabajo\/([\w:-]+)$/, async (_, [x]) => (await import('./criba72.ts')).trabajo(x) ?? { estado: 'perdido' }],
  ['GET', /^\/api\/criba72\/(\d+)$/, async (_, [x]) => { const c = await import('./criba72.ts'); const cr = c.leerCriba(db, id(x)); if (!cr) throw new Error('No existe esa criba'); const s = c.sesionVigente(db, cr.id); return { criba: cr, sesion: s, metricas: c.metricas(cr, s) } }],
  ['POST', /^\/api\/criba72\/(\d+)\/empezar$/, async (b, [x]) => (await import('./criba72.ts')).empezar(db, id(x), b.enMente)],
  ['POST', /^\/api\/criba72\/sesion\/(\d+)\/votar$/, async (b, [x]) => (await import('./criba72.ts')).votar(db, id(x), Number(b.n), b.voto == null ? null : Number(b.voto), { duda: b.duda })],
  ['POST', /^\/api\/criba72\/(\d+)\/reiniciar$/, async (_, [x]) => (await import('./criba72.ts')).reiniciar(db, id(x))],
  ['POST', /^\/api\/criba72\/(\d+)\/archivar$/, async (_, [x]) => (await import('./criba72.ts')).archivarCriba(db, id(x))],
  ['POST', /^\/api\/criba72\/(\d+)\/leer$/, async (_, [x]) => { const c = await import('./criba72.ts'); return { trabajo: c.deFondo(`leer-${id(x)}`, () => c.leerConMastropiero(db, id(x))) } }],
  ['POST', /^\/api\/criba72\/(\d+)\/exportar$/, async (b, [x]) => {
    const c = await import('./criba72.ts')
    const cr = c.leerCriba(db, id(x))
    if (!cr) throw new Error('No existe esa criba')
    const s = c.sesionVigente(db, cr.id)
    return b.formato === 'md' || b.formato === 'txt' ? { formato: b.formato, texto: c.exportarTexto(cr, s, b.formato === 'md') } : { formato: 'json', datos: { protocolo: c.PROTOCOLO, ...c.exportarSesion(cr, s) } }
  }],
  // Agenda, contactos y tareas de Google (plan v35, fase 3).
  ['GET', /^\/api\/google\/mas$/, async () => ({
    calendario: (await import('./google-calendario.ts')).viaCalendario(),
    contactos: { ...(await import('./google/contactos.ts')).estadoContactos(db), sincronizado: Number(ajuste(db, 'contactos_sincronizado')) || null },
    tareas: (await import('./google/tareas.ts')).estadoTareas(db),
  })],
  ['POST', /^\/api\/google\/contactos\/sincronizar$/, async () => (await import('./google/contactos.ts')).sincronizarContactos(db)],
  ['POST', /^\/api\/google\/tareas$/, async (b) => { const t = await import('./google/tareas.ts'); t.prenderTareas(db, !!b.activa); return b.activa ? t.sincronizarTareas(db) : { ok: true } }],
  ['POST', /^\/api\/google\/tareas\/sincronizar$/, async () => (await import('./google/tareas.ts')).sincronizarTareas(db)],
  // Drive (plan v35): la carpeta Mastropiero (lo que va), las carpetas que entran al corpus (lo que viene) y sincronizar.
  ['GET', /^\/api\/drive$/, async () => (await import('./google/drive.ts')).estadoDrive(db)],
  ['POST', /^\/api\/drive\/ajustes$/, async (b) => {
    if (b.medios != null) fijarAjuste(db, 'drive_medios', b.medios ? '1' : '0')
    if (b.conversaciones != null) fijarAjuste(db, 'drive_conversaciones', b.conversaciones ? '1' : '0')
    return (await import('./google/drive.ts')).estadoDrive(db)
  }],
  ['GET', /^\/api\/drive\/carpetas$/, async (_, __, q) => (await import('./google/sheets.ts')).buscarEnDrive(db, q.get('q') || '', 'carpeta', 15)],
  ['POST', /^\/api\/drive\/carpetas$/, async (b) => (await import('./google/drive.ts')).sumarCarpetaCorpus(db, { id: String(b.id ?? ''), nombre: String(b.nombre ?? '') })],
  ['POST', /^\/api\/drive\/carpetas\/([\w-]+)\/sacar$/, async (_, [c]) => (await import('./google/drive.ts')).sacarCarpetaCorpus(db, c)],
  ['POST', /^\/api\/drive\/sincronizar$/, async () => {
    const d = await import('./google/drive.ts')
    const corpus = await d.sincronizarCorpus(db)
    const conversaciones = await d.archivarConversaciones(db)
    const subidos = await d.trabajarCola(db)
    return { corpus, conversaciones, subidos }
  }],
  // WhatsApp (plan v35): configurar, el estado, desvincular y una prueba.
  ['GET', /^\/api\/whatsapp$/, async () => (await import('./whatsapp.ts')).estadoWhatsapp(db)],
  ['POST', /^\/api\/whatsapp\/config$/, async (b) => (await import('./whatsapp.ts')).configurarWhatsapp(db, { numeroId: b.numeroId, token: b.token, secreto: b.secreto })],
  ['POST', /^\/api\/whatsapp\/suscribir$/, async (b) => (await import('./whatsapp.ts')).suscribirApp(db, b.cuentaId)],
  ['POST', /^\/api\/whatsapp\/reacciones$/, async (b) => { fijarAjuste(db, 'whatsapp_reacciones', b.prender ? '1' : '0'); return (await import('./whatsapp.ts')).estadoWhatsapp(db) }],
  ['POST', /^\/api\/whatsapp\/desvincular$/, async () => (await import('./whatsapp.ts')).desvincularWhatsapp(db)],
  ['POST', /^\/api\/whatsapp\/probar$/, async () => {
    const wa = await import('./whatsapp.ts')
    if (!(await wa.decirPorWhatsapp(db, '☿ Prueba desde Deprocast: si lees esto, WhatsApp anda.'))) throw new Error('No hay ventana abierta: WhatsApp solo deja escribirte si vos escribiste en las últimas 24 horas. Mandale cualquier cosa al número y probá de nuevo.')
    return { ok: true }
  }],
  ['GET', /^\/api\/perfil$/, async () => (await import('./perfil.ts')).perfil(db)],
  // En qué se van los tokens y los créditos del mes, por uso (para decidir topes y ruteo).
  ['GET', /^\/api\/creditos$/, async (_, __, q) => ({ porUso: (await import('./nan.ts')).creditosPorUso(db, Date.now(), Math.min(60, Number(q.get('n')) || 25), q.get('orden') === 'tokens'), porModelo: usoDelMes(db) })],
  ['POST', /^\/api\/google\/cliente$/, async (b) => (await import('./google/oauth.ts')).guardarCliente(db, { json: b.json ? String(b.json) : undefined, id: b.id ? String(b.id) : undefined, secreto: b.secreto ? String(b.secreto) : undefined }, b.origen ? String(b.origen) : undefined)],
  ['POST', /^\/api\/google\/sincronizar$/, async () => (await import('./google/gmail.ts')).sincronizarGmail(db)],
  ['POST', /^\/api\/google\/desconectar$/, async () => { await (await import('./google/oauth.ts')).desconectarGoogle(db); return { ok: true } }],
  ['GET', /^\/api\/apps-conectadas$/, async () => { const a = await import('./apps.ts'); const m = await import('./mcp.ts'); return { apps: a.listarApps(db), permisos: a.PERMISOS, mcp: { herramientas: m.HERRAMIENTAS_MCP, llamadas: m.llamadasMcp(db, 12) } } }],
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
  // La Academia (plan v23): los dominios con su tutor de 6 niveles, las sugeridas, y cada sesión (clase o examen).
  ['GET', /^\/api\/academia$/, async () => {
    const a = await import('./academia.ts')
    return {
      dominios: a.listarDominios(db), niveles: a.NIVELES_TUTOR.map(({ n, nombre }) => ({ n, nombre })),
      sugeridos: a.sugeridosDe(db).map((d) => ({ ...d, texto: a.textoSugerencia(d) })),
    }
  }],
  ['POST', /^\/api\/academia\/sugerir$/, async () => { soloNube('Qué te conviene aprender'); return { sugeridos: await (await import('./academia.ts')).sugerirAprendizajes(db) } }],
  // Su material: un link, un texto, un archivo ya subido (/api/chat/archivo) o una obra; y si sirve o no.
  ['POST', /^\/api\/academia\/(\d+)\/material$/, async (b, [a]) => ({ material: await (await import('./academia.ts')).sumarMaterial(db, id(a), { url: b.url ?? null, texto: b.texto ?? null, titulo: b.titulo ?? null, archivo: b.archivo ?? null, nombre: b.nombre ?? null, obraId: b.obraId ? Number(b.obraId) : null }) })],
  ['POST', /^\/api\/academia\/(\d+)\/material\/(\d+)$/, async (b, [a, f]) => ({ material: (await import('./academia.ts')).marcarMaterial(db, id(a), id(f), { util: b.util == null ? undefined : Number(b.util), quitar: !!b.quitar }) })],
  // El mapa de conceptos, el diagnóstico, la meta y los huecos (plan v24).
  // El proyecto del nivel: proponer (u otro), aceptar (queda como primaria), entregar (lo corrige el tutor), descartar.
  // El Observatorio (plan v27): los temas que sigue, cada uno con sus rondas y lo encontrado; una ronda a mano (en la nube).
  ['GET', /^\/api\/observatorio$/, async () => {
    const ob = await import('./observatorio.ts')
    return { temas: ob.listarTemas(db).map((t) => ({ ...t, ultima: ob.rondasDe(db, t.id, 1)[0] ?? null, enRonda: ob.rondaEnCurso(t.id) })), plataformas: ob.PLATAFORMAS, nombres: ob.NOMBRE_PLATAFORMA, cuotas: (await import('./web.ts')).cuotas(db) }
  }],
  ['POST', /^\/api\/observatorio$/, async (b) => (await import('./observatorio.ts')).seguirTema(db, { nombre: b.nombre, consultas: b.consultas, plataformas: b.plataformas, cadaHoras: b.cadaHoras })],
  ['GET', /^\/api\/observatorio\/(\d+)$/, async (_, [t]) => {
    const ob = await import('./observatorio.ts')
    const x = ob.leerTema(db, id(t))
    if (!x) throw new Error(`No existe el tema ${t}`)
    return { tema: x, rondas: ob.rondasDe(db, x.id, 30), items: ob.itemsDe(db, x.id, { limite: 300 }), enRonda: ob.rondaEnCurso(x.id), nombres: ob.NOMBRE_PLATAFORMA }
  }],
  ['POST', /^\/api\/observatorio\/(\d+)$/, async (b, [t]) => (await import('./observatorio.ts')).editarTema(db, id(t), { nombre: b.nombre, consultas: b.consultas, plataformas: b.plataformas, cadaHoras: b.cadaHoras, activo: b.activo, borrar: !!b.borrar })],
  ['POST', /^\/api\/observatorio\/(\d+)\/ronda$/, async (_, [t]) => { soloNube('Una ronda del Observatorio'); return (await import('./observatorio.ts')).ronda(db, id(t)) }],
  // El informe único (plan v29): los guardados, uno, y armar uno entre dos fechas (con apertura de Mastropiero, en la nube).
  ['GET', /^\/api\/informes$/, async () => { const inf = await import('./informe.ts'); return { informes: inf.listarInformes(db), semana: inf.rangoDeSemana(), enLaNube: enLaNube() } }],
  ['GET', /^\/api\/informes\/periodo$/, async (_, __, q) => { const inf = await import('./informe.ts'); const desde = String(q.get('desde') ?? ''); const hasta = String(q.get('hasta') ?? ''); return { desde, hasta, secciones: await inf.seccionesDe(db, desde, hasta) } }],
  ['GET', /^\/api\/informes\/(\d+)$/, async (_, [i]) => (await import('./informe.ts')).leerInforme(db, id(i)) ?? { error: 'No existe ese informe' }],
  ['POST', /^\/api\/informes$/, async (b) => { if (b.conModelo) soloNube('Armar el informe con Mastropiero'); return (await import('./informe.ts')).armarInforme(db, { desde: String(b.desde ?? ''), hasta: String(b.hasta ?? ''), conModelo: !!b.conModelo }) }],
  // Campañas con su gente (plan v27): crear, ver, hashtags (con chequeo), elegir, armar y cerrar (lo que gasta, en la nube).
  ['GET', /^\/api\/campanas$/, async () => {
    const ca = await import('./campanas.ts')
    return { campanas: ca.listarCampanas(db).map((c) => ({ ...c, piezas: ca.piezasDe(db, c.id).length })), cuentas: listarCuentas(db).filter((c) => c.activa && c.modo !== 'lectura').map((c) => ({ id: c.id, red: c.red, usuario: c.usuario, conector: c.conector })) }
  }],
  ['POST', /^\/api\/campanas$/, async (b) => (await import('./campanas.ts')).crearCampana(db, { titulo: b.titulo, objetivo: b.objetivo, mensaje: b.mensaje, inicio: Number(b.inicio), fin: b.fin ? Number(b.fin) : null, cuentas: b.cuentas, hashtag: b.hashtag })],
  ['GET', /^\/api\/campanas\/(\d+)$/, async (_, [c]) => (await import('./campanas.ts')).verCampana(db, id(c))],
  ['POST', /^\/api\/campanas\/(\d+)$/, async (b, [c]) => (await import('./campanas.ts')).editarCampana(db, id(c), { titulo: b.titulo, objetivo: b.objetivo, mensaje: b.mensaje, inicio: b.inicio ? Number(b.inicio) : undefined, fin: b.fin ? Number(b.fin) : undefined, cuentas: b.cuentas, borrar: !!b.borrar })],
  ['POST', /^\/api\/campanas\/(\d+)\/hashtags$/, async (_, [c]) => { soloNube('Proponer hashtags'); return { candidatos: await (await import('./campanas.ts')).proponerHashtags(db, id(c)) } }],
  ['POST', /^\/api\/campanas\/(\d+)\/hashtag$/, async (b, [c]) => (await import('./campanas.ts')).elegirHashtag(db, id(c), String(b.hashtag ?? ''))],
  ['POST', /^\/api\/campanas\/(\d+)\/armar$/, async (_, [c]) => { soloNube('Armar la campaña'); const r = await (await import('./campanas.ts')).armarCampana(db, id(c)); return { ...r, piezas: r.piezas.length } }],
  ['POST', /^\/api\/campanas\/(\d+)\/cerrar$/, async (_, [c]) => { soloNube('Cerrar la campaña'); return (await import('./campanas.ts')).cerrarCampana(db, id(c)) }],
  // Dejar listo ya lo que va a abrir (la próxima clase, la sesión de idioma, el grafo): lo hace la rutina; esto, a mano.
  ['POST', /^\/api\/adelantar$/, async () => { soloNube('Dejar listo lo que vas a abrir'); return (await import('./adelantar.ts')).adelantar(db) }],
  // Los agentes con misión (plan v26): crear, ver (con su diario), indicar, pausar y una sesión a mano (en la nube).
  ['GET', /^\/api\/agentes\/misiones$/, async () => {
    const mi = await import('./agentes/misiones.ts')
    const em = await import('./agentes/embudo.ts')
    return { misiones: mi.listarMisionesAgente(db).map((m) => ({ ...m, agente: conNivel(leer(db, m.agenteId)), trabajando: mi.misionTrabajando(m.id), ultimo: mi.diarioDe(db, m.id, 1)[0] ?? null, embudo: em.embudo(db, m.id), progreso: em.progreso(db, m) })) }
  }],
  ['POST', /^\/api\/agentes\/misiones$/, async (b) => (await import('./agentes/misiones.ts')).crearMisionAgente(db, { titulo: b.titulo, brief: b.brief, criterio: b.criterio, entidadId: b.entidadId ?? null, vence: b.vence ?? null, agenteId: b.agenteId || null })],
  ['GET', /^\/api\/agentes\/misiones\/(\d+)$/, async (_, [m]) => {
    const mi = await import('./agentes/misiones.ts')
    const x = mi.leerMisionAgente(db, id(m))
    if (!x) throw new Error(`No existe la misión ${m}`)
    const em = await import('./agentes/embudo.ts')
    const rivales = mi.listarMisionesAgente(db).filter((r) => r.madreId === x.id && r.estado === 'activa').map((r) => ({ id: r.id, agente: conNivel(leer(db, r.agenteId)), progreso: em.progreso(db, r) }))
    return { mision: x, agente: conNivel(leer(db, x.agenteId)), diario: mi.diarioDe(db, x.id, 200), trabajando: mi.misionTrabajando(x.id), embudo: em.embudo(db, x.id), progreso: em.progreso(db, x), pistas: em.pistasDe(db, { misionId: x.id }), rivales }
  }],
  ['POST', /^\/api\/agentes\/misiones\/(\d+)$/, async (b, [m]) => (await import('./agentes/misiones.ts')).editarMisionAgente(db, id(m), { estado: b.estado, brief: b.brief, titulo: b.titulo, criterio: b.criterio, vence: b.vence })],
  ['POST', /^\/api\/agentes\/misiones\/(\d+)\/instruir$/, async (b, [m]) => (await import('./agentes/misiones.ts')).instruir(db, id(m), String(b.texto ?? ''))],
  ['POST', /^\/api\/agentes\/misiones\/(\d+)\/trabajar$/, async (_, [m]) => {
    soloNube('Una sesión del agente')
    const r = await (await import('./agentes/misiones.ts')).trabajarMision(db, id(m))
    return { sesion: r.sesion, pasos: r.resultado.pasos, cerrada: r.cerrada, cortado: r.resultado.cortado }
  }],
  ['GET', /^\/api\/agentes\/pistas$/, async (_, __, q) => {
    const em = await import('./agentes/embudo.ts')
    return { pistas: em.pistasDe(db, { misionId: q.get('mision') ? Number(q.get('mision')) : undefined }), etapas: em.ETAPAS, nombres: em.NOMBRE_ETAPA }
  }],
  ['POST', /^\/api\/agentes\/pistas\/(\d+)$/, async (b, [p]) => {
    const pi = await import('./agentes/pistas.ts')
    if (b.borrador === 'enviar' || b.borrador === 'descartar') return pi.resolverBorrador(db, id(p), b.borrador, { texto: b.texto ?? null })
    return pi.marcarPista(db, id(p), b.etapa, { nota: b.nota ?? null })
  }],
  ['POST', /^\/api\/agentes\/([^/]+)\/genoma$/, async (b, [a]) => conNivel((await import('./agentes/genoma.ts')).fijarGenoma(db, decodeURIComponent(a), !!b.fijo))],
  ['GET', /^\/api\/agentes\/sala$/, async () => {
    const hoy = new Date(`${fechaLocal()}T00:00:00`).getTime()
    const diario = db.prepare(`SELECT d.id, d.tipo, d.texto, d.en, d.agente_id AS agente, m.id AS mision, m.titulo FROM agente_diario d JOIN agente_misiones m ON m.id = d.mision_id ORDER BY d.id DESC LIMIT 30`).all()
    const gasto = db.prepare(`SELECT l.agente_id AS agente, SUM(COALESCE(l.tokens_in, 0) + COALESCE(l.tokens_out, 0)) AS tokens FROM llamadas l WHERE l.en >= ? AND l.agente_id IN (SELECT agente_id FROM agente_misiones) GROUP BY l.agente_id`).all(hoy)
    return { trabajando: (await import('./agentes/motor.ts')).trabajandoAhora(), diario, gasto }
  }],
  ['POST', /^\/api\/agentes\/misiones\/(\d+)\/hablar$/, async (b, [m]) => {
    soloNube('Hablar con el agente')
    return { respuesta: await (await import('./agentes/misiones.ts')).hablarConMision(db, id(m), String(b.texto ?? '')) }
  }],
  // El Grafo (plan v25): las capas, los grafos propios, sus fotos, recalcular (en el hilo aparte) y el diccionario.
  ['GET', /^\/api\/grafos$/, async () => ({ grafos: (await import('./grafo/index.ts')).listarGrafos(db) })],
  ['POST', /^\/api\/grafos$/, async (b) => (await import('./grafo/index.ts')).crearGrafo(db, { nombre: b.nombre, fuentes: b.fuentes, desde: b.desde, hasta: b.hasta })],
  ['GET', /^\/api\/grafos\/diccionario$/, async () => ({ entradas: (await import('./grafo/index.ts')).entradasDiccionario(db) })],
  ['POST', /^\/api\/grafos\/diccionario$/, async (b) => ({ entradas: (await import('./grafo/index.ts')).editarDiccionario(db, { forma: b.forma, tipo: b.tipo || null, destino: b.destino ?? null }) })],
  ['POST', /^\/api\/grafos\/texto$/, async (b) => (await import('./grafo/index.ts')).analizarTexto(db, String(b.texto ?? ''))],
  ['GET', /^\/api\/grafos\/(\d+)$/, async (_, [g], q) => {
    const gr = await import('./grafo/index.ts')
    const x = gr.leerGrafo(db, id(g))
    if (!x) throw new Error(`No existe el grafo ${g}`)
    // Sin foto todavía: se calcula ahora (en el hilo aparte) y la pantalla espera; con foto, la última (o la pedida).
    const foto = q.get('foto') ? gr.leerFoto(db, Number(q.get('foto'))) : gr.ultimaFoto(db, x.id) ?? await gr.recalcular(db, x.id)
    const hu = await import('./grafo/huecos.ts')
    // La capa de sentido (Fragua #229): la guardada, o se empieza a calcular de fondo y la pantalla vuelve a pedirla.
    const se = await import('./grafo/sentido.ts')
    // Una foto de antes de la capa de sentido (sin sus ejemplos) se rehace sola, de fondo.
    if (foto && !foto.ejemplos && !gr.estaCalculando(x.id)) void gr.recalcular(db, x.id).catch(() => {})
    const sentido = foto?.ejemplos ? se.sentidoDe(db, foto) : null
    const calculandoSentido = foto ? se.calculandoSentido(foto.id) || (!foto.ejemplos && gr.estaCalculando(x.id)) : false
    // Los ejemplos (qué piezas tiene cada concepto) son para el servidor: no viajan a la pantalla.
    const { ejemplos: _e, ...fotoPantalla } = foto ?? ({} as any)
    return { grafo: x, foto: foto ? fotoPantalla : null, calculando: gr.estaCalculando(x.id), historia: gr.historia(db, x.id), huecos: hu.huecosDe(db, x.id).map((h) => ({ ...h, delta: hu.deltaDe(db, h) })), grafeador: hu.proximoTrabajo(db, x.id), zonas: foto ? (await import('./grafo/mapa.ts')).zonas(db, x, foto, 30) : [], entidades: foto ? gr.entidadesDeNodos(db, foto) : {}, sentido, calculandoSentido }
  }],
  // La salud: estado, historia semanal y su calibración, lo que cambió, posibles bucles y alias (sin modelo).
  ['GET', /^\/api\/grafos\/(\d+)\/salud$/, async (_, [g]) => (await import('./grafo/salud.ts')).saludDe(db, id(g))],
  // De qué va cada grupo (los resúmenes por comunidad): los escribe el modelo, en la nube.
  ['POST', /^\/api\/grafos\/(\d+)\/zonas$/, async (_, [g]) => {
    soloNube('De qué va cada grupo')
    const gr = await import('./grafo/index.ts')
    const x = gr.leerGrafo(db, id(g)), f = x ? gr.ultimaFoto(db, x.id) : null
    if (!x || !f) throw new Error('Ese grafo todavía no tiene foto')
    const r = await (await import('./grafo/mapa.ts')).resumir(db, x, f, { max: 12 })
    return { ...r, zonas: (await import('./grafo/mapa.ts')).zonas(db, x, f, 30) }
  }],
  ['POST', /^\/api\/grafos\/(\d+)$/, async (b, [g]) => (await import('./grafo/index.ts')).editarGrafo(db, id(g), { nombre: b.nombre, fuentes: b.fuentes, desde: b.desde, hasta: b.hasta, borrar: !!b.borrar })],
  // Leer el grafo: los fragmentos donde aparecen juntos, quitar lo obvio, el diff entre fotos y abrir el grafo de algo.
  ['GET', /^\/api\/grafos\/(\d+)\/fragmentos$/, async (_, [g], q) => ({ fragmentos: (await import('./grafo/leer.ts')).fragmentos(db, id(g), Number(q.get('foto')), { lema: q.get('a') ?? '', forma: q.get('fa') ?? q.get('a') ?? '' }, q.get('b') ? { lema: q.get('b')!, forma: q.get('fb') ?? q.get('b')! } : null) })],
  ['POST', /^\/api\/grafos\/fotos\/(\d+)\/sin$/, async (b, [f]) => (await import('./grafo/leer.ts')).sinLoObvio(db, id(f), Number(b.k) || 5)],
  ['GET', /^\/api\/grafos\/diff$/, async (_, __, q) => {
    const gr = await import('./grafo/index.ts')
    const a = gr.leerFoto(db, Number(q.get('a'))), b = gr.leerFoto(db, Number(q.get('b')))
    if (!a || !b) throw new Error('Elegí dos fotos del mismo grafo')
    return (await import('./grafo/leer.ts')).diffFotos(a, b)
  }],
  ['POST', /^\/api\/grafos\/de$/, async (b) => (await import('./grafo/leer.ts')).grafoDe(db, b.fuente, String(b.nombre ?? 'Grafo'))],
  // Los huecos: la pregunta, responderla, que la investigue un agente, a La Fragua, al Radar, descartar.
  ['POST', /^\/api\/grafos\/huecos\/(\d+)\/(pregunta|responder|investigar|fragua|derivar|radar|descartar)$/, async (b, [h, accion]) => {
    const hu = await import('./grafo/huecos.ts')
    if (accion === 'pregunta') { soloNube('La pregunta del hueco'); return hu.preguntarHueco(db, id(h), { forzar: !!b.forzar }) }
    if (accion === 'responder') {
      const r = hu.responderHueco(db, id(h), String(b.texto ?? ''))
      // Lo que su respuesta deja abierto para el sistema va solo a La Fragua (Fragua #197; en la nube: gasta tokens).
      if (enLaNube()) void hu.derivarDeRespuesta(db, id(h)).catch((e) => console.error('  hueco → fragua:', e instanceof Error ? e.message : e))
      return r
    }
    if (accion === 'investigar') { soloNube('Que lo investigue un agente'); return hu.investigarHueco(db, id(h)) }
    if (accion === 'derivar') { soloNube('Ver qué deja tu respuesta para el sistema'); const r = await hu.derivarDeRespuesta(db, id(h)); return { ...hu.leerHueco(db, id(h))!, derivada: r.propuestaId } }
    if (accion === 'fragua') return hu.aLaFragua(db, id(h))
    if (accion === 'radar') { soloNube('El Radar'); return hu.alRadar(db, id(h)) }
    return hu.descartarHueco(db, id(h))
  }],
  ['POST', /^\/api\/grafos\/(\d+)\/recalcular$/, async (b, [g]) => ({ foto: await (await import('./grafo/index.ts')).recalcular(db, id(g), { forzar: !!b.forzar }) })],
  // Su feedback y la revisión (plan v24): valorar cualquier cosa, las lecciones que salen de eso y las métricas.
  ['POST', /^\/api\/devoluciones$/, async (b) => (await import('./devoluciones.ts')).anotarDevolucion(db, { superficie: String(b.superficie ?? ''), ref: String(b.ref ?? ''), valor: Number(b.valor), nota: b.nota ?? null })],
  ['GET', /^\/api\/revision$/, async () => (await import('./devoluciones.ts')).revision(db)],
  ['POST', /^\/api\/lecciones\/destilar$/, async () => { soloNube('Destilar lecciones'); return (await import('./devoluciones.ts')).destilarLecciones(db) }],
  ['POST', /^\/api\/lecciones\/(\d+)$/, async (b, [l]) => ({ lecciones: (await import('./devoluciones.ts')).editarLeccion(db, id(l), { texto: b.texto, borrar: !!b.borrar }) })],
  ['POST', /^\/api\/academia\/(\d+)\/proyecto$/, async (_, [a]) => (await import('./academia.ts')).proponerProyecto(db, id(a))],
  ['POST', /^\/api\/academia\/proyecto\/(\d+)\/aceptar$/, async (_, [p]) => (await import('./academia.ts')).aceptarProyecto(db, id(p))],
  ['POST', /^\/api\/academia\/proyecto\/(\d+)\/entregar$/, async (b, [p]) => (await import('./academia.ts')).entregarProyecto(db, id(p), { texto: String(b.texto ?? ''), url: b.url || null })],
  ['POST', /^\/api\/academia\/proyecto\/(\d+)\/descartar$/, async (_, [p]) => (await import('./academia.ts')).descartarProyecto(db, id(p))],
  ['POST', /^\/api\/academia\/(\d+)\/mapa$/, async (_, [a]) => ({ conceptos: await (await import('./academia.ts')).armarMapa(db, id(a)) })],
  ['POST', /^\/api\/academia\/(\d+)\/diagnostico$/, async (_, [a]) => {
    const ac = await import('./academia.ts')
    const s = await ac.abrirSesionTutor(db, id(a), { diagnostico: true })
    return { sesion: s, turnos: ac.turnosDe(db, s.id), visual: null }
  }],
  ['POST', /^\/api\/academia\/(\d+)\/meta$/, async (b, [a]) => {
    const ac = await import('./academia.ts')
    const co = await import('./conceptos.ts')
    const d = ac.leerDominio(db, id(a))
    if (!d) throw new Error(`No existe el dominio ${a}`)
    co.fijarMeta(db, d, { fecha: b.fecha || null, nivel: b.nivel ? Number(b.nivel) : null })
    return { ritmo: co.ritmoDe(db, ac.leerDominio(db, d.id)!) }
  }],
  ['GET', /^\/api\/academia\/(\d+)\/huecos$/, async (_, [a]) => {
    const ac = await import('./academia.ts')
    const d = ac.leerDominio(db, id(a))
    if (!d) throw new Error(`No existe el dominio ${a}`)
    return (await import('./huecos.ts')).huecosDeDominio(db, d)
  }],
  ['GET', /^\/api\/academia\/huecos$/, async () => ({ huecos: await (await import('./huecos.ts')).huecosDeMetas(db) })],
  ['POST', /^\/api\/academia\/huecos\/reporte$/, async () => { soloNube('Lo que te falta'); return (await (await import('./academia.ts')).reporteHuecos(db)) ?? { texto: null, ideas: [] } }],
  ['POST', /^\/api\/academia\/(\d+)\/fuentes$/, async (_, [a]) => { soloNube('Buscar fuentes'); return (await import('./academia.ts')).buscarFuentes(db, id(a)) }],
  ['POST', /^\/api\/academia\/(\d+)\/aceptar$/, async (_, [a]) => (await import('./academia.ts')).aceptarSugerencia(db, id(a))],
  ['POST', /^\/api\/academia\/(\d+)\/descartar$/, async (_, [a]) => (await import('./academia.ts')).descartarSugerencia(db, id(a))],
  ['POST', /^\/api\/academia$/, async (b) => (await import('./academia.ts')).sumarDominio(db, { tema: String(b.tema ?? ''), porQue: b.porQue ?? null })],
  ['GET', /^\/api\/academia\/(\d+)$/, async (_, [a]) => {
    const ac = await import('./academia.ts')
    const d = ac.leerDominio(db, id(a))
    if (!d) throw new Error(`No existe el dominio ${a}`)
    const visuales = (db.prepare(`SELECT id FROM artefactos WHERE tipo = 'visual' AND json_extract(meta, '$.dominioId') = ? ORDER BY id DESC LIMIT 40`).all(d.id) as { id: number }[]).map((r) => leerArtefacto(db, r.id)!)
    const co = await import('./conceptos.ts')
    const conceptos = co.conceptosDe(db, d.id).map((c) => ({ ...c, dominioHoy: +co.dominioHoy(c).toFixed(2) }))
    const sigue = co.frontera(db, d.id, d.tutorNivel)?.id ?? null
    return { dominio: { ...d, nivelNombre: ac.nombreNivel(d.tutorNivel) }, conceptos, sigue, ritmo: co.ritmoDe(db, d), proyecto: ac.proyectoDe(db, d.id, d.tutorNivel), proyectoObligatorio: d.tutorNivel >= ac.NIVEL_PROYECTO_OBLIGATORIO, examen: ac.examenHabilitado(db, d.id), visuales, sesiones: ac.sesionesDe(db, d.id).map(({ paquete, ...s }) => ({ ...s, preguntas: paquete?.preguntas.length ?? 0, visual: paquete?.visual?.tipo ?? null })), recursos: await ac.recursosDominio(db, d), practicas: practicasDe(db, d.id, 10), grafo: (await import('./grafo/mapa.ts')).mapaDelDominio(db, d.id) }
  }],
  ['POST', /^\/api\/academia\/(\d+)\/sesion$/, async (b, [a]) => {
    const ac = await import('./academia.ts')
    const s = await ac.abrirSesionTutor(db, id(a), { examen: !!b.examen })
    return { sesion: s, turnos: ac.turnosDe(db, s.id), aclaraciones: ac.aclaracionesDe(db, s.id), visual: ac.visualDe(db, s) }
  }],
  ['GET', /^\/api\/academia\/sesion\/(\d+)$/, async (_, [s]) => {
    const ac = await import('./academia.ts')
    const x = ac.leerSesionTutor(db, id(s))
    if (!x) throw new Error(`No existe la sesión ${s}`)
    return { sesion: x, turnos: ac.turnosDe(db, x.id), aclaraciones: ac.aclaracionesDe(db, x.id), visual: ac.visualDe(db, x) }
  }],
  ['POST', /^\/api\/academia\/sesion\/(\d+)\/responder$/, async (b, [s]) => (await import('./academia.ts')).responderTutor(db, id(s), Number(b.i), String(b.respuesta ?? ''))],
  ['POST', /^\/api\/academia\/sesion\/(\d+)\/aclarar$/, async (b, [s]) => (await import('./academia.ts')).aclarar(db, id(s), b.i == null ? -1 : Number(b.i))],
  ['POST', /^\/api\/academia\/sesion\/(\d+)\/voz$/, async (b, [s]) => ({ urls: await (await import('./academia.ts')).audiosDe(db, id(s), { parte: b.parte, i: b.i == null ? undefined : Number(b.i), texto: b.texto }) })],
  ['POST', /^\/api\/academia\/sesion\/(\d+)\/cerrar$/, async (_, [s]) => (await import('./academia.ts')).cerrarSesionTutor(db, id(s))],
  // YouTube: la cola (videos y canales), importar varios, y lo que lee la compu (la nube no puede leer YouTube).
  ['GET', /^\/api\/youtube$/, async () => (await import('./youtube.ts')).estadoYoutube(db)],
  ['POST', /^\/api\/youtube\/importar$/, async (b) => (await import('./youtube.ts')).importarYoutube(db, String(b.texto ?? ''), { max: Number(b.max) || null, dominio: b.dominio ? String(b.dominio) : null })],
  ['GET', /^\/api\/youtube\/compu$/, async () => ({ items: (await import('./youtube.ts')).paraLaCompu(db) })],
  ['POST', /^\/api\/youtube\/leido$/, async (b) => (await import('./youtube.ts')).recibirDeLaCompu(db, b)],
  ['POST', /^\/api\/youtube\/reintentar$/, async () => {
    const y = await import('./youtube.ts')
    // A mano, todo vuelve a empezar (también lo que esperaba a la compu después de sus tres intentos en la nube), y Gemini
    // deja de descansar: si de verdad no tiene cupo, lo vuelve a decir.
    fijarAjuste(db, 'youtube_gemini_hasta', '0')
    const n = Number(db.prepare(`UPDATE youtube_cola SET estado = 'pendiente', intentos = 0, motivo = NULL WHERE estado IN ('fallo', 'sin_subtitulos', 'compu', 'gemini')`).run().changes)
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
  ['GET', /^\/api\/fragua$/, async () => {
    const forjas = listarForjas(db)
    // La última forja de cada propuesta, con su estado real (Fragua #209), al lado del título.
    const ultima = new Map<number, Forja>()
    for (const f of forjas) if (f.propuestaId && !ultima.has(f.propuestaId)) ultima.set(f.propuestaId, f)
    const forjaDe = (pid: number) => { const f = ultima.get(pid); return f ? { id: f.id, ...estadoReal(f) } : null }
    const [{ gruposDePropuestas }, { cerradasRecientes }, { estadoToken }] = await Promise.all([import('./fragua-grupos.ts'), import('./fragua-commits.ts'), import('./fragua-token.ts')])
    return {
      rama: ramaActual(), noSePuede: corta('fragua-puede', 60_000, () => porQueNoSePuedeForjar()),
      token: estadoToken(db),
      forjas: forjas.map(({ diff: _, ...f }) => ({ ...f, paso: pasoDeForja.get(f.id) ?? null, real: estadoReal(f) })),
      propuestas: (db.prepare(`SELECT id, titulo, detalle, area, prioridad, estado, nota, en_cola, origen FROM propuestas WHERE estado = 'abierta' ORDER BY id DESC`).all() as any[]).map((p) => ({ ...p, enCola: p.en_cola ?? null, forja: forjaDe(p.id) })),
      grupos: gruposDePropuestas(db),
      cerradas: cerradasRecientes(db),
      // Las seis categorías fijas, con cuántas abiertas y urgentes tiene cada una (Fragua #258).
      ...(await import('./fragua-areas.ts')).areasConCuenta(db),
    }
  }],
  // Cambiar la categoría de una propuesta: solo a una de las seis, y queda registro de la anterior.
  ['POST', /^\/api\/propuestas\/(\d+)\/area$/, async (b, [n]) => (await import('./fragua-areas.ts')).cambiarArea(db, id(n), String(b.area ?? ''), 'a mano')],
  ['GET', /^\/api\/fragua\/(\d+)$/, (_, [f]) => leerForja(db, id(f)) ?? (() => { throw new Error(`No existe la forja ${f}`) })()],
  ['POST', /^\/api\/fragua$/, async (b) => {
    const motivo = porQueNoSePuedeForjar()
    if (motivo) throw new Error(motivo)
    // Token vencido (Fragua #215): la propuesta no se pierde, queda en cola y se forja sola cuando vuelva.
    const tk = await import('./fragua-token.ts')
    const token = tk.estadoToken(db)
    if (token.vencido && b.propuestaId) { tk.encolar(db, Number(b.propuestaId)); return { encolada: true, aviso: token.aviso } }
    if (token.vencido) throw new Error(`${token.aviso} ${tk.PASOS_RENOVAR}`)
    const cubre = Array.isArray(b.grupo) ? b.grupo.map(Number).filter(Boolean) : undefined
    void forjarMejora(db, { propuestaId: b.propuestaId ? Number(b.propuestaId) : null, pedido: b.pedido || null, cubre }).then((f) => {
      const que = f.estado === 'lista' ? 'pasó el typecheck y los tests: está en La Fragua para que la leas y la apliques' : f.estado === 'rota' ? 'quedó hecha pero no pasa los tests' : `no salió (${(f.salida ?? '').slice(0, 160)})`
      mensajeDeMastropiero(db, conversacionHoy(db).id, `La forja #${f.id} ${que}.`)
    }).catch((e) => console.error('  fragua:', e instanceof Error ? e.message : e))
    return { empezada: true }
  }],
  ['POST', /^\/api\/fragua\/(\d+)\/aplicar$/, async (_, [f]) => (await import('./fragua.ts')).aprobarForja(db, id(f))],
  ['POST', /^\/api\/fragua\/(\d+)\/revertir$/, async (_, [f]) => (await import('./fragua.ts')).revertirForja(db, id(f))],
  ['POST', /^\/api\/fragua\/(\d+)\/descartar$/, (_, [f]) => descartarForja(db, id(f))],
  // Cerrada por un commit que no era (Fragua #211): vuelve a abierta y ese commit no la cierra más.
  ['POST', /^\/api\/propuestas\/(\d+)\/reabrir$/, async (_, [p]) => (await import('./fragua-commits.ts')).reabrirPropuesta(db, id(p))],
  ['POST', /^\/api\/propuestas\/(\d+)\/cola$/, async (_, [p]) => ((await import('./fragua-token.ts')).sacarDeCola(db, id(p)), { ok: true })],
  // Las otras del grupo, cubiertas por la principal (Fragua #208).
  ['POST', /^\/api\/propuestas\/cubrir$/, async (b) => (await import('./fragua-grupos.ts')).cubrirCon(db, Number(b.principal), (Array.isArray(b.ids) ? b.ids : []).map(Number))],
  ['POST', /^\/api\/fragua\/commits$/, async () => (await import('./fragua-commits.ts')).revisarCommits(db)],

  // Economía de agentes
  ['GET', /^\/api\/economia$/, (_, __, q) => ({ semana: q.get('semana') || semanaDe(), tarifas: TARIFAS, resultados: RESULTADOS, tabla: tablaEconomia(db, q.get('semana') || semanaDe()), historia: db.prepare('SELECT semana, COUNT(*) AS agentes, ROUND(SUM(neto), 1) AS neto FROM temporadas GROUP BY semana ORDER BY semana DESC LIMIT 8').all() })],

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
  // La paleta (Ctrl+K): las misiones que dicen eso; las personas y entidades ya las tiene la pantalla (/api/menciones).
  ['GET', /^\/api\/paleta$/, async (_, __, q) => ({ misiones: (await import('./misiones.ts')).buscarMisiones(db, String(q.get('q') ?? '').slice(0, 120)) })],
  ['GET', /^\/api\/buscar$/, async (_, __, q) => ({ piezas: await buscarHibrido(db, q.get('q') ?? '', num(q.get('limite')) ?? 20, nivelesDe(q.get('nivel'))), vectores: estadoVectores(db) })],
  ['GET', /^\/api\/vectores$/, () => estadoVectores(db)],
  ['POST', /^\/api\/vectores$/, async (b) => vectorizarPendientes(db, { limite: Math.min(Number(b.limite) || 64, 512) })],

  // Personas
  ['GET', /^\/api\/personas$/, (_, __, q) => conMatriz(db, personas(db, { q: q.get('q') || undefined, clase: q.get('clase') || undefined, estado: q.get('estado') || undefined, orden: q.get('orden') || undefined }))],
  ['POST', /^\/api\/personas\/nueva$/, (b) => nuevaPersona(db, b)],
  ['GET', /^\/api\/personas\/grafo$/, () => grafoPersonas(db)],
  // El reproceso (corre en la nube) y la línea temporal que arma.
  // El estado del Procesar hace ~20 conteos sobre tablas grandes y la pantalla lo pide cada 8 s: se reusa 15 s.
  ['GET', /^\/api\/reproceso$/, async () => {
    if (!reprocesoReciente || Date.now() - reprocesoReciente.en > 15_000) {
      await (await import('./reproceso.ts')).contarDeAPoco(db) // lo grande, de a uno y cediendo el turno (cada 2 min)
      reprocesoReciente = { en: Date.now(), valor: estadoReproceso(db) }
    }
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
  ['POST', /^\/api\/idiomas$/, async (b) => {
    const m = await import('./idiomas.ts')
    const i = m.crearIdioma(db, b)
    m.prepararEnFondo(db, i.aprendizajeId) // el kit inicial (temario, básicas y la primera sesión), en la nube
    return i
  }],
  ['POST', /^\/api\/idiomas\/(\d+)$/, async (b, [i]) => (await import('./idiomas.ts')).editarIdioma(db, id(i), b)],
  ['POST', /^\/api\/idiomas\/(\d+)\/abrir$/, async (b, [i]) => (await import('./idiomas.ts')).abrirPractica(db, id(i), Date.now(), { tema: b.tema ? String(b.tema) : null })],
  ['POST', /^\/api\/idiomas\/(\d+)\/preparar$/, async (_, [i]) => (await import('./idiomas.ts')).prepararSesion(db, id(i))],
  ['POST', /^\/api\/idiomas\/(\d+)\/responder$/, async (b, [i]) => (await import('./idiomas.ts')).responderPractica(db, id(i), { texto: String(b.texto ?? '') })],
  ['POST', /^\/api\/idiomas\/(\d+)\/cerrar$/, async (_, [i]) => ({ resumen: (await import('./idiomas.ts')).cerrarPractica(db, id(i)) })],
  // Tarjetas a mano: completar varias de una (borradores para revisar), guardarlas, y el mazo para verlo y limpiarlo.
  ['POST', /^\/api\/idiomas\/(\d+)\/completar$/, async (b, [i]) => ({ borradores: await (await import('./idiomas.ts')).completarTarjetas(db, id(i), Array.isArray(b.lineas) ? b.lineas : String(b.lineas ?? '').split('\n')) })],
  ['POST', /^\/api\/idiomas\/(\d+)\/tarjetas$/, async (b, [i]) => ({ nuevas: (await import('./idiomas.ts')).guardarTarjetas(db, id(i), Array.isArray(b.items) ? b.items : []) })],
  ['POST', /^\/api\/idiomas\/(\d+)\/tarjetas\/borrar$/, async (b, [i]) => ({ borradas: (await import('./tarjetas.ts')).borrarTarjetas(db, `idioma:${id(i)}`, Array.isArray(b.ids) ? b.ids : []) })],
  ['GET', /^\/api\/idiomas\/(\d+)\/tarjetas$/, async (_, [i]) => ({ tarjetas: (await import('./tarjetas.ts')).tarjetasDeMazo(db, `idioma:${id(i)}`) })],
  ['POST', /^\/api\/tarjetas\/(\d+)\/editar$/, async (b, [t]) => (await import('./tarjetas.ts')).editarTarjeta(db, id(t), { frente: b.frente ?? null, dorso: b.dorso ?? null })],
  ['POST', /^\/api\/tarjetas\/(\d+)\/borrar$/, async (_, [t]) => { (await import('./tarjetas.ts')).borrarTarjeta(db, id(t)); return { ok: true } }],
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
  ['GET', /^\/api\/duplicados$/, async () => duplicadosProbables(db, 40, (await import('./grafo/salud.ts')).paresPorGrafo(db))],
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
    const pq = await import('./pesquisa.ts')
    return {
      mazo: m.composicion(db), cartas: await m.robarMano(db, { saltear: (q.get('saltear') ?? '').split(',').filter(Boolean).map(Number) }), sorpresas: m.sorpresasPendientes(db),
      pesquisa: pq.pesquisaAbierta(db), modo: m.modoDeMano(db), ascension: m.ascension(db),
    }
  }],
  // La Pesquisa (pregunta → manos → síntesis → decisión → la próxima), el dial y las ascensiones.
  ['GET', /^\/api\/mano\/opciones$/, async () => (await import('./pesquisa.ts')).opcionesDePesquisa(db)],
  ['POST', /^\/api\/mano\/pesquisa$/, async (b) => (await import('./pesquisa.ts')).abrirPesquisa(db, { pregunta: b.pregunta ?? null, origen: b.origen, origenId: b.origenId == null ? null : Number(b.origenId), fuentes: Array.isArray(b.fuentes) ? b.fuentes : [], jokers: Array.isArray(b.jokers) ? b.jokers : [] })],
  ['POST', /^\/api\/mano\/pesquisa\/(\d+)\/cerrar$/, async (b, [k]) => (await import('./pesquisa.ts')).cerrarPesquisa(db, id(k), { decision: b.decision ?? null, fecha: b.fecha ?? null })],
  ['POST', /^\/api\/mano\/pesquisa\/(\d+)\/siguiente$/, async (b, [k]) => ({ pesquisa: (await import('./pesquisa.ts')).elegirSiguiente(db, id(k), b.eleccion === 'saltar' ? 'saltar' : Number(b.eleccion)) })],
  ['POST', /^\/api\/mano\/dial$/, async (b) => (await import('./mano.ts')).fijarDial(db, String(b.dial ?? ''))],
  ['GET', /^\/api\/mano\/sorpresas$/, async () => ({ sorpresas: (await import('./mano.ts')).sorpresasPendientes(db) })],
  ['POST', /^\/api\/mano\/choque$/, async (b) => (await import('./mano.ts')).marcarChoque(db, Number(b.nueva), Number(b.vieja))],
  ['POST', /^\/api\/mano\/sorpresas\/(\d+)$/, async (b, [k]) => (await import('./mano.ts')).responderSorpresa(db, id(k), String(b.respuesta ?? ''), b.porque ?? null)],
  ['POST', /^\/api\/mano\/(\d+)$/, async (b, [k]) => (await import('./mano.ts')).jugar(db, id(k), { gesto: b.gesto, peso: b.peso == null ? null : Number(b.peso), porque: b.porque ?? null, prediccion: b.prediccion == null ? null : Number(b.prediccion) })],
  ['GET', /^\/api\/mano\/progreso$/, async () => (await import('./progreso-mano.ts')).progresoDeMano(db)],
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
/** Una ficha con su nivel (la pantalla lo muestra; la ficha guarda solo la XP). */
const conNivel = (f: Ficha | null) => (f ? { ...f, nivel: nivel(f) } : null)

function soloNube(que: string) {
  if (!enLaNube()) throw new Error(`${que}: lo arma Mastropiero en la nube (gasta tokens de NaN). Pedilo desde tu Deprocast en la nube.`)
}

/**
 * Las apps conectadas (Morpheon y las que vengan): con su token (Authorization: Bearer), sin la clave de la pantalla.
 * Solo estas rutas: GET /api/apps/yo, POST /api/apps/suenos (JSON, multipart con «audio», o el audio crudo) y POST
 * /api/apps/eventos. Sin token o revocado: 401; sin el permiso: 403.
 */
/**
 * Tus dispositivos (plan v33): /api/dispositivo/vincular (con el código de 6 dígitos, sin token) y, con «Authorization:
 * Bearer dpd_…», hoy (lo mínimo para abrir al instante), mensaje (escribirle a Mastropiero) y voz (un segmento de audio:
 * se transcribe y se descarta). Sin la clave de la pantalla.
 */
async function atenderDispositivo(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const responder = (codigo: number, cuerpo: unknown) => void res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(cuerpo))
  const d = await import('./dispositivos.ts')
  const ruta = url.pathname.slice('/api/dispositivo/'.length)
  try {
    if (ruta === 'vincular') {
      if (req.method !== 'POST') return responder(405, { error: 'Usá POST' })
      const b = JSON.parse((await leerCrudo(req, 64 * 1024)).toString('utf8') || '{}')
      const r = d.vincular(db, { codigo: b.codigo, nombre: b.nombre, plataforma: b.plataforma, tipo: b.tipo })
      return responder(201, { token: r.token, dispositivo: r.dispositivo })
    }
    const disp = d.autenticarDispositivo(db, req.headers.authorization)
    if (!disp) return responder(401, { error: 'Falta el token del dispositivo o no es válido (Authorization: Bearer dpd_…)' })
    if (ruta === 'hoy' && req.method === 'GET') return responder(200, { dispositivo: disp.nombre, estado: disp.estado, ...(await d.paqueteHoy(db)) })
    // Tu día en capas (plan v38, fase 6): los minutos que juntó el teléfono.
    if (ruta === 'capas' && req.method === 'POST') {
      const b = JSON.parse((await leerCrudo(req, 2 * 1024 * 1024)).toString('utf8') || '{}')
      return responder(200, (await import('./capas.ts')).recibirCapas(db, disp.id, b.minutos))
    }
    // La ubicación desde un dispositivo (Fragua #195): solo si la prendió.
    if (ruta === 'ubicacion' && req.method === 'POST') {
      const b = JSON.parse((await leerCrudo(req, 16 * 1024)).toString('utf8') || '{}')
      return responder(200, await (await import('./ubicacion.ts')).recibirUbicacion(db, { lat: Number(b.lat), lon: Number(b.lon), precision: b.precision == null ? null : Number(b.precision), en: Number(b.en) || undefined, fuente: disp.nombre }))
    }
    // El rescate (plan v38, fase 6): inventario → subir cada ítem crudo → cerrar (recién ahí se procesa).
    const rs = await import('./rescate.ts')
    if (ruta === 'rescate' && req.method === 'GET') return responder(200, { estado: disp.estado, ...rs.estadoRescate(db, disp.id) })
    if (ruta === 'rescate' && req.method === 'POST') {
      const b = JSON.parse((await leerCrudo(req, 4 * 1024 * 1024)).toString('utf8') || '{}')
      return responder(200, rs.inventariar(db, disp, b.items))
    }
    if (ruta === 'rescate/subir' && req.method === 'POST') return responder(200, await rs.salvar(db, disp, String(url.searchParams.get('clave') ?? ''), await leerCrudo(req, 50 * 1024 * 1024)))
    if (ruta === 'rescate/cerrar' && req.method === 'POST') { const r = rs.cerrarRescate(db, disp); void r.trabajo.catch(() => {}); return responder(200, { ...r, trabajo: undefined }) }
    if (ruta === 'mensaje' && req.method === 'POST') {
      const b = JSON.parse((await leerCrudo(req, 256 * 1024)).toString('utf8') || '{}')
      const texto = String(b.texto ?? '').trim()
      if (!texto) return responder(400, { error: '¿Qué le digo?' })
      if (disp.estado === 'rescate') { await (await import('./rescate.ts')).guardarDuranteRescate(db, disp, 'mensaje', 'mensaje.txt', Buffer.from(texto), {}); return responder(202, { ok: true, rescate: true }) }
      void enviar(db, conversacionHoy(db).id, texto)
      return responder(202, { ok: true })
    }
    if (ruta === 'voz' && req.method === 'POST') {
      const pedido = url.searchParams.get('modo')
      const modo = pedido === 'pasivo' || pedido === 'conversacion' ? pedido : 'dictado'
      const n = (k: string) => (url.searchParams.get(k) != null ? Number(url.searchParams.get(k)) : undefined)
      const audio = await leerCrudo(req, 25 * 1024 * 1024)
      if (disp.estado === 'rescate') {
        await (await import('./rescate.ts')).guardarDuranteRescate(db, disp, 'audio', url.searchParams.get('nombre') || 'voz.wav', audio, { modo, inicio: n('inicio'), fin: n('fin'), caminando: url.searchParams.get('caminando') === '1' })
        return responder(202, { texto: '', destino: 'rescate' })
      }
      const r = await d.recibirVoz(db, disp, audio, url.searchParams.get('nombre') || 'voz.m4a', {
        modo, inicio: n('inicio'), fin: n('fin'), ruidoDb: n('ruidoDb'), proximidad: url.searchParams.get('proximidad') === '1', caminando: url.searchParams.get('caminando') === '1',
      })
      return responder(201, r)
    }
    // Las voces: lo último que se dijo (con su hablante), los hablantes, vincular uno a una persona, olvidarlo.
    const voces = await import('./hablantes.ts')
    if (ruta === 'turnos' && req.method === 'GET') return responder(200, { turnos: voces.ultimosTurnos(db, { desde: Number(url.searchParams.get('desde')) || 0 }), hablantes: voces.listarHablantes(db) })
    if (ruta === 'personas' && req.method === 'GET') return responder(200, { personas: voces.buscarPersonas(db, url.searchParams.get('q') ?? '') })
    const mh = /^hablantes\/(\d+)(\/olvidar)?$/.exec(ruta)
    if (mh && req.method === 'POST') {
      if (mh[2]) { voces.olvidarHablante(db, Number(mh[1])); return responder(200, { ok: true }) }
      const b = JSON.parse((await leerCrudo(req, 16 * 1024)).toString('utf8') || '{}')
      // «yo»: el hablante sos vos (tu entidad de operador).
      const entidad = b.yo ? (db.prepare(`SELECT id FROM entidades WHERE json_extract(meta, '$.operador') = 1 ORDER BY id LIMIT 1`).get() as { id: number } | undefined)?.id ?? null : b.entidadId == null ? null : Number(b.entidadId)
      if (b.yo && entidad == null) return responder(400, { error: 'Todavía no hay una entidad tuya (Jugador → «Soy yo»)' })
      return responder(200, voces.vincularHablante(db, Number(mh[1]), entidad))
    }
    return responder(404, { error: 'Ruta desconocida' })
  } catch (e) {
    return responder(400, { error: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * La puerta MCP (plan v29): POST /mcp con el token de una app que tenga «leer». JSON-RPC sin streaming y sin sesión;
 * GET y DELETE no abren nada (405). Un Origin de otro sitio no entra (lo pide el protocolo contra el DNS rebinding).
 */
async function atenderMcp(req: http.IncomingMessage, res: http.ServerResponse) {
  const responder = (codigo: number, cuerpo?: unknown) => void res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(cuerpo === undefined ? '' : JSON.stringify(cuerpo))
  if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end()
  if (!origenPermitido(req)) return responder(403, { error: 'Origen no permitido' })
  const apps = await import('./apps.ts')
  const { app, motivo } = apps.autenticarApp(db, req.headers.authorization, 'leer')
  if (!app) return responder(motivo === 'sin_permiso' ? 403 : 401, { error: motivo === 'sin_permiso' ? 'Esta app no tiene el permiso «leer» (MCP)' : 'Falta el token o no es válido (Authorization: Bearer dpc_…)' })
  let cuerpo: unknown
  try { cuerpo = JSON.parse((await leerCrudo(req, 1024 * 1024)).toString('utf8')) } catch { return responder(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }) }
  const r = await (await import('./mcp.ts')).atenderMcp(db, cuerpo, app)
  return r ? responder(200, r) : responder(202)
}

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
  res.once('close', marcar(`${req.method} ${(req.url ?? '/').split('?')[0].replace(/\/\d+/g, '/:n')}`))
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
  // Lo de los usuarios (su sesión, sus apps por /u/<id>, entrar, alta, cuenta, la administración) antes que nada.
  if (puerta && await puerta.atender(req, res, url)) return
  // Las apps conectadas entran con su token, no con la clave.
  if (url.pathname.startsWith('/api/apps/')) return atenderApp(req, res, url)
  if (url.pathname === '/mcp') return atenderMcp(req, res)
  if (url.pathname.startsWith('/api/dispositivo/')) return atenderDispositivo(req, res, url)
  // WhatsApp (plan v35): el webhook de Meta es público; lo valida su firma (y la verificación, el token del perfil).
  if (url.pathname === '/api/whatsapp/webhook') {
    const wa = await import('./whatsapp.ts')
    if (req.method === 'GET') {
      const reto = wa.verificarWebhook(db, url.searchParams)
      return void res.writeHead(reto ? 200 : 403, { 'content-type': 'text/plain' }).end(reto ?? 'no')
    }
    if (req.method !== 'POST') return void res.writeHead(405).end()
    const cuerpo = await leerCrudo(req, 5 * 1024 * 1024)
    if (!wa.firmaValida(db, cuerpo, String(req.headers['x-hub-signature-256'] ?? ''))) {
      // Si Meta llega con una firma que no cierra, casi siempre es la clave secreta equivocada: que se vea en el perfil.
      if (req.headers['x-hub-signature-256']) wa.anotarWhatsapp(db, 'Llegó un aviso de Meta con una firma que no coincide: la «Clave secreta de la app» guardada no es la de esta app')
      return void res.writeHead(401, { 'content-type': 'text/plain' }).end('firma')
    }
    // Meta quiere el 200 enseguida (si no, reintenta): lo demás se atiende de fondo.
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    let datos: unknown = null
    try { datos = JSON.parse(cuerpo.toString('utf8')) } catch { return }
    void wa.recibirWebhook(db, datos).catch((e) => console.error('  whatsapp:', e instanceof Error ? e.message : e))
    return
  }
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
  // Conectar Google (plan v35): ida a Google y vuelta con el código. La dirección pública (https detrás del proxy de la
  // nube; en el Deprocast de un usuario, la que trae el pedido) es la que Google tiene registrada.
  // La vuelta va ANTES de pedir la clave: el navegador no manda la cookie del dueño (SameSite=Strict) en una navegación
  // que viene de Google. La valida el estado de un solo uso que se generó con la sesión puesta (10 minutos).
  if ((url.pathname === '/google/conectar' || url.pathname === '/google/volver') && req.method === 'GET') {
    if (url.pathname === '/google/conectar' && !autorizado(req)) return void res.writeHead(303, { location: '/entrar' }).end()
    const g = await import('./google/oauth.ts')
    // En la nube es siempre https (el proxy de la plataforma puede decir http hacia adentro); en la compu, http.
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0].trim()
    const local = /^(localhost|\d+\.\d+\.\d+\.\d+|\[[0-9a-f:]+\])(:\d+)?$/i.test(host)
    const origen = `${detrasDeProxy() || !local ? 'https' : 'http'}://${host}`
    const pagina = (titulo: string, texto: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google · Deprocast</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1012;color:#e6e6e8;font:16px system-ui,sans-serif;padding:24px;box-sizing:border-box}div{max-width:420px}a{color:#c4a062}p{color:#9a9ca4}</style></head><body><div><h1>${titulo}</h1><p>${texto.replace(/[<>&]/g, '')}</p><a href="/">Volver a Deprocast</a></div></body></html>`
    try {
      if (url.pathname === '/google/conectar') return void res.writeHead(303, { location: g.urlDeConexion(db, origen), 'cache-control': 'no-store' }).end()
      await g.volverDeGoogle(db, { code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error') })
      // La primera pasada por el correo, de fondo (la pantalla no espera).
      void import('./google/gmail.ts').then((m) => m.sincronizarGmail(db)).catch((e) => console.error('  gmail:', e instanceof Error ? e.message : e))
      // Una página propia que lleva a Deprocast: esa navegación ya sale de este sitio y viaja con la cookie.
      return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(pagina('Google conectado', 'Te llevo a Deprocast…').replace('</head>', '<meta http-equiv="refresh" content="1;url=/?google=ok"></head>').replace('<a href="/">', '<a href="/?google=ok">'))
    } catch (e) {
      return void res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(pagina('No se pudo conectar Google', e instanceof Error ? e.message : String(e)))
    }
  }
  // Lo que Google pide para publicar la conexión: la página principal y la política de privacidad (públicas).
  if ((url.pathname === '/acerca' || url.pathname === '/privacidad') && req.method === 'GET') {
    const { paginaPublica } = await import('./publicas.ts')
    return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' }).end(paginaPublica(url.pathname === '/acerca' ? 'acerca' : 'privacidad'))
  }
  // Qué versión de la pantalla sirve (pública: para saber si un deploy llegó, sin datos de nadie).
  // vias: qué integraciones tiene cargadas este servidor (solo sí/no, nunca el valor): para saber si una variable nueva de NaN llegó.
  if (url.pathname === '/version') return void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ web: VERSION_WEB, commit: process.env.MASTRO_COMMIT ?? null, arranco: ARRANCO, caliente, activo: fondoActivo, vias: { gemini: !!process.env.GEMINI_API_KEY?.trim(), fragua: !!process.env.GITHUB_FRAGUA_TOKEN?.trim(), supadata: !!process.env.SUPADATA_API_KEY?.trim() }, bloqueos: bloqueos.slice(url.searchParams.has('todos') ? 0 : -8) }))
  if (!autorizado(req) && !['/manifest.webmanifest', '/icono.svg'].includes(url.pathname)) {
    if (url.pathname.startsWith('/api/')) return void res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'Falta la clave' }))
    return void res.writeHead(303, { location: '/entrar' }).end()
  }
  // Vincular un teléfono sin cargar todo el panel (plan v33): una página mínima con el código de 6 dígitos, ya con la
  // clave puesta. Cada visita da un código nuevo (el anterior deja de valer).
  if (url.pathname === '/vincular' && req.method === 'GET') {
    const { crearCodigo } = await import('./dispositivos.ts')
    const { codigo, vence } = crearCodigo(db)
    const hora = new Date(vence).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    // En el Deprocast de un usuario, su dirección lleva /u/<id> (así el teléfono llega a su base y no a la del dueño).
    const host = (req.headers.host ?? '') + (enUsuario() ? `/u/${process.env.MASTRO_USUARIO}` : '')
    return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vincular · Deprocast</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1012;color:#e6e6e8;font:16px system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}b{display:block;font-size:56px;letter-spacing:.15em;color:#c4a062;margin:16px 0}small{color:#9a9ca4;display:block;margin-top:8px;line-height:1.5}code{color:#e6e6e8}a{color:#c4a062}</style></head>
<body><div><div>☿ Código para vincular tu teléfono</div><b>${codigo.slice(0, 3)} ${codigo.slice(3)}</b>
<small>En la app: servidor <code>${host.replace(/[<>&"]/g, '')}</code> y este código.<br>Vale hasta las ${hora} y una sola vez. <a href="/vincular">Otro código</a></small></div></body></html>`)
  }
  // Compartir desde el celular (la app instalada): un link, un reel o un texto llega a Mastropiero.
  if (url.pathname === '/compartir' && req.method === 'POST') {
    const f = leerFormulario(await leerCrudo(req, 2 * 1024 * 1024), String(req.headers['content-type'] ?? ''))
    const compartido = [f.title, f.text, f.url].filter((x) => x?.trim()).join('\n').trim()
    if (compartido) {
      const link = /https?:\/\/\S+/.exec(compartido)?.[0] ?? null
      ingerir(db, { fuente: 'operador', titulo: `Compartido · ${(f.title || link || compartido).slice(0, 80)}`, contenido: compartido, url: link, dominio: 'compartido' })
      const c = conversacionHoy(db)
      void enviar(db, c.id, `Te compartí esto desde el celular:\n${compartido}`)
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
        void import('./google/drive.ts').then((d) => d.alDrive(db, { datos: foto.datos, nombre: url.searchParams.get('nombre') || 'foto.jpg', tipo: 'imagen', origen: 'registro', descripcion: [url.searchParams.get('texto'), c.descripcion].filter(Boolean).join('\n\n') })).catch(() => {})
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
          return void res.end(JSON.stringify(await estudio.crearEstudio(db, { archivo: ruta, titulo: (q.get('nombre') || 'Video').replace(/\.[\w]+$/, '') })))
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
        void import('./google/drive.ts').then((d) => d.alDrive(db, { datos: audio, nombre: url.searchParams.get('nombre') || 'audio.m4a', tipo: 'audio', origen: 'diario', descripcion: texto })).catch(() => {})
        void enviar(db, cid, texto)
        return void res.end(JSON.stringify({ texto }))
      }
      const crudo = req.method === 'POST' ? /^\/api\/directo\/(\d+)\/(cuadro|audio)$/.exec(url.pathname) : null
      if (crudo) {
        const sesion = Number(crudo[1])
        // Un Directo que ya se cerró (por ejemplo, 10 minutos sin señal): 410 y la pantalla se apaga sola. No es un error
        // del servidor (antes quedaba anotado cientos de veces).
        if (leerSesion(db, sesion)?.estado !== 'activa') {
          req.resume()
          res.statusCode = 410
          return void res.end(JSON.stringify({ error: 'Ese Directo ya se cerró', cerrado: true }))
        }
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
      // Lo que dice en una conversación (dictado, charla en vivo o la tecla para hablar): se transcribe y entra como suyo.
      const vozChat = req.method === 'POST' ? /^\/api\/chat\/(\d+)\/voz$/.exec(url.pathname) : null
      if (vozChat) {
        const cid = Number(vozChat[1])
        const audio = await leerCrudo(req, 25 * 1024 * 1024)
        const q = url.searchParams
        return void res.end(JSON.stringify(await (await import('./voz.ts')).escucharTurno(db, cid, audio, { nombre: q.get('nombre') || 'voz.webm', segundos: Number(q.get('segundos')) || null, hud: q.get('hud') || null })))
      }
      // La respuesta de una práctica de idioma, grabada: se transcribe en ese idioma y vuelve la devolución.
      // La respuesta hablada a una pregunta del tutor de la Academia: cruda, ?i= la pregunta.
      const audioTutor = req.method === 'POST' ? /^\/api\/academia\/sesion\/(\d+)\/audio$/.exec(url.pathname) : null
      if (audioTutor) {
        const audio = await leerCrudo(req, 25 * 1024 * 1024)
        return void res.end(JSON.stringify(await (await import('./academia.ts')).responderTutorAudio(db, Number(audioTutor[1]), Number(url.searchParams.get('i')), audio, url.searchParams.get('nombre') || 'respuesta.webm')))
      }
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
      // Una cápsula de 40 s (Fragua #163): el video crudo, con el consentimiento y el uso en la dirección.
      if (req.method === 'POST' && url.pathname === '/api/capsulas') {
        const q = url.searchParams
        const c = await (await import('./capsulas.ts')).guardarCapsula(db, await leerCrudo(req, 80 * 1024 * 1024), { persona: q.get('persona'), uso: q.get('uso'), consentimiento: q.get('consentimiento'), acepto: q.get('acepto'), duracion: q.get('duracion'), mime: req.headers['content-type'] ?? null })
        return void res.end(JSON.stringify(c))
      }
      const enCapsula = req.method === 'GET' ? /^\/api\/capsulas\/(\d+)\/video$/.exec(url.pathname) : null
      if (enCapsula) {
        const k = await import('./capsulas.ts')
        const c = k.leerCapsula(db, Number(enCapsula[1]))
        if (!c || c.estado !== 'vigente' || !fs.existsSync(k.archivoDe(c))) return void res.writeHead(404).end(JSON.stringify({ error: 'No está (o se borró)' }))
        res.writeHead(200, { 'content-type': c.mime, 'cache-control': 'private, no-store' })
        return void fs.createReadStream(k.archivoDe(c)).pipe(res)
      }
      // Un video (Fragua #165) viaja crudo: a la cola.
      if (req.method === 'POST' && url.pathname === '/api/videos') {
        const v = await import('./video.ts')
        const r = v.encolarVideo(db, await leerCrudo(req, 600 * 1024 * 1024), url.searchParams.get('nombre') || 'video.mp4', { modo: url.searchParams.get('modo') === 'prensa' ? 'prensa' : url.searchParams.get('modo') === 'fuente' ? 'fuente' : undefined, nota: url.searchParams.get('nota') })
        return void res.end(JSON.stringify(r))
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
      if (req.method === 'POST') cortas.clear() // lo que él cambia se ve en el acto
      const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : {}
      const params = url.pathname.match(r[1])!.slice(1)
      const corre = Promise.resolve().then(() => r[2](cuerpo, params, url.searchParams))
      if (req.method !== 'POST') return void res.end(JSON.stringify((await corre) ?? null))
      // Lo largo (un tick, destilar, el radar, preparar la run, la academia): a los 8 s se contesta «en marcha» con una
      // clave y el trabajo sigue de fondo, sin depender de la conexión. La pantalla pregunta hasta que termina (Fragua #83).
      const { conPaciencia } = await import('./trabajos.ts')
      const x = await conPaciencia(corre, `${req.method} ${url.pathname.replace(/\/\d+(?=\/|$)/g, '/:id')}`, Number(process.env.MASTRO_PACIENCIA_MS) || 8000)
      if (x.listo) return void res.end(JSON.stringify(x.valor ?? null))
      corre.catch((e) => { if (esErrorDeCodigo(e)) registrarError(db, 'ruta', `${req.method} ${url.pathname.replace(/\/\d+(?=\/|$)/g, '/:id')} (de fondo): ${e instanceof Error ? e.message : String(e)}`) })
      res.writeHead(202)
      res.end(JSON.stringify({ trabajo: x.clave, enMarcha: true }))
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
  if (path.basename(archivo) === 'index.html') {
    // En el Deprocast de un usuario, la pantalla sabe su dirección pública (/u/<id>) para mostrar la de sus apps y su MCP.
    const html = indexConVersiones(WEB)
    return void servirEstatico(req, res, archivo, 'text/html; charset=utf-8', { contenido: enUsuario() ? html.replace('<html lang="es">', `<html lang="es" data-base="/u/${Number(process.env.MASTRO_USUARIO)}">`) : html })
  }
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
  const finMarca = marcar('rutinas')
  try {
    // Lo nuevo (primarias, aprendizajes, metas) busca lo que ya había hecho hacia eso. En la nube (o sin NaN: por palabras).
    if (enLaNube() || !nanConfigurado()) await (await import('./evidencia.ts')).buscarPreviosPendientes(db).catch((e) => console.error('  previos:', e instanceof Error ? e.message : e))
    for (const r of await correrRutinas(db)) console.log(`  ⏰ rutina ${r.id}: ${r.ok ? 'hecha' : 'falló'}${r.mensaje ? ` — ${r.mensaje.slice(0, 80)}` : ''}`)
  } catch (e) {
    console.error('  ⏰ rutinas:', e instanceof Error ? e.message : e)
  } finally {
    enRutinas = false
    finMarca()
  }
}
deFondo(() => setInterval(latido, 60_000).unref())

// La liga sola (plan v30): cada 15 s, los de la casa (como mucho una vez por minuto, sin tokens) y, si Auto está
// prendido, en la nube, con trabajo y sin tope, un tick. Con --sin-rutinas no corre nada solo.
let enVueltaLiga = false
async function latidoLiga() {
  if (enVueltaLiga || process.env.MASTRO_SIN_RUTINAS) return
  enVueltaLiga = true
  const finMarca = marcar('liga')
  try {
    await (await import('./casa.ts')).vueltaDeLiga(db, { nube: enLaNube(), tick: () => tickUnico(db) })
  } catch (e) {
    if (!/ya está en un tick/.test(String(e))) console.error('  liga:', e instanceof Error ? e.message : e)
  } finally {
    enVueltaLiga = false
    finMarca()
  }
}
deFondo(() => setInterval(latidoLiga, 15_000).unref())

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
deFondo(() => {
  setInterval(async () => {
    const fin = marcar('directo')
    try {
      const s = await latidoDirecto(db)
      if (s?.informe) mensajeDeMastropiero(db, conversacionHoy(db).id, `El Directo se cortó (no me llegó nada en 10 minutos: se cerró la pestaña o se apagó el servidor), así que lo cerré yo. ${s.informe}`)
      else void tramoDirecto(db).catch((e) => console.error('  directo:', e instanceof Error ? e.message : e))
      // El bloque guiado que él arrancó: se cierra a su hora y avisa una vez si se fue del tema.
      const dicho = (await import('./bloques.ts')).vigilarBloque(db)
      if (dicho) mensajeDeMastropiero(db, conversacionHoy(db).id, dicho)
    } catch (e) { console.error('  directo:', e instanceof Error ? e.message : e) } finally { fin() }
  }, 60_000).unref()
})

// Mastropiero proactivo: alertas y una reflexión cada tantas horas (con las rutinas; nunca en una reunión).
let pensando = false
async function latidoPensar() {
  if (pensando || process.env.MASTRO_SIN_RUTINAS) return
  pensando = true
  const finMarca = marcar('pensar')
  try {
    for (const t of await pensar(db)) mensajeDeMastropiero(db, conversacionHoy(db).id, t)
  } catch (e) {
    console.error('  pensar:', e instanceof Error ? e.message : e)
  } finally {
    pensando = false
    finMarca()
  }
}
deFondo(() => setInterval(latidoPensar, 15 * 60_000).unref())
deFondo(() => setTimeout(latidoPensar, 60_000).unref())

// Vectores: de a tandas, lo que falta (lo propio primero). Barato, pero respeta el tope diario si lo hay.
let vectorizando = false
deFondo(() => {
  setInterval(async () => {
    if (vectorizando || process.env.MASTRO_SIN_RUTINAS || topeAlcanzado(db) || ajuste(db, 'vectorizar_auto') === '0') return
    vectorizando = true
    const fin = marcar('vectores')
    try { await vectorizarPendientes(db, { limite: 48 }) } catch (e) { console.error('  vectores:', e instanceof Error ? e.message : e) } finally { vectorizando = false; fin() }
  }, 10 * 60_000).unref()
})

// El reproceso: si él lo prendió, sigue solo (en la nube) con lo que falte y con lo nuevo que entra.
deFondo(() => {
  if (enLaNube() && !enVercel()) {
    const reprocesar = () => { if (ajuste(db, 'reproceso_activo') === '1') { const fin = marcar('reproceso'); void trabajarReproceso(db).catch((e) => console.error('  reproceso:', e instanceof Error ? e.message : e)).finally(fin) } }
    setTimeout(reprocesar, 90_000).unref()
    setInterval(reprocesar, 10 * 60_000).unref()
  }
})

// El Observatorio: cada 10 minutos, en la nube, las rondas que tocan; lo fuerte (o todo, si es una campaña en vivo) va a Hoy.
deFondo(() => {
  if (enLaNube() && !enVercel() && !process.env.MASTRO_SIN_RUTINAS) {
    let observando = false
    setInterval(async () => {
      if (observando || topeAlcanzado(db)) return
      observando = true
      const fin = marcar('observatorio')
      try {
        for (const t of await (await import('./observatorio.ts')).latidoObservatorio(db)) mensajeDeMastropiero(db, conversacionHoy(db).id, t)
        for (const t of await (await import('./campanas.ts')).latidoCampanas(db)) mensajeDeMastropiero(db, conversacionHoy(db).id, t)
      } catch (e) { console.error('  observatorio:', e instanceof Error ? e.message : e) } finally { observando = false; fin() }
    }, 10 * 60_000).unref()
  }
})

// Recién arrancado, en la nube: lo que va a abrir (la próxima clase, la sesión de idioma, el grafo) se deja listo de fondo,
// sin esperar a la rutina (un reinicio no lo deja esperando al modelo).
deFondo(() => {
  if (enLaNube() && !enVercel() && !process.env.MASTRO_SIN_RUTINAS) {
    setTimeout(() => { if (!topeAlcanzado(db)) void import('./adelantar.ts').then((a) => a.adelantar(db)).catch((e) => console.error('  adelantar:', e instanceof Error ? e.message : e)) }, 3 * 60_000).unref()
  }
})

// Gmail (plan v35): cada 5 minutos, lo nuevo del correo (si Google está conectado).
deFondo(() => setInterval(async () => {
  try {
    const { googleConectado } = await import('./google/oauth.ts')
    if (!googleConectado(db)) return
    const fin = marcar('gmail')
    try {
      await (await import('./google/gmail.ts')).sincronizarGmail(db)
      // Lo que llegó, ordenado para atender (si no corre solo con tope alcanzado).
      if (!topeAlcanzado(db)) await (await import('./google/correo.ts')).triarCorreos(db)
    } finally { fin() }
  } catch (e) { console.error('  gmail:', e instanceof Error ? e.message : e) }
}, 5 * 60_000).unref())

// Encargos programados: cada minuto, los que tocan.
deFondo(() => setInterval(async () => {
  const fin = marcar('programados')
  try { await (await import('./programados.ts')).latidoProgramados(db) } catch (e) { console.error('  programados:', e instanceof Error ? e.message : e) } finally { fin() }
}, 60_000).unref())

// Google Tasks (cada 10 minutos, si lo prendió) y sus contactos (cada 6 horas).
deFondo(() => setInterval(async () => {
  const fin = marcar('tareas')
  try { const t = await import('./google/tareas.ts'); const { googleConectado } = await import('./google/oauth.ts'); if (googleConectado(db) && t.tareasActivas(db)) await t.sincronizarTareas(db) } catch (e) { console.error('  tareas de Google:', e instanceof Error ? e.message : e) } finally { fin() }
}, 10 * 60_000).unref())
deFondo(() => setInterval(async () => {
  const fin = marcar('contactos')
  try { const { googleConectado } = await import('./google/oauth.ts'); if (googleConectado(db) && (ajuste(db, 'google_alcances') ?? '').includes('contacts')) await (await import('./google/contactos.ts')).sincronizarContactos(db) } catch (e) { console.error('  contactos de Google:', e instanceof Error ? e.message : e) } finally { fin() }
}, 6 * 3_600_000).unref())

// Drive (plan v35): lo que espera para subir a su carpeta Mastropiero (cada 2 minutos), y cada media hora las
// conversaciones de hoy (y las de ayer, para cerrarlas) y las carpetas de su Drive que entran al corpus.
deFondo(() => setInterval(async () => {
  const fin = marcar('drive-cola')
  try { const { googleConectado } = await import('./google/oauth.ts'); if (googleConectado(db)) await (await import('./google/drive.ts')).trabajarCola(db) } catch (e) { console.error('  drive:', e instanceof Error ? e.message : e) } finally { fin() }
}, 2 * 60_000).unref())
deFondo(() => setInterval(async () => {
  try {
    const { googleConectado } = await import('./google/oauth.ts')
    if (!googleConectado(db)) return
    const d = await import('./google/drive.ts')
    const fin = marcar('drive')
    try {
      await d.archivarConversaciones(db, fechaLocal(Date.now() - 86_400_000))
      await d.archivarConversaciones(db)
      await d.sincronizarCorpus(db)
    } finally { fin() }
  } catch (e) { console.error('  drive:', e instanceof Error ? e.message : e) }
}, 30 * 60_000).unref())

// Las cuentas: lo aprobado se publica en su horario (solo con conector; «redacta» solo lo que él aprobó).
deFondo(() => {
  setInterval(async () => {
    const fin = marcar('cuentas')
    try {
      for (const p of await publicarPendientes(db)) if (p.estado === 'fallo') mensajeDeMastropiero(db, conversacionHoy(db).id, `No pude publicar: ${p.error}`)
    } catch (e) { console.error('  cuentas:', e instanceof Error ? e.message : e) } finally { fin() }
  }, 5 * 60_000).unref()
})

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
deFondo(() => {
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
      // Cada 15 minutos: lo que esperaba una vía vuelve a probar, y los canales aprobados siguen a su ritmo.
      setInterval(() => { y.reintentarConServicio(db); void y.trabajarYoutube(db).catch(() => {}) }, 15 * 60_000).unref()
    })
  }
})
deFondo(() => {
  if (telegramActivo() && !enVercel()) {
    escucharTelegram(db)
    setInterval(() => { const fin = marcar('telegram'); void latidoTelegram(db).catch(() => {}).finally(fin) }, 60_000).unref()
    alDecirSolo((texto) => void decirPorTelegram(texto).catch(() => {}))
  }
})

// WhatsApp: lo que Mastropiero dice solo también sale por ahí (si escribió en las últimas 24 horas).
deFondo(() => alDecirSolo((texto) => void import('./whatsapp.ts').then((wa) => wa.decirPorWhatsapp(db, texto)).catch(() => {})))
// La Fragua en la nube (plan v38, fase 2): lo aprobado que no llegó a correr en 15 minutos, se revierte solo.
// La Fragua sola (Fragua #211, #212, #215): los commits que nombran propuestas las cierran; el token se mira (avisa
// antes de que venza y forja lo que quedó en cola cuando vuelve); los bloqueos de la última hora arman su propuesta.
const avisarFragua = (t: string) => mensajeDeMastropiero(db, conversacionHoy(db).id, t, { canales: true })
deFondo(() => {
  const commits = () => { const fin = marcar('fragua-commits'); void import('./fragua-commits.ts').then((c) => c.revisarCommits(db)).catch((e) => console.error('  fragua commits:', e instanceof Error ? e.message : e)).finally(fin) }
  setTimeout(commits, 90_000).unref()
  setInterval(commits, 10 * 60_000).unref()
  const token = () => { const fin = marcar('fragua-token'); void import('./fragua-token.ts').then(async (tk) => {
    await tk.revisarToken(db, Date.now(), avisarFragua)
    await tk.forjarCola(db, (pid) => forjarMejora(db, { propuestaId: pid }).then((f) => avisarFragua(`La propuesta #${pid} estaba en cola por el token: ya se forjó (forja #${f.id}, ${estadoReal(f)?.texto ?? f.estado}).`)))
  }).catch((e) => console.error('  fragua token:', e instanceof Error ? e.message : e)).finally(fin) }
  setTimeout(token, 120_000).unref()
  setInterval(token, 3 * 3_600_000).unref()
  setInterval(() => { void import('./autocritica.ts').then((a) => { const r = a.propuestaPorBloqueos(db); if (r?.nueva) console.log(`  ⚒ bloqueos → propuesta #${r.id}`) }).catch(() => {}) }, 60 * 60_000).unref()
})
deFondo(() => setInterval(() => { const fin = marcar('fragua-vigia'); void import('./fragua-nube.ts').then((f) => f.vigilarAprobadas(db, Date.now(), (t) => mensajeDeMastropiero(db, conversacionHoy(db).id, t, { canales: true }))).catch((e) => console.error('  fragua vigía:', e instanceof Error ? e.message : e)).finally(fin) }, 5 * 60_000).unref())
// El rescate (plan v38, fase 6): cada hora se borran las copias del servidor ya procesadas y subidas al Drive.
deFondo(() => { setInterval(() => void import('./rescate.ts').then((r) => r.limpiar(db)).catch(() => {}), 3_600_000).unref() })
// Su feed (plan v38, fase 5): las fuentes se recolectan cada 6 horas (y al rato de arrancar).
deFondo(() => {
  const recolectar = () => { const fin = marcar('feed'); void import('./feed.ts').then((f) => f.recolectar(db)).catch((e) => console.error('  feed:', e instanceof Error ? e.message : e)).finally(fin) }
  setTimeout(recolectar, 5 * 60_000).unref()
  setInterval(recolectar, 6 * 3_600_000).unref()
})
// Los videos que quedaron en la cola (o a mitad) por un reinicio: siguen.
deFondo(() => setTimeout(() => void import('./video.ts').then((v) => v.trabajarVideos(db)).catch((e) => console.error('  videos:', e instanceof Error ? e.message : e)), 45_000).unref())
// WhatsApp: lo que un reinicio (una actualización) cortó a mitad de respuesta, se retoma al minuto de arrancar.
setTimeout(() => void import('./whatsapp.ts').then((wa) => wa.retomarWhatsapp(db)).catch((e) => console.error('  whatsapp retomar:', e instanceof Error ? e.message : e)), 70_000).unref?.()

// Las runs las arranca él: su latido (reporte por hora, cierre de la run vencida) corre aunque las rutinas estén apagadas.
let enRuns = false
async function latidoDeRuns() {
  if (enRuns) return
  enRuns = true
  const finMarca = marcar('runs')
  try {
    for (const texto of await latidoRuns(db)) mensajeDeMastropiero(db, conversacionHoy(db).id, texto)
    // Cada banda, sola y un minuto antes, por Telegram y WhatsApp (Fragua #182).
    await (await import('./telegram.ts')).avisarBandas(db).catch((e) => console.error('  ⏱ bandas:', e instanceof Error ? e.message : e))
  } catch (e) {
    console.error('  ⏱ runs:', e instanceof Error ? e.message : e)
  } finally {
    enRuns = false
    finMarca()
  }
}
deFondo(() => setInterval(latidoDeRuns, 60_000).unref())
deFondo(() => setTimeout(latido, 3_000).unref())

const problemaDeAcceso = validarAcceso()
if (!enVercel()) {
  if (problemaDeAcceso) {
    console.error(`\n  ✗ ${problemaDeAcceso}\n`)
    process.exit(1)
  }
  servidor.listen(PUERTO, host(), () => {
    console.log(`\n  ☿ Mastropiero en http://${host() === '0.0.0.0' ? '127.0.0.1' : host()}:${PUERTO}${expuesto() ? '   (expuesto a la red: pide clave)' : ''}   (base: ${process.env.MASTRO_DB ?? 'data/mastro.db'} · motor de reclutas: ${MOTOR_DEFECTO()})\n`)
    if (!process.env.MASTRO_SIN_PRECALENTAR) setTimeout(() => void precalentar(), arrancaEnEspera ? 0 : 1500)
    else caliente = true
  })
}

/**
 * Recién arrancado, el primer pedido de cada pantalla paga el frío (SQLite sin páginas en memoria, código sin
 * compilar): /api/estado tardaba 700 ms la primera vez y 35 ms después. Las rutas que la pantalla pide primero se
 * corren una vez de fondo, de a una y cediendo el turno entre cada una, así cuando él abre ya están calientes.
 */
async function precalentar() {
  const fin = marcar('precalentar')
  for (const ruta of ['/api/estado', '/api/meta', '/api/hoy', '/api/hoy/hud', '/api/hoy/tablero', '/api/bandeja', '/api/menciones', '/api/chat', '/api/personas', '/api/reproceso', '/api/academia', '/api/taller', '/api/mano']) {
    const r = rutas.find(([m, re]) => m === 'GET' && re.test(ruta))
    if (!r) continue
    try { await r[2]({}, ruta.match(r[1])!.slice(1), new URLSearchParams()) } catch { /* una ruta que falla en frío no frena al resto */ }
    await new Promise((ok) => setImmediate(ok))
  }
  caliente = true
  fin()
}

export { servidor }
