/**
 * La Academia (plan v23): cada dominio que quiere aprender tiene un tutor de seis niveles, del niño de 10 a la frontera
 * del conocimiento. Una sesión se prepara de antemano (explicación, ejemplos, preguntas, las ideas y tarjetas que deja y
 * el visual que le sirve al concepto); al cerrarla queda su pieza en el corpus, uno o dos quántomos proto (los toma La
 * Mano), tarjetas SM-2 en el mazo del dominio y la práctica anotada. Para subir de nivel hay un examen: se habilita con
 * dos clases seguidas bien resueltas y nunca sube solo. Idiomas sigue con su propio tutor (es un dominio especial).
 */
import { fechaLocal, json, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { asegurarFuente, buscar, insertar } from './corpus.ts'
import { crearQuantomo } from './quantomos.ts'
import { crearTarjeta, paraRepasar } from './tarjetas.ts'
import { crearAprendizaje, leerAprendizaje, listarAprendizajes, recursosDe, registrarPractica, type Aprendizaje } from './aprender.ts'
import { enLaNube } from './reproceso.ts'
import { pedirVisual } from './taller-cola.ts'
import { leerArtefacto } from './taller.ts'

export const NIVELES_TUTOR = [
  { n: 1, nombre: 'Niño de 10', regla: 'Explicá como a un chico curioso de 10 años: imágenes de la vida diaria, cero jerga (si aparece una palabra técnica, la explicás con algo que conoce), oraciones cortas. Las preguntas se responden con una idea, no con una definición.' },
  { n: 2, nombre: 'Instituto', regla: 'Nivel secundario: las ideas centrales con su vocabulario básico bien definido, un ejemplo concreto por idea y la intuición de por qué funciona. Preguntas de comprensión y de aplicar a un caso simple.' },
  { n: 3, nombre: 'Universitario', regla: 'Nivel universitario: definiciones precisas, el modelo o la fórmula detrás, supuestos y límites, y cómo se conecta con lo que ya vio. Preguntas que piden razonar, no recordar.' },
  { n: 4, nombre: 'Aplicado', regla: 'Nivel aplicado: cómo se usa en la práctica (herramientas, procedimientos, números reales, errores típicos y cómo detectarlos). Preguntas de casos: qué harías, qué falla, qué medís.' },
  { n: 5, nombre: 'Experto', regla: 'Nivel experto: matices, compromisos de diseño, casos límite, debates abiertos dentro del campo y referencias canónicas. Preguntas que piden criterio y justificar una decisión.' },
  { n: 6, nombre: 'Frontera', regla: 'La frontera: lo que todavía no está resuelto, lo más nuevo de sus fuentes, y los puentes con sus otros dominios y proyectos (lo que nadie conecta). Preguntas abiertas que piden una hipótesis propia y cómo la probaría.' },
] as const
export const nombreNivel = (n: number) => NIVELES_TUTOR[Math.max(1, Math.min(6, n)) - 1].nombre

export const VISUALES = ['diagrama', 'simulacion', 'movimiento', 'ninguno'] as const
export type Visual = { tipo: (typeof VISUALES)[number]; pedido: string; degradado?: string | null } | null
export type Pregunta = { pregunta: string; clave: string }
export type Paquete = { tema: string; explicacion: string; ejemplos: string[]; preguntas: Pregunta[]; ideas: string[]; tarjetas: { frente: string; dorso: string }[]; visual: Visual }
export type SesionTutor = {
  id: number; aprendizajeId: number; nivel: number; tipo: 'clase' | 'examen'; tema: string; paquete: Paquete; estado: 'lista' | 'en_curso' | 'hecha'
  puntaje: number | null; piezaId: number | null; visualId: number | null; creadaEn: number; empezadaEn: number | null; cerradaEn: number | null
}
export type Dominio = Aprendizaje & { tutorNivel: number; temario: Record<string, string[]>; temaIdx: number; sugerencia: Record<string, unknown> | null; fuentesEn: number | null }

const FUENTE = { id: 'academia', nombre: 'La Academia', nivel: 'propia' as const, descripcion: 'Las clases y exámenes de su Academia: lo explicado, lo que respondió y la devolución.' }
const mazoDe = (id: number) => `aprender:${id}`
const txt = (x: unknown, n = 400) => String(x ?? '').trim().slice(0, n)

// ─── lo que se prueba sin modelo ─────────────────────────────────────────

let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'academia' }, sistema, usuario, { temperatura: 0.5, maxTokens: 4000 })).datos
let nube = () => enLaNube()
/**
 * Cuando una sesión pide un visual, va a la cola del Taller (sin esperarlo): si ya existe sale de la caché; si no se
 * puede (cola llena, tope, sin modelo), la sesión queda solo con texto y lo dice.
 */
