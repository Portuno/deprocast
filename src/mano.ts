/**
 * La Mano: el gesto mínimo de Deprocast. Cinco cartas (afirmaciones que destiló de lo suyo y todavía no pesó) y una
 * tecla por carta: peso 1–12, descartar o «choca con lo que ya sabía». Al jugarla, la respuesta llega enseguida y sin
 * modelo: con qué cosas que ya sabía conecta (por sentido), qué de lo que pesó alto refuerza o con qué choca, y a qué
 * misión sirve. Lo que sorprende sale de los datos, nunca de un sorteo: el orden es fijo por día (misma base, mismo
 * día, misma mano) y lo nuevo de verdad sale primero.
 */
import { ajuste, fechaLocal, fijarAjuste, json, type Db } from './db.ts'
import { anotar } from './decisiones.ts'
import { crearQuantomo, descartar, leerQuantomo, parecidosA, sellar, UMBRAL_VARIACION, type Quantomo } from './quantomos.ts'
import { anotarSideQuest, principalDe } from './misiones.ts'
import { pedirJson } from './modelo.ts'
import { enLaNube } from './reproceso.ts'

export type Gesto = 'peso' | 'descartar' | 'choca'
export type Fuente = { piezaId: number; titulo: string; fecha: string | null; nivel: string | null }
export type Toca = {
  entidades: { id: number; nombre: string; tipo: string }[]
  /** La primaria de esta semana (o la última activa) que trata de algo de lo que habla la carta. */
  primaria: { id: number; titulo: string } | null
  principal: string | null
}
export type Carta = {
  id: number
  texto: string
  titulo: string | null
  novedad: string | null
  /** Si es variación o repetida: de qué. */
  parecidaA: { id: number; texto: string; sim: number } | null
  fuente: Fuente | null
  toca: Toca
}
export type Vecino = { id: number; texto: string; peso: number | null; sim: number; fecha: string | null }

/** Desde qué parecido una carta «conecta» con algo que ya sabía. */
export const UMBRAL_VECINO = 0.55
/** Lo que pesó desde acá es «lo que ya creía». */
export const PESO_CREENCIA = 9

// Primero lo nuevo de verdad que llegó esta semana (lo más reciente arriba: es lo que anuncia el aviso de Hoy); después
// lo nuevo de antes, las variaciones y lo repetido al final. Dentro de cada grupo, un orden mezclado pero fijo por día.
const ORDEN = `CASE WHEN q.novedad = 'nueva' AND q.creado_en > ? THEN -q.creado_en ELSE 0 END, CASE q.novedad WHEN 'nueva' THEN 0 WHEN 'variacion' THEN 1 WHEN 'repetida' THEN 3 ELSE 2 END, (q.id * 2654435761 + ?) % 1000003`
const SEMANA = 7 * 86_400_000
const semilla = (ahora: number) => Number(fechaLocal(ahora).replace(/-/g, ''))

function fuenteDe(db: Db, piezaId: number | null): Fuente | null {
  if (!piezaId) return null
  const p = db.prepare('SELECT id, titulo, fecha, nivel FROM corpus WHERE id = ?').get(piezaId) as any
  return p ? { piezaId: p.id, titulo: p.titulo, fecha: p.fecha ? String(p.fecha).slice(0, 10) : null, nivel: p.nivel ?? null } : null
}

/** A qué toca una carta: las entidades de su pieza (proyectos primero) y la primaria que trata de alguna de ellas. */
export function tocaDe(db: Db, piezaId: number | null): Toca {
  const principal = principalDe(db, 'jugador')?.titulo ?? null
  if (!piezaId) return { entidades: [], primaria: null, principal }
  const entidades = db.prepare(`SELECT e.id, e.nombre, e.tipo FROM corpus_entidades ce JOIN entidades e ON e.id = ce.entidad_id
    WHERE ce.pieza_id = ? ORDER BY e.tipo = 'proyecto' DESC, e.tipo = 'persona' DESC, e.id LIMIT 3`).all(piezaId) as Toca['entidades']
  const primaria = entidades.length
    ? (db.prepare(`SELECT id, titulo FROM misiones WHERE personaje = 'jugador' AND nivel = 'primaria' AND estado IN ('activa', 'sugerida', 'parcial')
        AND entidad_id IN (${entidades.map(() => '?').join(',')}) ORDER BY COALESCE(semana, '') DESC, id DESC LIMIT 1`).get(...entidades.map((e) => e.id)) as Toca['primaria'] | undefined) ?? null
    : null
  return { entidades, primaria, principal }
}

