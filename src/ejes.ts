/**
 * La matriz de un término: una entidad vista en varios ejes a la vez — el tiempo (sus eventos y cuándo se la nombra),
 * la gente (relaciones y con quién aparece), los lugares, los temas y los proyectos. Sale de lo que ya armó el
 * procesamiento (pasajes, destilado, eventos, relaciones): no gasta tokens.
 * Y los homónimos: cuando un nombre esconde más de una cosa (la persona y el estudio que se llama como ella), el modelo
 * propone las acepciones con sus piezas y él separa con un toque: nace la entidad nueva, se le mueven sus piezas y
 * queda anotado que no son lo mismo (y que se llaman igual).
 */
import { json, type Db } from './db.ts'
import { anotarConexion, conexionesDe, coocurrencias, leerEntidad, noSonLoMismo, type TipoEntidad, TIPOS_ENTIDAD } from './entidades.ts'
import { lineaTemporal } from './linea.ts'
import { pedirJson } from './modelo.ts'

const contiene = `EXISTS (SELECT 1 FROM json_each(COALESCE(c.entidades, '[]')) j WHERE j.value = ?)`

export function ejesDe(db: Db, id: number) {
  const e = leerEntidad(db, id)
  if (!e) throw new Error(`No existe la entidad ${id}`)
  const co = coocurrencias(db, id, 60)
  const porMes = db.prepare(`SELECT substr(c.fecha, 1, 7) AS mes, COUNT(*) AS n FROM corpus c WHERE ${contiene} AND c.fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]*' GROUP BY 1 ORDER BY 1`).all(id) as { mes: string; n: number }[]
  const temas = db.prepare(`SELECT MIN(t.tema) AS tema, COUNT(*) AS n FROM temas_pulso t JOIN corpus c ON c.id = t.pieza_id WHERE ${contiene} GROUP BY t.clave ORDER BY n DESC LIMIT 15`).all(id) as { tema: string; n: number }[]
  const lineas = lineaTemporal(db, { entidad: id, limite: 80 })
  return {
    entidad: { id: e.id, nombre: e.nombre, tipo: e.tipo },
    tiempo: { porMes, eventos: lineas.eventos.slice(0, 40).map((x) => ({ id: x.id, fecha: x.fecha, titulo: x.titulo, tipo: x.tipo, pieza: x.piezaId })) },
    gente: {
      relaciones: conexionesDe(db, id).map((c) => ({ id: c.otra, nombre: c.nombre, tipo: c.tipo, relacion: c.relacion })),
      aparece: co.filter((x) => x.tipo === 'persona' || x.tipo === 'agrupacion').slice(0, 12).map((x) => ({ id: x.id, nombre: x.nombre, veces: x.compartidas })),
    },
    lugares: co.filter((x) => x.tipo === 'lugar').slice(0, 12).map((x) => ({ id: x.id, nombre: x.nombre, veces: x.compartidas, lat: x.meta?.lat ?? null, lon: x.meta?.lon ?? null })),
    temas,
    proyectos: co.filter((x) => x.tipo === 'proyecto').slice(0, 12).map((x) => ({ id: x.id, nombre: x.nombre, veces: x.compartidas })),
  }
}

// ─── homónimos ──────────────────────────────────────────────────────────

const SISTEMA_ACEPCIONES = `Te paso un nombre y los fragmentos de un archivo personal donde aparece. Decidí si ese nombre se refiere a UNA sola cosa o a VARIAS distintas que se llaman igual (por ejemplo, una persona y un estudio o una calle que llevan su nombre, o dos personas homónimas).
- Si es una sola, devolvé una sola acepción con todas las piezas.
- Si son varias, una acepción por cada una: un nombre que la distinga («Nombre (el estudio)»), qué es (una frase) y qué piezas son de ella (los números que te paso). Una pieza puede ir en más de una si nombra a las dos.
- No inventes: si no está claro, dejá la pieza en la acepción principal.
Forma: {"acepciones": [{"nombre": string, "tipo": "persona" | "proyecto" | "agrupacion" | "lugar" | "concepto", "descripcion": string, "piezas": [number]}]}`

let consultar = async (db: Db, usuario: string) => (await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'ejes' }, SISTEMA_ACEPCIONES, usuario, { temperatura: 0.1, maxTokens: 3000 })).datos
export function _probarAcepciones(f: typeof consultar) {
  consultar = f
}