let alPedirVisual = (db: Db, s: SesionTutor, prioridad: number): void => {
  const v = s.paquete?.visual
  if (!v) return
  const d = leerDominio(db, s.aprendizajeId)
  const r = pedirVisual(db, { clase: v.tipo, pedido: v.pedido, concepto: s.tema, nivel: s.nivel, dominio: d?.tema ?? null, dominioId: s.aprendizajeId, origen: `tutor:${s.id}`, prioridad })
  if (r.artefactoId) db.prepare('UPDATE tutor_sesiones SET visual_id = ? WHERE id = ?').run(r.artefactoId, s.id)
  else db.prepare('UPDATE tutor_sesiones SET paquete = ? WHERE id = ?').run(JSON.stringify({ ...s.paquete, visual: { ...v, degradado: r.degradado } }), s.id)
}
export function _probarAcademia(o: { modelo?: typeof modelo; nube?: () => boolean; alPedirVisual?: typeof alPedirVisual }) {
  if (o.modelo) modelo = o.modelo
  if (o.nube) nube = o.nube
  if (o.alPedirVisual) alPedirVisual = o.alPedirVisual
}

// ─── leer ───────────────────────────────────────────────────────────────

export function leerDominio(db: Db, id: number): Dominio | null {
  const a = leerAprendizaje(db, id)
  if (!a) return null
  const r = db.prepare('SELECT tutor_nivel, temario, tema_idx, sugerencia, fuentes_en FROM aprendizajes WHERE id = ?').get(id) as any
  return { ...a, tutorNivel: r.tutor_nivel ?? 1, temario: json<Record<string, string[]>>(r.temario, {}) ?? {}, temaIdx: r.tema_idx ?? 0, sugerencia: json(r.sugerencia, null), fuentesEn: r.fuentes_en ?? null }
}

const deSesion = (r: any): SesionTutor => ({
  id: r.id, aprendizajeId: r.aprendizaje_id, nivel: r.nivel, tipo: r.tipo, tema: r.tema, paquete: json<Paquete>(r.paquete, null as any), estado: r.estado,
  puntaje: r.puntaje, piezaId: r.pieza_id, visualId: r.visual_id, creadaEn: r.creada_en, empezadaEn: r.empezada_en, cerradaEn: r.cerrada_en,
})
export function leerSesionTutor(db: Db, sid: number): SesionTutor | null {
  const r = db.prepare('SELECT * FROM tutor_sesiones WHERE id = ?').get(sid)
  return r ? deSesion(r) : null
}
export const sesionesDe = (db: Db, id: number, limite = 20): SesionTutor[] =>
  db.prepare('SELECT * FROM tutor_sesiones WHERE aprendizaje_id = ? ORDER BY id DESC LIMIT ?').all(id, limite).map(deSesion)
const sesionLista = (db: Db, id: number, tipo: 'clase' | 'examen' = 'clase') =>
  (db.prepare(`SELECT * FROM tutor_sesiones WHERE aprendizaje_id = ? AND tipo = ? AND estado IN ('lista', 'en_curso') ORDER BY id DESC LIMIT 1`).get(id, tipo) as any) ?? null

/** Si ya puede rendir el examen del nivel: dos clases seguidas del nivel, cerradas con 80 % o más. */
export function examenHabilitado(db: Db, id: number): boolean {
  const d = leerDominio(db, id)
  if (!d || d.tutorNivel >= 6) return false
  const ultimas = db.prepare(`SELECT puntaje FROM tutor_sesiones WHERE aprendizaje_id = ? AND nivel = ? AND tipo = 'clase' AND estado = 'hecha' ORDER BY id DESC LIMIT 2`).all(id, d.tutorNivel) as { puntaje: number | null }[]
  return ultimas.length === 2 && ultimas.every((s) => (s.puntaje ?? 0) >= 0.8)
}

/** Los dominios de la Academia, con su nivel, por dónde van y lo que tienen para hoy. Idiomas se marca (tiene su pantalla). */
export function listarDominios(db: Db, ahora = Date.now()) {
  const idiomas = new Set((db.prepare('SELECT aprendizaje_id FROM idiomas').all() as { aprendizaje_id: number }[]).map((r) => r.aprendizaje_id))
  return listarAprendizajes(db, {}, ahora).map((a) => {
    const d = leerDominio(db, a.id)!
    const temas = d.temario[String(d.tutorNivel)] ?? []
    const lista = sesionLista(db, a.id)
    return {
      ...a, tutorNivel: d.tutorNivel, nivelNombre: nombreNivel(d.tutorNivel), sugerencia: d.sugerencia, idioma: idiomas.has(a.id),
      temaSiguiente: lista?.tema ?? temas[d.temaIdx % Math.max(1, temas.length)] ?? null, sesionLista: !!lista,
      clases: (db.prepare(`SELECT COUNT(*) AS n FROM tutor_sesiones WHERE aprendizaje_id = ? AND estado = 'hecha'`).get(a.id) as { n: number }).n,
      tarjetasHoy: paraRepasar(db, { mazo: mazoDe(a.id), limite: 200 }, ahora).length,
      examen: examenHabilitado(db, a.id),
    }
  })
}

