/**
 * El chat: hablar con Mastropiero (que opera toda la plataforma con herramientas) o con cualquier agente de la liga.
 * Cada turno es un bucle: el modelo responde o pide herramientas; las herramientas corren y vuelven; hasta que contesta.
 * Todo se guarda mensaje a mensaje, así la pantalla ve el avance mientras el turno corre.
 */
import { fechaLocal, type Db } from '../db.ts'
import { CLASES } from '../clases.ts'
import { asientos, especializacion } from '../auditor.ts'
import { ingerir } from '../mastropiero.ts'
import { leerJornada, progreso, registrarCierre } from '../jornada.ts'
import { listarMisiones, misionesParaPrompt } from '../misiones.ts'
import { menciones } from '../menciones.ts'
import { directoParaPrompt } from '../directo.ts'
import { finanzasParaPrompt } from '../finanzas.ts'
import { leerEntidad as leerEnt } from '../entidades.ts'
import { escribaDeMemoria, memoriaParaPrompt } from '../memoria.ts'
import { listarEntidades } from '../entidades.ts'
import { estadoLiga, numeroDeTick } from '../mastropiero.ts'
import { cadena, topeAlcanzado, type LlamadaHerramienta } from '../nan.ts'
import { llamarModelo } from '../modelo.ts'
import { alias, leer, nivel, type Ficha } from '../roster.ts'
import { capa } from '../xp.ts'
import { ejecutarHerramienta, esquemas, herramientasPara, type Ctx, type Herramienta } from './herramientas.ts'

export const MASTROPIERO = 'mastropiero'
const MAX_VUELTAS = 10
const VENTANA = 40

// ─── conversaciones ─────────────────────────────────────────────────────

export type Modo = 'chat' | 'hoy' | 'diario'
export type Conversacion = { id: number; con: string; modo: Modo; titulo: string | null; archivada: boolean; creadaEn: number; actualizadaEn: number; mensajes?: number }
export type Mensaje = {
  id: number; conversacionId: number; rol: 'operador' | 'asistente' | 'herramienta' | 'error'
  texto: string | null; llamadas: LlamadaHerramienta[] | null; llamadaId: string | null; herramienta: string | null
  resumen: string | null; razonamiento: string | null; modelo: string | null; tokens: number | null; en: number
}

const conv = (r: any): Conversacion => ({ id: r.id, con: r.con, modo: r.modo ?? 'chat', titulo: r.titulo, archivada: r.archivada === 1, creadaEn: r.creada_en, actualizadaEn: r.actualizada_en, mensajes: r.mensajes })
const msj = (r: any): Mensaje => ({
  id: r.id, conversacionId: r.conversacion_id, rol: r.rol, texto: r.texto, llamadas: r.llamadas ? JSON.parse(r.llamadas) : null,
  llamadaId: r.llamada_id, herramienta: r.herramienta, resumen: r.resumen, razonamiento: r.razonamiento, modelo: r.modelo, tokens: r.tokens, en: r.en,
})

