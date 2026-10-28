/**
 * Los de la casa (plan v30): tres agentes que dependen solo de Mastropiero (el Omnívoro). No se forjan, no cobran, no
 * mueren y no gastan tokens: son la mano de Mastropiero sobre la liga. Corren solos cada minuto, en cualquier lado.
 * - 01 · Despachante: destraba el bus. Devuelve al bus lo asignado a agentes que ya no existen o están en la banca, y
 *   suelta de a poco la ingesta en espera (solo en la nube y con margen de tope, porque soltarla es gastar).
 * - 02 · Forjador: que nunca falte nadie. Al menos un agente listo (prueba o activo) por clase; y si una clase tiene un
 *   cuello de botella, un refuerzo (hasta TOPE_POR_CLASE).
 * - 03 · Meta-analista: una vez por hora mira la liga entera (cuellos de botella, fallas por clase, tareas viejas, el
 *   tope, la espera) y deja hallazgos; lo serio va a 📥 como propuesta de mejora (una por tema y por día).
 * Auto: la liga corre ticks sola en el servidor (ajuste liga_auto, prendido por defecto). Los ticks gastan tokens:
 * corren solo en la nube, con trabajo y sin tope. porQueNoAvanza() dice, en criollo, todo lo que la frena.
 */
import { ajuste, fijarAjuste, type Db } from './db.ts'
import { CLASES, type ClaseId } from './clases.ts'
import { enEspera, reanudarIngesta } from './bus.ts'
import { forjar, listar, alias, type Ficha } from './roster.ts'
import { tokensHoy, topeAlcanzado, topeDiario } from './nan.ts'
import { MASTROPIERO, tickEnCurso } from './mastropiero.ts'
import { efectos } from './xp.ts'

export const CASA = [
  { id: '01', nombre: 'Despachante', glifo: '⇄', oficio: 'Destraba el bus: devuelve lo trabado y suelta la espera de a poco.' },
  { id: '02', nombre: 'Forjador', glifo: '⚒', oficio: 'Que nunca falte nadie: un agente listo por clase, y refuerzos donde hay cuello de botella.' },
  { id: '03', nombre: 'Meta-analista', glifo: '◎', oficio: 'Mira la liga entera cada hora y dice qué la frena; lo serio va a 📥 como propuesta.' },
] as const
export type CasaId = (typeof CASA)[number]['id']

const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA
export const TANDA_ESPERA = 20
export const TANDA_SIN_TOPE = 60
export const TOPE_POR_CLASE = 4
/** Pendientes por agente listo a partir de las que el Forjador suma un refuerzo. */
export const CUELLO = 40
const MOTOR_EJECUTIVO = 'funcion:bitacora'

export type Hallazgo = { nivel: 'alto' | 'medio' | 'info'; texto: string }
export type Turno = { id: CasaId; nombre: string; glifo: string; oficio: string; ultimaVez: number | null; vueltas: number; texto: string | null; hechos: string[]; hallazgos: Hallazgo[] }

function anotarTurno(db: Db, id: CasaId, texto: string | null, hechos: string[], ahora: number, hallazgos?: Hallazgo[]) {
  db.prepare(`INSERT INTO casa_agentes (id, ultima_vez, vueltas, texto, hechos, hallazgos) VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET ultima_vez = excluded.ultima_vez, vueltas = vueltas + 1,
      texto = COALESCE(excluded.texto, texto), hechos = CASE WHEN excluded.texto IS NULL THEN hechos ELSE excluded.hechos END,
      hallazgos = COALESCE(excluded.hallazgos, hallazgos)`)
    .run(id, ahora, texto, JSON.stringify(hechos), hallazgos ? JSON.stringify(hallazgos) : null)
  if (texto) db.prepare('INSERT INTO cronica (tick, tipo, texto, en) VALUES ((SELECT COALESCE(MAX(tick), 0) FROM cronica), ?, ?, ?)').run('casa', `${id} ${texto}`, ahora)
}

