/**
 * Los Logos (Fragua #235): una familia de agentes, cada uno un profesional de un rubro. No es un agente sino una
 * familia: tiene su agrupación en el archivo y una regla de nombre común («Los Logos · Laboral»), y cada miembro una
 * ficha que dice qué sabe, qué no, con qué fuentes de su corpus trabaja y a quién deriva lo que no es suyo.
 * - Nacen como generativos (el nombre es el de la familia: no se gana por nivel). Un agente que ya existe puede entrar
 *   con su nombre propio: la excepción de la familia.
 * - Contestan SOLO desde sus fuentes (las piezas de esas fuentes o bloques del corpus), citando cada cosa. Si su rubro no
 *   tiene fuente cargada, lo declaran antes de contestar (eso lo pone el código, no depende del modelo). Lo que no es de
 *   su rubro no lo contestan: dicen a quién va.
 * - El sistema sale en blanco: hay plantillas de rubros comunes (laboral, mercantil, fiscal) para no empezar de cero,
 *   pero ningún Logos se forja solo ni trae fuentes: las fuentes son suyas y las elige él.
 */
import { json, type Db } from './db.ts'
import { alias, forjar, leer, nivel, type Ficha } from './roster.ts'

export const FAMILIA_LOGOS = { id: 'logos', nombre: 'Los Logos', regla: 'Los Logos · {rubro}', descripcion: 'Profesionales por rubro: cada uno contesta desde sus fuentes y deriva lo que no es suyo.' }

export type Vinculo = { tipo: 'fuente' | 'dominio'; id: string }
export type FichaRubro = { agenteId: string; familia: string; rubro: string; sabe: string | null; noSabe: string | null; fuentes: Vinculo[]; deriva: string[]; nombrePropio: boolean; creadoEn: number }

/** Plantillas de arranque (genéricas): lo que sabe y lo que no un profesional de cada rubro, y a quién deriva. */
export const PLANTILLAS: Record<string, { rubro: string; sabe: string; noSabe: string; deriva: string[] }> = {
  laboral: {
    rubro: 'Laboral',
    sabe: 'Contratos de trabajo, convenios colectivos, jornada, despidos e indemnizaciones, Seguridad Social del trabajador, planes de igualdad, registro salarial y protocolos de acoso.',
    noSabe: 'Impuestos (IRPF, IVA), sociedades y contratos mercantiles, litigios penales.',
    deriva: ['Fiscal', 'Mercantil'],
  },
  mercantil: {
    rubro: 'Mercantil',
    sabe: 'Sociedades (constitución, estatutos, órganos, actas, juntas), contratos entre empresas, propiedad industrial, Registro Mercantil, concursos.',
    noSabe: 'Relaciones laborales e impuestos.',
    deriva: ['Laboral', 'Fiscal'],
  },
  fiscal: {
    rubro: 'Fiscal',
    sabe: 'IVA, IRPF, Impuesto de Sociedades, modelos y plazos de presentación, retenciones, facturación, deducciones y regímenes especiales.',
    noSabe: 'Contratos de trabajo y derecho de sociedades.',
    deriva: ['Laboral', 'Mercantil'],
  },
}

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim()
const capital = (s: string) => s.trim().replace(/^\p{L}/u, (c) => c.toUpperCase())

function asegurarFamilia(db: Db) {
  db.prepare('INSERT OR IGNORE INTO agente_familias (id, nombre, regla, descripcion, creada_en) VALUES (?, ?, ?, ?, ?)').run(FAMILIA_LOGOS.id, FAMILIA_LOGOS.nombre, FAMILIA_LOGOS.regla, FAMILIA_LOGOS.descripcion, Date.now())
}

export const nombreDeLogos = (rubro: string) => FAMILIA_LOGOS.regla.replace('{rubro}', capital(rubro))

