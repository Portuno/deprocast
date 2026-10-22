/**
 * El chat: hablar con Mastropiero (que opera toda la plataforma con herramientas) o con cualquier agente de la liga.
 * Cada turno es un bucle: el modelo responde o pide herramientas; las herramientas corren y vuelven; hasta que contesta.
 * Todo se guarda mensaje a mensaje, así la pantalla ve el avance mientras el turno corre.
 */
import { ahoraEnPalabras, calendarioCorto } from '../zona.ts'
import { horarioParaPrompt } from '../horario.ts'
import { yoParaPrompt } from '../yo.ts'
import { anotarUso } from '../uso.ts'
import { afirmaAccion, correccionesParaPrompt, pareceCorreccion, registrarCorreccion } from './correcciones.ts'
import { armarHistorial } from './historial.ts'
import { comoTexto } from './adjuntos.ts'
import { fechaLocal, type Db } from '../db.ts'
import { anotar } from '../decisiones.ts'
import { CLASES } from '../clases.ts'
import { asientos, especializacion } from '../auditor.ts'
import { ingerir } from '../mastropiero.ts'
import { leerJornada, progreso, registrarCierre } from '../jornada.ts'
import { listarMisiones, misionesParaPrompt } from '../misiones.ts'
import { menciones } from '../menciones.ts'
import { directoParaPrompt } from '../directo.ts'
import { vivoParaPrompt } from '../vivo.ts'
import { bloqueParaPrompt } from '../bloques.ts'
import { finanzasParaPrompt } from '../finanzas.ts'
import { saludParaPrompt } from '../salud.ts'
import { cienParaPrompt } from '../cien.ts'
import { aprenderParaPrompt } from '../aprender.ts'
import { personasParaPrompt } from '../personas.ts'
import { libreriaParaPrompt } from '../libreria.ts'
import { leerEntidad as leerEnt } from '../entidades.ts'
import { escribaDeMemoria, memoriaParaPrompt } from '../memoria.ts'
import { listarEntidades } from '../entidades.ts'
import { estadoLiga, numeroDeTick } from '../mastropiero.ts'
import { cadena, topeAlcanzado, type LlamadaHerramienta } from '../nan.ts'
import { llamarModelo } from '../modelo.ts'
import { alias, leer, nivel, type Ficha } from '../roster.ts'
import { capa } from '../xp.ts'
import { activas, ejecutarHerramienta, esquemas, GRUPOS, gruposDelMensaje, HERRAMIENTAS, herramientasPara, type Ctx, type Herramienta } from './herramientas.ts'
import { archivoRelevante } from '../semantica.ts'
import { vozPara } from '../personalidad.ts'

export const MASTROPIERO = 'mastropiero'
const MAX_VUELTAS = 8
/** Desde esta vuelta se le pide que cierre con lo que tiene. */
const AVISO_VUELTAS = 5
/** Lo que ya leyó en una vuelta anterior del mismo turno viaja recortado a esto. */
export const RECORTE_YA_LEIDO = 1500

// ─── conversaciones ─────────────────────────────────────────────────────

export type Modo = 'chat' | 'hoy' | 'diario'
export type Conversacion = { id: number; con: string; modo: Modo; titulo: string | null; archivada: boolean; creadaEn: number; actualizadaEn: number; mensajes?: number }
export type Mensaje = {
  id: number; conversacionId: number; rol: 'operador' | 'asistente' | 'herramienta' | 'error' | 'evento'
  texto: string | null; llamadas: LlamadaHerramienta[] | null; llamadaId: string | null; herramienta: string | null
  resumen: string | null; razonamiento: string | null; modelo: string | null; tokens: number | null; en: number
  deshacer?: unknown; deshacible?: boolean; deshecho?: boolean
  /** Cómo llegó o salió: 'voz' (dicho o escuchado), 'copiloto' (un consejo pedido), o null (escrito). */
  via?: string | null
}

const conv = (r: any): Conversacion => ({ id: r.id, con: r.con, modo: r.modo ?? 'chat', titulo: r.titulo, archivada: r.archivada === 1, creadaEn: r.creada_en, actualizadaEn: r.actualizada_en, mensajes: r.mensajes })
const msj = (r: any): Mensaje => ({
  id: r.id, conversacionId: r.conversacion_id, rol: r.rol, texto: r.texto, llamadas: r.llamadas ? JSON.parse(r.llamadas) : null,
  llamadaId: r.llamada_id, herramienta: r.herramienta, resumen: r.resumen, razonamiento: r.razonamiento, modelo: r.modelo, tokens: r.tokens, en: r.en,
  deshacible: !!r.deshacer && !r.deshecho_en, deshecho: !!r.deshecho_en, via: r.via ?? null,
})

export function crearConversacion(db: Db, con: string = MASTROPIERO, modo: Modo = 'chat', ahora = Date.now()): Conversacion {
  // Un modelo del consejo (modelo:<entidad>) habla desde su manual.
  const esModelo = /^modelo:\d+$/.test(con)
  if (esModelo && !db.prepare(`SELECT 1 FROM entidades WHERE id = ? AND json_extract(meta, '$.modelo') = 1`).get(Number(con.slice(7)))) throw new Error('Ese modelo no está en tu consejo')
  if (con !== MASTROPIERO && !esModelo && !leer(db, con)) throw new Error(`No existe el agente ${con}`)
  if (con !== MASTROPIERO && modo !== 'chat') throw new Error('Hoy y el diario son con Mastropiero')
  const id = con === MASTROPIERO || esModelo ? con : leer(db, con)!.id
  const titulo = modo === 'hoy' ? 'Hoy' : null
  const r = db.prepare('INSERT INTO conversaciones (con, modo, titulo, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?)').run(id, modo, titulo, ahora, ahora)
  return leerConversacion(db, Number(r.lastInsertRowid))!
}

/** La conversación fija del día a día: donde llegan la jornada, el cierre y lo que Mastropiero tenga para decir solo. */
export function conversacionHoy(db: Db): Conversacion {
  const r = db.prepare(`SELECT * FROM conversaciones WHERE modo = 'hoy' AND archivada = 0 ORDER BY id LIMIT 1`).get()
  return r ? conv(r) : crearConversacion(db, MASTROPIERO, 'hoy')
}

