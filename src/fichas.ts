/**
 * La ficha v2 (Fragua #302): la ficha de empresa deja de vivir al costado y pasa a ser el molde de toda entidad con
 * datos duros. Un solo objeto, más profundo, con la misma forma para una empresa, un proyecto y un lugar.
 * - Datos: los de siempre (razón social, CIF, dirección, web, redes…) y los que faltaban, cada cambio con su historia:
 *   cuándo, de qué a qué y de dónde salió (a mano, el chat, un link o una pieza). La evolución, no una foto fija.
 * - Órganos y equipo (administradores, quién firma, director, equipo), las cuentas anuales depositadas (con la fecha del
 *   depósito) y la cartera de clientes: leídos de fuentes públicas (registros, su web, prensa, perfiles que aparecen en
 *   un buscador) y de su corpus. Cada fila lleva su link; lo que el modelo diga sin fuente se descarta.
 * - La solvencia sale de las cuentas cuando las hay (y lo dice), no de una estimación.
 * - Vínculos: quién de su gente aparece con ella, en qué rol y cuándo fue la última vez (la última pieza que los junta,
 *   su último contacto). Cruces: un cliente de la empresa que también está en uno de sus proyectos; alerta si la relación
 *   que él anotó es de competencia o conflicto.
 * - La ficha entera es una pieza viva del corpus (fuente «fichas»): se reescribe cuando cambia, y así se cita y se
 *   pregunta («¿qué sé de esta empresa?») como cualquier otra cosa suya.
 * LinkedIn no se lee (pide sesión): solo lo que muestra un buscador público, con su link.
 */
import crypto from 'node:crypto'
import { fechaLocal, json, type Db } from './db.ts'
import { leerEntidad } from './entidades.ts'

export type TipoFicha = 'empresa' | 'proyecto' | 'lugar'
export const TIPOS_FICHA: TipoFicha[] = ['empresa', 'proyecto', 'lugar']

/** Los campos de cada molde (los de empresa incluyen los de la ficha #164, que siguen en meta.empresa). */
export const CAMPOS: Record<TipoFicha, { k: string; n: string }[]> = {
  empresa: [
    { k: 'razonSocial', n: 'Razón social' }, { k: 'cif', n: 'CIF' }, { k: 'formaJuridica', n: 'Forma jurídica' }, { k: 'constituida', n: 'Constituida' },
    { k: 'actividad', n: 'Actividad' }, { k: 'direccion', n: 'Dirección' }, { k: 'web', n: 'Web' }, { k: 'redes', n: 'Redes' }, { k: 'telefono', n: 'Teléfono' }, { k: 'email', n: 'Email' },
  ],
  proyecto: [{ k: 'queHace', n: 'Qué hace' }, { k: 'estado', n: 'Estado' }, { k: 'web', n: 'Web' }, { k: 'redes', n: 'Redes' }, { k: 'direccion', n: 'Dónde' }, { k: 'email', n: 'Email' }],
  lugar: [{ k: 'direccion', n: 'Dirección' }, { k: 'horario', n: 'Horario' }, { k: 'telefono', n: 'Teléfono' }, { k: 'web', n: 'Web' }, { k: 'redes', n: 'Redes' }],
}
/** Dónde vive cada molde en la meta de la entidad (empresa, donde ya estaba). */
const CLAVE_META: Record<TipoFicha, string> = { empresa: 'empresa', proyecto: 'ficha', lugar: 'ficha' }
const FIRMAN = /administrador|consejero delegado|apoderad|presidente|liquidador|firma/i

export type PersonaFicha = { id: number; nombre: string; rol: string | null; firma: boolean; personaId: number | null; fuente: string | null; fecha: string | null; vigente: boolean }
export type Cuentas = { ejercicio: number; ingresos: number | null; resultado: number | null; patrimonio: number | null; activo: number | null; empleados: number | null; depositadas: string | null; fuente: string | null }
export type ClienteFicha = { id: number; nombre: string; clienteId: number | null; fuente: string | null; fecha: string | null }
export type Cambio = { campo: string; antes: string | null; despues: string | null; fuente: string | null; en: number }