function carta(db: Db, q: Quantomo): Carta {
  const de = q.novedadDe ? (db.prepare('SELECT id, texto FROM quantomos WHERE id = ?').get(q.novedadDe) as { id: number; texto: string } | undefined) : undefined
  return {
    id: q.id, texto: q.texto, titulo: q.titulo, novedad: q.novedad,
    parecidaA: de && q.novedad !== 'nueva' ? { ...de, sim: q.novedadSim ?? 0 } : null,
    fuente: fuenteDe(db, q.piezaId), toca: tocaDe(db, q.piezaId),
  }
}

/** Cómo viene el mazo antes de robar: cuántas cartas sin pesar y de qué clase (el azar a la vista). */
export function composicion(db: Db, ahora = Date.now()) {
  const filas = db.prepare(`SELECT novedad, COUNT(*) AS n FROM quantomos WHERE etapa = 'proto' GROUP BY novedad`).all() as { novedad: string | null; n: number }[]
  const de = (k: string | null) => filas.find((f) => f.novedad === k)?.n ?? 0
  const hoy = new Date(`${fechaLocal(ahora)}T00:00:00`).getTime()
  const jugadas = (db.prepare(`SELECT COUNT(*) AS n FROM mano_jugadas WHERE deshecha = 0 AND en >= ?`).get(hoy) as { n: number }).n
  return { total: filas.reduce((s, f) => s + f.n, 0), nuevas: de('nueva'), variaciones: de('variacion'), repetidas: de('repetida'), sinVector: de(null), jugadasHoy: jugadas, sorpresas: tasaDeSorpresas(db) }
}

/**
 * Cuántas afirmaciones nuevas de verdad (no se parecen a nada que tenga) llegaron desde la última vez que jugó (o en la
 * última semana): es lo único que hace aparecer el aviso en Hoy. No cuenta el montón acumulado: eso sería presión por
 * volumen, no novedad.
 */
export function nuevasParaJugar(db: Db, ahora = Date.now()): number {
  const ultima = (db.prepare('SELECT MAX(en) AS en FROM mano_jugadas').get() as { en: number | null }).en ?? 0
  const desde = Math.max(ultima, ahora - SEMANA)
  return (db.prepare(`SELECT COUNT(*) AS n FROM quantomos WHERE etapa = 'proto' AND novedad = 'nueva' AND creado_en > ?`).get(desde) as { n: number }).n
}

/** Una mano: hasta n cartas sin pesar, lo nuevo primero, en un orden fijo por día. */
export function robar(db: Db, o: { n?: number; saltear?: number[]; ahora?: number } = {}): Carta[] {
  const saltear = (o.saltear ?? []).filter(Number.isFinite).slice(-200)
  const filas = db.prepare(`SELECT q.id FROM quantomos q WHERE q.etapa = 'proto'
      ${saltear.length ? `AND q.id NOT IN (${saltear.map(() => '?').join(',')})` : ''}
    ORDER BY ${ORDEN} LIMIT ?`).all(...saltear, (o.ahora ?? Date.now()) - SEMANA, semilla(o.ahora ?? Date.now()), Math.min(Math.max(o.n ?? 5, 1), 12)) as { id: number }[]
  return filas.map((f) => carta(db, leerQuantomo(db, f.id)!))
}

/** Lo sellado más parecido a un quántomo, con su parecido y la fecha de su pieza. */
async function selladosCerca(db: Db, id: number): Promise<Vecino[]> {
  const cerca = (await parecidosA(db, id, 60)).filter((x) => x.sim >= UMBRAL_VECINO)
  if (!cerca.length) return []
  const filas = new Map((db.prepare(`SELECT q.id, q.texto, q.peso, c.fecha FROM quantomos q LEFT JOIN corpus c ON c.id = q.pieza_id
    WHERE q.etapa = 'sellado' AND q.id IN (${cerca.map(() => '?').join(',')})`).all(...cerca.map((x) => x.id)) as any[]).map((r) => [r.id, r]))
  return cerca.filter((x) => filas.has(x.id)).map((x) => {
    const r = filas.get(x.id)
    return { id: x.id, texto: r.texto, peso: r.peso, sim: x.sim, fecha: r.fecha ? String(r.fecha).slice(0, 10) : null }
  })
}

