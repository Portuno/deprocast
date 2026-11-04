/** Sincronizar (plan v33): primero sale lo encolado (en orden), después se trae Hoy y se guarda. Sin red no rompe nada. */
import { mandarMensaje, traerHoy, type Credenciales } from './api'
import { cola, guardarPaquete, sacarDeCola } from './almacen'

export async function sincronizar(c: Credenciales): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const m of await cola()) {
      await mandarMensaje(c, m.texto)
      await sacarDeCola(m.id)
    }
    await guardarPaquete(await traerHoy(c))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
