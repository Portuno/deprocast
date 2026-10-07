/**
 * Mastropiero: el Omnívoro. No es una ficha; es la liga entera.
 * Ve todo, ingiere todo y en cada tick hace tres cosas: purga, reparte, corre.
 */
import { CLASES } from './clases.ts'
import type { Db } from './db.ts'
import { asignar, asignadasA, cerrarFallo, cerrarOk, leerTarea, publicar, type NuevaTarea, type Tarea } from './bus.ts'
import { registrar } from './auditor.ts'
import { construir } from './contexto.ts'
import { aplicarEtapa, insertar, PIPELINE_INGESTA, type TipoPieza } from './corpus.ts'
import { crearQuantomo, registrarPropuesta } from './quantomos.ts'
import { elegir, gerenteDe } from './gerente.ts'
import { resolverMotor, type Salida } from './motores.ts'
import {
  alias, cambiarEstado, DIA_MS, DIAS_SIN_CORRER, forjar, leer, listar, nivel,
  PRUEBA_EXITOS, PRUEBA_FALLOS, RACHA_BANCA, retirar, type Ficha,
} from './roster.ts'
import { efectos, NIVEL_BAUTISMO, nivelDe, XP_POR_ASIGNACION, XP_POR_EXITO } from './xp.ts'

export const MASTROPIERO = 'mastropiero'

export type Evento = {
  tipo: 'purga' | 'asigna' | 'recluta' | 'vacante' | 'corre' | 'falla' | 'nivel' | 'bautismo' | 'promovido' | 'banca' | 'retirado' | 'publica'
  texto: string
}

// ─── Entradas a la liga ─────────────────────────────────────────────────

/** Un proyecto nace con su gerente. */
export function crearProyecto(db: Db, nombre: string, ahora = Date.now()): { id: string; gerente: Ficha } {
  const id = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!id) throw new Error('Nombre de proyecto vacío')
  db.prepare('INSERT INTO proyectos (id, nombre, creado_en) VALUES (?, ?, ?)').run(id, nombre, ahora)
  const gerente = forjar(db, { clase: 'gerente', creador: MASTROPIERO, proyectoId: id, instrucciones: `Entrenador del proyecto ${nombre}.`, ahora })
  return { id, gerente }
}

/** La boca del omnívoro para lo suelto: entra crudo y arranca la pipeline de ingesta. Los archivos entran por cargas. */
export function ingerir(
  db: Db,
  p: {
    fuente: string; titulo: string; contenido: string; nivel?: string; tipo?: TipoPieza; autor?: string | null; fecha?: string | null
    url?: string | null; proyectoId?: string | null; dominio?: string | null; por?: string
  },
  ahora = Date.now(),
): { corpusId: number; tarea: Tarea } {
  if (!p.contenido.trim()) throw new Error('Nada que ingerir: el contenido está vacío')
  const etiquetas = p.dominio ? [p.dominio] : undefined
  const corpusId = insertar(db, { ...p, etiquetas, meta: p.proyectoId ? { proyecto: p.proyectoId } : null }, ahora)!
  const tarea = publicar(db, {
    clase: PIPELINE_INGESTA[0].clase,
    tipo: 'ingesta',
    payload: { titulo: p.titulo },
    publicadaPor: p.por ?? MASTROPIERO,
    proyectoId: p.proyectoId,
    dominio: p.dominio,
    pipeline: 'ingesta',
    etapa: 0,
    corpusId,
  }, ahora)
  return { corpusId, tarea }
}

// ─── El tick ────────────────────────────────────────────────────────────

let enTick = false

/** Un tick a la vez, venga de la pantalla o del chat. */
export async function tickUnico(db: Db, o: { ahora?: number; reclutar?: boolean } = {}): Promise<Evento[]> {
  if (enTick) throw new Error('Mastropiero ya está en un tick')
  enTick = true
  try {
    return await tick(db, o)
  } finally {
    enTick = false
  }
}

export const tickEnCurso = () => enTick

export async function tick(db: Db, o: { ahora?: number; reclutar?: boolean } = {}): Promise<Evento[]> {
  const ahora = o.ahora ?? Date.now()
  const ev: Evento[] = []
  purgar(db, ahora, ev)
  repartir(db, ahora, o.reclutar ?? true, ev)
  await correr(db, ahora, ev)
  const n = numeroDeTick(db) + 1
  const alta = db.prepare('INSERT INTO cronica (tick, tipo, texto, en) VALUES (?, ?, ?, ?)')
  // Un tick sin novedades también cuenta: queda su número aunque no deje eventos.
  if (!ev.length) alta.run(n, 'quieto', 'tick sin novedades', ahora)
  for (const e of ev) alta.run(n, e.tipo, e.texto, ahora)
  return ev
}