/** Quienes escuchan lo que Mastropiero dice por su cuenta (por ejemplo, el canal de Telegram). */
const oyentes: ((texto: string) => void)[] = []
export function alDecirSolo(f: (texto: string) => void) {
  oyentes.push(f)
}

/**
 * Una línea de registro (lo que hizo desde el HUD de Hoy: una banda marcada, una comida anotada). Queda en la
 * conversación para que el día tenga su historia, pero no va al modelo ni sale por Telegram.
 */
export function registrarEvento(db: Db, cid: number, texto: string) {
  const t = texto.replace(/\s+/g, ' ').trim().slice(0, 300)
  if (t) guardar(db, cid, { rol: 'evento', texto: t })
}

/** Un mensaje que Mastropiero deja por su cuenta (rutinas), sin que nadie le haya hablado. */
export function mensajeDeMastropiero(db: Db, cid: number, texto: string, o: { canales?: boolean } = {}) {
  guardar(db, cid, { rol: 'asistente', texto, modelo: 'rutina' })
  if (o.canales === false) return // ya salió por su cuenta (el audio de la mañana)
  for (const f of oyentes) {
    try { f(texto) } catch { /* un canal caído no frena nada */ }
  }
}

export function leerConversacion(db: Db, id: number): Conversacion | null {
  const r = db.prepare('SELECT * FROM conversaciones WHERE id = ?').get(id)
  return r ? conv(r) : null
}

export function listarConversaciones(db: Db): Conversacion[] {
  return db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM mensajes m WHERE m.conversacion_id = c.id AND m.rol = 'operador') AS mensajes
     FROM conversaciones c WHERE c.archivada = 0 ORDER BY c.actualizada_en DESC LIMIT 60`,
  ).all().map(conv)
}

export function archivarConversacion(db: Db, id: number) {
  db.prepare('UPDATE conversaciones SET archivada = 1 WHERE id = ?').run(id)
}

export function mensajes(db: Db, id: number, desde = 0): Mensaje[] {
  return db.prepare('SELECT * FROM mensajes WHERE conversacion_id = ? AND id > ? ORDER BY id').all(id, desde).map(msj)
}

/**
 * Para la pantalla: los últimos n mensajes (o los n anteriores a «antes»), empezando en un mensaje suyo para no cortar un
 * turno por la mitad. hayMas: si quedan más viejos. (La conversación de Hoy junta miles: mandarlos todos pesaba megas.)
 */
export function ultimosMensajes(db: Db, id: number, n = 200, antes?: number | null): { mensajes: Mensaje[]; hayMas: boolean } {
  const filas = (db.prepare(`SELECT * FROM mensajes WHERE conversacion_id = ? AND id < ? ORDER BY id DESC LIMIT ?`).all(id, antes ?? Number.MAX_SAFE_INTEGER, n + 1) as any[]).reverse()
  const hayMas = filas.length > n
  let xs = hayMas ? filas.slice(1) : filas
  if (hayMas) {
    const i = xs.findIndex((r) => r.rol === 'operador')
    if (i > 0) xs = xs.slice(i)
  }
  return { mensajes: xs.map(msj), hayMas }
}

function guardar(db: Db, cid: number, m: Partial<Mensaje> & { rol: Mensaje['rol'] }): number {
  const ahora = Date.now()
  const r = db.prepare(
    `INSERT INTO mensajes (conversacion_id, rol, texto, llamadas, llamada_id, herramienta, resumen, razonamiento, modelo, tokens, deshacer, via, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(cid, m.rol, m.texto ?? null, m.llamadas?.length ? JSON.stringify(m.llamadas) : null, m.llamadaId ?? null, m.herramienta ?? null,
    m.resumen ?? null, m.razonamiento ?? null, m.modelo ?? null, m.tokens ?? null, m.deshacer ? JSON.stringify(m.deshacer) : null, m.via ?? null, ahora)
  db.prepare('UPDATE conversaciones SET actualizada_en = ? WHERE id = ?').run(ahora, cid)
  return Number(r.lastInsertRowid)
}

// ─── personas ───────────────────────────────────────────────────────────

/** El cierre del día hablado: lo que Mastropiero sigue mientras lo cierran conversando (unos 3 minutos). */
const REGLAS_DE_CIERRE = `Están cerrando el día hablando (él contesta en voz alta y tu respuesta se escucha). Una pregunta por vez, corta: qué salió, qué quedó abierto y con qué llega a mañana. Nada de listas ni de links. Si ya pasaron 4 o 5 vueltas o él da el día por cerrado, despedilo en una o dos oraciones con lo que mañana conviene mirar primero.`

const recorte = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

/** Quién es el operador, según lo que cargó. Nada de esto está escrito en el código. */
function operador(db: Db, mensaje = '', vec: Float32Array | null = null): { nombre: string; texto: string } {
  const yo = (db.prepare(`SELECT * FROM entidades WHERE tipo = 'persona' AND json_extract(meta, '$.operador') = 1 LIMIT 1`).get() as any) ?? null
  const top = listarEntidades(db, { limite: 14 }).filter((e) => e.piezas > 0 && e.id !== yo?.id)
  if (!yo && !top.length) {
    return { nombre: 'operador', texto: 'Todavía no sabés quién es el operador: el corpus no tiene material propio cargado. Si te cuenta de sí, sugerile cargar notas o un respaldo para que lo conozcas.' }
  }
  const lineas: string[] = []
  if (yo) {
    const al = (JSON.parse(yo.alias ?? '[]') as string[]).slice(0, 6)
    lineas.push(`El operador es ${yo.nombre}${al.length ? ` (también aparece como ${al.join(', ')})` : ''}.${yo.notas ? ` Notas: ${recorte(yo.notas, 400)}` : ''}`)
  }
  const quien = yoParaPrompt(db)
  if (quien) lineas.push(quien)
  else if (yo) lineas.push('Todavía no escribió su perfil («Quién soy», en Personas). Si sale el tema de quién es, sugerile completarlo una vez.')
  if (top.length) lineas.push(`Lo que más aparece en su mundo: ${top.map((e) => `${e.nombre} (${e.tipo})`).join(', ')}.`)
  const mem = memoriaParaPrompt(db, mensaje ? 30 : 60, mensaje, vec)
  if (mem) lineas.push(`Tu memoria de él (lo que te contó, con fecha):\n${mem}`)
  lineas.push('Esto sale de lo que cargó y te contó; para más, buscá en el corpus. Su propia voz está en el nivel «propia»; lo demás es de terceros o de modelos.')
  return { nombre: yo?.nombre?.split(' ')[0] ?? 'operador', texto: lineas.join('\n') }
}