export function turnos(db: Db): Turno[] {
  const filas = new Map((db.prepare('SELECT * FROM casa_agentes').all() as any[]).map((r) => [r.id, r]))
  const json = <T>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) : d } catch { return d } }
  return CASA.map((c) => { const r = filas.get(c.id); return { ...c, ultimaVez: r?.ultima_vez ?? null, vueltas: r?.vueltas ?? 0, texto: r?.texto ?? null, hechos: json(r?.hechos, []), hallazgos: json(r?.hallazgos, []) } })
}

const listos = (db: Db, clase: ClaseId) => listar(db, { clase }).filter((f) => f.estado !== 'banca')
const n = (db: Db, sql: string, ...a: (string | number)[]) => Number((db.prepare(sql).get(...a) as { n: number | null }).n ?? 0)

// ─── 01 · Despachante ───────────────────────────────────────────────────

/** Devuelve lo trabado y, si se puede gastar, suelta una tanda de la espera. */
export function despachar(db: Db, o: { drenar: boolean; ahora?: number }): string[] {
  const ahora = o.ahora ?? Date.now()
  const hechos: string[] = []
  const huerfanas = db.prepare(`UPDATE tareas SET estado = 'pendiente', asignada_a = NULL, asignada_por = NULL, actualizada_en = ?
    WHERE estado = 'asignada' AND (asignada_a IS NULL OR asignada_a NOT IN (SELECT id FROM agentes WHERE estado != 'banca'))`).run(ahora).changes
  if (huerfanas) hechos.push(`devolvió al bus ${huerfanas} tarea${huerfanas === 1 ? '' : 's'} trabada${huerfanas === 1 ? '' : 's'} (su agente ya no estaba o estaba en la banca)`)
  if (o.drenar && puedeSoltar(db, ahora)) {
    // Sin tope de tokens, la espera se suelta en tandas más grandes (se vacía en días, no en semanas).
    const sueltas = reanudarIngesta(db, { limite: topeDiario(db) ? TANDA_ESPERA : TANDA_SIN_TOPE }, ahora)
    if (sueltas) hechos.push(`soltó ${sueltas} encargo${sueltas === 1 ? '' : 's'} de la espera (lo propio primero); quedan ${enEspera(db).toLocaleString('es-AR')}`)
  }
  anotarTurno(db, '01', hechos.length ? hechos.join('; ') : null, hechos, ahora)
  return hechos
}

/** Hay espera, la cola de ingesta está corta y queda margen de tope (menos del 80 % gastado). */
function puedeSoltar(db: Db, ahora: number): boolean {
  if (!enEspera(db) || topeAlcanzado(db, ahora)) return false
  const tope = topeDiario(db)
  const enCola = n(db, `SELECT COUNT(*) AS n FROM tareas WHERE pipeline = 'ingesta' AND estado IN ('pendiente', 'asignada')`)
  if (enCola >= (tope ? TANDA_ESPERA : TANDA_SIN_TOPE)) return false
  if (!tope) return true
  const g = tokensHoy(db, ahora)
  return g.liga + g.fondo < tope * 0.8
}

// ─── 02 · Forjador ──────────────────────────────────────────────────────

/** Al menos un agente listo por clase; un refuerzo donde hay cuello de botella. Devuelve los forjados. */
export function asegurarClases(db: Db, ahora = Date.now()): Ficha[] {
  const forjados: Ficha[] = []
  for (const clase of Object.keys(CLASES) as ClaseId[]) {
    const ya = listos(db, clase)
    const pendientes = n(db, `SELECT COUNT(*) AS n FROM tareas WHERE clase = ? AND estado = 'pendiente'`, clase)
    const falta = !ya.length
    const cuello = ya.length > 0 && ya.length < TOPE_POR_CLASE && pendientes / ya.length > CUELLO && !topeAlcanzado(db, ahora)
    if (!falta && !cuello) continue
    try {
      const f = forjar(db, {
        clase, creador: `${MASTROPIERO}:02`, ahora,
        motor: clase === 'ejecutivo' ? MOTOR_EJECUTIVO : undefined,
        misionPrincipal: falta ? `Que la liga nunca se quede sin ${CLASES[clase].nombre}` : `Refuerzo: ${pendientes} pendientes de ${CLASES[clase].nombre}`,
      })
      forjados.push(f)
    } catch (e) {
      console.error(`  casa 02 (${clase}):`, e instanceof Error ? e.message : e)
    }
  }
  const texto = forjados.length ? `forjó ${forjados.map((f) => `${f.id} (${CLASES[f.clase].nombre})`).join(', ')}` : null
  anotarTurno(db, '02', texto, forjados.map((f) => f.id), ahora)
  return forjados
}