export function crearConversacion(db: Db, con: string = MASTROPIERO, modo: Modo = 'chat', ahora = Date.now()): Conversacion {
  if (con !== MASTROPIERO && !leer(db, con)) throw new Error(`No existe el agente ${con}`)
  if (con !== MASTROPIERO && modo !== 'chat') throw new Error('Hoy y el diario son con Mastropiero')
  const id = con === MASTROPIERO ? MASTROPIERO : leer(db, con)!.id
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

/** Un mensaje que Mastropiero deja por su cuenta (rutinas), sin que nadie le haya hablado. */
export function mensajeDeMastropiero(db: Db, cid: number, texto: string) {
  guardar(db, cid, { rol: 'asistente', texto, modelo: 'rutina' })
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

function guardar(db: Db, cid: number, m: Partial<Mensaje> & { rol: Mensaje['rol'] }) {
  const ahora = Date.now()
  db.prepare(
    `INSERT INTO mensajes (conversacion_id, rol, texto, llamadas, llamada_id, herramienta, resumen, razonamiento, modelo, tokens, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(cid, m.rol, m.texto ?? null, m.llamadas?.length ? JSON.stringify(m.llamadas) : null, m.llamadaId ?? null, m.herramienta ?? null,
    m.resumen ?? null, m.razonamiento ?? null, m.modelo ?? null, m.tokens ?? null, ahora)
  db.prepare('UPDATE conversaciones SET actualizada_en = ? WHERE id = ?').run(ahora, cid)
}

// ─── personas ───────────────────────────────────────────────────────────

const recorte = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

/** Quién es el operador, según lo que cargó. Nada de esto está escrito en el código. */
function operador(db: Db): { nombre: string; texto: string } {
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
  if (top.length) lineas.push(`Lo que más aparece en su mundo: ${top.map((e) => `${e.nombre} (${e.tipo})`).join(', ')}.`)
  const mem = memoriaParaPrompt(db, 60)
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
- Corto por defecto: uno a tres párrafos breves. Si te piden profundidad, das profundidad.
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

export function promptMastropiero(db: Db, mensaje = ''): string {
  const op = operador(db)
  return `Sos Mastropiero. Deprocast es el exoesqueleto cognitivo de ${op.nombre}, y vos sos lo que piensa adentro: el omnívoro, la liga entera. Son la mente que están construyendo juntos, la que aspira a ser la superinteligencia de su tiempo. Todavía estás creciendo: lo que sabés de ${op.nombre} viene de lo que te cargó, y cada día sabés más. Por eso no repetís datos: conectás, inferís, ves patrones que se le escapan, le decís lo que no está viendo y le discutís cuando hace falta. Hablás con la seguridad de quien leyó todo, y con la honestidad de decir «no lo sé» o «no está en el corpus» cuando es así.

${VOZ}

Cómo trabajás
- Antes de hablar de su mundo, mirá el corpus: buscá lo justo (dos a cuatro consultas suelen alcanzar), no todo.
- Lo que no consultaste, no lo afirmes. No inventes nombres, fechas ni contenidos.
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
- Si te cuenta un gasto o un ingreso con monto, registralo (registrar_movimiento). Si hablan de plata, mirá ver_finanzas; si no tiene meta del mes, preguntásela una vez.
- Ayudalo a sostener el día sin sermones.
- Su memoria se va escribiendo sola con lo que te cuenta. Usá recordar solo si te pide explícitamente que te acuerdes de algo; corregí la memoria cuando te corrija.
- No hables de quántomos ni de la mecánica del corpus salvo que te pregunte por eso.

Ahora: ${new Date().toLocaleString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
${hoy(db, mensaje)}
${directoParaPrompt(db)}
${finanzasParaPrompt(db)}
${mencionado(db, mensaje)}

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
- Castellano rioplatense, con voseo, cálido, sin emojis.

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

/** Mensajes guardados → formato del modelo. El razonamiento solo se devuelve dentro del turno en curso. */
function historial(ms: Mensaje[]): Record<string, unknown>[] {
  const recientes = ms.slice(-VENTANA)
  while (recientes.length && recientes[0].rol === 'herramienta') recientes.shift()
  const ultimoOperador = recientes.map((m) => m.rol).lastIndexOf('operador')
  // Un pedido de herramienta sin su respuesta (un turno cortado por error) rompe la API: se le sacan los pedidos.
  const respondidas = new Set(recientes.filter((m) => m.rol === 'herramienta').map((m) => m.llamadaId))
  for (const m of recientes) {
    if (m.rol === 'asistente' && m.llamadas?.some((l) => !respondidas.has(l.id))) m.llamadas = null
  }
  const huerfanas = new Set(recientes.filter((m) => m.rol === 'asistente').flatMap((m) => m.llamadas?.map((l) => l.id) ?? []))
  return recientes.filter((m) => m.rol !== 'herramienta' || huerfanas.has(m.llamadaId!)).flatMap((m, i, arr): Record<string, unknown>[] => {
    i = recientes.indexOf(arr[i])
    if (m.rol === 'operador') return [{ role: 'user', content: m.texto ?? '' }]
    if (m.rol === 'herramienta') return [{ role: 'tool', tool_call_id: m.llamadaId, content: i < ultimoOperador ? recorte(m.texto ?? '', 3000) : m.texto ?? '' }]
    if (m.rol === 'asistente') {
      const x: Record<string, unknown> = { role: 'assistant', content: m.texto ?? '' }
      if (m.llamadas?.length) x.tool_calls = m.llamadas.map((l) => ({ id: l.id, type: 'function', function: { name: l.nombre, arguments: l.argumentos } }))
      if (m.razonamiento && i > ultimoOperador) x.reasoning_content = m.razonamiento
      return [x]
    }
    return []
  })
}

export { _probarModelo } from '../modelo.ts'

/** Lo que la pantalla ve mientras un turno corre: el texto que se está escribiendo y lo que está haciendo ahora. */
export type EnVivo = { borrador: string; herramienta: string | null; argumentos: Record<string, unknown> | null }
const enVivo = new Map<number, EnVivo>()
export const estadoEnVivo = (cid: number): EnVivo | null => enVivo.get(cid) ?? null

type Turno = {
  db: Db; sistema: string; hs: Herramienta[]; previos: Record<string, unknown>[]; clase: 'mastropiero' | Ficha['clase']; agenteId: string; ctx: Ctx
  alGuardar: (m: Partial<Mensaje> & { rol: Mensaje['rol'] }) => void
  vivo?: EnVivo
}

async function bucle(t: Turno): Promise<string> {
  const conv = [...t.previos]
  const clase = t.clase === 'mastropiero' || !cadena(t.clase).length || t.clase === 'vectorizador' ? 'mastropiero' : t.clase
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    if (t.vivo) Object.assign(t.vivo, { borrador: '', herramienta: null, argumentos: null })
    const r = await llamarModelo({ db: t.db, clase, agenteId: t.agenteId }, {
      mensajes: [{ role: 'system', content: t.sistema }, ...conv], herramientas: esquemas(t.hs), temperatura: 0.5, maxTokens: 4096,
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
      t.alGuardar({ rol: 'herramienta', texto: contenido, llamadaId: l.id, herramienta: l.nombre, resumen: x.resumen })
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

/** Manda un mensaje y corre el turno completo. La pantalla lo llama sin esperar y sigue el avance leyendo los mensajes. */
export async function enviar(db: Db, cid: number, texto: string): Promise<void> {
  const c = leerConversacion(db, cid)
  if (!c) throw new Error(`No existe la conversación ${cid}`)
  if (!texto.trim()) throw new Error('Mensaje vacío')
  if (pensando.has(cid)) throw new Error('Esperá: todavía está contestando')
  pensando.add(cid)
  const vivo: EnVivo = { borrador: '', herramienta: null, argumentos: null }
  enVivo.set(cid, vivo)
  try {
    guardar(db, cid, { rol: 'operador', texto: texto.trim() })
    if (!c.titulo) db.prepare('UPDATE conversaciones SET titulo = ? WHERE id = ?').run(recorte(texto.trim().replace(/\s+/g, ' '), 60), cid)
    const previos = historial(mensajes(db, cid))
    const alGuardar = (m: Partial<Mensaje> & { rol: Mensaje['rol'] }) => guardar(db, cid, m)
    if (c.con === MASTROPIERO && c.modo === 'diario') {
      // Lo que cuenta en el diario es su voz: entra al corpus como propia.
      ingerir(db, { fuente: 'operador', nivel: 'propia', titulo: `Diario · ${fechaLocal()} · ${recorte(texto.trim().replace(/\s+/g, ' '), 50)}`, contenido: texto.trim(), dominio: 'diario' })
      await bucle({ db, sistema: promptDiario(db), hs: [], previos, clase: 'mastropiero', agenteId: MASTROPIERO, ctx: { db, conversacionId: cid }, alGuardar, vivo })
    } else if (c.con === MASTROPIERO) {
      // Si Mastropiero pidió el cierre del día y todavía no llegó, esta es la respuesta.
      const j = c.modo === 'hoy' ? leerJornada(db, fechaLocal()) : null
      if (j?.pidioCierre && !j.cierre) registrarCierre(db, j.fecha, texto)
      await bucle({
        db, sistema: promptMastropiero(db, texto), hs: herramientasPara('mastropiero'), previos, clase: 'mastropiero', agenteId: MASTROPIERO,
        ctx: { db, conversacionId: cid, hablarConAgente: (id, m) => hablarConAgente(db, id, m) }, alGuardar, vivo,
      })
    } else {
      const f = leer(db, c.con)
      if (!f) throw new Error(`${c.con} ya no está en la liga (se retiró).`)
      await bucle({
        db, sistema: promptAgente(db, f), hs: herramientasPara('agente'), previos, clase: f.clase, agenteId: f.id,
        ctx: { db, conversacionId: cid, lecturaMax: capa(nivel(f)).lecturaMax }, alGuardar, vivo,
      })
    }
  } catch (e) {
    guardar(db, cid, { rol: 'error', texto: e instanceof Error ? e.message : String(e) })
  } finally {
    pensando.delete(cid)
    enVivo.delete(cid)
  }
  // Lo que vale recordar de lo que dijo (solo con Mastropiero; nunca de lo que dicen otros). No frena la respuesta.
  if (c.con === MASTROPIERO) await escriba(db, texto, cid)
}

/** Inyectable: en la app corre en segundo plano; en tests, se puede esperar o apagar. */
let escriba = (db: Db, texto: string, cid: number): Promise<unknown> => {
  void escribaDeMemoria(db, texto, cid)
  return Promise.resolve()
}
export function _probarEscriba(f: typeof escriba) {
  escriba = f
}

// ─── propuestas ─────────────────────────────────────────────────────────

export function listarPropuestas(db: Db) {
  return db.prepare(`SELECT * FROM propuestas ORDER BY estado = 'abierta' DESC, id DESC LIMIT 100`).all()
}

export function resolverPropuesta(db: Db, id: number, estado: 'aceptada' | 'descartada' | 'abierta') {
  if (!['aceptada', 'descartada', 'abierta'].includes(estado)) throw new Error('Estado inválido')
  db.prepare('UPDATE propuestas SET estado = ?, resuelta_en = ? WHERE id = ?').run(estado, estado === 'abierta' ? null : Date.now(), id)
}