export function numeroDeTick(db: Db): number {
  return (db.prepare('SELECT COALESCE(MAX(tick), 0) AS n FROM cronica').get() as { n: number }).n
}

/** La crónica sobrevive a los reinicios: vive en la base. */
export function cronica(db: Db, limite = 150) {
  return (db.prepare(`SELECT tick, tipo, texto, en FROM cronica WHERE tipo != 'quieto' ORDER BY id DESC LIMIT ?`).all(limite) as (Evento & { tick: number; en: number })[]).reverse()
}

/** Un agente que no corre en una semana se borra, no se mejora. */
export function purgar(db: Db, ahora: number, ev: Evento[] = []) {
  const limite = ahora - DIAS_SIN_CORRER * DIA_MS
  for (const f of listar(db)) {
    if ((f.ultimaCorrida ?? f.creadoEn) < limite) {
      retirar(db, f.id, `${DIAS_SIN_CORRER} días sin correr`, ahora)
      ev.push({ tipo: 'purga', texto: `${alias(f)} retirado: ${DIAS_SIN_CORRER} días sin correr` })
    }
  }
  return ev
}

function repartir(db: Db, ahora: number, reclutar: boolean, ev: Evento[]) {
  const carga = new Map<string, number>()
  for (const r of db.prepare(`SELECT asignada_a AS id, COUNT(*) AS n FROM tareas WHERE estado = 'asignada' GROUP BY asignada_a`).all() as any[]) {
    carga.set(r.id, r.n)
  }
  const pendientes = db.prepare(`SELECT id FROM tareas WHERE estado = 'pendiente' ORDER BY id LIMIT 500`).all() as { id: number }[]
  for (const { id } of pendientes) {
    const tarea = leerTarea(db, id)!
    const gerente = gerenteDe(db, tarea.proyectoId)
    const por = gerente?.id ?? MASTROPIERO
    let pick = elegir(db, tarea, carga)
    if (!pick && reclutar) {
      if (tarea.clase === 'ejecutivo' || tarea.clase === 'gerente') {
        ev.push({ tipo: 'vacante', texto: `tarea ${tarea.id} espera un ${CLASES[tarea.clase].nombre}: no se recluta solo` })
        continue
      }
      const recluta = forjar(db, { clase: tarea.clase, creador: por, proyectoId: tarea.proyectoId, ahora })
      ev.push({ tipo: 'recluta', texto: `${por === MASTROPIERO ? 'Mastropiero' : alias(gerente!)} forja ${recluta.id} para la tarea ${tarea.id}` })
      pick = { agente: recluta, razon: 'recluta forjado para la vacante' }
    }
    if (!pick) continue
    if (!asignar(db, tarea.id, pick.agente.id, por, ahora)) continue
    carga.set(pick.agente.id, (carga.get(pick.agente.id) ?? 0) + 1)
    registrar(db, {
      tareaId: null, agenteId: por, ok: true, dominio: tarea.dominio,
      input: { tarea: tarea.id, clase: tarea.clase }, decision: `asigna a ${pick.agente.id}: ${pick.razon}`, output: { agente: pick.agente.id },
    }, ahora)
    ev.push({ tipo: 'asigna', texto: `tarea ${tarea.id} (${tarea.tipo}) → ${alias(pick.agente)} [${pick.razon}]` })
    if (gerente) acreditar(db, gerente, XP_POR_ASIGNACION, ahora, ev)
  }
}

/**
 * Un encargo puntual a un agente elegido, sin esperar al tick: se publica, se le asigna y corre ya.
 * Pasa por el mismo contrato, auditoría y XP que cualquier tarea del bus.
 */
export async function encargarYa(db: Db, agenteId: string, t: Omit<NuevaTarea, 'clase'>, ahora = Date.now()): Promise<{ tarea: Tarea; eventos: Evento[] }> {
  const f = leer(db, agenteId)
  if (!f) throw new Error(`No existe ${agenteId}`)
  const tarea = publicar(db, { ...t, clase: f.clase }, ahora)
  asignar(db, tarea.id, f.id, MASTROPIERO, ahora)
  const ev: Evento[] = []
  await ejecutar(db, f, leerTarea(db, tarea.id)!, ahora, ev)
  const n = numeroDeTick(db)
  const alta = db.prepare('INSERT INTO cronica (tick, tipo, texto, en) VALUES (?, ?, ?, ?)')
  for (const e of ev) alta.run(n, e.tipo, e.texto, ahora)
  return { tarea: leerTarea(db, tarea.id)!, eventos: ev }
}