/** La purga no puede dejar una clase sin nadie: el último listo de su clase no se retira. */
export function esElUltimo(db: Db, f: Ficha): boolean {
  return f.estado !== 'banca' && listos(db, f.clase).filter((x) => x.id !== f.id).length === 0
}

// ─── 03 · Meta-analista ─────────────────────────────────────────────────

export function metaanalizar(db: Db, ahora = Date.now(), o: { forzar?: boolean } = {}): Hallazgo[] | null {
  const ultima = (db.prepare(`SELECT ultima_vez FROM casa_agentes WHERE id = '03'`).get() as { ultima_vez: number } | undefined)?.ultima_vez ?? 0
  if (!o.forzar && ahora - ultima < HORA) return null
  const h: Hallazgo[] = []
  const propuestas: { titulo: string; detalle: string }[] = []
  for (const clase of Object.keys(CLASES) as ClaseId[]) {
    const nom = CLASES[clase].nombre
    const pend = n(db, `SELECT COUNT(*) AS n FROM tareas WHERE clase = ? AND estado = 'pendiente'`, clase)
    const ya = listos(db, clase)
    const capacidad = ya.reduce((t, f) => t + efectos(f.atributos).ritmo, 0)
    if (pend >= 20 && capacidad) {
      const ticks = Math.ceil(pend / capacidad)
      h.push({ nivel: ticks > 50 ? 'alto' : 'medio', texto: `${nom}: ${pend} pendientes para ${ya.length} agente${ya.length === 1 ? '' : 's'} (ritmo ${capacidad} por tick): unos ${ticks} ticks para vaciar.` })
    }
    const hechas = n(db, `SELECT COUNT(*) AS n FROM tareas WHERE clase = ? AND estado = 'hecha' AND actualizada_en >= ?`, clase, ahora - 7 * DIA)
    const fallidas = n(db, `SELECT COUNT(*) AS n FROM tareas WHERE clase = ? AND estado = 'fallida' AND actualizada_en >= ?`, clase, ahora - 7 * DIA)
    if (hechas + fallidas >= 10 && fallidas / (hechas + fallidas) >= 0.3) {
      const pct = Math.round((fallidas / (hechas + fallidas)) * 100)
      h.push({ nivel: 'alto', texto: `${nom}: falla el ${pct} % (${fallidas} de ${hechas + fallidas} en 7 días).` })
      const ultimo = (db.prepare(`SELECT error FROM tareas WHERE clase = ? AND estado = 'fallida' AND error IS NOT NULL ORDER BY actualizada_en DESC LIMIT 1`).get(clase) as { error: string } | undefined)?.error
      propuestas.push({ titulo: `La liga: los ${nom.toLowerCase()} fallan el ${pct} %`, detalle: `En los últimos 7 días, ${fallidas} de ${hechas + fallidas} tareas de ${nom} terminaron fallidas.${ultimo ? ` El último error: «${ultimo.slice(0, 300)}».` : ''} Revisar el motor, el contrato de salida o las instrucciones de la clase.` })
    }
  }
  const viejas = n(db, `SELECT COUNT(*) AS n FROM tareas WHERE estado = 'pendiente' AND creada_en < ?`, ahora - 3 * DIA)
  if (viejas) h.push({ nivel: 'medio', texto: `${viejas} tarea${viejas === 1 ? '' : 's'} pendiente${viejas === 1 ? '' : 's'} hace más de 3 días.` })
  const tope = topeAlcanzado(db, ahora)
  if (tope) {
    h.push({ nivel: 'alto', texto: `Tope de tokens alcanzado: ${tope}. La liga no corre hasta mañana.` })
    if (new Date(ahora).getHours() < 18) propuestas.push({ titulo: 'La liga: el tope diario se alcanza antes de las 18', detalle: `Hoy la liga llegó al tope de tokens temprano (${tope}). Conviene subir tokens_dia_max, pasar más agentes al motor local o soltar menos ingesta por tanda.` })
  }
  const espera = enEspera(db)
  if (espera) {
    const soltadas = n(db, `SELECT COUNT(*) AS n FROM tareas WHERE pipeline = 'ingesta' AND etapa = 0 AND estado != 'en_espera' AND actualizada_en >= ?`, ahora - DIA)
    h.push({ nivel: 'info', texto: `${espera.toLocaleString('es-AR')} encargos de ingesta en espera${soltadas ? `; a este ritmo (${soltadas} por día), unos ${Math.ceil(espera / soltadas)} días` : '; hoy no se soltó ninguno'}.` })
  }
  const ociosos = listar(db).filter((f) => f.estado === 'activo' && (f.ultimaCorrida ?? f.creadoEn) < ahora - 3 * DIA)
  if (ociosos.length) h.push({ nivel: 'info', texto: `${ociosos.length} agente${ociosos.length === 1 ? '' : 's'} activo${ociosos.length === 1 ? '' : 's'} sin correr hace 3 días (${ociosos.slice(0, 4).map(alias).join(', ')}${ociosos.length > 4 ? '…' : ''}).` })
  const hechas24 = n(db, `SELECT COUNT(*) AS n FROM tareas WHERE estado = 'hecha' AND actualizada_en >= ?`, ahora - DIA)
  const fallidas24 = n(db, `SELECT COUNT(*) AS n FROM tareas WHERE estado = 'fallida' AND actualizada_en >= ?`, ahora - DIA)
  h.push({ nivel: 'info', texto: `Últimas 24 h: ${hechas24} hechas, ${fallidas24} fallidas.` })

  // Lo serio, a 📥: una propuesta por tema, sin repetir mientras siga abierta o si ya se propuso hoy.
  const nuevas: string[] = []
  for (const p of propuestas) {
    const ya = db.prepare(`SELECT 1 FROM propuestas WHERE titulo = ? AND (estado = 'abierta' OR creada_en >= ?)`).get(p.titulo, ahora - DIA)
    if (ya) continue
    db.prepare(`INSERT INTO propuestas (titulo, detalle, area, prioridad, estado, origen, creada_en) VALUES (?, ?, 'liga', 'media', 'abierta', 'meta', ?)`).run(p.titulo, p.detalle, ahora)
    nuevas.push(p.titulo)
  }
  const serios = h.filter((x) => x.nivel === 'alto').length
  anotarTurno(db, '03', `revisó la liga: ${serios ? `${serios} cosa${serios === 1 ? '' : 's'} seria${serios === 1 ? '' : 's'}` : 'nada serio'}${nuevas.length ? `; dejó ${nuevas.length} propuesta${nuevas.length === 1 ? '' : 's'} en 📥` : ''}`, nuevas, ahora, h)
  return h
}

