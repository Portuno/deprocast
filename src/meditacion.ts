/**
 * Meditación: ejercicios de respiración y binaural beats, hechos a medida.
 * - Un ejercicio es una secuencia de fases (inhalar, retener, exhalar, sostener con los pulmones vacíos) que se repite
 *   por ciclos o por minutos, más un sonido opcional: binaural beats (dos tonos, uno por oído, que difieren en el
 *   «pulso»), que puede ir de un pulso a otro a lo largo de la sesión, con ruido de fondo y siguiendo la respiración.
 * - Hay unos de base (los clásicos: caja, 4-7-8, coherencia, suspiro, solo binaural) y los suyos: los arma a mano, o
 *   los pide en palabras («algo para dormir en 10 minutos») y el modelo los diseña. Todo se valida y se acota acá.
 * - Cada sesión queda anotada (cuánto duró, si la terminó, cómo quedó): los días y minutos del mes, sin rachas.
 * El sonido lo hace la pantalla (Web Audio); acá vive lo que se guarda.
 */
import type { DatabaseSync } from 'node:sqlite'
import { fechaLocal, json } from './db.ts'

type Db = DatabaseSync

export const TIPOS_FASE = ['inhalar', 'retener', 'exhalar', 'sostener'] as const
export type TipoFase = (typeof TIPOS_FASE)[number]
export type Fase = { tipo: TipoFase; seg: number }
export const RUIDOS = ['ninguno', 'blanco', 'rosa', 'marron'] as const
export type Binaural = { activo: boolean; portadora: number; pulso: number; pulsoFinal: number | null; volumen: number; ruido: (typeof RUIDOS)[number]; volumenRuido: number; sigueRespiracion: boolean }
export type Ejercicio = {
  id: string; nombre: string; intencion: string; descripcion: string; fases: Fase[]; ciclos: number | null; minutos: number | null
  binaural: Binaural; marcarFases: boolean; origen: 'base' | 'propia' | 'a_medida'; pedido: string | null; creadaEn: number | null; usos: number; ultima: number | null
}

/** Las bandas del pulso (lo que se suele asociar a cada una; orientativo). */
export const BANDAS = [
  { nombre: 'Delta', desde: 0.5, hasta: 4, para: 'sueño profundo' },
  { nombre: 'Theta', desde: 4, hasta: 8, para: 'relajación profunda, imágenes, el borde del sueño' },
  { nombre: 'Alfa', desde: 8, hasta: 13, para: 'calma despierta, bajar el ruido' },
  { nombre: 'Beta', desde: 13, hasta: 30, para: 'atención, alerta, trabajo' },
  { nombre: 'Gamma', desde: 30, hasta: 45, para: 'foco intenso (corto)' },
]

const LIMITES = { seg: [1, 30] as const, ciclos: [1, 200] as const, minutos: [1, 120] as const, portadora: [40, 1000] as const, pulso: [0.5, 45] as const }
const acotar = (v: unknown, [min, max]: readonly [number, number], defecto: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defecto }
const redondo = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

/** Un sonido por defecto: alfa suave, sin ruido. */
const BINAURAL_DEFECTO: Binaural = { activo: true, portadora: 200, pulso: 10, pulsoFinal: null, volumen: 0.35, ruido: 'ninguno', volumenRuido: 0.2, sigueRespiracion: true }

/**
 * Deja un ejercicio en forma (venga de la pantalla, del chat o del modelo): fases conocidas y de 1 a 30 s, un largo
 * (ciclos o minutos), el pulso entre 0,5 y 45 Hz, la portadora entre 40 y 1000 Hz. Sin fases, es solo sonido y pide minutos.
 */
