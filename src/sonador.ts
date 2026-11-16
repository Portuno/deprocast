/**
 * El Soñador (Fragua #275 y #276): el turno de noche sobre la memoria. Corre de madrugada, después de que se recalcula
 * el grafo de tu voz, y hace tres cosas y solo tres:
 * - poda: marca los quántomos proto que ya no tienen una pieza viva detrás (la pieza se retiró o no existe), viejos y
 *   sin peso;
 * - consolida: junta los proto que dicen lo mismo («repetida de #…», por sentido) en uno solo con todas sus evidencias;
 * - puentea: por cada hueco abierto entre dos zonas de tu voz, escribe una frase puente con una pieza de cada lado.
 *
 * Reglas (del arquetipo): nunca sella (el peso lo pone él), nunca borra (lo que se poda queda descartado, con su rastro)
 * y nunca escribe en el corpus. Todo lo que produce es una propuesta en «Para validar», con aceptar o descartar.
 * Su riesgo es inventar conexiones lindas que no existen: un puente sin dos citas reales (una de cada lado) se descarta
 * solo, sin llegar a la bandeja. Y aprende de lo que él descarta: no vuelve a tender un puente entre las mismas zonas.
 */
import crypto from 'node:crypto'
import type { Db } from './db.ts'

export type TipoSueno = 'poda' | 'fusion' | 'puente'
export type Evidencia = { piezaId: number; titulo: string; lado?: 'A' | 'B' }
export type Sueno = {
  id: number; tipo: TipoSueno; estado: 'pendiente' | 'aceptada' | 'descartada'; quantomos: number[]; texto: string | null
  evidencias: Evidencia[]; huecoId: number | null; terminos: string[]; motivo: string | null; creadaEn: number; resueltaEn: number | null
}

const ESQUEMA = `CREATE TABLE IF NOT EXISTS suenos_noche (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  quantomos TEXT NOT NULL DEFAULT '[]',
  texto TEXT,
  evidencias TEXT NOT NULL DEFAULT '[]',
  hueco_id INTEGER,
  terminos TEXT NOT NULL DEFAULT '[]',
  motivo TEXT,
  firma TEXT NOT NULL UNIQUE,
  creada_en INTEGER NOT NULL,
  resuelta_en INTEGER
)`
const listos = new WeakSet<Db>()
function asegurar(db: Db) {
  if (listos.has(db)) return
  db.exec(ESQUEMA)
  listos.add(db)
}

const json = <T>(s: unknown, d: T): T => { try { return s ? JSON.parse(String(s)) : d } catch { return d } }
const firmaDe = (x: unknown) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 20)
const deFila = (r: any): Sueno => ({
  id: r.id, tipo: r.tipo, estado: r.estado, quantomos: json(r.quantomos, []), texto: r.texto, evidencias: json(r.evidencias, []), huecoId: r.hueco_id,
  terminos: json(r.terminos, []), motivo: r.motivo, creadaEn: r.creada_en, resueltaEn: r.resuelta_en,
})