// ─── Auto ───────────────────────────────────────────────────────────────

export const autoPrendido = (db: Db) => ajuste(db, 'liga_auto') !== '0'
export function fijarAuto(db: Db, prendido: boolean) { fijarAjuste(db, 'liga_auto', prendido ? '1' : '0') }

const hayTrabajo = (db: Db) => !!db.prepare(`SELECT 1 FROM tareas WHERE estado IN ('pendiente', 'asignada') LIMIT 1`).get()

/** Por qué Auto no tickea ahora (null = tickea). */
export function frenoDeAuto(db: Db, nube: boolean, ahora = Date.now()): string | null {
  if (!autoPrendido(db)) return 'Auto está apagado: nadie corre ticks solo.'
  if (!nube) return 'Auto corre solo en la nube (los ticks gastan tokens): acá los ticks son a mano.'
  const tope = topeAlcanzado(db, ahora)
  if (tope) return `Tope de tokens del día: ${tope}.`
  if (!hayTrabajo(db)) return enEspera(db) ? 'Nada en el bus: el Despachante suelta la próxima tanda de la espera en un minuto.' : 'Nada en el bus: la liga espera trabajo.'
  return null
}

export type Motivo = { clave: string; texto: string; accion?: { texto: string; ruta: string } }

/** Todo lo que frena la liga, en criollo. Vacío = avanza. */
export function porQueNoAvanza(db: Db, nube: boolean, ahora = Date.now()): Motivo[] {
  const m: Motivo[] = []
  const freno = frenoDeAuto(db, nube, ahora)
  if (freno && !autoPrendido(db)) m.push({ clave: 'auto', texto: freno, accion: { texto: 'Prender Auto', ruta: '/liga/auto' } })
  else if (freno && !nube) m.push({ clave: 'nube', texto: freno })
  const tope = topeAlcanzado(db, ahora)
  if (tope) m.push({ clave: 'tope', texto: `Se llegó al tope diario de tokens (${tope}): la liga reparte pero no corre hasta mañana. Se cambia en Hoy → Ajustes.` })
  const espera = enEspera(db)
  if (espera) m.push({ clave: 'espera', texto: `${espera.toLocaleString('es-AR')} encargos de ingesta en espera: no se reparten hasta que se sueltan. ${nube && autoPrendido(db) ? `El Despachante suelta ${TANDA_ESPERA} cada vez que la cola de ingesta baja de ${TANDA_ESPERA} y queda margen de tope.` : 'Acá no se sueltan solos (soltarlos es gastar): se sueltan en la nube o a mano.'}`, accion: { texto: `Soltar ${TANDA_ESPERA} ahora`, ruta: '/ingesta/reanudar' } })
  const enMision = new Set((db.prepare(`SELECT agente_id FROM agente_misiones WHERE estado IN ('activa', 'pausada')`).all() as { agente_id: string }[]).map((r) => r.agente_id))
  for (const r of db.prepare(`SELECT clase, COUNT(*) AS n FROM tareas WHERE estado = 'pendiente' GROUP BY clase`).all() as { clase: ClaseId; n: number }[]) {
    const nom = CLASES[r.clase]?.nombre ?? r.clase
    const ya = listar(db, { clase: r.clase })
    const libres = ya.filter((f) => f.estado !== 'banca' && !enMision.has(f.id))
    if (!ya.length) m.push({ clave: `vacante:${r.clase}`, texto: `${r.n} pendiente${r.n === 1 ? '' : 's'} de ${nom} y no hay ningún ${nom}: el Forjador forja uno en el próximo minuto.` })
    else if (!libres.length) m.push({ clave: `ocupados:${r.clase}`, texto: `${r.n} pendiente${r.n === 1 ? '' : 's'} de ${nom}: los ${nom.toLowerCase()} están en la banca o dedicados a una misión, así que el bus no los toma.` })
  }
  const largas = n(db, `SELECT COUNT(*) AS n FROM tareas WHERE estado = 'asignada' AND actualizada_en < ?`, ahora - HORA)
  if (largas && !tope) m.push({ clave: 'lentas', texto: `${largas} tarea${largas === 1 ? '' : 's'} asignada${largas === 1 ? '' : 's'} hace más de una hora sin cerrarse: cada agente corre su ritmo por tick${freno ? ', y ahora no hay ticks' : ''}.` })
  return m
}