export type Jugada = {
  jugadaId: number
  gesto: Gesto
  carta: { id: number; texto: string; peso: number | null; etapa: string }
  /** Las 3 cosas que ya sabía con las que más conecta. */
  vecinos: Vecino[]
  /** Lo que pesó alto (≥ 9) y dice casi lo mismo: lo que esta carta refuerza. */
  refuerza: Vecino[]
  /** Si marcó «choca»: lo pesado alto más cercano, candidato a ser lo que contradice. */
  chocaCon: Vecino[]
  toca: Toca
  /** Lo que no podía predecir: un puente no obvio o un combo (la hipótesis llega después, por la nube). */
  sorpresas: Sorpresa[]
  ms: number
}

/** Juega una carta: la pesa, la descarta o la marca como choque, y devuelve enseguida con qué conecta. */
export async function jugar(db: Db, id: number, g: { gesto: Gesto; peso?: number | null; porque?: string | null }, ahora = Date.now()): Promise<Jugada> {
  const t0 = performance.now()
  const q = leerQuantomo(db, id)
  if (!q) throw new Error(`No existe la carta ${id}`)
  if (q.etapa !== 'proto' && q.etapa !== 'sellado') throw new Error(`Esa carta ya está ${q.etapa}`)
  if (!['peso', 'descartar', 'choca'].includes(g.gesto)) throw new Error('El gesto es peso, descartar o choca')
  if (g.gesto === 'peso') sellar(db, id, Number(g.peso), ahora)
  else if (g.gesto === 'descartar') descartar(db, id, ahora)
  const porque = String(g.porque ?? '').trim().slice(0, 500) || null
  const jugadaId = Number(db.prepare(`INSERT INTO mano_jugadas (quantomo_id, gesto, peso, porque, etapa_antes, peso_antes, en) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, g.gesto, g.gesto === 'peso' ? Number(g.peso) : null, porque, q.etapa, q.peso, ahora).lastInsertRowid)
  const despues = leerQuantomo(db, id)!
  const cerca = g.gesto === 'descartar' ? [] : await selladosCerca(db, id)
  const sorpresas: Sorpresa[] = []
  if (g.gesto === 'peso') {
    const puente = buscarPuente(db, q, cerca, jugadaId, ahora)
    if (puente) sorpresas.push(puente)
    const combo = buscarCombo(db, q, jugadaId, ahora)
    if (combo) sorpresas.push(combo)
    recalibrarPuente(db, ahora)
    // Lo que pesó alto y habla de lo mismo puede reforzarlo o contradecirlo: eso lo decide un modelo, en la nube y sin esperar.
    const dudosos = cerca.filter((v) => (v.peso ?? 0) >= PESO_CREENCIA && v.sim >= 0.7).slice(0, 2)
    if (dudosos.length && nube()) enFondo(revisarChoque(db, id, dudosos, jugadaId, ahora))
  }
  return {
    jugadaId, gesto: g.gesto,
    carta: { id, texto: despues.texto, peso: despues.peso, etapa: despues.etapa },
    vecinos: cerca.slice(0, 3),
    refuerza: g.gesto === 'peso' ? cerca.filter((v) => (v.peso ?? 0) >= PESO_CREENCIA && v.sim >= UMBRAL_VARIACION).slice(0, 2) : [],
    chocaCon: g.gesto === 'choca' ? cerca.filter((v) => (v.peso ?? 0) >= PESO_CREENCIA - 1).slice(0, 3) : [],
    toca: tocaDe(db, q.piezaId),
    sorpresas,
    ms: Math.round(performance.now() - t0),
  }
}

/** Deshace la última carta jugada: vuelve a como estaba (sin pesar, o con el peso de antes). */
export function deshacerJugada(db: Db, ahora = Date.now()): { quantomoId: number } | null {
  const j = db.prepare('SELECT * FROM mano_jugadas WHERE deshecha = 0 ORDER BY id DESC LIMIT 1').get() as any
  if (!j) return null
  if (j.gesto !== 'choca') {
    db.prepare('UPDATE quantomos SET etapa = ?, peso = ?, actualizado_en = ? WHERE id = ?').run(j.etapa_antes, j.peso_antes, ahora, j.quantomo_id)
    if (j.etapa_antes === 'proto') anotar(db, 'quantomo', j.quantomo_id, 'deshecha', { ahora })
  }
  db.prepare('UPDATE mano_jugadas SET deshecha = 1 WHERE id = ?').run(j.id)
  // Lo que esa jugada destapó y él todavía no respondió se va con ella.
  db.prepare(`DELETE FROM mano_eventos WHERE jugada_id = ? AND estado = 'pendiente'`).run(j.id)
  return { quantomoId: j.quantomo_id }
}

// ─── las sorpresas: lo que no podía predecir ────────────────────────────
// Salen de los datos, nunca de un sorteo, y cada una trae sus fuentes. Su frecuencia se regula sola (un umbral que sube si
// salen demasiado o si las marca «casualidad», y baja si no salen nunca): frecuente es ruido, nunca es extinción.

export type Sorpresa = {
  id: number
  tipo: 'puente' | 'contradiccion' | 'combo'
  estado: string
  /** Puente: por qué los une; contradicción: por qué chocan; combo: la hipótesis (null hasta que llegue). */
  texto: string | null
  sim: number | null
  /** Los mundos (fuentes) que cruza. */
  mundos: string[]
  cartas: { id: number; texto: string; peso: number | null; fuente: string | null; pieza: string | null; fecha: string | null }[]
  hipotesisId: number | null
  creadoEn: number
}

/** El parecido mínimo de un puente, regulado por lo que pasó (arranca en 0,80; entre 0,70 y 0,95). */
export const PUENTE_BASE = 0.8
export const umbralPuente = (db: Db) => Number(ajuste(db, 'mano_umbral_puente') ?? PUENTE_BASE)
/** La frecuencia buscada: una sorpresa cada 6 a 10 cartas pesadas. */
export const TASA = { min: 1 / 10, max: 1 / 6 }
export const COMBO_SIM = 0.7
const SESION = 2 * 3_600_000

const pendientes = new Set<Promise<unknown>>()
function enFondo(p: Promise<unknown>) {
  const q: Promise<unknown> = p.catch((e) => console.error('  mano:', e instanceof Error ? e.message : e)).finally(() => pendientes.delete(q))
  pendientes.add(q)
}
/** Para los tests: espera lo que quedó corriendo en segundo plano (los modelos). */
export async function _esperarFondo() {
  while (pendientes.size) await Promise.all([...pendientes])
}
let modelo = async (db: Db, sistema: string, usuario: string): Promise<any> =>
  (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'mano' }, sistema, usuario, { temperatura: 0.3, maxTokens: 700 })).datos
let nube = enLaNube
export function _probarMano(o: { modelo?: typeof modelo; nube?: () => boolean }) {
  if (o.modelo) modelo = o.modelo
  if (o.nube) nube = o.nube
}

/** De qué fuente (y pieza) viene cada quántomo, para mostrar las fuentes y saber si dos vienen de mundos distintos. */
function origenes(db: Db, ids: number[]) {
  if (!ids.length) return new Map<number, any>()
  return new Map((db.prepare(`SELECT q.id, q.texto, q.peso, q.pieza_id, c.titulo AS pieza, c.fecha, c.fuente, COALESCE(f.nombre, c.fuente) AS mundo
    FROM quantomos q LEFT JOIN corpus c ON c.id = q.pieza_id LEFT JOIN fuentes f ON f.id = c.fuente WHERE q.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as any[]).map((r) => [r.id, r]))
}