/** Para Mastropiero: sus dominios con el nivel en que está cada uno. */
export function academiaParaPrompt(db: Db): string {
  const xs = listarDominios(db).filter((d) => d.estado === 'activo')
  if (!xs.length) return ''
  return `Su Academia (lo que está aprendiendo, con un tutor de 6 niveles: ${NIVELES_TUTOR.map((n) => n.nombre).join(' → ')}): ${xs.map((d) => `${d.tema} en nivel ${d.tutorNivel} (${d.nivelNombre})${d.examen ? ', con el examen habilitado' : ''}`).join('; ')}.`
}

// ─── preparar ───────────────────────────────────────────────────────────

const REGLAS = `Sos el tutor de la Academia de Deprocast. Castellano rioplatense, con voseo. Sin relleno ni frases motivacionales.
- Todo lo que afirmás tiene que ser correcto; si algo es discutido o incierto, decilo.
- El visual: elegí el que de verdad ayuda a entender ESTE concepto. «diagrama» para piezas y relaciones (un circuito, un componente, un proceso, una arquitectura); «simulacion» para algo que se mueve o cambia en el tiempo o en 3D (una proteína que se pliega, una reacción, un campo, un sistema dinámico); «movimiento» para el cuerpo humano (un ejercicio, una postura, una técnica); «ninguno» si un dibujo no suma. El pedido describe en una o dos oraciones qué tiene que mostrar y qué tiene que poder tocar.`

const SISTEMA_TEMARIO = (n: number) => `${REGLAS}
Armás el temario del nivel ${n} (${nombreNivel(n)}) de un dominio: 10 a 12 temas en orden, del que se apoya en menos al que se apoya en más, guiados por para qué lo quiere aprender.
Forma: {"temario": [string]}`

const SISTEMA_CLASE = (n: number) => `${REGLAS}
Preparás UNA clase del nivel ${n} (${nombreNivel(n)}) sobre el tema que se te da. ${NIVELES_TUTOR[n - 1].regla}
- explicacion: en Markdown, 250 a 600 palabras, con subtítulos si ayudan.
- ejemplos: 2 o 3, concretos.
- preguntas: 4 o 5 de chequeo, con la «clave» (lo que tiene que aparecer en una buena respuesta, para corregir).
- ideas: 1 o 2 afirmaciones centrales de la clase, cada una en una oración que se sostiene sola (quedan como quántomos).
- tarjetas: 3 a 5 para repasar (frente: una pregunta corta; dorso: la respuesta).
- visual: {"tipo": "diagrama"|"simulacion"|"movimiento"|"ninguno", "pedido": string}.
Forma: {"tema": string, "explicacion": string, "ejemplos": [string], "preguntas": [{"pregunta": string, "clave": string}], "ideas": [string], "tarjetas": [{"frente": string, "dorso": string}], "visual": {"tipo": string, "pedido": string}}`

const SISTEMA_EXAMEN = (n: number) => `${REGLAS}
Armás el examen para aprobar el nivel ${n} (${nombreNivel(n)}): 5 preguntas mezcladas sobre los temas que vio, que pidan entender y aplicar (no recordar palabras). Cada una con su «clave».
Forma: {"tema": "Examen del nivel ${n}", "explicacion": string (dos líneas: qué evalúa y cómo aprobar: 4 de 5), "ejemplos": [], "preguntas": [{"pregunta": string, "clave": string}], "ideas": [], "tarjetas": [], "visual": {"tipo": "ninguno", "pedido": ""}}`

const SISTEMA_DEVOLUCION = `${REGLAS}
Corregís UNA respuesta del alumno contra la clave de la pregunta. «correcto» si la idea central está, aunque lo diga con otras palabras o con errores menores. La devolución: una o dos oraciones, qué estuvo bien, qué faltó o qué está mal, y la pista justa para entenderlo (no la respuesta completa si se equivocó feo).
Forma: {"correcto": boolean, "devolucion": string}`