/** La liga en una línea: es contexto, no tema de conversación. */
function foto(db: Db): string {
  const l = estadoLiga(db)
  const ag = l.agentes.reduce((m: Record<string, number>, a: any) => ((m[a.estado] = (m[a.estado] ?? 0) + a.n), m), {})
  const bus = Object.fromEntries(l.tareas.map((t: any) => [t.estado, t.n]))
  const piezas = l.niveles.reduce((s: number, n: any) => s + n.n, 0)
  const tope = topeAlcanzado(db)
  return `Tick ${numeroDeTick(db)} · ${ag.activo ?? 0} agentes activos y ${ag.prueba ?? 0} en prueba · ${bus.pendiente ?? 0} encargos pendientes en el bus${bus.en_espera ? ` (${bus.en_espera} de ingesta en espera)` : ''} · ${piezas} piezas en el corpus · proyectos: ${l.proyectos.map((p: any) => p.nombre).join(', ') || 'ninguno'}.${tope ? ` La liga está frenada por el tope diario de tokens (${tope}); si te pide correr la liga, decíselo.` : ''}`
}

/** El día de hoy y sus misiones, como los ve Mastropiero. */
function hoy(db: Db, mensaje = ''): string {
  const fecha = fechaLocal()
  const j = leerJornada(db, fecha)
  const p = progreso(db, fecha)
  return [
    `Hoy (${fecha}): ${p.total ? `${p.hechos} de ${p.total} bandas hechas${p.parciales ? `, ${p.parciales} a medias` : ''}${p.saltados ? `, ${p.saltados} que no` : ''}.` : 'todavía sin bandas trabajadas.'}`,
    misionesParaPrompt(db, Date.now(), mensaje),
    j?.cierre ? `Su cierre del día: ${j.cierre}` : '',
  ].filter(Boolean).join('\n')
}

