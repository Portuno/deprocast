/**
 * El Directo: Mastropiero mira y escucha mientras el jugador trabaja, a demanda (solo cuando lo prende).
 * La pantalla llega en cuadros (el navegador manda uno cada tanto, si cambió algo): la visión anota qué app,
 * qué hace y de qué trata. El audio llega en tramos: su voz (micrófono) y lo que escucha (el audio de la pantalla:
 * videos, música). Al cerrar, un informe para leer y una bandeja de propuestas: tareas, entidades,
 * conexiones, ideas, lo que miró. Nada de eso entra al corpus ni a las misiones hasta que él lo acepta.
 * Los cuadros no se guardan: solo lo que se vio. Lo que dijo en voz alta sí entra, porque es suyo.
 */
import { fechaLocal, json, type Db } from './db.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { anotarConexion, asegurarPorNombre, editarEntidad, TIPOS_ENTIDAD, type TipoEntidad } from './entidades.ts'
import { escribaDeMemoria, memoriaParaPrompt, recordar } from './memoria.ts'
import { pedirJson } from './modelo.ts'
import { nanTranscribir, nanVision } from './nan.ts'
import { anotarSideQuest, actualizarMision, enCurso, leerMision, listarMisiones, principalDe, semanaDe } from './misiones.ts'

export type Momento = {
  id: number; sesionId: number; tipo: 'pantalla' | 'voz' | 'medio' | 'error'; desde: number; hasta: number
  app: string | null; actividad: string | null; tema: string | null; detalle: string | null; nota: string | null; texto: string | null
}
export type Sesion = {
  id: number; inicio: number; fin: number | null; estado: 'activa' | 'cerrada'; fuentes: string[]; informe: string | null
  resumen: Record<string, unknown> | null; piezaId: number | null; ultimo: number | null
}

const deMomento = (r: any): Momento => ({
  id: r.id, sesionId: r.sesion_id, tipo: r.tipo, desde: r.desde, hasta: r.hasta, app: r.app, actividad: r.actividad, tema: r.tema,
  detalle: r.detalle, nota: r.nota, texto: r.texto,
})
const deSesion = (r: any): Sesion => ({
  id: r.id, inicio: r.inicio, fin: r.fin, estado: r.estado, fuentes: json(r.fuentes, []), informe: r.informe, resumen: json(r.resumen, null),
  piezaId: r.pieza_id, ultimo: r.ultimo,
})

export function leerSesion(db: Db, id: number): Sesion | null {
  const r = db.prepare('SELECT * FROM directo_sesiones WHERE id = ?').get(id)
  return r ? deSesion(r) : null
}
export function sesionActiva(db: Db): Sesion | null {
  const r = db.prepare(`SELECT * FROM directo_sesiones WHERE estado = 'activa' ORDER BY id DESC LIMIT 1`).get()
  return r ? deSesion(r) : null
}
export function listarSesiones(db: Db, limite = 20): Sesion[] {
  return db.prepare('SELECT * FROM directo_sesiones ORDER BY id DESC LIMIT ?').all(limite).map(deSesion)
}
export function momentos(db: Db, sesionId: number, f: { tipo?: string; limite?: number } = {}): Momento[] {
  return (f.tipo
    ? db.prepare('SELECT * FROM directo_momentos WHERE sesion_id = ? AND tipo = ? ORDER BY desde, id LIMIT ?').all(sesionId, f.tipo, f.limite ?? 2000)
    : db.prepare('SELECT * FROM directo_momentos WHERE sesion_id = ? ORDER BY desde, id LIMIT ?').all(sesionId, f.limite ?? 2000)).map(deMomento)
}

/** Prende el Directo (si ya hay uno prendido, sigue ese). */
export function iniciarDirecto(db: Db, fuentes: string[], ahora = Date.now()): Sesion {
  const ya = sesionActiva(db)
  if (ya) return ya
  const r = db.prepare(`INSERT INTO directo_sesiones (inicio, estado, fuentes, ultimo) VALUES (?, 'activa', ?, ?)`).run(ahora, JSON.stringify(fuentes), ahora)
  return leerSesion(db, Number(r.lastInsertRowid))!
}

