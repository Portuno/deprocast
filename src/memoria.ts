/**
 * Lo que Mastropiero sabe del operador: hechos, metas, preferencias, sueños y visión, con fecha.
 * Nace de lo que el operador dice (nunca de terceros). Nada se pisa: corregir crea una versión nueva.
 */
import { fechaLocal, type Db } from './db.ts'
import { anotar, haceSolo } from './decisiones.ts'
import { pedirJson } from './modelo.ts'
import { agregarItem, entidadDelJugador, personaje } from './personajes.ts'
import { anotarSideQuest } from './misiones.ts'
import { sugerirMovimiento } from './finanzas.ts'
import { parecidoA, vectoresDe } from './semantica.ts'

export const TIPOS_MEMORIA = ['hecho', 'meta', 'preferencia', 'sueño', 'vision', 'correccion'] as const
export type TipoMemoria = (typeof TIPOS_MEMORIA)[number]
export const HORIZONTES = ['castillo', 'campamento', 'trinchera'] as const
export type Horizonte = (typeof HORIZONTES)[number]

export type Recuerdo = {
  id: number
  texto: string
  tipo: TipoMemoria
  horizonte: Horizonte | null
  fecha: string
  origen: number | null
  estado: 'vigente' | 'corregida' | 'archivada'
  revisada: boolean
  reemplaza: number | null
  piezaId: number | null
  creadaPor: string
  creadaEn: number
}

const deFila = (r: any): Recuerdo => ({
  id: r.id, texto: r.texto, tipo: r.tipo, horizonte: r.horizonte, fecha: r.fecha, origen: r.origen, estado: r.estado,
  revisada: r.revisada === 1, reemplaza: r.reemplaza, piezaId: r.pieza_id ?? null, creadaPor: r.creada_por, creadaEn: r.creada_en,
})

const esTipo = (t: unknown): t is TipoMemoria => TIPOS_MEMORIA.includes(t as TipoMemoria)
const esHorizonte = (h: unknown): h is Horizonte => HORIZONTES.includes(h as Horizonte)

