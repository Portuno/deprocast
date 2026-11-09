/**
 * La ficha de empresa (Fragua #164): un tipo de entidad «empresa» con campos fijos y un cribado en tres niveles.
 * - Datos: razón social, CIF, dirección (con enlace a Maps), web y redes, cotización si cotiza.
 * - Puntaje objetivo 0–10: el promedio ponderado de criterios explícitos (cada uno con su peso, su valor y su nota), que se
 *   recalcula cada vez que cambia un dato; y el autopuntaje que declara la propia empresa, aparte.
 * - Cribado: público (lo que publica), privado (registros, prensa, licitaciones) y personal (su lectura, y a qué proyecto
 *   o persona suya le sirve; eso queda además como conexión entre entidades).
 * Todo vive en la meta de la entidad: no hay tabla nueva.
 */
import type { Db } from './db.ts'
import { anotarConexion, asegurarEntidad, leerEntidad } from './entidades.ts'

export type Criterio = { nombre: string; peso: number; valor: number | null; nota?: string | null }
export type Empresa = {
  razonSocial: string | null; cif: string | null; direccion: string | null; web: string | null; redes: string[]
  cotiza: { ticker: string; bolsa?: string | null } | null
  criterios: Criterio[]; puntaje: number | null
  autopuntaje: { valor: number; fuente?: string | null } | null
  cribado: { publico: string | null; privado: string | null; personal: string | null }
  sirveA: number[]; actualizada: number | null
}

export const CRITERIOS_BASE: Criterio[] = [
  { nombre: 'Solvencia', peso: 2, valor: null },
  { nombre: 'Reputación', peso: 1, valor: null },
  { nombre: 'Cumplimiento (legal, pagos, plazos)', peso: 2, valor: null },
  { nombre: 'Encaje con sus proyectos', peso: 2, valor: null },
  { nombre: 'Acceso (¿hay con quién hablar?)', peso: 1, valor: null },
]

const vacia = (): Empresa => ({ razonSocial: null, cif: null, direccion: null, web: null, redes: [], cotiza: null, criterios: CRITERIOS_BASE.map((c) => ({ ...c })), puntaje: null, autopuntaje: null, cribado: { publico: null, privado: null, personal: null }, sirveA: [], actualizada: null })
const entre = (x: unknown, a: number, b: number) => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Math.max(a, Math.min(b, Number(x))))
const texto = (x: unknown, max = 2000) => { const t = String(x ?? '').trim(); return t ? t.slice(0, max) : null }

/** El promedio ponderado de los criterios con valor (0–10, un decimal); sin ninguno, null. */
export function puntajeDe(cs: Criterio[]): number | null {
  const con = cs.filter((c) => c.valor != null && c.peso > 0)
  const peso = con.reduce((s, c) => s + c.peso, 0)
  return peso ? Math.round((con.reduce((s, c) => s + c.peso * c.valor!, 0) / peso) * 10) / 10 : null
}

export const mapsDe = (direccion: string | null) => (direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}` : null)

export function leerEmpresa(db: Db, id: number): Empresa & { id: number; nombre: string; maps: string | null } {
  const e = leerEntidad(db, id)
  if (!e) throw new Error(`No existe la entidad ${id}`)
  if (e.tipo !== 'empresa') throw new Error(`«${e.nombre}» no es una empresa (es ${e.tipo})`)
  const f = { ...vacia(), ...((e.meta as any)?.empresa ?? {}) } as Empresa
  return { id: e.id, nombre: e.nombre, ...f, maps: mapsDe(f.direccion) }
}

/** Cambia lo que venga (lo que no viene, queda) y recalcula el puntaje. */
export function guardarEmpresa(db: Db, id: number, c: Partial<Omit<Empresa, 'puntaje' | 'actualizada' | 'cribado'>> & { cribado?: Partial<Empresa['cribado']>; criterio?: { nombre: string; valor?: number | null; peso?: number; nota?: string | null } }, ahora = Date.now()) {
  const actual = leerEmpresa(db, id)
  const f: Empresa = { ...actual }
  if (c.razonSocial !== undefined) f.razonSocial = texto(c.razonSocial, 200)
  if (c.cif !== undefined) f.cif = texto(c.cif, 20)?.toUpperCase().replace(/[\s-]/g, '') ?? null
  if (c.direccion !== undefined) f.direccion = texto(c.direccion, 300)
  if (c.web !== undefined) f.web = texto(c.web, 300)
  if (c.redes !== undefined) f.redes = (Array.isArray(c.redes) ? c.redes : String(c.redes).split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
  if (c.cotiza !== undefined) f.cotiza = c.cotiza && (c.cotiza as any).ticker ? { ticker: String((c.cotiza as any).ticker).toUpperCase().slice(0, 12), bolsa: texto((c.cotiza as any).bolsa, 40) } : null
  if (c.criterios !== undefined) f.criterios = (c.criterios ?? []).map((x) => ({ nombre: String(x.nombre).slice(0, 80), peso: entre(x.peso, 0, 5) ?? 1, valor: entre(x.valor, 0, 10), nota: texto(x.nota, 300) })).filter((x) => x.nombre)
  if (c.criterio) {
    const i = f.criterios.findIndex((x) => x.nombre.toLowerCase() === c.criterio!.nombre.toLowerCase())
    const nuevo = { nombre: c.criterio.nombre.slice(0, 80), peso: entre(c.criterio.peso, 0, 5) ?? f.criterios[i]?.peso ?? 1, valor: c.criterio.valor === undefined ? f.criterios[i]?.valor ?? null : entre(c.criterio.valor, 0, 10), nota: c.criterio.nota === undefined ? f.criterios[i]?.nota ?? null : texto(c.criterio.nota, 300) }
    if (i >= 0) f.criterios[i] = nuevo; else f.criterios.push(nuevo)
  }
  if (c.autopuntaje !== undefined) f.autopuntaje = c.autopuntaje && entre(c.autopuntaje.valor, 0, 10) != null ? { valor: entre(c.autopuntaje.valor, 0, 10)!, fuente: texto(c.autopuntaje.fuente, 300) } : null
  if (c.cribado) for (const k of ['publico', 'privado', 'personal'] as const) if (c.cribado[k] !== undefined) f.cribado[k] = texto(c.cribado[k], 4000)
  if (c.sirveA !== undefined) {
    f.sirveA = [...new Set((c.sirveA ?? []).map(Number).filter((x) => x && leerEntidad(db, x)))]
    for (const x of f.sirveA.filter((x) => !actual.sirveA.includes(x))) anotarConexion(db, { a: id, b: x, relacion: 'le sirve a', origen: 'empresa' }, ahora)
  }
  f.puntaje = puntajeDe(f.criterios)
  f.actualizada = ahora
  const { id: _i, nombre: _n, maps: _m, ...guardar } = f as any
  db.prepare(`UPDATE entidades SET meta = json_set(COALESCE(meta, '{}'), '$.empresa', json(?)) WHERE id = ?`).run(JSON.stringify(guardar), id)
  return leerEmpresa(db, id)
}

/** La crea (o la encuentra) por nombre y le aplica los datos. */
export function ficharEmpresa(db: Db, nombre: string, c: Parameters<typeof guardarEmpresa>[2] = {}, ahora = Date.now()) {
  const id = asegurarEntidad(db, { tipo: 'empresa', nombre: nombre.trim() })
  return guardarEmpresa(db, id, c, ahora)
}