function paqueteDe(d: any, tema: string): Paquete {
  const v = d?.visual && VISUALES.includes(d.visual.tipo) && d.visual.tipo !== 'ninguno' && txt(d.visual.pedido) ? { tipo: d.visual.tipo, pedido: txt(d.visual.pedido, 500) } : null
  return {
    tema: txt(d?.tema, 120) || tema,
    explicacion: txt(d?.explicacion, 8000),
    ejemplos: (Array.isArray(d?.ejemplos) ? d.ejemplos : []).map((x: unknown) => txt(x, 800)).filter(Boolean).slice(0, 4),
    preguntas: (Array.isArray(d?.preguntas) ? d.preguntas : []).map((p: any) => ({ pregunta: txt(p?.pregunta, 500), clave: txt(p?.clave, 600) })).filter((p: Pregunta) => p.pregunta).slice(0, 6),
    ideas: (Array.isArray(d?.ideas) ? d.ideas : []).map((x: unknown) => txt(x, 400)).filter(Boolean).slice(0, 2),
    tarjetas: (Array.isArray(d?.tarjetas) ? d.tarjetas : []).map((t: any) => ({ frente: txt(t?.frente, 300), dorso: txt(t?.dorso, 600) })).filter((t: { frente: string; dorso: string }) => t.frente && t.dorso).slice(0, 6),
    visual: v,
  }
}

/** Lo que el tutor sabe del alumno y del dominio para preparar: para qué, lo que ya vio, lo que sabe y sus fuentes. */
function contexto(db: Db, d: Dominio, extra: string[] = []): string {
  const vistos = (db.prepare(`SELECT tema FROM tutor_sesiones WHERE aprendizaje_id = ? AND estado = 'hecha' ORDER BY id DESC LIMIT 12`).all(d.id) as { tema: string }[]).map((s) => s.tema)
  const sabe = (db.prepare(`SELECT frente FROM tarjetas WHERE mazo = ? AND estado = 'activa' ORDER BY id DESC LIMIT 20`).all(mazoDe(d.id)) as { frente: string }[]).map((t) => t.frente)
  const r = recursosDe(db, d.tema)
  const otros = d.tutorNivel >= 6 ? listarAprendizajes(db, { estado: 'activo' }).filter((x) => x.id !== d.id).map((x) => x.tema) : []
  let archivo: string[] = []
  try { archivo = buscar(db, d.tema, 5).map((p) => `${p.titulo}: ${String(p.contenido ?? '').replace(/\s+/g, ' ').slice(0, 300)}`) } catch { /* consulta rara para FTS */ }
  return [
    `Dominio: ${d.tema}`,
    d.porQue ? `Para qué lo quiere aprender: ${d.porQue}` : '',
    d.sugerencia ? `Por qué se lo propuso la Academia: ${JSON.stringify(d.sugerencia)}` : '',
    vistos.length ? `Temas que ya vio: ${vistos.join(' · ')}` : 'Todavía no vio ningún tema.',
    sabe.length ? `Lo que ya está repasando: ${sabe.join(' · ')}` : '',
    r.obras.length ? `Obras suyas sobre esto: ${r.obras.map((o) => o.titulo).join(' · ')}` : '',
    archivo.length ? `De su archivo (usalo si sirve; si no, ignoralo):\n${archivo.join('\n')}` : '',
    otros.length ? `Sus otros dominios (para los puentes del nivel frontera): ${otros.join(' · ')}` : '',
    ...extra,
  ].filter(Boolean).join('\n')
}

const preparando = new Map<string, Promise<SesionTutor>>()

/**
 * Prepara la próxima sesión de un dominio (la primera vez del nivel, también su temario) y la deja «lista». Si pide un
 * visual, se encola en el Taller (sin esperarlo). examen: arma el examen del nivel.
 */