function crearEvento(db: Db, e: { tipo: Sorpresa['tipo']; jugadaId: number | null; quantomoId: number; otroId?: number | null; ids: number[]; sim?: number | null; texto?: string | null; estado?: string }, ahora: number): number {
  return Number(db.prepare(`INSERT INTO mano_eventos (tipo, jugada_id, quantomo_id, otro_id, ids, sim, texto, estado, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(e.tipo, e.jugadaId, e.quantomoId, e.otroId ?? null, JSON.stringify(e.ids), e.sim ?? null, e.texto ?? null, e.estado ?? 'pendiente', ahora).lastInsertRowid)
}

export function leerSorpresa(db: Db, id: number): Sorpresa | null {
  const r = db.prepare('SELECT * FROM mano_eventos WHERE id = ?').get(id) as any
  if (!r) return null
  const ids: number[] = json(r.ids, [])
  const o = origenes(db, ids)
  const cartas = ids.filter((i) => o.has(i)).map((i) => {
    const x = o.get(i)
    return { id: i, texto: x.texto, peso: x.peso, fuente: x.mundo ?? null, pieza: x.pieza ?? null, fecha: x.fecha ? String(x.fecha).slice(0, 10) : null }
  })
  return {
    id: r.id, tipo: r.tipo, estado: r.estado, texto: r.texto, sim: r.sim, cartas, creadoEn: r.creado_en,
    mundos: [...new Set(cartas.map((c) => c.fuente).filter((m): m is string => !!m))], hipotesisId: r.tipo === 'combo' ? r.otro_id : null,
  }
}

/** Lo que destapó y todavía no respondió (de lo más nuevo a lo más viejo). */
export function sorpresasPendientes(db: Db, limite = 10): Sorpresa[] {
  return (db.prepare(`SELECT id FROM mano_eventos WHERE estado IN ('pendiente', 'sin_hipotesis') ORDER BY id DESC LIMIT ?`).all(limite) as { id: number }[])
    .map((r) => leerSorpresa(db, r.id)).filter((s): s is Sorpresa => !!s)
}

/** ¿Las piezas de dos quántomos ya estaban relacionadas (la misma pieza o una entidad en común)? */
function yaRelacionados(db: Db, a: number | null, b: number | null): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return !!db.prepare('SELECT 1 FROM corpus_entidades x JOIN corpus_entidades y ON y.entidad_id = x.entidad_id WHERE x.pieza_id = ? AND y.pieza_id = ? LIMIT 1').get(a, b)
}

/**
 * El puente no obvio: algo que pesó alto (≥ 8) dice casi lo mismo que la carta, pero viene de otro mundo (otra fuente) y
 * nunca aparecieron juntos (ni en la misma pieza ni con una entidad en común). Cerca en sentido, lejos en lo que ya relacionó.
 */
function buscarPuente(db: Db, q: Quantomo, cerca: Vecino[], jugadaId: number, ahora: number): Sorpresa | null {
  const umbral = umbralPuente(db)
  const candidatos = cerca.filter((v) => (v.peso ?? 0) >= 8 && v.sim >= umbral)
  if (!candidatos.length) return null
  const o = origenes(db, [q.id, ...candidatos.map((v) => v.id)])
  const yo = o.get(q.id)
  const ya = db.prepare(`SELECT 1 FROM mano_eventos WHERE tipo = 'puente' AND ((quantomo_id = ? AND otro_id = ?) OR (quantomo_id = ? AND otro_id = ?)) LIMIT 1`)
  for (const v of candidatos) {
    const otro = o.get(v.id)
    if (!yo?.fuente || !otro?.fuente || yo.fuente === otro.fuente) continue
    if (yaRelacionados(db, yo.pieza_id, otro.pieza_id) || ya.get(q.id, v.id, v.id, q.id)) continue
    const texto = `Se parecen ${Math.round(v.sim * 100)} % y nunca aparecieron juntos: uno viene de ${yo.mundo}, el otro de ${otro.mundo}.`
    return leerSorpresa(db, crearEvento(db, { tipo: 'puente', jugadaId, quantomoId: q.id, otroId: v.id, ids: [q.id, v.id], sim: v.sim, texto }, ahora))
  }
  return null
}

/** El parecido entre dos quántomos (por sus vectores), o null si a alguno le falta. */
function parecido(vecs: Map<number, Float32Array>, a: number, b: number): number | null {
  const x = vecs.get(a)
  const y = vecs.get(b)
  if (!x || !y) return null
  let s = 0
  for (let i = 0; i < Math.min(x.length, y.length); i++) s += x[i] * y[i]
  return s
}

/**
 * El combo: tres o más cartas pesadas en esta sesión (las últimas 2 horas) que se parecen entre sí (≥ 0,7 de a pares)
 * y vienen de al menos dos mundos. En la nube, un modelo arma una hipótesis con ellas (que vuelve como carta nueva).
 */
function buscarCombo(db: Db, q: Quantomo, jugadaId: number, ahora: number): Sorpresa | null {
  const usadas = new Set((db.prepare(`SELECT ids FROM mano_eventos WHERE tipo = 'combo' AND creado_en >= ?`).all(ahora - SESION) as { ids: string }[]).flatMap((r) => json<number[]>(r.ids, [])))
  if (usadas.has(q.id)) return null
  const sesion = (db.prepare(`SELECT DISTINCT j.quantomo_id AS id FROM mano_jugadas j JOIN quantomos q ON q.id = j.quantomo_id
    WHERE j.gesto = 'peso' AND j.deshecha = 0 AND j.en >= ? AND q.etapa = 'sellado' AND j.quantomo_id != ?`).all(ahora - SESION, q.id) as { id: number }[])
    .map((r) => r.id).filter((i) => !usadas.has(i))
  if (sesion.length < 2) return null
  const ids = [q.id, ...sesion]
  const vecs = new Map((db.prepare(`SELECT id, vec FROM vec_items WHERE tipo = 'quantomo' AND id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: number; vec: Uint8Array }[])
    .map((r) => [r.id, new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength))]))
  // Del más parecido a la carta al menos; entra al cúmulo solo si se parece a todos los que ya están.
  const cumulo = [q.id]
  const porParecido = sesion.map((i) => ({ i, s: parecido(vecs, q.id, i) ?? 0 })).filter((x) => x.s >= COMBO_SIM).sort((a, b) => b.s - a.s)
  for (const { i } of porParecido) if (cumulo.every((c) => (parecido(vecs, c, i) ?? 0) >= COMBO_SIM)) cumulo.push(i)
  if (cumulo.length < 3) return null
  const o = origenes(db, cumulo)
  if (new Set(cumulo.map((i) => o.get(i)?.fuente).filter(Boolean)).size < 2) return null
  // La hipótesis gasta tokens: se arma solo en la nube. Acá el combo queda anotado igual (y él puede decir si vale).
  const id = crearEvento(db, { tipo: 'combo', jugadaId, quantomoId: q.id, ids: cumulo, texto: nube() ? null : 'La hipótesis se arma en tu Deprocast de la nube (gasta tokens); acá queda el combo anotado.' }, ahora)
  if (nube()) enFondo(armarHipotesis(db, id, ahora))
  return leerSorpresa(db, id)
}

