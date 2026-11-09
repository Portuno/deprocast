/**
 * Mapamundi (plan v38, fase 7; Fragua #130 y #131): la historia como un tablero de hexágonos sobre el mapa real.
 *
 * - Cada hexágono tiene un grande de la historia y su país. Cada arista entre dos hexágonos puede ser una disputa con
 *   fecha y lugar. Cruzarla desde tu territorio dispara el pleito: se gana por la fuerza (con tus números contra los del
 *   rival) o por el discurso (quince palabras contra la postura del rival, que juzga el modelo).
 * - El resultado mueve el control y dibuja o borra rutas. Al cerrar, una ficha de tres líneas: qué pasó de verdad,
 *   qué se llevó el ganador y qué ley se saca.
 * - Un solo estado y varias lentes (Territorio, Disputas, Ideas, Cronología, Tu vida, Economía); «Tu vida» y
 *   «Economía» salen del Mapa que ya existe (tus lugares, tu línea, tus misiones, tu calendario y tus movimientos).
 *
 * La cuadrícula es propia (coordenadas axiales sobre una proyección local, sin dependencias): alcanza para una región.
 * El sistema arranca en blanco: el tablero existe cuando él elige dónde empezar (el piloto de Sagunto o su lugar).
 */
import { type Db, ajuste, fechaLocal, fijarAjuste } from './db.ts'
import { pedirJson } from './modelo.ts'

export const LENTES = ['territorio', 'disputas', 'ideas', 'cronologia', 'vida', 'economia'] as const
export type Lente = (typeof LENTES)[number]
export type Centro = { lat: number; lon: number; nombre: string; km: number }
type Ax = { q: number; r: number }

const RADIO_VIDA = 8 // hasta cuántos hexágonos del centro se anclan sus cosas
const ESPERA_REVANCHA = 24 * 3_600_000
const PALABRAS = 15

// ─── la cuadrícula ──────────────────────────────────────────────────────

export const clave = (h: Ax) => `${h.q},${h.r}`
export const deClave = (k: string): Ax => { const [q, r] = k.split(',').map(Number); return { q, r } }
const KM_LAT = 110.574
const kmLon = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180)

/** El hexágono (punta arriba) donde cae un punto. */
export function hexDe(c: Centro, lat: number, lon: number): Ax {
  const x = (lon - c.lon) * kmLon(c.lat)
  const y = (lat - c.lat) * KM_LAT
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / c.km
  const r = ((2 / 3) * y) / c.km
  return redondear(q, r)
}

function redondear(qf: number, rf: number): Ax {
  const sf = -qf - rf
  let q = Math.round(qf), r = Math.round(rf)
  const s = Math.round(sf)
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf)
  if (dq > dr && dq > ds) q = -r - s
  else if (dr > ds) r = -q - s
  return { q: q + 0, r: r + 0 }
}

/** El centro de un hexágono, en [lat, lon]. */
export function centroDe(c: Centro, h: Ax): [number, number] {
  const x = c.km * Math.sqrt(3) * (h.q + h.r / 2)
  const y = c.km * 1.5 * h.r
  return [c.lat + y / KM_LAT, c.lon + x / kmLon(c.lat)]
}

/** Los seis vértices, en [lat, lon]. */
export function vertices(c: Centro, h: Ax): [number, number][] {
  const [la, lo] = centroDe(c, h)
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i + 30) * Math.PI) / 180
    return [la + (c.km * Math.sin(a)) / KM_LAT, lo + (c.km * Math.cos(a)) / kmLon(c.lat)] as [number, number]
  })
}

const DIRS: Ax[] = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }]
export const vecinos = (h: Ax): Ax[] => DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }))
export const distancia = (a: Ax, b: Ax) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2
const sonVecinos = (a: string, b: string) => distancia(deClave(a), deClave(b)) === 1

// ─── el estado ──────────────────────────────────────────────────────────

export function centro(db: Db): Centro | null {
  try { const c = JSON.parse(ajuste(db, 'mapamundi_centro') ?? 'null'); return c && Number.isFinite(c.lat) ? c : null } catch { return null }
}
export const capital = (db: Db) => ajuste(db, 'mapamundi_capital') ?? '0,0'