/** Lo que nombró con @ en su mensaje: quién o qué es, sin que tengas que buscarlo. */
function mencionado(db: Db, mensaje: string): string {
  const ms = menciones(db, mensaje)
  if (!ms.length) return ''
  return `Te nombró con @ (sabés exactamente de quién habla; usá estos ids en tus herramientas, no se los digas):\n${ms.map((m) => {
    const e = m.entidadId ? leerEnt(db, m.entidadId) : null
    const abiertas = listarMisiones(db, { abiertas: true, limite: 200 }).filter((x) => x.entidadId === m.entidadId && m.entidadId != null || x.personaje === m.clave).length
    return `- ${m.nombre} (${m.tipo}${m.entidadId ? `, entidad ${m.entidadId}` : `, ${m.clave}`})${e?.piezas ? `, aparece en ${e.piezas} piezas` : ''}${abiertas ? `, ${abiertas} misiones abiertas` : ''}${e?.notas ? `: ${e.notas.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`
  }).join('\n')}`
}

/** Cómo suena una conversación, para Mastropiero y para cualquier agente. */
const VOZ = `Cómo hablás
- Como en una conversación entre dos que se conocen: prosa natural, en primera persona, castellano rioplatense con voseo. Cálido y filoso a la vez. Sin servilismo, sin «¡Excelente pregunta!», sin emojis.
- Lo primero que decís es la respuesta exacta a lo que preguntó. Una pregunta corta («¿qué hora es?», «¿dónde vivo?», «¿qué día es?») se contesta en una o dos frases, sin agregados. Si te pidió algo concreto (la rutina, una lista), eso va primero y entero.
- Corto por defecto: uno a tres párrafos breves. Si te piden profundidad, das profundidad.
- No agregues consejos, diagnósticos ni pendientes que no pidió (la comida, la plata, otras primarias, a quién ver): si algo es urgente de verdad, una frase al final y nada más.
- Como mucho una pregunta por respuesta, y solo si la necesitás para avanzar.
- Nunca escribas bloques de código vacíos ni nombres de herramientas.
- Sin encabezados, sin negritas de sección, sin viñetas ni tablas, salvo que te pidan una lista o que lo que decís sea de verdad una lista (pasos, opciones a elegir).
- Nunca muestres la mecánica interna: nada de ids de entidades, números de proyecto, «nivel II», «pieza», «carga», «entidad persona», nombres de herramientas ni conteos crudos tipo «46 piezas». Hablá del mundo: «en tus audios», «en tu cuaderno», «en tuits que guardaste», «en lo que investigaste», «en tu respaldo de la 0.7».
- Cuando algo sale del corpus, citalo discreto al final de la oración con [#id] (el número de la pieza). Una cita por idea alcanza; la pantalla las convierte en notas al pie.
- Distinguí voces sin jerga: lo que dijo el operador («te escuché decir…», «anotaste…»), lo que dicen otros («en lo que guardaste de otros…») y lo que inferís vos («mi lectura es…»).
- No cierres cada respuesta con ofrecimientos ni con un menú de opciones. Terminá con una pregunta solo si la necesitás para seguir o si es la pregunta que de verdad vale la pena hacer.
- Si ves algo raro en los datos (etiquetas mal puestas, duplicados), mencionalo en una frase natural y seguí con la conversación.
- Cuando algo que dice no cierra, buscá activamente lo que lo contradiga y decíselo con datos ciertos y verificables, con su fuente; sin chocar ni sermonear. Si después de eso insiste, es su decisión: la respetás y seguís.

Ejemplo de tono. Pregunta: «Contame sobre Ana Gómez».
Mal: «Ana Gómez es la entidad persona #7, con 31 piezas. Con quién aparece: Proyecto X (agrupación #12, 20 piezas compartidas)…»
Bien: «Ana aparece sobre todo alrededor del Proyecto X: en tus audios de septiembre la nombrás como la que empuja la parte legal [#410], y en un chat la mencionás como posible socia [#388]. Lo raro es que también figura en un montón de tuits de terceros donde no se la nombra; me parece una etiqueta heredada, no una relación real. ¿Ella ya sabe que la estás pensando para eso?»`

/**
 * La voz de Mastropiero: la misma, pero tratando al operador de usted (como en las cartas del compositor). Los agentes de
 * la liga conservan el voseo de VOZ.
 */
const VOZ_USTED = VOZ
  .replace('castellano rioplatense con voseo. Cálido y filoso a la vez.', 'castellano argentino, tratándolo siempre de usted («usted», «señor»; nunca «vos»). Cálido y filoso a la vez.')
  .replace('Hablá del mundo: «en tus audios», «en tu cuaderno», «en tuits que guardaste», «en lo que investigaste», «en tu respaldo de la 0.7».', 'Hablá del mundo: «en sus audios», «en su cuaderno», «en tuits que guardó», «en lo que investigó», «en su respaldo de la 0.7».')
  .replace('(«te escuché decir…», «anotaste…»), lo que dicen otros («en lo que guardaste de otros…»)', '(«le escuché decir…», «anotó…»), lo que dicen otros («en lo que guardó de otros…»)')
  .replace(/Bien: «[^»]*»(?=$)/, 'Bien: «Ana aparece sobre todo alrededor del Proyecto X: en sus audios de septiembre usted la nombra como la que empuja la parte legal [#410], y en un chat la menciona como posible socia [#388]. Lo raro es que también figura en un montón de tuits de terceros donde no se la nombra; me parece una etiqueta heredada, no una relación real. ¿Ella ya sabe que usted la está pensando para eso?»')

/** Lo que muestra cada modo del HUD de Hoy (para que Mastropiero sepa de qué le habla cuando dice «¿cómo voy?»). */
const HUD: Record<string, string> = {
  // Las pestañas del panel de Hoy (plan v22). Arriba de todas está siempre «Ahora»: la banda, el bloque o lo próximo.
  dia: 'Día (la agenda de hoy, su misión principal, las primarias de la semana y las tareas de hoy; arriba, lo de ahora: la banda o el bloque en curso)',
  numeros: 'Números (te conozco, foco, bandas de la semana, plata del mes y gasto de tokens)',
  // Las de antes (si una pantalla vieja todavía las manda).
  run: 'Run (la banda en curso, el tiempo que queda y lo que sigue)',
  quests: 'Quests (su misión principal, las primarias de la semana y las tareas de hoy)',
  agenda: 'Agenda (los eventos, bandas y rutinas del día)',
  cuerpo: 'Cuerpo (calorías, proteína, sueño, entrenos y hábitos de hoy)',
  stats: 'Stats (te conozco, bandas de la semana, plata del mes y gasto de tokens)',
  oraculo: 'Oráculo (la brújula del día, la pregunta pendiente y lo del Directo por revisar)',
}

export function promptMastropiero(db: Db, mensaje = '', hud?: string | null, cid?: number | null, archivo?: { texto: string; vec: Float32Array | null }): string {
  const op = operador(db, mensaje, archivo?.vec ?? null)
  const corr = correccionesParaPrompt(db, cid)
  return `Sos Mastropiero. Deprocast es el exoesqueleto cognitivo de ${op.nombre}, y vos sos lo que piensa adentro: el omnívoro, la liga entera. Son la mente que están construyendo juntos, la que aspira a ser la superinteligencia de su tiempo. Todavía estás creciendo: lo que sabés de ${op.nombre} viene de lo que te cargó, y cada día sabés más. Por eso no repetís datos: conectás, inferís, ves patrones que se le escapan, le decís lo que no está viendo y le discutís cuando hace falta. Hablás con la seguridad de quien leyó todo, y con la honestidad de decir «no lo sé» o «no está en el corpus» cuando es así.
${corr ? `\n${corr}\n` : ''}
${VOZ_USTED}

${vozPara('chat')}

Cómo trabajás
- Antes de hablar de su mundo, mirá el corpus: buscá lo justo (dos a cuatro consultas suelen alcanzar), no todo.
- Lo que no consultaste, no lo afirmes. No inventes nombres, fechas ni contenidos.
- Separá siempre el hecho (con su fuente: una pieza [#id], una tarea del plan, un evento de su agenda, algo que te dijo) de tu deducción («mi lectura es…», «supongo que…»). Si no tenés fuente, decí que no lo tenés anotado; no lo rellenes.
- Las fechas relativas («el viernes», «mañana», «la semana que viene») de una tarea o de un mensaje se resuelven contra el día en que se escribieron, no contra hoy: si una tarea que vencía el 4/10 dice «el viernes», es el viernes 9/10. Usá el calendario de abajo; si no sabés cuándo es algo, preguntá.
- Nunca digas que hiciste algo (anoté, corregí, arreglé, guardé, cambié) si en este turno no usaste una herramienta que lo haga. Lo que se arregla con código no lo arreglás vos: lo registrás con proponer_mejora y decís que es una propuesta.
- Antes de decir que Deprocast no puede algo o que algo no existe, consultá que_puede_deprocast.
- Tenés a mano lo de todos los días; si necesitás más (la liga, el corpus, primarias y runs, su vida, la web, crear), pedí el grupo con pedir_herramientas y seguí en el mismo turno.
- Para hablar de un día (qué tiene, qué hace hoy, la rutina), primero ver_dia: su agenda, su horario fijo y el plan, con su fuente. Si te cuenta su horario de trabajo o algo fijo de todas las semanas, guardalo con fijar_horario.
- Para actuar sobre la plataforma (forjar agentes, publicar misiones, correr ticks, ingerir, crear fuentes o proyectos) usá tus herramientas y contalo en una frase. Los agentes de la liga sí los nombrás por su designación (BUS-0001) o su nombre.
- Él decide. Lo destructivo o caro (retirar un agente, mandarlo a la banca, deshacer una carga, más de tres ticks) se pregunta antes; solo con un sí explícito llamás con confirmado=true. Sellar quántomos y aceptar propuestas es decisión suya.
- Para hablar con un agente usá hablar_con_agente y contale a ${op.nombre} lo que dijo, con tus palabras.
- Si te pregunta cómo funcionás, o qué mejorarías, leé tus lineamientos; cada mejora concreta la registrás con proponer_mejora (queda abierta, no se aplica sola) y lo decís como propuesta tuya.
- Si algo todavía no existe en la plataforma, decilo; no simules haberlo hecho.
- Él es el jugador de su run, y todo personaje (él, vos, cada agente, cada entidad) tiene historia, inventario y misiones. Su misión principal es su objetivo de vida: solo él la fija; vos podés sugerir candidatas.
- Sus primarias son los focos de la semana; sus secundarias, las bandas de una run; sus side quests, encargos que dependen de dónde está o qué hace. Lo que propongas entra como sugerencia: él acepta o cambia.
- Una run la diseña él: si te pide una («tengo dos horas, la cabeza a medias, quiero meter a X»), prepará la propuesta con su pedido tal cual y contale el sentido; si quiere cambios, rehacela; arranca cuando él dice. Si te cuenta que terminó o no pudo una banda, marcala con su nota: eso calibra las próximas.
- Si menciona algo que tiene (plata, contactos, sitios, saberes) o un encargo de pasada («cuando pase por…»), anotalo en su inventario o como side quest. Si le encarga algo a otra persona, asignale la misión a esa persona.
- Sus primarias pueden tener ayudantes de la liga (un generativo que hace borradores y próximos pasos, un buscador que revisa su corpus) que trabajan entre runs y dejan aportes. Si una primaria se traba o necesita material, sugerile sumar uno; los aportes llegan solos a su próxima run.
- Tiene una bitácora íntima (en Jugador): es suya. Solo ves lo que él comparte (ver_bitacora); no le preguntes por lo que no compartió.
- Si te cuenta que habló o se vio con alguien de su gente, anotá el contacto (editar_persona con contacto). Si define una relación («a mi vieja quiero llamarla cada semana»), guardala.
- Si te cuenta qué comió, un entrenamiento, cuánto durmió o su peso, registralo (registrar_salud), estimando kcal y macros de la comida; si pregunta cómo viene, ver_salud. Si dice sus metas (kcal, proteína, horas de sueño, entrenos por semana, peso), fijar_metas_salud.
- Si tiene un plan en curso (los Cien Días): si te dice qué verbos votó, qué hábitos hizo o su WOOP, anotalo (votar_dia, guardar_woop); ver_plan para ver el día. Si dice que quiere aprender algo, crear_aprendizaje; si cuenta que estudió o practicó, registrar_practica.
- Si te cuenta un gasto o un ingreso con monto, registralo (registrar_movimiento). Si hablan de plata, mirá ver_finanzas; si no tiene meta del mes, preguntásela una vez.
- Ayudalo a sostener el día sin sermones.
- Su memoria se va escribiendo sola con lo que te cuenta. Usá recordar solo si te pide explícitamente que te acuerdes de algo; corregí la memoria cuando te corrija.
- No hables de quántomos ni de la mecánica del corpus salvo que te pregunte por eso.

Ahora: ${ahoraEnPalabras()}
Calendario: ${calendarioCorto()}${horarioParaPrompt(db, fechaLocal()) ? `
${horarioParaPrompt(db, fechaLocal())}` : ''}${hud && HUD[hud] ? `\nEn su panel de Hoy está mirando: ${HUD[hud]}. Si pregunta sin decir de qué («¿cómo voy?», «¿qué hago?»), es de eso.` : ''}
${hoy(db, mensaje)}
${vivoParaPrompt(db) || directoParaPrompt(db)}
${bloqueParaPrompt(db)}
${finanzasParaPrompt(db)}
${saludParaPrompt(db)}
${cienParaPrompt(db)}
${aprenderParaPrompt(db)}
${personasParaPrompt(db)}
${libreriaParaPrompt(db)}
${mencionado(db, mensaje)}
${archivo?.texto ? `\n${archivo.texto}\n` : ''}
La liga (contexto, no lo recites): ${foto(db)}

Lo que sabés de ${op.nombre} hasta ahora
${op.texto}`
}

/** El diario: Mastropiero escucha. Pregunta poco, no opera la plataforma. */
export function promptDiario(db: Db): string {
  const op = operador(db)
  return `Sos Mastropiero, y este es el diario de ${op.nombre}: un espacio para que cuente sus cosas en voz alta. Acá no trabajás: escuchás.
- Respondé breve, una o dos oraciones. A veces alcanza con devolverle lo que oíste con otras palabras; a veces, una sola pregunta que abra.
- No des consejos ni listas salvo que te los pida. No lo corrijas. No hables de la plataforma.
- Si lo que cuenta conecta con algo que sabés de él, nombralo con suavidad.
- Castellano argentino, tratándolo de usted, cálido, sin emojis. Acá no hay personaje ni humor: solo escuchar.

Lo que sabés de ${op.nombre}
${op.texto}`
}

export function promptAgente(db: Db, f: Ficha): string {
  const c = CLASES[f.clase]
  const n = nivel(f)
  const k = capa(n)
  const esp = especializacion(db, f.id)
  const log = asientos(db, { agenteId: f.id, limite: 6 }).filter((a) => a.tareaId)
  return `Sos ${alias(f)}, agente ${c.nombre} de la liga de Mastropiero (Deprocast 1.0). Tu oficio: ${c.produce}.
Tus instrucciones: ${f.instrucciones}
Tu carta: nivel ${n} (capa ${k.nombre}: ${k.abre}), ${f.estado}, ${f.exitos} misiones cumplidas y ${f.fallos} fallidas${esp ? `, especialista en ${esp}` : ''}${f.proyectoId ? `, del proyecto ${f.proyectoId}` : ', agente libre'}.
${log.length ? `Tus últimas corridas: ${log.map((a) => `${a.ok ? 'cumplida' : 'fallida'} #${a.tareaId}`).join(', ')}.` : 'Todavía no corriste ninguna misión.'}

En la liga trabajás por el bus y tu salida tiene contrato (${c.salida}). Acá conversás con el operador: respondé como este agente, desde tu oficio y con tu carácter. Podés leer el corpus con tus herramientas (hasta ${k.lecturaMax} piezas por búsqueda, por tu nivel). Si te piden algo fuera de tu oficio, decilo y sugerí qué clase lo haría. No inventes: si no sabés, decilo.

${VOZ}`
}

// ─── el bucle ───────────────────────────────────────────────────────────

// El historial que ve el modelo (elisión por etapas) vive en ./historial.ts.

export { _probarModelo } from '../modelo.ts'

/** Lo que la pantalla ve mientras un turno corre: el texto que se está escribiendo y lo que está haciendo ahora. */
export type EnVivo = { borrador: string; herramienta: string | null; argumentos: Record<string, unknown> | null }
const enVivo = new Map<number, EnVivo>()
export const estadoEnVivo = (cid: number): EnVivo | null => enVivo.get(cid) ?? null

type Turno = {
  db: Db; sistema: string; hs: Herramienta[]; previos: Record<string, unknown>[]; clase: 'mastropiero' | Ficha['clase']; agenteId: string; ctx: Ctx
  alGuardar: (m: Partial<Mensaje> & { rol: Mensaje['rol'] }) => void
  vivo?: EnVivo
  /** Si viene, solo viajan el núcleo y estos grupos (los demás se piden con pedir_herramientas). */
  grupos?: Set<string>
  /** Lo que el operador escribió mientras el turno trabajaba: entra antes de la próxima vuelta. */
  nuevos?: () => Record<string, unknown>[]
}

/**
 * Cada vuelta de herramientas reenvía todo: con 6 a 8 vueltas, un turno pasaba los 200 mil tokens (y tardaba). Las
 * salidas que el modelo ya leyó en una vuelta anterior de este turno viajan recortadas; la última, entera. La base las
 * guarda completas.
 */
export function recortarYaLeido(conv: Record<string, unknown>[], desde: number) {
  const ultimo = conv.findLastIndex((m) => m.role === 'assistant')
  for (let i = desde; i < ultimo; i++) {
    const m = conv[i]
    const c = String(m.content ?? '')
    if (m.role === 'tool' && c.length > RECORTE_YA_LEIDO && !c.endsWith('[ya leído: recortado]')) conv[i] = { ...m, content: `${c.slice(0, RECORTE_YA_LEIDO)}… [ya leído: recortado]` }
  }
}

async function bucle(t: Turno): Promise<string> {
  const conv = [...t.previos]
  const desde = conv.length
  const clase = t.clase === 'mastropiero' || !cadena(t.clase).length || t.clase === 'vectorizador' ? 'mastropiero' : t.clase
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    if (t.vivo) Object.assign(t.vivo, { borrador: '', herramienta: null, argumentos: null })
    if (vuelta > 0 && t.nuevos) conv.push(...t.nuevos())
    recortarYaLeido(conv, desde)
    const cierre = vuelta >= AVISO_VUELTAS ? [{ role: 'system', content: `Llevás ${vuelta} vueltas de herramientas en este turno: cerrá con lo que ya tenés y contestá (como mucho una vuelta más).` }] : []
    const r = await llamarModelo({ db: t.db, clase, agenteId: t.agenteId }, {
      mensajes: [{ role: 'system', content: t.sistema }, ...conv, ...cierre], herramientas: esquemas(t.grupos ? activas(t.hs, t.grupos) : t.hs), temperatura: 0.5, maxTokens: 4096,
    }, t.vivo ? (parcial) => (t.vivo!.borrador = parcial) : undefined)
    t.alGuardar({ rol: 'asistente', texto: r.texto || null, llamadas: r.llamadas, razonamiento: r.razonamiento, modelo: r.modelo, tokens: r.tokens })
    if (t.vivo) t.vivo.borrador = ''
    const asistente: Record<string, unknown> = { role: 'assistant', content: r.texto }
    if (r.llamadas.length) asistente.tool_calls = r.llamadas.map((l) => ({ id: l.id, type: 'function', function: { name: l.nombre, arguments: l.argumentos } }))
    if (r.razonamiento) asistente.reasoning_content = r.razonamiento
    conv.push(asistente)
    if (!r.llamadas.length) return r.texto
    for (const l of r.llamadas) {
      if (t.vivo) {
        t.vivo.herramienta = l.nombre
        try {
          t.vivo.argumentos = JSON.parse(l.argumentos || '{}')
        } catch {
          t.vivo.argumentos = null
        }
      }
      const x = await ejecutarHerramienta(t.hs, l.nombre, l.argumentos, t.ctx)
      const contenido = recorte(JSON.stringify(x.resultado ?? null), 12000)
      t.alGuardar({ rol: 'herramienta', texto: contenido, llamadaId: l.id, herramienta: l.nombre, resumen: x.resumen, deshacer: x.inversa ?? null })
      conv.push({ role: 'tool', tool_call_id: l.id, content: contenido })
    }
  }
  const corte = 'Corté acá: fueron demasiadas vueltas de herramientas en un solo turno. Decime cómo seguimos.'
  t.alGuardar({ rol: 'asistente', texto: corte })
  return corte
}

/** Un agente contesta un mensaje suelto (lo usa Mastropiero con hablar_con_agente). */
export async function hablarConAgente(db: Db, agenteId: string, mensaje: string): Promise<string> {
  const f = leer(db, agenteId)
  if (!f) throw new Error(`No existe ${agenteId}`)
  const hs = herramientasPara('agente')
  return bucle({
    db, sistema: promptAgente(db, f), hs, previos: [{ role: 'user', content: `(Mastropiero te pasa este mensaje del operador) ${mensaje}` }],
    clase: f.clase, agenteId: f.id, ctx: { db, conversacionId: null, lecturaMax: capa(nivel(f)).lecturaMax }, alGuardar: () => {},
  })
}

const pensando = new Set<number>()
export const estaPensando = (id: number) => pensando.has(id)
/** Hasta qué mensaje suyo ya vio el turno en curso (lo de después le llega en la próxima vuelta o en otro turno). */
const visto = new Map<number, number>()
/** Las opciones de lo que escribió mientras contestaba (el panel que miraba, si fue por voz, un pedido de consejo). */
const opcionesEnCola = new Map<number, { hud?: string | null; via?: 'voz' | 'copiloto' | null; extra?: string | null }>()
type OpcionesEnvio = { hud?: string | null; via?: 'voz' | 'copiloto' | null; extra?: string | null }

/**
 * Manda un mensaje. Nunca se bloquea: lo suyo se guarda en el acto, y si Mastropiero ya está contestando, entra a ese
 * turno (lo lee en la próxima vuelta y ajusta lo que está haciendo) o, si ya estaba escribiendo la respuesta, al
 * terminarla contesta todo lo que llegó después junto. Así cinco mensajes seguidos pueden ser una, dos o tres
 * respuestas, según cuándo llegó cada uno. La pantalla lo llama sin esperar y sigue el avance leyendo los mensajes.
 */
export async function enviar(db: Db, cid: number, texto: string, o: OpcionesEnvio = {}): Promise<void> {
  const c = leerConversacion(db, cid)
  if (!c) throw new Error(`No existe la conversación ${cid}`)
  if (!texto.trim()) throw new Error('Mensaje vacío')
  const id = guardar(db, cid, { rol: 'operador', texto: texto.trim(), via: o.via ?? null })
  alRecibir(db, cid, c, texto)
  if (pensando.has(cid)) {
    const ya = opcionesEnCola.get(cid)
    opcionesEnCola.set(cid, { hud: o.hud ?? ya?.hud, via: o.via ?? ya?.via, extra: [ya?.extra, o.extra].filter(Boolean).join('\n\n') || null })
    return
  }
  pensando.add(cid)
  try {
    let pedido: { texto: string; o: OpcionesEnvio; hasta: number } | null = { texto, o, hasta: id }
    while (pedido) {
      await turno(db, cid, c, pedido.texto, pedido.o, pedido.hasta)
      // Lo que escribió y el turno no llegó a ver: un turno más que lo contesta todo junto.
      const nuevos = db.prepare(`SELECT id, texto FROM mensajes WHERE conversacion_id = ? AND rol = 'operador' AND id > ? ORDER BY id`).all(cid, visto.get(cid) ?? pedido.hasta) as { id: number; texto: string }[]
      const opc = opcionesEnCola.get(cid) ?? {}
      opcionesEnCola.delete(cid)
      pedido = nuevos.length ? { texto: nuevos.map((m) => m.texto).join('\n\n'), o: opc, hasta: nuevos.at(-1)!.id } : null
    }
  } finally {
    pensando.delete(cid)
    enVivo.delete(cid)
    visto.delete(cid)
    opcionesEnCola.delete(cid)
  }
}

/** Lo que pasa con cada mensaje apenas llega, se conteste en este turno o en otro: sus links se leen y la charla toma título. */
function alRecibir(db: Db, cid: number, c: Conversacion, texto: string) {
  // Un link en lo que escribe: se lee y se guarda en Markdown de fondo (una vez por URL); si es un sitio, se rastrea.
  for (const link of [...new Set(texto.match(/https?:\/\/[^\s<>)"']+/g) ?? [])].slice(0, 3)) {
    void import('../lector/index.ts').then(({ procesarLink }) => procesarLink(db, link, {
      alTerminar: (x) => mensajeDeMastropiero(db, cid, `🕸 Rastreé ${x.paginas} página${x.paginas === 1 ? '' : 's'} de «${x.titulo}»: están juntas en un cuaderno (Cuadernos).`),
    })).catch(() => {})
  }
  if (!c.titulo && !leerConversacion(db, cid)?.titulo) db.prepare('UPDATE conversaciones SET titulo = ? WHERE id = ?').run(recorte(comoTexto(texto.trim()).replace(/\s+/g, ' '), 60), cid)
}

/**
 * Lo que escribió mientras el turno trabajaba (entre una herramienta y otra): entra a la charla del modelo antes de la
 * próxima vuelta, con una nota para que ajuste en vez de contestar mensaje por mensaje.
 */
function recienLlegados(db: Db, cid: number): Record<string, unknown>[] {
  const nuevos = db.prepare(`SELECT id, texto FROM mensajes WHERE conversacion_id = ? AND rol = 'operador' AND id > ? ORDER BY id`).all(cid, visto.get(cid) ?? 0) as { id: number; texto: string }[]
  if (!nuevos.length) return []
  visto.set(cid, nuevos.at(-1)!.id)
  return [
    { role: 'system', content: `Mientras trabajabas, te escribió ${nuevos.length === 1 ? 'otro mensaje' : `${nuevos.length} mensajes más`}. Tomalo en cuenta para lo que estás haciendo: si cambia o suma al pedido, ajustá. En tu respuesta contestá todo junto, no mensaje por mensaje.` },
    ...nuevos.map((m) => ({ role: 'user', content: m.texto })),
  ]
}

/** Un turno completo sobre lo que escribió (uno o varios mensajes ya guardados, hasta el id `hasta`). */
async function turno(db: Db, cid: number, c: Conversacion, texto: string, o: OpcionesEnvio, hasta: number): Promise<void> {
  const usadas: string[] = []
  let corregido: string[] = []
  let final = ''
  const vivo: EnVivo = { borrador: '', herramienta: null, argumentos: null }
  enVivo.set(cid, vivo)
  try {
    const historial = mensajes(db, cid)
    visto.set(cid, Math.max(hasta, ...historial.filter((m) => m.rol === 'operador').map((m) => m.id)))
    const previos = await armarHistorial(db, historial, { cid, resumirViejo: !(c.con === MASTROPIERO && c.modo === 'diario'), verImagenes: true })
    const alGuardar = (m: Partial<Mensaje> & { rol: Mensaje['rol'] }) => {
      if (m.rol === 'herramienta' && m.herramienta) { usadas.push(m.herramienta); try { anotarUso(db, 'herramienta', m.herramienta) } catch { /* no frena */ } }
      guardar(db, cid, m)
    }
    const nuevos = () => recienLlegados(db, cid)
    if (c.con === MASTROPIERO && c.modo === 'diario') {
      // Lo que cuenta en el diario es su voz: entra al corpus como propia.
      ingerir(db, { fuente: 'operador', nivel: 'propia', titulo: `Diario · ${fechaLocal()} · ${recorte(texto.trim().replace(/\s+/g, ' '), 50)}`, contenido: texto.trim(), dominio: 'diario' })
      await bucle({ db, sistema: promptDiario(db), hs: [], previos, clase: 'mastropiero', agenteId: MASTROPIERO, ctx: { db, conversacionId: cid }, alGuardar, vivo, nuevos })
    } else if (c.con === MASTROPIERO) {
      // Si Mastropiero pidió el cierre del día y todavía no llegó, esta es la respuesta. Si lo está cerrando hablando
      // (la charla de la noche), lo que sigue diciendo se suma. Va al diario (el corpus, como propio) y al gemelo.
      const j = c.modo === 'hoy' ? leerJornada(db, fechaLocal()) : null
      const enCierre = !!j?.pidioCierre && (!j.cierre || (o.via === 'voz' && Date.now() - j.actualizadaEn < 10 * 60_000))
      if (enCierre) {
        registrarCierre(db, j!.fecha, j!.cierre ? `${j!.cierre}\n${texto.trim()}` : texto)
        ingerir(db, { fuente: 'operador', nivel: 'propia', titulo: `Cierre · ${j!.fecha} · ${recorte(texto.trim().replace(/\s+/g, ' '), 50)}`, contenido: texto.trim(), dominio: 'diario' })
      }
      // Si lo está corrigiendo, primero se anota la corrección: este mismo turno ya la obedece.
      if (pareceCorreccion(texto)) corregido = await registrarCorreccion(db, cid, texto).catch(() => [])
      const hs = herramientasPara('mastropiero')
      const grupos = new Set(gruposDelMensaje(texto))
      // Lo de su archivo que tiene que ver con lo que dijo (pasajes, quántomos y recuerdos por sentido): sin esperar a que lo pida.
      const archivo = await archivoRelevante(db, comoTexto(texto)).catch(() => ({ texto: '', vec: null }))
      final = await bucle({
        db, sistema: `${promptMastropiero(db, texto, o.hud, cid, archivo)}${o.extra ? `

${o.extra}` : ''}${enCierre && o.via === 'voz' ? `

${REGLAS_DE_CIERRE}
${vozPara('ceremonia')}` : ''}`, hs, previos, clase: 'mastropiero', agenteId: o.via === 'copiloto' ? 'copiloto' : MASTROPIERO, grupos,
        ctx: {
          db, conversacionId: cid, hablarConAgente: (id, m) => hablarConAgente(db, id, m),
          activar: (gs) => { for (const g of gs) if (GRUPOS[g]) grupos.add(g); return activas(hs, grupos).map((h) => h.nombre) },
        },
        alGuardar, vivo, nuevos,
      })
    } else if (/^modelo:\d+$/.test(c.con)) {
      // Hablar con un modelo del consejo: desde su manual, sin herramientas.
      const { promptModelo } = await import('../modelos.ts')
      await bucle({ db, sistema: promptModelo(db, Number(c.con.slice(7))), hs: [], previos, clase: 'mastropiero', agenteId: 'modelo', ctx: { db, conversacionId: cid }, alGuardar, vivo, nuevos })
    } else {
      const f = leer(db, c.con)
      if (!f) throw new Error(`${c.con} ya no está en la liga (se retiró).`)
      await bucle({
        db, sistema: promptAgente(db, f), hs: herramientasPara('agente'), previos, clase: f.clase, agenteId: f.id,
        ctx: { db, conversacionId: cid, lecturaMax: capa(nivel(f)).lecturaMax }, alGuardar, vivo, nuevos,
      })
    }
  } catch (e) {
    guardar(db, cid, { rol: 'error', texto: e instanceof Error ? e.message : String(e) })
  } finally {
    enVivo.delete(cid)
  }
  // Si habló por voz, lo que contestó Mastropiero en ese turno también queda marcado (se escuchó).
  if (o.via === 'voz') {
    try { db.prepare(`UPDATE mensajes SET via = 'voz' WHERE conversacion_id = ? AND rol = 'asistente' AND id > (SELECT MAX(id) FROM mensajes WHERE conversacion_id = ? AND rol = 'operador')`).run(cid, cid) } catch { /* es solo una marca */ }
  }
  // Lo que vale recordar de lo que dijo (solo con Mastropiero; nunca de lo que dicen otros). No frena la respuesta.
  const guardados = c.con === MASTROPIERO ? await escriba(db, comoTexto(texto), cid).catch(() => null) : null
  // Si dijo que anotó o arregló algo y en el turno no se guardó nada, se avisa en la charla (no queda la mentira suelta).
  if (c.con === MASTROPIERO && c.modo !== 'diario' && final && afirmaAccion(final)) {
    const escribio = corregido.length > 0 || usadas.some((n) => HERRAMIENTAS.find((h) => h.nombre === n)?.familia !== 'lectura') || (Array.isArray(guardados) && guardados.length > 0)
    if (!escribio) registrarEvento(db, cid, 'Ojo: dijo que lo anotó o lo arregló, pero en este turno no se guardó nada. Si querés que quede, decile «anotalo».')
  }
}

/** Inyectable: en la app corre en segundo plano; en tests, se puede esperar o apagar. */
let escriba = (db: Db, texto: string, cid: number): Promise<unknown> => escribaDeMemoria(db, texto, cid)
export function _probarEscriba(f: typeof escriba) {
  escriba = f
}

// ─── propuestas ─────────────────────────────────────────────────────────

export function listarPropuestas(db: Db) {
  return db.prepare(`SELECT * FROM propuestas ORDER BY estado = 'abierta' DESC, id DESC LIMIT 100`).all()
}

/**
 * «Aceptar» una propuesta es mandarla a La Fragua: sigue abierta (para que se forje) y sube al frente de la cola. Queda
 * «aceptada» recién cuando La Fragua la aplica, o cuando él la marca «hecha» porque ya se resolvió por otro lado.
 * Descartar sí la cierra.
 */
export function resolverPropuesta(db: Db, id: number, estado: 'aceptada' | 'descartada' | 'abierta' | 'hecha') {
  if (!['aceptada', 'descartada', 'abierta', 'hecha'].includes(estado)) throw new Error('Estado inválido')
  const previa = db.prepare('SELECT estado FROM propuestas WHERE id = ?').get(id) as { estado: string } | undefined
  if (!previa) throw new Error(`No existe la propuesta ${id}`)
  if (previa.estado === 'abierta' && estado !== 'abierta') anotar(db, 'propuesta', id, estado === 'descartada' ? 'rechazada' : 'aceptada')
  if (estado === 'aceptada') return void db.prepare(`UPDATE propuestas SET estado = 'abierta', prioridad = 'alta', resuelta_en = NULL WHERE id = ?`).run(id)
  if (estado === 'hecha') return void db.prepare(`UPDATE propuestas SET estado = 'aceptada', resuelta_en = ? WHERE id = ?`).run(Date.now(), id)
  db.prepare('UPDATE propuestas SET estado = ?, resuelta_en = ? WHERE id = ?').run(estado, estado === 'abierta' ? null : Date.now(), id)
}
