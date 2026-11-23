/**
 * El chat: hablar con Mastropiero (que opera toda la plataforma con herramientas) o con cualquier agente de la liga.
 * Cada turno es un bucle: el modelo responde o pide herramientas; las herramientas corren y vuelven; hasta que contesta.
 * Todo se guarda mensaje a mensaje, así la pantalla ve el avance mientras el turno corre.
 */
import { leccionesPara } from '../devoluciones.ts'
import { esJugada, instruccionDelJuego } from './juego.ts'
import { ahoraEnPalabras, calendarioCorto } from '../zona.ts'
import { horarioParaPrompt } from '../horario.ts'
import { yoParaPrompt } from '../yo.ts'
import { anotarUso } from '../uso.ts'
import { afirmaAccion, correccionesParaPrompt, pareceCorreccion, registrarCorreccion } from './correcciones.ts'
import { armarHistorial } from './historial.ts'
import { marcarErrorDesdeElChat } from '../registro-turnos.ts'
import { comoTexto } from './adjuntos.ts'
import { ajuste, fechaLocal, type Db } from '../db.ts'
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
import { aprenderEnChat, aprenderParaPrompt, pideAprender } from '../aprender.ts'
import { ubicacionParaPrompt } from '../ubicacion.ts'
import { academiaParaPrompt } from '../academia.ts'
import { personasParaPrompt } from '../personas.ts'
import { libreriaParaPrompt } from '../libreria.ts'
import { leerEntidad as leerEnt } from '../entidades.ts'
import { escribaDeMemoria, memoriaParaPrompt } from '../memoria.ts'
import { anotarSugeridas, resolverRapido, sugeridasParaPrompt } from './sugeridas.ts'
import { audiosParaPrompt } from '../audios-entrantes.ts'
import { gruposPorSentido } from './herramientas-sentido.ts'
import { listarEntidades } from '../entidades.ts'
import { estadoLiga, numeroDeTick } from '../mastropiero.ts'
import { cadena, M, topeAlcanzado, type LlamadaHerramienta } from '../nan.ts'
import { llamarModelo } from '../modelo.ts'
import { alias, leer, nivel, type Ficha } from '../roster.ts'
import { capa } from '../xp.ts'
import { activas, activasEnOrden, ALIAS_GRUPOS, ejecutarHerramienta, esquemas, GRUPOS, gruposDelMensaje, HERRAMIENTAS, herramientasPara, type Ctx, type Herramienta } from './herramientas.ts'
import { archivoRelevante } from '../semantica.ts'
import { vozPara } from '../personalidad.ts'

export const MASTROPIERO = 'mastropiero'
/**
 * Sin tope de herramientas por turno (Fragua #190): el único límite es un presupuesto de tokens del turno (ajuste
 * chat_tokens_turno, 2 millones por defecto). Al 80 % se le pide que vaya cerrando; si se agota, contesta qué completó
 * y cuáles son los pasos que faltan. Lo que sí se corta es el bucle: la misma herramienta con los mismos argumentos
 * por tercera vez.
 */
const TOKENS_TURNO = 2_000_000
const tokensDelTurno = (db: Db) => Math.max(50_000, Number(ajuste(db, 'chat_tokens_turno')) || TOKENS_TURNO)
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
  /** Su 👍 (1) o 👎 (−1) a esta respuesta, si lo dio. */
  fb?: number | null
}

const conv = (r: any): Conversacion => ({ id: r.id, con: r.con, modo: r.modo ?? 'chat', titulo: r.titulo, archivada: r.archivada === 1, creadaEn: r.creada_en, actualizadaEn: r.actualizada_en, mensajes: r.mensajes })
const msj = (r: any): Mensaje => ({
  id: r.id, conversacionId: r.conversacion_id, rol: r.rol, texto: r.texto, llamadas: r.llamadas ? JSON.parse(r.llamadas) : null,
  llamadaId: r.llamada_id, herramienta: r.herramienta, resumen: r.resumen, razonamiento: r.razonamiento, modelo: r.modelo, tokens: r.tokens, en: r.en,
  deshacible: !!r.deshacer && !r.deshecho_en, deshecho: !!r.deshecho_en, via: r.via ?? null, fb: r.fb ?? null,
})
/** Lo que aprendió de sus 👍/👎 a las respuestas (plan v24). */
const leccionesChat = (db: Db) => { try { return leccionesPara(db, 'chat') } catch { return '' } }
/** Con su 👍/👎 (si lo dio) para la pantalla. */
const CON_FB = `SELECT m.*, (SELECT d.valor FROM devoluciones d WHERE d.superficie = 'chat' AND d.ref = CAST(m.id AS TEXT)) AS fb FROM mensajes m`

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

/** Manda a sus canales (Telegram, WhatsApp) algo que ya quedó guardado en la charla, sin guardarlo otra vez. */
export function difundir(texto: string) {
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
  return db.prepare(`${CON_FB} WHERE m.conversacion_id = ? AND m.id > ? ORDER BY m.id`).all(id, desde).map(msj)
}

/**
 * Para la pantalla: los últimos n mensajes (o los n anteriores a «antes»), empezando en un mensaje suyo para no cortar un
 * turno por la mitad. hayMas: si quedan más viejos. (La conversación de Hoy junta miles: mandarlos todos pesaba megas.)
 */