export function lente(db: Db): Lente {
  const l = ajuste(db, 'mapamundi_lente') as Lente | null
  return l && LENTES.includes(l) ? l : 'territorio'
}
export function fijarLente(db: Db, l: string) {
  if (!LENTES.includes(l as Lente)) throw new Error(`Lente desconocida: ${l}`)
  fijarAjuste(db, 'mapamundi_lente', l)
  return { lente: l }
}

type Hex = { clave: string; q: number; r: number; grande: string | null; corto: string | null; pais: string | null; siglo: number | null; idea: string | null; control: 'tuyo' | 'ajeno' | null; origen: string | null }
type Disputa = {
  id: number; a: string; b: string; nombre: string; anio: number; lugar: string; postura_a: string; postura_b: string; fuerza_a: number; fuerza_b: number
  verdad: string; botin: string; ley: string; estado: 'pendiente' | 'ganada' | 'perdida'; via: string | null; resuelta_en: number | null
}

const hexes = (db: Db) => db.prepare('SELECT * FROM mapamundi_hex').all() as Hex[]
const hexPor = (db: Db, k: string) => db.prepare('SELECT * FROM mapamundi_hex WHERE clave = ?').get(k) as Hex | undefined
const disputas = (db: Db) => db.prepare('SELECT * FROM mapamundi_disputas ORDER BY anio').all() as Disputa[]
const rutas = (db: Db) => db.prepare('SELECT a, b FROM mapamundi_rutas').all() as { a: string; b: string }[]

function guardarHex(db: Db, k: string, h: { grande: string; corto?: string | null; pais: string; siglo: number; idea: string; control: 'tuyo' | 'ajeno' }, origen: string, ahora: number) {
  const { q, r } = deClave(k)
  db.prepare(`INSERT INTO mapamundi_hex (clave, q, r, grande, corto, pais, siglo, idea, control, origen, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(clave) DO UPDATE SET grande = excluded.grande, corto = excluded.corto, pais = excluded.pais, siglo = excluded.siglo, idea = excluded.idea, origen = excluded.origen`)
    .run(k, q, r, h.grande, h.corto?.trim() || null, h.pais, h.siglo, h.idea, h.control, origen, ahora)
}

type NuevaDisputa = Omit<Disputa, 'id' | 'estado' | 'via' | 'resuelta_en'>
function guardarDisputa(db: Db, d: NuevaDisputa) {
  if (!sonVecinos(d.a, d.b)) throw new Error('Una disputa va entre dos hexágonos vecinos')
  db.prepare(`INSERT OR IGNORE INTO mapamundi_disputas (a, b, nombre, anio, lugar, postura_a, postura_b, fuerza_a, fuerza_b, verdad, botin, ley) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(d.a, d.b, d.nombre, Math.round(d.anio), d.lugar, d.postura_a, d.postura_b, limite(d.fuerza_a), limite(d.fuerza_b), d.verdad, d.botin, d.ley)
}
const limite = (n: number) => Math.max(1, Math.min(10, Math.round(Number(n) || 5)))

/** Tu fuerza: la base, más dos por hexágono tuyo, más una por ruta. */
export function tuFuerza(db: Db) {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM mapamundi_hex WHERE control = 'tuyo'`).get() as { n: number }).n
  return 3 + 2 * n + rutas(db).length
}

/** De qué lado juega él en una disputa (el que controla), o null si no puede jugarla todavía. */
function tuLado(db: Db, d: Disputa, ahora: number): 'a' | 'b' | null {
  if (d.estado === 'ganada') return null
  if (d.estado === 'perdida' && d.resuelta_en && ahora - d.resuelta_en < ESPERA_REVANCHA) return null
  const ca = hexPor(db, d.a)?.control, cb = hexPor(db, d.b)?.control
  if (ca === 'tuyo' && cb !== 'tuyo') return 'a'
  if (cb === 'tuyo' && ca !== 'tuyo') return 'b'
  return null
}

// ─── el piloto: el Puerto de Sagunto con su grande y tres disputas ──────

