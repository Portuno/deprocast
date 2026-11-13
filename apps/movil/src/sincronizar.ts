/**
 * Sincronizar (plan v33; Mobile 1.0). Primero sale lo encolado (en orden), después se trae Hoy y se guarda. Sin red no
 * rompe nada. Lo de 1.0:
 * - una sola sincronización a la vez (antes dos simultáneas podían mandar dos veces un mensaje de la cola);
 * - cada ítem de la cola corre su suerte: uno roto (un tramo sin voz, 422) se descarta en vez de trabar todo, y uno que
 *   no salió por la red espera la próxima sin frenar que Hoy se actualice (antes el primer error cortaba todo y Hoy
 *   quedaba con lo viejo hasta reiniciar);
 * - quien muestre algo (Hoy, Escucha) se entera cuando cambió (alCambiar);
 * - mientras la app está abierta se pregunta cada 5 s la marca barata de Hoy, y se trae el paquete entero solo si cambió;
 *   al volver del segundo plano, se sincroniza enseguida.
 */
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { ErrorApi, mandarMensaje, subirVoz, traerHoy, traerMarca, type Credenciales } from './api'
import { anotarError, cola, colaVoz, estadoSincro, guardarPaquete, sacarDeCola, sacarVoz, sumarIntento } from './almacen'
import { claseDe, unaALaVez } from './logica/sincro'

export type Subido = { id: string | undefined; modo: string; texto: string; destino?: string }
export type Resultado = { ok: boolean; error?: string; subidos: Subido[]; descartados: number }

const escuchas = new Set<(r: Resultado) => void>()
/** Avisa cada vez que termina una sincronización (con lo que subió). Devuelve cómo dejar de escuchar. */
export function alCambiar(f: (r: Resultado) => void): () => void {
  escuchas.add(f)
  return () => { escuchas.delete(f) }
}

const statusDe = (e: unknown) => (e instanceof ErrorApi ? e.status : null)
const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** Los tramos que fallaron así de veces seguidas por el servidor (no por la red) se dejan de lado. */
const MAX_INTENTOS_VOZ = 8

/** Lo que va saliendo: los mensajes en orden (si uno no sale por la red, los que siguen esperan con él). */
async function vaciarMensajes(c: Credenciales): Promise<{ error: string | null; descartados: number }> {
  let descartados = 0
  for (const m of await cola()) {
    try {
      await mandarMensaje(c, m.texto, { id: m.clave ?? `cola-${m.id}-${m.en}`, en: m.en })
      await sacarDeCola(m.id)
    } catch (e) {
      const clase = claseDe(statusDe(e))
      if (clase === 'descartar') { await sacarDeCola(m.id); descartados++; continue }
      return { error: mensajeDe(e), descartados }
    }
  }
  return { error: null, descartados }
}

/** Los tramos de voz: cada uno con su suerte. Devuelve lo que subió (para mostrarlo en Escucha). */
async function vaciarVoces(c: Credenciales, puedeSubirAudio: () => Promise<boolean>): Promise<{ error: string | null; subidos: Subido[]; descartados: number }> {
  const { File } = await import('expo-file-system')
  const subidos: Subido[] = []
  let descartados = 0
  let error: string | null = null
  if (!(await puedeSubirAudio())) return { error: null, subidos, descartados }
  for (const v of await colaVoz()) {
    const f = new File(v.uri)
    const borrar = () => { try { f.delete() } catch { /* ya no está */ } }
    if (!f.exists) { await sacarVoz(v.id); continue }
    const meta = JSON.parse(v.meta)
    try {
      const r = await subirVoz(c, v.uri, meta)
      // Borrado local recién cuando el servidor confirmó.
      await sacarVoz(v.id); borrar()
      subidos.push({ id: meta.id, modo: meta.modo, texto: r.texto, destino: r.destino })
    } catch (e) {
      const clase = claseDe(statusDe(e))
      if (clase === 'descartar' || (statusDe(e) != null && v.intentos + 1 >= MAX_INTENTOS_VOZ)) { await sacarVoz(v.id); borrar(); descartados++; continue }
      if (statusDe(e) != null) await sumarIntento(v.id)
      error = mensajeDe(e)
      if (statusDe(e) == null) break // sin red: los demás tampoco van a salir ahora
    }
  }
  return { error, subidos, descartados }
}

/** Lo extra que sube cada sincronización (las capas del día, en Escucha). Se registra desde afuera. */
const extras = new Set<(c: Credenciales) => Promise<void>>()
export function alSincronizar(f: (c: Credenciales) => Promise<void>): () => void { extras.add(f); return () => { extras.delete(f) } }
/** Si se puede subir audio ahora (batería, red): lo decide Captura; por defecto, sí. */
let puedeAudio: () => Promise<boolean> = async () => true
export function decidirAudio(f: () => Promise<boolean>) { puedeAudio = f }

export const sincronizar = unaALaVez(async (c: Credenciales): Promise<Resultado> => {
  const errores: string[] = []
  const m = await vaciarMensajes(c).catch((e) => ({ error: mensajeDe(e), descartados: 0 }))
  if (m.error) errores.push(m.error)
  const v = await vaciarVoces(c, puedeAudio).catch((e) => ({ error: mensajeDe(e), subidos: [] as Subido[], descartados: 0 }))
  if (v.error) errores.push(v.error)
  for (const f of extras) await f(c).catch(() => {})
  // Hoy se trae siempre, aunque algo de la cola no haya salido.
  try { await guardarPaquete(await traerHoy(c)) } catch (e) { errores.push(mensajeDe(e)) }
  const r: Resultado = { ok: !errores.length, error: errores[0], subidos: v.subidos, descartados: m.descartados + v.descartados }
  await anotarError(r.ok ? null : r.error ?? null).catch(() => {})
  for (const f of escuchas) { try { f(r) } catch { /* una pantalla rota no frena a las demás */ } }
  return r
})

/** ¿Cambió algo en Hoy? Pregunta la marca (barato) y sincroniza solo si cambió (o si hay algo esperando salir). */
export async function revisarCambio(c: Credenciales, hayPendientes: () => Promise<boolean>): Promise<boolean> {
  try {
    const { marca } = await traerMarca(c)
    const actual = (await estadoSincro()).marca
    if (marca !== actual || (await hayPendientes())) { await sincronizar(c); return true }
    return false
  } catch {
    return false // sin red: la próxima vuelta
  }
}

/**
 * La sincronización de toda la app (no de una pantalla: antes, estando en Escucha, Hoy no se sincronizaba). Con la app
 * abierta, la marca cada 5 s; al volver del segundo plano, enseguida; y una completa cada minuto por las dudas.
 */
export function useSincronizacion(c: Credenciales | null, hayPendientes: () => Promise<boolean>) {
  useEffect(() => {
    if (!c) return
    let activa = AppState.currentState === 'active'
    void sincronizar(c)
    const marca = setInterval(() => { if (activa) void revisarCambio(c, hayPendientes) }, 5_000)
    const completa = setInterval(() => { if (activa) void sincronizar(c) }, 60_000)
    const app = AppState.addEventListener('change', (s) => {
      const antes = activa
      activa = s === 'active'
      if (activa && !antes) void sincronizar(c)
    })
    return () => { clearInterval(marca); clearInterval(completa); app.remove() }
  }, [c, hayPendientes])
}