const SISTEMA_HIPOTESIS = `Te paso afirmaciones que una persona pesó como importantes y que vienen de fuentes distintas de su vida. Armá UNA hipótesis que las conecte y que se pueda poner a prueba.
- "hipotesis": una frase, concreta, en segunda persona o impersonal ("Los días que…", "Cuando…").
- "predice": qué tendría que pasar si es cierta.
- "refutaria": qué la tiraría abajo.
Si no hay una hipótesis honesta que las una, devolvé {"hipotesis": null}.
Forma: {"hipotesis": string|null, "predice": string, "refutaria": string}`

async function armarHipotesis(db: Db, eventoId: number, ahora: number) {
  const s = leerSorpresa(db, eventoId)
  if (!s) return
  const r = await modelo(db, SISTEMA_HIPOTESIS, s.cartas.map((c) => `- [${c.fuente ?? '?'}] ${c.texto}`).join('\n'))
  const h = String(r?.hipotesis ?? '').trim()
  if (!h) return void db.prepare(`UPDATE mano_eventos SET texto = ?, estado = 'sin_hipotesis' WHERE id = ?`).run('No encontré una hipótesis honesta que las una.', eventoId)
  const texto = `${h}${r.predice ? `\nPredice: ${String(r.predice).trim()}` : ''}${r.refutaria ? `\nLa tiraría abajo: ${String(r.refutaria).trim()}` : ''}`
  const qid = crearQuantomo(db, { texto: h, titulo: 'Hipótesis (combo)', universo: 'hipotesis', procedencia: `combo de ${s.cartas.map((c) => `#${c.id}`).join(', ')}`, origenId: `combo:${eventoId}` }, ahora)
  db.prepare('UPDATE mano_eventos SET texto = ?, otro_id = ? WHERE id = ?').run(texto, qid, eventoId)
}

const SISTEMA_CHOQUE = `Te paso una afirmación NUEVA y otras que la persona ya creía (las pesó alto). Para cada una decí si la nueva la refuerza, la contradice o ninguna de las dos. Contradice = no pueden ser ciertas las dos a la vez, o la nueva cambia lo que conviene hacer.
Forma: {"relaciones": [{"id": number, "relacion": "refuerza"|"contradice"|"otra", "por_que": string}]}`

/** En la nube: ¿la carta recién pesada contradice algo que ya creía? Si sí, queda una sorpresa «la creencia que se cae». */
async function revisarChoque(db: Db, id: number, viejos: Vecino[], jugadaId: number, ahora: number) {
  const q = leerQuantomo(db, id)
  if (!q) return
  const r = await modelo(db, SISTEMA_CHOQUE, `NUEVA: ${q.texto}\n\nYA CREÍA:\n${viejos.map((v) => `- [${v.id}] (peso ${v.peso}) ${v.texto}`).join('\n')}`)
  for (const x of Array.isArray(r?.relaciones) ? r.relaciones : []) {
    const v = viejos.find((y) => y.id === Number(x?.id))
    if (!v || x?.relacion !== 'contradice') continue
    if (!db.prepare('SELECT 1 FROM mano_jugadas WHERE id = ? AND deshecha = 0').get(jugadaId)) return // la deshizo mientras tanto
    crearEvento(db, { tipo: 'contradiccion', jugadaId, quantomoId: id, otroId: v.id, ids: [id, v.id], sim: v.sim, texto: String(x.por_que ?? '').trim().slice(0, 400) || null }, ahora)
  }
}

/** Él marcó «choca» y eligió con qué: queda la contradicción, pendiente de que decida qué hace con ella. */
export function marcarChoque(db: Db, nuevaId: number, viejaId: number, ahora = Date.now()): Sorpresa {
  if (!leerQuantomo(db, nuevaId) || !leerQuantomo(db, viejaId)) throw new Error('Una de las dos no existe')
  const j = db.prepare(`SELECT id FROM mano_jugadas WHERE quantomo_id = ? AND gesto = 'choca' AND deshecha = 0 ORDER BY id DESC LIMIT 1`).get(nuevaId) as { id: number } | undefined
  const ya = db.prepare(`SELECT id FROM mano_eventos WHERE tipo = 'contradiccion' AND quantomo_id = ? AND otro_id = ? AND estado = 'pendiente'`).get(nuevaId, viejaId) as { id: number } | undefined
  return leerSorpresa(db, ya?.id ?? crearEvento(db, { tipo: 'contradiccion', jugadaId: j?.id ?? null, quantomoId: nuevaId, otroId: viejaId, ids: [nuevaId, viejaId], texto: 'Lo marcaste vos: choca con lo que ya sabías.' }, ahora))!
}

export const RESPUESTAS: Record<Sorpresa['tipo'], string[]> = {
  puente: ['real', 'casualidad'],
  contradiccion: ['actualizo', 'sostengo', 'pruebo'],
  combo: ['real', 'casualidad'],
}

/**
 * Lo que él hace con una sorpresa. Puente: real o casualidad. Contradicción: actualizo (la nueva queda con el peso de lo que
 * creía y lo viejo baja a 3), sostengo (la nueva se descarta; su por qué queda) o lo pruebo una semana (side quest con fecha).
 * Combo: real (la hipótesis queda para pesarla en una mano) o casualidad (se descarta).
 */
export function responderSorpresa(db: Db, id: number, respuesta: string, porque?: string | null, ahora = Date.now()): Sorpresa {
  const s = leerSorpresa(db, id)
  if (!s) throw new Error(`No existe la sorpresa ${id}`)
  if (!RESPUESTAS[s.tipo].includes(respuesta)) throw new Error(`Se responde ${RESPUESTAS[s.tipo].join(', ')}`)
  if (s.estado !== 'pendiente' && s.estado !== 'sin_hipotesis') throw new Error('Esa ya la respondiste')
  const datos: Record<string, unknown> = { porque: String(porque ?? '').trim().slice(0, 500) || null }
  if (s.tipo === 'contradiccion') {
    const nueva = leerQuantomo(db, s.cartas[0]?.id ?? 0)
    const vieja = leerQuantomo(db, s.cartas[1]?.id ?? 0)
    if (!nueva || !vieja) throw new Error('Una de las dos ya no está')
    if (respuesta === 'actualizo') {
      datos.antes = { nueva: [nueva.etapa, nueva.peso], vieja: [vieja.etapa, vieja.peso] }
      sellar(db, nueva.id, Math.max(nueva.peso ?? 0, vieja.peso ?? 0, 1), ahora)
      if (vieja.etapa === 'sellado') db.prepare('UPDATE quantomos SET peso = ?, actualizado_en = ? WHERE id = ?').run(Math.min(vieja.peso ?? 3, 3), ahora, vieja.id)
    } else if (respuesta === 'sostengo') {
      if (nueva.etapa === 'proto') descartar(db, nueva.id, ahora)
    } else {
      const m = anotarSideQuest(db, {
        titulo: `Probar una semana: «${nueva.texto.slice(0, 90)}»`, vence: fechaLocal(ahora + 7 * 86_400_000), creadaPor: 'mano',
        detalle: `Contra lo que creías: «${vieja.texto.slice(0, 200)}». A la semana, en La Mano: ¿actualizás o sostenés?`,
      }, ahora)
      datos.mision = m.id
    }
  } else if (s.tipo === 'combo' && s.hipotesisId && respuesta === 'casualidad') descartar(db, s.hipotesisId, ahora)
  db.prepare('UPDATE mano_eventos SET estado = ?, datos = ?, respondido_en = ? WHERE id = ?').run(respuesta, JSON.stringify(datos), ahora, id)
  if (s.tipo === 'puente') recalibrarPuente(db, ahora)
  return leerSorpresa(db, id)!
}

/**
 * El umbral del puente sigue a lo que pasó: con al menos 12 cartas pesadas en las últimas 60, si salieron más de 1 cada 6
 * sube; si salieron menos de 1 cada 10, baja. Y si de los últimos 10 puentes que respondió más de la mitad fueron
 * «casualidad», sube más: el canal tiene que seguir valiendo algo.
 */
export function recalibrarPuente(db: Db, ahora = Date.now()): number {
  let u = umbralPuente(db)
  const ventana = db.prepare(`SELECT id, en FROM mano_jugadas WHERE gesto = 'peso' AND deshecha = 0 AND en <= ? ORDER BY id DESC LIMIT 60`).all(ahora) as { id: number; en: number }[]
  if (ventana.length >= 12) {
    const puentes = (db.prepare(`SELECT COUNT(*) AS n FROM mano_eventos WHERE tipo = 'puente' AND creado_en >= ?`).get(ventana.at(-1)!.en) as { n: number }).n
    const tasa = puentes / ventana.length
    if (tasa > TASA.max) u += 0.01
    else if (tasa < TASA.min) u -= 0.01
  }
  const resp = db.prepare(`SELECT estado FROM mano_eventos WHERE tipo = 'puente' AND estado IN ('real', 'casualidad') ORDER BY respondido_en DESC LIMIT 10`).all() as { estado: string }[]
  if (resp.length >= 4 && resp.filter((r) => r.estado === 'casualidad').length / resp.length > 0.5) u += 0.02
  u = Math.round(Math.min(0.95, Math.max(0.7, u)) * 1000) / 1000
  if (u !== umbralPuente(db)) fijarAjuste(db, 'mano_umbral_puente', String(u))
  return u
}

/** Cuántas sorpresas salieron por carta pesada (las últimas 100) y cuántas marcó «casualidad»: lo que se muestra a la vista. */
export function tasaDeSorpresas(db: Db) {
  const ventana = db.prepare(`SELECT en FROM mano_jugadas WHERE gesto = 'peso' AND deshecha = 0 ORDER BY id DESC LIMIT 100`).all() as { en: number }[]
  const sorpresas = ventana.length ? (db.prepare(`SELECT COUNT(*) AS n FROM mano_eventos WHERE tipo IN ('puente', 'combo') AND creado_en >= ?`).get(ventana.at(-1)!.en) as { n: number }).n : 0
  const r = db.prepare(`SELECT COUNT(*) AS n, SUM(estado = 'casualidad') AS c FROM mano_eventos WHERE estado IN ('real', 'casualidad')`).get() as { n: number; c: number | null }
  return { jugadas: ventana.length, sorpresas, unaCada: sorpresas ? Math.round(ventana.length / sorpresas) : null, respondidas: r.n, casualidad: r.c ?? 0 }
}