/** Historia pública (no datos de nadie): el piloto jugable de punta a punta antes de replicar. */
export const PILOTO = {
  centro: { lat: 39.6634, lon: -0.2262, nombre: 'Puerto de Sagunto', km: 4 },
  hexes: {
    '0,0': { grande: 'Publio Cornelio Escipión, el Africano', corto: 'Escipión', pais: 'Roma', siglo: -3, idea: 'Al enemigo se lo vence aprendiendo de él y llevándole la guerra a su casa.' },
    '0,-1': { grande: 'Aníbal Barca', corto: 'Aníbal', pais: 'Cartago', siglo: -3, idea: 'Se puede invadir a una potencia por donde nadie cree que se pueda pasar.' },
    '-1,0': { grande: 'Louis-Gabriel Suchet', corto: 'Suchet', pais: 'Francia', siglo: 19, idea: 'Ocupar bien es administrar: orden, impuestos previsibles y respeto a lo local.' },
    '-1,1': { grande: 'Arsenio Martínez Campos', corto: 'Martínez Campos', pais: 'España', siglo: 19, idea: 'El orden primero: un rey que cierre las guerras civiles.' },
  } as Record<string, { grande: string; corto: string; pais: string; siglo: number; idea: string }>,
  disputas: [
    {
      a: '0,0', b: '0,-1', nombre: 'Zama', anio: -202, lugar: 'Zama, norte de África',
      postura_a: 'Cartago cae si se la ataca en África: así Aníbal tiene que volver a defenderla.',
      postura_b: 'Roma no es invencible: la vencí en Cannas y puedo volver a hacerlo.',
      fuerza_a: 7, fuerza_b: 8,
      verdad: 'Escipión venció a Aníbal en el norte de África y cerró la Segunda Guerra Púnica, que había empezado con el sitio de Sagunto (219 a. C.).',
      botin: 'Roma se quedó con Hispania y el Mediterráneo occidental; Cartago perdió su flota y su política exterior.',
      ley: 'El que estudia cómo lo vencieron gana: Escipión usó contra Aníbal lo que había aprendido de él.',
    },
    {
      a: '0,0', b: '-1,0', nombre: 'Batalla de Sagunto', anio: 1811, lugar: 'Al pie del castillo de Sagunto',
      postura_a: 'Hay que socorrer el castillo: si cae Sagunto, cae Valencia.',
      postura_b: 'Una fortaleza sin socorro ya está rendida; rendirla a tiempo salva vidas.',
      fuerza_a: 5, fuerza_b: 7,
      verdad: 'Suchet derrotó al ejército de socorro de Blake frente al castillo, que se rindió enseguida; Valencia cayó en enero de 1812.',
      botin: 'Suchet se quedó con Valencia y Napoleón lo hizo duque de la Albufera.',
      ley: 'El que depende de que lo rescaten cae el día que el rescate falla.',
    },
    {
      a: '0,0', b: '-1,1', nombre: 'Pronunciamiento de Sagunto', anio: 1874, lugar: 'Las afueras de Sagunto',
      postura_a: 'La república se defiende con leyes, no con un general que elige rey.',
      postura_b: 'España necesita orden y un rey: la república trajo tres guerras a la vez.',
      fuerza_a: 4, fuerza_b: 6,
      verdad: 'El 29 de diciembre de 1874 el general Martínez Campos proclamó rey a Alfonso XII; el gobierno no resistió y volvieron los Borbones sin batalla.',
      botin: 'La Restauración: medio siglo de turno pactado entre conservadores y liberales.',
      ley: 'Un régimen que nadie sale a defender cae con una declaración.',
    },
  ] as NuevaDisputa[],
}

const vacio = (db: Db) => !centro(db) && !(db.prepare('SELECT 1 FROM mapamundi_hex LIMIT 1').get())

/** Empieza el tablero con el piloto (solo si todavía no hay tablero). */
export function cargarPiloto(db: Db, ahora = Date.now()) {
  if (!vacio(db)) throw new Error('El Mapamundi ya tiene un tablero')
  fijarAjuste(db, 'mapamundi_centro', JSON.stringify(PILOTO.centro))
  fijarAjuste(db, 'mapamundi_capital', '0,0')
  for (const [k, h] of Object.entries(PILOTO.hexes)) guardarHex(db, k, { ...h, control: k === '0,0' ? 'tuyo' : 'ajeno' }, 'piloto', ahora)
  for (const d of PILOTO.disputas) guardarDisputa(db, d)
  return estado(db, ahora)
}