function normal(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function leerRecuerdo(db: Db, id: number): Recuerdo | null {
  const r = db.prepare('SELECT * FROM memoria WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

/** Alta. Si ya hay uno vigente que dice lo mismo, devuelve ese. */
export function recordar(
  db: Db,
  r: { texto: string; tipo?: string; horizonte?: string | null; origen?: number | null; piezaId?: number | null; creadaPor?: string; revisada?: boolean; fecha?: string; reemplaza?: number | null },
  ahora = Date.now(),
): Recuerdo {
  const texto = r.texto.trim().replace(/\s+/g, ' ')
  if (!texto) throw new Error('Un recuerdo vacío no se guarda')
  const tipo = esTipo(r.tipo) ? r.tipo : 'hecho'
  const horizonte = esHorizonte(r.horizonte) ? r.horizonte : null
  const n = normal(texto)
  const igual = (db.prepare(`SELECT * FROM memoria WHERE estado = 'vigente'`).all() as any[]).find((x) => {
    const m = normal(x.texto)
    return m === n || (m.length > 24 && n.includes(m)) || (n.length > 24 && m.includes(n))
  })
  if (igual) return deFila(igual)
  const res = db.prepare(
    `INSERT INTO memoria (texto, tipo, horizonte, fecha, origen, pieza_id, estado, revisada, reemplaza, creada_por, creada_en) VALUES (?, ?, ?, ?, ?, ?, 'vigente', ?, ?, ?, ?)`,
  ).run(texto, tipo, horizonte, r.fecha ?? fechaLocal(ahora), r.origen ?? null, r.piezaId ?? null, r.revisada ? 1 : 0, r.reemplaza ?? null, r.creadaPor ?? 'operador', ahora)
  return leerRecuerdo(db, Number(res.lastInsertRowid))!
}

/** Corregir no borra: la versión vieja queda como corregida y la nueva la reemplaza. */
const DE_LA_MAQUINA = new Set(['escriba', 'directo', 'takeout', 'preguntas'])

export function corregir(db: Db, id: number, cambios: { texto?: string; tipo?: string; horizonte?: string | null }, por = 'operador', ahora = Date.now()): Recuerdo {
  const viejo = leerRecuerdo(db, id)
  if (!viejo || viejo.estado !== 'vigente') throw new Error(`No hay un recuerdo vigente #${id}`)
  if (por === 'operador' && DE_LA_MAQUINA.has(viejo.creadaPor)) anotar(db, 'recuerdo', id, 'editada', { cambios: { texto: cambios.texto ?? null }, ahora })
  const soloOrden = cambios.texto == null || cambios.texto.trim() === viejo.texto
  if (soloOrden) {
    // Cambiar tipo u horizonte no es corregir el contenido: se actualiza en el lugar.
    db.prepare('UPDATE memoria SET tipo = ?, horizonte = ?, revisada = 1 WHERE id = ?')
      .run(esTipo(cambios.tipo) ? cambios.tipo : viejo.tipo, cambios.horizonte === undefined ? viejo.horizonte : esHorizonte(cambios.horizonte) ? cambios.horizonte : null, id)
    return leerRecuerdo(db, id)!
  }
  db.prepare(`UPDATE memoria SET estado = 'corregida' WHERE id = ?`).run(id)
  const nuevo = db.prepare(
    `INSERT INTO memoria (texto, tipo, horizonte, fecha, origen, estado, revisada, reemplaza, creada_por, creada_en) VALUES (?, ?, ?, ?, ?, 'vigente', 1, ?, ?, ?)`,
  ).run(cambios.texto!.trim(), esTipo(cambios.tipo) ? cambios.tipo : viejo.tipo, cambios.horizonte === undefined ? viejo.horizonte : esHorizonte(cambios.horizonte) ? cambios.horizonte : null,
    fechaLocal(ahora), viejo.origen, id, por, ahora)
  return leerRecuerdo(db, Number(nuevo.lastInsertRowid))!
}

export function archivar(db: Db, id: number) {
  const r = leerRecuerdo(db, id)
  if (r && r.estado === 'vigente' && DE_LA_MAQUINA.has(r.creadaPor)) anotar(db, 'recuerdo', id, 'rechazada')
  db.prepare(`UPDATE memoria SET estado = 'archivada' WHERE id = ?`).run(id)
}

// ─── limpieza de fondo ──────────────────────────────────────────────────

const VACIAS = new Set(['que', 'los', 'las', 'del', 'con', 'por', 'para', 'una', 'uno', 'unos', 'unas', 'sus', 'mas', 'muy', 'como', 'esta', 'este', 'tiene', 'pero', 'cuando', 'donde', 'sobre', 'entre', 'tambien', 'quiere', 'prefiere'])
const palabras = (t: string) => new Set(normal(t).split(' ').filter((w) => w.length >= 3 && !VACIAS.has(w) && !/^\d/.test(w)))
const numeros = (t: string) => (normal(t).match(/\d+/g) ?? []).join(' ')

/**
 * Mantenimiento, no trabajo del jugador: junta los recuerdos vigentes que dicen lo mismo (casi las mismas palabras, o
 * uno contiene al otro), deja el más completo y archiva el resto. Si dos dicen números distintos («cobra 1500» y
 * «cobra 1800») no son repetidos: uno corrige al otro y eso lo decide él. Las correcciones no se tocan.
 */
/** Mismo texto o casi (uno contiene al otro, o comparten casi todas las palabras con contenido). */
function mismos(a: { n: string; p: Set<string> }, b: { n: string; p: Set<string> }, umbral: number): boolean {
  if ((a.n.length > 24 && b.n.includes(a.n)) || (b.n.length > 24 && a.n.includes(b.n))) return true
  // Atajo: si el largo es muy distinto, no pueden llegar al umbral.
  const [m, M] = a.p.size < b.p.size ? [a.p.size, b.p.size] : [b.p.size, a.p.size]
  if (!M || m / M < umbral) return false
  let comun = 0
  for (const w of a.p) if (b.p.has(w)) comun++
  return comun / (a.p.size + b.p.size - comun) >= umbral
}

export function deduplicarMemoria(db: Db, umbral = 0.75, umbralSentido = 0.93): { grupos: number; archivados: number } {
  const vs = (db.prepare(`SELECT * FROM memoria WHERE estado = 'vigente' AND tipo != 'correccion' ORDER BY id`).all() as any[]).map(deFila)
  // Si ya tienen vector (el reproceso), también se juntan los que dicen lo mismo con otras palabras.
  const vecs = vectoresDe(db, 'memoria')
  const datos = vs.map((r) => ({ r, n: normal(r.texto), p: palabras(r.texto), num: numeros(r.texto), v: vecs.get(r.id) }))
  const padre = vs.map((_, i) => i)
  const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])))
  for (let i = 0; i < datos.length; i++) {
    for (let j = i + 1; j < datos.length; j++) {
      const a = datos[i]
      const b = datos[j]
      if (a.num !== b.num) continue
      if (mismos(a, b, umbral) || (a.v && b.v && parecidoA(a.v, b.v) >= umbralSentido)) padre[raiz(j)] = raiz(i)
    }
  }
  const grupos = new Map<number, Recuerdo[]>()
  vs.forEach((r, i) => grupos.set(raiz(i), [...(grupos.get(raiz(i)) ?? []), r]))
  let archivados = 0
  let n = 0
  const arch = db.prepare(`UPDATE memoria SET estado = 'archivada', reemplaza = COALESCE(reemplaza, ?) WHERE id = ?`)
  for (const g of grupos.values()) {
    if (g.length < 2) continue
    n++
    // Queda el que él ya revisó; si no, el más completo; a igualdad, el más nuevo.
    const queda = [...g].sort((a, b) => Number(b.revisada) - Number(a.revisada) || b.texto.length - a.texto.length || b.id - a.id)[0]
    for (const r of g) if (r.id !== queda.id) (arch.run(queda.id, r.id), archivados++)
  }
  return { grupos: n, archivados }
}

