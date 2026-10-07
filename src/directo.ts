/**
 * El Directo: Mastropiero mira y escucha mientras el jugador trabaja, a demanda (solo cuando lo prende).
 * La pantalla llega en cuadros (el navegador manda uno cada tanto, si cambió algo): la visión anota qué app,
 * qué hace y de qué trata. El audio llega en tramos: su voz (micrófono) y lo que escucha (el audio de la pantalla:
 * videos, música). Al cerrar, un informe: tiempos, ideas, tareas, lo que consumió y qué tan acorde fue con
 * sus misiones. Todo entra al corpus y a la memoria. Los cuadros no se guardan: solo lo que se vio.
 */
import { fechaLocal, json, type Db } from './db.ts'
import { asegurarFuente, insertar } from './corpus.ts'
import { escribaDeMemoria, memoriaParaPrompt } from './memoria.ts'
import { pedirJson } from './modelo.ts'
import { nanTranscribir, nanVision } from './nan.ts'
import { anotarSideQuest, enCurso, listarMisiones, principalDe, semanaDe } from './misiones.ts'

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

const SISTEMA_INFORME = `Sos Mastropiero y escribís el informe de un Directo: lo que viste y escuchaste mientras el jugador trabajaba.
- «texto»: 3 a 5 párrafos cortos, en castellano rioplatense, como si le hablaras. Qué hizo y cuánto tiempo, en qué se fue el foco, qué consumió (videos, música, lecturas) y qué te dice de él, y qué tan acorde fue con sus misiones (sin sermón: si se fue por otro lado, decí adónde y si parece valioso).
- «ideas»: lo que dijo en voz alta que vale guardar (ideas, decisiones), con sus palabras.
- «tareas»: cosas que dijo que tiene que hacer («tengo que…», «después llamo a…»), cortas y en infinitivo.
- «consumido»: por cada video, canción o lectura identificable: {titulo, tipo, resumen (qué dice, si se entendió), relacion (con qué proyecto o meta suya conecta, o null)}.
- «bandas»: de las bandas de su run, los títulos exactos que parecen hechas según lo visto (solo si hay evidencia).
- No inventes: solo lo que está en los momentos.
Forma: {"texto": string, "ideas": [string], "tareas": [string], "consumido": [{"titulo": string, "tipo": string, "resumen": string, "relacion": string | null}], "bandas": [string]}`

/** Cierra el Directo y deja todo donde corresponde: informe, voz, lo consumido, tareas, memoria. */
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
  const run = enCurso(db, ahora)?.run
  const bandas = run ? listarMisiones(db, { runId: run.id, nivel: 'secundaria' }).map((m) => m.titulo) : []
  let informe: { texto?: string; ideas?: string[]; tareas?: string[]; consumido?: any[]; bandas?: string[] } = {}
  if (o.conModelo !== false) {
    const lineas = ms.map((m) => m.tipo === 'pantalla'
      ? `[${hora(m.desde)}–${hora(m.hasta)}] PANTALLA ${m.app ?? '?'} · ${m.actividad ?? ''} · ${m.tema ?? ''} · ${m.detalle ?? ''}${m.nota ? ` — ${m.nota}` : ''}`
      : `[${hora(m.desde)}] ${m.tipo === 'voz' ? 'DIJO' : `ESCUCHÓ (${m.detalle ?? m.app ?? '?'})`}: ${(m.texto ?? '').slice(0, 1200)}`).join('\n')
    const primarias = listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] }).map((m) => m.titulo)
    try {
      informe = (await pedirJson<typeof informe>({ db, clase: 'mastropiero', agenteId: 'directo' }, SISTEMA_INFORME, [
        `Directo del ${fecha}, ${hora(s.inicio)}–${hora(ahora)} (${duracion}).`,
        `Minutos por actividad: ${JSON.stringify(met.minutosPorActividad)}. Por app: ${JSON.stringify(met.minutosPorApp)}.`,
        principalDe(db, 'jugador') ? `Su misión principal: ${principalDe(db, 'jugador')!.titulo}` : '',
        primarias.length ? `Sus primarias de la semana: ${primarias.join(' · ')}` : '',
        bandas.length ? `Bandas de su run en curso: ${bandas.join(' · ')}` : '',
        `Lo que sabés de él:\n${memoriaParaPrompt(db, 30)}`,
        `Momentos:\n${lineas.slice(0, 60000)}`,
      ].filter(Boolean).join('\n'), { temperatura: 0.4, maxTokens: 5000 })).datos
    } catch (e) {
      informe = { texto: `No pude escribir el informe: ${e instanceof Error ? e.message : e}` }
    }
  }
  const actividades = Object.entries(met.minutosPorActividad).map(([k, v]) => `${k} ${v} min`).join(', ')
  const texto = [
    informe.texto?.trim() || `Directo de ${duracion}: ${actividades || 'sin pantalla'}.`,
    informe.ideas?.length ? `\nIdeas que dijiste:\n${informe.ideas.map((x) => `- ${x}`).join('\n')}` : '',
    informe.tareas?.length ? `\nTareas que mencionaste (quedaron como side quests):\n${informe.tareas.map((x) => `- ${x}`).join('\n')}` : '',
    informe.bandas?.length ? `\nBandas que parecen hechas (marcalas si es así): ${informe.bandas.join(' · ')}` : '',
  ].filter(Boolean).join('\n')
  const pieza = insertar(db, {
    fuente: 'agentes', nivel: 'generada', titulo: `Informe del Directo · ${fecha} ${hora(s.inicio)}`, contenido: texto, estado: 'disponible',
    etiquetas: ['directo', 'informe'], autor: 'Mastropiero', fecha: new Date(s.inicio).toISOString(), meta: { sesion: id, metricas: met },
  }, ahora)
  // Lo que consumió: cada video, canción o lectura, con lo que se escuchó, entra al corpus como fuente primaria.
  if (met.consumido.length || informe.consumido?.length) {
    asegurarFuente(db, { id: 'directo', nombre: 'Directo', nivel: 'primaria', descripcion: 'Lo que vio, escuchó y leyó con el Directo prendido.' })
    for (const c of informe.consumido ?? []) {
      const oido = met.consumido.find((x) => norm(x.titulo).includes(norm(c.titulo ?? '').slice(0, 20)))
      insertar(db, {
        fuente: 'directo', nivel: 'primaria', titulo: `${c.tipo ?? 'Medio'} · ${c.titulo ?? 'sin título'}`.slice(0, 200),
        contenido: [c.resumen, c.relacion ? `Conecta con: ${c.relacion}` : '', oido?.textos.length ? `\nLo que se escuchó:\n${oido.textos.join('\n')}` : ''].filter(Boolean).join('\n'),
        estado: 'disponible', etiquetas: ['directo', 'consumido'], fecha: new Date(s.inicio).toISOString(), meta: { sesion: id },
      }, ahora)
    }
  }
  for (const t of (informe.tareas ?? []).slice(0, 8)) {
    try { anotarSideQuest(db, { titulo: t, detalle: `Lo dijiste en el Directo del ${fecha}.`, creadaPor: 'directo' }, ahora) } catch { /* una rara no frena */ }
  }
  db.prepare('UPDATE directo_sesiones SET informe = ?, resumen = ?, pieza_id = ? WHERE id = ?').run(texto, JSON.stringify({ ...met, ...informe, texto: undefined }), pieza, id)
  return leerSesion(db, id)!
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