/** Empieza el tablero en otro lugar: el centro queda ahí y el primer hexágono (tuyo) se puebla con el modelo. */
export async function empezarEn(db: Db, lugar: { lat: number; lon: number; nombre: string }, ahora = Date.now()) {
  if (!vacio(db)) throw new Error('El Mapamundi ya tiene un tablero')
  fijarAjuste(db, 'mapamundi_centro', JSON.stringify({ lat: lugar.lat, lon: lugar.lon, nombre: lugar.nombre, km: 4 }))
  fijarAjuste(db, 'mapamundi_capital', '0,0')
  await poblar(db, '0,0', ahora)
  return estado(db, ahora)
}

// ─── replicar: el modelo puebla un hexágono vecino ──────────────────────

/** Un grande para un hexágono vacío (vecino de alguno poblado, o el primero) y sus disputas con los vecinos poblados. */
export async function poblar(db: Db, k: string, ahora = Date.now()) {
  const c = centro(db)
  if (!c) throw new Error('Primero elegí dónde empieza el tablero')
  if (hexPor(db, k)?.grande) throw new Error('Ese hexágono ya tiene su grande')
  const pob = hexes(db).filter((h) => h.grande)
  const vec = pob.filter((h) => sonVecinos(h.clave, k))
  if (pob.length && !vec.length) throw new Error('Se puebla de a uno, al lado de lo que ya está')
  const [lat, lon] = centroDe(c, deClave(k))
  const usados = pob.map((h) => h.grande).join('; ')
  const { datos } = await pedirJson<{ grande: string; corto?: string; pais: string; siglo: number; idea: string; disputas?: { vecino: string; nombre: string; anio: number; lugar: string; postura_tuya: string; postura_rival: string; fuerza_tuya: number; fuerza_rival: number; verdad: string; botin: string; ley: string }[] }>(
    { db, clase: 'mastropiero', agenteId: 'mapamundi' },
    `Poblás un hexágono del Mapamundi de Deprocast: un tablero donde cada hexágono tiene un grande de la historia (persona real) y su país, y cada arista con un vecino es una disputa histórica real (batalla, pleito, debate, pronunciamiento) con año y lugar.
Reglas: solo hechos históricos verificables; si no estás seguro de un dato, elegí otra disputa. Preferí grandes y disputas ligados a la historia del lugar del hexágono; si no hay, cualquier grande que no esté repetido. Las posturas son lo que defendía cada lado, en una frase. La verdad, el botín y la ley, una línea cada una. Años antes de Cristo, negativos. Siglo: entero (-3 = siglo III a. C., 19 = siglo XIX). Fuerzas: de 1 a 10.
Formato: {"grande" (el nombre completo),"corto" (como se lo conoce, una o dos palabras),"pais","siglo","idea" (la idea central del grande, una frase),"disputas":[{"vecino" (la clave del vecino),"nombre","anio","lugar","postura_tuya" (la del lado de este hexágono),"postura_rival","fuerza_tuya","fuerza_rival","verdad","botin","ley"}]}`,
    `El hexágono ${k} está centrado en ${lat.toFixed(4)}, ${lon.toFixed(4)} (el tablero empieza en ${c.nombre}; cada hexágono mide ${c.km} km).
Grandes ya usados (no repetir): ${usados || 'ninguno'}.
Vecinos poblados (una disputa con cada uno): ${vec.map((h) => `${h.clave}: ${h.grande} (${h.pais})`).join('; ') || 'ninguno'}.`,
    { temperatura: 0.5, maxTokens: 2500 },
  )
  if (!datos?.grande?.trim()) throw new Error('El modelo no propuso un grande')
  const esCapital = k === capital(db) && !pob.length
  guardarHex(db, k, { grande: datos.grande.trim(), corto: datos.corto ?? null, pais: String(datos.pais ?? '').trim(), siglo: Math.round(Number(datos.siglo) || 0), idea: String(datos.idea ?? '').trim(), control: esCapital ? 'tuyo' : 'ajeno' }, 'modelo', ahora)
  for (const d of datos.disputas ?? []) {
    if (!vec.some((h) => h.clave === d.vecino) || !d.nombre || !d.verdad) continue
    guardarDisputa(db, { a: k, b: d.vecino, nombre: d.nombre, anio: Number(d.anio) || 0, lugar: d.lugar ?? '', postura_a: d.postura_tuya ?? '', postura_b: d.postura_rival ?? '', fuerza_a: d.fuerza_tuya, fuerza_b: d.fuerza_rival, verdad: d.verdad, botin: d.botin ?? '', ley: d.ley ?? '' })
  }
  return hexPor(db, k)
}