export function revisar(db: Db, id: number) {
  const r = leerRecuerdo(db, id)
  if (r && !r.revisada && DE_LA_MAQUINA.has(r.creadaPor)) anotar(db, 'recuerdo', id, 'aceptada')
  db.prepare('UPDATE memoria SET revisada = 1 WHERE id = ?').run(id)
}

export function memoriaVigente(db: Db, f: { tipo?: string; horizonte?: string; limite?: number } = {}): Recuerdo[] {
  const where = [`estado = 'vigente'`]
  const args: (string | number)[] = []
  if (f.tipo) where.push('tipo = ?'), args.push(f.tipo)
  if (f.horizonte) where.push('horizonte = ?'), args.push(f.horizonte)
  return db.prepare(`SELECT * FROM memoria WHERE ${where.join(' AND ')} ORDER BY fecha DESC, id DESC LIMIT ?`).all(...args, f.limite ?? 500).map(deFila)
}

/** La memoria como texto para un prompt: sus correcciones primero, después visión, metas y preferencias; lo más nuevo arriba. */
export function memoriaParaPrompt(db: Db, max = 60, mensaje = '', vec: Float32Array | null = null): string {
  const orden: Record<string, number> = { correccion: 0, vision: 1, meta: 2, preferencia: 3, sueño: 4, hecho: 5 } // lo que él corrigió manda
  const todas = memoriaVigente(db).sort((a, b) => (orden[a.tipo] - orden[b.tipo]) || b.fecha.localeCompare(a.fecha))
  let rs = todas.slice(0, max)
  if (mensaje.trim()) {
    // Con un mensaje: sus correcciones, su visión y sus metas siempre; del resto, lo que tiene que ver con lo que dijo:
    // por sentido si hay vectores (lo que no tiene vector queda en el medio), y las palabras en común desempatan.
    const fijas = todas.filter((r) => r.tipo === 'correccion' || r.tipo === 'vision' || r.tipo === 'meta').slice(0, Math.ceil(max / 2))
    const palabras = new Set(normal(mensaje).split(' ').filter((w) => w.length > 3))
    const vecs = vec ? vectoresDe(db, 'memoria') : null
    const sentido = (id: number) => (vecs?.has(id) ? parecidoA(vec!, vecs.get(id)!) : 0.3)
    const resto = todas.filter((r) => !fijas.includes(r))
      .map((r) => ({ r, p: (vecs?.size ? sentido(r.id) : 0) + 0.05 * normal(r.texto).split(' ').filter((w) => palabras.has(w)).length }))
      .sort((a, b) => b.p - a.p || b.r.fecha.localeCompare(a.r.fecha))
      .slice(0, max - fijas.length).map((x) => x.r)
    rs = [...fijas, ...resto]
  }
  return rs.map((r) => `- (${r.fecha}) [${r.tipo}${r.horizonte ? ` · ${r.horizonte}` : ''}] ${r.texto}`).join('\n')
}

