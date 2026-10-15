/**
 * Quién es él: lo primero que Deprocast tiene que conocer. Un perfil que arma él (cómo se llama, cómo le dicen, dónde
 * vive, de qué trabaja, sus proyectos, cómo trabaja, lo que hay que saber de él), guardado en su entidad (la del
 * jugador). Mastropiero lo lee entero, antes que la memoria. Lo que no cargó queda vacío.
 */
import { json, type Db } from './db.ts'
import { asegurarEntidad, editarEntidad, leerEntidad } from './entidades.ts'
import { entidadDelJugador, marcarJugador } from './personajes.ts'
import { horarioComoTexto, leerHorario } from './horario.ts'
import { personaEnUnaLinea, personas } from './personas.ts'
import { memoriaVigente } from './memoria.ts'

export const CAMPOS_PERFIL = {
  vive: 'Dónde vive',
  trabajo: 'De qué trabaja (y dónde)',
  proyectos: 'Sus proyectos principales',
  como_trabaja: 'Cómo trabaja, cómo le gusta que le hablen',
  saber: 'Lo que hay que saber de él',
} as const
export type Perfil = Partial<Record<keyof typeof CAMPOS_PERFIL, string>>

export function leerPerfil(db: Db): Perfil {
  const id = entidadDelJugador(db)
  if (!id) return {}
  const meta = json<Record<string, any>>((db.prepare('SELECT meta FROM entidades WHERE id = ?').get(id) as any)?.meta, {}) ?? {}
  return meta.perfil && typeof meta.perfil === 'object' ? meta.perfil : {}
}

/** Lo que muestra la tarjeta «Vos»: su entidad, el perfil, su horario, cuánto sabe Mastropiero y su gente clave. */
export function leerYo(db: Db) {
  const id = entidadDelJugador(db)
  const e = id ? leerEntidad(db, id) : null
  const memoria = memoriaVigente(db)
  const porTipo: Record<string, number> = {}
  for (const r of memoria) porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1
  return {
    entidad: e ? { id: e.id, nombre: e.nombre, alias: e.alias } : null,
    perfil: leerPerfil(db),
    campos: CAMPOS_PERFIL,
    horario: horarioComoTexto(leerHorario(db)),
    memoria: { total: memoria.length, porTipo, sinRevisar: memoria.filter((r) => !r.revisada).length },
    clave: personas(db, { orden: 'nivel' }).filter((p) => (p.nivel ?? 0) >= 10 || (p.importancia ?? 0) >= 10).slice(0, 12).map((p) => ({ id: p.id, nombre: p.nombre, nivel: p.nivel, importancia: p.importancia, vinculo: p.vinculo })),
  }
}

/**
 * Guarda su perfil (y su nombre y cómo le dicen). Los campos que vienen vacíos se borran; los que no vienen, quedan.
 * Si todavía no hay jugador y viene un nombre, lo crea y lo marca como él.
 */
export function guardarYo(db: Db, c: { nombre?: string; alias?: string[]; perfil?: Perfil }, ahora = Date.now()) {
  let id = entidadDelJugador(db)
  if (!id) {
    if (!c.nombre?.trim()) throw new Error('Decime cómo te llamás para empezar tu perfil')
    id = asegurarEntidad(db, { tipo: 'persona', nombre: c.nombre.trim() }, ahora)
    marcarJugador(db, id)
  }
  if (c.nombre?.trim() || c.alias) editarEntidad(db, id, { nombre: c.nombre?.trim() || undefined, alias: c.alias?.map((a) => a.trim()).filter(Boolean) })
  if (c.perfil) {
    const meta = json<Record<string, any>>((db.prepare('SELECT meta FROM entidades WHERE id = ?').get(id) as any)?.meta, {}) ?? {}
    const perfil: Perfil = { ...(meta.perfil ?? {}) }
    for (const k of Object.keys(CAMPOS_PERFIL) as (keyof Perfil)[]) {
      if (!(k in c.perfil)) continue
      const v = String(c.perfil[k] ?? '').trim()
      if (v) perfil[k] = v.slice(0, 2000)
      else delete perfil[k]
    }
    db.prepare('UPDATE entidades SET meta = ? WHERE id = ?').run(JSON.stringify({ ...meta, perfil }), id)
  }
  return leerYo(db)
}

/** Para el prompt: quién es, entero (sin recortes), y su gente clave. Vacío si no cargó nada. */
export function yoParaPrompt(db: Db): string {
  const p = leerPerfil(db)
  const lineas = (Object.keys(CAMPOS_PERFIL) as (keyof Perfil)[]).filter((k) => p[k]).map((k) => `- ${CAMPOS_PERFIL[k]}: ${p[k]}`)
  const clave = personas(db, { orden: 'nivel' }).filter((x) => (x.nivel ?? 0) >= 11 || (x.importancia ?? 0) >= 11).slice(0, 8)
  if (clave.length) lineas.push(`- Su gente más cercana: ${clave.map(personaEnUnaLinea).join('; ')}`)
  return lineas.length ? `Quién es (su perfil, lo escribió él; manda sobre lo que deduzcas):\n${lineas.join('\n')}` : ''
}