// ─── jugar una disputa ──────────────────────────────────────────────────

let azar = Math.random
export function _probarAzar(f: () => number) { azar = f }

export const palabras = (t: string) => t.trim().split(/\s+/).filter(Boolean).length

/** El evaluador de discurso de Deprocast: quince palabras contra la postura del rival. */
export async function juzgarDiscurso(db: Db, d: { nombre: string; anio: number; rival: string; postura: string }, texto: string) {
  const { datos } = await pedirJson<{ puntaje: number; por_que: string }>(
    { db, clase: 'mastropiero', agenteId: 'mapamundi' },
    `Sos el juez de discurso del Mapamundi de Deprocast. Juzgás una réplica de como mucho ${PALABRAS} palabras contra la postura de un lado de una disputa histórica.
Puntuá de 0 a 10 con estos criterios, sin regalar: (1) responde a esa postura y no a otra cosa; (2) es concreta; (3) no contradice la historia; (4) tiene fuerza: alguien de esa época podría cambiar de idea al oírla. Las réplicas genéricas («la libertad es mejor») no pasan de 4.
Formato: {"puntaje": número de 0 a 10 con un decimal, "por_que": una línea que diga qué funcionó o qué faltó}`,
    `Disputa: ${d.nombre} (${anioTexto(d.anio)}).\nPostura del rival (${d.rival}): «${d.postura}»\nRéplica: «${texto}»`,
    { temperatura: 0.2, maxTokens: 400 },
  )
  const puntaje = Math.max(0, Math.min(10, Math.round(Number(datos.puntaje) * 10) / 10 || 0))
  return { puntaje, gana: puntaje >= 6, porQue: String(datos.por_que ?? '').trim() }
}

export const anioTexto = (a: number) => (a < 0 ? `${-a} a. C.` : String(a))