export function prepararSesionTutor(db: Db, id: number, o: { tema?: string | null; examen?: boolean; ahora?: number; prioridadVisual?: number } = {}): Promise<SesionTutor> {
  const clave = `${id}:${o.examen ? 'examen' : 'clase'}`
  const ya = preparando.get(clave)
  if (ya && !o.tema) return ya
  const p = (async () => {
    const ahora = o.ahora ?? Date.now()
    const d = leerDominio(db, id)
    if (!d) throw new Error(`No existe el dominio ${id}`)
    const n = d.tutorNivel
    if (o.examen && !examenHabilitado(db, id)) throw new Error('El examen se habilita con dos clases seguidas del nivel resueltas con 80 % o más')
    let temas = d.temario[String(n)] ?? []
    if (!temas.length && !o.examen) {
      const t = await modelo(db, SISTEMA_TEMARIO(n), contexto(db, d))
      temas = (Array.isArray(t?.temario) ? t.temario : []).map((x: unknown) => txt(x, 120)).filter(Boolean).slice(0, 14)
      if (!temas.length) temas = [`Qué es ${d.tema}`]
      db.prepare('UPDATE aprendizajes SET temario = ?, tema_idx = 0 WHERE id = ?').run(JSON.stringify({ ...d.temario, [String(n)]: temas }), id)
    }
    const idx = (leerDominio(db, id)!.temaIdx) % Math.max(1, temas.length)
    const tema = o.examen ? `Examen del nivel ${n}` : o.tema || temas[idx]
    const datos = await modelo(db, o.examen ? SISTEMA_EXAMEN(n) : SISTEMA_CLASE(n), contexto(db, d, [o.examen ? `Temas del nivel: ${temas.join(' · ')}` : `Tema de la clase: ${tema}`]))
    const paquete = paqueteDe(datos, tema)
    if (!paquete.explicacion && !paquete.preguntas.length) throw new Error('El tutor no armó la clase: probá de nuevo')
    const sid = Number(db.prepare('INSERT INTO tutor_sesiones (aprendizaje_id, nivel, tipo, tema, paquete, estado, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, n, o.examen ? 'examen' : 'clase', paquete.tema, JSON.stringify(paquete), 'lista', ahora).lastInsertRowid)
    if (paquete.visual) alPedirVisual(db, leerSesionTutor(db, sid)!, o.prioridadVisual ?? 5)
    return leerSesionTutor(db, sid)!
  })()
  if (!o.tema) {
    preparando.set(clave, p)
    p.then(() => preparando.delete(clave), () => preparando.delete(clave))
  }
  return p
}

/** En la nube, la próxima clase se prepara sola (gasta tokens: en la compu, solo cuando la pedís). Su visual, con prioridad baja. */
export function prepararEnFondo(db: Db, id: number) {
  if (!nube() || sesionLista(db, id)) return
  prepararSesionTutor(db, id, { prioridadVisual: 1 }).catch((e) => console.error('  academia: preparar clase:', e instanceof Error ? e.message : e))
}

// ─── la sesión ──────────────────────────────────────────────────────────

/** Abre la sesión lista del dominio (o la prepara en el momento) y la marca en curso. */
export async function abrirSesionTutor(db: Db, id: number, o: { examen?: boolean; ahora?: number } = {}): Promise<SesionTutor> {
  const ahora = o.ahora ?? Date.now()
  const lista = sesionLista(db, id, o.examen ? 'examen' : 'clase')
  const s = lista ? deSesion(lista) : await prepararSesionTutor(db, id, { examen: o.examen, ahora, prioridadVisual: 9 })
  if (s.estado === 'lista') db.prepare(`UPDATE tutor_sesiones SET estado = 'en_curso', empezada_en = ? WHERE id = ?`).run(ahora, s.id)
  // Si al prepararla el visual no pudo entrar (cola llena, tope), se intenta de nuevo ahora, con prioridad: la está mirando.
  if (lista && s.paquete?.visual && !s.visualId) alPedirVisual(db, s, 9)
  return leerSesionTutor(db, s.id)!
}

/** Cómo está el visual de una sesión: listo (con su dirección), en el horno, falló, o solo texto (y por qué). */
export function visualDe(db: Db, s: SesionTutor) {
  const v = s.paquete?.visual
  if (!v) return null
  const a = s.visualId ? leerArtefacto(db, s.visualId) : null
  if (!a) return { tipo: v.tipo, estado: 'solo_texto' as const, motivo: v.degradado ?? 'el visual queda para después', artefactoId: null, url: null, progreso: null }
  return { tipo: v.tipo, estado: a.estado, motivo: null, artefactoId: a.id, url: a.estado === 'listo' ? `/taller/${a.id}/index.html` : null, progreso: a.progreso, valoracion: a.meta.valoracion ?? null }
}

export const turnosDe = (db: Db, sid: number) =>
  (db.prepare('SELECT i, respuesta, correcto, devolucion FROM tutor_turnos WHERE sesion_id = ? ORDER BY id').all(sid) as any[]).map((t) => ({ i: t.i, respuesta: t.respuesta, correcto: !!t.correcto, devolucion: t.devolucion }))

/** Su respuesta a una pregunta: el tutor la corrige contra la clave. La última respuesta a cada pregunta es la que cuenta. */
export async function responderTutor(db: Db, sid: number, i: number, respuesta: string, ahora = Date.now()) {
  const s = leerSesionTutor(db, sid)
  if (!s) throw new Error(`No existe la sesión ${sid}`)
  if (s.estado === 'hecha') throw new Error('Esa sesión ya se cerró')
  const p = s.paquete.preguntas[i]
  if (!p) throw new Error('Esa pregunta no está en la sesión')
  const r = respuesta.trim()
  if (!r) throw new Error('¿Qué respondés?')
  const d = await modelo(db, SISTEMA_DEVOLUCION, `Nivel ${s.nivel} (${nombreNivel(s.nivel)}). Tema: ${s.tema}\nPregunta: ${p.pregunta}\nClave: ${p.clave}\nRespuesta del alumno: ${r.slice(0, 2000)}`)
  const correcto = !!d?.correcto
  const devolucion = txt(d?.devolucion, 800) || (correcto ? 'Bien.' : 'No es eso: volvé a la explicación.')
  db.prepare('INSERT INTO tutor_turnos (sesion_id, i, respuesta, correcto, devolucion, en) VALUES (?, ?, ?, ?, ?, ?)').run(sid, i, r.slice(0, 4000), correcto ? 1 : 0, devolucion, ahora)
  return { i, correcto, devolucion }
}

/**
 * Cierra la sesión: el puntaje (sobre las preguntas respondidas), su pieza en el corpus, los quántomos y las tarjetas que
 * deja, la práctica, y avanza el temario. Un examen aprobado (4 de 5) sube de nivel.
 */
export function cerrarSesionTutor(db: Db, sid: number, ahora = Date.now()) {
  const s = leerSesionTutor(db, sid)
  if (!s) throw new Error(`No existe la sesión ${sid}`)
  if (s.estado === 'hecha') throw new Error('Esa sesión ya se cerró')
  const d = leerDominio(db, s.aprendizajeId)!
  const ultimos = new Map(turnosDe(db, sid).map((t) => [t.i, t]))
  const respondidas = [...ultimos.values()]
  const puntaje = respondidas.length ? respondidas.filter((t) => t.correcto).length / s.paquete.preguntas.length : 0
  const p = s.paquete

  // La pieza: lo que se explicó, lo que respondió y la devolución (es suya: nivel propia).
  asegurarFuente(db, FUENTE)
  const contenido = [
    `# ${s.tipo === 'examen' ? 'Examen' : 'Clase'} de ${d.tema} · nivel ${s.nivel} (${nombreNivel(s.nivel)}) · ${p.tema}`,
    p.explicacion,
    p.ejemplos.length ? `## Ejemplos\n${p.ejemplos.map((e) => `- ${e}`).join('\n')}` : '',
    `## Preguntas\n${p.preguntas.map((q, i) => { const t = ultimos.get(i); return `- ${q.pregunta}${t ? `\n  - Respondí: ${t.respuesta}\n  - ${t.correcto ? '✓' : '✗'} ${t.devolucion ?? ''}` : '\n  - (sin responder)'}` }).join('\n')}`,
    `Puntaje: ${Math.round(puntaje * 100)} %`,
  ].filter(Boolean).join('\n\n')
  const piezaId = insertar(db, {
    fuente: FUENTE.id, nivel: 'propia', titulo: `${d.tema} · ${p.tema} (nivel ${s.nivel})`, contenido, estado: 'disponible', fecha: fechaLocal(ahora),
    origenId: `academia:${d.id}:${sid}`, etiquetas: ['aprendizaje', d.tema], meta: { tipo: 'academia_sesion', dominio: d.id, nivel: s.nivel, puntaje },
  }, ahora)

  // Lo que deja: uno o dos quántomos proto (La Mano los toma) y las tarjetas del dominio.
  const quantomos = p.ideas.map((idea, k) => crearQuantomo(db, { texto: idea, titulo: `${d.tema}: ${p.tema}`, piezaId, etapa: 'proto', procedencia: `academia nivel ${s.nivel}`, origenId: `academia:${sid}:${k}` }, ahora)).filter((x) => x != null)
  const tarjetas = p.tarjetas.map((t) => crearTarjeta(db, { mazo: mazoDe(d.id), frente: t.frente, dorso: t.dorso, contexto: `${d.tema} · ${p.tema}`, origenTipo: 'academia_sesion', origenId: sid }, ahora)).filter((t) => t.nueva).length
  const minutos = s.empezadaEn ? Math.max(1, Math.min(180, Math.round((ahora - s.empezadaEn) / 60000))) : null
  registrarPractica(db, { aprendizajeId: d.id, minutos, que: `${s.tipo === 'examen' ? 'Examen' : 'Clase'} nivel ${s.nivel}: ${p.tema}`, fuente: 'academia' }, ahora)

  db.prepare(`UPDATE tutor_sesiones SET estado = 'hecha', puntaje = ?, pieza_id = ?, cerrada_en = ? WHERE id = ?`).run(puntaje, piezaId, ahora, sid)
  let subio = false
  if (s.tipo === 'examen') {
    if (puntaje >= 0.8 && d.tutorNivel < 6) {
      db.prepare('UPDATE aprendizajes SET tutor_nivel = ?, tema_idx = 0 WHERE id = ?').run(d.tutorNivel + 1, d.id)
      subio = true
    }
  } else db.prepare('UPDATE aprendizajes SET tema_idx = tema_idx + 1 WHERE id = ?').run(d.id)
  prepararEnFondo(db, d.id)
  const fallidas = p.preguntas.filter((_, i) => !ultimos.get(i)?.correcto).map((q) => q.pregunta)
  return { puntaje, piezaId, quantomos: quantomos.length, tarjetas, subio, nivel: leerDominio(db, d.id)!.tutorNivel, examen: examenHabilitado(db, d.id), repasar: s.tipo === 'examen' && !subio ? fallidas : [] }
}

/** Sumar un dominio a la Academia (si ya estaba sugerido o pausado, se activa). */
export function sumarDominio(db: Db, a: { tema: string; porQue?: string | null }, ahora = Date.now()) {
  const r = crearAprendizaje(db, { tema: a.tema, porQue: a.porQue }, ahora)
  if (!r.nuevo && r.estado !== 'activo') db.prepare(`UPDATE aprendizajes SET estado = 'activo', por_que = COALESCE(?, por_que) WHERE id = ?`).run(a.porQue?.trim() || null, r.id)
  return leerDominio(db, r.id)!
}

// ─── qué le conviene aprender (lo propone; él acepta en 📥 Para validar) ─

const SISTEMA_SUGERIR = (n: number) => `Sos el consejero de su Academia. Mirás lo que viene con fecha (eventos, convocatorias, viajes), lo que quiere (su misión principal, sus primarias, sus metas por horizonte) y quién es, y proponés hasta ${n} dominios NUEVOS que le conviene aprender para eso.
Reglas:
- Cada propuesta nombra la meta o el evento concreto que la justifica (con su fecha si la tiene). Nada genérico («inglés», «productividad») salvo que una meta lo pida explícito.
- No repitas lo que ya está aprendiendo ni lo que descartó.
- horizonte: "corto" (algo con fecha en las próximas semanas: llegar con lo básico), "medio" (meses), "largo" (sus metas de fondo).
- tema: corto, como se nombraría la materia («Drones», «Negociación», «Electrónica básica»).
- primer_paso: qué vería en la primera clase.
- Si no hay señales claras, proponé menos (o ninguna). Mejor una certera que tres de relleno.
Forma: {"sugerencias": [{"tema": string, "por_que": string, "horizonte": "corto"|"medio"|"largo", "para": string|null, "fecha": "AAAA-MM-DD"|null, "primer_paso": string}]}`

const HORIZONTE_DE: Record<string, string> = { trinchera: 'corto', campamento: 'medio', castillo: 'largo' }
const normTema = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Lo que el predictor mira: lo que viene con fecha, lo que quiere y lo que ya aprende (o descartó). */
async function contextoSugerir(db: Db, ahora: number): Promise<string> {
  const hoy = fechaLocal(ahora)
  const hasta = fechaLocal(ahora + 100 * 86_400_000)
  let agenda: string[] = []
  try {
    const { itemsDelCalendario } = await import('./agenda.ts')
    agenda = (await itemsDelCalendario(db, hoy, hasta, new Set(['google', 'linea', 'radar', 'mision']))).items.slice(0, 50).map((i) => `- ${i.fecha}: ${i.titulo}${i.lugar ? ` (${i.lugar})` : ''}`)
  } catch { /* sin calendario: sigue con lo demás */ }
  const { listarOportunidades } = await import('./radar.ts')
  const ops = listarOportunidades(db, { estados: ['nueva', 'me_interesa'], limite: 15 }).map((o) => `- ${o.titulo}${o.cierre ? ` (cierra ${o.cierre})` : ''}${o.fecha ? ` (el ${o.fecha})` : ''}${o.porQue ? `: ${o.porQue}` : ''}`)
  const { principalDe, listarMisiones, semanaDe } = await import('./misiones.ts')
  const principal = principalDe(db, 'jugador')
  const primarias = listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] }).map((m) => `- ${m.titulo}`)
  const { memoriaVigente } = await import('./memoria.ts')
  const metas = ['meta', 'vision', 'sueño'].flatMap((tipo) => memoriaVigente(db, { tipo, limite: 25 })).map((r) => `- ${r.horizonte ? `[${HORIZONTE_DE[r.horizonte] ?? r.horizonte} plazo] ` : ''}${r.texto}`)
  const { yoParaPrompt } = await import('./yo.ts')
  const todos = db.prepare('SELECT tema, estado FROM aprendizajes').all() as { tema: string; estado: string }[]
  const vivos = todos.filter((t) => t.estado !== 'descartado').map((t) => t.tema)
  const descartados = todos.filter((t) => t.estado === 'descartado').map((t) => t.tema)
  return [
    `Hoy es ${hoy}.`,
    principal ? `Su misión principal: ${principal.titulo}${principal.detalle ? ` — ${principal.detalle}` : ''}` : '',
    primarias.length ? `Sus primarias de esta semana:\n${primarias.join('\n')}` : '',
    metas.length ? `Sus metas y visión:\n${metas.slice(0, 40).join('\n')}` : '',
    yoParaPrompt(db),
    agenda.length ? `Lo que viene en los próximos 100 días:\n${agenda.join('\n')}` : 'No hay nada agendado a 100 días.',
    ops.length ? `Oportunidades del Radar abiertas:\n${ops.join('\n')}` : '',
    vivos.length ? `Ya está aprendiendo (o se lo propusiste): ${vivos.join(' · ')}` : '',
    descartados.length ? `Descartó (no lo propongas de nuevo): ${descartados.join(' · ')}` : '',
  ].filter(Boolean).join('\n\n')
}