const tipoDe = (t: string): TipoFicha => {
  if (!TIPOS_FICHA.includes(t as TipoFicha)) throw new Error(`Las entidades de tipo «${t}» no tienen ficha (solo empresa, proyecto y lugar)`)
  return t as TipoFicha
}
const comoTexto = (v: unknown): string | null => {
  if (v == null || v === '') return null
  if (Array.isArray(v)) return v.length ? v.join(' ') : null
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim()

// ─── historia ──────────────────────────────────────────────────────────────

/** Anota lo que cambió entre dos versiones de los mismos campos. Devuelve cuántos cambios. */
export function anotarCambios(db: Db, entidadId: number, antes: Record<string, unknown>, despues: Record<string, unknown>, fuente: string | null, ahora = Date.now()): number {
  const ins = db.prepare('INSERT INTO ficha_historia (entidad_id, campo, antes, despues, fuente, en) VALUES (?, ?, ?, ?, ?, ?)')
  let n = 0
  for (const campo of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
    const a = comoTexto(antes[campo]), d = comoTexto(despues[campo])
    if (a === d) continue
    ins.run(entidadId, campo, a?.slice(0, 2000) ?? null, d?.slice(0, 2000) ?? null, fuente?.slice(0, 400) ?? null, ahora)
    n++
  }
  return n
}

export function historiaDe(db: Db, entidadId: number, limite = 60): Cambio[] {
  return (db.prepare('SELECT campo, antes, despues, fuente, en FROM ficha_historia WHERE entidad_id = ? ORDER BY en DESC, id DESC LIMIT ?').all(entidadId, limite) as any[])
    .map((r) => ({ campo: r.campo, antes: r.antes, despues: r.despues, fuente: r.fuente, en: r.en }))
}

// ─── datos ─────────────────────────────────────────────────────────────────

function metaDe(db: Db, id: number) {
  const e = leerEntidad(db, id)
  if (!e) throw new Error(`No existe la entidad ${id}`)
  const tipo = tipoDe(e.tipo)
  const meta = (e.meta ?? {}) as Record<string, any>
  return { e, tipo, datos: { ...(meta[CLAVE_META[tipo]] ?? {}) } as Record<string, unknown> }
}

/** Los datos de la ficha (solo los campos del molde), con lo que valga. */
export function datosDe(db: Db, id: number): Record<string, unknown> {
  const { tipo, datos } = metaDe(db, id)
  return Object.fromEntries(CAMPOS[tipo].map(({ k }) => [k, datos[k] ?? null]))
}

/**
 * Cambia datos del molde (lo que no viene, queda) y anota la historia. Para una empresa, los campos de la ficha #164
 * pasan por guardarEmpresa (que recalcula el puntaje); los nuevos se guardan al lado, en la misma meta.
 */
export async function guardarDatos(db: Db, id: number, cambios: Record<string, unknown>, o: { fuente?: string | null; ahora?: number } = {}) {
  const ahora = o.ahora ?? Date.now()
  const { tipo, datos } = metaDe(db, id)
  const validos = new Set(CAMPOS[tipo].map((c) => c.k))
  const limpio: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cambios)) {
    if (!validos.has(k) || v === undefined) continue
    limpio[k] = k === 'redes' ? (Array.isArray(v) ? v : String(v ?? '').split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 12) : v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, 600)
  }
  if (!Object.keys(limpio).length) return fichaDe(db, id)
  if (tipo === 'empresa') {
    const { guardarEmpresa } = await import('./empresas.ts')
    const viejos = ['razonSocial', 'cif', 'direccion', 'web', 'redes'].filter((k) => k in limpio)
    if (viejos.length) guardarEmpresa(db, id, Object.fromEntries(viejos.map((k) => [k, limpio[k]])) as any, ahora, o.fuente ?? 'a mano')
    const nuevos = Object.fromEntries(Object.entries(limpio).filter(([k]) => !viejos.includes(k)))
    if (Object.keys(nuevos).length) {
      const antes = Object.fromEntries(Object.keys(nuevos).map((k) => [k, datos[k] ?? null]))
      db.prepare(`UPDATE entidades SET meta = json_set(COALESCE(meta, '{}'), '$.empresa', json(?)) WHERE id = ?`).run(JSON.stringify({ ...((leerEntidad(db, id)!.meta as any)?.empresa ?? {}), ...nuevos }), id)
      anotarCambios(db, id, antes, nuevos, o.fuente ?? 'a mano', ahora)
    }
  } else {
    const antes = Object.fromEntries(Object.keys(limpio).map((k) => [k, datos[k] ?? null]))
    db.prepare(`UPDATE entidades SET meta = json_set(COALESCE(meta, '{}'), '$.ficha', json(?)) WHERE id = ?`).run(JSON.stringify({ ...datos, ...limpio }), id)
    anotarCambios(db, id, antes, limpio, o.fuente ?? 'a mano', ahora)
  }
  await alCorpus(db, id, ahora)
  return fichaDe(db, id)
}

// ─── órganos, cuentas y clientes ───────────────────────────────────────────

function personaDelGrafo(db: Db, nombre: string): number | null {
  const r = db.prepare(`SELECT id FROM entidades WHERE tipo = 'persona' AND (nombre = ? COLLATE NOCASE OR EXISTS (SELECT 1 FROM json_each(COALESCE(alias, '[]')) WHERE value = ? COLLATE NOCASE)) LIMIT 1`).get(nombre, nombre) as { id: number } | undefined
  return r?.id ?? null
}
function entidadDelGrafo(db: Db, nombre: string, excepto: number): number | null {
  const r = db.prepare(`SELECT id FROM entidades WHERE id != ? AND (nombre = ? COLLATE NOCASE OR EXISTS (SELECT 1 FROM json_each(COALESCE(alias, '[]')) WHERE value = ? COLLATE NOCASE)) LIMIT 1`).get(excepto, nombre, nombre) as { id: number } | undefined
  return r?.id ?? null
}