// ─── el escriba ─────────────────────────────────────────────────────────

const ESCRIBA = `Sos el escriba de memoria de Mastropiero. Leés UN mensaje del operador y anotás solo lo que vale recordar de él a largo plazo:
metas, preferencias (cómo le gusta trabajar, hablar, organizarse), hechos de su vida (personas, lugares, proyectos, decisiones), sueños, visión, y correcciones que hace.
Reglas:
- Solo lo que dice el operador sobre sí o su mundo. Nada que venga de terceros citados, de otras IAs ni de lo que vos suponés.
- Nada pasajero (saludos, pedidos puntuales de una tarea, preguntas sueltas, estados de ánimo de un momento).
- Cada recuerdo, una oración corta en tercera persona («Quiere…», «Prefiere…», «Trabaja en…»).
- tipo: hecho | meta | preferencia | sueño | vision | correccion. horizonte (opcional, solo para metas/visión/sueños): castillo (años, estrategia), campamento (semanas o meses), trinchera (días).
- Entre 0 y 3 recuerdos. Si no hay nada que valga, devolvé la lista vacía.
- inventario (0 a 2, opcional): cosas que dice que TIENE. tipo: capital (plata, bienes), conexion (una persona o grupo con nombre), presencia (un sitio, red o canal suyo), conocimiento, herramienta, acceso, recurso. Con «valor» y «unidad» si hay número.
- side_quests (0 a 2, opcional): encargos chicos que surgen sobre la marcha y dependen de estar en un lugar o haciendo algo («cuando pase por…», «si salgo a caminar…, comprarle X a Y»). «disparador»: {lugar, zona, actividad, cuando}, solo lo que se sabe.
- montos (0 a 3, opcional): plata que le ENTRÓ o que GASTÓ, con número concreto («me pagaron 800 del freelance», «gasté 40 en el súper», «pagué el alquiler, 650»). «monto» negativo si salió, positivo si entró; «fecha» YYYY-MM-DD solo si la dice; «dicho»: la frase tal cual. NO: saldos («me quedan 300», eso es inventario), precios que mira, deudas o planes («voy a cobrar»).
Forma: {"recuerdos": [{"texto": string, "tipo": string, "horizonte": string | null}], "inventario": [{"tipo": string, "nombre": string, "detalle": string, "valor": number | null, "unidad": string | null, "url": string | null}], "side_quests": [{"titulo": string, "detalle": string, "disparador": {"lugar": string | null, "zona": string | null, "actividad": string | null, "cuando": string | null}}], "montos": [{"monto": number, "descripcion": string, "moneda": string | null, "fecha": string | null, "dicho": string}]}`

export type FuenteDeMemoria = { texto: string; origen: number | null; pieza: number | null; grabacion: boolean }

/** Los nombres con los que aparece él en chats y grabaciones: su nombre de jugador, el de su entidad y sus alias. */
export function nombresDelOperador(db: Db): string[] {
  const out = new Set<string>()
  try { out.add(personaje(db, 'jugador').nombre) } catch { /* sin jugador todavía */ }
  const id = entidadDelJugador(db)
  if (id) {
    const e = db.prepare('SELECT nombre, alias FROM entidades WHERE id = ?').get(id) as any
    if (e) { out.add(e.nombre); for (const a of e.alias ? JSON.parse(e.alias) : []) out.add(a) }
  }
  return [...out].map((x) => x.trim()).filter((x) => x.length >= 3)
}

const normNombre = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * De un chat importado («[14:05] Ana: hola») o una grabación con voces marcadas («[Lautaro] …», «[Voz B] …»), deja solo
 * las líneas de él. Devuelve null si el texto no tiene ese formato (no es un chat), y '' si es un chat donde él no habla.
 */