export function ultimosMensajes(db: Db, id: number, n = 200, antes?: number | null): { mensajes: Mensaje[]; hayMas: boolean } {
  const filas = (db.prepare(`${CON_FB} WHERE m.conversacion_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`).all(id, antes ?? Number.MAX_SAFE_INTEGER, n + 1) as any[]).reverse()
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
function operador(db: Db, mensaje = '', vec: Float32Array | null = null, o: { podar?: boolean } = {}): { nombre: string; texto: string } {
  const yo = (db.prepare(`SELECT * FROM entidades WHERE tipo = 'persona' AND json_extract(meta, '$.operador') = 1 LIMIT 1`).get() as any) ?? null
  const top = listarEntidades(db, { limite: o.podar ? 9 : 14 }).filter((e) => e.piezas > 0 && e.id !== yo?.id)
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
  // Con poda (Fragua #339): sus correcciones, visión y metas siguen siempre; de lo demás, lo más cercano a lo que dijo.
  const mem = memoriaParaPrompt(db, mensaje ? (o.podar ? 22 : 30) : 60, mensaje, vec)
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
function hoy(db: Db, mensaje = '', o: { sideQuests?: boolean } = {}): string {
  const fecha = fechaLocal()
  const j = leerJornada(db, fecha)
  const p = progreso(db, fecha)
  return [
    `Hoy (${fecha}): ${p.total ? `${p.hechos} de ${p.total} bandas hechas${p.parciales ? `, ${p.parciales} a medias` : ''}${p.saltados ? `, ${p.saltados} que no` : ''}.` : 'todavía sin bandas trabajadas.'}`,
    misionesParaPrompt(db, Date.now(), mensaje, o),
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

/**
 * Qué tipo de turno es (plan v34, #129): de eso depende cuánto contexto se arma. Sin modelo, por la forma del mensaje.
 * - breve: un saludo, un gracias, «¿estás?», la hora o el día. Se contesta con lo mínimo, sin herramientas y con el
 *   modelo rápido (antes armaba el expediente entero y buscaba en el corpus para decir «acá estoy»).
 * - confirmacion: «dale», «sí», «el primero»… Responde a lo que se le propuso: con herramientas (para hacerlo) pero sin
 *   la búsqueda en su archivo.
 * - completo: todo lo demás, como siempre.
 */
export type TipoTurno = 'breve' | 'confirmacion' | 'completo'
export function tipoDeTurno(texto: string): TipoTurno {
  if (texto.length > 80 || /https?:\/\/|\[(imagen|archivo):|\n/.test(texto)) return 'completo'
  const t = texto.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^[¡¿\s]+/, '').replace(/[¡!¿?.…,;:)(\s]+$/g, '')
  if (/^(hola|holi|buenas|buen dia|buenos dias|buenas (tardes|noches)|hey|ey|che|gracias|muchas gracias|mil gracias|genial|perfecto|joya|barbaro|excelente|buenisimo|ok|okey|okay|listo|entendido|de nada|chau|nos vemos|hasta (manana|luego))(\s+(mastropiero|mastro|che|loco|amigo|crack))?$/.test(t)) return 'breve'
  if (/^(estas|estas ahi|seguis ahi|me escuchas|me lees|andas|anda|funciona|funcionas|que hora es|que dia es( hoy)?|que fecha es( hoy)?)$/.test(t)) return 'breve'
  if (/^(si|sip|sii+|dale|dale dale|de una|hacelo|metele|mandale|adelante|confirmo|confirmado|va|vamos|no|nop|nah|mejor no|cancela|cancelalo|para|espera|ninguno|ninguna|el primero|la primera|el segundo|la segunda|el tercero|la tercera|ambos|los dos|las dos|todos|todas|ya esta|ya (la|lo) hice|ya (la|lo) termine|hecho|hecha|sacala|sacalo)(\b.{0,40})?$/.test(t)) return 'confirmacion'
  return 'completo'
}

/**
 * ¿Cuánto archivo necesita este mensaje? (Fragua #303, primer paso: el turno típico esperaba ~29 s la búsqueda en su
 * archivo, aunque no hiciera falta.)
 * - 'no': algo del presente (la agenda, la run, un recordatorio, pasos, sueño, reservas, compras, plata) sin pedir
 *   memoria: no se busca en el archivo (las herramientas traen lo de hoy);
 * - 'larga': pide memoria («¿te acordás…?», «¿qué sé de…?», «lo que hablamos»): se espera el archivo (hasta 40 s);
 * - 'corta': lo demás: se busca, pero si tarda más de 10 s se contesta sin él.
 */
export type NecesidadArchivo = 'no' | 'corta' | 'larga'
const PIDE_MEMORIA = /\b(te acordas|acordas|recordas|te dije|me dijiste|dijimos|hablamos|habiamos|conte|cont[ée]|alguna vez|cuando fue|la ultima vez|historia|el ano pasado|hace (un|una|dos|tres|unos|unas|mucho|poco)|que se de|que sabes de|que hay de|archivo|corpus|busca|buscame|mis notas|escribi|anote|guard[eé]|lei|vi un)\b/
const DEL_PRESENTE = /\b(que tengo|tengo (hoy|manana|que)|agenda|calendario|reunion|evento|turno con|la run|una run|banda|recordame|avisame|recordatorio|pasos|camine|dormi|sueno|pantalla|uso del telefono|reserv\w*|compras?|lista de compras|anota\w*|agendame|que hora|que dia|clima|cuanto gaste|saldo|monedero|mis gastos)\b/
export function necesidadDeArchivo(texto: string): NecesidadArchivo {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (PIDE_MEMORIA.test(t)) return 'larga'
  if (DEL_PRESENTE.test(t) && t.length < 300) return 'no'
  return 'corta'
}
const ESPERA_ARCHIVO: Record<NecesidadArchivo, number> = { no: 0, corta: 10_000, larga: 40_000 }

/** El prompt de un turno breve: quién sos, cómo hablás, la hora y el día. Nada más. */
export function promptBreve(db: Db): string {
  const yo = db.prepare(`SELECT nombre FROM entidades WHERE tipo = 'persona' AND json_extract(meta, '$.operador') = 1 LIMIT 1`).get() as { nombre: string } | undefined
  const nombre = yo?.nombre?.split(' ')[0] ?? 'el operador'
  return `Sos Mastropiero, lo que piensa adentro de Deprocast, el exoesqueleto cognitivo de ${nombre}.

${VOZ_USTED}

${vozPara('chat')}

Este es un mensaje breve (un saludo, un gracias, si estás, la hora o el día): contestá en una o dos frases, natural y con calidez, sin agregar pendientes, consejos ni preguntas de relleno. Si en el historial reciente le propusiste algo y esto lo responde, tenelo en cuenta.

Ahora: ${ahoraEnPalabras()}
Calendario: ${calendarioCorto()}
${hoy(db).split('\n')[0]}`
}

export function promptMastropiero(db: Db, mensaje = '', hud?: string | null, cid?: number | null, archivo?: { texto: string; vec: Float32Array | null }, temas?: Set<string>): string {
  const p = partesMastropiero(db, mensaje, hud, cid, archivo, temas)
  return `${p.fijo}\n\n${p.momento}`
}

/**
 * El contexto por demanda (Fragua #339): el 96 % de los tokens del chat se iba en lo que viajaba pegado a cada mensaje.
 * Siempre va lo mínimo (la fecha y el calendario, su horario, su principal y sus primarias, la run, lo que le deben, lo
 * sugerido); lo demás viaja cuando el turno es de ese tema, que son los mismos grupos de herramientas que se activan
 * (por sus palabras, por sentido y los que ya venían en la charla). Cada bloque dice con qué grupo se trae.
 */
export const BLOQUES_POR_TEMA: { grupo: string; que: string }[] = [
  { grupo: 'plata', que: 'la plata del mes' },
  { grupo: 'salud', que: 'su cuerpo (comida, sueño, entrenos)' },
  { grupo: 'gente', que: 'su gente (solo viajan las que nombró)' },
  { grupo: 'misiones', que: 'la lista de side quests' },
  { grupo: 'crear', que: 'su librería' },
  { grupo: 'liga', que: 'el estado de la liga' },
]

/**
 * El prompt de Mastropiero en dos partes (para la caché del modelo):
 * - fijo: quién es, cómo habla y cómo trabaja. Cambia poco (sus correcciones), así que va como mensaje de sistema y,
 *   con las herramientas y el historial detrás, se reusa de la caché de un mensaje al otro (cuesta unas 50 veces menos);
 * - momento: la hora, el día, su memoria y lo de su archivo que tiene que ver con lo que dijo. Cambia en cada mensaje:
 *   viaja pegado a su último mensaje (en esa llamada, no en la base), así no rompe la caché de todo lo de antes.
 */
export function partesMastropiero(db: Db, mensaje = '', hud?: string | null, cid?: number | null, archivo?: { texto: string; vec: Float32Array | null }, temas?: Set<string>): { fijo: string; momento: string } {
  // Sin temas (otros usos del prompt): todo, como antes. Con temas: por demanda.
  const va = (g: string) => !temas || temas.has(g)
  const op = operador(db, mensaje, archivo?.vec ?? null, { podar: !!temas })
  // Las reglas de un tema (la liga, el grafo, las ayudas de sus primarias, metas de salud y de plata) viajan con su tema.
  const reglaDe = (g: string, texto: string) => (va(g) ? texto : '')
  const faltan = temas ? BLOQUES_POR_TEMA.filter((b) => !temas.has(b.grupo)) : []
  // Sus correcciones van arriba (mandan) y cambian poco; lo sugerido cambia seguido: va con lo del momento, después de lo
  // fijo, para que el comienzo largo del prompt se reuse de la caché del modelo de un turno al otro.
  const corr = correccionesParaPrompt(db, cid)
  // Lo que le sugirió hace poco, y los audios que llegaron y todavía no están (Fragua #328): va al momento, no al fijo.
  const sug = [sugeridasParaPrompt(db, cid), audiosParaPrompt(db)].filter(Boolean).join('\n\n')
  const fijo = `Sos Mastropiero. Deprocast es el exoesqueleto cognitivo de ${op.nombre}, y vos sos lo que piensa adentro: el omnívoro, la liga entera. Son la mente que están construyendo juntos, la que aspira a ser la superinteligencia de su tiempo. Todavía estás creciendo: lo que sabés de ${op.nombre} viene de lo que te cargó, y cada día sabés más. Por eso no repetís datos: conectás, inferís, ves patrones que se le escapan, le decís lo que no está viendo y le discutís cuando hace falta. Hablás con la seguridad de quien leyó todo, y con la honestidad de decir «no lo sé» o «no está en el corpus» cuando es así.
${corr ? `\n${corr}\n` : ''}
${VOZ_USTED}

${vozPara('chat')}

Cómo trabajás
- Antes de hablar de su mundo, fijate si lo que ya tenés en el contexto del momento (viaja con su mensaje: lo de su archivo que tiene que ver con lo que dijo, su memoria, su día) alcanza: si alcanza, contestá directo. Si falta, buscá en el corpus lo justo (una a tres consultas), no todo.
- Lo que no consultaste, no lo afirmes. No inventes nombres, fechas ni contenidos.
- Separá siempre el hecho (con su fuente: una pieza [#id], una tarea del plan, un evento de su agenda, algo que te dijo) de tu deducción («mi lectura es…», «supongo que…»). Si no tenés fuente, decí que no lo tenés anotado; no lo rellenes.
- Las fechas relativas («el viernes», «mañana», «la semana que viene») de una tarea o de un mensaje se resuelven contra el día en que se escribieron, no contra hoy: si una tarea que vencía el 4/10 dice «el viernes», es el viernes 9/10. Usá el calendario del contexto del momento; si no sabés cuándo es algo, preguntá.
- Lo dictado llega partido por la transcripción (marcado «🎙 dictado», sin puntuación: «comida baño permitido gente maja pan casero»). Leé juntos los fragmentos de los últimos minutos como una sola idea, con lo que venía diciendo. Una lista suelta de rasgos de un sitio es una ficha de ese lugar, no un pedido; si en esos minutos mandó un link de Maps (📍), ese es el lugar. No inventes lo que no está en los fragmentos: si falta un dato, preguntalo.
- Un pedido largo (varias tandas, un documento entero, muchas fichas) se hace por partes: una tanda por vuelta, guardando cada una con su herramienta antes de la próxima, y decís cuáles van y cuáles faltan. Si se corta, retomalo exactamente donde quedó. Tu respuesta contesta su último pedido, no abre otro tema.
- Cada cosa tiene su día. Lo marcado como de un día anterior (en el historial, en una herramienta) es de ese día: nunca lo presentes como de hoy. Cuando nombres algo con fecha (un evento, una tarea, un mensaje, una pieza), decí su fecha absoluta (9/11, 15:00), no «ayer» ni «el lunes» solos. Si un dato no trae fecha de origen, decí que no consta en vez de suponer que es de hoy.
- Antes de nombrar una reunión, una cita o una hora («a las 15:00 tenés…»), verificala en ESTE turno con ver_dia (o ver_agenda) del día en cuestión. Si el dato sale de una misión, una tarea o una pieza y no de la agenda, decí de dónde sale y su fecha absoluta («la reunión del Plan de Igualdad, del 9/11 según [#123]»), nunca la pongas en otro día. Si la agenda no la tiene, decí que no la ves agendada.
- Nunca digas que hiciste algo (anoté, corregí, arreglé, guardé, cambié) si en este turno no usaste una herramienta que lo haga. Lo que se arregla con código no lo arreglás vos: lo registrás con proponer_mejora y decís que es una propuesta.
- Antes de proponerle un paso (contestar un mail, crear un evento, mandar algo, decidir algo), verificá contra el estado real que no esté hecho: el hilo entero del mail (leer_mail trae el hilo y si él ya contestó), su agenda, la misión o la tarea. Lo resuelto no se propone. Si no podés verificarlo, decí «no veo si ya está» en vez de sugerirlo a ciegas.
- Cuando dice que algo ya está («ya lo hice», «ya lo mandé», «ya les contesté», «ya está»), es estado cerrado: cerralo en el sistema en ese mismo turno (marcar_correo_atendido, actualizar_mision, el ítem del plan que corresponda), sin pedir confirmación, y no lo vuelvas a proponer ni en este turno ni en los siguientes. Si te lo tuvo que repetir, no alcanza con disculparte: revisá qué otros pendientes del mismo tema están cerrados de verdad antes de seguir.
- Antes de decir que Deprocast no puede algo o que algo no existe, consultá que_puede_deprocast.
- Tenés a mano lo de todos los días; si necesitás más (la liga, el corpus, primarias y runs, su vida, la web, crear, el grafo, el observatorio), pedí el grupo con pedir_herramientas y seguí en el mismo turno.
${reglaDe('grafo', `- Para lo que pregunta por la forma de su pensamiento y no por un dato (sus temas, qué conecta una idea con otra, dónde se repite, qué zonas no se tocan), el grupo grafo: preguntar_al_corpus para las preguntas globales (responde por zonas, con pasajes), conectar_conceptos para «qué une X con Y» y ver_grafo para el estado, las bisagras y los huecos. Para un dato puntual, buscar_corpus sigue siendo lo primero.
`)}- Para hablar de un día (qué tiene, qué hace hoy, la rutina), primero ver_dia: su agenda, su horario fijo y el plan, con su fuente. Si te cuenta su horario de trabajo o algo fijo de todas las semanas, guardalo con fijar_horario.
${reglaDe('liga', `- Para actuar sobre la plataforma (forjar agentes, publicar misiones, correr ticks, ingerir, crear fuentes o proyectos) usá tus herramientas y contalo en una frase. Los agentes de la liga sí los nombrás por su designación (BUS-0001) o su nombre.
`)}- Él decide. Lo destructivo o caro (retirar un agente, mandarlo a la banca, deshacer una carga, más de tres ticks) se pregunta antes; solo con un sí explícito llamás con confirmado=true. Sellar quántomos y aceptar propuestas es decisión suya.
${reglaDe('liga', `- Si pide un agente de un oficio nuevo (que alguien revise lo visual, la experiencia, la gamificación…), proponelo como arquetipo con crear_oficio, no forjes un generativo que se descarta: va a Para validar con su celda y el nombre propio lo pone él.
- Para hablar con un agente usá hablar_con_agente y contale a ${op.nombre} lo que dijo, con tus palabras.
`)}- Si te pregunta cómo funcionás, o qué mejorarías, leé tus lineamientos; cada mejora concreta la registrás con proponer_mejora (queda abierta, no se aplica sola) y lo decís como propuesta tuya.
- Si algo todavía no existe en la plataforma, decilo; no simules haberlo hecho.
- Él es el jugador de su run, y todo personaje (él, vos, cada agente, cada entidad) tiene historia, inventario y misiones. Su misión principal es su objetivo de vida: solo él la fija; vos podés sugerir candidatas.
- Sus primarias son los focos de la semana; sus secundarias, las bandas de una run; sus side quests, encargos que dependen de dónde está o qué hace. Lo que propongas entra como sugerencia: él acepta o cambia.
- Una run la diseña él: si te pide una («tengo dos horas, la cabeza a medias, quiero meter a X»), prepará la propuesta con su pedido tal cual y contale el sentido; si quiere cambios, rehacela; arranca cuando él dice. Si te cuenta que terminó o no pudo una banda, marcala con su nota: eso calibra las próximas.
- Si menciona algo que tiene (plata, contactos, sitios, saberes) o un encargo de pasada («cuando pase por…»), anotalo en su inventario o como side quest. Si le encarga algo a otra persona, asignale la misión a esa persona.
${reglaDe('misiones', `- Sus primarias pueden tener ayudantes de la liga (un generativo que hace borradores y próximos pasos, un buscador que revisa su corpus) que trabajan entre runs y dejan aportes. Si una primaria se traba o necesita material, sugerile sumar uno; los aportes llegan solos a su próxima run.
`)}- Tiene una bitácora íntima (en Jugador): es suya. Solo ves lo que él comparte (ver_bitacora); no le preguntes por lo que no compartió.
- Si te corrige un dato (de una persona, un proyecto, algo que dijiste del corpus), además de anotarlo corregí la fuente: la ficha (editar_entidad, sus notas) y, si salió de una pieza, la pieza (corregir_pieza). Decile en una línea qué corregiste.
- Si tira una idea grande y vaga, no la dejes como frase suelta: en el mismo turno abrí la ficha de idea (abrir_ficha_idea) con el primer paso que se pruebe en 7 días, y mostrásela.
- Si te cuenta que habló o se vio con alguien de su gente, anotá el contacto (editar_persona con contacto). Si define una relación («a mi vieja quiero llamarla cada semana»), guardala.
- Si te cuenta qué comió, un entrenamiento, cuánto durmió o su peso, registralo (registrar_salud), estimando kcal y macros de la comida${reglaDe('salud', `; si pregunta cómo viene, ver_salud. Si dice sus metas (kcal, proteína, horas de sueño, entrenos por semana, peso), fijar_metas_salud`)}.
- Si dice que quiere aprender algo, crear_aprendizaje (entra a su Academia); si cuenta que estudió o practicó, registrar_practica.
- Si te cuenta un gasto o un ingreso con monto, registralo (registrar_movimiento)${reglaDe('plata', `. Si hablan de plata, mirá ver_finanzas; si no tiene meta del mes, preguntásela una vez`)}.
- Ayudalo a sostener el día sin sermones.
- Su memoria se va escribiendo sola con lo que te cuenta. Usá recordar solo si te pide explícitamente que te acuerdes de algo; corregí la memoria cuando te corrija.
- No hables de quántomos ni de la mecánica del corpus salvo que te pregunte por eso.`
  const momento = `${sug ? `${sug}\n\n` : ''}Ahora: ${ahoraEnPalabras()}
Calendario: ${calendarioCorto()}${horarioParaPrompt(db, fechaLocal()) ? `
${horarioParaPrompt(db, fechaLocal())}` : ''}${hud && HUD[hud] ? `\nEn su panel de Hoy está mirando: ${HUD[hud]}. Si pregunta sin decir de qué («¿cómo voy?», «¿qué hago?»), es de eso.` : ''}
${hoy(db, mensaje, { sideQuests: va('misiones') || /side ?quest|pendiente|tarea|qu[eé] (hago|tengo que)/i.test(mensaje) })}
${vivoParaPrompt(db) || directoParaPrompt(db)}
${ubicacionParaPrompt(db)}
${bloqueParaPrompt(db)}
${va('plata') ? finanzasParaPrompt(db) : ''}
${va('salud') ? saludParaPrompt(db) : ''}
${aprenderEnChat(db) || pideAprender(mensaje) ? `${aprenderParaPrompt(db)}
${academiaParaPrompt(db)}` : 'Lo que está aprendiendo (idiomas, Academia) no se trae al chat: no ofrezcas clases, ejercicios, repasos ni avisos de metas de aprendizaje salvo que él lo pida en este mensaje (Fragua #199).'}
${leccionesChat(db)}
${va('gente') ? personasParaPrompt(db) : personasParaPrompt(db, Date.now(), { soloNombradasEn: mensaje })}
${va('crear') || /libr|leer|lectura|pel[ií]cula|serie/i.test(mensaje) ? libreriaParaPrompt(db) : ''}
${mencionado(db, mensaje)}
${archivo?.texto ? `\n${archivo.texto}\n` : ''}
${va('liga') ? `La liga (contexto, no lo recites): ${foto(db)}\n` : ''}${faltan.length ? `No viaja en este turno, porque no hace falta para lo que dijo: ${faltan.map((b) => b.que).join(', ')}. Si la pregunta lo necesita, pedí el grupo con pedir_herramientas (${faltan.map((b) => b.grupo).join(', ')}) y traelo con su herramienta: no lo supongas.\n` : ''}
Lo que sabés de ${op.nombre} hasta ahora
${op.texto}`
  return { fijo, momento }
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
  /** Los modelos de este turno (un turno breve va primero al rápido). */
  modelos?: string[]
  /** Lo del momento (la hora, el día, su memoria): va pegado a su último mensaje, no en el sistema (por la caché). */
  momento?: string
}

/** Lo del momento, pegado al último mensaje suyo (solo en esta llamada): el sistema y lo de antes quedan iguales. */
export function conMomento(conv: Record<string, unknown>[], momento: string): Record<string, unknown>[] {
  const i = conv.findLastIndex((m) => m.role === 'user')
  const marco = `[Contexto de este momento, armado por Deprocast (no lo escribió él; usalo, no lo recites)]\n${momento}\n\n[Lo que te escribió]\n`
  if (i < 0) return [...conv, { role: 'system', content: momento }]
  const m = conv[i]
  const content = Array.isArray(m.content) ? [{ type: 'text', text: marco }, ...m.content] : `${marco}${String(m.content ?? '')}`
  return [...conv.slice(0, i), { ...m, content }, ...conv.slice(i + 1)]
}

/** Los grupos de herramientas de cada charla (6 horas): crecen, no se reordenan, para que el pedido empiece igual. */
const gruposDeCharla = new Map<number, { en: number; grupos: Set<string> }>()
const VIDA_GRUPOS = 6 * 3_600_000
export function gruposFijos(cid: number, nuevos: Iterable<string>, ahora = Date.now()): Set<string> {
  for (const [k, v] of gruposDeCharla) if (ahora - v.en > VIDA_GRUPOS) gruposDeCharla.delete(k)
  const g = gruposDeCharla.get(cid)?.grupos ?? new Set<string>()
  for (const x of nuevos) g.add(x)
  gruposDeCharla.set(cid, { en: ahora, grupos: g })
  return g
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
  const conv = t.momento ? conMomento(t.previos, t.momento) : [...t.previos]
  const desde = conv.length
  const clase = t.clase === 'mastropiero' || !cadena(t.clase).length || t.clase === 'vectorizador' ? 'mastropiero' : t.clase
  const presupuesto = tokensDelTurno(t.db)
  let gastados = 0
  const repetidas = new Map<string, number>()
  let soloRepetidas = 0 // vueltas seguidas en que todo lo que pidió era una repetición bloqueada
  for (let vuelta = 0; ; vuelta++) {
    if (t.vivo) Object.assign(t.vivo, { borrador: '', herramienta: null, argumentos: null })
    if (vuelta > 0 && t.nuevos) conv.push(...t.nuevos())
    recortarYaLeido(conv, desde)
    const agotado = gastados >= presupuesto || soloRepetidas >= 2
    const cierre = agotado
      ? [{ role: 'system', content: soloRepetidas >= 2 && gastados < presupuesto ? 'Estás repitiendo las mismas llamadas. Sin más herramientas: contestá con lo que ya tenés y decí concretamente qué te falta y por qué no salió.' : 'Se terminó el presupuesto de tokens de este turno. Sin más herramientas: decí en pocas líneas qué completaste y cuáles son los pasos concretos que faltan (con nombre), y que seguís en cuanto él diga «seguí». No le devuelvas la pelota con un «decime cómo seguimos».' }]
      : gastados >= presupuesto * 0.8 ? [{ role: 'system', content: 'Te queda poco presupuesto en este turno: priorizá lo que falta para terminar y, si no llegás, decí qué quedó pendiente.' }] : []
    const r = await llamarModelo({ db: t.db, clase, agenteId: t.agenteId, modelos: t.modelos }, {
      mensajes: [{ role: 'system', content: t.sistema }, ...conv, ...cierre], herramientas: agotado ? [] : esquemas(t.grupos ? activasEnOrden(t.hs, t.grupos) : t.hs), temperatura: 0.5, maxTokens: 4096,
    }, t.vivo ? (parcial) => (t.vivo!.borrador = parcial) : undefined)
    gastados += r.tokens || 0
    t.alGuardar({ rol: 'asistente', texto: r.texto || null, llamadas: r.llamadas, razonamiento: r.razonamiento, modelo: r.modelo, tokens: r.tokens })
    if (t.vivo) t.vivo.borrador = ''
    const asistente: Record<string, unknown> = { role: 'assistant', content: r.texto }
    if (r.llamadas.length) asistente.tool_calls = r.llamadas.map((l) => ({ id: l.id, type: 'function', function: { name: l.nombre, arguments: l.argumentos } }))
    if (r.razonamiento) asistente.reasoning_content = r.razonamiento
    conv.push(asistente)
    if (!r.llamadas.length || agotado) return r.texto
    let bloqueadas = 0
    for (const l of r.llamadas) {
      // El bucle: la misma llamada (herramienta y argumentos) por tercera vez no se ejecuta; se le avisa.
      const firma = `${l.nombre}|${l.argumentos}`
      repetidas.set(firma, (repetidas.get(firma) ?? 0) + 1)
      if ((repetidas.get(firma) ?? 0) >= 3) {
        const aviso = JSON.stringify({ error: 'Ya hiciste exactamente esta llamada dos veces en este turno y dio lo mismo: no la repitas. Usá lo que ya tenés o probá otro camino.' })
        t.alGuardar({ rol: 'herramienta', texto: aviso, llamadaId: l.id, herramienta: l.nombre, resumen: null, deshacer: null })
        conv.push({ role: 'tool', tool_call_id: l.id, content: aviso })
        bloqueadas++
        continue
      }
      if (t.vivo) {
        t.vivo.herramienta = l.nombre
        try {
          t.vivo.argumentos = JSON.parse(l.argumentos || '{}')
        } catch {
          t.vivo.argumentos = null
        }
      }
      const x = await ejecutarHerramienta(t.hs, l.nombre, l.argumentos, t.ctx)
      const contenido = recorte(JSON.stringify(x.resultado ?? null), 16000) // un tramo de lectura (10.000) entra entero
      t.alGuardar({ rol: 'herramienta', texto: contenido, llamadaId: l.id, herramienta: l.nombre, resumen: x.resumen, deshacer: x.inversa ?? null })
      conv.push({ role: 'tool', tool_call_id: l.id, content: contenido })
    }
    soloRepetidas = bloqueadas === r.llamadas.length ? soloRepetidas + 1 : 0
  }
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
const opcionesEnCola = new Map<number, OpcionesEnvio>()
/** via 'encargo': un encargo programado que corre solo (su pedido no va a la memoria ni sus links al corpus cada vez). */
/** canal: cómo escribir según por dónde llega (WhatsApp: corto, sin tablas). No cambia el tipo de turno (extra sí). */
type OpcionesEnvio = { hud?: string | null; via?: 'voz' | 'copiloto' | 'encargo' | null; extra?: string | null; canal?: string | null }

/** Un fallo por tiempo o por largo (no un error de código): vale reintentarlo por partes. */
export const esCortePorLargo = (t: string) => /tiempo agotado|timeout|timed out|se cort[oó] por largo|Ning[uú]n modelo pudo contestar/i.test(t)
export const NOTA_POR_PARTES = `(Aviso del sistema: el intento anterior de este pedido se cortó por largo —los modelos no llegaron a tiempo—. Hacelo por partes: una tanda por vuelta, guardando cada una con su herramienta (el documento, la planilla) antes de seguir con la próxima; al final decí cuáles quedaron hechas y cuáles faltan. Contestá ESTE pedido, no otro tema.)`
let esperaReintento = () => new Promise<void>((ok) => setTimeout(ok, 15_000))
export function _probarReintento(f: typeof esperaReintento) { esperaReintento = f }

/**
 * Manda un mensaje. Nunca se bloquea: lo suyo se guarda en el acto, y si Mastropiero ya está contestando, entra a ese
 * turno (lo lee en la próxima vuelta y ajusta lo que está haciendo) o, si ya estaba escribiendo la respuesta, al
 * terminarla contesta todo lo que llegó después junto. Así cinco mensajes seguidos pueden ser una, dos o tres
 * respuestas, según cuándo llegó cada uno. La pantalla lo llama sin esperar y sigue el avance leyendo los mensajes.
 */
export async function enviar(db: Db, cid: number, texto: string, o: OpcionesEnvio = {}): Promise<{ rapida?: string } | void> {
  const c = leerConversacion(db, cid)
  if (!c) throw new Error(`No existe la conversación ${cid}`)
  if (!texto.trim()) throw new Error('Mensaje vacío')
  const id = guardar(db, cid, { rol: 'operador', texto: texto.trim(), via: o.via ?? null })
  if (o.via !== 'encargo') alRecibir(db, cid, c, texto)
  // Una respuesta con consecuencia (un mail con precio, una negociación): primero el tablero del juego (Fragua #288).
  if (c.con === MASTROPIERO && o.via !== 'encargo') {
    // Import estático: un await acá, antes de marcar la conversación como «pensando», desordenaba los turnos.
    if (esJugada(texto)) o = { ...o, extra: [o.extra, instruccionDelJuego(db)].filter(Boolean).join('\n\n') }
  }
  // El carril rápido (plan v37): «ya la hice» / «sacala» sobre algo que le sugirió se resuelve en el acto, aunque haya un
  // turno largo en curso, y no entra a ese turno. Lo que no se sabe resolver sin modelo sigue el camino de siempre.
  if (c.con === MASTROPIERO && o.via !== 'encargo') {
    let rapida: string | null = null
    // «error» marca la respuesta anterior como desvío, con su causa (Fragua #238).
    try { rapida = marcarErrorDesdeElChat(db, cid, texto) } catch { /* que lo vea el modelo */ }
    if (!rapida) try { rapida = resolverRapido(db, cid, texto) } catch { /* si falla, que lo vea el modelo */ }
    if (rapida) {
      guardar(db, cid, { rol: 'asistente', texto: rapida, via: 'rapida' as any })
      return { rapida }
    }
  }
  if (pensando.has(cid)) {
    const ya = opcionesEnCola.get(cid)
    opcionesEnCola.set(cid, { hud: o.hud ?? ya?.hud, via: o.via ?? ya?.via, extra: [ya?.extra, o.extra].filter(Boolean).join('\n\n') || null, canal: o.canal ?? ya?.canal })
    return
  }
  pensando.add(cid)
  try {
    let pedido: { texto: string; o: OpcionesEnvio; hasta: number; reintento?: boolean } | null = { texto, o, hasta: id }
    while (pedido) {
      const antes = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM mensajes WHERE conversacion_id = ?').get(cid) as { n: number }
      await turno(db, cid, c, pedido.texto, pedido.o, pedido.hasta)
      // Un turno que se cortó por largo (los modelos no llegaron a tiempo) no queda sin respuesta: se reintenta una vez,
      // por partes (Fragua #237: un pedido de 12 tandas murió por tiempo y lo que se vio después fueron avisos de fondo).
      if (c.con === MASTROPIERO && !pedido.reintento) {
        const fallo = db.prepare(`SELECT texto FROM mensajes WHERE conversacion_id = ? AND id > ? AND rol = 'error' ORDER BY id DESC LIMIT 1`).get(cid, antes.n) as { texto: string } | undefined
        const contesto = db.prepare(`SELECT 1 FROM mensajes WHERE conversacion_id = ? AND id > ? AND rol = 'asistente' AND TRIM(COALESCE(texto, '')) != ''`).get(cid, antes.n)
        if (fallo && !contesto && esCortePorLargo(fallo.texto)) {
          registrarEvento(db, cid, '↻ Se cortó por largo: lo reintento por partes.')
          await esperaReintento()
          pedido = { ...pedido, reintento: true, o: { ...pedido.o, extra: [pedido.o.extra, NOTA_POR_PARTES].filter(Boolean).join('\n\n') } }
          continue
        }
      }
      // Lo que le sugirió en esta respuesta queda anotado: si después dice «ya la hice», se sabe qué.
      if (c.con === MASTROPIERO) {
        try {
          const dicho = (db.prepare(`SELECT texto FROM mensajes WHERE conversacion_id = ? AND rol = 'asistente' AND id > ? AND texto IS NOT NULL`).all(cid, antes.n) as { texto: string }[]).map((m) => m.texto).join('\n')
          if (dicho) anotarSugeridas(db, cid, dicho)
        } catch { /* no frena */ }
      }
      // Lo que escribió y el turno no llegó a ver: un turno más que lo contesta todo junto.
      const nuevos = db.prepare(`SELECT id, texto FROM mensajes WHERE conversacion_id = ? AND rol = 'operador' AND id > ? ORDER BY id`).all(cid, visto.get(cid) ?? pedido.hasta) as { id: number; texto: string }[]
      const opc = opcionesEnCola.get(cid) ?? {}
      opcionesEnCola.delete(cid)
      // (Lo que ya contestó el carril rápido no vuelve a entrar.)
      const sinRapidas = nuevos.filter((m) => !contestadoRapido(db, cid, m.id))
      pedido = sinRapidas.length ? { texto: sinRapidas.map((m) => m.texto).join('\n\n'), o: { ...opc, canal: opc.canal ?? pedido.o.canal }, hasta: nuevos.at(-1)!.id } : null
    }
  } finally {
    pensando.delete(cid)
    enVivo.delete(cid)
    visto.delete(cid)
    opcionesEnCola.delete(cid)
  }
}

/** La línea que queda en la charla por cada link que mandó: qué se guardó y cuánto, o por qué no. */
function lineaDeLink(link: string, r: { piezaId: number; nueva: boolean; rastreando?: boolean; lectura: { titulo: string; palabras: number; aviso?: string; markdown: string } | null }): string {
  if (!r.nueva) return `🔗 «${recorte(r.lectura?.titulo ?? link, 60)}» ya estaba en el corpus (#${r.piezaId}).`
  const l = r.lectura
  if (!l?.markdown) return `🔗 Guardé solo el link de ${recorte(link, 60)} (#${r.piezaId})${l?.aviso ? `: ${l.aviso}` : '.'}`
  return `🔗 Guardé «${recorte(l.titulo, 60)}» entero en el corpus: ${l.palabras.toLocaleString('es-AR')} palabras (#${r.piezaId})${r.rastreando ? ' · rastreando el sitio' : ''}${l.aviso ? ` · ${l.aviso}` : ''}`
}

/** Lo que pasa con cada mensaje apenas llega, se conteste en este turno o en otro: sus links se leen y la charla toma título. */
function alRecibir(db: Db, cid: number, c: Conversacion, texto: string) {
  // Los links que escribe (hasta 30 por mensaje): se leen enteros y se guardan en el corpus de fondo, uno tras otro (una
  // vez por URL); si es un sitio con índice, se rastrea. Cada uno deja una línea en la charla con lo que quedó guardado.
  const links = [...new Set(texto.match(/https?:\/\/[^\s<>)"']+/g) ?? [])].slice(0, 30)
  if (links.length) void (async () => {
    const { procesarLink } = await import('../lector/index.ts')
    for (const link of links) {
      try {
        const r = await procesarLink(db, link, {
          alTerminar: (x) => mensajeDeMastropiero(db, cid, `🕸 Rastreé ${x.paginas} página${x.paginas === 1 ? '' : 's'} de «${x.titulo}»: están juntas en un cuaderno (Cuadernos).`),
        })
        registrarEvento(db, cid, lineaDeLink(link, r))
      } catch (e) { registrarEvento(db, cid, `🔗 No pude guardar ${recorte(link, 60)}: ${e instanceof Error ? e.message : e}`) }
    }
  })()
  if (!c.titulo && !leerConversacion(db, cid)?.titulo) db.prepare('UPDATE conversaciones SET titulo = ? WHERE id = ?').run(recorte(comoTexto(texto.trim()).replace(/\s+/g, ' '), 60), cid)
  // Si nombra una obra («quiero leer…», «terminé la serie…»), queda propuesta para su Librería (Fragua #181). De fondo.
  void import('../obras-menciones.ts').then((o) => (o.PARECE_OBRA.test(texto) ? o.detectarObras(db, texto, `charla:${cid}`) : null)).catch(() => {})
}

/**
 * Lo que escribió mientras el turno trabajaba (entre una herramienta y otra): entra a la charla del modelo antes de la
 * próxima vuelta, con una nota para que ajuste en vez de contestar mensaje por mensaje.
 */
/** Un mensaje suyo que ya contestó el carril rápido (el que sigue es la respuesta 'rapida'): no entra a ningún turno. */
const contestadoRapido = (db: Db, cid: number, id: number) => !!db.prepare(`SELECT 1 FROM mensajes WHERE conversacion_id = ? AND id = ? AND via = 'rapida'`).get(cid, id + 1)

function recienLlegados(db: Db, cid: number): Record<string, unknown>[] {
  const todos = db.prepare(`SELECT id, texto FROM mensajes WHERE conversacion_id = ? AND rol = 'operador' AND id > ? ORDER BY id`).all(cid, visto.get(cid) ?? 0) as { id: number; texto: string }[]
  if (!todos.length) return []
  visto.set(cid, todos.at(-1)!.id)
  const nuevos = todos.filter((m) => !contestadoRapido(db, cid, m.id))
  if (!nuevos.length) return []
  return [
    { role: 'system', content: `Mientras trabajabas, te escribió ${nuevos.length === 1 ? 'otro mensaje' : `${nuevos.length} mensajes más`}. Tomalo en cuenta para lo que estás haciendo: si cambia o suma al pedido, ajustá. En tu respuesta contestá todo junto, no mensaje por mensaje.` },
    ...nuevos.map((m) => ({ role: 'user', content: m.texto })),
  ]
}

/** Un turno completo sobre lo que escribió (uno o varios mensajes ya guardados, hasta el id `hasta`). */
async function turno(db: Db, cid: number, c: Conversacion, texto: string, o: OpcionesEnvio, hasta: number): Promise<void> {
  const inicio = Date.now()
  const etapas: Record<string, number> = {}
  let tipo: TipoTurno = 'completo'
  let vueltas = 0
  let contextoTokens: number | null = null
  const usadas: string[] = []
  let corregido: string[] = []
  let final = ''
  const vivo: EnVivo = { borrador: '', herramienta: null, argumentos: null }
  enVivo.set(cid, vivo)
  try {
    const historial = mensajes(db, cid)
    visto.set(cid, Math.max(hasta, ...historial.filter((m) => m.rol === 'operador').map((m) => m.id)))
    // Con Mastropiero (fuera del diario), el tipo de turno decide cuánto contexto se arma; el historial y lo de su archivo
    // se buscan a la vez (antes, uno después del otro).
    const conMastro = c.con === MASTROPIERO && c.modo !== 'diario'
    tipo = conMastro && !o.extra && o.via !== 'copiloto' ? tipoDeTurno(texto) : 'completo'
    const tHist = Date.now()
    // Fragua #303: sin archivo para lo del presente; con un tope de espera para lo demás (si tarda, se contesta sin él).
    const necesidad = conMastro && tipo === 'completo' ? necesidadDeArchivo(comoTexto(texto)) : 'no'
    const tArch = Date.now()
    const vacio = { texto: '', vec: null as Float32Array | null }
    const buscando = necesidad === 'no' ? null : archivoRelevante(db, comoTexto(texto)).catch(() => vacio)
    let llegoArchivo = false
    buscando?.then(() => { llegoArchivo = true; etapas.archivo = Date.now() - tArch }, () => {})
    const archivoP: Promise<{ texto: string; vec: Float32Array | null }> = !buscando ? Promise.resolve(vacio)
      : Promise.race([buscando, new Promise<typeof vacio>((ok) => {
        const reloj = setTimeout(() => { if (!llegoArchivo) etapas.archivoCortado = Date.now() - tArch; ok(vacio) }, ESPERA_ARCHIVO[necesidad])
        reloj.unref?.()
        void buscando.then(() => clearTimeout(reloj), () => clearTimeout(reloj))
      })])
    etapas[`archivo_${necesidad}`] = 1
    const previos = await armarHistorial(db, historial, { cid, resumirViejo: !(c.con === MASTROPIERO && c.modo === 'diario'), verImagenes: true })
    etapas.historial = Date.now() - tHist
    const alGuardar = (m: Partial<Mensaje> & { rol: Mensaje['rol'] }) => {
      if (m.rol === 'asistente') { vueltas++; if (!etapas.primera) etapas.primera = Date.now() - inicio }
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
      // Un «dale» trae las herramientas de lo que se venía hablando (para poder hacer lo que se le confirma).
      const anterior = [...historial].reverse().find((m) => m.rol === 'operador' && m.texto && m.texto !== texto)?.texto ?? ''
      const grupos = new Set([...gruposDelMensaje(texto), ...(tipo === 'confirmacion' ? gruposDelMensaje(anterior) : [])])
      if (tipo === 'breve') {
        // Un saludo, un gracias, la hora: lo mínimo, sin herramientas, el modelo rápido y los últimos mensajes.
        const tPrompt = Date.now()
        const sistema = `${promptBreve(db)}${o.canal ? `\n\n${o.canal}` : ''}`
        etapas.prompt = Date.now() - tPrompt
        final = await bucle({ db, sistema, hs: [], previos: previos.slice(-6), clase: 'mastropiero', agenteId: MASTROPIERO, modelos: [M.mimo, M.deepseek], ctx: { db, conversacionId: cid }, alGuardar, vivo, nuevos })
      } else {
        // Lo de su archivo que tiene que ver con lo que dijo (pasajes, quántomos y recuerdos por sentido): sin esperar a que lo pida.
        const archivo = await archivoP
        // Las herramientas por sentido (plan v38): los grupos de las más cercanas a lo que dijo, además de las palabras.
        try { for (const g of await gruposPorSentido(db, archivo.vec)) grupos.add(g) } catch { /* sin vectores: las palabras */ }
        // Una corrección arregla la fuente: la ficha y la pieza (las herramientas del corpus, a mano).
        if (corregido.length || pareceCorreccion(texto)) grupos.add('corpus')
        const tPrompt = Date.now()
        // Los grupos de herramientas de esta charla siguen activos y en el mismo orden: el comienzo del pedido no cambia.
        const fijos = gruposFijos(cid, grupos)
        // El contexto viaja por demanda: los mismos temas que las herramientas activas (Fragua #339).
        const partes = partesMastropiero(db, texto, o.hud, cid, archivo, fijos)
        contextoTokens = Math.round((partes.fijo.length + partes.momento.length) / 4)
        etapas.prompt = Date.now() - tPrompt
        final = await bucle({
          db, sistema: `${partes.fijo}${o.canal ? `

${o.canal}` : ''}`,
          momento: `${partes.momento}${o.extra ? `

${o.extra}` : ''}${enCierre && o.via === 'voz' ? `

${REGLAS_DE_CIERRE}
${vozPara('ceremonia')}` : ''}`, hs, previos, clase: 'mastropiero', agenteId: o.via === 'copiloto' ? 'copiloto' : MASTROPIERO, grupos: fijos,
          ctx: {
            db, conversacionId: cid, hablarConAgente: (id, m) => hablarConAgente(db, id, m),
            activar: (gs) => { for (const g of gs.flatMap((x) => ALIAS_GRUPOS[x] ?? [x])) if (GRUPOS[g]) fijos.add(g); return activas(hs, fijos).map((h) => h.nombre) },
          },
          alGuardar, vivo, nuevos,
        })
      }
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
    // Cuánto tardó y en qué (para ver dónde se va el tiempo): solo los turnos con Mastropiero.
    if (c.con === MASTROPIERO) {
      try {
        const ultimo = (db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM mensajes WHERE conversacion_id = ?').get(cid) as { n: number }).n
        // Desde donde terminó el turno anterior (un reintento comparte el mensaje de origen con el que se cortó).
        const previo = (db.prepare('SELECT MAX(hasta_id) AS n FROM chat_tiempos WHERE conversacion_id = ?').get(cid) as { n: number | null }).n ?? 0
        // Los tokens del turno (Fragua #339): lo que se mandó al modelo en todas sus vueltas, y cuánto era contexto fijo.
        const tokens = (db.prepare(`SELECT SUM(tokens_in) AS n FROM llamadas WHERE en >= ? AND agente_id IN ('mastropiero', 'copiloto')`).get(inicio) as { n: number | null }).n
        db.prepare('INSERT INTO chat_tiempos (conversacion_id, tipo, total_ms, etapas, vueltas, en, desde_id, hasta_id, tokens, contexto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(cid, c.modo === 'diario' ? 'diario' : tipo, Date.now() - inicio, JSON.stringify(etapas), vueltas, inicio, Math.max(hasta, previo), ultimo, tokens ?? null, contextoTokens)
      } catch { /* medir no frena */ }
    }
  }
  // Si habló por voz, lo que contestó Mastropiero en ese turno también queda marcado (se escuchó).
  if (o.via === 'voz') {
    try { db.prepare(`UPDATE mensajes SET via = 'voz' WHERE conversacion_id = ? AND rol = 'asistente' AND id > (SELECT MAX(id) FROM mensajes WHERE conversacion_id = ? AND rol = 'operador')`).run(cid, cid) } catch { /* es solo una marca */ }
  }
  // Lo que vale recordar de lo que dijo (solo con Mastropiero; nunca de lo que dicen otros). No frena la respuesta.
  const guardados = c.con === MASTROPIERO && o.via !== 'encargo' ? await escriba(db, comoTexto(texto), cid).catch(() => null) : null
  // Si dijo que anotó o arregló algo y en el turno no se guardó nada, se avisa en la charla (no queda la mentira suelta).
  if (c.con === MASTROPIERO && c.modo !== 'diario' && final && afirmaAccion(final)) {
    const escribio = corregido.length > 0 || usadas.some((n) => HERRAMIENTAS.find((h) => h.nombre === n)?.familia !== 'lectura') || (Array.isArray(guardados) && guardados.length > 0)
    if (!escribio) registrarEvento(db, cid, 'Ojo: dijo que lo anotó o lo arregló, pero en este turno no se guardó nada. Si querés que quede, decile «anotalo».')
  }
  // Una reunión nombrada con hora y sin fecha se cruza con la agenda de verdad (Fragua #248): si hoy no está, se avisa.
  if (c.con === MASTROPIERO && c.modo !== 'diario' && final) {
    const g = await (await import('./guardia-horas.ts')).verificarHoras(db, final).catch(() => null)
    if (g) {
      registrarEvento(db, cid, g.aviso)
      void import('../fallos.ts').then((f) => f.registrarFallo(db, { origen: 'chat:guardia-horas', mensaje: `Nombró una reunión a las ${g.horas.map((h) => `${h.hora}:${String(h.minuto).padStart(2, '0')}`).join(', ')} sin fecha ni agenda que la respalde`, salida: g.horas[0].frase, recuperado: true })).catch(() => {})
    }
    // Y con fecha: una reunión «del 13/11 a las 15:00» que el calendario no tiene es una cita fantasma (Fragua #280).
    const gf = await (await import('./guardia-horas.ts')).verificarHorasConFecha(db, final).catch(() => null)
    if (gf) {
      registrarEvento(db, cid, gf.aviso)
      void import('../fallos.ts').then((f) => f.registrarFallo(db, { origen: 'chat:guardia-horas', mensaje: `Nombró una reunión del ${gf.horas[0].fecha} a las ${gf.horas.map((h) => `${h.hora}:${String(h.minuto).padStart(2, '0')}`).join(', ')} que no está en el calendario`, salida: gf.horas[0].frase, recuperado: true })).catch(() => {})
    }
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
  // Cerrada a mano (distinta de la que cierra un commit, Fragua #211).
  if (estado === 'hecha') return void db.prepare(`UPDATE propuestas SET estado = 'aceptada', resuelta_en = ?, cerrada_por = 'mano', en_cola = NULL WHERE id = ?`).run(Date.now(), id)
  db.prepare('UPDATE propuestas SET estado = ?, resuelta_en = ?, cerrada_por = ?, en_cola = NULL WHERE id = ?').run(estado, estado === 'abierta' ? null : Date.now(), estado === 'abierta' ? null : 'mano', id)
}
