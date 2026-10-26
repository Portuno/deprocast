/**
 * La Academia (plan v23): cada dominio que quiere aprender tiene un tutor de seis niveles, del niño de 10 a la frontera
 * del conocimiento. Una sesión se prepara de antemano (explicación, ejemplos, preguntas, las ideas y tarjetas que deja y
 * el visual que le sirve al concepto); al cerrarla queda su pieza en el corpus, uno o dos quántomos proto (los toma La
 * Mano), tarjetas SM-2 en el mazo del dominio y la práctica anotada. Para subir de nivel hay un examen: se habilita con
 * dos clases seguidas bien resueltas (o con todo el nivel sabido) y nunca sube solo. Idiomas sigue con su propio tutor.
 * Plan v24: cada dominio tiene su mapa de conceptos (conceptos.ts), armado desde su material si lo hay; la clase elige
 * sola el próximo concepto e intercala repaso; un diagnóstico de seis preguntas lo ubica; el tutor lee su material.
 */
import crypto from 'node:crypto'
import { fechaLocal, json, type Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { asegurarFuente, buscar, insertar, leerPieza, type Pieza } from './corpus.ts'
import { buscarHibrido, cercanas, type PiezaHallada } from './semantica.ts'
import { crearQuantomo } from './quantomos.ts'
import { crearTarjeta, paraRepasar } from './tarjetas.ts'
import { crearAprendizaje, leerAprendizaje, listarAprendizajes, recursosDe, registrarPractica, type Aprendizaje } from './aprender.ts'
import { enLaNube } from './reproceso.ts'
import { pedirVisual } from './taller-cola.ts'
import { leerArtefacto } from './taller.ts'
import { anotarSilencioso, leccionesPara } from './devoluciones.ts'
import { anotar } from './decisiones.ts'
import { anotarRespuesta, bajarDominio, conceptoPorNombre, conceptosDe, conceptosParaRepasar, deTemario, dominioHoy, frontera, guardarMapa, leerConcepto, marcarSabidos, nivelSabido, programarRepaso, ritmoDe, SABIDO, type Concepto } from './conceptos.ts'

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
export type Pregunta = { pregunta: string; clave: string; conceptoId?: number | null; repaso?: string | null; nivel?: number | null }
export type Paquete = { tema: string; explicacion: string; ejemplos: string[]; preguntas: Pregunta[]; ideas: string[]; tarjetas: { frente: string; dorso: string }[]; visual: Visual; fuentes?: number[] }
export type SesionTutor = {
  id: number; aprendizajeId: number; nivel: number; tipo: 'clase' | 'examen' | 'diagnostico'; tema: string; paquete: Paquete; estado: 'lista' | 'en_curso' | 'hecha'
  puntaje: number | null; piezaId: number | null; visualId: number | null; conceptoId: number | null; creadaEn: number; empezadaEn: number | null; cerradaEn: number | null
}
export type Dominio = Aprendizaje & { tutorNivel: number; temario: Record<string, string[]>; temaIdx: number; sugerencia: Record<string, unknown> | null; fuentesEn: number | null; diagnosticoEn: number | null }

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
/** La voz (inyectable para tests): lo que dice el tutor (kokoro, con caché) y lo que él responde hablando (Whisper). */
let hablar = async (db: Db, texto: string): Promise<string | null> => (await import('./voz.ts')).decir(db, texto, (await import('./chat/adjuntos.ts')).dirAdjuntos())
let transcribir = async (db: Db, audio: Buffer, nombre: string): Promise<string> => (await import('./nan.ts')).nanTranscribir(db, audio, nombre, 'es')
export function _probarAcademia(o: { modelo?: typeof modelo; nube?: () => boolean; alPedirVisual?: typeof alPedirVisual; hablar?: typeof hablar; transcribir?: typeof transcribir }) {
  if (o.modelo) modelo = o.modelo
  if (o.nube) nube = o.nube
  if (o.alPedirVisual) alPedirVisual = o.alPedirVisual
  if (o.hablar) hablar = o.hablar
  if (o.transcribir) transcribir = o.transcribir
}

// ─── leer ───────────────────────────────────────────────────────────────

export function leerDominio(db: Db, id: number): Dominio | null {
  const a = leerAprendizaje(db, id)
  if (!a) return null
  const r = db.prepare('SELECT tutor_nivel, temario, tema_idx, sugerencia, fuentes_en, diagnostico_en FROM aprendizajes WHERE id = ?').get(id) as any
  return { ...a, tutorNivel: r.tutor_nivel ?? 1, temario: json<Record<string, string[]>>(r.temario, {}) ?? {}, temaIdx: r.tema_idx ?? 0, sugerencia: json(r.sugerencia, null), fuentesEn: r.fuentes_en ?? null, diagnosticoEn: r.diagnostico_en ?? null }
}

const deSesion = (r: any): SesionTutor => ({
  id: r.id, aprendizajeId: r.aprendizaje_id, nivel: r.nivel, tipo: r.tipo, tema: r.tema, paquete: json<Paquete>(r.paquete, null as any), estado: r.estado,
  puntaje: r.puntaje, piezaId: r.pieza_id, visualId: r.visual_id, conceptoId: r.concepto_id ?? null, creadaEn: r.creada_en, empezadaEn: r.empezada_en, cerradaEn: r.cerrada_en,
})
export function leerSesionTutor(db: Db, sid: number): SesionTutor | null {
  const r = db.prepare('SELECT * FROM tutor_sesiones WHERE id = ?').get(sid)
  return r ? deSesion(r) : null
}
export const sesionesDe = (db: Db, id: number, limite = 20): SesionTutor[] =>
  db.prepare('SELECT * FROM tutor_sesiones WHERE aprendizaje_id = ? ORDER BY id DESC LIMIT ?').all(id, limite).map(deSesion)
const sesionLista = (db: Db, id: number, tipo: SesionTutor['tipo'] = 'clase') =>
  (db.prepare(`SELECT * FROM tutor_sesiones WHERE aprendizaje_id = ? AND tipo = ? AND estado IN ('lista', 'en_curso') ORDER BY id DESC LIMIT 1`).get(id, tipo) as any) ?? null

/** Si ya puede rendir el examen del nivel: dos clases seguidas del nivel con 80 % o más, o todos sus conceptos sabidos. */
export function examenHabilitado(db: Db, id: number): boolean {
  const d = leerDominio(db, id)
  if (!d || d.tutorNivel >= 6) return false
  // Desde el nivel 4 (aplicado), sin el proyecto del nivel aprobado no hay examen: se sabe haciendo.
  if (d.tutorNivel >= NIVEL_PROYECTO_OBLIGATORIO && !proyectoAprobado(db, id, d.tutorNivel)) return false
  if (nivelSabido(db, id, d.tutorNivel)) return true
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
    const cs = conceptosDe(db, a.id)
    return {
      ...a, tutorNivel: d.tutorNivel, nivelNombre: nombreNivel(d.tutorNivel), sugerencia: d.sugerencia, idioma: idiomas.has(a.id),
      temaSiguiente: lista?.tema ?? frontera(db, a.id, d.tutorNivel, ahora)?.nombre ?? temas[d.temaIdx % Math.max(1, temas.length)] ?? null, sesionLista: !!lista,
      mapa: cs.length ? { total: cs.length, sabidos: cs.filter((c) => dominioHoy(c, ahora) >= SABIDO).length, delNivel: cs.filter((c) => c.nivel === d.tutorNivel).length, sabidosDelNivel: cs.filter((c) => c.nivel === d.tutorNivel && dominioHoy(c, ahora) >= SABIDO).length } : null,
      ritmo: ritmoDe(db, d, ahora), diagnosticado: !!d.diagnosticoEn,
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
  return `Su Academia (lo que está aprendiendo, con un tutor de 6 niveles: ${NIVELES_TUTOR.map((n) => n.nombre).join(' → ')}): ${xs.map((d) => `${d.tema} en nivel ${d.tutorNivel} (${d.nivelNombre})${d.examen ? ', con el examen habilitado' : ''}${d.ritmo && d.ritmo.estado !== 'lograda' ? ` — meta: ${d.ritmo.texto}` : ''}`).join('; ')}.`
}

// ─── preparar ───────────────────────────────────────────────────────────

const REGLAS = `Sos el tutor de la Academia de Deprocast. Castellano rioplatense, con voseo. Sin relleno ni frases motivacionales.
- Todo lo que afirmás tiene que ser correcto; si algo es discutido o incierto, decilo.
- El visual: elegí el que de verdad ayuda a entender ESTE concepto. «diagrama» para piezas y relaciones (un circuito, un componente, un proceso, una arquitectura); «simulacion» para algo que se mueve o cambia en el tiempo o en 3D (una proteína que se pliega, una reacción, un campo, un sistema dinámico); «movimiento» para el cuerpo humano (un ejercicio, una postura, una técnica); «ninguno» si un dibujo no suma. El pedido describe en una o dos oraciones qué tiene que mostrar y qué tiene que poder tocar.`

const SISTEMA_MAPA = `${REGLAS}
Armás el mapa de conceptos de un dominio, de punta a punta en los seis niveles (${NIVELES_TUTOR.map((x) => `${x.n} ${x.nombre}`).join(', ')}).
- Un concepto es algo que se aprende en UNA clase (ni un capítulo entero ni una palabra suelta).
- 5 a 8 conceptos por nivel en los niveles 1 a 4; 3 a 5 en el 5 y el 6. Guiado por para qué lo quiere aprender.
- requisitos: los nombres EXACTOS de los conceptos (de su nivel o de antes) que hay que saber primero. Sin ciclos.
- Si viene el índice de su material (un libro, apuntes), el mapa lo sigue: los mismos temas, en ese orden, con esos nombres.
Forma: {"conceptos": [{"nombre": string, "nivel": 1-6, "requisitos": [string]}]}`

const SISTEMA_CLASE = (n: number) => `${REGLAS}
Preparás UNA clase del nivel ${n} (${nombreNivel(n)}) sobre el tema que se te da. ${NIVELES_TUTOR[n - 1].regla}
- explicacion: en Markdown, 250 a 600 palabras, con subtítulos si ayudan.
- ejemplos: 2 o 3, concretos.
- preguntas: 4 o 5 de chequeo, con la «clave» (lo que tiene que aparecer en una buena respuesta, para corregir). Si viene «Repaso intercalado», sumá UNA pregunta corta por cada concepto de ese repaso, con "repaso": el nombre exacto del concepto.
- ideas: 1 o 2 afirmaciones centrales de la clase, cada una en una oración que se sostiene sola (quedan como quántomos).
- tarjetas: 3 a 5 para repasar (frente: una pregunta corta; dorso: la respuesta).
- visual: {"tipo": "diagrama"|"simulacion"|"movimiento"|"ninguno", "pedido": string}.
- Si viene «Material», la clase se arma sobre él (es lo que él eligió para aprender): seguí su enfoque, su orden y su notación, y citá [#id] donde lo uses. No inventes citas ni contradigas el material sin decirlo.
Forma: {"tema": string, "explicacion": string, "ejemplos": [string], "preguntas": [{"pregunta": string, "clave": string, "repaso": string | null}], "ideas": [string], "tarjetas": [{"frente": string, "dorso": string}], "visual": {"tipo": string, "pedido": string}}`

const SISTEMA_DIAGNOSTICO = `${REGLAS}
Armás un diagnóstico de ubicación: SEIS preguntas sobre el dominio, una por nivel, de la más fácil (nivel 1, ${nombreNivel(1)}) a la más difícil (nivel 6, ${nombreNivel(6)}). Cada una se responde en pocas líneas y discrimina de verdad ese nivel (no es de memoria). Con su «clave».
Forma: {"preguntas": [{"nivel": 1-6, "pregunta": string, "clave": string}]}`

const SISTEMA_EXAMEN = (n: number) => `${REGLAS}
Armás el examen para aprobar el nivel ${n} (${nombreNivel(n)}): 5 preguntas mezcladas sobre los conceptos del nivel, que pidan entender y aplicar (no recordar palabras). Cada una con su «clave».
Forma: {"tema": "Examen del nivel ${n}", "explicacion": string (dos líneas: qué evalúa y cómo aprobar: 4 de 5), "ejemplos": [], "preguntas": [{"pregunta": string, "clave": string}], "ideas": [], "tarjetas": [], "visual": {"tipo": "ninguno", "pedido": ""}}`

const SISTEMA_DEVOLUCION = `${REGLAS}
Corregís UNA respuesta del alumno contra la clave de la pregunta. «correcto» si la idea central está, aunque lo diga con otras palabras o con errores menores.
- Si está bien: una o dos oraciones, qué estuvo bien y, si falta un matiz, cuál.
- Si está mal y es el PRIMER intento: NO des la respuesta. Una pista o una pregunta guía que lo haga pensar en la dirección correcta (socrático), apoyada en algo que ya sabe. Termina invitándolo a probar de nuevo.
- Si está mal y ya es el SEGUNDO intento (o más): ahí sí, explicá la respuesta, corto y claro, y por qué su idea no alcanzaba.
- concepto_flojo: si el error muestra que le falta una idea previa (un requisito), nombrala; si no, null.
Forma: {"correcto": boolean, "devolucion": string, "concepto_flojo": string | null}`

const SISTEMA_ACLARACION = `${REGLAS}
El alumno dijo «no entendí». Reexplicá UN nivel más abajo y con OTRA analogía distinta a la de la clase (algo de la vida diaria). Corto: 80 a 180 palabras. Si es sobre una pregunta, explicá qué te está pidiendo la pregunta y qué idea hace falta, SIN dar la respuesta.
Forma: {"texto": string}`

function paqueteDe(d: any, tema: string): Paquete {
  const v = d?.visual && VISUALES.includes(d.visual.tipo) && d.visual.tipo !== 'ninguno' && txt(d.visual.pedido) ? { tipo: d.visual.tipo, pedido: txt(d.visual.pedido, 500) } : null
  return {
    tema: txt(d?.tema, 120) || tema,
    explicacion: txt(d?.explicacion, 8000),
    ejemplos: (Array.isArray(d?.ejemplos) ? d.ejemplos : []).map((x: unknown) => txt(x, 800)).filter(Boolean).slice(0, 4),
    preguntas: (Array.isArray(d?.preguntas) ? d.preguntas : []).map((p: any) => ({ pregunta: txt(p?.pregunta, 500), clave: txt(p?.clave, 600), repaso: txt(p?.repaso, 120) || null, nivel: Number(p?.nivel) || null })).filter((p: Pregunta) => p.pregunta).slice(0, 8),
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
  const material = materialDe(db, d.id).filter((m) => m.util !== -1 && m.origen !== 'busqueda').map((m) => m.titulo)
  return [
    `Dominio: ${d.tema}`,
    d.porQue ? `Para qué lo quiere aprender: ${d.porQue}` : '',
    d.sugerencia ? `Por qué se lo propuso la Academia: ${JSON.stringify(d.sugerencia)}` : '',
    vistos.length ? `Temas que ya vio: ${vistos.join(' · ')}` : 'Todavía no vio ningún tema.',
    sabe.length ? `Lo que ya está repasando: ${sabe.join(' · ')}` : '',
    r.obras.length ? `Obras suyas sobre esto: ${r.obras.map((o) => o.titulo).join(' · ')}` : '',
    material.length ? `El material que sumó para esto: ${material.slice(0, 12).join(' · ')}` : '',
    otros.length ? `Sus otros dominios (para los puentes del nivel frontera): ${otros.join(' · ')}` : '',
    leccionesPara(db, ['clase', 'explicacion', 'pregunta', 'proyecto']),
    ...extra,
  ].filter(Boolean).join('\n')
}

// ─── el mapa de conceptos ───────────────────────────────────────────────

/** El índice de su material (títulos, capítulos, secciones): lo que guía el mapa cuando sumó un libro o apuntes. */
export function indiceDeMaterial(db: Db, id: number, max = 80): string {
  const lineas: string[] = []
  for (const m of materialDe(db, id).filter((x) => x.piezaId && x.util !== -1 && x.origen !== 'busqueda')) {
    const p = leerPieza(db, m.piezaId!)
    if (!p) continue
    const titulos = p.contenido.split(/\r?\n/).map((l) => l.trim())
      .filter((l) => /^#{1,3}\s+\S/.test(l) || /^(cap[ií]tulo|chapter|unidad|unit|tema|lecci[oó]n|lesson|parte|part|secci[oó]n|section)\s+[\divxlc]+\b/i.test(l) || /^\d+(\.\d+){0,2}\.?\s+[A-ZÁÉÍÓÚÑ¿][^.]{3,90}$/.test(l))
      .map((l) => l.replace(/^#+\s*/, '').slice(0, 110))
    if (titulos.length) lineas.push(`De «${p.titulo}»:`, ...titulos.slice(0, 40).map((t) => `- ${t}`))
    if (lineas.length >= max) break
  }
  return lineas.slice(0, max).join('\n')
}

/**
 * Arma (o rearma) el mapa de conceptos del dominio con el modelo, siguiendo el índice de su material si lo hay. Lo que ya
 * sabía de cada concepto se conserva.
 */
export async function armarMapa(db: Db, id: number, ahora = Date.now()): Promise<Concepto[]> {
  const d = leerDominio(db, id)
  if (!d) throw new Error(`No existe el dominio ${id}`)
  const indice = indiceDeMaterial(db, id)
  const ya = conceptosDe(db, id)
  const r = await modelo(db, SISTEMA_MAPA, contexto(db, d, [
    `Hoy está en el nivel ${d.tutorNivel} (${nombreNivel(d.tutorNivel)}).`,
    indice ? `El índice de su material (seguilo):\n${indice}` : '',
    ya.length ? `El mapa de antes (conservá los nombres de lo que siga valiendo): ${ya.map((c) => `${c.nombre} [${c.nivel}]`).join(' · ')}` : '',
  ]))
  const items = (Array.isArray(r?.conceptos) ? r.conceptos : []).slice(0, 60).map((c: any) => ({ nombre: txt(c?.nombre, 120), nivel: Number(c?.nivel) || 1, requisitos: Array.isArray(c?.requisitos) ? c.requisitos.map((x: unknown) => txt(x, 120)) : [] }))
  const cs = guardarMapa(db, id, items.length ? items : [{ nombre: `Qué es ${d.tema}`, nivel: 1 }], ahora)
  db.prepare('UPDATE aprendizajes SET temario = NULL WHERE id = ?').run(id)
  return cs
}

/** Que el dominio tenga su mapa: los temarios del v23 pasan solos; si no hay nada, lo arma el modelo. */
async function asegurarMapa(db: Db, d: Dominio, ahora: number): Promise<Concepto[]> {
  const cs = conceptosDe(db, d.id)
  if (cs.length) return cs
  if (Object.values(d.temario).some((t) => t.length)) return deTemario(db, d.id, d.temario, d.temaIdx, d.tutorNivel, ahora)
  return armarMapa(db, d.id, ahora)
}

const preparando = new Map<string, Promise<SesionTutor>>()

/**
 * Prepara la próxima sesión de un dominio y la deja «lista». Una clase elige sola el concepto (la frontera de su mapa) e
 * intercala una o dos preguntas de lo que le toca repasar; lee su material. Si pide un visual, se encola en el Taller
 * (sin esperarlo). examen: el examen del nivel, sobre sus conceptos.
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
    if (o.examen && !examenHabilitado(db, id)) throw new Error(n >= NIVEL_PROYECTO_OBLIGATORIO && !proyectoAprobado(db, id, n) ? `Desde el nivel ${NIVEL_PROYECTO_OBLIGATORIO}, el examen pide el proyecto del nivel aprobado` : 'El examen se habilita con dos clases seguidas del nivel resueltas con 80 % o más')
    const mapa = await asegurarMapa(db, d, ahora)
    const delNivel = mapa.filter((c) => c.nivel === n)
    // El concepto: el que pidió, la frontera o, si ya sabe todo lo del nivel, lo que menos domina (repaso antes del examen).
    const concepto = o.examen ? null : (o.tema ? conceptoPorNombre(db, id, o.tema) : null) ?? (o.tema ? null : frontera(db, id, n, ahora) ?? [...delNivel].sort((a, b) => dominioHoy(a, ahora) - dominioHoy(b, ahora))[0] ?? null)
    const tema = o.examen ? `Examen del nivel ${n}` : o.tema || concepto?.nombre || `Qué es ${d.tema}`
    const repaso = o.examen ? [] : conceptosParaRepasar(db, { aprendizajeId: id, excepto: concepto ? [concepto.id] : [], limite: 2 }, ahora)
    const porId = new Map(mapa.map((c) => [c.id, c]))
    const mat = o.examen ? null : await materialParaClase(db, d, tema)
    const extra = o.examen
      ? [`Conceptos del nivel: ${(delNivel.length ? delNivel.map((c) => c.nombre) : [d.tema]).join(' · ')}`]
      : [
        `Tema de la clase: ${tema}`,
        concepto?.requisitos.length ? `Se apoya en: ${concepto.requisitos.map((r) => porId.get(r)?.nombre).filter(Boolean).join(' · ')}` : '',
        repaso.length ? `Repaso intercalado (una pregunta de cada uno, con "repaso" = el nombre exacto): ${repaso.map((c) => `${c.nombre}${c.aprendizajeId !== id ? ` (de ${c.dominioTema})` : ''}`).join(' · ')}` : '',
        mat?.texto ? `Material (basate en esto; citá [#id] donde lo uses):\n${mat.texto}` : '',
      ]
    const datos = await modelo(db, o.examen ? SISTEMA_EXAMEN(n) : SISTEMA_CLASE(n), contexto(db, d, extra))
    const paquete = paqueteDe(datos, tema)
    if (mat?.ids.length) paquete.fuentes = mat.ids
    // Cada pregunta sabe de qué concepto es: las de repaso, del suyo; las demás, del de la clase.
    for (const q of paquete.preguntas) {
      const r = q.repaso ? repaso.find((c) => c.nombre.toLowerCase() === q.repaso!.toLowerCase()) : null
      q.conceptoId = r?.id ?? (q.repaso ? null : concepto?.id ?? null)
    }
    if (!paquete.explicacion && !paquete.preguntas.length) throw new Error('El tutor no armó la clase: probá de nuevo')
    const sid = Number(db.prepare('INSERT INTO tutor_sesiones (aprendizaje_id, nivel, tipo, tema, paquete, estado, concepto_id, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, n, o.examen ? 'examen' : 'clase', paquete.tema, JSON.stringify(paquete), 'lista', concepto?.id ?? null, ahora).lastInsertRowid)
    if (paquete.visual) alPedirVisual(db, leerSesionTutor(db, sid)!, o.prioridadVisual ?? 5)
    return leerSesionTutor(db, sid)!
  })()
  if (!o.tema) {
    preparando.set(clave, p)
    p.then(() => preparando.delete(clave), () => preparando.delete(clave))
  }
  return p
}

/** El diagnóstico de ubicación: seis preguntas, una por nivel. Al cerrarlo, el nivel se fija según hasta dónde respondió bien. */
export async function prepararDiagnostico(db: Db, id: number, ahora = Date.now()): Promise<SesionTutor> {
  const d = leerDominio(db, id)
  if (!d) throw new Error(`No existe el dominio ${id}`)
  const r = await modelo(db, SISTEMA_DIAGNOSTICO, contexto(db, d))
  const preguntas: Pregunta[] = (Array.isArray(r?.preguntas) ? r.preguntas : []).map((q: any, i: number) => ({ pregunta: txt(q?.pregunta, 500), clave: txt(q?.clave, 600), nivel: Math.max(1, Math.min(6, Number(q?.nivel) || i + 1)), conceptoId: null, repaso: null }))
    .filter((q: Pregunta) => q.pregunta).sort((a: Pregunta, b: Pregunta) => a.nivel! - b.nivel!).slice(0, 6)
  if (preguntas.length < 3) throw new Error('El tutor no armó el diagnóstico: probá de nuevo')
  const paquete: Paquete = { tema: `Ubicación en ${d.tema}`, explicacion: 'Seis preguntas, de la más fácil a la más difícil. Respondé lo que sepas con tus palabras; si no sabés, escribí «no sé» (eso también ubica).', ejemplos: [], preguntas, ideas: [], tarjetas: [], visual: null }
  const sid = Number(db.prepare(`INSERT INTO tutor_sesiones (aprendizaje_id, nivel, tipo, tema, paquete, estado, creada_en) VALUES (?, ?, 'diagnostico', ?, ?, 'lista', ?)`).run(id, d.tutorNivel, paquete.tema, JSON.stringify(paquete), ahora).lastInsertRowid)
  return leerSesionTutor(db, sid)!
}

/** En la nube, la próxima clase se prepara sola (gasta tokens: en la compu, solo cuando la pedís). Su visual, con prioridad baja. */
export function prepararEnFondo(db: Db, id: number) {
  if (!nube() || sesionLista(db, id)) return
  prepararSesionTutor(db, id, { prioridadVisual: 1 }).catch((e) => console.error('  academia: preparar clase:', e instanceof Error ? e.message : e))
}

// ─── la sesión ──────────────────────────────────────────────────────────

/** Abre la sesión lista del dominio (o la prepara en el momento) y la marca en curso. */
export async function abrirSesionTutor(db: Db, id: number, o: { examen?: boolean; diagnostico?: boolean; ahora?: number } = {}): Promise<SesionTutor> {
  const ahora = o.ahora ?? Date.now()
  const lista = sesionLista(db, id, o.diagnostico ? 'diagnostico' : o.examen ? 'examen' : 'clase')
  const s = lista ? deSesion(lista) : o.diagnostico ? await prepararDiagnostico(db, id, ahora) : await prepararSesionTutor(db, id, { examen: o.examen, ahora, prioridadVisual: 9 })
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
  (db.prepare(`SELECT i, respuesta, correcto, devolucion FROM tutor_turnos WHERE sesion_id = ? AND tipo = 'respuesta' ORDER BY id`).all(sid) as any[]).map((t) => ({ i: t.i, respuesta: t.respuesta, correcto: !!t.correcto, devolucion: t.devolucion }))
export const aclaracionesDe = (db: Db, sid: number) =>
  (db.prepare(`SELECT i, devolucion FROM tutor_turnos WHERE sesion_id = ? AND tipo = 'aclaracion' ORDER BY id`).all(sid) as any[]).map((t) => ({ i: t.i, texto: t.devolucion as string }))

/** Su respuesta a una pregunta: el tutor la corrige contra la clave. La última respuesta a cada pregunta es la que cuenta. */
export async function responderTutor(db: Db, sid: number, i: number, respuesta: string, ahora = Date.now()) {
  const s = leerSesionTutor(db, sid)
  if (!s) throw new Error(`No existe la sesión ${sid}`)
  if (s.estado === 'hecha') throw new Error('Esa sesión ya se cerró')
  const p = s.paquete.preguntas[i]
  if (!p) throw new Error('Esa pregunta no está en la sesión')
  const r = respuesta.trim()
  if (!r) throw new Error('¿Qué respondés?')
  // Socrático: en el primer intento, si se equivoca, el tutor da una pista y no la respuesta; desde el segundo, explica.
  const intento = (db.prepare(`SELECT COUNT(*) AS n FROM tutor_turnos WHERE sesion_id = ? AND i = ? AND tipo = 'respuesta'`).get(sid, i) as { n: number }).n + 1
  const examen = s.tipo !== 'clase'
  const d = await modelo(db, SISTEMA_DEVOLUCION, `${leccionesPara(db, 'pregunta') ? `${leccionesPara(db, 'pregunta')}\n` : ''}Nivel ${s.nivel} (${nombreNivel(s.nivel)}). Tema: ${s.tema}\nPregunta: ${p.pregunta}\nClave: ${p.clave}\nIntento: ${examen ? 2 : intento}${examen ? ' (es una evaluación: corregí sin pistas)' : ''}\nRespuesta del alumno: ${r.slice(0, 2000)}`)
  const correcto = !!d?.correcto
  const pista = !correcto && intento === 1 && !examen
  const devolucion = txt(d?.devolucion, 800) || (correcto ? 'Bien.' : pista ? 'No es eso todavía: volvé a la explicación y probá de nuevo.' : 'No es eso: volvé a la explicación.')
  // La primera respuesta a cada pregunta mueve lo que sabe de su concepto (los reintentos no: ya vio la devolución).
  if (intento === 1 && p.conceptoId) anotarRespuesta(db, p.conceptoId, correcto, ahora)
  // Si el error muestra que le falta un requisito, ese requisito baja un poco (vuelve antes).
  const flojo = !correcto && d?.concepto_flojo ? conceptoPorNombre(db, s.aprendizajeId, String(d.concepto_flojo)) : null
  if (flojo && flojo.id !== p.conceptoId) bajarDominio(db, flojo.id, 0.9)
  db.prepare('INSERT INTO tutor_turnos (sesion_id, i, respuesta, correcto, devolucion, en) VALUES (?, ?, ?, ?, ?, ?)').run(sid, i, r.slice(0, 4000), correcto ? 1 : 0, devolucion, ahora)
  return { i, correcto, devolucion, pista, intento, flojo: flojo?.nombre ?? null }
}

/**
 * «No entendí»: el tutor reexplica un nivel más abajo y con otra analogía (de la explicación, i = -1, o de una pregunta,
 * sin darle la respuesta). Queda en la sesión y baja un poco lo que creía saber de ese concepto.
 */
export async function aclarar(db: Db, sid: number, i = -1, ahora = Date.now()): Promise<{ i: number; texto: string }> {
  const s = leerSesionTutor(db, sid)
  if (!s) throw new Error(`No existe la sesión ${sid}`)
  const p = i >= 0 ? s.paquete.preguntas[i] : null
  if (i >= 0 && !p) throw new Error('Esa pregunta no está en la sesión')
  const nivel = Math.max(1, s.nivel - 1)
  const r = await modelo(db, SISTEMA_ACLARACION, [
    `Explicá al nivel ${nivel} (${nombreNivel(nivel)}): ${NIVELES_TUTOR[nivel - 1].regla}`,
    `Tema: ${s.tema}`,
    p ? `No entendió esta pregunta: ${p.pregunta}` : `No entendió la explicación:\n${s.paquete.explicacion.slice(0, 3000)}`,
    ...aclaracionesDe(db, sid).filter((x) => x.i === i).map((x) => `Ya le dijiste (probá otra cosa): ${x.texto.slice(0, 400)}`),
  ].join('\n'))
  const texto = txt(r?.texto, 2000) || 'Probemos de otra forma: decime qué parte no se entiende y lo vemos.'
  db.prepare(`INSERT INTO tutor_turnos (sesion_id, i, respuesta, correcto, devolucion, tipo, en) VALUES (?, ?, '(no entendí)', 0, ?, 'aclaracion', ?)`).run(sid, i, texto, ahora)
  const cid = p?.conceptoId ?? s.conceptoId
  if (cid) bajarDominio(db, cid, 0.85)
  // Pedir otra explicación es feedback: esa explicación (o esa pregunta) no alcanzó.
  anotarSilencioso(db, { superficie: i >= 0 ? 'pregunta' : 'explicacion', ref: `${sid}:${i}`, valor: -1, nota: `pidió otra explicación (${s.tema})` }, ahora)
  return { i, texto }
}

/** Responder hablando: el audio se transcribe y se corrige como una respuesta escrita (devuelve también lo que entendió). */
export async function responderTutorAudio(db: Db, sid: number, i: number, audio: Buffer, nombre = 'respuesta.webm', ahora = Date.now()) {
  if (audio.length < 1500) throw new Error('El audio quedó vacío')
  const texto = (await transcribir(db, audio, nombre)).trim()
  if (!texto) throw new Error('No se entendió el audio: probá de nuevo, más cerca del micrófono')
  return { ...(await responderTutor(db, sid, i, texto, ahora)), transcripcion: texto }
}

/** En tramos que se dicen bien (hasta ~500 caracteres, cortando en oraciones), sin el markdown ni las citas. */
export function tramosParaDecir(texto: string, largo = 500): string[] {
  const limpio = texto.replace(/\[#\d+\]/g, '').replace(/(^|\s)#{1,6}\s+/g, '$1').replace(/[*_`>]+/g, '').replace(/[ \t]+([.,;:!?])/g, '$1').replace(/\n{2,}/g, '\n').trim()
  const oraciones = limpio.match(/[^.!?\n]+[.!?]*|\n/g)?.map((x) => x.trim()).filter(Boolean) ?? []
  const out: string[] = []
  for (const o of oraciones) {
    const ultimo = out[out.length - 1]
    if (ultimo && (ultimo + ' ' + o).length <= largo) out[out.length - 1] = `${ultimo} ${o}`
    else out.push(o.slice(0, largo))
  }
  return out
}

/** La voz del tutor: la explicación (en tramos), una pregunta, una devolución o una aclaración, como audios listos. */
export async function audiosDe(db: Db, sid: number, que: { parte: 'explicacion' | 'pregunta' | 'texto'; i?: number; texto?: string }): Promise<string[]> {
  const s = leerSesionTutor(db, sid)
  if (!s) throw new Error(`No existe la sesión ${sid}`)
  const texto = que.parte === 'explicacion' ? `${s.paquete.tema}.
${s.paquete.explicacion}`
    : que.parte === 'pregunta' ? s.paquete.preguntas[que.i ?? -1]?.pregunta ?? ''
    : String(que.texto ?? '').slice(0, 3000)
  if (!texto.trim()) throw new Error('No hay nada para decir')
  const urls: string[] = []
  for (const t of tramosParaDecir(texto)) { const u = await hablar(db, t); if (u) urls.push(u) }
  return urls
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
  if (s.tipo === 'diagnostico') return cerrarDiagnostico(db, s, d, ultimos, puntaje, ahora)

  // La pieza: lo que se explicó, lo que respondió y la devolución (es suya: nivel propia).
  asegurarFuente(db, FUENTE)
  const contenido = [
    `# ${s.tipo === 'examen' ? 'Examen' : 'Clase'} de ${d.tema} · nivel ${s.nivel} (${nombreNivel(s.nivel)}) · ${p.tema}`,
    p.explicacion,
    p.ejemplos.length ? `## Ejemplos\n${p.ejemplos.map((e) => `- ${e}`).join('\n')}` : '',
    `## Preguntas\n${p.preguntas.map((q, i) => { const t = ultimos.get(i); return `- ${q.pregunta}${t ? `\n  - Respondí: ${t.respuesta}\n  - ${t.correcto ? '✓' : '✗'} ${t.devolucion ?? ''}` : '\n  - (sin responder)'}` }).join('\n')}`,
    aclaracionesDe(db, sid).length ? `## Lo que no entendí y cómo me lo explicó\n${aclaracionesDe(db, sid).map((a) => `- ${a.i >= 0 ? `(pregunta ${a.i + 1}) ` : ''}${a.texto}`).join('\n')}` : '',
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
      marcarSabidos(db, d.id, d.tutorNivel, SABIDO, ahora)
      subio = true
    }
  } else db.prepare('UPDATE aprendizajes SET tema_idx = tema_idx + 1 WHERE id = ?').run(d.id)
  // Cada concepto que tocó vuelve a repaso cuando le toca (lo que sabe poco, pronto; lo firme, más adelante).
  for (const c of new Set([s.conceptoId, ...p.preguntas.map((q) => q.conceptoId)].filter((x): x is number => !!x))) programarRepaso(db, c, ahora)
  prepararEnFondo(db, d.id)
  if (s.tipo === 'clase') proyectoEnFondo(db, d.id)
  // Al subir de nivel, material del nivel nuevo (más avanzado).
  if (subio) buscarFuentesEnFondo(db, d.id)
  const fallidas = p.preguntas.filter((_, i) => !ultimos.get(i)?.correcto).map((q) => q.pregunta)
  return { puntaje, piezaId, quantomos: quantomos.length, tarjetas, subio, nivel: leerDominio(db, d.id)!.tutorNivel, examen: examenHabilitado(db, d.id), repasar: s.tipo === 'examen' && !subio ? fallidas : [] }
}

/**
 * El diagnóstico: el nivel es el de la última pregunta bien respondida antes del segundo error (las que no respondió
 * cuentan como «no sé»). Lo de abajo queda sabido (y vuelve pronto a repaso para confirmarlo); el tutor arranca ahí.
 */
function cerrarDiagnostico(db: Db, s: SesionTutor, d: Dominio, ultimos: Map<number, { correcto: boolean }>, puntaje: number, ahora: number) {
  let nivel = 0
  let errores = 0
  s.paquete.preguntas.forEach((q, i) => {
    if (errores >= 2) return
    if (ultimos.get(i)?.correcto) nivel = Math.max(nivel, q.nivel ?? i + 1)
    else errores++
  })
  const nuevo = Math.max(1, Math.min(6, nivel || 1))
  db.prepare(`UPDATE tutor_sesiones SET estado = 'hecha', puntaje = ?, cerrada_en = ? WHERE id = ?`).run(puntaje, ahora, s.id)
  db.prepare('UPDATE aprendizajes SET tutor_nivel = ?, tema_idx = 0, diagnostico_en = ? WHERE id = ?').run(nuevo, ahora, d.id)
  if (nuevo > 1) marcarSabidos(db, d.id, nuevo - 1, SABIDO, ahora)
  prepararEnFondo(db, d.id)
  return { puntaje, piezaId: null, quantomos: 0, tarjetas: 0, subio: nuevo > d.tutorNivel, nivel: nuevo, nivelNombre: nombreNivel(nuevo), examen: examenHabilitado(db, d.id), repasar: [] as string[], diagnostico: true }
}

/** Sumar un dominio a la Academia (si ya estaba sugerido o pausado, se activa). */
export function sumarDominio(db: Db, a: { tema: string; porQue?: string | null }, ahora = Date.now()) {
  const r = crearAprendizaje(db, { tema: a.tema, porQue: a.porQue }, ahora)
  if (!r.nuevo && r.estado !== 'activo') db.prepare(`UPDATE aprendizajes SET estado = 'activo', por_que = COALESCE(?, por_que) WHERE id = ?`).run(a.porQue?.trim() || null, r.id)
  if (r.nuevo || r.estado !== 'activo') alAceptar(db, leerDominio(db, r.id)!)
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
  let huecos = ''
  try { const h = await import('./huecos.ts'); huecos = h.huecosParaPrompt(await h.huecosDeMetas(db, ahora)) } catch { /* sin vectores */ }
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
    huecos,
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
  const datos = await modelo(db, SISTEMA_SUGERIR(n), [await contextoSugerir(db, ahora), leccionesPara(db, 'sugerencia')].filter(Boolean).join('\n\n'))
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

/** Lo que pasa al aceptar un dominio: sale a buscar sus primeras fuentes (en la nube). */
let alAceptar: (db: Db, d: Dominio) => void = (db, d) => buscarFuentesEnFondo(db, d.id)
export function _alAceptar(f: typeof alAceptar) { alAceptar = f }

/** Aceptar una sugerencia: pasa a ser un dominio activo, con su entidad, su primera clase (de fondo) y sus fuentes. */
export async function aceptarSugerencia(db: Db, id: number, ahora = Date.now()): Promise<Dominio> {
  const d = leerDominio(db, id)
  if (!d || d.estado !== 'sugerido') throw new Error('Esa sugerencia ya no está')
  db.prepare(`UPDATE aprendizajes SET estado = 'activo', creado_en = ? WHERE id = ?`).run(ahora, id)
  anotar(db, 'aprender', id, 'aceptada', { ahora })
  anotarSilencioso(db, { superficie: 'sugerencia', ref: id, valor: 1, nota: `aceptó: ${d.tema}${(d.sugerencia as any)?.porQue ? ` (${(d.sugerencia as any).porQue})` : ''}` }, ahora)
  try { (await import('./entidades.ts')).asegurarPorNombre(db, d.tema, 'dominio', ahora) } catch { /* el grafo es un plus */ }
  // Si vino con fecha (un evento), queda como meta: llegar al nivel siguiente para ese día.
  const fecha = (d.sugerencia as any)?.fecha
  if (typeof fecha === 'string' && fecha >= fechaLocal(ahora)) { try { (await import('./conceptos.ts')).fijarMeta(db, d, { fecha, nivel: d.tutorNivel + 1 }, ahora) } catch { /* una fecha rara: sin meta */ } }
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
  anotar(db, 'aprender', id, 'rechazada')
  anotarSilencioso(db, { superficie: 'sugerencia', ref: id, valor: -1, nota: `descartó: ${d.tema}${(d.sugerencia as any)?.porQue ? ` (${(d.sugerencia as any).porQue})` : ''}` })
  return { ok: true }
}

/** El texto de una sugerencia para la bandeja y el aviso: por qué, para qué y cuándo. */
export const textoSugerencia = (d: Dominio) => {
  const s = (d.sugerencia ?? {}) as { porQue?: string; horizonte?: string; para?: string; fecha?: string }
  return [s.porQue ?? d.porQue, s.para ? `para ${s.para}${s.fecha ? ` (${s.fecha})` : ''}` : s.fecha ?? null, s.horizonte ? `${s.horizonte} plazo` : null].filter(Boolean).join(' · ')
}

// ─── el corpus crece por dominio: fuentes para aprender ─────────────────

const SISTEMA_FUENTES = (n: number) => `Escribís las búsquedas web para encontrar material para APRENDER un tema al nivel ${n} (${NIVELES_TUTOR[n - 1].nombre}).
- 3 o 4 consultas cortas, como las escribiría alguien que busca aprender: ${n <= 2 ? 'introducciones claras, explicaciones visuales, cursos para principiantes, videos' : n <= 4 ? 'tutoriales prácticos, cursos completos, documentación, proyectos de ejemplo' : 'papers, revisiones del estado del arte, repositorios, documentación técnica, charlas de expertos'}.
- Mezclá castellano e inglés (en inglés suele haber más). Nada de lo que ya tiene.
Forma: {"consultas": [string]}`

/** Buscar y guardar (inyectables para tests: sin red). */
let buscador = async (db: Db, q: string, ahora: number): Promise<{ titulo: string; url: string }[]> => (await import('./web.ts')).buscarWeb(db, q, { n: 6, ahora })
let guardador = async (db: Db, url: string, nota: string, ahora: number) => (await import('./lector/index.ts')).guardarLink(db, url, { nota, ahora })
export function _probarFuentes(o: { buscador?: typeof buscador; guardador?: typeof guardador }) {
  if (o.buscador) buscador = o.buscador
  if (o.guardador) guardador = o.guardador
}

export const MAX_FUENTES = 5

/**
 * Sale a buscar material para un dominio, a su nivel: el modelo escribe las búsquedas, el buscador las corre y se guardan
 * hasta 5 links nuevos (solo URLs que volvieron de la búsqueda, una de cada consulta por vuelta para que haya variedad).
 * Entran al corpus como cualquier link (YouTube va a su cola) y el Reproceso los destila.
 */
export async function buscarFuentes(db: Db, id: number, o: { ahora?: number; concepto?: string | null } = {}): Promise<{ nuevas: { piezaId: number; titulo: string; url: string }[]; consultas: string[]; aviso: string | null; concepto: string | null }> {
  const ahora = o.ahora ?? Date.now()
  const d = leerDominio(db, id)
  if (!d) throw new Error(`No existe el dominio ${id}`)
  const { topeAlcanzado } = await import('./nan.ts')
  const tope = topeAlcanzado(db, ahora)
  if (tope) return { nuevas: [], consultas: [], aviso: tope, concepto: null }
  const r = recursosDe(db, d.tema)
  const ya = [...r.obras.map((x) => x.titulo), ...materialDe(db, id).map((m) => m.titulo)]
  // Si hay un concepto de su nivel sin material (un hueco), la búsqueda va por ese.
  const concepto = o.concepto ?? conceptosDe(db, id).find((x) => x.sinMaterial === true && x.nivel >= d.tutorNivel && dominioHoy(x, ahora) < SABIDO)?.nombre ?? null
  const c = await modelo(db, SISTEMA_FUENTES(d.tutorNivel), [leccionesPara(db, 'fuente'), `Tema: ${d.tema}`, concepto ? `Concepto puntual que le falta (buscá material sobre ESTO): ${concepto}` : '', d.porQue ? `Para qué: ${d.porQue}` : '', ya.length ? `Ya tiene: ${ya.slice(0, 15).join(' · ')}` : ''].filter(Boolean).join('\n'))
  const consultas = (Array.isArray(c?.consultas) ? c.consultas : []).map((x: unknown) => txt(x, 160)).filter(Boolean).slice(0, 4) as string[]
  const listas: { titulo: string; url: string }[][] = []
  for (const q of consultas) {
    try { listas.push((await buscador(db, q, ahora)).filter((x) => /^https?:\/\//.test(x.url))) } catch { listas.push([]) }
  }
  // De a una por consulta, por vuelta: lo primero de cada búsqueda antes que lo segundo de una sola.
  const orden: { titulo: string; url: string }[] = []
  const vistas = new Set<string>()
  for (let i = 0; i < 6; i++) for (const l of listas) if (l[i] && !vistas.has(l[i].url)) { vistas.add(l[i].url); orden.push(l[i]) }
  const nuevas: { piezaId: number; titulo: string; url: string }[] = []
  for (const x of orden) {
    if (nuevas.length >= MAX_FUENTES) break
    try {
      const g = await guardador(db, x.url, `Fuente para aprender ${d.tema} (nivel ${d.tutorNivel}, ${nombreNivel(d.tutorNivel)})`, ahora)
      atarFuente(db, id, { piezaId: g.piezaId, origen: 'busqueda' }, ahora)
      if (g.nueva) nuevas.push({ piezaId: g.piezaId, titulo: x.titulo, url: x.url })
    } catch { /* una página que no se deja leer: la siguiente */ }
  }
  db.prepare('UPDATE aprendizajes SET fuentes_en = ? WHERE id = ?').run(ahora, id)
  const { hayBuscadorWeb } = await import('./web.ts')
  if (concepto && nuevas.length) db.prepare('UPDATE conceptos SET sin_material = NULL WHERE aprendizaje_id = ? AND nombre = ?').run(id, concepto) // se vuelve a medir
  return { nuevas, consultas, concepto, aviso: !orden.length ? (hayBuscadorWeb() ? 'La búsqueda no trajo nada.' : 'Sin clave de buscador solo hay Wikipedia.') : null }
}

/** De fondo y solo en la nube (gasta tokens y cuota del buscador). */
export function buscarFuentesEnFondo(db: Db, id: number) {
  if (!nube()) return
  buscarFuentes(db, id).catch((e) => console.error('  academia: fuentes:', e instanceof Error ? e.message : e))
}

/** Para la rutina diaria: el dominio activo con la búsqueda más vieja (o que nunca buscó). */
export function dominioParaFuentes(db: Db, ahora = Date.now()): Dominio | null {
  const idiomas = `SELECT aprendizaje_id FROM idiomas`
  const r = db.prepare(`SELECT id FROM aprendizajes WHERE estado = 'activo' AND id NOT IN (${idiomas}) AND (fuentes_en IS NULL OR fuentes_en < ?) ORDER BY fuentes_en IS NOT NULL, fuentes_en, id LIMIT 1`).get(ahora - 6 * 86_400_000) as { id: number } | undefined
  return r ? leerDominio(db, r.id) : null
}

// ─── el material de cada dominio (plan v24): atado a él y leído por sentido ─

const FUENTE_MATERIAL = { id: 'material', nombre: 'Material para aprender', nivel: 'primaria' as const, descripcion: 'Libros, textos, links y archivos que sumó a un dominio de su Academia.' }

export type Material = { id: number; piezaId: number | null; obraId: number | null; origen: string; util: number | null; titulo: string; url: string | null; palabras: number | null; en: number }

/** Ata una pieza (o una obra) a un dominio. Lo mismo dos veces no se duplica. */
export function atarFuente(db: Db, aprendizajeId: number, f: { piezaId?: number | null; obraId?: number | null; origen: 'busqueda' | 'operador' | 'libro' }, ahora = Date.now()) {
  if (!f.piezaId && !f.obraId) return
  db.prepare('INSERT OR IGNORE INTO dominio_fuentes (aprendizaje_id, pieza_id, obra_id, origen, en) VALUES (?, ?, ?, ?, ?)').run(aprendizajeId, f.piezaId ?? null, f.piezaId ? null : f.obraId ?? null, f.origen, ahora)
}

/** El material de un dominio: lo suyo primero, después lo que encontró la búsqueda; lo que no sirve, al final. */
export function materialDe(db: Db, id: number): Material[] {
  return (db.prepare(`SELECT f.id, f.pieza_id, f.obra_id, f.origen, f.util, f.en, COALESCE(c.titulo, o.titulo, '(sin título)') AS titulo, COALESCE(c.url, o.url) AS url,
      CASE WHEN c.contenido IS NULL THEN NULL ELSE (LENGTH(c.contenido) - LENGTH(REPLACE(c.contenido, ' ', '')) + 1) END AS palabras
    FROM dominio_fuentes f LEFT JOIN corpus c ON c.id = f.pieza_id LEFT JOIN obras o ON o.id = f.obra_id
    WHERE f.aprendizaje_id = ? ORDER BY COALESCE(f.util, 0) = -1, f.origen = 'busqueda', f.en DESC`).all(id) as any[])
    .map((r) => ({ id: r.id, piezaId: r.pieza_id, obraId: r.obra_id, origen: r.origen, util: r.util, titulo: r.titulo, url: r.url, palabras: r.palabras, en: r.en }))
}

/**
 * Él suma material a un dominio: un link (se lee entero), un texto pegado, un archivo ya subido (PDF, Word…) o una obra de
 * su Librería. Entra al corpus como material (nivel primaria: no es su voz) y queda atado al dominio; el Reproceso lo
 * corta en pasajes con vector y el tutor lo usa en las clases.
 */
export async function sumarMaterial(db: Db, id: number, m: { url?: string | null; texto?: string | null; titulo?: string | null; archivo?: string | null; nombre?: string | null; obraId?: number | null }, ahora = Date.now()): Promise<Material[]> {
  const d = leerDominio(db, id)
  if (!d) throw new Error(`No existe el dominio ${id}`)
  const nota = `Material para aprender ${d.tema}`
  if (m.url?.trim()) {
    if (!/^https?:\/\//i.test(m.url.trim())) throw new Error('Eso no parece un link')
    const g = await guardador(db, m.url.trim(), nota, ahora)
    atarFuente(db, id, { piezaId: g.piezaId, origen: 'operador' }, ahora)
  } else if (m.obraId) {
    const o = db.prepare('SELECT id, piezas FROM obras WHERE id = ?').get(m.obraId) as { id: number; piezas: string | null } | undefined
    if (!o) throw new Error('Esa obra ya no está en tu Librería')
    const piezas = json<number[]>(o.piezas, []) ?? []
    for (const p of piezas) atarFuente(db, id, { piezaId: p, origen: 'libro' }, ahora)
    if (!piezas.length) atarFuente(db, id, { obraId: o.id, origen: 'libro' }, ahora)
  } else {
    let texto = m.texto?.trim() ?? ''
    let titulo = m.titulo?.trim() || ''
    if (m.archivo) {
      const { textoDeArchivo } = await import('./chat/adjuntos.ts')
      texto = textoDeArchivo(m.archivo).trim()
      titulo ||= (m.nombre ?? 'Archivo').replace(/\.[a-z0-9]+$/i, '')
      if (!texto) throw new Error('Ese archivo no trae texto (¿es un escaneo?): pasalo como imagen al chat o buscá una versión con texto')
    }
    if (texto.length < 40) throw new Error('Pegá un poco más de texto (o un link, o un archivo)')
    asegurarFuente(db, FUENTE_MATERIAL)
    const origenId = `material:${crypto.createHash('sha1').update(texto).digest('hex').slice(0, 16)}`
    const nueva = insertar(db, {
      fuente: FUENTE_MATERIAL.id, nivel: 'primaria', titulo: (titulo || texto.split('\n')[0]).slice(0, 160), contenido: texto, estado: 'disponible', url: m.archivo ?? null,
      fecha: fechaLocal(ahora), origenId, etiquetas: ['aprendizaje', d.tema], meta: { tipo: 'material', dominio: d.id, nota },
    }, ahora)
    const piezaId = nueva ?? (db.prepare('SELECT id FROM corpus WHERE origen_id = ?').get(origenId) as { id: number }).id
    atarFuente(db, id, { piezaId, origen: m.archivo ? 'libro' : 'operador' }, ahora)
  }
  return materialDe(db, id)
}

/** Sirve (1), no sirve (−1) o sin opinión (0); o quitarlo del dominio (la pieza sigue en el corpus). */
export function marcarMaterial(db: Db, id: number, fid: number, c: { util?: number; quitar?: boolean }) {
  if (c.quitar) db.prepare('DELETE FROM dominio_fuentes WHERE id = ? AND aprendizaje_id = ?').run(fid, id)
  else {
    db.prepare('UPDATE dominio_fuentes SET util = ? WHERE id = ? AND aprendizaje_id = ?').run(c.util ? Math.sign(c.util) : null, fid, id)
    const m = materialDe(db, id).find((x) => x.id === fid)
    if (m && c.util) anotarSilencioso(db, { superficie: 'fuente', ref: m.piezaId ?? `obra:${m.obraId}`, valor: Math.sign(c.util), nota: `${c.util > 0 ? 'sirve' : 'no sirve'}: ${m.titulo}${m.url ? ` (${m.url})` : ''}` })
  }
  return materialDe(db, id)
}

const significativas = (s: string) => normTema(s).split(' ').filter((w) => w.length >= 4 && !/^(para|como|sobre|desde|entre|nivel|prueba)$/.test(w))

/**
 * Lo relacionado del resto del corpus: por sentido (vectores) si hay; si no, solo lo que nombra TODAS las palabras
 * importantes del tema (la búsqueda por palabras sola trae «Pruebas cosmológicas» para «Electricidad (prueba)»).
 */
async function relacionadas(db: Db, consulta: string, tema: string, excluir: Set<number>, limite: number): Promise<PiezaHallada[]> {
  const sirve = (p: Pieza | null): p is Pieza => !!p && !excluir.has(p.id) && p.nivel !== 'generada' && p.contenido.length >= 200 && !String((p.meta as any)?.tipo ?? '').startsWith('academia')
  // Por sentido: solo lo de verdad cerca (con 0,25 entra cualquier cuaderno); el corte también es relativo al mejor.
  let cerca: { id: number; sim: number; desde?: number; hasta?: number }[] = []
  try { cerca = await cercanas(db, consulta.replace(/\([^)]*\)/g, ' ').trim(), limite * 6) } catch { /* sin red */ }
  const porSentido: PiezaHallada[] = []
  let tope = 0
  for (const x of cerca.filter((c) => c.sim >= UMBRAL_SENTIDO)) {
    const p = leerPieza(db, x.id)
    if (sirve(p)) tope ||= x.sim
    if (sirve(p) && x.sim >= tope * 0.93) porSentido.push({ ...p, por: 'sentido', sim: +x.sim.toFixed(3), fragmento: x.desde ? p.contenido.slice(x.desde, x.hasta) : undefined } as PiezaHallada)
  }
  // Por palabras: solo lo que nombra TODAS las palabras importantes del tema.
  const palabras = significativas(tema)
  let porPalabras: Pieza[] = []
  if (palabras.length) { try { porPalabras = buscar(db, palabras.join(' '), limite * 4) } catch { /* consulta rara */ } }
  porPalabras = porPalabras.filter((p) => sirve(p) && palabras.every((w) => normTema(`${p.titulo} ${p.contenido.slice(0, 4000)}`).includes(w)))
  const vistos = new Set<number>()
  return [...porSentido, ...porPalabras.map((p) => ({ ...p, por: 'palabras' }))].filter((p) => !vistos.has(p.id) && vistos.add(p.id)).slice(0, limite)
}

/**
 * Desde qué parecido (coseno, qwen3) algo del archivo «habla de lo mismo» que el tema. Medido sobre un archivo real, con
 * el tema solo como consulta: lo ajeno ronda 0,48-0,52 y lo relacionado 0,53-0,56 (una palabra sola da poca señal; el
 * material propio del dominio es lo que de verdad guía). Las hojas casi vacías se parecen a todo: se piden 200 caracteres.
 */
export const UMBRAL_SENTIDO = 0.53

/** Los recursos de un dominio, para la pantalla: su material, las obras de la Librería y lo relacionado del corpus. */
export async function recursosDominio(db: Db, d: Dominio) {
  const material = materialDe(db, d.id)
  const atadas = new Set(material.map((m) => m.piezaId).filter((x): x is number => x != null))
  const piezas = (await relacionadas(db, d.tema, d.tema, atadas, 6)).map((p) => ({ id: p.id, titulo: p.titulo, nivel: p.nivel, por: p.por ?? 'palabras', sim: (p as any).sim ?? null, largo: p.contenido.length }))
  return { material, obras: recursosDe(db, d.tema).obras, piezas }
}

/**
 * El material para una clase: los pasajes más cercanos al tema, primero de lo atado al dominio (sin lo marcado «no
 * sirve») y después del resto del corpus (solo por sentido). Cada uno con su [#id] para que el tutor cite.
 */
export async function materialParaClase(db: Db, d: Dominio, tema: string): Promise<{ texto: string; ids: number[] }> {
  const material = materialDe(db, d.id)
  const atadas = new Set(material.filter((m) => m.piezaId != null && m.util !== -1).map((m) => m.piezaId!))
  const malas = new Set(material.filter((m) => m.util === -1 && m.piezaId != null).map((m) => m.piezaId!))
  const consulta = `${tema} — ${d.tema}`
  let hall: PiezaHallada[] = []
  try { hall = await buscarHibrido(db, consulta, 24) } catch { /* consulta rara para FTS */ }
  hall = hall.filter((p) => !malas.has(p.id) && p.nivel !== 'generada')
  const propias: PiezaHallada[] = hall.filter((p) => atadas.has(p.id)).slice(0, 3)
  if (!propias.length && atadas.size) {
    // Sin vectores todavía (recién sumado): lo del material que nombra el tema; si nada, lo último que sumó.
    let porPalabras: Pieza[] = []
    try { porPalabras = buscar(db, tema, 40).filter((p) => atadas.has(p.id)) } catch { /* consulta rara */ }
    const ultima = [...atadas].map((x) => leerPieza(db, x)).find(Boolean)
    propias.push(...(porPalabras.length ? porPalabras.slice(0, 2) : ultima ? [ultima] : []))
  }
  const otras = (await relacionadas(db, consulta, d.tema, new Set([...atadas, ...malas]), 2)).filter((p) => p.por === 'sentido')
  const bloque = (p: PiezaHallada, de: string) => `[#${p.id}] ${p.titulo} (${de})\n${(p.fragmento ?? p.contenido).replace(/\s+/g, ' ').slice(0, 1400)}`
  const partes = [...propias.map((p) => bloque(p, 'su material')), ...otras.map((p) => bloque(p, 'su archivo'))]
  return { texto: partes.join('\n\n'), ids: [...propias, ...otras].map((p) => p.id) }
}

// ─── el reporte de huecos (semanal, en la nube) ─────────────────────────

const SISTEMA_HUECOS = `Sos Mastropiero mirando dónde no alcanza su información. Te paso los huecos medidos (lo que sus metas y sus dominios piden y su archivo casi no tiene, y lo que falla seguido). Para cada uno, UNA idea concreta de qué hacer: qué material sumar (un libro, un tipo de fuente, una persona a quien preguntar), qué aprender o qué pregunta hacerse. Corto, de usted, sin relleno. Si dos huecos se resuelven juntos, decilo.
Forma: {"ideas": [{"hueco": string, "idea": string}]}`

/** Lo que te falta: los huecos de sus metas y de sus dominios, con una idea para cada uno. null si no hay nada que decir. */
export async function reporteHuecos(db: Db, ahora = Date.now()): Promise<{ texto: string; ideas: { hueco: string; idea: string }[] } | null> {
  const h = await import('./huecos.ts')
  const metas = (await h.huecosDeMetas(db, ahora)) ?? []
  const dominios: string[] = []
  for (const x of listarDominios(db, ahora).filter((y) => y.estado === 'activo' && !y.idioma)) {
    const r = await h.huecosDeDominio(db, { id: x.id, tema: x.tema, tutorNivel: x.tutorNivel }, ahora)
    if (r.sinMaterial.length) dominios.push(`[${x.tema}] sin material: ${r.sinMaterial.map((c) => c.nombre).join(', ')}`)
    if (r.flojos.length) dominios.push(`[${x.tema}] falla seguido: ${r.flojos.map((c) => c.nombre).join(', ')}`)
    for (const b of r.bloqueantes) dominios.push(`[${x.tema}] «${b.concepto.nombre}» frena a ${b.frena.join(', ')}`)
  }
  if (!metas.length && !dominios.length) return null
  const r = await modelo(db, SISTEMA_HUECOS, [metas.length ? h.huecosParaPrompt(metas) : '', dominios.length ? `En su Academia:\n${dominios.map((x) => `- ${x}`).join('\n')}` : ''].filter(Boolean).join('\n\n'))
  const ideas = (Array.isArray(r?.ideas) ? r.ideas : []).map((x: any) => ({ hueco: txt(x?.hueco, 200), idea: txt(x?.idea, 400) })).filter((x: { hueco: string; idea: string }) => x.hueco && x.idea).slice(0, 8)
  const texto = `🕳 **Lo que le falta** (donde su información no alcanza):\n${ideas.length ? ideas.map((x: { hueco: string; idea: string }) => `- **${x.hueco}**: ${x.idea}`).join('\n') : [...metas.map((m) => `- ${m.texto}`), ...dominios.map((x) => `- ${x}`)].slice(0, 10).join('\n')}`
  return { texto, ideas }
}

// ─── el proyecto de cada nivel (plan v24) ───────────────────────────────

/** Desde este nivel el proyecto es requisito del examen (antes, opcional). */
export const NIVEL_PROYECTO_OBLIGATORIO = 4

export type Proyecto = {
  id: number; aprendizajeId: number; nivel: number; titulo: string; objetivo: string | null; pasos: string[]; entregable: string | null; criterio: string | null
  estado: 'propuesto' | 'aceptado' | 'aprobado' | 'rehacer' | 'descartado'; misionId: number | null; entrega: string | null; devolucion: string | null; piezaId: number | null; creadoEn: number; cerradoEn: number | null
}
const deProyecto = (r: any): Proyecto => ({
  id: r.id, aprendizajeId: r.aprendizaje_id, nivel: r.nivel, titulo: r.titulo, objetivo: r.objetivo, pasos: json<string[]>(r.pasos, []) ?? [], entregable: r.entregable, criterio: r.criterio,
  estado: r.estado, misionId: r.mision_id, entrega: r.entrega, devolucion: r.devolucion, piezaId: r.pieza_id, creadoEn: r.creado_en, cerradoEn: r.cerrado_en,
})
export const leerProyecto = (db: Db, pid: number) => { const r = db.prepare('SELECT * FROM tutor_proyectos WHERE id = ?').get(pid); return r ? deProyecto(r) : null }
/** El proyecto vigente del nivel (el último que no se descartó). */
export const proyectoDe = (db: Db, id: number, nivel: number): Proyecto | null => {
  const r = db.prepare(`SELECT * FROM tutor_proyectos WHERE aprendizaje_id = ? AND nivel = ? AND estado != 'descartado' ORDER BY id DESC LIMIT 1`).get(id, nivel)
  return r ? deProyecto(r) : null
}
export const proyectoAprobado = (db: Db, id: number, nivel: number) => !!db.prepare(`SELECT 1 FROM tutor_proyectos WHERE aprendizaje_id = ? AND nivel = ? AND estado = 'aprobado'`).get(id, nivel)

const SISTEMA_PROYECTO = (n: number) => `${REGLAS}
Proponés UN proyecto práctico para cerrar el nivel ${n} (${nombreNivel(n)}): algo que haga con las manos o en la compu, en 1 a 4 horas, que use lo que aprendió en este nivel y que deje algo que se pueda mostrar (una foto, un número medido, un archivo, un link). Concreto y alcanzable con lo que tiene; si sirve a para qué lo aprende, mejor.
- pasos: 3 a 6, cortos.
- entregable: qué tiene que mandar (ej.: «una foto del circuito armado y la corriente que midió»).
- criterio: cómo se sabe que está bien (lo que el tutor va a mirar al corregir).
Forma: {"titulo": string, "objetivo": string, "pasos": [string], "entregable": string, "criterio": string}`

const SISTEMA_EVALUAR = `${REGLAS}
Corregís la entrega de un proyecto contra su criterio. «aprobado» si cumple lo central del criterio (no hace falta perfección). La devolución: qué está bien, qué mejorar y, si no se aprueba, qué tiene que rehacer o mostrar. Si la entrega no permite saberlo (falta la medición, la foto no se describe), pedilo.
Forma: {"aprobado": boolean, "devolucion": string}`

/** ¿Ya va por la mitad del nivel? Entonces toca el proyecto (si no hay uno vigente). */
function tocaProyecto(db: Db, id: number, nivel: number, ahora = Date.now()) {
  const cs = conceptosDe(db, id).filter((c) => c.nivel === nivel)
  return cs.length > 0 && cs.filter((c) => dominioHoy(c, ahora) >= SABIDO).length >= Math.ceil(cs.length / 2) && !proyectoDe(db, id, nivel)
}

/** El tutor propone el proyecto del nivel (o uno nuevo, si pidió otro). */
export async function proponerProyecto(db: Db, id: number, ahora = Date.now()): Promise<Proyecto> {
  const d = leerDominio(db, id)
  if (!d) throw new Error(`No existe el dominio ${id}`)
  const n = d.tutorNivel
  const anterior = proyectoDe(db, id, n)
  if (anterior && anterior.estado !== 'propuesto') throw new Error('El proyecto de este nivel ya está en marcha')
  const sabidos = conceptosDe(db, id).filter((c) => c.nivel <= n && dominioHoy(c, ahora) >= SABIDO).map((c) => c.nombre)
  const r = await modelo(db, SISTEMA_PROYECTO(n), contexto(db, d, [sabidos.length ? `Lo que ya sabe: ${sabidos.join(' · ')}` : '', anterior ? `No le gustó este (proponé otra cosa): ${anterior.titulo}` : '']))
  const titulo = txt(r?.titulo, 120)
  if (!titulo) throw new Error('El tutor no armó el proyecto: probá de nuevo')
  if (anterior) {
    db.prepare(`UPDATE tutor_proyectos SET estado = 'descartado' WHERE id = ?`).run(anterior.id)
    anotarSilencioso(db, { superficie: 'proyecto', ref: anterior.id, valor: -1, nota: `pidió otro en vez de «${anterior.titulo}»` }, ahora)
  }
  const pid = Number(db.prepare('INSERT INTO tutor_proyectos (aprendizaje_id, nivel, titulo, objetivo, pasos, entregable, criterio, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, n, titulo, txt(r.objetivo, 600) || null, JSON.stringify((Array.isArray(r.pasos) ? r.pasos : []).map((x: unknown) => txt(x, 300)).filter(Boolean).slice(0, 8)), txt(r.entregable, 400) || null, txt(r.criterio, 600) || null, ahora).lastInsertRowid)
  return leerProyecto(db, pid)!
}

/** En la nube, al llegar a la mitad del nivel el proyecto se propone solo. */
export function proyectoEnFondo(db: Db, id: number) {
  const d = leerDominio(db, id)
  if (!d || !nube() || !tocaProyecto(db, id, d.tutorNivel)) return
  proponerProyecto(db, id).catch((e) => console.error('  academia: proyecto:', e instanceof Error ? e.message : e))
}

/** Aceptarlo: queda como primaria de la semana (con la entidad del dominio), para hacerlo de verdad. */
export async function aceptarProyecto(db: Db, pid: number, ahora = Date.now()): Promise<Proyecto> {
  const p = leerProyecto(db, pid)
  if (!p || p.estado !== 'propuesto') throw new Error('Ese proyecto ya no está para aceptar')
  const d = leerDominio(db, p.aprendizajeId)!
  const { crearMision, semanaDe } = await import('./misiones.ts')
  let entidadId: number | null = null
  try { entidadId = (await import('./entidades.ts')).asegurarPorNombre(db, d.tema, 'dominio', ahora) } catch { /* sin entidad */ }
  const m = crearMision(db, {
    personaje: 'jugador', asignadaPor: 'academia', nivel: 'primaria', titulo: `Proyecto de ${d.tema}: ${p.titulo}`, semana: semanaDe(ahora), estado: 'activa', entidadId, creadaPor: 'academia',
    detalle: [p.objetivo, p.pasos.length ? `Pasos: ${p.pasos.map((x, i) => `${i + 1}) ${x}`).join(' ')}` : '', p.entregable ? `Entregá: ${p.entregable}` : '', p.criterio ? `Está bien si: ${p.criterio}` : ''].filter(Boolean).join('\n'),
  }, { por: 'academia', ahora })
  db.prepare(`UPDATE tutor_proyectos SET estado = 'aceptado', mision_id = ? WHERE id = ?`).run(m.id, pid)
  anotarSilencioso(db, { superficie: 'proyecto', ref: pid, valor: 1, nota: `aceptó «${p.titulo}»` }, ahora)
  return leerProyecto(db, pid)!
}

/**
 * La entrega: el tutor la corrige contra el criterio. Queda como pieza propia (evidencia de lo que hizo); si se aprueba,
 * la primaria se cierra hecha; si no, dice qué rehacer y se puede volver a entregar.
 */
export async function entregarProyecto(db: Db, pid: number, e: { texto: string; url?: string | null }, ahora = Date.now()) {
  const p = leerProyecto(db, pid)
  if (!p || (p.estado !== 'aceptado' && p.estado !== 'rehacer' && p.estado !== 'propuesto')) throw new Error('Ese proyecto no está para entregar')
  const texto = e.texto.trim()
  if (texto.length < 10) throw new Error('Contá qué hiciste y qué salió (y el link o la foto, si hay)')
  const d = leerDominio(db, p.aprendizajeId)!
  const entrega = [texto, e.url ? `Link: ${e.url}` : ''].filter(Boolean).join('\n')
  const r = await modelo(db, SISTEMA_EVALUAR, [`Proyecto: ${p.titulo} (nivel ${p.nivel}, ${nombreNivel(p.nivel)})`, p.objetivo ? `Objetivo: ${p.objetivo}` : '', p.entregable ? `Entregable pedido: ${p.entregable}` : '', `Criterio: ${p.criterio ?? 'que cumpla el objetivo'}`, `Lo que entregó:\n${entrega.slice(0, 4000)}`].filter(Boolean).join('\n'))
  const aprobado = !!r?.aprobado
  const devolucion = txt(r?.devolucion, 1200) || (aprobado ? 'Aprobado.' : 'Todavía no: mirá el criterio y volvé a entregar.')
  asegurarFuente(db, FUENTE)
  const piezaId = insertar(db, {
    fuente: FUENTE.id, nivel: 'propia', titulo: `${d.tema} · Proyecto del nivel ${p.nivel}: ${p.titulo}`, estado: 'disponible', fecha: fechaLocal(ahora), url: e.url ?? null,
    contenido: [`# Proyecto: ${p.titulo}`, p.objetivo ?? '', `## Lo que hice\n${entrega}`, `## Devolución del tutor (${aprobado ? 'aprobado' : 'a rehacer'})\n${devolucion}`].filter(Boolean).join('\n\n'),
    origenId: `academia:proyecto:${pid}:${crypto.createHash('sha1').update(entrega).digest('hex').slice(0, 12)}`, // cada entrega distinta, su pieza etiquetas: ['aprendizaje', d.tema, 'proyecto'], meta: { tipo: 'academia_proyecto', dominio: d.id, nivel: p.nivel, aprobado },
  }, ahora)
  db.prepare('UPDATE tutor_proyectos SET estado = ?, entrega = ?, devolucion = ?, pieza_id = ?, cerrado_en = ? WHERE id = ?').run(aprobado ? 'aprobado' : 'rehacer', entrega, devolucion, piezaId, aprobado ? ahora : null, pid)
  if (aprobado && p.misionId) {
    try { (await import('./misiones.ts')).actualizarMision(db, p.misionId, { estado: 'hecha', feedback: devolucion.slice(0, 300) }, { por: 'academia', ahora }) } catch { /* la misión ya no está */ }
  }
  registrarPractica(db, { aprendizajeId: d.id, minutos: null, que: `Proyecto nivel ${p.nivel}: ${p.titulo}`, fuente: 'academia' }, ahora)
  return { ...leerProyecto(db, pid)!, aprobado, examen: examenHabilitado(db, d.id) }
}

/** Descartar el propuesto (el tutor puede proponer otro). */
export function descartarProyecto(db: Db, pid: number) {
  db.prepare(`UPDATE tutor_proyectos SET estado = 'descartado' WHERE id = ? AND estado = 'propuesto'`).run(pid)
  return { ok: true }
}