/** Juega una disputa desde su territorio: por la fuerza (al azar, con sus números) o por el discurso (lo juzga el modelo). */
export async function jugar(db: Db, id: number, o: { via: 'fuerza' | 'discurso'; texto?: string }, ahora = Date.now()) {
  const d = db.prepare('SELECT * FROM mapamundi_disputas WHERE id = ?').get(id) as Disputa | undefined
  if (!d) throw new Error('No existe esa disputa')
  const lado = tuLado(db, d, ahora)
  if (!lado) throw new Error(d.estado === 'ganada' ? 'Esa ya la ganaste' : d.estado === 'perdida' ? 'La revancha se juega al día siguiente' : 'Se juega desde un hexágono tuyo hacia uno que no lo es')
  const desde = lado === 'a' ? d.a : d.b
  const hacia = lado === 'a' ? d.b : d.a
  const rival = hexPor(db, hacia)
  let gano: boolean, puntaje: number | null = null, porQue: string | null = null, prob: number | null = null
  const texto = o.texto?.trim() ?? ''
  if (o.via === 'discurso') {
    if (!texto) throw new Error('Escribí tu réplica')
    if (palabras(texto) > PALABRAS) throw new Error(`Son ${palabras(texto)} palabras: como mucho ${PALABRAS}`)
    const j = await juzgarDiscurso(db, { nombre: d.nombre, anio: d.anio, rival: rival?.grande ?? 'el rival', postura: lado === 'a' ? d.postura_b : d.postura_a }, texto)
    gano = j.gana; puntaje = j.puntaje; porQue = j.porQue
  } else {
    const tuya = tuFuerza(db)
    const suya = 2 * (lado === 'a' ? d.fuerza_b : d.fuerza_a)
    prob = tuya / (tuya + suya)
    gano = azar() < prob
  }
  db.prepare('INSERT INTO mapamundi_jugadas (disputa_id, desde, via, texto, puntaje, gano, por_que, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, desde, o.via, texto || null, puntaje, gano ? 1 : 0, porQue, ahora)
  db.prepare('UPDATE mapamundi_disputas SET estado = ?, via = ?, resuelta_en = ? WHERE id = ?').run(gano ? 'ganada' : 'perdida', o.via, ahora, id)
  let cambio: string
  if (gano) {
    db.prepare(`UPDATE mapamundi_hex SET control = 'tuyo' WHERE clave = ?`).run(hacia)
    db.prepare('INSERT OR IGNORE INTO mapamundi_rutas (a, b) VALUES (?, ?)').run(...[desde, hacia].sort())
    cambio = `${rival?.grande ?? 'Ese hexágono'} pasa a tu lado y se abre una ruta.`
  } else if (desde !== capital(db)) {
    db.prepare(`UPDATE mapamundi_hex SET control = 'ajeno' WHERE clave = ?`).run(desde)
    db.prepare('DELETE FROM mapamundi_rutas WHERE a = ? OR b = ?').run(desde, desde)
    cambio = 'Perdés el hexágono desde el que saliste, y sus rutas.'
  } else cambio = 'Tu capital resiste. La revancha, mañana.'
  return { gano, via: o.via, puntaje, porQue, prob, cambio, ficha: { verdad: d.verdad, botin: d.botin, ley: d.ley } }
}

// ─── lo que ve la pantalla ──────────────────────────────────────────────

type Ancla = { titulo: string; capa: string; fecha: string | null; hoy: boolean }

/** Su vida y su plata anclados al hexágono donde ocurren (sale del Mapa que ya existe). */
async function anclas(db: Db, c: Centro, ahora: number) {
  const vida = new Map<string, Ancla[]>()
  const plata = new Map<string, { ingresos: number; gastos: number; n: number }>()
  const hoy = fechaLocal(ahora)
  const cerca = (h: Ax) => distancia(h, { q: 0, r: 0 }) <= RADIO_VIDA
  try {
    const { puntosDelMapa } = await import('./mapa.ts')
    const { puntos } = await puntosDelMapa(db, new Set(['lugar', 'linea', 'mision', 'google']), ahora)
    for (const p of puntos) {
      const h = hexDe(c, p.lat, p.lon)
      if (!cerca(h)) continue
      const k = clave(h)
      if (!vida.has(k)) vida.set(k, [])
      vida.get(k)!.push({ titulo: p.titulo, capa: p.capa, fecha: p.fecha, hoy: p.fecha?.slice(0, 10) === hoy })
    }
    // La plata: los movimientos del último año atados a un lugar con posición (por la entidad o por su nombre en la descripción).
    const lugares = (db.prepare(`SELECT id, nombre, meta FROM entidades WHERE tipo = 'lugar'`).all() as { id: number; nombre: string; meta: string | null }[])
      .map((l) => { const m = (() => { try { return JSON.parse(l.meta ?? '{}') } catch { return {} } })(); return { ...l, lat: Number(m.lat), lon: Number(m.lon) } })
      .filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lon) && l.nombre.length >= 4)
    if (lugares.length) {
      const desde = new Date(ahora - 365 * 86_400_000).toISOString().slice(0, 10)
      for (const m of db.prepare('SELECT monto, descripcion, entidad_id FROM movimientos WHERE fecha >= ?').all(desde) as { monto: number; descripcion: string; entidad_id: number | null }[]) {
        const t = m.descripcion.toLowerCase()
        const l = lugares.find((x) => x.id === m.entidad_id) ?? lugares.find((x) => t.includes(x.nombre.toLowerCase()))
        if (!l) continue
        const h = hexDe(c, l.lat, l.lon)
        if (!cerca(h)) continue
        const k = clave(h)
        const e = plata.get(k) ?? { ingresos: 0, gastos: 0, n: 0 }
        if (m.monto >= 0) e.ingresos += m.monto
        else e.gastos += -m.monto
        e.n++
        plata.set(k, e)
      }
    }
  } catch (e) { console.error('  mapamundi (anclas):', e instanceof Error ? e.message : e) }
  return { vida, plata }
}