/** Suma (o actualiza) una persona de los órganos o del equipo. Lo nuevo queda en la historia («+ Ana Pérez · administradora»). */
export function anotarPersona(db: Db, entidadId: number, p: { nombre: string; rol?: string | null; fuente?: string | null; fecha?: string | null; vigente?: boolean }, ahora = Date.now()) {
  const nombre = p.nombre.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (nombre.length < 3) return null
  const rol = p.rol?.trim().slice(0, 80) || null
  const ya = db.prepare('SELECT id, vigente FROM ficha_personas WHERE entidad_id = ? AND nombre = ? COLLATE NOCASE AND COALESCE(rol, \'\') = COALESCE(?, \'\')').get(entidadId, nombre, rol) as { id: number; vigente: number } | undefined
  const vigente = p.vigente === false ? 0 : 1
  if (ya) {
    db.prepare('UPDATE ficha_personas SET fuente = COALESCE(?, fuente), fecha = COALESCE(?, fecha), vigente = ?, persona_id = COALESCE(persona_id, ?) WHERE id = ?').run(p.fuente ?? null, p.fecha ?? null, vigente, personaDelGrafo(db, nombre), ya.id)
    if (ya.vigente !== vigente) anotarCambios(db, entidadId, { [`persona:${nombre}`]: ya.vigente ? rol ?? 'sí' : null }, { [`persona:${nombre}`]: vigente ? rol ?? 'sí' : null }, p.fuente ?? null, ahora)
    return ya.id
  }
  const r = db.prepare('INSERT INTO ficha_personas (entidad_id, nombre, rol, firma, persona_id, fuente, fecha, vigente, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(entidadId, nombre, rol, rol && FIRMAN.test(rol) ? 1 : 0, personaDelGrafo(db, nombre), p.fuente ?? null, p.fecha ?? null, vigente, ahora)
  // Si se supo de alguien que ya cesó, la historia dice que dejó el cargo (no que entró).
  anotarCambios(db, entidadId, vigente ? {} : { [`persona:${nombre}`]: rol ?? 'sí' }, vigente ? { [`persona:${nombre}`]: rol ?? 'sí' } : {}, p.fuente ?? null, ahora)
  return Number(r.lastInsertRowid)
}

const num = (x: unknown) => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x))

export function anotarCuentas(db: Db, entidadId: number, c: Partial<Cuentas> & { ejercicio: number }, ahora = Date.now()) {
  const ejercicio = Math.round(Number(c.ejercicio))
  if (!(ejercicio >= 1900 && ejercicio <= new Date(ahora).getFullYear())) return
  const antes = db.prepare('SELECT ingresos, resultado, patrimonio, activo, empleados, depositadas FROM ficha_cuentas WHERE entidad_id = ? AND ejercicio = ?').get(entidadId, ejercicio) as Record<string, unknown> | undefined
  const nuevo = { ingresos: num(c.ingresos), resultado: num(c.resultado), patrimonio: num(c.patrimonio), activo: num(c.activo), empleados: num(c.empleados) == null ? null : Math.round(num(c.empleados)!), depositadas: /^\d{4}-\d{2}-\d{2}$/.test(String(c.depositadas ?? '')) ? String(c.depositadas) : null }
  const fusion = Object.fromEntries(Object.entries(nuevo).map(([k, v]) => [k, v ?? antes?.[k] ?? null]))
  db.prepare(`INSERT INTO ficha_cuentas (entidad_id, ejercicio, ingresos, resultado, patrimonio, activo, empleados, depositadas, fuente, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (entidad_id, ejercicio) DO UPDATE SET ingresos = excluded.ingresos, resultado = excluded.resultado, patrimonio = excluded.patrimonio, activo = excluded.activo, empleados = excluded.empleados, depositadas = excluded.depositadas, fuente = COALESCE(excluded.fuente, ficha_cuentas.fuente), en = excluded.en`)
    .run(entidadId, ejercicio, fusion.ingresos as any, fusion.resultado as any, fusion.patrimonio as any, fusion.activo as any, fusion.empleados as any, fusion.depositadas as any, c.fuente ?? null, ahora)
  // Un renglón por ejercicio en la historia (no uno por cifra).
  const resumen = (x: Record<string, unknown> | undefined) => {
    if (!x) return null
    const partes = [['ingresos', 'ingresos'], ['resultado', 'resultado'], ['patrimonio', 'patrimonio'], ['activo', 'activo']].filter(([k]) => x[k] != null).map(([k, n]) => `${n} ${Math.round(Number(x[k])).toLocaleString('es-ES')} €`)
    if (x.empleados != null) partes.push(`${x.empleados} empleados`)
    if (x.depositadas) partes.push(`depositadas ${x.depositadas}`)
    return partes.join(' · ') || null
  }
  anotarCambios(db, entidadId, { [`cuentas ${ejercicio}`]: resumen(antes) }, { [`cuentas ${ejercicio}`]: resumen(fusion) }, c.fuente ?? null, ahora)
}

