/** Sincronizar (plan v33): primero sale lo encolado (en orden), después se trae Hoy y se guarda. Sin red no rompe nada. */
import { mandarMensaje, subirVoz, traerHoy, type Credenciales } from './api'
import { cola, colaVoz, guardarPaquete, sacarDeCola, sacarVoz } from './almacen'

export async function sincronizar(c: Credenciales): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const m of await cola()) {
      await mandarMensaje(c, m.texto)
      await sacarDeCola(m.id)
    }
    for (const v of await colaVoz()) {
      const { File } = await import('expo-file-system')
      const f = new File(v.uri)
      if (f.exists) { await subirVoz(c, v.uri, JSON.parse(v.meta)); try { f.delete() } catch { /* ya no está */ } }
      await sacarVoz(v.id)
    }
    await guardarPaquete(await traerHoy(c))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
