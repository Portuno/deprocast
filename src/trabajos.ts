/**
 * Lo largo, de fondo (Fragua #83, #103, #67, #85, #68): si un pedido tarda más de unos segundos, el servidor contesta
 * «en marcha» con una clave y el trabajo sigue solo, sin depender de la conexión (que el proxy de la nube corta, y por eso
 * se veían «aborted due to timeout» y pedidos de 5 minutos). La pantalla pregunta por la clave hasta que termina: para
 * ella es transparente (api() espera el resultado igual que antes).
 */
type Trabajo = { que: string; estado: 'andando' | 'listo' | 'error'; resultado?: unknown; error?: string; desde: number; hasta: number | null }
const trabajos = new Map<string, Trabajo>()
let n = 0

/** Registra una promesa que ya está corriendo y devuelve su clave. */
export function registrarTrabajo(promesa: Promise<unknown>, que: string, ahora = Date.now()): string {
  for (const [k, t] of trabajos) if (t.hasta && ahora - t.hasta > 60 * 60_000) trabajos.delete(k)
  const clave = `t${ahora.toString(36)}${(++n).toString(36)}`
  const t: Trabajo = { que, estado: 'andando', desde: ahora, hasta: null }
  trabajos.set(clave, t)
  promesa.then(
    (resultado) => { t.estado = 'listo'; t.resultado = resultado ?? null; t.hasta = Date.now() },
    (e) => { t.estado = 'error'; t.error = e instanceof Error ? e.message : String(e); t.hasta = Date.now() },
  )
  return clave
}

/** Cómo va. Si el servidor se reinició en el medio, la clave ya no existe: «perdido». */
export function estadoTrabajo(clave: string) {
  const t = trabajos.get(clave)
  if (!t) return { estado: 'perdido' as const, error: 'Se perdió el trabajo (el servidor se reinició en el medio): probá de nuevo.' }
  return { estado: t.estado, que: t.que, segundos: Math.round(((t.hasta ?? Date.now()) - t.desde) / 1000), ...(t.estado === 'listo' ? { resultado: t.resultado } : {}), ...(t.estado === 'error' ? { error: t.error } : {}) }
}

export const trabajosEnMarcha = () => [...trabajos.values()].filter((t) => t.estado === 'andando').map((t) => t.que)

/**
 * Espera una promesa hasta `paciencia` ms: si termina, su valor ({ listo: true, valor }); si no, la registra y devuelve su
 * clave ({ listo: false, clave }). Si falla antes de la paciencia, el error sale como siempre.
 */
export async function conPaciencia<T>(promesa: Promise<T>, que: string, paciencia: number): Promise<{ listo: true; valor: T } | { listo: false; clave: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const corte = new Promise<null>((ok) => { timer = setTimeout(() => ok(null), paciencia) })
  try {
    const r = await Promise.race([promesa.then((valor) => ({ valor })), corte])
    if (r) return { listo: true, valor: r.valor }
    return { listo: false, clave: registrarTrabajo(promesa, que) }
  } finally { clearTimeout(timer) }
}