export function anotarCliente(db: Db, entidadId: number, c: { nombre: string; fuente?: string | null; fecha?: string | null }, ahora = Date.now()) {
  const nombre = c.nombre.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (nombre.length < 2 || normal(nombre) === normal(leerEntidad(db, entidadId)?.nombre ?? '')) return null
  const r = db.prepare('INSERT OR IGNORE INTO ficha_clientes (entidad_id, nombre, cliente_id, fuente, fecha, en) VALUES (?, ?, ?, ?, ?, ?)').run(entidadId, nombre, entidadDelGrafo(db, nombre, entidadId), c.fuente ?? null, c.fecha ?? null, ahora)
  if (r.changes) anotarCambios(db, entidadId, {}, { [`cliente:${nombre}`]: 'sí' }, c.fuente ?? null, ahora)
  return r.changes ? Number(r.lastInsertRowid) : null
}

const personasDe = (db: Db, id: number): PersonaFicha[] => (db.prepare('SELECT * FROM ficha_personas WHERE entidad_id = ? ORDER BY vigente DESC, firma DESC, nombre').all(id) as any[])
  .map((r) => ({ id: r.id, nombre: r.nombre, rol: r.rol, firma: !!r.firma, personaId: r.persona_id, fuente: r.fuente, fecha: r.fecha, vigente: !!r.vigente }))
const cuentasDe = (db: Db, id: number): Cuentas[] => (db.prepare('SELECT * FROM ficha_cuentas WHERE entidad_id = ? ORDER BY ejercicio DESC').all(id) as any[])
  .map((r) => ({ ejercicio: r.ejercicio, ingresos: r.ingresos, resultado: r.resultado, patrimonio: r.patrimonio, activo: r.activo, empleados: r.empleados, depositadas: r.depositadas, fuente: r.fuente }))
const clientesDe = (db: Db, id: number): ClienteFicha[] => (db.prepare('SELECT * FROM ficha_clientes WHERE entidad_id = ? ORDER BY nombre').all(id) as any[])
  .map((r) => ({ id: r.id, nombre: r.nombre, clienteId: r.cliente_id, fuente: r.fuente, fecha: r.fecha }))

/**
 * La solvencia de las cuentas depositadas (no estimada): el último ejercicio con patrimonio y activo. Base 5; cuánto de
 * lo que tiene es propio (patrimonio sobre activo) suma o resta hasta 3; ganar o perder, uno. Patrimonio negativo: 1.
 */
export function solvenciaDe(cs: Cuentas[]): { valor: number; nota: string } | null {
  const c = cs.find((x) => x.patrimonio != null && x.activo)
  if (!c) return null
  const ratio = c.patrimonio! / c.activo!
  let v = c.patrimonio! < 0 ? 1 : 5 + (ratio >= 0.5 ? 3 : ratio >= 0.3 ? 1.5 : ratio >= 0.1 ? 0 : -2) + (c.resultado == null ? 0 : c.resultado > 0 ? 1 : c.resultado < 0 ? -1 : 0)
  v = Math.max(0, Math.min(10, Math.round(v * 2) / 2))
  const pct = Math.round(ratio * 100)
  return { valor: v, nota: `De las cuentas ${c.ejercicio}${c.depositadas ? ` (depositadas el ${c.depositadas})` : ''}: patrimonio ${pct} % del activo${c.resultado != null ? `, ${c.resultado >= 0 ? 'ganó' : 'perdió'} ${Math.abs(Math.round(c.resultado)).toLocaleString('es-ES')} €` : ''}.` }
}

// ─── vínculos y cruces ─────────────────────────────────────────────────────

export type Vinculo = { personaId: number; nombre: string; rol: string | null; suGente: boolean; ultimoContacto: string | null; ultimaPieza: { id: number; titulo: string; fecha: string | null } | null; piezas: number }

