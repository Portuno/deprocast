/**
 * El Mentor (personaje 17): cruza la Librería con lo que está empujando (principal, primarias de la semana, lo que
 * sabe de él) y le propone qué leer, ver, jugar o estudiar ahora, ya convertido en algo hacible: una banda para la
 * próxima run o una side quest. Él acepta o descarta; aceptar lo anota y pone la obra «en curso».
 */
import type { Db } from './db.ts'
import { pedirJson } from './modelo.ts'
import { memoriaParaPrompt } from './memoria.ts'
import { anotarSideQuest, listarMisiones, principalDe, semanaDe } from './misiones.ts'
import { editarObra, leerObra, listarObras } from './libreria.ts'

export type Recomendacion = { id: number; obraId: number; titulo: string; tipo: string; porQue: string; accion: string; como: 'banda' | 'side_quest'; minutos: number | null; estado: string; creadaEn: number }
const deFila = (r: any): Recomendacion => ({ id: r.id, obraId: r.obra_id, titulo: r.titulo, tipo: r.tipo, porQue: r.por_que, accion: r.accion, como: r.como, minutos: r.minutos, estado: r.estado, creadaEn: r.creada_en })

export const listarRecomendaciones = (db: Db, estado = 'sugerida'): Recomendacion[] =>
  db.prepare(`SELECT m.*, o.titulo, o.tipo FROM mentor m JOIN obras o ON o.id = m.obra_id WHERE m.estado = ? ORDER BY m.id DESC LIMIT 20`).all(estado).map(deFila)

const SISTEMA = `Sos Mastropiero hablando como el Mentor. Le recomendás al jugador qué leer, ver, jugar o estudiar AHORA de su propia Librería, para lo que está empujando.
Forma: {"recomendaciones": [{"obra": number, "por_que": string, "accion": string, "como": "banda" | "side_quest", "minutos": number | null}]}
- Hasta 3. «obra» es el número de la lista. Solo obras de la lista.
- «por_que»: una oración que conecte la obra con una primaria, su principal o algo que sabés de él. Si no hay conexión real, no la recomiendes.
- «accion»: algo concreto y chico, en infinitivo («Leer el prólogo y el capítulo 1 de…», «Ver la primera hora de… tomando notas sobre…», «Clonar … y correr el ejemplo»).
- «como»: «banda» si es trabajo con foco (va a la próxima run; «minutos»: 12, 25 o 50); «side_quest» si es para un rato libre o un viaje.
- Preferí lo que ya empezó (en curso) o lo que quiere (quiero) y lo que valoró alto.`

export async function recomendar(db: Db, ahora = Date.now()): Promise<Recomendacion[]> {
  const candidatas = [
    ...listarObras(db, { estado: 'en_curso', limite: 15 }),
    ...listarObras(db, { estado: 'quiero', limite: 40 }),
    // Lo de referencia: primero lo que valoró o revisó; después lo que Mastropiero sacó de su corpus (lo más nombrado).
    ...listarObras(db, { estado: 'referencia', limite: 500 })
      .sort((a, b) => Number(b.revisada) - Number(a.revisada) || (b.valoracion ?? 0) - (a.valoracion ?? 0) || b.piezas.length - a.piezas.length)
      .slice(0, 40),
  ]
  if (!candidatas.length) throw new Error('La Librería está vacía: sumá obras o poblala desde el corpus')
  const principal = principalDe(db, 'jugador')
  const prims = listarMisiones(db, { personaje: 'jugador', nivel: 'primaria', semana: semanaDe(ahora), estados: ['activa'] })
  const yaSugeridas = new Set((db.prepare(`SELECT obra_id FROM mentor WHERE estado = 'sugerida' OR (estado = 'descartada' AND creada_en > ?)`).all(ahora - 14 * 86_400_000) as any[]).map((r) => r.obra_id))
  const lista = candidatas.filter((o, i, a) => a.findIndex((x) => x.id === o.id) === i && !yaSugeridas.has(o.id)).slice(0, 60)
  if (!lista.length) return listarRecomendaciones(db)
  const usuario = [
    principal ? `Su misión principal: ${principal.titulo}` : '',
    prims.length ? `Primarias de la semana:\n${prims.map((m) => `- ${m.titulo}${m.detalle ? ` — ${m.detalle.slice(0, 140)}` : ''}`).join('\n')}` : 'Sin primarias esta semana.',
    `Lo que sabés de él:\n${memoriaParaPrompt(db, 25) || '(poco)'}`,
    `Su Librería (candidatas):\n${lista.map((o, i) => `${i + 1}. [${o.tipo}] ${o.titulo}${o.autor ? ` — ${o.autor}` : ''} · ${o.estado}${o.valoracion ? ` · ${o.valoracion}/12` : ''}${o.notas ? ` · ${o.notas.slice(0, 100)}` : ''}`).join('\n')}`,
  ].filter(Boolean).join('\n\n')
  const { datos } = await pedirJson<any>({ db, clase: 'mastropiero', agenteId: 'mentor' }, SISTEMA, usuario, { temperatura: 0.5, maxTokens: 1500 })
  const ins = db.prepare(`INSERT INTO mentor (obra_id, por_que, accion, como, minutos, estado, creada_en) VALUES (?, ?, ?, ?, ?, 'sugerida', ?)`)
  for (const r of (Array.isArray(datos.recomendaciones) ? datos.recomendaciones : []).slice(0, 3)) {
    const o = lista[Number(r.obra) - 1]
    if (!o || !r.accion) continue
    ins.run(o.id, String(r.por_que ?? '').slice(0, 400), String(r.accion).slice(0, 200), r.como === 'side_quest' ? 'side_quest' : 'banda', [12, 25, 50].includes(Number(r.minutos)) ? Number(r.minutos) : null, ahora)
  }
  return listarRecomendaciones(db)
}

/** Aceptar: queda como side quest (las de «banda» marcadas para la próxima run) y la obra pasa a «en curso». */
export function resolverRecomendacion(db: Db, id: number, aceptar: boolean, ahora = Date.now()) {
  const r = db.prepare(`SELECT m.*, o.titulo, o.tipo FROM mentor m JOIN obras o ON o.id = m.obra_id WHERE m.id = ?`).get(id) as any
  if (!r) throw new Error(`No existe la recomendación ${id}`)
  db.prepare('UPDATE mentor SET estado = ?, resuelta_en = ? WHERE id = ?').run(aceptar ? 'aceptada' : 'descartada', ahora, id)
  if (!aceptar) return null
  const obra = leerObra(db, r.obra_id)!
  if (obra.estado === 'quiero' || obra.estado === 'referencia') editarObra(db, obra.id, { estado: 'en_curso' }, ahora)
  return anotarSideQuest(db, {
    titulo: r.accion, detalle: `${r.por_que}${r.como === 'banda' ? ` · Para la próxima run${r.minutos ? ` (${r.minutos} min)` : ''}.` : ''}`,
    disparador: r.como === 'banda' ? { cuando: 'en la próxima run', actividad: r.tipo === 'pelicula' || r.tipo === 'serie' ? 'ver' : r.tipo === 'repositorio' ? 'programar' : 'leer' } : { actividad: 'rato libre', cuando: null },
    creadaPor: 'mastropiero',
  })
}
