/**
 * Los arquetipos como sistema (Fragua #260). La Matriz 72 es un esquema de reparto (dónde trabaja cada cosa); el plantel
 * es otra cosa: los arquetipos con nombre propio, cada uno con su ficha:
 * - nombre propio (lo pone él, en la página del arquetipo);
 * - oficio: una profesión («Tesorero», «Modista», «Hipnotizador»), nunca un concepto («Naturaleza y taxonomía»,
 *   «Benchmarking», «Profesionales por rubro», «Despacho de la liga»);
 * - su elemento del Gnosis (partícula, materia, campo, onda, tiempo-espacio o posición) y su celda en la matriz 6×6;
 * - qué maneja, en una línea, y un ejemplo concreto;
 * - su estado: vacío, nombrado, en prueba o activo.
 * Reglas que quedan en el código: un oficio no puede ser el nombre propio de nadie, un nombre propio no se repite, y un
 * concepto no pasa como oficio. Nada de esto trae nombres: los pone él (sistema en blanco).
 */
import type { Db } from './db.ts'

export const ELEMENTOS = ['partícula', 'materia', 'campo', 'onda', 'tiempo-espacio', 'posición'] as const
export type Elemento = (typeof ELEMENTOS)[number]
export const ESTADOS_PLANTEL = ['vacío', 'nombrado', 'en prueba', 'activo'] as const
export type EstadoPlantel = (typeof ESTADOS_PLANTEL)[number]
export type Ficha = { n: number; nombre: string | null; oficio: string | null; elemento: Elemento | null; fila: number | null; columna: number | null; maneja: string | null; ejemplo: string | null; estado: EstadoPlantel }