function sesionViva(db: Db, id: number): Sesion {
  const s = leerSesion(db, id)
  if (!s) throw new Error(`No existe la sesión ${id}`)
  if (s.estado !== 'activa') throw new Error('Ese Directo ya se cerró')
  return s
}

// ─── pantalla ───────────────────────────────────────────────────────────

const VISTA = `Sos los ojos de Mastropiero. Te llega una captura de la pantalla del jugador. Anotá qué está haciendo, en JSON:
- app: el programa o sitio (VS Code, YouTube, Instagram, Google Docs, WhatsApp Web, Spotify…).
- actividad: trabajando | escribiendo | programando | leyendo | mirando video | escuchando música | chateando | navegando | jugando | reunion | otra.
- tema: de qué se trata, en pocas palabras (el proyecto, el asunto).
- detalle: lo concreto e identificable: título del video o canción, nombre del documento, página, con quién chatea, qué archivo.
- nota: una oración con lo que vale recordar (una idea, un dato, una decisión visible). Vacía si no hay nada.
Sé preciso y breve; no inventes lo que no se lee. Castellano rioplatense.
Forma: {"app": string, "actividad": string, "tema": string, "detalle": string, "nota": string}`

let vision = async (db: Db, imagen: string) => {
  const r = await nanVision({ db, clase: 'mastropiero', agenteId: 'directo' }, { sistema: VISTA, texto: 'Qué hay en esta pantalla:', imagen, maxTokens: 500 })
  const j = r.texto.match(/\{[\s\S]*\}/)?.[0]
  return j ? JSON.parse(j) : {}
}
let transcribir = (db: Db, audio: Buffer, nombre: string) => nanTranscribir(db, audio, nombre)
export function _probarDirecto(o: { vision?: typeof vision; transcribir?: typeof transcribir }) {
  if (o.vision) vision = o.vision
  if (o.transcribir) transcribir = o.transcribir
}

const corto = (v: unknown, n = 160) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
const norm = (s: string | null) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** Un cuadro de pantalla: lo que se ve se anota; si sigue en lo mismo que el anterior, se estira ese momento. */
export async function registrarCuadro(db: Db, id: number, imagen: Buffer, mime = 'image/jpeg', ahora = Date.now()): Promise<Momento> {
  sesionViva(db, id)
  db.prepare('UPDATE directo_sesiones SET ultimo = ? WHERE id = ?').run(ahora, id)
  const v = await vision(db, `data:${mime};base64,${imagen.toString('base64')}`)
  const m = { app: corto(v.app, 60), actividad: corto(v.actividad, 40), tema: corto(v.tema, 120), detalle: corto(v.detalle, 200), nota: corto(v.nota, 300) }
  const ultimo = db.prepare(`SELECT * FROM directo_momentos WHERE sesion_id = ? AND tipo = 'pantalla' ORDER BY id DESC LIMIT 1`).get(id) as any
  if (ultimo && norm(ultimo.app) === norm(m.app) && norm(ultimo.detalle) === norm(m.detalle) && ahora - ultimo.hasta < 10 * 60_000) {
    const nota = [ultimo.nota, m.nota].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' ').slice(0, 600) || null
    db.prepare('UPDATE directo_momentos SET hasta = ?, nota = ? WHERE id = ?').run(ahora, nota, ultimo.id)
    return deMomento(db.prepare('SELECT * FROM directo_momentos WHERE id = ?').get(ultimo.id))
  }
  const r = db.prepare(`INSERT INTO directo_momentos (sesion_id, tipo, desde, hasta, app, actividad, tema, detalle, nota) VALUES (?, 'pantalla', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ahora, ahora, m.app, m.actividad, m.tema, m.detalle, m.nota)
  return deMomento(db.prepare('SELECT * FROM directo_momentos WHERE id = ?').get(Number(r.lastInsertRowid)))
}

// ─── audio ──────────────────────────────────────────────────────────────

/** Lo que Whisper «oye» en el silencio o en la música (sus alucinaciones típicas en castellano). */
const ALUCINACIONES = [/amara\.org/i, /^¡?gracias por ver(lo| el video)?!?\.?$/i, /^suscr[ií]bete/i, /^\[?m[uú]sica\]?\.?$/i, /^\.+$/, /^subt[ií]tulos/i, /^¡?gracias\.?!?$/i]

export function esRuido(texto: string): boolean {
  const t = texto.trim()
  return t.length < 4 || ALUCINACIONES.some((r) => r.test(t))
}

/** Un tramo de audio: su voz (micrófono) o lo que escucha (audio de la pantalla). */
export async function registrarAudio(db: Db, id: number, audio: Buffer, tipo: 'voz' | 'medio', nombre = 'tramo.webm', o: { desde?: number; ahora?: number } = {}): Promise<Momento | null> {
  sesionViva(db, id)
  const ahora = o.ahora ?? Date.now()
  db.prepare('UPDATE directo_sesiones SET ultimo = ? WHERE id = ?').run(ahora, id)
  if (audio.length < 2000) return null
  const texto = (await transcribir(db, audio, nombre)).trim()
  if (!texto || esRuido(texto)) return null
  // Lo que escucha se ata a lo que se ve en ese momento (el video o la canción en pantalla).
  const visto = tipo === 'medio'
    ? db.prepare(`SELECT app, detalle, tema FROM directo_momentos WHERE sesion_id = ? AND tipo = 'pantalla' ORDER BY id DESC LIMIT 1`).get(id) as any
    : null
  const r = db.prepare(`INSERT INTO directo_momentos (sesion_id, tipo, desde, hasta, app, detalle, tema, texto) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, tipo, o.desde ?? ahora - 60_000, ahora, visto?.app ?? null, visto?.detalle ?? null, visto?.tema ?? null, texto.slice(0, 8000))
  return deMomento(db.prepare('SELECT * FROM directo_momentos WHERE id = ?').get(Number(r.lastInsertRowid)))
}