export function normalizar(x: any): Omit<Ejercicio, 'id' | 'origen' | 'pedido' | 'creadaEn' | 'usos' | 'ultima'> {
  const nombre = String(x?.nombre ?? '').trim().slice(0, 80)
  if (nombre.length < 2) throw new Error('El ejercicio necesita un nombre')
  const fases: Fase[] = (Array.isArray(x?.fases) ? x.fases : []).slice(0, 12).map((f: any) => {
    const tipo = String(f?.tipo ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') as TipoFase
    if (!TIPOS_FASE.includes(tipo)) throw new Error(`Fase desconocida «${f?.tipo}»: va inhalar, retener, exhalar o sostener`)
    return { tipo, seg: redondo(acotar(f?.seg, LIMITES.seg, 4)) }
  })
  if (fases.length && !fases.some((f) => f.tipo === 'inhalar') ) throw new Error('Una respiración sin inhalar no se puede seguir')
  const b = x?.binaural ?? {}
  const ruido = RUIDOS.includes(b.ruido) ? b.ruido : 'ninguno'
  const pulsoFinal = b.pulsoFinal == null || b.pulsoFinal === '' ? null : redondo(acotar(b.pulsoFinal, LIMITES.pulso, 10))
  const binaural: Binaural = {
    activo: b.activo !== false && x?.binaural !== null,
    portadora: Math.round(acotar(b.portadora, LIMITES.portadora, BINAURAL_DEFECTO.portadora)),
    pulso: redondo(acotar(b.pulso, LIMITES.pulso, BINAURAL_DEFECTO.pulso)),
    pulsoFinal,
    volumen: redondo(acotar(b.volumen, [0, 1], BINAURAL_DEFECTO.volumen), 2),
    ruido, volumenRuido: redondo(acotar(b.volumenRuido, [0, 1], BINAURAL_DEFECTO.volumenRuido), 2),
    sigueRespiracion: b.sigueRespiracion !== false && fases.length > 0,
  }
  let ciclos = x?.ciclos == null || x.ciclos === '' ? null : Math.round(acotar(x.ciclos, LIMITES.ciclos, 10))
  let minutos = x?.minutos == null || x.minutos === '' ? null : redondo(acotar(x.minutos, LIMITES.minutos, 10))
  if (!fases.length) { ciclos = null; minutos ??= 15; if (!binaural.activo) throw new Error('Sin respiración y sin sonido no queda nada para hacer') }
  if (fases.length && ciclos == null && minutos == null) ciclos = 10
  if (ciclos != null && minutos != null) minutos = null // manda uno solo: los ciclos
  return {
    nombre, intencion: String(x?.intencion ?? '').trim().slice(0, 160), descripcion: String(x?.descripcion ?? '').trim().slice(0, 1200),
    fases, ciclos, minutos, binaural, marcarFases: x?.marcarFases !== false && fases.length > 0,
  }
}

/** Cuánto dura (segundos): los ciclos por lo que dura uno, o los minutos. */
export function duracion(e: Pick<Ejercicio, 'fases' | 'ciclos' | 'minutos'>): number {
  const ciclo = e.fases.reduce((s, f) => s + f.seg, 0)
  if (e.ciclos != null && ciclo) return Math.round(e.ciclos * ciclo)
  if (e.minutos != null) return Math.round(e.minutos * 60)
  return 0
}

const base = (id: string, x: Parameters<typeof normalizar>[0]): Ejercicio => ({ id: `base:${id}`, ...normalizar(x), origen: 'base', pedido: null, creadaEn: null, usos: 0, ultima: null })
/** Los de base: los clásicos, con un sonido que acompaña lo que buscan. */
export const BASE: Ejercicio[] = [
  base('caja', {
    nombre: 'Respiración en caja', intencion: 'Calma y foco antes de algo importante', descripcion: 'Cuatro tiempos iguales: inhalar, retener, exhalar y quedarse vacío. La usan para bajar la ansiedad sin adormecerse.',
    fases: [{ tipo: 'inhalar', seg: 4 }, { tipo: 'retener', seg: 4 }, { tipo: 'exhalar', seg: 4 }, { tipo: 'sostener', seg: 4 }], ciclos: 10, binaural: { pulso: 10, portadora: 200 },
  }),
  base('478', {
    nombre: '4-7-8 para dormir', intencion: 'Soltar el día y entrar en el sueño', descripcion: 'Inhalar por la nariz en 4, retener en 7 y exhalar por la boca en 8. Pocos ciclos alcanzan; el sonido va bajando de theta a delta.',
    fases: [{ tipo: 'inhalar', seg: 4 }, { tipo: 'retener', seg: 7 }, { tipo: 'exhalar', seg: 8 }], ciclos: 8, binaural: { pulso: 6, pulsoFinal: 3, portadora: 150, ruido: 'marron', volumenRuido: 0.25 },
  }),
  base('coherencia', {
    nombre: 'Coherencia cardíaca', intencion: 'Ordenar el ritmo del corazón', descripcion: 'Unas seis respiraciones por minuto, parejas, sin retener. Cinco minutos ya se notan.',
    fases: [{ tipo: 'inhalar', seg: 5.5 }, { tipo: 'exhalar', seg: 5.5 }], minutos: 5, binaural: { pulso: 10, portadora: 220 },
  }),
  base('suspiro', {
    nombre: 'Suspiro fisiológico', intencion: 'Bajar un pico de estrés en un minuto', descripcion: 'Una inhalación, un segundo sorbo de aire arriba, y una exhalación larga. Rápido y para cualquier momento.',
    fases: [{ tipo: 'inhalar', seg: 2 }, { tipo: 'inhalar', seg: 1 }, { tipo: 'exhalar', seg: 6 }], ciclos: 6, binaural: { activo: false },
  }),
  base('activar', {
    nombre: 'Activación suave', intencion: 'Despertar sin café', descripcion: 'Inhalar más largo que exhalar, con un pulso beta. Para arrancar la mañana o salir de un bajón de la tarde.',
    fases: [{ tipo: 'inhalar', seg: 4 }, { tipo: 'exhalar', seg: 2 }], minutos: 3, binaural: { pulso: 18, portadora: 260 },
  }),
  base('binaural', {
    nombre: 'Solo binaural', intencion: 'Escuchar, sin guiar la respiración', descripcion: 'Veinte minutos de theta que bajan a alfa al final, con ruido rosa. Respirás como quieras.',
    fases: [], minutos: 20, binaural: { pulso: 6, pulsoFinal: 10, portadora: 180, ruido: 'rosa', volumenRuido: 0.2 },
  }),
]

// ─── lo guardado ─────────────────────────────────────────────────────────

const listos = new WeakSet<Db>()
function asegurar(db: Db) {
  if (listos.has(db)) return
  db.exec(`
CREATE TABLE IF NOT EXISTS meditaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, intencion TEXT, descripcion TEXT, config TEXT NOT NULL,
  origen TEXT NOT NULL DEFAULT 'propia', pedido TEXT, estado TEXT NOT NULL DEFAULT 'activa', creada_en INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meditacion_sesiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ejercicio TEXT NOT NULL, nombre TEXT, fecha TEXT NOT NULL, segundos INTEGER NOT NULL,
  completa INTEGER NOT NULL DEFAULT 0, animo TEXT, nota TEXT, en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_meditacion_sesiones_fecha ON meditacion_sesiones(fecha);
CREATE INDEX IF NOT EXISTS ix_meditacion_sesiones_ejercicio ON meditacion_sesiones(ejercicio);`)
  listos.add(db)
}

const deFila = (db: Db, r: any): Ejercicio => {
  const c = json<any>(r.config, {}) ?? {}
  const uso = db.prepare('SELECT COUNT(*) AS n, MAX(en) AS u FROM meditacion_sesiones WHERE ejercicio = ?').get(String(r.id)) as { n: number; u: number | null }
  return { id: String(r.id), nombre: r.nombre, intencion: r.intencion ?? '', descripcion: r.descripcion ?? '', fases: c.fases ?? [], ciclos: c.ciclos ?? null, minutos: c.minutos ?? null,
    binaural: c.binaural ?? { ...BINAURAL_DEFECTO, activo: false }, marcarFases: c.marcarFases !== false, origen: r.origen, pedido: r.pedido, creadaEn: r.creada_en, usos: uso.n, ultima: uso.u }
}

export function listar(db: Db): Ejercicio[] {
  asegurar(db)
  return (db.prepare(`SELECT * FROM meditaciones WHERE estado = 'activa' ORDER BY id DESC`).all() as any[]).map((r) => deFila(db, r))
}

export function leer(db: Db, id: string): Ejercicio | null {
  if (id.startsWith('base:')) {
    const b = BASE.find((x) => x.id === id)
    if (!b) return null
    asegurar(db)
    const uso = db.prepare('SELECT COUNT(*) AS n, MAX(en) AS u FROM meditacion_sesiones WHERE ejercicio = ?').get(id) as { n: number; u: number | null }
    return { ...b, usos: uso.n, ultima: uso.u }
  }
  asegurar(db)
  const r = db.prepare(`SELECT * FROM meditaciones WHERE id = ? AND estado = 'activa'`).get(Number(id))
  return r ? deFila(db, r) : null
}

/** Guarda uno nuevo o cambia uno suyo (los de base no se tocan: si los edita, queda una copia suya). */
export function guardar(db: Db, x: any, o: { origen?: 'propia' | 'a_medida'; pedido?: string | null; ahora?: number } = {}): Ejercicio {
  asegurar(db)
  const n = normalizar(x)
  const config = JSON.stringify({ fases: n.fases, ciclos: n.ciclos, minutos: n.minutos, binaural: n.binaural, marcarFases: n.marcarFases })
  const id = x?.id != null && !String(x.id).startsWith('base:') ? Number(x.id) : null
  if (id) {
    const ok = db.prepare(`UPDATE meditaciones SET nombre = ?, intencion = ?, descripcion = ?, config = ? WHERE id = ? AND estado = 'activa'`).run(n.nombre, n.intencion, n.descripcion, config, id).changes
    if (!ok) throw new Error('Ese ejercicio no existe (o lo borraste)')
    return leer(db, String(id))!
  }
  const nuevo = Number(db.prepare(`INSERT INTO meditaciones (nombre, intencion, descripcion, config, origen, pedido, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(n.nombre, n.intencion, n.descripcion, config, o.origen ?? 'propia', o.pedido ?? null, o.ahora ?? Date.now()).lastInsertRowid)
  return leer(db, String(nuevo))!
}

export function borrar(db: Db, id: string) {
  asegurar(db)
  if (id.startsWith('base:')) throw new Error('Los de base no se borran')
  if (!db.prepare(`UPDATE meditaciones SET estado = 'archivada' WHERE id = ? AND estado = 'activa'`).run(Number(id)).changes) throw new Error('Ese ejercicio no existe')
}

// ─── a medida ────────────────────────────────────────────────────────────

const SISTEMA_A_MEDIDA = `Diseñás un ejercicio de respiración (y su sonido binaural) a medida de lo que pide una persona, en castellano rioplatense.
- Fases: "inhalar", "retener" (con aire), "exhalar", "sostener" (sin aire). Cada una de 1 a 30 segundos. Respetá lo que se sabe: para calmar y dormir, exhalar más largo que inhalar; para activar, al revés; las retenciones, moderadas (no más de 15 s salvo que lo pida y sea alguien con práctica).
- Largo: "ciclos" (cuántas veces se repite la secuencia) o "minutos", uno solo. Si pide un tiempo, usá minutos.
- Si pide solo sonido (escuchar, sin guía), fases vacías y minutos.
- Binaural: "portadora" 100–400 Hz (más grave relaja), "pulso" (la diferencia entre oídos) según lo que busca: delta 0,5–4 dormir, theta 4–8 relajación profunda, alfa 8–13 calma despierta, beta 13–30 atención, gamma 30–45 foco corto. "pulsoFinal" si conviene ir de un estado a otro (por ejemplo de 10 a 3 para dormirse). "ruido": "ninguno", "blanco", "rosa" o "marron" (el marrón es el más suave). Volúmenes de 0 a 1 (0,3 está bien).
- "intencion": para qué es, en una frase. "descripcion": cómo hacerlo, en dos o tres frases, sin promesas médicas.
Forma: {"nombre": string, "intencion": string, "descripcion": string, "fases": [{"tipo": string, "seg": number}], "ciclos": number | null, "minutos": number | null, "binaural": {"activo": boolean, "portadora": number, "pulso": number, "pulsoFinal": number | null, "volumen": number, "ruido": string, "volumenRuido": number, "sigueRespiracion": boolean}}`

/** Inyectable para tests: el diseño del modelo. */
let disenar = async (db: Db, pedido: string): Promise<any> => {
  const { pedirJson } = await import('./modelo.ts')
  return (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'meditacion' }, SISTEMA_A_MEDIDA, pedido, { temperatura: 0.5, maxTokens: 1500 })).datos
}
export function _probarMeditacion(f: typeof disenar) { disenar = f }

/** Lo pide en palabras («algo para dormir en 10 minutos») y queda guardado como suyo. */
export async function aMedida(db: Db, pedido: string, ahora = Date.now()): Promise<Ejercicio> {
  const p = String(pedido ?? '').trim()
  if (p.length < 3) throw new Error('Contame para qué lo querés (dormir, calmarte antes de algo, concentrarte, cuánto tiempo…)')
  const d = await disenar(db, p.slice(0, 2000))
  return guardar(db, d, { origen: 'a_medida', pedido: p.slice(0, 2000), ahora })
}

// ─── sesiones ────────────────────────────────────────────────────────────

export const ANIMOS = ['mejor', 'igual', 'peor'] as const

/** Una sesión hecha (aunque la corte): cuánto duró, si la terminó y cómo quedó. Menos de 10 segundos no cuenta. */
export function registrarSesion(db: Db, s: { ejercicio: unknown; segundos: unknown; completa?: unknown; animo?: unknown; nota?: unknown }, ahora = Date.now()) {
  asegurar(db)
  const e = leer(db, String(s.ejercicio ?? ''))
  if (!e) throw new Error('No encuentro ese ejercicio')
  const segundos = Math.round(Number(s.segundos) || 0)
  if (segundos < 10) return { anotada: false }
  const animo = ANIMOS.includes(s.animo as any) ? String(s.animo) : null
  const id = Number(db.prepare('INSERT INTO meditacion_sesiones (ejercicio, nombre, fecha, segundos, completa, animo, nota, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(e.id, e.nombre, fechaLocal(ahora), Math.min(segundos, 4 * 3600), s.completa ? 1 : 0, animo, String(s.nota ?? '').trim().slice(0, 500) || null, ahora).lastInsertRowid)
  return { anotada: true, id }
}

/** Cómo viene: los días y minutos de este mes (sin rachas que se pierdan), el total y lo último. */
export function resumen(db: Db, ahora = Date.now()) {
  asegurar(db)
  const mes = fechaLocal(ahora).slice(0, 7)
  const m = db.prepare(`SELECT COUNT(DISTINCT fecha) AS dias, COALESCE(SUM(segundos), 0) AS s, COUNT(*) AS n FROM meditacion_sesiones WHERE fecha LIKE ?`).get(`${mes}%`) as { dias: number; s: number; n: number }
  const t = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(segundos), 0) AS s FROM meditacion_sesiones`).get() as { n: number; s: number }
  const animos = db.prepare(`SELECT animo, COUNT(*) AS n FROM meditacion_sesiones WHERE animo IS NOT NULL AND fecha LIKE ? GROUP BY animo`).all(`${mes}%`) as { animo: string; n: number }[]
  const ultimas = db.prepare(`SELECT nombre, fecha, segundos, completa, animo FROM meditacion_sesiones ORDER BY en DESC LIMIT 8`).all() as any[]
  return {
    mes: { dias: m.dias, minutos: Math.round(m.s / 60), sesiones: m.n, animos: Object.fromEntries(animos.map((a) => [a.animo, a.n])) },
    total: { sesiones: t.n, minutos: Math.round(t.s / 60) },
    ultimas: ultimas.map((u) => ({ nombre: u.nombre, fecha: u.fecha, minutos: Math.round((u.segundos / 60) * 10) / 10, completa: !!u.completa, animo: u.animo })),
  }
}

/** Todo lo de la sección: los de base, los suyos, las bandas y cómo viene. */
export function seccion(db: Db, ahora = Date.now()) {
  return { base: BASE.map((b) => leer(db, b.id)!), mias: listar(db), bandas: BANDAS, resumen: resumen(db, ahora) }
}