/**
 * Propone hasta 3 dominios que le conviene aprender para lo que viene y lo que quiere, cada uno con su porqué, horizonte
 * y para qué evento o meta. Quedan «sugeridos» (📥 Para validar): aceptar los vuelve dominios; descartados, no vuelven.
 * Las sugerencias sin responder de más de 3 semanas se van solas.
 */
export async function sugerirAprendizajes(db: Db, o: { ahora?: number; max?: number } = {}): Promise<Dominio[]> {
  const ahora = o.ahora ?? Date.now()
  db.prepare(`DELETE FROM aprendizajes WHERE estado = 'sugerido' AND creado_en < ?`).run(ahora - 21 * 86_400_000)
  const pendientes = (db.prepare(`SELECT COUNT(*) AS n FROM aprendizajes WHERE estado = 'sugerido'`).get() as { n: number }).n
  const n = Math.max(0, Math.min(3, o.max ?? 3) - pendientes)
  if (!n) return []
  const datos = await modelo(db, SISTEMA_SUGERIR(n), await contextoSugerir(db, ahora))
  const ya = new Set((db.prepare('SELECT tema FROM aprendizajes').all() as { tema: string }[]).map((r) => normTema(r.tema)))
  const nuevos: Dominio[] = []
  for (const s of (Array.isArray(datos?.sugerencias) ? datos.sugerencias : []).slice(0, n)) {
    const tema = txt(s?.tema, 120)
    if (tema.length < 2 || ya.has(normTema(tema))) continue
    ya.add(normTema(tema))
    const sugerencia = {
      porQue: txt(s.por_que, 400) || null, horizonte: ['corto', 'medio', 'largo'].includes(s.horizonte) ? s.horizonte : null,
      para: txt(s.para, 200) || null, fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(s.fecha ?? '')) ? s.fecha : null, primerPaso: txt(s.primer_paso, 300) || null,
    }
    // Directo a la tabla: una sugerencia no crea entidad ni cuenta como aprendizaje hasta que la acepta.
    const id = Number(db.prepare(`INSERT INTO aprendizajes (tema, por_que, estado, sugerencia, creado_en) VALUES (?, ?, 'sugerido', ?, ?)`).run(tema, sugerencia.porQue, JSON.stringify(sugerencia), ahora).lastInsertRowid)
    nuevos.push(leerDominio(db, id)!)
  }
  return nuevos
}