/** ¿Hay más de uno con este nombre? Las acepciones que ve el modelo, cada una con sus piezas. */
export async function acepciones(db: Db, id: number): Promise<{ nombre: string; tipo: string; descripcion: string; piezas: { id: number; titulo: string }[] }[]> {
  const e = leerEntidad(db, id)
  if (!e) throw new Error(`No existe la entidad ${id}`)
  const nombres = [e.nombre, ...e.alias].filter(Boolean)
  const piezas = db.prepare(`SELECT c.id, c.titulo, c.contenido, c.fecha FROM corpus c WHERE ${contiene} ORDER BY c.nivel = 'generada', c.id DESC LIMIT 60`).all(id) as { id: number; titulo: string; contenido: string; fecha: string | null }[]
  if (piezas.length < 2) return [{ nombre: e.nombre, tipo: e.tipo, descripcion: 'Aparece en muy pocas piezas para separar nada.', piezas: piezas.map((p) => ({ id: p.id, titulo: p.titulo })) }]
  // De cada pieza, el fragmento alrededor del nombre (es lo que dice quién es).
  const fragmento = (t: string) => {
    const bajo = t.toLowerCase()
    const i = nombres.map((n) => bajo.indexOf(n.toLowerCase())).filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 0
    return t.slice(Math.max(0, i - 250), i + 350).replace(/\s+/g, ' ')
  }
  const d = await consultar(db, `Nombre: ${e.nombre}${e.alias.length ? ` (también ${e.alias.slice(0, 5).join(', ')})` : ''}\n\n${piezas.map((p) => `[${p.id}] «${p.titulo}»${p.fecha ? ` (${String(p.fecha).slice(0, 10)})` : ''}: ${fragmento(p.contenido)}`).join('\n\n').slice(0, 50_000)}`)
  const validas = new Set(piezas.map((p) => p.id))
  const titulo = new Map(piezas.map((p) => [p.id, p.titulo]))
  return (Array.isArray(d?.acepciones) ? d.acepciones : []).slice(0, 6).map((a: any) => ({
    nombre: String(a?.nombre ?? e.nombre).slice(0, 120), tipo: TIPOS_ENTIDAD.includes(a?.tipo) ? a.tipo : e.tipo, descripcion: String(a?.descripcion ?? '').slice(0, 300),
    piezas: [...new Set((Array.isArray(a?.piezas) ? a.piezas : []).map(Number).filter((x: number) => validas.has(x)))].map((x) => ({ id: x as number, titulo: titulo.get(x as number) ?? '' })),
  })).filter((a: { piezas: unknown[] }) => a.piezas.length)
}

/** Separa: una entidad nueva (aunque se llame igual) con esas piezas, que dejan de apuntar a la de antes. */
export function separarEntidad(db: Db, id: number, o: { nombre: string; tipo?: string; notas?: string | null; piezas: number[] }, ahora = Date.now()): { id: number; movidas: number } {
  const e = leerEntidad(db, id)
  if (!e) throw new Error(`No existe la entidad ${id}`)
  const nombre = o.nombre.trim()
  if (!nombre) throw new Error('Falta el nombre de la nueva')
  if (!o.piezas.length) throw new Error('Elegí qué piezas son de la nueva')
  const tipo = (TIPOS_ENTIDAD.includes(o.tipo as TipoEntidad) ? o.tipo : e.tipo) as TipoEntidad
  // Siempre nueva (con su origen propio), aunque el nombre sea el mismo: es otra cosa.
  const nueva = Number(db.prepare('INSERT INTO entidades (origen_id, tipo, nombre, alias, notas, meta, creada_en) VALUES (?, ?, ?, NULL, ?, NULL, ?)')
    .run(`separada:${id}:${ahora}:${Math.random().toString(36).slice(2, 8)}`, tipo, nombre, o.notas?.trim() || null, ahora).lastInsertRowid)
  let movidas = 0
  const leer = db.prepare('SELECT entidades FROM corpus WHERE id = ?')
  const poner = db.prepare('UPDATE corpus SET entidades = ? WHERE id = ?')
  for (const p of o.piezas) {
    const r = leer.get(p) as { entidades: string | null } | undefined
    if (!r) continue
    const actual = json<number[]>(r.entidades, []) ?? []
    if (!actual.includes(id)) continue
    poner.run(JSON.stringify([...actual.filter((x) => x !== id), nueva]), p)
    movidas++
  }
  noSonLoMismo(db, [id, nueva])
  anotarConexion(db, { a: Math.min(id, nueva), b: Math.max(id, nueva), relacion: 'homónimo', nota: `Se llaman igual («${e.nombre}» / «${nombre}»): separadas a mano`, origen: 'ejes' }, ahora)
  return { id: nueva, movidas }
}
