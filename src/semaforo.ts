/**
 * Un semáforo: como mucho N trabajos a la vez; los demás esperan su turno, en orden. PASOS_DE_FONDO es el de los pasos
 * pesados de fondo (el reproceso y el Takeout comparten el mismo): «de a 6 a la vez» (Fragua #244). Se cambia con
 * MASTRO_PASOS_A_LA_VEZ.
 */
export function semaforo(max: () => number) {
  let activos = 0
  let pico = 0
  const cola: (() => void)[] = []
  const tomar = () => new Promise<void>((ok) => {
    const entrar = () => { activos++; pico = Math.max(pico, activos); ok() }
    if (activos < Math.max(1, max())) entrar()
    else cola.push(entrar)
  })
  const soltar = () => {
    activos--
    while (cola.length && activos < Math.max(1, max())) cola.shift()!()
  }
  return {
    async con<T>(f: () => Promise<T>): Promise<T> {
      await tomar()
      try { return await f() } finally { soltar() }
    },
    get activos() { return activos },
    get esperando() { return cola.length },
    /** El máximo que hubo a la vez desde que arrancó (para la prueba y la pantalla). */
    get pico() { return pico },
  }
}

export const pasosALaVez = () => Number(process.env.MASTRO_PASOS_A_LA_VEZ) || 6
export const PASOS_DE_FONDO = semaforo(pasosALaVez)
