/**
 * Los tramos de voz en disco (Mobile 1.0, bloque 2), sin nada de React Native: se prueban desde el repo.
 *
 * Cada tramo se graba a un archivo propio en la carpeta de documentos (la de caché el sistema la puede borrar) y, antes
 * de empezar, queda anotado «en curso». Si la app se cierra a la fuerza a mitad de un tramo, al abrir se recupera: el WAV
 * mantiene su encabezado válido mientras graba, así que lo grabado hasta ahí sirve. Un archivo suelto en la carpeta (que
 * no está ni en la cola ni en curso) también se recupera. Lo que es casi nada (menos de medio segundo) se borra.
 */

export type EnCurso = { id: string; uri: string; inicio: number; meta: { modo: string; caminando: boolean; conv?: boolean } }
export type Archivo = { uri: string; bytes: number; modificado: number | null }
export type Decision = { uri: string; accion: 'encolar' | 'borrar'; meta?: { id: string; modo: 'dictado' | 'pasivo' | 'conversacion'; inicio: number; fin: number; caminando: boolean; recuperado: true } }

/** 16 kHz mono en float32: 64 KB por segundo. Menos de medio segundo de audio (más el encabezado) no se manda. */
export const BYTES_POR_SEGUNDO = 16_000 * 4
export const MINIMO_BYTES = 44 + BYTES_POR_SEGUNDO / 2

/** El id de un tramo sale del nombre de su archivo (tramos/<id>.wav). */
export const idDeUri = (uri: string) => /([^/]+)\.wav$/i.exec(uri)?.[1] ?? null

/**
 * Qué hacer con lo que quedó al abrir: los tramos «en curso» (la app se cortó grabando) y los archivos sueltos de la
 * carpeta. Lo que ya está en la cola no se toca.
 */
export function recuperar(enCurso: EnCurso[], archivos: Archivo[], enCola: Set<string>, ahora = Date.now()): Decision[] {
  const porUri = new Map(archivos.map((a) => [a.uri, a]))
  const out: Decision[] = []
  const vistos = new Set<string>()
  for (const t of enCurso) {
    vistos.add(t.uri)
    const a = porUri.get(t.uri)
    if (!a || enCola.has(t.uri)) continue
    if (a.bytes < MINIMO_BYTES) { out.push({ uri: t.uri, accion: 'borrar' }); continue }
    const duracion = Math.round(((a.bytes - 44) / BYTES_POR_SEGUNDO) * 1000)
    const modo = t.meta.conv ? 'conversacion' : t.meta.modo === 'dictado' ? 'dictado' : 'pasivo'
    out.push({ uri: t.uri, accion: 'encolar', meta: { id: t.id, modo, inicio: t.inicio, fin: t.inicio + duracion, caminando: t.meta.caminando, recuperado: true } })
  }
  for (const a of archivos) {
    if (vistos.has(a.uri) || enCola.has(a.uri)) continue
    if (a.bytes < MINIMO_BYTES) { out.push({ uri: a.uri, accion: 'borrar' }); continue }
    const fin = a.modificado ?? ahora
    const inicio = fin - Math.round(((a.bytes - 44) / BYTES_POR_SEGUNDO) * 1000)
    // Suelto: no se sabe si era dictado; va como nota (pasivo), que nunca entra al chat por error.
    out.push({ uri: a.uri, accion: 'encolar', meta: { id: idDeUri(a.uri) ?? `suelto-${fin}`, modo: 'pasivo', inicio, fin, caminando: false, recuperado: true } })
  }
  return out
}

/**
 * Cuándo se cierra un tramo (lo que pase primero): se dejó de hablar, se cambió de app (la app pasó a segundo plano) o
 * llegó al máximo (60 s; en conversación, 20 s por turno; nunca más de 5 minutos).
 */
export const MAX_TRAMO_MS = 60_000
export const MAX_TRAMO_CONV_MS = 20_000
export function debeCerrar(t: { inicio: number; ultimaVoz: number; conv: boolean }, ahora: number, finSilencioMs: number, cambioDeApp: boolean): 'silencio' | 'app' | 'maximo' | null {
  if (cambioDeApp) return 'app'
  if (ahora - t.inicio > Math.min(5 * 60_000, t.conv ? MAX_TRAMO_CONV_MS : MAX_TRAMO_MS)) return 'maximo'
  if (ahora - t.ultimaVoz > finSilencioMs) return 'silencio'
  return null
}