const deFila = (r: any): FichaRubro => ({
  agenteId: r.agente_id, familia: r.familia, rubro: r.rubro, sabe: r.sabe, noSabe: r.no_sabe, fuentes: json<Vinculo[]>(r.fuentes, []), deriva: json<string[]>(r.deriva, []),
  nombrePropio: !!r.nombre_propio, creadoEn: r.creado_en,
})

/** Los vínculos con su corpus que existen de verdad (una fuente con ese id, o un bloque que alguna pieza lleva). */
function limpiarFuentes(db: Db, xs: unknown): Vinculo[] {
  const out: Vinculo[] = []
  for (const x of Array.isArray(xs) ? xs : []) {
    const v = typeof x === 'string' ? ({ tipo: x.startsWith('dominio:') ? 'dominio' : 'fuente', id: x.replace(/^(fuente|dominio):/, '') } as Vinculo) : (x as Vinculo)
    const id = String(v?.id ?? '').trim()
    if (!id) continue
    const tipo = v.tipo === 'dominio' ? 'dominio' : 'fuente'
    if (tipo === 'fuente' && !db.prepare('SELECT 1 FROM fuentes WHERE id = ?').get(id)) throw new Error(`No existe la fuente «${id}» en tu corpus`)
    if (!out.some((y) => y.tipo === tipo && y.id === (tipo === 'dominio' ? id.toLowerCase() : id))) out.push({ tipo, id: tipo === 'dominio' ? id.toLowerCase() : id })
  }
  return out
}

/** Cuántas piezas disponibles tiene cada fuente de un Logos (0 = la fuente está vacía). */
export function piezasDeFuentes(db: Db, fuentes: Vinculo[]): { vinculo: Vinculo; piezas: number }[] {
  return fuentes.map((v) => ({
    vinculo: v,
    piezas: (v.tipo === 'fuente'
      ? db.prepare(`SELECT COUNT(*) AS n FROM corpus WHERE fuente = ? AND estado != 'retirada'`).get(v.id)
      : db.prepare(`SELECT COUNT(*) AS n FROM corpus c WHERE c.estado != 'retirada' AND EXISTS (SELECT 1 FROM json_each(COALESCE(c.etiquetas, '[]')) WHERE value = ?)`).get(v.id)) as { n: number },
  })).map((x) => ({ vinculo: x.vinculo, piezas: x.piezas.n }))
}

export function leerLogos(db: Db, ref: string): (FichaRubro & { agente: Ficha }) | null {
  const porRubro = db.prepare(`SELECT * FROM agente_rubros WHERE familia = 'logos' AND rubro = ? COLLATE NOCASE`).get(capital(ref.replace(/^los logos\s*·\s*/i, ''))) as any
  const ag = porRubro ? leer(db, porRubro.agente_id) : leer(db, ref)
  if (!ag) return null
  const r = porRubro ?? db.prepare(`SELECT * FROM agente_rubros WHERE agente_id = ? AND familia = 'logos'`).get(ag.id)
  return r ? { ...deFila(r), agente: ag } : null
}

export function listarLogos(db: Db) {
  return (db.prepare(`SELECT r.* FROM agente_rubros r JOIN agentes a ON a.id = r.agente_id WHERE r.familia = 'logos' ORDER BY r.nombre_propio, r.rubro`).all() as any[]).map((r) => {
    const f = deFila(r)
    const ag = leer(db, f.agenteId)!
    const fuentes = piezasDeFuentes(db, f.fuentes)
    return { ...f, nombre: ag.nombre ?? ag.id, estado: ag.estado, nivel: nivel(ag), fuentesEstado: fuentes, conFuente: fuentes.some((x) => x.piezas > 0) }
  })
}

function instruccionesDe(f: Pick<FichaRubro, 'rubro' | 'sabe' | 'noSabe' | 'deriva'>): string {
  return [`Sos de Los Logos: un profesional de ${f.rubro}.`, f.sabe ? `Sabés: ${f.sabe}` : '', f.noSabe ? `No es tuyo: ${f.noSabe}` : '', f.deriva.length ? `Lo que no es tuyo lo derivás a: ${f.deriva.join(', ')}.` : '', 'Contestás solo desde tus fuentes, citando cada cosa; si no tenés fuente, lo decís antes de contestar.'].filter(Boolean).join(' ')
}