function asegurar(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS arquetipo_fichas (
    n INTEGER PRIMARY KEY, oficio TEXT, elemento TEXT, fila INTEGER, columna INTEGER, maneja TEXT, ejemplo TEXT, estado TEXT, actualizada_en INTEGER NOT NULL)`)
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const sinArticulo = (s: string) => sinTildes(s).replace(/^(el|la|los|las|un|una)\s+/, '')

// Una profesión: el sustantivo de quien hace algo. Sufijos de agente, y oficios que no los tienen.
const AGENTE = /(dor|dora|tor|tora|triz|ero|era|ista|ante|ente|ario|aria|ologo|ologa|ografo|ografa|ico|ica|ano|ana|ino|ina|on|ona|ier|eur|er|or)$/
const SIN_SUFIJO = new Set(['medico', 'medica', 'juez', 'jueza', 'chef', 'poeta', 'guia', 'piloto', 'chaman', 'mago', 'maga', 'sastre', 'monje', 'monja', 'espia', 'cura', 'bufon', 'juglar', 'escriba', 'heraldo', 'oraculo', 'sabio', 'sabia', 'maestro', 'maestra', 'capitan', 'alcalde', 'principe', 'rey', 'reina', 'arquitecto', 'arquitecta', 'abogado', 'abogada', 'arquero', 'brujo', 'bruja', 'nomade', 'pastor', 'pirata', 'profeta', 'tutor', 'socio', 'agente', 'jefe', 'jefa', 'testigo', 'interprete', 'detective', 'atleta', 'artesano', 'artesana', 'notario', 'notaria', 'eremita', 'vigia', 'centinela', 'ujier', 'mayordomo', 'botanico', 'quimico', 'astronomo', 'filosofo', 'geografo', 'matematico', 'musico', 'critico', 'medium', 'curandero', 'herrero', 'carpintero', 'haiku-eador'])
// Un concepto: un nombre abstracto (de acción, de cualidad, de doctrina) o una lista («X y Y», «por rubro»).
const CONCEPTO_FUERTE = /(cion|sion|dad|tad|ismo|encia|ancia|miento|ing|ologia|grafia|nomia)$/
const CONCEPTO = /(eza|ia|ura|ez|aje|tica)$/

/** ¿Es un oficio (una profesión) y no un concepto? Con el porqué si no. */
export function esOficio(texto: string): { ok: boolean; porQue?: string } {
  const t = sinArticulo(texto)
  if (!t) return { ok: false, porQue: 'está vacío' }
  if (/\b(y|e|por|segun)\b/.test(t) && !/^\S+\s+(de|del)\s/.test(t)) return { ok: false, porQue: `«${texto}» es una lista o un criterio, no una profesión` }
  const primera = t.split(/\s+/)[0]
  if (SIN_SUFIJO.has(primera)) return { ok: true }
  if (CONCEPTO_FUERTE.test(primera) || (CONCEPTO.test(primera) && !AGENTE.test(primera))) return { ok: false, porQue: `«${texto}» es un concepto (lo que se hace), no quien lo hace: probá con el nombre de la profesión («${primera.replace(/(cion|sion)$/, 'dor').replace(/ing$/, 'er')}…»)` }
  if (/^(despacho|oficina|area|seccion|departamento|equipo|grupo|profesionales|servicio|centro)\b/.test(t)) return { ok: false, porQue: `«${texto}» es un lugar o un grupo, no una profesión` }
  if (AGENTE.test(primera)) return { ok: true }
  return { ok: false, porQue: `«${texto}» no parece una profesión (un oficio es quien hace algo: Tesorero, Modista, Hipnotizador)` }
}

function fila(db: Db, n: number) { return db.prepare('SELECT * FROM arquetipo_fichas WHERE n = ?').get(n) as any }
function nombreDe(db: Db, n: number): string | null {
  try { return (db.prepare(`SELECT nombre FROM paginas WHERE tipo = 'arquetipo' AND clave = ?`).get(String(n)) as { nombre: string | null } | undefined)?.nombre ?? null } catch { return null }
}

export function fichaDe(db: Db, n: number): Ficha {
  asegurar(db)
  if (!Number.isInteger(n) || n < 1 || n > 72) throw new Error(`No hay arquetipo ${n}: van del 1 al 72.`)
  const f = fila(db, n), nombre = nombreDe(db, n)
  const estado: EstadoPlantel = f?.estado === 'en prueba' || f?.estado === 'activo' ? f.estado : nombre ? 'nombrado' : 'vacío'
  return { n, nombre, oficio: f?.oficio ?? null, elemento: f?.elemento ?? null, fila: f?.fila ?? null, columna: f?.columna ?? null, maneja: f?.maneja ?? null, ejemplo: f?.ejemplo ?? null, estado }
}

/** ¿Este nombre propio es el oficio de algún arquetipo? (para que nombrar no lo permita). */
export function esOficioDeAlguno(db: Db, nombre: string): number | null {
  asegurar(db)
  const n = sinArticulo(nombre)
  const r = (db.prepare('SELECT n, oficio FROM arquetipo_fichas WHERE oficio IS NOT NULL').all() as { n: number; oficio: string }[]).find((x) => sinArticulo(x.oficio) === n)
  return r?.n ?? null
}

/** Completa la ficha (solo lo que viene), con las reglas del plantel. */
export function fijarFicha(db: Db, n: number, c: { oficio?: string | null; elemento?: string | null; fila?: number | null; columna?: number | null; maneja?: string | null; ejemplo?: string | null; estado?: string | null }, ahora = Date.now()): Ficha {
  const actual = fichaDe(db, n)
  const nueva = { ...actual }
  if (c.oficio !== undefined) {
    const o = c.oficio?.trim().slice(0, 60) || null
    if (o) {
      const v = esOficio(o)
      if (!v.ok) throw new Error(v.porQue)
      // Un oficio no puede ser el nombre propio de nadie.
      const filas = db.prepare(`SELECT clave, nombre FROM paginas WHERE tipo = 'arquetipo' AND nombre IS NOT NULL`).all() as { clave: string; nombre: string }[]
      const choca = filas.find((x) => sinArticulo(x.nombre) === sinArticulo(o))
      if (choca) throw new Error(`«${o}» ya es el nombre propio del arquetipo ${choca.clave}: un oficio no puede ser un nombre.`)
    }
    nueva.oficio = o
  }
  if (c.elemento !== undefined) {
    const e = c.elemento ? ELEMENTOS.find((x) => sinTildes(x) === sinTildes(String(c.elemento)).replace(/\s+/g, '-')) ?? null : null
    if (c.elemento && !e) throw new Error(`Elemento inválido: ${c.elemento} (${ELEMENTOS.join(', ')})`)
    nueva.elemento = e
  }
  for (const k of ['fila', 'columna'] as const) {
    if (c[k] === undefined) continue
    const v = c[k] == null ? null : Number(c[k])
    if (v != null && !(Number.isInteger(v) && v >= 1 && v <= 6)) throw new Error(`La ${k} de la matriz 6×6 va del 1 al 6`)
    nueva[k] = v
  }
  if (c.maneja !== undefined) nueva.maneja = c.maneja?.trim().slice(0, 200) || null
  if (c.ejemplo !== undefined) nueva.ejemplo = c.ejemplo?.trim().slice(0, 300) || null
  if (c.estado !== undefined && c.estado != null) {
    if (!(['en prueba', 'activo', 'nombrado', 'vacío'] as string[]).includes(c.estado)) throw new Error(`Estado inválido (${ESTADOS_PLANTEL.join(', ')})`)
    if ((c.estado === 'en prueba' || c.estado === 'activo') && !actual.nombre) throw new Error('Para estar en prueba o activo, primero necesita su nombre propio.')
  }
  const estadoGuardado = c.estado === 'en prueba' || c.estado === 'activo' ? c.estado : c.estado === 'nombrado' || c.estado === 'vacío' ? null : (fila(db, n)?.estado ?? null)
  db.prepare(`INSERT INTO arquetipo_fichas (n, oficio, elemento, fila, columna, maneja, ejemplo, estado, actualizada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (n) DO UPDATE SET oficio = excluded.oficio, elemento = excluded.elemento, fila = excluded.fila, columna = excluded.columna, maneja = excluded.maneja, ejemplo = excluded.ejemplo, estado = excluded.estado, actualizada_en = excluded.actualizada_en`)
    .run(n, nueva.oficio, nueva.elemento, nueva.fila, nueva.columna, nueva.maneja, nueva.ejemplo, estadoGuardado, ahora)
  return fichaDe(db, n)
}

/** Las 72 fichas, y el plantel (los que tienen nombre propio). */
export function plantel(db: Db) {
  const todas = Array.from({ length: 72 }, (_, i) => fichaDe(db, i + 1))
  const porEstado = Object.fromEntries(ESTADOS_PLANTEL.map((e) => [e, todas.filter((f) => f.estado === e).length]))
  return { plantel: todas.filter((f) => f.nombre), porEstado, todas }
}

/** Lo que no cumple las reglas (fichas viejas, cargadas antes de las reglas): para corregir, sin tocar nada solo. */
export function revisarPlantel(db: Db): { n: number; problema: string }[] {
  const out: { n: number; problema: string }[] = []
  const todas = plantel(db).todas
  for (const f of todas) {
    if (f.oficio) { const v = esOficio(f.oficio); if (!v.ok) out.push({ n: f.n, problema: v.porQue! }) }
    if (f.nombre) {
      const o = todas.find((x) => x.oficio && sinArticulo(x.oficio) === sinArticulo(f.nombre!))
      if (o) out.push({ n: f.n, problema: `su nombre «${f.nombre}» es el oficio del arquetipo ${o.n}` })
    }
  }
  return out
}
