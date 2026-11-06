/**
 * Lo que Mastropiero le sugiere, y lo que él contesta, cambia el sistema (plan v37). Cada respuesta que nombra una misión
 * abierta suya («hacé el presupuesto de Ana») la deja anotada como sugerida en esa charla. Si después dice «ya la hice»,
 * se marca hecha en el acto, sin pasar por el modelo; si dice «no me la vuelvas a sugerir» o «sacala», se descarta. Y el
 * prompt sabe qué le sugirió hace poco, así lo que no resuelve la regla lo resuelve el modelo con la misión correcta.
 *
 * Una misión cerrada no se vuelve a sugerir porque deja de estar abierta (todas las listas que ve Mastropiero son de
 * abiertas).
 */
import type { Db } from '../db.ts'
import { actualizarMision, leerMision, listarMisiones, marcarSecundaria } from '../misiones.ts'

const VENTANA = 3 * 3_600_000
const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim()

/** Las misiones abiertas suyas que nombra un texto (por título, o por [#id]). */
export function misionesNombradas(db: Db, texto: string): { id: number; titulo: string }[] {
  const t = ` ${normal(texto)} `
  const ids = new Set([...texto.matchAll(/\[#(\d+)\]|#(\d+)\b/g)].map((m) => Number(m[1] ?? m[2])))
  return listarMisiones(db, { abiertas: true, limite: 300 })
    .filter((m) => m.personaje === 'jugador' && (m.estado === 'activa' || m.estado === 'sugerida'))
    .filter((m) => { const n = normal(m.titulo); return ids.has(m.id) || (n.length >= 8 && t.includes(` ${n} `)) })
    .map((m) => ({ id: m.id, titulo: m.titulo }))
}

/** Después de cada respuesta: lo que nombró queda como «sugerido ahora» en esa charla (reemplaza lo anterior). */
export function anotarSugeridas(db: Db, cid: number, respuesta: string, ahora = Date.now()): number {
  const ms = misionesNombradas(db, respuesta)
  if (!ms.length) return 0
  db.prepare('DELETE FROM chat_sugeridas WHERE conversacion_id = ? AND en < ?').run(cid, ahora - VENTANA)
  db.prepare('UPDATE chat_sugeridas SET ultima = 0 WHERE conversacion_id = ?').run(cid)
  const ins = db.prepare('INSERT INTO chat_sugeridas (conversacion_id, mision_id, titulo, en, ultima) VALUES (?, ?, ?, ?, 1) ON CONFLICT (conversacion_id, mision_id) DO UPDATE SET en = excluded.en, ultima = 1')
  for (const m of ms) ins.run(cid, m.id, m.titulo, ahora)
  return ms.length
}

type Sugerida = { misionId: number; titulo: string; en: number; ultima: boolean }
function vigentes(db: Db, cid: number, ahora: number): Sugerida[] {
  return (db.prepare('SELECT mision_id, titulo, en, ultima FROM chat_sugeridas WHERE conversacion_id = ? AND en >= ? ORDER BY ultima DESC, en DESC').all(cid, ahora - VENTANA) as any[])
    .map((r) => ({ misionId: r.mision_id, titulo: r.titulo, en: r.en, ultima: !!r.ultima }))
    .filter((s) => { const m = leerMision(db, s.misionId); return !!m && (m.estado === 'activa' || m.estado === 'sugerida') })
}

/** Para el prompt: lo que le sugirió hace poco y sigue abierto. */
export function sugeridasParaPrompt(db: Db, cid: number | null | undefined, ahora = Date.now()): string {
  if (!cid) return ''
  const s = vigentes(db, cid, ahora)
  if (!s.length) return ''
  return `Lo que le sugeriste hace poco y sigue abierto (si dice que ya lo hizo, marcalo hecho con marcar_mision o actualizar_mision; si dice que no va o que no se lo sugieras más, descartalo; lo cerrado no se vuelve a proponer):\n${s.map((x) => `- [#${x.misionId}] ${x.titulo}`).join('\n')}`
}

const HECHO = /^(ya (la|lo|las|los|esa|ese|eso) (hice|termine|resolvi|mande|complete|hicimos|cerre)|ya (hice|termine|mande|resolvi|complete)|ya (la|lo) tengo|ya (esta|quedo|fue)( hech[ao]| list[ao])?|hech[ao]s?|list[ao],? (ya )?(la|lo) hice|terminad[ao]|completad[ao]|done)\b/
const DESCARTAR = /(no (me )?(la|lo|las|los) (vuelvas a |sigas )?(sugerir|sugieras|recomiendes|propongas|menciones)|sacal[ao]s?|descartal[ao]s?|borral[ao]s?|no (la|lo) voy a hacer|ya no va|olvidal[ao])/

/**
 * El carril rápido: «ya la hice» o «sacala» sobre algo que le sugirió hace poco. Si se sabe de qué misión habla (la
 * única sugerida en la última respuesta, o la que nombra), la cierra y devuelve qué decirle. Si no, null (va al modelo).
 */
export function resolverRapido(db: Db, cid: number, texto: string, ahora = Date.now()): string | null {
  const t = normal(texto)
  if (!t || t.length > 90 || texto.includes('?')) return null
  const hecho = HECHO.test(t)
  const descartar = !hecho && DESCARTAR.test(t)
  if (!hecho && !descartar) return null
  const s = vigentes(db, cid, ahora)
  if (!s.length) return null
  // La que nombra (alguna palabra de su título de 5+ letras), o la única de la última respuesta.
  const palabras = new Set(t.split(' ').filter((w) => w.length >= 5))
  const nombra = s.filter((x) => normal(x.titulo).split(' ').some((w) => w.length >= 5 && palabras.has(w)))
  const ultimas = s.filter((x) => x.ultima)
  const elegida = nombra.length === 1 ? nombra[0] : !nombra.length && ultimas.length === 1 ? ultimas[0] : null
  if (!elegida) return null
  const m = leerMision(db, elegida.misionId)!
  if (hecho) {
    if (m.nivel === 'secundaria') marcarSecundaria(db, m.id, 'hecha', null, ahora)
    else actualizarMision(db, m.id, { estado: 'hecha' }, { por: 'operador', ahora })
  } else actualizarMision(db, m.id, { estado: 'descartada' }, { por: 'operador', ahora })
  db.prepare('DELETE FROM chat_sugeridas WHERE conversacion_id = ? AND mision_id = ?').run(cid, m.id)
  return hecho ? `✅ Listo: «${m.titulo}» quedó hecha. No te la vuelvo a sugerir.` : `🗑 Saqué «${m.titulo}»: no te la vuelvo a proponer.`
}