/** Quién de su gente aparece con esta entidad: por los órganos, por una conexión o por piezas compartidas; y cuándo. */
export function vinculosDe(db: Db, id: number, limite = 12): Vinculo[] {
  const cand = new Map<number, string | null>()
  for (const p of personasDe(db, id)) if (p.personaId) cand.set(p.personaId, p.rol)
  for (const c of db.prepare(`SELECT CASE WHEN a = ? THEN b ELSE a END AS otra, relacion FROM conexiones WHERE a = ? OR b = ?`).all(id, id, id) as { otra: number; relacion: string | null }[]) if (!cand.has(c.otra)) cand.set(c.otra, c.relacion)
  for (const c of db.prepare(`SELECT b.entidad_id AS otra FROM corpus_entidades a JOIN corpus_entidades b ON b.pieza_id = a.pieza_id WHERE a.entidad_id = ? AND b.entidad_id != ? GROUP BY b.entidad_id ORDER BY COUNT(*) DESC LIMIT 40`).all(id, id) as { otra: number }[]) if (!cand.has(c.otra)) cand.set(c.otra, null)
  const out: Vinculo[] = []
  for (const [pid, rol] of cand) {
    const e = db.prepare(`SELECT id, nombre, tipo FROM entidades WHERE id = ?`).get(pid) as { id: number; nombre: string; tipo: string } | undefined
    if (!e || e.tipo !== 'persona') continue
    const rel = db.prepare('SELECT ultimo_contacto FROM relaciones WHERE entidad_id = ?').get(pid) as { ultimo_contacto: string | null } | undefined
    const ult = db.prepare(`SELECT c.id, c.titulo, c.fecha FROM corpus c JOIN corpus_entidades a ON a.pieza_id = c.id AND a.entidad_id = ? JOIN corpus_entidades b ON b.pieza_id = c.id AND b.entidad_id = ? WHERE c.fuente != 'fichas' ORDER BY COALESCE(c.fecha, '') DESC, c.id DESC LIMIT 1`).get(id, pid) as { id: number; titulo: string; fecha: string | null } | undefined
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM corpus_entidades a JOIN corpus_entidades b ON b.pieza_id = a.pieza_id JOIN corpus c ON c.id = a.pieza_id WHERE a.entidad_id = ? AND b.entidad_id = ? AND c.fuente != 'fichas'`).get(id, pid) as { n: number }).n
    out.push({ personaId: pid, nombre: e.nombre, rol, suGente: !!rel, ultimoContacto: rel?.ultimo_contacto ?? null, ultimaPieza: ult ?? null, piezas: n })
  }
  const cuando = (v: Vinculo) => [v.ultimoContacto ?? '', v.ultimaPieza?.fecha ?? ''].sort().at(-1)!
  return out.sort((a, b) => Number(b.suGente) - Number(a.suGente) || cuando(b).localeCompare(cuando(a)) || b.piezas - a.piezas).slice(0, limite)
}

export type Cruce = { cliente: string; clienteId: number; proyecto: string; proyectoId: number; como: string; alerta: boolean }
const CONFLICTO = /compet|compit|rival|conflict|contra|enfrent|demand|litig/i

/** Un cliente de la empresa que también aparece en uno de sus proyectos (alerta si la relación es de competencia o conflicto). */
export function crucesDe(db: Db, id: number): Cruce[] {
  const out: Cruce[] = []
  for (const c of clientesDe(db, id).filter((x) => x.clienteId)) {
    const vistos = new Set<number>()
    const nombreDe = (pid: number) => (db.prepare('SELECT nombre FROM entidades WHERE id = ?').get(pid) as { nombre: string }).nombre
    for (const x of db.prepare(`SELECT CASE WHEN k.a = ? THEN k.b ELSE k.a END AS p, k.relacion FROM conexiones k JOIN entidades e ON e.id = CASE WHEN k.a = ? THEN k.b ELSE k.a END WHERE (k.a = ? OR k.b = ?) AND e.tipo = 'proyecto' AND e.id != ?`).all(c.clienteId, c.clienteId, c.clienteId, c.clienteId, id) as { p: number; relacion: string | null }[]) {
      vistos.add(x.p)
      out.push({ cliente: c.nombre, clienteId: c.clienteId!, proyecto: nombreDe(x.p), proyectoId: x.p, como: x.relacion ? `anotaste: «${x.relacion}»` : 'están conectados en tu grafo', alerta: CONFLICTO.test(x.relacion ?? '') })
    }
    if (db.prepare(`SELECT 1 FROM entidades WHERE id = ? AND tipo = 'proyecto'`).get(c.clienteId)) {
      if (!vistos.has(c.clienteId!)) out.push({ cliente: c.nombre, clienteId: c.clienteId!, proyecto: c.nombre, proyectoId: c.clienteId!, como: 'es uno de tus proyectos', alerta: false })
      continue
    }
    for (const x of db.prepare(`SELECT e.id AS p, COUNT(*) AS n FROM corpus_entidades a JOIN corpus_entidades b ON b.pieza_id = a.pieza_id JOIN entidades e ON e.id = b.entidad_id WHERE a.entidad_id = ? AND e.tipo = 'proyecto' AND e.id != ? GROUP BY e.id HAVING n >= 2 ORDER BY n DESC LIMIT 3`).all(c.clienteId, id) as { p: number; n: number }[]) {
      if (vistos.has(x.p)) continue
      out.push({ cliente: c.nombre, clienteId: c.clienteId!, proyecto: nombreDe(x.p), proyectoId: x.p, como: `aparecen juntos en ${x.n} piezas tuyas`, alerta: false })
    }
  }
  return out.sort((a, b) => Number(b.alerta) - Number(a.alerta))
}

// ─── la ficha entera ───────────────────────────────────────────────────────

export function fichaDe(db: Db, id: number) {
  const { e, tipo, datos } = metaDe(db, id)
  const cuentas = cuentasDe(db, id)
  const pieza = db.prepare(`SELECT id FROM corpus WHERE origen_id = ?`).get(`ficha:${id}`) as { id: number } | undefined
  return {
    entidad: { id: e.id, tipo, nombre: e.nombre, alias: e.alias, notas: e.notas },
    campos: CAMPOS[tipo].map(({ k, n }) => ({ k, n, valor: datos[k] ?? null })),
    personas: personasDe(db, id), cuentas, solvencia: solvenciaDe(cuentas), clientes: clientesDe(db, id),
    vinculos: vinculosDe(db, id), cruces: crucesDe(db, id), historia: historiaDe(db, id, 40),
    investigada: ((e.meta ?? {}) as Record<string, any>).fichaInvestigada ?? null,
    piezaId: pieza?.id ?? null,
  }
}

const eur = (n: number | null) => (n == null ? '—' : `${Math.round(n).toLocaleString('es-ES')} €`)

/** La ficha como Markdown: lo que va al corpus (y lo que se cita). */
export function fichaComoMarkdown(f: ReturnType<typeof fichaDe>, extra: { empresa?: Record<string, any> | null } = {}, hoy = fechaLocal()): string {
  const l: string[] = [`# ${f.entidad.nombre}`, `_Ficha de ${f.entidad.tipo} · al ${hoy}${f.entidad.alias.length ? ` · también: ${f.entidad.alias.join(', ')}` : ''}_`, '']
  if (f.entidad.notas) l.push(f.entidad.notas.trim(), '')
  const datos = f.campos.filter((c) => c.valor != null && comoTexto(c.valor))
  if (datos.length) l.push('## Datos', ...datos.map((c) => `- **${c.n}:** ${comoTexto(c.valor)}`), '')
  const emp = extra.empresa
  if (emp?.puntaje != null) l.push(`Puntaje objetivo: ${emp.puntaje}/10${emp.autopuntaje?.valor != null ? ` (lo que declara: ${emp.autopuntaje.valor})` : ''}.`, '')
  const vig = f.personas.filter((p) => p.vigente)
  if (vig.length) l.push('## Órganos y equipo', ...vig.map((p) => `- ${p.nombre}${p.rol ? ` · ${p.rol}` : ''}${p.firma ? ' (firma)' : ''}${p.fecha ? ` · ${p.fecha}` : ''}${p.fuente ? ` · ${p.fuente}` : ''}`), '')
  if (f.cuentas.length) {
    l.push('## Cuentas anuales', '| Ejercicio | Ingresos | Resultado | Patrimonio | Activo | Empleados | Depositadas |', '|---|---|---|---|---|---|---|')
    for (const c of f.cuentas) l.push(`| ${c.ejercicio} | ${eur(c.ingresos)} | ${eur(c.resultado)} | ${eur(c.patrimonio)} | ${eur(c.activo)} | ${c.empleados ?? '—'} | ${c.depositadas ?? '—'} |`)
    if (f.solvencia) l.push('', `Solvencia: ${f.solvencia.valor}/10. ${f.solvencia.nota}`)
    l.push('')
  }
  if (f.clientes.length) l.push('## Clientes', ...f.clientes.map((c) => `- ${c.nombre}${c.fuente ? ` · ${c.fuente}` : ''}`), '')
  if (f.cruces.length) l.push('## Cruces con sus proyectos', ...f.cruces.map((c) => `- ${c.alerta ? '⚠ ' : ''}${c.cliente} → ${c.proyecto}: ${c.como}`), '')
  if (f.vinculos.length) l.push('## Su gente acá', ...f.vinculos.map((v) => `- ${v.nombre}${v.rol ? ` · ${v.rol}` : ''}${v.ultimaPieza ? ` · última vez juntos: ${v.ultimaPieza.fecha ?? '¿?'} («${v.ultimaPieza.titulo}» [#${v.ultimaPieza.id}])` : ''}${v.ultimoContacto ? ` · último contacto: ${v.ultimoContacto}` : ''}`), '')
  const cambios = f.historia.filter((h) => !h.campo.startsWith('cuentas ')).slice(0, 12)
  if (cambios.length) l.push('## Lo que cambió', ...cambios.map((h) => `- ${fechaLocal(h.en)} · ${h.campo}: ${h.antes ?? '—'} → ${h.despues ?? '—'}${h.fuente ? ` (${h.fuente})` : ''}`), '')
  return l.join('\n').trim() + '\n'
}

/** La ficha entra (o se reescribe) en el corpus como pieza viva, solo si cambió. Devuelve el id de la pieza. */
export async function alCorpus(db: Db, id: number, ahora = Date.now()): Promise<number | null> {
  try {
    const f = fichaDe(db, id)
    const empresa = f.entidad.tipo === 'empresa' ? ((leerEntidad(db, id)!.meta as any)?.empresa ?? null) : null
    const md = fichaComoMarkdown(f, { empresa }, fechaLocal(ahora))
    // Lo que hace que valga como ficha: algún dato, persona, cuenta o cliente (el nombre solo no es una ficha).
    if (!f.campos.some((c) => comoTexto(c.valor)) && !f.personas.length && !f.cuentas.length && !f.clientes.length) return null
    const firma = crypto.createHash('sha1').update(md.replace(/^_Ficha de .*_$/m, '')).digest('hex')
    const c = await import('./corpus.ts')
    const ya = c.piezaPorOrigen(db, `ficha:${id}`)
    if (ya) {
      if ((ya.meta as any)?.firmaFicha === firma) return ya.id
      c.corregirPieza(db, ya.id, md, 'la ficha cambió', 'ficha', ahora)
      db.prepare(`UPDATE corpus SET meta = json_set(COALESCE(meta, '{}'), '$.firmaFicha', ?), fecha = ? WHERE id = ?`).run(firma, fechaLocal(ahora), ya.id)
      return ya.id
    }
    c.asegurarFuente(db, { id: 'fichas', nombre: 'Fichas', nivel: 'propia', descripcion: 'Las fichas de empresas, proyectos y lugares: datos, órganos, cuentas, clientes y su gente. Se reescriben cuando cambian.' })
    return c.insertar(db, { fuente: 'fichas', nivel: 'propia', tipo: 'materia', estado: 'disponible', titulo: `Ficha · ${f.entidad.nombre}`, contenido: md, fecha: fechaLocal(ahora), etiquetas: ['ficha'], origenId: `ficha:${id}`, entidades: [id], meta: { firmaFicha: firma, ficha: id } }, ahora) ?? null
  } catch (e) {
    console.error('  ficha → corpus:', e instanceof Error ? e.message : e)
    return null
  }
}

// ─── investigar en fuentes ─────────────────────────────────────────────────

const SISTEMA_INVESTIGAR = `Leés fuentes públicas sobre una entidad (empresa, proyecto o lugar) y sacás SOLO datos verificables, cada uno con la fuente de donde sale.
- Cada dato lleva "fuente": EXACTAMENTE una de las fuentes de la lista (su url, o "pieza:<id>"). Si no podés señalar la fuente, no lo pongas.
- Nada inventado ni deducido: si una fuente dice «facturación entre 1 y 2 millones», no pongas 1.500.000; dejalo afuera.
- Cuidado con homónimos: si una fuente habla de otra entidad con un nombre parecido (otro CIF, otra ciudad), ignorala.
- personas: administradores, consejeros, apoderados, director, socios, equipo clave. "rol" tal cual lo dice la fuente; "fecha" (AAAA-MM-DD) si la fuente la da (el BORME, por ejemplo); "vigente": false si la fuente dice que cesó.
- cuentas: por ejercicio (año), en euros, solo números que la fuente da como cifra; "depositadas" (AAAA-MM-DD) si se sabe cuándo se depositaron.
- clientes: empresas o instituciones para las que trabajó (casos, logos con nombre, prensa). No sus proveedores ni competidores.
Forma: {"datos": {"<campo>": {"valor": string, "fuente": string}}, "personas": [{"nombre": string, "rol": string, "fecha": string|null, "vigente": boolean, "fuente": string}], "cuentas": [{"ejercicio": number, "ingresos": number|null, "resultado": number|null, "patrimonio": number|null, "activo": number|null, "empleados": number|null, "depositadas": string|null, "fuente": string}], "clientes": [{"nombre": string, "fuente": string}]}`

/** Para las pruebas: cómo se busca y se lee en la web (por defecto, src/web.ts). */
let web_ = {
  buscar: async (db: Db, q: string, ahora: number) => (await import('./web.ts')).buscarWeb(db, q, { n: 5, ahora }),
  leer: async (url: string, max: number) => (await import('./web.ts')).leerPagina(url, max),
}
export function _probarFichasWeb(w: typeof web_) { web_ = w }

/** Los links internos de una página (en su Markdown) que suelen tener clientes, equipo o casos. */
function paginasUtiles(base: string, md: string): string[] {
  const out = new Set<string>()
  for (const m of md.matchAll(/\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g)) {
    let u: URL
    try { u = new URL(m[1], base) } catch { continue }
    if (u.host !== new URL(base).host) continue
    if (/client|proyect|trabaj|casos|portfolio|equipo|nosotros|about|quienes|team|work/i.test(u.pathname)) out.add(u.href.split('#')[0])
  }
  return [...out].slice(0, 2)
}

/**
 * Investiga la ficha en fuentes: busca en registros públicos y prensa, lee su web (y sus páginas de clientes o
 * equipo) y lo que su corpus ya dice de ella. El modelo saca datos, órganos, cuentas y clientes; todo lo que no traiga
 * una fuente de la lista se descarta. Los datos solo llenan lo vacío (lo que él cargó no se pisa: si una fuente dice
 * otra cosa, vuelve como discrepancia). Una llamada al modelo y unas pocas búsquedas.
 */
export async function investigarFicha(db: Db, id: number, o: { ahora?: number } = {}) {
  const ahora = o.ahora ?? Date.now()
  const { e, tipo, datos } = metaDe(db, id)
  const nombre = String(datos.razonSocial ?? e.nombre)
  const consultas = tipo === 'empresa'
    ? [`"${nombre}" administrador BORME`, `"${nombre}" cuentas anuales facturación empleados`, `"${e.nombre}" clientes proyectos`, `"${e.nombre}" site:linkedin.com`]
    : tipo === 'proyecto' ? [`"${e.nombre}" equipo fundadores`, `"${e.nombre}" clientes`] : [`"${e.nombre}" ${datos.direccion ?? ''} horario teléfono`]
  const fuentes: { url: string; titulo: string; texto: string }[] = []
  const fallas: string[] = []
  for (const q of consultas) {
    try { for (const r of await web_.buscar(db, q, ahora)) if (!fuentes.some((f) => f.url === r.url)) fuentes.push({ url: r.url, titulo: r.titulo, texto: r.extracto }) } catch (er) { fallas.push(er instanceof Error ? er.message : String(er)) }
  }
  const web = datos.web ? (/^https?:/.test(String(datos.web)) ? String(datos.web) : `https://${datos.web}`) : null
  if (web) {
    try {
      const home = await web_.leer(web, 8000)
      if (home) {
        fuentes.unshift({ url: web, titulo: home.titulo, texto: home.texto })
        for (const u of paginasUtiles(web, home.texto)) { const p = await web_.leer(u, 6000).catch(() => null); if (p) fuentes.push({ url: u, titulo: p.titulo, texto: p.texto }) }
      }
    } catch (er) { fallas.push(`su web: ${er instanceof Error ? er.message : er}`) }
  }
  const piezas = db.prepare(`SELECT c.id, c.titulo, c.fecha, substr(c.contenido, 1, 1500) AS texto FROM corpus_entidades ce JOIN corpus c ON c.id = ce.pieza_id WHERE ce.entidad_id = ? AND c.fuente NOT IN ('fichas', 'hojas') ORDER BY COALESCE(c.fecha, '') DESC LIMIT 8`).all(id) as { id: number; titulo: string; fecha: string | null; texto: string }[]
  for (const p of piezas) fuentes.push({ url: `pieza:${p.id}`, titulo: `${p.titulo}${p.fecha ? ` (${p.fecha})` : ''}`, texto: p.texto })
  if (!fuentes.length) throw new Error(`No encontré nada sobre «${e.nombre}»${fallas.length ? ` (${fallas[0]})` : ''}: cargale la web o el CIF y probá de nuevo.`)

  const campos = CAMPOS[tipo].map((c) => c.k)
  const usuario = `Entidad: ${e.nombre} (${tipo})${datos.cif ? ` · CIF ${datos.cif}` : ''}${datos.direccion ? ` · ${datos.direccion}` : ''}${datos.web ? ` · ${datos.web}` : ''}\nCampos posibles de "datos": ${campos.join(', ')}\n\nFuentes:\n${fuentes.map((f) => `--- fuente: ${f.url}\n${f.titulo}\n${f.texto.slice(0, 3500)}`).join('\n\n')}`.slice(0, 40_000)
  const { pedirJson } = await import('./modelo.ts')
  const { datos: r } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'fichas' }, SISTEMA_INVESTIGAR, usuario, { temperatura: 0.1, maxTokens: 3000 })

  // Lo que no trae una fuente de la lista, afuera.
  const urls = new Set(fuentes.map((f) => f.url))
  const conFuente = (x: any) => x && typeof x.fuente === 'string' && urls.has(x.fuente.trim())
  let descartados = 0
  const filtrar = <T,>(xs: unknown): T[] => (Array.isArray(xs) ? xs : []).filter((x) => (conFuente(x) ? true : (descartados++, false))) as T[]

  const llenar: Record<string, unknown> = {}
  const discrepancias: { campo: string; tenias: string; fuente: string; dice: string }[] = []
  for (const [k, v] of Object.entries(r.datos ?? {})) {
    if (!campos.includes(k) || !conFuente(v)) { if (campos.includes(k)) descartados++; continue }
    const valor = String((v as any).valor ?? '').trim()
    if (!valor) continue
    const actual = comoTexto(datos[k])
    if (!actual) llenar[k] = valor
    else if (normal(actual) !== normal(valor)) discrepancias.push({ campo: k, tenias: actual, fuente: (v as any).fuente, dice: valor })
  }
  if (Object.keys(llenar).length) {
    // Cada dato con su propia fuente en la historia.
    for (const [k, v] of Object.entries(llenar)) await guardarDatos(db, id, { [k]: v }, { fuente: (r.datos[k] as any).fuente, ahora })
  }
  const personas = filtrar<any>(r.personas)
  for (const p of personas) anotarPersona(db, id, { nombre: String(p.nombre ?? ''), rol: p.rol ?? null, fuente: p.fuente, fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(p.fecha ?? '')) ? p.fecha : null, vigente: p.vigente !== false }, ahora)
  const cuentas = tipo === 'empresa' ? filtrar<any>(r.cuentas) : []
  for (const c of cuentas) anotarCuentas(db, id, { ...c, ejercicio: Number(c.ejercicio) }, ahora)
  const clientes = filtrar<any>(r.clientes)
  for (const c of clientes) anotarCliente(db, id, { nombre: String(c.nombre ?? ''), fuente: c.fuente }, ahora)

  // La solvencia, de las cuentas (y lo dice): pisa la estimada.
  if (tipo === 'empresa') {
    const s = solvenciaDe(cuentasDe(db, id))
    if (s) (await import('./empresas.ts')).guardarEmpresa(db, id, { criterio: { nombre: 'Solvencia', valor: s.valor, nota: s.nota } }, ahora, 'cuentas anuales')
  }
  db.prepare(`UPDATE entidades SET meta = json_set(COALESCE(meta, '{}'), '$.fichaInvestigada', ?) WHERE id = ?`).run(ahora, id)
  await alCorpus(db, id, ahora)
  return { llenados: Object.keys(llenar), personas: personas.length, cuentas: cuentas.length, clientes: clientes.length, discrepancias, descartados, fuentes: fuentes.length, fallas, ficha: fichaDe(db, id) }
}
