/**
 * @menciones: el operador nombra entidades (proyectos, personas, lo que sea) o agentes con «@» en cualquier lugar
 * donde escribe, y el sistema sabe exactamente de quién habla. La pantalla autocompleta; acá se resuelve el texto
 * (también lo tipeado a mano): después de «@» gana el nombre o alias más largo que coincida.
 */
import { json, type Db } from './db.ts'
import { entidadDelJugador } from './personajes.ts'
import { alias, listar } from './roster.ts'

export type Mencionable = { clave: string; nombre: string; tipo: string; alias: string[]; piezas: number }
export type Mencion = { clave: string; nombre: string; tipo: string; texto: string; entidadId: number | null }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Todo lo que se puede nombrar con @: entidades (por cuántas piezas las mencionan) y agentes vivos. */
export function catalogo(db: Db): Mencionable[] {
  const yo = entidadDelJugador(db)
  const ents = (db.prepare(
    `WITH usos AS (SELECT j.value AS id, COUNT(*) AS n FROM corpus c, json_each(c.entidades) j WHERE c.entidades IS NOT NULL GROUP BY j.value)
     SELECT e.id, e.nombre, e.tipo, e.alias, COALESCE(u.n, 0) AS piezas FROM entidades e LEFT JOIN usos u ON u.id = e.id ORDER BY piezas DESC, e.nombre`,
  ).all() as { id: number; nombre: string; tipo: string; alias: string | null; piezas: number }[])
    .map((e) => ({ clave: e.id === yo ? 'jugador' : `entidad:${e.id}`, nombre: e.nombre, tipo: e.id === yo ? 'vos' : e.tipo, alias: json<string[]>(e.alias, []), piezas: e.piezas }))
  const agentes = listar(db).map((f) => ({ clave: `agente:${f.id}`, nombre: alias(f), tipo: 'agente', alias: f.nombre ? [f.id] : [], piezas: 0 }))
  return [...ents, ...agentes]
}

/** Las menciones de un texto, sin repetir, en el orden en que aparecen. */
export function menciones(db: Db, texto: string, cat: Mencionable[] = catalogo(db)): Mencion[] {
  if (!texto.includes('@')) return []
  const nombres = cat.flatMap((m) => [m.nombre, ...m.alias].filter((n) => n.trim().length >= 2).map((n) => ({ m, n: norm(n.trim()), texto: n.trim() })))
    .sort((a, b) => b.n.length - a.n.length)
  const t = norm(texto)
  const out = new Map<string, Mencion>()
  for (let i = t.indexOf('@'); i >= 0; i = t.indexOf('@', i + 1)) {
    if (i > 0 && /[\p{L}\p{N}_.]/u.test(t[i - 1])) continue // un mail no es una mención
    const resto = t.slice(i + 1)
    const hit = nombres.find((x) => resto.startsWith(x.n) && !/[\p{L}\p{N}]/u.test(resto[x.n.length] ?? ''))
    if (hit && !out.has(hit.m.clave)) {
      out.set(hit.m.clave, {
        clave: hit.m.clave, nombre: hit.m.nombre, tipo: hit.m.tipo, texto: texto.slice(i, i + 1 + hit.n.length),
        entidadId: hit.m.clave.startsWith('entidad:') ? Number(hit.m.clave.slice(8)) : hit.m.clave === 'jugador' ? entidadDelJugador(db) : null,
      })
    }
  }
  return [...out.values()]
}

/** El texto sin las arrobas de las menciones resueltas («Avanzar @Terreta Hub» → «Avanzar Terreta Hub»), para títulos. */
export function sinArrobas(texto: string, ms: Mencion[]): string {
  let s = texto
  for (const m of ms) s = s.replace(m.texto, m.texto.slice(1))
  return s
}