/**
 * Forja un Logos de un rubro (con la plantilla del rubro si la hay, y lo que se pase encima). Nace generativo y con el
 * nombre de la familia; si se le da un nombre propio, lo lleva (la excepción). Un rubro, un Logos.
 */
export function forjarLogos(db: Db, p: { rubro: string; sabe?: string | null; noSabe?: string | null; fuentes?: unknown; deriva?: string[] | null; nombre?: string | null; ahora?: number }) {
  asegurarFamilia(db)
  const plantilla = PLANTILLAS[normal(p.rubro)]
  const rubro = capital(plantilla?.rubro ?? p.rubro.trim()).slice(0, 60)
  if (rubro.length < 3) throw new Error('Falta el rubro')
  if (db.prepare(`SELECT 1 FROM agente_rubros WHERE familia = 'logos' AND rubro = ? COLLATE NOCASE`).get(rubro)) throw new Error(`Ya hay un Logos de ${rubro}`)
  const ficha = { rubro, sabe: p.sabe?.trim() || plantilla?.sabe || null, noSabe: p.noSabe?.trim() || plantilla?.noSabe || null, deriva: (p.deriva ?? plantilla?.deriva ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 8) }
  const fuentes = limpiarFuentes(db, p.fuentes)
  const nombre = (p.nombre?.trim() || nombreDeLogos(rubro)).slice(0, 80)
  if (db.prepare('SELECT 1 FROM agentes WHERE nombre = ? COLLATE NOCASE UNION SELECT 1 FROM lapidas WHERE nombre = ? COLLATE NOCASE').get(nombre, nombre)) throw new Error(`«${nombre}» ya fue usado en la liga`)
  const ag = forjar(db, { clase: 'generativo', instrucciones: instruccionesDe(ficha), creador: 'operador', misionPrincipal: `Contestar consultas de ${rubro} desde sus fuentes`, ahora: p.ahora })
  // El nombre es el de la familia (no se gana por nivel): la regla de nombrado de Los Logos.
  db.prepare('UPDATE agentes SET nombre = ? WHERE id = ?').run(nombre, ag.id)
  db.prepare('INSERT INTO agente_rubros (agente_id, familia, rubro, sabe, no_sabe, fuentes, deriva, nombre_propio, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ag.id, 'logos', rubro, ficha.sabe, ficha.noSabe, JSON.stringify(fuentes), JSON.stringify(ficha.deriva), p.nombre?.trim() ? 1 : 0, p.ahora ?? Date.now())
  return leerLogos(db, ag.id)!
}

/** Un agente que ya existe entra a la familia con su nombre propio (la excepción: «el Logos de lo vivo y el cielo»). */
export function sumarALogos(db: Db, agente: string, p: { rubro: string; sabe?: string | null; noSabe?: string | null; fuentes?: unknown; deriva?: string[] | null; ahora?: number }) {
  asegurarFamilia(db)
  const ag = leer(db, agente)
  if (!ag) throw new Error(`No existe el agente «${agente}»`)
  if (db.prepare('SELECT 1 FROM agente_rubros WHERE agente_id = ?').get(ag.id)) throw new Error(`${alias(ag)} ya es de una familia`)
  const rubro = capital(p.rubro).slice(0, 60)
  if (db.prepare(`SELECT 1 FROM agente_rubros WHERE familia = 'logos' AND rubro = ? COLLATE NOCASE`).get(rubro)) throw new Error(`Ya hay un Logos de ${rubro}`)
  if (!ag.nombre) db.prepare('UPDATE agentes SET nombre = ? WHERE id = ?').run(nombreDeLogos(rubro), ag.id)
  db.prepare('INSERT INTO agente_rubros (agente_id, familia, rubro, sabe, no_sabe, fuentes, deriva, nombre_propio, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ag.id, 'logos', rubro, p.sabe?.trim() || null, p.noSabe?.trim() || null, JSON.stringify(limpiarFuentes(db, p.fuentes)), JSON.stringify((p.deriva ?? []).slice(0, 8)), ag.nombre ? 1 : 0, p.ahora ?? Date.now())
  return leerLogos(db, ag.id)!
}

/** Cambia la ficha de un Logos (lo que no viene, queda); las instrucciones del agente se rehacen con ella. */
export function editarLogos(db: Db, ref: string, c: { sabe?: string | null; noSabe?: string | null; fuentes?: unknown; deriva?: string[] | null }) {
  const l = leerLogos(db, ref)
  if (!l) throw new Error(`No hay un Logos «${ref}»`)
  const f = { rubro: l.rubro, sabe: c.sabe !== undefined ? c.sabe?.trim() || null : l.sabe, noSabe: c.noSabe !== undefined ? c.noSabe?.trim() || null : l.noSabe, deriva: c.deriva !== undefined ? (c.deriva ?? []).map(String).filter(Boolean).slice(0, 8) : l.deriva }
  const fuentes = c.fuentes !== undefined ? limpiarFuentes(db, c.fuentes) : l.fuentes
  db.prepare('UPDATE agente_rubros SET sabe = ?, no_sabe = ?, fuentes = ?, deriva = ? WHERE agente_id = ?').run(f.sabe, f.noSabe, JSON.stringify(fuentes), JSON.stringify(f.deriva), l.agenteId)
  if (!l.nombrePropio) db.prepare('UPDATE agentes SET instrucciones = ? WHERE id = ?').run(instruccionesDe(f), l.agenteId)
  return leerLogos(db, l.agenteId)!
}

// ─── contestar ─────────────────────────────────────────────────────────────

/** Las piezas de sus fuentes que más tienen que ver con la pregunta (búsqueda híbrida, quedándose con las suyas). */
async function pasajesDe(db: Db, fuentes: Vinculo[], pregunta: string, limite = 6) {
  const { buscarHibrido } = await import('./semantica.ts')
  const { listarPiezas } = await import('./corpus.ts')
  const fs = new Set(fuentes.filter((v) => v.tipo === 'fuente').map((v) => v.id))
  const ds = new Set(fuentes.filter((v) => v.tipo === 'dominio').map((v) => v.id))
  const suya = (p: { fuente: string; etiquetas?: string[] }) => fs.has(p.fuente) || (p.etiquetas ?? []).some((e) => ds.has(e))
  const out = new Map<number, { id: number; titulo: string; texto: string }>()
  try {
    for (const p of await buscarHibrido(db, pregunta, 40)) if (suya(p as any) && out.size < limite) out.set(p.id, { id: p.id, titulo: p.titulo, texto: (p.fragmento ?? p.contenido).slice(0, 1500) })
  } catch { /* sin vectores: por palabras */ }
  const palabras = normal(pregunta).split(' ').filter((w) => w.length >= 5).slice(0, 4)
  for (const v of fuentes) {
    for (const q of palabras.length ? palabras : [pregunta]) {
      if (out.size >= limite) break
      for (const p of listarPiezas(db, { q, ...(v.tipo === 'fuente' ? { fuente: v.id } : { dominio: v.id }), limite: 3 }).piezas) if (out.size < limite && !out.has(p.id)) out.set(p.id, { id: p.id, titulo: p.titulo, texto: p.contenido.slice(0, 1500) })
    }
  }
  return [...out.values()]
}

export const AVISO_SIN_FUENTE = (rubro: string) => `⚠ No tengo fuente cargada de ${rubro}: lo que sigue es conocimiento general, verificalo antes de usarlo.`

/**
 * Le pregunta algo a un Logos. Contesta solo con los pasajes de sus fuentes (las citas que no salen de ahí se borran);
 * sin fuente cargada, lo declara primero; lo que no es de su rubro, lo deriva.
 */
export async function preguntarALogos(db: Db, ref: string, pregunta: string) {
  const l = leerLogos(db, ref)
  if (!l) throw new Error(`No hay un Logos «${ref}»`)
  const q = pregunta.trim()
  if (!q) throw new Error('Falta la pregunta')
  const otros = listarLogos(db).filter((x) => x.agenteId !== l.agenteId).map((x) => `${x.nombre} (${x.rubro})`)
  const conPiezas = piezasDeFuentes(db, l.fuentes).filter((x) => x.piezas > 0).map((x) => x.vinculo)
  const pasajes = conPiezas.length ? await pasajesDe(db, conPiezas, q) : []
  const sinFuente = !conPiezas.length
  const nombre = l.agente.nombre ?? l.agente.id
  const sistema = `Sos ${nombre}, de Los Logos: un profesional de ${l.rubro}.
${l.sabe ? `Lo tuyo: ${l.sabe}\n` : ''}${l.noSabe ? `No es tuyo: ${l.noSabe}\n` : ''}Si la pregunta no es de ${l.rubro}, NO la contestes: poné "fuera_de_rubro": true y en "deriva_a" a quién va (${[...l.deriva, ...otros].join(', ') || 'otro profesional'}).
${sinFuente
    ? 'No tenés fuente cargada: contestá breve, con conocimiento general, marcando lo que hay que verificar. No cites nada.'
    : 'Contestá SOLO con los pasajes de sus fuentes que vienen abajo. Cada afirmación lleva su cita [#id] (el id del pasaje). Si los pasajes no alcanzan para contestar, decí qué falta en vez de completarlo de memoria.'}
No es un dictamen: si el caso tiene consecuencias serias (un despido, una inspección, un juicio), recomendá confirmarlo con un profesional colegiado.
Castellano rioplatense, directo.
Forma: {"respuesta": string, "fuera_de_rubro": boolean, "deriva_a": string | null}`
  const usuario = `Pregunta: ${q}${pasajes.length ? `\n\nPasajes de tus fuentes:\n${pasajes.map((p) => `--- [#${p.id}] ${p.titulo}\n${p.texto}`).join('\n\n')}` : conPiezas.length ? '\n\n(No encontré pasajes de tus fuentes sobre esto.)' : ''}`
  const { pedirJson } = await import('./modelo.ts')
  const { datos } = await pedirJson<{ respuesta?: string; fuera_de_rubro?: boolean; deriva_a?: string | null }>({ db, clase: 'generativo', agenteId: l.agenteId }, sistema, usuario, { temperatura: 0.2, maxTokens: 1500 })
  db.prepare('UPDATE agentes SET ultima_corrida = ? WHERE id = ?').run(Date.now(), l.agenteId)
  const ids = new Set(pasajes.map((p) => p.id))
  // Una cita que no sale de los pasajes que se le dieron se borra (no se inventan fuentes).
  let respuesta = String(datos.respuesta ?? '').replace(/\s?\[#(\d+)\]/g, (m, id) => (ids.has(Number(id)) ? m : '')).trim()
  const citas = [...new Set([...respuesta.matchAll(/\[#(\d+)\]/g)].map((m) => Number(m[1])))]
  const fuera = !!datos.fuera_de_rubro
  if (sinFuente && !fuera) respuesta = `${AVISO_SIN_FUENTE(l.rubro)}\n\n${respuesta}`
  else if (!fuera && !citas.length && respuesta) respuesta = `${respuesta}\n\n(No encontré esto en tus fuentes de ${l.rubro}: no lo tomes como dicho por ellas.)`
  return { logos: nombre, rubro: l.rubro, respuesta, citas, sinFuente, fueraDeRubro: fuera, derivaA: fuera ? (datos.deriva_a ?? null) : null, pasajes: pasajes.map((p) => ({ id: p.id, titulo: p.titulo })) }
}