/** Anota una propuesta (la misma no se repite: ni pendiente, ni si ya la descartó). Devuelve su id o null. */
function proponer(db: Db, s: Omit<Sueno, 'id' | 'estado' | 'creadaEn' | 'resueltaEn'>, firma: string, ahora: number): number | null {
  const r = db.prepare(`INSERT OR IGNORE INTO suenos_noche (tipo, quantomos, texto, evidencias, hueco_id, terminos, motivo, firma, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(s.tipo, JSON.stringify(s.quantomos), s.texto, JSON.stringify(s.evidencias), s.huecoId, JSON.stringify(s.terminos), s.motivo, firma, ahora)
  return r.changes ? Number(r.lastInsertRowid) : null
}

export function listarSuenos(db: Db, estado: Sueno['estado'] = 'pendiente', limite = 50): Sueno[] {
  asegurar(db)
  return (db.prepare('SELECT * FROM suenos_noche WHERE estado = ? ORDER BY id DESC LIMIT ?').all(estado, limite) as any[]).map(deFila)
}
export function leerSueno(db: Db, id: number): Sueno | null {
  asegurar(db)
  const r = db.prepare('SELECT * FROM suenos_noche WHERE id = ?').get(id)
  return r ? deFila(r) : null
}

// ─── 1. poda ─────────────────────────────────────────────────────────────

const DIA = 86_400_000

/** Los proto sin pieza viva detrás (retirada o inexistente), de más de 30 días y sin peso, de a lotes de 20. */
export function proponerPoda(db: Db, ahora = Date.now(), max = 5): number[] {
  asegurar(db)
  const ids = (db.prepare(`SELECT q.id FROM quantomos q LEFT JOIN corpus c ON c.id = q.pieza_id
      WHERE q.etapa = 'proto' AND q.peso IS NULL AND q.creado_en < ? AND (q.pieza_id IS NULL OR c.id IS NULL OR c.estado = 'retirada')
      ORDER BY q.id LIMIT ?`).all(ahora - 30 * DIA, max * 20) as { id: number }[]).map((r) => r.id)
  const hechas: number[] = []
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20)
    const id = proponer(db, { tipo: 'poda', quantomos: lote, texto: null, evidencias: [], huecoId: null, terminos: [], motivo: `${lote.length} proto sin una pieza viva detrás (su pieza se retiró o ya no está), de hace más de 30 días y sin peso.` }, firmaDe(['poda', lote]), ahora)
    if (id) hechas.push(id)
  }
  return hechas
}

// ─── 2. consolidación ───────────────────────────────────────────────────

let escribir = async (db: Db, sistema: string, usuario: string): Promise<string> =>
  (await (await import('./modelo.ts')).llamarModelo({ db, clase: 'mastropiero', agenteId: 'sonador' }, { mensajes: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }], herramientas: [], temperatura: 0.3, maxTokens: 800 })).texto.trim()
export function _probarSonador(f: typeof escribir) { escribir = f }

const SISTEMA_FUSION = `Sos El Soñador: de noche consolidás lo que el operador dijo varias veces. Te paso varios quántomos (afirmaciones atómicas suyas) que dicen lo mismo. Escribí UNA sola afirmación que los junte, con sus palabras, sin agregar nada que no esté en ninguno. Una o dos oraciones. Devolvé solo el texto.`

/** Los proto marcados «repetida de #…»: cada grupo (el original y sus repetidas) → una propuesta de fusión. */
export async function proponerFusiones(db: Db, ahora = Date.now(), max = 10): Promise<number[]> {
  asegurar(db)
  const grupos = db.prepare(`SELECT novedad_de AS raiz, GROUP_CONCAT(id) AS ids FROM quantomos WHERE etapa = 'proto' AND novedad = 'repetida' AND novedad_de IS NOT NULL
      GROUP BY novedad_de ORDER BY COUNT(*) DESC LIMIT ?`).all(max * 2) as { raiz: number; ids: string }[]
  const hechas: number[] = []
  for (const g of grupos) {
    if (hechas.length >= max) break
    const ids = [g.raiz, ...g.ids.split(',').map(Number)].filter((x, i, a) => a.indexOf(x) === i)
    const qs = (db.prepare(`SELECT q.id, q.texto, q.pieza_id, c.titulo FROM quantomos q LEFT JOIN corpus c ON c.id = q.pieza_id WHERE q.id IN (${ids.map(() => '?').join(',')}) AND q.etapa IN ('proto', 'sellado')`).all(...ids) as { id: number; texto: string; pieza_id: number | null; titulo: string | null }[])
    if (qs.length < 2) continue
    const firma = firmaDe(['fusion', qs.map((q) => q.id).sort((a, b) => a - b)])
    if (db.prepare('SELECT 1 FROM suenos_noche WHERE firma = ?').get(firma)) continue
    const texto = await escribir(db, SISTEMA_FUSION, qs.map((q) => `- [${q.id}] ${q.texto}`).join('\n')).catch(() => '')
    if (!texto) continue
    const evidencias = qs.filter((q) => q.pieza_id).map((q) => ({ piezaId: q.pieza_id!, titulo: q.titulo ?? `pieza ${q.pieza_id}` })).filter((e, i, a) => a.findIndex((x) => x.piezaId === e.piezaId) === i)
    const id = proponer(db, { tipo: 'fusion', quantomos: qs.map((q) => q.id), texto: texto.slice(0, 600), evidencias, huecoId: null, terminos: [], motivo: `${qs.length} quántomos que dicen lo mismo.` }, firma, ahora)
    if (id) hechas.push(id)
  }
  return hechas
}

// ─── 3. puentes ──────────────────────────────────────────────────────────

const SISTEMA_PUENTE = `Sos El Soñador: de noche tendés puentes entre dos zonas del pensamiento del operador que casi no se tocan. Te paso los términos de cada zona y piezas reales suyas de cada lado (con su número). Escribí UNA frase puente: una conexión concreta entre las dos zonas que esas piezas sostienen, citando al menos una pieza de cada lado con su número entre corchetes, así: [#123].
- Si las piezas no sostienen ninguna conexión real, devolvé exactamente: SIN PUENTE.
- Nada lindo que no esté en las piezas. Una o dos oraciones.`

/** Piezas suyas (nivel propia, vivas) que nombran términos de una zona, para citar. */
function piezasDeZona(db: Db, terminos: string[], excluir: number[] = [], max = 3): { id: number; titulo: string; extracto: string }[] {
  const out: { id: number; titulo: string; extracto: string }[] = []
  for (const t of terminos.slice(0, 6)) {
    if (out.length >= max) break
    const filas = db.prepare(`SELECT id, titulo, SUBSTR(contenido, 1, 400) AS extracto FROM corpus WHERE nivel = 'propia' AND estado != 'retirada' AND (contenido LIKE ? OR titulo LIKE ?) ORDER BY id DESC LIMIT 3`).all(`%${t}%`, `%${t}%`) as { id: number; titulo: string; extracto: string }[]
    for (const f of filas) if (out.length < max && !out.some((x) => x.id === f.id) && !excluir.includes(f.id)) out.push(f)
  }
  return out
}

/** Lo que él descartó: no se vuelve a tender un puente entre zonas que se parecen a esas (la mitad de los términos). */
function yaLoDescarto(db: Db, terminos: string[]): boolean {
  const descartados = (db.prepare(`SELECT terminos FROM suenos_noche WHERE tipo = 'puente' AND estado = 'descartada'`).all() as { terminos: string }[]).map((r) => new Set(json<string[]>(r.terminos, [])))
  return descartados.some((d) => { const comunes = terminos.filter((t) => d.has(t)).length; return comunes >= Math.max(2, Math.ceil(Math.min(d.size, terminos.length) / 2)) })
}

/** Por cada hueco abierto del grafo de tu voz: un puente con una pieza de cada lado (o nada). */
export async function proponerPuentes(db: Db, ahora = Date.now(), max = 3): Promise<{ propuestos: number[]; descartadosSolos: number }> {
  asegurar(db)
  let huecos: { id: number; terminosA: string[]; terminosB: string[]; bisagras: string[] }[] = []
  try {
    const { grafoPorClave } = await import('./grafo/index.ts')
    const { huecosDe } = await import('./grafo/huecos.ts')
    huecos = huecosDe(db, grafoPorClave(db, 'voz').id).filter((h) => h.estado === 'abierto')
  } catch { return { propuestos: [], descartadosSolos: 0 } }
  const propuestos: number[] = []
  let descartadosSolos = 0
  for (const h of huecos) {
    if (propuestos.length >= max) break
    const terminos = [...h.terminosA.slice(0, 5), ...h.terminosB.slice(0, 5)]
    if (yaLoDescarto(db, terminos)) continue
    const firma = firmaDe(['puente', h.id, terminos])
    if (db.prepare('SELECT 1 FROM suenos_noche WHERE firma = ?').get(firma)) continue
    const a = piezasDeZona(db, h.terminosA)
    const b = piezasDeZona(db, h.terminosB, a.map((x) => x.id))
    if (!a.length || !b.length) continue // sin una pieza de cada lado no hay de dónde citar
    const usuario = [
      `Zona A: ${h.terminosA.slice(0, 8).join(', ')}`,
      `Zona B: ${h.terminosB.slice(0, 8).join(', ')}`,
      h.bisagras.length ? `Términos que ya las rozan: ${h.bisagras.join(', ')}` : '',
      `Piezas del lado A:\n${a.map((p) => `[#${p.id}] ${p.titulo}: ${p.extracto.replace(/\s+/g, ' ')}`).join('\n')}`,
      `Piezas del lado B:\n${b.map((p) => `[#${p.id}] ${p.titulo}: ${p.extracto.replace(/\s+/g, ' ')}`).join('\n')}`,
    ].filter(Boolean).join('\n\n')
    const texto = await escribir(db, SISTEMA_PUENTE, usuario).catch(() => '')
    // Dos citas reales (una de cada lado) o se descarta solo: su riesgo es inventar conexiones lindas.
    const citadas = [...texto.matchAll(/\[#(\d+)\]/g)].map((m) => Number(m[1]))
    const deA = citadas.filter((id) => a.some((p) => p.id === id)), deB = citadas.filter((id) => b.some((p) => p.id === id))
    if (!texto || /SIN PUENTE/i.test(texto) || !deA.length || !deB.length) { descartadosSolos++; continue }
    const evidencias: Evidencia[] = [...a.filter((p) => deA.includes(p.id)).map((p) => ({ piezaId: p.id, titulo: p.titulo, lado: 'A' as const })), ...b.filter((p) => deB.includes(p.id)).map((p) => ({ piezaId: p.id, titulo: p.titulo, lado: 'B' as const }))]
    const id = proponer(db, { tipo: 'puente', quantomos: [], texto: texto.slice(0, 700), evidencias, huecoId: h.id, terminos, motivo: `Puente entre «${h.terminosA.slice(0, 3).join(', ')}» y «${h.terminosB.slice(0, 3).join(', ')}».` }, firma, ahora)
    if (id) propuestos.push(id)
  }
  return { propuestos, descartadosSolos }
}

// ─── la noche y la bandeja ───────────────────────────────────────────────

/** La pasada de la noche: poda, consolidación y puentes. */
export async function sonar(db: Db, ahora = Date.now()) {
  asegurar(db)
  const poda = proponerPoda(db, ahora)
  const fusiones = await proponerFusiones(db, ahora)
  const puentes = await proponerPuentes(db, ahora)
  return { poda: poda.length, fusiones: fusiones.length, puentes: puentes.propuestos.length, descartadosSolos: puentes.descartadosSolos }
}

/**
 * Él resuelve una propuesta. Aceptar: la poda descarta esos proto (quedan, con su rastro); la fusión crea un quántomo proto
 * nuevo con todas las evidencias y deja los juntados como superados; el puente crea un proto con sus dos citas. Nunca sella.
 */
export async function resolverSueno(db: Db, id: number, accion: string, ahora = Date.now()) {
  const s = leerSueno(db, id)
  if (!s) throw new Error(`No existe el sueño ${id}`)
  if (s.estado !== 'pendiente') return s
  if (accion !== 'aceptar') {
    db.prepare(`UPDATE suenos_noche SET estado = 'descartada', resuelta_en = ? WHERE id = ?`).run(ahora, id)
    return leerSueno(db, id)
  }
  const q = await import('./quantomos.ts')
  const citas = s.evidencias.map((e) => `#${e.piezaId}`).join(', ')
  if (s.tipo === 'poda') q.descartarLote(db, s.quantomos, 'poda del Soñador (sin pieza viva detrás)', ahora)
  else if (s.tipo === 'fusion') {
    const nuevo = q.crearQuantomo(db, { texto: s.texto ?? '', piezaId: s.evidencias[0]?.piezaId ?? null, procedencia: `El Soñador: fusión de ${s.quantomos.map((x) => `#${x}`).join(', ')}${citas ? ` · evidencias ${citas}` : ''}`, origenId: `sonador:${id}` }, ahora)
    if (nuevo) db.prepare(`UPDATE quantomos SET etapa = 'superado', padre_id = ?, actualizado_en = ? WHERE id IN (${s.quantomos.map(() => '?').join(',')}) AND etapa = 'proto'`).run(nuevo, ahora, ...s.quantomos)
  } else {
    q.crearQuantomo(db, { texto: s.texto ?? '', piezaId: s.evidencias[0]?.piezaId ?? null, procedencia: `El Soñador: puente del hueco #${s.huecoId} · ${citas}`, origenId: `sonador:${id}` }, ahora)
  }
  db.prepare(`UPDATE suenos_noche SET estado = 'aceptada', resuelta_en = ? WHERE id = ?`).run(ahora, id)
  return leerSueno(db, id)
}

/** Para la bandeja «Para validar». */
export function suenosParaBandeja(db: Db) {
  asegurar(db)
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM suenos_noche WHERE estado = 'pendiente'`).get() as { n: number }).n
  const nombre = { poda: '✂ Podar', fusion: '⊕ Juntar', puente: '⌒ Puente' }
  return {
    n,
    items: listarSuenos(db, 'pendiente', 12).map((s) => ({
      id: s.id,
      texto: `${nombre[s.tipo]}: ${s.texto ?? s.motivo ?? ''}`,
      sub: s.tipo === 'poda' ? s.motivo : `${s.motivo ?? ''}${s.evidencias.length ? ` · ${s.evidencias.map((e) => `${e.lado ? `${e.lado}: ` : ''}«${e.titulo}» [#${e.piezaId}]`).join(' · ')}` : ''}`,
    })),
  }
}