export const sugeridosDe = (db: Db): Dominio[] =>
  (db.prepare(`SELECT id FROM aprendizajes WHERE estado = 'sugerido' ORDER BY creado_en DESC, id DESC`).all() as { id: number }[]).map((r) => leerDominio(db, r.id)!)

/** Lo que pasa al aceptar un dominio (la Fase 6 suma: buscar sus primeras fuentes). */
let alAceptar: (db: Db, d: Dominio) => void = () => {}
export function _alAceptar(f: typeof alAceptar) { alAceptar = f }

/** Aceptar una sugerencia: pasa a ser un dominio activo, con su entidad, su primera clase (de fondo) y sus fuentes. */
export async function aceptarSugerencia(db: Db, id: number, ahora = Date.now()): Promise<Dominio> {
  const d = leerDominio(db, id)
  if (!d || d.estado !== 'sugerido') throw new Error('Esa sugerencia ya no está')
  db.prepare(`UPDATE aprendizajes SET estado = 'activo', creado_en = ? WHERE id = ?`).run(ahora, id)
  try { (await import('./entidades.ts')).asegurarPorNombre(db, d.tema, 'dominio', ahora) } catch { /* el grafo es un plus */ }
  prepararEnFondo(db, id)
  const activo = leerDominio(db, id)!
  alAceptar(db, activo)
  return activo
}

/** Descartar: queda anotado para no volver a proponerlo igual. */
export function descartarSugerencia(db: Db, id: number) {
  const d = leerDominio(db, id)
  if (!d || d.estado !== 'sugerido') throw new Error('Esa sugerencia ya no está')
  db.prepare(`UPDATE aprendizajes SET estado = 'descartado' WHERE id = ?`).run(id)
  return { ok: true }
}

/** El texto de una sugerencia para la bandeja y el aviso: por qué, para qué y cuándo. */
export const textoSugerencia = (d: Dominio) => {
  const s = (d.sugerencia ?? {}) as { porQue?: string; horizonte?: string; para?: string; fecha?: string }
  return [s.porQue ?? d.porQue, s.para ? `para ${s.para}${s.fecha ? ` (${s.fecha})` : ''}` : s.fecha ?? null, s.horizonte ? `${s.horizonte} plazo` : null].filter(Boolean).join(' · ')
}
