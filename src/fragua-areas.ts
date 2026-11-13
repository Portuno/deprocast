/**
 * Las seis categorías fijas de La Fragua (Fragua #258). Antes eran nueve áreas sueltas («liga», «forja», «motores»,
 * «otro»…) más las que se colaban; «otro» se comía lo importante. Ahora: seis, sin texto libre, y un cambio de categoría
 * queda registrado con la anterior.
 */
import type { Db } from './db.ts'

export const AREAS = [
  { id: 'corpus', nombre: 'Corpus', cubre: 'ingesta, fuentes, búsqueda, quántomos, Drive, conectores' },
  { id: 'grafo', nombre: 'Grafo y entidades', cubre: 'aristas, conceptos, fichas, limpieza de nodos' },
  { id: 'chat', nombre: 'Chat', cubre: 'Mastropiero, voz, dictado, captura, guardias de fecha, respuestas cortadas' },
  { id: 'liga', nombre: 'Liga y forja', cubre: 'agentes, arquetipos, motores, economía, logs, reproceso, replays' },
  { id: 'pantalla', nombre: 'Pantalla y móvil', cubre: 'app, escritorio, navegación, diseño, notificaciones, cuentas de redes' },
  { id: 'vida', nombre: 'Vida y misiones', cubre: 'plan, runs, salud, plata, personas, línea, reservas' },
] as const
export type AreaId = (typeof AREAS)[number]['id']
export const AREA_IDS = AREAS.map((a) => a.id) as AreaId[]
export const esArea = (x: unknown): x is AreaId => AREA_IDS.includes(x as AreaId)

/** Las áreas viejas, a cuál de las seis van. «otro» no tiene destino: decide el texto. */
const VIEJAS: Record<string, AreaId> = {
  corpus: 'corpus', quantomos: 'corpus', 'quántomos': 'corpus', entidades: 'grafo', grafo: 'grafo', chat: 'chat',
  liga: 'liga', forja: 'liga', motores: 'liga', pantalla: 'pantalla', vida: 'vida', misiones: 'vida',
}
/** Por el texto, en orden (lo primero que encaja gana): lo de agentes y la máquina primero, lo de su vida después. */
const PALABRAS: [AreaId, RegExp][] = [
  ['liga', /agentes?\b|arquetipo|forja|motor(es)?\b|econom[ií]a de la liga|reproceso|\blogs?\b|\bliga\b|replay|benchmark|monedero|wallet/i],
  ['pantalla', /pantalla|\bapp\b|m[oó]vil|escritorio|\bpwa\b|navegaci[oó]n|notificaci|dise[ñn]o|\bfeed\b|cuentas de redes|reloj|anillo|gadget/i],
  ['vida', /reserva|salud|kcal|calor[ií]as|sue[ñn]o\b|\bruns?\b|misi[oó]n|primaria|patrimonio|gastos?\b|ingresos?\b|cobro|ubicaci[oó]n|\bgps\b|\bmapa\b|l[ií]nea\b|encuesta|cuotas?\b/i],
  ['chat', /\bchat\b|telegram|whatsapp|\bvoz\b|dictado|captura|guardia|respuesta/i],
  ['grafo', /grafo|arista|nodo|entidad(es)?\b|concepto/i],
  ['corpus', /corpus|drive|ingest|fuentes?\b|qu[áa]ntomo|criba|conector|second brain|\bmcp\b|youtube|tuits?\b|scrape/i],
]

/** La categoría de una propuesta: la que dijo (si es de las seis o un nombre viejo con destino), o la que dice su texto. */
export function areaDe(area: unknown, texto = ''): AreaId | null {
  const a = String(area ?? '').trim().toLowerCase()
  if (esArea(a)) return a
  if (VIEJAS[a]) return VIEJAS[a]
  for (const [id, re] of PALABRAS) if (re.test(texto)) return id
  return null
}

/** Para lo que se registra solo (autocrítica, errores, el grafo): si no encaja en nada, su categoría por origen. */
export const areaOPorOrigen = (area: unknown, texto: string, porOrigen: AreaId): AreaId => areaDe(area, texto) ?? porOrigen

/** Cambia la categoría dejando registro de la anterior (Fragua #258: nunca se cambia sin rastro). */
export function cambiarArea(db: Db, id: number, area: string, por: string, ahora = Date.now()) {
  if (!esArea(area)) throw new Error(`La categoría tiene que ser una de las seis: ${AREA_IDS.join(', ')}`)
  const p = db.prepare('SELECT area FROM propuestas WHERE id = ?').get(id) as { area: string | null } | undefined
  if (!p) throw new Error(`No existe la propuesta ${id}`)
  if (p.area === area) return { id, area, cambio: false }
  db.prepare('INSERT INTO propuestas_areas (propuesta_id, de, a, por, en) VALUES (?, ?, ?, ?, ?)').run(id, p.area, area, por, ahora)
  db.prepare('UPDATE propuestas SET area = ? WHERE id = ?').run(area, id)
  return { id, area, cambio: true }
}

/**
 * La reagrupación de una vez (12/11/2026, pedido suyo): las que él repartió a mano, a donde dijo; las demás (abiertas y
 * aceptadas), por su área vieja o su texto. Las descartadas quedan como están. Todo con registro.
 */
export const REPARTO_258: Record<AreaId, number[]> = {
  corpus: [252, 247, 246, 241, 239, 226, 219, 250, 240],
  grafo: [227, 228, 229, 230],
  chat: [237, 245, 248, 218, 243, 238],
  liga: [223, 235, 236, 234, 242, 244, 256, 257, 255],
  pantalla: [220, 221, 224, 253],
  vida: [249, 251, 254],
}
export function reagrupar(db: Db, ahora = Date.now()): { cambiadas: number } {
  const aMano = new Map<number, AreaId>()
  for (const [area, ids] of Object.entries(REPARTO_258) as [AreaId, number[]][]) for (const id of ids) aMano.set(id, area)
  const filas = db.prepare(`SELECT id, area, titulo, detalle FROM propuestas WHERE estado != 'descartada'`).all() as { id: number; area: string | null; titulo: string; detalle: string }[]
  let cambiadas = 0
  for (const p of filas) {
    const area = aMano.get(p.id) ?? areaOPorOrigen(p.area, `${p.titulo}\n${p.detalle}`, 'liga')
    if (cambiarArea(db, p.id, area, 'reagrupación #258', ahora).cambio) cambiadas++
  }
  return { cambiadas }
}

/** Las seis con cuántas abiertas tiene cada una y cuántas urgentes; arranca en la que tiene más urgentes. */
export function areasConCuenta(db: Db) {
  const filas = db.prepare(`SELECT area, COUNT(*) AS n, SUM(prioridad = 'alta') AS altas FROM propuestas WHERE estado = 'abierta' GROUP BY area`).all() as { area: string; n: number; altas: number }[]
  const areas = AREAS.map((a) => { const f = filas.find((x) => x.area === a.id); return { ...a, abiertas: f?.n ?? 0, altas: f?.altas ?? 0 } })
  const inicial = [...areas].sort((a, b) => b.altas - a.altas || b.abiertas - a.abiertas)[0]?.id ?? 'corpus'
  return { areas, inicial }
}