// ─── el informe ─────────────────────────────────────────────────────────

const fmtMin = (ms: number) => `${Math.max(1, Math.round(ms / 60000))} min`

/** Los números sin modelo: minutos por actividad y por app, cuánto habló, qué consumió. */
export function metricas(ms: Momento[]) {
  const pantalla = ms.filter((m) => m.tipo === 'pantalla')
  // Cada momento de pantalla dura hasta el siguiente (o su último cuadro + medio intervalo).
  const dur = pantalla.map((m, i) => Math.max(30_000, (pantalla[i + 1]?.desde ?? m.hasta + 30_000) - m.desde))
  const suma = (clave: 'actividad' | 'app') => {
    const t: Record<string, number> = {}
    pantalla.forEach((m, i) => { const k = m[clave] ?? 'otra'; t[k] = (t[k] ?? 0) + dur[i] })
    return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v / 60000)]))
  }
  const medio = new Map<string, { titulo: string; app: string | null; textos: string[] }>()
  for (const m of ms.filter((x) => x.tipo === 'medio')) {
    const k = m.detalle ?? m.app ?? 'sin título'
    const e = medio.get(k) ?? { titulo: k, app: m.app, textos: [] }
    e.textos.push(m.texto ?? '')
    medio.set(k, e)
  }
  return {
    minutosPorActividad: suma('actividad'), minutosPorApp: suma('app'),
    tramosDeVoz: ms.filter((m) => m.tipo === 'voz').length, consumido: [...medio.values()],
  }
}

const SISTEMA_INFORME = `Sos Mastropiero y cerrás un Directo: lo que viste y escuchaste mientras el jugador trabajaba.
- «texto»: dos o tres párrafos cortos, separados por una línea en blanco. Castellano rioplatense, con ritmo de charla: qué hizo, adónde se le fue el foco, y si eso empujó sus misiones o fue paseo. Sin listas y sin repetir tareas, nombres ni títulos: eso va en los otros campos.
- «ideas»: frases suyas que valen recordar, cortas, con sus palabras.
- «tareas»: encargos nuevos que dijo («tengo que…», «después llamo a…»), cortos y en infinitivo. No repitas side quests que ya tiene abiertas.
- «cumplidas»: ids (números de la lista) de side quests que en este Directo quedaron hechas. Solo con evidencia. Si no, [].
- «bandas»: ids de bandas de la run que parecen hechas. Solo con evidencia. Si no, [].
- «entidades»: personas, proyectos, lugares o conceptos suyos que aparecieron y NO están en la lista de conocidas. No anotes apps ni sitios genéricos (Chrome, Instagram, Gmail, YouTube, X, VS Code). tipo: persona | proyecto | agrupacion | dominio | lugar | concepto. alias solo si dijo que son el mismo.
- «conexiones»: un vínculo concreto entre dos nombres (se conocen, trabajan juntos, uno le debe algo al otro). {de, con, relacion, tipoDe, tipoCon}. tipoDe y tipoCon con los mismos tipos. Vacío si no hay vínculo dicho o visible.
- «consumido»: cada video, canción o lectura identificable: {titulo, tipo, resumen, relacion (con qué proyecto o meta conecta, o null)}.
- No inventes: solo lo que está en los momentos.
Forma: {"texto": string, "ideas": [string], "tareas": [string], "cumplidas": [number], "bandas": [number], "entidades": [{"nombre": string, "tipo": string, "nota": string, "alias": [string]}], "conexiones": [{"de": string, "con": string, "relacion": string, "tipoDe": string, "tipoCon": string}], "consumido": [{"titulo": string, "tipo": string, "resumen": string, "relacion": string | null}]}`