export function soloSuVoz(texto: string, nombres: string[]): string | null {
  const lineas = texto.split('\n')
  const marca = /^\[(?:\d{1,2}:\d{2}\]\s*([^:\]]{1,60}):|([^\]]{1,60})\])\s?(.*)$/
  const marcadas = lineas.map((l) => marca.exec(l)).filter(Boolean) as RegExpExecArray[]
  if (marcadas.length < Math.max(2, lineas.filter((l) => l.trim()).length * 0.6)) return null
  const mios = nombres.map(normNombre)
  const esEl = (quien: string) => { const q = normNombre(quien); return !!q && mios.some((n) => n === q || n.split(' ')[0] === q || q.split(' ')[0] === n.split(' ')[0] && q.split(' ')[0].length >= 4) }
  return marcadas.filter((m) => esEl(m[1] ?? m[2] ?? '')).map((m) => m[3]).join('\n').trim()
}

/** Lo suyo que ya está cargado: charlas con Mastropiero y piezas propias (de las más pesadas a las más nuevas). */
export function fuentesParaAprender(db: Db, limite: number): FuenteDeMemoria[] {
  const chats = db.prepare(
    `SELECT m.texto, m.conversacion_id AS origen FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
     WHERE m.rol = 'operador' AND c.con = 'mastropiero' AND length(m.texto) > 40 ORDER BY m.id DESC LIMIT ?`,
  ).all(Math.ceil(limite / 3)) as { texto: string; origen: number }[]
  const propias = db.prepare(
    `SELECT id, contenido AS texto FROM corpus WHERE nivel = 'propia' AND tipo = 'materia' AND length(contenido) > 200
     ORDER BY COALESCE(peso, 0) DESC, COALESCE(fecha, '') DESC LIMIT ?`,
  ).all(limite - chats.length) as { id: number; texto: string }[]
  const nombres = nombresDelOperador(db)
  const deEl: FuenteDeMemoria[] = []
  for (const p of propias) {
    // Un chat o una grabación con voces marcadas: solo lo que dijo él (si no habla, no hay nada que aprender ahí).
    const suyo = soloSuVoz(p.texto, nombres)
    if (suyo !== null) { if (suyo.length > 40) deEl.push({ texto: suyo, origen: null, pieza: p.id, grabacion: false }); continue }
    // Una transcripción sin marcas de quién habla: el escriba la lee con otro cuidado.
    deEl.push({ texto: p.texto, origen: null, pieza: p.id, grabacion: /\[Speaker \d+\]|^\[\d{4}-\d{2}-\d{2}T/m.test(p.texto) })
  }
  return [...chats.map((c) => ({ texto: c.texto, origen: c.origen, pieza: null, grabacion: false })), ...deEl]
}

export type Aprendizaje = { hechos: number; total: number; nuevos: number; terminado: boolean }
let aprendiendo: Aprendizaje | null = null
export const estadoAprendizaje = () => aprendiendo

/** Pasa el escriba por lo ya cargado, de a una (DeepSeek: rápido y con el cupo más grande). Corre en segundo plano; el avance se consulta aparte. */
export async function aprender(db: Db, limite = 40): Promise<Aprendizaje> {
  if (aprendiendo && !aprendiendo.terminado) throw new Error('Ya estoy aprendiendo de lo cargado')
  const fuentes = fuentesParaAprender(db, limite)
  const estado: Aprendizaje = { hechos: 0, total: fuentes.length, nuevos: 0, terminado: false }
  aprendiendo = estado
  // De a cuatro en paralelo: dentro del límite de la key (5 a la vez, 50 por minuto).
  const cola = [...fuentes]
  const obrero = async () => {
    for (let f = cola.shift(); f; f = cola.shift()) {
      // Primero esperar, después sumar: `x += await …` lee x antes del await y pierde lo que sumaron los otros.
      const nuevos = (await escribaDeMemoria(db, f.texto, f.origen, { pieza: f.pieza, grabacion: f.grabacion })).length
      estado.nuevos += nuevos
      estado.hechos++
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, cola.length) }, obrero))
  estado.terminado = true
  return estado
}

