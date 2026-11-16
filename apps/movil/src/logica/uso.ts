/**
 * El uso del teléfono (Mobile 1.3), sin nada de React Native: se prueba desde el repo. Lo que lee el módulo nativo (en
 * milisegundos, con el lanzador y la barra del sistema) se resume por día en minutos, sin lo que no es «usar» el teléfono.
 */
export type AppCruda = { paquete: string; nombre: string; ms: number; aperturas: number }
export type DiaUso = { fecha: string; pantallaMin: number; desbloqueos: number; apps: { paquete: string; nombre: string; min: number; aperturas: number }[] }

const IGNORAR = /launcher|systemui|inputmethod|\.home$|permissioncontroller|trebuchet/i

/** El inicio y el fin (o ahora) de un día local 'AAAA-MM-DD'. */
export function rangoDelDia(fecha: string, ahora = Date.now()): [number, number] {
  const [a, m, d] = fecha.split('-').map(Number)
  const inicio = new Date(a, m - 1, d).getTime()
  return [inicio, Math.min(new Date(a, m - 1, d + 1).getTime(), ahora)]
}

export function resumirUso(fecha: string, c: { pantallaMs: number; desbloqueos: number; apps: AppCruda[] }): DiaUso {
  const apps = c.apps
    .filter((a) => a.paquete && !IGNORAR.test(a.paquete))
    .map((a) => ({ paquete: a.paquete, nombre: a.nombre || a.paquete, min: Math.round(a.ms / 60_000), aperturas: a.aperturas | 0 }))
    .filter((a) => a.min >= 1)
    .sort((a, b) => b.min - a.min)
    .slice(0, 60)
  const enApps = apps.reduce((s, a) => s + a.min, 0)
  // Sin el dato de pantalla (Android viejo), al menos lo que sumaron las apps.
  return { fecha, pantallaMin: Math.min(1440, Math.max(Math.round(c.pantallaMs / 60_000), enApps)), desbloqueos: c.desbloqueos | 0, apps }
}

/** «3 h 10 min» o «45 min». */
export const horasYMinutos = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`)