export type TipoPropuesta = 'tarea' | 'cumplida' | 'banda' | 'entidad' | 'conexion' | 'idea' | 'medio'
export type Propuesta = {
  id: string
  tipo: TipoPropuesta
  estado: 'pendiente' | 'aceptada' | 'rechazada'
  titulo: string
  detalle: string | null
  misionId: number | null
  tipoEntidad: string | null
  tipoCon: string | null
  alias: string[]
  de: string | null
  con: string | null
  oido: string | null
}

const TIPOS_PROP = new Set<TipoPropuesta>(['tarea', 'cumplida', 'banda', 'entidad', 'conexion', 'idea', 'medio'])

export function propuestasDe(s: { resumen: Record<string, unknown> | null }): Propuesta[] {
  const xs = s.resumen?.propuestas
  if (!Array.isArray(xs)) return []
  return xs.filter((x): x is Propuesta => !!x && typeof x === 'object' && typeof (x as Propuesta).id === 'string' && TIPOS_PROP.has((x as Propuesta).tipo))
}

export function propuestasPendientes(db: Db): number {
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM directo_sesiones s, json_each(json_extract(s.resumen, '$.propuestas')) j WHERE json_extract(j.value, '$.estado') = 'pendiente'`,
  ).get() as { n: number }).n
}

/** Lo que Mastropiero deja en el chat al cerrar: un aviso, no el informe entero. */
export function avisoDeCierre(s: Sesion): string {
  const n = propuestasDe(s).filter((p) => p.estado === 'pendiente').length
  const desde = new Date(s.inicio).toTimeString().slice(0, 5)
  const hasta = s.fin ? new Date(s.fin).toTimeString().slice(0, 5) : ''
  const cuando = hasta ? `${desde}–${hasta}` : desde
  return n
    ? `Cerré el Directo (${cuando}). Hay ${n} ${n === 1 ? 'cosa' : 'cosas'} para aceptar o descartar en Directo. No las metí al corpus.`
    : `Cerré el Directo (${cuando}). No quedó nada nuevo para anotar.`
}

const tipoEnt = (v: unknown): TipoEntidad => {
  const t = String(v ?? '').toLowerCase().trim()
  return (TIPOS_ENTIDAD as readonly string[]).includes(t) ? t as TipoEntidad : 'concepto'
}
const frases = (v: unknown, n = 8): string[] => {
  const out: string[] = []
  for (const x of Array.isArray(v) ? v : []) {
    const s = typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as any).titulo === 'string' ? (x as any).titulo : x && typeof x === 'object' && typeof (x as any).texto === 'string' ? (x as any).texto : ''
    const t = String(s).trim().replace(/\s+/g, ' ').slice(0, 200)
    if (t && !out.some((y) => norm(y) === norm(t))) out.push(t)
    if (out.length >= n) break
  }
  return out
}
const idsDe = (v: unknown, validos: Map<number, string>): number[] => {
  const out: number[] = []
  for (const x of Array.isArray(v) ? v : []) {
    const n = typeof x === 'number' ? x : x && typeof x === 'object' ? Number((x as any).id) : Number(x)
    if (validos.has(n) && !out.includes(n)) out.push(n)
  }
  return out
}
const pareceIgual = (a: string, b: string) => {
  const x = norm(a), y = norm(b)
  return !!x && (x === y || (x.length > 12 && y.includes(x)) || (y.length > 12 && x.includes(y)))
}
const GENERICO = new Set(['instagram', 'chrome', 'gmail', 'youtube', 'google', 'twitter', 'vs code', 'vscode', 'cursor', 'vivaldi', 'firefox', 'whatsapp', 'spotify', 'telegram'])

function armarPropuestas(db: Db, informe: Record<string, unknown>, met: ReturnType<typeof metricas>, abiertas: Map<number, string>, bandas: Map<number, string>): Propuesta[] {
  const conocidas = new Set<string>()
  for (const r of db.prepare('SELECT nombre, alias FROM entidades').all() as { nombre: string; alias: string | null }[]) {
    conocidas.add(norm(r.nombre))
    for (const a of json<string[]>(r.alias, [])) conocidas.add(norm(a))
  }
  const titulosAbiertos = [...abiertas.values()]
  const ps: Propuesta[] = []
  const alta = (p: Propuesta) => { ps.push(p) }
  let i = 0
  const id = () => `p${++i}`
  const base = (tipo: TipoPropuesta, titulo: string): Propuesta => ({
    id: id(), tipo, estado: 'pendiente', titulo, detalle: null, misionId: null, tipoEntidad: null, tipoCon: null, alias: [], de: null, con: null, oido: null,
  })
  for (const mid of idsDe(informe.cumplidas, abiertas)) {
    const p = base('cumplida', abiertas.get(mid)!)
    p.misionId = mid
    alta(p)
  }
  for (const mid of idsDe(informe.bandas, bandas)) {
    const p = base('banda', bandas.get(mid)!)
    p.misionId = mid
    alta(p)
  }
  for (const t of frases(informe.tareas)) {
    if (titulosAbiertos.some((a) => pareceIgual(a, t))) continue
    alta(base('tarea', t))
  }
  for (const e of (Array.isArray(informe.entidades) ? informe.entidades : []).slice(0, 8)) {
    if (!e || typeof e !== 'object') continue
    const nombre = String((e as any).nombre ?? '').trim().slice(0, 80)
    if (nombre.length < 2 || conocidas.has(norm(nombre)) || GENERICO.has(norm(nombre))) continue
    const p = base('entidad', nombre)
    p.tipoEntidad = tipoEnt((e as any).tipo || 'persona')
    p.detalle = String((e as any).nota ?? '').trim().slice(0, 240) || null
    p.alias = frases((e as any).alias, 6).filter((a) => norm(a) !== norm(nombre) && !conocidas.has(norm(a)))
    conocidas.add(norm(nombre))
    alta(p)
  }
  const pares = new Set<string>()
  for (const c of (Array.isArray(informe.conexiones) ? informe.conexiones : []).slice(0, 6)) {
    if (!c || typeof c !== 'object') continue
    const de = String((c as any).de ?? '').trim().slice(0, 80)
    const con = String((c as any).con ?? '').trim().slice(0, 80)
    const relacion = String((c as any).relacion ?? '').trim().slice(0, 160)
    if (de.length < 2 || con.length < 2 || norm(de) === norm(con) || GENERICO.has(norm(de)) || GENERICO.has(norm(con))) continue
    const clave = `${norm(de)}|${norm(con)}|${norm(relacion)}`
    if (pares.has(clave)) continue
    pares.add(clave)
    const p = base('conexion', `${de} ↔ ${con}`)
    p.de = de
    p.con = con
    p.detalle = relacion || null
    p.tipoEntidad = tipoEnt((c as any).tipoDe || 'persona')
    p.tipoCon = tipoEnt((c as any).tipoCon || 'persona')
    alta(p)
  }
  for (const idea of frases(informe.ideas, 6)) alta(base('idea', idea))
  for (const c of (Array.isArray(informe.consumido) ? informe.consumido : []).slice(0, 8)) {
    if (!c || typeof c !== 'object') continue
    const titulo = String((c as any).titulo ?? '').trim().slice(0, 160)
    if (titulo.length < 2) continue
    const oido = met.consumido.find((x) => norm(x.titulo).includes(norm(titulo).slice(0, 20)))
    const p = base('medio', titulo)
    p.tipoEntidad = String((c as any).tipo ?? 'Medio').trim().slice(0, 40) || 'Medio'
    const resumen = String((c as any).resumen ?? '').trim().slice(0, 400)
    const relacion = String((c as any).relacion ?? '').trim().slice(0, 160)
    p.detalle = [resumen, relacion ? `Conecta con: ${relacion}` : ''].filter(Boolean).join('\n') || null
    p.oido = oido?.textos.length ? oido.textos.join('\n').slice(0, 1200) : null
    alta(p)
  }
  return ps
}

function aplicarPropuesta(db: Db, p: Propuesta, s: Sesion, ahora: number) {
  const fecha = fechaLocal(s.inicio)
  if (p.tipo === 'tarea') {
    anotarSideQuest(db, { titulo: p.titulo, detalle: `Lo dijiste en el Directo del ${fecha}.`, creadaPor: 'directo' }, ahora)
    return
  }
  if (p.tipo === 'cumplida' || p.tipo === 'banda') {
    const m = p.misionId ? leerMision(db, p.misionId) : null
    if (m && (m.estado === 'activa' || m.estado === 'sugerida')) actualizarMision(db, m.id, { estado: 'hecha' }, { por: 'operador', ahora })
    return
  }
  if (p.tipo === 'entidad') {
    const id = asegurarPorNombre(db, p.titulo, tipoEnt(p.tipoEntidad), ahora)
    if (p.alias.length) editarEntidad(db, id, { sumarAlias: p.alias })
    if (p.detalle) {
      const notas = (db.prepare('SELECT notas FROM entidades WHERE id = ?').get(id) as { notas: string | null }).notas
      if (!notas?.trim()) editarEntidad(db, id, { notas: p.detalle })
    }
    return
  }
  if (p.tipo === 'conexion' && p.de && p.con) {
    const a = asegurarPorNombre(db, p.de, tipoEnt(p.tipoEntidad), ahora)
    const b = asegurarPorNombre(db, p.con, tipoEnt(p.tipoCon), ahora)
    if (a !== b) anotarConexion(db, { a, b, relacion: p.detalle, origen: `directo:${s.id}`, nota: `Directo del ${fecha}` }, ahora)
    return
  }
  if (p.tipo === 'idea') {
    recordar(db, { texto: p.titulo, tipo: 'hecho', creadaPor: 'directo', revisada: true }, ahora)
    return
  }
  if (p.tipo === 'medio') {
    asegurarFuente(db, { id: 'directo', nombre: 'Directo', nivel: 'primaria', descripcion: 'Lo que vio, escuchó y leyó con el Directo prendido, y él aceptó guardar.' })
    insertar(db, {
      fuente: 'directo', nivel: 'primaria', titulo: `${p.tipoEntidad ?? 'Medio'} · ${p.titulo}`.slice(0, 200),
      contenido: [p.detalle, p.oido ? `Lo que se escuchó:\n${p.oido}` : ''].filter(Boolean).join('\n\n'),
      estado: 'disponible', etiquetas: ['directo', 'consumido'], fecha: new Date(s.inicio).toISOString(),
      origenId: `directo:${s.id}:${p.id}`, meta: { sesion: s.id },
    }, ahora)
  }
}

/** Aceptar guarda (side quest, entidad, conexión, memoria, corpus). Rechazar no guarda nada. */
export function resolverPropuestas(db: Db, sesionId: number, ids: string[], accion: 'aceptar' | 'rechazar', ahora = Date.now()): { propuestas: Propuesta[]; sesion: Sesion } {
  const s = leerSesion(db, sesionId)
  if (!s) throw new Error(`No existe la sesión ${sesionId}`)
  if (accion !== 'aceptar' && accion !== 'rechazar') throw new Error('Acción inválida')
  const propuestas = propuestasDe(s)
  const pedidos = new Set(ids)
  const tocadas: Propuesta[] = []
  db.exec('BEGIN')
  try {
    for (const p of propuestas) {
      if (!pedidos.has(p.id) || p.estado !== 'pendiente') continue
      if (accion === 'aceptar') aplicarPropuesta(db, p, s, ahora)
      p.estado = accion === 'aceptar' ? 'aceptada' : 'rechazada'
      tocadas.push(p)
    }
    db.prepare('UPDATE directo_sesiones SET resumen = ? WHERE id = ?').run(JSON.stringify({ ...(s.resumen ?? {}), propuestas }), sesionId)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return { propuestas: tocadas, sesion: leerSesion(db, sesionId)! }
}

/** Cierra el Directo. El informe queda para leer; las propuestas esperan que él las acepte. */
export async function cerrarDirecto(db: Db, id: number, o: { ahora?: number; conModelo?: boolean; escriba?: boolean } = {}): Promise<Sesion> {
  const ahora = o.ahora ?? Date.now()
  const s = leerSesion(db, id)
  if (!s) throw new Error(`No existe la sesión ${id}`)
  if (s.estado === 'cerrada') return s
  db.prepare(`UPDATE directo_sesiones SET estado = 'cerrada', fin = ? WHERE id = ?`).run(ahora, id)
  const ms = momentos(db, id)
  const met = metricas(ms)
  const duracion = fmtMin(ahora - s.inicio)
  const fecha = fechaLocal(s.inicio)
  const hora = (t: number) => new Date(t).toTimeString().slice(0, 5)
  if (!ms.length) {
    db.prepare('UPDATE directo_sesiones SET informe = ?, resumen = ? WHERE id = ?').run(`Directo de ${duracion} sin nada registrado.`, JSON.stringify(met), id)
    return leerSesion(db, id)!
  }
  // Su voz: es suya, entra como propia y pasa por el escriba.
  const voz = ms.filter((m) => m.tipo === 'voz').map((m) => `[${hora(m.desde)}] ${m.texto}`).join('\n')
  if (voz) {
    insertar(db, { fuente: 'operador', nivel: 'propia', titulo: `Directo · ${fecha} · lo que dijo`, contenido: voz, estado: 'disponible', etiquetas: ['directo', 'voz'], fecha: new Date(s.inicio).toISOString() }, ahora)
    if (o.escriba !== false) void escribaDeMemoria(db, voz, null, { grabacion: true }).catch(() => {})
  }
  return escribirInforme(db, s, ms, ahora, o)
}

/** El informe y la bandeja de propuestas de un Directo ya cerrado (al cerrar, o de nuevo si la primera vez falló). */
async function escribirInforme(db: Db, s: Sesion, ms: Momento[], ahora: number, o: { conModelo?: boolean } = {}): Promise<Sesion> {
  const id = s.id
  const met = metricas(ms)
  const duracion = fmtMin(ahora - s.inicio)
  const fecha = fechaLocal(s.inicio)
  const hora = (t: number) => new Date(t).toTimeString().slice(0, 5)
  const run = enCurso(db, ahora)?.run
  const abiertas = new Map(listarMisiones(db, { personaje: 'jugador', nivel: 'terciaria', estados: ['activa'], limite: 40 }).map((m) => [m.id, m.titulo]))
  const bandas = new Map((run ? listarMisiones(db, { runId: run.id, nivel: 'secundaria', estados: ['activa'] }) : []).map((m) => [m.id, m.titulo]))
  const conocidas = (db.prepare('SELECT nombre FROM entidades ORDER BY id DESC LIMIT 40').all() as { nombre: string }[]).map((r) => r.nombre)
  let informe: Record<string, unknown> = {}
  if (o.conModelo !== false) {
    const lineas = ms.map((m) => m.tipo === 'pantalla'
      ? `[${hora(m.desde)}–${hora(m.hasta)}] PANTALLA ${m.app ?? '?'} · ${m.actividad ?? ''} · ${m.tema ?? ''} · ${m.detalle ?? ''}${m.nota ? ` — ${m.nota}` : ''}`
      : `[${hora(m.desde)}] ${m.tipo === 'voz' ? 'DIJO' : `ESCUCHÓ (${m.detalle ?? m.app ?? '?'})`}: ${(m.texto ?? '').slice(0, 1200)}`).join('\n')
    const primarias = listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] }).map((m) => m.titulo)
    const lista = (xs: Map<number, string>) => [...xs].map(([i, t]) => `- ${i} · ${t}`).join('\n')
    try {
      informe = (await pedirJson<Record<string, unknown>>({ db, clase: 'mastropiero', agenteId: 'directo' }, SISTEMA_INFORME, [
        `Directo del ${fecha}, ${hora(s.inicio)}–${hora(ahora)} (${duracion}).`,
        `Minutos por actividad: ${JSON.stringify(met.minutosPorActividad)}. Por app: ${JSON.stringify(met.minutosPorApp)}.`,
        principalDe(db, 'jugador') ? `Su misión principal: ${principalDe(db, 'jugador')!.titulo}` : '',
        primarias.length ? `Sus primarias de la semana: ${primarias.join(' · ')}` : '',
        abiertas.size ? `Side quests abiertas (el número es el id):\n${lista(abiertas)}` : '',
        bandas.size ? `Bandas de su run en curso (el número es el id):\n${lista(bandas)}` : '',
        conocidas.length ? `Entidades que ya existen (no las repitas): ${conocidas.join(', ')}` : '',
        `Lo que sabés de él:\n${memoriaParaPrompt(db, 30)}`,
        `Momentos:\n${lineas.slice(0, 60000)}`,
      ].filter(Boolean).join('\n'), { temperatura: 0.4, maxTokens: 5000 })).datos ?? {}
    } catch (e) {
      informe = { texto: `No pude escribir el informe: ${e instanceof Error ? e.message : e}` }
    }
  }
  const actividades = Object.entries(met.minutosPorActividad).map(([k, v]) => `${k} ${v} min`).join(', ')
  const texto = (typeof informe.texto === 'string' && informe.texto.trim() ? informe.texto.trim() : `Directo de ${duracion}: ${actividades || 'sin pantalla'}.`).slice(0, 4000)
  const propuestas = armarPropuestas(db, informe, met, abiertas, bandas)
  const { consumido: _oido, ...numeros } = met
  db.prepare('UPDATE directo_sesiones SET informe = ?, resumen = ? WHERE id = ?').run(texto, JSON.stringify({ ...numeros, propuestas }), id)
  return leerSesion(db, id)!
}

export const informeFallido = (s: Pick<Sesion, 'informe'>) => /^No pude escribir el informe/.test(s.informe ?? '')

/** Vuelve a escribir el informe de un Directo cerrado cuya primera vez falló (sin volver a guardar su voz en el corpus). */
export async function rehacerInforme(db: Db, id: number): Promise<Sesion> {
  const s = leerSesion(db, id)
  if (!s) throw new Error(`No existe la sesión ${id}`)
  if (s.estado !== 'cerrada') throw new Error('El Directo sigue prendido')
  const ms = momentos(db, id)
  if (!ms.length) throw new Error('Ese Directo no tiene nada registrado')
  const r = await escribirInforme(db, s, ms, s.fin ?? Date.now())
  if (informeFallido(r)) throw new Error(r.informe!.replace(/^No pude escribir el informe: /, 'Tampoco esta vez: '))
  return r
}

/** Si el navegador se cerró sin apagar el Directo, a los 10 minutos sin nada se cierra solo. */
export async function latidoDirecto(db: Db, ahora = Date.now()): Promise<Sesion | null> {
  const s = sesionActiva(db)
  if (!s || ahora - (s.ultimo ?? s.inicio) < 10 * 60_000) return null
  return cerrarDirecto(db, s.id, { ahora })
}

/** Para el prompt de Mastropiero: qué está haciendo ahora, si el Directo está prendido. */
export function directoParaPrompt(db: Db): string {
  const s = sesionActiva(db)
  if (!s) return ''
  const ultimos = momentos(db, s.id).slice(-6)
  const pantalla = ultimos.filter((m) => m.tipo === 'pantalla').at(-1)
  const dijo = ultimos.filter((m) => m.tipo === 'voz').at(-1)
  return [
    `El Directo está prendido desde las ${new Date(s.inicio).toTimeString().slice(0, 5)}: ves su pantalla y escuchás.`,
    pantalla ? `En pantalla ahora: ${[pantalla.app, pantalla.actividad, pantalla.detalle].filter(Boolean).join(' · ')}.` : '',
    dijo ? `Lo último que dijo en voz alta: «${(dijo.texto ?? '').slice(0, 300)}».` : '',
  ].filter(Boolean).join(' ')
}