const GRABACION = `Grabación transcripta del operador (un audio suyo o un chat). OJO: puede haber OTRAS personas hablando (marcadas [Speaker N] o con su nombre) y errores de transcripción.
Anotá solo lo que es claramente él hablando de sí, de lo que quiere o de cómo trabaja. Lo que dicen otros, lo que se discute en una reunión ajena o lo que no sabés quién dijo: NO lo anotes. Ante la duda, lista vacía. Si un nombre parece mal transcripto, no lo copies.
Texto:`

/** Lee un mensaje del operador y guarda lo que vale recordar. Nunca rompe la conversación si falla. */
export async function escribaDeMemoria(
  db: Db, texto: string, origen: number | null, o: { pieza?: number | null; grabacion?: boolean } = {},
): Promise<Recuerdo[]> {
  if (texto.trim().length < 12) return []
  const conocidos = memoriaParaPrompt(db, 40)
  try {
    const { datos } = await pedirJson<{ recuerdos?: { texto: string; tipo: string; horizonte?: string | null }[]; inventario?: any[]; side_quests?: any[]; montos?: any[] }>(
      { db, clase: 'mastropiero', agenteId: 'escriba' },
      ESCRIBA,
      `${conocidos ? `Lo que ya sabés (no lo repitas):\n${conocidos}\n\n` : ''}${o.grabacion ? GRABACION : 'Mensaje del operador:'}\n${texto.slice(0, 6000)}`,
      { temperatura: 0.2, maxTokens: 1200 },
    )
    const nuevos: Recuerdo[] = []
    for (const r of (datos.recuerdos ?? []).slice(0, 3)) {
      if (typeof r?.texto !== 'string' || !r.texto.trim()) continue
      const antes = (db.prepare('SELECT MAX(id) AS n FROM memoria').get() as { n: number | null }).n ?? 0
      const x = recordar(db, { texto: r.texto, tipo: r.tipo, horizonte: r.horizonte ?? null, origen, piezaId: o.pieza ?? null, creadaPor: 'escriba' })
      if (x.id > antes) {
        nuevos.push(x)
        // Si lo que anota el escriba acierta casi siempre y él lo pasó a «auto», queda revisado solo (deshacible).
        if (haceSolo(db, 'recuerdo')) {
          db.prepare('UPDATE memoria SET revisada = 1 WHERE id = ?').run(x.id)
          anotar(db, 'recuerdo', x.id, 'auto', { cambios: { texto: x.texto }, deshacer: { que: 'recuerdo', id: x.id } })
        }
      }
    }
    // Lo que dice que tiene entra como sugerencia (lo acepta en su ficha); los encargos de pasada, como side quests activas:
    // él las quiere dando vueltas aunque no las anote.
    for (const i of (datos.inventario ?? []).slice(0, 2)) {
      if (typeof i?.nombre !== 'string' || !i.nombre.trim()) continue
      try {
        const it = agregarItem(db, 'jugador', i, { fuente: 'escriba', sugerido: true })
        if (it.estado === 'sugerido' && haceSolo(db, 'inventario')) {
          db.prepare(`UPDATE inventario SET estado = 'vigente' WHERE id = ?`).run(it.id)
          anotar(db, 'inventario', it.id, 'auto', { cambios: { texto: it.nombre }, deshacer: { que: 'inventario', id: it.id } })
        }
      } catch { /* un ítem raro no frena nada */ }
    }
    for (const q of (o.grabacion ? [] : datos.side_quests ?? []).slice(0, 2)) {
      if (typeof q?.titulo !== 'string' || !q.titulo.trim()) continue
      try { anotarSideQuest(db, { titulo: q.titulo, detalle: q.detalle ?? null, disparador: q.disparador ?? null, creadaPor: 'escriba' }) } catch { /* idem */ }
    }
    // Los montos que contó esperan su ok en Finanzas (de una grabación no: puede ser otro el que habla de plata).
    for (const x of (o.grabacion ? [] : datos.montos ?? []).slice(0, 3)) {
      if (typeof x?.monto !== 'number') continue
      try { sugerirMovimiento(db, { monto: x.monto, descripcion: String(x.descripcion ?? ''), moneda: x.moneda ?? null, fecha: x.fecha ?? null, dicho: x.dicho ?? null }) } catch { /* idem */ }
    }
    return nuevos
  } catch {
    return []
  }
}