async function correr(db: Db, ahora: number, ev: Evento[]) {
  const ids = (db.prepare(`SELECT DISTINCT asignada_a AS id FROM tareas WHERE estado = 'asignada'`).all() as { id: string }[]).map((r) => r.id)
  for (const id of ids) {
    const f = leer(db, id)
    if (!f || f.estado === 'banca') continue
    for (const t of asignadasA(db, f.id, efectos(f.atributos).ritmo)) {
      const vivo = leer(db, f.id)
      if (!vivo || vivo.estado === 'banca') break
      await ejecutar(db, vivo, t, ahora, ev)
    }
  }
}

async function ejecutar(db: Db, f: Ficha, t: Tarea, ahora: number, ev: Evento[]) {
  const { contexto, lector } = construir(db, f, t)
  const ef = efectos(f.atributos)
  let salida: Salida | null = null
  let error: string | null = null
  try {
    const s = await resolverMotor(f.motor)({ db, ficha: f, tarea: t, contexto, lector, efectos: ef })
    if (typeof s !== 'object' || s === null || Array.isArray(s)) throw new Error('la salida no es un objeto')
    salida = s
    error = CLASES[f.clase].validar(s)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const input = { capa: contexto.capa, tarea: contexto.tarea, pieza: contexto.pieza?.id }

  if (error) {
    const reintentar = t.intentos < ef.reintentos
    cerrarFallo(db, t.id, error, reintentar, ahora)
    registrar(db, { tareaId: t.id, agenteId: f.id, ok: false, dominio: t.dominio, input, decision: error, output: salida ?? undefined }, ahora)
    db.prepare('UPDATE agentes SET fallos = fallos + 1, racha_fallos = racha_fallos + 1, ultima_corrida = ? WHERE id = ?').run(ahora, f.id)
    ev.push({ tipo: 'falla', texto: `${alias(f)} falla tarea ${t.id}: ${error}${reintentar ? ' (vuelve al bus)' : ''}` })
    const g = leer(db, f.id)!
    if (g.estado === 'prueba' && g.fallos >= PRUEBA_FALLOS) {
      retirar(db, g.id, 'no pasó la prueba', ahora)
      ev.push({ tipo: 'retirado', texto: `${alias(g)} no pasó la prueba: retirado` })
    } else if (g.estado === 'activo' && g.rachaFallos >= RACHA_BANCA) {
      cambiarEstado(db, g.id, 'banca')
      ev.push({ tipo: 'banca', texto: `${alias(g)} a la banca: ${RACHA_BANCA} fallos seguidos` })
    }
    return
  }

  cerrarOk(db, t.id, salida, ahora)
  registrar(db, { tareaId: t.id, agenteId: f.id, ok: true, dominio: t.dominio, input, decision: `motor ${f.motor}: salida validada contra el contrato de ${CLASES[f.clase].nombre}`, output: salida }, ahora)
  db.prepare('UPDATE agentes SET exitos = exitos + 1, racha_fallos = 0 WHERE id = ?').run(f.id)
  ev.push({ tipo: 'corre', texto: `${alias(f)} cierra tarea ${t.id} (${t.tipo})` })
  acreditar(db, f, XP_POR_EXITO, ahora, ev)
  derivar(db, f, t, salida!, ef.iniciativa, ahora, ev)
}

/** XP, nivel, bautismo y paso de prueba a activo. */
function acreditar(db: Db, f: Ficha, xp: number, ahora: number, ev: Evento[]) {
  const antes = nivelDe(f.xp)
  db.prepare('UPDATE agentes SET xp = xp + ?, ultima_corrida = ? WHERE id = ?').run(xp, ahora, f.id)
  if (f.clase === 'gerente') db.prepare('UPDATE agentes SET exitos = exitos + 1 WHERE id = ?').run(f.id)
  const g = leer(db, f.id)!
  const despues = nivel(g)
  if (despues > antes) {
    ev.push({ tipo: 'nivel', texto: `${alias(g)} sube a nivel ${despues}` })
    if (despues >= NIVEL_BAUTISMO && antes < NIVEL_BAUTISMO && !g.nombre) {
      ev.push({ tipo: 'bautismo', texto: `${g.id} se ganó un nombre: npm run mastro -- bautizar ${g.id} <nombre>` })
    }
  }
  if (g.estado === 'prueba' && g.exitos >= PRUEBA_EXITOS) {
    db.prepare(`UPDATE agentes SET estado = 'activo' WHERE id = ?`).run(g.id)
    ev.push({ tipo: 'promovido', texto: `${alias(g)} pasó la prueba: entra al roster` })
  }
}

/** Lo que una tarea cerrada deja en el bus: etapa siguiente de pipeline, materia prima de crawlers, iniciativa propia. */
function derivar(db: Db, f: Ficha, t: Tarea, salida: Salida, iniciativa: number, ahora: number, ev: Evento[]) {
  if (t.pipeline === 'ingesta' && t.corpusId != null && t.etapa != null) {
    const etapa = PIPELINE_INGESTA[t.etapa]
    aplicarEtapa(db, t.corpusId, etapa.clase, salida, etapa.deja)
    const siguiente = PIPELINE_INGESTA[t.etapa + 1]
    if (siguiente) {
      publicar(db, {
        clase: siguiente.clase, tipo: 'ingesta', payload: t.payload, publicadaPor: f.id,
        proyectoId: t.proyectoId, dominio: t.dominio, pipeline: 'ingesta', etapa: t.etapa + 1, corpusId: t.corpusId,
      }, ahora)
    }
  }
  if (t.pipeline === 'ingesta' && t.corpusId != null && f.clase === 'extractor' && Array.isArray(salida.quantomos)) {
    // El extractor propone; el operador sella.
    for (const texto of (salida.quantomos as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 6)) {
      crearQuantomo(db, { texto, piezaId: t.corpusId, etapa: 'proto', procedencia: `extractor ${f.id}`, tareaId: t.id }, ahora)
    }
  }
  if (f.clase === 'crawler' && Array.isArray(salida.items)) {
    for (const it of salida.items as { titulo?: string; contenido: string; url: string }[]) {
      const { corpusId } = ingerir(db, { fuente: 'web', titulo: it.titulo || it.url, contenido: it.contenido, url: it.url, proyectoId: t.proyectoId, dominio: t.dominio, por: f.id }, ahora)
      ev.push({ tipo: 'publica', texto: `${alias(f)} trae ${it.url} → corpus ${corpusId}` })
      // Si venía de un enlace cosechado, el enlace queda como traído y apunta a la pieza nueva.
      if (t.corpusId != null && !t.pipeline) {
        db.prepare(`UPDATE corpus SET estado = 'traido', meta = json_set(COALESCE(meta, '{}'), '$.traido_en', ?) WHERE id = ? AND tipo = 'enlace'`).run(corpusId, t.corpusId)
      }
    }
  }
  if (t.tipo === 'mejora-quantomo' && typeof salida.texto === 'string') {
    const id = registrarPropuesta(db, t, salida.texto, f.id, ahora)
    if (id) ev.push({ tipo: 'publica', texto: `${alias(f)} propone una versión del quántomo ${t.payload.quantomoId} → espera tu sello` })
  } else if (f.clase === 'generativo' && typeof salida.texto === 'string' && salida.texto.trim()) {
    // Lo que crean los agentes también es corpus, en su nivel: generada.
    const pedido = typeof t.payload.texto === 'string' ? t.payload.texto : t.tipo
    insertar(db, {
      fuente: 'agentes', nivel: 'generada', titulo: `${alias(f)} · ${pedido.slice(0, 90)}`, contenido: salida.texto,
      autor: f.id, estado: 'disponible', etiquetas: t.dominio ? [t.dominio] : undefined, meta: { tarea: t.id, pedido }, origenId: `liga:tarea:${t.id}`,
    }, ahora)
  }
  if (iniciativa > 0 && Array.isArray(salida.nuevasTareas)) {
    for (const n of (salida.nuevasTareas as any[]).slice(0, iniciativa)) {
      try {
        const nueva = publicar(db, {
          clase: String(n?.clase), tipo: 'iniciativa', payload: { texto: String(n?.texto ?? '') },
          publicadaPor: f.id, proyectoId: t.proyectoId, dominio: n?.dominio ?? t.dominio,
        }, ahora)
        ev.push({ tipo: 'publica', texto: `${alias(f)} publica tarea ${nueva.id} para ${nueva.clase}` })
      } catch {
        // Una tarea mal formada del agente no rompe la corrida.
      }
    }
  }
}

// ─── Lo que ve el omnívoro ──────────────────────────────────────────────

export function estadoLiga(db: Db) {
  const q = (sql: string) => db.prepare(sql).all() as any[]
  return {
    agentes: q('SELECT clase, estado, COUNT(*) AS n FROM agentes GROUP BY clase, estado'),
    tareas: q('SELECT estado, COUNT(*) AS n FROM tareas GROUP BY estado'),
    corpus: q('SELECT estado, COUNT(*) AS n FROM corpus GROUP BY estado'),
    niveles: q(`SELECT nivel, COUNT(*) AS n FROM corpus WHERE estado != 'pendiente' GROUP BY nivel`),
    quantomos: q('SELECT etapa, COUNT(*) AS n FROM quantomos GROUP BY etapa'),
    entidades: (db.prepare('SELECT COUNT(*) AS n FROM entidades').get() as { n: number }).n,
    lapidas: (db.prepare('SELECT COUNT(*) AS n FROM lapidas').get() as { n: number }).n,
    proyectos: q('SELECT id, nombre FROM proyectos ORDER BY creado_en'),
  }
}