/**
 * Una vuelta: los de la casa (siempre; sin tokens) y, si toca, un tick. La llama el servidor cada 15 s; los de la casa
 * corren como mucho una vez por minuto.
 */
let ultimaCasa = 0
export async function vueltaDeLiga(db: Db, o: { nube: boolean; tick: () => Promise<unknown>; ahora?: number }): Promise<{ casa: boolean; tick: boolean }> {
  const ahora = o.ahora ?? Date.now()
  let casa = false
  if (ahora - ultimaCasa >= MIN) {
    ultimaCasa = ahora
    casa = true
    despachar(db, { drenar: o.nube && autoPrendido(db), ahora })
    asegurarClases(db, ahora)
    metaanalizar(db, ahora)
  }
  if (frenoDeAuto(db, o.nube, ahora) || tickEnCurso()) return { casa, tick: false }
  await o.tick()
  return { casa, tick: true }
}
export function _reiniciarCasa() { ultimaCasa = 0 }

// ─── Lo que se ve ───────────────────────────────────────────────────────

export function ligaEnVivo(db: Db, nube: boolean, ahora = Date.now()) {
  const enMision = new Set((db.prepare(`SELECT agente_id FROM agente_misiones WHERE estado IN ('activa', 'pausada')`).all() as { agente_id: string }[]).map((r) => r.agente_id))
  const carga = new Map((db.prepare(`SELECT asignada_a AS id, COUNT(*) AS n FROM tareas WHERE estado = 'asignada' GROUP BY asignada_a`).all() as { id: string; n: number }[]).map((r) => [r.id, r.n]))
  const porClase = new Map<string, Record<string, number>>()
  for (const r of db.prepare(`SELECT clase, estado, COUNT(*) AS n FROM tareas WHERE estado IN ('pendiente', 'asignada', 'en_espera') GROUP BY clase, estado`).all() as { clase: string; estado: string; n: number }[]) {
    porClase.set(r.clase, { ...(porClase.get(r.clase) ?? {}), [r.estado]: r.n })
  }
  const dia = new Map<string, Record<string, number>>()
  for (const r of db.prepare(`SELECT clase, estado, COUNT(*) AS n FROM tareas WHERE estado IN ('hecha', 'fallida') AND actualizada_en >= ? GROUP BY clase, estado`).all(ahora - DIA) as { clase: string; estado: string; n: number }[]) {
    dia.set(r.clase, { ...(dia.get(r.clase) ?? {}), [r.estado]: r.n })
  }
  const roster = listar(db)
  const agentes = roster.map((f) => {
    const asignadas = carga.get(f.id) ?? 0
    const reciente = !!f.ultimaCorrida && f.ultimaCorrida >= ahora - 2 * MIN
    const estado = f.estado === 'banca' ? 'banca' : enMision.has(f.id) ? 'mision' : asignadas && (reciente || tickEnCurso()) ? 'trabajando' : asignadas ? 'con_tareas' : 'libre'
    return { id: f.id, alias: alias(f), clase: f.clase, nivel: f.estado === 'prueba' ? 'prueba' : f.estado, estado, asignadas, ultimaCorrida: f.ultimaCorrida, ritmo: efectos(f.atributos).ritmo, casa: String(f.creador ?? '').startsWith(`${MASTROPIERO}:02`) }
  })
  const clases = (Object.keys(CLASES) as ClaseId[]).map((c) => {
    const ag = roster.filter((f) => f.clase === c)
    const t = porClase.get(c) ?? {}
    const d = dia.get(c) ?? {}
    return {
      id: c, nombre: CLASES[c].nombre, glifo: CLASES[c].glifo,
      agentes: { activo: ag.filter((f) => f.estado === 'activo').length, prueba: ag.filter((f) => f.estado === 'prueba').length, banca: ag.filter((f) => f.estado === 'banca').length },
      pendientes: t.pendiente ?? 0, asignadas: t.asignada ?? 0, enEspera: t.en_espera ?? 0, hechas24: d.hecha ?? 0, fallidas24: d.fallida ?? 0,
    }
  })
  const totales = Object.fromEntries((db.prepare('SELECT estado, COUNT(*) AS n FROM tareas GROUP BY estado').all() as { estado: string; n: number }[]).map((r) => [r.estado, r.n]))
  const ultimoTick = (db.prepare(`SELECT MAX(en) AS en FROM cronica WHERE tipo != 'casa'`).get() as { en: number | null }).en
  const ticksHora = n(db, `SELECT COUNT(DISTINCT tick) AS n FROM cronica WHERE en >= ? AND tipo != 'casa'`, ahora - HORA)
  return {
    auto: { prendido: autoPrendido(db), freno: frenoDeAuto(db, nube, ahora), nube, corriendo: tickEnCurso(), ultimoTick, ticksHora },
    motivos: porQueNoAvanza(db, nube, ahora), casa: turnos(db), clases, agentes, totales,
  }
}