/** El estado entero (uno solo) y la lente que eligió la última vez. */
export async function estado(db: Db, ahora = Date.now()) {
  const c = centro(db)
  if (!c) return { centro: null, lente: lente(db), piloto: { nombre: PILOTO.centro.nombre, disputas: PILOTO.disputas.length } }
  const hs = hexes(db)
  const ds = disputas(db)
  const { vida, plata } = await anclas(db, c, ahora)
  // El tablero visible: lo poblado, sus vecinos (para poblar) y donde hay algo de su vida o su plata.
  const claves = new Set<string>(hs.map((h) => h.clave))
  for (const h of hs) if (h.grande) for (const v of vecinos(h)) claves.add(clave(v))
  for (const k of [...vida.keys(), ...plata.keys()]) claves.add(k)
  if (!claves.size) claves.add('0,0')
  const porClave = new Map(hs.map((h) => [h.clave, h]))
  const poblados = hs.filter((h) => h.grande)
  return {
    centro: c,
    capital: capital(db),
    lente: lente(db),
    fuerza: tuFuerza(db),
    hexes: [...claves].map((k) => {
      const h = porClave.get(k)
      const ax = deClave(k)
      return {
        clave: k, centro: centroDe(c, ax), vertices: vertices(c, ax),
        grande: h?.grande ?? null, corto: h?.corto ?? null, pais: h?.pais ?? null, siglo: h?.siglo ?? null, idea: h?.idea ?? null, control: h?.control ?? null,
        poblable: !h?.grande && (poblados.length ? poblados.some((p) => sonVecinos(p.clave, k)) : k === capital(db)),
        vida: (vida.get(k) ?? []).slice(0, 30), plata: plata.get(k) ?? null,
      }
    }),
    disputas: ds.map((d) => {
      const lado = tuLado(db, d, ahora)
      const ult = db.prepare('SELECT via, texto, puntaje, gano, por_que, en FROM mapamundi_jugadas WHERE disputa_id = ? ORDER BY id DESC LIMIT 1').get(d.id) as any
      return {
        id: d.id, a: d.a, b: d.b, nombre: d.nombre, anio: d.anio, anioTexto: anioTexto(d.anio), lugar: d.lugar, estado: d.estado, via: d.via,
        jugable: !!lado, rival: lado ? porClave.get(lado === 'a' ? d.b : d.a)?.grande ?? null : null,
        postura: lado ? (lado === 'a' ? d.postura_b : d.postura_a) : null, tuPostura: lado ? (lado === 'a' ? d.postura_a : d.postura_b) : null,
        prob: lado ? Math.round((100 * tuFuerza(db)) / (tuFuerza(db) + 2 * (lado === 'a' ? d.fuerza_b : d.fuerza_a))) : null,
        ficha: d.estado !== 'pendiente' ? { verdad: d.verdad, botin: d.botin, ley: d.ley } : null,
        ultima: ult ? { via: ult.via, texto: ult.texto, puntaje: ult.puntaje, gano: !!ult.gano, porQue: ult.por_que } : null,
      }
    }),
    rutas: rutas(db).map((r) => [r.a, r.b]),
  }
}

/** Para el chat: un resumen corto del tablero y lo que se puede jugar. */
export async function resumen(db: Db, ahora = Date.now()) {
  const e = await estado(db, ahora)
  if (!e.centro) return { tablero: 'Todavía no hay tablero: se empieza desde Mapamundi (el piloto de Sagunto o un lugar suyo).' }
  const hs = e.hexes!.filter((h) => h.grande)
  return {
    empieza_en: e.centro.nombre,
    tuyos: hs.filter((h) => h.control === 'tuyo').map((h) => `${h.grande} (${h.pais})`),
    ajenos: hs.filter((h) => h.control === 'ajeno').map((h) => `${h.grande} (${h.pais})`),
    tu_fuerza: e.fuerza,
    jugables: e.disputas!.filter((d) => d.jugable).map((d) => ({ id: d.id, disputa: `${d.nombre} (${d.anioTexto})`, rival: d.rival, postura_del_rival: d.postura, chance_por_fuerza: `${d.prob}%` })),
    cerradas: e.disputas!.filter((d) => d.ficha).map((d) => ({ disputa: `${d.nombre} (${d.anioTexto})`, resultado: d.estado, ley: d.ficha!.ley })),
  }
}
