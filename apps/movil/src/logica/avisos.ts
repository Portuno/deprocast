/**
 * Los avisos del teléfono (Mobile 1.3), sin nada de React Native: se prueba desde el repo.
 * - planDeAvisos: con lo programado y lo que manda el servidor (eventos y recordatorios), qué se cancela (lo que ya no
 *   está: un evento que se movió o un recordatorio borrado) y qué se programa;
 * - nuevosDeMastropiero: lo que escribió Mastropiero en Hoy desde lo último que se avisó, en un solo aviso;
 * - masParaValidar: si creció lo que espera tu ok.
 * La primera vez (sin nada visto) solo se toma la marca: no se avisa todo lo viejo de golpe.
 */
export type Aviso = { clave: string; titulo: string; cuerpo: string; en: number }
const DEL_SERVIDOR = /^(ev|rec):/

export function planDeAvisos(programados: string[], avisos: Aviso[], ahora = Date.now()): { cancelar: string[]; programar: Aviso[] } {
  const futuros = avisos.filter((a) => a.en > ahora)
  const claves = new Set(futuros.map((a) => a.clave))
  return { cancelar: programados.filter((id) => DEL_SERVIDOR.test(id) && !claves.has(id)), programar: futuros }
}

export function nuevosDeMastropiero(mensajes: { id: number; rol: string; texto: string }[], ultimoAvisado: number | null): { aviso: { titulo: string; cuerpo: string } | null; ultimo: number } {
  const ultimo = mensajes.reduce((m, x) => Math.max(m, x.id), ultimoAvisado ?? 0)
  if (ultimoAvisado == null) return { aviso: null, ultimo }
  const nuevos = mensajes.filter((m) => m.rol === 'asistente' && m.id > ultimoAvisado && m.texto.trim())
  if (!nuevos.length) return { aviso: null, ultimo }
  const texto = nuevos[nuevos.length - 1].texto.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim()
  return { aviso: { titulo: nuevos.length > 1 ? `Mastropiero (${nuevos.length})` : 'Mastropiero', cuerpo: texto.length > 240 ? `${texto.slice(0, 239)}…` : texto }, ultimo }
}

export function masParaValidar(antes: number | null, ahora: number): { titulo: string; cuerpo: string } | null {
  if (antes == null || ahora <= antes) return null
  return { titulo: '📥 Esperan tu ok', cuerpo: `${ahora} cosa${ahora === 1 ? '' : 's'} para validar (${ahora - antes} nueva${ahora - antes === 1 ? '' : 's'}).` }
}
